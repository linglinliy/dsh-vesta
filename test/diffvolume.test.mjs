/**
 * 体积相减（电荷密度差）测试。
 *   node --test test/diffvolume.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { differenceVolume } from '../core.js'

const grid = (values, dims = [2, 2, 2]) => ({
  dims,
  origin: [0, 0, 0],
  steps: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  values: Float32Array.from(values),
})

test('differenceVolume：逐点相减并可正可负', () => {
  const base = grid([1, 2, 3, 4, 5, 6, 7, 8])
  const ref = grid([1, 1, 1, 1, 1, 1, 1, 1])
  const diff = differenceVolume(base, ref)
  assert.deepEqual(Array.from(diff.values), [0, 1, 2, 3, 4, 5, 6, 7])
  const reversed = differenceVolume(ref, base)
  assert.deepEqual(Array.from(reversed.values), [0, -1, -2, -3, -4, -5, -6, -7])
})

test('differenceVolume：保留网格几何信息', () => {
  const diff = differenceVolume(grid([1, 1, 1, 1, 1, 1, 1, 1]), grid([0, 0, 0, 0, 0, 0, 0, 0]))
  assert.deepEqual(diff.dims, [2, 2, 2])
  assert.deepEqual(diff.steps[2], [0, 0, 1])
})

test('differenceVolume：维度不一致时报错', () => {
  const a = grid([1, 1, 1, 1, 1, 1, 1, 1], [2, 2, 2])
  const b = grid([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [3, 2, 2])
  assert.throws(() => differenceVolume(a, b), /维度不一致/)
})

test('differenceVolume：不修改输入数组', () => {
  const base = grid([2, 2, 2, 2, 2, 2, 2, 2])
  const ref = grid([1, 1, 1, 1, 1, 1, 1, 1])
  differenceVolume(base, ref)
  assert.deepEqual(Array.from(base.values), [2, 2, 2, 2, 2, 2, 2, 2])
  assert.deepEqual(Array.from(ref.values), [1, 1, 1, 1, 1, 1, 1, 1])
})
