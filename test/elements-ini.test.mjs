/**
 * elements.ini 的读写 + 真实 VESTA 渲染验证（元素配色/半径）。
 *   node --test test/elements-ini.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { editElementsIni, parseElementsIni } from '../core.js'

const INI = process.env.VESTA_ELEMENTS_INI ?? 'D:/VESTA-win64/elements.ini'
const hasIni = existsSync(INI)

test('parseElementsIni：97 个元素，Si 的半径与颜色与 ATOMT 一致', { skip: !hasIni && '缺少 elements.ini' }, () => {
  if (!hasIni) return
  const table = parseElementsIni(readFileSync(INI, 'utf8'))
  assert.equal(table.size, 97)
  const si = table.get('Si')
  assert.ok(Math.abs(si.radius - 1.18) < 1e-6)
  // 场景文件 ATOMT 里 Si 是 27 59 250，正好等于 0.10596/0.23226/0.98096 × 255
  assert.deepEqual(si.rgb, [27, 59, 250])
  assert.equal(si.color, '#1b3bfa')
})

test('editElementsIni：只改目标元素，其它行原样保留', { skip: !hasIni && '缺少 elements.ini' }, () => {
  if (!hasIni) return
  const original = readFileSync(INI, 'utf8')
  const edited = editElementsIni(original, { Si: { color: [0, 200, 0], radius: 1.4 } })
  assert.deepEqual(edited.changed, ['Si'])
  const after = parseElementsIni(edited.text).get('Si')
  assert.deepEqual(after.rgb, [0, 200, 0])
  assert.ok(Math.abs(after.radius - 1.4) < 1e-6)
  // 行数不变
  assert.equal(edited.text.split('\n').length, original.split('\n').length)
  // 未改动的元素保持原值
  const fe = parseElementsIni(edited.text).get('Fe')
  assert.deepEqual(fe.rgb, parseElementsIni(original).get('Fe').rgb)
})

test('editElementsIni：改回原值即恢复原颜色', { skip: !hasIni && '缺少 elements.ini' }, () => {
  if (!hasIni) return
  const original = readFileSync(INI, 'utf8')
  const table = parseElementsIni(original)
  const si = table.get('Si')
  const changed = editElementsIni(original, { Si: { color: [0, 0, 0], radius: 2 } })
  const restored = editElementsIni(changed.text, { Si: { color: si.rgb, radius: si.radius } })
  const back = parseElementsIni(restored.text).get('Si')
  assert.deepEqual(back.rgb, si.rgb)
  assert.ok(Math.abs(back.radius - si.radius) < 1e-6)
})

test('editElementsIni：非法颜色/半径报中文错误', { skip: !hasIni && '缺少 elements.ini' }, () => {
  if (!hasIni) return
  const original = readFileSync(INI, 'utf8')
  assert.throws(() => editElementsIni(original, { Si: { color: [300, 0, 0] } }), /0–255/)
  assert.throws(() => editElementsIni(original, { Si: { color: [1, 2] } }), /三个/)
  assert.throws(() => editElementsIni(original, { Si: { radius: 99 } }), /0–10/)
})

test('parseElementsIni：空内容返回空表而不是抛错', () => {
  assert.equal(parseElementsIni('').size, 0)
  assert.equal(parseElementsIni('# 只有注释\n').size, 0)
})

test('真实 VESTA：改 elements.ini 后渲染颜色确实变化，还原后恢复', { skip: !hasIni && '缺少 elements.ini', timeout: 240000 }, async () => {
  if (!hasIni) return
  const { spawnSync } = await import('node:child_process')
  const { copyFileSync, rmSync, statSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = join(tmpdir(), 'vesta-elements-' + process.pid)
  const png = join(dir, 'si.png')
  const exe = process.env.VESTA_EXE ?? 'D:/VESTA-win64/VESTA.exe'
  const poscar = process.env.VESTA_SI_POSCAR ?? 'D:/calcf/si/POSCAR'
  if (!existsSync(poscar)) return

  const sh = (command) => spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).stdout.trim()
  const count = () => {
    const script = [
      'Add-Type -AssemblyName System.Drawing',
      `$bmp = [System.Drawing.Bitmap]::FromFile('${png.replace(/\//g, '\\\\')}')`,
      '$green = 0; $blue = 0',
      'for ($y = 0; $y -lt $bmp.Height; $y += 2) { for ($x = 0; $x -lt $bmp.Width; $x += 2) {',
      '  $c = $bmp.GetPixel($x, $y)',
      '  if ($c.G -gt 150 -and $c.R -lt 120 -and $c.B -lt 120) { $green++ }',
      '  if ($c.B -gt 150 -and $c.R -lt 120) { $blue++ }',
      '} }',
      '$bmp.Dispose()',
      '"$green|$blue"',
    ].join('; ')
    const [green, blue] = sh(script).split('|').map(Number)
    return { green, blue }
  }
  const render = () => {
    rmSync(png, { force: true })
    // 只启动自己的渲染进程，用 -close 让它自己退出；不全局杀 VESTA（会连累并行跑的其它用例）
    spawnSync(exe, ['-open', poscar, '-export_img', 'scale=1', png, '-close'], { windowsHide: true, timeout: 90000 })
    return existsSync(png) && statSync(png).size > 1024 ? count() : null
  }

  const original = readFileSync(INI, 'utf8')
  try {
    const before = render()
    if (!before) return
    writeFileSync(INI, editElementsIni(original, { Si: { color: [0, 200, 0] } }).text, 'utf8')
    const after = render()
    assert.ok(after, '改色后应能渲染')
    assert.ok(after.green > before.green * 3, `绿色像素应大增：${before.green} → ${after.green}`)
    assert.ok(after.blue < before.blue * 0.5, `蓝色像素应大减：${before.blue} → ${after.blue}`)
  } finally {
    writeFileSync(INI, original, 'utf8')
  }
  const restored = render()
  assert.ok(restored && restored.blue > 500, '还原后蓝色应恢复')
})
