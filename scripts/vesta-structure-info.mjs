#!/usr/bin/env node
/**
 * vesta-structure-info —— 让 VESTA 自己报告结构摘要（空间群、a/b/c、α/β/γ、体积），
 * 再与我们的 POSCAR 解析逐项对照。
 *
 *   node scripts/vesta-structure-info.mjs <结构文件>
 *
 * 需要本机安装 VESTA；会临时打开一个 VESTA 窗口，读完文本区后关闭进程。
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import {
  cellParameters, launch, parsePoscar, potcarElements, probeExecutable,
  readVestaStructureSummary,
} from '../core.js'

installFriendlyErrors()

const input = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
if (!input) {
  console.error('用法：node scripts/vesta-structure-info.mjs <结构文件>')
  process.exit(2)
}
const source = resolve(input)
const probe = probeExecutable({})
if (!probe.exists) {
  console.error(`找不到 VESTA：${probe.problem ?? probe.path}`)
  process.exit(2)
}

// 我们自己的解析结果
const potcarPath = join(dirname(source), 'POTCAR')
const symbols = existsSync(potcarPath) ? potcarElements(readFileSync(potcarPath, 'utf8')) : undefined
const ours = parsePoscar(readFileSync(source, 'utf8'), basename(source), { symbols })
const ourParams = cellParameters([ours.a1, ours.a2, ours.a3])

const pid = await launch(probe.path, source)
let theirs = null
if (pid) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline && !theirs) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 600))
    try {
      theirs = await readVestaStructureSummary(pid)
    } catch {
      theirs = null
    }
  }
}
try {
  if (pid) process.kill(pid)
} catch {
  // 进程可能已退出
}

if (!theirs) {
  console.error('没能从 VESTA 文本区读到结构摘要（窗口未出现或读取失败）')
  process.exit(3)
}

const rows = [
  ['a (Å)', (t) => t.a, ourParams.a],
  ['b (Å)', (t) => t.b, ourParams.b],
  ['c (Å)', (t) => t.c, ourParams.c],
  ['α (°)', (t) => t.alpha, ourParams.alpha],
  ['β (°)', (t) => t.beta, ourParams.beta],
  ['γ (°)', (t) => t.gamma, ourParams.gamma],
  ['V (Å³)', (t) => t.volume, ourParams.volume],
].map(([label, pick, mine]) => {
  const value = pick(theirs)
  return { label, vesta: value, ours: mine, delta: value === null ? null : Math.abs(value - mine) }
})

console.log(`文件：${basename(source)}`)
console.log(`VESTA 报告：空间群 ${theirs.spaceGroup ?? '?'}（#${theirs.spaceGroupNumber ?? '?'}）`)
for (const row of rows) {
  const delta = row.delta === null ? '—' : row.delta.toExponential(2)
  console.log(`  ${row.label.padEnd(8)} VESTA ${String(row.vesta).padStart(10)}   我们 ${row.ours.toFixed(6).padStart(12)}   差 ${delta}`)
}
const worst = Math.max(...rows.filter((row) => row.delta !== null).map((row) => row.delta))
console.log(worst < 1e-3
  ? '结论：晶胞参数与体积一致（差在 VESTA 显示位数之内）。'
  : '结论：存在明显差异，需要检查解析。')
console.log(JSON.stringify({ file: source, vesta: theirs, ours: ourParams, worstDelta: worst }, null, 2))
