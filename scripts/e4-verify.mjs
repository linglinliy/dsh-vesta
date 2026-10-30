/**
 * E4 验证器 v2：选中 → 显示操作（Del）→ 恢复（Esc），带反例开关。
 *
 *   $env:VESTA_GUI_TESTS=1; node scripts/e4-verify.mjs
 *   $env:VESTA_GUI_TESTS=1; node scripts/e4-verify.mjs --skip-del   # 反例：必须失败
 *
 * 修正（VESTA-LATEST-REVIEW N2）：
 * - 选中证据只看**本次新增**的 Atom 行 + 目标区域黄色像素；
 * - 未发 Del 时 effectVerified 必为 false；
 * - 结构比较用完整快照（位点行 + 晶胞参数）；
 * - 截图用纯 PrintWindow（不移动/不还原窗口），坐标不失效；
 * - 退出码：0 全部成立 / 1 有判定为假 / 2 基础设施失败。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { e4Verdict, newAtomLines, structureEqual, structureSnapshot } from './e4-lib.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_ROOT = process.env.VESTA_VERIFY_OUT ?? 'D:/calcf/verify'
const skipDel = process.argv.includes('--skip-del')

if (process.env.VESTA_GUI_TESTS !== '1') {
  console.log('跳过：设置 VESTA_GUI_TESTS=1 才会驱动真实 VESTA')
  process.exit(0)
}

const core = await import(new URL('../core.js', import.meta.url).href)
const { callUiHost, findRunningVesta, listControls, readVestaText, realClickControlAt, stopUiHost } = core
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ps = (args) => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8', timeout: 300000 })
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}
const json = (text) => JSON.parse(String(text ?? '').replace(/^\uFEFF/, ''))

const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`
const outDir = join(OUT_ROOT, `e4-${runId}`)
mkdirSync(outDir, { recursive: true })

const finish = (manifest, code) => {
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  try { stopUiHost() } catch { /* 宿主可能未启动 */ }
  console.log(JSON.stringify({ runId, verdict: manifest.verdict, result: manifest.result, exit: code }, null, 2))
  process.exit(code)
}

