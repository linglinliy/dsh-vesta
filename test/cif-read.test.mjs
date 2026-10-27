/**
 * CIF 读取（parseCif / structureFromCif）+ 占位率，用公开 COD 夹具。
 *   node --test test/cif-read.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSupercell, parseCif, structureFromCif, structureToCif, transformStructure } from '../core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, 'fixtures', 'public')
const SPGRA = process.env.VESTA_SPGRA ?? 'D:/VESTA-win64/spgra.dat'
const hasSpgra = existsSync(SPGRA)
const read = (name) => readFileSync(join(DIR, name), 'utf8')
const counts = (structure) => {
  const result = {}
  for (const atom of structure.atoms) result[atom.symbol] = (result[atom.symbol] ?? 0) + 1
  return result
}

test('parseCif：晶胞参数、空间群、IT 号', { skip: !existsSync(join(DIR, 'cod-9006316.cif')) && '缺少公开夹具' }, () => {
  const parsed = parseCif(read('cod-9006316.cif'))
  assert.equal(parsed.itNumber, 227)
  assert.match(parsed.spaceGroup, /F d -3 m/)
  assert.ok(Math.abs(parsed.cell.a - 8.33) < 0.01, `a=${parsed.cell.a}`)
  assert.ok(Math.abs(parsed.cell.gamma - 90) < 1e-9)
  assert.equal(parsed.ops.length, 192, '该 CIF 自带 192 条对称操作')
})

test('parseCif：带标准不确定度的坐标也能解析', { skip: !existsSync(join(DIR, 'cod-1000000.cif')) && '缺少公开夹具' }, () => {
  const parsed = parseCif(read('cod-1000000.cif'))
  assert.ok(parsed.atoms.length >= 30, `原子数 ${parsed.atoms.length}`)
  const phosphorus = parsed.atoms.find((atom) => atom.label === 'P1')
  assert.ok(phosphorus, '应能找到 P1')
  assert.ok(Math.abs(phosphorus.frac[0] - 0.55909) < 1e-5, `x=${phosphorus.frac[0]}`)
  assert.equal(phosphorus.symbol, 'P')
})

test('parseCif：多个 _atom_site 循环要累加（H 与重原子分开写）', { skip: !existsSync(join(DIR, 'cod-1000000.cif')) && '缺少公开夹具' }, () => {
  const parsed = parseCif(read('cod-1000000.cif'))
  const elements = new Set(parsed.atoms.map((atom) => atom.symbol))
  assert.ok(elements.has('P') && elements.has('O') && elements.has('C') && elements.has('H'), [...elements].join(','))
})

test('structureFromCif：CIF 自带操作时不用外部表', { skip: !existsSync(join(DIR, 'cod-9006316.cif')) && '缺少公开夹具' }, () => {
  const structure = structureFromCif(read('cod-9006316.cif'))
  assert.equal(structure.atoms.length, 56)
  assert.deepEqual(counts(structure), { Fe: 24, O: 32 })
  const partial = structure.atoms.filter((atom) => atom.occupancy !== null && atom.occupancy < 0.999)
  assert.equal(partial.length, 16, 'Fe-oct 占位 0.833 应保留在 16 个原子上')
  assert.ok(Math.abs(partial[0].occupancy - 0.83333) < 1e-4)
})

test('structureFromCif：没有自带操作时回退 spgra.dat', { skip: (!existsSync(join(DIR, 'cod-1010363.cif')) || !hasSpgra) && '缺少 CIF 或 spgra.dat' }, () => {
  const structure = structureFromCif(read('cod-1010363.cif'), { spaceGroupTablePath: SPGRA })
  assert.equal(structure.atoms.length, 64)
  assert.deepEqual(counts(structure), { Cu: 4, Fe: 4, C: 24, N: 32 })
})

test('structureFromCif：expandSymmetry=false 只返回不对称单元', { skip: !existsSync(join(DIR, 'cod-9006316.cif')) && '缺少公开夹具' }, () => {
  const structure = structureFromCif(read('cod-9006316.cif'), { expandSymmetry: false })
  assert.equal(structure.atoms.length, 3)
  assert.equal(structure.siteCount, 3)
})

test('parseCif：cod-1000000 没有自带对称操作（所以工具层要回退 VESTA）', { skip: !existsSync(join(DIR, 'cod-1000000.cif')) && '缺少公开夹具' }, () => {
  const parsed = parseCif(read('cod-1000000.cif'))
  assert.equal(parsed.ops.length, 0)
  assert.equal(parsed.itNumber, 14)
  assert.match(parsed.spaceGroup, /P 1 21\/n 1/)
})

test('structureFromCif：缺晶胞参数时给中文错误', () => {
  assert.throws(() => structureFromCif('data_x\n# nothing\n'), /晶胞参数/)
})
test('占位率在扩胞/矩阵变换与 CIF 往返中保留', { skip: !existsSync(join(DIR, 'cod-9006316.cif')) && '缺少公开夹具' }, () => {
  const structure = structureFromCif(read('cod-9006316.cif'))
  const partial = (value) => value.atoms.filter((atom) => atom.occupancy !== null && atom.occupancy < 0.999).length
  assert.equal(partial(structure), 16)
  assert.equal(partial(makeSupercell(structure, [2, 1, 1])), 32, "扩胞后占位原子应翻倍")
  assert.equal(partial(transformStructure(structure, [[2, 0, 0], [0, 1, 0], [0, 0, 1]])), 32)
  const cif = structureToCif(structure, { title: 'maghemite' })
  assert.ok(cif.includes('_atom_site_occupancy'), '应写出占位列')
  assert.equal(cif.split('\n').filter((line) => /0\.8333/.test(line)).length, 16)
  assert.match(cif, /_chemical_formula_sum\s+'Fe24 O32'/)
})
