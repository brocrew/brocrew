import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import NewAgent from '../../src/renderer/src/components/NewAgent.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { useAgentStore } from '../../src/renderer/src/composables/useAgentStore'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  AgentIdentity,
  AuthState,
  Provider,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { DEFAULT_PROFILE_ID, DEFAULT_PROFILE_LABEL } from '../../src/shared/runtime-ipc'

/**
 * # 🔴 423 · the gesture that brings an agent into existence
 *
 * **In the DOM project, and three separate claims are why it has to be.**
 *
 *  1. **A layout claim.** A sheet that fits its window and scrolls its body rather than pushing
 *     its actions off is a statement about painted boxes, and SSR has no layout. ⚠️ **D-016** took
 *     §0 — the count and the `+` in `ProjectsBoard`'s page head — with the board it measured.
 *  2. **A claim about a press.** A refusal that appears and then goes away one letter later is two
 *     renders and a click; SSR renders the first frame and stops.
 *  3. **A claim about what crossed the wire.** `test/dom/setup/the-window-is-a-wire.ts` wraps every
 *     `window.api` stub in `everythingOverTheWire`, so a payload that would not survive
 *     `ipcRenderer.invoke` throws here rather than in the shipped app.
 *
 * ⛔ **Every negative below is paired with a positive from the same mount** — the standing
 * `brobot2-ssr-tests-pass-vacuously` rule, which bites just as hard on a DOM query that found
 * nothing because the component failed to render.
 */

interface Answers {
  list: AgentIdentities
  created: unknown[]
  refuseWith: string | null
}

const identity = (over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: `aid:${over.slug ?? 'pm'}`,
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

const roster = (identities: AgentIdentity[], orphans: readonly string[] = []): AgentIdentities => ({
  identities,
  foldersWithoutARow: orphans,
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
})

let answers: Answers

/**
 * ⛔ **Installed ONCE, at module scope, over mutable state** — the rule
 * `a-second-project.dom.test.ts` set before D-016 took it, and for its reason: `useAgentStore`
 * memoises the bridge at its first call and is a module singleton, so a stub swapped per test
 * reaches a store that already closed over the old one.
 *
 * 🔴 **And the singleton is the SUBJECT of §4.** The rail, the creation sheet and the capability
 * sheet all resolve the same `useAgentStore()`, which is what makes one `load()` after a create
 * update all three. A surface that built its own store over `window.api.runtime` would update
 * none of them, and that is the failure this file measures rather than assumes.
 */
;(window as unknown as { api?: unknown }).api = {
  runtime: {
    agentIdentities: () => Promise.resolve(answers.list),
    createAgent: (input: unknown) => {
      answers.created.push(input)
      if (answers.refuseWith !== null) return Promise.reject(new Error(answers.refuseWith))
      const made = identity({ slug: (input as { slug: string }).slug })
      answers.list = roster([...answers.list.identities, made], answers.list.foldersWithoutARow)
      return Promise.resolve(made)
    },
    setCapabilities: () => Promise.resolve(answers.list.identities[0] ?? null),
    setSpawningEnabled: () => Promise.resolve({ spawningEnabled: answers.list.spawningEnabled }),
    listResumable: () => Promise.resolve([]),
    listUnresumable: () => Promise.resolve([]),
  },
}

/**
 * ⚠️ **A macrotask, not a count of `nextTick`s.** A press runs `await store.create(…)` → `await
 * bridge.createAgent(…)` → `await load()` → `await bridge.agentIdentities()`, which is several
 * microtask hops; a fixed number is a count that goes wrong the day one more `await` lands.
 */
const settled = async (): Promise<void> => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}

const type = async (m: Mounted, cy: string, value: string): Promise<void> => {
  const field = m.q(cy) as HTMLInputElement
  field.value = value
  field.dispatchEvent(new Event('input'))
  await nextTick()
}

