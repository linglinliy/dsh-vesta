#!/usr/bin/env node
/**
 * vesta-calcf —— 让 VESTA 计算 X 射线结构因子，并解析它写出的表。
 *
 *   node scripts/vesta-calcf.mjs <结构文件> [--keep]
 *
 * 两个坑（都已处理）：
 *   1. VESTA 把结果写成 `<标题>.txt`（用 POSCAR 第一行做文件名），放在**当前工作目录**；
 *   2. 路径里含点（如 `.tmp`、`5.5`）时它会把路径截断导致写不出文件。
 * 因此这里把输入复制到无点的临时目录、以该目录为 cwd 运行，再按修改时间找产物。
 */
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parseVestaStructureFactors, potcarElements, probeExecutable } from '../core.js'

installFriendlyErrors()

/** 删除临时目录：VESTA 刚被杀时可能仍占用句柄，重试几次；最终失败也不影响结果。 */
async function cleanup(dir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
    }
  }
}

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const keep = args.includes('--keep')
if (!input) {
  console.error('用法：node scripts/vesta-calcf.mjs <结构文件> [--keep]')
  process.exit(2)
}

const probe = probeExecutable({})
if (!probe.exists) {
  console.error(`找不到 VESTA：${probe.problem ?? probe.path}`)
  process.exit(2)
}

// 无点的临时目录（VESTA 在含点的路径下会截断输出路径）
const work = mkdtempSync(join(tmpdir(), 'calcfwork-'))
const base = basename(input)
const target = join(work, base)
// VESTA 用 POSCAR 第一行当输出文件名，标题里不能有路径分隔符；顺便补 VASP4 缺失的元素行
let poscarText = readFileSync(input, 'utf8')
const lines = poscarText.split(/\r?\n/)
const firstDataTokens = (lines[5] ?? '').trim().split(/\s+/)
const isVasp4 = firstDataTokens.length > 0 && firstDataTokens.every((token) => /^\d+$/.test(token))
if (isVasp4) {
  const potcarPath = join(dirname(input), 'POTCAR')
  if (existsSync(potcarPath)) {
    const symbols = potcarElements(readFileSync(potcarPath, 'utf8'))
    if (symbols.length === firstDataTokens.length) {
      lines.splice(5, 0, symbols.join(' '))
      poscarText = lines.join('\n')
    }
  }
}
if (!poscarText.includes('\n')) throw new Error('POSCAR 内容为空')
writeFileSync(target, poscarText, 'utf8')
// 标题统一成 cell，输出文件名即 cell.txt
const titleLines = poscarText.split(/\n/)
titleLines[0] = 'cell'
writeFileSync(target, titleLines.join('\n'), 'utf8')

const child = spawn(probe.path, ['-open', base, '-calcf'], { cwd: work, stdio: 'ignore' })
const started = Date.now()
let output = null
while (Date.now() - started < 30000) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  const files = readdirSync(work).filter((name) => name.toLowerCase().endsWith('.txt'))
  if (files.length > 0) {
    const candidate = join(work, files[0])
    if (statSync(candidate).size > 100) {
      output = candidate
      break
    }
  }
}
try {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
} catch {
  try { process.kill(child.pid) } catch { /* 可能已退出 */ }
}

if (!output || !existsSync(output)) {
  console.error('VESTA 没有写出结构因子文件（30 s 超时）')
  if (keep) console.error(`临时目录保留在：${work}`)
  else await cleanup(work)
  process.exit(3)
}

const parsed = parseVestaStructureFactors(readFileSync(output, 'latin1'))
const sorted = [...parsed.reflections].sort((a, b) => b.abs - a.abs)
const dMin = Math.min(...parsed.reflections.map((item) => item.d))
const dMax = Math.max(...parsed.reflections.map((item) => item.d))
console.log(`结构因子：${parsed.count} 条反射　d 范围 ${dMin.toFixed(4)} → ${dMax.toFixed(4)} Å`)
console.log('最强的 5 条：')
for (const item of sorted.slice(0, 5)) {
  console.log(`  (${item.h} ${item.k} ${item.l})　d = ${item.d.toFixed(4)} Å　|F| = ${item.abs.toFixed(3)}　I = ${item.intensity?.toFixed(2) ?? '—'}`)
}
console.log(JSON.stringify({
  file: input,
  output: keep ? output : null,
  count: parsed.count,
  dRange: [dMin, dMax],
  strongest: sorted.slice(0, 10).map((item) => ({ hkl: [item.h, item.k, item.l], d: item.d, abs: item.abs })),
}, null, 2))

if (keep) console.log(`\n产物保留在：${work}`)
else await cleanup(work)
