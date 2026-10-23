import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import semver from 'semver'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)))
const hostVersion = '0.2.1-rc.2'

test('manifest accepts the supported DSH prerelease and does not claim untested hosts', () => {
  assert.ok(semver.satisfies(hostVersion, pkg.engines.dsh))
  assert.equal(semver.satisfies('0.2.1-alpha.4', pkg.engines.dsh), false)
  assert.equal(semver.satisfies('0.2.1-rc.3', pkg.engines.dsh), false)
  assert.ok(semver.gt(pkg.version, '0.1.0'))
  assert.equal(lock.version, pkg.version)
  assert.deepEqual(lock.packages[''].engines, pkg.engines)
})

test('validation runs against installed rc.2 SDK packages and matching framework dependencies', () => {
  for (const name of [
    '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/cordis', '@deepseek-ai/cordis-plugin-loader',
  ]) {
    const installed = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url)))
    const requested = pkg.peerDependencies[name] ?? pkg.devDependencies[name]
    assert.ok(semver.satisfies(installed.version, requested), `${name} does not match the test target`)
    assert.equal(lock.packages[`node_modules/${name}`].version, installed.version)
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(installed.version, hostVersion)
  }
})