beforeEach(async () => {
  answers = { list: roster([identity()]), created: [], refuseWith: null }
  // ⛔ The singleton survives between tests, so each one re-reads rather than inheriting.
  await useAgentStore().load()
})
afterEach(unmountAll)

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the gesture
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **570 · the gesture moved, and it is the same gesture.**
 *
 * ⛔ **`423` put *bring an agent into existence* in the rail's AGENTS section**, beside the list it
 * adds to — *"the place a person looks for the agents is the place the gesture belongs"*. ⚑
 * `EXT-008` §4.4 moved that list to a page, so the place a person looks for the agents is
 * `TeamWorkspace`, and the gesture is there. ⚠️ **`RuntimeScreen` raises the same overlay from the
 * same emit**; what changed is which component raises it.
 */
const teamPage = async (
  agents: AgentIdentities | null,
  raised: string[] = [],
): Promise<Mounted> => {
  const m = mount(
    TeamWorkspace,
    {
      agents,
      onCreate: () => raised.push('newAgent'),
      onOpen: (slug: string) => raised.push(`caps:${slug}`),
      store: {
        renameTo: () => {
          throw new Error('§1 presses no write door')
        },
        remove: () => {
          throw new Error('§1 presses no write door')
        },
      },
    },
    { width: 1100, height: 900 },
  )
  await settled()
  return m
}

