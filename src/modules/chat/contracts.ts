import type { RemoteStreamHandle, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

export const CHAT_LIMITS = { input: 12_000, history: 80_000, messages: 41, output: 64_000 } as const
export type ChatMessage = { role: 'user'; text: string } | { role: 'assistant'; text: string; model: ChatModel }
export interface ChatRequest { requestId: string; messages: ChatMessage[] }
export interface ChatModel { provider: string; model: string; reasoningEffort?: string }
export type ChatEvent = { requestId: string } & (
  | { type: 'start'; model: ChatModel }
  | { type: 'thinking' }
  | { type: 'delta'; text: string }
  | { type: 'finish'; reason: 'stop' | 'length' }
)
export class ChatError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ChatError' }
}
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatError('INVALID_INPUT', '对话格式无效')
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new ChatError('INVALID_INPUT', '对话含未支持的字段')
}
function parseModel(value: unknown): ChatModel {
  object(value); keys(value, ['provider', 'model', 'reasoningEffort'])
  for (const key of ['provider', 'model']) if (typeof value[key] !== 'string' || !value[key] || (value[key] as string).length > 256) throw new ChatError('INVALID_INPUT', '模型来源无效')
  if (value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || value.reasoningEffort.length > 128)) throw new ChatError('INVALID_INPUT', '推理配置无效')
  return { provider: value.provider as string, model: value.model as string, ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort as string } : {}) }
}
export function parseChatRequest(value: unknown): ChatRequest {
  object(value); keys(value, ['requestId', 'messages'])
  if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value.requestId)) throw new ChatError('INVALID_INPUT', '对话请求标识无效')
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > CHAT_LIMITS.messages || value.messages.length % 2 !== 1) throw new ChatError('HISTORY_LIMIT', '对话过长，请开启新对话')
  let length = 0
  const messages = value.messages.map<ChatMessage>((message, index) => {
    object(message); keys(message, index % 2 === 0 ? ['role', 'text'] : ['role', 'text', 'model'])
    const role = index % 2 === 0 ? 'user' : 'assistant'
    if (message.role !== role || typeof message.text !== 'string' || !message.text.trim()) throw new ChatError('INVALID_INPUT', '对话内容或顺序无效')
    if (message.text.length > (role === 'user' ? CHAT_LIMITS.input : CHAT_LIMITS.output)) throw new ChatError('INPUT_LIMIT', '单条消息过长，请缩短内容')
    length += message.text.length
    return role === 'user' ? { role, text: message.text } : { role, text: message.text, model: parseModel(message.model) }
  })
  if (length > CHAT_LIMITS.history) throw new ChatError('HISTORY_LIMIT', '对话上下文过长，请开启新对话')
  return { requestId: value.requestId, messages }
}
export function parseChatEvent(value: unknown): ChatEvent {
  object(value)
  if (typeof value.requestId !== 'string') throw new ChatError('INVALID_STREAM', '对话响应标识缺失')
  if (value.type === 'thinking') return { requestId: value.requestId, type: 'thinking' }
  if (value.type === 'delta' && typeof value.text === 'string' && value.text.length <= CHAT_LIMITS.output) return { requestId: value.requestId, type: 'delta', text: value.text }
  if (value.type === 'finish' && (value.reason === 'stop' || value.reason === 'length')) return { requestId: value.requestId, type: 'finish', reason: value.reason }
  if (value.type === 'start') {
    return { requestId: value.requestId, type: 'start', model: parseModel(value.model) }
  }
  throw new ChatError('INVALID_STREAM', '模型响应格式无效')
}
export const chatRemote: TypertRemoteContribution = {
  package: 'dsh-writing-workbench', descriptors: [{
    id: 'dsh-writing-workbench#writingChat/stream', service: 'writingChat', namespace: 'writingChat', method: 'stream', mode: 'stream',
    invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'WritingChatEvent', create: () => ({ parse: parseChatEvent }) },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'WritingChatRequest', create: () => ({ parse: parseChatRequest }) } }],
  }],
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'writing-chat/owner-required': {}
    'writing-chat/failed': { chatCode: string }
  }
  interface TypertRemoteNamespaceMap { writingChat: { stream(request: ChatRequest, signal?: AbortSignal): RemoteStreamHandle<ChatEvent, never> } }
}
