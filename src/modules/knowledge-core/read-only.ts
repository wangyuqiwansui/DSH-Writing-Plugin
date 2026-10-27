/** Public snapshot algorithms: no database, host, model execution or mutation capability. */
export { chunkText, retrieve, evidence, digest } from './retrieval.js'
export { answerPacket, parseAnswer } from './model-codecs.js'
export type { Corpus, QueryInput, Hit, Evidence, Answer, PacketFormat } from './contracts.js'
