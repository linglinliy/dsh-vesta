#!/usr/bin/env node
/**
 * render-proof —— 无头渲染 POSCAR，用来验收「几何对不对」并给出可直接看的 PNG。
 *
 * 它和浏览器里的 HTML 查看器共用 viewer/scene.js 的投影数学，只是把图元画到
 * 自己写的位图上（不依赖 canvas / sharp / 浏览器）。
 *
 *   node scripts/render-proof.mjs <POSCAR> [--repeat 2,2,2] [--rx 20 --ry 30 --rz 0]
 *                                 [--zoom 1.6] [--out proof.png] [--width 900 --height 700]
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePoscar, buildSupercell, resolveTarget } from '../core.js'
import { readFileSync } from 'node:fs'
import { buildScene, projectScene } from '../viewer/scene.js'
import { installFriendlyErrors } from './_friendly-errors.mjs'

installFriendlyErrors()

// ── 极简 PNG 编码（RGBA8，无滤波）─────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 位图 ─────────────────────────────────────────────────────────────────
class Bitmap {
  constructor(width, height, background) {
    this.width = width
    this.height = height
    this.data = Buffer.alloc(width * height * 4)
    const hex = background.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    for (let i = 0; i < width * height; i += 1) {
      this.data[i * 4] = r
      this.data[i * 4 + 1] = g
      this.data[i * 4 + 2] = b
      this.data[i * 4 + 3] = 255
    }
  }

  blend(x, y, color, alpha) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const offset = (y * this.width + x) * 4
    const hex = color.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    this.data[offset] = Math.round(this.data[offset] * (1 - alpha) + r * alpha)
    this.data[offset + 1] = Math.round(this.data[offset + 1] * (1 - alpha) + g * alpha)
    this.data[offset + 2] = Math.round(this.data[offset + 2] * (1 - alpha) + b * alpha)
  }

  line(x1, y1, x2, y2, color, width) {
    const half = Math.max(width, 1) / 2
    const minX = Math.floor(Math.min(x1, x2) - half - 1)
    const maxX = Math.ceil(Math.max(x1, x2) + half + 1)
    const minY = Math.floor(Math.min(y1, y2) - half - 1)
    const maxY = Math.ceil(Math.max(y1, y2) + half + 1)
    const dx = x2 - x1
    const dy = y2 - y1
    const lengthSquared = dx * dx + dy * dy || 1
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared))
        const px = x1 + t * dx
        const py = y1 + t * dy
        const distance = Math.hypot(x - px, y - py)
        if (distance <= half) this.blend(x, y, color, distance > half - 1 ? 0.5 : 1)
      }
    }
  }

  disc(cx, cy, radius, color) {
    const minX = Math.floor(cx - radius - 1)
    const maxX = Math.ceil(cx + radius + 1)
    const minY = Math.floor(cy - radius - 1)
    const maxY = Math.ceil(cy + radius + 1)
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distance = Math.hypot(x - cx, y - cy)
        if (distance <= radius) this.blend(x, y, color, 1)
        else if (distance <= radius + 1) this.blend(x, y, color, 0.55)
      }
    }
  }
}

// ── 参数 ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/render-proof.mjs <POSCAR> [--repeat 2,2,2] [--rx 20] [--ry 30] [--zoom 1] [--out out.png]')
  process.exit(2)
}

const repeat = String(flag('repeat', '1,1,1')).split(/[x, ]+/).filter(Boolean).map(Number)
const width = Number(flag('width', '900'))
const height = Number(flag('height', '700'))
const view = {
  width,
  height,
  rx: Number(flag('rx', '18')),
  ry: Number(flag('ry', '28')),
  rz: Number(flag('rz', '0')),
  zoom: Number(flag('zoom', '1')),
  labels: flag('labels', 'on') !== 'off',
}

const target = resolveTarget(input, process.cwd())
const parsed = parsePoscar(readFileSync(target, 'utf8'), target.split(/[\\/]/).pop())
const structure = buildSupercell(parsed, repeat)
const scene = buildScene(structure)
const primitives = projectScene(scene, view)

const bitmap = new Bitmap(width, height, '#f7f8fa')
for (const line of primitives.lines.filter((item) => item.kind === 'cell')) {
  bitmap.line(line.x1, line.y1, line.x2, line.y2, line.color, line.width)
}
for (const line of primitives.lines.filter((item) => item.kind === 'bond')) {
  bitmap.line(line.x1, line.y1, line.x2, line.y2, line.color, line.width)
}
for (const circle of primitives.circles) {
  bitmap.disc(circle.x, circle.y, circle.r * 1.06, '#2a2f36')
  bitmap.disc(circle.x, circle.y, circle.r, circle.color)
}

const out = resolve(flag('out', 'proof.png'))
writeFileSync(out, encodePng(width, height, bitmap.data))
const cell = {
  a: Math.hypot(...structure.a1),
  b: Math.hypot(...structure.a2),
  c: Math.hypot(...structure.a3),
}
console.log(JSON.stringify({
  out,
  atoms: structure.atoms.length,
  bonds: scene.bonds.length,
  cellEdges: scene.cellEdges.length,
  view,
  cell: { a: +cell.a.toFixed(2), b: +cell.b.toFixed(2), c: +cell.c.toFixed(2) },
}, null, 2))
