/**
 * 倒格子与 k 路径距离测试。
 *   node --test test/kpath.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { reciprocalLattice, bandPathDistances } from '../core.js'

test('reciprocalLattice：立方晶胞（a=1）→ |b| = 2π', () => {
  const [b1, b2, b3] = reciprocalLattice([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
  assert.ok(Math.abs(b1[0] - 2 * Math.PI) < 1e-12)
  assert.ok(Math.abs(b2[1] - 2 * Math.PI) < 1e-12)
  assert.ok(Math.abs(b3[2] - 2 * Math.PI) < 1e-12)
  assert.ok(Math.abs(b1[1]) < 1e-12)
})

test('reciprocalLattice：正交晶胞按长度反比缩放', () => {
  const [b1, , b3] = reciprocalLattice([[2, 0, 0], [0, 2, 0], [0, 0, 10]])
  assert.ok(Math.abs(b1[0] - Math.PI) < 1e-12)
  assert.ok(Math.abs(b3[2] - (2 * Math.PI) / 10) < 1e-12)
})

test('reciprocalLattice：退化晶胞报错', () => {
  assert.throws(() => reciprocalLattice([[1, 0, 0], [2, 0, 0], [0, 0, 1]]), /体积为零/)
})

test('bandPathDistances：Γ→X→M 的距离是 π 与 2π', () => {
  const path = bandPathDistances(
    [{ k: [0, 0, 0] }, { k: [0.5, 0, 0] }, { k: [0.5, 0.5, 0] }],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  )
  assert.equal(path.distances[0], 0)
  assert.ok(Math.abs(path.distances[1] - Math.PI) < 1e-12)
  assert.ok(Math.abs(path.total - 2 * Math.PI) < 1e-12)
})

test('bandPathDistances：正交晶胞 a=2 时 X 点距离是 π/2', () => {
  const path = bandPathDistances(
    [{ k: [0, 0, 0] }, { k: [0.5, 0, 0] }],
    [[2, 0, 0], [0, 2, 0], [0, 0, 10]],
  )
  assert.ok(Math.abs(path.distances[1] - Math.PI / 2) < 1e-12)
})
