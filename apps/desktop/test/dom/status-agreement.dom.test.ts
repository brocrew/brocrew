import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'
import type { SessionStatus, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, permission, record, unmountAll, type Mounted } from './harness'

/**
 * **The four surfaces cannot disagree about whether the agent is busy** (099).
 *
 * One quiet Claude conversation can otherwise show conflicting states across four surfaces.
 * This file checks the visible agreement:
 *
 * | surface | said |
 * |---|---|
 * | the drawer plate (`SessionBot`, 090) | `working` |
 * | the top-bar pill | `Idle` |
 * | the rail row | `claude · idle` |
 * | the pill above the composer | `● WAITING` |
 *
 * Two of those read `sessionDoing`, two read `record.control.status` raw, and the two derivations
 * had drifted apart. Fixing the drift is one line; the reason it drifted THREE TIMES in one slice
 * (042, 089, 099) is that nothing in the suite could see two surfaces at once. Every renderer test
 * in this repo but these renders ONE component to a string.
 *
 * So this file mounts the real components in a real engine — 083's harness — puts them side by side,
 * and asserts a property over the whole state space rather than three examples. The property is
 * deliberately NOT "each surface equals `standingOf(...)`", which would be a change-detector that
 * passes by calling the code under test: it is the user-visible contradiction itself, written out
 * independently. **Busy-ness is one bit, and every surface has to carry the same bit.**
 *
 * ⚠️ **Every "they all agree" here is paired with proof that they said something** (the SSR-vacuity
 * rule, 29 found). A sweep asserting that no two surfaces disagree passes perfectly over a page
 * that renders nothing at all, and passes just as well if every cell of the sweep happens to be
 * idle. The sweep therefore counts what it saw and fails if either half of the bit is missing, and
 * `q()` throws on an element that is not there.
 */

afterEach(unmountAll)

/* ------------------------------------------------------------------ the bit */

/**
 * The words a text surface uses for a session that is NOT running. Written out rather than derived
 * from `STANDING_LABEL`, so a rename that quietly turned `Idle` into something a user would read as
 * busy has to be made here too, in a file whose whole subject is what those words mean.
 *
 * ⛔ **`background` and `Still running` are here, and that is 250's ruling rather than a set widened
 * to make a sweep pass.**
 *
 * This file's bit is *"is a TURN being driven"* — that is the question {@link plateSaysBusy} answers,
 * and the question all four surfaces answered identically until 250. `background` is the one standing
 * that says **no turn is being driven AND something this conversation started is still running**: two
 * facts, and the plate deliberately keeps the idle face for the first (250 — the avatar is about the
 * AGENT, and a process it detached is not the agent, which is 042's ruling restated). So on the turn
 * axis every surface still carries one bit, and putting the new word here is what keeps that true
 * instead of making the oracle fire on a state it was never written about.
 *
 * ⚠️ **The second fact then needs its own agreement check, or this file would be silently narrower
 * than it was.** *"the two WORD surfaces carry the second fact"* below is it: the two word surfaces
 * must BOTH say `background`, and the two plates must BOTH say `idle`, over a fold that really holds
 * running work — with the empty-level pairing beside it. Without that pair, adding two strings here
 * would be exactly the coverage loss it looks like.
 */
// ⛔ **`Scheduled` joins them for 250's reason, one facet along** (258): a job that will wake this
// conversation LATER is not a claim that anything is happening now, and the plate keeps the idle
// face for it exactly as it does for `background`. The agreement check for the second fact is the
// third value on the `outside` axis below.
// ⚑ **D-017b · `Ended`, `Error` and `Not started` are gone from both sets**: no standing says whether
// anything stopped or started (`05` rule 5), so a stopped conversation reads by the one state and
// its word is one of these or a busy one — never a fourth kind of quiet.
const QUIET_WORDS = new Set(['Idle', 'Unknown', 'Still running', 'Scheduled'])
const QUIET_STANDINGS = new Set(['idle', 'unknown', 'background', 'scheduled'])
/** The two DOINGs that are not a claim that something is happening right now. */
const QUIET_DOINGS = new Set(['idle', 'unknown'])

