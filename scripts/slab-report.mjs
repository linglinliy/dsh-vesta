#!/usr/bin/env node
/**
 * slab-report —— 批量分析板层/吸附体系：位点、吸附高度、最近距离、真空层厚度。
 *
 *   node scripts/slab-report.mjs --root <目录> [--adsorbate Na] [--substrate C] [--marker POSCAR]
 *                               [--adsorbate-height] [--out table.md|table.csv] [--depth 2]
 *
 * 每个任务目录读 POSCAR（或 CONTCAR），输出一行。默认同时写 Markdown 与 CSV。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { adsorbateHeight, adsorbateSite, layerProfile, parsePoscar } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const root = flag('root', '')
if (!root) {
  console.error('用法：node scripts/slab-report.mjs --root <目录> [--adsorbate Na] [--substrate C] [--out table.md]')
  process.exit(2)
}
const adsorbate = flag('adsorbate', 'Na')
const substrate = flag('substrate', 'C').split(',')
const marker = flag('marker', 'POSCAR')
const maxDepth = Number(flag('depth', '2'))
const outPath = flag('out', '') || join(resolve(root), 'slab-report.md')

/** 收集含 marker 文件的目录。 */
const dirs = []
const walk = (dir, depth) => {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  if (entries.some((entry) => entry.isFile() && entry.name === marker)) {
    dirs.push(dir)
    return
  }
  if (depth >= maxDepth) return
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) walk(join(dir, entry.name), depth + 1)
  }
}
walk(resolve(root), 0)

const rows = []
for (const dir of dirs) {
  const file = join(dir, marker)
  let structure
  try {
    structure = parsePoscar(readFileSync(file, 'utf8'), basename(dir))
  } catch (error) {
    rows.push({ name: basename(dir), note: `解析失败：${String(error.message).slice(0, 40)}` })
    continue
  }
  const counts = new Map()
  for (const atom of structure.atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1)
  const formula = [...counts.entries()].map(([symbol, count]) => `${symbol}${count}`).join('')
  const symbols = new Set(counts.keys())
  const profile = layerProfile(structure)
  const vacua = profile.layers.length > 1
    ? profile.layers.slice(1).map((layer, index) => layer.z - profile.layers[index].z)
    : [profile.axisLength]
  const vacuum = profile.layers.length > 1 ? profile.axisLength - profile.layers[profile.layers.length - 1].z + profile.layers[0].z : 0
  void vacua

  let site = '—'
  let height = null
  let nearest = null
  if (symbols.has(adsorbate) && substrate.some((symbol) => symbols.has(symbol))) {
    const siteResult = adsorbateSite(structure, { adsorbate, substrate })
    site = siteResult.sites[0]?.site ?? '—'
    const heightResult = adsorbateHeight(structure, { adsorbate, substrate })
    height = heightResult.mean
    nearest = siteResult.sites[0]?.distance ?? null
  }
  rows.push({
    name: basename(dir),
    formula,
    atoms: structure.atoms.length,
    site,
    height,
    nearest,
    vacuum: profile.layers.length > 1 ? vacuum : null,
    c: profile.axisLength,
  })
}

const cell = (value, digits) => (value === null || value === undefined ? '—' : Number(value).toFixed(digits))
const header = ['任务', '成分', '原子数', '位点', '吸附高度(Å)', '最近面内距离(Å)', '真空(Å)', 'c(Å)']
const table = rows.map((row) => [
  row.name,
  row.formula ?? '—',
  row.atoms ?? '—',
  row.site,
  cell(row.height, 3),
  cell(row.nearest, 3),
  cell(row.vacuum, 2),
  cell(row.c, 2),
  row.note ?? '',
])

const markdown = [
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...table.map((line) => `| ${line.slice(0, header.length).join(' | ')} |`),
].join('\n')
const csv = [header.join(','), ...table.map((line) => line.slice(0, header.length).join(','))].join('\n')

writeFileSync(resolve(outPath), `${markdown}\n`, 'utf8')
const csvPath = resolve(outPath.replace(/\.md$/, '.csv'))
writeFileSync(csvPath, `${csv}\n`, 'utf8')
console.log(`已写出 Markdown：${resolve(outPath)}`)
console.log(`已写出 CSV：${csvPath}`)

const withSite = rows.filter((row) => row.site !== '—')
const bySite = new Map()
for (const row of withSite) bySite.set(row.site, (bySite.get(row.site) ?? 0) + 1)
console.log(JSON.stringify({
  root: resolve(root),
  tasks: rows.length,
  withAdsorbate: withSite.length,
  sites: Object.fromEntries(bySite),
  out: outPath ? resolve(outPath) : null,
}, null, 2))
