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
  it('the recovery window resolves every icon it draws, with a transcript open', async () => {
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
})
