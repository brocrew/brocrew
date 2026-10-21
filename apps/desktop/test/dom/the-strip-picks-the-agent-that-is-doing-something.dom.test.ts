import { afterEach, describe, expect, it } from 'vitest'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_W_MAX, DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { AgentIdentity } from '../../src/shared/runtime-ipc'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import type { WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import { META, drawerProps, mount, unmountAll } from './harness'

/**
 * 🔴 **The strip's own layout** — how a chip is drawn, and the box it sits in.
 *
 * The right panel displays only the current agent’s card, so there is no default-open chip
 * selection underneath it. A chip opens that agent’s conversation.
 *
 * The Sub agents box places a small plate beside each name with a state dot. `activeNow`
 * independently accepts a recent give, recently ended work, or a currently running
 * conversation. A child’s start time comes from the piece’s `givenAt`; the spawn edge has no
 * independent time. Each fixture pair keeps every other OR-branch false so a regression in
 * the one varied branch cannot be masked.
 */

afterEach(() => {
  unmountAll()
  useWhoCalledWhom().memoryUnmeasured.value = null
  useWhoCalledWhom().railSays.value = null
  // ⛔ **The channel is a window-level singleton**, so a reading left behind would be the next
  // test's premise. ⚠️ Reset to the cold state rather than to an empty band — they are different
  // facts and this file asserts about both.
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
})

/** ⚑ A stable instant, so every age below is a fact about the fixture rather than about the clock. */
const NOW = Date.now()

const identity = (slug: string, displayName: string | null = null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: NOW - 86_400_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  // ⚑ **The shipped defaults**, because nothing on this band reads a capability — a grant invented
  // here would be a fact about this file rather than about the app.
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const spawn = (over: Partial<SpawnEdge> = {}): SpawnEdge => ({
  conversation: 'sess_child',
  identity: 'worker',
  provider: 'claude',
  running: 'unwatched',
  ...over,
})

/**
 * The strip’s `<li>` elements draw one chip per agent, with a small plate and name side by
 * side.
 */
const agentRows = (strip: HTMLElement): HTMLElement[] => [
  ...strip.querySelectorAll<HTMLElement>(':scope > li'),
]

const walk = <Row>(
  rows: readonly Row[],
  kind: LedgerWalkKind,
  over: Partial<LedgerWalk<Row>> = {},
): LedgerWalk<Row> => ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0, ...over })

const answer = (over: Partial<WhoCalledWhom> = {}): WhoCalledWhom => ({
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>([], 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
  ...over,
})

interface Shown {
  read: WhoCalledWhom | null
  answered?: boolean
  identities?: readonly AgentIdentity[] | null
  /** ⚑ Absent ⇒ no screen above the drawer, so the band draws no press at all. */
  press?: string[]
  /**
   * ⚑ **632 · what each running conversation was last told it is doing**, or absent for a band that
   * has no such reading — which is the state every case written before `632` is in.
   */
  atWork?: WhatIsBeingDone | null
  width?: number
}

function show(over: Shown) {
  const cast = useWhoCalledWhom()
  cast.reading.value =
    over.read === null
      ? null
      : {
          conversation: META.sessionId,
          read: over.read,
          answered: over.answered ?? true,
          atWork: over.atWork ?? null,
        }
  cast.goTo.value = over.press ? (conversation) => over.press!.push(conversation) : null
  return mount(SessionDrawer as never, drawerProps({ identities: over.identities ?? null }), {
    width: over.width ?? DRAWER_W_MIN,
    height: 900,
  })
}

describe('the strip picks the agent that is doing something', () => {
  it('an agent chip draws its small plate, then its name and the dot of its state (the person’s v3 card)', () => {
    const m = show({
      identities: [identity('worker', 'A very long worker name indeed')],
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_a' }), spawn({ conversation: 'sess_b' })],
          'every-conversation-this-one-spawned',
        ),
      }),
    })
    const tiles = agentRows(m.q('cast-children-strip'))
    expect(tiles).toHaveLength(2)
    for (const tile of tiles) {
      const plate = tile.querySelector<HTMLElement>('[data-cy="agent-plate"]')
      const name = tile.querySelector<HTMLElement>('[data-cy^="cast-tile-name-"]')
      expect(plate, 'the chip drew no plate').not.toBeNull()
      expect(name, 'the chip drew no name').not.toBeNull()
      // Measure the row order in pixels: plate, name, then state dot.
      const dot = tile.querySelector<HTMLElement>('.chip-dot')
      expect(dot, 'the chip drew no dot').not.toBeNull()
      expect(
        plate!.getBoundingClientRect().right,
        'the plate sat above the name, not beside it',
      ).toBeLessThanOrEqual(name!.getBoundingClientRect().left)
      expect(name!.getBoundingClientRect().right).toBeLessThanOrEqual(
        dot!.getBoundingClientRect().left,
      )
    }
  })

  it('the strip is the card’s Sub agents box — counted, and never claiming a zero it holds agents under', () => {
    const m = show({
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_a' }), spawn({ conversation: 'sess_b' })],
          'every-conversation-this-one-spawned',
        ),
      }),
    })
    const box = m.q('cast-sub-agents')
    expect(box.querySelector('.title')?.textContent?.trim()).toBe('Started here')
    expect(box.querySelector('.count')?.textContent?.trim()).toBe('(2)')
    expect(box.contains(m.q('cast-children-strip'))).toBe(true)
    expect(m.all('cast-children-empty')).toHaveLength(0)
    // Near the panel’s 360px floor, each sub-agent occupies one row.
    const [one, two] = agentRows(m.q('cast-children-strip'))
    expect(two!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      one!.getBoundingClientRect().bottom,
    )
    m.unmount()
    // ⚑ …and side by side at its widest.
    const wide = show({
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_a' }), spawn({ conversation: 'sess_b' })],
          'every-conversation-this-one-spawned',
        ),
      }),
      width: DRAWER_W_MAX,
    })
    const [left, right] = agentRows(wide.q('cast-children-strip'))
    expect(left!.getBoundingClientRect().top).toBe(right!.getBoundingClientRect().top)
  })

  // There is no default-open agent under the strip. The right panel shows only the current
  // agent’s card, and a chip opens its own conversation
  // (`the-first-picture-of-who-called-whom.dom.test.ts` §1).
})

