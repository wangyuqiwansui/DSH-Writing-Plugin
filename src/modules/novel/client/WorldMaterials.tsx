import { useSyncExternalStore } from 'react'
import type { NovelWorldContext } from './world-context.js'

export function WorldMaterials({ controller }: { controller: NovelWorldContext }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return <section className="wn-world-materials" aria-label="世界观材料查询">
    <h4>世界观材料</h4>
    <p>读取本小说已确认绑定的世界版本。输入地点、势力、能力、物品或事件名称；留空查看核心与硬规则。</p>
    <form onSubmit={e => { e.preventDefault(); void controller.search() }}>
      <label className="wn-field">本次需要的设定<input aria-label="本次需要的设定" maxLength={600} value={state.queryText} onChange={e => controller.setText(e.target.value)} placeholder="例如：渡口 绿单"/></label>
      <label className="wn-field">材料字数预算<select aria-label="材料字数预算" value={state.maxCharacters} onChange={e => controller.setBudget(Number(e.target.value))}>
        <option value={2000}>2,000 字符</option><option value={8000}>8,000 字符</option><option value={20000}>20,000 字符</option><option value={50000}>50,000 字符</option>
      </select></label>
      <button disabled={state.busy || !state.connected} type="submit">查询世界观材料</button>
      {state.busy && <button type="button" onClick={controller.cancel}>取消查询</button>}
    </form>
    {!state.connected && <p>世界观查询服务尚未连接。</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.result && <div>
      <p role="status">{state.result.complete ? '材料已选出' : '材料尚不完整'} · v{state.result.sourceVersion.revision} · {state.result.entries.length} 条 · {state.result.characters} 字符</p>
      <p>供作者规划审阅；未自动判断人物知情、时期适用或调用模型。</p>
      <ul>{state.result.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
      {state.result.ambiguities.map(a => <div key={a.term}><strong>请选择“{a.term}”所指条目</strong>{a.candidates.map(c => <button key={c.id} disabled={state.busy} onClick={() => void controller.search([c.id])}>{c.name} · {c.context || c.id}</button>)}</div>)}
      <details><summary>入选依据与来源</summary><ul>{state.result.entries.map(e => <li key={e.id}>{e.name}：{e.reasons.join('、')}<small> · {e.id}</small></li>)}</ul><code>{state.result.sourceVersion.contentHash}</code></details>
      {state.result.text && <label className="wn-field">本次材料<textarea aria-label="本次世界观材料" readOnly value={state.result.text} rows={14}/></label>}
    </div>}
  </section>
}
