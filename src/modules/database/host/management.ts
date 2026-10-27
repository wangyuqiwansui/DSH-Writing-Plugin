import type { DatabaseDataPort } from '../../../shared/middleware.js'
import { createHash } from 'node:crypto'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { canonicalJson } from '../../../shared/contracts/index.js'
import type { DatabaseConfig } from '../contracts/index.js'
import { parsePath, parseSaveRequest, type DatabaseInspection, type DatabaseSettings, type SaveDatabaseRequest } from '../contracts/management.js'
import { DatabaseConfigSchema } from './config.js'

export interface ConfigurationPort {
  available(): boolean
  current(): Record<string, unknown>
  edit(change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}
export function configurationRevision(config: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex')
}
/** Owns only this plugin's configuration. ConfigEditor owns persistence and rollback. */
export class DatabaseManagement {
  constructor(private readonly config: DatabaseConfig, private readonly port: ConfigurationPort, private readonly data: DatabaseDataPort) {}
  read(signal?: AbortSignal): DatabaseSettings {
    signal?.throwIfAborted()
    const editable = this.port.available()
    return { databasePath: this.config.databasePath ?? '', revision: configurationRevision(this.port.current()),
      editable, readOnlyReason: editable ? null : '当前宿主未提供可编辑的 profile 配置。请在 DSH 的插件配置中设置 databasePath。',
      inspection: this.data.inspect(this.config.databasePath, signal) }
  }
  inspect(databasePath: string, signal?: AbortSignal): DatabaseInspection {
    return this.data.inspect(parsePath(databasePath), signal)
  }
  async save(request: SaveDatabaseRequest, signal?: AbortSignal): Promise<{ databasePath: string }> {
    const input = parseSaveRequest(request)
    signal?.throwIfAborted()
    if (!this.port.available()) throw new RemoteError('writing-database/unavailable', '当前配置不可编辑，请检查 DSH profile 和配置服务。', {})
    try {
      await this.port.edit(current => {
        signal?.throwIfAborted()
        if (configurationRevision(current) !== input.revision) {
          throw new RemoteError('writing-database/conflict', '配置已被其他窗口或外部文件修改。请刷新当前配置，再确认需要保存的路径。', {})
        }
        const candidate = { ...current, databasePath: input.databasePath }
        const validation = DatabaseConfigSchema['~standard'].validate({ databasePath: candidate.databasePath })
        if (validation.issues) throw new RemoteError('gateway/bad-request', validation.issues[0]!.message, {})
        const inspection = this.inspect(input.databasePath, signal)
        if (!inspection.status.databaseReady || !inspection.writable) {
          throw new RemoteError('writing-database/not-ready', inspection.status.message, {})
        }
        return candidate
      })
      // Once persistence begins, cancellation cannot prove the write was undone.
      // The client always reads the applied configuration back before reporting success.
      return { databasePath: input.databasePath }
    } catch (error) {
      if (error instanceof RemoteError || signal?.aborted) throw error
      throw new RemoteError('writing-database/save-failed', `保存未完成：${error instanceof Error ? error.message : '配置服务异常'}。请刷新核对当前配置。`, {})
    }
  }
}
