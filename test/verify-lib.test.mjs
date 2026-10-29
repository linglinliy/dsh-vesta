/**
 * 验证清单解析的回归测试（不依赖 GUI / VESTA）。
 *   node --test test/verify-lib.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectTrials, isCandidate, parseTrials, stripBom } from '../scripts/verify-lib.mjs'

const e1 = { phase: 'E1', geometry: { window: '10,10,1200,760', dpi: 120 } }
const trial = {
  phase: 'E2',
  trial: 1,
  candidateIndex: 0,
  variant: 'click-40ms',
  stats: { diffLocal: 0, yellowBefore: 0, yellowAfter: 0 },
}

test('stripBom 只去掉开头的 BOM', () => {
  assert.equal(stripBom('\uFEFFabc'), 'abc')
  assert.equal(stripBom('a\uFEFFb'), 'a\uFEFFb')
  assert.equal(stripBom(''), '')
})

test('带 BOM 的 JSONL 能被完整解析（E1 不丢）', () => {
  const text = `\uFEFF${JSON.stringify(e1)}\r\n${JSON.stringify(trial)}\r\n`
  const parsed = parseTrials(text)
  assert.equal(parsed.invalid.length, 0)
  assert.equal(parsed.rows.length, 2)
  const inspected = inspectTrials(parsed)
  assert.deepEqual(inspected.geometry, e1.geometry)
  assert.equal(inspected.infraOk, true)
})

test('无 BOM、LF、含空行也能解析', () => {
  const text = `${JSON.stringify(e1)}\n\n${JSON.stringify(trial)}\n`
  const parsed = parseTrials(text)
  assert.equal(parsed.invalid.length, 0)
  assert.equal(parsed.rows.length, 2)
})

test('非法行被记录而不是静默丢弃，并使基础设施判定失败', () => {
  const text = `${JSON.stringify(e1)}\n{"phase":\n`
  const parsed = parseTrials(text)
  assert.equal(parsed.invalid.length, 1)
  assert.equal(parsed.invalid[0].reason, 'invalid-json')
  assert.equal(inspectTrials(parsed).infraOk, false)
})

test('缺少 phase 的记录被判为缺失字段', () => {
  const parsed = parseTrials(`${JSON.stringify({ geometry: 1 })}\n`)
  assert.equal(parsed.invalid[0].reason, 'missing-phase')
})

test('缺少 E1 时基础设施判定失败并给出原因', () => {
  const parsed = parseTrials(`${JSON.stringify(trial)}\n`)
  const inspected = inspectTrials(parsed)
  assert.equal(inspected.infraOk, false)
  assert.equal(inspected.infraReason, 'missing-E1')
})

test('候选判定只看局部差异/黄色增量，不驱动任何动作', () => {
  assert.equal(isCandidate(trial), false)
  assert.equal(isCandidate({ ...trial, stats: { diffLocal: 0.2, yellowBefore: 0, yellowAfter: 0 } }), true)
  assert.equal(isCandidate({ ...trial, stats: { diffLocal: 0, yellowBefore: 0, yellowAfter: 100 } }), true)
})
