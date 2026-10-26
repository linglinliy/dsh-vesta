#!/usr/bin/env node
/**
 * xray-powder —— 由结构算 X 射线粉末衍射峰位与相对强度（Bragg–Brentano）。
 *
 *   node scripts/xray-powder.mjs <结构文件> [--lambda 1.5406] [--two-theta-max 90] [--max-index 6] [--out peaks.csv]
 *
 * 强度 = Σ|F|² × LP(2θ)，归一到 100；同 d 的反射合并（自动含多重度）。
 */
import { writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parsePoscar, potcarElements, powderPattern } from '../core.js'
import { existsSync, readFileSync } from 'node:fs'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/xray-powder.mjs <结构文件> [--lambda 1.5406] [--two-theta-max 90] [--out peaks.csv]')
  process.exit(2)
}

const source = resolve(input)
const potcarPath = join(dirname(source), 'POTCAR')
const symbols = existsSync(potcarPath) ? potcarElements(readFileSync(potcarPath, 'utf8')) : undefined
const structure = parsePoscar(readFileSync(source, 'utf8'), basename(source), { symbols })

const result = powderPattern(structure, {
  lambda: Number(flag('lambda', '1.5406')),
  twoThetaMax: Number(flag('two-theta-max', '90')),
  maxIndex: Number(flag('max-index', '6')),
})

console.log(`文件：${basename(source)}　波长 λ = ${result.lambda} Å　峰数 ${result.peaks.length}`)
console.log('   2θ(°)      d(Å)       I(%)   等价反射数')
for (const peak of result.peaks) {
  console.log(
    `${peak.twoTheta.toFixed(3).padStart(9)}`
    + `${peak.d.toFixed(4).padStart(11)}`
    + `${peak.intensity.toFixed(1).padStart(11)}`
    + `${String(peak.hkls.length).padStart(11)}`,
  )
}
if (result.strongest) {
  console.log(`\n最强峰：2θ = ${result.strongest.twoTheta.toFixed(3)}°，d = ${result.strongest.d.toFixed(4)} Å`)
}

const out = flag('out', '')
if (out) {
  const lines = ['two_theta_deg,d_angstrom,intensity,hkl_count']
  for (const peak of result.peaks) {
    lines.push(`${peak.twoTheta.toFixed(4)},${peak.d.toFixed(6)},${peak.intensity.toFixed(3)},${peak.hkls.length}`)
  }
  writeFileSync(resolve(out), `${lines.join('\n')}\n`, 'utf8')
  console.log(`已写出 CSV：${resolve(out)}`)
}

console.log(JSON.stringify({
  file: source,
  lambda: result.lambda,
  peaks: result.peaks.map((peak) => ({
    twoTheta: +peak.twoTheta.toFixed(3),
    d: +peak.d.toFixed(5),
    intensity: +peak.intensity.toFixed(2),
  })),
}, null, 2))
