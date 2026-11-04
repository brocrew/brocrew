import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import ExternalMcpRegistry from '../../src/renderer/src/components/ExternalMcpRegistry.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  AgentIdentity,
  ProviderCapabilityMap,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import type { ExternalMcpServerReach, ExternalMcpServerRow } from '../../src/shared/external-mcp'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **516 · what a person actually sees and presses** (HO-040 §4.2, `HO-042` §3/§6).
 *
 * ## ⛔ Why the rendered half cannot be an SSR string test
 *
 * ⚠️ **Three of the four claims here are about a DISABLED control and a sentence beside it**, and a
 * string assertion cannot tell a rendered paragraph from one that is present and dead —
 * `brobot2-ssr-tests-pass-vacuously` is the standing reason. ⛔ The Codex refusal in particular is a
 * claim about what a person can and cannot MOVE, which only a real press answers.
 *
 * ## ⚑ The four things measured
 *
 *  1. the registry's tick-boxes are drawn from the roster and a tick reaches the wire;
 *  2. ⛔ **on a provider that declares the capability `unwired`, the boxes are dead and the
 *     PROVIDER's own sentence is drawn** — and the grant it already holds is sent back unchanged;
 *  3. the registry block adds and removes, and renders the door's refusal verbatim;
 *  4. the rail draws the section, its count and each address.
 */

interface Answers {
  list: AgentIdentities
  saved: unknown[]
  registered: unknown[]
  removed: unknown[]
  registerFails: string | null
  removeFails: string | null
  loadFails: string | null
}

let answers: Answers

const server = (
  name: string,
  port: number,
  // ⛔ **524 · `'restricted'` is this fixture's default and NOT the product's** (`HO-048` §1). Every
  // row in this file is one a person is expected to TICK — that is what the suite is about — and
  // seeding them `'everyone'` would have made the tick-boxes disappear and the file pass vacuously.
  // ⚑ The product's default is on the registration form, where `a-server-the-workspace-has` pins it.
  reach: ExternalMcpServerReach = 'restricted',
): ExternalMcpServerRow => ({
  id: `ems:${name}`,
  name,
  url: `http://127.0.0.1:${String(port)}/mcp`,
  registeredAt: 1_700_000_000_000,
  reach,
})

