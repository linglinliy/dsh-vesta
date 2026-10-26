/**
 * 平面平均电势与功函数（planarAverage / workFunction）。
 *   node --test test/workfunction.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { planarAverage, workFunction } from '../core.js'

/**
 * 造 LOCPOT：z 方向 40 格、4×4 平面；15–24 格是「板层」（电势有起伏），其余是 5.0 eV 真空平台。
 */
const makeLocpot = ({ slabValue = 5.0, slabAmplitude = 2.0, plateau = 5.0 } = {}) => {
  const nx = 4, ny = 4, nz = 40
  const values = new Float32Array(nx * ny * nz)
  for (let k = 0; k < nz; k += 1) {
    const inSlab = k >= 15 && k <= 24
    const potential = inSlab
      ? slabValue + slabAmplitude * Math.cos((2 * Math.PI * (k - 15)) / 10)
      : plateau
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) values[(k * ny + j) * nx + i] = potential
    }
  }
  return {
    dims: [nx, ny, nz],
    values,
    structure: { a1: [4, 0, 0], a2: [0, 4, 0], a3: [0, 0, 40] },
  }
}

test('planarAverage：沿 c 轴逐格平均，位置按轴长均分', () => {
  const volume = makeLocpot()
  const average = planarAverage(volume)
  assert.equal(average.values.length, 40)
  assert.equal(average.length, 40)
  assert.ok(Math.abs(average.positions[1] - 1) < 1e-9)
  assert.ok(Math.abs(average.values[0] - 5) < 1e-5, `真空区均值 ${average.values[0]}`)
  assert.ok(Math.abs(average.values[20] - 3) < 1e-5, `板层谷值 ${average.values[20]}`)
  assert.ok(Math.abs(average.values[15] - 7) < 1e-5, `板层峰值 ${average.values[15]}`)
})

test('workFunction：真空平台 5 eV、费米 2 eV → 功函数 3 eV', () => {
  const result = workFunction(makeLocpot(), { efermi: 2 })
  assert.ok(Math.abs(result.vacuumLevel - 5) < 1e-6)
  assert.ok(Math.abs(result.workFunction - 3) < 1e-6)
  assert.ok(Math.abs(result.plateau.length - 28) < 1e-6, `平台长度 ${result.plateau.length}`)
})

test('workFunction：平台高度变化会等比反映到功函数', () => {
  const result = workFunction(makeLocpot({ plateau: 4.2 }), { efermi: 2 })
  assert.ok(Math.abs(result.workFunction - 2.2) < 1e-6)
})

test('workFunction：没有平坦段时退回「电势最大值」', () => {
  // 每格都抬高 1 eV，斜率处处大于 tolerance
  const volume = makeLocpot()
  for (let index = 0; index < volume.values.length; index += 1) {
    volume.values[index] += Math.floor(index / 16) * 0.5
  }
  const result = workFunction(volume, { efermi: 0, tolerance: 1e-9 })
  assert.equal(result.plateau.length, 1)
  assert.ok(Math.abs(result.workFunction - result.vacuumLevel) < 1e-9)
})

test('workFunction：efermi 非法时报错', () => {
  assert.throws(() => workFunction(makeLocpot(), { efermi: Number.NaN }), /efermi/)
})
