/**
 * 目录（TOC）防漂移：README 与各分册的目录都必须与各自的二级标题一致、锚点可解析。
 *   node --test test/docs-toc.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchorOf, buildToc, sectionsOf } from '../scripts/update-toc.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FILES = [
  'README.md',
  'docs/PROJECT.md',
  'docs/VIZ.md',
  'docs/VASP.md',
  'docs/VESTA.md',
  'docs/QUALITY.md',
]

test('每个文件的目录都与二级标题同步', () => {
  for (const file of FILES) {
    const text = readFileSync(`${ROOT}/${file}`, 'utf8')
    const headings = sectionsOf(text)
    assert.ok(headings.length >= 2, `${file} 的二级标题太少：${headings.length}`)
    const expected = buildToc(headings)
    const actual = /<!-- TOC -->[\s\S]*?<!-- \/TOC -->/.exec(text)?.[0]
    assert.ok(actual, `${file} 没有目录块`)
    assert.equal(actual, expected, `${file} 的目录已过期：运行 node scripts/update-toc.mjs`)
  }
})

test('目录里每一项都能找到对应锚点', () => {
  for (const file of FILES) {
    const text = readFileSync(`${ROOT}/${file}`, 'utf8')
    const anchors = new Set(sectionsOf(text).map(anchorOf))
    const links = [...text.matchAll(/^- \[([^\]]+)\]\(#([^)]+)\)$/gm)].map((match) => match[2])
    assert.ok(links.length >= 2, `${file} 目录项太少：${links.length}`)
    const broken = links.filter((anchor) => !anchors.has(anchor))
    assert.deepEqual(broken, [], `${file} 里这些锚点没有对应标题：${broken.join(', ')}`)
  }
})

test('anchorOf：中文标题保留、空格转连字符、下划线保留', () => {
  assert.equal(anchorOf('功函数（LOCPOT）'), '功函数locpot')
  assert.equal(anchorOf('工具入口：vesta_analyze'), '工具入口vesta_analyze')
  assert.equal(anchorOf('Why Win32'), 'why-win32')
})
