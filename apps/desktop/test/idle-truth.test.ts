import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import {
  plateWord,
  recordFacets,
  standingOf,
  standingWord,
  STANDING_LABEL,
  STANDING_TONE,
} from '../src/renderer/src/lib/agent-state'
// ⚑ D-017 · R11 — the one predicate and the one word are `shared/agent-state.ts`'s, so `main` asks
// and says them as the window does. ⚑ **D-029 · `scheduleHeld` is the ONE schedule predicate now**:
// the window's narrower `somethingScheduled` and its `SCHEDULE_ASLEEP` sentence went with 258 §2's
// asleep ruling, since this app starts a stopped conversation in time for its jobs.
import { SCHEDULED, scheduleHeld, somethingRunning } from '../src/shared/agent-state'
import { scheduleHead } from '../src/renderer/src/lib/scheduled-work'
import { panelEmptyWords, sessionPanel } from '../src/renderer/src/lib/session-panel'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  markReadOnly,
  markReopened,
} from '../src/renderer/src/lib/transcript'
import type { CreatedSession, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 250 · ⛔ **"Idle" is not true — and the three surfaces have to agree about it**
 *
 * A correct background registry with a running `local_bash` row and Stop control must not
 * coexist with `idle` words in the header, rail, and drawer. The state must reflect detached
 * work even after the turn ends.
 *
 * ⚑ **The drawer's words are quoted as HISTORY** — `577` replaced that heading with one that says
 * what the column counted (`EXT-010` §3.1), and the equalities below are on the new one. The
 * sighting is unchanged; the string it names no longer exists.
 *
 * ⚠️ **This file is the parity instrument, in `219` §3's shape and for `099`'s reason.** The three
 * surfaces are three PROJECTIONS of one derivation, so what is asserted here is not "each says the
 * right thing" three times — it is that there is no fold over which they can differ. `099` is the
 * dispatch about the rail saying `idle` while the pane said `working` six inches away, and the fix
 * was one function with two callers; this is the same fix arriving for a fourth fact.
 *
 * ⛔ **The word `idle` is never asserted as ABSENT here.** `248`'s live step went green over a defect
 * because its claim excluded only `done` and `finished` and the new wrong word walked through the
 * gap. Every assertion below is an equality on what the surface SAYS.
 */

/** The level payload, as `247` measured it and `normalize.ts` emits it. */
function level(
  running: { id: string; kind?: string; toolCallId?: string; description?: string }[],
  dropped?: number,
): RuntimeEvent {
  return {
    type: 'background_work',
    running,
    ...(dropped === undefined ? {} : { dropped }),
    source: 'background_tasks_changed',
  } as RuntimeEvent
}

/** A measured `local_bash` background-work row. */
const BACKGROUND_ROW = {
  id: 'b6uoyo82k',
  kind: 'local_bash',
  toolCallId: 'toolu_1',
  description: 'waiting for person.txt to appear on Desktop',
}

/**
 * A conversation as the store holds one: the host's word about the provider, and a folded control
 * projection.
 *
 * ⚠️ **`liveness: 'live'` matters.** It is what `sessionBeing` reads, and a record without it has no
 * BEING at all — which would make every standing below reachable by a route the real app never
 * takes.
 */
function liveSession(...events: [TranscriptEvent, number?][]): SessionRecord {
  const record = createSessionRecord('sess_person')
  record.meta = {
    sessionId: 'sess_person',
    provider: 'claude',
    cwd: '/Users/alex/work/brobot',
    profileId: 'default',
    liveness: { state: 'live' },
  } as CreatedSession
  record.phase = 'open'
  for (const [event, at] of events) applyEvent(record.control, event, at)
  return record
}

/**
 * ⛔ **What every surface says about this conversation, read the way each one reads it.**
 *
 * Each line is the committed call the component makes, not a restatement of it — `SessionHeader`
 * renders `STANDING_LABEL[standingOf(facets)]`, `SideRail` renders `{{provider}} · {{word}}` from
 * `standingWord`, `SessionPanel` renders `panelEmptyWords`. If a component stops calling one of
 * these, its own render test fails; if one of these stops agreeing, this file does.
 */
function surfaces(record: SessionRecord): {
  standing: string
  pill: string
  pillTone: string
  railWord: string
  panelHead: string
  panelBody: string
  registryRows: number
  /**
   * 🔴 **The DRAWER's bot — the fifth word surface, and the one that went stale twice** (258).
   *
   * `250` found it in review and fixed it with a one-off check in `SessionBot.vue`; `258`'s fifth
   * facet walked straight through that check and the bot went back to printing `idle` above its own
   * paragraph. The rule moved to `plateWord`, and this line is what watches it.
   */
  botWord: string
  /** 258: the schedule bar's own two readings — its heading, and how many rows it draws. */
  scheduleRows: number
  scheduleHeading: string
} {
  const facets = recordFacets(record)
  const panel = sessionPanel(record.control)
  const words = panelEmptyWords(panel)
  return {
    standing: standingOf(facets),
    pill: STANDING_LABEL[standingOf(facets)],
    pillTone: STANDING_TONE[standingOf(facets)],
    railWord: `${record.meta?.provider} · ${standingWord(facets)}`,
    panelHead: words.head,
    panelBody: words.body,
    registryRows: record.control.background.running.length,
    botWord: plateWord(facets),
    scheduleRows: record.control.schedule.jobs.length,
    scheduleHeading: scheduleHead(record.control.schedule),
  }
}

/** The turn that ends while the work does not — the exact boundary `245` measured 24.562 s of. */
const TURN_OVER: [TranscriptEvent, number?][] = [
  [{ type: 'status', state: 'working' }, 1_000],
  [{ type: 'user_turn', text: 'watch my Desktop for person.txt' }, 1_001],
  [{ type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'node -e "…"' }, 2_000],
  [level([BACKGROUND_ROW]), 6_065],
  [
    {
      type: 'tool_result',
      id: 'toolu_1',
      summary: 'Command running in background with ID: b6uoyo82k.',
      ok: true,
      backgrounded: true,
      backgroundId: 'b6uoyo82k',
    },
    6_073,
  ],
  [{ type: 'turn', state: 'completed' }, 9_507],
  [{ type: 'status', state: 'idle' }, 9_508],
]

describe('250 §2 · the state the person watched, and every surface that describes it', () => {
  it('🔴 turn over, work still running — no surface says the conversation is idle', () => {
    const said = surfaces(liveSession(...TURN_OVER))

    // ⛔ Equalities, never `not.toBe('idle')` — see the file header.
    expect(said.standing).toBe('background')
    expect(said.pill).toBe('Still running')
    expect(said.railWord).toBe('claude · running in the background')
    // ⛔ The HEADING is constant in all five forms (see `PANEL_EMPTY_WORDS`) — the BODY is what
    // this dispatch changed, and it is what a test must discriminate on.
    // ⚑ **577 re-worded it and did not un-share it**: the heading names what the column COUNTED,
    // and detached work was never in that count (`229`). The literal is typed out here on `169`
    // §2's rule — this file holds the surface to the exact words a person reads; the DERIVED
    // comparison against what the fold counts lives in `the-heading-and-what-it-counts.test.ts`.
    expect(said.panelHead).toBe('No permissions or questions are on a card here')
    expect(said.panelBody).toContain('still running')
    // …and the tone the pill wears, which is what stops it reading like the blank `idle` one.
    expect(said.pillTone).toBe('live')
    // ⚑ **The pairing that makes all of the above mean something**: `248`'s registry — the surface
    // that was already RIGHT — is holding exactly the row the words are now describing.
    expect(said.registryRows).toBe(1)
    expect(said.panelBody).toContain('above the composer')
    // ⛔ **And the fifth surface**, which `250` found in review and fixed in the component. Asserted
    // here since `258` moved the rule to `plateWord` — the two must not drift apart again.
    // ⚑ F023 · the plate says the rail's word (its stem here — see `expectedWords`).
    expect(said.botWord).toBe('running in the background')
  })

  it('⛔ …and the same fold with an EMPTY level reads idle, so the words are about the work', () => {
    const quiet = surfaces(liveSession(...TURN_OVER, [level([]), 36_157]))
    // The control for the test above. Without it every equality there could be a constant.
    expect(quiet.standing).toBe('idle')
    expect(quiet.pill).toBe('Idle')
    expect(quiet.railWord).toBe('claude · idle')
    expect(quiet.panelBody).toContain('Running sub-agents, workflows and the checklist')
    expect(quiet.registryRows).toBe(0)
  })

  it('⛔ the turn ENDING is what used to silence them, and now changes nothing', () => {
    // `248`'s own near-miss, one surface over: `stopOpenToolCalls` runs at every turn end, and
    // sweeping detached work there would have emptied the registry at the exact instant `245`'s
    // window opens. The words now depend on that registry, so the regression would land here too.
    const beforeTurn = surfaces(liveSession(...TURN_OVER.slice(0, 5)))
    const afterTurn = surfaces(liveSession(...TURN_OVER))
    expect(beforeTurn.registryRows).toBe(1)
    expect(afterTurn.registryRows).toBe(1)
    // The DOING legitimately changes — the host stopped driving a turn — and the word does not.
    expect(beforeTurn.standing).toBe('working')
    expect(afterTurn.standing).toBe('background')
    expect(afterTurn.pill).toBe('Still running')
  })

  it('⛔ when the provider says the work ended, all three go quiet TOGETHER', () => {
    const done = surfaces(
      liveSession(
        ...TURN_OVER,
        [
          {
            type: 'background_work',
            ended: { id: 'b6uoyo82k', toolCallId: 'toolu_1', outcome: 'completed' },
            source: 'task_notification',
          } as TranscriptEvent,
          36_157,
        ],
        // ⚠️ The LEVEL is what clears the registry — the ending above is an edge and deliberately
        // does not (`247`: *replace your set, never pair edges*). Both arrive; only one clears.
        [level([]), 36_157],
      ),
    )
    expect(done.standing).toBe('idle')
    expect(done.pill).toBe('Idle')
    expect(done.railWord).toBe('claude · idle')
    expect(done.panelBody).toContain('Running sub-agents, workflows and the checklist')
  })

  it('🔴 an ENDING alone does not clear it — the level does, and the words follow the level', () => {
    // The pairing for the test above, and a real ordering: `background_work.ended` can arrive with
    // no level beside it. A word derived from the ENDING would go quiet here while work the provider
    // has not retracted is still in the set.
    const stillListed = surfaces(
      liveSession(...TURN_OVER, [
        {
          type: 'background_work',
          ended: { id: 'b6uoyo82k', toolCallId: 'toolu_1', outcome: 'completed' },
          source: 'task_notification',
        } as TranscriptEvent,
        36_157,
      ]),
    )
    expect(stillListed.registryRows).toBe(1)
    expect(stillListed.standing).toBe('background')
  })
})

describe('250 §2 · what the new word may NOT take precedence over', () => {
  it('⛔ a permission still wins — it freezes the composer and this does not (229)', () => {
    const blocked = surfaces(
      liveSession(...TURN_OVER, [
        {
          type: 'permission_request',
          id: 'req_1',
          kind: 'command',
          action: 'Bash',
          detail: 'rm -rf /tmp/build',
          scope: {
            paths: [],
            networkHosts: [],
            persistence: 'once',
            amendments: [],
            availableDecisions: ['allow', 'deny'],
            underDisclosed: false,
          },
        } as unknown as TranscriptEvent,
        10_000,
      ]),
    )
    expect(blocked.standing).toBe('waiting')
    expect(blocked.railWord).toBe('claude · needs you: permission')
    // …and the registry is still holding the work, so this is a precedence result and not an absence.
    expect(blocked.registryRows).toBe(1)
  })

  it('⛔ a session that has ENDED cannot be holding running work — the invariant, not a branch', () => {
    // `sessionFacets` adds NO guard for detached work in a stopped session, on the grounds that
    // `markTerminal` empties the registry. That is an invariant of the FOLD, and this is where it is
    // pinned — if it ever stops holding, the guard has to come back.
    //
    // ⚑ **D-017b · and it now carries the whole weight.** `standingOf` used to answer `ended` above
    // `background` as well, so a registry left full was hidden twice over. That terminal word said
    // whether a process runs (`05` rule 5) and went: a stopped conversation reads by the one state
    // like any other, so a row left in the registry would read `Still running` — and this sweep is
    // the only thing that makes it read `Idle`.
    const over = liveSession(...TURN_OVER, [
      {
        type: 'session',
        state: 'ended',
        ref: {
          provider: 'claude',
          sessionId: 'sess_person',
          cwd: '/Users/alex/work/brobot',
          rotation: 0,
        },
      },
      12_000,
    ])
    expect(over.control.background.running).toEqual([])
    expect(somethingRunning(over.control.background)).toBe(false)
    const said = surfaces(over)
    expect(said.standing).toBe('idle')
    expect(said.pill).toBe('Idle')
  })

  it('🔴 the RAIL reads the control projection, so a reader scrolled into history still sees it', () => {
    // ⛔ **064's whole subject, arriving for a fourth fact.** The rail describes conversations that
    // are mostly not the one on screen, and a reader who pages back far enough forks the two folds:
    // `transcript` becomes a view of HISTORY and `control` goes on folding the live tail. A
    // `recordFacets` that read `transcript.background` would go quiet about the running work of
    // every conversation the reader is not looking at — which is the state 061 finding 5 lists.
    const record = liveSession(...TURN_OVER)
    const live = record.control
    // The fork, as `prependOlder` makes it: the reading projection becomes an older fold with no
    // level payload in it, and the control projection is left holding the present.
    record.transcript = createTranscript()
    expect(record.transcript.background.running).toEqual([])
    expect(live.background.running).toHaveLength(1)

    const said = surfaces(record)
    expect(said.standing).toBe('background')
    expect(said.railWord).toBe('claude · running in the background')
  })

  it('⛔ …and so does `unknown`, because a refusal to claim outranks a smaller fact', () => {
    // `unknown` means the host has said nothing about this session at all. *"We do not know what
    // this is doing"* is a larger caveat than *"and something is running"*, and 081's faceless ring
    // is a refusal to claim — one that a smaller fact could talk over would not be one.
    expect(standingOf({ doing: 'unknown', being: 'live', detached: true })).toBe('unknown')
    // The pairing: the same facets with a DOING the host did give us take the new word.
    expect(standingOf({ doing: 'idle', being: 'live', detached: true })).toBe('background')
  })

  it('a turn that is genuinely WORKING keeps its own word, background work or not', () => {
    const busy = surfaces(liveSession(...TURN_OVER.slice(0, 5)))
    expect(busy.standing).toBe('working')
    // ⚑ **UI-004** — a running turn's pill is the one state's *Active*.
    expect(busy.pill).toBe('Active')
    // The pairing: it really is holding the work, so `working` here is a precedence decision rather
    // than a fold that never saw a level payload.
    expect(busy.registryRows).toBe(1)
  })
})

describe('250 §2 · one derivation, three projections — they cannot disagree', () => {
  /**
   * ⛔ **Every ordering of the four facts that decide this word, swept.**
   *
   * `219` §3's parity shape: the claim is not that three surfaces are each right, it is that no
   * sequence of events exists over which they differ. The sweep is over the ORDER as well as the
   * content, because `247`'s own doc is explicit that the level and the bookends arrive in an
   * unspecified order and the app must not depend on one.
   */
  const PIECES: [string, [TranscriptEvent, number?]][] = [
    ['level', [level([BACKGROUND_ROW]), 6_065]],
    ['turn', [{ type: 'turn', state: 'completed' }, 9_507]],
    ['idle', [{ type: 'status', state: 'idle' }, 9_508]],
    [
      'receipt',
      [
        {
          type: 'tool_result',
          id: 'toolu_1',
          summary: 'Command running in background with ID: b6uoyo82k.',
          ok: true,
          backgrounded: true,
          backgroundId: 'b6uoyo82k',
        } as TranscriptEvent,
        6_073,
      ],
    ],
  ]

  /**
   * ⛔ **What the four surfaces SHOULD say, derived from the fold's own fields rather than from the
   * functions under test.**
   *
   * ⚠️ Nothing here calls `standingOf`, `standingWord`, `STANDING_LABEL` or `panelEmptyWords`. It is
   * the rule restated in a second voice — 099's `status-agreement.dom.test.ts` calls this *"the
   * user-visible contradiction itself, written out independently"*, and it is what makes the
   * equalities above capable of failing.
   */
  function expectedWords(record: SessionRecord): {
    standing: string
    pill: string
    railWord: string
    panelHead: string
    panelBody: string
  } {
    const state = record.control
    const running = state.background.running.length > 0 || state.background.dropped > 0
    const blocked = state.pending.permissions > 0 || state.pending.questions > 0
    const busy = state.status === 'working' || state.status === 'waiting_permission'
    const standing = state.ended
      ? 'ended'
      : blocked
        ? 'waiting'
        : busy || state.streamingId !== null
          ? 'working'
          : running
            ? 'background'
            : 'idle'
    const pill = {
      ended: 'Ended',
      waiting: 'Waiting on you',
      working: 'Active',
      background: 'Still running',
      idle: 'Idle',
    }[standing] as string
    // ⚑ **F023 · the PM's phrase.** This file pins the word's STEM — `surfaces()` asks
    // `standingWord` without the details the rail appends (the command, the wake-up time), which
    // `status-agreement.dom.test.ts` pins on the real row.
    // ⚑ **UI-004** — and a running turn's word is the one state's *active*.
    const word =
      standing === 'background'
        ? 'running in the background'
        : standing === 'working'
          ? 'active'
          : standing
    return {
      standing,
      pill,
      railWord: `claude · ${word}`,
      panelHead: 'No permissions or questions are on a card here',
      panelBody: running
        ? 'Work this conversation started is still running — it is listed above the composer.'
        : 'Running sub-agents, workflows and the checklist appear here too, while they are open.',
    }
  }

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items]
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
        item,
        ...rest,
      ]),
    )
  }

  it('🔴 over every ordering, the pill, the rail row and the panel answer the same question', () => {
    const orders = permutations(PIECES)
    expect(orders).toHaveLength(24)
    let sawRunning = 0
    let sawQuiet = 0
    for (const order of orders)
      // ⛔ **Each ordering is run TWICE — with the provider's level and with an empty one.** The
      // first draft swept only the running case, so `sawQuiet` was structurally unreachable and the
      // sweep could only ever have confirmed itself. `193`'s vacuity, caught by its own pairing.
      for (const running_ of [true, false]) {
        const names = `${order.map(([name]) => name).join('→')}/${running_ ? 'level' : 'empty'}`
        const record = liveSession(
          [{ type: 'status', state: 'working' }, 1_000],
          [{ type: 'user_turn', text: 'watch my Desktop' }, 1_001],
          [{ type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'node -e "…"' }, 2_000],
          ...order.map(([name, event]) =>
            name === 'level' && !running_
              ? ([level([]), 6_065] as [TranscriptEvent, number?])
              : event,
          ),
        )
        const said = surfaces(record)
        const running = somethingRunning(record.control.background)
        // ⛔ **The oracle is written out INDEPENDENTLY, and the first draft of these three lines was
        // not.** It compared `said.pill` against `STANDING_LABEL[said.standing]` — but `said` is
        // built by this file's own `surfaces()` from one `recordFacets` call, so both sides reduced
        // to `STANDING_LABEL[standingOf(f)] === STANDING_LABEL[standingOf(f)]`: `x === x`, for all
        // 48 cells, unfalsifiable by any fold or any code change. Found by the adversarial pass over
        // 250's own diff. `status-agreement.dom.test.ts`'s header states the rule this now follows:
        // the property must be *the user-visible contradiction itself, written out independently*.
        const expected = expectedWords(record)
        expect(said.standing, names).toBe(expected.standing)
        expect(said.pill, names).toBe(expected.pill)
        expect(said.railWord, names).toBe(expected.railWord)
        expect(said.panelHead, names).toBe(expected.panelHead)
        expect(said.panelBody, names).toBe(expected.panelBody)
        // …and the panel's sentence tracks the registry rather than the standing, which is the one
        // place the two surfaces are allowed to be computed from different things.
        expect(said.panelBody.includes('still running'), names).toBe(running)
        // The one thing every ordering must agree on: the word says `background` exactly when work is
        // in the set AND the host has stopped driving a turn.
        const idleHost = record.control.status === 'idle' || record.control.status === null
        if (running && idleHost) {
          expect(said.standing, names).toBe('background')
          sawRunning += 1
        } else {
          expect(said.standing, names).not.toBe('background')
          sawQuiet += 1
        }
      }
    // ⚠️ **The pairing.** A sweep in which no ordering ever reached the running state would satisfy
    // every line above vacuously — `193`'s rule, and the reason both counters exist.
    expect(sawRunning, 'no ordering ever produced the state under test').toBeGreaterThan(0)
    expect(sawQuiet, 'no ordering ever produced the ordinary state').toBeGreaterThan(0)
  })
})

