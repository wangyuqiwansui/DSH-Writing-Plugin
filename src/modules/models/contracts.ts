import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
export interface Selection { provider: string; model: string; reasoningEffort?: string }
export interface ModelState { models: { provider: string; model: string; name: string; providerName?: string }[]; selected: Selection | null; efforts: { id: string; name: string }[] }
export function parseSelection(value: unknown): Selection {
 const v = value as Selection
 if (!v || typeof v.provider !== 'string' || !v.provider || typeof v.model !== 'string' || !v.model || (v.reasoningEffort !== undefined && typeof v.reasoningEffort !== 'string')) throw new Error('模型配置无效')
 return { provider: v.provider, model: v.model, ...(v.reasoningEffort ? { reasoningEffort: v.reasoningEffort } : {}) }
}
export const modelsRemote: TypertRemoteContribution = { package: 'dsh-writing-workbench', descriptors: ['read', 'save'].map(method => ({ id: `dsh-writing-workbench#writingModels/${method}`, service: 'writingModels', namespace: 'writingModels', method, invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' }, result: { mode: 'src-json' }, parameters: method === 'read' ? [] : [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'WritingModelSelection', create: () => ({ parse: parseSelection }) } }] })) }
declare module '@deepseek-ai/dsh-typert-protocol' { interface TypertRemoteNamespaceMap { writingModels: { read(signal?: AbortSignal): Promise<RemoteResult<ModelState>>; save(request: Selection, signal?: AbortSignal): Promise<RemoteResult<ModelState>> } } }
