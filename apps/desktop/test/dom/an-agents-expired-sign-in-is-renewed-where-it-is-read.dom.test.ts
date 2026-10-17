import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import {
  forgetProfileSignIns,
  useProfileSignIn,
} from '../../src/renderer/src/composables/useProfileSignIn'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { drawerProps, META, mount, paneProps, record, unmountAll } from './harness'

/**
 * An agent's own profile sign-in, renewed where the person reads that it expired: in its
 * conversation, under the refusal, and on its card. The gestures name that agent's profile, never
 * the default one.
 */

const PROFILE = 'bakery-builder'
const EXPIRED = {
  state: 'stale',
  reason: "This profile's Codex sign-in has expired and can no longer start a turn.",
} as const

const SESSION: CreatedSession = {
  ...META,
  provider: 'codex',
  profileId: PROFILE,
  ref: { ...META.ref!, provider: 'codex' },
}

function theBridge() {
  const runtime = {
    checkProviderAuth: vi.fn(async () => EXPIRED),
    signInProvider: vi.fn(async () => ({ success: true, state: EXPIRED, detail: null })),
    reprovisionProviderAuth: vi.fn(async () => 'replaced'),
    cancelProviderSignIn: vi.fn(async () => undefined),
    listResumable: async () => [],
    listUnresumable: async () => [],
  }
  ;(window as unknown as { api: unknown }).api = { runtime }
  return runtime
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}

afterEach(() => {
  unmountAll()
  forgetProfileSignIns()
})

describe('an agent’s expired sign-in, renewed where it is read', () => {
  it('🔴 its conversation shows the sign-in panel under the refusal, for its own profile', async () => {
    const runtime = theBridge()
    const r = record([])
    r.meta = SESSION
    r.error = EXPIRED.reason
    const m = mount(
      ConversationPane as Component,
      paneProps({ record: r, capabilities: CAPABILITY_FIXTURE }),
      { width: 1200, height: 900 },
    )
    await settled()

    expect(runtime.checkProviderAuth).toHaveBeenCalledWith({
      provider: 'codex',
      profileId: PROFILE,
    })
    const strip = m.q('pane-sign-in')
    expect(strip.querySelector('[data-cy="sign-in-panel"]')).not.toBeNull()

    strip.querySelector<HTMLElement>('[data-cy="sign-in-start"]')!.click()
    await settled()
    expect(runtime.signInProvider).toHaveBeenCalledWith({ provider: 'codex', profileId: PROFILE })

    strip.querySelector<HTMLElement>('[data-cy="sign-in-reprovision"]')!.click()
    await settled()
    expect(runtime.reprovisionProviderAuth).toHaveBeenCalledWith({
      provider: 'codex',
      profileId: PROFILE,
    })
  })

  it('⚑ the control: with no refusal on screen it asks nothing and draws nothing', async () => {
    const runtime = theBridge()
    const r = record([])
    r.meta = SESSION
    const m = mount(
      ConversationPane as Component,
      paneProps({ record: r, capabilities: CAPABILITY_FIXTURE }),
      { width: 1200, height: 900 },
    )
    await settled()
    expect(runtime.checkProviderAuth).not.toHaveBeenCalled()
    expect(m.host.querySelector('[data-cy="pane-sign-in"]')).toBeNull()
  })

  it('🔴 its agent card shows the same panel, and its gesture names the agent’s profile', async () => {
    const runtime = theBridge()
    // The conversation has already learned the sign-in expired; the card reads the same answer.
    await useProfileSignIn('codex', PROFILE).check()
    const m = mount(
      SessionDrawer as never,
      drawerProps({ session: SESSION, capabilities: CAPABILITY_FIXTURE, tab: 'open' }),
      { width: 560, height: 900 },
    )
    await settled()

    const card = m.q('card-sign-in')
    expect(card.querySelector('[data-cy="sign-in-panel"]')).not.toBeNull()
    card.querySelector<HTMLElement>('[data-cy="sign-in-start"]')!.click()
    await settled()
    expect(runtime.signInProvider).toHaveBeenCalledWith({ provider: 'codex', profileId: PROFILE })
  })
})
