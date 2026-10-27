import { KnowledgeController } from '../modules/knowledge-core/client/controller.js'
import type { ModelsBackend } from '../modules/models/client.js'
import type { ComponentType } from 'react'
import { DatabaseController } from '../modules/database/client/controller.js'
import { WikiController } from '../modules/wiki/client/controller.js'
import { QualityController } from '../modules/quality/client/controller.js'
import { NovelController } from '../modules/novel/client/controller.js'
import { WorldController } from '../modules/worldbuilding/client/controller.js'
import { ChatController } from '../modules/chat/client/controller.js'
import { PersonaController } from '../modules/author-persona/client/controller.js'

export interface WorkbenchEntry {
  id: string
  title: string
  description: string
  state: 'available' | 'unavailable'
  reason?: string
  component: ComponentType
}

export interface WorkbenchSnapshot {
  modelsBackend?: ModelsBackend
  open: boolean
  page: string
  entries: readonly WorkbenchEntry[]
  recent: readonly string[]
}

/** Navigation owns controller lifetime; modules own their data and operations. */
export class WorkbenchController {
  readonly knowledge = new KnowledgeController()
  readonly database = new DatabaseController()
  readonly wiki = new WikiController()
  readonly quality = new QualityController()
  readonly novel = new NovelController()
  readonly world = new WorldController()
  readonly chat = new ChatController()
  readonly persona = new PersonaController()
  private listeners = new Set<() => void>()
  private disposed = false
  private snapshot: WorkbenchSnapshot = { open: false, page: 'home', entries: [], recent: [] }
  getSnapshot = (): WorkbenchSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private update(patch: Partial<WorkbenchSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  attachModels = (modelsBackend?: ModelsBackend): void => this.update({ modelsBackend })
  open = (): void => this.update({ open: true })
  close = (): void => this.update({ open: false })
  navigate = (page: string): void => {
    if (page === 'settings') page = 'database'
    const entry = this.snapshot.entries.find(item => item.id === page)
    if (!['home', 'world', 'database', 'wiki', 'knowledge'].includes(page) && entry?.state !== 'available') {
      this.update({ page: 'home' })
      return
    }
    this.update({ page, recent: entry || page === 'wiki' || page === 'world' ? [page, ...this.snapshot.recent.filter(id => id !== page)].slice(0, 5) : this.snapshot.recent })
  }
  register(entry: WorkbenchEntry): () => void {
    if (this.disposed) throw new Error('Writing workbench has been disposed')
    if (!/^[a-z][a-z0-9-]*$/.test(entry.id) || ['home', 'world', 'settings', 'database', 'wiki', 'knowledge'].includes(entry.id)) throw new Error('Reserved or invalid workbench entry id')
    if (this.snapshot.entries.some(item => item.id === entry.id)) throw new Error('Duplicate workbench entry id')
    const copy = Object.freeze({ ...entry })
    this.update({ entries: [...this.snapshot.entries, copy] })
    return () => this.update({
      entries: this.snapshot.entries.filter(item => item !== copy),
      recent: this.snapshot.recent.filter(id => id !== copy.id),
      page: this.snapshot.page === copy.id ? 'home' : this.snapshot.page,
    })
  }
  dispose(): void {
    this.knowledge.dispose()
    this.database.dispose()
    this.wiki.dispose()
    this.quality.dispose()
    this.novel.dispose()
    this.world.dispose()
    this.chat.dispose()
    this.persona.dispose()
    this.update({ open: false, page: 'home', entries: [], recent: [] })
    this.disposed = true
    this.listeners.clear()
  }
}
