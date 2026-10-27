import { createElement } from 'react'
import type { WorkbenchController } from '../../../client/model.js'
import { NovelPage } from './NovelPage.js'

export function registerNovelPage(controller: WorkbenchController) {
  return controller.register({ id: 'novel', title: '小说', description: '从作品设定到逐章正文，管理小说与角色。', state: 'available',
    component: () => createElement(NovelPage, { controller: controller.novel }) })
}