const identity = (over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: 'aid:pm',
  slug: 'pm',
  displayName: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
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

/**
 * ⚑ **A capability map with both answers in it**, so *held back* is a statement about one entry
 * rather than about a table nobody filled in. ⛔ The shapes are the real `CapabilityStatus` union.
 *
 * ⚠️ **PLANTED, and since `605` it no longer matches the shipped table** — both providers are
 * `available` there. ⛔ **That is the fixture doing its job rather than rotting**: the subject of
 * these tests is *the sheet draws whatever the entry says and moves nothing*, and a fixture taken
 * from the product would have stopped measuring the held-back arm the day the product stopped
 * having one. ⚑ The tests that pin the PRODUCT's own words are
 * `one-local-server-one-identity.test.ts` and `provider-capabilities.render.test.ts`.
 */
const CAPABILITIES = {
  claude: { externalMcpServers: { state: 'available' } },
  codex: {
    externalMcpServers: {
      state: 'unwired',
      reason: 'Codex asks for a tool approval without naming which call it is about.',
    },
  },
} as unknown as ProviderCapabilityMap

function storeOver(): AgentStore {
  const bridge = {
    agentIdentities: async () => {
      if (answers.loadFails !== null) throw new Error(answers.loadFails)
      return answers.list
    },
    setCapabilities: async (input: unknown) => {
      // ⛔ **Cloned the way the REAL bridge clones** — `a-test-bridge-that-clones-nothing`.
      structuredClone(input)
      answers.saved.push(input)
      return answers.list.identities[0] ?? null
    },
    // ⚑ **696 · the door's answer since `682`** — the identity AND what it cleared (`AgentProviderSet`).
    setAgentProvider: async () => {
      const one = answers.list.identities[0]
      return one === undefined ? null : { ...one, modelChoiceCleared: null }
    },
    setSpawningEnabled: async () => ({ spawningEnabled: answers.list.spawningEnabled }),
    registerExternalMcpServer: async (input: unknown) => {
      structuredClone(input)
      answers.registered.push(input)
      if (answers.registerFails !== null) throw new Error(answers.registerFails)
      const said = input as { name: string; url: string }
      const row = { ...server(said.name, 1), url: said.url }
      answers.list = {
        ...answers.list,
        externalMcpServers: [...answers.list.externalMcpServers, row],
      }
      return row
    },
    removeExternalMcpServer: async (input: unknown) => {
      structuredClone(input)
      answers.removed.push(input)
      if (answers.removeFails !== null) throw new Error(answers.removeFails)
      const said = input as { serverId: string }
      answers.list = {
        ...answers.list,
        externalMcpServers: answers.list.externalMcpServers.filter(
          (one) => one.id !== said.serverId,
        ),
      }
      return true
    },
  } as unknown as RuntimeBridge
  return createAgentStore(bridge)
}

async function openSheet(runsOn: 'claude' | 'codex'): Promise<Mounted> {
  const store = storeOver()
  await store.load()
  const m = mount(
    CapabilitiesSheet,
    { profileSlug: 'pm', runsOn, capabilities: CAPABILITIES, store },
    { width: 900, height: 1200 },
  )
  await nextTick()
  return m
}

async function openRegistry(): Promise<Mounted> {
  const store = storeOver()
  await store.load()
  const m = mount(ExternalMcpRegistry, { store }, { width: 900, height: 1200 })
  await nextTick()
  return m
}

const boxIn = (m: Mounted, cy: string): HTMLInputElement =>
  m.q(cy).querySelector('input') as HTMLInputElement

beforeEach(() => {
  answers = {
    list: {
      identities: [identity()],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      externalMcpServers: [server('jira', 8765)],
    },
    saved: [],
    registered: [],
    removed: [],
    registerFails: null,
    removeFails: null,
    loadFails: null,
  }
})
afterEach(() => {
  unmountAll()
})

describe('516 §1 · the grant, on the sheet where every other grant is', () => {
  it('🔴 a tick puts the server on the wire, and the capability grant beside it is untouched', async () => {
    const m = await openSheet('claude')
    const box = boxIn(m, 'external-mcp-grant-jira')
    expect(box.checked, 'the fixture row holds no grant, so the box starts clear').toBe(false)
    expect(box.disabled).toBe(false)

    box.checked = true
    box.dispatchEvent(new Event('change'))
    await nextTick()
    m.q('capabilities-save').click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const sent = answers.saved.at(-1) as {
      externalMcpServerIds: string[]
      grant: Record<string, unknown>
    }
    expect(sent.externalMcpServerIds).toEqual(['ems:jira'])
    // ⛔ **The COMPLETE set and one transaction**: the capability grant rides the same payload, and
    // every field of it is still `null` — *use the default* — because nothing else was touched.
    expect(Object.values(sent.grant).every((held) => held === null)).toBe(true)
  })

  it('⚑ …and unticking sends an EMPTY set rather than omitting the field', async () => {
    // ⛔ **The two are different intents** (339): an absent key is *this caller does not know about
    // external servers*; `[]` is *this person unticked every box*. The wire requires the field, so
    // the second is the only thing a sheet can say — and the store clears on it.
    answers.list = {
      ...answers.list,
      identities: [identity({ externalMcpServerIds: ['ems:jira'] })],
    }
    const m = await openSheet('claude')
    const box = boxIn(m, 'external-mcp-grant-jira')
    expect(box.checked, 'a row holding the grant draws the box ticked').toBe(true)

    box.checked = false
    box.dispatchEvent(new Event('change'))
    await nextTick()
    m.q('capabilities-save').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      (answers.saved.at(-1) as { externalMcpServerIds: string[] }).externalMcpServerIds,
    ).toEqual([])
  })

  it('⛔ an empty registry says where to add one rather than drawing an empty list', async () => {
    answers.list = { ...answers.list, externalMcpServers: [] }
    const m = await openSheet('claude')
    expect(m.all('external-mcp-grants')).toHaveLength(0)
    // The empty state tells a person the route to the registration form.
    expect(m.q('external-mcp-empty').textContent).toContain('Settings → Tools')
  })

  it('⚑ the sentence about WHEN it lands is drawn, and it says nothing running moves', async () => {
    const m = await openSheet('claude')
    const said = m.q('external-mcp-when').textContent ?? ''
    expect(said).toContain('next conversation')
    expect(said).toContain('Nothing running moves')
  })
})

