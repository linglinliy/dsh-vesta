/**
 * 插件装配集成测试：用 mock ctx 调用 apply()，检查所有工具注册齐全、schema 合法。
 *   node --test test/tools.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, inject } from '../index.js'

/** 跑一次 apply，收集注册的工具定义。 */
const registerAll = () => {
  const registered = []
  const ctx = {
    tools: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
    effect: (factory) => {
      const dispose = factory()
      assert.equal(typeof dispose, 'function', 'effect 应返回 disposer')
    },
  }
  apply(ctx, {})
  return registered
}

const EXPECTED_TOOLS = [
  'vesta_open', 'vesta_info', 'vesta_menu', 'vesta_control', 'vesta_capture', 'vesta_analyze',
  'volume_analyze', 'xray_powder', 'slab_report', 'work_function', 'check_structure', 'vesta_view',
  'vasp_dos', 'vasp_bands', 'vasp_report', 'vasp_batch', 'vasp_compare', 'vasp_table',
  'vasp_trajectory', 'vasp_pdos', 'vesta_input', 'vesta_render', 'vesta_edit', 'vesta_vector', 'volume_export', 'vesta_measure', 'vesta_volume_display', 'vesta_style',
]

test('apply：注册的工具名与预期清单一致', () => {
  const tools = registerAll()
  const names = tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, [...EXPECTED_TOOLS].sort())
  assert.equal(tools.length, EXPECTED_TOOLS.length)
})

test('apply：每个工具都有描述、参数 schema 与 execute', () => {
  for (const tool of registerAll()) {
    assert.equal(typeof tool.name, 'string')
    assert.ok(tool.name.length > 0)
    assert.equal(typeof tool.description, 'string', `${tool.name} 缺描述`)
    assert.ok(tool.description.length > 10, `${tool.name} 描述太短`)
    assert.equal(typeof tool.description, 'string')
    assert.equal(typeof tool.parameters, 'object', `${tool.name} 缺 parameters`)
    assert.equal(tool.parameters.type, 'object', `${tool.name} 的 parameters 应为 object`)
    assert.equal(typeof tool.execute, 'function', `${tool.name} 缺 execute`)
  }
})

test('apply：必填参数都出现在 properties 里', () => {
  for (const tool of registerAll()) {
    const required = tool.parameters.required ?? []
    const properties = tool.parameters.properties ?? {}
    for (const key of required) {
      assert.ok(key in properties, `${tool.name} 的必填参数 ${key} 不在 properties 中`)
    }
  }
})

test('apply：插件名与依赖声明正确', () => {
  assert.equal(name, 'vesta')
  assert.deepEqual(inject, ['tools'])
})

test('apply：每个工具的描述都写了「何时使用」的触发语', () => {
  for (const tool of registerAll()) {
    // 描述里要有明确的使用触发（用户问… / 用户要… / 当…时），否则模型难以自行选择工具
    assert.match(tool.description, /用户|当[^。]{0,20}时/, `${tool.name} 的描述缺少触发语：${tool.description.slice(0, 60)}`)
    assert.ok(!/sci_viz|sci_viz_structure/.test(tool.description), `${tool.name} 引用了不存在的工具`)
  }
})

test('apply：每个参数都有描述，数值型参数写明单位或范围', () => {
  // 这些参数的单位/范围对模型填值很关键，缺了就容易被瞎填
  const needsUnit = /^(at|scale|points|window|twoThetaMax|fwhm|lambda|efermi|repeat|tolerance|maxPeaks|threshold|depth)$/i
  const hasUnit = /°|Å|eV|%|0[–-]1|倍数|范围|默认|≥|≤/
  for (const tool of registerAll()) {
    for (const [param, schema] of Object.entries(tool.parameters.properties ?? {})) {
      assert.equal(typeof schema.description, 'string', `${tool.name}.${param} 缺参数描述`)
      assert.ok(schema.description.length >= 4, `${tool.name}.${param} 描述太短`)
      if (needsUnit.test(param)) {
        assert.match(schema.description, hasUnit, `${tool.name}.${param} 缺单位/范围：${schema.description}`)
      }
    }
  }
})

test('apply：输出 schema 的 required 字段与 properties 一致', () => {
  for (const tool of registerAll()) {
    const schema = tool.output?.schema
    if (!schema) continue
    const required = schema.required ?? []
    const properties = schema.properties ?? {}
    for (const key of required) {
      assert.ok(key in properties, `${tool.name} 的输出 schema 缺 ${key} 的定义`)
    }
  }
})
