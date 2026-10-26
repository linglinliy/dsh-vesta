#!/usr/bin/env node
/**
 * make-all —— 对一个根目录下的所有 VASP 任务批量出图，并生成索引页。
 *
 *   node scripts/make-all.mjs --root <任务根目录> --out <输出目录> [--repeat 2,2,2] [--depth 3]
 *
 * 每个任务生成：
 *   structure.html  POSCAR/CONTCAR → 三维结构（周期成键；有 CHGCAR 时同时叠等值面）
 *   dos.html        DOSCAR → DOS 曲线（自旋极化镜像）
 *   bands.html      EIGENVAL → 本征值/能带 + 带隙
 * 顶层写 index.html，按任务列出可用产物与关键数字。
 *
 * 实现上直接调用已有的三个生成脚本（子进程），不重复实现渲染逻辑。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanTasks } from '../core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const root = resolve(flag('root', ''))
if (!flag('root', '')) {
  console.error('用法：node scripts/make-all.mjs --root <任务根目录> --out <输出目录> [--repeat 2,2,2]')
  process.exit(2)
}
const outDir = resolve(flag('out', join(root, '_figures')))
const repeat = String(flag('repeat', '1,1,1'))
const depth = Number(flag('depth', '3'))
mkdirSync(outDir, { recursive: true })

const run = (script, scriptArgs) => {
  const result = spawnSync(process.execPath, [join(HERE, script), ...scriptArgs], { encoding: 'utf8' })
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' ') }
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout) }
  } catch {
    return { ok: false, error: '生成器输出无法解析' }
  }
}

const scan = await scanTasks(root, { maxDepth: depth })
const entries = []

for (const task of scan.tasks) {
  const dir = task.dir
  const name = basename(dir) || 'task'
  const target = join(outDir, name)
  mkdirSync(target, { recursive: true })
  const outputs = { name, dir, structure: null, dos: null, bands: null, conv: null, gap: null, electrons: null, error: null }

  const poscar = ['POSCAR', 'CONTCAR']
    .map((file) => join(dir, file))
    .find((file) => existsSync(file) && statSync(file).size > 0)

  const chgcar = ['CHGCAR', 'CHG']
    .map((file) => join(dir, file))
    .find((file) => existsSync(file) && statSync(file).size > 0)

  if (poscar) {
    const structureArgs = [poscar, '--repeat', repeat, '--out', join(target, 'structure.html')]
    if (chgcar) structureArgs.push('--vol', chgcar)
    const result = run('make-viewer-gl.mjs', structureArgs)
    if (result.ok) outputs.structure = join(target, 'structure.html')
    else outputs.error = result.error
  }

  const doscar = join(dir, 'DOSCAR')
  if (existsSync(doscar) && statSync(doscar).size > 0) {
    const result = run('make-dos.mjs', [doscar, '--out', join(target, 'dos.html')])
    if (result.ok) {
      outputs.dos = join(target, 'dos.html')
      outputs.electrons = result.data.integratedElectrons
    } else {
      outputs.error = outputs.error ?? result.error
    }
  }

  const oszicar = join(dir, 'OSZICAR')
  if (existsSync(oszicar) && statSync(oszicar).size > 0) {
    const result = run('make-conv.mjs', [oszicar, '--out', join(target, 'conv.html')])
    if (result.ok) outputs.conv = join(target, 'conv.html')
    else outputs.error = outputs.error ?? result.error
  }

  const eigenval = join(dir, 'EIGENVAL')
  if (existsSync(eigenval) && statSync(eigenval).size > 0) {
    const result = run('make-bands.mjs', [eigenval, '--out', join(target, 'bands.html')])
    if (result.ok) {
      outputs.bands = join(target, 'bands.html')
      outputs.gap = result.data.gap
    } else {
      outputs.error = outputs.error ?? result.error
    }
  }

  entries.push(outputs)
}

// 索引页
const rows = entries.map((entry) => {
  const link = (file, label) => (file ? `<a href="${basename(join(dirname(file), basename(file)))}/${basename(file)}">${label}</a>` : '—')
  const gap = entry.gap === null ? '—' : entry.gap.toFixed(3)
  return `<tr><td><code>${entry.name}</code></td><td>${link(entry.structure, '结构')}</td>`
    + `<td>${link(entry.dos, 'DOS')}</td><td>${link(entry.bands, '能带')}</td><td>${link(entry.conv, '收敛')}</td>`
    + `<td>${gap}</td><td>${entry.error ? escaped(entry.error) : ''}</td></tr>`
})

function escaped(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]))
}

const index = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8">
<title>VASP 任务图集 · ${escaped(basename(root))}</title>
<style>
  body { margin: 32px; font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #22262c; background: #f7f8fa; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .meta { color: #667; font-size: 13px; margin-bottom: 18px; }
  table { border-collapse: collapse; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.07); border-radius: 10px; overflow: hidden; }
  th, td { padding: 9px 14px; text-align: left; border-bottom: 1px solid #eef1f5; }
  th { background: #f2f5f9; font-weight: 600; font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  a { color: #2f6feb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: #eef2f7; padding: 1px 5px; border-radius: 4px; }
</style>
<h1>VASP 任务图集</h1>
<div class="meta">根目录 ${escaped(root)}　·　${entries.length} 个任务　·　扩胞 ${escaped(repeat)}　·　由 make-all 生成</div>
<table>
  <tr><th>任务</th><th>结构</th><th>DOS</th><th>能带</th><th>收敛</th><th>带隙 (eV)</th><th>备注</th></tr>
  ${rows.join('\n  ')}
</table>
</html>
`
writeFileSync(join(outDir, 'index.html'), index, 'utf8')

// 顺带导出体检汇总表（Markdown + CSV），方便贴进报告
const tables = []
for (const format of ['md', 'csv']) {
  const result = run('make-table.mjs', ['--root', root, '--format', format, '--out', join(outDir, `table.${format}`)])
  if (result.ok) tables.push(join(outDir, `table.${format}`))
  else console.error(`导出 table.${format} 失败：${result.error}`)
}

console.log(JSON.stringify({
  root,
  outDir,
  index: join(outDir, 'index.html'),
  tables,
  tasks: entries.map((entry) => ({
    name: entry.name,
    structure: entry.structure !== null,
    dos: entry.dos !== null,
    bands: entry.bands !== null,
    conv: entry.conv !== null,
    gap: entry.gap,
    electrons: entry.electrons,
    error: entry.error,
  })),
}, null, 2))
