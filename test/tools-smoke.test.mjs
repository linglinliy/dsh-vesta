/**
 * 真实调用冒烟测试：用 5.5 夹具（真实 VASP 输出）真正跑几个工具。
 * 夹具不存在时自动跳过，便于在别的机器上跑其余测试。
 *   node --test test/tools-smoke.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { apply } from '../index.js'

const FIXTURE = '<本地任务根目录>/5.5'
const available = existsSync(`${FIXTURE}/OUTCAR`)
const skip = !available && '缺少 5.5 夹具'

/** 装配插件并用 mock ctx/exec 调工具。 */
const loadTools = () => {
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    effect: (factory) => { factory() },
  }
  apply(ctx, {})
  return tools
}

test('vasp_report：真实任务给出能量、带隙、判语与建议', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('vasp_report').execute({ path: FIXTURE }, {})
  // 约定：ok 表示「所有检查项都通过」，不是「工具调用成功」
  assert.equal(result.ok, false, '5.5 有 ENCUT 告警，ok 应为 false')
  assert.equal(result.mode, 'single')
  assert.match(result.summary, /E = -10\.8391031 eV/)
  assert.match(result.summary, /带隙 0\.657 eV/)
  assert.match(result.summary, /判语：/)
  assert.match(result.summary, /建议：/)
  assert.match(result.summary, /ENCUT 提到至少 319 eV/)
  assert.ok(result.checks.some((check) => !check.ok && check.name === 'ENCUT vs ENMAX'))
})

test('vasp_table：不给 out 也能导出表格（回归：曾因 out 为空而报错）', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('vasp_table').execute({ path: FIXTURE, format: 'md' }, {})
  assert.equal(result.ok, true)
  assert.ok(result.tasks >= 1)
  assert.ok(existsSync(result.path), `产物不存在：${result.path}`)
  assert.match(result.summary, /表格已生成/)
})

test('vasp_dos：生成 DOS 图并回报积分电子数', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('vasp_dos').execute({ path: `${FIXTURE}/DOSCAR` }, {})
  assert.equal(result.ok, true)
  assert.match(result.summary, /DOS/)
  assert.ok(existsSync(result.path), `产物不存在：${result.path}`)
})

test('vesta_analyze：kind=structure 读出空间群与晶胞', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('vesta_analyze').execute({ path: `${FIXTURE}/POSCAR`, kind: 'structure' }, {})
  assert.equal(result.ok, true)
  assert.match(result.summary, /3\.88909|41\.59|Fm/i)
})
