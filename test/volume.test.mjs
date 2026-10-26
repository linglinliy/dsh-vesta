/**
 * 体积数据解析的单元测试：CUBE、CHGCAR、网格降采样量化。
 * 用内联的最小样本，不依赖任何临时文件。
 *
 *   node --test test/volume.test.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { BOHR3_TO_A3, parseVestaVolumeText, volumeDiagnostics, sampleSlice, parseCube, parseChgcar, parsePoscar, encodeVolume, readVolumeFile } from '../core.js'

/** 3×2×2 的小 CUBE：原子 2 个，数值按 x 最快排列。 */
const CUBE = `tiny cube
second line
2 0 0 0
3 1.0 0 0
2 0 1.0 0
2 0 0 1.0
6 6.0 0 0 0
8 8.0 1 1 1
1 2 3 4 5 6 7 8 9 10 11 12
`

test('parseCube：维度、原子与数值顺序', () => {
  const volume = parseCube(CUBE)
  assert.deepEqual(volume.dims, [3, 2, 2])
  assert.equal(volume.atoms.length, 2)
  assert.equal(volume.atoms[0].symbol, 'C')
  assert.equal(volume.atoms[1].symbol, 'O')
  assert.deepEqual(volume.atoms[1].cart, [1, 1, 1])
  assert.equal(volume.values.length, 12)
  assert.equal(volume.values[0], 1)
  assert.equal(volume.values[11], 12)
  assert.deepEqual(volume.steps[0], [1, 0, 0])
})

test('parseChgcar：结构块 + ρ·V 换算回 e/Å³', () => {
  // 立方晶胞 V = 8 Å³，2×2×2 网格，数值 1..8 → ρ = value / 8
  const chgcar = [
    'test cell',
    '1.0',
    '2 0 0',
    '0 2 0',
    '0 0 2',
    'C',
    '1',
    'Direct',
    '0 0 0',
    '',
    '2 2 2',
    '1 2 3 4',
    '5 6 7 8',
  ].join('\n')
  const volume = parseChgcar(chgcar)
  assert.deepEqual(volume.dims, [2, 2, 2])
  assert.equal(volume.atoms.length, 1)
  assert.equal(volume.unit, 'e/Å³')
  assert.equal(volume.values.length, 8)
  assert.ok(Math.abs(volume.values[0] - 1 / 8) < 1e-9)
  assert.ok(Math.abs(volume.values[7] - 8 / 8) < 1e-9)
})

test('encodeVolume：降采样到最长边上限并量化成 Uint8', () => {
  const values = new Float32Array(4 * 4 * 4)
  for (let i = 0; i < values.length; i += 1) values[i] = i
  const encoded = encodeVolume({ dims: [4, 4, 4], values }, { maxDim: 2 })
  assert.deepEqual(encoded.dims, [2, 2, 2])
  assert.equal(encoded.stride, 2)
  assert.equal(encoded.min, 0)
  // 采到的是 x/y/z 都为偶数的 8 个点：index = 16z + 4y + x，最大在 (2,2,2) = 42。
  assert.equal(encoded.max, 42)
  const bytes = Buffer.from(encoded.data, 'base64')
  assert.equal(bytes.length, 8)
  assert.equal(bytes[0], 0)
  assert.equal(bytes[7], 255)
})

test('encodeVolume：常数列不会除以零', () => {
  const values = new Float32Array(8).fill(0.5)
  const encoded = encodeVolume({ dims: [2, 2, 2], values }, { maxDim: 8 })
  assert.ok(Number.isFinite(encoded.min))
  assert.ok(Number.isFinite(encoded.max))
  const bytes = Buffer.from(encoded.data, 'base64')
  // 常量场应量化为同一个值（等值面因此不会出现，但也不该产生 NaN / 除零）。
  assert.equal(new Set(bytes).size, 1)
})
test('readVolumeFile：空 CHGCAR 给出可操作的提示', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-vol-'))
  const file = join(dir, 'CHGCAR')
  writeFileSync(file, '')
  assert.throws(() => readVolumeFile(file), /空文件.*LCHARG/)
})

