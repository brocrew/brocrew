import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import ExternalMcpRegistry from '../../src/renderer/src/components/ExternalMcpRegistry.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { EXTERNAL_MCP_NONE_YET, EXTERNAL_MCP_REMOVAL_MEANS } from '../../src/shared/external-mcp'
import type { ExternalMcpServerReach, ExternalMcpServerRow } from '../../src/shared/external-mcp'
import { MAX_PATH_CHARS } from '../../src/shared/runtime-ipc'
import type {
  AgentIdentities,
  AgentIdentity,
  ProviderCapabilityMap,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import { assertClipped, assertDrawn, cutsOf, drawnReady, lineCount } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **566 · the Tools register — what a person sees, and what the page refuses to say** (`564`'s
 * smallest standalone slice, `EXT-008` §4.1).
 *
 * ## ⛔ Why this is a dom suite and not an SSR string test
 *
 * ⚠️ **§4 is a measurement and nothing else can take it.** `566` §5.3: *"A server URL is unbounded
 * user-entered text; `530` found a value that had never fitted its column at all."* ⛔ A string
 * assertion reads the same `textContent` whether the address is drawn or clipped to nothing —
 * `brobot2-ssr-tests-pass-vacuously`, and `531`'s whole finding.
 *
 * ⚑ **The rest is here for the same reason it is on one page**: the count that must not be drawn
 * before the read lands is a rendered absence, and the incumbent this dispatch measures against —
 * the registration sheet, which still ellipsizes an address — has to be mounted in the same frame
 * to be compared honestly (`measure-the-incumbent-at-the-same-moment`).
 *
 * ## ⚠️ Every negative below is paired with a reading of the same surface
 *
 * ⛔ **An absence asserted over a surface that drew nothing is not a measurement.** Each block that
 * asserts something is NOT drawn also reads a string the page DID draw in the same mount, so a
 * component that rendered an empty root would fail rather than pass.
 */

interface Answers {
  list: AgentIdentities
  opened: number
  removed: string[]
  removeError: string | null
  failReread: boolean
  holdRemoval: boolean
  releaseRemoval: (() => void) | null
}

let answers: Answers

const server = (
  name: string,
  url: string,
  reach: ExternalMcpServerReach,
  registeredAt = 1_700_000_000_000,
): ExternalMcpServerRow => ({ id: `ems:${name}`, name, url, registeredAt, reach })

const identity = (slug: string, granted: readonly string[] = []): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  externalMcpServerIds: granted,
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

/**
 * ⚑ **The real shape of the capability table's two answers**, so `unwired` is a statement about one
 * entry rather than a table nobody filled in. ⛔ The words are deliberately NOT the product's — §6
 * asserts the product's own bytes reach the page separately, and a fixture that copied them would
 * make that assertion compare a string with itself.
 */
const CAPABILITIES = {
  claude: {
    externalMcpServers: { state: 'available', note: 'A fixture note about handing over.' },
  },
  codex: {
    externalMcpServers: { state: 'unwired', reason: 'A fixture reason about not handing over.' },
  },
} as unknown as ProviderCapabilityMap

/** ⚑ `now`, fixed, so `Registered …` is a derivation rather than a race with the wall clock. */
const NOW = 1_700_000_000_000 + 3 * 86_400_000

/**
 * 🔴 **The longest address this app can ever hold** — `MAX_PATH_CHARS`, the wire's own ceiling on
 * `registerExternalMcpServer.url`.
 *
 * ⛔ **Built FROM the constant on purpose, which is the opposite of `repeat(CAP + 1)`.** That shape
 * is refused for a REFUSAL test, where a fixture that moves with the bound can no longer pin it
 * (`a-bound-written-as-the-constant-cannot-pin-it`); this is a LAYOUT test, where the question is
 * *can a person read the widest value the door admits* — and the day the door admits a wider one,
 * this measurement should widen with it or it has stopped asking. ⚑ The length is asserted against
 * the constant below, so the premise is visible rather than assumed.
 */
const HEAD = 'http://127.0.0.1:8765/'
const A_URL_NO_COLUMN_COULD_HOLD = HEAD + 'a'.repeat(MAX_PATH_CHARS - HEAD.length)

function storeOver(): AgentStore {
  const bridge = {
    agentIdentities: async () => {
      if (answers.failReread && answers.removed.length > 0)
        throw new Error('The roster reread failed')
      return answers.list
    },
    removeExternalMcpServer: async ({ serverId }: { serverId: string }) => {
      answers.removed.push(serverId)
      if (answers.holdRemoval)
        await new Promise<void>((resolve) => {
          answers.releaseRemoval = resolve
        })
      if (answers.removeError !== null) throw new Error(answers.removeError)
      answers.list = {
        ...answers.list,
        externalMcpServers: answers.list.externalMcpServers.filter((row) => row.id !== serverId),
      }
      return true
    },
  } as unknown as RuntimeBridge
  return createAgentStore(bridge)
}

/** ⛔ A store whose read has been asked for and has not answered — `loaded` is still false. */
function storeThatHasNotAnswered(): AgentStore {
  return createAgentStore({
    agentIdentities: () => new Promise<AgentIdentities>(() => {}),
  } as unknown as RuntimeBridge)
}

async function openPage(
  extra: Record<string, unknown> = {},
  box: { width: number; height: number } = { width: 1100, height: 900 },
): Promise<Mounted> {
  const store = storeOver()
  await store.load()
  const m = mount(
    SettingsScreen,
    {
      tab: 'tools',
      store,
      capabilities: CAPABILITIES,
      warnings: null,
      clock: NOW,
      toolsNow: NOW,
      onAddServer: () => (answers.opened += 1),
      ...extra,
    },
    box,
  )
  await nextTick()
  await drawnReady()
  return m
}

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

beforeEach(() => {
  answers = {
    list: {
      identities: [identity('pm'), identity('web-builder'), identity('scout')],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      externalMcpServers: [],
    },
    opened: 0,
    removed: [],
    removeError: null,
    failReread: false,
    holdRemoval: false,
    releaseRemoval: null,
  }
})
afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ─────────────────────────────────────────────────────────────────────────────
   §1 · two servers of DIFFERENT REACH — 566 §5.2's first planted world
   ───────────────────────────────────────────────────────────────────────────── */

describe('566 §1 · every server this app registered, and what each one is', () => {
  beforeEach(() => {
    answers.list = {
      ...answers.list,
      identities: [
        identity('pm', ['ems:browser']),
        identity('web-builder', ['ems:browser']),
        identity('scout'),
      ],
      externalMcpServers: [
        server('kibana', 'http://127.0.0.1:4000/demo-logs/mcp', 'everyone'),
        server('browser', 'http://localhost:3070/mcp', 'restricted'),
      ],
    }
  })

  it('🔴 the headline: both rows, both addresses whole, and 566 §4.1 — which is which', async () => {
    const m = await openPage()
    expect(m.q('tools-count').textContent).toBe('2')

    expect(m.q('tools-name-kibana').textContent).toBe('kibana')
    expect(m.q('tools-url-kibana').textContent).toBe('http://127.0.0.1:4000/demo-logs/mcp')
    expect(m.q('tools-name-browser').textContent).toBe('browser')
    expect(m.q('tools-url-browser').textContent).toBe('http://localhost:3070/mcp')

    // 🔴 **`566` §4.1** — *"A register that does not show which is which is hiding the only
    // per-server decision a person makes."* ⛔ Both values drawn, never only the exception.
    expect(m.q('tools-reach-kibana').textContent).toBe('Available to every identity')
    expect(m.q('tools-reach-browser').textContent).toBe('Only the identities I grant it to')
  })

  it('⚑ a restricted server says how many were granted it; an everyone server is not asked', async () => {
    const m = await openPage()
    expect(m.q('tools-granted-browser').textContent).toBe('Granted to 2 identities')
    // ⛔ **The paired absence, and it is a fact rather than a gap** — an `'everyone'` row carries no
    // grant rows at all, so a count over it would read `0` for a server every agent can use.
    expect(m.all('tools-granted-kibana')).toHaveLength(0)
    // ⚠️ Non-vacuous: the row this absence is about was drawn, with its own reading, in this mount.
    expect(m.q('tools-registered-kibana').textContent).toBe('Registered 3d ago')
  })

  it('says removal consequences before the press and removes only the chosen server', async () => {
    const m = await openPage()
    expect(m.q('tools-removal-means-browser').textContent?.trim()).toBe(EXTERNAL_MCP_REMOVAL_MEANS)
    expect(m.q('tools-removal-means-kibana').textContent?.trim()).toBe(EXTERNAL_MCP_REMOVAL_MEANS)
    expect(answers.removed).toEqual([])
    expect(m.q('tools-remove-browser').textContent?.trim()).toBe('Remove')
    m.q('tools-remove-browser').click()
    await nextTick()
    await drawnReady()
    expect(answers.removed).toEqual(['ems:browser'])
    expect(m.all('tools-row-browser')).toHaveLength(0)
    expect(m.q('tools-name-kibana').textContent).toBe('kibana')
  })

  it('keeps a host removal refusal visible beside the unchanged list', async () => {
    answers.removeError = 'The host refused this removal'
    const m = await openPage()
    m.q('tools-remove-browser').click()
    await nextTick()
    await drawnReady()
    expect(m.q('tools-remove-refusal').textContent).toContain('The host refused this removal')
    expect(m.q('tools-name-browser').textContent).toBe('browser')
  })

  it('keeps successful removal feedback visible when the roster reread fails', async () => {
    answers.failReread = true
    const m = await openPage()
    m.q('tools-remove-browser').click()
    await nextTick()
    await drawnReady()
    expect(m.q('tools-load-error').textContent).toContain('The roster reread failed')
    expect(m.q('tools-remove-refusal').textContent).toContain('The server was removed, but')
  })

  it('disables every removal press while one removal is still in progress', async () => {
    answers.holdRemoval = true
    const m = await openPage()
    try {
      m.q('tools-remove-browser').click()
      await nextTick()
      expect(m.q('tools-remove-browser').textContent?.trim()).toBe('Removing…')
      expect((m.q('tools-remove-browser') as HTMLButtonElement).disabled).toBe(true)
      expect((m.q('tools-remove-kibana') as HTMLButtonElement).disabled).toBe(true)
      expect(answers.removed).toEqual(['ems:browser'])
    } finally {
      answers.releaseRemoval?.()
    }
    await drawnReady()
    expect(m.q('tools-name-kibana').textContent).toBe('kibana')
  })

  it('⛔ the page performs nothing — Add server… raises the gesture and opens no overlay', async () => {
    const m = await openPage()
    // ⚑ **A READING of the control before the absences below** — `556`'s rule: an absence asserted
    // over a surface that drew nothing is not a measurement, and `toHaveLength(0)` is not a
    // reading. This is the words on the button the rail's `+` became.
    expect(m.q('tools-add-server').textContent?.trim()).toBe('Add server…')
    expect(answers.opened).toBe(0)
    m.q('tools-add-server').click()
    await nextTick()
    expect(answers.opened).toBe(1)
    // ⚑ The page drew no form of its own: `516`'s sheet is the only registration surface there is.
    expect(m.all('external-mcp-name')).toHaveLength(0)
    expect(m.all('external-mcp-reach-everyone')).toHaveLength(0)
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
   §2 · an install with NONE — 566 §5.2's second planted world, and §4.3's common one
   ───────────────────────────────────────────────────────────────────────────── */

describe('566 §2 · the fresh install, which is the state the person is in right now', () => {
  it('⚑ says what an empty register means, in the sentence EXT-008 §2 quoted as true', async () => {
    const m = await openPage()
    expect(m.q('tools-count').textContent).toBe('0')
    expect(m.all('tools-rows')).toHaveLength(0)
    expect(m.q('tools-none').textContent?.trim()).toBe(EXTERNAL_MCP_NONE_YET)
    // ⛔ **The ruling is the half that had to survive the move** — `HO-048` §1's default, said on
    // the surface a person meets before they have registered anything.
    expect(m.q('tools-none').textContent).toContain('unless you register it as restricted')
    // ⚠️ **And the pointer is NOT in it** — see {@link EXTERNAL_MCP_NONE_YET}: *Add one above* was
    // true in the rail, false in the sheet where the form is below, and is why one sentence could
    // not be three surfaces' copy until `566` removed it.
    expect(m.q('tools-none').textContent).not.toContain('above')
    // ⚑ The entrance it used to name is on the page, so nothing was lost by dropping the words.
    expect(m.q('tools-add-server').textContent?.trim()).toBe('Add server…')
  })

  it('🔴 an empty register is not an error and not an unread one — all three are distinct', async () => {
    const empty = await openPage()
    expect(empty.all('tools-loading')).toHaveLength(0)
    expect(empty.all('tools-load-error')).toHaveLength(0)
    expect(empty.q('tools-none').textContent?.length).toBeGreaterThan(0)

    // ⛔ **086 · *not asked* claims no count at all.** A `0` before the answer arrives is the page
    // saying it looked, which is the one thing this state may not imply.
    const cold = mount(
      SettingsScreen,
      {
        tab: 'tools',
        store: storeThatHasNotAnswered(),
        capabilities: CAPABILITIES,
        warnings: null,
        clock: NOW,
        toolsNow: NOW,
      },
      { width: 1100, height: 900 },
    )
    await nextTick()
    expect(cold.all('tools-count')).toHaveLength(0)
    expect(cold.all('tools-none')).toHaveLength(0)
    // ⚠️ Non-vacuous: the page rendered, and it said which of the three states it is in.
    expect(cold.q('tools-loading').textContent).toContain('Reading the registered servers')
  })

  it('⚠️ a read that refused draws the store’s own sentence, and claims no count', async () => {
    const store = createAgentStore({
      agentIdentities: async () => {
        throw new Error('the registry could not be read')
      },
    } as unknown as RuntimeBridge)
    await store.load()
    const m = mount(
      SettingsScreen,
      {
        tab: 'tools',
        store,
        capabilities: CAPABILITIES,
        warnings: null,
        clock: NOW,
        toolsNow: NOW,
      },
      { width: 1100, height: 900 },
    )
    await nextTick()
    expect(m.q('tools-load-error').textContent).toContain('could not be read')
    expect(m.all('tools-count')).toHaveLength(0)
    expect(m.all('tools-none')).toHaveLength(0)
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
   §3 · 566 §4.2 · what each provider is handed, in that provider's own words
   ───────────────────────────────────────────────────────────────────────────── */

describe('566 §3 · the provider block, rendered from the capability table', () => {
  it('🔴 draws every provider the table answered for, with that provider’s own sentence', async () => {
    const m = await openPage()
    expect(m.q('tools-provider-says-claude').textContent).toBe('A fixture note about handing over.')
    expect(m.q('tools-provider-says-codex').textContent).toBe(
      'A fixture reason about not handing over.',
    )
    // ⚑ **The display NAME, through `providerName`, never the key** — and read off its own
    // element rather than the block, so a hit inside a neighbouring sentence cannot answer
    // (`an-assertion-can-be-satisfied-by-a-neighbouring-element`).
    expect(m.q('tools-provider-claude').querySelector('strong')?.textContent).toBe('Claude')
    expect(m.q('tools-provider-codex').querySelector('strong')?.textContent).toBe('Codex')
  })

  it('⛔ a table nobody has answered draws NO block — 086, not an empty one and not a claim', async () => {
    const m = await openPage({ capabilities: null })
    expect(m.all('tools-providers')).toHaveLength(0)
    expect(m.all('tools-provider-claude')).toHaveLength(0)
    // ⚠️ Non-vacuous: the same mount drew the rest of the page.
    expect(m.q('tools-register-is').textContent?.length).toBeGreaterThan(0)
  })

  it('⚑ the two refusals v2.10 asked for are said to the person, not left in a docblock', async () => {
    const m = await openPage()
    const said = m.q('tools-not-a-report').textContent ?? ''
    // ⛔ no health claim …
    expect(said).toContain('does not say the server is running')
    // ⛔ … and registration ≠ a conversation's reported tool inventory.
    expect(said).toContain('read from the conversation itself')
    // ⚠️ **And it names no destination** — `a-pointer-clause-is-a-claim`: v2.10's version ends
    // *"Inspect that conversation's Tools tab"*, which is navigation this dispatch did not build.
    expect(said).not.toContain('tab')
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
   §4 · 566 §5.3 · MEASURED INK — 531's sensor, against the incumbent
   ───────────────────────────────────────────────────────────────────────────── */

describe('566 §4 · a URL no column could hold', () => {
  beforeEach(() => {
    answers.list = {
      ...answers.list,
      externalMcpServers: [
        server('long', A_URL_NO_COLUMN_COULD_HOLD, 'everyone'),
        server('short', 'http://127.0.0.1:8765/mcp', 'everyone'),
      ],
    }
  })

  it('⚠️ the premise: the fixture IS the widest address the door admits', () => {
    expect(A_URL_NO_COLUMN_COULD_HOLD.length).toBe(MAX_PATH_CHARS)
    expect(A_URL_NO_COLUMN_COULD_HOLD.startsWith('http://127.0.0.1:')).toBe(true)
  })

  for (const width of [1100, 760]) {
    it(`🔴 at ${String(width)}px every character of it is drawn, and it pushes nothing sideways`, async () => {
      await page.viewport(Math.max(width, 900), 900)
      const m = await openPage({}, { width, height: 900 })

      const address = m.q('tools-url-long')
      // ⛔ **The mount host as `boundary`** — `drawn.ts` limit 5b: the default is `document.body`,
      // which `base.css` gives `overflow: hidden` on purpose, so it is itself a `never` clipper.
      assertDrawn(address, `the widest legal address at ${String(width)}px`, m.host)

      // ⚑ **The positive control on the same mount**: the short address beside it is not cut
      // either, so *nothing was cut* is a reading of this page rather than of an empty one.
      expect(cutsOf(m.q('tools-url-short'), m.host)).toEqual([])

      // ⛔ **It WRAPPED rather than fitting** — without this the assertion above would also pass on
      // a page that happened to be wide enough, and the rule being measured is the wrap.
      expect(lineCount(address)).toBeGreaterThan(8)

      // ⚠️ **And the page does not scroll sideways because of it** — the non-vacuity half
      // `the-documents-a-project-actually-produced` pairs with its own clip assertion.
      const row = m.q('tools-row-long')
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
      expect(row.clientWidth).toBeGreaterThan(300)
    })
  }

  it('🔴 the incumbent, measured in the same frame: the registration sheet CUTS the same string', async () => {
    // ⛔ **`measure-the-incumbent-at-the-same-moment`.** *The page draws it whole* is only a claim
    // about this dispatch if the surface it replaced did not — and `ExternalMcpRegistry`'s
    // `.row-copy small` is `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` today.
    // ⚑ This is what `566` §5.3 is pointing at: the rail clipped this string in a 131px copy
    // column, the sheet still clips it in a 560px one, and the page is the surface with room.
    const store = storeOver()
    await store.load()
    const sheet = mount(ExternalMcpRegistry, { store }, { width: 900, height: 1200 })
    await nextTick()
    await drawnReady()
    const cut = assertClipped(
      sheet.q('external-mcp-row-long').querySelector('small.mono') as HTMLElement,
      'the same address in the registration sheet',
      sheet.host,
    )
    expect(cut.axis).toBe('x')

    const m = await openPage({}, { width: 900, height: 900 })
    assertDrawn(m.q('tools-url-long'), 'the same address on the page', m.host)
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
   §5 · 566 §5.4 · what still points at the rail, and whether it still points at anything
   ───────────────────────────────────────────────────────────────────────────── */

describe('566 §5 · the sentence that names a destination, and the destination', () => {
  it('🔴 the capability sheet’s pointer names the row the rail actually draws', async () => {
    // ⛔ **`566` §5.4 asks *whether anything still points at it*, and one thing did.**
    // `CapabilitiesSheet`'s empty-registry paragraph read *"Add one from External tools in the
    // rail"* — a pointer at the section this dispatch removed. ⚠️ **The assertion that already
    // covered that paragraph reads the SHEET's own string**, so it would have stayed green while
    // the sentence pointed at nothing (`a-pointer-clause-is-a-claim`).
    // ⚑ **This is the instrument that could not have stayed green**: it takes the label off the
    // rail and requires the sentence to name THAT.
    const rail = mount(
      SideRail,
      { open: [], activeId: null, place: null, agents: answers.list },
      { width: 240, height: 1200 },
    )
    await nextTick()
    const label = rail.q('rail-settings').textContent?.trim() ?? ''
    expect(label.length, 'the rail drew no destination to point at').toBeGreaterThan(2)

    const store = storeOver()
    await store.load()
    const sheet = mount(
      CapabilitiesSheet,
      { profileSlug: 'pm', runsOn: 'claude', capabilities: CAPABILITIES, store },
      { width: 900, height: 1200 },
    )
    await nextTick()
    const said = sheet.q('external-mcp-empty').textContent ?? ''
    const toolsPage = await openPage()
    const tab = toolsPage.q('settings-tab-tools').textContent?.trim() ?? ''
    expect(tab.length, 'the Settings tab drew no label').toBeGreaterThan(2)
    expect(said).toContain(`${label} → ${tab}`)
    expect(said).not.toContain('Tools in the sidebar')
  })
  it('⛔ pressing the row asks for THIS destination — the rail routes nothing itself', async () => {
    // ⚠️ **The rail raises `go` and `RuntimeScreen` writes `place`** (`SideRail.vue:501`'s rule),
    // so the only thing this row can get wrong is WHICH place it names — and a row wired to a
    // neighbouring destination draws identically and reads identically.
    const went: string[] = []
    const rail = mount(
      SideRail,
      {
        open: [],
        activeId: null,
        place: null,
        agents: answers.list,
        onGo: (place: string) => went.push(place),
      },
      { width: 240, height: 1200 },
    )
    await nextTick()
    rail.q('rail-settings').click()
    await nextTick()
    expect(went).toEqual(['settings'])
  })
})
