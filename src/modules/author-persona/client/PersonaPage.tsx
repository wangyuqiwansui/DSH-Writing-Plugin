import { useEffect, useState, useSyncExternalStore } from 'react'
import { PERSONA_SCHEMA, PROMPT_SECTIONS, type PersonaDocument, type PersonaProjection } from '../contracts/index.js'
import { codePoints, expressionText, validatePersona } from '../domain/persona.js'
import type { PersonaController } from './controller.js'

export function PersonaPage({ controller, configure, useInNovel }: { controller: PersonaController; configure(): void; useInNovel(projection: PersonaProjection): Promise<boolean> }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), [confirmed, setConfirmed] = useState(false)
  const e = state.editor, document = state.viewing?.version.document ?? e?.document, detail = state.viewing ?? e?.base
  const readonly = !!state.viewing || state.busy || !!state.pending, text = document ? expressionText(document) : ''
  const issues = document?.schemaVersion === PERSONA_SCHEMA ? validatePersona(document) : [], foreign = !!e?.instance && e.instance !== state.overview?.pluginInstanceId
  useEffect(() => setConfirmed(false), [e, state.viewing])
  const edit = (patch: Partial<PersonaDocument>) => { if (e) controller.edit({ ...e.document, ...patch }) }
  const exportFile = () => {
    const blob = new Blob([controller.export()], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob)
    const a = window.document.createElement('a'); a.href = url; a.download = `author-persona-${e?.id ?? 'draft'}.json`; a.click(); URL.revokeObjectURL(url)
  }
  const importFile = async (file: File) => {
    try {
      if (file.size > 256_000) throw new Error('导入文件超过 256 KB')
      const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer())
      controller.import(value, file.name.endsWith('.json') ? 'json' : 'text', file.name.replace(/\.[^.]+$/, '').slice(0, 120))
    } catch (error) { controller.reportError(error instanceof Error ? error.message : '文件读取失败') }
  }
  return <div className="ww-persona">
    <div className="ww-persona-intro"><p>使用一份 Prompt 模板定义作者表达。编辑、导入和发布共用同一套模板校验。</p><span className="ww-pill">统一 Prompt · 写作实测未执行</span></div>
    <div className="ww-persona-toolbar">
      <button disabled={state.busy || !!state.pending} onClick={() => controller.create()}>新建人格</button>
      <label className="ww-persona-import">导入 JSON / 文本<input aria-label="导入作者人格文件" type="file" accept=".json,.txt,.md" disabled={state.busy || !!state.pending} onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }}/></label>
      <button disabled={state.busy} onClick={() => void controller.refresh()}>{state.connected ? '刷新资料库' : '重新连接'}</button>
      <button onClick={configure}>数据库设置</button>
    </div>
    {(!state.connected || !state.overview?.ready) && <p role="status">{state.overview?.message ?? '作者人格宿主服务尚未就绪。本地草稿可继续编辑和导出，连接成功后才能保存。'}</p>}
    {state.error && <p className="ww-persona-notice" role="alert">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}
    {state.pending && <div className="ww-persona-notice"><p>提交结果待核对。请保留当前页面，恢复原数据库连接后核对。</p><button disabled={state.busy || !state.connected} onClick={() => void controller.reconcile()}>核对提交结果</button></div>}
    <div className="ww-persona-layout">
      <aside aria-label="作者人格资料库"><h2>我的人格 <small>{state.overview?.personas.length ?? 0}</small></h2>
        {!state.overview?.personas.length && <p>还没有保存的人格。</p>}
        {state.overview?.personas.map(item => <button key={item.personaId} disabled={state.busy || !!state.pending} aria-pressed={e?.id === item.personaId && !foreign} onClick={() => void controller.open(item.personaId)}><strong>{item.name}</strong><small>v{item.revision} · {item.status === 'published' ? '已发布' : '草稿'}{item.published && item.status === 'draft' ? ` · 已发布 v${item.published.revision}` : ''}</small></button>)}
        {state.buffers.some(b => b.dirty) && <><h3>本地草稿</h3>{state.buffers.filter(b => b.dirty).map(b => <button key={`${b.instance}:${b.id}`} disabled={state.busy || !!state.pending} onClick={() => controller.resume(b)}>{b.document.name || '未命名人格'}<small>{b.instance && b.instance !== state.overview?.pluginInstanceId ? '属于另一数据库' : '未保存的编辑'}</small></button>)}</>}
      </aside>
      <section className="ww-persona-editor" aria-label="作者人格编辑器">
        {!document ? <div className="ww-persona-empty"><h2>让表达有一份稳定的约定</h2><p>从统一 Prompt 模板开始，或导入已有内容并完成模板校验。每次发布都保留独立版本。</p><button onClick={() => controller.create()} disabled={state.busy || !!state.pending}>开始创建人格</button></div> : <>
          <div className="ww-persona-section-head"><h2>{state.viewing ? `历史版本 v${detail?.version.revision} · 只读` : e?.base ? `编辑人格 · 基于 v${e.base.version.revision}` : '新人格草稿'}</h2><span>{e?.dirty && !state.viewing ? '尚未保存' : detail?.version.status === 'published' ? '已发布' : '草稿'}</span></div>
          {foreign && <p className="ww-persona-notice">草稿属于另一数据库。返回原数据库继续编辑，或另存为新人格。</p>}
          {document.schemaVersion !== PERSONA_SCHEMA && <p className="ww-persona-notice">这是旧版历史原文，只读保留。另存为新人格时将转为统一 Prompt 草稿。</p>}
          <fieldset disabled={readonly}>
            <label>人格名称<input aria-label="人格名称" value={document.name} maxLength={120} onChange={v => edit({ name: v.target.value })}/></label>
            <label>说明<textarea aria-label="人格说明" rows={2} value={document.description} maxLength={2000} placeholder="适合什么作品、表达什么气质" onChange={v => edit({ description: v.target.value })}/></label>
            <p className="ww-persona-template-help">模板段落：{PROMPT_SECTIONS.map(s => s.title).join(' → ')}。请保留二级标题，填写每段要求并替换占位内容。</p>
            <label>作者人格 Prompt<textarea className="ww-persona-full" aria-label="作者人格 Prompt" rows={20} value={text} onChange={v => edit({ prompt: v.target.value })}/></label>
            <label>来源备注<textarea aria-label="来源备注" rows={2} value={document.sourceNote} maxLength={2000} placeholder="可记录来源，但备注不代表来源已审核" onChange={v => edit({ sourceNote: v.target.value })}/></label>
          </fieldset>
          <details className="ww-persona-preview"><summary>交付文本预览 · {codePoints(text)} 字符</summary><p>仅用于写作表达，不赋予工具或剧情事实权限。Prompt 保留原文，不自动截断。</p><pre>{text || '暂无表达文本'}</pre></details>
          {issues.length > 0 ? <ul aria-label="模板校验">{issues.map((i, index) => <li key={`${i.code}:${i.path}:${index}`}>{i.message}</li>)}</ul> : document.schemaVersion === PERSONA_SCHEMA && <p role="status">统一 Prompt 模板校验通过</p>}
          <div className="ww-persona-toolbar">
            <button disabled={readonly || !state.overview?.ready || foreign} onClick={() => void controller.save('save')}>保存草稿</button>
            <button disabled={!e || state.busy || !!state.pending} onClick={() => controller.fork()}>另存为新人格</button>
            <button onClick={exportFile}>导出当前文档</button>
            {state.viewing && <button disabled={state.busy} onClick={() => controller.view(null)}>返回本地编辑</button>}
          </div>
          {!state.viewing && <div className="ww-persona-release"><label><input type="checkbox" checked={confirmed} disabled={readonly || !!e?.dirty || !e?.base} onChange={v => setConfirmed(v.target.checked)}/>我确认发布当前已保存版本，仅作为人工表达配置</label><button disabled={readonly || !!e?.dirty || !confirmed || !!issues.length || foreign || !state.overview?.ready} onClick={() => void controller.save('publish', confirmed)}>发布人格</button></div>}
          <div className="ww-persona-toolbar"><button disabled={state.busy || !!state.pending || detail?.version.status !== 'published' || (!state.viewing && !!e?.dirty) || foreign} onClick={async () => { const projection = await controller.projection(); if (projection) await useInNovel(projection) }}>加入小说资产</button><small>加入本次小说会话后需明确选择绑定。新版本不会替换已有绑定。</small></div>
          <div className="ww-persona-history"><div className="ww-persona-section-head"><h3>版本记录</h3><button disabled={state.busy || !!state.pending || !e?.base || foreign} onClick={() => void controller.loadHistory()}>刷新历史</button></div>{state.history.map(d => <button key={d.ref.versionId} disabled={state.busy || !!state.pending} onClick={() => controller.view(d)}>v{d.version.revision} · {d.version.status === 'published' ? '已发布' : '草稿'} · {new Date(d.version.createdAt).toLocaleString()}</button>)}</div>
        </>}
      </section>
    </div>
  </div>
}
