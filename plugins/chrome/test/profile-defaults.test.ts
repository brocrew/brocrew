import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import { createChromeBrowser } from '../src/index.js'
import { HELPER_ID } from '../src/extensions.js'
import { silentLogger } from '../src/logger.js'
import { DEFAULTS_VERSION, createProfileStore } from '../src/profiles/store.js'
import type { ChromiumLaunchOptions } from '../src/shared/browser/browser-launch.js'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-defaults-'))
  homes.push(dir)
  return dir
}
const file = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8'))
const flags = (dir: string, name: string) => {
  const p = file(dir).profiles.find((one: { name: string }) => one.name === name)
  return { allowExtensions: p.allowExtensions, allowSync: p.allowSync }
}

describe('sync and extensions are on by default', () => {
  it('new profiles start with both on; temporary ones keep both off', () => {
    const dir = home()
    const store = createProfileStore({ home: dir })
    store.create('fern', 'panel')
    store.create('scratch-1', 'agent', { temporary: true })
    expect(flags(dir, 'fern')).toEqual({ allowExtensions: true, allowSync: true })
    expect(flags(dir, 'scratch-1')).toEqual({ allowExtensions: false, allowSync: false })
    expect(file(dir).defaults).toBe(DEFAULTS_VERSION)
  })
  it('switches existing profiles on once, then keeps the person’s later choice', () => {
    const dir = home()
    fs.writeFileSync(
      path.join(dir, 'profiles.json'),
      JSON.stringify({
        profiles: [
          { name: 'fern', enabled: true, allowExtensions: false, allowSync: false },
          {
            name: 'willow',
            enabled: false,
            allowExtensions: false,
            allowSync: true,
            allowSettings: true,
          },
          { name: 'scratch-1', enabled: true, temporary: true },
        ],
      }),
    )
    const store = createProfileStore({ home: dir })
    expect(flags(dir, 'fern')).toEqual({ allowExtensions: true, allowSync: true })
    expect(flags(dir, 'willow')).toEqual({ allowExtensions: true, allowSync: true })
    expect(store.get('willow')).toMatchObject({ enabled: false, allowSettings: true })
    expect(flags(dir, 'scratch-1')).toEqual({ allowExtensions: false, allowSync: false })
    store.setFlags('fern', { allowExtensions: false, allowSync: false })
    createProfileStore({ home: dir })
    createProfileStore({ home: dir })
    expect(flags(dir, 'fern')).toEqual({ allowExtensions: false, allowSync: false })
    expect(file(dir).defaults).toBe(DEFAULTS_VERSION)
  })
  it('an unreadable profiles.json still fails only the calls that read it', () => {
    const dir = home()
    fs.writeFileSync(path.join(dir, 'profiles.json'), '{ not json')
    const store = createProfileStore({ home: dir })
    expect(() => store.list()).toThrow('not valid')
  })
})

class Context extends EventEmitter {
  sent: string[] = []
  pages() {
    return []
  }
  serviceWorkers() {
    return []
  }
  browser() {
    return {
      on() {},
      isConnected: () => true,
      newBrowserCDPSession: async () => ({
        on() {},
        detach: async () => {},
        send: async (method: string) => {
          this.sent.push(method)
          if (method === 'Extensions.getExtensions') return { extensions: [] }
          if (method === 'Extensions.loadUnpacked') throw new Error('Method not available.')
          if (method === 'Extensions.uninstall') return {}
          return {}
        },
      }),
    }
  }
  async close() {
    this.emit('close')
  }
}
async function launch(
  mode: 'visible' | 'headless',
  set?: { allowExtensions?: boolean; allowSync?: boolean },
  before?: (store: ReturnType<typeof createProfileStore>) => void,
) {
  const dir = home()
  const store = createProfileStore({ home: dir })
  store.create('fern', 'panel')
  store.setFlags('fern', { enabled: true, ...set })
  before?.(store)
  const launches: ChromiumLaunchOptions[] = []
  const context = new Context()
  const browser = createChromeBrowser(store, silentLogger, undefined, undefined, {
    downloadsRoot: path.join(dir, 'downloads'),
    lockHeld: async () => false,
    helperSource: fileURLToPath(new URL('../helper/', import.meta.url)),
    ua: {
      get: async () => ({ userAgent: 'fictional', chromeVersion: '1' }),
      invalidate() {},
      peek: () => null,
    },
    launchContext: async (opts) => {
      launches.push(opts)
      return context as unknown as BrowserContext
    },
  })
  await browser.ensure('fern', mode)
  const state = browser.state('fern')
  await browser.closeAll()
  return { args: launches[0].args ?? [], sent: context.sent, state, store }
}

