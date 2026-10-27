// Opt-in UI fixtures. Never read a local database or persist a DSH configuration.
import type { DatabaseBackend, DatabaseInspection, DatabaseSettings } from '../src/modules/database/contracts/management.js'

export function databasePreview(initial: 'ready' | 'unconfigured' | 'readonly'): DatabaseBackend {
  let selected = initial === 'unconfigured' ? '' : 'C:\\Writing\\novel.sqlite3'
  let revision = 0
  function inspect(path: string): DatabaseInspection {
    const state = !path ? 'unconfigured' : !/^[A-Za-z]:[\\/]/.test(path) ? 'invalid_path'
      : path.includes('missing') ? 'missing' : path.includes('old') ? 'migration_required'
      : path.includes('denied') ? 'unreadable' : 'ready'
    const ready = state === 'ready'
    return { status: { state, databasePath: path, databaseReady: ready, nextAction: ready ? 'none' : 'inspect_database', managementCommand: '',
      message: ready ? '数据库结构与迁移记录检查通过，文件及目录具备写入权限。'
        : state === 'missing' ? '未找到数据库文件，请创建后重新测试连接。'
        : state === 'migration_required' ? '数据库结构版本需要升级，请通过管理命令检查。'
        : state === 'unreadable' ? '无法访问数据库，请检查文件与目录权限。' : '请填写完整的本地数据库文件路径。' },
      checkedAt: new Date().toISOString(), expectedVersion: 4, schemaVersion: ready ? 4 : null,
      instanceId: ready ? 'preview-only-0000-0000-0000-000000000000' : null, projectCount: ready ? 0 : null,
      sizeBytes: ready ? 720896 : null, writable: ready, commandShell: 'PowerShell',
      command: ['missing', 'migration_required'].includes(state) ? `python -X utf8 'C:\\Writing\\scripts\\local_db.py' --db '${path.replaceAll("'", "''")}' init` : null }
  }
  const read = async (): Promise<DatabaseSettings> => ({ databasePath: selected, revision: String(revision).padStart(64, '0'),
    editable: initial !== 'readonly', readOnlyReason: initial === 'readonly' ? '此演示场景模拟未提供配置编辑能力的宿主。' : null,
    inspection: inspect(selected) })
  return { read, inspect: async path => inspect(path), save: async request => {
    if (request.databasePath.includes('fail-save')) throw new Error('演示：配置文件暂时无法写入')
    if (request.databasePath.includes('conflict')) { selected = 'C:\\Writing\\external.sqlite3'; revision++; throw new Error('演示：配置已被其他窗口修改') }
    selected = request.databasePath; revision++; return { databasePath: selected }
  } }
}
