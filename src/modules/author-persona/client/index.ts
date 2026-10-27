import { createElement } from 'react'
import type { WorkbenchController } from '../../../client/model.js'
import { PersonaPage } from './PersonaPage.js'

/** Composition alone knows both modules; the persona page only knows a consumer callback. */
export function registerPersonaPage(controller: WorkbenchController) {
  return controller.register({ id: 'author-persona', title: '作者人格', description: '定义表达风格，保存并交付明确的人格版本。', state: 'available',
    component: () => createElement(PersonaPage, { controller: controller.persona, configure: () => controller.navigate('database'), useInNovel: async projection => {
      const ok = await controller.novel.addPersonaVersion(projection)
      if (ok) controller.navigate('novel')
      else controller.persona.reportError(controller.novel.getSnapshot().error ?? '小说资产添加未完成')
      return ok
    } }) })
}