describe('516 §2 · a provider that cannot carry it says so, and moves nothing', () => {
  it('🔴 the boxes are DEAD and the provider’s own sentence is on screen — with the control beside it', async () => {
    const codex = await openSheet('codex')
    expect(boxIn(codex, 'external-mcp-grant-jira').disabled).toBe(true)
    expect(codex.q('external-mcp-held-back').textContent).toContain(
      'without naming which call it is about',
    )
    // ⚑ **The pairing, at the same moment**: the provider that IS wired draws no sentence and a
    // live box — so *"held back"* is a statement about one declaration rather than about the block.
    const claude = await openSheet('claude')
    expect(claude.all('external-mcp-held-back')).toHaveLength(0)
    expect(boxIn(claude, 'external-mcp-grant-jira').disabled).toBe(false)
  })

  it('⛔ …and a grant the row already holds is SENT BACK unchanged rather than cleared', async () => {
    // 🔴 **`HO-037` §1's *tell, don't clamp*, measured.** A person who granted while this identity
    // ran on a provider that supports it must not lose the grant by moving it — so a Save from the
    // held-back sheet writes the set it arrived with.
    answers.list = {
      ...answers.list,
      identities: [identity({ externalMcpServerIds: ['ems:jira'] })],
    }
    const m = await openSheet('codex')
    expect(boxIn(m, 'external-mcp-grant-jira').checked).toBe(true)
    m.q('capabilities-save').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      (answers.saved.at(-1) as { externalMcpServerIds: string[] }).externalMcpServerIds,
    ).toEqual(['ems:jira'])
  })

  it('⚠️ a capability map that has not arrived holds the control back too', async () => {
    // ⛔ **Fail closed, and null is the third state**: *we have not asked what this provider
    // supports* is not *it is supported*. A sheet that treated an unread map as permission would
    // offer a grant it can say nothing about.
    const store = storeOver()
    await store.load()
    const m = mount(
      CapabilitiesSheet,
      { profileSlug: 'pm', runsOn: 'claude', capabilities: null, store },
      { width: 900, height: 1200 },
    )
    await nextTick()
    expect(boxIn(m, 'external-mcp-grant-jira').disabled).toBe(true)
    expect(m.q('external-mcp-held-back').textContent).toContain('has not read what this provider')
  })
})

