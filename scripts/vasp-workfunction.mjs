#!/usr/bin/env node
/**
 * vasp-workfunction —— 由 LOCPOT 算功函数（真空能级 − 费米能级）。
 *
 *   node scripts/vasp-workfunction.mjs <LOCPOT 或任务目录> [--axis c] [--efermi 2.0] [--out profile.csv]
 *
 * 费米能级默认从同目录 OUTCAR 读（E-fermi）；给 --efermi 可覆盖。
 * 真空能级取平面平均电势里最长的近水平段的均值。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parseOutcar, readVolumeFile, workFunction } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/vasp-workfunction.mjs <LOCPOT 或任务目录> [--axis c] [--efermi 2.0] [--out profile.csv]')
  process.exit(2)
}

const source = resolve(input)
const locpot = existsSync(source) && !source.toLowerCase().endsWith('locpot')
  ? join(source, 'LOCPOT')
  : source
if (!existsSync(locpot)) {
  console.error(`找不到 LOCPOT：${locpot}`)
  process.exit(2)
}

let efermi = Number(flag('efermi', 'NaN'))
let efermiSource = '命令行 --efermi'
if (!Number.isFinite(efermi)) {
  const outcar = join(dirname(locpot), 'OUTCAR')
  if (existsSync(outcar)) {
    const parsed = parseOutcar(readFileSync(outcar, 'utf8'))
    if (Number.isFinite(parsed.efermi)) {
      efermi = parsed.efermi
      efermiSource = 'OUTCAR'
    }
  }
}
if (!Number.isFinite(efermi)) {
  console.error('读不到费米能级：同目录没有 OUTCAR，或请用 --efermi 指定')
  process.exit(3)
}

const volume = readVolumeFile(locpot)
if (!/eV/.test(volume.unit ?? '')) {
  console.error(`LOCPOT 单位异常（${volume.unit ?? '未知'}），本工具只接受 LOCPOT（eV）`)
  process.exit(2)
}
const axis = flag('axis', 'c')
const result = workFunction(volume, { efermi, axis })

console.log(`文件：${basename(locpot)}　网格 ${volume.dims.join('×')}　轴 ${axis}（长 ${result.profile.length.toFixed(2)} Å）`)
console.log(`费米能级 E_F = ${efermi.toFixed(4)} eV（来自 ${efermiSource}）`)
console.log(`真空能级 E_vac = ${result.vacuumLevel.toFixed(4)} eV（平台段 ${result.plateau.start.toFixed(2)} → ${result.plateau.end.toFixed(2)} Å，长 ${result.plateau.length.toFixed(2)} Å）`)
console.log(`功函数 Φ = ${result.workFunction.toFixed(3)} eV`)

const out = flag('out', '')
if (out) {
  const lines = ['position_angstrom,potential_eV']
  result.profile.positions.forEach((position, index) => {
    lines.push(`${position.toFixed(4)},${result.profile.values[index].toFixed(6)}`)
  })
  writeFileSync(resolve(out), `${lines.join('\n')}\n`, 'utf8')
  console.log(`已写出剖面：${resolve(out)}`)
}

console.log(JSON.stringify({
  file: locpot,
  axis,
  efermi,
  efermiSource,
  vacuumLevel: +result.vacuumLevel.toFixed(4),
  workFunction: +result.workFunction.toFixed(4),
  plateau: result.plateau,
}, null, 2))
