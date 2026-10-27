import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SchemaMismatch, validateSchema } from './database-schema.js'
import type { StorageStatus } from '../../shared/contracts/index.js'

export const MANAGEMENT_COMMAND = 'npm run db:init -- --db "<absolute-path>"'

export type DatabaseState = 'unconfigured' | 'missing' | 'invalid_path' | 'not_a_file'
  | 'unreadable' | 'invalid_database' | 'migration_required' | 'ready'

export type DatabaseStatus = StorageStatus

function report(state: DatabaseState, databasePath: string, message: string): DatabaseStatus {
  return {
    state,
    databaseReady: state === 'ready',
    databasePath,
    message,
    nextAction: state === 'ready' ? 'none'
      : state === 'unconfigured' || state === 'missing' ? 'initialize_database' : 'inspect_database',
    managementCommand: MANAGEMENT_COMMAND,
  }
}

/** Never creates a file, chooses a fallback path, migrates storage, or writes a row. */
export function inspectDatabase(databasePath?: string, signal?: AbortSignal): DatabaseStatus {
  signal?.throwIfAborted()
  const selectedPath = databasePath?.trim() ?? ''
  if (!selectedPath) {
    return report('unconfigured', '',
      `数据库尚未配置。指定本地绝对路径后运行 ${MANAGEMENT_COMMAND}，并将同一路径配置到插件 databasePath。`)
  }
  const driveQualified = process.platform !== 'win32' || /^[A-Za-z]:[\\/]/.test(selectedPath)
  if (!isAbsolute(selectedPath) || !driveQualified || selectedPath.startsWith('\\\\') || selectedPath.startsWith('//')) {
    return report('invalid_path', selectedPath,
      '数据库地址必须是本机绝对文件路径。请修改插件 databasePath 配置。')
  }
  try {
    if (!statSync(selectedPath).isFile()) {
      return report('not_a_file', selectedPath,
        '配置的数据库地址不是文件。请在 databasePath 中选择完整数据库文件路径。')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return report('missing', selectedPath,
        `未找到配置的数据库。请运行 ${MANAGEMENT_COMMAND} 初始化；插件运行时不会自动创建数据库。`)
    }
    return report('unreadable', selectedPath, '无法读取配置的数据库路径，请检查访问权限及父目录；未创建或修改文件。')
  }

  signal?.throwIfAborted()
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(selectedPath, { readOnly: true })
    database.exec('PRAGMA busy_timeout = 1000')
    database.exec('BEGIN')
    validateSchema(database)
    signal?.throwIfAborted()
    return report('ready', selectedPath, '本地数据库已就绪，共享存储接口可用；小说业务插件尚待接入。')
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof SchemaMismatch) return report(error.state, selectedPath, error.message)
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      return report('unreadable', selectedPath, '数据库不可访问，请检查权限；未修改文件。')
    }
    return report('invalid_database', selectedPath, '数据库无法打开或读取，请检查文件、权限及占用情况；未自动修复或重建。')
  } finally {
    database?.close()
  }
}

/** Guard for future writing operations; readiness is rechecked for every operation. */
export function requireDatabase(databasePath?: string, signal?: AbortSignal): DatabaseStatus {
  const status = inspectDatabase(databasePath, signal)
  if (!status.databaseReady) throw new DatabaseNotReadyError(status)
  return status
}

export class DatabaseNotReadyError extends Error {
  readonly code = 'WRITING_DATABASE_NOT_READY'
  constructor(readonly status: DatabaseStatus) {
    super(status.message)
    this.name = 'DatabaseNotReadyError'
  }
}
