import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { AgentPanelSubAgent } from '../../src/renderer/src/lib/agent-panel'
import { DRAWER_W_MAX } from '../../src/renderer/src/lib/drawer'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { META, mount, unmountAll } from './harness'

/**
 * # Two sub-agent chips in one row are one height
 *
 * The Sub agents box draws its chips two to a row. Each `li` is a flex box, so the chip inside it
 * stretches to the row's height: a chip with a telemetry block (model, effort, context, memory)
 * and a chip without one end at the same line, and the row is not ragged.
 *
 * - 🔴 **One height**: a chip with telemetry beside one without, in one row, are the same height.
 * - ⚑ **Control**: the fixture can tell. The bare chip's own content ends at least one
 *   telemetry block above its bottom edge, so the shared height comes from the stretch and not from
 *   two chips that happen to hold the same content.
 *
 * The existing height check (`the-card-says-what-the-rail-says.dom.test.ts`) compares a chip with a
 * state word to one without. The word sits beside the name, inside a row the 40px plate already
 * sets, so the two chips are the same height whether or not the `li` stretches. Here one chip
 * carries a block the other does not, so only the stretch makes them equal.
 */

afterEach(() => {
  unmountAll()
  // The channel is a window-level singleton: a row left behind would be the next test's premise.
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
  cast.railSays.value = null
  cast.forest.value = null
})

const NOW = Date.now()

const spawn = (conversation: string): SpawnEdge => ({
  conversation,
  identity: 'worker',
  provider: 'claude',
  running: 'unwatched',
})

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

/** Two children, drawn side by side. */
const READ: WhoCalledWhom = {
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>(
    [spawn('sess_ana'), spawn('sess_ayo')],
    'every-conversation-this-one-spawned',
  ),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
}

/** What Ana runs on, every figure known. Ayo has no entry, so its chip draws no telemetry. */
const ANAS: AgentPanelSubAgent = {
  conversation: 'sess_ana',
  name: 'worker',
  profile: 'worker',
  facets: {},
  word: null,
  active: false,
  model: { value: 'claude-opus-5-5' },
  effort: { value: 'high' },
  context: { value: '12%' },
  memory: { value: '210 MB' },
  from: {},
}

async function band(): Promise<HTMLElement> {
  // No rail above the band, so neither chip says a state word: the two differ by telemetry alone.
  useWhoCalledWhom().railSays.value = null
  const m = mount(
    WorkingTogether,
    {
      reading: { conversation: META.sessionId, read: READ, answered: true, atWork: null },
      conversation: META.sessionId,
      identities: null,
      canOpen: true,
      telemetry: new Map([['sess_ana', ANAS]]),
    },
    { width: DRAWER_W_MAX, height: 900 },
  )
  await nextTick()
  const root = m.q('working-together')
  // The mount box is a flex row; the band takes its full width, as it does in the drawer.
  root.style.width = `${DRAWER_W_MAX}px`
  return root
}

const chipOf = (root: HTMLElement, conversation: string): HTMLElement => {
  const chip = root.querySelector<HTMLElement>(
    `[data-cy="cast-children-strip"] .agent-chip[data-conversation="${conversation}"]`,
  )
  expect(chip, `no chip for ${conversation}`).not.toBeNull()
  return chip!
}

const identityOf = (chip: HTMLElement): HTMLElement => {
  const row = chip.querySelector<HTMLElement>('.team-identity')
  expect(row, 'no identity row').not.toBeNull()
  return row!
}

describe('the Sub agents box: chips in one row share one height', () => {
  it('🔴 a chip with telemetry and one without, side by side, are one height', async () => {
    const root = await band()
    const ana = chipOf(root, 'sess_ana')
    const ayo = chipOf(root, 'sess_ayo')
    // The premise: one chip reports what it runs on, the other does not.
    expect(ana.querySelector('[data-cy="cast-tile-telemetry-sess_ana"]')).not.toBeNull()
    expect(ayo.querySelector('[data-cy="cast-tile-telemetry-sess_ayo"]')).toBeNull()
    const [a, b] = [ana.getBoundingClientRect(), ayo.getBoundingClientRect()]
    // Side by side, in one row.
    expect(a.top).toBe(b.top)
    expect(a.left).toBeLessThan(b.left)
    expect(a.height).toBe(b.height)
  })

  it('⚑ CONTROL · the bare chip is stretched by at least the telemetry block it does not draw', async () => {
    const root = await band()
    const ana = chipOf(root, 'sess_ana')
    const ayo = chipOf(root, 'sess_ayo')
    const telemetry = ana
      .querySelector<HTMLElement>('[data-cy="cast-tile-telemetry-sess_ana"]')!
      .getBoundingClientRect()
    expect(telemetry.height).toBeGreaterThan(0)
    // Below its last block, Ana's chip holds only its padding and border.
    const anasTail = ana.getBoundingClientRect().bottom - telemetry.bottom
    // Below its identity row, Ayo's chip holds the same padding and border, plus the room its
    // neighbour's telemetry takes.
    const ayosTail =
      ayo.getBoundingClientRect().bottom - identityOf(ayo).getBoundingClientRect().bottom
    expect(ayosTail - anasTail).toBeGreaterThanOrEqual(telemetry.height - 0.5)
  })
})