describe('§1 · pressing it raises the screen’s gesture and nothing else', () => {
  it('⛔ a press emits newAgent, and it is not the row press beside it', async () => {
    const raised: string[] = []
    const m = await teamPage(roster([identity()]), raised)
    m.q('team-create').click()
    await nextTick()
    expect(raised).toEqual(['newAgent'])
    // ⚑ The control: the identity row beside it still raises its own gesture, so the new button
    // has not swallowed the roster's press.
    m.q('team-open-pm').click()
    await nextTick()
    expect(raised).toEqual(['newAgent', 'caps:pm'])
  })

  it('⛔ it is absent until the roster read lands — 086, and the whole page waits together', async () => {
    const m = await teamPage(null)
    expect(m.all('team-members')).toHaveLength(0)
    expect(m.all('team-count')).toHaveLength(0)
    // ⚠️ **570 · the gesture itself is the one thing that does NOT wait.** ⛔ In the rail it was
    // inside `v-if="props.agents"` with the section — *"a create button floating above a section
    // that has not arrived would be the only part of the rail claiming to know"* — and on a page
    // the header is not a claim about the roster: the page is already open and a person who came
    // here to make an agent should not have to wait for a read to do it.
    expect(visible(m.q('team-create'))).toBe(true)
    // ⚑ The pairing: with an ANSWER that is empty, the roster and its count are both drawn.
    // ⛔ **`['default']` is the roster the HOST can actually produce for an empty app**, not a
    // convenience: `listProfileIds` returns `DEFAULT_PROFILE_ID` unconditionally and
    // `agentIdentities` puts every profile with no row into `foldersWithoutARow`, so zero
    // identities always means at least one orphan.
    const asked = await teamPage(roster([], ['default']))
    expect(asked.all('team-members')).toHaveLength(1)
    expect(visible(asked.q('team-create'))).toBe(true)
    expect(asked.q('team-count').textContent).toBe('0')
  })

  it('⚑ the note a person actually reads points at the gesture', async () => {
    // 🔴 **The ORPHAN note is the one an empty app shows**, for the reason above — so it is the
    // one this dispatch's rewrite has to be asserted on. ⛔ **A sentence a person reads, by name**
    // (HO-013 §5): it said *"One exists once a conversation has run as it"*, which the `+` two
    // lines above it made false.
    const m = await teamPage(roster([], ['default']))
    expect(m.q('team-other-home-folders-says').textContent?.replace(/\s+/g, ' ')).toMatch(
      /create one with the same name/i,
    )
  })

  it('⚠️ …and the empty note is corrected too, and a person CAN reach it now', async () => {
    // ⛔ **`423` reported this branch as unreachable rather than repairing it** (finding 6):
    // `identities.length === 0` implies `foldersWithoutARow` holds `default`, so in the rail the
    // empty note sat behind a `v-else-if` the orphan note always won. ⚑ **570 · on the page the
    // two are not alternatives** — the count line and the roster's own empty sentence are drawn
    // beside the folders section rather than instead of it — so the sentence `423` corrected for
    // a day that might never come is on screen the first time a person opens this page.
    const m = await teamPage(roster([], ['default']))
    expect(m.q('team-none').textContent?.replace(/\s+/g, ' ')).toMatch(/create one/i)
    expect(m.all('team-other-home-folders')).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the refusal, and the same gesture one letter over
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function openSheet(): Promise<{ m: Mounted; closed: number }> {
  const shut = ref(0)
  const m = mount(
    defineComponent({
      setup: () => () => h(NewAgent as never, { onClose: () => (shut.value += 1) }),
    }),
    {},
    { width: 620, height: 900 },
  )
  await nextTick()
  return {
    m,
    get closed() {
      return shut.value
    },
  }
}

describe('§2 · standing rule 3 — the refusal, and the same gesture one letter over', () => {
  const TAKEN =
    "There is already an agent called worker. An agent's name is its identity, so it cannot be " +
    'reused — and names are compared without case, because a profile is its folder.'

  it('🔴 a taken name shows the HOST’s sentence and the sheet stays open', async () => {
    answers.refuseWith = `Error invoking remote method 'runtime:command': Error: ${TAKEN}`
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'worker')
    sheet.m.q('new-agent-create').click()
    await settled()
    // ⛔ **The bytes, not a substring** — the claim is that the app's own sentence reaches a person
    // whole, with Electron's `Error invoking remote method …` wrapper stripped.
    expect(sheet.m.q('new-agent-refusal').textContent?.trim()).toBe(TAKEN)
    expect(sheet.closed).toBe(0)
  })

  it('⛔ …and one letter over, the same gesture succeeds and the sheet closes', async () => {
    // 🔴 **The pair is the measurement.** A refusal on its own is equally explained by a create
    // that never works; this is `419`'s own fixture shape, one character apart.
    answers.refuseWith = null
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'workers')
    sheet.m.q('new-agent-create').click()
    await settled()
    expect(sheet.m.all('new-agent-refusal')).toHaveLength(0)
    expect(sheet.closed).toBe(1)
    expect(answers.created).toEqual([{ slug: 'workers', displayName: null, provider: null }])
  })

  it('⚑ a refusal is cleared by the next keystroke, so it never describes the box as it is now', async () => {
    answers.refuseWith = `Error invoking remote method 'runtime:command': Error: ${TAKEN}`
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'worker')
    sheet.m.q('new-agent-create').click()
    await settled()
    expect(sheet.m.all('new-agent-refusal')).toHaveLength(1)
    await type(sheet.m, 'new-agent-slug', 'workers')
    expect(sheet.m.all('new-agent-refusal')).toHaveLength(0)
  })

  it('⛔ the two optional facts cross the wire as the person set them, and no role is asked', async () => {
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'archivist')
    await type(sheet.m, 'new-agent-name', 'The Archivist')
    const provider = sheet.m.q('new-agent-provider') as HTMLSelectElement
    // ⛔ **D-014 · no roles** — the sheet that offers a provider offers no role beside it.
    expect(sheet.m.all('new-agent-role')).toHaveLength(0)
    provider.value = 'claude'
    provider.dispatchEvent(new Event('change'))
    await nextTick()
    sheet.m.q('new-agent-create').click()
    await settled()
    expect(answers.created).toEqual([
      { slug: 'archivist', displayName: 'The Archivist', provider: 'claude' },
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · what the name box says before the press
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the fold, the alphabet, and the two names that mean something else', () => {
  it('⛔ the fold is shown while it is being typed, and the folded name is what is sent', async () => {
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'Worker')
    expect(sheet.m.q('agent-slug-folded').textContent).toContain('worker')
    sheet.m.q('new-agent-create').click()
    await settled()
    expect(answers.created).toEqual([{ slug: 'worker', displayName: null, provider: null }])
  })

  it('⚑ …and a name that needs no folding shows no such line', async () => {
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'worker')
    // ⛔ **556: the box is read before the absence is believed.** This block's only assertion was
    // the `toHaveLength(0)` below, which a sheet that never opened, a `type` that typed nothing
    // and a box that swallowed the name all satisfy. ⚑ The name a person can SEE in the field is
    // the positive, and it is the same string the fold is being claimed about.
    expect((sheet.m.q('new-agent-slug') as HTMLInputElement).value).toBe('worker')
    expect(sheet.m.all('agent-slug-folded')).toHaveLength(0)
  })

  it('⛔ a name outside the alphabet is refused here, and Create goes dark', async () => {
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', '../escape')
    expect(sheet.m.q('new-agent-slug-refusal').textContent).toMatch(/must be/i)
    expect((sheet.m.q('new-agent-create') as HTMLButtonElement).disabled).toBe(true)
    // ⚑ The pairing: a legal name lights it again.
    await type(sheet.m, 'new-agent-slug', 'escape')
    expect(sheet.m.all('new-agent-slug-refusal')).toHaveLength(0)
    expect((sheet.m.q('new-agent-create') as HTMLButtonElement).disabled).toBe(false)
  })

  it('⛔ an empty box cannot be pressed, and nothing is sent', async () => {
    const sheet = await openSheet()
    expect((sheet.m.q('new-agent-create') as HTMLButtonElement).disabled).toBe(true)
    sheet.m.q('new-agent-create').click()
    await settled()
    expect(answers.created).toEqual([])
  })

  it('⚑ a name that already has a FOLDER says so — reported, never repaired', async () => {
    // 🔴 **Two orphans, one of them mixed-case, and the second is the measurement.** The host
    // FILTERS `foldersWithoutARow` on `foldProfileName(folder)` and emits the raw directory name —
    // *"a directory keeps the spelling its first session ran under, so `Developer/` and the row
    // `developer` are one identity"* — so a comparison that folded only one side would miss every
    // orphan the fold exists for, and would do it silently.
    answers.list = roster([identity()], ['half-typed', 'Developer'])
    await useAgentStore().load()
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'half-typed')
    expect(sheet.m.q('new-agent-slug-adopts').textContent).toMatch(/already a folder/i)
    // 🔴 The one a single-sided comparison cannot see: typed folded, stored capitalised.
    await type(sheet.m, 'new-agent-slug', 'developer')
    expect(sheet.m.q('new-agent-slug-adopts').textContent).toMatch(/already a folder/i)
    // ⛔ **A note and not a refusal** — `createAgentIdentityTx` asks the identity table and nothing
    // else, so an orphan folder does not make a name taken.
    expect((sheet.m.q('new-agent-create') as HTMLButtonElement).disabled).toBe(false)
    // ⚑ The control: any other name gets the ordinary note.
    await type(sheet.m, 'new-agent-slug', 'other')
    expect(sheet.m.all('new-agent-slug-adopts')).toHaveLength(0)
    expect(sheet.m.all('new-agent-slug-note')).toHaveLength(1)
  })

  it('🔴 typing BroBot’s own slug says what that name IS, and what the press decides for ever', async () => {
    // ⛔ **Measured at 423**: `agent_identity` is empty on a fresh database, so BroBot's slug is
    // a name this form can create — and creating it mints BroBot. A person is told rather than
    // refused. ⚑ **592 · typed from the constant** (`HO-078` §2): the literal `'default'` stopped
    // being that name, and this note is rendered only for the name the front door launches as.
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', DEFAULT_PROFILE_ID)
    const said = sheet.m.q('new-agent-slug-is-brobot').textContent ?? ''
    expect(said).toContain(DEFAULT_PROFILE_LABEL)
    // 🔴 **The fact the press decides, by name**: the provider every new conversation on the app
    // starts on. ⛔ **D-014 · and no role** — a name brings none, so the note may not promise one.
    expect(said).toMatch(/provider chosen here/i)
    expect(said).not.toMatch(/\brole\b/i)
    // ⚑ …and the provider note is the one about a LAUNCH, not the one about a spawn.
    expect(sheet.m.q('new-agent-provider-note').textContent).toMatch(
      /new conversations on this app/i,
    )
    // ⚑ The control: it is about THIS name, not about every name.
    await type(sheet.m, 'new-agent-slug', 'defaults')
    expect(sheet.m.all('new-agent-slug-is-brobot')).toHaveLength(0)
    expect(sheet.m.q('new-agent-provider-note').textContent).toMatch(
      /no agent that gives it work can change it/i,
    )
  })

  it('⛔ …and on an app where BroBot already exists, the promise is not made at all', async () => {
    // 🔴 **The disclosure is conditioned on the creation being possible.** On every app a
    // conversation has run on, `default` has a row and the press is refused by the host — so a
    // sentence about what this name decides would be describing a gesture a person cannot make.
    answers.list = roster([identity({ slug: 'default', id: 'aid:default' })])
    await useAgentStore().load()
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'default')
    expect(sheet.m.all('new-agent-slug-is-brobot')).toHaveLength(0)
    expect(sheet.m.all('new-agent-slug-note')).toHaveLength(1)
  })

  it('⛔ the sheet fits, and its body scrolls rather than pushing the actions off', async () => {
    const m = mount(NewAgent, {}, { width: 460, height: 560 })
    await nextTick()
    const sheet = m.host.querySelector('.new-agent') as HTMLElement
    expect(sheet.getBoundingClientRect().height).toBeLessThanOrEqual(560)
    const actions = m.q('new-agent-create').getBoundingClientRect()
    expect(actions.bottom).toBeLessThanOrEqual(sheet.getBoundingClientRect().bottom + 1)
    expect(actions.width).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the seam
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · a created identity is one the capability sheet opens on', () => {
  /**
   * 🔴 **The seam between the two surfaces**: a created identity is one the capability sheet finds
   * the moment the creation lands.
   *
   * ⛔ **Through the real singleton, not a shared fixture.** `CapabilitiesSheet` resolves
   * `props.store ?? useAgentStore()` and `NewAgent` resolves `useAgentStore()`; the property only
   * holds because those are the same object, and a creation form that built its own store over
   * `window.api.runtime` would leave this sheet, the rail and the front door all reading a roster
   * that has not got the row.
   */
  it('🔴 create, then open the sheet on the new slug — its row is there', async () => {
    // ⚑ **The control first, on the same singleton**: before the creation, the sheet for this slug
    // says there is no row, so the answer below is the creation's doing.
    const before = mount(
      CapabilitiesSheet,
      { profileSlug: 'archivist' },
      { width: 900, height: 900 },
    )
    await settled()
    expect(before.all('capabilities-no-row')).toHaveLength(1)
    before.unmount()

    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'archivist')
    sheet.m.q('new-agent-create').click()
    await settled()
    expect(sheet.closed).toBe(1)
    sheet.m.unmount()

    const caps = mount(CapabilitiesSheet, { profileSlug: 'archivist' }, { width: 900, height: 900 })
    await settled()
    expect(caps.all('capabilities-no-row')).toHaveLength(0)
    expect(caps.q('capabilities-slug').textContent).toBe('archivist')
  })

  it('⚑ …and the rail counts it, from the same one read', async () => {
    const sheet = await openSheet()
    await type(sheet.m, 'new-agent-slug', 'archivist')
    sheet.m.q('new-agent-create').click()
    await settled()
    sheet.m.unmount()

    // ⚠️ **570 · the count is the page's now** — `EXT-008` §1 sent counts to the page — and the
    // seam this test is really about is unchanged: one `useAgentStore()` singleton, written by
    // the sheet and read by the surface, with no second read in between.
    const m = mount(
      TeamWorkspace,
      {
        agents: useAgentStore().identities.value,
        store: {
          renameTo: () => {
            throw new Error('this assertion presses no write door')
          },
          remove: () => {
            throw new Error('this assertion presses no write door')
          },
        },
      },
      { width: 1100, height: 900 },
    )
    await settled()
    expect(m.q('team-count').textContent).toBe('2')
    expect(m.all('team-card-archivist')).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the premise 417 was entitled to, and 423 is not
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the front door’s provider can MOVE under a pending gesture', () => {
  /**
   * 🔴 **`417` deleted `withAuthGesture`'s stamp on a stated premise** — *"`props.defaultProvider`
   * and `DEFAULT_PROFILE_ID` are both fixed for the life of this surface, so every answer
   * describes the only question it could have been asked."*
   *
   * ⛔ **`423` falsified it.** The prop's source is `RuntimeScreen.frontDoorProvider`, and
   * `NewAgent` is an OVERLAY — a sibling of `<main>` — so a person creating `default` with a
   * provider does it while the launcher stays mounted behind the sheet. ⚑ **In the DOM project
   * because it is a TRANSITION**: a prop that changes after a call was made, which SSR renders
   * once and cannot reach.
   */
  const frame = (): {
    m: Mounted
    provider: Ref<Provider>
    settle: (state: AuthState) => void
    cancelled: unknown[]
    fail: () => Promise<void>
  } => {
    const provider = ref<Provider>('codex')
    const busy = ref(false)
    const error = ref<string | null>(null)
    const book = createAttachmentBook()
    const cancelled: unknown[] = []
    let settle: ((state: AuthState) => void) | null = null
    ;(window as unknown as { api?: unknown }).api = {
      runtime: {
        // Not usable, so `SignInPanel` renders at all — a usable credential is silent by design.
        checkProviderAuth: () =>
          Promise.resolve({ state: 'absent', reason: 'This profile has never been signed in.' }),
        // A sign-in that stays pending until the test lets it land — `102`'s whole subject, and
        // the only state in which the Cancel this test presses is on screen.
        signInProvider: () =>
          new Promise((done) => {
            settle = (state) => done({ success: true, state })
          }),
        cancelProviderSignIn: (input: unknown) => {
          cancelled.push(input)
          return Promise.resolve()
        },
      },
    }
    const m = mount(
      defineComponent({
        setup: () => () =>
          h(NewConversation as never, {
            busy: busy.value,
            error: error.value,
            debug: false,
            draft: 'go',
            handing: book.handing(NEW_CONVERSATION),
            defaultProvider: provider.value,
            // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
            // untouched door holds, and `models: null` is *nobody has answered yet*. Both are required
            // props for `handing`'s reason: the typechecker is the only reader of `RuntimeScreen`'s
            // bindings, so a silently-absent one is a silently-absent control.
            models: null,
            choices: NO_LAUNCH_CHOICES,
            capabilities: allProviderCapabilities(),
            onStart: () => (busy.value = true),
          }),
      }),
      {},
      { width: 1200, height: 900 },
    )
    /** Press Send, then have the launch fail — the only route to the credential panel. */
    const fail = async (): Promise<void> => {
      ;(m.q('send-prompt') as HTMLButtonElement).click()
      await settled()
      busy.value = false
      error.value = 'codex exited before it started: no such file or directory (cwd)'
      await settled()
    }
    return { m, provider, cancelled, fail, settle: (state) => settle?.(state) }
  }

  it('🔴 a sign-in that lands after the provider moved does not describe the new one', async () => {
    const f = frame()
    await f.fail()
    f.m.q('sign-in-start').click()
    await settled()
    expect(f.m.q('sign-in-notice').textContent).toMatch(/finish signing in/i)

    // The person creates `default` on the other provider while the browser flow is pending.
    f.provider.value = 'claude'
    await settled()
    // ⚑ **The panel is still there, and that is deliberate**: its Cancel is the only way to stop a
    // running browser flow, so the provider moving must not take it off the screen.
    expect(f.m.all('sign-in-cancel')).toHaveLength(1)

    // 🔴 **The pending answer lands, and it does NOT put Codex's success under Claude's name.**
    f.settle({ state: 'usable', login: 'account', expiresAt: null })
    await settled()
    expect(f.m.all('sign-in-notice')).toHaveLength(0)
    expect(f.m.all('sign-in-panel')).toHaveLength(0)
  })

  it('⛔ …and a cancel names the pair that is RUNNING, not the one on screen', async () => {
    // 🔴 The host keys a sign-in `provider:profileId`. A cancel naming the new provider misses the
    // key, returns silently, and leaves the old flow running under a button that said it stopped.
    const f = frame()
    await f.fail()
    f.m.q('sign-in-start').click()
    await settled()
    f.provider.value = 'claude'
    await settled()
    f.m.q('sign-in-cancel').click()
    await settled()
    expect(f.cancelled).toEqual([{ provider: 'codex', profileId: DEFAULT_PROFILE_ID }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §6 · the OTHER door — an identity, and the provider it chose
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§6 · a conversation started as an identity a person created', () => {
  /**
   * 🔴 **423 relay 1's (b), and the half `424` proved nothing else delivers.** After `417` merges,
   * BroBot's conversation runs in `<userData>/brobot-workspace`, a spawn is bounded by its
   * parent's folder and the bound is monotone — so **every conversation a person can open is
   * BroBot's, in the workspace, and so is everything it spawns.** This sheet is the way out.
   *
   * ⚑ **And it is where `423` §3's resolution finally has something to resolve.** Nothing a person
   * can press writes `default`'s provider on a used app; an identity they CREATED can say what it
   * runs on, and this door is where that answer is spent.
   *
   * ⚠️ **D-016 · no project is picked here any more** — the conversation runs in a folder a person
   * chooses, or in the app's own workspace when none is chosen.
   */

  const placed = (): { m: Mounted; started: unknown[] } => {
    const started: unknown[] = []
    const m = mount(
      defineComponent({
        setup: () => () =>
          h(StartAsAgent as never, {
            profileSlug: 'archivist',
            provider: 'claude',
            onStart: (input: unknown, words: string) => started.push([input, words]),
          }),
      }),
      {},
      { width: 700, height: 700 },
    )
    return { m, started }
  }

  beforeEach(() => {
    ;(window as unknown as { api?: unknown }).api = {
      runtime: {
        agentIdentities: () => Promise.resolve(answers.list),
      },
    }
  })

  it('🔴 it sends the identity AND the provider that identity chose', async () => {
    const f = placed()
    await settled()
    await type(f.m, 'prompt-input', 'read the failing test')
    ;(f.m.q('send-prompt') as HTMLButtonElement).click()
    await settled()
    // ⛔ **The field the front door does not send, and the one it resolves the same way.** ⚠️
    // D-016 · no project, and no `cwd` while no folder is chosen — the host runs it in the app's
    // own workspace, as it runs the front door's.
    expect(f.started).toEqual([
      [
        {
          provider: 'claude',
          profileId: 'archivist',
          approvalMode: 'ask',
        },
        'read the failing test',
      ],
    ])
  })

  it('⛔ with no folder chosen, the sheet says where it runs rather than leaving it blank', async () => {
    const f = placed()
    await settled()
    // ⚑ No folder is a legal answer, said rather than refused. ⚠️ D-016 · it is the app's own
    // workspace now, not a project's missing folder.
    expect(f.m.q('start-as-agent-no-folder').textContent).toMatch(/workspace/i)
    expect(f.m.all('start-as-agent-folder')).toHaveLength(0)
  })

  it('⚑ it names the provider in the same words it will start on', async () => {
    const f = placed()
    await settled()
    // 151's rule: a provider in running prose is spelled the way a person reads it, and the value
    // the launch sends is the same prop — so the sentence cannot name one and start the other.
    expect(f.m.q('start-as-agent-title').textContent).toContain('archivist')
    expect((f.m.q('start-as-agent') as HTMLElement).textContent).toContain('Claude')
  })

  it('⛔ the door is reached from the identity’s own sheet, in one press', async () => {
    // 🔴 The whole path: the Team page's card opens the capability sheet, and the sheet opens
    // this. ⚠️ It was the rail's agent row until `EXT-008` §4.4 moved the roster at `570`. ⚠️ Asserted as the EMIT, because the overlay layer is `RuntimeScreen`'s and a test
    // that mounted the screen would be measuring the screen.
    const asked: string[] = []
    const caps = mount(
      defineComponent({
        setup: () => () =>
          h(CapabilitiesSheet as never, {
            profileSlug: 'pm',
            onStartConversation: (slug: string) => asked.push(slug),
          }),
      }),
      {},
      { width: 900, height: 900 },
    )
    await settled()
    caps.q('capabilities-start-conversation').click()
    await nextTick()
    expect(asked).toEqual(['pm'])
  })
})
