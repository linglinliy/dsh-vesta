#!/usr/bin/env node
/**
 * vesta-density-derived —— 由电子密度算 ∇²ρ、动能密度 g、势能密度 ν、能量密度 h_e（手册 14.15）。
 *
 *   node scripts/vesta-density-derived.mjs <体积文件> [--out-he energy.ted] [--out-lap lap.led]
 *
 * 公式（原子单位，ℏ²/m = 1，λ = 1/72，k = 1/6）：
 *   g = (3/10)(3π²)^{2/3} ρ^{5/3} + λ|∇ρ|²/ρ + k·∇²ρ/2
 *   ν = (1/4)∇²ρ − 2g，h_e = g + ν
 * 输出体积文件用 VESTA 的 general volumetric 文本格式（N+1 网格、z 最快），可直接在 VESTA 里打开。
 */
import { writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { densityDerived, formatVolumeText, readVolumeFile } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/vesta-density-derived.mjs <体积文件> [--out-he energy.ted] [--out-lap lap.led]')
  process.exit(2)
}

const source = resolve(input)
const volume = readVolumeFile(source)
if (!/e\/Å³/.test(volume.unit ?? '')) {
  console.error(`只对电子密度有意义（当前单位：${volume.unit ?? '未知'}）`)
  process.exit(2)
}

const derived = densityDerived(volume)
const stats = (array) => {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const value of array) {
    if (value < min) min = value
    if (value > max) max = value
    sum += value
  }
  return { min, max, mean: sum / array.length }
}

const lap = stats(derived.laplacian)
const kinetic = stats(derived.kinetic)
const potential = stats(derived.potential)
const energy = stats(derived.energy)

console.log(`文件：${basename(source)}　网格 ${volume.dims.join('×')}　输入单位 ${volume.unit}`)
console.log(`输出单位：g / ν / h_e 为 E_h·a₀⁻³；∇²ρ 为 a₀⁻⁵（手册表 14.1）`)
console.log(`∇²ρ   min ${lap.min.toExponential(3)}  max ${lap.max.toExponential(3)}  mean ${lap.mean.toExponential(3)}`)
console.log(`g     min ${kinetic.min.toExponential(3)}  max ${kinetic.max.toExponential(3)}  mean ${kinetic.mean.toExponential(3)}`)
console.log(`ν     min ${potential.min.toExponential(3)}  max ${potential.max.toExponential(3)}  mean ${potential.mean.toExponential(3)}`)
console.log(`h_e   min ${energy.min.toExponential(3)}  max ${energy.max.toExponential(3)}  mean ${energy.mean.toExponential(3)}`)

const writeVolume = (array, path, title) => {
  const wrapped = { ...volume, values: array }
  writeFileSync(path, formatVolumeText(wrapped, { title }), 'utf8')
  return path
}
const outHe = flag('out-he', '')
const outLap = flag('out-lap', '')
if (outHe) console.log(`\n已写出 h_e：${writeVolume(derived.energy, resolve(outHe), `${basename(source)} h_e`)}`)
if (outLap) console.log(`已写出 ∇²ρ：${writeVolume(derived.laplacian, resolve(outLap), `${basename(source)} laplacian`)}`)

console.log(JSON.stringify({
  file: source,
  unit: derived.unit,
  laplacian: { min: lap.min, max: lap.max },
  kinetic: { min: kinetic.min, max: kinetic.max },
  energy: { min: energy.min, max: energy.max },
  outHe: outHe ? resolve(outHe) : null,
  outLap: outLap ? resolve(outLap) : null,
}, null, 2))
