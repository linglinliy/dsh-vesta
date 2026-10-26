#!/usr/bin/env node
/**
 * vesta-peaks —— 体积数据的峰搜索（VESTA 手册 14.14），输出与 VESTA 相似的文本。
 *
 *   node scripts/vesta-peaks.mjs <体积文件> [--max 20] [--threshold 0.1] [--out peaks.txt]
 *
 * 每个峰给出：分数坐标、峰高、积分电子数（最近的峰归属，即 Voronoi 的离散近似）、Voronoi 体积。
 * 各峰电子数之和应等于整胞积分——这是本工具自带的守恒检查。
 */
import { writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { formatPeakSearchText, peakSearch, readVolumeFile } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/vesta-peaks.mjs <体积文件> [--max 20] [--threshold 0.1] [--out peaks.txt]')
  process.exit(2)
}

const source = resolve(input)
const volume = readVolumeFile(source)
const options = {}
const max = Number(flag('max', '20'))
if (Number.isInteger(max) && max > 0) options.maxPeaks = max
const thresholdText = flag('threshold', '')
if (thresholdText !== '') options.threshold = Number(thresholdText)

const result = peakSearch(volume, options)
const text = formatPeakSearchText(result, {
  title: `${volume.title ?? basename(source)}  peak search`,
  voxelVolume: result.voxelVolume,
})

const out = flag('out', '')
if (out) writeFileSync(resolve(out), text, 'utf8')

const electronSum = result.peaks.reduce((sum, peak) => sum + peak.electrons, 0)
console.log(`文件：${basename(source)}　网格 ${volume.dims.join('×')}　单位 ${volume.unit ?? '?'}`)
console.log(`整胞积分 ${result.total.toFixed(4)}　峰数 ${result.peaks.length}　各峰电子之和 ${electronSum.toFixed(4)}`)
console.log(`守恒检查：总和与整胞积分相差 ${Math.abs(electronSum - result.total).toExponential(2)}`)
const header = '    #         x         y         z     Peak value     Integrated         Volume'
console.log(header)
for (const [index, peak] of result.peaks.entries()) {
  console.log(
    `${String(index + 1).padStart(5)}`
    + `${peak.frac[0].toFixed(5).padStart(10)}`
    + `${peak.frac[1].toFixed(5).padStart(10)}`
    + `${peak.frac[2].toFixed(5).padStart(10)}`
    + `${peak.value.toExponential(3).padStart(15)}`
    + `${peak.electrons.toExponential(3).padStart(15)}`
    + `${(peak.voxels * result.voxelVolume).toExponential(3).padStart(15)}`,
  )
}
if (out) console.log(`\n已写出：${resolve(out)}（VESTA 手册 14.14 的版式）`)
console.log(JSON.stringify({
  file: source,
  total: +result.total.toFixed(6),
  peakCount: result.peaks.length,
  voxelVolume: result.voxelVolume,
  peaks: result.peaks.map((peak) => ({
    frac: peak.frac.map((value) => +value.toFixed(5)),
    value: +peak.value.toFixed(6),
    electrons: +peak.electrons.toFixed(6),
    voxels: peak.voxels,
  })),
  out: out ? resolve(out) : null,
}, null, 2))
