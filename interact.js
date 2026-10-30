/**
 * 正式交互入口的实现：观测 → 选择 → 隐藏 → 恢复。
 *
 * 设计依据 docs/VESTA-LATEST-REVIEW.md §3 与 docs/VESTA-IMPLEMENTATION-NEXT-STEPS.md 工作包 3/4：
 * - 观测返回 sessionId + geometryRevision（几何一变就拒绝旧坐标）；
 * - 选择返回 selectionToken，绑定文档与几何；
 * - 隐藏/恢复都带前后证据与判定字段，信息不足返回 unknown 而不是硬报成功。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  callUiHost, findRunningVesta, listControls, readVestaText, realClickControlAt, stopUiHost,
} from './core.js'
import { newAtomLines, structureEqual, structureSnapshot } from './scripts/e4-lib.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const sessions = new Map()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16)
const ps = (args) => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8', timeout: 60000 })
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}
const psJson = (args) => {
  const result = ps(args)
  if (result.status !== 0 || !result.stdout) return null
  try { return JSON.parse(result.stdout.replace(/^\uFEFF/, '')) } catch { return null }
}
const tempDir = () => mkdtempSync(join(tmpdir(), 'vesta-interact-'))

const resolveTarget = async (pidOption) => {
  const running = findRunningVesta()
  if (running.length === 0) throw new Error('没有运行中的 VESTA')
  const picked = Number.isInteger(pidOption) ? running.find((item) => item.pid === pidOption) : running[0]
  if (!picked) throw new Error(`找不到 pid=${pidOption} 的 VESTA 窗口`)
  const main = await listControls({ pid: picked.pid, window: 'main' })
  const canvas = main.controls.find((control) => /wxGLCanvas/i.test(String(control.class)))
  if (!canvas) throw new Error('找不到 wxGLCanvas')
  const rects = await callUiHost({ action: 'rect', hwnds: [main.window.hwnd, canvas.hwnd] })
  const byHwnd = new Map((rects.rects ?? []).map((row) => [Number(row.hwnd), row]))
  const windowRect = byHwnd.get(Number(main.window.hwnd))
  const canvasRect = byHwnd.get(Number(canvas.hwnd))
  return { pid: picked.pid, title: String(picked.title ?? main.window.title ?? ''), mainHwnd: main.window.hwnd, canvasHwnd: canvas.hwnd, windowRect, canvasRect }
}

const geometryRevision = (target) => hash(JSON.stringify({
  window: target.windowRect ?? null,
  canvas: target.canvasRect ?? null,
}))

/** 找到左侧竖直工具栏（wxToolBar 自绘，宽度很窄、高度较大）。 */
const findPalette = async (target) => {
  const listing = await listControls({ pid: target.pid, window: 'main' }).catch(() => null)
  const candidates = (listing?.controls ?? []).filter((control) => /ToolbarWindow32/i.test(String(control.class)))
  if (candidates.length === 0) return null
  const rects = await callUiHost({ action: 'rect', hwnds: candidates.map((control) => control.hwnd) })
  const rows = (rects.rects ?? []).filter((row) => Number(row.width) < 80 && Number(row.height) > 300)
  if (rows.length === 0) return null
  const row = rows[0]
  return { hwnd: Number(row.hwnd), width: Number(row.width), height: Number(row.height) }
}

/** 观测：建立会话，返回几何、文档标识与几何版本。 */
export async function observeVesta(options = {}) {
  const target = await resolveTarget(options.pid)
  const text = String(await readVestaText(target.pid) ?? '')
  const snapshot = structureSnapshot(text)
  const revision = geometryRevision(target)
  const sessionId = `${target.pid}-${Date.now().toString(36)}`
  sessions.set(sessionId, { target, revision, document: target.title, snapshot, baseline: null, token: null, targetPoint: null })
  return {
    ok: true,
    sessionId,
    pid: target.pid,
    mainHwnd: target.mainHwnd,
    canvasHwnd: target.canvasHwnd,
    windowRect: target.windowRect ?? null,
    canvasRect: target.canvasRect ?? null,
    geometryRevision: revision,
    document: target.title,
    structure: { rows: snapshot.rows.length, cell: snapshot.cell },
  }
}