test('readVolumeFile：按扩展名分派 CUBE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-vol-'))
  const file = join(dir, 'density.cube')
  writeFileSync(file, CUBE)
  const volume = readVolumeFile(file)
  assert.deepEqual(volume.dims, [3, 2, 2])
})
test('parseChgcar：网格顺序是 x 最快（VASP/Fortran 约定）', () => {
  // 2×3×4 网格，数值 = 1..24，用来钉死 index = (k*ny + j)*nx + i
  const values = Array.from({ length: 24 }, (_, i) => String(i + 1))
  const chgcar = [
    'order test',
    '1.0',
    '2 0 0',
    '0 2 0',
    '0 0 2',
    'Si',
    '1',
    'Direct',
    '0 0 0',
    '',
    '2 3 4',
    values.join(' '),
  ].join('\n')
  const volume = parseChgcar(chgcar)
  assert.deepEqual(volume.dims, [2, 3, 4])
  const cellVolume = 8
  assert.ok(Math.abs(volume.values[0] - 1 / cellVolume) < 1e-12)
  assert.ok(Math.abs(volume.values[1] - 2 / cellVolume) < 1e-12) // i 变化 → 下一个数
  assert.ok(Math.abs(volume.values[2] - 3 / cellVolume) < 1e-12) // i 到头，j+1
  assert.ok(Math.abs(volume.values[6] - 7 / cellVolume) < 1e-12) // j 到头，k+1
  assert.equal(volume.values.length, 24)
})
test('parsePoscar：VASP4（没有元素行）用 POTCAR 元素补齐', () => {
  const text = ['Si-fcc', '5.5', '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0', '2', 'Direct', '0 0 0', '0.25 0.25 0.25'].join('\n')
  const structure = parsePoscar(text, 'POSCAR', { symbols: ['Si'] })
  assert.equal(structure.atoms.length, 2)
  assert.equal(structure.atoms[0].symbol, 'Si')
  // 5.5 缩放后的 fcc 原胞棱长 = 5.5 / sqrt(2)
  assert.ok(Math.abs(Math.hypot(...structure.a1) - 5.5 / Math.SQRT2) < 1e-6)
  assert.throws(() => parsePoscar(text, 'POSCAR'), /VASP 4/)
})
test('parseCube：原子序数映射到元素符号（防止符号表丢失）', () => {
  const cube = [
    'symbols',
    'comment',
    '2 0 0 0',
    '2 0.5 0 0',
    '2 0 0.5 0',
    '2 0 0 0.5',
    '14 14.0 0 0 0',
    '6 6.0 1 1 1',
    '0 0 0 0 0 0 0 0',
  ].join('\n')
  const parsed = parseCube(cube)
  assert.deepEqual(parsed.atoms.map((atom) => atom.symbol), ['Si', 'C'])
})

/** 两块 CHGCAR（ISPIN=2）：第一块电荷、第二块磁化密度；体积 8 Å³。 */
const TWO_BLOCK = [
  'two block',
  '1.0',
  '2 0 0',
  '0 2 0',
  '0 0 2',
  'C',
  '1',
  'Direct',
  '0 0 0',
  '',
  '1 1 2',
  '8 16',
  ' 1 1 1 1',
  '',
  '1 1 2',
  '4 8',
].join('\n')

test('parseChgcar：默认读第一块（电荷密度）', () => {
  const volume = parseChgcar(TWO_BLOCK)
  assert.equal(volume.block, 1)
  assert.deepEqual(Array.from(volume.values), [1, 2])
})

test('parseChgcar：block=2 跳过 augmentation 读到磁化密度块', () => {
  const volume = parseChgcar(TWO_BLOCK, { block: 2 })
  assert.equal(volume.block, 2)
  assert.deepEqual(Array.from(volume.values), [0.5, 1])
  assert.match(volume.unit, /磁化/)
})

