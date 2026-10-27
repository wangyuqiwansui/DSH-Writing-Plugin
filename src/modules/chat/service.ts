import { CHAT_LIMITS, ChatError, parseChatRequest, type ChatEvent, type ChatMessage, type ChatModel, type ChatRequest } from './contracts.js'

export interface ChatConfig { timeoutMs: number; maxTokens: number }
export type ChatChunk = { type: 'text'; text: string } | { type: 'thinking' } | { type: 'finish'; reason: 'stop' | 'length' }
export interface ChatProvider {
  prepare(signal: AbortSignal, maxTokens: number): Promise<{ model: ChatModel; stream(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<ChatChunk> }>
}
/** A non-cooperative provider cannot keep the UI request or service lease open forever. */
function untilAbort<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new ChatError('CANCELLED', '已停止生成'))
    if (signal.aborted) { Promise.resolve(work).catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
/** Owns only active chat requests, not novel data, files, tools or a second database. */
export class ChatService {
  private active = new Map<string, AbortController>()
  private disposed = false
  constructor(private provider: ChatProvider, private config: ChatConfig = { timeoutMs: 180_000, maxTokens: 8192 }) {}
  async *stream(input: ChatRequest, external: AbortSignal): AsyncGenerator<ChatEvent> {
    const request = parseChatRequest(input)
    if (this.disposed) throw new ChatError('UNAVAILABLE', '对话服务已卸载')
    if (this.active.has(request.requestId)) throw new ChatError('DUPLICATE', '这条消息正在生成，请勿重复发送')
    if (this.active.size >= 2) throw new ChatError('BUSY', '对话服务繁忙，请等待正在进行的回复')
    external.throwIfAborted()
    const controller = new AbortController(), signal = controller.signal
    const cancel = () => controller.abort(external.reason)
    external.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(() => controller.abort(new ChatError('TIMEOUT', '回复超时，已保留收到的内容。可以重新生成。')), this.config.timeoutMs)
    this.active.set(request.requestId, controller)
    let iterator: AsyncIterator<ChatChunk> | undefined, textLength = 0, thinking = false, finished = false
    try {
      const prepared = await untilAbort(this.provider.prepare(signal, this.config.maxTokens), signal)
      signal.throwIfAborted()
      yield { requestId: request.requestId, type: 'start', model: prepared.model }
      iterator = prepared.stream(request.messages, signal)[Symbol.asyncIterator]()
      while (true) {
        const item = await untilAbort(iterator.next(), signal)
        signal.throwIfAborted()
        if (item.done) break
        const chunk = item.value
        if (chunk.type === 'text') {
          textLength += chunk.text.length
          if (textLength > CHAT_LIMITS.output) throw new ChatError('OUTPUT_LIMIT', '回复过长，已停止并保留收到的内容')
          yield { requestId: request.requestId, type: 'delta', text: chunk.text }
        } else if (chunk.type === 'thinking' && !thinking) {
          thinking = true; yield { requestId: request.requestId, type: 'thinking' }
        } else if (chunk.type === 'finish') {
          if (!textLength) throw new ChatError('EMPTY_RESPONSE', '模型未返回可显示的文字，可以重新生成')
          finished = true
          yield { requestId: request.requestId, type: 'finish', reason: chunk.reason }
          break
        }
      }
      if (!finished) throw new ChatError('INTERRUPTED', '模型连接中断，回复尚未完成。已保留收到的内容。')
    } finally {
      clearTimeout(timeout); external.removeEventListener('abort', cancel)
      this.active.delete(request.requestId)
      controller.abort()
      // A provider that ignores abort must not block service teardown.
      try { void Promise.resolve(iterator?.return?.()).catch(() => {}) } catch { /* cleanup only */ }
    }
  }
  dispose(): void {
    this.disposed = true
    for (const controller of this.active.values()) controller.abort(new ChatError('UNAVAILABLE', '对话服务已卸载，请重新连接'))
  }
}
