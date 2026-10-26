/**
 * X 射线粉末衍射（峰位 + 相对强度）测试。
 *   node --test test/powder.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePoscar, powderPattern } from '../core.js'

/** 真实 Si 晶格常数 a = 5.431 Å 的 fcc 原胞。 */
const SI_REAL = parsePoscar([
  'Si-real', '5.431',
  '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0',
  'Si', '2', 'Direct',
  '0 0 0', '0.25 0.25 0.25',
].join('\n'), 'Si-real')

test('powderPattern：每个峰满足 Bragg 关系 sinθ = λ/(2d)', () => {
  const result = powderPattern(SI_REAL, { lambda: 1.5406, twoThetaMax: 90 })
  for (const peak of result.peaks) {
    const expected = 2 * Math.asin(1.5406 / (2 * peak.d)) * (180 / Math.PI)
    assert.ok(Math.abs(peak.twoTheta - expected) < 1e-6, `2θ = ${peak.twoTheta}, 期望 ${expected}`)
  }
})

test('powderPattern：Si(111) 峰位 28.44°、d = 3.1356 Å（文献值）', () => {
  const result = powderPattern(SI_REAL, { lambda: 1.5406, twoThetaMax: 90 })
  const first = result.peaks[0]
  assert.ok(Math.abs(first.twoTheta - 28.442) < 0.05, `2θ = ${first.twoTheta}`)
  assert.ok(Math.abs(first.d - 3.1356) < 1e-3)
  assert.equal(first.intensity, 100)
})

test('powderPattern：金刚石结构的禁戒反射强度可视为 0', () => {
  const result = powderPattern(SI_REAL, { lambda: 1.5406, twoThetaMax: 90 })
  // (200)/(222)/(420) 在金刚石结构中系统消光，对应 d ≈ 2.7155 / 1.5678 / 1.2144
  for (const d of [2.7155, 1.5678, 1.2144]) {
    const peak = result.peaks.find((item) => Math.abs(item.d - d) < 1e-3)
    assert.ok(peak, `没有找到 d = ${d} 的峰`)
    assert.ok(peak.intensity < 1e-20, `I = ${peak.intensity}`)
  }
})

test('powderPattern：Si(220) 与 (111) 的相对强度比接近文献 0.55', () => {
  const result = powderPattern(SI_REAL, { lambda: 1.5406, twoThetaMax: 90 })
  const p111 = result.peaks[0]
  const p220 = result.peaks.find((item) => Math.abs(item.d - 1.9201) < 1e-3)
  assert.ok(p220)
  const ratio = p220.intensity / p111.intensity
  assert.ok(ratio > 0.4 && ratio < 0.7, `I(220)/I(111) = ${ratio}`)
})

test('powderPattern：峰按 2θ 升序排列', () => {
  const result = powderPattern(SI_REAL, { lambda: 1.5406, twoThetaMax: 90 })
  for (let index = 1; index < result.peaks.length; index += 1) {
    assert.ok(result.peaks[index].twoTheta >= result.peaks[index - 1].twoTheta)
  }
})
