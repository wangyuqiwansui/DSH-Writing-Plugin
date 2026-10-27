import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { type WorldDetail, type WorldDocument, type WorldRecord } from '../contracts/index.js'
import { recordPath } from '../domain/tree.js'
import { SettingTree } from './SettingTree.js'
import { WorldDatasetBuilder } from '../../test-datasets/client.js'
import { type WorldController, type WorldTab } from './controller.js'

const tabs: [WorldTab, string][] = [['scope','世界范围'],['records','设定目录']]
function Field({ label, value, onChange, multiline = false, placeholder = '' }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  return <label className="wb-field"><span>{label}</span>{multiline ? <textarea aria-label={label} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}/> : <input aria-label={label} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}/>}</label>
}
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="wb-field"><span>{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{children}</select></label>
}
function RecordEditor({ record: r, doc, controller }: { record: WorldRecord; doc: WorldDocument; controller: WorldController }) {
  const update = (patch: Partial<WorldRecord>) => controller.edit(d => ({ ...d, records: d.records.map(x => x.id === r.id ? { ...x, ...patch } : x) }))
  return <div className="wb-editor wb-setting-editor">
    <div className="wb-section-title"><div><span className="ww-eyebrow">SETTING</span><h2>{r.name || '新的设定'}</h2></div><button className="wb-subtle" onClick={() => controller.removeRecord(r.id)}>删除设定</button></div>
    <p className="wb-record-breadcrumb" title={recordPath(doc, r.id)}>设定目录 / {recordPath(doc, r.id)}</p>
    <Select label="上级设定" value={r.parentId ?? ''} onChange={parentId => controller.moveRecord(r.id, parentId)}><option value="">根目录</option>{doc.records.filter(x => x.id !== r.id && !recordPath(doc, x.id, true).split('/').includes(r.id)).map(x => <option key={x.id} value={x.id}>{recordPath(doc, x.id)}</option>)}</Select>
    <Field label="设定名称" value={r.name} onChange={name => update({ name })}/>
    <Field label="基本描述" value={r.description} onChange={description => update({ description })} multiline placeholder="它是什么样的，有什么特征？"/>
    <div className="wb-fields"><Select label="记录类型" value={r.kind} onChange={kind => update({ kind: kind as WorldRecord['kind'] })}><option value="setting">背景设定</option><option value="rule">独立规则</option></Select>
      <Select label="影响程度" value={r.importance} onChange={importance => update({ importance: importance as WorldRecord['importance'] })}><option value="background">普通背景</option><option value="key">关键设定</option></Select></div>
    <details open={r.importance === 'key' || r.kind === 'rule' || undefined}><summary>运行规则与适用边界</summary>
      <Field label="运行规则" value={r.rule} onChange={rule => update({ rule })} multiline/>
      <div className="wb-fields"><Field label="参与或使用条件" value={r.conditions} onChange={conditions => update({ conditions })} placeholder="无条件也可明确填写“无”"/><Field label="代价与限制" value={r.cost} onChange={cost => update({ cost })} placeholder="没有代价时填写“无代价”"/></div>
      <Select label="适用范围" value={r.scope.mode} onChange={mode => update({ scope: { ...r.scope, mode: mode as WorldRecord['scope']['mode'] } })}><option value="undetermined">尚未确定</option><option value="global">全局默认</option><option value="local">局部适用</option></Select>
      <div className="wb-fields">{([['time','适用时期'],['place','适用地点'],['subjects','适用对象'],['conditions','范围附加条件']] as const).map(([key, label]) => <Field key={key} label={label} value={r.scope[key]} onChange={v => update({ scope: { ...r.scope, [key]: v } })}/>)}</div>
      <label className="wb-field"><span>引用已有规则</span><select multiple aria-label="引用已有规则" value={r.ruleRefs} onChange={e => update({ ruleRefs: Array.from(e.target.selectedOptions, o => o.value) })}>{doc.records.filter(x => x.kind === 'rule' && x.id !== r.id).map(x => <option key={x.id} value={x.id}>{x.name || '未命名规则'}</option>)}</select></label>
    </details>
    <details><summary>状态、传闻与来源</summary><div className="wb-fields">
      <Select label="作者确认" value={r.confirmation} onChange={confirmation => update({ confirmation: confirmation as WorldRecord['confirmation'] })}><option value="confirmed">已确认</option><option value="candidate">待定</option></Select>
      <Select label="内容性质" value={r.truth} onChange={truth => update({ truth: truth as WorldRecord['truth'] })}><option value="fact">客观设定</option><option value="rumor">传闻或故事中的说法</option></Select>
      <Select label="有效状态" value={r.validity} onChange={validity => update({ validity: validity as WorldRecord['validity'] })}><option value="valid">有效</option><option value="expired">已失效</option></Select>
      <Select label="来源类型" value={r.origin} onChange={origin => update({ origin: origin as WorldRecord['origin'], ...(origin === 'model' ? { confirmation: 'candidate' as const } : {}) })}><option value="author">作者原创</option><option value="reference">现实参考资料</option><option value="model">模型候选（手动整理）</option></Select></div>
      {r.validity === 'expired' && <Field label="失效原因" value={r.expiryReason} onChange={expiryReason => update({ expiryReason })}/>}
      {r.truth === 'rumor' && <><p className="wb-hint">确认传闻只代表确认“有人这样说”，不会确认其内容为真。</p><div className="wb-fields">{([['spreaders','传播者或群体'],['range','传播范围'],['period','传播时期']] as const).map(([k, label]) => <Field key={k} label={label} value={r.rumor[k]} onChange={v => update({ rumor: { ...r.rumor, [k]: v } })}/>)}</div><Select label="传闻真实性" value={r.rumor.veracity} onChange={veracity => update({ rumor: { ...r.rumor, veracity: veracity as WorldRecord['rumor']['veracity'] } })}><option value="unknown">尚不知晓</option><option value="true">作者注明为真</option><option value="false">作者注明为假</option></Select></>}
      {r.origin !== 'author' && <div className="wb-fields">{([['citation','来源出处'],['locator','来源定位'],['period','来源适用时期']] as const).map(([k, label]) => <Field key={k} label={label} value={r.source[k]} onChange={v => update({ source: { ...r.source, [k]: v } })}/>)}</div>}
    </details>
  </div>
}
function download(name: string, content: string) { const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0) }

