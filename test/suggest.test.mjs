/**
 * suggestActions（把体检发现翻译成可执行建议）测试。
 *   node --test test/suggest.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestActions } from '../core.js'

const report = (checks, extra = {}) => ({ checks, ...extra })
const fail = (name) => ({ name, ok: false, detail: '' })
const ok = (name) => ({ name, ok: true, detail: '' })

test('suggestActions：ENCUT 偏低 → 给出具体建议值', () => {
  const actions = suggestActions(report([fail('ENCUT vs ENMAX')], { potcar: { enmax: 245.345 } }))
  assert.equal(actions.length, 1)
  assert.match(actions[0], /319 eV/)
})

test('suggestActions：真空不足 → 建议加长 c 轴', () => {
  const actions = suggestActions(report([fail('真空层')]))
  assert.ok(actions.some((action) => action.includes('c 轴')))
})

test('suggestActions：ZVAL 不符 → 建议检查 POTCAR 顺序', () => {
  const actions = suggestActions(report([fail('POTCAR ZVAL ↔ NELECT')]))
  assert.ok(actions.some((action) => action.includes('POTCAR')))
})

test('suggestActions：NBANDS 不足 → 给出建议下限', () => {
  const actions = suggestActions(report([fail('NBANDS 下限')], { outcar: { nelect: 8 }, eigenval: { natoms: 2 } }))
  assert.ok(actions.some((action) => action.includes('至少 6')))
})

test('suggestActions：未收尾或未收敛 → 建议检查作业', () => {
  const actions = suggestActions(report([fail('计算收尾'), fail('SCF 收敛')]))
  assert.ok(actions.some((action) => action.includes('未正常结束')))
})

test('suggestActions：全部通过 → 没有建议', () => {
  assert.deepEqual(suggestActions(report([ok('SCF 收敛'), ok('k 网格')])), [])
})

test('suggestActions：k 点密度偏低且为半导体 → 建议加密', () => {
  const actions = suggestActions(report([ok('SCF 收敛')], {
    eigenval: { gap: 0.7, natoms: 4 },
    kpoints: { total: 8 },
  }))
  assert.ok(actions.some((action) => action.includes('k 点密度偏低')))
})
