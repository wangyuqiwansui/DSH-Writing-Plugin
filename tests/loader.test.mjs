import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'

test('real Cordis Loader mounts and removes shipped host entry', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(Loader, { baseUrl: new URL('../', import.meta.url).href })
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const [, id, name] = patch.match(/- id: (\S+)\s+name: (\S+)/)
    await ctx.loader.root.update([{ id, name: import.meta.resolve(name), config: {} }])
    await ctx.loader.await()
    ctx.loader.remove(id)
    await ctx.loader.await()
  } finally { await ctx.fiber.dispose() }
})

test('browser artifact registers the declared module without bundling host runtime', async () => {
  const { runInNewContext } = await import('node:vm')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  let captured
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => { captured = value } } } })
  assert.equal(captured.id, pkg.name)
  const external = []
  const plugin = captured.factory(id => { external.push(id); return require(id) })
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(external.every(id => id === 'react' || id === 'react/jsx-runtime'))
})

test('client contributes real SlotCore entries and disposes navigation, styles and service', async () => {
  const { SlotCore } = await import('@deepseek-ai/dsh-client-ui-slots')
  const { runInNewContext } = await import('node:vm')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const slots = new SlotCore()
  slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  } }, () => null)
  const styles = new Set()
  let activePanelId = 'writing-workbench'
  let captured
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { captured = value } } },
    document: {
      createElement: () => { const tag = { dataset: {}, remove: () => styles.delete(tag) }; return tag },
      head: { appendChild: tag => styles.add(tag) },
    },
  })
  const plugin = captured.factory(require)
  const ctx = new Context()
  try {
    ctx.reflect.provide('slots', slots)
    ctx.reflect.provide('layout', {
      panelInfo: { getSnapshot: () => ({ activePanelId }) },
      selectPanel: value => { activePanelId = value },
    })
    const fiber = ctx.plugin(plugin)
    await fiber
    assert.equal(slots.entriesOfSlot('main').length, 1)
    assert.equal(slots.entriesOfSlot('main')[0].options.key, 'writing-workbench')
    assert.equal(slots.entriesOfSlot('sidebar.panellist')[0].options.label, '写作工作台')
    assert.equal(styles.size, 1)
    assert.ok(ctx.writingWorkbench)
    await fiber.dispose()
    assert.equal(slots.entriesOfSlot('main').length, 0)
    assert.equal(slots.entriesOfSlot('sidebar.panellist').length, 0)
    assert.equal(styles.size, 0)
    assert.equal(activePanelId, null)
    assert.equal(ctx.get('writingWorkbench'), undefined)
  } finally { await ctx.fiber.dispose() }
})
