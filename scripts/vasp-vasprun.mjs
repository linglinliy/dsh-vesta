#!/usr/bin/env node
/**
 * vasp-vasprun —— 解析 vasprun.xml，输出关键信息并可与 OUTCAR/CONTCAR 交叉核对。
 *
 *   node scripts/vasp-vasprun.mjs <vasprun.xml 或任务目录> [--out summary.json]
 *
 * 覆盖：版本、INCAR、物种与价电子、k 点、每步能量、费米能级、NBANDS/NELECT、力/应力、终态结构。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parseOutcar, parsePoscar, parseVasprunXml } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/vasp-vasprun.mjs <vasprun.xml 或任务目录> [--out summary.json]')
  process.exit(2)
}

const source = resolve(input)
let xmlPath = source
if (!/vasprun\.xml$/i.test(source)) {
  const candidate = join(source, 'vasprun.xml')
  if (!existsSync(candidate)) {
    console.error(`找不到 vasprun.xml：${candidate}`)
    process.exit(2)
  }
  xmlPath = candidate
}

const text = readFileSync(xmlPath, 'utf8')
const parsed = parseVasprunXml(text)
const finalEnergy = parsed.energies.length > 0 ? parsed.energies[parsed.energies.length - 1] : null
const zvalSum = parsed.types.reduce((sum, type) => sum + type.count * type.valence, 0)

console.log(`文件：${basename(xmlPath)}（${(text.length / 1024).toFixed(0)} KB）`)
console.log(`VASP 版本：${parsed.version ?? '—'}`)
console.log(`原子 ${parsed.natoms ?? '—'}　物种：${parsed.types.map((type) => `${type.element}×${type.count}(Z=${type.valence})`).join(' ') || '—'}`)
console.log(`价电子之和 ${zvalSum} e　NELECT ${parsed.nelect ?? '—'}　NBANDS ${parsed.nbands ?? '—'}`)
console.log(`k 点：${parsed.kpoints.scheme ?? '—'} ${parsed.kpoints.divisions?.join('×') ?? ''}（列表 ${parsed.kpoints.count} 点）`)
console.log(`能量块 ${parsed.energies.length} 个　离子步 ${parsed.ionicSteps}　终态能量 ${finalEnergy === null ? '—' : finalEnergy.toFixed(8)} eV`)
console.log(`E-fermi ${parsed.efermi ?? '—'} eV　最大力 ${parsed.maxForce === null ? '—' : parsed.maxForce.toExponential(3)} eV/Å`)
if (parsed.stress) console.log(`应力 ${parsed.stress.map((value) => value.toFixed(2)).join(' / ')} kB`)

// 与同目录 OUTCAR / CONTCAR 交叉核对
const dir = dirname(xmlPath)
const crossChecks = []
const outcarPath = join(dir, 'OUTCAR')
if (existsSync(outcarPath)) {
  const outcar = parseOutcar(readFileSync(outcarPath, 'utf8'))
  if (outcar.sigma0 !== null && finalEnergy !== null) {
    crossChecks.push({ name: '能量', ours: finalEnergy, theirs: outcar.sigma0, delta: Math.abs(finalEnergy - outcar.sigma0), unit: 'eV' })
  }
  if (outcar.efermi !== null && parsed.efermi !== null) {
    crossChecks.push({ name: 'E-fermi', ours: parsed.efermi, theirs: outcar.efermi, delta: Math.abs(parsed.efermi - outcar.efermi), unit: 'eV' })
  }
}
const contcarPath = join(dir, 'CONTCAR')
if (existsSync(contcarPath) && parsed.finalStructure) {
  try {
    const contcar = parsePoscar(readFileSync(contcarPath, 'utf8'), 'CONTCAR')
    if (contcar.atoms.length === parsed.finalStructure.positions.length) {
      let maxDiff = 0
      for (let index = 0; index < contcar.atoms.length; index += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const a = parsed.finalStructure.positions[index][axis]
          const b = contcar.atoms[index].frac[axis]
          let diff = Math.abs(a - b)
          diff = Math.min(diff, Math.abs(diff - 1), Math.abs(diff + 1))
          if (diff > maxDiff) maxDiff = diff
        }
      }
      crossChecks.push({ name: '终态坐标', ours: null, theirs: null, delta: maxDiff, unit: '分数坐标' })
    }
  } catch {
    /* CONTCAR 读不了就跳过 */
  }
}
if (crossChecks.length > 0) {
  console.log('\n交叉核对：')
  for (const item of crossChecks) {
    const mark = item.delta < (item.unit === '分数坐标' ? 1e-3 : 1e-4) ? 'OK' : '偏差'
    console.log(`  ${mark} ${item.name}：Δ = ${item.delta.toExponential(2)} ${item.unit}`)
  }
}

const summary = {
  file: xmlPath,
  version: parsed.version,
  natoms: parsed.natoms,
  types: parsed.types.map((type) => ({ element: type.element, count: type.count, valence: type.valence })),
  zvalSum,
  nelect: parsed.nelect,
  nbands: parsed.nbands,
  kpoints: parsed.kpoints,
  energies: parsed.energies.length,
  ionicSteps: parsed.ionicSteps,
  finalEnergy,
  efermi: parsed.efermi,
  maxForce: parsed.maxForce,
  stress: parsed.stress,
  incar: parsed.incar,
  crossChecks: crossChecks.map((item) => ({ name: item.name, delta: item.delta, unit: item.unit })),
  out: null,
}
const out = flag('out', '')
if (out) {
  writeFileSync(resolve(out), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  summary.out = resolve(out)
  console.log(`\n已写出：${resolve(out)}`)
}
void readdirSync
console.log(JSON.stringify(summary, null, 2))
