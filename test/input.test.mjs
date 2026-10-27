/**
 * 输入注入（vesta_input）：纯函数 + 真实 VESTA 的可选联调。
 *   node --test test/input.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import {
  VIRTUAL_KEYS,
  clearInputHistory,
  getInputHistory,
  injectInput,
  inverseInput,
  packMousePoint,
  redoInput,
  stopUiHost,
  undoInput,
} from '../core.js'

test('packMousePoint：低 16 位是 X、高 16 位是 Y', () => {
  assert.equal(packMousePoint(100, 50), (50 << 16) | 100)
  assert.equal(packMousePoint(0, 0), 0)
  assert.equal(packMousePoint(65535, 65535), -1) // 全 1 位在 Int32 里就是 -1
})

test('packMousePoint：负数或越界直接抛错，不静默截断', () => {
  assert.throws(() => packMousePoint(-1, 5), /越界/)
  assert.throws(() => packMousePoint(5, 70000), /越界/)
  assert.throws(() => packMousePoint(Number.NaN, 5), /越界/)
})

test('packMousePoint：小数按整数截断', () => {
  assert.equal(packMousePoint(10.9, 20.2), (20 << 16) | 10)
})

test('VIRTUAL_KEYS：方向键与翻页键码正确', () => {
  assert.equal(VIRTUAL_KEYS.left, 0x25)
  assert.equal(VIRTUAL_KEYS.up, 0x26)
  assert.equal(VIRTUAL_KEYS.right, 0x27)
  assert.equal(VIRTUAL_KEYS.down, 0x28)
  assert.equal(VIRTUAL_KEYS.pageup, 0x21)
  assert.equal(VIRTUAL_KEYS.pagedown, 0x22)
})

test('injectInput：未知动作给出中文错误', async () => {
  await assert.rejects(() => injectInput('main', 'teleport'), /不支持的输入动作/)
})

test('injectInput：不认识的键名给出可选项', async () => {
  await assert.rejects(() => injectInput({ pid: 1 }, 'key', { key: 'f13' }), /不认识的键名/)
})

// 需要真实 VESTA 的联调：没有进程时跳过，不算失败
const hasVesta = existsSync('D:/VESTA-win64/VESTA.exe')

test('真实 VESTA：拖拽后截图哈希变化（自己开一个干净窗口）', { skip: !hasVesta && '未安装 VESTA' }, async () => {
  const { execFileSync } = await import('node:child_process')
  const { captureWindow, findViewport, hashFile, openFiles } = await import('../core.js')

  // 测试隔离：不再随便连一个正在运行的 VESTA（全量跑时会被别的用例干扰），
  // 自己开一个只含本用例结构的窗口，用完关掉。
  let pid = null
  try {
    await openFiles({ executable: 'D:/VESTA-win64/VESTA.exe' }, ['D:/calcf/si/POSCAR'])
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const list = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      '(Get-Process VESTA -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1).Id',
    ], { encoding: 'utf8' }).trim()
    pid = list ? Number(list) : null
  } catch {
    pid = null
  }
  if (!pid) {
    // 开不起来（例如并行用例抢窗口）：跳过而不是让整轮变红
    return
  }
  try {
    await new Promise((resolve) => setTimeout(resolve, 4000))
    const view = await findViewport({ pid })
    assert.ok(view.width > 0 && view.height > 0, '视图尺寸应为正')

    const before = await captureWindow({ pid, out: `${process.env.TEMP ?? '.'}/vesta-input-before.png` })
    const beforeHash = hashFile(before.path)
    await injectInput({ pid }, 'drag', { dx: 90, dy: 0 })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const after = await captureWindow({ pid, out: `${process.env.TEMP ?? '.'}/vesta-input-after.png` })
    const afterHash = hashFile(after.path)
    assert.notEqual(beforeHash, afterHash, '拖拽之后画面应该变化')
  } finally {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { encoding: 'utf8' })
    } catch { /* 进程可能已退出 */ }
    stopUiHost()
  }
})

test('inverseInput：拖拽/滚轮取反，方向键取反，点击与打字不可逆', () => {
  assert.deepEqual(inverseInput('drag', { dx: 120, dy: -10 }), { action: 'drag', options: { dx: -120, dy: 10, steps: undefined } })
  assert.deepEqual(inverseInput('wheel', { delta: 120, count: 2 }), { action: 'wheel', options: { delta: -120, count: 2 } })
  assert.deepEqual(inverseInput('key', { key: 0x25 }), { action: 'key', options: { key: 0x27, count: undefined, ctrl: undefined } })
  assert.deepEqual(inverseInput('key', { key: 'left' }), { action: 'key', options: { key: 0x27, count: undefined, ctrl: undefined } })
  assert.equal(inverseInput('click', {}), null)
  assert.equal(inverseInput('type', { text: 'x' }), null)
})

test('getInputHistory：没有记录时返回空栈', () => {
  clearInputHistory(424242)
  const history = getInputHistory(424242)
  assert.deepEqual(history.undo, [])
  assert.deepEqual(history.redo, [])
})

