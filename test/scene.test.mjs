/**
 * .vesta 场景文本：解析、模板替换、以及 VESTA 是否接受生成文件（可选，需装 VESTA）。
 *   node --test test/scene.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  applySceneBoundary,
  applySceneStyle,
  buildVestaFromTemplate,
  cellParameters,
  parsePoscar,
  parseVestaProject,
  readSceneBoundary,
  readSceneStyle,
} from '../core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
// 真实夹具（带 BOUND / BKGRC 等完整段），用来测显示相关字段
const BOUND_TEMPLATE = readFileSync(join(HERE, 'fixtures', 'scene-template.vesta'), 'utf8')

const TEMPLATE = `#VESTA_FORMAT_VERSION 3.5.4


CRYSTAL

TITLE
template

GROUP
1 1 P 1
SYMOP
0 0 0 1 0 0 0 1 0 0 0 1 1

LMATRIX
  0.000000  0.816497  0.577350  0.000000
  0.707107 -0.408248  0.577350  0.000000
  0.707107  0.408248 -0.577350  0.000000
  0.000000  0.000000  0.000000  1.000000
  0.000000  0.000000  0.000000

CELLP
   3.840297   3.840297   3.840297  60.000000  60.000000  60.000000
   0.000000   0.000000   0.000000   0.000000   0.000000   0.000000
STRUC
  1 Si        Si1  1.0000   0.000000   0.000000   0.000000    1a       1
                            0.000000   0.000000   0.000000  0.00
  0 0 0 0 0 0 0
THERI 1
  1        Si1 -0.000000
  0 0 0
STYLE
MODEL   0  1  0
BONDS   1
BKGRC
 255 255 255
`

test('parseVestaProject：段、行内参数、结构、晶胞、取向矩阵', () => {
  const parsed = parseVestaProject(TEMPLATE)
  assert.equal(parsed.version, '3.5.4')
  assert.ok(parsed.order.includes('STYLE'))
  assert.equal(parsed.inline.get('THERI'), '1')
  assert.equal(parsed.structure.atoms.length, 1)
  assert.equal(parsed.structure.atoms[0].element, 'Si')
  assert.deepEqual(parsed.structure.atoms[0].frac, [0, 0, 0])
  assert.deepEqual(parsed.structure.cell, [3.840297, 3.840297, 3.840297, 60, 60, 60])
  assert.equal(parsed.matrix.length, 3)
  assert.ok(Math.abs(parsed.matrix[0][1] - 0.816497) < 1e-6)
})

test('parseVestaProject：不是 .vesta 时返回空壳而不是抛错', () => {
  const parsed = parseVestaProject('hello world')
  assert.equal(parsed.version, null)
  assert.deepEqual(parsed.structure.atoms, [])
  assert.equal(parsed.matrix, null)
})

test('buildVestaFromTemplate：替换结构、保留显示设置与行内参数', () => {
  const built = buildVestaFromTemplate(TEMPLATE, {
    title: 'graphene',
    lattice: [[2.46, 0, 0], [-1.23, 2.130422, 0], [0, 0, 15]],
    atoms: [
      { element: 'C', frac: [0, 0, 0.5] },
      { element: 'C', frac: [1 / 3, 1 / 3, 0.5] },
    ],
  })
  const parsed = parseVestaProject(built)
  assert.equal(parsed.structure.atoms.length, 2)
  assert.ok(parsed.blocks.has('STYLE'))
  assert.ok(parsed.blocks.has('BKGRC'))
  // 取向矩阵来自模板
  assert.ok(Math.abs(parsed.matrix[1][0] - 0.707107) < 1e-6)
  // 行内参数必须还是同一行
  assert.match(built, /^THERI 1$/m)
  // 晶胞参数不能粘连：6 个数各自成 token
  const cellp = parsed.structure.cell
  assert.equal(cellp.length, 6)
  assert.ok(Math.abs(cellp[0] - 2.46) < 1e-6)
  assert.ok(Math.abs(cellp[5] - 120) < 1e-4, `gamma 应约为 120，实际 ${cellp[5]}`)
})

test('buildVestaFromTemplate：缺结构/缺晶胞时报中文错误', () => {
  assert.throws(() => buildVestaFromTemplate(TEMPLATE, { atoms: [] }), /没有原子/)
  assert.throws(() => buildVestaFromTemplate(TEMPLATE, { atoms: [{ element: 'C', frac: [0, 0, 0] }] }), /缺少晶胞参数/)
  assert.throws(() => buildVestaFromTemplate('not a vesta file', { atoms: [{ element: 'C', frac: [0, 0, 0] }], cell: [1, 1, 1, 90, 90, 90] }), /不像/)
})

test('cellParameters：立方晶胞的角度都是 90°', () => {
  const params = cellParameters([[5, 0, 0], [0, 5, 0], [0, 0, 5]])
  assert.equal(params.a, 5)
  assert.ok(Math.abs(params.alpha - 90) < 1e-9)
  assert.ok(Math.abs(params.volume - 125) < 1e-9)
})

// VESTA 是否接受我们生成的 .vesta：必须用「完整模板」（VESTA 自己存的 .vesta），
// 最小模板缺 BOUND/VECTR/SBOND/ATOMT 等段，VESTA 会拒绝——这本身就是要写进文档的限制。
const VESTA = 'D:/VESTA-win64/VESTA.exe'
const FULL_TEMPLATE = process.env.VESTA_SCENE_TEMPLATE
  ?? join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'scene-template.vesta')
test('真实 VESTA：接受模板生成的 .vesta 并导出 PNG', {
  skip: !existsSync(VESTA) || !FULL_TEMPLATE || !existsSync(FULL_TEMPLATE)
    ? '需要 VESTA 与完整模板（VESTA_SCENE_TEMPLATE 指向一个 .vesta）'
    : false,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-scene-'))
  const scene = buildVestaFromTemplate(readFileSync(FULL_TEMPLATE, 'utf8'), {
    title: 'graphene',
    lattice: [[2.46, 0, 0], [-1.23, 2.130422, 0], [0, 0, 15]],
    atoms: [{ element: 'C', frac: [0, 0, 0.5] }, { element: 'C', frac: [1 / 3, 1 / 3, 0.5] }],
  })
  const scenePath = join(dir, 'scene.vesta')
  writeFileSync(scenePath, scene, 'utf8')
  const png = join(dir, 'scene.png')

  const sh = (command) => {
    try {
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  sh("Get-Process VESTA -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill() }")
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  sh(`Start-Process -FilePath '${VESTA}' -ArgumentList '-open','${scenePath}','-export_img','scale=1','${png}','-close' | Out-Null`)
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    if (existsSync(png) && statSync(png).size > 1024) break
  }
  sh("Get-Process VESTA -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill() }")
  assert.ok(existsSync(png), 'VESTA 应该能打开生成的 .vesta 并出图')
})
test('readSceneStyle / applySceneStyle：改背景色与显示模型', () => {
  const before = readSceneStyle(TEMPLATE)
  assert.deepEqual(before.background, [255, 255, 255])
  assert.equal(before.model, 0)
  const changed = applySceneStyle(TEMPLATE, { background: [255, 0, 0], model: 1 })
  const after = readSceneStyle(changed)
  assert.deepEqual(after.background, [255, 0, 0])
  assert.equal(after.model, 1)
  // 其它行不应被破坏
  assert.match(changed, /^BKGRC$/m)
  assert.equal(parseVestaProject(changed).version, parseVestaProject(TEMPLATE).version)
})

test('applySceneStyle：非法背景色/模型报中文错误', () => {
  assert.throws(() => applySceneStyle(TEMPLATE, { background: [1, 2] }), /三个/)
  assert.throws(() => applySceneStyle(TEMPLATE, { background: [300, 0, 0] }), /0–255/)
  assert.throws(() => applySceneStyle(TEMPLATE, { model: 9 }), /0–4/)
  assert.throws(() => applySceneStyle('no sections here', { background: [1, 2, 3] }), /BKGRC/)
})
test('readSceneBoundary / applySceneBoundary：改显示边界', () => {
  const before = readSceneBoundary(BOUND_TEMPLATE)
  assert.deepEqual(before.ranges, [[0, 1], [0, 1], [0, 1]])
  const changed = applySceneBoundary(BOUND_TEMPLATE, [[-1, 2], [-1, 2], [-1, 2]])
  assert.deepEqual(readSceneBoundary(changed).ranges, [[-1, 2], [-1, 2], [-1, 2]])
  // 其它段不应被破坏
  assert.equal(parseVestaProject(changed).version, parseVestaProject(BOUND_TEMPLATE).version)
})

test('applySceneBoundary：非法边界报中文错误', () => {
  assert.throws(() => applySceneBoundary(BOUND_TEMPLATE, [[0, 1]]), /三个方向/)
  assert.throws(() => applySceneBoundary(BOUND_TEMPLATE, [[1, 1], [0, 1], [0, 1]]), /止必须大于起/)
  assert.throws(() => applySceneBoundary(BOUND_TEMPLATE, [[-10, 1], [0, 1], [0, 1]]), /-9\.\.9/)
  assert.throws(() => applySceneBoundary('no BOUND here', [[0, 1], [0, 1], [0, 1]]), /BOUND/)
})
