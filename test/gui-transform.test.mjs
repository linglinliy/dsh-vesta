/**
 * GUI 数值输入与晶胞变换（PostMessage 路线）：真机验证。
 *
 * 这一组用例需要真实 VESTA + 一个 POSCAR；没有就跳过。
 * 关键断言：`transformCellInVesta` 的步骤日志必须包含「Warning 是」与「&Apply」，
 * 且 VESTA 文本区出现它自己写的变换记录（`Transformation from standard setting 2a,b,c`）。
 *   node --test test/gui-transform.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { listControls, openFiles, readVestaText, stopUiHost, transformCellInVesta } from '../core.js'

const VESTA = 'D:/VESTA-win64/VESTA.exe'
const POSCAR = process.env.VESTA_POSCAR ?? 'D:/calcf/si/POSCAR'
const available = existsSync(VESTA) && existsSync(POSCAR)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 60000 }).trim()
const killAll = () => {
  try { spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process VESTA -ErrorAction SilentlyContinue | Stop-Process -Force'], { windowsHide: true }) } catch { /* */ }
}

test('transformCellInVesta：填矩阵 → OK → Warning 是 → &Apply，VESTA 记录 2a 变换', { skip: !available && '缺少 VESTA 或 POSCAR', timeout: 180000 }, async () => {
  if (!available) return
  killAll()
  try {
    await openFiles({ executable: VESTA }, [POSCAR])
    await sleep(6000)
    const pid = Number(ps('(Get-Process VESTA -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1).Id'))
    assert.ok(pid > 0, '应能拿到 VESTA pid')

    // 等主窗口出来
    let ready = false
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { if ((await listControls('main')).window?.hwnd) { ready = true; break } } catch { /* */ }
      await sleep(1000)
    }
    assert.ok(ready, 'VESTA 主窗口应就绪')

    const result = await transformCellInVesta(pid, [[2, 0, 0], [0, 2, 0], [0, 0, 2]])
    assert.equal(result.ok, true)
    const joined = result.steps.join('\n')
    assert.match(joined, /填入矩阵 2,0,0,0,2,0,0,0,2/)
    assert.match(joined, /Warning/)
    assert.match(joined, /是\(&Y\)/)
    assert.match(joined, /&\s?Apply|&Apply/)

    // VESTA 自己写的变换记录是权威证据
    const text = await readVestaText(pid)
    assert.match(text, /Transformation (from|to) standard setting/i, '文本区应有变换记录')
    assert.match(text, /2a/, '文本区应出现 2a 标记')
  } finally {
    killAll()
    stopUiHost()
  }
})
