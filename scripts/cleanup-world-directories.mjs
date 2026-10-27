// Explicit maintenance: dry run by default; --apply requires a user-authorized deletion.
import { parseArgs } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { cleanupWorldDirectories } from '../lib/infrastructure/storage/world-directory-cleanup.js'
const { values } = parseArgs({ options: { db: { type: 'string' }, apply: { type: 'boolean', default: false }, report: { type: 'string' } } })
if (!values.db) throw new Error('Use --db <absolute existing database path> [--apply] [--report <file>]')
const report = await cleanupWorldDirectories(values.db, { apply: values.apply })
if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ applied: report.applied, changedVersions: report.changedVersions, changedCommands: report.changedCommands, changedEvents: report.changedEvents, backupPath: report.backupPath }))
