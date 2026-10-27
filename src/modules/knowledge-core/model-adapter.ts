import type { Context } from '@deepseek-ai/cordis'
import type { ModelPort } from './contracts.js'
import type {} from '../models/host.js'
/** The only LLM adapter. No network/file/SQL tools are passed to the provider. */
export function knowledgeModel(ctx:Context):ModelPort {
  return {async complete(input,signal){
    const models=ctx.get('writingModels');if(!models)throw new Error('请先配置并连接统一模型')
    const generation=models.generation,prepared=await models.prepare(signal,{maxTokens:12000}),started=performance.now()
    let output='',finished=false,usage:unknown=null
    for await(const chunk of prepared.stream({...prepared.config,signal,system:input.system,messages:[{role:'user',content:[{type:'text',text:input.user}]}]})){
      signal.throwIfAborted();if(ctx.get('writingModels')?.generation!==generation)throw new Error('模型服务已变化，请核对本次运行')
      if(chunk.type==='text-delta'){output+=chunk.text;if(output.length>160000)throw new Error('模型输出超出上限')}
      if(chunk.type==='usage')usage=chunk.usage
      if(chunk.type==='tool-call-delta')throw new Error('知识库模型不允许调用工具')
      if(chunk.type==='finish'){if(chunk.reason.kind!=='stop')throw new Error('模型输出未完整结束');finished=true}
    }
    signal.throwIfAborted();if(!finished)throw new Error('模型连接中断')
    return {config:JSON.parse(JSON.stringify({provider:prepared.config.provider,model:prepared.config.model,reasoningEffort:prepared.config.reasoningEffort,maxTokens:prepared.config.maxTokens,temperature:prepared.config.temperature,stop:prepared.config.stop})),input,output,usage:JSON.parse(JSON.stringify(usage)),durationMs:performance.now()-started}
  }}
}
