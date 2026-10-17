import { afterEach, describe, expect, it } from 'vitest'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import type { ConversationAtWork, WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import { META, drawerProps, mount, unmountAll } from './harness'

/**
 * 🔴 **632 · what a person SEES on a child avatar** — the half the node suite cannot reach.
 *
 * ⛔ **`AgentState` draws a face only for a `doing` that is not `unknown`** (`:122`), so the
 * difference between *this app knows what the child is doing* and *it does not* is a PICTURE. ⚑ The
 * node suite proves the fold; this proves the avatar.
 *
 * ⚠️ **Every case is driven through `CastReading.atWork`**, which is the field `RuntimeScreen` fills
 * from `whatIsBeingDone` — so what is planted here is the wire's own shape and never a plate.
 */

afterEach(unmountAll)

const PARENT = META.sessionId
const CHILD = 'sess_child'
const AT = 1_800_000_000_000

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: 1,
  rowsUnread: 0,
})

const child: SpawnEdge = {
  conversation: CHILD,
  identity: 'worker',
  provider: 'claude',
  running: 'unwatched',
}

/**
 * ⛔ **A second conversation of the SAME identity** — `543` §0's case, and the one a band keyed by
 * identity cannot tell from its sibling.
 */
const SIBLING = 'sess_sibling'
const sibling: SpawnEdge = { ...child, conversation: SIBLING }

/** ⚑ **A conversation the spawn walk never named** — a `WorkEdge` and nothing else. */
const OUTSIDER = 'sess_outsider'
const given: WorkEdge = {
  piece: 'work_1',
  label: 'W1.1',
  title: 'take the notes',
  from: PARENT,
  fromIdentity: 'default',
  to: OUTSIDER,
  toIdentity: 'scribe',
  state: 'working',
  givenAt: AT - 30_000,
  endedAt: null,
}