describe('W4.203 · an idle or ended sub-agent says what it last reported', () => {
  it('its model, effort and last context with its time — and "not recorded" only where there is none', () => {
    const m = show({
      read: answer({
        children: walk(
          [spawn({ conversation: 'sess_ali' }), spawn({ conversation: 'sess_amara' })],
          'every-conversation-this-one-spawned',
        ),
        lastReported: {
          sess_ali: {
            model: 'claude-sonnet-5-5',
            modelFrom: 'its-provider',
            effort: 'high',
            effortFrom: 'its-setting',
            context: { reading: { kind: 'tokens', used: 141_404 }, at: NOW - 60_000 },
          },
          sess_amara: {
            model: 'claude-opus-5-5',
            modelFrom: 'its-provider',
            effort: null,
            effortFrom: null,
            context: null,
          },
        },
      }),
      width: DRAWER_W_MAX,
    })
    const metric = (conversation: string, key: string): HTMLElement =>
      m.q(`cast-tile-telemetry-${conversation}`).querySelector<HTMLElement>(`.chip-metric.${key}`)!
    expect(metric('sess_ali', 'model').textContent?.trim()).toBe('claude-sonnet-5-5')
    expect(metric('sess_ali', 'model').title).toBe('Model: claude-sonnet-5-5 (last ran)')
    expect(metric('sess_ali', 'effort').title).toBe('Reasoning effort: high (asked for)')
    expect(metric('sess_ali', 'context').textContent).toContain('141k')
    expect(metric('sess_ali', 'context').title).toContain('last reported at')
    expect(metric('sess_ali', 'memory').textContent?.trim()).toBe('not running')
    expect(metric('sess_amara', 'model').title).toBe('Model: claude-opus-5-5 (last ran)')
    expect(metric('sess_amara', 'effort').textContent?.trim()).toBe('not recorded')
    expect(metric('sess_amara', 'context').textContent?.trim()).toBe('not recorded')
  })

  it('🔴 where no process could be measured, the memory chip says so in main’s words, never "not running"', () => {
    const said = 'BroBot can’t measure its agents’ memory and CPU on Windows yet.'
    const children = walk(
      [spawn({ conversation: 'sess_ali' })],
      'every-conversation-this-one-spawned',
    )
    const memory = (m: ReturnType<typeof show>): HTMLElement =>
      m.q('cast-tile-telemetry-sess_ali').querySelector<HTMLElement>('.chip-metric.memory')!

    useWhoCalledWhom().memoryUnmeasured.value = said
    const unmeasured = show({ read: answer({ children }), width: DRAWER_W_MAX })
    expect(memory(unmeasured).textContent?.trim()).toBe('not measured')
    expect(memory(unmeasured).title).toBe(`Memory (RAM): ${said}`)
    expect(memory(unmeasured).getAttribute('aria-label')).toBe(`Memory (RAM): ${said}`)
    unmountAll()

    // The control: the processes were read and this one holds none.
    useWhoCalledWhom().memoryUnmeasured.value = null
    const stopped = show({ read: answer({ children }), width: DRAWER_W_MAX })
    expect(memory(stopped).textContent?.trim()).toBe('not running')
    expect(memory(stopped).title).toBe('Memory (RAM): Not running now.')
  })

  it('🔴 a working agent whose process has no figure yet is not said to be "not running"', () => {
    const children = walk(
      [spawn({ conversation: 'sess_ali' }), spawn({ conversation: 'sess_amara' })],
      'every-conversation-this-one-spawned',
    )
    const cast = useWhoCalledWhom()
    cast.railSays.value = new Map([
      ['sess_ali', { facets: { doing: 'working' }, word: 'working' }],
      ['sess_amara', { facets: { doing: 'idle' }, word: 'idle' }],
    ])
    const m = show({ read: answer({ children }), width: DRAWER_W_MAX })
    const memory = (conversation: string): HTMLElement =>
      m.q(`cast-tile-telemetry-${conversation}`).querySelector<HTMLElement>('.chip-metric.memory')!
    expect(memory('sess_ali').textContent?.trim()).toBe('not measured')
    expect(memory('sess_ali').title).toBe('Memory (RAM): Not measured yet.')
    // The control: an idle one with no process is not running.
    expect(memory('sess_amara').textContent?.trim()).toBe('not running')
  })
})
