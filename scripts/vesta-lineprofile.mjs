#!/usr/bin/env node
/**
 * vesta-lineprofile —— 沿线段对体积数据做等步长采样，并按 VESTA 手册 14.13 的格式输出文本。
 *
 *   node scripts/vesta-lineprofile.mjs <体积文件> --from "0,0,0" --to "0.25,0.25,0.25" \
 *        [--points 50] [--out profile.txt] [--html profile.html]
 *
 * 端点用分数坐标；距离列是笛卡尔距离（Å），与 VESTA 的输出列一致。
 */
import { writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { formatLineProfileText, lineProfile, readVolumeFile } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/vesta-lineprofile.mjs <体积文件> --from "x,y,z" --to "x,y,z" [--points 50] [--out file]')
  process.exit(2)
}

const parsePoint = (text) => {
  const parts = String(text).split(',').map(Number)
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(`端点格式应为 "x,y,z"（分数坐标），收到：${text}`)
  }
  return parts
}

const source = resolve(input)
const volume = readVolumeFile(source)
const start = parsePoint(flag('from', '0,0,0'))
const end = parsePoint(flag('to', '0.5,0.5,0.5'))
const points = Number(flag('points', '50'))

const profile = lineProfile(volume, start, end, { points })
const text = formatLineProfileText({
  title: `${volume.title ?? basename(source)}  line profile`,
  start,
  end,
  distances: profile.distances,
  values: profile.values,
})

const out = flag('out', '')
if (out) writeFileSync(resolve(out), text, 'utf8')

const maxIndex = profile.values.indexOf(Math.max(...profile.values))
const minIndex = profile.values.indexOf(Math.min(...profile.values))
console.log(`文件：${basename(source)}　单位 ${volume.unit ?? '?'}`)
console.log(`起点 ${start.join(',')} → 终点 ${end.join(',')}　线段长 ${profile.total.toFixed(5)} Å　${points} 点`)
console.log(`最大值 ${profile.values[maxIndex].toExponential(4)} @ ${profile.distances[maxIndex].toFixed(3)} Å`)
console.log(`最小值 ${profile.values[minIndex].toExponential(4)} @ ${profile.distances[minIndex].toFixed(3)} Å`)
console.log(`首尾值 ${profile.values[0].toExponential(4)} / ${profile.values[profile.values.length - 1].toExponential(4)}`)
if (out) console.log(`已写出：${resolve(out)}（VESTA 手册 14.13 的文本格式）`)
console.log(JSON.stringify({
  file: source, from: start, to: end, points, total: +profile.total.toFixed(5),
  max: { value: +profile.values[maxIndex].toFixed(6), distance: +profile.distances[maxIndex].toFixed(4) },
  min: { value: +profile.values[minIndex].toFixed(6), distance: +profile.distances[minIndex].toFixed(4) },
  out: out ? resolve(out) : null,
}, null, 2))
