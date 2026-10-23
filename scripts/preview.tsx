import { createRoot } from 'react-dom/client'
import { useSyncExternalStore } from 'react'
import { Workbench, Launcher } from '../src/client/Workbench.js'
import { WorkbenchController } from '../src/client/model.js'
import css from '../src/client/workbench.css'
const style = document.createElement('style')
style.textContent = css
document.head.appendChild(style)
const controller = new WorkbenchController()
function Preview() {
  const { open } = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return open ? <div style={{ height: '100dvh' }}><Workbench controller={controller}/></div> : <div style={{ padding: 32, fontFamily: 'system-ui' }}><p>DSH Writing Plugin · 本地组件预览（非 DSH 宿主）</p><Launcher controller={controller}/></div>
}
createRoot(document.getElementById('root')!).render(<Preview/>)
controller.open()
