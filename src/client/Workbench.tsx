import { Component, useState, useSyncExternalStore, type ReactNode } from 'react'
import { WorkbenchController } from './model.js'

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
  const [menu, setMenu] = useState(false)
  const go = (page: string) => { controller.navigate(page); setMenu(false) }
  const entry = state.entries.find(item => item.id === state.page)
  const title = entry?.title ?? ({ home: '工作台', world: '世界观', settings: '设置' }[state.page] ?? '工作台')
  const Entry = entry?.component
  return <section className="ww-dialog ww-panel" aria-labelledby="ww-title">
    <div className="ww-shell">
      <aside className={`ww-sidebar ${menu ? 'ww-menu-open' : ''}`}>
        <div className="ww-brand"><span className="ww-mark">W.</span><div><strong>WRITING</strong><small>创作，从这里开始</small></div></div>
        <span className="ww-nav-label">工作空间</span>
        <nav aria-label="写作工作台导航">
          <button aria-current={state.page === 'home' ? 'page' : undefined} onClick={() => go('home')}>▦ <span>工作台</span></button>
          <span className="ww-nav-label">创作工具</span>
          <button aria-current={state.page === 'world' ? 'page' : undefined} onClick={() => go('world')}>◎ <span>世界观</span><small>待接入</small></button>
          {state.entries.map(item => <button key={item.id} disabled={item.state !== 'available'} title={item.reason} aria-current={state.page === item.id ? 'page' : undefined} onClick={() => go(item.id)}>{item.title}{item.state !== 'available' && ' · 不可用'}</button>)}
        </nav>
        <div className="ww-sidebar-bottom"><button aria-current={state.page === 'settings' ? 'page' : undefined} onClick={() => go('settings')}>⚙ <span>设置</span></button><small>DSH WRITING PLUGIN<br/>主界面 · 0.1.1</small></div>
      </aside>
      <div className="ww-main">
        <header className="ww-topbar"><div><button className="ww-menu-toggle" aria-label="切换工作台导航" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button><span>写作空间 <span className="ww-separator">/</span> {title}</span></div><div className="ww-top-actions"><span className="ww-status"><i/>主界面已加载</span><button className="ww-close" onClick={onExit} aria-label="返回 DSH">返回 DSH ↗</button></div></header>
        <main className="ww-content">
          <PageBoundary key={state.page} home={() => go('home')}>
            {state.page === 'home' ? <>
              <div className="ww-heading"><div><span className="ww-eyebrow">YOUR WRITING WORKSPACE</span><h1 id="ww-title">给你的故事，一个起点。</h1><p>项目、世界设定与创作工具，在同一处相遇。</p></div><span className="ww-edition">01 / WORKBENCH</span></div>
              <section className="ww-project"><div><span className="ww-kicker">当前项目</span><h2>下一段故事，尚未命名。</h2><p>项目服务尚未接入。接入后，你可以在这里选择项目，继续上次的创作。</p><button disabled>选择写作项目</button><small>当前没有已连接的项目服务</small></div><div className="ww-book" aria-hidden="true"><div>世界的边界<br/>由你写下<span>YOUR STORY<br/>STARTS HERE</span></div></div></section>
              <div className="ww-section-heading"><h2>创作工具</h2><span>统一入口 · 逐步接入</span></div>
              <div className="ww-tools"><button className="ww-tool" onClick={() => go('world')}><span className="ww-tool-icon">◎</span><span className="ww-pill">入口预留</span><h3>世界观</h3><p>为故事建立规则、环境与历史。</p><span className="ww-text-link">查看接入状态 <span>→</span></span></button>{state.entries.map(item => <button className="ww-tool" key={item.id} disabled={item.state !== 'available'} onClick={() => go(item.id)}><span className="ww-pill">{item.state === 'available' ? '可用' : '不可用'}</span><h3>{item.title}</h3><p>{item.description}</p><small>{item.reason}</small></button>)}<div className="ww-tool ww-tool-note"><span className="ww-tool-icon">＋</span><h3>让工具随创作生长</h3><p>后续子插件将在这里统一呈现。当前仅提供主工作台框架。</p></div></div>
              <div className="ww-bottom-grid"><section className="ww-card"><div className="ww-section-heading"><h2>环境概况</h2><span className="ww-pill">部分待接入</span></div><div className="ww-status-row"><span>主界面</span><b>已加载</b></div><div className="ww-status-row"><span>项目与数据服务</span><span>尚未接入</span></div><button className="ww-link-button" onClick={() => go('settings')}>查看设置入口 →</button></section><section className="ww-card"><h2>最近访问</h2>{state.recent.length ? state.recent.map(id => <button className="ww-recent" key={id} onClick={() => go(id)}>{state.entries.find(item => item.id === id)?.title} →</button>) : <div className="ww-empty"><span>◷</span><p>还没有创作工具访问记录</p><small>接入并使用子插件后，将在这里保留本次会话的访问入口。</small></div>}</section></div>
            </> : Entry ? <><h1 id="ww-title">{title}</h1><Entry/></> : <><span className="ww-eyebrow">{state.page === 'world' ? 'WORLD BUILDING' : 'WORKSPACE SETTINGS'}</span><h1 id="ww-title">{title}</h1><section className="ww-placeholder"><span className="ww-placeholder-icon">{state.page === 'world' ? '◎' : '⚙'}</span><h2>{state.page === 'world' ? '世界观入口已预留' : '全局设置入口已预留'}</h2><p>{state.page === 'world' ? '世界观子插件尚未接入。本阶段先搭建统一工作台，具体编辑功能将在后续实现。' : '项目与数据库服务尚未接入。本阶段不提供数据库配置或初始化操作。'}</p><button onClick={() => go('home')}>返回工作台</button></section></>}
          </PageBoundary>
          <footer className="ww-footer"><span>DSH WRITING PLUGIN</span><span>让每一个设定，都有归处。</span></footer>
        </main>
      </div>
    </div>
  </section>
}