/**
 * What the PLATE claims, read off the attributes `AgentState` publishes.
 *
 * ⚑ **D-017b · the ending no longer comes first, because no plate draws one.** This oracle used to
 * answer *not busy* for an `ended`, `errored` or `unstarted` line before it read the badge (085: a
 * question cannot outlive the turn that asked it). ⛔ A stop ends nothing now and the plate draws no
 * line for it — its face is `idle` — so a stopped plate reads by its badge and its face like any
 * other, and the word surfaces read it by the one state.
 */
function plateSaysBusy(el: HTMLElement): boolean {
  const needing = el.dataset.needing
  // A permission or a question is an open demand: whatever the face is doing, the session is not
  // finished with you. `plan` is not here — a go-ahead blocks nothing and can be pressed whenever.
  // ⛔ **This oracle keeps its own copy** — see `agent-state.test.ts`' twin: reading the product's
  // predicate would make the agreement it measures trivially true. ⚑ `446` widened it by hand.
  if (needing === 'permission' || needing === 'question' || needing === 'proposal') return true
  return !QUIET_DOINGS.has(el.dataset.doing ?? 'unknown')
}

/** Every surface's bit, from one mounted pane and one mounted rail. */
interface Read {
  headerPlate: boolean
  headerWord: boolean
  railPlate: boolean
  railWord: boolean
  /** The pill is a claim that something is happening; its ABSENCE claims nothing either way. */
  pillPresent: boolean
  /** ⛔ The raw standing, so the sweep can PROVE it reached 250's new one (which is quiet here). */
  standing: string
  /** For the message on failure. */
  detail: string
}

function readSurfaces(pane: Mounted, rail: Mounted): Read {
  const headerPlate = pane.q('agent-state')
  const word = pane.q('session-status')
  const railPlate = rail.q('agent-state')
  const railWord = rail.host.querySelector<HTMLElement>('.rail-copy small[data-standing]')
  expect(railWord, 'the rail row has no word').not.toBeNull()
  const pill = pane.all('activity-pill')[0]
  return {
    headerPlate: plateSaysBusy(headerPlate),
    headerWord: !QUIET_WORDS.has((word.textContent ?? '').trim()),
    railPlate: plateSaysBusy(railPlate),
    railWord: !QUIET_STANDINGS.has(railWord!.dataset.standing ?? ''),
    pillPresent: pill !== undefined,
    standing: word.dataset.standing ?? '',
    detail:
      `plate[doing=${headerPlate.dataset.doing} being=${headerPlate.dataset.being} ` +
      `needing=${headerPlate.dataset.needing}] word="${(word.textContent ?? '').trim()}" ` +
      `rail=${railWord!.dataset.standing} pill=${pill?.dataset.doing ?? 'none'}`,
  }
}

/* ------------------------------------------------------------------ fixtures */

/**
 * A conversation in an arbitrary state.
 *
 * ⚠️ **The control projection is set DIRECTLY rather than driven by events, and the reason is
 * coverage.** Several cells of the sweep are states the fold reaches only by a specific ordering —
 * `status: idle` with a live `activity` is one, and it is the whole incident. A sweep that could
 * only build what a happy path builds would have missed 099 for the same reason the app did. The
 * fold's own behaviour is asserted in `transcript.test.ts`; what is asserted HERE is that no
 * combination of fields can put two answers on screen. The measured incident is then replayed
 * through the real fold, below, so the state space and the real sequence are both covered.
 *
 * ⚠️ **`status: null` is a CAST past the type, and it is the one cell that is not a real state.**
 * `TranscriptState.status` is non-nullable, starts at `'idle'` and is only ever written from a
 * zod-validated `SessionStatus`, so the fold cannot produce it — review said so and review is
 * right. It is swept anyway because `SessionFacetInput.status` IS nullable (the launcher passes
 * null) and `sessionDoing` therefore has a branch for it, which 099 §3 turned into the honest
 * `unknown`. What this cell proves is that the branch draws the faceless ring on all four surfaces
 * rather than a confident face — not that the app gets there today, and the comment says which.
 */
