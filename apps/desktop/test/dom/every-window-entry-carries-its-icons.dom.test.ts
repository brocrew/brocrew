import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import RecoveryApp from '../../src/renderer/src/components/RecoveryApp.vue'
import { mount, unmountAll } from './harness'
import {
  CONVERSATIONS,
  fakeRecoveryBridge,
  HEADER_EVENTS,
  HISTORY_ONLY,
  NEWER_WITH_A_COPY,
} from './recovery-fake'

/**
 * Every window entry draws its own icons. The icons are `<use href="#i-…">` references into one
 * sprite, and a reference to a symbol nobody mounted draws an empty box with no error. The look
 * tool mounts the sprite itself, so a picture cannot show the omission: this mounts each entry's
 * root as its entry file does, with no sprite of its own, and checks every reference resolves.
 */

/** The renderer's top-level files, read as text: this runs in the browser, so no `node:fs`. */
const TOP: Record<string, string> = import.meta.glob('../../src/renderer/src/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SOURCE: Record<string, string> = import.meta.glob(
  ['../../src/renderer/src/App.vue', '../../src/renderer/src/components/RuntimeScreen.vue'],
  { query: '?raw', import: 'default', eager: true },
)

/** Every renderer entry, by the root component its file mounts with `createApp`. */
function entries(): { file: string; root: string }[] {
  return Object.entries(TOP)
    .flatMap(([path, source]) => {
      const root = /createApp\(\s*(\w+)/.exec(source)?.[1]
      return root ? [{ file: path.split('/').at(-1)!, root }] : []
    })
    .sort((a, b) => a.file.localeCompare(b.file))
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}

/** Icon references in the document that point at no symbol. */
function dangling(): string[] {
  const refs = [...document.querySelectorAll('use')]
    .map((use) => use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '')
    .filter((href) => href.startsWith('#'))
  expect(refs.length, 'nothing drew an icon, so the check is vacuous').toBeGreaterThan(0)
  return [...new Set(refs)].filter((href) => document.querySelector(`symbol${href}`) === null)
}

afterEach(unmountAll)

describe('every window entry carries its icons', () => {
  it('⚑ the entries are the two known ones, so a new entry is checked here too', () => {
    expect(entries()).toEqual([
      { file: 'main.ts', root: 'App' },
      { file: 'recovery.ts', root: 'RecoveryApp' },
    ])
  })

  it('🔴 the recovery window resolves every icon it draws, with a transcript open', async () => {
    expect(document.querySelector('symbol'), 'a sprite is already mounted').toBeNull()
    const bridge = fakeRecoveryBridge({
      verdict: HISTORY_ONLY,
      afterReturn: NEWER_WITH_A_COPY,
      conversations: CONVERSATIONS,
      transcripts: { 'conv-header': HEADER_EVENTS },
    })
    const view = mount(RecoveryApp, { bridge }, { width: 1200, height: 800 })
    await settle()
    view.all('recovery-conversation')[1]!.click()
    await settle()
    expect(dangling()).toEqual([])
  })

  it('🔴 the main window mounts the sprite in the screen its entry draws', () => {
    // The main entry mounts App, whose screen is RuntimeScreen; mounting it whole needs the whole
    // bridge, so the claim is read off the source instead: the screen App draws mounts the sprite.
    const app = SOURCE['../../src/renderer/src/App.vue']!
    expect(app).toMatch(/<RuntimeScreen\b/)
    const screen = SOURCE['../../src/renderer/src/components/RuntimeScreen.vue']!
    expect(screen).toMatch(/<IconSprite\s*\/>/)
  })
})
