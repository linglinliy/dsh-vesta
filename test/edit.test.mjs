/**
 * 结构编辑（扩胞 / 变换矩阵 / 元素替换 / POSCAR 写出）。
 *   node --test test/edit.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addAtoms,
  cellParameters,
  latticeFromCellParameters,
  removeAtoms,
  setCellParameters,
  makeSupercell,
  parsePoscar,
  structureToPoscar,
  substituteElement,
  transformStructure,
} from '../core.js'

const POSCAR = [
  'Si-fcc', '1.0',
  '0.000000 2.715500 2.715500',
  '2.715500 0.000000 2.715500',
  '2.715500 2.715500 0.000000',
  'Si', '2', 'Direct',
  '0.000000 0.000000 0.000000',
  '0.250000 0.250000 0.250000',
].join('\n') + '\n'

const baseStructure = () => {
  const parsed = parsePoscar(POSCAR, 'Si')
  return {
    a1: parsed.a1, a2: parsed.a2, a3: parsed.a3,
    atoms: parsed.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac })),
  }
}

test('transformStructure：2×2×1 得到 4 倍原子，基矢翻倍', () => {
  const base = baseStructure()
  const result = transformStructure(base, [[2, 0, 0], [0, 2, 0], [0, 0, 1]])
  assert.equal(result.determinant, 4)
  assert.equal(result.atoms.length, base.atoms.length * 4)
  assert.ok(Math.abs(result.a1[1] - base.a1[1] * 2) < 1e-9, 'a1 应翻倍')
  assert.ok(Math.abs(result.a3[1] - base.a3[1]) < 1e-9, 'a3 不应变化')
})

test('transformStructure：体积按 |det| 放大', () => {
  const base = baseStructure()
  const before = cellParameters([base.a1, base.a2, base.a3]).volume
  for (const [matrix, det] of [
    [[[2, 0, 0], [0, 2, 0], [0, 0, 1]], 4],
    [[[2, 0, 0], [0, 2, 0], [0, 0, 2]], 8],
    [[[1, 1, 0], [0, 1, 0], [0, 0, 1]], 1],
  ]) {
    const result = transformStructure(base, matrix)
    const after = cellParameters([result.a1, result.a2, result.a3]).volume
    assert.ok(Math.abs(after / before - det) < 1e-6, `体积比应等于 ${det}`)
    assert.equal(result.atoms.length, base.atoms.length * det)
  }
})

test('transformStructure：分数坐标全部落在 [0,1)', () => {
  const result = transformStructure(baseStructure(), [[2, 1, 0], [0, 2, 0], [0, 0, 1]])
  for (const atom of result.atoms) {
    for (const value of atom.frac) {
      assert.ok(value >= 0 && value < 1, `分数坐标越界：${value}`)
    }
  }
})

test('transformStructure：行列式为 0 或非整数时报中文错误', () => {
  assert.throws(() => transformStructure(baseStructure(), [[1, 0, 0], [0, 0, 0], [0, 0, 1]]), /行列式为 0/)
  assert.throws(() => transformStructure(baseStructure(), [[1.5, 0, 0], [0, 1, 0], [0, 0, 1]]), /整数/)
  assert.throws(() => transformStructure(baseStructure(), [[1, 0], [0, 1]]), /3×3/)
})

test('transformStructure 与 makeSupercell 结果一致（2×2×1）', () => {
  const base = baseStructure()
  const viaMatrix = transformStructure(base, [[2, 0, 0], [0, 2, 0], [0, 0, 1]])
  const viaSupercell = makeSupercell(base, [2, 2, 1])
  assert.equal(viaMatrix.atoms.length, viaSupercell.atoms.length)
  const volumeMatrix = cellParameters([viaMatrix.a1, viaMatrix.a2, viaMatrix.a3]).volume
  const volumeSupercell = cellParameters([viaSupercell.a1, viaSupercell.a2, viaSupercell.a3]).volume
  assert.ok(Math.abs(volumeMatrix - volumeSupercell) < 1e-6)
})

test('substituteElement：同位置换并计数', () => {
  const base = baseStructure()
  const result = substituteElement(base, 'Si', 'C')
  assert.equal(result.replaced, 2)
  assert.deepEqual([...new Set(result.structure.atoms.map((atom) => atom.symbol))], ['C'])
  assert.deepEqual(result.structure.atoms[0].frac, base.atoms[0].frac, '位置不应改变')
  assert.equal(substituteElement(base, 'Na', 'C').replaced, 0)
})

test('structureToPoscar：VASP5 往返保持原子与晶胞', () => {
  const base = baseStructure()
  const text = structureToPoscar(base, 'Si test')
  assert.match(text, /^Si test\n1\.0000000000\n/)
  assert.match(text, /\nDirect\n/)
  const back = parsePoscar(text, 'roundtrip')
  assert.equal(back.atoms.length, base.atoms.length)
  const original = cellParameters([base.a1, base.a2, base.a3])
  const restored = cellParameters([back.a1, back.a2, back.a3])
  assert.ok(Math.abs(original.volume - restored.volume) < 1e-6)
  assert.ok(Math.abs(back.atoms[1].frac[0] - 0.25) < 1e-9)
})

test('addAtoms：追加原子并把坐标折回 [0,1)', () => {
  const base = baseStructure()
  const added = addAtoms(base, [
    { symbol: 'C', frac: [1.5, -0.25, 0.5] },
    { symbol: 'H', frac: [0.1, 0.2, 0.3] },
  ])
  assert.equal(added.added, 2)
  assert.equal(added.structure.atoms.length, base.atoms.length + 2)
  const carbon = added.structure.atoms.at(-2)
  assert.deepEqual(carbon.symbol, 'C')
  assert.ok(Math.abs(carbon.frac[0] - 0.5) < 1e-9, '1.5 应折回 0.5')
  assert.ok(Math.abs(carbon.frac[1] - 0.75) < 1e-9, '-0.25 应折回 0.75')
})

test('addAtoms：缺 symbol 或 frac 不合法时报中文错误', () => {
  const base = baseStructure()
  assert.throws(() => addAtoms(base, []), /atoms 数组/)
  assert.throws(() => addAtoms(base, [{ frac: [0, 0, 0] }]), /symbol/)
  assert.throws(() => addAtoms(base, [{ symbol: 'C', frac: [0, 0] }]), /三个数字/)
})

test('removeAtoms：按元素与按索引删除', () => {
  const base = baseStructure()
  const bySpecies = removeAtoms(base, { species: 'Si' })
  assert.equal(bySpecies.removed, 2)
  assert.equal(bySpecies.structure.atoms.length, 0)
  const byIndex = removeAtoms(base, { indexes: [0] })
  assert.equal(byIndex.removed, 1)
  assert.equal(byIndex.structure.atoms.length, 1)
  assert.throws(() => removeAtoms(base, {}), /indexes 或 species/)
  assert.throws(() => removeAtoms(base, { species: 'Na' }), /没有匹配到/)
})

test('setCellParameters：只改一项时其余保持', () => {
  const base = baseStructure()
  const changed = setCellParameters(base, { a: 5.5 })
  const params = cellParameters([changed.structure.a1, changed.structure.a2, changed.structure.a3])
  assert.ok(Math.abs(params.a - 5.5) < 1e-9)
  const original = cellParameters([base.a1, base.a2, base.a3])
  assert.ok(Math.abs(params.b - original.b) < 1e-6, 'b 不应变化')
  assert.ok(Math.abs(params.gamma - original.gamma) < 1e-6, 'γ 不应变化')
})

test('latticeFromCellParameters：六方 120° 生成正确矢量', () => {
  const [a1, a2, a3] = latticeFromCellParameters({ a: 2.46, b: 2.46, c: 15, alpha: 90, beta: 90, gamma: 120 })
  assert.ok(Math.abs(a1[0] - 2.46) < 1e-9)
  assert.ok(Math.abs(a2[0] + 1.23) < 1e-9)
  assert.ok(Math.abs(a2[1] - 2.46 * Math.sin((120 * Math.PI) / 180)) < 1e-9)
  assert.ok(Math.abs(a3[2] - 15) < 1e-9)
})

test('latticeFromCellParameters：非法参数报中文错误', () => {
  assert.throws(() => latticeFromCellParameters({ a: -1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 }), /正数/)
  assert.throws(() => latticeFromCellParameters({ a: 1, b: 1, c: 1, alpha: 170, beta: 10, gamma: 10 }), /合法晶胞/)
})