function scenario(over: {
  status: SessionStatus | null
  activity?: { phase: 'thinking' | 'tool' | 'waiting' | 'compacting'; detail?: string } | null
  streaming?: boolean
  ended?: boolean
  blocking?: boolean
  /**
   * ⛔ **250's fourth facet, as the fold really holds it** — a `background_work` level payload rather
   * than a written field, because `TranscriptState.background` is only ever written by that event.
   *
   * ⚠️ **Added because the sweep could not otherwise reach `background` at all**, which would have
   * left the two values 250 put into the quiet sets above exercised by nothing but one hand-built
   * test. Found by the adversarial pass over 250's diff. It multiplies the sweep by two and makes the
   * new standing meet every `blocking` / `streaming` / `ended` / phase combination, which is where a
   * precedence mistake would live.
   */
  running?: boolean
  /**
   * ⛔ **258's fifth facet, as the fold really holds it** — a `scheduled_work` level rather than a
   * written field, for the reason {@link running} is.
   */
  scheduled?: boolean
}): SessionRecord {
  const events: TranscriptEvent[] = over.blocking ? [permission('req_1')] : []
  if (over.running) {
    events.push({
      type: 'background_work',
      running: [{ id: 'b6uoyo82k', kind: 'local_bash', description: 'watching the Desktop' }],
      source: 'background_tasks_changed',
    } as TranscriptEvent)
  }
  if (over.scheduled) {
    events.push({
      type: 'scheduled_work',
      jobs: [
        { id: 'e3826cc5', schedule: '0 3 * * *', recurring: true, prompt: 'check the Desktop' },
      ],
      source: 'hook/Stop',
    } as TranscriptEvent)
  }
  const r = record(events)
  r.transcript.status = over.status as SessionStatus
  r.transcript.activity = over.activity ?? null
  r.transcript.streamingId = over.streaming ? 'stream_1' : null
  r.transcript.ended = over.ended ?? false
  // ⚑ **D-017b** — a fold that ended moves its record to `recorded` (`acceptEvent`).
  if (over.ended) r.phase = 'recorded'
  return r
}

async function surfacesFor(r: SessionRecord): Promise<Read> {
  const pane = mount(ConversationPane, paneProps({ record: r }))
  const rail = mount(SideRail, { open: [r], activeId: r.sessionId, place: null })
  await nextTick()
  const read = readSurfaces(pane, rail)
  pane.unmount()
  rail.unmount()
  return read
}

/* ------------------------------------------------------------------ the sweep */

const STATUSES: (SessionStatus | null)[] = [
  'idle',
  'working',
  'waiting_permission',
  'ended',
  'errored',
  null,
]
const PHASES = ['thinking', 'tool', 'waiting', 'compacting', undefined] as const

