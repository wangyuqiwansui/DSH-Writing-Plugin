import { useEffect, useState } from 'react'
import { recordPath, settingTree, type SettingNode } from '../domain/tree.js'
import type { WorldController } from './controller.js'

function NodeIcon({ branch }: { branch: boolean }) {
  return <svg className="wb-node-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">{branch ? <path d="M2.5 5.5h6l2 2h7v9h-15z M2.5 5.5v-2h6l2 2h7v2"/> : <><path d="M5 2.5h7l3 3v12H5z M12 2.5v4h3 M8 10h4 M8 13h4"/></>}</svg>
}

export function SettingTree({ controller }: { controller: WorldController }) {
  const state = controller.getSnapshot(), doc = state.document!
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const query = state.query.trim().toLocaleLowerCase()
  const tree = settingTree(doc)
  const directHits = new Set(doc.records.filter(r => [r.name, r.description].join(' ').toLocaleLowerCase().includes(query)).map(r => r.id))
  const visible = new Set<string>()
  // Search keeps the ancestor chain; a matching directory also exposes its descendants.
  const filter = (nodes: SettingNode[], inherited = false): SettingNode[] => nodes.flatMap(node => {
    const hit = !query || directHits.has(node.record.id)
    const children = filter(node.children, inherited || hit)
    if (!hit && !inherited && !children.length) return []
    visible.add(node.record.id)
    return [{ ...node, children }]
  })
  const filtered = filter(tree)
  useEffect(() => {
    if (!state.recordId) return
    const ancestors = recordPath(doc, state.recordId, true).split('/').slice(0, -1)
    setCollapsed(old => new Set([...old].filter(id => !ancestors.includes(id))))
  }, [state.recordId, doc])
  const highlight = (name: string) => {
    const index = query ? name.toLocaleLowerCase().indexOf(query) : -1
    return index < 0 ? name : <>{name.slice(0, index)}<mark>{name.slice(index, index + query.length)}</mark>{name.slice(index + query.length)}</>
  }
  const render = (nodes: SettingNode[]) => <ul>{nodes.map(({ record: r, children }) => {
    const expanded = !!query || !collapsed.has(r.id)
    return <li key={r.id}>
      <div className={`wb-tree-row${state.recordId === r.id ? ' is-selected' : ''}${query && !directHits.has(r.id) ? ' is-context' : ''}`}>
        {children.length ? <button className="wb-tree-toggle" aria-label={`${expanded ? '收起' : '展开'} ${r.name || '未命名设定'}`} aria-expanded={expanded} disabled={!!query} onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); return next })}><span className={expanded ? 'is-open' : ''}>›</span></button> : <span className="wb-tree-spacer"/>}
        <button className="wb-tree-select" title={recordPath(doc, r.id)} aria-current={state.recordId === r.id ? 'true' : undefined} onClick={() => controller.selectRecord(r.id)}><NodeIcon branch={!!children.length}/><span className="wb-node-name">{highlight(r.name || '未命名设定')}</span>{r.confirmation === 'candidate' && <small>待定</small>}{!!children.length && <span className="wb-node-count">{children.length}</span>}</button>
      </div>
      {!!children.length && expanded && render(children)}
    </li>
  })}</ul>
  return <aside className="wb-record-list">
    <div className="wb-directory-heading"><h2>设定目录</h2><span>{doc.records.length} 条设定</span></div>
    <label className="wb-field wb-directory-search"><span className="wb-visually-hidden">搜索设定</span><input type="search" value={state.query} onChange={e => controller.setQuery(e.target.value)} placeholder="搜索名称或正文…"/></label>
    <div className="wb-directory-actions"><button className="wb-primary" onClick={() => { controller.setEntryFilter('all'); controller.addRecord() }}>＋ 新建设定</button><button disabled={!state.recordId} title="在当前选中的设定下添加" onClick={controller.addChild}>＋ 子设定</button></div>
    <div className="wb-tree-toolbar"><span>{query ? `匹配 ${directHits.size} 条` : '全部设定'}</span><div><button disabled={!!query || !doc.records.length} onClick={() => setCollapsed(new Set())}>展开</button><button disabled={!!query || !doc.records.length} onClick={() => setCollapsed(new Set(doc.records.map(r => r.id)))}>收起</button></div></div>
    <nav className="wb-tree" aria-label="设定树">{render(filtered)}</nav>
    {!doc.records.length ? <div className="wb-directory-empty"><NodeIcon branch/><strong>从一条设定开始</strong><p>新建设定后，可继续添加子设定。</p></div> : query && !visible.size ? <div className="wb-directory-empty" role="status"><strong>没有匹配的设定</strong><p>试试其他名称或正文关键词。</p><button onClick={() => controller.setQuery('')}>清除搜索</button></div> : null}
    {query && !!visible.size && <p className="wb-tree-search-note">已保留上级目录，显示匹配位置。</p>}
  </aside>
}