describe('516 §3 · the registry block', () => {
  it('🔴 Add sends what a person typed AND the reach they did not touch, and the boxes clear only on success', async () => {
    const m = await openRegistry()
    const name = m.q('external-mcp-name') as HTMLInputElement
    const url = m.q('external-mcp-url') as HTMLInputElement
    name.value = 'browser'
    name.dispatchEvent(new Event('input'))
    url.value = 'http://127.0.0.1:9001/mcp'
    url.dispatchEvent(new Event('input'))
    await nextTick()

    m.q('external-mcp-add').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // 🔴 **524 · the third field is the one nobody touched, and that is the assertion** (`HO-048`
    // §1). ⛔ A person who typed a name and an address and pressed Add registered a server **every
    // identity may use** — *"it starts open"* — and the whole cost this ruling removes is the tick
    // that used to be required afterwards.
    expect(answers.registered.at(-1)).toEqual({
      name: 'browser',
      url: 'http://127.0.0.1:9001/mcp',
      reach: 'everyone',
    })
    await nextTick()
    expect((m.q('external-mcp-name') as HTMLInputElement).value).toBe('')
  })

  it('⛔ a refusal is rendered VERBATIM and the typing survives it', async () => {
    // 🔴 **`423` §2's rule — render the app's sentence; do not compose a second one.** The commonest
    // refusal here is *the server was not running*, and a refusal a person has to retype is a
    // refusal they cannot act on (`425`).
    answers.registerFails =
      '“jira” publishes a tool BroBot2 already governs — spawn_agent. Rename it on the server.'
    const m = await openRegistry()
    const name = m.q('external-mcp-name') as HTMLInputElement
    const url = m.q('external-mcp-url') as HTMLInputElement
    name.value = 'other'
    name.dispatchEvent(new Event('input'))
    url.value = 'http://127.0.0.1:9002/mcp'
    url.dispatchEvent(new Event('input'))
    await nextTick()
    m.q('external-mcp-add').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    expect(m.q('external-mcp-add-refusal').textContent).toContain('spawn_agent')
    expect((m.q('external-mcp-name') as HTMLInputElement).value).toBe('other')
  })

  it.each([
    [
      'unreachable',
      "Couldn't reach the server at http://127.0.0.1:9002/mcp. Check that it's running and try again.",
    ],
    [
      'HTTP refusal',
      'The server at http://127.0.0.1:9002/mcp refused the MCP check (HTTP 500). Nothing was registered.',
    ],
    [
      'MCP refusal',
      'The server at http://127.0.0.1:9002/mcp refused the MCP check. Nothing was registered.',
    ],
    [
      'unreadable reply',
      "Couldn't read the server's MCP reply at http://127.0.0.1:9002/mcp. Nothing was registered.",
    ],
    [
      'timeout',
      "The server at http://127.0.0.1:9002/mcp didn't answer in time. Nothing was registered.",
    ],
    [
      'address',
      '“http://example.invalid/mcp” is not on this machine. BroCrew can only register an unauthenticated server running locally — localhost, 127.0.0.1 or [::1].',
    ],
    [
      'name taken',
      'There is already a server called other. Remove it first, or register this one under another name.',
    ],
    [
      'tool collision',
      '“other” publishes a tool BroCrew already governs — list_profiles. An agent cannot tell one of those apart from BroCrew’s own, so the whole server is refused rather than part of it. Rename it on the server, or register a server that does not publish that name.',
    ],
  ])(
    'a %s registration refusal stays visible when reading the list separately fails',
    async (kind, words) => {
      answers.registerFails = words
      const store = storeOver()
      await store.load()
      const m = mount(ExternalMcpRegistry, { store }, { width: 900, height: 1200 })
      const name = m.q('external-mcp-name') as HTMLInputElement
      const url = m.q('external-mcp-url') as HTMLInputElement
      name.value = 'other'
      name.dispatchEvent(new Event('input'))
      url.value = 'http://127.0.0.1:9002/mcp'
      url.dispatchEvent(new Event('input'))
      await nextTick()
      m.q('external-mcp-add').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
      expect(m.q('external-mcp-add-refusal').textContent?.trim(), kind).toBe(words)
      expect(getComputedStyle(m.q('external-mcp-add-refusal')).display).not.toBe('none')
      expect((m.q('external-mcp-add') as HTMLButtonElement).disabled).toBe(false)
      expect(name.value).toBe('other')
      expect(url.value).toBe('http://127.0.0.1:9002/mcp')
      answers.loadFails = 'The registered servers could not be read.'
      await store.load()
      await nextTick()
      expect(m.q('external-mcp-load-error').textContent).toContain(answers.loadFails)
      expect(m.q('external-mcp-add-refusal').textContent?.trim(), kind).toBe(words)
      expect(getComputedStyle(m.q('external-mcp-add-refusal')).display).not.toBe('none')
      expect(answers.registered).toHaveLength(1)
    },
  )

  it('a removal refusal also stays visible when the server list cannot be read', async () => {
    answers.removeFails = 'The server could not be removed.'
    const store = storeOver()
    await store.load()
    const m = mount(ExternalMcpRegistry, { store }, { width: 900, height: 1200 })
    m.q('external-mcp-remove-jira').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    answers.loadFails = 'The registered servers could not be read.'
    await store.load()
    await nextTick()
    expect(m.q('external-mcp-remove-refusal').textContent?.trim()).toBe(answers.removeFails)
    expect(m.q('external-mcp-load-error').textContent).toContain(answers.loadFails)
    expect(getComputedStyle(m.q('external-mcp-remove-refusal')).display).not.toBe('none')
  })

  it('⛔ Remove names the row, and what it costs is said BEFORE the press', async () => {
    const m = await openRegistry()
    expect(m.q('external-mcp-removal-means').textContent).toContain(
      'every identity that was granted it',
    )
    m.q('external-mcp-remove-jira').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(answers.removed.at(-1)).toEqual({ serverId: 'ems:jira' })
    await nextTick()
    // 🔴 **566 · this line pinned a paragraph that had been FALSE since `524`.** It read *"it
    // grants nobody until you tick it on an agent's own sheet"* under a pre-selected *available to
    // every identity* radio; `HO-048` §1 withdrew it, `524` corrected the rail's copy and this one
    // survived. ⚑ Re-pinned on the clause that replaced it — the same clause the rail used to carry
    // and the Tools page now does — so the three surfaces cannot come apart without a red.
    expect(m.q('external-mcp-none').textContent).toContain('unless you register it as restricted')
  })

  it('⚑ Add is dead while either box is empty, which is the one case this file can answer', async () => {
    // ⛔ **Both halves of the name rule and the whole of the URL rule live at the DOOR**, where the
    // sentences are — see the component's docblock. A blank box is the one refusal this surface can
    // make without composing a second opinion.
    const m = await openRegistry()
    expect((m.q('external-mcp-add') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('566 §5.4 · the rail after the section moved', () => {
  /**
   * 🔴 **`566` replaced this section with a DESTINATION, and the three facts it used to assert are
   * now the page's** — `EXT-008` §1: *"counts, `+` buttons, lists and explanations go into
   * Projects, Agents and Tools as PAGES, where there is room for them and where a person is already
   * looking for that subject."*
   *
   * ⛔ **Re-aimed rather than deleted**, and rule 26 is why: *"stripping alone would have been the
   * worst repair available — the test would have gone GREEN with the world changed underneath it."*
   * ⚑ **Where each moved assertion now lives**, so this block is a pointer and not a gap:
   *
   *  - *nothing before the read lands* → `the-tools-register.dom.test.ts` §1 (`tools-count` is
   *    drawn only once `store.loaded` is true, which is the same `086` rule one surface over);
   *  - *the address on the row* → `the-tools-register.dom.test.ts` §1 and §4, where it is now also
   *    MEASURED rather than read off `textContent` — the rail clipped it at 131px and the page
   *    does not;
   *  - *an empty registry says so* → `the-tools-register.dom.test.ts` §2, on the same sentence.
   */
  it('⛔ draws Tools as a destination — no count, no add button, no list, no sentence', async () => {
    const m = mount(
      SideRail,
      { open: [], activeId: null, place: null, agents: answers.list },
      { width: 240, height: 1200 },
    )
    await nextTick()
    // ⚑ Non-vacuity first: the rail really rendered, and it rendered THIS row.
    expect(m.q('rail-settings').textContent?.trim()).toBe('Settings')

    // ⛔ **The four things `EXT-008` §5 took out of the navigation column.** Every one of them is
    // asserted absent BY NAME, because *the section is gone* is a claim four separate elements
    // could each falsify on their own.
    expect(m.all('rail-external-tools')).toHaveLength(0)
    expect(m.all('external-tools-count')).toHaveLength(0)
    expect(m.all('rail-new-external-mcp')).toHaveLength(0)
    expect(m.all('rail-external-mcp-jira')).toHaveLength(0)
    expect(m.all('rail-external-tools-empty')).toHaveLength(0)
  })

  it('⚑ the row marks itself when that is where you are, like every other destination', async () => {
    const away = mount(
      SideRail,
      { open: [], activeId: null, place: 'sessions', agents: answers.list },
      { width: 240, height: 1200 },
    )
    await nextTick()
    expect(away.q('rail-settings').className).not.toContain('active')

    const there = mount(
      SideRail,
      { open: [], activeId: null, place: 'settings', agents: answers.list },
      { width: 240, height: 1200 },
    )
    await nextTick()
    expect(there.q('rail-settings').className).toContain('active')
  })
})