test('parseChgcar：单块文件请求第二块时报错', () => {
  const single = TWO_BLOCK.split('\n').slice(0, 12).join('\n')
  assert.throws(() => parseChgcar(single, { block: 2 }), /没有第二个网格块/)
})

/** 同一种「结构 + 网格 + 数据」布局，用来对比不同文件的单位处理。 */
const volumeLike = (values) => [
  'unit test',
  '1.0',
  '2 0 0',
  '0 2 0',
  '0 0 2',
  'C',
  '1',
  'Direct',
  '0 0 0',
  '',
  '1 1 2',
  values,
].join('\n')

test('readVolumeFile：PARCHG 与 CHG 一样除以体积', async () => {
  const { readVolumeFile } = await import('../core.js')
  const dir = mkdtempSync(join(tmpdir(), 'vesta-vol-'))
  writeFileSync(join(dir, 'PARCHG'), volumeLike('8 16'))
  const volume = readVolumeFile(join(dir, 'PARCHG'))
  assert.equal(volume.unit, 'e/Å³')
  assert.deepEqual(Array.from(volume.values), [1, 2])
})

test('readVolumeFile：ELFCAR 不除体积、单位标成无量纲', async () => {
  const { readVolumeFile } = await import('../core.js')
  const dir = mkdtempSync(join(tmpdir(), 'vesta-vol-'))
  writeFileSync(join(dir, 'ELFCAR'), volumeLike('0.25 0.75'))
  const volume = readVolumeFile(join(dir, 'ELFCAR'))
  assert.match(volume.unit, /ELF/)
  assert.deepEqual(Array.from(volume.values), [0.25, 0.75])
})

test('readVolumeFile：LOCPOT 不除体积、单位是 eV', async () => {
  const { readVolumeFile } = await import('../core.js')
  const dir = mkdtempSync(join(tmpdir(), 'vesta-vol-'))
  writeFileSync(join(dir, 'LOCPOT'), volumeLike('-3.5 1.5'))
  const volume = readVolumeFile(join(dir, 'LOCPOT'))
  assert.match(volume.unit, /eV/)
  assert.deepEqual(Array.from(volume.values), [-3.5, 1.5])
})

test('readVolumeFile：陌生文件名报错并列出支持的类型', async () => {
  const { readVolumeFile } = await import('../core.js')
  const dir = mkdtempSync(join(tmpdir(), 'vesta-vol-'))
  writeFileSync(join(dir, 'WEIRD.dat'), volumeLike('1 2'))
  assert.throws(() => readVolumeFile(join(dir, 'WEIRD.dat')), /PARCHG.*ELFCAR.*LOCPOT/)
})

/** 2×2×2 体积，值 1..8，x 最快、z 最慢。 */
const SMALL = { dims: [2, 2, 2], values: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]) }

test('sampleSlice：xy 截面按 z 取整层', () => {
  const first = sampleSlice(SMALL, { plane: 'xy', at: 0, size: 2 })
  assert.deepEqual(Array.from(first.pixels), [1, 2, 3, 4])
  const second = sampleSlice(SMALL, { plane: 'xy', at: 0.5, size: 2 })
  assert.deepEqual(Array.from(second.pixels), [5, 6, 7, 8])
})

test('sampleSlice：yz 截面固定 x（行是 z、列是 y）', () => {
  const slice = sampleSlice(SMALL, { plane: 'yz', at: 0, size: 2 })
  // x=0 固定；行 0 是 z=0，列依次 y=0、y=1 → 1、3；行 1 是 z=1 → 5、7
  assert.deepEqual(Array.from(slice.pixels), [1, 3, 5, 7])
})

test('sampleSlice：非网格位置做线性插值', () => {
  const slice = sampleSlice(SMALL, { plane: 'xy', at: 0, size: 3 })
  // 第一行沿 x 在 1（i=0）与 2（i=1）之间插值；u=1/3 时距 i=0 为 2/3 → 5/3
  assert.ok(Math.abs(slice.pixels[0] - 1) < 1e-6)
  assert.ok(Math.abs(slice.pixels[1] - 5 / 3) < 1e-6)
  // u=2/3 越过周期边界，在 i=1 与 i=0 之间插值 → 同为 5/3
  assert.ok(Math.abs(slice.pixels[2] - 5 / 3) < 1e-6)
})