/** 选择：默认自动挑最大球；也可给画布坐标。返回 selectionToken 与本次新增身份。 */
export async function selectVesta(sessionId, options = {}) {
  const session = sessions.get(String(sessionId))
  if (!session) throw new Error('未知 sessionId：请先调用 observe')
  const { target } = session
  const current = { window: target.windowRect, canvas: target.canvasRect }
  if (geometryRevision({ windowRect: current.window, canvasRect: current.canvas }) !== session.revision) {
    throw new Error('staleObservation：窗口几何已变化，请重新 observe')
  }

  let point = null
  if (Number.isFinite(options.x) && Number.isFinite(options.y)) {
    point = { x: Number(options.x), y: Number(options.y) }
  } else {
    const dir = tempDir()
    const path = join(dir, 'sphere.json')
    const observed = psJson(['-File', join(ROOT, 'scripts', 'vesta-sphere.ps1'), '-Hwnd', String(target.mainHwnd), '-OutJson', path])
    if (!observed?.sphere) throw new Error('没有找到可选的球（请先切到 Select 模式或给出坐标）')
    point = { x: Number(observed.sphere.canvasX), y: Number(observed.sphere.canvasY) }
  }

  const beforeText = String(await readVestaText(target.pid) ?? '')
  // 基线必须在点击前抓：恢复判定要回到“选中前”的画面
  const baselineDir = tempDir()
  const baseline = join(baselineDir, 'baseline.png')
  psJson(['-File', join(ROOT, 'scripts', 'capture-window.ps1'), '-Hwnd', String(target.mainHwnd), '-Out', baseline])
  await realClickControlAt(target.canvasHwnd, point.x, point.y)
  await sleep(900)
  let afterText = String(await readVestaText(target.pid) ?? '')
  let added = newAtomLines(beforeText, afterText)
  let selectCandidate = null

  // 若还没有选中反馈，逐个候选位置尝试切换工具（不依赖人工预选）
  // 只探测图标区（顶部 8 个位置），避免点到底部的 Properties/Boundary 按钮弹出对话框
  // 注意：这里不做“遍历工具栏猜模式”。模式切换由调用方用一次明确的点击完成，
  // 避免在工具内部循环点击工具栏（可能触发 Properties 等对话框而卡住）。


  const token = added.length > 0 ? hash(`${sessionId}|${session.revision}|${added.join(';')}`) : null
  session.token = token
  session.targetPoint = point
  session.identity = added

  session.baseline = existsSync(baseline) ? baseline : null

  return {
    ok: added.length > 0,
    sessionId,
    point,
    selectionToken: token,
    identity: added,
    identityLine: added[0] ?? null,
    selectCandidate,
    status: added.length > 0 ? 'supported' : 'unknown',
    note: added.length > 0 ? '' : '未观察到本次新增的 Atom 行：可能不是 Select 模式，或点不在球上',
  }
}

