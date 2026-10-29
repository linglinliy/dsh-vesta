/**
 * VESTA 交互验证（E1 + 候选点击探测），按 VESTA-VERIFICATION-REVIEW.md 修正后的口径输出。
 *
 *   $env:VESTA_GUI_TESTS=1; node scripts/verify-vesta.mjs
 *
 * 本脚本只做“诊断”：产生几何与候选点击记录，**不**执行隐藏/删除等副作用动作。
 * 退出码：0 = 有可确认的选中证据；1 = 未观察到选中；2 = 基础设施失败（几何缺失/清单损坏/文档不匹配）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectTrials, isCandidate, parseTrials } from './verify-lib.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_ROOT = process.env.VESTA_VERIFY_OUT ?? 'D:/calcf/verify'
const FIXTURE = process.env.VESTA_VERIFY_FIXTURE ?? 'D:/calcf/si/POSCAR'

if (process.env.VESTA_GUI_TESTS !== '1') {
  console.log('跳过：设置 VESTA_GUI_TESTS=1 才会驱动真实 VESTA')
  process.exit(0)
}

const core = await import(new URL('../core.js', import.meta.url).href)
const { callUiHost, findRunningVesta, listControls, openFiles, readVestaText, stopUiHost } = core
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(OUT_ROOT, runId)
mkdirSync(outDir, { recursive: true })

const textInfo = (text) => {
  const body = String(text ?? '')
  const block = body.split(/={20,}/).filter((b) => b.includes('Structure parameters')).pop() ?? ''
  const rows = block.split(/\r?\n/).filter((l) => /^\s*\d+\s+[A-Z][a-z]?\s+\S+\s+-?\d/.test(l)).length
  const countLine = body.split(/\r?\n/).filter((l) => /\d+\s+atoms/i.test(l)).pop() ?? ''
  const m = /(\d+)\s+atoms/.exec(countLine)
  return { rows, renderedFromLog: m ? Number(m[1]) : null, lines: body.split(/\r?\n/).length }
}

const finish = (manifest, code) => {
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  writeFileSync(join(outDir, 'summary.md'), [
    `# 验证 ${runId}`,
    '',
    `- 结果：**${manifest.result}**（退出码 ${code}）`,
    `- 基础设施：${manifest.infra?.ok ? 'ok' : manifest.infra?.reason ?? '?'}`,
    `- 结构：${manifest.structure?.before?.rows ?? '?'} 原子行（文档 ${manifest.document ?? '?'}）`,
    `- 候选点击：${manifest.e2?.trials ?? 0} 次 / 候选 ${manifest.e2?.candidates ?? 0}`,
    `- 几何：${JSON.stringify(manifest.geometry ?? null)}`,
  ].join('\n'), 'utf8')
  try { stopUiHost() } catch { /* 宿主可能未启动 */ }
  console.log(`result=${manifest.result} exit=${code}`)
  process.exit(code)
}

try {
  let running = findRunningVesta()
  if (running.length === 0) {
    await openFiles({ executable: 'D:/VESTA-win64/VESTA.exe' }, [FIXTURE])
    await sleep(6000)
    running = findRunningVesta()
  }
  if (running.length === 0) {
    finish({ runId, time: new Date().toISOString(), result: 'infra-failed', infra: { ok: false, reason: 'no-vesta' } }, 2)
  }
  const pid = running[0].pid
  for (let i = 0; i < 25; i += 1) {
    const t = await readVestaText(pid).catch(() => null)
    if (t && /Structure parameters/.test(String(t))) break
    await sleep(1000)
  }
  const main = await listControls('main')
  const title = String(main.window.title ?? '')
  const documentOk = /POSCAR/i.test(title)
  const before = textInfo(await readVestaText(pid))

  const ps = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'vesta-trials.ps1'),
    '-Hwnd', String(main.window.hwnd), '-OutJson', join(outDir, 'trials.jsonl'),
  ], { encoding: 'utf8', timeout: 600000 })
  if (ps.status !== 0) {
    finish({
      runId, time: new Date().toISOString(), result: 'infra-failed',
      newInfra: undefined,
      infra: { ok: false, reason: `trials-script-exit-${ps.status}` },
      stderr: (ps.stderr ?? '').slice(0, 400),
    }, 2)
  }

  const raw = existsSync(join(outDir, 'trials.jsonl')) ? readFileSync(join(outDir, 'trials.jsonl'), 'utf8') : ''
  const parsed = parseTrials(raw)
  const inspected = inspectTrials(parsed)
  const candidates = inspected.trials.filter((row) => isCandidate(row))
  const infraOk = inspected.infraOk && documentOk

  const manifest = {
    runId,
    time: new Date().toISOString(),
    source: { repo: 'D:/DSH/vesta-plugin', version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version },
    host: { node: process.version, platform: process.platform, arch: process.arch },
    vesta: { pid, mainHwnd: main.window.hwnd, title },
    document: documentOk ? 'POSCAR' : 'mismatch',
    fixture: FIXTURE,
    geometry: inspected.geometry,
    infra: {
      ok: infraOk,
      reason: infraOk ? '' : (!documentOk ? 'document-mismatch' : inspected.infraReason),
      invalidLines: parsed.invalid,
    },
    status: {
      inputSent: inspected.trials.length > 0,
      selectionObserved: candidates.length > 0,
      identityResolved: false,
      effectVerified: false,
    },
    e2: {
      trials: inspected.trials.length,
      candidates: candidates.length,
      note: '候选仅为诊断；未执行隐藏/删除',
      byVariant: inspected.trials.reduce((acc, row) => {
        const key = String(row.variant ?? 'unknown')
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
    },
    e3: { ran: false, reason: 'planned: 依赖可确认的选中基线' },
    e4: { ran: false, reason: 'not-run: 需先有唯一确认的选中试次，再由独立步骤执行' },
    structure: { before, after: textInfo(await readVestaText(pid)) },
    result: infraOk ? (candidates.length > 0 ? 'candidate-observed' : 'no-selection-observed') : 'infra-failed',
    files: { trials: 'trials.jsonl' },
  }
  finish(manifest, infraOk ? (candidates.length > 0 ? 0 : 1) : 2)
} catch (error) {
  finish({
    runId, time: new Date().toISOString(), result: 'infra-failed',
    infra: { ok: false, reason: 'exception' },
    error: String(error?.message ?? error).slice(0, 400),
  }, 2)
}