describe('what a default profile launches with', () => {
  it('no --disable-sync or --disable-extensions, and the helper is tried in a visible profile', async () => {
    const { args, sent, state } = await launch('visible')
    expect(args).not.toContain('--disable-sync')
    expect(args).not.toContain('--disable-extensions')
    expect(args).toContain('--enable-unsafe-extension-debugging')
    expect(sent).toContain('Extensions.loadUnpacked')
    // Chrome refused the load here, so placement degrades instead of failing the launch.
    expect(state?.helper).toBe('unavailable')
  })
  it('headless profiles never get the helper', async () => {
    const { args, sent, state } = await launch('headless')
    expect(args).not.toContain('--disable-extensions')
    expect(args).not.toContain('--enable-unsafe-extension-debugging')
    expect(sent.some((m) => m.startsWith('Extensions.'))).toBe(false)
    expect(state?.helper).toBeUndefined()
  })
  it('a person who turned extensions off keeps them off, with no helper', async () => {
    const { args, sent, state } = await launch('visible', {
      allowExtensions: false,
      allowSync: false,
    })
    expect(args).toContain('--disable-extensions')
    expect(args).toContain('--disable-sync')
    expect(args).not.toContain('--enable-unsafe-extension-debugging')
    expect(sent.some((m) => m.startsWith('Extensions.'))).toBe(false)
    expect(state?.helper).toBeUndefined()
  })
  it.each(['visible', 'headless'] as const)(
    'reads an off switch Chrome recorded in the last session before a %s start, which drops it',
    async (mode) => {
      const { sent, state, store } = await launch(mode, undefined, offRecord)
      expect(store.get('fern')?.helper).toBe('off')
      if (mode === 'visible') expect(state?.helper).toBe('off')
      expect(sent.some((m) => m.startsWith('Extensions.'))).toBe(false)
    },
  )
  it('reads it before a launch with extensions off too', async () => {
    const { store } = await launch('visible', { allowExtensions: false }, offRecord)
    expect(store.get('fern')?.helper).toBe('off')
  })
  it('keeps it off at the next launch, after Chrome dropped its own record', async () => {
    const { sent, state } = await launch('visible', undefined, (store) =>
      store.setHelper('fern', 'off'),
    )
    expect(state?.helper).toBe('off')
    expect(sent.some((m) => m.startsWith('Extensions.'))).toBe(false)
  })
  it('a Turn on pressed while closed beats the older off record at the next launch', async () => {
    const { sent, store } = await launch('visible', undefined, (store) => {
      offRecord(store)
      store.setHelper('fern', 'turning-on')
    })
    // A fresh install over any disabled copy; this fake Chrome refuses the load, so the request
    // stays for the launch after.
    expect(sent.filter((m) => m.startsWith('Extensions.'))).toEqual([
      'Extensions.uninstall',
      'Extensions.loadUnpacked',
    ])
    expect(store.get('fern')?.helper).toBe('turning-on')
  })
  it('a Turn on survives headless launches until a visible one can install it', async () => {
    const { sent, store } = await launch('headless', undefined, (store) => {
      offRecord(store)
      store.setHelper('fern', 'turning-on')
    })
    expect(sent.some((m) => m.startsWith('Extensions.'))).toBe(false)
    expect(store.get('fern')?.helper).toBe('turning-on')
  })
})
/** Chrome's own record of the person switching the helper off, as it leaves it at close. */
function offRecord(store: ReturnType<typeof createProfileStore>) {
  const dir = store.dirOf('fern')
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'Default', 'Preferences'),
    JSON.stringify({
      extensions: {
        settings: {
          [HELPER_ID]: {
            path: fileURLToPath(new URL('../helper/', import.meta.url)),
            location: 4,
            disable_reasons: [1],
          },
        },
      },
    }),
  )
}
