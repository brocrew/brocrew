import { describe, expect, it } from 'vitest'
import type {
  ThemeChanged,
  ThemeReading,
  ThemeRefused,
  ThemesBridge,
} from '../../src/shared/theme-library'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import { THEME_STYLE_ID, type ThemeDocument } from '../../src/renderer/src/lib/apply-theme'
import {
  FIRST_THEME_WAIT_MS,
  onThemesChanged,
  readingAssetUrl,
  startWindowTheme,
  themeBeforeDrawing,
} from '../../src/renderer/src/lib/window-theme'
import { contextFor, DEFINED, SAMPLES } from './fixtures'

/** A document with a root, a head and elements by id: what `applyTheme` touches. */
function fakeDocument() {
  const attributes = new Map<string, string>()
  const head: { id: string; textContent: string | null; remove(): void }[] = []
  const doc: ThemeDocument = {
    documentElement: {
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => void attributes.set(name, value),
      removeAttribute: (name) => void attributes.delete(name),
    },
    head: { appendChild: (node: never) => head.push(node) },
    getElementById: (id) => head.find((node) => node.id === id) ?? null,
    createElement: () => {
      const node = {
        id: '',
        textContent: null as string | null,
        remove: () => void head.splice(head.indexOf(node), 1),
      }
      return node
    },
  }
  return { doc, attributes, css: () => head.find((n) => n.id === THEME_STYLE_ID)?.textContent }
}

function sample(name: string): Theme {
  const s = SAMPLES[name]!
  const r = validateTheme(s.file, contextFor(s.assets, s.pictures))
  if (!r.ok) throw new Error(JSON.stringify(r.problems))
  return resolveTheme(r.theme, DEFINED)
}

const reading = (theme: Theme | null, versions: Record<string, string> = {}): ThemeReading => ({
  active: theme?.id ?? 'classic',
  theme,
  version: theme ? 'v' : null,
  assetVersions: versions,
})

