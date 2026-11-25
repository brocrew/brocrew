import { PROVIDER_DESCRIPTORS, type Provider } from '@brobot2/shared'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { providerCatalogue } from '../../src/renderer/src/client-provider/catalogue'
import { desktopProviderApi } from '../../src/renderer/src/client-provider/window'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import CommandPalette from '../../src/renderer/src/components/CommandPalette.vue'
import SessionHeader from '../../src/renderer/src/components/SessionHeader.vue'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import { screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import type { PaletteOpenRow } from '../../src/renderer/src/lib/command-palette'
import { conversationList } from '../../src/renderer/src/lib/conversation-list'
import { DRAWER_W_MAX } from '../../src/renderer/src/lib/drawer'
import type { WorkThatNamesIt } from '../../src/shared/piece-called'
import type { LibraryEntry, LibraryPage, ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import type { ConversationSearchHit, WorkSearchResult } from '../../src/shared/work-search'
import { conv, forestDrawn, viewOf } from './forest-fixture'
import { META, mount, unmountAll } from './harness'
import { activity, identities, store, workerRows } from './parallel-workers-fixture'

/**
 * Every surface that shows a conversation draws it with `ConversationRow`, and every provider name
 * it shows with `ProviderLabel`. Each case mounts the real surface with one made-up conversation,
 * finds the element that shows its title, and checks that a `.conversation-row` holds it. Where the
 * surface names a provider, the name is the one the catalogue supplied, and the bare id is not
 * printed as a word of its own.
 */

const SUPPLIED = PROVIDER_DESCRIPTORS.map((one) => ({ ...one, displayName: `Supplied ${one.id}` }))
const TITLE = 'Sample landing page'
const NAMED: WorkThatNamesIt = { label: 'W90.4', title: TITLE }
const NOW = Date.now()

/** A window API whose runtime also answers the provider catalogue. */
const api = (runtime: Record<string, unknown> = {}): never =>
  ({ runtime: { providerCatalogue: async () => SUPPLIED, ...runtime } }) as never

beforeAll(async () => {
  // The catalogue is read once per window, so it is answered before the first mount.
  window.api = api()
  await providerCatalogue(desktopProviderApi).read()
})

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
  screenFacts().update({ reading: null, goTo: null, railSays: null, forest: null })
})

async function settle(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}

function* texts(root: Node): Generator<Text> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node as Text
}

/** The element whose own text shows `text`, searched under `root`. */
function showing(root: Node, text: string): HTMLElement {
  for (const node of texts(root)) if (node.data.includes(text)) return node.parentElement!
  throw new Error(`nothing under the surface shows "${text}"`)
}

/** The one row that holds `el`, asserted to exist. */
function rowOf(el: Element): HTMLElement {
  const row = el.closest<HTMLElement>('.conversation-row')
  expect(row, `"${el.textContent?.trim()}" is not drawn inside a .conversation-row`).not.toBeNull()
  return row!
}

/** The provider is named by `ProviderLabel` with the supplied name, and never by its bare id. */
function expectSuppliedName(root: Element, provider: Provider): void {
  const labels = [...root.querySelectorAll<HTMLElement>('.provider-label')]
  expect(labels.length, 'no .provider-label is drawn').toBeGreaterThan(0)
  for (const label of labels) {
    expect(label.dataset.provider).toBe(provider)
    expect(label.textContent?.trim()).toBe(`Supplied ${provider}`)
  }
  // Each word of the text, split where the rows put their dots.
  const words = [...texts(root)].flatMap((node) =>
    node.data.split('·').map((part) => part.trim().toLowerCase()),
  )
  expect(words).not.toContain(provider)
}

/** A recorded conversation, as the host lists it. */
const recorded = (sessionId: string, provider: Provider): ResumableSessionInfo => ({
  ...workerRows(1)[0]!,
  sessionId,
  provider,
  profileId: 'designer',
  worker: undefined,
  state: { is: 'idle' },
  running: 'unwatched',
  status: 'idle',
  named: NAMED,
  updatedAt: NOW - 60_000,
})

const ENTRY: LibraryEntry = {
  id: 'sample::1',
  provider: 'claude',
  providerSessionId: 'sample-thread-1',
  recordId: 'sample-record-1',
  cwd: '/work/sample-site',
  title: TITLE,
  preview: 'Review the sample project.',
  createdAt: NOW - 7_200_000,
  updatedAt: NOW - 600_000,
  bytes: 32_768,
  origin: 'ours',
  onDisk: true,
  readable: true,
  derived: 'current',
  lastEnding: 'completed',
  unresumableReason: null,
  child: null,
}
const PAGE: LibraryPage = {
  entries: [ENTRY],
  matched: 1,
  counts: {
    ...{ total: 1, ours: 1, userHome: 0, restored: 0, imported: 0, notImported: 0, onlyHere: 0 },
    providers: [{ provider: 'claude', total: 1 }],
  },
  skipped: [],
  skippedTotal: 0,
}

