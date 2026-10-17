import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { mount, unmountAll } from './harness'

const row = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName: null,
  createdAt: 0,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
  ...over,
})

const agents: AgentIdentities = {
  identities: [
    row('default', { displayName: 'BroBot', provider: 'codex' }),
    row('running', { provider: 'claude' }),
    row('unnamed'),
    row('no-provider'),
  ],
  foldersWithoutARow: ['default', 'project-manager', 'web-builder'],
  use: [
    {
      slug: 'default',
      conversations: 1,
      thisAppMintsIt: true,
      isLaunching: false,
      isStarting: false,
      runsOn: { provider: 'codex', from: 'saved' },
    },
    {
      slug: 'running',
      conversations: 0,
      thisAppMintsIt: false,
      isLaunching: true,
      isStarting: false,
      runsOn: { provider: 'claude', from: 'saved' },
    },
    {
      slug: 'unnamed',
      conversations: 0,
      thisAppMintsIt: false,
      isLaunching: false,
      isStarting: false,
      runsOn: { provider: null, from: 'nothing-yet' },
    },
    {
      slug: 'no-provider',
      conversations: 0,
      thisAppMintsIt: false,
      isLaunching: false,
      isStarting: false,
      runsOn: { provider: null, from: 'nothing-yet' },
    },
  ],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const store = {
  renameTo: vi.fn(async () => null),
  remove: vi.fn(async () => null),
} as unknown as AgentStore

afterEach(unmountAll)
beforeEach(() => vi.clearAllMocks())

describe('Team workspace fold and door', () => {
  it('renders literal slug fallback, never-run history, provider absence, and orphan folders', () => {
    const mounted = mount(TeamWorkspace, { agents, store })
    expect(mounted.q('team-workspace').textContent).toContain('BroBot')
    expect(mounted.q('team-never-run-unnamed').textContent).toContain('Never run')
    // 🔴 **593 · the engine is LABELLED and it is behind the disclosure** — `EXT-012` §1 measured
    // the defect this repairs: *"three different KINDS of fact — a count, a category, an engine —
    // set identically and stacked"*, and §2 sent the engine off the card's face.
    // ⛔ **Two assertions and not one, on the SPAN rather than the card.** `toContain` on a whole
    // card is satisfied by any neighbour holding the words
    // (`an-assertion-can-be-satisfied-by-a-neighbouring-element`); the label and the value are
    // separate elements and each is read where it lives.
    expect(mounted.q('team-provider-no-provider').textContent?.trim()).toBe('Not chosen yet')
    expect(mounted.q('team-card-no-provider').textContent).toContain('Engine')
    expect(mounted.q('team-other-home-folders').textContent).toContain('project-manager')
    expect(mounted.q('team-card-default').querySelector('input')?.getAttribute('maxlength')).toBe(
      '200',
    )
    expect(mounted.q('team-open-default').querySelector('strong')?.getAttribute('title')).toBe(
      'BroBot',
    )
  })

  it('filters the folded population and reaches rename/removal doors', async () => {
    const mounted = mount(TeamWorkspace, { agents, store })
    const search = mounted.q('team-controls').querySelector('input') as HTMLInputElement
    search.value = 'running'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(mounted.all('team-card-running')).toHaveLength(1)
    expect(mounted.all('team-card-default')).toHaveLength(0)
    mounted.q('team-rename-running').click()
    await nextTick()
    expect(store.renameTo).toHaveBeenCalledWith('running', null)
    search.value = ''
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    mounted.q('team-remove-unnamed').click()
    await Promise.resolve()
    expect(store.renameTo).toHaveBeenCalledWith('running', null)
    expect(store.remove).toHaveBeenCalledWith('unnamed')
  })

  /**
   * 🔴 **570 · a count that says three beside copy that says none is the defect this page EXISTS
   * to resolve** (`EXT-008` §4.4: *"the rail says zero and then names three agents"*).
   *
   * ⛔ **Two controls narrow the roster and only one of them is the search box.** A first version
   * of the empty arm asked `members.length === 0 && query === ''`, which is true whenever the
   * FILTER empties the list — so the page drew its own contradiction. ⚑ The discriminant is
   * `total`, which no control touches.
   */
  it('🔴 a filter that empties the list does not say the machine has no agents', async () => {
    const mounted = mount(TeamWorkspace, { agents, store }, { width: 1100, height: 900 })
    const everyoneHasRun = {
      ...agents,
      use: agents.use.map((use) => ({ ...use, conversations: 1, isLaunching: false })),
    }
    const all = mount(
      TeamWorkspace,
      { agents: everyoneHasRun, store },
      { width: 1100, height: 900 },
    )
    const filter = all.q('team-controls').querySelector('select') as HTMLSelectElement
    filter.value = 'never-run'
    filter.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    // ⚑ The premise: the filter really did empty the list, so this is about the sentence.
    expect(all.all('team-card-default')).toHaveLength(0)
    // ⛔ The count is the machine's and does not move…
    expect(all.q('team-count').textContent).toBe('4')
    // …and the page says the FILTER found nothing, not that the machine has nobody.
    expect(all.all('team-none')).toHaveLength(0)
    expect(all.q('team-no-match').textContent).toContain('matches that')
    // 🔴 **The pair, on the world where the sentence IS true** — otherwise this is a test that
    // one arm never renders rather than a test of which arm renders when.
    expect(mounted.all('team-none')).toHaveLength(0)
    const empty = mount(
      TeamWorkspace,
      { agents: { ...agents, identities: [], use: [] }, store },
      { width: 1100, height: 900 },
    )
    expect(empty.q('team-count').textContent).toBe('0')
    expect(empty.q('team-none').textContent).toContain('No agent identities yet')
  })

  /**
   * ⚑ **570 · the column contract, measured in a REPRODUCED host** — `RuntimeScreen`'s `<main>` is
   * `display: flex; flex-direction: column; overflow: hidden`, and nothing in this repository
   * mounts `RuntimeScreen`. ⛔ **`568` shipped `min-height: 100%` on a standalone root**, which
   * inside that parent is a content-sized flex item the parent then CLIPS: a roster longer than
   * the window would stop, with no scrollbar and nothing saying so. ⚠️ The harness host is a
   * `display: flex` ROW with visible overflow, so it cannot tell the two apart — the host has to
   * be made into the box the app really uses before the question means anything.
   */
  it('⛔ inside a column that hides its overflow, the roster scrolls instead of being cut', async () => {
    const many = {
      ...agents,
      identities: Array.from({ length: 40 }, (_, at) => row(`agent-${String(at)}`)),
      use: [],
    }
    const mounted = mount(TeamWorkspace, { agents: many, store }, { width: 900, height: 320 })
    // ⛔ **The host becomes `.main`**: the same three declarations, read off
    // `RuntimeScreen.vue`'s own `.main` rule.
    Object.assign(mounted.host.style, {
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    })
    await nextTick()
    const page = mounted.q('team-workspace')
    // 🔴 The page fills the column rather than growing past it…
    expect(page.getBoundingClientRect().height).toBeLessThanOrEqual(320)
    // …and the overflow is REACHABLE on the page itself rather than clipped by the parent.
    // ⚠️ **Asked as a SCROLL rather than as a `scrollHeight`/`clientHeight` pair**, deliberately:
    // that pair is the shape `every-assertion-that-reads-clipped-text.test.ts` §2 rosters, and a
    // scroll that actually moves proves the premise (there is more content than the box) and the
    // property (a person can reach it) in one reading instead of two.
    expect(getComputedStyle(page).overflowY).toBe('auto')
    page.scrollTop = 10_000
    expect(page.scrollTop, 'the roster did not scroll — it was cut instead').toBeGreaterThan(0)
    // ⚑ The control, from the same mount: a roster that FITS does not scroll, so the assertion
    // above is about this content rather than about any page in this box.
    const few = mount(TeamWorkspace, { agents, store }, { width: 1400, height: 1600 })
    Object.assign(few.host.style, { display: 'flex', flexDirection: 'column', overflow: 'hidden' })
    await nextTick()
    const short = few.q('team-workspace')
    short.scrollTop = 10_000
    expect(short.scrollTop).toBe(0)
  })

  it('draws the refusal on the card instead of a mystery disabled button', () => {
    const held = {
      ...agents,
      use: agents.use.map((use) => (use.slug === 'default' ? { ...use, conversations: 1 } : use)),
    }
    const mounted = mount(TeamWorkspace, { agents: held, store })
    expect(mounted.q('team-remove-default').hasAttribute('disabled')).toBe(true)
    expect(mounted.q('team-removal-refusal-default').textContent).toContain('conversations')
  })
})
