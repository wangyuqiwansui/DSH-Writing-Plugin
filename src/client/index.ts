import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createElement } from 'react'
import { WorkbenchController } from './model.js'
import { Workbench } from './Workbench.js'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import css from './workbench.css'

export { WorkbenchController } from './model.js'
export type { WorkbenchEntry } from './model.js'

declare module '@deepseek-ai/cordis' {
  interface Context { writingWorkbench: WorkbenchController }
}

export const inject = ['slots', 'layout']
const panelId = 'writing-workbench' as MainPanelId

/** Additive slots preserve DSH's existing conversation and navigation. */
export function apply(ctx: Context): void {
  const controller = new WorkbenchController()
  ctx.effect(() => () => controller.dispose())
  ctx.effect(() => ctx.reflect.provide('writingWorkbench', controller))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-writing-workbench'
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  })
  ctx.effect(() => ctx.slots.register({ name: 'main', key: panelId },
    () => createElement(Workbench, { controller, onExit: () => ctx.layout.selectPanel(null) })))
  ctx.effect(() => ctx.slots.register({ name: 'sidebar.panellist', id: panelId, label: '写作工作台', order: 40 },
    ({ size }) => createElement('span', { 'aria-hidden': true, style: { fontSize: size } }, '✎')))
  ctx.effect(() => () => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId === panelId) ctx.layout.selectPanel(null)
  })
}
