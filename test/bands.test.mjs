/**
 * EIGENVAL 解析与带隙测试。
 *   node --test test/bands.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEigenval, bandGap } from '../core.js'

/** ISPIN=1：每条带 3 列（带号、能量、占据数）。2 个 k 点、3 条带。 */
const SINGLE = [
  '1 1 1 1',
  '0.1 0.2 0.3 0.4 0.5',
  '1.0',
  'CAR ',
  'test',
  '4 2 3',
  '',
  '0.0 0.0 0.0 0.5',
  '1 -5.0 1.0',
  '2 0.0 0.0',
  '3 1.0 0.0',
  '',
  '0.5 0.0 0.0 0.5',
  '1 -4.0 1.0',
  '2 0.5 0.0',
  '3 2.0 0.0',
].join('\n')

/** ISPIN=2：每条带 5 列（带号、E_up、E_down、occ_up、occ_down）。 */
const SPIN = [
  '1 1 1 2',
  '0.1 0.2 0.3 0.4 0.5',
  '1.0',
  'CAR ',
  'test',
  '4 1 2',
  '',
  '0.0 0.0 0.0 1.0',
  '1 -5.0 -4.9 1.0 1.0',
  '2  0.0  0.6 0.0 0.0',
].join('\n')

test('parseEigenval：ISPIN=1 的 3 列格式', () => {
  const eigen = parseEigenval(SINGLE)
  assert.equal(eigen.nkpts, 2)
  assert.equal(eigen.nbands, 3)
  assert.equal(eigen.nelect, 4)
  assert.equal(eigen.spinPolarized, false)
  assert.deepEqual(eigen.kpoints[1].k, [0.5, 0, 0])
  assert.deepEqual(eigen.energies[0], [-5, 0, 1])
  assert.deepEqual(eigen.occupations[0], [1, 0, 0])
})

test('parseEigenval：ISPIN=2 的 5 列格式（自旋向下单独存）', () => {
  const eigen = parseEigenval(SPIN)
  assert.equal(eigen.spinPolarized, true)
  assert.deepEqual(eigen.energies[0], [-5, 0])
  assert.deepEqual(eigen.energiesDown[0], [-4.9, 0.6])
  assert.deepEqual(eigen.occupations[0], [1, 0])
  assert.deepEqual(eigen.occupationsDown[0], [1, 0])
})

test('bandGap：取占据带最高与空带最低', () => {
  const gap = bandGap(parseEigenval(SINGLE))
  // 占据带最高是 k1 的 -4；空带最低是 k0 的 0 → 带隙 4 eV，间接（不同 k）
  assert.equal(gap.vbm, -4)
  assert.equal(gap.cbm, 0)
  assert.equal(gap.gap, 4)
  assert.equal(gap.direct, false)
})

test('bandGap：自旋极化时两个通道一起看', () => {
  const gap = bandGap(parseEigenval(SPIN))
  // 两个通道一起看：占据带最高 = max(-5, -4.9) = -4.9；空带最低 = min(0, 0.6) = 0
  assert.equal(gap.vbm, -4.9)
  assert.equal(gap.cbm, 0)
  assert.ok(Math.abs(gap.gap - 4.9) < 1e-9)
})
