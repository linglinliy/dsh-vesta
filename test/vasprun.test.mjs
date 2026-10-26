/**
 * vasprun.xml 解析（parseVasprunXml）。
 *   node --test test/vasprun.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { parseVasprunXml } from '../core.js'

/**
 * 合成的 vasprun.xml：注意真实文件在 '>' 前有空格（<varray name="forces" >），
 * 这是第一次实现踩过的坑，这里刻意保留。
 */
const XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<modeling>
 <generator>
  <i type="string" name="program" >vasp</i>
  <i type="string" name="version" >6.1.1</i>
  <i type="string" name="subversion" >19Jun20 (build Nov 10 2021)</i>
 </generator>
 <incar>
  <i type="string" name="SYSTEM" >test</i>
  <i name="ENCUT" >    520.00000000</i>
  <i type="int" name="ISPIN" >     2</i>
 </incar>
 <kpoints>
  <generation param="Gamma">
   <v type="int" name="divisions" >   3   3   1</v>
  </generation>
  <varray name="kpointlist" >
   <v>  0.0000000  0.0000000  0.0000000</v>
   <v>  0.0000000  0.3333333  0.0000000</v>
  </varray>
 </kpoints>
 <parameters>
  <separator name="electronic" >
   <i type="int" name="NBANDS" >   144</i>
   <i name="NELECT" >   207.00000000</i>
  </separator>
 </parameters>
 <atominfo>
  <atoms> 3 </atoms>
  <types> 2 </types>
  <array name="atomtypes" >
   <set>
    <rc><c>   2</c><c>C </c><c>    12.011</c><c>     4.00000000</c><c>PAW_PBE C 08Apr2002</c></rc>
    <rc><c>   1</c><c>Na</c><c>    22.990</c><c>     7.00000000</c><c>PAW_PBE Na_pv 02Aug2007</c></rc>
   </set>
  </array>
 </atominfo>
 <structure name="finalpos" >
  <crystal>
   <varray name="basis" >
    <v>   12.30000000   0.00000000   0.00000000</v>
    <v>   -6.15000000  10.65211247   0.00000000</v>
    <v>    0.00000000   0.00000000  25.00000000</v>
   </varray>
  </crystal>
  <varray name="positions" >
   <v>  0.00000000  0.00000000  0.50000000</v>
   <v>  0.33333333  0.33333333  0.50000000</v>
   <v>  0.50000000  0.50000000  0.60000000</v>
  </varray>
 </structure>
 <varray name="forces" >
  <v>   0.01000000   0.00000000   0.00000000</v>
  <v>   0.00000000   0.02000000   0.00000000</v>
  <v>   0.00000000   0.00000000  -0.03000000</v>
 </varray>
 <varray name="stress" >
  <v>  -0.16000000   0.00000000   0.11000000</v>
  <v>   0.00000000   0.00000000   0.00000000</v>
  <v>   0.11000000   0.00000000  -0.08000000</v>
 </varray>
 <energy>
  <i name="e_fr_energy" > -10.50000000</i>
  <i name="e_0_energy" > -10.40000000</i>
 </energy>
 <energy>
  <i name="e_fr_energy" > -10.90000000</i>
  <i name="e_0_energy" > -10.83910310</i>
 </energy>
 <calculation>
  <dos>
   <i name="efermi" >  -1.72805790</i>
  </dos>
 </calculation>
</modeling>`

test('parseVasprunXml：版本 / INCAR / 物种与价电子', () => {
  const parsed = parseVasprunXml(XML)
  assert.match(parsed.version, /6\.1\.1/)
  assert.equal(parsed.incar.ENCUT, '520.00000000')
  assert.equal(parsed.incar.ISPIN, '2')
  assert.equal(parsed.natoms, 3)
  assert.equal(parsed.types.length, 2)
  assert.equal(parsed.types[0].element, 'C')
  assert.equal(parsed.types[0].count, 2)
  assert.equal(parsed.types[1].valence, 7)
  // 2×4 + 1×7 = 15
  assert.equal(parsed.types.reduce((sum, type) => sum + type.count * type.valence, 0), 15)
})

test('parseVasprunXml：k 点、能量序列与费米能级', () => {
  const parsed = parseVasprunXml(XML)
  assert.equal(parsed.kpoints.scheme, 'Gamma')
  assert.deepEqual(parsed.kpoints.divisions, [3, 3, 1])
  assert.equal(parsed.kpoints.count, 2)
  assert.deepEqual(parsed.energies, [-10.4, -10.8391031])
  assert.ok(Math.abs(parsed.efermi - -1.7280579) < 1e-12)
  assert.equal(parsed.nbands, 144)
  assert.equal(parsed.nelect, 207)
})

test('parseVasprunXml：力 / 应力 / 终态结构', () => {
  const parsed = parseVasprunXml(XML)
  assert.ok(Math.abs(parsed.maxForce - 0.03) < 1e-9)
  assert.deepEqual(parsed.stress, [-0.16, 0, -0.08, 0, 0, 0.11])
  assert.ok(parsed.finalStructure)
  assert.equal(parsed.finalStructure.positions.length, 3)
  assert.ok(Math.abs(parsed.finalStructure.positions[2][2] - 0.6) < 1e-9)
  assert.ok(Math.abs(parsed.finalStructure.basis[1][0] - -6.15) < 1e-9)
})

test('parseVasprunXml：残缺文件不抛错，字段为 null/空', () => {
  const parsed = parseVasprunXml('<modeling><generator></generator></modeling>')
  assert.equal(parsed.version, null)
  assert.deepEqual(parsed.energies, [])
  assert.equal(parsed.finalStructure, null)
  assert.equal(parsed.types.length, 0)
})

// 有真实数据时，额外用一份真实 vasprun 做守门
const REAL = '<本地 pilot 数据集>/adsorption_tasks/host_G_pristine__Na1__hollow__h2.3/vasprun.xml'
test('parseVasprunXml：真实文件中 ΣZVAL 与 NELECT 一致', { skip: !existsSync(REAL) && '缺少真实 vasprun 样本' }, async () => {
  const { readFileSync } = await import('node:fs')
  const parsed = parseVasprunXml(readFileSync(REAL, 'utf8'))
  const zvalSum = parsed.types.reduce((sum, type) => sum + type.count * type.valence, 0)
  assert.equal(parsed.natoms, 51)
  assert.equal(zvalSum, parsed.nelect)
  assert.ok(parsed.ionicSteps >= 1)
  assert.ok(parsed.energies.length > 0)
})
