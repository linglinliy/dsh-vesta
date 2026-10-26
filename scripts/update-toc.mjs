#!/usr/bin/env node
/**
 * update-toc —— 给 README 与各分册生成/更新目录块（<!-- TOC --> … <!-- /TOC -->）。
 *
 *   node scripts/update-toc.mjs [--check] [--file docs/VASP.md]
 *
 * 默认处理 README.md 与 docs/ 下的 PROJECT/VIZ/VASP/VESTA/QUALITY。
 * --check 只检查是否过期（不写文件）：一致返回 0，否则返回 1。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const START = '<!-- TOC -->'
const END = '<!-- /TOC -->'

/** GitHub 风格的锚点：小写、去标点（保留下划线）、空格转连字符。 */
export function anchorOf(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

/** 从 Markdown 文本里取二级标题（忽略目录块内部）。 */
export function sectionsOf(text) {
  const withoutToc = text.replace(new RegExp(`${START}[\\s\\S]*?${END}`, 'g'), '')
  return withoutToc
    .split(/\r?\n/)
    .filter((line) => /^## /.test(line))
    .map((line) => line.slice(3).trim())
}

/** 生成目录块（折叠列表）。 */
export function buildToc(headings) {
  const items = headings.map((heading) => `- [${heading}](#${anchorOf(heading)})`).join('\n')
  return `${START}\n<details>\n<summary>目录（${headings.length} 节，点击展开）</summary>\n\n${items}\n\n</details>\n${END}`
}

/** 对单个文件应用目录更新；返回 { changed, headings }。 */
export function updateFile(path, { check = false } = {}) {
  const text = readFileSync(path, 'utf8')
  const headings = sectionsOf(text)
  const toc = buildToc(headings)
  let updated = text
  if (text.includes(START)) {
    updated = text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), toc)
  } else {
    const index = text.search(/^## /m)
    if (index < 0) return { changed: false, headings }
    updated = `${text.slice(0, index)}${toc}\n\n${text.slice(index)}`
  }
  const changed = updated !== text
  if (changed && !check) writeFileSync(path, updated, 'utf8')
  return { changed, headings }
}

const DEFAULT_FILES = [
  'README.md',
  'docs/PROJECT.md',
  'docs/VIZ.md',
  'docs/VASP.md',
  'docs/VESTA.md',
  'docs/QUALITY.md',
]

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const check = process.argv.includes('--check')
  const fileFlag = process.argv.indexOf('--file')
  const files = fileFlag >= 0 ? [process.argv[fileFlag + 1]] : DEFAULT_FILES
  let stale = 0
  for (const file of files) {
    const path = join(root, file)
    if (!existsSync(path)) {
      console.error(`跳过（不存在）：${file}`)
      continue
    }
    const { changed, headings } = updateFile(path, { check })
    if (check) {
      if (changed) {
        stale += 1
        console.error(`${file}：目录需要更新（${headings.length} 节）`)
      } else {
        console.log(`${file}：最新（${headings.length} 节）`)
      }
    } else {
      console.log(`${file}：${changed ? '已更新' : '无变化'}（${headings.length} 节）`)
    }
  }
  if (check && stale > 0) {
    console.error('运行 node scripts/update-toc.mjs 更新目录')
    process.exit(1)
  }
}
