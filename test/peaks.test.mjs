/**
 * peakSearch（峰搜索 + Voronoi 式归属）与文本格式的单元测试。
 *   node --test test/peaks.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatPeakSearchText, peakSearch } from '../core.js'

/** 造一个 8³ 网格：在给定分数坐标处放高斯峰。 */
const gaussianVolume = (centers, size = 8) => {
  const values = new Float32Array(size ** 3)
  const index = (i, j, k) => (k * size + j) * size + i
  for (let k = 0; k < size; k += 1) {
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const frac = [i / size, j / size, k / size]
        let value = 0
        for (const center of centers) {
          let sum = 0
          for (let axis = 0; axis < 3; axis += 1) {
            let delta = frac[axis] - center[axis]
            delta -= Math.round(delta)
            sum += delta * delta
          }
          value += Math.exp(-sum / (2 * 0.08 * 0.08))
        }
        values[index(i, j, k)] = value
      }
    }
  }
  return {
    dims: [size, size, size],
    values,
    structure: { a1: [2, 0, 0], a2: [0, 2, 0], a3: [0, 0, 2] },
  }
}

test('peakSearch：单个高斯峰 → 一个峰，积分等于整胞积分', () => {
  const result = peakSearch(gaussianVolume([[0.5, 0.5, 0.5]]))
  assert.equal(result.peaks.length, 1)
  assert.ok(Math.abs(result.peaks[0].electrons - result.total) < 1e-9)
  assert.deepEqual(result.peaks[0].frac.map((value) => +value.toFixed(3)), [0.5, 0.5, 0.5])
})

test('peakSearch：两个分开的峰 → 两个峰，各自约一半，总和守恒', () => {
  const result = peakSearch(gaussianVolume([[0.25, 0.5, 0.5], [0.75, 0.5, 0.5]]))
  assert.equal(result.peaks.length, 2)
  const sum = result.peaks.reduce((total, peak) => total + peak.electrons, 0)
  assert.ok(Math.abs(sum - result.total) < 1e-9)
  assert.ok(Math.abs(result.peaks[0].electrons - result.peaks[1].electrons) < 1e-6)
})

test('peakSearch：maxPeaks 限制列出个数', () => {
  const volume = gaussianVolume([[0.25, 0.5, 0.5], [0.75, 0.5, 0.5]])
  assert.equal(peakSearch(volume, { maxPeaks: 1 }).peaks.length, 1)
})

test('peakSearch：各峰体素之和等于网格总数（回归：曾把体积当体素数）', () => {
  const volume = gaussianVolume([[0.25, 0.5, 0.5], [0.75, 0.5, 0.5]])
  const result = peakSearch(volume)
  const totalVoxels = volume.dims.reduce((product, value) => product * value, 1)
  const sum = result.peaks.reduce((acc, peak) => acc + peak.voxels, 0)
  assert.ok(Math.abs(sum - totalVoxels) < 1e-6, `体素之和 ${sum}，期望 ${totalVoxels}`)
  const electrons = result.peaks.reduce((acc, peak) => acc + peak.electrons, 0)
  assert.ok(Math.abs(electrons - result.total) < 1e-9)
})

test('formatPeakSearchText：含 VESTA 版式的关键行', () => {
  const result = peakSearch(gaussianVolume([[0.5, 0.5, 0.5]]))
  const text = formatPeakSearchText(result, { title: 'gauss', voxelVolume: result.voxelVolume })
  const lines = text.trim().split('\n')
  assert.equal(lines[0], 'gauss')
  assert.match(lines[1], /^Integrated value of volumetric data over the unit cell: [\d.]+, 0\.000000$/)
  assert.match(lines[3], /^Number of peaks in the volumetric data = 1$/)
  assert.match(lines[4], /x\s+y\s+z\s+Peak value\s+Integrated\s+Volume/)
  assert.match(lines[5], /^\s+1\s+0\.50000\s+0\.50000\s+0\.50000/)
})
