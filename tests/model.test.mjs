import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchController } from '../lib/client/model.js'
const entry = (id = 'test-tool') => ({ id, title: '测试工具', description: 'test', state: 'available', component: () => null })

test('navigation has real empty state and invalid routes recover to home', () => {
  const model = new WorkbenchController()
  assert.deepEqual(model.getSnapshot().entries, [])
  model.open(); assert.equal(model.getSnapshot().open, true)
  model.navigate('world'); assert.equal(model.getSnapshot().page, 'world')
  model.navigate('unknown'); assert.equal(model.getSnapshot().page, 'home')
  model.close(); assert.equal(model.getSnapshot().open, false)
})
test('entry disposal removes stale navigation and visits; duplicate registration fails', () => {
  const model = new WorkbenchController()
  const dispose = model.register(entry())
  assert.throws(() => model.register(entry()), /Duplicate/)
  model.navigate('test-tool')
  assert.deepEqual(model.getSnapshot().recent, ['test-tool'])
  dispose()
  assert.equal(model.getSnapshot().page, 'home')
  assert.deepEqual(model.getSnapshot().recent, [])
  assert.equal(model.getSnapshot().entries.length, 0)
})
test('unavailable entries never mount, and controller becomes inert after unload', () => {
  const model = new WorkbenchController()
  model.register({ ...entry(), state: 'unavailable', reason: 'missing provider' })
  model.navigate('test-tool'); assert.equal(model.getSnapshot().page, 'home')
  let calls = 0
  model.subscribe(() => calls++)
  model.dispose()
  const before = calls
  model.open()
  assert.equal(calls, before)
  assert.equal(model.getSnapshot().open, false)
  assert.throws(() => model.register(entry()), /disposed/)
})
