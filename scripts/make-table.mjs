#!/usr/bin/env node
/**
 * make-table —— 把一个根目录下多个任务的体检结果导成表格（Markdown 或 CSV）。
 *
 *   node scripts/make-table.mjs --root <根目录> [--format md|csv] [--out table.md]
 *
 * 列：任务、E(sigma→0)、E/atom、E-fermi、带隙、直接/间接、ENCUT、ENCUT/ENMAX、k 网格、真空层、最大力、失败项。
 * 只读；不写任何任务文件（除非显式给 --out）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { inspectTask, scanTasks, parsePoscar, potcarElements, slabVacuum } from '../core.js'
import { existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const root = flag('root', '')
if (!root) {
  console.error('用法：node scripts/make-table.mjs --root <任务根目录> [--format md|csv] [--out table.md]')
  process.exit(2)
}
const format = String(flag('format', 'md')).toLowerCase() === 'csv' ? 'csv' : 'md'
const absoluteRoot = resolve(root)
const scan = await scanTasks(absoluteRoot, { maxDepth: Number(flag('depth', '3')) })

const rows = []
for (const task of scan.tasks) {
  let report = null
  try {
    report = await inspectTask(task.dir)
  } catch {
    report = null
  }
  let natoms = report?.eigenval?.natoms ?? null
  let vacuum = null
  if (existsSync(join(task.dir, 'POSCAR'))) {
    try {
      const symbols = existsSync(join(task.dir, 'POTCAR'))
        ? potcarElements(readFileSync(join(task.dir, 'POTCAR'), 'utf8'))
        : undefined
      const structure = parsePoscar(readFileSync(join(task.dir, 'POSCAR'), 'utf8'), 'POSCAR', { symbols })
      natoms = natoms ?? structure.atoms.length
      const geometry = slabVacuum(structure)
      if (geometry.slabLike) vacuum = geometry.vacuum
    } catch {
      // 结构读不了就不填这两列
    }
  }
  const encut = report?.incar?.ENCUT ? Number(report.incar.ENCUT) : report?.outcar?.encut ?? null
  const enmax = report?.potcar?.enmax ?? null
  const gap = report?.eigenval?.gap ?? null
  const energy = report?.outcar?.sigma0 ?? null
  const failed = report ? report.checks.filter((check) => !check.ok).map((check) => check.name) : ['体检失败']
  rows.push({
    name: task.name,
    energy,
    perAtom: energy !== null && natoms ? energy / natoms : null,
    efermi: report?.outcar?.efermi ?? null,
    gap,
    type: gap === null ? '' : (report.eigenval.direct ? '直接' : '间接'),
    encut,
    ratio: encut !== null && enmax ? encut / enmax : null,
    kmesh: report?.kpoints?.mesh ? report.kpoints.mesh.join('×') : '',
    vacuum,
    maxForce: report?.outcar?.maxForce ?? null,
    failed,
  })
}

const number = (value, digits) => (value === null || value === undefined ? '' : value.toFixed(digits))
const header = ['任务', 'E (eV)', 'E/atom (eV)', 'E-fermi (eV)', '带隙 (eV)', '类型', 'ENCUT', 'ENCUT/ENMAX', 'k 网格', '真空层 (Å)', '最大力 (eV/Å)', '未通过项']
const cells = (row) => [
  row.name,
  number(row.energy, 4),
  number(row.perAtom, 3),
  number(row.efermi, 4),
  number(row.gap, 3),
  row.type,
  row.encut === null ? '' : String(row.encut),
  row.ratio === null ? '' : row.ratio.toFixed(2),
  row.kmesh,
  number(row.vacuum, 2),
  row.maxForce === null || row.maxForce === undefined ? '' : row.maxForce.toExponential(1),
  row.failed.join('；'),
]

let output
if (format === 'csv') {
  const quote = (text) => (/[",\n]/.test(String(text)) ? `"${String(text).replace(/"/g, '""')}"` : String(text))
  output = [header, ...rows.map(cells)].map((line) => line.map(quote).join(',')).join('\n') + '\n'
} else {
  const head = `| ${header.join(' | ')} |`
  const divider = `| ${header.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${cells(row).join(' | ')} |`).join('\n')
  output = `${head}\n${divider}\n${body}\n`
}

const out = flag('out', '')
if (out) {
  const target = resolve(out)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, output, 'utf8')
  console.log(JSON.stringify({ out: target, format, tasks: rows.length }, null, 2))
} else {
  console.log(output)
  // 供工具层解析：不写文件时 out 为 null
  console.log(JSON.stringify({ out: null, format, tasks: rows.length }, null, 2))
}
