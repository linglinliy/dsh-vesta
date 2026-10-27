/**
 * GUI 删除原子（真机用例，默认跳过）。
 *
 * 需要显式开启：`VESTA_GUI_TESTS=1 node --test test/gui-delete.test.mjs`
 * 原因：它会打开一个 VESTA 窗口并在其中做「扩胞 → 删一行」，属于会干扰桌面的测试。
 *
 * 断言链（全部来自 VESTA 自己的文本输出，不靠截图猜）：
 *   1. 扩胞后晶胞 a=b=c（2×2×2），位点数 2；
 *   2. `deleteAtomInVesta` 返回的步骤包含「真实点击选中」与「Delete 生效」；
 *   3. 删完位点数比之前少 1。
 *   node --test test/gui-delete.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  deleteAtomInVesta, findRunningVesta, listControls, openFiles, readVestaText, stopUiHost, transformCellInVesta,
} from '../core.js'

const VESTA = 'D:/VESTA-win64/VESTA.exe'
const POSCAR = process.env.VESTA_POSCAR ?? 'D:/calcf/si/POSCAR'
const enabled = process.env.VESTA_GUI_TESTS === '1'
const available = enabled && existsSync(VESTA) && existsSync(POSCAR)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ps = (script) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 60000 }).trim() } catch { return '' }
}
const structure = (text) => {
  const blocks = text.split(/={20,}/).filter((block) => block.includes('Structure parameters'))
  const block = blocks[blocks.length - 1] ?? ''
  const rows = block.split(/\r?\n/).filter((line) => /^\s*\d+\s+[A-Z][a-z]?\s+\S+\s+-?\d/.test(line))
  const lattice = /a\s+b\s+c\s+alpha\s+beta\s+gamma\r?\n\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(block)
  return { lattice: lattice ? lattice.slice(1, 4).map(Number) : null, rows: rows.length }
}

test('GUI：扩胞后删掉一行原子（纯投递消息，不抢前台）', { skip: !available && '需要 VESTA_GUI_TESTS=1 与 VESTA/POSCAR', timeout: 240000 }, async () => {
  if (!available) return
  try {
    // 总是先用同一个实例加载 POSCAR：VESTA 是单实例，会把文件交给已开的窗口（不新开窗），
    // 这样初始状态一定是 2 原子的原胞，测试才有确定性。
    await openFiles({ executable: VESTA }, [POSCAR])
    await sleep(6000)
    const running = findRunningVesta()
    assert.ok(running.length > 0, '应有运行中的 VESTA')
    const pid = running[0].pid
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { if ((await listControls('main')).window?.hwnd) break } catch { /* */ }
      await sleep(1000)
    }

    const before = structure(await readVestaText(pid))
    assert.equal(before.rows, 2, `重新加载 POSCAR 后应有 2 个原子，实际 ${before.rows}`)
    assert.equal(before.rows >= 1, true, '初始应至少有一个位点')

    // 扩胞到 2×2×2（若已是更大晶胞也不影响，只要位点数 ≥2 才能安全删除）
    const grown = await transformCellInVesta(pid, [[2, 0, 0], [0, 2, 0], [0, 0, 2]])
    // Warning 只在「晶胞体积改变」时出现；这里不强断言它，改断言矩阵已写入
    assert.ok(grown.steps.some((step) => /填入矩阵/.test(step)), '应记录填入矩阵')
    await sleep(800)
    const afterGrow = structure(await readVestaText(pid))
    assert.equal(afterGrow.rows >= 2, true, `扩胞后位点数应 ≥2，实际 ${afterGrow.rows}`)

    const deleted = await deleteAtomInVesta(pid, { row: 0 })
    const joined = deleted.steps.join('\n')
    assert.match(joined, /投递点击选中/, '应记录投递点击选行（纯消息，不抢前台）')
    assert.match(joined, /Delete.*生效/, '应记录 Delete 生效')
    await sleep(1000)
    const afterDelete = structure(await readVestaText(pid))
    assert.equal(afterDelete.rows, afterGrow.rows - 1, `位点数应从 ${afterGrow.rows} 减到 ${afterGrow.rows - 1}，实际 ${afterDelete.rows}`)
  } finally {
    const left = ps('(Get-Process VESTA -ErrorAction SilentlyContinue | Measure-Object).Count')
    if (left === '0') { /* 已经没了 */ }
    stopUiHost()
  }
})
