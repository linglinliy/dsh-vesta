/**
 * dosGap（由 DOSCAR 判带隙）测试。
 *   node --test test/dosgap.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dosGap } from '../core.js'

const makeDos = (energies, up, down = null, efermi = 0) => ({
  energies,
  up,
  down: down ?? up.map(() => 0),
  efermi,
})

test('dosGap：中间 DOS 为零 → VBM 是 Ef 以下最后一个有态的点，CBM 是 Ef 以上第一个有态的点', () => {
  // 能量格点 −2,−1,0,1,2；DOS 在 0 与 1 处为零
  const dos = makeDos([-2, -1, 0, 1, 2], [1, 1, 0, 0, 1])
  const gap = dosGap(dos)
  assert.equal(gap.vbm, -1)
  assert.equal(gap.cbm, 2)
  assert.equal(gap.gap, 3)
})

test('dosGap：DOS 处处非零时，带隙按定义仍为相邻格点差', () => {
  const dos = makeDos([-1, 0, 1], [1, 1, 1])
  const gap = dosGap(dos)
  assert.equal(gap.vbm, 0)
  assert.equal(gap.cbm, 1)
  assert.equal(gap.gap, 1)
})

test('dosGap：默认阈值（峰值的 0.5%）会忽略极小的 DOS', () => {
  const dos = makeDos([-2, -1, 0, 1, 2], [1, 1e-9, 0, 1e-9, 1])
  const withDefault = dosGap(dos)
  assert.equal(withDefault.vbm, -2)
  assert.equal(withDefault.cbm, 2)
  assert.equal(withDefault.gap, 4)
  // 阈值降到 0 时，1e-9 也算有态
  const lower = dosGap(dos, { threshold: 0 })
  assert.equal(lower.vbm, -1)
  assert.equal(lower.cbm, 1)
  assert.equal(lower.gap, 2)
})

test('dosGap：自旋极化时上下自旋相加', () => {
  const dos = makeDos([-1, 0, 1], [1, 0, 0], [0, 0, 1])
  const gap = dosGap(dos)
  assert.equal(gap.vbm, -1)
  assert.equal(gap.cbm, 1)
  assert.equal(gap.gap, 2)
})
