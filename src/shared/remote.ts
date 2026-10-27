import { knowledgeRemote } from '../modules/knowledge-core/remote-contract.js'
import { knowledgeQueryRemote } from '../modules/knowledge-query/contracts.js'
import { modelsRemote } from '../modules/models/contracts.js'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { databaseRemote } from '../modules/database/contracts/management.js'
import { wikiRemote } from '../modules/wiki/contracts/index.js'
import { qualityRemote } from '../modules/quality/contracts.js'
import { worldRemote } from '../modules/worldbuilding/contracts/index.js'
import { chatRemote } from '../modules/chat/contracts.js'
import { personaRemote } from '../modules/author-persona/contracts/index.js'

/** The npm package contributes once per face; modules retain their own typed services. */
export const workbenchRemote: TypertRemoteContribution = { package: 'dsh-writing-workbench',
  descriptors: [...knowledgeRemote.descriptors, ...knowledgeQueryRemote.descriptors, ...modelsRemote.descriptors, ...databaseRemote.descriptors, ...wikiRemote.descriptors, ...qualityRemote.descriptors, ...worldRemote.descriptors, ...chatRemote.descriptors, ...personaRemote.descriptors] }
