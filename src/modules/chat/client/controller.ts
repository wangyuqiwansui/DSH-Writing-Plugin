import { CHAT_LIMITS, ChatError, parseChatEvent, parseChatRequest, type ChatEvent, type ChatMessage, type ChatModel, type ChatRequest } from '../contracts.js'

export interface ChatBackend { stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> }
export interface ChatTurn { id: string; user: string; answer: string; status: 'waiting' | 'thinking' | 'streaming' | 'complete' | 'truncated' | 'cancelled' | 'failed'; model?: ChatModel; error?: string }
export interface ChatSnapshot { open: boolean; connected: boolean; draft: string; busy: boolean; turns: readonly ChatTurn[]; error: string | null }
export class ChatController {
  private state: ChatSnapshot = Object.freeze({ open: false, connected: false, draft: '', busy: false, turns: Object.freeze([]), error: null })
  private listeners = new Set<() => void>()
  private backend?: ChatBackend
  private active?: AbortController
  private disposed = false
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<ChatSnapshot>) {
    if (this.disposed) return
    this.state = Object.freeze({ ...this.state, ...patch, ...(patch.turns ? { turns: Object.freeze(patch.turns.map(turn => Object.freeze({ ...turn }))) } : {}) })
    for (const listener of this.listeners) listener()
  }
  private turn(id: string, patch: Partial<ChatTurn>) { this.update({ turns: this.state.turns.map(turn => turn.id === id ? Object.freeze({ ...turn, ...patch }) : turn) }) }
  attach(backend: ChatBackend): () => void {
    this.stop('连接已更新，回复已停止'); this.backend = backend; this.update({ connected: true })
    return () => { if (this.backend === backend) this.transportLost() }
  }
  transportLost = () => { this.stop('连接已断开，回复可能不完整'); this.backend = undefined; this.update({ connected: false }) }
  toggle = () => this.update({ open: !this.state.open })
  collapse = () => this.update({ open: false })
  setDraft = (draft: string) => this.update({ draft, error: null })
  newConversation = () => { if (!this.state.busy) this.update({ turns: [], error: null }) }
  send = async (): Promise<void> => {
    const text = this.state.draft.trim()
    if (!text || this.state.busy || this.disposed) return
    if (!this.backend) { this.update({ error: '对话服务尚未连接，请确认宿主已配置可用模型' }); return }
    const id = crypto.randomUUID()
    let request: ChatRequest
    try { request = parseChatRequest({ requestId: id, messages: [...this.history(), { role: 'user', text }] }) }
    catch (error) { this.update({ error: (error as Error).message }); return }
    this.update({ draft: '', error: null, turns: [...this.state.turns, { id, user: text, answer: '', status: 'waiting' }] })
    await this.run(request)
  }
  retry = async (): Promise<void> => {
    const previous = this.state.turns.at(-1)
    if (!previous || this.state.busy || this.disposed || !this.backend) return
    const id = crypto.randomUUID()
    let request: ChatRequest
    try { request = parseChatRequest({ requestId: id, messages: [...this.history(this.state.turns.slice(0, -1)), { role: 'user', text: previous.user }] }) }
    catch (error) { this.update({ error: (error as Error).message }); return }
    this.update({ error: null, turns: [...this.state.turns.slice(0, -1), { id, user: previous.user, answer: '', status: 'waiting' }] })
    await this.run(request)
  }
  private history(turns = this.state.turns): ChatMessage[] {
    return turns.filter(turn => ['complete', 'truncated'].includes(turn.status) && turn.answer && turn.model).flatMap(turn => [{ role: 'user', text: turn.user }, { role: 'assistant', text: turn.answer, model: turn.model! }] as ChatMessage[])
  }
  private async run(request: ChatRequest) {
    const backend = this.backend!, controller = new AbortController()
    this.active = controller; this.update({ busy: true })
    let text = '', started = false, finished = false
    try {
      for await (const raw of backend.stream(request, controller.signal)) {
        if (this.active !== controller || controller.signal.aborted || this.disposed) return
        const event = parseChatEvent(raw)
        if (event.requestId !== request.requestId || finished) throw new ChatError('INVALID_STREAM', '收到不匹配的对话响应')
        if (event.type === 'start') {
          if (started) throw new ChatError('INVALID_STREAM', '对话响应重复开始')
          started = true; this.turn(request.requestId, { model: event.model }); continue
        }
        if (!started) throw new ChatError('INVALID_STREAM', '对话响应缺少模型信息')
        if (event.type === 'thinking') { if (!text) this.turn(request.requestId, { status: 'thinking' }) }
        if (event.type === 'delta') {
          text += event.text
          if (text.length > CHAT_LIMITS.output) throw new ChatError('OUTPUT_LIMIT', '回复过长，已停止接收')
          this.turn(request.requestId, { answer: text, status: 'streaming' })
        }
        if (event.type === 'finish') {
          if (!text) throw new ChatError('EMPTY_RESPONSE', '模型未返回文字')
          finished = true; this.turn(request.requestId, { status: event.reason === 'length' ? 'truncated' : 'complete' }); break
        }
      }
      if (this.active === controller && !finished) throw new ChatError('INTERRUPTED', '连接中断，回复尚未完成。已保留收到的内容。')
    } catch (error) {
      if (this.active === controller && !this.disposed) this.turn(request.requestId, { status: 'failed', error: error instanceof Error ? error.message : '回复失败，请重试' })
    } finally {
      controller.abort()
      if (this.active === controller) { this.active = undefined; this.update({ busy: false }) }
    }
  }
  stop = (reason = '已停止生成') => {
    const controller = this.active
    if (!controller) return
    this.active = undefined; controller.abort()
    const last = this.state.turns.at(-1)
    if (last) this.turn(last.id, { status: 'cancelled', error: reason })
    this.update({ busy: false })
  }
  dispose(): void { this.stop(); this.update({ open: false, connected: false, turns: [], draft: '' }); this.disposed = true; this.backend = undefined; this.listeners.clear() }
}
