/**
 * VESTA 积分值的单位换算（vestaIntegralToElectrons）。
 *   node --test test/vesta-integral.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOHR3_TO_A3, vestaIntegralToElectrons } from '../core.js'

test('vestaIntegralToElectrons：合成常密度文件（VESTA 报 0.148185 → 1 个电子）', () => {
  // 该文件的真实积分是 1.0000 e（ρ=1/64 e/Å³ × 64 Å³），VESTA 报 0.148185
  const electrons = vestaIntegralToElectrons(0.148185)
  assert.ok(Math.abs(electrons - 1) < 1e-4, `换算得 ${electrons}`)
})

test('vestaIntegralToElectrons：5.5/CHGCAR（VESTA 报 1.187066 → 约 8 个电子）', () => {
  const electrons = vestaIntegralToElectrons(1.187066)
  // 我们自己的积分是 8.0000；VESTA 内部网格积分导致 0.13% 偏差
  assert.ok(Math.abs(electrons - 8) / 8 < 0.005, `换算得 ${electrons}`)
})

test('BOHR3_TO_A3：等于 1/a0³（6.7483 bohr³ per Å³）', () => {
  const a0 = 0.529177210903
  assert.ok(Math.abs(BOHR3_TO_A3 - 1 / a0 ** 3) < 1e-6)
  assert.ok(Math.abs(BOHR3_TO_A3 - 6.748334) < 1e-5)
})
