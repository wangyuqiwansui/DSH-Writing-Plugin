import { accessSync, constants, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { inspectDatabase } from './database-status.js'
import { migrations, validateSchema } from './database-schema.js'
import type { DatabaseInspection } from '../../modules/database/contracts/management.js'

const packagePath = fileURLToPath(new URL('../../../', import.meta.url))
function quote(value: string): string {
  return process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`
}

/** All probes are read-only. Readiness is not a full payload-integrity audit. */
export function inspectDatabaseSettings(databasePath?: string, signal?: AbortSignal): DatabaseInspection {
  signal?.throwIfAborted()
  const status = inspectDatabase(databasePath, signal)
  const result: DatabaseInspection = {
    status, checkedAt: new Date().toISOString(), expectedVersion: migrations().length,
    schemaVersion: null, instanceId: null, sizeBytes: null, projectCount: null, writable: false,
    command: null, commandShell: process.platform === 'win32' ? 'PowerShell' : 'Shell',
  }
  if (['missing', 'migration_required'].includes(status.state)) {
    result.command = `npm --prefix ${quote(packagePath)} run db:init -- --db ${quote(status.databasePath)}`
  }
  if (!status.databaseReady) return result
  let database: DatabaseSync | undefined
  try {
    result.sizeBytes = statSync(status.databasePath).size
    database = new DatabaseSync(status.databasePath, { readOnly: true })
    database.exec('PRAGMA busy_timeout = 1000; BEGIN')
    result.instanceId = validateSchema(database)
    result.schemaVersion = Number(database.prepare('PRAGMA user_version').get()!.user_version)
    result.projectCount = Number(database.prepare('SELECT COUNT(*) AS count FROM projects').get()!.count)
    accessSync(status.databasePath, constants.W_OK)
    accessSync(dirname(status.databasePath), constants.W_OK)
    result.writable = true
    result.status = { ...status, message: '数据库结构与迁移记录检查通过，文件及目录具备写入权限。' }
  } catch {
    result.status = { ...status, state: 'unreadable', databaseReady: false, nextAction: 'inspect_database',
      message: '数据库在检查期间发生变化，或文件及目录无访问权限。请确认路径和权限后重新检查。' }
  } finally { database?.close() }
  signal?.throwIfAborted()
  return result
}
