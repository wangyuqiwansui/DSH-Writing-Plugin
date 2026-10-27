import { isAbsolute } from 'node:path'
import type { DatabaseConfig } from '../contracts/index.js'
/** Standard Schema v1 accepted by Cordis 4.0.5. Config does not initialize storage. */
export const DatabaseConfigSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'dsh-writing-workbench',
    validate(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { issues: [{ message: 'Expected database configuration object' }] }
      const config = value as Record<string, unknown>
      if (Object.keys(config).some(key => key !== 'databasePath')) return { issues: [{ message: 'Unknown database configuration field' }] }
      const path = config.databasePath
      if (path === undefined) return { value: {} as DatabaseConfig }
      if (typeof path !== 'string' || !path.trim() || path !== path.trim() || path.includes('\0') || !isAbsolute(path)
        || path.startsWith('\\\\') || path.startsWith('//') || (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(path))) {
        return { issues: [{ message: 'databasePath must be an absolute local file path / 数据库地址必须是本机绝对文件路径' }] }
      }
      return { value: { databasePath: path } }
    },
  },
}