describe('250 · the predicate every surface asks (223)', () => {
  it('a level with rows is running; an empty one is not', () => {
    expect(somethingRunning({ running: [BACKGROUND_ROW], dropped: 0 })).toBe(true)
    expect(somethingRunning({ running: [], dropped: 0 })).toBe(false)
  })

  it('🔴 a level that UNDERSTATES itself is still running, even with no row to name', () => {
    // `normalize.ts` counts an entry the provider sent with no `task_id` — it cannot be listed and
    // cannot be stopped — so `running` is empty while something is running. A predicate that read
    // `running.length` alone would answer "idle" on the one payload the provider told us was short.
    expect(somethingRunning({ running: [], dropped: 1 })).toBe(true)
    // The whole of `TURN_OVER` except its level, which is replaced by one that names nothing.
    const record = liveSession(
      ...TURN_OVER.map((step): [TranscriptEvent, number?] =>
        step === TURN_OVER[3] ? [level([], 1), 6_065] : step,
      ),
    )
    expect(surfaces(record).standing).toBe('background')
    // ⚠️ **And the registry has no row to draw**, which is why `BackgroundBar` shows nothing here —
    // reported in 250's response rather than widened, because its heading counts `running.length`
    // and a bar drawn for this level would open with "0 things are still running". The word and the
    // absent bar do not contradict each other; an absent bar is not a claim.
    expect(record.control.background.running).toEqual([])
    expect(record.control.background.dropped).toBe(1)
    // ⛔ …and the panel does NOT send the reader to a bar that will not render.
    const panel = sessionPanel(record.control)
    expect(panel.stillRunning).toBe(true)
    expect(panel.runningNamed).toBe(false)
    expect(panelEmptyWords(panel).body).toContain('cannot say what it is')
  })

  // ⚠️ **FOUR of five, and the fifth is elsewhere on purpose**: `508`'s `gaveWork` arm needs the
  // second parameter, and `the-work-this-conversation-gave-out.test.ts` is where that one is held.
  it('the panel’s four sentences each name their own state, and none names a list that is absent', () => {
    const quiet = { stillRunning: false, runningNamed: false, scheduled: false }
    const named = { stillRunning: true, runningNamed: true, scheduled: false }
    // ⛔ The level said something is running and named nothing — `BackgroundBar`'s `v-if` is
    // `running.length > 0`, so there is no list above the composer to send anyone to.
    const unnamed = { stillRunning: true, runningNamed: false, scheduled: false }
    // 258: nothing is running and something will wake it later. Its own sentence since this dispatch.
    const later = { stillRunning: false, runningNamed: false, scheduled: true }

    // ⛔ ONE heading in all four, still: *"Nothing is waiting on you"* collided with
    // `NEEDING_WORD.plan` and it is also Home's own heading over a different count.
    // 🔴 **577 changed the WORDS and kept the sharing.** The arms differ in what else is going on —
    // detached work, a schedule, work handed out — never in what is OPEN, which is all the heading
    // claims. ⚑ Typed out rather than imported on purpose: `169` §2 wants the exact words a person
    // reads pinned here, and an equality against `NOTHING_OPEN_HEAD` would be the constant agreeing
    // with itself. The derived comparison is `the-heading-and-what-it-counts.test.ts`.
    expect(panelEmptyWords(quiet).head).toBe('No permissions or questions are on a card here')
    expect(panelEmptyWords(named).head).toBe('No permissions or questions are on a card here')
    expect(panelEmptyWords(unnamed).head).toBe('No permissions or questions are on a card here')
    expect(panelEmptyWords(later).head).toBe('No permissions or questions are on a card here')
    // …so the BODY is what has to tell the four apart, and it does.
    expect(new Set([quiet, named, unnamed, later].map((p) => panelEmptyWords(p).body)).size).toBe(4)
    // ⛔ **Running outranks scheduled**, and a conversation that is both gets the running sentence —
    // the one with a Stop button behind it. The schedule is still on screen in its own bar.
    expect(panelEmptyWords({ ...named, scheduled: true }).body).toBe(panelEmptyWords(named).body)
    // `239`: the sentence that raises the alarm also says where to look — WHEN there is somewhere.
    expect(panelEmptyWords(named).body).toContain('above the composer')
    expect(panelEmptyWords(unnamed).body).not.toContain('above the composer')
    // …and the paired positive, so the negative above is not passing over an empty string.
    expect(panelEmptyWords(unnamed).body).toContain('cannot say what it is')
    // ⚑ **577 · the quiet body names what the HEADING does not** — the bands that are happening
    // rather than blocked on you. Three nouns moved up into the heading and `workflows` joined.
    expect(panelEmptyWords(quiet).body).toContain('Running sub-agents, workflows and the checklist')
    // 258: the scheduled sentence DOES point, because `ScheduleBar`'s condition counts `dropped` and
    // its heading counts every row the provider sent — so there is always a bar to look at.
    expect(panelEmptyWords(later).body).toContain('above the composer')
    expect(panelEmptyWords(later).body).toContain('has work scheduled')
  })

  it('⛔ background work is counted as HAPPENING and never as WAITING (229/108)', () => {
    const panel = sessionPanel(liveSession(...TURN_OVER).control)
    expect(panel.stillRunning).toBe(true)
    // The queue that freezes the composer, badges the drawer and raises 205's bar must not move.
    expect(panel.waiting).toBe(0)
    // …and it adds no ROW here: the bar above the composer is the one place it is listed, and the
    // only place it can be stopped (035).
    expect(panel.agents).toEqual([])
    expect(panel.workflows).toEqual([])
    // `empty` still gates the paragraph — folding this in would delete the sentence in the one
    // state that most needs one, which is 067's blank column arriving by a new route.
    expect(panel.empty).toBe(true)
  })
})

