#!/usr/bin/env node
/**
 * vesta-crosscheck —— 用 VESTA 自己导出的文本体积数据，逐点校验我们的体积解析。
 *
 *   node scripts/vesta-crosscheck.mjs <CHGCAR|CHG|PARCHG>
 *
 * 做法：让 VESTA 打开该文件并 `-save` 成 *.3ed（文本、bohr⁻³、z 最快），
 * 再与我们 `readVolumeFile` 的结果逐点比较。最大偏差很小（≲1e-6）说明两边读法一致。
 * 仅对电子密度类文件有意义（单位 e/Å³）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { BOHR3_TO_A3, convertWithVesta, parseVestaVolumeText, readVolumeFile } from '../core.js'

installFriendlyErrors()

const input = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
if (!input) {
  console.error('用法：node scripts/vesta-crosscheck.mjs <CHGCAR|CHG|PARCHG>')
  process.exit(2)
}

const source = resolve(input)
const ours = readVolumeFile(source)
if (!/e\/Å³/.test(ours.unit ?? '')) {
  console.error(`只对电子密度文件有意义（当前单位：${ours.unit ?? '未知'}）`)
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'vesta-crosscheck-'))
const textPath = join(work, `${basename(source)}.3ed`)

try {
  await convertWithVesta({}, source, textPath)
  if (!existsSync(textPath)) throw new Error('VESTA 没有写出文本体积文件')
  const theirs = parseVestaVolumeText(readFileSync(textPath, 'utf8'))
  const [nx, ny, nz] = ours.dims
  const [vx, vy, vz] = theirs.dims
  // VESTA：z 最快；我们：x 最快
  const ourValue = (i, j, k) => ours.values[(k * ny + j) * nx + i]
  const theirValue = (i, j, k) => theirs.values[i * (vy * vz) + j * vz + k] * BOHR3_TO_A3

  let maxDiff = 0
  let maxAt = [0, 0, 0]
  let samples = 0
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const diff = Math.abs(ourValue(i, j, k) - theirValue(i, j, k))
        samples += 1
        if (diff > maxDiff) { maxDiff = diff; maxAt = [i, j, k] }
      }
    }
  }
  const sameGrid = nx + 1 === vx && ny + 1 === vy && nz + 1 === vz
  console.log(`网格：我们 ${ours.dims.join('×')}　VESTA ${theirs.dims.join('×')}（差 1 是 VESTA 的周期冗余面）`)
  console.log(`比较点数：${samples}　最大偏差：${maxDiff.toExponential(2)} e/Å³（在 ${maxAt.join(',')}）`)
  console.log(maxDiff < 1e-6
    ? '结论：两边读出的数组一致，解析正确。'
    : '结论：存在偏差，需检查网格顺序或单位换算。')
  console.log(JSON.stringify({ file: source, ours: ours.dims, vesta: theirs.dims, samples, maxDiff, sameGrid }, null, 2))
} finally {
  rmSync(work, { recursive: true, force: true })
}
