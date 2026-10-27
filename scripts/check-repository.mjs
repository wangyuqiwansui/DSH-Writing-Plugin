// Read-only Git hygiene check. It never stages, deletes or uploads files.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const ignored = git(['ls-files', '-ci', '--exclude-standard'])
assert.equal(ignored, '', `Local output is still tracked; remove only its Git index entry:\n${ignored}`)
const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0'))]
  .filter(p => p && existsSync(resolve(root, p)))
const problems = []
for (const file of files.filter(p => p.endsWith('.md'))) {
  const text = readFileSync(resolve(root, file), 'utf8')
  if (/[A-Za-z]:(?:[/\\]+)Users(?:[/\\]+)[^/\\\s]+/i.test(text)) problems.push(`${file}: personal absolute path`)
  for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = link.split('#')[0]
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue
    const local = resolve(root, dirname(file), decodeURIComponent(target))
    const repositoryPath = relative(root, local).replaceAll('\\', '/')
    if (!existsSync(local)) problems.push(`${file}: missing documentation target ${target}`)
    else if (!files.includes(repositoryPath) && !files.some(p => p.startsWith(repositoryPath + '/'))) {
      problems.push(`${file}: documentation target is outside the distributable source ${target}`)
    }
  }
}
const patch = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'))
assert.deepEqual(patch[0].insert[0].config, {}, 'The shipped bundle must start without local configuration')
for (const file of files.filter(p => /^backtesting\/datasets\/[^/]+\.json$/.test(p) && !p.endsWith('/index.json'))) {
  const dataset = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  if (dataset.provenance?.type !== 'synthetic' || dataset.provenance?.reviewed !== true) problems.push(`${file}: only reviewed synthetic datasets belong in the repository`)
}
assert.deepEqual(problems, [], 'Repository source must be self-contained')
console.log(`Repository check passed: ${files.length} source files, no tracked local outputs, default configuration empty.`)
