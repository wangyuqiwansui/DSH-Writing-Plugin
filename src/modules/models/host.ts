import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-config-editor'
import { parseSelection, type Selection, type ModelState } from './contracts.js'
import type {} from '../../infrastructure/middleware/host.js'
declare module '@deepseek-ai/cordis' { interface Context { writingModels: WritingModels } }
export class WritingModels extends TypertRemoteService {
 readonly generation = Symbol('writing-models')
 constructor(ctx: Context, private selected: Selection | undefined, private persist: (s: Selection) => Promise<void>) { super(ctx, 'writingModels') }
 private async state(signal?: AbortSignal): Promise<ModelState> {
  const llm = this.ctx.get('llm')
  if (!llm) throw new Error('宿主模型服务尚未就绪，请稍后重试')
  const models = (await Promise.all(llm.listProviders().map(async p => (await llm.listModels(p.id)).map(m => ({ provider: p.id, model: m.id, name: m.name || m.id, providerName: p.name || p.id }))))).flat()
  signal?.throwIfAborted()
  const selected = this.selected ?? models[0]
  if (!selected || !models.some(m => m.provider === selected.provider && m.model === selected.model)) return { models, selected: null, efforts: [] }
  const info = await llm.resolveModelInfo(selected.provider, selected.model, signal)
  const config = await llm.resolveCallConfig(selected as LlmCallConfig, signal)
  return { models, selected: config, efforts: [...info.reasoning?.efforts ?? []] }
 }
 @Remote
 async read(signal: AbortSignal) { return this.ctx.writingMiddleware.request('models', 'read', this.ctx.invocation?.peer.principal.kind, s => this.state(s), signal) }
 @Remote
 async save(request: Selection, signal: AbortSignal) {
  return this.ctx.writingMiddleware.request('models', 'save', this.ctx.invocation?.peer.principal.kind, async s => {
  const selection = parseSelection(request)
  const state = await this.state(s)
  if (!state.models.some(m => m.provider === selection.provider && m.model === selection.model)) throw new Error('模型已下线，请刷新列表')
  await this.ctx.llm.resolveCallConfig(selection as LlmCallConfig, s)
  s.throwIfAborted(); await this.persist(selection); this.selected = selection
  // ConfigEditor may reload this middleware after persistence; report the committed selection.
  return this.state(signal)
  }, signal)
 }
 /** All writing features dispatch here; each call captures one configuration and adapter generation. */
 async prepare(signal?: AbortSignal, overrides: Pick<LlmCallConfig, 'maxTokens'> = {}) {
  return this.ctx.writingMiddleware.task('models', 'prepare', async s => {
  const state = await this.state(s)
  if (!state.selected) throw new Error('宿主未注册可用模型')
  return this.ctx.llm.prepareCall({ ...state.selected, ...overrides } as LlmCallConfig, s)
  }, signal)
 }
 async *stream(options: Omit<GenerateOptions, 'provider' | 'model' | 'reasoningEffort'>) {
  const prepared = await this.prepare(options.signal)
  yield* prepared.stream({ ...options, ...prepared.config })
 }
}
export function mountModels(ctx: Context, selected?: Selection) {
 const owner = ctx.fiber
 ctx.inject(['typert', 'llm', 'writingMiddleware'], child => {
  new WritingModels(child, selected, async selection => {
   const editor = child.get('configEditor'); const entry = editor?.entries().find(e => e.fiber === owner)
   if (!editor || !entry) throw new Error('宿主配置服务不可用，无法保存默认模型')
   await editor.edit(entry, current => ({ ...current, defaultModel: selection }))
  })
 })
}
