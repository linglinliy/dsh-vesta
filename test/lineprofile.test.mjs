/**
 * lineProfile 与 VESTA 文本格式的单元测试。
 *   node --test test/lineprofile.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatLineProfileText, lineProfile } from '../core.js'

/** 值 = x 索引（0 或 1）的 2×2×2 网格，胞长 2 Å。 */
const VOLUME = {
  dims: [2, 2, 2],
  values: new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]),
  structure: { a1: [2, 0, 0], a2: [0, 2, 0], a3: [0, 0, 2] },
}

test('lineProfile：沿 x 线性插值，距离与取值都线性', () => {
  const profile = lineProfile(VOLUME, [0, 0, 0], [0.5, 0, 0], { points: 3 })
  assert.equal(profile.points, 3)
  assert.ok(Math.abs(profile.total - 1) < 1e-9)
  assert.deepEqual(profile.distances.map((value) => +value.toFixed(6)), [0, 0.5, 1])
  assert.deepEqual(profile.values.map((value) => +value.toFixed(6)), [0, 0.5, 1])
})

test('lineProfile：Si–Si 对角线长度等于键长 2.38157 Å', () => {
  const volume = {
    dims: [4, 4, 4],
    values: new Float32Array(64),
    structure: { a1: [0, 2.75, 2.75], a2: [2.75, 0, 2.75], a3: [2.75, 2.75, 0] },
  }
  const profile = lineProfile(volume, [0, 0, 0], [0.25, 0.25, 0.25], { points: 5 })
  assert.ok(Math.abs(profile.total - 2.38157) < 1e-4)
  assert.equal(profile.values.length, 5)
})

test('formatLineProfileText：格式与 VESTA 手册 14.13 一致', () => {
  const profile = lineProfile(VOLUME, [0, 0, 0], [0.5, 0, 0], { points: 2 })
  const text = formatLineProfileText({
    title: 'test profile',
    start: [0, 0, 0],
    end: [0.5, 0, 0],
    distances: profile.distances,
    values: profile.values,
  })
  const lines = text.trim().split('\n')
  assert.equal(lines[0], 'test profile')
  assert.match(lines[1], /^Point 1:\s+0\.00000\s+0\.00000\s+0\.00000$/)
  assert.match(lines[2], /^Point 2:\s+0\.50000\s+0\.00000\s+0\.00000$/)
  assert.equal(lines[3], '2')
  assert.equal(lines.length, 4 + 2)
  assert.match(lines[4], /^\s+\d\.\d{6}E[+-]\d{3}\s+\d\.\d{6}E[+-]\d{3}$/)
})

test('lineProfile：点数少于 2 时回退到默认 50', () => {
  assert.equal(lineProfile(VOLUME, [0, 0, 0], [0.5, 0.5, 0.5], { points: 1 }).points, 50)
})
