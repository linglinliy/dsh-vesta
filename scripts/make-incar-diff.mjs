#!/usr/bin/env node
/**
 * make-incar-diff —— 对比一个根目录下多个任务的 INCAR，标出不同的标签。
 *
 *   node scripts/make-incar-diff.mjs --root <根目录> [--out incar-diff.html]
 *
 * 输出：一张标签 × 任务 的表，取值不同的行整行高亮；顶部给出「差异标签」清单。
 * 只读，不改任何任务文件。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseIncar, scanTasks } from '../core.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const root = flag('root', '')
if (!root) {
  console.error('用法：node scripts/make-incar-diff.mjs --root <任务根目录> [--out incar-diff.html]')
  process.exit(2)
}
const absoluteRoot = resolve(root)
// 以 INCAR 作为任务标志：只有输入文件的目录（还没跑）也能对比
const scan = await scanTasks(absoluteRoot, { maxDepth: Number(flag('depth', '3')), marker: 'INCAR' })

const tasks = []
for (const task of scan.tasks) {
  const incar = join(task.dir, 'INCAR')
  if (!existsSync(incar)) continue
  tasks.push({ name: task.name, tags: parseIncar(readFileSync(incar, 'utf8')) })
}
if (tasks.length === 0) {
  console.error('没有找到任何 INCAR')
  process.exit(2)
}

// 所有出现过的标签（按字母序），并标出哪些标签在不同任务间不一致
const allTags = [...new Set(tasks.flatMap((task) => Object.keys(task.tags)))].sort()
const differing = allTags.filter((tag) => {
  const values = tasks.map((task) => task.tags[tag] ?? '—')
  return new Set(values).size > 1
})

const escape = (text) => String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]))

const header = tasks.map((task) => `<th>${escape(task.name)}</th>`).join('')
const rows = allTags.map((tag) => {
  const isDifferent = differing.includes(tag)
  const cells = tasks.map((task) => {
    const value = task.tags[tag] ?? '—'
    return `<td class="${value === '—' ? 'missing' : ''}">${escape(value)}</td>`
  }).join('')
  return `<tr class="${isDifferent ? 'diff' : ''}"><td class="tag">${escape(tag)}</td>${cells}</tr>`
}).join('\n    ')

const html = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8">
<title>INCAR 对比 · ${escape(basename(absoluteRoot))}</title>
<style>
  body { margin: 32px; font: 13px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #22262c; background: #f7f8fa; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #667; font-size: 12px; margin-bottom: 16px; }
  .diff-list { background: #fff7e6; border: 1px solid #f0d9a8; border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; font-size: 13px; overflow-wrap: anywhere; }
  .diff-list code { background: #fdf1d8; padding: 1px 5px; border-radius: 4px; margin-right: 4px; }
  table { border-collapse: collapse; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.07); border-radius: 10px; overflow: hidden; }
  th, td { padding: 7px 14px; text-align: left; border-bottom: 1px solid #eef1f5; }
  th { background: #f2f5f9; font-weight: 600; font-size: 12px; }
  td.tag { font-family: Consolas, monospace; color: #33465c; }
  td.missing { color: #b6bcc6; }
  tr.diff { background: #fff7e6; }
  tr.diff td.tag { font-weight: 700; color: #8a5a00; }
  tr:last-child td { border-bottom: none; }
</style>
<h1>INCAR 对比</h1>
<div class="meta">根目录 ${escape(absoluteRoot)}　·　${tasks.length} 个任务　·　${allTags.length} 个标签，其中 ${differing.length} 个不同</div>
${differing.length > 0
  ? `<div class="diff-list">差异标签：${differing.map((tag) => `<code>${escape(tag)}</code>`).join('')}</div>`
  : '<div class="diff-list">所有任务的 INCAR 完全一致。</div>'}
<table>
  <tr><th>标签</th>${header}</tr>
  ${rows}
</table>
</html>
`

const out = resolve(flag('out', join(absoluteRoot, 'incar-diff.html')))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  tasks: tasks.map((task) => task.name),
  tags: allTags.length,
  differing,
}, null, 2))
