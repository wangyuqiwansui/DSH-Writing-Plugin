import { createElement } from 'react'
import type { WorkbenchController } from '../../../client/model.js'
import { QualityPage } from './QualityPage.js'
export function registerQualityPage(controller: WorkbenchController) {
  return controller.register({ id: 'quality', title: '质量检测', description: '检查章节正文，管理 L0/L1 规则，定位本次检测问题。', state: 'available',
    component: () => createElement(QualityPage, { controller: controller.quality, configure: () => controller.navigate('database') }) })
}
