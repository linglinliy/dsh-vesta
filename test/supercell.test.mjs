/**
 * 超胞构建（makeSupercell）。
 *   node --test test/supercell.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cellParameters, makeSupercell, parsePoscar } from '../core.js'

const FCC = parsePoscar([
  'Si-fcc', '5.5',
  '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0',
  'Si', '2', 'Direct',
  '0 0 0', '0.25 0.25 0.25',
].join('\n'), 'Si-fcc')

test('makeSupercell：原子数与体积按倍数增长', () => {
  const cell = cellParameters([FCC.a1, FCC.a2, FCC.a3])
  const supercell = makeSupercell(FCC, [2, 2, 2])
  assert.equal(supercell.atoms.length, 16)
  const newCell = cellParameters([supercell.a1, supercell.a2, supercell.a3])
  assert.ok(Math.abs(newCell.volume - cell.volume * 8) < 1e-6, `体积 ${newCell.volume}`)
})

test('makeSupercell：分数坐标都在 [0,1) 且互不重复', () => {
  const supercell = makeSupercell(FCC, [3, 1, 2])
  assert.equal(supercell.atoms.length, 2 * 3 * 1 * 2)
  const unique = new Set()
  for (const atom of supercell.atoms) {
    for (const value of atom.frac) {
      assert.ok(value >= 0 && value < 1, `坐标越界：${value}`)
    }
    unique.add(atom.frac.map((value) => value.toFixed(8)).join(','))
  }
  assert.equal(unique.size, supercell.atoms.length)
})

test('makeSupercell：物种顺序保持（同一元素仍然连续）', () => {
  const mixed = parsePoscar([
    'NaCl', '5.64', '1 0 0', '0 1 0', '0 0 1',
    'Na Cl', '1 1', 'Direct', '0 0 0', '0.5 0.5 0.5',
  ].join('\n'), 'NaCl')
  const supercell = makeSupercell(mixed, [2, 1, 1])
  assert.deepEqual(supercell.atoms.map((atom) => atom.symbol), ['Na', 'Cl', 'Na', 'Cl'])
})

test('makeSupercell：非法倍数报错', () => {
  assert.throws(() => makeSupercell(FCC, [0, 1, 1]), /正整数/)
  assert.throws(() => makeSupercell(FCC, [1, 1]), /三个正整数/)
  assert.throws(() => makeSupercell(FCC, [100, 100, 100]), /过大/)
})

test('makeSupercell：结果能被 parsePoscar 回读（往返一致）', () => {
  const supercell = makeSupercell(FCC, [2, 1, 1])
  const counts = new Map()
  for (const atom of supercell.atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1)
  const text = [
    'Si 2x1x1', '1.0',
    supercell.a1.join(' '), supercell.a2.join(' '), supercell.a3.join(' '),
    'Si', String(counts.get('Si')), 'Direct',
    ...supercell.atoms.map((atom) => atom.frac.join(' ')),
  ].join('\n')
  const back = parsePoscar(text, 'roundtrip')
  assert.equal(back.atoms.length, 4)
  assert.ok(Math.abs(back.atoms[0].frac[0] - 0) < 1e-9)
})
