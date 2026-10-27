/**
 * 空间群表与对称展开（用 VESTA 自带的 spgra.dat）。
 *   node --test test/symmetry.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  applySymmetry,
  centeringTranslations,
  assignWyckoff,
  symmetrizeCell,
  symmetrizeStructure,
  expandBySpaceGroup,
  parseWyckoffTable,
  reduceBySpaceGroup,
  symmetryOrbit,
  parseSpaceGroupTable,
  symmetryOperationToMatrix,
} from '../core.js'

const TABLE = process.env.VESTA_SPGRA ?? 'D:/VESTA-win64/spgra.dat'
const WYCKOFF = process.env.VESTA_WYCKOFF ?? 'D:/VESTA-win64/wyckoff.dat'
const hasWyckoff = existsSync(WYCKOFF)
const hasTable = existsSync(TABLE)

test('symmetryOperationToMatrix：解析带分数平移与负号', () => {
  assert.deepEqual(symmetryOperationToMatrix('x,y,z'), [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]])
  assert.deepEqual(symmetryOperationToMatrix('-x+1/2,y+1/2,-z'), [[-1, 0, 0, 0.5], [0, 1, 0, 0.5], [0, 0, -1, 0]])
  // spgra.dat 里有的行以逗号结尾
  assert.deepEqual(symmetryOperationToMatrix('x,-z,-y+1/2,'), [[1, 0, 0, 0], [0, 0, -1, 0], [0, -1, 0, 0.5]])
  assert.throws(() => symmetryOperationToMatrix('x,y'), /三段/)
})

test('centeringTranslations：按符号首字母给出点阵平移', () => {
  assert.equal(centeringTranslations('P 1').length, 1)
  assert.equal(centeringTranslations('I 4/mmm').length, 2)
  assert.equal(centeringTranslations('F m -3 m').length, 4)
  assert.equal(centeringTranslations('R -3 m').length, 3)
})

test('parseSpaceGroupTable：解析 VESTA 的 spgra.dat', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const table = parseSpaceGroupTable(readFileSync(TABLE, 'utf8'))
  assert.equal(table.size, 230)
  assert.equal(table.get(1).symbol, 'P 1')
  assert.equal(table.get(225).matrices.length, 24)
  assert.equal(table.get(227).matrices.length, 48)
  assert.ok(table.get(225).symbol.startsWith('F'))
})

test('expandBySpaceGroup：FCC / 金刚石 / hcp 的已知原子数', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const cell = { a1: [5.431, 0, 0], a2: [0, 5.431, 0], a3: [0, 0, 5.431] }
  const fcc = expandBySpaceGroup({ ...cell, atoms: [{ symbol: 'Si', frac: [0, 0, 0] }] }, 225, TABLE)
  assert.equal(fcc.unique, 4)
  const diamond = expandBySpaceGroup({ ...cell, atoms: [{ symbol: 'Si', frac: [0, 0, 0] }] }, 227, TABLE)
  assert.equal(diamond.unique, 8)
  const hcp = expandBySpaceGroup({ ...cell, atoms: [{ symbol: 'Mg', frac: [1 / 3, 2 / 3, 0.25] }] }, 194, TABLE)
  assert.equal(hcp.unique, 2)
  const p1 = expandBySpaceGroup({ ...cell, atoms: [{ symbol: 'X', frac: [0.1, 0.2, 0.3] }] }, 1, TABLE)
  assert.equal(p1.unique, 1)
})

test('applySymmetry：非法群号给出中文错误', () => {
  assert.throws(() => applySymmetry({ atoms: [] }, new Map(), 999), /没有编号/)
})
test('reduceBySpaceGroup：展开→约化→再展开是恒等变换', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const cell = { a1: [5.431, 0, 0], a2: [0, 5.431, 0], a3: [0, 0, 5.431] }
  const key = (structure) => structure.atoms.map((atom) => atom.symbol + ':' + atom.frac.map((v) => v.toFixed(4)).join(',')).sort().join('|')
  for (const number of [225, 227]) {
    const expanded = expandBySpaceGroup({ ...cell, atoms: [{ symbol: 'Si', frac: [0, 0, 0] }] }, number, TABLE)
    const reduced = reduceBySpaceGroup(expanded.structure, number, TABLE)
    assert.equal(reduced.structure.atoms.length, 1, `群 ${number} 约化后应只剩 1 个原子`)
    assert.equal(reduced.orbits[0].multiplicity, expanded.unique, `多重度应等于展开原子数`)
    const again = expandBySpaceGroup(reduced.structure, number, TABLE)
    assert.equal(key(again.structure), key(expanded.structure), `群 ${number} 应满足展开∘约化∘展开 = 展开`)
  }
})

test('reduceBySpaceGroup：NaCl 约化成 Na+Cl 各一个，多重度都是 4', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const cell = { a1: [5.431, 0, 0], a2: [0, 5.431, 0], a3: [0, 0, 5.431] }
  const expanded = expandBySpaceGroup({
    ...cell,
    atoms: [{ symbol: 'Na', frac: [0, 0, 0] }, { symbol: 'Cl', frac: [0.5, 0.5, 0.5] }],
  }, 225, TABLE)
  assert.equal(expanded.unique, 8)
  const reduced = reduceBySpaceGroup(expanded.structure, 225, TABLE)
  assert.equal(reduced.structure.atoms.length, 2)
  assert.deepEqual(reduced.structure.atoms.map((atom) => atom.symbol).sort(), ['Cl', 'Na'])
  assert.deepEqual(reduced.orbits.map((orbit) => orbit.multiplicity), [4, 4])
})

test('symmetryOrbit：单原子在 P1 下的轨道只有自身', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const table = parseSpaceGroupTable(readFileSync(TABLE, 'utf8'))
  const orbit = symmetryOrbit({ symbol: 'X', frac: [0.1, 0.2, 0.3] }, table.get(1))
  assert.equal(orbit.length, 1)
})
test('parseWyckoffTable：解析 VESTA 的 wyckoff.dat', { skip: !hasWyckoff && '缺少 wyckoff.dat' }, () => {
  if (!hasWyckoff) return
  const table = parseWyckoffTable(readFileSync(WYCKOFF, 'utf8'))
  assert.equal(table.size, 230)
  const sites = table.get(225).sites
  const site4a = sites.find((site) => site.letter === 'a')
  assert.equal(site4a.multiplicity, 4)
  assert.equal(site4a.rows.length, 1)
  assert.equal(sites.length >= 5, true)
})

test('assignWyckoff：225 的 4a/4b/一般位置', { skip: !hasWyckoff && '缺少 wyckoff.dat' }, () => {
  if (!hasWyckoff) return
  const table = parseWyckoffTable(readFileSync(WYCKOFF, 'utf8'))
  const cell = { a1: [5.431, 0, 0], a2: [0, 5.431, 0], a3: [0, 0, 5.431] }
  const assign = (frac) => assignWyckoff({ ...cell, atoms: [{ symbol: 'Si', frac }] }, 225, table, null)[0]
  const a = assign([0, 0, 0])
  assert.equal(a.letter, 'a')
  assert.equal(a.multiplicity, 4)
  const b = assign([0.5, 0.5, 0.5])
  assert.equal(b.letter, 'b')
  const general = assign([0.1, 0.2, 0.3])
  assert.equal(general.letter, 'l')
  assert.equal(general.multiplicity, 192)
})

test('assignWyckoff：Fd-3m 的 8a/8b/16c 与 hcp 的 2a/2c', { skip: !hasWyckoff && '缺少 wyckoff.dat' }, () => {
  if (!hasWyckoff) return
  const table = parseWyckoffTable(readFileSync(WYCKOFF, 'utf8'))
  const cell = { a1: [5.431, 0, 0], a2: [0, 5.431, 0], a3: [0, 0, 5.431] }
  const assign = (number, frac, symbol = 'Si') => assignWyckoff({ ...cell, atoms: [{ symbol, frac }] }, number, table, null)[0]
  assert.equal(assign(227, [0, 0, 0]).letter, 'a')
  assert.equal(assign(227, [0, 0, 0]).multiplicity, 8)
  assert.equal(assign(227, [0.5, 0.5, 0.5]).letter, 'b')
  assert.equal(assign(227, [0.125, 0.125, 0.125]).letter, 'c')
  assert.equal(assign(227, [0.125, 0.125, 0.125]).multiplicity, 16)
  assert.equal(assign(194, [0, 0, 0], 'Mg').letter, 'a')
  assert.equal(assign(194, [1 / 3, 2 / 3, 0.25], 'Mg').letter, 'c')
  assert.equal(assign(194, [1 / 3, 2 / 3, 0.25], 'Mg').multiplicity, 2)
})
test('symmetrizeStructure：轻微畸变的金刚石能恢复成理想结构', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const cell = { a1: [3.84, 0, 0], a2: [0, 3.84, 0], a3: [0, 0, 3.84] }
  const ideal = expandBySpaceGroup({ ...cell, atoms: [{ symbol: 'Si', frac: [0, 0, 0] }] }, 227, TABLE).structure
  const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const random = rng(7)
  const noise = 0.004
  const distorted = {
    ...cell,
    atoms: ideal.atoms.map((atom) => ({
      symbol: atom.symbol,
      frac: atom.frac.map((value) => value + (random() - 0.5) * 2 * noise),
    })),
  }
  const table = parseSpaceGroupTable(readFileSync(TABLE, 'utf8'))
  const result = symmetrizeStructure(distorted, 227, table, { iterations: 4 })
  const key = (structure) => structure.atoms.map((atom) => atom.frac.map((value) => value.toFixed(4)).join(',')).sort()
  assert.deepEqual(key(result.structure), key(ideal), '对称化后应与理想结构完全一致')
  assert.ok(result.maxShift < 0.01, `最大位移 ${result.maxShift}`)
})

test('symmetrizeStructure：非法群号报中文错误', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const table = parseSpaceGroupTable(readFileSync(TABLE, 'utf8'))
  assert.throws(() => symmetrizeStructure({ a1: [1,0,0], a2: [0,1,0], a3: [0,0,1], atoms: [] }, 999, table), /没有编号/)
})
test('symmetrizeCell：完美晶胞不被改动（P1 / 立方 / 六方）', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const table = parseSpaceGroupTable(readFileSync(TABLE, 'utf8'))
  const cubic = { a1: [3.84, 0, 0], a2: [0, 3.84, 0], a3: [0, 0, 3.84], atoms: [{ symbol: 'Si', frac: [0, 0, 0] }] }
  for (const number of [1, 221, 225, 227]) {
    const result = symmetrizeCell(cubic, number, table)
    assert.ok(Math.abs(result.after.a - 3.84) < 1e-6, `群 ${number} a=${result.after.a}`)
    assert.ok(result.deviation < 1e-9, `群 ${number} 偏差 ${result.deviation}`)
  }
  const hex = { a1: [2.95, 0, 0], a2: [-1.475, 2.5548, 0], a3: [0, 0, 4.68], atoms: [{ symbol: 'Mg', frac: [0, 0, 0] }] }
  const hexResult = symmetrizeCell(hex, 194, table)
  assert.ok(Math.abs(hexResult.after.a - 2.95) < 1e-3)
  assert.ok(Math.abs(hexResult.after.c - 4.68) < 1e-3)
  assert.ok(Math.abs(hexResult.after.gamma - 120) < 1e-2)
})

test('symmetrizeCell：畸变立方胞恢复成 a=b=c、α=β=γ=90°', { skip: !hasTable && '缺少 spgra.dat' }, () => {
  if (!hasTable) return
  const table = parseSpaceGroupTable(readFileSync(TABLE, 'utf8'))
  const distorted = {
    a1: [3.86, 0, 0], a2: [0.01, 3.82, 0], a3: [0, 0.012, 3.85],
    atoms: [{ symbol: 'Si', frac: [0, 0, 0] }],
  }
  const result = symmetrizeCell(distorted, 227, table)
  const { a, b, c, alpha, beta, gamma } = result.after
  assert.ok(Math.abs(a - b) < 1e-9 && Math.abs(b - c) < 1e-9, `a/b/c = ${a}/${b}/${c}`)
  assert.ok([alpha, beta, gamma].every((value) => Math.abs(value - 90) < 1e-9), `角度 ${alpha}/${beta}/${gamma}`)
  // 最小二乘投影应落在三个原值的平均附近
  assert.ok(Math.abs(a - (3.86 + 3.82 + 3.85) / 3) < 0.01, `a=${a}`)
  assert.ok(result.deviation > 1e-3, '原始晶胞确实偏离对称约束')
})