const read: WhoCalledWhom = {
  conversation: PARENT,
  readAt: AT,
  parent: null,
  children: walk([child, sibling], 'every-conversation-this-one-spawned'),
  workGivenOut: walk([given], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk([], 'every-piece-of-work-this-one-was-given'),
}

/** ⚑ One row of `575`'s reading, in the shape the wire really carries. */
const atWorkRow = (
  told: ConversationAtWork['told'],
  status: 'idle' | 'working',
  over: { conversation?: string; streaming?: boolean } = {},
): WhatIsBeingDone => ({
  readAt: AT,
  conversations: [
    {
      conversation: over.conversation ?? CHILD,
      identity: 'worker',
      told,
      status,
      streaming: over.streaming ?? false,
      since: AT - 5_000,
      context: null,
    },
  ],
})

function draw(atWork: WhatIsBeingDone | null) {
  const cast = useWhoCalledWhom()
  cast.reading.value = { conversation: PARENT, read, answered: true, atWork }
  cast.goTo.value = null
  return mount(SessionDrawer as never, drawerProps({ identities: null }), {
    width: DRAWER_W_MIN,
    height: 900,
  })
}

/**
 * ⛔ **One conversation's plate, as the DOM holds it** — never as the fold reports it.
 *
 * ## 🔴 631 re-pointed this helper, and it is the ONLY thing in this file that moved
 *
 * Spawned children are horizontal tiles in `cast-children-strip`, rather than cards with
 * `data-conversation`. Their plate remains `<AgentState v-bind="card.facets">`, bound to the
 * same fold, so the state cases apply unchanged.
 *
 * Conversations outside the spawn walk also receive a tile, one per line after the children
 * beside their work. A task-row `size="dot"` plate draws no `agent-avatar` in any state, so
 * {@link Plate.faceIsAskable} is false there; the outsider case must read a visible state
 * rather than pass on an absent face ([[a-positive-assertion-must-differ-from-the-default]]).
 */
interface Plate {
  doing: string
  hasFace: boolean
  /** ⛔ `false` on a dot, where NOTHING draws a face and an absence proves nothing. */
  faceIsAskable: boolean
}

const plateOnScreen = (m: ReturnType<typeof mount>, conversation = CHILD): Plate => {
  // ⚑ **Its tile, and nothing else** — the task line that once stood in for a conversation the band
  // held no tile for went with the given list (UI-006); a recipient has a tile of its own.
  const where = m.host
    .querySelector<HTMLElement>(`[data-cy="cast-tile-name-${conversation}"]`)
    ?.closest<HTMLElement>('li')
  expect(where, `nothing on this band names ${conversation}`).toBeTruthy()
  const state = where!.querySelector<HTMLElement>('[data-cy="agent-state"]')
  expect(state, `${conversation} is named but draws no plate`).not.toBeNull()
  return {
    doing: state!.dataset.doing ?? '',
    hasFace: state!.querySelector('[data-cy="agent-avatar"]') !== null,
    faceIsAskable: state!.querySelector('[data-cy="agent-dot"]') === null,
  }
}

describe('632 · the child avatar', () => {
  it('🔴 a child with a live activity wears a FACE, not the faceless ring', () => {
    const m = draw(atWorkRow({ said: 'an-activity', phase: 'tool', detail: 'Bash' }, 'working'))
    const plate = plateOnScreen(m)
    expect(plate.doing).toBe('tool')
    expect(plate.hasFace, 'the plate drew no avatar at all').toBe(true)
  })

  it('⛔ …and with no reading it wears the faceless ring — the state before 632', () => {
    // ⚑ **The control, and it is the same mount one fact over** (standing rule 3). Without it the
    // green above is satisfiable by a component that draws a face for everything.
    const plate = plateOnScreen(draw(null))
    expect(plate.doing).toBe('unknown')
    expect(plate.hasFace, '`unknown` must never draw a face — 081, 099 §3').toBe(false)
  })

  it('⚠️ a child nothing has arrived from is UNKNOWN on screen and never `idle`', () => {
    // 🔴 **`an-unenumerated-state-counts-as-success`, at the pixel.** The row's recorded status is
    // `idle` and `whatAPlateCanDraw` withholds it, so what a person sees is the ring.
    const plate = plateOnScreen(
      draw(atWorkRow({ said: 'nothing', because: 'nothing-has-arrived' }, 'idle')),
    )
    expect(plate.doing).toBe('unknown')
    expect(plate.hasFace).toBe(false)
  })

  it('⚑ …and a child with nothing to do right now is `idle`, which is a face it may wear', () => {
    const plate = plateOnScreen(
      draw(atWorkRow({ said: 'nothing', because: 'no-activity-right-now' }, 'idle')),
    )
    expect(plate.doing).toBe('idle')
  })

  it('🔴 a child that is REPLYING outranks the tool it has finished with', () => {
    // ⛔ **`089`'s defect, and it is why `streaming` is a field of its own on that row.** After a
    // tool returns, the last activity still says `tool` while the model is already streaming — and
    // the pill read *"running Bash"* into the middle of the reply. ⚑ `sessionDoing` puts streaming
    // above activity, and this band inherits that ordering rather than re-deriving it.
    const m = draw(
      atWorkRow({ said: 'an-activity', phase: 'tool', detail: 'Bash' }, 'working', {
        streaming: true,
      }),
    )
    expect(plateOnScreen(m).doing).toBe('replying')
  })

  it('⛔ a conversation the spawn walk never read gets NO state, however much the band holds', () => {
    // ⚠️ **A `WorkEdge` names a conversation with no session row**, so this card carries no
    // `running` and no plate — `547`'s own rule, which `632` did not widen.
    const m = draw(atWorkRow({ said: 'an-activity', phase: 'tool', detail: 'Bash' }, 'working'))
    const outsider = plateOnScreen(m, OUTSIDER)
    expect(outsider.doing).toBe('unknown')
    // ⚑ **The outsider has a plate of its own now** — a line of its own beside its work, since the
    // agents went one per line — so `hasFace` can come out either way, and it is asked: a
    // conversation no session row was read for wears the faceless ring, however much the band holds.
    expect(outsider.faceIsAskable, 'the outsider lost the plate it is asked about').toBe(true)
    expect(outsider.hasFace, 'a conversation the spawn walk never read wears a face').toBe(false)
    // ⚑ **The control on the SAME mount**: the spawned child really is wearing a face, so the
    // absence above is this card's own and not the band drawing nothing for anybody.
    const theChild = plateOnScreen(m, CHILD)
    expect(theChild.doing).toBe('tool')
    expect(theChild.faceIsAskable, 'the child lost its own plate').toBe(true)
    expect(theChild.hasFace).toBe(true)
  })

  it('🔴 a sibling of the SAME identity does not wear this one’s state', () => {
    // ⛔ **`547`'s first rule: a card is a CONVERSATION, not an identity** — and `543` §0 plants
    // exactly this case. ⚠️ A band keyed by identity would give both children one answer.
    const m = draw(atWorkRow({ said: 'an-activity', phase: 'tool', detail: 'Bash' }, 'working'))
    expect(plateOnScreen(m, CHILD).doing).toBe('tool')
    expect(plateOnScreen(m, SIBLING).doing).toBe('unknown')
  })
})
