/**
 * 体数据导出（volumeSlice / volumeSliceCsv / volumeProfileText）。
 *   node --test test/volume-export.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { volumeAboveLevel, volumePercentForValue, volumeProfileText, volumeSlice, volumeSliceCsv, volumeValueAtPercent } from '../core.js'

/** 造一个 2×3×4 的体数据，数值 = i + 10j + 100k，便于逐点核对。 */
const makeVolume = () => {
  const [nx, ny, nz] = [2, 3, 4]
  const values = new Float64Array(nx * ny * nz)
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) values[(k * ny + j) * nx + i] = i + 10 * j + 100 * k
    }
  }
  return { dims: [nx, ny, nz], values, unit: 'e/Å^3', structure: { a1: [1, 0, 0], a2: [0, 1, 0], a3: [0, 0, 1] } }
}

test('volumeSlice：xy 面取正确的 z 层', () => {
  const slice = volumeSlice(makeVolume(), { plane: 'xy', at: 0.5 })
  assert.equal(slice.rows, 3)
  assert.equal(slice.columns, 2)
  assert.equal(slice.axisLabels[2], 'z=2')
  // k=2 → 数值 200 + j*10 + i
  assert.equal(slice.values[0][0], 200)
  assert.equal(slice.values[2][1], 1 + 20 + 200)
})

test('volumeSlice：yz 与 zx 面的形状与取值', () => {
  const yz = volumeSlice(makeVolume(), { plane: 'yz', at: 0.5 })
  assert.equal(yz.rows, 4)
  assert.equal(yz.columns, 3)
  assert.equal(yz.axisLabels[2], 'x=1')
  assert.equal(yz.values[0][0], 1)

  const zx = volumeSlice(makeVolume(), { plane: 'zx', at: 0.5 })
  assert.equal(zx.rows, 2)
  assert.equal(zx.columns, 4)
  assert.equal(zx.axisLabels[2], 'y=1')
  assert.equal(zx.values[0][0], 10)
})

test('volumeSlice：非法切面或位置报中文错误', () => {
  assert.throws(() => volumeSlice(makeVolume(), { plane: 'ab' }), /plane/)
  assert.throws(() => volumeSlice(makeVolume(), { at: 1.5 }), /0–1/)
})

test('volumeSliceCsv：表头 + 行索引 + 数值，行数正确', () => {
  const csv = volumeSliceCsv(makeVolume(), { plane: 'xy', at: 0.5 })
  const lines = csv.trim().split('\n')
  assert.match(lines[0], /^x_y,0,1$/)
  assert.match(lines[1], /^# unit=e\/Å\^3$/)
  assert.match(lines[2], /^# z=2$/)
  const data = lines.slice(3)
  assert.equal(data.length, 3)
  assert.match(data[0], /^0,2\.000000e\+2/)
})

test('volumeProfileText：两列、点数与距离递增', () => {
  const text = volumeProfileText(makeVolume(), { from: [0, 0, 0], to: [0.5, 0.5, 0.5], points: 5 })
  const lines = text.trim().split('\n')
  assert.match(lines[0], /^# distance\(A\)\tvalue\(e\/Å\^3\)$/)
  const rows = lines.slice(1).map((line) => line.split('\t').map(Number))
  assert.equal(rows.length, 5)
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(rows[index][0] > rows[index - 1][0], '距离应递增')
    assert.ok(Number.isFinite(rows[index][1]), '数值应为有限数')
  }
})

// 真实数据（可选）：有 CHGCAR 时验证网格尺寸与 CSV 行数
const CHGCAR = process.env.VESTA_CHGCAR ?? 'C:/Users/Administrator/Desktop/新建文件夹/zzz/5.5/CHGCAR'
test('真实 CHGCAR：切片网格与 CSV 行数一致', { skip: !existsSync(CHGCAR) && '缺少 CHGCAR 样本' }, async () => {
  if (!existsSync(CHGCAR)) return
  const { readVolumeFile } = await import('../core.js')
  const volume = readVolumeFile(CHGCAR)
  const slice = volumeSlice(volume, { plane: 'xy', at: 0.5 })
  assert.equal(slice.rows, volume.dims[1])
  assert.equal(slice.columns, volume.dims[0])
  const csv = volumeSliceCsv(volume, { plane: 'xy', at: 0.5 })
  assert.equal(csv.trim().split('\n').length, volume.dims[1] + 3)
})
test('volumeValueAtPercent / volumePercentForValue：互为反函数', () => {
  const volume = makeVolume()
  for (const percent of [0, 25, 50, 75, 100]) {
    const value = volumeValueAtPercent(volume, percent)
    const back = volumePercentForValue(volume, value)
    assert.ok(Math.abs(back - percent) < 0.5, `${percent}% → ${value} → ${back}%`)
  }
})

test('volumeAboveLevel：阈值以上的格点计数与手工统计一致', () => {
  const volume = makeVolume()
  const ninety = volumeValueAtPercent(volume, 90)
  const result = volumeAboveLevel(volume, ninety)
  const expected = [...volume.values].filter((value) => value >= ninety).length
  assert.equal(result.count, expected)
  assert.equal(result.total, volume.values.length)
  // 小样本只有 12 个格点，比例误差放宽到 15%
  assert.ok(Math.abs(result.fraction * 100 - 10) < 15, `比例 ${(result.fraction * 100).toFixed(1)}%`)
})

test('volumePercentForValue：超出范围时钳到 0 或 100', () => {
  const volume = makeVolume()
  assert.equal(volumePercentForValue(volume, -1e9), 0)
  assert.equal(volumePercentForValue(volume, 1e9), 100)
  assert.throws(() => volumePercentForValue(volume, Number.NaN), /有限数/)
})
