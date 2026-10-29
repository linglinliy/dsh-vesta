/**
 * 导出 PNG 并生成“日志 ↔ 产物”一一绑定的清单（唯一路径 + SHA-256 + 解码尺寸）。
 *
 *   $env:VESTA_GUI_TESTS=1; node scripts/export-png.mjs
 *
 * 分工：PS 只负责保存对话框（选 PNG 格式 + 填路径 + 回车）；后续对话框由本脚本点击。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
if (process.env.VESTA_GUI_TESTS !== '1') {
  console.log('跳过：设置 VESTA_GUI_TESTS=1 才会驱动真实 VESTA')
  process.exit(0)
}

const core = await import(new URL('../core.js', import.meta.url).href)
const { callUiHost, findRunningVesta, listControls, stopUiHost } = core
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 处理导出后的后续对话框：Export Graphics / Export image / 确认另存为 → 点 OK / 是 */
const dismissFollowups = async () => {
  const clicked = []
  for (let i = 0; i < 8; i += 1) {
    const dialog = await listControls('dialog').catch(() => null)
    if (!dialog?.window?.title) break
    const title = String(dialog.window.title)
    if (!/Export|确认另存为/.test(title)) break
    const button = dialog.controls?.find((c) => String(c.class) === 'Button' && String(c.text).trim() === 'OK')
      ?? dialog.controls?.find((c) => String(c.class) === 'Button' && /^是/.test(String(c.text).trim()))
    if (!button) { clicked.push(`${title}:no-button`); break }
    await callUiHost({ action: 'clickpost', hwnd: button.hwnd })
    clicked.push(`${title}:${String(button.text).trim()}`)
    await sleep(1800)
  }
  return clicked
}

const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join('D:/calcf/verify', `export-${runId}`)
mkdirSync(outDir, { recursive: true })
const target = join(outDir, 'export.png')
const logPath = join(outDir, 'export-log.json')

const running = findRunningVesta()
if (running.length === 0) {
  console.log('没有运行中的 VESTA')
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ runId, ok: false, error: 'no-vesta' }, null, 2))
  process.exit(2)
}
const pid = running[0].pid

const ps = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'vesta-export-png2.ps1'),
  '-Target', target, '-OutJson', logPath,
], { encoding: 'utf8', timeout: 600000 })

const followups = await dismissFollowups()
await sleep(800)

const logRaw = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
const log = logRaw ? JSON.parse(logRaw.replace(/^\uFEFF/, '')) : null
const exists = existsSync(target)
const verification = { exists, size: 0, sha256: '', signature: '', width: 0, height: 0 }
if (exists) {
  const buffer = readFileSync(target)
  verification.size = buffer.length
  verification.sha256 = createHash('sha256').update(buffer).digest('hex')
  verification.signature = buffer.slice(0, 8).toString('hex')
  if (verification.signature === '89504e470d0a1a0a') {
    verification.width = buffer.readUInt32BE(16)
    verification.height = buffer.readUInt32BE(20)
  }
}

const manifest = {
  runId,
  time: new Date().toISOString(),
  vesta: { pid },
  outDir,
  target,
  spawn: { status: ps.status, stderr: (ps.stderr ?? '').slice(0, 400) },
  log,
  followups,
  verification,
  verdict: verification.signature === '89504e470d0a1a0a' && verification.width > 0 ? 'png-verified' : 'not-png',
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
console.log(JSON.stringify({ runId, followups, verification, verdict: manifest.verdict }, null, 2))
stopUiHost()
process.exit(manifest.verdict === 'png-verified' ? 0 : 1)