/**
 * # 🔴 258 · **The other half of the same complaint, which `250` did not fix**
 *
 * `SessionFacetInput.detached`, fed by `somethingRunning`, covers only the background
 * registry. Scheduled work also needs a path in `transcript.ts`: `case 'scheduled_work':
 * return` would discard the event and leave a conversation with a recurring job labeled idle.
 * Assert that independent facet.
 *
 * ⚠️ **Same instrument, same rule**: every assertion is an equality on what a surface SAYS, never a
 * `not.toBe('idle')`. `248`'s live step went green over a defect because its claim excluded only
 * `done` and `finished`.
 */

/** The level as `claude/session-crons.ts` publishes it, off the `Stop` hook. */
function crons(
  jobs: { id: string; schedule?: string; recurring?: boolean; prompt?: string }[],
  dropped?: number,
): RuntimeEvent {
  return {
    type: 'scheduled_work',
    jobs,
    ...(dropped === undefined ? {} : { dropped }),
    source: 'hook/Stop',
  } as RuntimeEvent
}

/**
 * Use a recurring stepped cron expression and the model’s prompt. Keep the expression as data
 * rather than prose: `scheduled-work.ts` explains that the two characters spelling a cron
 * step can also terminate a block comment.
 */
const SCHEDULED_TASK = {
  id: 'e3826cc5',
  schedule: '*/2 * * * *',
  recurring: true,
  prompt: 'check whether person.txt has appeared on the Desktop',
}

