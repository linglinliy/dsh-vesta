#!/usr/bin/env node
/**
 * vesta-convert —— 用 VESTA 的官方命令行（-open / -save）做结构格式转换。
 *
 *   node scripts/vesta-convert.mjs <源文件> <目标文件>
 *
 * 目标扩展名决定格式（.cif / .vasp / .pdb / .xyz …），由 VESTA 自己识别。
 * 需要本机安装 VESTA（默认 <VESTA 安装目录>/VESTA.exe，可用 VESTA_EXE 覆盖）。
 */
import { resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { convertWithVesta } from '../core.js'

installFriendlyErrors()

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('用法：node scripts/vesta-convert.mjs <源文件> <目标文件>')
  process.exit(2)
}

const config = {}
const result = await convertWithVesta(config, resolve(input), resolve(output))
console.log(JSON.stringify({ ...result, bytes: result.bytes }, null, 2))
