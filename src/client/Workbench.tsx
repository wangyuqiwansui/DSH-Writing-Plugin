import { KnowledgePage } from '../modules/knowledge-core/client/KnowledgePage.js'
import { ModelPicker } from '../modules/models/client.js'
import { Component, useState, useSyncExternalStore, type ReactNode } from 'react'
import { WorkbenchController } from './model.js'
import { DatabasePage, databaseStateLabel } from '../modules/database/client/DatabasePage.js'
import { WikiPage } from '../modules/wiki/client/WikiPage.js'
import { WorldPage } from '../modules/worldbuilding/client/WorldPage.js'
import { ChatToggle, FloatingChat } from '../modules/chat/client/FloatingChat.js'

export function Launcher({ controller, wide = true }: { controller: WorkbenchController; wide?: boolean }) {
  return <button className="ww-launch" type="button" onClick={controller.open} title="打开写作工作台" aria-label="打开写作工作台">✎{wide && <span> 写作工作台</span>}</button>
}

class PageBoundary extends Component<{ children: ReactNode; home: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div className="ww-card" role="alert"><h2>页面暂时无法显示</h2><p>子插件加载发生异常，可以返回工作台后重试。</p><button onClick={this.props.home}>返回工作台</button></div> : this.props.children
  }
}

export function Workbench({ controller, onExit = controller.close }: { controller: WorkbenchController; onExit?: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const database = useSyncExternalStore(controller.database.subscribe, controller.database.getSnapshot)
  const novel = useSyncExternalStore(controller.novel.subscribe, controller.novel.getSnapshot)
  const currentNovel = novel.workspace.projects.find(project => project.id === novel.projectId)
  const [menu, setMenu] = useState(false)
  const go = (page: string) => { controller.navigate(page); setMenu(false) }
  const entry = state.entries.find(item => item.id === state.page)
  const title = entry?.title ?? ({ knowledge:'知识库', home: '工作台', world: '世界观', database: '数据库配置', wiki: 'Wiki' }[state.page] ?? '工作台')
  const Entry = entry?.component
  return <section className="ww-dialog ww-panel" aria-labelledby="ww-title">
    <div className="ww-shell">
      <aside id="ww-navigation" className={`ww-sidebar ${menu ? 'ww-menu-open' : ''}`}>
        <div className="ww-brand"><span className="ww-mark">W.</span><div><strong>写作工作台</strong><small>专注每一章的创作</small></div></div>
        <span className="ww-nav-label">工作空间</span>
        <nav aria-label="写作工作台导航">
          <button aria-current={state.page === 'home' ? 'page' : undefined} onClick={() => go('home')}>▦ <span>工作台</span></button>
          <span className="ww-nav-label">创作工具</span>
          <button aria-current={state.page === 'knowledge' ? 'page' : undefined} onClick={() => go('knowledge')}>▧ <span>知识库</span></button>
          <button aria-current={state.page === 'wiki' ? 'page' : undefined} onClick={() => go('wiki')}>▤ <span>Wiki</span></button>
          <button aria-current={state.page === 'world' ? 'page' : undefined} onClick={() => go('world')}>◎ <span>世界观</span></button>
          {state.entries.map(item => <button key={item.id} disabled={item.state !== 'available'} title={item.reason} aria-current={state.page === item.id ? 'page' : undefined} onClick={() => go(item.id)}>{item.title}{item.state !== 'available' && ' · 不可用'}</button>)}
        </nav>
        <div className="ww-sidebar-bottom"><button aria-current={state.page === 'database' ? 'page' : undefined} onClick={() => go('database')}>⚙ <span>数据库</span></button><small>DSH WRITING PLUGIN<br/>主界面 · 0.1.2</small></div>
      </aside>
      <div className="ww-main">
        <header className="ww-topbar"><div><button className="ww-menu-toggle" aria-controls="ww-navigation" aria-label="切换工作台导航" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button><span>写作空间 <span className="ww-separator">/</span> {title}</span></div><div className="ww-top-actions"><span className="ww-status"><i/>工作台已就绪</span><PageBoundary home={() => go('home')}><ModelPicker backend={state.modelsBackend}/></PageBoundary><button className="ww-close" onClick={onExit} aria-label="返回 DSH">返回 DSH ↗</button><ChatToggle controller={controller.chat}/></div></header>
        <div className="ww-workspace-body">
        <main className="ww-content">
          <PageBoundary key={state.page} home={() => go('home')}>
            {state.page === 'home' ? <>
              <div className="ww-heading"><div><span className="ww-eyebrow">AUTHOR WORKSPACE</span><h1 id="ww-title">创作工作台</h1><p>管理作品与世界设定，回到你的创作。</p></div><span className="ww-edition">写作空间</span></div>
              <section className="ww-project"><div><span className="ww-kicker">我的作品</span><h2>{currentNovel?.title ?? '开始你的下一部作品'}</h2><p>{currentNovel ? '继续编写设定、规划剧情，或回到正文编辑。' : '绑定作者人格与世界观，从小说设定开始创作。'}</p><button onClick={() => go('novel')}>{currentNovel ? '继续创作 →' : '创建小说 →'}</button><small>本次会话共 {novel.workspace.projects.length} 部作品 · 未接入数据库，离开前请导出</small></div><div className="ww-book" aria-hidden="true"><div>世界的边界<br/>由你写下<span>YOUR STORY<br/>STARTS HERE</span></div></div></section>
              <div className="ww-section-heading"><h2>创作工具</h2><span>设定与辅助工具</span></div>
              <div className="ww-tools"><button className="ww-tool" onClick={() => go('wiki')}><span className="ww-tool-icon">▤</span><span className="ww-pill">资料与知识</span><h3>Wiki</h3><p>查阅知识页面，追溯原始资料与引用。</p><span className="ww-text-link">打开 Wiki <span>→</span></span></button><button className="ww-tool" onClick={() => go('world')}><span className="ww-tool-icon">◎</span><span className="ww-pill">设定与规则</span><h3>世界观</h3><p>为故事建立规则、环境与历史。</p><span className="ww-text-link">管理世界观 <span>→</span></span></button>{state.entries.map(item => <button className="ww-tool" key={item.id} disabled={item.state !== 'available'} onClick={() => go(item.id)}><span className="ww-pill">{item.state === 'available' ? '可用' : '不可用'}</span><h3>{item.title}</h3><p>{item.description}</p><small>{item.reason}</small></button>)}<div className="ww-tool ww-tool-note"><span className="ww-tool-icon">＋</span><h3>更多创作工具</h3><p>后续接入的独立创作工具将在这里显示。</p></div></div>
              <div className="ww-bottom-grid"><section className="ww-card"><div className="ww-section-heading"><h2>环境概况</h2><span className="ww-pill">部分待接入</span></div><div className="ww-status-row"><span>主界面</span><b>已加载</b></div><div className="ww-status-row"><span>数据库</span><span>{database.connected && database.current ? databaseStateLabel[database.current.inspection.status.state] : '服务未连接'}</span></div><button className="ww-link-button" onClick={() => go('database')}>配置数据库 →</button></section><section className="ww-card"><h2>最近访问</h2>{state.recent.length ? state.recent.map(id => <button className="ww-recent" key={id} onClick={() => go(id)}>{id === 'wiki' ? 'Wiki' : id === 'world' ? '世界观' : state.entries.find(item => item.id === id)?.title} →</button>) : <div className="ww-empty"><span>◷</span><p>还没有创作工具访问记录</p><small>接入并使用子插件后，将在这里保留本次会话的访问入口。</small></div>}</section></div>
            </> : state.page === 'knowledge' ? <KnowledgePage controller={controller.knowledge} configure={() => go('database')}/> : state.page === 'world' ? <WorldPage controller={controller.world} configure={() => go('database')} useInNovel={async detail => { const ok = await controller.novel.addWorldVersion(detail); if (ok) { controller.novel.openModule('assets'); go('novel') } else controller.world.reportError(controller.novel.getSnapshot().error ?? '小说资产添加未完成'); return ok }}/> : state.page === 'wiki' ? <WikiPage controller={controller.wiki} configure={() => go('database')}/> : state.page === 'database' ? <DatabasePage controller={controller.database}/> : Entry ? <>{state.page !== 'novel' && <h1 id="ww-title">{title}</h1>}<Entry/></> : <><span className="ww-eyebrow">WORLD BUILDING</span><h1 id="ww-title">{title}</h1><section className="ww-placeholder"><span className="ww-placeholder-icon">◎</span><h2>世界观入口已预留</h2><p>世界观子插件尚未接入。本阶段先搭建统一工作台，具体编辑功能将在后续实现。</p><button onClick={() => go('home')}>返回工作台</button></section></>}
          </PageBoundary>
          <footer className="ww-footer"><span>DSH WRITING PLUGIN</span><span>让每一个设定，都有归处。</span></footer>
        </main>
        <FloatingChat controller={controller.chat}/>
        </div>
      </div>
    </div>
  </section>
}
