/**
 * 结构预检（structureHealth）。
 *   node --test test/health.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePoscar, structureHealth } from '../core.js'

const build = (atoms, { a1 = [4, 0, 0], a2 = [0, 4, 0], a3 = [0, 0, 20] } = {}) => {
  const species = [...new Set(atoms.map((atom) => atom.symbol))]
  const counts = species.map((symbol) => atoms.filter((atom) => atom.symbol === symbol).length)
  const ordered = species.flatMap((symbol) => atoms.filter((atom) => atom.symbol === symbol))
  return parsePoscar([
    'health', '1.0',
    a1.join(' '), a2.join(' '), a3.join(' '),
    species.join(' '), counts.join(' '), 'Direct',
    ...ordered.map((atom) => atom.frac.map((value) => value.toFixed(6)).join(' ')),
  ].join('\n'), 'health')
}

test('structureHealth：正常结构通过，无问题项', () => {
  const structure = build([
    { symbol: 'C', frac: [0.0, 0.0, 0.5] },
    { symbol: 'C', frac: [0.25, 0.0, 0.5] },
  ])
  const health = structureHealth(structure)
  assert.equal(health.ok, true)
  assert.deepEqual(health.issues, [])
  assert.equal(health.atoms, 2)
  assert.equal(health.formula, 'C2')
  assert.ok(Math.abs(health.minDistance - 1) < 1e-6, `最近原子 ${health.minDistance}`)
})

test('structureHealth：原子完全重合 → error', () => {
  const structure = build([
    { symbol: 'C', frac: [0.5, 0.5, 0.5] },
    { symbol: 'C', frac: [0.5, 0.5, 0.5] },
  ])
  const health = structureHealth(structure)
  assert.equal(health.ok, false)
  assert.ok(health.issues.some((issue) => issue.level === 'error' && /重合/.test(issue.message)))
})

test('structureHealth：原子过近（< 0.5 Å）→ warning 但不失败', () => {
  const structure = build([
    { symbol: 'C', frac: [0.5, 0.5, 0.5] },
    { symbol: 'C', frac: [0.51, 0.5, 0.5] }, // 0.04 Å × 4 = 0.04 Å? 实际 0.01×4 = 0.04 Å
  ])
  const health = structureHealth(structure)
  assert.equal(health.ok, true)
  assert.ok(health.issues.some((issue) => issue.level === 'warning' && /过近|距离/.test(issue.message)))
})

test('structureHealth：坐标越界 → warning', () => {
  const structure = build([
    { symbol: 'C', frac: [0.0, 0.0, 0.5] },
    { symbol: 'C', frac: [0.3, 0.0, 1.02] },
  ])
  const health = structureHealth(structure)
  assert.equal(health.ok, true)
  assert.ok(health.issues.some((issue) => /越界/.test(issue.message)))
})

test('structureHealth：零体积晶胞 → error', () => {
  const structure = build([{ symbol: 'C', frac: [0, 0, 0.5] }], { a1: [4, 0, 0], a2: [0, 0, 0], a3: [0, 0, 20] })
  const health = structureHealth(structure)
  assert.equal(health.ok, false)
  assert.ok(health.issues.some((issue) => issue.level === 'error'))
})
