#!/usr/bin/env node
/**
 * check-structure —— 跑 VASP 之前的结构预检（可对单个文件或整个目录批量）。
 *
 *   node scripts/check-structure.mjs <结构文件 | 任务根目录> [--marker POSCAR] [--min-distance 0.5]
 *
 * 检查：晶胞体积/角度、原子数、坐标越界、原子重合、过近原子。
 * 有 error 时退出码为 1，便于接进流水线。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parsePoscar, potcarElements, structureHealth } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/check-structure.mjs <结构文件 | 任务根目录> [--marker POSCAR] [--min-distance 0.5]')
  process.exit(2)
}

const marker = flag('marker', 'POSCAR')
const minDistance = Number(flag('min-distance', '0.5'))
const source = resolve(input)

/** 收集要检查的结构文件。 */
const files = []
if (statSync(source).isFile()) {
  files.push(source)
} else {
  const walk = (dir, depth) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const hit = entries.find((entry) => entry.isFile() && (entry.name === marker || entry.name === `${marker}.vasp`))
    if (hit) {
      files.push(join(dir, hit.name))
      return
    }
    if (depth >= 3) return
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) walk(join(dir, entry.name), depth + 1)
    }
  }
  walk(source, 0)
}

if (files.length === 0) {
  console.error(`没有找到任何 ${marker} 文件`)
  process.exit(2)
}

const rows = []
let errors = 0
for (const file of files) {
  const potcarPath = join(dirname(file), 'POTCAR')
  const symbols = existsSync(potcarPath) ? potcarElements(readFileSync(potcarPath, 'utf8')) : undefined
  let health
  try {
    const structure = parsePoscar(readFileSync(file, 'utf8'), basename(file), { symbols })
    health = structureHealth(structure, { minDistance })
  } catch (error) {
    health = { ok: false, issues: [{ level: 'error', message: `解析失败：${String(error.message).slice(0, 60)}` }], atoms: 0, formula: '—', cellVolume: 0, minDistance: null }
  }
  if (!health.ok) errors += 1
  rows.push({ file, health })
}

const label = (file) => file.slice(source.length).replace(/^[\\/]/, '') || basename(file)
console.log(`检查 ${files.length} 个结构：${files.length - errors} 个通过，${errors} 个有 error`)
for (const { file, health } of rows) {
  const tag = health.ok ? (health.issues.length > 0 ? '⚠' : '✔') : '✖'
  console.log(`${tag} ${label(file)}　${health.formula}　${health.atoms} 原子　V=${health.cellVolume.toFixed(2)} Å³`
    + (health.minDistance === null ? '' : `　最近原子 ${health.minDistance.toFixed(3)} Å`))
  for (const issue of health.issues) console.log(`    ${issue.level === 'error' ? '错误' : '提示'}：${issue.message}`)
}

console.log(JSON.stringify({
  root: source,
  files: files.length,
  errors,
  problems: rows.filter((row) => row.health.issues.length > 0).map((row) => ({
    file: label(row.file),
    issues: row.health.issues.map((issue) => issue.message),
  })),
}, null, 2))
process.exit(errors > 0 ? 1 : 0)