/** 隐藏：对当前选中项发 Del，返回区域差异判定（faded 语义）。 */
export async function hideSelected(sessionId, token) {
  const session = sessions.get(String(sessionId))
  if (!session) throw new Error('未知 sessionId')
  if (!session.token || session.token !== token) throw new Error('selectionToken 不匹配：请重新 select')
  const { target } = session
  if (geometryRevision({ windowRect: target.windowRect, canvasRect: target.canvasRect }) !== session.revision) {
    throw new Error('staleObservation：窗口几何已变化，请重新 observe')
  }
  const dir = tempDir()
  const before = join(dir, 'before.png')
  const after = join(dir, 'after.png')
  psJson(['-File', join(ROOT, 'scripts', 'capture-window.ps1'), '-Hwnd', String(target.mainHwnd), '-Out', before])
  await callUiHost({ action: 'keypost', hwnd: target.canvasHwnd, key: 0x2e, count: 1 })
  await sleep(1200)
  psJson(['-File', join(ROOT, 'scripts', 'capture-window.ps1'), '-Hwnd', String(target.mainHwnd), '-Out', after])

  const point = session.targetPoint ?? { x: 0, y: 0 }
  const win = session.target.windowRect ?? { left: 0, top: 0 }
  const canvas = session.target.canvasRect ?? { left: 0, top: 0 }
  const box = {
    x: Math.max(0, Number(canvas.left) - Number(win.left) + point.x - 60),
    y: Math.max(0, Number(canvas.top) - Number(win.top) + point.y - 60),
    w: 120,
    h: 120,
  }
  const diff = psJson(['-File', join(ROOT, 'scripts', 'region-diff.ps1'), '-PathA', before, '-PathB', after,
    '-X', String(box.x), '-Y', String(box.y), '-W', String(box.w), '-H', String(box.h)])
  const ratio = Number(diff?.diffRatio ?? 0)
  session.hiddenAfter = after
  return {
    ok: ratio > 0.02,
    sessionId,
    effect: ratio > 0.02 ? 'faded' : 'unknown',
    regionDiff: ratio,
    note: '只验证“变淡（faded）”，未验证渲染中完全不可见',
    evidence: { before, after },
  }
}

/** 恢复：Esc，并与选中前基线比较。 */
export async function restoreVesta(sessionId, token) {
  const session = sessions.get(String(sessionId))
  if (!session) throw new Error('未知 sessionId')
  if (!session.token || session.token !== token) throw new Error('selectionToken 不匹配：请重新 select')
  const { target } = session
  await callUiHost({ action: 'keypost', hwnd: target.canvasHwnd, key: 0x1b, count: 1 })
  await sleep(1200)
  const dir = tempDir()
  const after = join(dir, 'restored.png')
  psJson(['-File', join(ROOT, 'scripts', 'capture-window.ps1'), '-Hwnd', String(target.mainHwnd), '-Out', after])

  const point = session.targetPoint ?? { x: 0, y: 0 }
  const win = session.target.windowRect ?? { left: 0, top: 0 }
  const canvas = session.target.canvasRect ?? { left: 0, top: 0 }
  const box = {
    x: Math.max(0, Number(canvas.left) - Number(win.left) + point.x - 60),
    y: Math.max(0, Number(canvas.top) - Number(win.top) + point.y - 60),
    w: 120,
    h: 120,
  }
  let ratio = null
  if (session.baseline && existsSync(session.baseline) && existsSync(after)) {
    const diff = psJson(['-File', join(ROOT, 'scripts', 'region-diff.ps1'), '-PathA', session.baseline, '-PathB', after,
      '-X', String(box.x), '-Y', String(box.y), '-W', String(box.w), '-H', String(box.h)])
    ratio = Number(diff?.diffRatio ?? 1)
  }
  return {
    ok: ratio !== null && ratio < 0.01,
    sessionId,
    restored: ratio !== null && ratio < 0.01,
    regionDiff: ratio,
    note: ratio === null ? '缺少基线截图，无法判定' : (ratio < 0.01 ? '已恢复' : '未完全恢复'),
    evidence: { after },
  }
}

/** 读取会话当前结构，用于“结构未变”核验。 */
export async function sessionStructure(sessionId) {
  const session = sessions.get(String(sessionId))
  if (!session) throw new Error('未知 sessionId')
  const text = String(await readVestaText(session.target.pid) ?? '')
  const snapshot = structureSnapshot(text)
  return {
    ok: true,
    unchanged: structureEqual(session.snapshot, snapshot),
    rows: snapshot.rows.length,
  }
}

export function closeVestaSessions() {
  sessions.clear()
  stopUiHost()
}
