/**
 * X 射线散射因子与结构因子（与 VESTA -calcf 表对照）。
 *   node --test test/xray.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  structureFactor, structureFactorDispersive, xrayFormFactor,
  XRAY_DISPERSION, XRAY_FORM_FACTORS, parsePoscar,
} from '../core.js'

const SI = parsePoscar([
  'Si-fcc', '5.5',
  '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0',
  'Si', '2', 'Direct',
  '0 0 0', '0.25 0.25 0.25',
].join('\n'), 'Si-fcc')

const C2 = parsePoscar([
  'C2', '1.0',
  '2.464 0 0', '-1.232 2.133886594925 0', '0 0 25',
  'C', '2', 'Direct',
  '0.333333 0.666667 0.5', '0.666667 0.333333 0.5',
].join('\n'), 'C2')

/** 表里每个元素的 f0(0) 都应等于原子序数（系数抄错就会露馅）。 */
const ATOMIC_NUMBER = {
  H: 1, B: 5, C: 6, N: 7, O: 8, Na: 11, Mg: 12, Al: 13, Si: 14, P: 15,
  S: 16, Cl: 17, K: 19, Ti: 22, Fe: 26, Cu: 29, Zn: 30, Br: 35, I: 53,
}

test('xrayFormFactor：所有元素的 f0(0) 都等于原子序数', () => {
  for (const [element, coefficients] of Object.entries(XRAY_FORM_FACTORS)) {
    const value = xrayFormFactor(0, coefficients)
    const expected = ATOMIC_NUMBER[element]
    assert.ok(expected !== undefined, `${element} 不在检查表里`)
    assert.ok(Math.abs(value - expected) < 0.02, `${element}: f0(0) = ${value}, 期望 ${expected}`)
  }
  assert.equal(Object.keys(XRAY_FORM_FACTORS).length, Object.keys(ATOMIC_NUMBER).length)
  assert.ok(Object.keys(XRAY_FORM_FACTORS).length >= 19)
})

test('structureFactor：仅 f0 时 Si (111) 与 VESTA 差约 1%（色散所致）', () => {
  const result = structureFactor(SI, { h: 1, k: 1, l: 1 })
  assert.ok(Math.abs(result.d - 3.175426) < 1e-5)
  assert.ok(Math.abs(result.abs - 15.0781) / 15.0781 < 0.02, `|F| = ${result.abs}`)
})

test('structureFactor：金刚石结构的禁戒反射 (0 1 1) 近似为 0', () => {
  assert.ok(structureFactor(SI, { h: 0, k: 1, l: 1 }).abs < 1e-9)
})

test('structureFactorDispersive：Si (111) 的实部虚部与 VESTA 完全一致', () => {
  const result = structureFactorDispersive(SI, { h: 1, k: 1, l: 1 })
  assert.ok(Math.abs(result.real - 10.730726) < 1e-4, `Re = ${result.real}`)
  assert.ok(Math.abs(result.imag - -10.592409) < 1e-4, `Im = ${result.imag}`)
})

test('structureFactorDispersive：C2 (111) 与 VESTA 一致', () => {
  const result = structureFactorDispersive(C2, { h: 1, k: 1, l: 1 })
  assert.ok(Math.abs(result.real - -3.8514) < 1e-3, `Re = ${result.real}`)
  assert.ok(Math.abs(result.imag - -0.0032) < 1e-3, `Im = ${result.imag}`)
})

test('structureFactorDispersive：色散表标明波长', () => {
  assert.ok(Math.abs(XRAY_DISPERSION.wavelengthNm - 0.070932) < 1e-9)
})

test('structureFactor：未知元素返回 null', () => {
  const weird = { ...SI, atoms: [{ symbol: 'Xx', frac: [0, 0, 0] }] }
  assert.equal(structureFactor(weird, { h: 1, k: 1, l: 1 }), null)
  assert.equal(structureFactorDispersive(weird, { h: 1, k: 1, l: 1 }), null)
})