/** All conversations, with one library entry and one recorded conversation. */
async function library(): Promise<HTMLElement> {
  window.api = api({
    listLibrary: async () => PAGE,
    listResumable: async () => [],
    listUnresumable: async () => [],
  })
  const m = mount(SessionLibrary, {})
  await expect.poll(() => m.all(`library-row-${ENTRY.id}`).length).toBe(1)
  await expect.poll(() => m.all(`library-row-${ENTRY.id}`).length).toBe(1)
  return m.host
}

const PALETTE = { conversations: [], looked: true, listError: null, activeId: null, agent: null }
/** Open the palette the way its owner does, and let it draw. */
async function openPalette(props: Record<string, unknown>): Promise<void> {
  ;(mount(CommandPalette, { ...PALETTE, ...props }).vm['toggle'] as () => void)()
  await settle()
}
/** One element in the document, as the palette draws on the body. */
const inDocument = (cy: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-cy="${cy}"]`)

const PALETTE_ROW: PaletteOpenRow = {
  sessionId: 'sess_palette',
  provider: 'claude',
  label: 'Ada',
  named: NAMED,
  word: 'idle',
  opening: null,
  place: null,
}
const ASKING: AttentionRequest = {
  key: 'req-sample',
  sessionId: 'sess_asking',
  requestId: 'r1',
  itemId: 'i1',
  kind: 'permission',
  where: TITLE,
  hasACommander: false,
  provider: 'codex',
  profileId: 'designer',
  who: 'Ada',
  standing: 'waiting: permission',
  asked: 'Run the test suite',
  scope: ['npm test', 'in /work/sample-site'],
  underDisclosed: false,
  detailOmitted: null,
  noPositive: null,
  at: NOW - 120_000,
  decisions: [],
  limit: null,
  sent: false,
  refused: null,
}

const walk = <Row>(rows: readonly Row[], kind: string) =>
  ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0 }) as never
const JUNIPER: SpawnEdge = {
  conversation: 'sess_juniper',
  identity: 'juniper',
  provider: 'claude',
  running: 'unwatched',
}
/** One child conversation, started by the conversation on screen. */
const CAST: WhoCalledWhom = {
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>([JUNIPER], 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
}

/** Team, with these conversations of the recipe worker's identity. */
async function team(rows: ResumableSessionInfo[]): Promise<HTMLElement> {
  const m = mount(
    TeamWorkspace,
    {
      agents: identities(rows.length),
      store,
      beingDone: activity(rows),
      conversations: conversationList({
        resumable: rows,
        unresumable: [],
        identities: identities().identities,
      }),
    },
    { width: 760, height: 1200 },
  )
  await settle()
  return m.host
}

/** The element showing the title, the row's form, and where and which provider is named. */
interface Drawn {
  readonly title: HTMLElement
  readonly form: 'full' | 'compact'
  readonly provider?: { readonly root: Element; readonly id: Provider }
}
/** A list item that shows {@link TITLE}, and names `id` when given. */
const item = (one: Element, form: Drawn['form'], id?: Provider): Drawn => ({
  title: showing(one, TITLE),
  form,
  ...(id ? { provider: { root: one, id } } : {}),
})

const SURFACES: { name: string; draw: () => Promise<Drawn> }[] = [
  {
    name: 'the rail',
    draw: async () => {
      window.api = api({
        listResumable: async () => [recorded('sess_rail', 'claude')],
        listUnresumable: async () => [],
      })
      // The shipped rail width.
      const m = mount(SideRail, { open: [], activeId: null, place: null }, { width: 251.68 })
      await expect.poll(() => m.all('open-session-sess_rail').length).toBe(1)
      return item(m.q('open-session-sess_rail'), 'full', 'claude')
    },
  },
  {
    name: 'All conversations, a library entry',
    draw: async () => {
      const one = (await library()).querySelector(`[data-cy="library-row-${ENTRY.id}"]`)!
      return item(one, 'full', 'claude')
    },
  },
  {
    name: 'the command palette',
    draw: async () => {
      await openPalette({ conversations: [PALETTE_ROW] })
      const one = inDocument('palette-row-open-sess_palette')
      expect(one, 'the palette lists no row for the conversation').not.toBeNull()
      return item(one!, 'compact', 'claude')
    },
  },
  {
    name: 'the Team page, a worker',
    draw: async () => {
      const host = await team(workerRows(1))
      const name = host.querySelector<HTMLElement>('[data-cy="team-worker-name-recipe-1"]')
      expect(name?.textContent).toContain('Mira')
      // The card names the agent's provider in its details.
      const engine = host.querySelector('[data-cy="team-provider-recipe-worker"]')!.parentElement!
      return { title: name!, form: 'full', provider: { root: engine, id: 'codex' } }
    },
  },
  {
    name: 'the Team page, an agent’s Conversations shelf',
    draw: async () => {
      const legacy = { ...workerRows(1)[0]!, sessionId: 'legacy', worker: undefined, named: NAMED }
      const host = await team([legacy])
      host.querySelector<HTMLDetailsElement>('[data-cy="team-shelf-recipe-worker"]')!.open = true
      await nextTick()
      return item(host.querySelector('[data-cy="team-conversation-legacy"]')!, 'compact')
    },
  },
  {
    name: 'the graph, Who called whom',
    draw: async () => {
      const view = viewOf([conv('juniper', null), conv('rowan', 'juniper')])
      const m = mount(TeamForest, { view })
      await forestDrawn()
      await forestDrawn()
      const name = m.all('forest-name').find((el) => /juniper/i.test(el.textContent ?? ''))
      expect(name, 'no graph card is named juniper').toBeDefined()
      return { title: name!, form: 'full' }
    },
  },
  {
    name: 'the panel’s cast of agents',
    draw: async () => {
      screenFacts().update({ railSays: null })
      const juniper = { ...identities().identities[0]!, id: 'aid:juniper', slug: 'juniper' }
      const opened: string[] = []
      const m = mount(
        WorkingTogether,
        {
          reading: { conversation: META.sessionId, read: CAST, answered: true, atWork: null },
          conversation: META.sessionId,
          identities: [{ ...juniper, displayName: 'Juniper' }],
          canOpen: true,
          onOpenConversation: (id: string) => opened.push(id),
        },
        { width: DRAWER_W_MAX, height: 600 },
      )
      await settle()
      const name = m.q('cast-tile-name-sess_juniper')
      expect(name.textContent).toContain('Juniper')
      // The chip around the shared row still opens that conversation.
      name.closest<HTMLElement>('.agent-chip')!.click()
      expect(opened).toEqual(['sess_juniper'])
      return { title: name, form: 'full' }
    },
  },
  {
    name: 'Home’s attention queue',
    draw: async () => {
      const m = mount(AttentionQueue, { requests: [ASKING], now: NOW }, { width: 760 })
      await settle()
      return item(m.q('attention-request-sess_asking'), 'compact', 'codex')
    },
  },
]

/** What the search finds: one conversation, with its provider. */
const HIT: ConversationSearchHit = {
  conversation: 'sess_found',
  address: 'W90',
  title: TITLE,
  line: TITLE,
  profile: 'editor',
  last_active_at: NOW - 3_600_000,
  status: null,
  matched_tasks: [],
  tasks_omitted: 0,
  metadata: { provider: 'claude', archived_at: null, title_author: null },
}
const ONE_HIT = { hits: [HIT], next_cursor: null, searched: 1, rows_unread: 0, ledgers_skipped: 0 }
const FOUND: WorkSearchResult = { ok: true, page: { ...ONE_HIT, complete: true } }

describe('every surface draws a conversation with the one row', () => {
  it.each(SURFACES)('$name', async ({ draw }) => {
    const { title, form, provider } = await draw()
    expect(rowOf(title).dataset.form).toBe(form)
    if (provider) expectSuppliedName(provider.root, provider.id)
  })

  it('the conversation header puts its title editor and its state inside the row', async () => {
    const m = mount(SessionHeader, {
      session: META,
      status: 'idle',
      facets: { doing: 'idle', being: 'live' },
      named: NAMED,
    })
    await settle()
    const row = rowOf(m.q('conversation-title'))
    expect(row.dataset.form).toBe('compact')
    expect(row.contains(m.host.querySelector('.header-title'))).toBe(true)
    expect(m.q('conversation-title').textContent).toContain(TITLE)
    expect(rowOf(m.q('session-status'))).toBe(row)
    expectSuppliedName(m.q('provider-chip'), 'claude')
  })

  it('the palette’s search draws each conversation it found with the compact row', async () => {
    await openPalette({ searchCaller: 'sess_caller', searchConversations: async () => FOUND })
    const box = inDocument('palette-search') as HTMLInputElement
    box.value = 'landing'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await expect.poll(() => inDocument('palette-row-open-sess_found') !== null).toBe(true)
    const one = inDocument('palette-row-open-sess_found')!
    expect(one.querySelectorAll('.conversation-row')).toHaveLength(1)
    expect(rowOf(showing(one, TITLE)).dataset.form).toBe('compact')
    expectSuppliedName(one, 'claude')
  })
})
