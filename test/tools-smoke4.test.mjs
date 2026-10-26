/**
 * 第四批冒烟：VESTA 进程类工具（open / menu / control）与 slab_report / vesta_info。
 *   node --test test/tools-smoke4.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { DEFAULT_EXECUTABLE } from '../core.js'

const loadTools = () => {
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    effect: (factory) => { factory() },
  }
  apply(ctx, {})
  return tools
}

const VESTA = DEFAULT_EXECUTABLE
const hasVesta = existsSync(VESTA)
const SI = '<本地任务根目录>/5.5/POSCAR'
const hasFixture = existsSync(SI)
const ADSORPTION = '<本地 pilot 数据集>/adsorption_tasks'
const hasAdsorption = existsSync(ADSORPTION)

/** 结束时清掉 VESTA，避免单实例进程影响后续测试。 */
const killVesta = () => {
  try {
    execFileSync('taskkill', ['/IM', 'VESTA.exe', '/F'], { stdio: 'ignore' })
  } catch {
    /* 没在跑就算了 */
  }
}

test('vesta_info：报告可执行文件与版本标识', { skip: !hasVesta && '本机没有 VESTA' }, async () => {
  const tools = loadTools()
  const result = await tools.get('vesta_info').execute({}, {})
  assert.equal(result.ok, true)
  assert.match(result.summary, /VESTA\.exe|3\.\d/)
})

test('vesta_open + vesta_menu + vesta_control：真实驱动 VESTA', { skip: (!hasVesta || !hasFixture) && '缺少 VESTA 或夹具' }, async () => {
  const tools = loadTools()
  killVesta()
  try {
    const opened = await tools.get('vesta_open').execute({ paths: [SI] }, {})
    assert.equal(opened.ok, true)
    assert.match(opened.summary, /POSCAR/)
    assert.ok(opened.summary.includes('pid') || /pid \d+/.test(opened.summary), `没拿到 pid：${opened.summary.slice(0, 120)}`)

    const menu = await tools.get('vesta_menu').execute({ list: true }, {})
    assert.equal(menu.ok, true)
    assert.match(menu.summary, /\d+ 条命令/)
    const commandCount = Number(/(\d+) 条命令/.exec(menu.summary)?.[1] ?? 0)
    assert.ok(commandCount >= 50, `菜单命令太少：${commandCount}`)

    const controls = await tools.get('vesta_control').execute({ action: 'list', window: 'main' }, {})
    assert.equal(controls.ok, true)
    const controlCount = Number(/(\d+) 个控件/.exec(controls.summary)?.[0]?.match(/\d+/)?.[0] ?? 0)
    assert.ok(controlCount >= 20, `控件太少：${controlCount}`)
  } finally {
    killVesta()
  }
})

test('slab_report：真实吸附数据目录出表', { skip: !hasAdsorption && '缺少吸附数据' }, async () => {
  const tools = loadTools()
  // 显式写临时目录，避免把产物丢进用户的数据目录
  const out = join(mkdtempSync(join(tmpdir(), 'vesta-slab-')), 'slab-report.md')
  const result = await tools.get('slab_report').execute({
    path: ADSORPTION, adsorbate: 'Na', substrate: 'C', depth: 1, out,
  }, {})
  assert.equal(result.ok, true)
  assert.equal(result.tasks, 32)
  assert.match(result.summary, /hollow/)
  assert.equal(result.path, out, '应回报显式给的输出路径')
  assert.ok(existsSync(out), `表格不存在：${out}`)
})
