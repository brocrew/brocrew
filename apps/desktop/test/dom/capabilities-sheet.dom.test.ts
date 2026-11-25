import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import { SUPPORTED_PROVIDERS, providerDescriptor } from '@brobot2/shared'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { desktopProviderApi } from '../../src/renderer/src/client-provider/window'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { AgentIdentities, AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'
import { rosterSettingsBridge } from '../lib/agent-roster-fixture'

/**
 * 🔴 **One identity's sheet, on a screen** — its provider control, the rule-writing policy,
 * and a Save that writes only the external servers it may use.
 *
 * ⚠️ **In the DOM project** because a string assertion over SSR markup cannot tell a rendered
 * control from one that is present and dead.
 *
 * ⚠️ **The store is INJECTED rather than stubbed on `window`.** `useAgentStore` memoises the bridge
 * at first call and is a module singleton, so a per-test `window.api` would be captured by the first
 * test in the file and ignored by every later one — the trap `project-sheet.dom.test.ts` records.
 */

interface Answers {
  list: AgentIdentities
  loadFails: string | null
  saveFails: string | null
  saved: unknown[]
  /** 433 · what the provider control sent, and what the door answered it with. */
  chose: unknown[]
  chooseFails: string | null
}

let answers: Answers

// The approved words are a UI contract, independent of the production constant.
const RULE_WRITING_POLICY =
  'Only the person and the profile that created an agent can change its standing rules; any conversation of that profile counts, and when no creating profile is recorded, only the person can. Being the same profile as the agent gives no right to change its rules: an agent never writes its own, and keeps its own notes instead. Anyone else, the agent included, can propose a change, and the person decides a proposal. Each version keeps its author and reason, and can be undone.'

const identity = (over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: 'agp:default:pm',
  slug: 'pm',
  displayName: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
  externalMcpServerIds: [],
  ...over,
})

function storeOver(): AgentStore {
  const bridge = {
    ...rosterSettingsBridge(() => answers),
    // Clone the payload here for the same reason as the external MCP settings mock. This
    // payload is two primitives, so nothing here can be a Proxy — which is exactly the claim
    // `the-bridge-that-clones-nothing.test.ts` files it under, and a fake that skipped the clone
    // would be the place that claim stopped being measured.
    setAgentProvider: async (input: unknown) => {
      structuredClone(input)
      answers.chose.push(input)
      if (answers.chooseFails !== null) throw new Error(answers.chooseFails)
      // ⚑ **696 · the door's answer since `682`** — the identity AND what it cleared (`AgentProviderSet`).
      const one = answers.list.identities[0]
      return one === undefined ? null : { ...one, modelChoiceCleared: null }
    },
  } as unknown as RuntimeBridge
  return createAgentStore(bridge)
}

async function openSheet(
  props: Record<string, unknown> = {},
): Promise<{ m: Mounted; store: AgentStore }> {
  const store = storeOver()
  await store.load()
  const catalogueClient = Object.create(desktopProviderApi, {
    providerCatalogue: { value: async () => SUPPORTED_PROVIDERS.map(providerDescriptor) },
  })
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, catalogueClient)
        return () => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex', store, ...props })
      },
    }),
    {},
    { width: 900, height: 900 },
  )
  await nextTick()
  return { m, store }
}

/** Whether an element is actually painted, rather than merely present in the markup. */
function shown(element: HTMLElement | null): boolean {
  return element !== null && element.getClientRects().length > 0
}

