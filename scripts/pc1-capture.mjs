import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { captureFullWindow, findRunningVesta, invokeCommand, listControls, stopUiHost } from 'file:///D:/DSH/vesta-plugin/core.js'

const OUT = 'D:/calcf/verify/pc1'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const diff = (a, b) => Number(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  'D:/calcf/verify/e4/diff2.ps1', '-PathA', a, '-PathB', b], { encoding: 'utf8', timeout: 120000 }).trim())

const r = findRunningVesta()
if (r.length === 0) { console.log('no vesta'); process.exit(0) }
const pid = r[0].pid
const main = await listControls('main')

const a = `${OUT}/pc1-before.png`
const b = `${OUT}/pc1-after.png`
const before = await captureFullWindow(pid, a, { width: 1200, height: 760 })
for (let i = 0; i < 3; i += 1) { await invokeCommand(5137, { pid }); await sleep(350) }
await sleep(1200)
const after = await captureFullWindow(pid, b, { width: 1200, height: 760 })
const ratio = diff(a, b)
await invokeCommand(209, { pid })    // Fit to Screen
await sleep(1000)

const manifest = {
  runId: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
  method: 'PrintWindow（不依赖前台/屏幕未被遮挡）',
  action: 'WM_COMMAND 5137 Zoom In ×3',
  before: { ok: before.ok, ink: before.ink, method: before.method },
  after: { ok: after.ok, ink: after.ink, method: after.method },
  diffRatio: ratio,
  verdict: ratio > 0.03 ? 'capture-sensitive-confirmed' : 'inconclusive',
}
writeFileSync(`${OUT}/pc1-manifest.json`, JSON.stringify(manifest, null, 2), 'utf8')
console.log(JSON.stringify(manifest, null, 2))
stopUiHost()
process.exit(0)
