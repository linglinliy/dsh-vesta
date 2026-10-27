/**
 * CIF 导出（structureToCif）与 VESTA 往返验证。
 *   node --test test/cif.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { cellParameters, convertWithVesta, parsePoscar, structureToCif } from '../core.js'

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

test('structureToCif：包含晶胞、P1 与逐原子坐标', () => {
  const cif = structureToCif(structure(), { title: 'Si test' })
  assert.match(cif, /^data_Si_test/)
  const params = cellParameters([structure().a1, structure().a2, structure().a3])
  assert.ok(cif.includes(params.a.toFixed(6)), '应包含 a')
  assert.match(cif, /_symmetry_space_group_name_H-M\s+'P 1'/)
  assert.match(cif, /^loop_$/m)
  assert.match(cif, /_atom_site_fract_x/)
  const atomLines = cif.split('\n').filter((line) => /^Si\d+\s+Si\s/.test(line))
  assert.equal(atomLines.length, 2)
  assert.match(atomLines[0], /0\.00000000\s+0\.00000000\s+0\.00000000/)
})

test('structureToCif：标题里的非法字符被替换成下划线', () => {
  const cif = structureToCif(structure(), { title: '扩胞 2×2×1 test' })
  assert.match(cif, /^data_[0-9A-Za-z_.-]+/)
  assert.ok(!cif.split('\n')[0].includes('×'))
})

test('structureToCif：空结构也能写出合法的 CIF 骨架', () => {
  const cif = structureToCif({ a1: [5, 0, 0], a2: [0, 5, 0], a3: [0, 0, 5], atoms: [] })
  assert.match(cif, /^data_structure/)
  assert.match(cif, /_cell_length_a\s+5\.000000/)
  assert.ok(!/^C\d+/m.test(cif))
})

const VESTA = 'D:/VESTA-win64/VESTA.exe'
test('真实 VESTA：能读我们写的 CIF 并转回 POSCAR（往返一致）', { skip: !existsSync(VESTA) && '未安装 VESTA' }, async () => {
  if (!existsSync(VESTA)) return
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const dir = mkdtempSync(join(tmpdir(), 'vesta-cif-'))
  const cifPath = join(dir, 'out.cif')
  writeFileSync(cifPath, structureToCif(structure(), { title: 'roundtrip' }), 'utf8')
  const backPath = join(dir, 'back.POSCAR')
  await convertWithVesta({ executable: VESTA }, cifPath, backPath, { timeoutMs: 60000 })

  const back = parsePoscar(readFileSync(backPath, 'utf8'), 'back')
  assert.equal(back.atoms.length, 2)
  const original = cellParameters([structure().a1, structure().a2, structure().a3])
  const restored = cellParameters([back.a1, back.a2, back.a3])
  assert.ok(Math.abs(original.a - restored.a) < 1e-4)
  assert.ok(Math.abs(original.alpha - restored.alpha) < 1e-3)
})