export function WorldPage({ controller, configure, useInNovel }: { controller: WorldController; configure: () => void; useInNovel: (detail: WorldDetail) => Promise<boolean> }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), doc = state.document
  const [authorConfirmed, confirm] = useState(false)
  useEffect(() => confirm(false), [state.detail, state.document])
  const update = (patch: Partial<WorldDocument>) => controller.edit(d => ({ ...d, ...patch }))
  const locked = state.busy || !!state.pending
  const exportDocument = () => { if (doc) download(`${doc.name || '世界观'}.world.json`, JSON.stringify({ document: doc, sourceVersion: state.dirty ? null : state.detail?.ref ?? null }, null, 2)) }
  const adopt = async (detail: WorldDetail) => { try { await useInNovel(detail) } catch (e) { controller.reportError((e as Error).message) } }
  const selected = doc?.records.find(r => r.id === state.recordId)
  return <section className="wb-page" aria-label="世界观编辑器">
    <div className="ww-heading wb-heading"><div><span className="ww-eyebrow">WORLD BUILDING</span><h1 id="ww-title">世界观</h1><p>从故事需要的地方开始，让每一条设定都有依据。</p></div><div className="wb-actions"><button onClick={controller.refresh} disabled={state.busy}>刷新列表</button><button className="wb-primary" onClick={controller.newWorld} disabled={!state.overview?.ready || locked}>＋ 新建世界</button></div></div>
    {state.error && <div className="wb-notice" role="alert">{state.error}</div>}{state.message && <div className="wb-notice" role="status">{state.message}</div>}
    {state.busy && <div role="status" className="wb-notice">正在处理… <button onClick={controller.cancel}>取消请求</button></div>}
    {state.pending && !state.busy && <div className="wb-notice"><button className="wb-primary" disabled={!state.connected} onClick={controller.reconcile}>核对提交结果</button><span>先查原操作回执，未提交时才使用原请求重试。</span></div>}
    {(!state.connected || !state.overview?.ready) && <div className="wb-notice"><strong>{state.connected ? state.overview?.message || '正在读取世界观资料库' : '世界观服务未连接'}</strong><p>保存世界观需要工作台共享数据库。已输入内容仍保留，可先导出。</p><button onClick={configure}>配置数据库</button></div>}
    <div className="wb-library"><Select label="当前世界" value={state.instance === state.overview?.pluginInstanceId ? state.worldId : ''} onChange={id => { if (id) void controller.open(id) }}><option value="">选择世界观</option>{state.overview?.worlds.map(w => <option key={w.worldId} value={w.worldId}>{w.name} · v{w.revision}{w.status === 'active' ? ' · 正式' : ' · 草稿'}</option>)}{state.localWorlds.filter(w => w.instance === state.overview?.pluginInstanceId && !state.overview.worlds.some(s => s.worldId === w.worldId)).map(w => <option key={w.worldId} value={w.worldId}>{w.name} · 本地未保存</option>)}{state.worldId && !state.overview?.worlds.some(w => w.worldId === state.worldId) && !state.localWorlds.some(w => w.worldId === state.worldId) && <option value={state.worldId}>未保存的新世界</option>}</Select>
      <div className="wb-actions"><label className="wb-import">导入新世界<input type="file" accept=".json,application/json" disabled={locked || !state.overview?.ready} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) { if (file.size > 8_000_000) controller.reportError('导入文件过大'); else void file.text().then(controller.importDocument).catch(() => controller.reportError('无法读取导入文件')) } }}/></label><button disabled={!doc} onClick={exportDocument}>导出当前内容</button></div>
    </div>
    {!doc ? <div className="wb-empty"><span>◎</span><h2>一个小城，也可以是整个世界</h2><p>选择已有世界，或从名称和简介开始。力量、势力、地点、物品、历史按需使用，无需填满。</p></div> : <>
      <nav className="wb-tabs" aria-label="世界观功能">{tabs.map(([key, label]) => <button key={key} aria-current={state.tab === key ? 'page' : undefined} onClick={() => controller.setTab(key)}>{label}</button>)}</nav>
      <fieldset disabled={locked} className="wb-canvas">
        {state.tab === 'scope' && <div className="wb-editor"><div className="wb-section-title"><h2>故事发生在哪里</h2><span className="ww-pill">{state.dirty ? '有未保存修改' : `v${state.detail?.version.revision ?? 0}`}</span></div><Field label="世界名称" value={doc.name} onChange={name => update({ name })}/><Field label="世界简介" value={doc.description} onChange={description => update({ description })} multiline/><div className="wb-fields"><Field label="故事时代" value={doc.era} onChange={era => update({ era })}/><Field label="故事空间" value={doc.space} onChange={space => update({ space })}/><Select label="现实或架空" value={doc.reality} onChange={reality => update({ reality: reality as WorldDocument['reality'] })}><option value="real">现实</option><option value="fictional">架空</option><option value="mixed">现实与架空结合</option></Select></div></div>}
        {state.tab === 'records' && <><div className="wb-records"><SettingTree key={state.worldId} controller={controller}/>{selected ? <RecordEditor key={selected.id} record={selected} doc={doc} controller={controller}/> : <div className="wb-empty"><h2>选择或添加一条设定</h2><p>按父子层级组织世界设定。</p></div>}</div><WorldDatasetBuilder key={state.worldId + ':' + state.detail?.ref.versionId + ':' + state.dirty + ':' + state.connected + ':' + state.overview?.pluginInstanceId} document={doc}/></>}
      </fieldset>
      {!!state.issues.length && <section className="wb-notice" aria-label="世界观校验结果"><h3>{state.issues.filter(i => i.blocking).length} 项阻断 · {state.issues.filter(i => !i.blocking).length} 项提示</h3><ul>{state.issues.map((i, n) => <li key={n}>{i.blocking ? '需处理' : '提示'}：{i.message}{i.recordId && <button onClick={() => { const r = doc.records.find(r => r.id === i.recordId); if (r) { controller.setTab('records'); controller.setEntryFilter('all'); controller.selectRecord(r.id) } }}>查看设定</button>}</li>)}</ul></section>}
      <div className="wb-savebar"><div><strong>{state.dirty ? '有未保存修改' : state.detail?.version.status === 'active' ? `正式版本 v${state.detail.version.revision}` : `草稿 v${state.detail?.version.revision ?? 0}`}</strong><small>保存到共享数据库</small></div><div className="wb-actions"><button onClick={controller.check} disabled={locked}>校验设定</button><button onClick={() => void controller.save()} disabled={locked || !state.overview?.ready || !state.connected}>保存草稿</button>{state.detail?.version.status === 'active' && !state.dirty ? <button className="wb-primary" onClick={() => void adopt(state.detail!)} disabled={locked}>加入小说资产</button> : <button className="wb-primary" onClick={() => void controller.save('publish', authorConfirmed)} disabled={locked || state.dirty || !state.detail || !authorConfirmed || !state.connected}>发布正式版本</button>}</div></div>
      {state.detail && !state.dirty && state.detail.version.status === 'draft' && <label className="wb-checkbox wb-author-confirm"><input type="checkbox" checked={authorConfirmed} onChange={e => confirm(e.target.checked)} disabled={locked}/>我已审阅此版本的设定、来源与未决限制，确认发布。</label>}
      {state.dirty && state.detail && <button className="wb-subtle" disabled={locked} onClick={() => { if (window.confirm('放弃当前世界未保存的修改并载入最新版本？可先导出备份。')) void controller.open(state.worldId, true) }}>放弃修改并读取最新版本</button>}
    </>}
  </section>
}
