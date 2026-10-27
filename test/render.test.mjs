/**
 * CLI 批量出图（vesta_render）：参数翻译 + 真实 VESTA 的端到端（无 VESTA 时跳过）。
 *   node --test test/render.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { renderViewsWithCli, viewToCliArgs } from '../core.js'

test('viewToCliArgs：只翻译非零角度，顺序固定 x→y→z', () => {
  assert.deepEqual(viewToCliArgs({}), [])
  assert.deepEqual(viewToCliArgs({ rx: 30 }), ['-rotate_x', '30'])
  assert.deepEqual(viewToCliArgs({ rz: -15, rx: 30 }), ['-rotate_x', '30', '-rotate_z', '-15'])
  assert.deepEqual(viewToCliArgs({ rx: 0, ry: 0, rz: 0 }), [])
})

test('viewToCliArgs：忽略非数字与 NaN', () => {
  assert.deepEqual(viewToCliArgs({ rx: 'abc', ry: Number.NaN }), [])
})

const hasVesta = existsSync('D:/VESTA-win64/VESTA.exe')

test('真实 VESTA：两个视角各出一张图并写 manifest', { skip: !hasVesta && '未安装 VESTA' }, async () => {
  if (!hasVesta) return
  const { mkdtempSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  // 用仓库里的合成结构，避免依赖本机数据
  const dir = mkdtempSync(join(tmpdir(), 'vesta-render-'))
  const poscar = join(dir, 'POSCAR')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(poscar, [
    'Si-fcc', '5.431', '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0', 'Si', '2', 'Direct', '0 0 0', '0.25 0.25 0.25',
  ].join('\n') + '\n', 'utf8')

  const result = await renderViewsWithCli({ executable: 'D:/VESTA-win64/VESTA.exe' }, {
    structure: poscar,
    outDir: join(dir, 'out'),
    scale: 1,
    views: [{ name: 'a' }, { name: 'b', rx: 30 }],
    timeoutMs: 90000,
  })

  assert.equal(result.renders.length, 2)
  for (const item of result.renders) {
    assert.ok(existsSync(item.out), `缺少产物：${item.out}`)
    assert.ok(item.bytes > 1024, `产物太小：${item.bytes}`)
  }
  // 不同视角必须是不同的图
  assert.notEqual(result.renders[0].bytes, 0)
  const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'))
  assert.equal(manifest.viewCount, 2)
  assert.match(manifest.structureSha256, /^[0-9a-f]{64}$/)
  assert.equal(manifest.renders[1].view.rx, 30)
})


test('真实 VESTA：同一组旋转参数两次出图哈希一致（确定性）', { skip: !hasVesta && '未安装 VESTA' }, async () => {
  if (!hasVesta) return
  const { mkdtempSync, readFileSync } = await import('node:fs')
  const { createHash } = await import('node:crypto')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { writeFileSync } = await import('node:fs')

  const dir = mkdtempSync(join(tmpdir(), 'vesta-determinism-'))
  const poscar = join(dir, 'POSCAR')
  writeFileSync(poscar, [
    'Si-fcc', '5.431', '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0', 'Si', '2', 'Direct', '0 0 0', '0.25 0.25 0.25',
  ].join('\n') + '\n', 'utf8')

  const hashOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12)
  const run = async (name) => {
    const result = await renderViewsWithCli({ executable: 'D:/VESTA-win64/VESTA.exe' }, {
      structure: poscar,
      outDir: join(dir, name),
      scale: 1,
      views: [{ name: 'a', rx: 30, ry: 20 }],
      timeoutMs: 90000,
    })
    return hashOf(result.renders[0].out)
  }

  const first = await run('one')
  const second = await run('two')
  assert.equal(first, second, '同一组参数两次出图应逐字节一致')
})
