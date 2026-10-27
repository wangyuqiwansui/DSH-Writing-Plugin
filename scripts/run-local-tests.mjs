// Optional local suite. Its files intentionally do not ship in Git.
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = new URL('../tests/', import.meta.url)
if (!existsSync(directory)) {
  console.error('本地 tests/ 未提供；该目录不随 Git 分发。公开构建和回测自检请运行 npm test。')
  process.exit(1)
}
const files = readdirSync(directory).filter(name => name.endsWith('.test.mjs')).sort().map(name => 'tests/' + name)
if (!files.length || !readdirSync(directory).some(name => /^test_.*\.py$/.test(name))) {
  console.error('本地 tests/ 不完整，需要 Node 与 Python 测试文件；未将缺失的测试视为通过。')
  process.exit(1)
}
files.push(...readdirSync(new URL('../backtesting/tests/', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort().map(name => 'backtesting/tests/' + name))
for (const [command, args] of [[process.execPath, ['--test', ...files]], ['python', ['-X', 'utf8', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v']]]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}
