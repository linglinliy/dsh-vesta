/**
 * 功函数工具冒烟：用合成 LOCPOT 夹具（<合成 LOCPOT 目录>）验证数值与产物。
 *   node --test test/tools-smoke5.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const FIXTURE = '<合成 LOCPOT 目录>'
const available = existsSync(join(FIXTURE, 'LOCPOT')) && existsSync(join(FIXTURE, 'OUTCAR'))

const loadTools = () => {
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    effect: (factory) => { factory() },
  }
  apply(ctx, {})
  return tools
}

test('work_function：合成 LOCPOT → Φ = 3.000 eV，产物 HTML 存在', { skip: !available && '缺少合成 LOCPOT 夹具' }, async () => {
  const tools = loadTools()
  const out = join(mkdtempSync(join(tmpdir(), 'vesta-wf-')), 'wf.html')
  const result = await tools.get('work_function').execute({ path: FIXTURE, out }, {})
  assert.equal(result.ok, true)
  assert.ok(Math.abs(result.workFunction - 3) < 1e-6, `Φ = ${result.workFunction}`)
  assert.equal(result.path, out)
  assert.ok(existsSync(out), `产物不存在：${out}`)
  assert.match(result.summary, /真空能级 E_vac = 5\.000 eV/)
  assert.match(result.summary, /费米能级 E_F = 2\.000 eV/)
})

test('work_function：显式 efermi 覆盖 OUTCAR', { skip: !available && '缺少合成 LOCPOT 夹具' }, async () => {
  const tools = loadTools()
  const out = join(mkdtempSync(join(tmpdir(), 'vesta-wf-')), 'wf2.html')
  const result = await tools.get('work_function').execute({ path: FIXTURE, efermi: 4, out }, {})
  assert.ok(Math.abs(result.workFunction - 1) < 1e-6, `Φ = ${result.workFunction}`)
})
