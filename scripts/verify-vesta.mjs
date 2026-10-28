/**
 * VESTA 交互验证（E1–E4），按 VESTA-INTERACTION-REVIEW.md §4/§5 的清单格式输出。
 *
 *   $env:VESTA_GUI_TESTS=1; node scripts/verify-vesta.mjs
 *
 * 产出：<outDir>/<runId>/manifest.json、summary.md、trials.json、t*.png
 * 只读验证：不修改用户结构文件；E4 仅在真的观察到选中时执行，并用 Esc 恢复。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_ROOT = process.env.VESTA_VERIFY_OUT ?? 'D:/calcf/verify'

if (process.env.VESTA_GUI_TESTS !== '1') {
  console.log('跳过：设置 VESTA_GUI_TESTS=1 才会驱动真实 VESTA')
  process.exit(0)
}

const { callUiHost, captureFullWindow, findRunningVesta, listControls, openFiles, readVestaText, stopUiHost } = await import(
  'file:///D:/DSH/vesta-plugin/core.js'
)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(OUT_ROOT, runId)
mkdirSync(outDir, { recursive: true })

const textInfo = (text) => {
  const block = String(text ?? '').split(/={20,}/).filter((b) => b.includes('Structure parameters')).pop() ?? ''
  const rows = block.split(/\r?\n/).filter((l) => /^\s*\d+\s+[A-Z][a-z]?\s+\S+\s+-?\d/.test(l)).length
  const countLine = String(text ?? '').split(/\r?\n/).filter((l) => /atoms,.*bonds/i.test(l)).pop() ?? ''
  const m = /(\d+)\s+atoms/.exec(countLine)
  return { rows, rendered: m ? Number(m[1]) : null, lines: String(text ?? '').split(/\r?\n/).length }
}

// ---------- 准备 ----------
let running = findRunningVesta()
if (running.length === 0) {
  await openFiles({ executable: 'D:/VESTA-win64/VESTA.exe' }, ['D:/calcf/si/POSCAR'])
  await sleep(6000)
  running = findRunningVesta()
}
if (running.length === 0) {
  console.log('无法启动 VESTA')
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ runId, ok: false, error: 'no-vesta' }, null, 2))
  process.exit(1)
}
const pid = running[0].pid
for (let i = 0; i < 25; i += 1) {
  const t = await readVestaText(pid).catch(() => null)
  if (t && /Structure parameters/.test(String(t))) break
  await sleep(1000)
}
const main = await listControls('main')
const before = textInfo(await readVestaText(pid))
console.log(`runId=${runId} pid=${pid} 主窗口=${main.window.hwnd} 结构行=${before.rows} 渲染=${before.rendered}`)

// ---------- E1 + E2 ----------
const ps = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'vesta-trials.ps1'),
  '-Hwnd', String(main.window.hwnd), '-OutJson', join(outDir, 'trials.json'),
], { encoding: 'utf8', timeout: 600000 })
process.stdout.write(ps.stdout ?? '')
if (ps.status !== 0) console.error('trials stderr:', (ps.stderr ?? '').slice(0, 400))

const raw = existsSync(join(outDir, 'trials.json')) ? readFileSync(join(outDir, 'trials.json'), 'utf8') : ''
const trials = raw.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).map((l) => {
  try { return JSON.parse(l) } catch { return { parseError: l.slice(0, 120) } }
})

// ---------- 判定 ----------
const candidates = trials.filter((t) => t.phase === 'E2' && t.stats && (t.stats.diffLocal > 0.05 || (t.stats.yellowAfter - t.stats.yellowBefore) > 40))
const selectionObserved = candidates.length > 0

// ---------- E4（仅在观察到选中时） ----------
let e4 = { ran: false, reason: selectionObserved ? '' : 'no-selection-observed' }
if (selectionObserved) {
  const canvas = main.controls.find((c) => /wxGLCanvas/i.test(String(c.class)))
  const beforeE4 = textInfo(await readVestaText(pid))
  await callUiHost({ action: 'keypost', hwnd: canvas.hwnd, key: 0x2E, count: 1 })
  await sleep(1200)
  const afterE4 = textInfo(await readVestaText(pid))
  await captureFullWindow(pid, join(outDir, 'e4-after-delete.png'), { width: 1200, height: 760 })
  await callUiHost({ action: 'keypost', hwnd: canvas.hwnd, key: 0x1B, count: 1 })
  await sleep(1000)
  const restored = textInfo(await readVestaText(pid))
  e4 = {
    ran: true,
    before: beforeE4,
    afterDelete: afterE4,
    afterEsc: restored,
    structureUnchanged: afterE4.rows === beforeE4.rows,
    renderedChanged: afterE4.rendered !== beforeE4.rendered,
  }
}

// ---------- 清单 ----------
const manifest = {
  runId,
  time: new Date().toISOString(),
  source: { repo: 'D:/DSH/vesta-plugin', version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version },
  host: { node: process.version, platform: process.platform, arch: process.arch },
  vesta: { pid, mainHwnd: main.window.hwnd },
  geometry: trials.find((t) => t.phase === 'E1')?.geometry ?? null,
  status: {
    inputSent: trials.some((t) => t.phase === 'E2'),
    selectionObserved,
    identityResolved: false,
    effectVerified: e4.ran ? Boolean(e4.renderedChanged) : false,
  },
  e2: { trials: trials.filter((t) => t.phase === 'E2').length, candidates },
  e3: { ran: false, reason: selectionObserved ? '' : 'blocked: E2 未产出选中基线' },
  e4,
  structure: { before, after: textInfo(await readVestaText(pid)) },
  result: selectionObserved ? (e4.structureUnchanged && e4.renderedChanged ? 'passed' : 'inconclusive') : 'failed',
  files: { trials: 'trials.json' },
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

const lines = [
  `# 验证 ${runId}`,
  '',
  `- VESTA pid=${pid}，主窗口 ${main.window.hwnd}`,
  `- 结构：${manifest.structure.before.rows} 原子行，渲染 ${manifest.structure.before.rendered}`,
  `- E2 试次：${manifest.e2.trials}，命中候选：${manifest.e2.candidates.length}`,
  `- 选中观察到：${selectionObserved}`,
  `- E4：${e4.ran ? JSON.stringify(e4) : '未执行（' + e4.reason + '）'}`,
  `- 结论：**${manifest.result}**`,
]
writeFileSync(join(outDir, 'summary.md'), lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
stopUiHost()
process.exit(0)
