/**
 * 公开测试数据（COD 的 CIF + 用 VESTA 转出的 POSCAR）。
 * 来源与许可见 test/fixtures/public/PROVENANCE.md。
 *   node --test test/public-fixtures.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cellParameters, parsePoscar, structureToCif } from '../core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, 'fixtures', 'public')

const read = (name) => readFileSync(join(DIR, name), 'utf8')
const counts = (structure) => {
  const result = {}
  for (const atom of structure.atoms) result[atom.symbol] = (result[atom.symbol] ?? 0) + 1
  return result
}

test('cod-1000000：140 原子，a=7.878 Å，组成与 CIF 的 4 倍一致', { skip: !existsSync(join(DIR, 'cod-1000000.POSCAR')) && '缺少公开夹具' }, () => {
  const structure = parsePoscar(read('cod-1000000.POSCAR'), 'cod-1000000')
  assert.equal(structure.atoms.length, 140)
  const cell = cellParameters([structure.a1, structure.a2, structure.a3])
  assert.ok(Math.abs(cell.a - 7.8783) < 0.01, `a=${cell.a}`)
  assert.deepEqual(counts(structure), { P: 8, Al: 4, O: 32, H: 68, N: 8, C: 20 })
})

test('cod-1010363：64 原子，立方 a=10.05 Å', { skip: !existsSync(join(DIR, 'cod-1010363.POSCAR')) && '缺少公开夹具' }, () => {
  const structure = parsePoscar(read('cod-1010363.POSCAR'), 'cod-1010363')
  assert.equal(structure.atoms.length, 64)
  const cell = cellParameters([structure.a1, structure.a2, structure.a3])
  assert.ok(Math.abs(cell.a - 10.05) < 0.01, `a=${cell.a}`)
  assert.ok(Math.abs(cell.alpha - 90) < 0.01)
  assert.deepEqual(counts(structure), { Cu: 4, Fe: 4, C: 24, N: 32 })
})

test('cod-9006316：56 原子（CIF 声明 Fe2O3，但展开是 Fe24O32 —— 占位率被忽略）', { skip: !existsSync(join(DIR, 'cod-9006316.POSCAR')) && '缺少公开夹具' }, () => {
  const structure = parsePoscar(read('cod-9006316.POSCAR'), 'cod-9006316')
  assert.equal(structure.atoms.length, 56)
  assert.deepEqual(counts(structure), { Fe: 24, O: 32 })
  const ratio = counts(structure).Fe / counts(structure).O
  assert.ok(Math.abs(ratio - 0.75) < 1e-9, 'Fe:O 应为 24:32 = 0.75（即 Fe3O4 比例）')
})

test('公开夹具可以转写成 CIF 并保持晶胞与原子数', { skip: !existsSync(join(DIR, 'cod-9006316.POSCAR')) && '缺少公开夹具' }, () => {
  const structure = parsePoscar(read('cod-9006316.POSCAR'), 'hematite')
  const original = cellParameters([structure.a1, structure.a2, structure.a3])
  const cif = structureToCif(
    { a1: structure.a1, a2: structure.a2, a3: structure.a3, atoms: structure.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac })) },
    { title: 'hematite' },
  )
  assert.match(cif, /^data_hematite/)
  const atomLines = cif.split('\n').filter((line) => /^(Fe|O)\d+\s+(Fe|O)\s/.test(line))
  assert.equal(atomLines.length, 56)
  assert.ok(cif.includes(original.a.toFixed(6)))
})
