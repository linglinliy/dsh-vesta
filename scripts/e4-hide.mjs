import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { callUiHost, captureFullWindow, findRunningVesta, listControls, readVestaText, stopUiHost } from 'file:///D:/DSH/vesta-plugin/core.js'

const OUT = 'D:/calcf/verify/e4'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const r = findRunningVesta()
if (r.length === 0) { console.log('no vesta'); process.exit(0) }
const pid = r[0].pid

const info = async () => {
  const text = String(await readVestaText(pid) ?? '')
  const block = text.split(/={20,}/).filter((b) => b.includes('Structure parameters')).pop() ?? ''
  const rows = block.split(/\r?\n/).filter((l) => /^\s*\d+\s+[A-Z][a-z]?\s+\S+\s+-?\d/.test(l)).length
  const atomLine = text.split(/\r?\n/).filter((l) => /^\s*Atom:\s/.test(l)).pop() ?? ''
  const bondLine = text.split(/\r?\n/).filter((l) => /^\s*Bond:\s/.test(l)).pop() ?? ''
  const bondCountLine = text.split(/\r?\n/).filter((l) => /\d+\s+atoms?,\s*\d+\s+bonds?/i.test(l)).pop() ?? ''
  return { rows, atomLine: atomLine.trim(), bondLine: bondLine.trim(), bondCountLine: bondCountLine.trim(), lines: text.split(/\r?\n/).length }
}

const main = await listControls('main')
const canvas = main.controls.find((c) => /wxGLCanvas/i.test(String(c.class)))
const before = await info()
console.log('选中态:', JSON.stringify(before))
await captureFullWindow(pid, `${OUT}/e4-1-selected.png`, { width: 1200, height: 760 })

// Del：隐藏当前选中的显示对象（不是删除结构）
await callUiHost({ action: 'keypost', hwnd: canvas.hwnd, key: 0x2E, count: 1 })
await sleep(1500)
const afterDel = await info()
console.log('Del 后:', JSON.stringify(afterDel))
await captureFullWindow(pid, `${OUT}/e4-2-after-del.png`, { width: 1200, height: 760 })

// Esc：恢复显示
await callUiHost({ action: 'keypost', hwnd: canvas.hwnd, key: 0x1B, count: 1 })
await sleep(1500)
const afterEsc = await info()
console.log('Esc 后:', JSON.stringify(afterEsc))
await captureFullWindow(pid, `${OUT}/e4-3-after-esc.png`, { width: 1200, height: 760 })

const manifest = {
  runId: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
  pid,
  canvasHwnd: canvas.hwnd,
  steps: { before, afterDel, afterEsc },
  verdict: {
    selectionSeen: Boolean(before.atomLine),
    structureUnchangedAfterDel: afterDel.rows === before.rows,
    textChangedAfterDel: afterDel.lines !== before.lines || afterDel.atomLine !== before.atomLine,
    restoredAfterEsc: afterEsc.rows === before.rows,
  },
}
writeFileSync(`${OUT}/e4-manifest.json`, JSON.stringify(manifest, null, 2), 'utf8')
console.log('verdict:', JSON.stringify(manifest.verdict))
stopUiHost()
process.exit(0)
