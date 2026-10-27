// Opt-in preview API backed by the real module and a disposable SQLite database.
// It never opens the user's configured data/novel.sqlite3 or calls a model.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LocalStorage } from '../lib/infrastructure/storage/storage.js'
import { QualityService } from '../lib/modules/quality/service.js'
import { CONTRACT_VERSION } from '../lib/shared/contracts/index.js'

export async function qualityPreviewServer() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-quality-preview-')), path = join(root, 'preview.sqlite3')
  const cleanup = () => {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.split(/[\\/]/).at(-1).startsWith('dsh-quality-preview-')) throw new Error('Unexpected preview cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
  let storage, service
  try {
    const result = spawnSync('python', ['-X', 'utf8', fileURLToPath(new URL('./local_db.py', import.meta.url)), '--db', path, 'init'], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr)
    storage = new LocalStorage(path)
    const pluginInstanceId = storage.instanceId(), scope = { pluginInstanceId, projectId: 'river' }
    const command = (owner, projectId, work) => storage.repositoryFor(owner, projectId).command({ contractVersion: CONTRACT_VERSION, pluginInstanceId, projectId, operationId: crypto.randomUUID(), input: {}, scope: { targetIds: [], referenceIds: [] }, expectedVersions: [] }, work).result
    command('story', 'river', tx => { tx.createProject('江流城纪事'); return true })
    command('story', 'empty', tx => { tx.createProject('新作品 · 尚无内容'); return true })
    const append = (owner, key, kind, text) => command(owner, 'river', tx => tx.appendArtifact({ key, kind, schemaVersion: 'quality-preview-v1', payload: { format: 'text', text } }))
    const body = append('writer', '第一章 · 夜渡', 'chapter_body', '江流城的雨落了一整夜。\n\n林舟抵达渡口时，最后一盏灯还亮着。船夫没有问他的来处，只指了指船舷上的旧绳结。\n\n<think>检查渡口与人物设定</think>\n\n“今夜不渡客。”船夫说。\n\n林舟把那枚铜钱放在灯下。命运的齿轮开始转动。船夫看了很久，终于解开了绳子。')
    append('writer', '第二章 · 晨雾', 'chapter_body', '雾散时，江流城的城门还没有开。\n\n林舟沿着石阶向上走，手里攥着一张被雨浸透的信笺。身后，渡船缓缓离岸。')
    const outline = append('planning', '卷一 · 渡口旧事', 'chapter_plot', '第一章：夜渡\n林舟携信来到江流城，借旧铜钱获得船夫的帮助。\n\n第二章：晨雾\n进入城门前，他发现信笺上的落款与渡口绳结相同。')
    service = new QualityService(storage)
    const call = async (action, input) => (await service.invoke({ action, input })).data
    const rule = async (level, content, active) => {
      const ruleScope = { ...scope, projectId: level === 'L0' ? null : 'river' }
      const saved = await call('saveRule', { ...ruleScope, operationId: crypto.randomUUID(), ruleId: null, expectedRevision: 0, level, content })
      if (active) await call('setRuleStatus', { ...ruleScope, operationId: crypto.randomUUID(), ruleId: saved.id, expectedRevision: saved.revision, status: 'active' })
    }
    await rule('L0', { title: '正文不包含交付说明', description: '正文开头不保留“以下是正文”等交付说明。', dimension: 'body', checkType: 'deterministic', detector: 'forbidden_literal', literal: '以下是正文', source: '编辑规范 · 输出格式' }, true)
    await rule('L1', { title: '观察套话：命运的齿轮', description: '命中时提示复核，不直接判断文风或 AI 生成概率。', dimension: 'body', checkType: 'observation', detector: 'forbidden_literal', literal: '命运的齿轮', source: '江流城纪事 · 作者约定' }, true)
    await rule('L1', { title: '人物动机与设定一致', description: '核对林舟的行动是否由已知目标支持。没有足够上下文时标记待复核。', dimension: 'all', checkType: 'semantic', detector: null, literal: '', source: '作者审阅意见 · 待确认' }, false)
    for (const target of [body]) {
      const prepared = await call('prepare', { ...scope, target, mode: 'deterministic' })
      await call('detect', { ...scope, target, mode: 'deterministic', operationId: crypto.randomUUID(), fingerprint: prepared.fingerprint })
    }
    return { invoke: (request, signal) => service.invoke(request, signal), async dispose() { await service.dispose(); storage.dispose(); cleanup() } }
  } catch (error) { await service?.dispose(); storage?.dispose(); cleanup(); throw error }
}
