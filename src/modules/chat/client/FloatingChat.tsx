import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Markdown } from '../../../shared/client/Markdown.js'
import { CHAT_LIMITS } from '../contracts.js'
import type { ChatController } from './controller.js'
import { useChatPlacement } from './useChatPlacement.js'

function ChatIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M7 19H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7l-5 3v-3Z"/><path d="M7 8h10M7 12h7"/></svg> }
export function ChatToggle({ controller }: { controller: ChatController }) {
  const { open, busy } = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return <button id="ww-chat-toggle" className={`ww-chat-toggle ${busy ? 'ww-chat-working' : ''}`} type="button" aria-label={open ? '收起 AI 对话' : '打开 AI 对话'} aria-expanded={open} aria-controls={open ? 'ww-floating-chat' : undefined} onClick={controller.toggle} title={open ? '收起 AI 对话' : 'AI 对话'}><ChatIcon/><span>AI 对话</span>{busy && <i aria-label="正在生成"/>}</button>
}
const suggestions = ['帮我梳理一个故事创意', '一起完善人物的动机', '帮我润色一段文字']
export function FloatingChat({ controller }: { controller: ChatController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const placement = useChatPlacement(state.open)
  const input = useRef<HTMLTextAreaElement>(null), scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true), composing = useRef(false)
  const [expanded, setExpanded] = useState(false), [copyNotice, setCopyNotice] = useState('')
  const close = () => { controller.collapse(); document.getElementById('ww-chat-toggle')?.focus() }
  useEffect(() => { if (state.open) { composing.current = false; input.current?.focus(); pinned.current = true; if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight } }, [state.open])
  useEffect(() => { if (state.open && pinned.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight }, [state.turns, state.open])
  useEffect(() => {
    if (!copyNotice) return
    const timer = setTimeout(() => setCopyNotice(''), 2000)
    return () => clearTimeout(timer)
  }, [copyNotice])
  if (!state.open) return null
  const last = state.turns.at(-1)
  const submit = () => { pinned.current = true; void controller.send() }
  return <section ref={placement.panel} style={placement.style} id="ww-floating-chat" role="dialog" aria-modal="false" aria-labelledby="ww-chat-title" className={`ww-chat ${expanded ? 'ww-chat-expanded' : ''} ${placement.fixed ? '' : 'ww-chat-movable'} ${placement.dragging ? 'ww-chat-dragging' : ''}`}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); event.stopPropagation(); if (!placement.cancelDrag()) close() } }}>
    <header className="ww-chat-header" {...placement.headerEvents}><div className="ww-chat-heading" role="group" tabIndex={placement.fixed ? undefined : 0} aria-label={placement.fixed ? undefined : '移动对话位置'} title={placement.fixed ? '点击图钉解锁位置' : '拖动标题栏或用方向键移动，Shift + 方向键加速'} onKeyDown={placement.onMoveKeyDown}><ChatIcon/><div><h2 id="ww-chat-title">AI 对话</h2><span>{placement.fixed ? '写作助手 · 已固定' : '拖动标题栏移动'}</span></div></div><div className="ww-chat-actions">
      <button type="button" className="ww-chat-pin" aria-pressed={placement.fixed} title={placement.fixed ? '解锁位置后可拖动' : '固定回右上角'} aria-label={placement.fixed ? '解锁对话位置' : '固定到右上角'} onClick={placement.toggleFixed}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 3h6M10 3v6l-3 4v2h10v-2l-3-4V3M12 15v6"/></svg></button>
      <button type="button" title="新对话" aria-label="新对话" disabled={state.busy || !state.turns.length} onClick={() => { controller.newConversation(); setCopyNotice(''); input.current?.focus() }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <button type="button" className="ww-chat-resize" title={expanded ? '还原对话大小' : '放大对话'} aria-label={expanded ? '还原对话大小' : '放大对话'} onClick={() => setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</button>
      <button type="button" title="收起对话" aria-label="收起对话" onClick={close}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 12h12"/></svg></button>
    </div></header>
    <div className="ww-chat-transcript" ref={scroller} role="log" aria-label="对话消息" aria-live="off" onScroll={event => { const e = event.currentTarget; pinned.current = e.scrollHeight - e.scrollTop - e.clientHeight < 80 }}>
      {!state.turns.length ? <div className="ww-chat-empty"><span className="ww-chat-emblem"><ChatIcon/></span><h3>故事的下一步，一起想。</h3><p>聊聊你的设定、人物，或一段想打磨的文字。</p><div className="ww-chat-suggestions">{suggestions.map(text => <button type="button" key={text} onClick={() => { controller.setDraft(text); input.current?.focus() }}>{text}<span aria-hidden="true">↗</span></button>)}</div></div> : state.turns.map(turn => <div className="ww-chat-turn" key={turn.id}>
        <div className="ww-chat-user" aria-label="你的消息">{turn.user}</div>
        <article className="ww-chat-answer" aria-label="AI 回复"><div className="ww-chat-answer-label"><span className="ww-chat-avatar">AI</span><span>{turn.model?.model ?? '写作助手'}</span></div>
          {turn.answer ? <Markdown text={turn.answer} className="ww-chat-markdown"/> : ['waiting', 'thinking'].includes(turn.status) ? <p className="ww-chat-pending"><i/>{turn.status === 'thinking' ? '正在思考…' : '正在连接模型…'}</p> : null}
          {turn.status === 'streaming' && <span className="ww-chat-streaming" aria-label="正在生成"/>}
          {turn.status === 'truncated' && <p className="ww-chat-turn-note">本次回复达到长度上限，可以发送“继续”。</p>}
          {turn.error && <p className="ww-chat-turn-note" role={turn.status === 'failed' ? 'alert' : 'status'}>{turn.error}</p>}
          {!['waiting', 'thinking', 'streaming'].includes(turn.status) && <div className="ww-chat-message-actions">
            {turn.answer && <button type="button" onClick={() => { if (!navigator.clipboard) { setCopyNotice('复制不可用，请选中文字复制'); return }; void navigator.clipboard.writeText(turn.answer).then(() => setCopyNotice('已复制回复'), () => setCopyNotice('复制失败，请选中文字复制')) }}>复制</button>}
            {turn.id === last?.id && <button type="button" disabled={state.busy || !state.connected} onClick={() => { pinned.current = true; void controller.retry() }}>重新生成</button>}
          </div>}
        </article>
      </div>)}
    </div>
    <div className="ww-chat-compose-area">
      {!state.connected && <p className="ww-chat-notice" role="status">对话服务未连接。请在 DSH 配置模型后重试。</p>}
      {state.error && <p className="ww-chat-notice" role="alert">{state.error}</p>}
      <form className="ww-chat-composer" onSubmit={event => { event.preventDefault(); submit() }}>
        <textarea ref={input} value={state.draft} maxLength={CHAT_LIMITS.input} rows={3} placeholder="和 AI 一起打磨故事…" aria-label="对话内容" onChange={event => controller.setDraft(event.target.value)}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !state.busy && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); submit() } }}/>
        <div className="ww-chat-compose-tools"><span title="使用工作台右上角选择的模型">使用工作台模型</span>{state.busy ? <button type="button" className="ww-chat-send" aria-label="停止生成" title="停止生成" onClick={() => controller.stop()}><span className="ww-chat-stop-icon"/></button> : <button type="submit" className="ww-chat-send" disabled={!state.connected || !state.draft.trim()} aria-label="发送消息" title="发送消息"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v13"/></svg></button>}</div>
      </form>
      <div className="ww-chat-footnote"><span role="status" aria-live="polite">{copyNotice || (state.busy ? '正在生成回复' : '对话仅保留在本次工作台会话')}</span><span>Shift + Enter 换行</span></div>
    </div>
  </section>
}
