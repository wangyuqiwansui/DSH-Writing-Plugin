/** Public file-snapshot projection. It does not repair references or read/write storage. */
import { parseWorld } from './domain/world.js'
import { queryWorld } from './domain/query.js'
import type { VersionRef } from '../../shared/contracts/index.js'
import type { WorldQuery } from './contracts/index.js'
export function queryWorldSnapshot(document:unknown,ref:VersionRef,query:WorldQuery) {
  return queryWorld(parseWorld(document),ref,query)
}
