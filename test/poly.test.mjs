/**
 * parseVestaPolyList（配位多面体摘要）的单元测试。
 *   node --test test/poly.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVestaPolyList } from '../core.js'

const TEXT = [
  'POLYHEDRON:',
  '   1     Si1 Si  1.00000  1.00000  1.00000  ( 1  1  1) + x, y, z',
  '------------------------------------------------------------',
  '   2     Si2 Si  1.25000  0.25000  1.25000  ( 1  0  1) + x, y, z',
  '   2     Si2 Si  0.25000  1.25000  1.25000  ( 0  1  1) + x, y, z',
  '------------------------------------------------------------',
  'l(Si1-Si2) =  2.38157(0) Å',
  'l(Si1-Si2) =  2.38157(0) Å',
  '---------------------------------------',
  'Average bond length =  2.3816 Å',
  'Polyhedral volume =  6.9323 Å^3',
  'Distortion index (bond length) = 0.00000',
  'Quadratic elongation =  1.0000',
  'Bond angle variance =   0.0000 deg.^2',
  'Effective coordination number =  4.',
].join('\n')

test('parseVestaPolyList：读出中心原子、键与六项畸变指标', () => {
  const result = parseVestaPolyList(TEXT)
  assert.equal(result.count, 1)
  const poly = result.polyhedra[0]
  assert.equal(poly.center.label, 'Si1')
  assert.equal(poly.center.element, 'Si')
  assert.equal(poly.bonds.length, 2)
  assert.ok(Math.abs(poly.averageBond - 2.3816) < 1e-9)
  assert.ok(Math.abs(poly.volume - 6.9323) < 1e-9)
  assert.equal(poly.distortionIndex, 0)
  assert.equal(poly.quadraticElongation, 1)
  assert.equal(poly.bondAngleVariance, 0)
  assert.equal(poly.effectiveCoordination, 4)
})

test('parseVestaPolyList：没有多面体时返回空列表', () => {
  assert.deepEqual(parseVestaPolyList('nothing'), { polyhedra: [], count: 0 })
})
