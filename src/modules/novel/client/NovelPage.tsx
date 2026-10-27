import { WorldMaterials } from './WorldMaterials.js'
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { NovelController } from './controller.js'
import { FIELDS, type FieldDefinition } from '../domain/fields.js'
import { MODULES, authority, kindLabels, latest, splitIds, statusLabels, type AssetKind, type DocumentKind, type Fields, type NovelDocument, type NovelIssue, type NovelModule } from '../contracts/index.js'

const assetLabels: Record<AssetKind, string> = { persona: '作者人格', world: '世界观', reference: '参考资料' }
const parentTypes: Partial<Record<DocumentKind, DocumentKind>> = { volume: 'outline', unit: 'volume', chapter: 'unit', body: 'chapter' }
const moduleKinds: Record<NovelModule, DocumentKind[]> = { assets: ['assets'], settings: ['settings'], outline: ['outline', 'volume'], units: ['unit'], chapters: ['chapter'], body: ['body'], characters: ['character'] }
const nameOf = (doc: NovelDocument) => latest(doc).fields.title || `未命名${kindLabels[doc.kind]}`
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="wn-empty"><span aria-hidden="true">✎</span><h3>{title}</h3>{children}</div> }

export function NovelPage({ controller }: { controller: NovelController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const file = useRef<HTMLInputElement>(null)
  const project = state.workspace.projects.find(p => p.id === state.projectId)
  const exportFile = () => {
    if (!project) return
    const blob = new Blob([controller.service.exportProject(project.id)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = `${project.title.replace(/[\\/:*?"<>|]/g, '_')}.novel.json`
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
  }
  return <section className={`wn-page ${state.module === 'body' ? 'wn-writing' : ''}`} aria-label="小说工作室">
    <div className="wn-heading"><div><span className="wn-eyebrow">NOVEL STUDIO</span><h1 id="ww-title">{project?.title ?? '让故事，从这里开始'}</h1><p>{project ? '设定、规划与正文，在同一个创作空间。' : '选择创作资产，建立属于你的小说。'}</p></div>
      <div className="wn-actions"><button onClick={() => controller.newProject()} disabled={state.busy}>＋ 新建小说</button><button onClick={() => file.current?.click()} disabled={state.busy}>导入小说</button><button onClick={exportFile} disabled={!project || state.busy}>导出已保存版本</button></div>
    </div>
    <input ref={file} className="wn-file" type="file" accept=".json,application/json" aria-label="导入小说文件" onChange={async e => {
      const input = e.currentTarget, selected = input.files?.[0]
      if (selected) {
        try { if (selected.size > 10_000_000) throw new Error('文件超过 10 MB，请缩小导入范围'); await controller.importProject(await selected.text()) }
        catch (error) { controller.reportError(error instanceof Error ? error.message : '文件读取失败') }
      }
      input.value = ''
    }}/>
    <div className="wn-session"><span><i/>会话草稿 · 未连接数据库</span><p>刷新、关闭或卸载后清空。离开前请保存并导出；导入内容需重新确认。</p>
      <label>当前小说<select aria-label="当前小说" value={state.projectId ?? ''} disabled={state.busy} onChange={e => e.target.value ? controller.selectProject(e.target.value) : controller.newProject()}><option value="">新建作品</option>{state.workspace.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
    </div>
    <nav className="wn-modules" aria-label="小说模块导航">{MODULES.map(item => <button key={item.id} disabled={state.busy} aria-current={item.id === state.module ? 'page' : undefined} onClick={() => controller.openModule(item.id)}><small>{item.step ?? '独立'}</small><strong>{item.title}</strong><span>{item.caption}</span></button>)}</nav>
    {state.error && <div className="wn-alert" role="alert">{state.error}</div>}
    {state.message && <div className="wn-notice" role="status">{state.message}</div>}
    {state.module === 'assets' ? <Assets controller={controller}/> : !project ? <Empty title="先为故事建立身份"><p>小说创建后，七个模块可随时进入。角色库独立于主流程。</p><button onClick={() => controller.openModule('assets')}>前往资产配置 →</button></Empty> : <div className="wn-workspace">
      <DocumentList controller={controller}/>
      <div className={`wn-editor-pane ${state.module === 'body' ? 'wn-body-editor' : ''}`}>{state.draft ? <Editor key={`${project.id}:${state.draft.id ?? state.draft.kind + state.draft.parentId}`} controller={controller}/> : <Empty title="选择或新建内容"><p>从左侧目录开始创作。</p></Empty>}</div>
      <Inspector controller={controller}/>
    </div>}
  </section>
}

function Assets({ controller }: { controller: NovelController }) {
  const state = controller.getSnapshot(), draft = state.draft, existing = Boolean(state.projectId)
  const fields = existing && draft ? draft.fields : state.creation
  const [assetKind, setAssetKind] = useState<AssetKind>('persona'), [assetName, setAssetName] = useState(''), [assetContent, setAssetContent] = useState('')
  const change = (key: string, value: string) => existing ? controller.edit(key, value) : controller.editCreation(key as keyof typeof state.creation, value)
  const selected = (kind: AssetKind) => state.workspace.assets.find(a => a.id === fields[kind === 'persona' ? 'personaId' : 'worldId'])
  return <div className="wn-assets-layout"><div className="wn-card"><span className="wn-eyebrow">{existing ? 'ASSET BINDINGS' : 'NEW NOVEL'}</span><h3>{existing ? '这部作品的创作资产' : '创建第一份创作档案'}</h3><p className="wn-muted">明确选择一份作者人格与一份世界观。人格约束表达，世界观提供事实。</p>
    <label className="wn-field">小说名称<input aria-label="小说名称" value={fields.title ?? ''} disabled={state.busy} onChange={e => change('title', e.target.value)} placeholder="给故事一个暂定名称"/></label>
    <div className="wn-binding-grid">{(['persona', 'world'] as const).map(kind => <div className="wn-binding" key={kind}><span className="wn-binding-number">{kind === 'persona' ? '01' : '02'}</span><h4>{assetLabels[kind]} <small>必选</small></h4><select aria-label={`选择${assetLabels[kind]}`} value={fields[kind === 'persona' ? 'personaId' : 'worldId'] ?? ''} disabled={state.busy} onChange={e => change(kind === 'persona' ? 'personaId' : 'worldId', e.target.value)}><option value="">请选择{assetLabels[kind]}</option>{state.workspace.assets.filter(a => a.kind === kind).map(a => <option key={a.id} value={a.id} disabled={!a.available}>{a.name} · v{a.revision}{!a.available && '（不可用）'}</option>)}</select>
      {selected(kind) ? <details><summary>{selected(kind)!.name} · v{selected(kind)!.revision} · 预览内容</summary><p className="wn-source-text">{selected(kind)!.content}</p></details> : <p>从右侧登记资产后，在此明确选择。</p>}</div>)}</div>
    <fieldset className="wn-reference"><legend>可选参考资料</legend>{state.workspace.assets.filter(a => a.kind === 'reference').length ? state.workspace.assets.filter(a => a.kind === 'reference').map(a => <label key={a.id}><input type="checkbox" disabled={state.busy || !a.available} checked={splitIds(fields.referenceIds).includes(a.id)} onChange={e => change('referenceIds', e.target.checked ? [...splitIds(fields.referenceIds), a.id].join(',') : splitIds(fields.referenceIds).filter(i => i !== a.id).join(','))}/>{a.name} <small>仅作参考</small></label>) : <p className="wn-muted">可先留空，之后按需添加。</p>}</fieldset>
    {existing && draft?.id && <><VersionBar controller={controller}/><p className="wn-muted">更换世界观后，依赖它的设定与剧情需复核；更换人格会影响正文表达来源。旧版本保留。</p><div className="wn-binding-impact"><strong>本次变更影响 · {controller.service.assetImpact(state.projectId!, fields).length}</strong>{controller.service.assetImpact(state.projectId!, fields).map(d => <button key={d.id} onClick={() => controller.openDocument(d.id)}>{nameOf(d)} →</button>)}</div><Issues controller={controller} issues={controller.service.check(draft.id)}/><button disabled={state.busy} onClick={() => void controller.save()}>刷新来源并另存绑定版本</button></>}
    <div className="wn-actions wn-savebar">{existing ? <><button onClick={() => void controller.save()} disabled={state.busy}>保存绑定草稿</button><button className="wn-primary" disabled={state.busy || draft?.dirty || !draft?.id} onClick={() => void controller.confirm()}>确认资产绑定</button></> : <button className="wn-primary" disabled={state.busy} onClick={() => void controller.createProject()}>{state.busy ? '正在创建…' : '创建小说并进入设定 →'}</button>}</div>
  </div><aside className="wn-card wn-asset-library"><span className="wn-eyebrow">SESSION LIBRARY</span><h3>本次会话资产</h3><p className="wn-muted">可从作者人格或世界观页面加入已发布版本，也可手动登记。加入后版本固定，请在作品中明确选择绑定。</p>
    <form onSubmit={async e => { e.preventDefault(); if (await controller.addAsset(assetKind, assetName, assetContent)) { setAssetName(''); setAssetContent('') } }}>
      <label className="wn-field">资产类型<select aria-label="资产类型" value={assetKind} disabled={state.busy} onChange={e => setAssetKind(e.target.value as AssetKind)}>{Object.entries(assetLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="wn-field">资产名称<input aria-label="资产名称" value={assetName} disabled={state.busy} onChange={e => setAssetName(e.target.value)}/></label>
      <label className="wn-field">资产内容<textarea aria-label="资产内容" value={assetContent} disabled={state.busy} onChange={e => setAssetContent(e.target.value)} rows={7} placeholder="粘贴你指定的资产原文"/></label>
      <button type="submit" disabled={state.busy}>登记资产</button>
    </form><div className="wn-asset-inventory">{state.workspace.assets.map(a => <div key={a.id}><strong>{a.name}</strong><span>{assetLabels[a.kind]} · v{a.revision}</span></div>)}</div>
  </aside></div>
}

function DocumentList({ controller }: { controller: NovelController }) {
  const state = controller.getSnapshot(), docs = controller.service.documents(state.projectId!), kinds = moduleKinds[state.module]
  const visible = docs.filter(d => kinds.includes(d.kind)), parentType = state.draft && parentTypes[state.draft.kind]
  const parents = parentType ? docs.filter(d => d.kind === parentType) : []
  const createKind = state.module === 'outline' ? 'volume' : kinds[0]!
  return <aside className="wn-list"><div className="wn-list-heading"><strong>{MODULES.find(m => m.id === state.module)?.title}</strong><span>{visible.length} 项</span></div>
    {state.module === 'outline' && <button className="wn-new" disabled={state.busy} onClick={() => controller.startNew('outline')}>全书总纲</button>}
    {!['settings', 'assets'].includes(state.module) && <button className="wn-new" disabled={state.busy} onClick={() => controller.startNew(createKind)}>＋ 新建{kindLabels[createKind]}</button>}
    {parentType && <label className="wn-parent-label">新建内容的归属<select aria-label="选择所属对象" disabled={state.busy} value={state.draft?.parentId ?? ''} onChange={e => controller.startNew(state.draft!.kind, e.target.value)}><option value="" disabled>请先创建上游</option>{parents.map(p => <option value={p.id} key={p.id}>{nameOf(p)}</option>)}</select></label>}
    <div className="wn-document-list">{visible.map(doc => <button key={doc.id} disabled={state.busy} aria-current={state.draft?.id === doc.id ? 'true' : undefined} onClick={() => controller.openDocument(doc.id)}><small>{kindLabels[doc.kind]} {['volume', 'unit', 'chapter'].includes(doc.kind) ? String(doc.order).padStart(2, '0') : ''}</small><strong>{nameOf(doc)}</strong><span>{statusLabels[latest(doc).status]} · v{latest(doc).revision}{controller.service.sourceIssues(doc).length ? ' · 待复核' : ''}</span></button>)}</div>
    {state.module === 'body' && <div className="wn-body-directory"><p>章节目录</p>{controller.service.orderedChapters(state.projectId!).map(ch => <button key={ch.id} disabled={state.busy} onClick={() => controller.startNew('body', ch.id)}>{nameOf(ch)} <span>写作 →</span></button>)}</div>}
    {!visible.length && <p className="wn-list-empty">还没有{kindLabels[createKind]}。<br/>可以先保存不完整草稿。</p>}
  </aside>
}

function VersionBar({ controller }: { controller: NovelController }) {
  const { draft, projectId } = controller.getSnapshot(), doc = draft?.id ? controller.service.document(draft.id) : undefined
  const revision = doc && latest(doc), stale = doc ? controller.service.sourceIssues(doc).length > 0 : false
  return <div className="wn-version"><span className="wn-badge">{draft?.dirty ? '尚未保存' : revision ? statusLabels[revision.status] : '新草稿'}</span>{revision && <span>v{revision.revision} · {stale ? '来源待复核' : '来源已记录'}</span>}<span>{doc?.confirmedRevision ? `权威版本 v${doc.confirmedRevision}` : '尚未确认'}</span><small>{projectId ? '当前小说范围' : ''}</small></div>
}

function Editor({ controller }: { controller: NovelController }) {
  const state = controller.getSnapshot(), draft = state.draft!, doc = draft.id ? controller.service.document(draft.id) : undefined
  const [historyVersion, setHistoryVersion] = useState(0)
  const fields = draft.kind === 'assets' ? [] : FIELDS[draft.kind], groups = [...new Set(fields.map(f => f.group))]
  const revision = doc && latest(doc), old = historyVersion && doc?.revisions.find(r => r.revision === historyVersion)
  const parent = draft.parentId ? controller.service.document(draft.parentId) : undefined
  const nextModule: Partial<Record<DocumentKind, NovelModule>> = { settings: 'outline', outline: 'outline', volume: 'units', unit: 'chapters', chapter: 'body' }
  return <>
    <div className="wn-editor-heading"><div><span className="wn-eyebrow">{draft.kind === 'body' ? 'MANUSCRIPT' : draft.kind === 'character' ? 'CHARACTER PROFILE' : 'STORY PLANNING'}</span><h3>{draft.fields.title || `新建${kindLabels[draft.kind]}`}</h3></div><small>{kindLabels[draft.kind]}</small></div>
    <VersionBar controller={controller}/>
    {parent ? <button className="wn-backlink" onClick={() => controller.openDocument(parent.id)}>来源：{nameOf(parent)} →</button> : parentTypes[draft.kind] && <p className="wn-alert">尚未选择所属{kindLabels[parentTypes[draft.kind]!] }。可先填写，保存前请创建并选择上游。</p>}
    {draft.kind === 'body' && <p className="wn-muted wn-body-note">当前支持手动写作与版本保存。AI 生成、四项评审、正式入库及写后维护尚未接入。</p>}
    {draft.kind === 'character' && <p className="wn-muted">角色档案可独立创建。此处维护初始设定，规划中的预期变化不属于已发生事实。</p>}
    <form onSubmit={e => { e.preventDefault(); void controller.save() }}>
      {groups.map(group => <fieldset className={`wn-field-group ${draft.kind === 'body' && group === '正文' ? 'wn-manuscript' : ''}`} key={group}><legend>{group}</legend><div className="wn-fields">{fields.filter(f => f.group === group).map(field => <Field key={field.key} field={field} fields={draft.fields} controller={controller}/>)}</div></fieldset>)}
      {draft.kind === 'body' && <div className="wn-word-count">{Array.from((draft.fields.text ?? '').replace(/\s/g, '')).length.toLocaleString('zh-CN')} 字符（不含空白）<span>仅保存草稿，不代表通过评审或正式入库</span></div>}
      <div className="wn-savebar"><div className="wn-actions"><button type="submit" className="wn-primary" disabled={state.busy}>{state.busy ? '处理中…' : '保存草稿'}</button>{doc && <button type="button" disabled={state.busy} onClick={() => void controller.save()}>刷新来源并另存版本</button>}{draft.kind !== 'body' && <button type="button" disabled={state.busy || draft.dirty || !doc || revision?.status === 'confirmed'} onClick={() => void controller.confirm()}>确认此版本</button>}</div><small>带 * 的内容在确认时必填。语义与创作取舍由作者核验。</small></div>
    </form>
    {doc && <>
      <div className="wn-editor-links">{nextModule[draft.kind] && <button onClick={() => {
        if (draft.kind === 'outline') controller.startNew('volume', doc.id)
        else if (draft.kind === 'volume') controller.startNew('unit', doc.id)
        else if (draft.kind === 'unit') controller.startNew('chapter', doc.id)
        else if (draft.kind === 'chapter') controller.startNew('body', doc.id)
        else controller.openModule(nextModule[draft.kind]!)
      }}>前往{draft.kind === 'outline' ? '分卷剧情' : MODULES.find(m => m.id === nextModule[draft.kind])?.title} →</button>}
      {revision?.status === 'confirmed' ? <button disabled={state.busy || draft.dirty} onClick={() => void controller.setStatus('revoked')}>撤销当前确认</button> : ['draft', 'candidate'].includes(revision?.status ?? '') && <button disabled={state.busy || draft.dirty} onClick={() => void controller.setStatus('rejected')}>拒绝此候选</button>}</div>
      <details className="wn-history"><summary>版本历史与比较 · {doc.revisions.length} 个版本</summary><label>历史版本<select aria-label="选择历史版本" value={historyVersion} onChange={e => setHistoryVersion(Number(e.target.value))}><option value={0}>选择要比较的历史版本</option>{doc.revisions.map(r => <option key={r.revision} value={r.revision}>v{r.revision} · {statusLabels[r.status]} · {r.createdAt.slice(0, 16)}</option>)}</select></label>{old && <div className="wn-comparison"><section><h4>历史 v{old.revision}</h4>{fields.filter(f => old.fields[f.key] !== draft.fields[f.key]).map(f => <div key={f.key}><b>{f.label}</b><pre>{old.fields[f.key] || '（空）'}</pre></div>)}</section><section><h4>当前编辑内容</h4>{fields.filter(f => old.fields[f.key] !== draft.fields[f.key]).map(f => <div key={f.key}><b>{f.label}</b><pre>{draft.fields[f.key] || '（空）'}</pre></div>)}</section>{fields.every(f => old.fields[f.key] === draft.fields[f.key]) && <p>内容相同，来源或确认状态可能不同。</p>}</div>}</details>
    </>}
  </>
}

function Field({ field, fields, controller }: { field: FieldDefinition; fields: Fields; controller: NovelController }) {
  const state = controller.getSnapshot(), value = fields[field.key] ?? '', change = (value: string) => controller.edit(field.key, value)
  return <label className={`wn-field ${field.type === 'text' || field.type === 'number' || field.type === 'select' ? 'wn-short' : ''}`}><span>{field.label}{field.required && <small> *</small>}</span>
    {field.type === 'characters' ? <div className="wn-character-select">{controller.service.documents(state.projectId!, 'character').map(ch => <span key={ch.id}><input type="checkbox" aria-label={`引用角色 ${nameOf(ch)}`} disabled={state.busy} checked={splitIds(value).includes(ch.id)} onChange={e => change(e.target.checked ? [...splitIds(value), ch.id].join(',') : splitIds(value).filter(i => i !== ch.id).join(','))}/>{nameOf(ch)} <small>{authority(ch) ? '已确认档案' : '未确认'}</small></span>)}{!controller.service.documents(state.projectId!, 'character').length && <span>暂无角色，可从独立角色库建档。</span>}</div> : field.type === 'select' ? <select aria-label={field.label} disabled={state.busy} value={value} onChange={e => change(e.target.value)}><option value="">请选择</option>{field.options?.map(o => <option key={o}>{o}</option>)}</select> : field.type === 'text' || field.type === 'number' ? <input aria-label={field.label} type={field.type} min={field.type === 'number' ? 1 : undefined} step={field.type === 'number' ? 1 : undefined} disabled={state.busy} value={value} onChange={e => change(e.target.value)}/> : <textarea aria-label={field.label} disabled={state.busy} value={value} rows={field.key === 'text' ? 24 : ['narrative', 'chapterPlot', 'synopsis'].includes(field.key) ? 7 : 3} onChange={e => change(e.target.value)}/>}
    {field.hint && <small className="wn-field-hint">{field.hint}</small>}
  </label>
}

function Issues({ controller, issues }: { controller: NovelController; issues: NovelIssue[] }) {
  if (!issues.length) return <p className="wn-check-ok">结构与来源检查已满足，创作内容仍需作者核验。</p>
  return <div className="wn-issues"><strong>待处理 · {issues.length}</strong><ul>{issues.map((issue, i) => <li key={`${issue.code}:${i}`}><span>{issue.message}</span>{issue.targetId && issue.targetId !== controller.getSnapshot().draft?.id ? <button onClick={() => controller.openDocument(issue.targetId!)}>查看来源 →</button> : issue.module !== controller.getSnapshot().module && <button onClick={() => controller.openModule(issue.module)}>前往{MODULES.find(m => m.id === issue.module)?.title} →</button>}</li>)}</ul></div>
}

function Inspector({ controller }: { controller: NovelController }) {
  const state = controller.getSnapshot(), draft = state.draft, doc = draft?.id ? controller.service.document(draft.id) : undefined
  const issues = doc ? controller.service.check(doc.id) : state.issues
  const revision = doc && latest(doc), impact = doc && controller.service.impacted(doc.id)
  const parent = draft?.parentId ? controller.service.document(draft.parentId) : undefined
  const coverage = parent && ['unit', 'volume'].includes(parent.kind) ? controller.service.coverage(parent.id) : undefined
  return <aside className="wn-inspector"><h3>创作参考</h3><p className="wn-muted">依据明确，逐步推进。</p>
    <WorldMaterials controller={controller.worldContext}/>
    <section><h4>确认前检查</h4>{doc ? <Issues controller={controller} issues={issues}/> : <p>保存草稿后查看必填、来源与交接检查。缺少上游时仍可编辑。</p>}{draft?.dirty && <p>检查基于已保存版本，当前编辑尚未检查。</p>}</section>
    {coverage && <section><h4>上游事件覆盖</h4><p>{coverage.complete ? '当前范围分配完整' : '当前范围尚未完成'}</p><p>未覆盖：{coverage.missing.join('、') || '无'}</p>{coverage.repeated.length > 0 && <p>多次引用：{coverage.repeated.join('、')}，请核对片段职责。</p>}<p>末项出口：{coverage.exitMatches ? '与上游一致' : '待核验'}</p></section>}
    <section><h4>精确来源 · {revision?.sourceRefs.length ?? 0}</h4>{revision?.sourceRefs.map(ref => {
      const source = ref.type === 'document' ? state.workspace.documents.find(d => d.id === ref.objectId) : undefined
      const asset = ref.type === 'asset' ? state.workspace.assets.find(a => a.id === ref.objectId) : undefined
      const sourceRevision = source?.revisions.find(r => r.revision === ref.revision)
      return <details className="wn-source" key={`${ref.type}:${ref.objectId}`}><summary>{sourceRevision?.fields.title || asset?.name || ref.objectId}<small>v{ref.revision} · {ref.purpose === 'writing_style' ? '表达风格' : ref.purpose === 'reference' ? '参考' : '剧情事实'}</small></summary>{source && <button onClick={() => controller.openDocument(source.id)}>打开来源 →</button>}<div className="wn-source-text">{asset?.content ?? (sourceRevision ? Object.entries(sourceRevision.fields).filter(([key]) => ['chapterPlot', 'narrative', 'initialState', 'background', 'abilities', 'premise', 'pov', 'minWords', 'maxWords'].includes(key)).map(([key, value]) => `${source && source.kind !== 'assets' ? FIELDS[source.kind].find(f => f.key === key)?.label ?? key : key}：${value}`).join('\n\n') : '来源不存在')}</div><code>{ref.contentHash}</code></details>
    })}{!revision?.sourceRefs.length && <p>保存时记录已确认来源。页面浏览不会创建规划记录。</p>}</section>
    {doc && <section><h4>下游影响 · {impact?.length ?? 0}</h4><p>新版本确认后，依赖旧版的内容需要复核，历史文本保留。</p>{impact?.map(d => <button className="wn-impact" key={d.id} onClick={() => controller.openDocument(d.id)}>{nameOf(d)} →</button>)}</section>}
    <section><h4>当前能力</h4><p>手动草稿、候选导入、确认与版本追溯。</p><p>已支持按精确世界版本查询材料。AI 生成、语义评审与持久恢复待接入。</p></section>
  </aside>
}
