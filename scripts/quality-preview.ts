import type { QualityBackend } from '../src/modules/quality/contracts.js'
export function qualityPreview(scenario: string | null): QualityBackend {
  return { invoke: async (request, signal) => {
    if (scenario === 'unconfigured' && request.action === 'overview') return { action: 'overview', data: { ready: false, message: '当前未选择数据库文件。', projects: [], pluginInstanceId: null, semanticAvailable: false } }
    if (scenario === 'error' && request.action !== 'overview') throw new Error('演示：数据库暂时无法读取，请刷新后重试。')
    const response = await fetch('/quality-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '预览服务异常')
    if (result.action === 'overview') result.data.projects.sort((a: { id: string }, b: { id: string }) => a.id === 'river' ? -1 : b.id === 'river' ? 1 : 0)
    return result
  } }
}
