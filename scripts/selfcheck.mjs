#!/usr/bin/env node
/**
 * selfcheck —— 一条命令跑完全部自检：单测 + MCP 冒烟 + 各生成器端到端。
 *
 *   node scripts/selfcheck.mjs [--fixture <含 VASP 任务的根目录>] [--keep]
 *
 * 默认 fixture 是本机已有的示例任务根目录；每个生成器都会在临时目录里真跑一次并检查产物体积。
 * 退出码 0 = 全过；任何一项失败 = 1。加 --keep 保留临时产物。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
// 本机真实 VASP 任务根目录（不含在仓库里）：用 --fixture 或环境变量 VASP_FIXTURE_ROOT 指定
const fixture = flag('fixture', process.env.VASP_FIXTURE_ROOT ?? '')
const keep = args.includes('--keep')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// 1) 单元测试
const testDir = join(ROOT, 'test')
const suites = readdirSync(testDir).filter((file) => file.endsWith('.test.mjs')).sort()
for (const suite of suites) {
  const run = spawnSync(process.execPath, ['--test', join(testDir, suite)], { encoding: 'utf8' })
  const output = `${run.stdout}\n${run.stderr}`
  const pass = /pass (\d+)/.exec(output)?.[1] ?? '?'
  const fail = /fail (\d+)/.exec(output)?.[1] ?? '?'
  record(`单测 ${suite}`, run.status === 0, `${pass} passed / ${fail} failed`)
}

// 2) MCP 冒烟
const smoke = spawnSync(process.execPath, [join(testDir, 'smoke.mjs')], { encoding: 'utf8' })
record('MCP 冒烟', smoke.status === 0 && /5\/5/.test(smoke.stdout), smoke.stdout.trim().split('\n').pop())

// 3) 生成器端到端
if (!fixture) {
  record('生成器自检', true, '跳过：未设置 VASP_FIXTURE_ROOT（生成器端到端需要真实 VASP 任务目录）')
} else if (!existsSync(fixture)) {
  record('生成器自检', false, `fixture 不存在：${fixture}`)
} else {
  const work = mkdtempSync(join(tmpdir(), 'vesta-selfcheck-'))
  const atlas = join(work, 'atlas')
  const spawn = (script, scriptArgs) => spawnSync(process.execPath, [join(HERE, script), ...scriptArgs], { encoding: 'utf8' })

  const batch = spawn('make-all.mjs', ['--root', fixture, '--out', atlas])
  const index = join(atlas, 'index.html')
  record('make-all（结构/DOS/能带/收敛 + 索引 + 表格）', batch.status === 0 && existsSync(index), index)

  const compareDos = join(work, 'compare-dos.html')
  const cmp = spawn('make-compare.mjs', ['--root', fixture, '--kind', 'dos', '--out', compareDos])
  record('make-compare dos', cmp.status === 0 && existsSync(compareDos), compareDos)

  const compareConv = join(work, 'compare-conv.html')
  const cmpConv = spawn('make-compare.mjs', ['--root', fixture, '--kind', 'conv', '--out', compareConv])
  record('make-compare conv', cmpConv.status === 0 && existsSync(compareConv), compareConv)

  const table = join(work, 'table.md')
  const tbl = spawn('make-table.mjs', ['--root', fixture, '--out', table])
  record('make-table', tbl.status === 0 && existsSync(table) && statSync(table).size > 100, table)

  const incarDiff = join(work, 'incar-diff.html')
  const inc = spawn('make-incar-diff.mjs', ['--root', fixture, '--out', incarDiff])
  record('make-incar-diff', inc.status === 0 && existsSync(incarDiff), incarDiff)

  if (keep) console.log(`\n产物保留在：${work}`)
  else rmSync(work, { recursive: true, force: true })
}

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
if (failed.length > 0) {
  console.log('失败项：' + failed.map((item) => item.name).join('、'))
  process.exit(1)
}
