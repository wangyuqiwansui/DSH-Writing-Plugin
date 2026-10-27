import { createRoot } from 'react-dom/client'
import { useSyncExternalStore } from 'react'
import { Workbench, Launcher } from '../src/client/Workbench.js'
import { WorkbenchController } from '../src/client/model.js'
import css from '../src/client/workbench.css'
import { databasePreview } from './database-preview.js'
import { wikiPreview } from './wiki-preview.js'
import { qualityPreview } from './quality-preview.js'
import { registerQualityPage } from '../src/modules/quality/client/index.js'
import { registerNovelPage } from '../src/modules/novel/client/index.js'
import novelCss from '../src/modules/novel/client/novel.css'
import worldCss from '../src/modules/worldbuilding/client/world.css'
import chatCss from '../src/modules/chat/client/chat.css'
const style = document.createElement('style')
style.textContent = css + '\n' + novelCss + '\n' + worldCss + '\n' + chatCss
document.head.appendChild(style)
const controller = new WorkbenchController()
registerNovelPage(controller)
registerQualityPage(controller)
const query = new URLSearchParams(location.search)
if (query.get('demo') === 'models-sync-error') controller.attachModels({ read: () => { throw new Error('模型服务尚未挂载') }, save: async () => { throw new Error('模型服务尚未挂载') } })
if (query.get('demo') === 'models-late') {
 let reads = 0
 controller.attachModels({ read: async () => ++reads === 1 ? { models: [], selected: null, efforts: [] } : { models: [{ provider: 'demo', model: 'writer', name: '演示 Provider / Writer' }], selected: { provider: 'demo', model: 'writer', reasoningEffort: 'high' }, efforts: [{ id: 'high', name: '高' }] }, save: async () => { throw new Error('演示不保存') } })
}
if (query.get('demo') === 'models-grouped') {
 const models = [{ provider: 'account', providerName: 'DeepSeek 账号', model: 'flash', name: 'DeepSeek-V4.1-Flash' }, { provider: 'account', providerName: 'DeepSeek 账号', model: 'pro', name: 'DeepSeek-V4-Pro' }, { provider: 'deepseek', providerName: 'DeepSeek', model: 'flash', name: 'DeepSeek-V4.1-Flash' }, { provider: 'google', providerName: 'google', model: 'research', name: 'Deep Research Max Preview (Apr-21-2026)' }, { provider: 'google', providerName: 'google', model: 'gemini', name: 'Gemini 2.5 Computer Use Preview 10-2025' }]
 let selected = { provider: 'account', model: 'flash', reasoningEffort: 'high' }
 const read = async () => ({ models, selected, efforts: [{ id: 'high', name: '高' }, { id: 'low', name: '低' }] })
 controller.attachModels({ read, save: async value => { selected = { ...value, reasoningEffort: value.reasoningEffort ?? 'high' }; return read() } })
}
const demo = ['database', 'wiki', 'quality'].includes(query.get('demo') ?? '')
if (query.get('demo') === 'database') {
  const scenario = query.get('state')
  controller.database.attach(databasePreview(scenario === 'unconfigured' || scenario === 'readonly' ? scenario : 'ready'))
}
if (query.get('demo') === 'wiki') controller.wiki.attach(wikiPreview(query.get('state')))
if (query.get('demo') === 'quality') controller.quality.attach(qualityPreview(query.get('state')))
function Preview() {
  const { open } = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return open ? <><div style={{ padding: '7px 14px', height: 34, boxSizing: 'border-box', background: '#ececec', font: '12px/20px system-ui', color: '#666' }}>{demo ? '界面演示 · 使用临时模拟状态，不会保存到 DSH' : '本地组件预览 · 未连接 DSH 宿主'}</div><div style={{ height: 'calc(100dvh - 34px)' }}><Workbench controller={controller}/></div></> : <div style={{ padding: 32, fontFamily: 'system-ui' }}><p>DSH Writing Plugin · 本地组件预览（非 DSH 宿主）</p><Launcher controller={controller}/></div>
}
createRoot(document.getElementById('root')!).render(<Preview/>)
controller.open()
if (query.get('page') === 'database' || query.get('demo') === 'database') controller.navigate('database')
if (query.get('page') === 'wiki' || query.get('demo') === 'wiki') controller.navigate('wiki')
if (query.get('page') === 'quality' || query.get('demo') === 'quality') controller.navigate('quality')
if (query.get('page') === 'novel') controller.navigate('novel')
if (query.get('page') === 'world') controller.navigate('world')
