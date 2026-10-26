/**
 * 第三批冒烟：轨迹播放器（合成 XDATCAR）与 VESTA 高清导出（需要本机 VESTA）。
 *   node --test test/tools-smoke3.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { DEFAULT_EXECUTABLE } from '../core.js'

const loadTools = () => {
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    effect: (factory) => { factory() },
  }
  apply(ctx, {})
  return tools
}

/** 造一个 3 帧的 XDATCAR：两个 Si 原子沿 z 靠近。 */
const writeXdatcar = () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-traj-'))
  const lines = [
    'Si relaxation',
    '1.0',
    '5.5 0 0',
    '0 5.5 0',
    '0 0 20',
    'Si',
    '2',
  ]
  const zFrames = [0.25, 0.26, 0.27]
  for (const [index, z] of zFrames.entries()) {
    lines.push(`Direct configuration= ${index + 1}`)
    lines.push('0.0 0.0 0.0')
    lines.push(`0.0 0.0 ${z}`)
  }
  const file = join(dir, 'XDATCAR')
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  return { dir, file }
}

test('vasp_trajectory：合成 3 帧轨迹 → 生成播放器 HTML', async () => {
  const tools = loadTools()
  const { file } = writeXdatcar()
  const result = await tools.get('vasp_trajectory').execute({ path: file }, {})
  assert.equal(result.ok, true)
  assert.equal(result.frames, 3)
  assert.ok(existsSync(result.path), `产物不存在：${result.path}`)
  assert.ok(statSync(result.path).size > 5000, 'HTML 太小，可能没写进去')
})

test('vasp_trajectory：路径不存在时给出明确错误', async () => {
  const tools = loadTools()
  await assert.rejects(
    () => tools.get('vasp_trajectory').execute({ path: 'D:/no/such/XDATCAR' }, {}),
    /不存在|找不到/,
  )
})

const hasVesta = existsSync(DEFAULT_EXECUTABLE)
test('vesta_capture：path 模式走 CLI 高清导出', { skip: !hasVesta && '本机没有 VESTA' }, async () => {
  const tools = loadTools()
  const dir = mkdtempSync(join(tmpdir(), 'vesta-cap-'))
  const poscar = join(dir, 'POSCAR')
  writeFileSync(poscar, [
    'Si', '5.5',
    '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0',
    'Si', '2', 'Direct',
    '0 0 0', '0.25 0.25 0.25',
  ].join('\n'), 'utf8')
  const out = join(dir, 'export.png')
  const result = await tools.get('vesta_capture').execute({ path: poscar, scale: 2, out }, {})
  assert.equal(result.ok, true)
  assert.ok(existsSync(out), `导出文件不存在：${out}`)
  assert.ok(statSync(out).size > 10_000, `PNG 太小：${statSync(out).size} 字节`)
  assert.match(result.summary, /导出|export|PNG/i)
})
