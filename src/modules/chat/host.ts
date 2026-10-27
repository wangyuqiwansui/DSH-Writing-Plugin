import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../models/host.js'
import type {} from '../../infrastructure/middleware/host.js'
import { ChatError, type ChatRequest } from './contracts.js'
import { ChatService, type ChatConfig, type ChatProvider } from './service.js'

export const name = 'writing-chat'
export const inject = ['typert', 'writingModels', 'writingMiddleware']
export const Config = { '~standard': { version: 1 as const, vendor: 'writing-chat', validate(value: unknown) {
  const v = value as Partial<ChatConfig>
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['timeoutMs', 'maxTokens'].includes(k))) return { issues: [{ message: 'Invalid chat config' }] }
  const timeoutMs = v.timeoutMs ?? 180_000, maxTokens = v.maxTokens ?? 8192
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000 || !Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 32_768) return { issues: [{ message: 'Invalid chat timeout or token limit' }] }
  return { value: { timeoutMs, maxTokens } }
} } }
declare module '@deepseek-ai/cordis' { interface Context { writingChat: WritingChat } }
export class WritingChat extends TypertRemoteService {
  readonly engine: ChatService
  constructor(ctx: Context, config: ChatConfig) {
    super(ctx, 'writingChat')
    const provider: ChatProvider = { prepare: async (signal, maxTokens) => {
      const models = ctx.get('writingModels')
      if (!models) throw new ChatError('UNAVAILABLE', '模型服务尚未连接，请稍后重试')
      const generation = models.generation
      const call = await models.prepare(signal, { maxTokens })
      return { model: { provider: call.config.provider, model: call.config.model, ...(call.config.reasoningEffort ? { reasoningEffort: call.config.reasoningEffort } : {}) },
        async *stream(messages, signal) {
          const input: GenerateOptions['messages'] = messages.map(message => message.role === 'user'
            ? { role: 'user', content: [{ type: 'text', text: message.text }] }
            : createAssistantMessage({ content: [{ type: 'text', text: message.text }], source: { provider: message.model.provider, model: message.model.model } }))
          for await (const chunk of call.stream({ ...call.config, signal,
            system: '你是写作工作台的 AI 写作助手，帮助作者讨论设定、剧情、人物和文字表达。根据用户使用的语言回答，建议清楚具体。你只能看到本次对话中用户提供的内容，没有访问或修改工作台小说、世界观、文件或工具的能力，不要声称已经读取、保存或应用修改。',
            messages: input,
          })) {
            signal.throwIfAborted()
            if (ctx.get('writingModels')?.generation !== generation) throw new ChatError('MODEL_CHANGED', '模型服务已更换，请重新生成')
            if (chunk.type === 'text-delta') yield { type: 'text', text: chunk.text }
            else if (chunk.type === 'reasoning-delta') yield { type: 'thinking' }
            else if (chunk.type === 'finish') {
              if (chunk.reason.kind === 'stop' || chunk.reason.kind === 'max-tokens') yield { type: 'finish', reason: chunk.reason.kind === 'stop' ? 'stop' : 'length' }
              else throw new ChatError('MODEL_FAILED', '模型未能完成回复，请检查模型配置后重试')
            }
          }
        },
      }
    } }
    this.engine = new ChatService(provider, config)
    ctx.effect(() => () => this.engine.dispose())
  }
  @Remote({ mode: 'stream' })
  async *stream(request: ChatRequest, signal: AbortSignal) {
    try { yield* this.ctx.writingMiddleware.stream('chat', 'stream', this.ctx.invocation?.peer.principal.kind, s => this.engine.stream(request, s), signal) }
    catch (error) {
      if (error instanceof RemoteError) throw error
      if (signal.aborted) throw new RemoteError('gateway/cancelled', '已停止生成', {})
      throw new RemoteError('writing-chat/failed', error instanceof ChatError ? error.message : '模型服务暂时无法完成回复，请检查右上角的模型配置后重试', { chatCode: error instanceof ChatError ? error.code : 'MODEL_FAILED' })
    }
  }
}
export function apply(ctx: Context, config: ChatConfig = { timeoutMs: 180_000, maxTokens: 8192 }) { new WritingChat(ctx, config) }
