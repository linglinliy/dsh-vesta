/**
 * 离散 Voronoi 电荷归属（voronoiCharges）。
 *   node --test test/bader.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { voronoiCharges, parsePoscar } from '../core.js'

/** 8×8×8 均匀密度 + 两个原子，检查「总电荷守恒」与「等距均分」。 */
const makeVolume = (atoms, { density = 0.1, size = 8 } = {}) => {
  const values = new Float32Array(size ** 3).fill(density)
  return {
    dims: [size, size, size],
    values,
    structure: { a1: [2, 0, 0], a2: [0, 2, 0], a3: [0, 0, 2], atoms },
  }
}

test('voronoiCharges：总电荷等于 密度 × 体积（守恒）', () => {
  const volume = makeVolume([
    { symbol: 'Si', frac: [0.125, 0.125, 0.125] },
    { symbol: 'Si', frac: [0.625, 0.625, 0.625] },
  ], { density: 0.1 })
  const result = voronoiCharges(volume)
  const cellVolume = 2 * 2 * 2
  // 密度存在 Float32 里，累加后按相对误差比较
  assert.ok(Math.abs(result.total - 0.1 * cellVolume) / (0.1 * cellVolume) < 1e-6, `total = ${result.total}`)
  assert.ok(Math.abs(result.total - 0.8) / 0.8 < 1e-6, `total = ${result.total}`)
})

test('voronoiCharges：两个对称原子分到相同电荷与体积', () => {
  const volume = makeVolume([
    { symbol: 'Si', frac: [0.25, 0.5, 0.5] },
    { symbol: 'Si', frac: [0.75, 0.5, 0.5] },
  ])
  const result = voronoiCharges(volume)
  assert.ok(Math.abs(result.atoms[0].charge - result.atoms[1].charge) < 1e-9)
  assert.ok(Math.abs(result.atoms[0].volume - result.atoms[1].volume) < 1e-9)
  assert.equal(result.byElement.Si.count, 2)
})

test('voronoiCharges：密度集中在某个原子附近时，该原子拿到大部分电荷', () => {
  const size = 8
  const values = new Float32Array(size ** 3)
  // 在 frac ≈ (0.125, 0.125, 0.125) 附近放高斯「密度」
  for (let k = 0; k < size; k += 1) {
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const dx = i / size - 0.125
        const dy = j / size - 0.125
        const dz = k / size - 0.125
        values[(k * size + j) * size + i] = Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * 0.05 ** 2))
      }
    }
  }
  const result = voronoiCharges({
    dims: [size, size, size],
    values,
    structure: {
      a1: [2, 0, 0], a2: [0, 2, 0], a3: [0, 0, 2],
      atoms: [
        { symbol: 'Na', frac: [0.125, 0.125, 0.125] },
        { symbol: 'C', frac: [0.625, 0.625, 0.625] },
      ],
    },
  })
  assert.ok(result.atoms[0].charge > result.atoms[1].charge * 10, `Na=${result.atoms[0].charge} C=${result.atoms[1].charge}`)
})

test('voronoiCharges：没有原子时明确报错', () => {
  assert.throws(() => voronoiCharges({ dims: [2, 2, 2], values: new Float32Array(8), structure: null }), /需要带原子的结构/)
})

test('voronoiCharges：按元素汇总的每原子电荷正确', () => {
  const structure = parsePoscar([
    'x', '1.0', '2 0 0', '0 2 0', '0 0 2', 'Si', '1', 'Direct', '0.25 0.5 0.5',
  ].join('\n'), 'x')
  const volume = { dims: [4, 4, 4], values: new Float32Array(64).fill(0.5), structure }
  const result = voronoiCharges(volume)
  assert.ok(Math.abs(result.byElement.Si.perAtom - 4) < 1e-9, `perAtom = ${result.byElement.Si.perAtom}`)
})
