#!/usr/bin/env node
/**
 * vesta-geometry —— 让 VESTA 自己列出几何参数（-list bond），并与我们的计算对照。
 *
 *   node scripts/vesta-geometry.mjs <结构文件> [--kind bond]
 *
 * 目前解析 bond；angle / poly 会原样打印 VESTA 的输出（格式尚未建模）。
 */
import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import {
  parsePoscar, parseVestaBondList, potcarElements, probeExecutable,
  readVestaText, shortestAtomDistance,
} from '../core.js'
import { spawn } from 'node:child_process'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const kind = (() => {
  const index = args.indexOf('--kind')
  return index >= 0 && args[index + 1] ? args[index + 1] : 'bond'
})()
if (!input) {
  console.error('用法：node scripts/vesta-geometry.mjs <结构文件> [--kind bond|angle|poly]')
  process.exit(2)
}

const source = resolve(input)
const probe = probeExecutable({})
if (!probe.exists) {
  console.error(`找不到 VESTA：${probe.problem ?? probe.path}`)
  process.exit(2)
}

// 我们自己的结构解析
const symbolsFile = join(source, '..', 'POTCAR')
let symbols
try {
  symbols = potcarElements(readFileSync(symbolsFile, 'utf8'))
} catch {
  symbols = undefined
}
const structure = parsePoscar(readFileSync(source, 'utf8'), basename(source), { symbols })
const ourShortest = shortestAtomDistance(structure)

// 让 VESTA 输出几何参数
const child = spawn(probe.path, ['-open', source, '-list', kind], {
  cwd: join(probe.path, '..'),
  stdio: 'ignore',
})
const pid = child.pid
let text = null
const deadline = Date.now() + 25000
while (Date.now() < deadline) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 700))
  try {
    text = await readVestaText(pid)
  } catch {
    text = null
  }
  if (text && text.includes('Bond:')) break
}
try { process.kill(pid) } catch { /* 可能已退出 */ }

if (!text) {
  console.error('没能读到 VESTA 文本区')
  process.exit(3)
}

if (kind === 'bond') {
  const parsed = parseVestaBondList(text)
  if (parsed.pairs.length === 0) {
    console.error('VESTA 没有列出任何键（文本区里没有 Bond: 行）')
    process.exit(3)
  }
  const shortest = Math.min(...parsed.pairs.map((item) => item.length))
  console.log(`VESTA 列出 ${parsed.pairs.length} 对键（原始条目 ${parsed.count} 条，含周期像）`)
  for (const item of parsed.pairs.slice(0, 8)) console.log(`  ${item.pair.padEnd(12)} ${item.length.toFixed(5)} Å`)
  console.log(`\n最短键长：VESTA ${shortest.toFixed(5)} Å　我们 ${ourShortest === null ? '—' : ourShortest.toFixed(5)} Å`)
  const delta = ourShortest === null ? null : Math.abs(shortest - ourShortest)
  console.log(delta !== null && delta < 1e-4
    ? '结论：与我们的最短原子间距一致。'
    : '结论：存在差异，需要检查键长计算或结构解析。')
  console.log(JSON.stringify({ file: source, kind, pairs: parsed.pairs, vestaShortest: shortest, oursShortest: ourShortest }, null, 2))
} else {
  console.log(text.slice(-1500))
}
