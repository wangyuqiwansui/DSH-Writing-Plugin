import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { KnowledgeSummary } from '../../../shared/contracts/index.js'
import type { WikiDetail } from '../contracts/index.js'
import { WikiController } from './controller.js'
import { Markdown } from './Markdown.js'

const namespaces: Record<string, string> = { canon: '作品事实', planning: '故事规划', reference: '参考资料', style: '写作风格', experience: '创作经验' }
const statuses: Record<string, string> = { candidate: '候选', confirmed: '已确认', published: '已发布', observed: '已观察', revoked: '已撤回', superseded: '已替代', rejected: '已否决' }
const kinds: Record<string, string> = { knowledge_source: '原始资料', source_text: '解析文本', wiki_page: 'Wiki 页面' }
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
function date(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('zh-CN') }
function Badges({ record }: { record: KnowledgeSummary }) {
  return <div className="ww-wiki-badges"><span>{kinds[record.ref.kind] ?? '领域资料'}</span>
    {record.catalog && <span>{namespaces[record.catalog.namespace]}</span>}
    {record.inactive && <span className="ww-wiki-caution">已失效</span>}
    {!record.latest && <span>历史版本</span>}<span>v{record.ref.revision}</span></div>
}
function Evidence({ detail, controller }: { detail: WikiDetail; controller: WikiController }) {
  return <section className="ww-wiki-evidence" aria-label="来源引用"><div className="ww-wiki-section-title"><h3>来源引用</h3><span>{detail.citations.length} 条</span></div>
    {!detail.citations.length ? <p className="ww-wiki-muted">本页未登记来源引用，内容依据待补充。</p> : detail.citations.map(citation => <article className="ww-wiki-citation" key={citation.id}>
      <div><span className="ww-wiki-citation-id">{citation.label}</span><span>{citation.role === 'contradicts' ? '反证' : citation.role === 'supports' ? '支持' : '来源'}</span></div>
      <strong>{citation.source?.title ?? '无法验证的来源'}</strong>
      {citation.quote !== null && <blockquote>{citation.quote}</blockquote>}
      <p className={citation.verified ? '' : 'ww-wiki-caution'}>{citation.message}</p>
      {citation.source && <Badges record={citation.source}/>}
      <button className="ww-link-button" disabled={!citation.verified} onClick={() => { void controller.open(citation.sourceRef, true, citation.readOffset) }}>查看来源原文 →</button>
      {citation.locator && <small>原文 UTF-8 字节 {citation.locator.start}–{citation.locator.endExclusive}</small>}
    </article>)}
  </section>
}
function Reader({ detail, controller }: { detail: WikiDetail; controller: WikiController }) {
  const { record, document } = detail
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => { title.current?.focus({ preventScroll: true }) }, [record.ref.versionId])
  return <>
    <div className="ww-wiki-reader-heading"><Badges record={record}/><h2 ref={title} tabIndex={-1}>{record.title}</h2>
      <p>保存于 {date(record.createdAt)} · {size(record.byteLength)} · {record.latest ? '最新保存版本' : '历史引用版本'}</p></div>
    {(record.inactive || !record.latest) && <p className="ww-wiki-notice" role="status">{record.inactive ? '此来源已失效，仅供历史追溯。' : '正在阅读引用指定的历史版本。'}{record.decision?.reason && ` ${record.decision.reason}`}</p>}
    {detail.notice && <p className="ww-wiki-muted">{detail.notice}</p>}
    {document ? <>
      {document.summary && <p className="ww-wiki-summary">{document.summary}</p>}
      <Markdown text={document.markdown}/>
      {!!document.claims.length && <details className="ww-wiki-details"><summary>主张与证据关系 · {document.claims.length}</summary>{document.claims.map(claim => <div className="ww-wiki-claim" key={claim.id}><p>{claim.statement}</p><small>{namespaces[claim.namespace]} · {statuses[claim.factStatus]} · 证据：{claim.supportBundleIds.join('、') || '未登记'}</small></div>)}</details>}
      {!!document.conflicts.length && <details className="ww-wiki-details"><summary>待核对冲突 · {document.conflicts.length}</summary><pre>{JSON.stringify(document.conflicts, null, 2)}</pre></details>}
      <Evidence detail={detail} controller={controller}/>
      {!!document.links.length && <section className="ww-wiki-related"><h3>相关页面</h3>{document.links.map((link, index) => <button key={index} onClick={() => { void controller.open(link.targetRef, true) }}>{link.label} →</button>)}</section>}
    </> : detail.text !== null ? <><pre className="ww-wiki-source-text">{detail.text || '（此版本正文为空）'}</pre>
      {(detail.offset > 0 || detail.nextOffset !== null) && <div className="ww-wiki-pagination"><button disabled={detail.offset === 0} onClick={() => controller.readChunk(0)}>回到开头</button><span>已读至 {detail.offset + detail.text.length} / {detail.totalCharacters} 字符</span><button disabled={detail.nextOffset === null} onClick={() => detail.nextOffset !== null && controller.readChunk(detail.nextOffset)}>继续阅读</button></div>}</> : null}
    {!!record.dependencies.length && <section className="ww-wiki-related"><h3>来源链</h3>{record.dependencies.map((dependency, index) => <button key={index} onClick={() => { void controller.open(dependency.ref, true) }}>{kinds[dependency.ref.kind] ?? '关联资料'} · v{dependency.ref.revision} →</button>)}</section>}
    <details className="ww-wiki-details"><summary>版本与来源信息</summary>
      <dl><dt>内容版本</dt><dd>{record.ref.versionId}</dd><dt>SHA-256</dt><dd>{record.ref.contentHash}</dd><dt>资料标识</dt><dd>{record.key}</dd>
        <dt>目录标注</dt><dd>{record.catalog ? `${namespaces[record.catalog.namespace]} · ${statuses[record.catalog.factStatus]}` : '未登记'}</dd>
        <dt>状态核验</dt><dd>{record.catalogCurrent ? '目录游标与当前领域事件一致' : '目录状态待复核；不作为事实采纳依据'}</dd>
        <dt>生效范围</dt><dd>{record.catalog?.validity.mode === 'timeless' ? '无章节限制' : record.catalog?.validity.mode === 'chapter_range' ? `章节 ${record.catalog.validity.fromChapterId} 起，至 ${record.catalog.validity.toChapterIdExclusive ?? '未指定'}（不含）` : '尚未确定'}</dd>
        <dt>领域决定</dt><dd>{record.decision ? statuses[record.decision.decision] : '未登记'}</dd></dl>
      {record.imports.map((item, index) => <div className="ww-wiki-origin" key={index}><strong>导入凭据 {index + 1}</strong><p>{item.origin.system} / {item.origin.table} / {item.origin.rowId}</p><p>来源实例：{item.origin.sourceInstanceId}</p><button onClick={() => { void controller.open(item.importManifestRef, true) }}>查看导入清单</button></div>)}
    </details>
  </>
}
export function WikiPage({ controller, configure }: { controller: WikiController; configure: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => { if (controller.getSnapshot().connected) void controller.refresh() }, [controller])
  const ready = state.connected && state.overview?.ready && !!state.projectId
  const loading = state.busy.overview || state.busy.list
  const label = state.kind === 'pages' ? 'Wiki 页面' : '资料'
  return <div className="ww-wiki">
    <div className="ww-heading"><div><span className="ww-eyebrow">KNOWLEDGE LIBRARY</span><h1 id="ww-title">Wiki</h1><p>阅读资料与知识页面，让每一条引用都有出处。</p></div><button className="ww-db-secondary" disabled={!state.connected || state.busy.overview} onClick={() => { void controller.refresh() }}>刷新</button></div>
    {state.error && <div className="ww-wiki-notice" role="alert">{state.error}<button onClick={() => { void controller.refresh() }}>重新加载</button></div>}
    {!state.connected ? <section className="ww-wiki-empty"><span>▤</span><h2>等待连接 DSH 宿主</h2><p>连接后即可读取当前数据库中的 Wiki 与资料。</p><button onClick={configure}>查看数据库配置</button></section>
      : state.busy.overview ? <p className="ww-wiki-loading" role="status">正在读取项目…</p>
      : !state.overview?.ready ? <section className="ww-wiki-empty"><h2>{state.error ? '暂时无法读取资料库' : '请先连接数据库'}</h2><p>{state.overview?.message}</p><button onClick={configure}>配置数据库</button></section>
      : !state.overview.projects.length ? <section className="ww-wiki-empty"><span>▤</span><h2>数据库中还没有项目</h2><p>已有项目及资料写入当前数据库后，将在这里显示。</p><button onClick={configure}>查看数据库配置</button></section>
      : <>
        <div className="ww-wiki-toolbar"><label className="ww-wiki-project">当前项目<select aria-label="当前项目" value={state.projectId} onChange={event => controller.setProject(event.target.value)}>{state.overview.projects.map(project => <option key={project.id} value={project.id}>{project.title}{project.status === 'archived' ? '（已归档）' : ''}</option>)}</select></label>
          <form className="ww-wiki-search" onSubmit={event => { event.preventDefault(); controller.search() }}><input aria-label="搜索 Wiki 和资料" placeholder="搜索标题或正文，支持中文" maxLength={200} value={state.draft} onChange={event => controller.setDraft(event.target.value)}/><button type="submit" disabled={!ready}>搜索</button></form></div>
        <div className="ww-wiki-filters"><div className="ww-wiki-tabs" aria-label="内容类型"><button aria-pressed={state.kind === 'pages'} onClick={() => controller.setKind('pages')}>Wiki 页面</button><button aria-pressed={state.kind === 'sources'} onClick={() => controller.setKind('sources')}>资料库</button></div><label><input type="checkbox" checked={state.includeInactive} onChange={event => controller.setInactive(event.target.checked)}/>包含已失效资料</label></div>
        <div className={`ww-wiki-layout ${state.detail || state.busy.detail ? 'ww-wiki-layout-reading' : ''}`}>
          <section className="ww-wiki-listpane" aria-label={`${label}列表`} aria-busy={loading}><div className="ww-wiki-list-heading"><strong>{state.query ? `“${state.query}”` : '全部内容'}</strong><span>{state.listing ? `${state.listing.total} 项` : '…'}</span></div>
            <p className="ww-wiki-search-help">{state.query ? '按当前分类的标题和正文匹配关键词。' : '按最近保存排序，仅列出每项的最新版本。'}</p>
            {loading ? <p className="ww-wiki-loading" role="status">正在读取…</p> : state.error && !state.listing ? <div className="ww-wiki-list-empty"><h3>列表暂时无法读取</h3><p>请检查上方提示并重新加载。</p></div> : !state.listing?.items.length ? <div className="ww-wiki-list-empty"><h3>{state.query ? '没有匹配内容' : `还没有${label}`}</h3><p>{state.query ? '试试更短的关键词，或切换另一分类。' : state.kind === 'pages' ? '页面保存到当前项目后，即可在此查看正文和来源。' : '原始资料和解析文本写入当前项目后，将在这里显示。'}</p>{state.kind === 'pages' && <button onClick={() => controller.setKind('sources')}>浏览资料库 →</button>}</div>
              : <ul className="ww-wiki-items">{state.listing.items.map(item => <li key={item.ref.versionId}><button aria-current={state.detail?.record.ref.versionId === item.ref.versionId ? 'true' : undefined} onClick={() => { void controller.open(item.ref) }}><span className="ww-wiki-item-title">{item.title}</span><Badges record={item}/><span className="ww-wiki-item-meta">{date(item.createdAt)}<span>{size(item.byteLength)}</span></span></button></li>)}</ul>}
            {state.listing && state.listing.total > 30 && <div className="ww-wiki-pagination"><button disabled={state.offset === 0 || loading} onClick={() => controller.paginate(Math.max(0, state.offset - 30))}>上一页</button><span>{Math.floor(state.offset / 30) + 1} / {Math.ceil(state.listing.total / 30)}</span><button disabled={state.offset + 30 >= state.listing.total || loading} onClick={() => controller.paginate(state.offset + 30)}>下一页</button></div>}
          </section>
          <section className="ww-wiki-reader" aria-label="内容阅读" aria-busy={state.busy.detail}>
            {(state.detail || state.busy.detail) && <div className="ww-wiki-reader-nav"><button onClick={controller.closeDetail}>← 返回列表</button>{!!state.trail.length && <button onClick={controller.back}>← 返回上一条内容</button>}</div>}
            {state.busy.detail ? <p className="ww-wiki-loading" role="status">正在校验版本并读取内容…</p> : state.detail ? <Reader detail={state.detail} controller={controller}/> : <div className="ww-wiki-reader-empty"><span>W.</span><h2>从一条资料开始</h2><p>选择 Wiki 页面或资料，查看完整内容与版本来源。</p><small>资料按项目隔离 · 引用回到精确版本</small></div>}
          </section>
        </div>
      </>}
  </div>
}
