/**
 * 板层真空层判断测试。
 *   node --test test/slab.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { slabVacuum } from '../core.js'

const structure = (a3, zs) => ({
  a1: [2.468, 0, 0],
  a2: [-1.234, 2.137, 0],
  a3,
  atoms: zs.map((z) => ({ symbol: 'C', frac: [0.25, 0.25, z] })),
})

test('slabVacuum：平板模型（c=25，原子都在 z=0.5）→ 真空 25 Å', () => {
  const geometry = slabVacuum(structure([0, 0, 25], [0.5, 0.5]))
  assert.equal(geometry.slabLike, true)
  assert.equal(geometry.thickness, 0)
  assert.equal(geometry.vacuum, 25)
})

test('slabVacuum：体相结构（c≈a）不判为板层', () => {
  const geometry = slabVacuum(structure([0, 0, 3.89], [0, 0.25]))
  assert.equal(geometry.slabLike, false)
})

test('slabVacuum：层厚计入真空', () => {
  // z 分布 0.4→0.5，c=20 → 层厚 2 Å，真空 18 Å
  const geometry = slabVacuum(structure([0, 0, 20], [0.4, 0.5]))
  assert.ok(Math.abs(geometry.thickness - 2) < 1e-9)
  assert.ok(Math.abs(geometry.vacuum - 18) < 1e-9)
  assert.equal(geometry.slabLike, true)
})
