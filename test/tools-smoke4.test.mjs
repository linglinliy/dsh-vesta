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
// 仓库里是脱敏占位路径；设了 VASP_FIXTURE_ROOT 就用真实数据
const FIXTURE_ROOT = process.env.VASP_FIXTURE_ROOT ?? '<本地任务根目录>'
const SI = `${FIXTURE_ROOT}/5.5/POSCAR`
const hasFixture = existsSync(SI)
const ADSORPTION = process.env.VASP_ADSORPTION_ROOT ?? '<本地 pilot 数据集>/adsorption_tasks'
const hasAdsorption = existsSync(ADSORPTION)

/** 只清掉本用例自己打开的 VESTA（按 pid），不按镜像名全局杀，避免连累并行用例。 */
let trackedPid = null
const killVesta = () => {
  if (!trackedPid) return
  try {
    execFileSync('taskkill', ['/PID', String(trackedPid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* 已经退出了 */
  }
  trackedPid = null
}
/** 从 vesta_open 的摘要里记住 pid。 */
const rememberPid = (summary) => { const match = /pid (\d+)/.exec(summary ?? ''); if (match) trackedPid = Number(match[1]) }

test('vesta_info：报告可执行文件与版本标识', { skip: !hasVesta && '本机没有 VESTA' }, async () => {
  const tools = loadTools()
  const result = await tools.get('vesta_info').execute({}, {})
  assert.equal(result.ok, true)
  assert.match(result.summary, /VESTA\.exe|3\.\d/)
})

test('vesta_open + vesta_menu + vesta_control：真实驱动 VESTA', { skip: (!hasVesta || !hasFixture) && '缺少 VESTA 或夹具', timeout: 180000 }, async () => {
  const tools = loadTools()
  killVesta()
  try {
    const opened = await tools.get('vesta_open').execute({ paths: [SI] }, {})
    rememberPid(opened.summary)
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
    // 常驻 PowerShell 宿主必须显式停掉，否则 node 进程会一直挂着（表现为测试“卡住”）
    try {
      const { stopUiHost } = await import('../core.js')
      stopUiHost()
    } catch { /* 没启动过就算了 */ }
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