test('sampleSlice：统计量', () => {
  const slice = sampleSlice(SMALL, { plane: 'xy', at: 0, size: 2 })
  assert.equal(slice.min, 1)
  assert.equal(slice.max, 4)
  assert.ok(Math.abs(slice.mean - 2.5) < 1e-9)
  assert.equal(slice.size, 2)
})

/** 合成体积：结构为 2 Å 立方胞、一个原子在原点，密度峰指定在某个网格点。 */
const cubicVolume = (peakAt) => {
  const nx = 4, ny = 4, nz = 4
  const values = new Float32Array(nx * ny * nz)
  const [pi, pj, pk] = peakAt
  values[(pk * ny + pj) * nx + pi] = 1
  return {
    dims: [nx, ny, nz],
    values,
    unit: 'e/Å³',
    structure: {
      a1: [2, 0, 0],
      a2: [0, 2, 0],
      a3: [0, 0, 2],
      atoms: [{ symbol: 'C', frac: [0, 0, 0] }],
    },
  }
}

test('volumeDiagnostics：峰在原子处时距离为 0', () => {
  const report = volumeDiagnostics(cubicVolume([0, 0, 0]))
  assert.equal(report.nearest.distance, 0)
  assert.equal(report.atoms[0].value, 1)
  // ∫ρ dV = 均值 × 体积 = (1/64) × 8 = 0.125
  assert.ok(Math.abs(report.integral - 0.125) < 1e-6)
})

test('volumeDiagnostics：峰偏离原子时给出距离', () => {
  const report = volumeDiagnostics(cubicVolume([2, 0, 0]))
  // 网格 4 格 → 峰在 x=1 Å 处，距原点 1 Å
  assert.ok(Math.abs(report.nearest.distance - 1) < 1e-6)
  assert.equal(report.atoms[0].value, 0)
})

test('volumeDiagnostics：周期性最近邻（原子在 0，峰在 x=1.5 → 距离 0.5）', () => {
  const report = volumeDiagnostics(cubicVolume([3, 0, 0]))
  assert.ok(Math.abs(report.nearest.distance - 0.5) < 1e-6)
})

test('volumeDiagnostics：没有结构时只给统计量', () => {
  const volume = cubicVolume([0, 0, 0])
  delete volume.structure
  const report = volumeDiagnostics(volume)
  assert.equal(report.nearest, null)
  assert.equal(report.integral, null)
  assert.equal(report.max, 1)
})

test('parseVestaVolumeText：按 z 最快读入，维度是 N+1', () => {
  const values = Array.from({ length: 27 }, (_, n) => n + 1)
  const text = [
    'test volume',
    ' 3.88909  3.88909  3.88909  60.0000  60.0000  60.0000',
    '   3    3    3',
    values.slice(0, 9).join(' '),
    values.slice(9, 18).join(' '),
    values.slice(18).join(' '),
  ].join('\n')
  const parsed = parseVestaVolumeText(text)
  assert.deepEqual(parsed.dims, [3, 3, 3])
  assert.equal(parsed.cell[0], 3.88909)
  assert.equal(parsed.cell[3], 60)
  // z 最快：index = i*(3*3) + j*3 + k
  assert.equal(parsed.values[0], 1)
  assert.equal(parsed.values[1 * 9 + 2 * 3 + 1], values[1 * 9 + 2 * 3 + 1])
  assert.equal(parsed.values[26], 27)
})

test('parseVestaVolumeText：数据不足时报错', () => {
  const text = ['t', '1 1 1 90 90 90', '2 2 2', '1 2 3'].join('\n')
  assert.throws(() => parseVestaVolumeText(text), /数据不足/)
})

test('BOHR3_TO_A3：1 bohr⁻³ ≈ 6.748 Å⁻³', () => {
  assert.ok(Math.abs(BOHR3_TO_A3 - 6.748334) < 1e-5)
})