/** A turn that ends having scheduled something and left NOTHING running. */
const TURN_SCHEDULED: [TranscriptEvent, number?][] = [
  [{ type: 'status', state: 'working' }, 1_000],
  [{ type: 'user_turn', text: 'check my Desktop every 2 minutes' }, 1_001],
  [{ type: 'tool_call', id: 'toolu_c', name: 'CronCreate', summary: 'every 2 minutes' }, 2_000],
  [{ type: 'tool_result', id: 'toolu_c', summary: 'Created job e3826cc5', ok: true }, 2_400],
  [{ type: 'turn', state: 'completed' }, 9_507],
  [{ type: 'status', state: 'idle' }, 9_508],
  // ⚑ The `Stop` hook fires AFTER the turn — that is the only channel this fact has, and it is why
  // a session that has never ended a turn has never been told anything.
  [crons([SCHEDULED_TASK]), 9_600],
]

describe('258 §3 · the schedule the person could not see, and every surface that describes it', () => {
  it('🔴 turn over, nothing running, a job scheduled — no surface says the conversation is idle', () => {
    const said = surfaces(liveSession(...TURN_SCHEDULED))

    expect(said.standing).toBe('scheduled')
    expect(said.pill).toBe('Scheduled')
    expect(said.railWord).toBe(`claude · ${SCHEDULED}`)
    expect(said.panelHead).toBe('No permissions or questions are on a card here')
    expect(said.panelBody).toContain('has work scheduled')
    expect(said.panelBody).toContain('above the composer')
    // ⛔ **Blank, and deliberately** — nothing is in progress, so the pill does not wear `live`. See
    // `STANDING_TONE`. The WORD is the fix; a hue that claimed a running machine would be a new one.
    expect(said.pillTone).toBe('')
    // 🔴 **And the DRAWER's bot, which is the surface that went stale a SECOND time.** `250` found
    // it in review and fixed it with `standingOf(facets) === 'background'` written into
    // `SessionBot.vue`; this dispatch's fifth facet walked straight through that check and the bot
    // printed `idle` a few lines above its own paragraph saying a job will wake the conversation
    // later. Found by the adversarial pass over THIS diff; the rule now lives in `plateWord`.
    expect(said.botWord).toBe(SCHEDULED)
    // ⚑ **The pairing that makes the words mean something**: the bar the paragraph points at really
    // is holding the job, and its heading is the sentence a person reads there.
    expect(said.scheduleRows).toBe(1)
    expect(said.scheduleHeading).toBe('1 job is scheduled')
    // …and the OTHER registry is empty, so none of the above came in through `250`'s door.
    expect(said.registryRows).toBe(0)
  })

  it('⛔ …and the same fold with an EMPTY level reads idle, so the words are about the schedule', () => {
    const quiet = surfaces(liveSession(...TURN_SCHEDULED, [crons([]), 130_000]))
    // The control for the test above. Without it every equality there could be a constant.
    expect(quiet.standing).toBe('idle')
    expect(quiet.pill).toBe('Idle')
    expect(quiet.railWord).toBe('claude · idle')
    expect(quiet.panelBody).toContain('Running sub-agents, workflows and the checklist')
    expect(quiet.scheduleRows).toBe(0)
    // …and the bot goes back to the plain DOING word, which is what keeps `plateWord` scoped.
    expect(quiet.botWord).toBe('idle')
  })

  it('🔴 `undefined` is not `[]` — a frame that did not state the level changes nothing', () => {
    // ⛔ **§1's most important rule, and the one `222` paid for.** A `scheduled_work` event carrying
    // no `jobs` is *"this frame did not state it"*; conflating it with `[]` erases a job that is
    // still going to fire, on a level whose only channel is one hook.
    const silent = surfaces(
      liveSession(...TURN_SCHEDULED, [
        { type: 'scheduled_work', source: 'hook/Stop' } as RuntimeEvent,
        130_000,
      ]),
    )
    expect(silent.scheduleRows).toBe(1)
    expect(silent.standing).toBe('scheduled')
    // …and the paired positive from the same shape: `[]` from the same source DOES clear it.
    const stated = surfaces(liveSession(...TURN_SCHEDULED, [crons([]), 130_000]))
    expect(stated.scheduleRows).toBe(0)
    expect(stated.standing).toBe('idle')
  })

  it('🔴 a level that UNDERSTATES itself is still scheduled, even with no row to name', () => {
    // The producer drops a job the provider sent with no id and counts it instead, because an id is
    // the only thing that makes two payloads comparable. `jobs` is then empty while something is
    // genuinely scheduled — the one payload the provider had already told us was short.
    // ⚑ D-029 — asked of `scheduleHeld`, the predicate every surface asks now (see the imports).
    expect(scheduleHeld({ jobs: [], dropped: 1 })).toBe(true)
    const said = surfaces(liveSession(...TURN_SCHEDULED, [crons([], 1), 130_000]))
    expect(said.standing).toBe('scheduled')
    expect(said.scheduleRows).toBe(0)
    // ⛔ **And unlike `248`'s bar, this one still DRAWS** — its heading counts every row the provider
    // sent rather than the rows it can list, so it never opens with "0". That is the defect `250`
    // had to route around in `PANEL_EMPTY_WORDS.unnamed`, not inherited here.
    expect(said.scheduleHeading).toBe('1 job is scheduled')
    expect(said.panelBody).toContain('above the composer')
  })

  it('🔴 §2 · a conversation that CLOSES keeps its schedule untouched, and still says it is scheduled', () => {
    // 🔴 **The background level is in this fixture ON PURPOSE, and its absence was a real defect in
    // the first draft of this test** (found by the adversarial pass over this diff). The assertion
    // below is the whole asymmetry — one registry is swept at this boundary and the other is not —
    // and over a fixture that had never held a running row it was `[] === []`, green against a
    // `stopDetachedWork` deleted outright.
    const open = liveSession(...TURN_SCHEDULED, [level([BACKGROUND_ROW]), 130_000])
    const closed = liveSession(
      ...TURN_SCHEDULED,
      [level([BACKGROUND_ROW]), 130_000],
      [{ type: 'session', state: 'ended' } as RuntimeEvent, 140_000],
    )
    // ⛔ **The job is still there.** `253` measured a resumed session reporting the same job back
    // before its own first prompt, so sweeping this list would delete something that still exists.
    expect(closed.control.schedule.jobs).toHaveLength(1)
    expect(closed.control.schedule.jobs[0]?.id).toBe('e3826cc5')
    // ⛔ …and the neighbouring registry, which IS swept at exactly this boundary. The asymmetry is
    // the ruling, and this is the assertion that stops it being quietly made symmetric again —
    // paired with the same fold short of the close, so the sweep had a row to take.
    expect(open.control.background.running).toHaveLength(1)
    expect(closed.control.background.running).toEqual([])
    // ⚑ **D-029 · the close leaves the level exactly as the provider last stated it** — its first
    // listing included, and no flag written beside it. 258 §2 set `sleeping` here and the bar added
    // *"Nothing here fires until this conversation takes its next message"*; that sentence is false
    // now (this app starts a stopped conversation in time for its jobs) and went with the flag.
    expect(closed.control.schedule).toEqual(open.control.schedule)
    expect(scheduleHead(closed.control.schedule)).toBe(`1 job is ${SCHEDULED}`)
    // ⚑ **D-029 moved this: every WORD surface this fold feeds says `scheduled` about a conversation
    // that stopped** — `main` says *scheduled · HH:MM* of it too, on the rail and in `list_agents`.
    // 258 §2 read it `idle`: its asleep schedule was not `somethingScheduled`. ⚠️ Which of its jobs a
    // start brings back only the host knows, so a view drawn from its ledger wears the host's word
    // (`AgentCard` draws no bar under *idle*).
    const said = surfaces(closed)
    expect(scheduleHeld(closed.control.schedule)).toBe(true)
    expect(said.standing).toBe('scheduled')
    expect(said.pill).toBe('Scheduled')
    expect(said.railWord).toBe(`claude · ${SCHEDULED}`)
  })

  it('🔴 …and a ledger with TWO lives keeps them through the SESSION arm — the fourth door, found in review', () => {
    // ⛔ **`case 'session'` un-ends a transcript without going through `markReopened`**, which is
    // deliberate and documented there — and 258's first draft missed it, so a ledger with two lives
    // folded to `ended: false` with the schedule still asleep: the bar read *"This conversation is
    // closed"* over a live conversation with a free composer, and the pill and the rail row went
    // back to `Idle`. ⚑ Driven through the FOLD, not by calling `markReopened` by hand, because the
    // hand-call is what hid it. ⚑ **D-029 · no door writes the schedule now** (the asleep flag went),
    // so the door is pinned by what it must leave: the level as the first life stated it, and the word.
    const twoLives = liveSession(
      ...TURN_SCHEDULED,
      [{ type: 'session', state: 'ended' } as RuntimeEvent, 140_000],
      [
        {
          type: 'session',
          state: 'resumed',
          ref: {
            provider: 'claude',
            sessionId: 'th_2',
            cwd: '/Users/alex/work/brobot',
            rotation: 1,
          },
        } as RuntimeEvent,
        150_000,
      ],
    )
    expect(twoLives.control.ended).toBe(false)
    expect(twoLives.control.schedule.jobs).toHaveLength(1)
    expect(twoLives.control.schedule).toEqual(liveSession(...TURN_SCHEDULED).control.schedule)
    const said = surfaces(twoLives)
    expect(said.standing).toBe('scheduled')
    expect(said.pill).toBe('Scheduled')
  })

  it('⛔ …and REOPENING it keeps the same jobs rather than rebuilding them', () => {
    const closed = liveSession(...TURN_SCHEDULED, [
      { type: 'session', state: 'ended' } as RuntimeEvent,
      140_000,
    ])
    // ⚑ **D-029** — 258 §2's `wakeSchedule` woke them here; with nothing asleep the reopen leaves the
    // level alone, the very rows the close left, until the new process restates it (`253`).
    const listed = closed.control.schedule.jobs
    markReopened(closed.control)
    expect(closed.control.schedule.jobs).toBe(listed)
    expect(closed.control.schedule.jobs).toHaveLength(1)
    expect(scheduleHead(closed.control.schedule)).toBe('1 job is scheduled')
    expect(surfaces(closed).standing).toBe('scheduled')
  })

  it('⛔ a RECORDING keeps its jobs too — the same asymmetry at the second closing door', () => {
    const record = liveSession(...TURN_SCHEDULED, [level([BACKGROUND_ROW]), 130_000])
    markReadOnly(record.control, 'settled when this conversation was last open')
    // The same asymmetry, at the second of the two closing doors: the running row goes, the job stays.
    expect(record.control.background.running).toEqual([])
    expect(record.control.schedule.jobs).toHaveLength(1)
    // ⚑ **D-029** — left exactly as the recording ends, where 258 §2 set it asleep: no flag, and the
    // level the same fold holds without the door.
    expect(record.control.schedule).toEqual(
      liveSession(...TURN_SCHEDULED, [level([BACKGROUND_ROW]), 130_000]).control.schedule,
    )
    expect(scheduleHead(record.control.schedule)).toBe(`1 job is ${SCHEDULED}`)
    // `markReadOnly` deliberately does not set `ended`, and the one derivation reads the level it
    // left: `scheduled`, where 258 §2's asleep predicate read `idle`.
    expect(record.control.ended).toBe(false)
    expect(scheduleHeld(record.control.schedule)).toBe(true)
    expect(surfaces(record).standing).toBe('scheduled')
    // ⚠️ **What this is worth today, said rather than implied**: `ReadingPane` draws `TranscriptView`
    // alone — no bar and no word — so nothing on a recording's screen promises these jobs, exactly
    // as nothing draws the registry `stopDetachedWork` empties in the same function. ⛔ No start
    // reaches a recording (D-029 starts a stopped CONVERSATION), so the day a recording draws a
    // word it has to be the host's: `scheduled` above is what this fold says, and no start stands
    // behind it.
  })

  it('⛔ running outranks scheduled, and a permission outranks both', () => {
    // Both true at once: something is happening NOW and something else will happen later. One word,
    // and it names the one a person could still act on — `248`'s bar is the one with a Stop button.
    const both = liveSession(...TURN_OVER, [crons([SCHEDULED_TASK]), 9_600])
    expect(both.control.background.running).toHaveLength(1)
    expect(both.control.schedule.jobs).toHaveLength(1)
    expect(surfaces(both).standing).toBe('background')
    expect(surfaces(both).pill).toBe('Still running')

    // …and a permission freezes the composer, which outranks anything merely happening.
    const asked = liveSession(...TURN_SCHEDULED, [
      {
        type: 'permission_request',
        id: 'perm_1',
        action: 'Write file',
        detail: '/Users/alex/Desktop/person.txt',
      } as RuntimeEvent,
      150_000,
    ])
    expect(asked.control.schedule.jobs).toHaveLength(1)
    expect(surfaces(asked).standing).toBe('waiting')
  })

  it('🔴 …and no BEING outranks it, asserted DIRECTLY rather than through the sweep', () => {
    // ⛔ **Found by replaying this dispatch's own mutation table**, when it said the opposite: the
    // row that hoisted `scheduled` above `standingOf`'s three terminal returns died only because the
    // same hoist also beat the PERMISSION check.
    //
    // ⚑ **D-017b · the three terminal returns are gone** — `ended`, `errored` and `unstarted` said
    // whether a process runs (`05` rule 5) — so a stopped conversation reads by the one state like
    // any other. ⚑ **D-029 · and nothing keeps a stopped conversation from saying `scheduled` now**:
    // 258 §2's asleep flag (`markTerminal` set `sleeping`) went, because this app starts a stopped
    // conversation in time for its jobs — §2 above pins that a close leaves its level alone.
    // ⚠️ Asserted directly, so a `being` check that crept back above the schedule — a process word
    // by another route — is seen here.
    expect(standingOf({ doing: 'idle', being: 'ended', scheduled: true })).toBe('scheduled')
    expect(standingOf({ doing: 'idle', being: 'errored', scheduled: true })).toBe('scheduled')
    expect(standingOf({ doing: 'idle', being: 'unstarted', scheduled: true })).toBe('scheduled')
    expect(standingOf({ doing: 'idle', being: 'live', scheduled: true })).toBe('scheduled')
    // …and the paired negative, so the four above are about the SCHEDULE and not about a function
    // that answers `scheduled` for everything.
    expect(standingOf({ doing: 'idle', being: 'ended' })).toBe('idle')
  })

  it('⛔ a schedule is counted as HAPPENING LATER and never as WAITING (229)', () => {
    const panel = sessionPanel(liveSession(...TURN_SCHEDULED).control)
    expect(panel.scheduled).toBe(true)
    // The queue that freezes the composer, badges the drawer and raises 205's bar must not move: a
    // cron asks nothing of anybody, and it is not even happening yet.
    expect(panel.waiting).toBe(0)
    // …and it adds no ROW here either (035): the bar above the composer is where it is listed.
    expect(panel.agents).toEqual([])
    expect(panel.workflows).toEqual([])
    expect(panel.empty).toBe(true)
  })
})
