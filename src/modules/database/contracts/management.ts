import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { StorageStatus } from '../../../shared/contracts/index.js'

export interface DatabaseInspection {
  status: StorageStatus
  checkedAt: string
  expectedVersion: number
  schemaVersion: number | null
  instanceId: string | null
  sizeBytes: number | null
  projectCount: number | null
  writable: boolean
  command: string | null
  commandShell: 'PowerShell' | 'Shell'
}
export interface DatabaseSettings {
  databasePath: string
  revision: string
  editable: boolean
  readOnlyReason: string | null
  inspection: DatabaseInspection
}
export interface SaveDatabaseRequest { databasePath: string; revision: string }
export interface SaveDatabaseResult { databasePath: string }
/** The client cannot select a plugin entry, run SQL, or execute a management command. */
export interface DatabaseBackend {
  read(signal: AbortSignal): Promise<DatabaseSettings>
  inspect(databasePath: string, signal: AbortSignal): Promise<DatabaseInspection>
  save(request: SaveDatabaseRequest, signal: AbortSignal): Promise<SaveDatabaseResult>
}

export function parsePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\0\r\n]/.test(value)) {
    throw new Error('请输入完整的本地数据库文件路径。')
  }
  return value.trim()
}
export function parseSaveRequest(value: unknown): SaveDatabaseRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置请求格式无效。')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 2 || Object.keys(input).some(key => !['databasePath', 'revision'].includes(key))
    || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) throw new Error('配置版本无效，请刷新后重试。')
  return { databasePath: parsePath(input.databasePath), revision: input.revision }
}

// One explicit strict descriptor contract is shared by the Host registry and Client mount.
// Typert's public codec contract requires parse(); no Host module enters the browser bundle.
const descriptors: readonly InvocationDescriptor[] = [
  { method: 'read', parameters: [] },
  { method: 'inspect', parameters: [{ name: 'databasePath', wire: 'databasePath', source: 'json' as const,
    codec: { mode: 'strict' as const, typeSymbol: 'DatabasePath', create: () => ({ parse: parsePath }) } }] },
  { method: 'save', parameters: [{ name: 'request', wire: 'request', source: 'json' as const,
    codec: { mode: 'strict' as const, typeSymbol: 'SaveDatabaseRequest', create: () => ({ parse: parseSaveRequest }) } }] },
].map(method => ({ ...method, id: `dsh-writing-workbench#writingDatabase/${method.method}`,
  service: 'writingDatabase', namespace: 'writingDatabase', invocation: { kind: 'direct' as const },
  cancellation: { parameter: 'signal' as const }, result: { mode: 'src-json' as const } }))
export const databaseRemote: TypertRemoteContribution = { package: 'dsh-writing-workbench', descriptors }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    writingDatabase: {
      read(signal?: AbortSignal): Promise<RemoteResult<DatabaseSettings>>
      inspect(databasePath: string, signal?: AbortSignal): Promise<RemoteResult<DatabaseInspection>>
      save(request: SaveDatabaseRequest, signal?: AbortSignal): Promise<RemoteResult<SaveDatabaseResult>>
    }
  }
  interface RemoteErrorDetailsMap {
    'writing-database/conflict': {}
    'writing-database/unavailable': {}
    'writing-database/not-ready': {}
    'writing-database/save-failed': {}
    'writing-database/owner-required': {}
  }
}
