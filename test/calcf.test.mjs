/**
 * VESTA 结构因子表解析测试。
 *   node --test test/calcf.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVestaStructureFactors } from '../core.js'

const TABLE = [
  '   h    k    l      d (Å)      F(real)      F(imag)          |F|         2θ          I    M',
  '  -1   -1   -1   3.175426    10.592409    10.730726      15.0781   12.82531  100.00000    1',
  '   0   -1    0   3.175426    10.730726   -10.592409      15.0781   12.82531  100.00000    1',
  '   0    1    1   2.750000     0.000000    -0.000000  1.23512e-15   14.81978    0.00000    1',
].join('\n')

test('parseVestaStructureFactors：读出 hkl、d、实虚部与强度', () => {
  const parsed = parseVestaStructureFactors(TABLE)
  assert.equal(parsed.count, 3)
  const first = parsed.reflections[0]
  assert.equal(first.h, -1)
  assert.equal(first.l, -1)
  assert.ok(Math.abs(first.d - 3.175426) < 1e-9)
  assert.ok(Math.abs(first.real - 10.592409) < 1e-9)
  assert.ok(Math.abs(first.abs - 15.0781) < 1e-9)
  assert.ok(Math.abs(first.twoTheta - 12.82531) < 1e-9)
  assert.equal(first.intensity, 100)
  assert.equal(first.multiplicity, 1)
})

test('parseVestaStructureFactors：禁戒反射的 |F| 保留为极小值', () => {
  const forbidden = parseVestaStructureFactors(TABLE).reflections[2]
  assert.ok(forbidden.abs < 1e-12)
  assert.equal(forbidden.intensity, 0)
})

test('parseVestaStructureFactors：跳过表头与非数据行', () => {
  const withNoise = `标题行\n${TABLE}\n\n结尾说明 2024 年\n`
  assert.equal(parseVestaStructureFactors(withNoise).count, 3)
  assert.equal(parseVestaStructureFactors('').count, 0)
})
