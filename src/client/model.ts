import type { ComponentType } from 'react'

export interface WorkbenchEntry {
  id: string
  title: string
  description: string
  state: 'available' | 'unavailable'
  reason?: string
  component: ComponentType
}

export interface WorkbenchSnapshot {
  open: boolean
  page: string
  entries: readonly WorkbenchEntry[]
  recent: readonly string[]
}

/** Local navigation only. Project data and business operations belong to future providers. */
export class WorkbenchController {
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
  open = (): void => this.update({ open: true })
  close = (): void => this.update({ open: false })
  navigate = (page: string): void => {
    const entry = this.snapshot.entries.find(item => item.id === page)
    if (!['home', 'world', 'settings'].includes(page) && entry?.state !== 'available') {
      this.update({ page: 'home' })
      return
    }
    this.update({ page, recent: entry ? [page, ...this.snapshot.recent.filter(id => id !== page)].slice(0, 5) : this.snapshot.recent })
  }
  register(entry: WorkbenchEntry): () => void {
    if (this.disposed) throw new Error('Writing workbench has been disposed')
    if (!/^[a-z][a-z0-9-]*$/.test(entry.id) || ['home', 'world', 'settings'].includes(entry.id)) throw new Error('Reserved or invalid workbench entry id')
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
    this.update({ open: false, page: 'home', entries: [], recent: [] })
    this.disposed = true
    this.listeners.clear()
  }
}