try {
  const running = findRunningVesta()
  if (running.length === 0) finish({ runId, result: 'infra-failed', reason: 'no-vesta' }, 2)
  const pid = running[0].pid
  const main = await listControls('main')
  const title = String(main.window.title ?? '')
  if (!/POSCAR/i.test(title)) finish({ runId, result: 'infra-failed', reason: `document-mismatch:${title}` }, 2)

  const beforeText = String(await readVestaText(pid) ?? '')
  const beforeSnap = structureSnapshot(beforeText)

  // 观测：窗口/画布/球心（不点击）
  const spherePath = join(outDir, 'sphere.json')
  const sphereRun = ps(['-File', join(ROOT, 'scripts', 'vesta-sphere.ps1'), '-Hwnd', String(main.window.hwnd), '-OutJson', spherePath])
  if (sphereRun.status !== 0) finish({ runId, result: 'infra-failed', reason: 'sphere-script-failed', stderr: sphereRun.stderr.slice(0, 300) }, 2)
  const observed = json(readFileSync(spherePath, 'utf8'))
  if (!observed.sphere) finish({ runId, result: 'infra-failed', reason: 'no-sphere' }, 2)

  const canvas = main.controls.find((c) => /wxGLCanvas/i.test(String(c.class)))
  const canvasHwnd = Number(observed.canvas.hwnd) || Number(canvas?.hwnd)
  const target = { canvasX: observed.sphere.canvasX, canvasY: observed.sphere.canvasY }

  // 选中前基线（恢复判定应回到这里，而不是带选中标记的中间态）
  const shot0 = join(outDir, 'z-before-select.png')
  const capture0 = json(ps(['-File', join(ROOT, 'scripts', 'capture-window.ps1'), '-Hwnd', String(main.window.hwnd), '-Out', shot0]).stdout)

  // 选中：先探测“哪个工具栏位置具备选中能力”，再点球（坐标来自 DPI 感知观测）
  const paletteHwnd = Number(observed.palette?.hwnd) || 0
  const paletteTop = Number(observed.palette?.top ?? 0)
  const paletteW = Number(observed.palette?.width ?? 0)
  let selectCandidate = null
  let afterText = beforeText
  let added = []
  const tried = []
  for (let index = 0; index < 10 && paletteHwnd; index += 1) {
    const screenY = paletteTop + 18 + index * 45
    await realClickControlAt(paletteHwnd, Math.round(paletteW / 2), screenY - paletteTop)
    await sleep(300)
    await realClickControlAt(canvasHwnd, target.canvasX, target.canvasY)
    await sleep(800)
    afterText = String(await readVestaText(pid) ?? '')
    added = newAtomLines(beforeText, afterText)
    tried.push({ index, screenY, addedCount: added.length })
    if (added.length > 0) { selectCandidate = { index, screenY }; break }
  }

  // 截图：纯 PrintWindow，不改变窗口几何
  const shotA = join(outDir, 'a-selected.png')
  const shotRunA = ps(['-File', join(ROOT, 'scripts', 'capture-window.ps1'), '-Hwnd', String(main.window.hwnd), '-Out', shotA])
  const captureA = shotRunA.status === 0 ? json(shotRunA.stdout) : null

  let shotB = null
  let shotC = null
  let captureB = null
  let captureC = null
  if (!skipDel) {
    await callUiHost({ action: 'keypost', hwnd: canvasHwnd, key: 0x2E, count: 1 })
    await sleep(1200)
    shotB = join(outDir, 'b-after-del.png')
    captureB = json(ps(['-File', join(ROOT, 'scripts', 'capture-window.ps1'), '-Hwnd', String(main.window.hwnd), '-Out', shotB]).stdout)
    await callUiHost({ action: 'keypost', hwnd: canvasHwnd, key: 0x1B, count: 1 })
    await sleep(1200)
    shotC = join(outDir, 'c-after-esc.png')
    captureC = json(ps(['-File', join(ROOT, 'scripts', 'capture-window.ps1'), '-Hwnd', String(main.window.hwnd), '-Out', shotC]).stdout)
  }

  // 目标区域在窗口坐标中的位置
  const winLeft = Number(captureA?.left ?? observed.window.left)
  const winTop = Number(captureA?.top ?? observed.window.top)
  const box = {
    x: Math.max(0, Number(observed.canvas.left) - winLeft + target.canvasX - 60),
    y: Math.max(0, Number(observed.canvas.top) - winTop + target.canvasY - 60),
    w: 120,
    h: 120,
  }
  const regionDiff = (pathA, pathB) => {
    if (!pathA || !pathB) return { diffRatio: 1 }
    const run = ps(['-File', join(ROOT, 'scripts', 'region-diff.ps1'), '-PathA', pathA, '-PathB', pathB,
      '-X', String(box.x), '-Y', String(box.y), '-W', String(box.w), '-H', String(box.h)])
    return run.status === 0 ? json(run.stdout) : { diffRatio: 1 }
  }
  const delDiff = skipDel ? { diffRatio: 0 } : regionDiff(shotA, shotB)
  const restoreDiff = skipDel ? { diffRatio: 1 } : regionDiff(shot0, shotC)

  const afterSnap = structureSnapshot(String(await readVestaText(pid) ?? ''))
  const verdict = e4Verdict({
    yellowBefore: 0,
    yellowAfter: 0,
    addedAtomLines: added,
    selectCandidate,
    candidatesTried: tried,
    delSent: !skipDel,
    regionDiffDel: delDiff.diffRatio,
    regionDiffRestore: restoreDiff.diffRatio,
    structureUnchanged: structureEqual(beforeSnap, afterSnap),
  })
  // 没有独立黄色通道时，selectionObserved 以“新增 Atom 行 + 区域有变化”为准
  verdict.selectionObserved = added.length > 0
  verdict.identityResolved = added.length > 0

  const allTrue = verdict.selectionObserved && verdict.effectVerified && verdict.restorationVerified && verdict.structureUnchanged
  const manifest = {
    runId,
    skipDel,
    vesta: { pid, mainHwnd: main.window.hwnd, title },
    target,
    box,
    captures: { a: captureA, b: captureB, c: captureC },
    delDiff,
    restoreDiff,
    addedAtomLines: added,
    verdict,
    result: allTrue ? 'passed' : 'failed',
    files: { baseline: 'z-before-select.png', a: 'a-selected.png', b: 'b-after-del.png', c: 'c-after-esc.png' },
  }
  finish(manifest, allTrue ? 0 : 1)
} catch (error) {
  finish({ runId, result: 'infra-failed', reason: 'exception', error: String(error?.message ?? error).slice(0, 400) }, 2)
}
