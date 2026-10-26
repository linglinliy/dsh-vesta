#!/usr/bin/env node
/**
 * harvest-form-factors —— 借 VESTA 的 -calcf 输出，采集任意元素的 X 射线散射因子系数。
 *
 *   node scripts/harvest-form-factors.mjs Si C O Na ...
 *
 * 做法：为每个元素造一个最小立方 POSCAR（单原子），让 VESTA 跑 -calcf，
 * 从文本区读它打印的 a1..a5 / c / b1..b5，输出可直接粘进 core.js 的 JSON。
 * 系数与结构无关，只取决于元素。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { probeExecutable, readVestaText } from '../core.js'

installFriendlyErrors()

const elements = process.argv.slice(2)
if (elements.length === 0) {
  console.error('用法：node scripts/harvest-form-factors.mjs Si C O Na ...')
  process.exit(2)
}
const probe = probeExecutable({})
if (!probe.exists) {
  console.error(`找不到 VESTA：${probe.problem ?? probe.path}`)
  process.exit(2)
}

/** 从 VESTA 文本区里抽某个元素的系数行。 */
function parseCoefficients(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const start = lines.findIndex((line) => /Calculating structure factors/.test(line))
  if (start < 0) return null
  const block = lines.slice(start, start + 8)
  const first = block.find((line) => /\b[a-z0-9]+:\s+-?[\d.]+/.test(line) === false && /:\s+-?[\d.]+/.test(line))
  void first
  // 形如 "   Si:  5.275329   3.191038   ...   0.145073" 与下一行 b 值
  const elementLineIndex = block.findIndex((line) => /:\s+-?[\d.]+.*-?[\d.]/.test(line) && !/dispersion/i.test(line))
  if (elementLineIndex < 0) return null
  const elementName = /([A-Za-z]{1,2}):/.exec(block[elementLineIndex])?.[1]
  const numbers = []
  for (let index = elementLineIndex; index < elementLineIndex + 2 && index < block.length; index += 1) {
    const tokens = block[index].replace(/^.*?:\s*/, '').trim().split(/\s+/)
    for (const token of tokens) {
      const value = Number(token)
      if (Number.isFinite(value)) numbers.push(value)
    }
  }
  if (numbers.length < 12) return null
  return {
    element: elementName,
    a: numbers.slice(0, 5),
    c: numbers[5],
    b: numbers.slice(6, 11),
  }
}

const results = {}
for (const element of elements) {
  const work = mkdtempSync(join(tmpdir(), 'harvest-'))
  const poscar = ['cell', '3.0', '3 0 0', '0 3 0', '0 0 3', element, '1', 'Direct', '0 0 0'].join('\n')
  writeFileSync(join(work, 'POSCAR'), `${poscar}\n`, 'utf8')
  const child = spawn(probe.path, ['-open', 'POSCAR', '-calcf'], { cwd: work, stdio: 'ignore' })
  let text = null
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 600))
    try {
      text = await readVestaText(child.pid)
    } catch {
      text = null
    }
    if (text && /X-ray dispersion/.test(text)) break
  }
  try { process.kill(child.pid) } catch { /* 忽略 */ }
  const parsed = text ? parseCoefficients(text) : null
  if (parsed) {
    results[element] = { a: parsed.a, b: parsed.b, c: parsed.c }
    const f0 = parsed.a.reduce((sum, value) => sum + value, 0) + parsed.c
    console.log(`${element}: f0(0) = ${f0.toFixed(3)}`)
  } else {
    console.log(`${element}: 未采到系数`)
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 3 })
}

console.log('\n可直接粘贴的 JSON：')
console.log(JSON.stringify(results, null, 2))