/** A bridge whose answers the test hands out one by one, in any order. */
function bridge() {
  const pending: ((r: ThemeReading | ThemeRefused) => void)[] = []
  const listeners: ((c: ThemeChanged) => void)[] = []
  let failing = false
  const themes = {
    read: () => {
      if (failing) {
        failing = false
        return Promise.reject(new Error('the host could not read it'))
      }
      return new Promise<ThemeReading | ThemeRefused>((done) => pending.push(done))
    },
    onChanged: (listener: (c: ThemeChanged) => void) => {
      listeners.push(listener)
      return () => void listeners.splice(listeners.indexOf(listener), 1)
    },
  } as unknown as ThemesBridge
  return {
    themes,
    pending,
    listeners,
    failNext: () => void (failing = true),
    change: (c: Partial<ThemeChanged>) =>
      listeners.forEach((l) => l({ active: 'x', requested: null, themes: [], ...c })),
  }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

describe('the window takes its theme before it draws, and follows every change', () => {
  it('applies the first reading, and classic is the app’s own look', async () => {
    const b = bridge()
    const page = fakeDocument()
    const followed = startWindowTheme(b.themes, { doc: page.doc })
    b.pending.shift()!(reading(sample('zen')))
    await followed.ready
    expect(page.attributes.get('data-theme')).toBe('zen')
    b.change({ active: 'classic' })
    b.pending.shift()!(reading(null))
    await settle()
    expect(page.attributes.has('data-theme')).toBe(false)
    expect(page.css()).toBeUndefined()
  })

  it('a slow older answer never replaces a newer one', async () => {
    const b = bridge()
    const page = fakeDocument()
    startWindowTheme(b.themes, { doc: page.doc })
    b.change({ active: 'zen' })
    const [first, second] = [b.pending.shift()!, b.pending.shift()!]
    second(reading(sample('zen')))
    await settle()
    first(reading(sample('win95')))
    await settle()
    expect(page.attributes.get('data-theme')).toBe('zen')
  })

  it('a refusal or an unreadable first answer leaves the app’s own look', async () => {
    const b = bridge()
    const page = fakeDocument()
    const followed = startWindowTheme(b.themes, { doc: page.doc })
    b.pending.shift()!({ outcome: 'refused', rail: 'theme-unknown', problems: [] })
    await followed.ready
    expect(page.attributes.has('data-theme')).toBe(false)
  })

  it('a change is reported once its own read is on, with who made it', async () => {
    const b = bridge()
    const page = fakeDocument()
    const told: ThemeChanged[] = []
    startWindowTheme(b.themes, { doc: page.doc, onChange: (c) => told.push(c) })
    b.pending.shift()!(reading(null))
    b.change({ active: 'zen', previous: 'classic' })
    b.pending.shift()!(reading(sample('zen')))
    await settle()
    b.change({ active: 'win95', previous: 'zen', actor: 'Research' })
    b.pending.shift()!(reading(sample('win95')))
    await settle()
    expect(told.map((c) => [c.actor, c.previous, c.active])).toEqual([
      [undefined, 'classic', 'zen'],
      ['Research', 'zen', 'win95'],
    ])
    expect(page.attributes.get('data-theme')).toBe('win95')
  })

  it('an agent’s change whose read a person’s change overtook is never reported', async () => {
    const b = bridge()
    const page = fakeDocument()
    const told: ThemeChanged[] = []
    startWindowTheme(b.themes, { doc: page.doc, onChange: (c) => told.push(c) })
    b.pending.shift()!(reading(null))
    await settle()
    b.change({ active: 'win95', previous: 'classic', actor: 'Research' })
    const agents = b.pending.shift()!
    b.change({ active: 'zen', previous: 'win95' })
    b.pending.shift()!(reading(sample('zen')))
    await settle()
    agents(reading(sample('win95')))
    await settle()
    expect(told.map((c) => [c.actor, c.active])).toEqual([[undefined, 'zen']])
    expect(page.attributes.get('data-theme')).toBe('zen')
  })

  it('a change whose read failed, or was refused, is never reported', async () => {
    const b = bridge()
    const page = fakeDocument()
    const told: ThemeChanged[] = []
    startWindowTheme(b.themes, { doc: page.doc, onChange: (c) => told.push(c) })
    b.pending.shift()!(reading(sample('zen')))
    await settle()
    b.failNext()
    b.change({ active: 'win95', previous: 'zen', actor: 'Research' })
    await settle()
    b.change({ active: 'win95', previous: 'zen', actor: 'Research' })
    b.pending.shift()!({ outcome: 'refused', rail: 'theme-unknown', problems: [] })
    await settle()
    expect(told).toEqual([])
  })

  it('a change read at another version than it announced is not reported', async () => {
    const b = bridge()
    const page = fakeDocument()
    const told: ThemeChanged[] = []
    startWindowTheme(b.themes, { doc: page.doc, onChange: (c) => told.push(c) })
    b.pending.shift()!(reading(null))
    const rows = [
      { id: 'win95', name: 'W', source: 'built-in' as const, status: 'ok' as const, version: 'v2' },
    ]
    b.change({ active: 'win95', previous: 'classic', actor: 'Research', themes: rows })
    b.pending.shift()!(reading(sample('win95')))
    await settle()
    expect(told).toEqual([])
  })

  it('every announcement reaches the window’s followers through its one listener', async () => {
    const b = bridge()
    const followed = startWindowTheme(b.themes, { doc: fakeDocument().doc })
    const heard: string[] = []
    const stop = onThemesChanged((c) => heard.push(c.active))
    b.change({ active: 'zen' })
    b.change({ active: 'win95' })
    stop()
    b.change({ active: 'classic' })
    expect(heard).toEqual(['zen', 'win95'])
    expect(b.listeners).toHaveLength(1)
    followed.stop()
  })

  it('stop() lets go of the bridge and applies nothing after', async () => {
    const b = bridge()
    const page = fakeDocument()
    const followed = startWindowTheme(b.themes, { doc: page.doc })
    followed.stop()
    expect(b.listeners).toHaveLength(0)
    b.pending.shift()!(reading(sample('zen')))
    await settle()
    expect(page.attributes.has('data-theme')).toBe(false)
  })

  it('ready waits for a theme to be on when the first read is overtaken', async () => {
    const b = bridge()
    const page = fakeDocument()
    const followed = startWindowTheme(b.themes, { doc: page.doc })
    let ready = false
    void followed.ready.then(() => (ready = true))
    b.change({ active: 'zen' })
    const [first, second] = [b.pending.shift()!, b.pending.shift()!]
    first(reading(sample('win95')))
    await settle()
    expect(ready).toBe(false)
    expect(page.attributes.has('data-theme')).toBe(false)
    second(reading(sample('zen')))
    await settle()
    expect(ready).toBe(true)
    expect(page.attributes.get('data-theme')).toBe('zen')
  })

  it('ready settles on the app’s own look when the first read fails', async () => {
    const b = bridge()
    b.failNext()
    const followed = startWindowTheme(b.themes, { doc: fakeDocument().doc })
    await expect(followed.ready).resolves.toBeUndefined()
  })

  it('with no bridge, the window draws at once in its own look', async () => {
    await expect(startWindowTheme(undefined).ready).resolves.toBeUndefined()
  })

  it('the first draw waits for the theme, but no longer than the bound', async () => {
    const never = { ready: new Promise<void>(() => undefined), stop: () => undefined }
    const waited: number[] = []
    await themeBeforeDrawing(never, async (ms) => void waited.push(ms))
    expect(waited).toEqual([FIRST_THEME_WAIT_MS])
  })
})

describe('a theme’s files are fetched from their own theme, at its version', () => {
  it('own files and inherited ones carry their owner’s version', () => {
    const url = readingAssetUrl(
      reading(
        { format: 1, id: 'mine', name: 'Mine' },
        { mine: 'a'.repeat(64), brocrew: 'b'.repeat(64) },
      ),
    )
    expect(url('assets/x.png')).toBe(`brobot-theme://mine/assets/x.png?v=${'a'.repeat(64)}`)
    expect(url('@brocrew/assets/net.png')).toBe(
      `brobot-theme://brocrew/assets/net.png?v=${'b'.repeat(64)}`,
    )
  })
})
