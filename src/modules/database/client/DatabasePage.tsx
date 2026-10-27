import { useState, useSyncExternalStore } from 'react'
import type { DatabaseInspection } from '../contracts/management.js'
import type { DatabaseController } from './controller.js'

export const databaseStateLabel: Record<string, string> = {
  unconfigured: '尚未配置', missing: '文件不存在', invalid_path: '路径无效', not_a_file: '请选择文件', unreadable: '无法访问',
  invalid_database: '数据库不可用', migration_required: '需要检查版本', ready: '已连接', provider_missing: '服务未连接', configuration_conflict: '配置冲突',
}
function size(bytes: number | null) {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  return bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
function Guidance({ inspection }: { inspection: DatabaseInspection }) {
  const [copied, setCopied] = useState('')
  if (!inspection.command) return null
  return <details className="ww-db-guide" open><summary>{inspection.status.state === 'missing' ? '创建数据库' : '检查与升级数据库'}</summary>
    <p>{inspection.status.state === 'missing' ? '在终端运行下面的命令创建数据库，然后重新测试连接。' : '请先停用使用此文件的写作服务，再执行检查与升级。升级前会自动备份；不支持降级或覆盖陌生数据库。'}</p>
    <div className="ww-db-command-heading"><span>{inspection.commandShell}</span><button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(inspection.command!); setCopied('已复制') }
      catch { setCopied('复制失败，请选中下方命令复制') }
    }}>复制命令</button></div><pre tabIndex={0}>{inspection.command}</pre><span role="status">{copied}</span>
  </details>
}

export function DatabasePage({ controller }: { controller: DatabaseController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const { current, inspection, busy, connected } = state
  const dirty = state.draft !== (current?.databasePath ?? '')
  const canSave = connected && current?.editable && !busy && dirty && inspection?.status.databaseReady && inspection.writable
    && inspection.status.databasePath === state.draft.trim()
  const active = current?.inspection
  const statusLabel = connected && active ? databaseStateLabel[active.status.state] : busy === 'load' ? '正在连接' : '服务未连接'
  return <>
    <div className="ww-heading"><div><span className="ww-eyebrow">WORKSPACE SETTINGS</span><h1 id="ww-title">数据库配置</h1><p>为作品与资料指定存储位置，让创作有迹可循。</p></div><span className="ww-edition">全局配置</span></div>
    <div className="ww-db-grid">
      <section className="ww-card ww-db-form" aria-labelledby="ww-db-connection-title" aria-busy={!!busy}>
        <div className="ww-db-card-heading"><div><span className="ww-kicker">连接设置</span><h2 id="ww-db-connection-title">本地数据库</h2></div><span className="ww-pill">SQLite</span></div>
        <p className="ww-db-intro">作品、设定与知识资料保存在同一个数据库中，各作品的数据独立管理。</p>
        {!connected && !busy && <div className="ww-db-notice" role="status"><strong>等待连接 DSH 宿主</strong><p>在 DSH 内打开本页面即可读取配置。独立预览仅展示界面。</p></div>}
        {current && !current.editable && <div className="ww-db-notice" role="status"><strong>当前配置只读</strong><p>{current.readOnlyReason}</p></div>}
        <form onSubmit={event => { event.preventDefault(); if (canSave) void controller.save() }}>
          <label className="ww-db-label" htmlFor="ww-db-path">数据库文件路径 {dirty && <span>未保存</span>}</label>
          <input id="ww-db-path" className="ww-db-input" value={state.draft} onChange={event => controller.setDraft(event.target.value)}
            placeholder="例如 C:\Writing\novel.sqlite3" autoComplete="off" spellCheck={false} disabled={busy === 'save'}
            aria-describedby="ww-db-path-help" aria-invalid={inspection && !inspection.status.databaseReady ? true : undefined}/>
          <p id="ww-db-path-help" className="ww-db-help">填写运行 DSH 的电脑上的完整文件路径，包含文件名。支持本机 SQLite 文件。</p>
          <div className="ww-db-actions"><button className="ww-db-secondary" type="button" disabled={!connected || !!busy || !state.draft.trim()} onClick={() => void controller.inspect()}>{busy === 'inspect' ? '正在检查…' : '测试连接'}</button>
            <button className="ww-db-primary" type="submit" disabled={!canSave}>{busy === 'save' ? '正在保存…' : '保存并应用'}</button>
            {dirty && <button className="ww-link-button" type="button" disabled={!!busy} onClick={controller.resetDraft}>还原输入</button>}</div>
          <p className="ww-db-help">先测试连接，再保存。切换数据库后，写作服务将使用新路径。</p>
        </form>
        {inspection && <div className={`ww-db-check ${inspection.status.databaseReady ? 'ww-db-check-ok' : ''}`} role="status">
          <strong>{inspection.status.databaseReady ? '连接检查通过' : databaseStateLabel[inspection.status.state]}</strong><p>{inspection.status.message}</p>
          <small>检查时间：{new Date(inspection.checkedAt).toLocaleString('zh-CN')}</small>
          {inspection.status.databaseReady && <small>结构 v{inspection.schemaVersion} · {inspection.projectCount} 个作品 · {size(inspection.sizeBytes)}</small>}
          <Guidance key={inspection.checkedAt} inspection={inspection}/>
        </div>}
        {state.notice && <div className={`ww-db-notice ww-db-notice-${state.notice.kind}`} role={state.notice.kind === 'error' ? 'alert' : 'status'}>{state.notice.message}</div>}
      </section>
      <aside className="ww-db-aside">
        <section className="ww-card" aria-labelledby="ww-db-active-title"><div className="ww-db-card-heading"><h2 id="ww-db-active-title">当前连接</h2><span className="ww-pill">{statusLabel}</span></div>
          <p className="ww-db-help">{connected ? '当前已保存配置 · 状态以最近检查为准' : current ? '上次读取的配置，尚未确认当前状态' : '连接宿主后显示当前配置'}</p>
          <div className="ww-db-current-path">{current?.databasePath || '尚未指定数据库文件'}</div>
          <dl className="ww-db-facts"><div><dt>存储类型</dt><dd>本地 SQLite</dd></div><div><dt>结构版本</dt><dd>{active?.schemaVersion ? `v${active.schemaVersion}` : '—'} <span>{active ? `/ v${active.expectedVersion}` : ''}</span></dd></div><div><dt>文件大小</dt><dd>{size(active?.sizeBytes ?? null)}</dd></div><div><dt>作品数量</dt><dd>{active?.projectCount ?? '—'}</dd></div></dl>
          {active?.instanceId && <div className="ww-db-instance"><span>数据库实例</span><code>{active.instanceId}</code></div>}
          {active && !active.status.databaseReady && connected && <p className="ww-db-help">{active.status.state === 'unconfigured' ? '在左侧填写路径并测试连接。' : active.status.message}</p>}
          <button className="ww-link-button" disabled={!!busy} onClick={() => void controller.refresh()}>{busy === 'load' ? '正在刷新…' : '刷新当前状态 ↻'}</button>
        </section>
        <section className="ww-db-notes"><h2>关于数据保存</h2><p>测试连接会检查文件、结构版本与迁移记录。完整内容校验与备份可通过数据库管理命令完成。</p><p>新建或升级数据库后，回到这里重新测试连接并保存配置。</p></section>
      </aside>
    </div>
  </>
}
