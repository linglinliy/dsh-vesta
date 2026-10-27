#!/usr/bin/env node
/**
 * 逐个跑「需要真实夹具 / 需要 VESTA」的测试文件，每个文件独立进程，跑完清掉 VESTA。
 *
 * 为什么需要它：这些用例共享 VESTA 这个**单实例 GUI 资源**。放在同一个 node 进程里连续跑，
 * 前一个用例残留的 VESTA 窗口会让后一个用例的 `-open`/文本区读取卡住（表现是整轮挂死而不是失败）。
 * 每个文件一个进程 + 每次清理，就稳定了。
 *
 * 用法：
 *   node scripts/test-real-fixtures.mjs
 *   VASP_FIXTURE_ROOT=<任务根目录> node scripts/test-real-fixtures.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEST_DIR = join(HERE, '..', 'test')
// 只挑「会真启动 VESTA 或用真实夹具」的套件
const SUITES = ['tools-smoke.test.mjs', 'tools-smoke2.test.mjs', 'tools-smoke4.test.mjs']

const killVesta = () => {
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process VESTA -ErrorAction SilentlyContinue | Stop-Process -Force'], { windowsHide: true, timeout: 20000 })
  } catch { /* 没有就算了 */ }
}

const rows = []
for (const suite of SUITES) {
  const file = join(TEST_DIR, suite)
  if (!existsSync(file)) { rows.push([suite, '缺失', '']); continue }
  killVesta()
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], {
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env },
  })
  killVesta()
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const pass = /ℹ pass (\d+)/.exec(output)?.[1] ?? '?'
  const fail = /ℹ fail (\d+)/.exec(output)?.[1] ?? '?'
  const skipped = /ℹ skipped (\d+)/.exec(output)?.[1] ?? '?'
  const timedOut = result.error?.code === 'ETIMEDOUT'
  rows.push([suite, timedOut ? '超时' : (fail === '0' ? '通过' : '失败'), `pass=${pass} fail=${fail} skipped=${skipped}`])
}

console.log('套件'.padEnd(28) + '结果'.padEnd(8) + '计数')
for (const [suite, status, detail] of rows) console.log(suite.padEnd(28) + status.padEnd(8) + detail)
const bad = rows.filter(([, status]) => status !== '通过' && status !== '缺失')
console.log(`\n合计：${rows.length - bad.length}/${rows.length} 套件通过`)
process.exit(bad.length === 0 ? 0 : 1)
