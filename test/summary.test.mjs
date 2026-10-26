/**
 * summarizeTask（综合判语）测试。
 *   node --test test/summary.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeTask } from '../core.js'

const makeReport = (gap, checks = [], extra = {}) => ({
  eigenval: gap === null ? null : { gap, direct: false },
  doscar: null,
  outcar: { ispin: 1 },
  checks,
  ...extra,
})

const ok = (name) => ({ name, ok: true, detail: '' })
const fail = (name) => ({ name, ok: false, detail: '' })

test('summarizeTask：带隙接近 0 → 金属性', () => {
  const summary = summarizeTask(makeReport(0.01, [ok('SCF 收敛')]))
  assert.match(summary.electronic, /金属性/)
})

test('summarizeTask：中等带隙 → 半导体；大带隙 → 绝缘体量级', () => {
  assert.match(summarizeTask(makeReport(0.7)).electronic, /半导体/)
  assert.match(summarizeTask(makeReport(3.2)).electronic, /绝缘体量级/)
})

test('summarizeTask：缺 EIGENVAL 时电子结构未知', () => {
  assert.match(summarizeTask(makeReport(null)).electronic, /未知/)
})

test('summarizeTask：有真空层检查项 → 判为板层', () => {
  assert.match(summarizeTask(makeReport(0.7, [ok('真空层')])).geometry, /板层/)
  assert.match(summarizeTask(makeReport(0.7, [])).geometry, /体相/)
})

test('summarizeTask：ISPIN=2 或 DOS 自旋极化 → 自旋极化', () => {
  assert.match(summarizeTask(makeReport(0.7, [], { outcar: { ispin: 2 } })).spin, /自旋极化/)
  assert.match(
    summarizeTask(makeReport(0.7, [], { doscar: { spinPolarized: true } })).spin,
    /自旋极化/,
  )
})

test('summarizeTask：全体通过 → 可直接使用', () => {
  const summary = summarizeTask(makeReport(0.7, [ok('SCF 收敛'), ok('k 网格')]))
  assert.match(summary.verdict, /可直接使用/)
  assert.deepEqual(summary.failed, [])
})

test('summarizeTask：只有非关键提示 → 自洽但可复核', () => {
  const summary = summarizeTask(makeReport(0.7, [ok('SCF 收敛'), fail('ENCUT vs ENMAX')]))
  assert.match(summary.verdict, /可复核/)
  assert.deepEqual(summary.critical, [])
})

test('summarizeTask：关键项失败 → 建议先排查', () => {
  const summary = summarizeTask(makeReport(0.7, [fail('OUTCAR↔OSZICAR 能量'), fail('k 网格')]))
  assert.match(summary.verdict, /关键不一致/)
  assert.deepEqual(summary.critical, ['OUTCAR↔OSZICAR 能量'])
})
