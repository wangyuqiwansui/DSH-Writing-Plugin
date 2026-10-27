import { useEffect, useId, useRef, useState } from 'react'
import type { ModelState, Selection } from './contracts.js'
export interface ModelsBackend { read(signal?: AbortSignal): Promise<ModelState>; save(s: Selection, signal?: AbortSignal): Promise<ModelState> }
export function modelStatus(connected: boolean, loading: boolean, error: string, state?: ModelState) {
 if (!connected) return '未连接宿主'
 if (loading && !state) return '正在读取宿主模型…'
 if (error) return '模型读取失败'
 if (!state) return '等待宿主模型服务'
 return state.models.length ? '选择模型' : '宿主尚未公布可选模型'
}
function Chevron() { return <svg className="ww-picker-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function Check() { return <svg className="ww-picker-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function message(e: unknown) { return e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e) }
export function ModelPicker({ backend }: { backend?: ModelsBackend }) {
 const [state, setState] = useState<ModelState>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
 const [effortOpen, setEffortOpen] = useState(false)
 const effortTrigger = useRef<HTMLButtonElement>(null); const effortPopup = useRef<HTMLDivElement>(null)
 const [open, setOpen] = useState(false); const [query, setQuery] = useState('')
 const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const search = useRef<HTMLInputElement>(null)
 const popupId = useId()
 useEffect(() => {
  if (!open && !effortOpen) return
  if (open) search.current?.focus()
  else effortPopup.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setEffortOpen(false) } }
  document.addEventListener('pointerdown', outside)
  return () => document.removeEventListener('pointerdown', outside)
 }, [open, effortOpen])
 const refresh = useRef<() => void>(() => {}); const saveRef = useRef<(s: Selection) => void>(() => {})
 useEffect(() => {
  let live = true, saving = false, reading = false, sequence = 0
  let request: AbortController | undefined
  setState(undefined); setError(''); setBusy(!!backend)
  async function run(selection?: Selection) {
   if (!backend || !live || saving || (!selection && reading)) return
   const id = ++sequence; request?.abort(); request = new AbortController()
   const signal = request.signal; saving = !!selection; reading = !selection; setBusy(true)
   const timer = setTimeout(() => request?.abort(new Error('读取模型超时，请重试')), 15000)
   const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
   try {
    const result = await Promise.race([Promise.resolve().then(() => selection ? backend!.save(selection, signal) : backend!.read(signal)), aborted])
    if (live && id === sequence) { setState(result); setError('') }
   } catch (e) { if (live && id === sequence) setError(message(e)) }
   finally { clearTimeout(timer); if (live && id === sequence) { saving = false; reading = false; setBusy(false) } }
  }
  refresh.current = () => { void run() }; saveRef.current = s => { void run(s) }
  void run()
  // Re-read the live host catalog, including registrations that arrive after mounting.
  const poll = setInterval(() => { void run() }, 5000)
  return () => { live = false; sequence++; request?.abort(); clearInterval(poll) }
 }, [backend])
 const selected = state?.models.find(m => m.provider === state.selected?.provider && m.model === state.selected?.model)
 const groups = new Map<string, { label: string; models: ModelState['models'] }>()
 for (const model of state?.models ?? []) {
  if (!`${model.providerName ?? model.provider} ${model.name} ${model.model}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) continue
  let group = groups.get(model.provider)
  if (!group) { group = { label: model.providerName ?? model.provider, models: [] }; groups.set(model.provider, group) }
  group.models.push(model)
 }
 function close() { setOpen(false); trigger.current?.focus() }
 return <div className="ww-model-picker" ref={root} onKeyDown={e => { if (e.key === 'Escape' && (open || effortOpen)) { e.stopPropagation(); if (effortOpen) { setEffortOpen(false); effortTrigger.current?.focus() } else close() } }}>
  <button ref={trigger} className="ww-model-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={popupId} onClick={() => { setEffortOpen(false); setOpen(!open); setQuery('') }} title={selected ? `${selected.providerName ?? selected.provider} / ${selected.name}` : undefined}>
   <span className="ww-model-trigger-name">{selected?.name ?? modelStatus(!!backend, busy, error, state)}</span><Chevron/>
  </button>
  <div className="ww-effort-picker">
   <button ref={effortTrigger} type="button" className="ww-model-trigger ww-effort-trigger" aria-label="推理等级" aria-haspopup="menu" aria-expanded={effortOpen} aria-controls={`${popupId}-effort`} disabled={!state?.selected || !backend} onClick={() => { setOpen(false); setEffortOpen(!effortOpen) }}>
    <span className="ww-effort-label">推理</span><span className="ww-effort-value">{state?.efforts.find(e => e.id === state.selected?.reasoningEffort)?.name ?? (state?.selected?.reasoningEffort || '模型默认')}</span><Chevron/>
   </button>
   {effortOpen && <div ref={effortPopup} id={`${popupId}-effort`} className="ww-model-popover ww-effort-popover" role="menu" aria-label="推理等级" onKeyDown={e => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const options = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    if (!options.length) return
    e.preventDefault(); const index = options.indexOf(document.activeElement as HTMLButtonElement)
    options[e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
   }}>
    <div className="ww-effort-heading">推理等级</div>
    {[{ id: '', name: '模型默认' }, ...state?.efforts ?? []].map(e => {
     const active = e.id === (state?.selected?.reasoningEffort ?? '')
     return <button className={`ww-model-option${active ? ' is-selected' : ''}`} key={e.id} type="button" role="menuitemradio" aria-checked={active} disabled={busy || !backend || !state?.selected} onClick={() => { if (!active && state?.selected) saveRef.current({ ...state.selected, reasoningEffort: e.id || undefined }); setEffortOpen(false); effortTrigger.current?.focus() }}><span>{e.name}</span>{active && <Check/>}</button>
    })}
    {!state?.efforts.length && <p className="ww-effort-hint">此模型未提供可选推理等级</p>}
   </div>}
  </div>
  {open && <div id={popupId} className="ww-model-popover" role="dialog" aria-label="选择默认模型" onKeyDown={e => {
   if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
   const options = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.ww-model-option:not(:disabled)'))
   if (!options.length) return
   e.preventDefault(); const index = options.indexOf(document.activeElement as HTMLButtonElement)
   options[(index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
  }}>
   <div className="ww-model-search"><input ref={search} aria-label="搜索模型或提供商" placeholder="搜索模型或提供商…" value={query} onChange={e => setQuery(e.target.value)}/></div>
   <div className="ww-model-list">
    {[...groups].map(([provider, group]) => <section className="ww-model-group" key={provider} aria-label={group.label}><h3>{group.label}</h3>{group.models.map(m => {
     const active = m.provider === state?.selected?.provider && m.model === state?.selected?.model
     return <button type="button" className={`ww-model-option${active ? ' is-selected' : ''}`} key={m.model} aria-pressed={active} disabled={!backend || busy} onClick={() => { if (!active) saveRef.current({ provider: m.provider, model: m.model }); close() }}><span>{m.name}</span>{active && <span className="ww-model-check" aria-label="已选择"><Check/></span>}</button>
    })}</section>)}
    {!groups.size && <p className="ww-model-empty">{state?.models.length ? '没有匹配的模型' : modelStatus(!!backend, busy, error, state)}</p>}
   </div>
   <div className="ww-model-popup-footer"><span>{busy ? '正在同步…' : '使用宿主已注册的模型'}</span><button type="button" disabled={!backend || busy} onClick={() => refresh.current()}>刷新列表</button></div>
  </div>}
  {error && <span className="ww-model-error" role="alert">{error}</span>}
 </div>
}
