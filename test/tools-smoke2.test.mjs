/**
 * 真实调用冒烟测试（第二批）：可视化类工具与体积分析类工具。
 * 夹具：5.5（真实 Si）与 C2（真实单层），以及父目录下的多任务批量。
 *   node --test test/tools-smoke2.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const ROOT = '<本地任务根目录>'
const SI = `${ROOT}/5.5`
const C2 = `${ROOT}/latticefine_C2_a2p464_k25`
const hasSi = existsSync(`${SI}/OUTCAR`)
const skip = !hasSi && '缺少 5.5 夹具'

const loadTools = () => {
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    effect: (factory) => { factory() },
  }
  apply(ctx, {})
  return tools
}

test('vasp_bands：从 EIGENVAL 出能带图并给带隙', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('vasp_bands').execute({ path: SI }, {})
  assert.equal(result.ok, true)
  assert.match(result.summary, /能带/)
  assert.ok(existsSync(result.path), `产物不存在：${result.path}`)
})

test('vasp_compare：两个真实任务的收敛曲线对比', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('vasp_compare').execute({ path: ROOT, kind: 'conv' }, {})
  assert.equal(result.ok, true)
  assert.ok(existsSync(result.path), `产物不存在：${result.path}`)
})

test('vasp_batch：父目录下批量出图并写索引页', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('vasp_batch').execute({ path: ROOT, maxDepth: 2 }, {})
  assert.equal(result.ok, true)
  assert.ok(result.tasks.length >= 2)
  assert.ok(existsSync(result.index), `索引页不存在：${result.index}`)
})

test('volume_analyze：slice / profile / peaks / derived 四种都可用', { skip }, async () => {
  const tools = loadTools()
  const tool = tools.get('volume_analyze')
  const slice = await tool.execute({ path: SI, kind: 'slice', at: 0.3 }, {})
  assert.equal(slice.ok, true)
  assert.ok(existsSync(slice.path))
  const profile = await tool.execute({ path: SI, kind: 'profile', from: '0,0,0', to: '0.25,0.25,0.25' }, {})
  assert.equal(profile.ok, true)
  assert.match(profile.summary, /2\.3815/)
  const peaks = await tool.execute({ path: SI, kind: 'peaks', maxPeaks: 3 }, {})
  assert.equal(peaks.ok, true)
  assert.match(peaks.summary, /峰搜索/)
  const derived = await tool.execute({ path: SI, kind: 'derived' }, {})
  assert.equal(derived.ok, true)
  assert.match(derived.summary, /∇²ρ/)
  const out = join(mkdtempSync(join(tmpdir(), 'vesta-chg-')), 'charges.csv')
  const charges = await tool.execute({ path: SI, kind: 'charges', out }, {})
  assert.equal(charges.ok, true)
  assert.equal(charges.path, out, '应回报 CSV 路径')
  assert.ok(existsSync(out), `CSV 不存在：${out}`)
  // 总电荷应等于 NELECT = 8
  assert.match(charges.summary, /总电荷 8 e/)
})

test('xray_powder：真实 Si 结构出粉末图谱', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('xray_powder').execute({ path: `${SI}/POSCAR` }, {})
  assert.equal(result.ok, true)
  assert.ok(result.peaks >= 5)
  assert.ok(existsSync(result.path))
})

test('vesta_view：生成浏览器可看的结构文件', { skip }, async () => {
  const tools = loadTools()
  const result = await tools.get('vesta_view').execute({ paths: [`${SI}/POSCAR`] }, {})
  assert.equal(result.ok, true)
  const record = result.structures[0]
  assert.ok(record.pdb, '应给出 pdb 路径')
  assert.ok(existsSync(record.pdb), `产物不存在：${record.pdb}`)
  assert.ok(existsSync(record.cif), `产物不存在：${record.cif}`)
  assert.match(record.formula, /Si/)
})

test('vasp_pdos：没有 LORBIT 数据时给出明确报错而不是崩掉', { skip }, async () => {
  const tools = loadTools()
  await assert.rejects(
    () => tools.get('vasp_pdos').execute({ path: SI }, {}),
    (error) => /LORBIT|PDOS|部分态密度/.test(error.message),
  )
})