describe('the four surfaces answer once (099)', () => {
  it('⚠️ no two surfaces disagree about whether the agent is busy, over every state there is', async () => {
    let busy = 0
    let quiet = 0
    let pills = 0
    // ⛔ 250's standing is QUIET on this file's axis, so the two counters above cannot show that the
    // sweep ever reached it. This one can, and the assertion below makes the widening mean something.
    let background = 0
    // ⛔ …and 258's, for the identical reason: `scheduled` is QUIET on this axis too.
    let scheduled = 0

    for (const status of STATUSES) {
      for (const phase of PHASES) {
        for (const streaming of [true, false]) {
          for (const ended of [true, false]) {
            for (const blocking of [true, false])
              // ⚠️ **THREE values rather than a second two-way axis** (258). A fourth `for` would
              // double a sweep that already mounts 480 pairs inside a 120 s budget; the two
              // states that matter here are mutually exclusive on screen anyway, and their
              // PRECEDENCE against each other is settled in `idle-truth.test.ts` where it costs
              // nothing. What this axis buys is each of them meeting every
              // blocking/streaming/ended/phase combination, which is where a precedence mistake
              // against the OTHER facets would live.
              for (const outside of ['quiet', 'running', 'scheduled'] as const) {
                const where = `${status}/${phase}/streaming=${streaming}/ended=${ended}/blocking=${blocking}/outside=${outside}`
                const read = await surfacesFor(
                  scenario({
                    status,
                    activity: phase ? { phase, detail: 'Bash' } : null,
                    streaming,
                    ended,
                    blocking,
                    running: outside === 'running',
                    scheduled: outside === 'scheduled',
                  }),
                )
                const answers = [read.headerPlate, read.headerWord, read.railPlate, read.railWord]
                expect(new Set(answers).size, `${where} — ${read.detail}`).toBe(1)
                // The pill is the fifth surface and the one that started 089. It may be silent while
                // the others say busy — it states a PHASE and there is not always one — but it may
                // never speak over a session the other four call quiet.
                if (read.pillPresent) {
                  pills++
                  expect(
                    read.headerPlate,
                    `pill over a quiet session at ${where} — ${read.detail}`,
                  ).toBe(true)
                }
                if (read.standing === 'background') background++
                if (read.standing === 'scheduled') scheduled++
                if (answers[0]) busy++
                else quiet++
              }
          }
        }
      }
    }

    // ⚠️ **The non-vacuity pair.** Everything above is an assertion that two things are EQUAL, and
    // equality holds trivially over a page that rendered nothing, over a sweep that never found a
    // busy state, and over one that never found a quiet one. All three counts have to be real.
    expect(busy, 'the sweep never found a busy session').toBeGreaterThan(0)
    expect(quiet, 'the sweep never found a quiet session').toBeGreaterThan(0)
    expect(
      pills,
      'the activity pill never appeared, so the check above passed over nothing',
    ).toBeGreaterThan(0)
    // ⛔ **And the fourth count, which is 250's** — `background` is QUIET on this file's axis, so the
    // three counters above cannot show the sweep ever reached it, and the two words added to the
    // quiet sets would be exercised by nothing here. Found by the adversarial pass over 250's diff.
    expect(
      background,
      '250 · the sweep never reached `background`, so the words added to the quiet sets are ' +
        'exercised by nothing in it',
    ).toBeGreaterThan(0)
    // ⛔ **And the fifth**, which is 258's — the same widening, and the same reason it needs its own
    // counter: `scheduled` is quiet on this axis, so nothing above could show the sweep reached it.
    expect(
      scheduled,
      '258 · the sweep never reached `scheduled`, so the words added to the quiet sets are ' +
        'exercised by nothing in it',
    ).toBeGreaterThan(0)
    expect(busy + quiet).toBe(STATUSES.length * PHASES.length * 2 * 2 * 2 * 3)
  }, 120_000)

  it('distinguishes the background-work state from the adjacent idle state', async () => {
    // `turn completed` → `status idle` → a background sub-agent publishes `{phase:'waiting'}`
    // twelve seconds later, with no turn left to clear it. Measured from his own ledger,
    // sess_53d78fdf…, ordinals 781/782/794.
    const shot = await surfacesFor(scenario({ status: 'idle', activity: { phase: 'waiting' } }))
    expect(shot.headerPlate, shot.detail).toBe(false)
    expect(shot.headerWord, shot.detail).toBe(false)
    expect(shot.railPlate, shot.detail).toBe(false)
    expect(shot.railWord, shot.detail).toBe(false)
    // The `● WAITING` line goes with them: it was the same stale field wearing a word.
    expect(shot.pillPresent, shot.detail).toBe(false)

    // ⚠️ **The pairing, and it is what keeps the four `false`s above from being a dead page.** The
    // identical activity on a session the host DOES call busy still draws all of it.
    const live = await surfacesFor(scenario({ status: 'working', activity: { phase: 'waiting' } }))
    expect(live.headerPlate, live.detail).toBe(true)
    expect(live.headerWord, live.detail).toBe(true)
    expect(live.railPlate, live.detail).toBe(true)
    expect(live.railWord, live.detail).toBe(true)
    expect(live.pillPresent, live.detail).toBe(true)
  })

  it('⚠️ the ten seconds BEFORE it — a reply streaming after the host said idle', async () => {
    // The other direction, and 042's. Between 19:35:50 and 19:36:07 his model streamed a whole
    // message with the turn already closed, so `status` said `idle` while text was arriving. The
    // honest answer is that it is replying, and every surface has to say so — a top bar reading
    // `Idle` over visibly arriving text is the same defect with the roles swapped.
    const read = await surfacesFor(
      scenario({ status: 'idle', activity: { phase: 'waiting' }, streaming: true }),
    )
    expect(read.headerPlate, read.detail).toBe(true)
    expect(read.headerWord, read.detail).toBe(true)
    expect(read.railPlate, read.detail).toBe(true)
    expect(read.railWord, read.detail).toBe(true)
    // ⚠️ **The fifth surface, which this test omitted until review pointed it out.** Every other
    // scenario here states what the pill does; leaving it out of the one case where the pill is
    // drawn over a session the host calls idle left the most surprising cell in the file unasserted.
    // It speaks, and it says `replying` — not the stale `waiting` phase that is still in the field.
    expect(read.pillPresent, read.detail).toBe(true)
  })

  it('⚠️ replayed through the real fold, not constructed — the measured sequence end to end', async () => {
    // Apply every event touching the two fields in the measured order. Unlike constructed
    // cases alone, this exercises `applyEvent` between input and reading, catching a change
    // in how the fold clears state.
    const r = record([
      { type: 'user_turn', text: 'send the subagent a multi-step task' },
      { type: 'status', state: 'working' },
      { type: 'activity', phase: 'waiting' },
      { type: 'activity', phase: 'thinking' },
      { type: 'assistant_message', text: '[CLAUDE] Sent the subagent a multi-step task' },
      { type: 'turn', state: 'completed' },
      { type: 'status', state: 'idle' },
      // …and now the background sub-agent finishes, outside any turn.
      { type: 'sub_agent', agentId: 'ad63a0d89dcd9eed4', phase: 'ended', outcome: 'completed' },
      { type: 'activity', phase: 'waiting' },
    ] as TranscriptEvent[])
    // The field really is left set — this test would pass vacuously against a fold that had simply
    // dropped the event, and that is not the fix 099 made.
    expect(r.control.activity, 'the fold no longer keeps a late activity').toEqual({
      phase: 'waiting',
    })
    expect(r.control.status).toBe('idle')

    const read = await surfacesFor(r)
    expect([read.headerPlate, read.headerWord, read.railPlate, read.railWord], read.detail).toEqual(
      [false, false, false, false],
    )
    expect(read.pillPresent, read.detail).toBe(false)
  })

  it("⚠️ 089's two behaviours, re-asserted where they can be seen at once", async () => {
    // 1 — the tool's NAME dies with the phase. "REPLYING BASH" would move the lie one word right.
    const replying = mount(
      ConversationPane,
      paneProps({
        record: scenario({
          status: 'working',
          activity: { phase: 'tool', detail: 'Bash' },
          streaming: true,
        }),
      }),
    )
    await nextTick()
    const pill = replying.q('activity-pill')
    expect(pill.dataset.doing).toBe('replying')
    expect(pill.textContent).not.toContain('Bash')
    replying.unmount()

    // …and the pairing: the same activity with nothing streaming still names the call, so the
    // absence above is the streaming and not a component that stopped rendering details.
    const running = mount(
      ConversationPane,
      paneProps({
        record: scenario({ status: 'working', activity: { phase: 'tool', detail: 'Bash' } }),
      }),
    )
    await nextTick()
    expect(running.q('activity-pill').textContent).toContain('Bash')
    running.unmount()

    // 2 — a session that died mid-turn stops pulsing. `activity` survives (nothing cleared it) and
    // every surface still has to call it quiet (D-017b: its fold ended, so it is `recorded`).
    const dead = await surfacesFor(
      scenario({ status: 'working', activity: { phase: 'tool', detail: 'Bash' }, ended: true }),
    )
    expect([dead.headerPlate, dead.headerWord, dead.railPlate, dead.railWord], dead.detail).toEqual(
      [false, false, false, false],
    )
    expect(dead.pillPresent, dead.detail).toBe(false)
  })

  it('🔴 the two WORD surfaces carry the second fact, and the two plates carry the first (250)', async () => {
    // Mount both components at once and read the DOM: the background registry can be correct
    // while every state word still says `idle`.
    //
    // ⚠️ This is what stops `background` joining the quiet sets above from being a coverage loss.
    const r = record([
      { type: 'status', state: 'working' },
      { type: 'user_turn', text: 'watch my Desktop for person.txt' },
      { type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'node -e "…"' },
      {
        type: 'background_work',
        running: [
          {
            id: 'b6uoyo82k',
            kind: 'local_bash',
            toolCallId: 'toolu_1',
            description: 'waiting for person.txt to appear on Desktop',
          },
        ],
        source: 'background_tasks_changed',
      },
      { type: 'turn', state: 'completed' },
      { type: 'status', state: 'idle' },
    ] as TranscriptEvent[])
    // The fold really is holding the work — without this the four equalities below are a dead page.
    expect(r.control.background.running, 'the fold no longer holds the level').toHaveLength(1)
    expect(r.control.status).toBe('idle')

    const pane = mount(ConversationPane, paneProps({ record: r }))
    const rail = mount(SideRail, { open: [r], activeId: r.sessionId, place: null })
    await nextTick()
    const read = readSurfaces(pane, rail)

    // 1 · the TURN axis — still one bit, and it is `false`, because no turn is being driven.
    expect([read.headerPlate, read.headerWord, read.railPlate, read.railWord], read.detail).toEqual(
      [false, false, false, false],
    )
    // 2 · the RUNNING axis — both word surfaces say it, in their own register.
    expect(pane.q('session-status').dataset.standing).toBe('background')
    expect(pane.q('session-status').textContent?.trim()).toBe('Still running')
    const railWord = rail.host.querySelector<HTMLElement>('.rail-copy small[data-standing]')
    expect(railWord?.dataset.standing).toBe('background')
    // ⚑ **449 · the row gained WHERE it is working**, and the equality is kept end-to-end rather
    // than loosened to a `toContain`: what this file is for is two surfaces saying one thing, and a
    // substring match would stop noticing a third fact arriving on one of them.
    // ⚑ **F023 · the PM's phrase, with what it is running** — the row's own command, as the bar
    // names it.
    expect(railWord?.textContent?.trim()).toBe(
      'claude · running in the background · node -e "…" · checkout',
    )
    // 3 · …and both PLATES keep the idle face, which is 250's ruling and not an omission: the avatar
    //     is about the AGENT, and a process it detached is not the agent (042).
    expect(pane.q('agent-state').dataset.doing).toBe('idle')
    expect(rail.q('agent-state').dataset.doing).toBe('idle')
    // 4 · the pill above the composer says nothing, because there is no PHASE to state.
    expect(read.pillPresent, read.detail).toBe(false)
    pane.unmount()
    rail.unmount()
  })

  it('⚠️ …and the pairing: the same conversation with an EMPTY level says idle everywhere', async () => {
    // Without this, every equality above could be what the components say about any quiet session.
    const r = record([
      { type: 'status', state: 'working' },
      { type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'node -e "…"' },
      { type: 'background_work', running: [], source: 'background_tasks_changed' },
      { type: 'turn', state: 'completed' },
      { type: 'status', state: 'idle' },
    ] as TranscriptEvent[])
    const pane = mount(ConversationPane, paneProps({ record: r }))
    const rail = mount(SideRail, { open: [r], activeId: r.sessionId, place: null })
    await nextTick()
    expect(pane.q('session-status').dataset.standing).toBe('idle')
    expect(pane.q('session-status').textContent?.trim()).toBe('Idle')
    expect(
      rail.host.querySelector<HTMLElement>('.rail-copy small[data-standing]')?.dataset.standing,
    ).toBe('idle')
    pane.unmount()
    rail.unmount()
  })

  it('⚠️ where the app does not know, it says so rather than picking a side (099 §3)', async () => {
    // No word from the host at all. 081's ruling is that this draws the faceless dashed ring and
    // never a face — an honest `unknown` beats a confident `working`.
    const pane = mount(
      ConversationPane,
      paneProps({ record: scenario({ status: null, activity: { phase: 'thinking' } }) }),
    )
    await nextTick()
    expect(pane.q('agent-state').dataset.doing).toBe('unknown')
    // The ring is the drawn form of it, and it is what makes this more than an attribute check.
    expect(pane.all('agent-unknown').length).toBeGreaterThan(0)
    expect(pane.q('session-status').textContent?.trim()).toBe('Unknown')
    // Paired: the same activity WITH a host word draws a face and names it.
    pane.unmount()
    const known = mount(
      ConversationPane,
      paneProps({ record: scenario({ status: 'working', activity: { phase: 'thinking' } }) }),
    )
    await nextTick()
    expect(known.q('agent-state').dataset.doing).toBe('thinking')
    expect(known.all('agent-unknown').length).toBe(0)
    known.unmount()
  })
})
