#!/usr/bin/env node
/**
 * poscar2view —— 把 POSCAR/CONTCAR 转成三维面板能看的 PDB/mmCIF，可扩胞。
 *
 * 独立脚本（不是插件工具）的好处：每次都是新进程，读的是磁盘上最新的解析代码，
 * 不受 DSH 里插件模块缓存的影响。插件里的 `vesta_view` 工具做的是同一件事。
 *
 *   node scripts/poscar2view.mjs <POSCAR 文件或目录> [--repeat 2,2,2] [--out 目录]
 *
 * 输出：PDB 与 CIF 的绝对路径（每行一个），随后把 PDB 交给 sci_viz_structure 即可。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportStructureForViewer, resolveTarget } from '../core.js'
import { installFriendlyErrors } from './_friendly-errors.mjs'

installFriendlyErrors()

const args = process.argv.slice(2)
if (args.length === 0 || args[0].startsWith('--')) {
  console.error('用法：node scripts/poscar2view.mjs <POSCAR 文件或目录> [--repeat 2,2,2] [--out 目录]')
  process.exit(2)
}

let repeat = [1, 1, 1]
let outDir
const inputs = []
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--repeat') {
    repeat = String(args[(i += 1)] ?? '').split(/[x, ]+/).filter(Boolean).map(Number)
  } else if (arg === '--out') {
    outDir = args[(i += 1)]
  } else {
    inputs.push(arg)
  }
}

const base = process.cwd()
for (const input of inputs) {
  const target = resolveTarget(input, base)
  const result = exportStructureForViewer(target, { repeat, outDir })
  const cell = result.cell
  console.log(`# ${result.formula}  ${result.atoms} 原子  ${result.repeat.join('×')}  晶胞 a=${cell.a.toFixed(2)} b=${cell.b.toFixed(2)} c=${cell.c.toFixed(2)} Å  α=${cell.alpha.toFixed(1)} β=${cell.beta.toFixed(1)} γ=${cell.gamma.toFixed(1)}`)
  console.log(result.pdb)
  console.log(result.cif)
}

void readFileSync
void dirname
void join
void resolve
void fileURLToPath