describe('355 · the capabilities sheet', () => {
  beforeEach(() => {
    answers = {
      list: {
        identities: [identity()],
        foldersWithoutARow: [],
        use: [],
        // 500 · required on `AgentIdentities`; this sheet is per-identity and reads neither.
        defaultApprovalMode: 'ask',
        // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
        externalMcpServers: [],
      },
      loadFails: null,
      saveFails: null,
      saved: [],
      chose: [],
      chooseFails: null,
    }
  })
  afterEach(() => {
    unmountAll()
  })

  describe('§1 · the policy, and no grant to set', () => {
    it('draws the rule-writing policy and the external servers as the only field', async () => {
      const { m } = await openSheet()
      expect(m.q('rules-fixed-policy').textContent).toBe(RULE_WRITING_POLICY)
      // The field ROOTS beside the identity block: external servers are the one thing set here.
      const roots = [...m.q('capabilities-identity').parentElement!.children].filter((el) =>
        /^capability-[A-Za-z-]+$/.test(el.getAttribute('data-cy') ?? ''),
      )
      expect(roots.map((el) => el.getAttribute('data-cy'))).toEqual(['capability-external-mcp'])
      expect(shown(m.q('capability-external-mcp'))).toBe(true)
    })

    it('🔴 Save sends the complete server set for this identity and nothing else', async () => {
      answers.list = {
        ...answers.list,
        identities: [identity({ externalMcpServerIds: ['ems:jira'] })],
      }
      const { m } = await openSheet()
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(answers.saved).toEqual([{ profileId: 'pm', externalMcpServerIds: ['ems:jira'] }])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3.1 · what it RUNS ON, which is not a capability (433)
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3.1 · the provider control, and the sentence beside it', () => {
    /**
     * 🔴 **433 §A · the control a person presses, and it is NOT part of Save.**
     *
     * ⛔ **Provider is not written by Save**, and the reason is what a combined Save would have to report:
     * two commands behind one button can half-succeed, and this sheet would then have to draw a
     * state that is neither saved nor unsaved. ⚑ **So the press writes on its own**, which is what
     * the two lists below measure separately.
     *
     * ⚠️ **In the DOM project rather than as a source census**, on this file's own rule: a string
     * assertion over markup cannot tell a rendered control from one that is present and dead —
     * and `chose()` on the wrapper's `@change` is exactly the mistake `355` made once already.
     */
    it('🔴 a person picks a provider and it writes on its own, without touching Save', async () => {
      const { m } = await openSheet()
      const select = m.q('capabilities-provider-select') as HTMLSelectElement
      expect(shown(select)).toBe(true)
      // ⚑ **Nobody has said**, which is the row's state and the option the select starts on.
      expect(select.value).toBe('')

      select.value = 'claude'
      select.dispatchEvent(new Event('change'))
      // ⛔ **The screen follows the gesture straight away** — measured BEFORE the write resolves,
      // because binding to the row made the disabled control snap back to the old provider for the
      // whole round trip, which reads as a refusal at the moment a person is waiting for one.
      await nextTick()
      expect((m.q('capabilities-provider-select') as HTMLSelectElement).value).toBe('claude')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(answers.chose).toEqual([{ profileId: 'pm', provider: 'claude' }])
      // ⛔ **Save was never pressed and nothing was saved**, which is what makes this its own gesture.
      expect(answers.saved).toEqual([])

      // ⚑ **And the reversible half**: the empty option is a real value on the wire, not an absence.
      select.value = ''
      select.dispatchEvent(new Event('change'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(answers.chose[1]).toEqual({ profileId: 'pm', provider: null })
    })

    /**
     * ⛔ **A word this app does not know NARROWS to *nobody has said*** — `parseProvider`'s
     * direction, one layer up, and the reason the handler folds against the table rather than
     * casting the `<select>`'s value.
     *
     * ⚠️ **The hazard this measures is a hand-injected option**, which is the only way the value can
     * be something the app did not render — and it is the shape a cast would have passed straight
     * through to the wire.
     */
    it('⛔ a value this app does not know is sent as nothing, not as itself', async () => {
      const { m } = await openSheet()
      const select = m.q('capabilities-provider-select') as HTMLSelectElement
      const planted = document.createElement('option')
      planted.value = 'gemini'
      select.append(planted)
      select.value = 'gemini'
      expect(select.value, 'the plant did not take, so this measures nothing').toBe('gemini')
      select.dispatchEvent(new Event('change'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(answers.chose).toEqual([{ profileId: 'pm', provider: null }])
    })

    /**
     * ⛔ **HO-025, through `433` relay 1:** *"changing it means a new conversation, and the app
     * should SAY that rather than offer a control that silently relaunches."*
     *
     * ⚑ **Rendered from the RESOLVED provider** — `props.runsOn`, which the screen computes with the
     * same `providerForALaunch` the front door uses. ⚠️ The pair is the two values of that prop, so
     * the sentence is measured as something that FOLLOWS a value rather than as a fixed string.
     */
    it('⛔ it says a running conversation does not move, and names what the next one starts on', async () => {
      const { m } = await openSheet()
      await vi.waitFor(() =>
        expect(m.q('capabilities-provider-note').textContent).toContain('Codex'),
      )
      const said = m.q('capabilities-provider-note').textContent ?? ''
      expect(said).toContain('Codex')
      expect(said).toContain('Changing it starts nothing; existing work stays put')

      const { m: other } = await openSheet({ runsOn: 'claude' })
      await vi.waitFor(() =>
        expect(other.q('capabilities-provider-note').textContent).toContain('Claude'),
      )
      const elsewhere = other.q('capabilities-provider-note').textContent ?? ''
      expect(elsewhere).toContain('Claude')
      expect(elsewhere).not.toBe(said)
    })

    /**
     * ⛔ **A refusal is shown where the gesture is**, and Save's own sentence is somewhere else —
     * two gestures, two places to be told, which is the price of not folding them together and is
     * paid here rather than hidden.
     */
    it('⛔ a refused change says so beside the control, and the sheet stays open', async () => {
      answers.chooseFails = 'a person must be asking'
      const { m } = await openSheet()
      const select = m.q('capabilities-provider-select') as HTMLSelectElement
      select.value = 'claude'
      select.dispatchEvent(new Event('change'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
      expect(m.q('capabilities-provider-error').textContent).toContain('a person must be asking')
      // ⛔ **And the control went BACK to what the database says** — a select left showing a choice
      // that did not take is a surface claiming a write nobody made.
      expect((m.q('capabilities-provider-select') as HTMLSelectElement).value).toBe('')
      // ⚑ **The pair**: a change that succeeds draws no sentence at all.
      answers.chooseFails = null
      select.value = ''
      select.dispatchEvent(new Event('change'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
      expect(m.all('capabilities-provider-error')).toHaveLength(0)
    })

    /** ⛔ Criterion 12: an identity with no row has no control to press. */
    it('⛔ a profile with no row is offered no provider control', async () => {
      const { m } = await openSheet({ profileSlug: 'nobody' })
      expect(m.all('capabilities-provider-select')).toHaveLength(0)
      expect(answers.chose).toEqual([])
    })
  })

  describe('§4 · the states that are not an error', () => {
    /** ⛔ §4's trap: a profile with no row is a real state, and viewing it creates nothing. */
    it('⛔ says there is no identity rather than drawing an empty form', async () => {
      const { m } = await openSheet({ profileSlug: 'nobody' })
      expect(shown(m.q('capabilities-no-row'))).toBe(true)
      expect(m.q('capabilities-no-row').textContent).toContain('nobody')
      // ⛔ There is nothing to press, so nothing can be saved into existence.
      expect(m.all('capabilities-save')).toHaveLength(0)
      expect(answers.saved).toEqual([])
      // ⚑ The pair: the identity that DOES exist draws its controls, so the above is about the row
      // and not about the sheet being broken.
      const { m: real } = await openSheet()
      expect(shown(real.q('capabilities-save'))).toBe(true)
    })

    /**
     * 🔴 **Asserted on the EMIT, not on the markup** — `project-sheet.dom.test.ts`'s finding, and
     * for its reason: this component does not remove itself, `RuntimeScreen`'s `v-if` does, so an
     * assertion that the sheet is still painted is about an element that cannot go away.
     */
    it('🔴 does not ask to be closed over a refused save, because the sentence goes with it', async () => {
      answers.saveFails = 'a person must be asking'
      const closes: number[] = []
      const store = storeOver()
      await store.load()
      const m = mount(
        CapabilitiesSheet,
        {
          profileSlug: 'pm',
          store,
          onClose: () => closes.push(1),
        },
        { width: 900, height: 900 },
      )
      await nextTick()
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
      expect(shown(m.q('capabilities-save-refusal'))).toBe(true)
      expect(m.q('capabilities-save-refusal').textContent).toContain('a person must be asking')
      expect(closes).toEqual([])

      // ⚑ The positive half: a save that succeeds DOES ask to close.
      answers.saveFails = null
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
      expect(closes).toEqual([1])
    })

    /**
     * ⛔ **Criterion 12 as a person meets it after pressing Save** (review — this path was drawn by
     * nothing). The store answers `null` for an identity whose row has gone; `agent-store` turns
     * that into a sentence, and the sheet must show it and stay open rather than close over it.
     */
    it('⛔ says the identity has gone when the door answers null, and stays open', async () => {
      const closes: number[] = []
      const store = storeOver()
      await store.load()
      // The row disappears between the read and the Save — a session closed it, or a repair did.
      answers.list = { ...answers.list, identities: [] }
      const m = mount(
        CapabilitiesSheet,
        { profileSlug: 'pm', store, onClose: () => closes.push(1) },
        { width: 900, height: 900 },
      )
      await nextTick()
      // ⚠️ The sheet still holds the row it loaded, so Save is reachable — which is the case.
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
      expect(shown(m.q('capabilities-save-refusal'))).toBe(true)
      expect(m.q('capabilities-save-refusal').textContent).toContain('There is no agent identity')
      expect(closes).toEqual([])
    })

    it('⚠️ shows why the list could not be read, rather than an empty one', async () => {
      answers.loadFails = 'agentIdentities changes what agents are allowed to do'
      const { m } = await openSheet()
      expect(shown(m.q('capabilities-load-error'))).toBe(true)
      expect(m.q('capabilities-load-error').textContent).toContain('agentIdentities')
    })
  })
})
