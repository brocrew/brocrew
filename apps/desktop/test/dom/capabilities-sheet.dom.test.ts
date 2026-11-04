import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import {
  createModelLists,
  type ModelLists,
  type PickedModel,
} from '../../src/renderer/src/lib/model-lists'
import { compatibilityConnections } from '../provider-connection-fixture'
import {
  ASSIGNMENT_REACH_ADMITS,
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
  MESSAGING_REACH,
  MESSAGING_REACH_ADMITS,
  type AnyCapabilityField,
} from '../../src/shared/capabilities'
import type { AgentIdentities, AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **355 · the grant, on a screen.**
 *
 * ⛔ **In the DOM project, and the P3 claim is why it has to be.** The dispatch's design requirement
 * is that the sheet ENUMERATES the capability schema — *"then `can_interrupt` appears when P3 lands
 * without a second pass"* — and the only honest way to show that is to hand this component a schema
 * with a fifth field in it and watch a control appear and a value reach the wire. A string assertion
 * over SSR markup cannot tell a rendered control from one that is present and dead.
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
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
  ...over,
})

function storeOver(): { store: AgentStore; lists: ModelLists } {
  let savedChoice: PickedModel | null = null
  const bridge = {
    agentIdentities: async () => {
      if (answers.loadFails !== null) throw new Error(answers.loadFails)
      return answers.list
    },
    setCapabilities: async (input: unknown) => {
      /**
       * 🔴 **Cloned the way the REAL bridge clones, and this file's fake is why it has to be.**
       *
       * ⛔ `ipcRenderer.invoke` structured-clones its payload, and the structured clone algorithm
       * **refuses a Vue Proxy** — *"An object could not be cloned."* An in-process fake passes one
       * straight through, so every test here was green over a sheet whose `can_spawn` and
       * `max_concurrent` grants threw at the boundary in the shipped app while its two primitive
       * fields saved perfectly. `218` paid for this once already, on attachments
       * (`session-store.ts`'s `overTheWire`); this is the same rule with a test that can see it.
       *
       * ⚠️ **It throws rather than sanitising**, so a Proxy is a red here rather than something this
       * fake quietly repairs on the product's behalf.
       */
      structuredClone(input)
      answers.saved.push(input)
      if (answers.saveFails !== null) throw new Error(answers.saveFails)
      return answers.list.identities[0] ?? null
    },
    providerConnections: async () => compatibilityConnections(),
    agentModelAndEffort: async () => savedChoice,
    modelList: async ({ provider }: { provider: 'claude' | 'codex' }) => ({
      provider,
      notAsked: null,
      standIn: null,
      lastPicked: null,
      startsOn: null,
      models: [
        { id: 'fictional-model', label: 'Fictional model', addedBy: 'the-provider', efforts: [] },
      ],
    }),
    setAgentModelAndEffort: async (input: {
      profileId: string
      provider: 'claude' | 'codex'
      connectionId: string
      model: string
      effort: string | null
    }) => {
      answers.chose.push(structuredClone(input))
      if (answers.chooseFails !== null) throw new Error(answers.chooseFails)
      savedChoice = {
        provider: input.provider,
        connectionId: input.connectionId,
        model: input.model,
        effort: input.effort,
      }
      return { ok: true, choice: savedChoice }
    },
    setSpawningEnabled: async () => ({ spawningEnabled: answers.list.spawningEnabled }),
    // 433 · ⚑ **Cloned the way the real bridge clones, for `setCapabilities`' reason above.** This
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
  Reflect.set(window, 'api', { runtime: bridge })
  return { store: createAgentStore(bridge), lists: createModelLists(() => bridge) }
}

async function openSheet(
  props: Record<string, unknown> = {},
): Promise<{ m: Mounted; store: AgentStore }> {
  const { store, lists } = storeOver()
  await store.load()
  const m = mount(
    CapabilitiesSheet,
    { profileSlug: 'pm', runsOn: 'codex', store, lists, ...props },
    { width: 900, height: 900 },
  )
  await nextTick()
  return { m, store }
}

/** Whether an element is actually painted, rather than merely present in the markup. */
function shown(element: HTMLElement | null): boolean {
  return element !== null && element.getClientRects().length > 0
}

/** The one thing `setCapabilities` was last called with. */
function lastGrant(): Record<string, unknown> {
  const last = answers.saved.at(-1) as { grant: Record<string, unknown> } | undefined
  if (last === undefined) throw new Error('nothing was saved')
  return last.grant
}

describe('355 · the capabilities sheet', () => {
  beforeEach(() => {
    answers = {
      list: {
        identities: [identity()],
        foldersWithoutARow: [],
        use: [],
        spawningEnabled: true,
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
    Reflect.deleteProperty(window, 'api')
  })

  it.each(['none', 'propose', 'relay', null] as const)(
    'preserves dormant rules value %s while another visible grant is saved',
    async (held) => {
      const one = identity()
      answers.list = {
        ...answers.list,
        identities: [
          identity({
            capabilities: { ...one.capabilities, canWriteRules: held ?? 'none' },
            chosen: { ...one.chosen, canWriteRules: held === null ? 'default' : 'chosen' },
          }),
        ],
      }
      const { m } = await openSheet()
      expect(m.host.querySelector('[data-cy="capability-canWriteRules"]')).toBeNull()
      const depth = m.q('capability-maxDepth-input') as HTMLInputElement
      depth.value = '5'
      depth.dispatchEvent(new Event('input'))
      await nextTick()
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(lastGrant().maxDepth).toBe(5)
      expect(lastGrant().canWriteRules).toBe(held)
    },
  )

  it('connection-led polish: the agent sheet has no provider select or standing explanations', async () => {
    const { m } = await openSheet()
    expect(m.host.querySelector('[data-cy="capabilities-provider-select"]')).toBeNull()
    for (const cy of [
      'capabilities-owner',
      'capabilities-provider-note',
      'rules-fixed-policy',
      'spawn-rail-means',
      'external-mcp-answers-for-the-fallback',
      'external-mcp-empty',
      'own-instructions-when',
      'own-instructions-empty',
    ])
      expect(m.host.querySelector(`[data-cy="${cy}"]`), cy).toBeNull()
    expect(m.q('agent-model')).toBeDefined()
    expect(m.q('capabilities-save')).toBeDefined()
  })

  describe('§1 · one control per capability, drawn from the schema', () => {
    it('draws every active schema field and keeps the dormant rules grant out of the editor', async () => {
      const { m } = await openSheet()
      for (const field of CAPABILITY_FIELDS.filter((one) => one.key !== 'canWriteRules')) {
        expect(shown(m.q(`capability-${field.key}`)), `${field.key} is not on screen`).toBe(true)
      }
      expect(m.host.querySelector('[data-cy="capability-canWriteRules"]')).toBeNull()
      expect(m.all('rules-fixed-policy')).toHaveLength(0)
      // ⛔ **EXACTLY the schema, and a `toBeGreaterThanOrEqual` over a PREFIX selector was neither**
      // (review): every control inside a field also matches `[data-cy^="capability-"]`, so the count
      // was a lower bound over a superset and a stray field could never have failed it. The field
      // ROOTS are what the schema decides, and they are what is counted.
      const roots = [...m.q('capabilities-identity').parentElement!.children].filter((el) =>
        /^capability-[A-Za-z]+$/.test(el.getAttribute('data-cy') ?? ''),
      )
      expect(roots.map((el) => el.getAttribute('data-cy'))).toEqual(
        CAPABILITY_FIELDS.filter((field) => field.key !== 'canWriteRules').map(
          (field) => `capability-${field.key}`,
        ),
      )
    })

    /**
     * 🔴 **HO-008 §3's claim, measured.** A fifth capability of an existing editor kind draws its
     * own control and reaches the grant, with no change to this component.
     *
     * ⚠️ **The cast is the point rather than a shortcut.** `AnyCapabilityField` is keyed on
     * `ProfileCapabilities`, so a field P3 has not added yet cannot be spelled without one — which is
     * exactly the compile-time guard this dispatch relies on. What the cast lets this test do is
     * stand in the future for one assertion.
     */
    it('🔴 a capability the app does not have yet draws itself and reaches the wire', async () => {
      // ⚠️ **This field used to be `canInterrupt`, and 374 landed it.** Standing in the future stops
      // working the moment the future arrives: with the real field in `CAPABILITY_FIELDS`, the sheet
      // drew two controls with one `data-cy` and `m.q` threw on the duplicate. ⛔ **So the probe
      // moved to a capability nobody has proposed**, and the collection on the old one was the test
      // below it — ⚠️ deleted at D-014 with `canInterrupt` itself.
      const canBroadcast = {
        key: 'canBroadcast',
        column: 'can_broadcast',
        editor: 'choice',
        label: 'May broadcast',
        help: 'Which conversations this identity may say one thing to at once.',
        ruled: 'none',
        narrowest: 'none',
        // ⛔ **Its own words, not `canMessage`'s** (review). With the same words, *"reads the
        // schema's own vocabulary"* was equally satisfied by a hardcoded list copied from the field
        // beside it — a positive that does not differ from what it is measured against.
        vocabulary: ['never', 'when-idle', 'always'],
      } as unknown as AnyCapabilityField

      const { m } = await openSheet({ fields: [...CAPABILITY_FIELDS, canBroadcast] })

      // 1 · it is on screen, with its own control, and it is the schema's own words.
      expect(shown(m.q('capability-canBroadcast'))).toBe(true)
      expect(m.q('capability-canBroadcast').textContent).toContain('May broadcast')
      const select = m.q('capability-canBroadcast-select') as HTMLSelectElement
      expect([...select.options].map((option) => option.value)).toEqual([
        'never',
        'when-idle',
        'always',
      ])
      // ⚑ The pair: the field BESIDE it still draws its own words, so the assertion above is about
      // this field's vocabulary rather than about whatever the last `<select>` happened to hold.
      // ⚠️ **D-016 · two words now** — `same-project` went with projects.
      expect(
        [...(m.q('capability-canMessage-select') as HTMLSelectElement).options].map((o) => o.value),
      ).toEqual(['none', 'any'])
      // ⛔ …and it is NOT rendered by the unknown-editor branch, which would also be "on screen".
      expect(m.all('capability-canBroadcast-unknown-editor')).toHaveLength(0)

      // 2 · it reaches the grant — as `null`, because a row that has chosen nothing follows the
      //     default, which is the same rule every other field obeys.
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(lastGrant()).toHaveProperty('canBroadcast', null)

      // 3 · and as a VALUE once somebody chooses one.
      select.value = 'when-idle'
      select.dispatchEvent(new Event('change'))
      await nextTick()
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(lastGrant()).toHaveProperty('canBroadcast', 'when-idle')
    })

    /**
     * 🔴 **449 · a person picking a reach reads what it ADMITS, on the screen, at the real width.**
     *
     * ⛔ **`canInterrupt`'s help said nothing whatever about reach**, so the ruled default read as a
     * control that lets this identity cut into anything in its project — which HO-016 §1 already
     * caught this field's NAME implying once. ⚠️ `canMessage`'s said *"Anything but `any` reaches
     * only conversations it started"*, which is true of `same-project` and false of the word beside
     * it.
     *
     * ⚑ **PAINTED, not merely present.** A help sentence a person cannot see is a comment, and this
     * file's own `shown` is what tells those apart.
     *
     * ⚠️ **D-014 · `canInterrupt` is gone** — ending and interrupting read no grant, they reach the
     * chain below the caller — so the second reach control on this sheet is `canAssignWork`, the
     * other field over {@link MESSAGING_REACH}. ⚑ **493's divergence is still the point**: its `any`
     * admits only conversations its holder started, where `canMessage`'s admits any.
     */
    it('🔴 449/493 · both reach controls visibly say what their own gate admits', async () => {
      const { m } = await openSheet()
      for (const key of ['canMessage', 'canAssignWork'] as const) {
        const control = m.q(`capability-${key}`)
        expect(control.querySelector('p.note')).toBeNull()
        const select = control.querySelector<HTMLSelectElement>('select')!
        expect(shown(select), `${key} has no visible editor`).toBe(true)
        for (const word of MESSAGING_REACH) {
          expect([...select.options].find((one) => one.value === word)?.textContent).toBe(word)
        }
      }
      // 🔴 **493's divergent control.** The two fields use the same word `any`, but messaging
      // may reach what this identity did not start and giving work may not.
      expect(MESSAGING_REACH_ADMITS.any).not.toBe(ASSIGNMENT_REACH_ADMITS.any)
      expect(shown(m.q('capability-canMessage-select'))).toBe(true)
      expect(shown(m.q('capability-canAssignWork-select'))).toBe(true)
      expect(m.q('capability-canAssignWork').textContent).not.toContain(MESSAGING_REACH_ADMITS.any)
      // ⛔ **The control, and it is the field one row down.** A grant on the OTHER two-word
      // vocabulary carries none of these sentences, so the loop above is about this vocabulary
      // rather than about every note on the sheet being long. ⚠️ **D-016** took `same-project`,
      // the one word this control used to read, so it reads every word the vocabulary has left.
      for (const word of MESSAGING_REACH) {
        expect(m.q('capability-canCreateAgents').textContent ?? '').not.toContain(
          MESSAGING_REACH_ADMITS[word],
        )
      }
    })

    /**
     * ⚑ **The honest hole, shown rather than left blank** (009). A capability whose editor this app
     * has never met gets a sentence — and the pair is the test above, where a KNOWN kind does not.
     */
    it('⚑ says so when a capability’s editor is one it has no control for', async () => {
      const alien = {
        key: 'canTeleport',
        column: 'can_teleport',
        editor: 'quantum',
        label: 'May teleport',
        help: 'Nothing here can draw this.',
        ruled: null,
        narrowest: null,
      } as unknown as AnyCapabilityField
      const { m } = await openSheet({ fields: [...CAPABILITY_FIELDS, alien] })
      expect(shown(m.q('capability-canTeleport-unknown-editor'))).toBe(true)
      expect(m.q('capability-canTeleport-unknown-editor').textContent).toContain('quantum')
    })
  })

  describe('§2 · null is not zero, and Save may not turn one into the other', () => {
    /**
     * 🔴 **The §2 pair, and the reason this file is in the DOM project.** A field left alone is
     * `null` on the wire — *use the default* — and a field somebody touched is a value. Both draw
     * the same number in the box, so the box cannot be what tells them apart.
     */
    it('🔴 saves an untouched field as null and a touched one as its value', async () => {
      const { m } = await openSheet()
      expect(m.q('capability-maxDepth-state').textContent).toContain('Following the default')
      expect((m.q('capability-maxDepth-input') as HTMLInputElement).value).toBe(
        String(DEFAULT_CAPABILITIES.maxDepth),
      )

      const depth = m.q('capability-maxDepth-input') as HTMLInputElement
      depth.value = '5'
      depth.dispatchEvent(new Event('input'))
      await nextTick()
      expect(m.q('capability-maxDepth-state').textContent).toContain('Set on this identity')

      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const grant = lastGrant()
      expect(grant.maxDepth).toBe(5)
      // ⛔ Every other field is null — nothing was touched, so nothing may be written.
      for (const field of CAPABILITY_FIELDS.filter((one) => one.key !== 'maxDepth')) {
        expect(grant[field.key], `${field.key} was written`).toBe(null)
      }
      expect(grant.canMessage).toBe(null)
    })

    it('⚑ “Use the default” takes a field back to null, and only that field', async () => {
      const { m } = await openSheet()
      const depth = m.q('capability-maxDepth-input') as HTMLInputElement
      depth.value = '5'
      depth.dispatchEvent(new Event('input'))
      const select = m.q('capability-canMessage-select') as HTMLSelectElement
      select.value = 'any'
      select.dispatchEvent(new Event('change'))
      await nextTick()

      m.q('capability-maxDepth-use-default').click()
      await nextTick()
      expect(m.q('capability-maxDepth-state').textContent).toContain('Following the default')
      // ⛔ …and the box goes back to the ruled default rather than keeping the number nobody kept.
      expect((m.q('capability-maxDepth-input') as HTMLInputElement).value).toBe(
        String(DEFAULT_CAPABILITIES.maxDepth),
      )

      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(lastGrant().maxDepth).toBe(null)
      // ⚑ The pair: the OTHER field somebody chose is untouched by the reversal.
      expect(lastGrant().canMessage).toBe('any')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3.1 · what it RUNS ON, which is not a capability (433)
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3.1 · the provider control, and the sentence beside it', () => {
    async function openPicker(m: Mounted): Promise<HTMLSelectElement> {
      await expect.poll(() => m.all('model-picker-face').length).toBe(1)
      m.q('model-picker-face').click()
      await expect.poll(() => m.all('model-picker-row').length).toBe(1)
      return m.q('model-picker-connection') as HTMLSelectElement
    }
    async function pickModel(m: Mounted): Promise<void> {
      await expect.poll(() => m.all('model-picker-row').length).toBe(1)
      m.q('model-picker-row').querySelector('input')!.click()
      await nextTick()
      m.q('model-picker-take').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
    }

    it('🔴 a person picks a provider and it writes on its own, without touching Save', async () => {
      const { m } = await openSheet()
      expect(m.all('capabilities-provider-select')).toHaveLength(0)
      const select = await openPicker(m)
      select.value = 'claude:sign-in'
      select.dispatchEvent(new Event('change'))
      await nextTick()
      expect(answers.chose).toEqual([])
      await pickModel(m)
      expect(answers.chose).toEqual([
        {
          profileId: 'pm',
          provider: 'claude',
          connectionId: 'claude:sign-in',
          model: 'fictional-model',
          effort: null,
        },
      ])
      expect(answers.saved).toEqual([])
    })

    it('⛔ a value this app does not know is sent as nothing, not as itself', async () => {
      const { m } = await openSheet()
      const select = await openPicker(m)
      const planted = document.createElement('option')
      planted.value = 'fictional-unknown'
      select.append(planted)
      select.value = 'fictional-unknown'
      expect(select.value).toBe('fictional-unknown')
      select.dispatchEvent(new Event('change'))
      await nextTick()
      expect(answers.chose).toEqual([])
      expect(answers.saved).toEqual([])
    })

    it('⛔ it says a running conversation does not move, and names what the next one starts on', async () => {
      answers.list = {
        ...answers.list,
        use: [
          {
            slug: 'pm',
            conversations: 1,
            thisAppMintsIt: false,
            isLaunching: true,
            isStarting: false,
            runsOn: { provider: 'codex', from: 'saved' },
          },
        ],
      }
      const { m } = await openSheet()
      const before = structuredClone(answers.list.use)
      const select = await openPicker(m)
      select.value = 'claude:sign-in'
      select.dispatchEvent(new Event('change'))
      await nextTick()
      await pickModel(m)
      expect(answers.chose).toHaveLength(1)
      expect(answers.list.use).toEqual(before)
      expect(m.all('capabilities-provider-note')).toHaveLength(0)
    })

    it('⛔ a refused change says so beside the control, and the sheet stays open', async () => {
      answers.chooseFails = 'a person must be asking'
      const { m } = await openSheet()
      const select = await openPicker(m)
      const before = m.q('model-picker-face').textContent
      select.value = 'claude:sign-in'
      select.dispatchEvent(new Event('change'))
      await nextTick()
      await pickModel(m)
      await expect.poll(() => m.all('model-picker-refusal').length).toBe(1)
      expect(m.q('model-picker-refusal').textContent).toContain('a person must be asking')
      expect(m.q('model-picker-face').textContent).toBe(before)
      expect(m.q('model-picker-panel').matches(':popover-open')).toBe(true)
      expect(answers.saved).toEqual([])
    })

    it('⛔ a profile with no row is offered no provider control', async () => {
      const { m } = await openSheet({ profileSlug: 'nobody' })
      expect(m.all('capabilities-provider-select')).toHaveLength(0)
      expect(m.all('agent-model')).toHaveLength(0)
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

    it('⚠️ says a grant cannot take effect while spawning is switched off', async () => {
      answers.list = { ...answers.list, spawningEnabled: false }
      const { m } = await openSheet()
      expect(shown(m.q('capabilities-spawning-off'))).toBe(true)
      // ⚑ The pair — with the switch on, the warning is not drawn at all.
      answers.list = { ...answers.list, spawningEnabled: true }
      const { m: on } = await openSheet()
      expect(on.all('capabilities-spawning-off')).toHaveLength(0)
    })

    /**
     * 🔴 **Asserted on the EMIT, not on the markup** — `project-sheet.dom.test.ts`'s finding, and
     * for its reason: this component does not remove itself, `RuntimeScreen`'s `v-if` does, so an
     * assertion that the sheet is still painted is about an element that cannot go away.
     */
    it('🔴 does not ask to be closed over a refused save, because the sentence goes with it', async () => {
      answers.saveFails = 'a person must be asking'
      const closes: number[] = []
      const { store, lists } = storeOver()
      await store.load()
      const m = mount(
        CapabilitiesSheet,
        {
          profileSlug: 'pm',
          store,
          lists,
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
      const { store, lists } = storeOver()
      await store.load()
      // The row disappears between the read and the Save — a session closed it, or a repair did.
      answers.list = { ...answers.list, identities: [] }
      const m = mount(
        CapabilitiesSheet,
        { profileSlug: 'pm', store, lists, onClose: () => closes.push(1) },
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
