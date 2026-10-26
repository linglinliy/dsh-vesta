/**
 * densityDerived（∇²ρ / g / ν / h_e）与 formatVolumeText 的单元测试。
 *   node --test test/derived.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOHR_RADIUS_A, densityDerived, formatVolumeText, parseVestaVolumeText } from '../core.js'

const CUBIC = { a1: [1, 0, 0], a2: [0, 1, 0], a3: [0, 0, 1] }
const TO_AU = BOHR_RADIUS_A ** 3

/** ρ = 2 + cos(2πx)：恒正、周期、解析 Laplacian 已知。 */
const cosineVolume = (n = 32) => {
  const values = new Float32Array(n * n * n)
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        values[(k * n + j) * n + i] = 2 + Math.cos((2 * Math.PI * i) / n)
      }
    }
  }
  return { dims: [n, n, n], values, structure: CUBIC }
}

test('densityDerived：cos 波的 Laplacian 与解析值一致（<1% 离散误差）', () => {
  const n = 32
  const derived = densityDerived(cosineVolume(n))
  const scale = Math.pow(2 * Math.PI, 2) * TO_AU
  let maxRelative = 0
  for (let i = 0; i < n; i += 1) {
    const expected = -scale * Math.cos((2 * Math.PI * i) / n)
    const got = derived.laplacian[i]
    if (Math.abs(expected) < 1e-9) continue
    maxRelative = Math.max(maxRelative, Math.abs((got - expected) / expected))
  }
  assert.ok(maxRelative < 0.01, `相对误差 ${maxRelative}`)
})

test('densityDerived：均匀密度 → Laplacian 为 0，动能等于 Thomas-Fermi 项', () => {
  const n = 8
  const values = new Float32Array(n ** 3).fill(1)
  const derived = densityDerived({ dims: [n, n, n], values, structure: CUBIC })
  assert.ok(Math.abs(derived.laplacian[0]) < 1e-9)
  const rho = 1 * TO_AU
  const expected = (3 / 10) * Math.pow(3 * Math.PI * Math.PI, 2 / 3) * Math.pow(rho, 5 / 3)
  // Float32 存储：按相对精度比较
  assert.ok(Math.abs(derived.kinetic[0] - expected) / expected < 1e-6)
})

test('densityDerived：h_e = g + ν 恒等', () => {
  const derived = densityDerived(cosineVolume(8))
  for (let i = 0; i < derived.energy.length; i += 1) {
    const sum = derived.kinetic[i] + derived.potential[i]
    assert.ok(Math.abs(derived.energy[i] - sum) <= Math.abs(sum) * 1e-6 + 1e-12)
  }
})

test('formatVolumeText：N+1 网格、z 最快，能被 parseVestaVolumeText 读回', () => {
  const volume = {
    dims: [2, 2, 2],
    values: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
    structure: { a1: [2, 0, 0], a2: [0, 2, 0], a3: [0, 0, 2] },
  }
  const text = formatVolumeText(volume, { title: 'round trip' })
  const back = parseVestaVolumeText(text)
  assert.deepEqual(back.dims, [3, 3, 3])
  assert.equal(back.cell[0], 2)
  // 我们按 x 最快存储，写出时转成 z 最快：index = i*9 + j*3 + k
  assert.equal(back.values[0], 1)
  assert.equal(back.values[0 * 9 + 0 * 3 + 1], volume.values[(1 * 2 + 0) * 2 + 0])
  assert.equal(back.values[1 * 9 + 0 * 3 + 0], volume.values[(0 * 2 + 0) * 2 + 1])
})
