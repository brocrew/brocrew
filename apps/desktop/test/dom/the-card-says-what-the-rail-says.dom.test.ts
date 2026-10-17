import { afterEach, describe, expect, it } from 'vitest'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import {
  useWhoCalledWhom,
  type RailSays,
} from '../../src/renderer/src/composables/useWhoCalledWhom'
import { facetsOfState } from '../../src/renderer/src/lib/agent-state'
import { DRAWER_W_MAX, DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { agentStateWords, type AgentState } from '../../src/shared/agent-state'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import type { WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import { META, drawerProps, mount, unmountAll } from './harness'

/**
 * # 🔴 UI-001 · the right panel's agents say what the rail says
 *
 * ⚑ **BroBot's check after D-017b** (2026-09-28): at 21:07 Ana was idle with a job due at 21:10 and
 * Ayo was blocked on a question routed to BroBot. `get_agent_status` said *"scheduled · 09:10 PM"*
 * and *"waiting on BroBot's answer"*; the rail agreed; the card under the strip said *idle* and
 * *working* — read off whether their processes ran.
 *
 * ⚑ **The fix draws each agent from its rail row** (`TheCast.railSays`): the plate and the word the
 * rail shows, which for a conversation this window is not fed is the host's one state. ⛔ The band's
 * own reading is what a drawer with no rail above it draws, and nothing else.
 *
 * | § | subject | ⚑ control |
 * |---|---|---|
 * | 1 | the chip's plate is the rail row's | no rail: the band's own reading, which is the reported defect |
 * | 2 | a conversation the rail does not name yet | the faceless plate, never the band's *working* |
 */

afterEach(() => {
  unmountAll()
  // ⛔ **The channel is a window-level singleton**, so a row left behind would be the next test's
  // premise.
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
  cast.railSays.value = null
})

const NOW = Date.now()
/** ⚑ Ana's job, three minutes out — the 21:07 / 21:10 of the finding. */
const DUE = NOW + 3 * 60_000

const spawn = (conversation: string, over: Partial<SpawnEdge> = {}): SpawnEdge => ({
  conversation,
  identity: 'worker',
  provider: 'claude',
  running: 'unwatched',
  ...over,
})

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

/** ⚑ BroBot spawned both. Ana's process is not running; Ayo's is, parked on its question. */
const READ: WhoCalledWhom = {
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>(
    [spawn('sess_ana', { running: 'not-running' }), spawn('sess_ayo')],
    'every-conversation-this-one-spawned',
  ),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
}

/** ⚑ What the band's own reading holds of Ayo: a running process mid-turn. */
const AT_WORK: WhatIsBeingDone = {
  readAt: NOW,
  conversations: [
    {
      conversation: 'sess_ayo',
      identity: 'worker',
      told: { said: 'an-activity', phase: 'tool', detail: null },
      status: 'working',
      streaming: false,
      since: NOW - 60_000,
      context: null,
    },
  ],
}

/** ⚑ A rail row as the rail draws a conversation it is not fed: the host's one state. */
const hostRow = (state: AgentState): RailSays => ({
  facets: facetsOfState(state),
  word: agentStateWords(state),
})

const RAIL = new Map<string, RailSays>([
  ['sess_ana', hostRow({ is: 'scheduled', dueAt: DUE })],
  ['sess_ayo', hostRow({ is: 'waiting-on-an-answer', from: 'BroBot' })],
])

function show(
  rail: ReadonlyMap<string, RailSays> | null,
  read: WhoCalledWhom = READ,
  identities: unknown = null,
  width: number = DRAWER_W_MIN,
) {
  const cast = useWhoCalledWhom()
  cast.reading.value = { conversation: META.sessionId, read, answered: true, atWork: AT_WORK }
  cast.railSays.value = rail
  const drawer = mount(SessionDrawer as never, drawerProps({ identities }), {
    width,
    height: 900,
  })
  // The right panel keeps the chip’s plate; each agent’s standing word comes from its own
  // reading on the Graph tab’s forest. The right panel shows only the current agent’s card.
  return { band: drawer.q('working-together') }
}

const chipOf = (band: HTMLElement, conversation: string): HTMLElement => {
  const chip = band.querySelector<HTMLElement>(
    `[data-cy="cast-children-strip"] .agent-chip[data-conversation="${conversation}"]`,
  )
  expect(chip, `no chip for ${conversation}`).not.toBeNull()
  return chip!
}

const doingOf = (chip: HTMLElement): string | null =>
  chip.querySelector('[data-cy="agent-state"]')?.getAttribute('data-doing') ?? null

describe('UI-001 · the right panel draws each agent as its rail row does', () => {
  it('🔴 §1 · Ana’s chip carries the scheduled clock; Ayo’s is not the running process’s face', () => {
    const { band } = show(RAIL)
    expect(chipOf(band, 'sess_ana').querySelector('.work-mark')?.getAttribute('data-mark')).toBe(
      'scheduled',
    )
    // ⛔ **Not the running process's face** — the band's reading says Ayo is using a tool.
    expect(doingOf(chipOf(band, 'sess_ayo'))).toBe('idle')
  })

  it('⛔ §1 · THE CONTROL — with no rail above the drawer, the band draws its own reading: the reported idle and working', () => {
    const { band } = show(null)
    expect(chipOf(band, 'sess_ana').querySelector('.work-mark')).toBeNull()
    expect(doingOf(chipOf(band, 'sess_ayo'))).toBe('tool')
  })

  it('⚑ §2 · a conversation the rail does not name yet draws the faceless plate, never the band’s working', () => {
    const { band } = show(new Map([['sess_ana', RAIL.get('sess_ana')!]]))
    expect(doingOf(chipOf(band, 'sess_ayo'))).toBe('unknown')
    // ⚑ The named one still draws its row: the rail's answer is per conversation.
    expect(chipOf(band, 'sess_ana').querySelector('.work-mark')?.getAttribute('data-mark')).toBe(
      'scheduled',
    )
  })
})

/* ------------------------------------------------------------------ §3 · UI-004 */

const wordOf = (chip: HTMLElement): string | null =>
  chip.querySelector('.chip-word')?.textContent?.trim() ?? null
const profileOf = (chip: HTMLElement): string | null =>
  chip.querySelector('.chip-profile')?.textContent?.trim() ?? null

describe('UI-004 · each chip says its profile and its state in words (F041)', () => {
  it('🔴 §3 · under the name, the profile and the rail row’s word — the one the plate beside it draws', () => {
    // ⚑ The identity has a name a person gave it, so the name and the profile are two strings.
    const { band } = show(RAIL, READ, [{ id: 'aid:worker', slug: 'worker', displayName: 'Wendy' }])
    const ana = chipOf(band, 'sess_ana')
    expect(ana.querySelector('.chip-name')?.textContent?.trim()).toBe('Wendy')
    expect(profileOf(ana)).toBe('worker')
    expect(wordOf(ana)).toBe(agentStateWords({ is: 'scheduled', dueAt: DUE }))
    expect(ana.querySelector('[data-cy="cast-tile-word-sess_ana"]')).not.toBeNull()
    expect(ana.querySelector('[data-cy="cast-tile-profile-sess_ana"]')).not.toBeNull()
    expect(wordOf(chipOf(band, 'sess_ayo'))).toBe('waiting on an answer from BroBot')
    // ⚑ Each on its own title, for a chip too narrow to hold it.
    expect(ana.querySelector('.chip-word')!.getAttribute('title')).toBe(wordOf(ana))
    expect(ana.querySelector('.chip-profile')!.getAttribute('title')).toBe('worker')
  })

  it('⛔ §3 · a chip the rail does not name says no word, and keeps its profile — the named one beside it says its own', () => {
    // ⚑ W4.183 · at the panel's widest, where two cards share a row (one per row toward 360px).
    const { band } = show(new Map([['sess_ana', RAIL.get('sess_ana')!]]), READ, null, DRAWER_W_MAX)
    const ayo = chipOf(band, 'sess_ayo')
    expect(profileOf(ayo)).toBe('worker')
    expect(ayo.querySelector('.chip-word')).toBeNull()
    const ana = chipOf(band, 'sess_ana')
    expect(wordOf(ana)).toBe(agentStateWords({ is: 'scheduled', dueAt: DUE }))
    // ⚑ Side by side, one with a word and one without, and still one row's height.
    const [a, b] = [ana.getBoundingClientRect(), ayo.getBoundingClientRect()]
    expect(a.top).toBe(b.top)
    expect(a.height).toBe(b.height)
  })

  it('⛔ §3 · with no rail above the drawer, no chip says a word — every profile still drawn', () => {
    const { band } = show(null)
    for (const id of ['sess_ana', 'sess_ayo']) {
      expect(chipOf(band, id).querySelector('.chip-word'), id).toBeNull()
      expect(profileOf(chipOf(band, id)), id).toBe('worker')
    }
  })

  it('⛔ §3 · an agent this app placed no identity for draws no profile — its word still drawn', () => {
    const bare: WhoCalledWhom = {
      ...READ,
      children: walk<SpawnEdge>(
        [spawn('sess_ana', { running: 'not-running', identity: null }), spawn('sess_ayo')],
        'every-conversation-this-one-spawned',
      ),
    }
    const { band } = show(RAIL, bare)
    const ana = chipOf(band, 'sess_ana')
    expect(ana.querySelector('.chip-profile')).toBeNull()
    expect(wordOf(ana)).toBe(agentStateWords({ is: 'scheduled', dueAt: DUE }))
    expect(profileOf(chipOf(band, 'sess_ayo'))).toBe('worker')
  })
})
