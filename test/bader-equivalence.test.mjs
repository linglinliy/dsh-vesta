/**
 * voronoiCharges 的等价性回归：优化后的实现必须与朴素实现逐原子一致。
 *   node --test test/bader-equivalence.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { voronoiCharges } from '../core.js'

/**
 * 朴素参考实现：每个体素对每个原子用「绕回后的分数差 → 笛卡尔距离」，
 * 再按并列数均分。刻意写得直白，用来校验优化版的正确性。
 */
const naive = (volume) => {
  const { dims, values, structure } = volume
  const [nx, ny, nz] = dims
  const cell = [structure.a1, structure.a2, structure.a3]
  const det = cell[0][0] * (cell[1][1] * cell[2][2] - cell[1][2] * cell[2][1])
    - cell[0][1] * (cell[1][0] * cell[2][2] - cell[1][2] * cell[2][0])
    + cell[0][2] * (cell[1][0] * cell[2][1] - cell[1][1] * cell[2][0])
  const voxelVolume = Math.abs(det) / (nx * ny * nz)
  const atoms = structure.atoms
  const charges = atoms.map(() => 0)
  const volumes = atoms.map(() => 0)

  const distanceOf = (frac, atomFrac) => {
    const diff = [0, 1, 2].map((axis) => {
      let delta = frac[axis] - atomFrac[axis]
      delta -= Math.round(delta)
      return delta
    })
    const cart = [0, 1, 2].map((axis) =>
      diff[0] * cell[0][axis] + diff[1] * cell[1][axis] + diff[2] * cell[2][axis])
    return Math.hypot(cart[0], cart[1], cart[2])
  }

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const density = values[(k * ny + j) * nx + i]
        const frac = [i / nx, j / ny, k / nz]
        const distances = atoms.map((atom) => distanceOf(frac, atom.frac))
        const minimum = Math.min(...distances)
        const tied = distances.filter((value) => value <= minimum + 1e-9).length
        distances.forEach((distance, index) => {
          if (distance <= minimum + 1e-9) {
            charges[index] += (density * voxelVolume) / tied
            volumes[index] += voxelVolume / tied
          }
        })
      }
    }
  }
  return { charges, volumes }
}

const makeCase = () => {
  const n = 10
  const values = new Float32Array(n ** 3)
  for (let index = 0; index < values.length; index += 1) {
    values[index] = 0.1 + ((index * 37) % 23) / 100
  }
  return {
    dims: [n, n, n],
    values,
    structure: {
      a1: [5, 0, 0], a2: [0, 5, 0], a3: [0, 0, 5],
      atoms: [
        { symbol: 'C', frac: [0.1, 0.1, 0.1] },
        { symbol: 'C', frac: [0.6, 0.1, 0.1] },
        { symbol: 'Na', frac: [0.35, 0.35, 0.4] },
        { symbol: 'C', frac: [0.9, 0.5, 0.5] },
      ],
    },
  }
}

test('voronoiCharges：与朴素全扫描逐原子一致（含并列均分）', () => {
  const volume = makeCase()
  const fast = voronoiCharges(volume)
  const reference = naive(volume)
  fast.atoms.forEach((atom, index) => {
    assert.ok(Math.abs(atom.charge - reference.charges[index]) < 1e-9,
      `原子 ${index + 1}（${atom.symbol}）：${atom.charge} vs ${reference.charges[index]}`)
    assert.ok(Math.abs(atom.volume - reference.volumes[index]) < 1e-9)
  })
})

test('voronoiCharges：总电荷守恒', () => {
  const volume = makeCase()
  const result = voronoiCharges(volume)
  const cellVolume = 125
  const sum = volume.values.reduce((total, value) => total + value, 0)
  const expected = sum * (cellVolume / volume.values.length)
  assert.ok(Math.abs(result.total - expected) / expected < 1e-6, `total = ${result.total}, 期望 ${expected}`)
})
