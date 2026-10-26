#!/usr/bin/env node
/**
 * check-volume —— 体积文件体检：量程、积分、密度峰位置与最近原子距离（含周期性）。
 *
 *   node scripts/check-volume.mjs <CHGCAR|CUBE|ELFCAR|LOCPOT>
 *
 * 用来回答「密度峰是否落在原子上」。若峰离最近原子很远，通常意味着体积文件与结构不匹配
 * （例如 CHGCAR 来自另一次计算），此时不要继续用它做等值面/截面结论。
 */
import { basename, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { readVolumeFile, volumeDiagnostics } from '../core.js'

installFriendlyErrors()

const input = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
if (!input) {
  console.error('用法：node scripts/check-volume.mjs <CHGCAR|CUBE|ELFCAR|LOCPOT>')
  process.exit(2)
}

const source = resolve(input)
const volume = readVolumeFile(source)
const report = volumeDiagnostics(volume)

console.log(`文件：${basename(source)}　网格 ${report.dims.join('×')}　单位 ${report.unit ?? '?'}`)
console.log(`量程：${report.min.toFixed(5)} → ${report.max.toFixed(5)}　均值 ${report.mean.toFixed(5)}`)
if (report.integral !== null) console.log(`积分：${report.integral.toFixed(3)}（电荷密度应等于 NELECT）`)
console.log(`密度峰：分数坐标 ${report.peakFrac.map((value) => value.toFixed(3)).join(', ')}　值 ${report.peakValue.toFixed(5)}`)
if (report.nearest) {
  console.log(`最近原子：${report.nearest.symbol} 距峰 ${report.nearest.distance.toFixed(3)} Å`)
  console.log(`各原子处的取值：${report.atoms.map((atom) =>
    `${atom.symbol}@(${atom.frac.map((value) => value.toFixed(2)).join(',')}) = ${atom.value.toFixed(4)}`).join('；')}`)
  const suspicious = report.nearest.distance > 0.5
  console.log(suspicious
    ? '结论：峰位离原子较远（> 0.5 Å），建议确认体积文件与结构是否来自同一次计算。'
    : '结论：峰位落在原子附近，体积文件与结构一致。')
}

console.log(JSON.stringify({
  file: source,
  dims: report.dims,
  unit: report.unit ?? null,
  min: +report.min.toFixed(6),
  max: +report.max.toFixed(6),
  mean: +report.mean.toFixed(6),
  integral: report.integral === null ? null : +report.integral.toFixed(4),
  peakFrac: report.peakFrac,
  nearestDistance: report.nearest ? +report.nearest.distance.toFixed(4) : null,
}, null, 2))
