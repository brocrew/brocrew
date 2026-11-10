import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  allProviderCapabilities,
  capabilitiesFor,
  isAvailable,
  type CapabilityStatus,
  type ProviderCapabilities,
} from '@brobot2/runtime'
import { SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import { type ProviderCapabilityMap } from '../src/shared/runtime-ipc'
import NewConversation from '../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../src/renderer/src/lib/launch-choices'

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(NewConversation as never, {
          handing: createAttachmentBook().handing(NEW_CONVERSATION),
          ...props,
        }),
    }),
  )

const launcher = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  busy: false,
  error: null,
  debug: false,
  draft: '',
  defaultProvider: 'claude',
  choices: NO_LAUNCH_CHOICES,
  capabilities: allProviderCapabilities(),
  ...over,
})

/** Vue keeps template comments in SSR output. */
const visible = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '')

const CAPABILITIES = Object.keys(
  capabilitiesFor(SUPPORTED_PROVIDERS[0] as (typeof SUPPORTED_PROVIDERS)[number]),
) as readonly (keyof ProviderCapabilities)[]

describe('every provider declares every capability', () => {
  it('sends the presentation mark with each provider declaration', () => {
    expect(capabilitiesFor('claude').mark.kind).toBe('letter')
    expect(capabilitiesFor('codex').mark.kind).toBe('blossom')
  })
  it('declares whether a start sends one short message to renew an expired login', () => {
    expect(isAvailable(capabilitiesFor('claude').loginRenewalMessage)).toBe(true)
    expect(isAvailable(capabilitiesFor('codex').loginRenewalMessage)).toBe(false)
  })

  it('the map is complete — a provider cannot be half-declared', () => {
    expect(SUPPORTED_PROVIDERS.length).toBeGreaterThan(1)
    for (const provider of SUPPORTED_PROVIDERS) {
      const declared: ProviderCapabilities = capabilitiesFor(provider)
      for (const capability of CAPABILITIES) {
        expect(declared[capability], `${provider}.${capability}`).toBeDefined()
        expect(['available', 'unwired', 'absent']).toContain(declared[capability].state)
      }
    }
  })

  it('nothing is declared unavailable without saying why, in words a user could read', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const capability of CAPABILITIES) {
        const status: CapabilityStatus = capabilitiesFor(provider)[capability]
        if (status.state === 'available') continue
        expect(status.reason.trim().length, `${provider}.${capability}`).toBeGreaterThan(10)
        expect(status.reason, `${provider}.${capability}`).toMatch(/[a-z]{3,} [a-z]{2,}/i)
      }
    }
  })

  it('plan mode is available on both, and the two say different things about it', () => {
    const plans = SUPPORTED_PROVIDERS.map((provider) => capabilitiesFor(provider).planMode)
    for (const plan of plans) expect(isAvailable(plan)).toBe(true)
    const notes = plans.map((plan) => (plan.state === 'available' ? (plan.note ?? '') : ''))
    expect(
      notes.every((note) => note.length > 0),
      'plan mode differs by provider, so each must say what it gives you',
    ).toBe(true)
    expect(new Set(notes).size).toBe(notes.length)
  })

  it('thinking is available on both and described differently', () => {
    const claude = capabilitiesFor('claude').thinking
    const codex = capabilitiesFor('codex').thinking
    expect([claude.state, codex.state]).toEqual(['available', 'available'])
    const notes = [claude, codex].map((s) => (s.state === 'available' ? (s.note ?? '') : ''))
    expect(
      notes.every((note) => note.length > 0),
      'both must say what they give you',
    ).toBe(true)
    expect(notes[0]).not.toEqual(notes[1])
  })
})

describe('the launcher survives a map that does not name its provider', () => {
  it('a map missing the selected provider offers nothing, rather than taking the window down', async () => {
    const partial = { claude: capabilitiesFor('claude') } as unknown as ProviderCapabilityMap
    const html = await render(launcher({ defaultProvider: 'codex', capabilities: partial }))
    expect(html).toContain('data-cy="new-conversation-surface"')
    expect(html).toContain('data-cy="model-picker-face"')
    expect(html).toContain('data-cy="launcher-column"')
    expect(html).toContain('data-cy="prompt-input"')
    // The credential sentence sits behind a closed fold, so neither provider's is on the page.
    const neighbour = capabilitiesFor('claude').homeCredential
    const borrowed = neighbour.state === 'available' ? (neighbour.note ?? '') : neighbour.reason
    expect(borrowed.trim().length, 'a sentence must exist to be looked for').toBeGreaterThan(10)
    expect(visible(html)).not.toContain(borrowed)
    const whole = await render(launcher({ defaultProvider: 'codex' }))
    const own = capabilitiesFor('codex').homeCredential
    const mine = own.state === 'available' ? (own.note ?? '') : own.reason
    expect(mine.trim().length).toBeGreaterThan(10)
    expect(visible(whole)).not.toContain(mine)
  })

  it('the model picker still draws on an empty map', async () => {
    const html = await render(launcher({ capabilities: {} as unknown as ProviderCapabilityMap }))
    expect(html).toContain('data-cy="model-picker-face"')
    expect(html).toContain('data-cy="launcher-choices"')
  })
})
