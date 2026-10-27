import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { RuleContent, RuleLevel, RuleRecord, QualityReport, Check, ReportDetail, Span } from '../contracts.js'
import type { QualityController } from './controller.js'

const executionLabel: Record<QualityReport['execution'], string> = { running: '检测中', succeeded: '已完成', failed: '执行失败', unknown: '结果未知', cancelled: '已取消' }
const verdictLabel: Record<QualityReport['verdict'], string> = { not_evaluated: '未完成评估', passed: '所选检查通过', issues_found: '发现问题', needs_review: '待复核' }
const checkLabel: Record<Check['status'], string> = { clear: '通过', issue: '问题', needs_review: '待复核', not_applicable: '不适用 · 待确认' }
const ruleLabel = { draft: '草稿', active: '已启用', retired: '已停用' }
const initialRule: RuleContent = { title: '', description: '', dimension: 'body', checkType: 'deterministic', detector: 'forbidden_literal', literal: '', source: '手动制定' }
function RuleEditor({ controller, before, close }: { controller: QualityController; before: RuleRecord | null; close: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [content, setContent] = useState<RuleContent>(before ? { title: before.current.title, description: before.current.description, dimension: before.current.dimension,
    checkType: before.current.checkType, detector: before.current.detector, literal: before.current.literal, source: before.current.source } : initialRule)
  const level: RuleLevel = before?.current.level ?? state.level
  const set = (patch: Partial<RuleContent>) => setContent({ ...content, ...patch })
  return <form className="wq-editor ww-card" onSubmit={async event => { event.preventDefault(); const result = await controller.saveRule(content, level, before); if (result) close() }}>
    <div className="ww-section-heading"><h2>{before ? '保存规则新版本' : '新建规则'}</h2><button type="button" onClick={close}>关闭</button></div>
    <p className="wq-muted">保存为草稿后，可在列表中启用。已有生效版本会继续生效，直到新版本启用或规则停用。</p>
    <div className="wq-tags"><span className="ww-pill">{level === 'L0' ? 'L0 · 全局规则' : 'L1 · 当前项目'}</span><span className="ww-pill">适用内容：正文</span></div>
    <label>规则名称<input required maxLength={120} value={content.title} onChange={e => set({ title: e.target.value })} placeholder="例如：不保留过程说明"/></label>
    <label>规则说明<textarea required maxLength={4000} rows={3} value={content.description} onChange={e => set({ description: e.target.value })} placeholder="描述检查要求和适用边界"/></label>
    <div className="wq-form-grid"><label>检查方式<select value={content.checkType} onChange={e => { const checkType = e.target.value as RuleContent['checkType']; set({ checkType, detector: checkType === 'semantic' ? null : 'forbidden_literal', literal: '' }) }}><option value="deterministic">精确文本检测</option><option value="semantic">模型语义审阅</option><option value="observation">文本提示 · 命中后待复核</option></select></label>
      {content.checkType !== 'semantic' && <label>匹配条件<select value={content.detector ?? 'forbidden_literal'} onChange={e => set({ detector: e.target.value as RuleContent['detector'] })}><option value="forbidden_literal">不应包含</option><option value="required_literal">必须包含</option></select></label>}</div>
    {content.checkType !== 'semantic' && <label>精确匹配文本<input aria-label="精确匹配文本" required maxLength={300} value={content.literal} onChange={e => set({ literal: e.target.value })}/><small>逐字匹配，不运行正则表达式或脚本。</small></label>}
    <label>来源说明<input required maxLength={2000} value={content.source} onChange={e => set({ source: e.target.value })} placeholder="例如：作者约定 / 编辑意见 / 资料名称与章节"/></label>
    <div className="wq-actions"><button className="wq-primary" disabled={state.busy.mutation}>保存草稿</button><button type="button" onClick={close}>取消</button></div>
  </form>
}
function ReportView({ detail, controller }: { detail: ReportDetail; controller: QualityController }) {
  const [selected, setSelected] = useState<Span | null>(null)
  const report = detail.report, points = [...report.target.text]
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { panel.current?.scrollIntoView({ block: 'start' }) }, [report.id])
  return <section ref={panel} className="wq-report ww-card" aria-label="本次检测结果">
    <div className="ww-section-heading"><div><span className="ww-eyebrow">本次检测结果</span><h2>{report.target.title}</h2></div><button onClick={controller.closeReport}>关闭结果</button></div>
    <div className="wq-tags"><span className="ww-pill">{executionLabel[report.execution]}</span><span className="ww-pill">{verdictLabel[report.verdict]}</span><span className="ww-pill">{report.mode === 'deterministic' ? '仅机器检测' : report.mode === 'semantic' ? '仅语义审阅' : '机器 + 语义'}</span><span className="ww-pill">{detail.current ? '当前版本' : '版本已变化'}</span></div>
    <p className="wq-muted">{detail.currentReason} 目标 v{report.target.ref.revision} · {new Date(report.createdAt).toLocaleString()}</p>
    {report.error && <p role="alert" className="wq-alert">{report.error}</p>}
    {report.execution === 'running' && <div className="wq-actions"><button onClick={() => void controller.cancelReport(report.id)}>停止并记录状态</button><button onClick={() => void controller.openReport(report.id)}>刷新本次结果</button></div>}
    <div className="wq-report-grid"><div className="wq-checks">{report.checks.map(check => <article key={check.id} className={`wq-check wq-${check.status}`}>
      <div className="ww-section-heading"><h3>{check.title}</h3><span className="ww-pill">{checkLabel[check.status]}</span></div><p>{check.message}</p>
      {check.rule && <small>{check.rule.level} · 规则 v{check.rule.version} · 来源：{check.rule.source}</small>}
      {check.evidence.map((span, index) => <button className="wq-quote" key={index} onClick={() => setSelected(span)} title="定位报告中的原始版本"><q>{span.quote}</q><small>定位原文 {span.start}–{span.endExclusive} ↗</small></button>)}
    </article>)}</div><div className="wq-original"><div className="ww-section-heading"><h3>检测原文 · 只读</h3>{selected && <button onClick={() => setSelected(null)}>清除定位</button>}</div>
      {selected && <p className="wq-muted">已定位：第 {selected.start}–{selected.endExclusive} 个 Unicode 码点。</p>}
      <pre>{selected ? <>{points.slice(0, selected.start).join('')}<mark ref={node => node?.scrollIntoView({ block: 'nearest' })}>{points.slice(selected.start, selected.endExclusive).join('')}</mark>{points.slice(selected.endExclusive).join('')}</> : report.target.text}</pre></div></div>
    <details><summary>版本与检测记录</summary><dl className="wq-meta"><dt>报告</dt><dd>{report.id}</dd><dt>目标摘要</dt><dd>{report.target.ref.contentHash}</dd><dt>检测器</dt><dd>{report.detectorVersion}</dd><dt>模型</dt><dd>{report.model ? JSON.stringify(report.model) : '未调用'}</dd></dl>{report.rawResponse !== null && <><h3>模型原始返回</h3><pre className="wq-raw">{report.rawResponse}</pre></>}</details>
  </section>
}
export function QualityPage({ controller, configure }: { controller: QualityController; configure: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [editor, setEditor] = useState<RuleRecord | 'new' | null>(null)
  const rulesView = state.tab === 'rules', busy = !!state.busy.list
  const locked = !!state.busy.detect || !!state.busy.mutation
  const listing = rulesView ? state.rules : state.targets
  const needsProject = !rulesView || state.level === 'L1'
  const setView = (tab: 'rules' | 'detect') => { setEditor(null); controller.setTab(tab) }
  return <div className="wq-page">
    <div className="wq-intro"><p>管理正文检查规则，核对章节内容，定位每一处问题。</p><button onClick={() => { setEditor(null); void controller.refresh() }} disabled={state.busy.overview || locked}>刷新</button></div>
    <div className="wq-kind-card"><div><strong>正文质量检测</strong><p>检查已保存的章节正文，结合全局规范与项目约定，保留精确原文证据。</p></div><div className="wq-actions"><button aria-pressed={rulesView} onClick={() => setView('rules')} disabled={locked}>规则管理</button><button className={!rulesView ? 'wq-primary' : ''} aria-pressed={!rulesView} onClick={() => setView('detect')} disabled={locked}>检测正文</button></div></div>
    {state.error && <p className="wq-alert" role="alert">{state.error}</p>}{state.notice && <p className="wq-notice" role="status">{state.notice}</p>}
    {!state.connected ? <section className="wq-empty"><h2>质量检测服务未连接</h2><p>启用质量检测插件后即可使用。</p></section>
      : state.busy.overview ? <p role="status">正在读取检测环境…</p>
      : !state.overview?.ready ? <section className="wq-empty"><h2>{state.overview ? '数据库尚未就绪' : '质量检测暂不可用'}</h2><p>{state.overview?.message ?? '请确认插件已经启用，然后刷新。'}</p><button onClick={configure}>配置数据库</button></section> : <>
      {rulesView && <>
        <div className="wq-section-title"><h2>规则层级</h2><p>L0 统一正文规范，L1 补充当前项目要求；只有已启用的规则参与检测。</p></div>
        <div className="wq-layer-grid" role="tablist" aria-label="质量规则层级">{([
          ['L0', 'L0 Policy', '全局规则', '所有作品共用的正文规范与检查要求。'],
          ['L1', 'L1 Project', '项目规则', '绑定具体作品，维护当前项目的正文约定。'],
        ] as const).map(([level, title, label, description]) => <button key={level} role="tab" aria-label={`${title} · ${label}`} aria-selected={state.level === level} aria-controls="wq-rule-panel" id={`wq-tab-${level}`} disabled={locked} onClick={() => { setEditor(null); controller.setLevel(level) }}><strong>{title}<span>{label}</span></strong><p>{description}</p></button>)}</div>
      </>}
      <section id={rulesView ? 'wq-rule-panel' : undefined} role={rulesView ? 'tabpanel' : undefined} aria-labelledby={rulesView ? `wq-tab-${state.level}` : undefined}>
        <div className="wq-section-title"><h2>{rulesView ? `正文质量检测 / ${state.level === 'L0' ? 'L0 Policy' : 'L1 Project'}` : '选择章节正文'}</h2><span className="ww-pill">{listing ? `${listing.total} ${rulesView ? '条规则' : '个正文版本'}` : rulesView ? state.level === 'L0' ? '全局规则空间' : '项目规则空间' : '正文版本'}</span></div>
        {needsProject && <div className="wq-toolbar"><label>当前项目<select aria-label="当前项目" value={state.projectId} disabled={locked} onChange={e => { setEditor(null); controller.setProject(e.target.value) }}><option value="">请选择项目</option>{state.overview.projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><p className="wq-muted">{rulesView ? '项目规则只在当前作品中生效。' : '读取当前数据库已保存的章节正文。'}</p></div>}
        {!needsProject || state.projectId ? <>
          <form className="wq-search" onSubmit={event => { event.preventDefault(); controller.search() }}><input aria-label="搜索质量检测" value={state.draft} onChange={e => controller.setDraft(e.target.value)} placeholder={rulesView ? '搜索规则名称、内容或来源' : '搜索章节名称'} disabled={locked}/><button disabled={busy || locked}>搜索</button>
            {rulesView && <><select aria-label="规则状态筛选" value={state.ruleStatus} disabled={locked} onChange={e => controller.setRuleStatus(e.target.value as typeof state.ruleStatus)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="active">已启用</option><option value="retired">已停用</option></select><button type="button" className="wq-primary" disabled={locked} onClick={() => setEditor('new')}>新建规则</button></>}
          </form>
          {editor !== null && rulesView && <RuleEditor key={editor === 'new' ? `new:${state.level}:${state.projectId}` : editor.current.versionId} controller={controller} before={editor === 'new' ? null : editor} close={() => setEditor(null)}/>}
          {!rulesView && <div className="wq-detection-mode"><label>检查范围<select value={state.mode} disabled={locked || !!state.pendingOperationId} onChange={e => controller.setMode(e.target.value as typeof state.mode)}><option value="deterministic">机器检测</option><option value="combined">机器 + 语义审阅</option><option value="semantic">仅语义审阅</option></select></label><p>先预览正文与生效规则，再发起检测。语义审阅使用顶部所选模型。</p></div>}
          {busy && <p role="status">正在读取…</p>}
          {!busy && listing?.total === 0 && <section className="wq-empty"><h2>{state.query ? '没有匹配的记录' : rulesView ? '还没有规则' : '没有可检测的正文版本'}</h2><p>{rulesView ? '创建正文检查规则，保存为草稿并启用后即可参与检测。' : '写作模块保存章节正文后，会出现在这里。'}</p></section>}
          <div className="wq-list" aria-busy={busy}>
            {rulesView && state.rules?.items.map((rule, index) => <article className="wq-rule-row" key={rule.id}><span className="wq-rule-number">{String(state.offset + index + 1).padStart(2, '0')}</span><div className="wq-rule-content"><div className="wq-rule-title"><h3>{rule.current.title}</h3><span className="ww-pill">{ruleLabel[rule.status]}</span><span className="ww-pill">{rule.current.checkType === 'semantic' ? '语义审阅' : rule.current.checkType === 'observation' ? '文本提示' : '精确文本'}</span></div><p>{rule.current.description}</p><small>{rule.current.level} · v{rule.current.version} · 来源：{rule.current.source}{rule.active && rule.active.versionId !== rule.current.versionId ? ` · 生效版本 v${rule.active.version}` : ''}</small><div className="wq-actions"><button disabled={locked} onClick={() => setEditor(rule)}>编辑</button><button disabled={locked || rule.active?.versionId === rule.current.versionId} onClick={() => void controller.changeRule(rule, 'active')}>启用</button><button disabled={locked || !rule.active} onClick={() => void controller.changeRule(rule, 'retired')}>停用</button></div></div></article>)}
            {!rulesView && state.targets?.items.map(target => <article className="wq-row" key={target.ref.versionId}><div><span className="ww-pill">章节正文 · v{target.ref.revision}</span><h3>{target.title}</h3><small>预览当前版本与生效规则后开始检测</small></div><button disabled={locked || !!state.busy.prepare || !!state.pendingOperationId} onClick={() => void controller.prepare(target)}>预览检测</button></article>)}
          </div>
          {listing && listing.total > 0 && <div className="wq-pagination"><span>共 {listing.total} 条 · {Math.floor(state.offset / 30) + 1} / {Math.ceil(listing.total / 30)} 页</span><button disabled={!state.offset || busy || locked} onClick={() => controller.paginate(Math.max(0, state.offset - 30))}>上一页</button><button disabled={state.offset + 30 >= listing.total || busy || locked} onClick={() => controller.paginate(state.offset + 30)}>下一页</button></div>}
        </> : <section className="wq-empty"><h2>{state.overview.projects.length ? '选择一个写作项目' : '数据库中还没有项目'}</h2><p>{rulesView ? '选择作品后管理 L1 项目规则；L0 全局规则无需项目即可维护。' : '已有项目和章节正文写入当前数据库后，即可在此检测。'}</p><button onClick={() => { setEditor(null); controller.setLevel('L0') }}>管理全局规则</button></section>}
      </section>
      {state.prepared && !rulesView && <section className="wq-prepared ww-card"><h2>检测范围确认</h2><p>{state.prepared.target.title} · v{state.prepared.target.ref.revision} · {[...state.prepared.target.text].length} 字符</p><p>基础检查 {state.prepared.checks.filter(check => !check.rule).length} 项，已启用规则 {state.prepared.rules.length} 条。</p><ul>{state.prepared.rules.map(rule => <li key={rule.versionId}>{rule.level} · {rule.title} · v{rule.version}{rule.checkType === 'semantic' ? ' · 语义规则' : ''}</li>)}</ul>{!state.prepared.rules.length && <p className="wq-muted">目前没有生效规则，本次只执行基础检查。</p>}{state.mode !== 'deterministic' && <p className="wq-muted">语义审阅会发送所选正文及生效规则，单次调用，不自动重试。</p>}<div className="wq-actions"><button className="wq-primary" disabled={locked || !!state.pendingOperationId} onClick={() => void controller.detect()}>{state.busy.detect ? '检测中…' : '开始检测'}</button>{state.busy.detect && <button onClick={controller.stop}>停止检测</button>}</div></section>}
      {state.pendingOperationId && !state.busy.detect && <div className="wq-notice"><p>本次检测结果尚未确认。核对只读取已提交记录，不会再次调用模型。</p><button disabled={state.busy.recovery} onClick={() => void controller.recoverDetection()}>核对本次结果</button></div>}
      {state.busy.detail && <p role="status">正在读取检测结果…</p>}{!state.busy.detail && !state.detail && state.currentReportId && <button onClick={() => void controller.openReport(state.currentReportId!)}>重新读取本次结果</button>}{state.detail && <ReportView key={state.detail.report.id} detail={state.detail} controller={controller}/>}
    </>}
  </div>
}
