import type { IpcRenderer, IpcRendererEvent } from 'electron'
import {
  THEME_FIRST_PAINT_CHANNEL,
  THEMES_CHANNELS,
  type ThemeChanged,
  type ThemePaint,
  type ThemesBridge,
} from '../shared/theme-library'

interface PaintDocument {
  readonly documentElement: { setAttribute(name: string, value: string): void } | null
  readonly head: { appendChild(node: never): unknown } | null
  createElement(tag: 'style'): { id: string; textContent: string | null }
}

type ObserveDocument = (changed: () => void) => () => void

const page = globalThis as unknown as {
  document: PaintDocument
  MutationObserver: new (changed: () => void) => {
    observe(doc: PaintDocument, options: { childList: boolean; subtree: boolean }): void
    disconnect(): void
  }
}

/** The preload can run before the parser creates the root or head. Observe before any paint. */
export function themeBeforePaint(
  ipc: Pick<IpcRenderer, 'sendSync'>,
  doc: PaintDocument = page.document,
  observe: ObserveDocument = (changed) => {
    const observer = new page.MutationObserver(changed)
    observer.observe(doc, { childList: true, subtree: true })
    return () => observer.disconnect()
  },
): void {
  let paint: ThemePaint | null
  try {
    paint = ipc.sendSync(THEME_FIRST_PAINT_CHANNEL) as ThemePaint | null
  } catch {
    return
  }
  if (!paint) return
  const apply = (): boolean => {
    if (!doc.documentElement || !doc.head) return false
    if (paint.id !== null) {
      const style = doc.createElement('style')
      // The live renderer updates this same style after its asynchronous reading settles.
      style.id = 'brobot-theme'
      style.textContent = paint.css
      doc.head.appendChild(style as never)
      for (const [name, value] of Object.entries(paint.attributes))
        doc.documentElement.setAttribute(name, value)
      doc.documentElement.setAttribute('data-theme', paint.id)
    }
    return true
  }
  if (apply()) return
  const stop = observe(() => {
    if (apply()) stop()
  })
}

export function themesBridge(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'off'>): ThemesBridge {
  return Object.freeze({
    list: () => ipc.invoke(THEMES_CHANNELS.list) as ReturnType<ThemesBridge['list']>,
    read: (id?: string) => ipc.invoke(THEMES_CHANNELS.read, id) as ReturnType<ThemesBridge['read']>,
    set: (id: string) => ipc.invoke(THEMES_CHANNELS.set, id) as ReturnType<ThemesBridge['set']>,
    duplicate: (id: string, name: string) =>
      ipc.invoke(THEMES_CHANNELS.duplicate, id, name) as ReturnType<ThemesBridge['duplicate']>,
    delete: (id: string) =>
      ipc.invoke(THEMES_CHANNELS.delete, id) as ReturnType<ThemesBridge['delete']>,
    openFolder: () =>
      ipc.invoke(THEMES_CHANNELS.openFolder) as ReturnType<ThemesBridge['openFolder']>,
    onChanged: (listener: (snapshot: ThemeChanged) => void): (() => void) => {
      const forward = (_event: IpcRendererEvent, snapshot: ThemeChanged): void => listener(snapshot)
      ipc.on(THEMES_CHANNELS.changed, forward)
      return () => {
        ipc.off(THEMES_CHANNELS.changed, forward)
      }
    },
  })
}
