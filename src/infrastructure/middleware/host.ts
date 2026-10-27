import type { Context } from '@deepseek-ai/cordis'
import type {} from '../storage/host.js'
import { WritingMiddleware } from './service.js'

export const name = 'writing-middleware'
export const inject = ['writingStorage']
declare module '@deepseek-ai/cordis' { interface Context { writingMiddleware: WritingMiddleware } }
export function apply(ctx: Context) {
  const middleware = new WritingMiddleware(ctx.writingStorage)
  ctx.reflect.provide('writingMiddleware', middleware)
  ctx.effect(() => () => middleware.dispose())
}
export { WritingMiddleware }
export type { RequestContext, RequestCompletion, RequestHook, ModuleDataPorts } from '../../shared/middleware.js'
