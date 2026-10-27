/**
 * 测量：距离/角度/点击拾取。
 *   node --test test/measure.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  measureAngles,
  measureDistances,
  parsePoscar,
  pickAtom,
  structureProjection,
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

const structure = () => {
  const parsed = parsePoscar(POSCAR, 'Si')
  return {
    a1: parsed.a1, a2: parsed.a2, a3: parsed.a3,
    atoms: parsed.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac })),
  }
}

test('measureDistances：Si 最近邻 2.3517 Å（金刚石）', () => {
  const [pair] = measureDistances(structure(), [[0, 1]])
  assert.ok(Math.abs(pair.distance - 2.3517) < 0.002, `实际 ${pair.distance}`)
  assert.equal(pair.i, 0)
  assert.equal(pair.j, 1)
})

test('measureDistances：索引越界报中文错误', () => {
  assert.throws(() => measureDistances(structure(), [[0, 9]]), /越界/)
})

test('measureAngles：立方晶胞里沿 a 与 b 的两个近邻夹角是 90°', () => {
  const cubic = {
    a1: [4, 0, 0], a2: [0, 4, 0], a3: [0, 0, 4],
    atoms: [
      { symbol: 'X', frac: [0, 0, 0] },
      { symbol: 'X', frac: [0.5, 0, 0] },
      { symbol: 'X', frac: [0, 0.5, 0] },
    ],
  }
  const [angle] = measureAngles(cubic, [[1, 0, 2]])
  assert.ok(Math.abs(angle.angle - 90) < 1e-6, `实际 ${angle.angle}`)
})

test('structureProjection：原子数与结构一致，坐标在画布内', () => {
  const projection = structureProjection(structure(), { width: 400, height: 300 })
  assert.equal(projection.atoms.length, 2)
  for (const atom of projection.atoms) {
    assert.ok(atom.x >= 0 && atom.x <= 400, `x 越界 ${atom.x}`)
    assert.ok(atom.y >= 0 && atom.y <= 300, `y 越界 ${atom.y}`)
    assert.ok(atom.radius > 0)
  }
})

test('pickAtom：点在原子上命中，点在空白处返回 null', () => {
  const view = { rx: 20, ry: 15, width: 800, height: 600 }
  const projection = structureProjection(structure(), view)
  const first = projection.atoms[0]
  const hit = pickAtom(structure(), { x: first.x, y: first.y, ...view })
  assert.ok(hit)
  assert.equal(hit.index, 0)
  assert.equal(hit.symbol, 'Si')
  assert.equal(pickAtom(structure(), { x: 2, y: 2, ...view }), null)
})

test('pickAtom：靠近哪个原子就命中哪个', () => {
  const view = { width: 800, height: 600, rx: 0, ry: 0, rz: 0 }
  const projection = structureProjection(structure(), view)
  const [a, b] = projection.atoms
  // 在 b 的圆内、但离 a 更远的一点：应命中 b
  const nearB = { x: b.x + 1, y: b.y + 1 }
  const hitB = pickAtom(structure(), { ...nearB, ...view })
  assert.equal(hitB?.index, 1)
  // 在 a 的圆内的一点：应命中 a
  const nearA = { x: a.x + 1, y: a.y + 1 }
  const hitA = pickAtom(structure(), { ...nearA, ...view })
  assert.equal(hitA?.index, 0)
})
