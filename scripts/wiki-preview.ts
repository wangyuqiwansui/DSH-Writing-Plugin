// Explicit UI fixtures, excluded from the shipped bundle. No user database is accessed.
import type { WikiBackend, WikiDetail, WikiOverview } from '../src/modules/wiki/contracts/index.js'
import type { KnowledgeListing } from '../src/shared/contracts/index.js'
import fixture from '../.preview/wiki-preview.json'

export function wikiPreview(scenario: string | null): WikiBackend {
  const data = fixture as unknown as { overview: WikiOverview; pages: KnowledgeListing; sources: KnowledgeListing; details: Record<string, WikiDetail> }
  return {
    overview: async () => scenario === 'unconfigured' ? { ready: false, message: '当前未选择数据库文件。', pluginInstanceId: null, projects: [] }
      : scenario === 'empty' ? { ...data.overview, projects: [] } : data.overview,
    browse: async request => {
      if (scenario === 'error') throw new Error('演示：数据库暂时无法读取，请刷新后重试。')
      if (request.projectId === 'q') return { total: 0, items: [] }
      const source = request.kind === 'pages' ? data.pages : data.sources
      const items = source.items.filter(item => (request.includeInactive || !item.inactive)
        && (!request.query || `${item.title}\n${data.details[item.ref.versionId]?.text ?? ''}\n${data.details[item.ref.versionId]?.document?.markdown ?? ''}`.toLowerCase().includes(request.query.toLowerCase())))
      return { total: items.length, items: items.slice(request.offset, request.offset + 30) }
    },
    read: async request => {
      const value = data.details[request.ref.versionId]
      if (!value) throw new Error('演示版本不存在。')
      return value
    },
  }
}
