import type { Dialog, Download, Page } from 'playwright-core'
import type { ProfileBrowser } from './browser/profileBrowser.js'
export class TabError extends Error {}
export const RING_SIZE = 200
export interface Ring<T> {
  push(entry: Omit<T, 'seq'>): T
  since(since?: number): T[]
  readonly lastSeq: number
}
export function createRing<
  T extends {
    seq: number
  },
>(size = RING_SIZE): Ring<T> {
  const items: T[] = []
  let seq = 0
  return {
    push(entry) {
      const full = { ...entry, seq: ++seq } as T
      items.push(full)
      if (items.length > size) items.shift()
      return full
    },
    since: (since = 0) => items.filter((i) => i.seq > since),
    get lastSeq() {
      return seq
    },
  }
}
export interface ConsoleLine {
  seq: number
  type: string
  text: string
}
export interface NetworkEntry {
  seq: number
  method: string
  url: string
  status: number | null
  type: string
}
export interface DialogPlan {
  accept: boolean
  promptText?: string
}
export interface TabState {
  id: string
  profile: string
  generation: number
  page: Page
  refs: Set<string> | null
  console: Ring<ConsoleLine>
  network: Ring<NetworkEntry>
  dialogPlan: DialogPlan | null
  pendingDialog: Dialog | null
  notes: string[]
  closed: boolean
  pendingDownloads: Array<{
    download: Download
    at: number
  }>
}
export const MAX_PENDING_DOWNLOADS = 5
export const PENDING_DOWNLOAD_MS = 60000
const MAX_TOMBSTONES = 2000
export function bareUrl(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'javascript:')
      return `${u.protocol}…`
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return raw.split(/[?#]/)[0].slice(0, 300)
  }
}
export interface TabRegistryOptions {
  start?: number
}
export class TabRegistry {
  private next: number
  private readonly tabs = new Map<string, TabState>()
  private readonly byPage = new WeakMap<Page, TabState>()
  private readonly gone = new Map<string, string>()
  constructor(opts: TabRegistryOptions = {}) {
    this.next = opts.start ?? 1 + Math.floor(Math.random() * 9000)
  }
  private readonly privateDownloads = new Map<string, (download: Download) => Promise<boolean>>()
  private readonly watched = new Set<string>()
  watch(profile: string, browser: ProfileBrowser): void {
    if (this.watched.has(profile)) return
    this.watched.add(profile)

    this.privateDownloads.set(
      profile,
      (download) => browser.downloadIsPrivate?.(profile, download) ?? Promise.resolve(true),
    )
    browser.onPage(profile, (page) => {
      const generation = browser.state(profile)?.generation
      if (generation !== undefined) this.add(profile, generation, page)
    })
  }
  add(profile: string, generation: number, page: Page, id?: string): TabState {
    const known = this.byPage.get(page)
    if (known && (id === undefined || known.id === id)) return known
    if (known && id !== undefined) {
      this.tabs.delete(known.id)
      this.gone.delete(id)
      known.id = id
      known.generation = generation
      known.refs = null
      this.tabs.set(id, known)
      return known
    }
    if (id !== undefined) this.gone.delete(id)
    const tab: TabState = {
      id: id ?? `t${this.next++}`,
      profile,
      generation,
      page,
      refs: null,
      console: createRing<ConsoleLine>(),
      network: createRing<NetworkEntry>(),
      dialogPlan: null,
      pendingDialog: null,
      notes: [],
      closed: false,
      pendingDownloads: [],
    }
    this.tabs.set(tab.id, tab)
    this.byPage.set(page, tab)
    this.listen(tab)
    return tab
  }
  tabOf(page: Page): TabState | undefined {
    return this.byPage.get(page)
  }
  resolve(id: string, generationOf: (profile: string) => number | null): TabState {
    const tab = this.tabs.get(id)
    if (!tab)
      throw new TabError(
        this.gone.get(id) ??
          `tab ${safeId(id)} is unknown (the id is wrong, or the server was restarted) — call open_tab again`,
      )
    if (tab.closed || tab.page.isClosed()) {
      this.bury(tab, `tab ${tab.id} no longer exists (the page was closed) — call open_tab again`)
      throw new TabError(this.gone.get(tab.id)!)
    }
    if (generationOf(tab.profile) !== tab.generation) {
      this.bury(
        tab,
        `tab ${tab.id} no longer exists (profile "${tab.profile}" was restarted) — call open_tab again`,
      )
      throw new TabError(this.gone.get(tab.id)!)
    }
    return tab
  }
  list(generationOf: (profile: string) => number | null, profile?: string): TabState[] {
    const out: TabState[] = []
    for (const tab of [...this.tabs.values()]) {
      if (profile !== undefined && tab.profile !== profile) continue
      try {
        out.push(this.resolve(tab.id, generationOf))
      } catch {
        /* Continue without this optional result. */
      }
    }
    return out
  }
  private bury(tab: TabState, reason: string): void {
    this.tabs.delete(tab.id)
    this.gone.set(tab.id, reason)
    if (this.gone.size > MAX_TOMBSTONES) this.gone.delete(this.gone.keys().next().value as string)
  }
  private listen(tab: TabState): void {
    const { page } = tab
    page.on('close', () => {
      tab.closed = true
    })
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) tab.refs = null
    })
    page.on('download', (download) => {
      const beganAt = Date.now()
      const accept = () => {
        if (tab.closed || Date.now() - beganAt > PENDING_DOWNLOAD_MS) return
        tab.pendingDownloads.push({ download, at: beganAt })
        // Bound metadata only. Router retention, not queue eviction, owns the file.
        while (tab.pendingDownloads.length > MAX_PENDING_DOWNLOADS) tab.pendingDownloads.shift()
      }
      // Correlate the GUID artifact with Browser.downloadWillBegin, never the policy
      // at this later Page event. Public/unknown items are neither queued nor deleted.
      const classify = this.privateDownloads.get(tab.profile)
      if (!classify) accept()
      else
        void classify(download)
          .then((owned) => {
            if (owned) accept()
          })
          .catch(() => undefined)
    })
    page.on('console', (msg) => {
      tab.console.push({ type: msg.type(), text: msg.text().slice(0, 500) })
    })
    const entries = new WeakMap<object, NetworkEntry>()
    page.on('request', (req) => {
      entries.set(
        req,
        tab.network.push({
          method: req.method(),
          url: bareUrl(req.url()),
          status: null,
          type: req.resourceType(),
        }),
      )
    })
    page.on('response', (res) => {
      const e = entries.get(res.request())
      if (e) e.status = res.status()
    })
    page.on('requestfailed', (req) => {
      const e = entries.get(req)
      if (e) e.status = 0
    })
    page.on('dialog', (dialog) => {
      tab.pendingDialog = dialog
      const plan = tab.dialogPlan
      if (plan) {
        tab.dialogPlan = null
        void (plan.accept ? dialog.accept(plan.promptText) : dialog.dismiss())
          .then(() => {
            if (tab.pendingDialog === dialog) tab.pendingDialog = null
          })
          .catch(() => undefined)
        return
      }
    })
  }
}
const safeId = (id: string): string => id.replace(/[^\w-]/g, '').slice(0, 20)
