import { describe, expect, it } from 'vitest'
import {
  STANDINGS,
  STANDING_LABEL,
  STANDING_TONE,
  accessibleName,
  plateWord,
  recordFacets,
  sessionFacets,
  standingOf,
  standingWord,
  waitSummonsAPerson,
  type AgentFacets,
} from '../src/renderer/src/lib/agent-state'
import { theWaitIn, waitReadingFor } from '../src/renderer/src/lib/conversation-waits'
import { everyFacetState } from '../src/renderer/src/lib/status-projection'
import { WORK_STATE_WORD } from '../src/renderer/src/lib/work-report'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import type { CreatedSession, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  CONVERSATION_WAITS,
  TASK_WAITS,
  type ConversationWait,
  type WhatEachConversationIsWaitingOn,
} from '../src/shared/tasks'

/**
 * 🔴 **636 · three surfaces read the new field, and one word is not reused** — `621` §5's table
 * and its F2, `HO-095` §5.1, `HO-096` §4.
 *
 * BroBot’s header must not say `Idle` while a helper is actively working for it.
 *
 * ## ⛔ What was already built, and what this dispatch had to write (rule 38)
 *
 * ⚑ **Built and reaching the wire at `621`**: the fold (`theWaitAConversationIsIn`), the door
 * (`RuntimeHost.whatEachConversationIsWaitingOn`), the IPC verb, the preload binding and
 * `SessionStore.whatEachConversationIsWaitingOn`. ⛔ **Absent**: every reader of it. The store
 * method had ZERO call sites on `main`, and `recordFacets` and `ConversationPane.facetInput`
 * both composed their facets out of `control` alone.
 *
 * ## ⚠️ What is measured here, and what is measured in the DOM project
 *
 * ⛔ **This file is the derivation**: which facet, which standing, which words, which precedence,
 * and the three absences. ⚑ **`three-surfaces-read-the-new-field.dom.test.ts` is the ink** — that
 * a person reads the word in a box the rail actually draws, which is the half `531` proved a
 * `textContent` assertion cannot see (`brobot2-ssr-tests-pass-vacuously`).
 */

const META: CreatedSession = {
  sessionId: 'sess_brobot',
  provider: 'claude',
  cwd: '/work/brobot',
  profileId: 'default',
  liveness: { state: 'live', since: 1_700_000_000_000, signInSuperseded: false },
} as CreatedSession

/**
 * ⚑ **A conversation as the store holds one**, folded through the product's own `applyEvent`.
 *
 * ⚠️ **`liveness: 'live'` is kept as the real app holds it** — ⚑ D-017b: it no longer draws a BEING
 * (`sessionBeing` draws only `silent` of it), so no standing below turns on it; a record without it
 * would still be one the real app never builds.
 */
function liveConversation(...events: TranscriptEvent[]): SessionRecord {
  const record = createSessionRecord(META.sessionId)
  record.meta = META
  record.phase = 'open'
  for (const event of events) applyEvent(record.control, event, 1_700_000_000_000)
  return record
}

/** ⛔ **The reading `621` put on the wire**, built the way the host builds it. */
function readingOf(rows: Record<string, ConversationWait | null>): WhatEachConversationIsWaitingOn {
  return {
    readAt: 1_700_000_000_000,
    conversations: Object.entries(rows).map(([conversation, waiting]) => ({
      conversation,
      identity: 'default',
      waiting,
      work: null,
    })),
    rowsUnread: 0,
  }
}

/**
 * 🔴 **What every surface says about this conversation, read the way each one reads it** —
 * `idle-truth.test.ts`' shape, narrowed to the three `HO-095` §5.1 names.
 *
 * ⛔ **Each line is the committed call the component makes**, not a restatement of it:
 * `SideRail` renders `{{provider}} · {{word}}` from `standingWord(recordFacets(record, …))`,
 * `SessionHeader` renders `STANDING_LABEL[standingOf(facets)]`, and `SessionBot` — the plate
 * under the avatar — renders `plateWord(facets)`.
 */
function surfaces(
  record: SessionRecord,
  reading: WhatEachConversationIsWaitingOn | null,
): {
  standing: string
  railWord: string
  pill: string
  pillTone: string
  plate: string
  read: string
} {
  const facets = recordFacets(record, theWaitIn(reading, record.sessionId))
  return {
    standing: standingOf(facets),
    railWord: `${record.meta?.provider} · ${standingWord(facets)}`,
    pill: STANDING_LABEL[standingOf(facets)],
    pillTone: STANDING_TONE[standingOf(facets)],
    plate: plateWord(facets),
    read: accessibleName({ ...facets, label: 'brobot' }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the three surfaces stop saying `idle` about a conversation whose worker is working
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('636 §1 · a conversation whose worker is working no longer says idle', () => {
  it('🔴 the rail row, the pill and the plate all move — and the SAME record without the read does not', () => {
    // ⚑ **The conversation from `HO-095` §5.1**: BroBot, idle, live, holding no task row of its
    // own — `workBeingAssigned` mints none for a message a person typed (`621` §1.1) — while the
    // work it gave out is open with Ada.
    const brobot = liveConversation({ type: 'status', state: 'idle' })

    // The control uses the same record without the reading; every surface then says `idle`.
    const before = surfaces(brobot, null)
    expect(before.standing).toBe('idle')
    expect(before.railWord).toBe('claude · idle')
    expect(before.pill).toBe('Idle')
    expect(before.plate).toBe('idle')
    // ⚑ **D-017b** — the read no longer says *live*: a running provider is not a condition, and
    // whether one runs is off every surface (`05` rule 5).
    expect(before.read).toBe('brobot — idle')

    // 🔴 **THE REPAIR**: one field, three surfaces, and none of them says `idle` any more.
    const after = surfaces(brobot, readingOf({ sess_brobot: 'waiting-on-a-worker' }))
    expect(after.standing).toBe('elsewhere')
    expect(after.railWord).toBe('claude · waiting on a worker')
    expect(after.pill).toBe('Waiting on another agent')
    expect(after.plate).toBe('waiting on a worker')
    expect(after.read).toBe('brobot — idle, waiting on a worker')
  })

  it('⛔ the second of the two agent-owed waits says WHICH, and it is not the first', () => {
    // ⚠️ **One standing, two words** — `waiting`'s own arrangement, and the reason it is one
    // standing is that nobody at this machine can move either of them.
    const brobot = liveConversation({ type: 'status', state: 'idle' })
    const answer = surfaces(brobot, readingOf({ sess_brobot: 'waiting-on-an-answer' }))
    expect(answer.standing).toBe('elsewhere')
    expect(answer.railWord).toBe('claude · waiting on an answer')
    expect(answer.plate).toBe('waiting on an answer')
    // ⛔ **The two members are DISTINGUISHED**, which is the property a single collapsed word
    // would have lost — `a-comparison-tested-where-both-sides-agree-measures-nothing`.
    const worker = surfaces(brobot, readingOf({ sess_brobot: 'waiting-on-a-worker' }))
    expect(answer.railWord).not.toBe(worker.railWord)
    // ⚑ …while the PILL is deliberately the family for both, exactly as `Waiting on you` is for
    // four different needings.
    expect(answer.pill).toBe(worker.pill)
  })

  it('⚑ the words are the table that owns them, and this file spells none of them', () => {
    // ⛔ **`222` §4** — one phrase for one fact. A second spelling here would be the drift
    // `standingWord`'s own `BACKGROUND_WORD` line exists to prevent, and a test that wrote the
    // string out would pin the copy rather than the derivation.
    // ⚑ **D-036 · `waitIsAnotherAgents` is gone** — the agent-owed waits are the complement of the
    // person's, which §2's partition proves is the one state's `elsewhere`.
    for (const wait of CONVERSATION_WAITS.filter((w) => !waitSummonsAPerson(w))) {
      const facets: AgentFacets = { doing: 'idle', being: 'live', waiting: wait }
      expect(standingWord(facets)).toBe(WORK_STATE_WORD[wait])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the word is NOT the `waiting` standing — `621` §5.2, which is the part to read twice
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('636 §2 · `waiting-on-a-worker` does not put a mark on the person', () => {
  const rail = (facets: AgentFacets): string => standingOf(facets)

  it('🔴 neither agent-owed wait reaches `waiting`, the amber, or the count titled *waiting on you*', () => {
    // ⚑ **D-036** — the agent-owed waits as the complement of the person's (`waitIsAnotherAgents`
    // went), and ⛔ never as whichever reads `elsewhere`: a wait that wrongly reached `waiting`
    // would then leave this loop instead of failing it. The partition below counts them.
    for (const wait of CONVERSATION_WAITS.filter((w) => !waitSummonsAPerson(w))) {
      const facets: AgentFacets = { doing: 'idle', being: 'live', waiting: wait }
      // ⛔ **The standing `SideRail.needingCount` filters on** — `rows.filter(r => r.standing ===
      // 'waiting')`, whose badge title is *"N waiting on you"*. ⚑ This is the assertion that says
      // the count cannot move, stated against the field the component actually reads.
      expect(rail(facets), `${wait} reached the needing count`).not.toBe('waiting')
      // ⚠️ **And not by the back door either**: amber is *a person must act*.
      expect(STANDING_TONE[standingOf(facets)]).not.toBe('waiting')
      expect(STANDING_TONE[standingOf(facets)]).toBe('')
      // ⛔ **`HO-092` §3's shape, refused**: a count a person cannot clear.
      expect(STANDING_LABEL[standingOf(facets)]).not.toBe(STANDING_LABEL.waiting)
    }
  })

  it('⚑ THE PAIR · the one wait that IS a person’s reaches `waiting`, and it is the F2 case', () => {
    // 🔴 **`621` F2**: `passQuestionUp` writes `request_routed{to:'a-person'}` into the passer's
    // ledger and the transcript draws no card for it, so `control.pending` is zero — the surface
    // had nothing to read and said `idle`. ⚑ **`aPerson` is what it reads now.**
    const person: AgentFacets = { doing: 'idle', being: 'live', waiting: 'waiting-on-a-person' }
    expect(standingOf(person)).toBe('waiting')
    // ⚑ **UI-008** — the pill says the one state's word, *needs you* (F051).
    expect(STANDING_LABEL[standingOf(person)]).toBe('Needs you')
    expect(STANDING_TONE[standingOf(person)]).toBe('waiting')
    // ⚠️ **No NEEDING is invented for it.** The badge vocabulary is unchanged and the row wears
    // no glyph it did not earn; what changed is the one-word answer.
    expect(person.needing).toBeUndefined()
    // ⛔ **And the screen reader is told the fact**, which is the surface that had nothing at all —
    // ⚑ in the one state's word since UI-008, as the plate's word says it.
    expect(accessibleName({ ...person, label: 'brobot' })).toBe('brobot — idle, live, needs you')
  })

  it('⛔ …and it is not a DOUBLE count: a permission already reached `waiting` without it', () => {
    // ⚠️ **The two sources answer one question and are OR-ed**, so a conversation holding a
    // permission AND a person-wait is one `waiting` row, not two.
    const both: AgentFacets = {
      doing: 'idle',
      being: 'live',
      needing: 'permission',
      waiting: 'waiting-on-a-person',
    }
    expect(standingOf(both)).toBe('waiting')
    expect(standingOf({ doing: 'idle', being: 'live', needing: 'permission' })).toBe('waiting')
    // ⚑ **And the sentence does not say it twice**: the needing is the more specific statement of
    // the same fact, so the wait phrase stands down.
    expect(accessibleName({ ...both, label: 'brobot' })).toBe(
      'brobot — idle, live, needs you (permission)',
    )
  })

  it('⚠️ a person’s wait and the one state’s `elsewhere` PARTITION a conversation’s waits — every member in exactly one', () => {
    // ⚑ **D-036 moved the second set.** It was `waitIsAnotherAgents`, a predicate of its own; it is
    // gone, and a wait is another agent's when the ONE state reads it as one of its two arms read
    // off `facets.waiting` — *waiting on an answer* and *waiting on <name>* — which `standingOf`
    // says as `elsewhere` on an idle plate. So the partition is asked of the standing itself.
    const anotherAgents = (wait: ConversationWait): boolean =>
      standingOf({ doing: 'idle', being: 'live', waiting: wait }) === 'elsewhere'
    // ⛔ **`an-enumeration-whose-members-must-differ-needs-a-distinctness-check`**, and the
    // roster is `CONVERSATION_WAITS`, which derives itself from `TASK_STATES`' own prefix — so a
    // new wait a conversation can be in fails here rather than falling silently into neither set.
    for (const wait of CONVERSATION_WAITS) {
      const inOne = [waitSummonsAPerson(wait), anotherAgents(wait)].filter(Boolean).length
      expect(inOne, `${wait} is in ${inOne} of the two sets`).toBe(1)
    }
    // ⚑ **Non-vacuity: both sets are non-empty**, so the partition is a split rather than a
    // constant (`a-positive-assertion-must-differ-from-the-default`).
    expect(CONVERSATION_WAITS.filter((w) => waitSummonsAPerson(w))).toHaveLength(1)
    expect(CONVERSATION_WAITS.filter((w) => anotherAgents(w))).toHaveLength(2)
    // 🔴 **D-016 · commit 6 · the one wait left out of the roster is a piece's, never a
    // conversation's** — *waiting on you*, said on the piece only (plan ruling 9) — so it is in
    // neither set: neither a facet (`AgentFacets.waiting`) nor `waitSummonsAPerson` can be handed
    // it — both take a `ConversationWait` — so it is never *needs you*.
    // ⚑ **F097 · and a second, the same way** — the wait on the person who wrote is the piece's
    // too; what its holder's own word says comes from the host's reading of who owes it the next
    // move, never from this roster.
    // ⚑ **And a third** — a piece marked as waiting on purpose, said on that piece only.
    expect(TASK_WAITS.filter((w) => !CONVERSATION_WAITS.some((one) => one === w))).toEqual([
      'waiting-on-the-person-who-asked',
      'waiting-on-the-person-who-wrote',
      'waiting-on-purpose',
    ])
    // ⛔ **And neither set takes an absence**, which is the one input both are given on every
    // conversation this app has not read a wait for: no person summoned, and an idle plate with no
    // wait reads `idle`, never `elsewhere`.
    expect(waitSummonsAPerson(undefined)).toBe(false)
    expect(standingOf({ doing: 'idle', being: 'live' })).toBe('idle')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · three absences, and none of them renders as a claim
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('636 §3 · `unknown` and absent never become `idle`, and the three absences stay apart', () => {
  it('🔴 the three are told apart by name, and only one of them is an answer', () => {
    const reading = readingOf({ sess_brobot: 'waiting-on-a-worker', sess_quiet: null })
    // ⛔ **Nobody has looked** — the poll has not answered, or the last call was refused.
    expect(waitReadingFor(null, 'sess_brobot')).toEqual({ known: 'nobody-has-looked' })
    // ⛔ **The reading landed and does not cover this conversation** — it is not one this app is
    // running, which is the population `whatEachConversationIsWaitingOn` promises and no other.
    expect(waitReadingFor(reading, 'sess_elsewhere')).toEqual({ known: 'not-in-the-reading' })
    // ⚑ **A REAL ANSWER, and `null` is one of its values** — *nothing this app has recorded is
    // outstanding here*, never *we did not look*.
    expect(waitReadingFor(reading, 'sess_quiet')).toEqual({ known: 'read', waiting: null })
    expect(waitReadingFor(reading, 'sess_brobot')).toEqual({
      known: 'read',
      waiting: 'waiting-on-a-worker',
    })
  })

  it('⛔ an absence ADDS nothing — the word is the one the five live facets already produced', () => {
    const brobot = liveConversation({ type: 'status', state: 'idle' })
    const reading = readingOf({ sess_someone_else: 'waiting-on-a-worker' })
    // ⚠️ **Both absences collapse to the same facet and that is the only place they collapse.**
    for (const absent of [null, reading]) {
      expect(theWaitIn(absent, 'sess_brobot')).toBeUndefined()
      expect(surfaces(brobot, absent).standing).toBe('idle')
    }
    // 🔴 **And `idle` here is the DOING's answer, not the absence's** — a fact this app holds,
    // because the host said `idle` and the fold recorded it. ⛔ **The proof that the absence
    // contributes nothing is that the SAME absence over facets whose DOING is missing answers
    // `unknown`**, which is `632`'s rule and `081`'s faceless ring: a missing wait cannot make a
    // conversation idle, and it cannot make one known either.
    expect(standingOf({ doing: undefined, being: 'live' })).toBe('unknown')
    expect(standingOf({ doing: 'unknown', being: 'live' })).toBe('unknown')
  })

  it('⚑ `unknown` is not talked over by a wait that belongs to another agent', () => {
    // ⛔ **`250`'s line, kept**: *"a refusal that can be talked over by a smaller fact is not
    // one."* A host that has said nothing about a conversation must keep the faceless ring.
    expect(standingOf({ doing: undefined, being: 'live', waiting: 'waiting-on-a-worker' })).toBe(
      'unknown',
    )
    // ⚠️ **THE PAIR** — and the person-wait DOES outrank it, exactly as a `needing` does, because
    // it is the same kind of fact and sits on the same line.
    expect(standingOf({ doing: undefined, being: 'live', waiting: 'waiting-on-a-person' })).toBe(
      'waiting',
    )
  })

  it('⛔ a stopped conversation reads by what it is waiting on, like any other', () => {
    // ⚑ **D-017b** — this said *"a terminal conversation reads terminal, whatever it is waiting
    // on"*: `standingOf` answered `ended`/`errored`/`unstarted` above every wait. Those standings
    // said whether a process runs (`05` rule 5) and went, so a stopped conversation's wait is read
    // exactly as a running one's is — the `being` changes nothing.
    const answers = new Set<string>()
    for (const wait of CONVERSATION_WAITS) {
      const running = standingOf({ doing: 'idle', waiting: wait })
      answers.add(running)
      for (const being of ['ended', 'errored', 'unstarted'] as const)
        expect(standingOf({ doing: 'idle', being, waiting: wait }), `${being} ${wait}`).toBe(
          running,
        )
    }
    // ⚠️ The control: the waits give different answers, so *"the same as a running one"* is not
    // every wait collapsing to one word.
    expect(answers.size, 'every wait read the same').toBeGreaterThan(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the precedence, where the readings DIVERGE
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('636 §4 · which of two true things the one slot says', () => {
  it('🔴 a conversation that is TAKING A TURN says `working`, and that is not a gap', () => {
    // ⚠️ The word is already true, and `081`'s rule is that a one-word surface says the most
    // important thing rather than every thing. ⛔ The state this dispatch is about is the one
    // where the turn is OVER and the word went quiet with it.
    expect(standingOf({ doing: 'replying', being: 'live', waiting: 'waiting-on-a-worker' })).toBe(
      'working',
    )
  })

  it('⛔ detached work outranks it, and so does a schedule', () => {
    // ⚑ **D-017 · R11 — the ONE order ranks it** (`shared/agent-state.ts`'s `agentStateArm`, the
    // order `list_agents` reads): below the background AND the schedule. ⚑ **D-036 moved why**: it
    // only refined an idle plate (work handed out was no state of the agent's), and it is now the
    // one state's own sixth arm, *waiting on <name>* — ranked where this plate always ranked it.
    const base = { doing: 'idle', being: 'live', waiting: 'waiting-on-a-worker' } as const
    expect(standingOf({ ...base, detached: true })).toBe('background')
    expect(standingOf({ ...base, scheduled: true })).toBe('scheduled')
    expect(standingOf({ ...base, detached: true, scheduled: true })).toBe('background')
    // ⚠️ **THE PAIR — R19's wait on another conversation's ANSWER is a state**, *waiting on
    // <name>'s answer*, and it ranks above both: the same `elsewhere` slot, a different rank.
    const answer = { doing: 'idle', being: 'live', waiting: 'waiting-on-an-answer' } as const
    expect(standingOf({ ...answer, scheduled: true })).toBe('elsewhere')
    expect(standingOf({ ...answer, detached: true })).toBe('elsewhere')
    // ⛔ **Measured where they DIVERGE** — the same three inputs without the wait give the two
    // answers this app gave before, so the assertions above are about the new field
    // (`a-comparison-tested-where-both-sides-agree-measures-nothing`).
    expect(standingOf({ doing: 'idle', being: 'live', scheduled: true })).toBe('scheduled')
    expect(standingOf({ doing: 'idle', being: 'live' })).toBe('idle')
  })

  it('⚠️ every member of the vocabulary still has a word, a tone and a distinct label', () => {
    expect(STANDINGS).toContain('elsewhere')
    expect(new Set(STANDINGS.map((s) => STANDING_LABEL[s])).size).toBe(STANDINGS.length)
    for (const standing of STANDINGS) {
      expect(STANDING_LABEL[standing], `${standing} has no word`).toBeTruthy()
      expect(STANDING_TONE[standing], `${standing} has no tone entry`).toBeDefined()
    }
  })

  it('🔴 `elsewhere` is reachable ONLY with a wait present — the invariant behind the fallback', () => {
    // ⛔ **`standingWord`'s `undefined` arm is unreachable by construction and this is the
    // construction**, asserted over the whole facet space rather than argued in a comment —
    // `a-line-no-mutation-can-kill-is-not-carrying-its-rule`, answered with an invariant instead
    // of an invented mutation row.
    const space = everyFacetState()
    const elsewhere = space.filter((facets) => standingOf(facets) === 'elsewhere')
    expect(elsewhere.length, 'the space never reaches `elsewhere`').toBeGreaterThan(0)
    for (const facets of elsewhere) {
      expect(facets.waiting, JSON.stringify(facets)).toBeDefined()
      // ⚑ **D-036** — `elsewhere` comes from the one state's two arms read off `facets.waiting`
      // (`waitIsAnotherAgents` went), so the wait present is one of those two and no other.
      expect(['waiting-on-an-answer', 'waiting-on-a-worker'], JSON.stringify(facets)).toContain(
        facets.waiting,
      )
      expect(standingWord(facets)).not.toBe('elsewhere')
    }
    // ⚑ **The control**: the same sweep finds standings that carry no wait at all, so the filter
    // is selecting rather than matching everything.
    expect(space.some((facets) => standingOf(facets) === 'idle')).toBe(true)
  })

  it('⛔ `sessionFacets` drops an absent wait rather than carrying a null through', () => {
    const told = {
      started: true,
      phase: null,
      status: 'idle',
      ended: false,
      activity: null,
      streaming: false,
      liveness: 'live',
    } as const
    expect(Object.hasOwn(sessionFacets(told), 'waiting')).toBe(false)
    expect(sessionFacets({ ...told, waiting: 'waiting-on-a-worker' }).waiting).toBe(
      'waiting-on-a-worker',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the brief's §2 · F2, and what the transcript draws for a question passed up to a person
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **§2 asked which half of F2 was fixed and the answer is *the surface, and the row was never
 * a gap*** — reported rather than drawn, with the search stated (rule 4).
 *
 * ## ⛔ The search shape: what CAN put a question passed up to a person on this page
 *
 * ⚠️ **Three things could, and each was asked:**
 *
 *  1. ⚑ **A transcript ITEM for the routing row itself** — `applyEvent`'s `request_routed` arm.
 *     ⛔ It draws none, and that is `394`'s RULING with a stated argument — *"the request itself
 *     already has a row … drawing it here would also put a routing decision beside the card a
 *     person is answering, which reads as an instruction about who should answer"* — reaffirmed
 *     at `437` for `pass_question_up`'s sibling. 🔴 **A ruling, not an oversight**, so rule 14
 *     applies: this dispatch reports it and changes nothing (and `transcript.ts` is `mla/fe-1`'s).
 *  2. ⚑ **The act's own NEIGHBOUR** — the `pass_question_up` tool call, which every in-process
 *     tool produces in the calling conversation's own stream. ⛔ **It is drawn**, which is the
 *     premise `394`'s ruling rests on, and it is asserted below rather than assumed.
 *  3. 🔴 **The agent-state surfaces** — the header, the plate and the rail row. ⛔ **These were
 *     the hole**, and §1 is where they close: `aPerson` reaches them through the sixth facet.
 *
 * ⚠️ **So the honest report is that F2 had one half, not two**: the in-conversation SURFACE was
 * missing and now exists; the in-conversation ROW was decided against twice, on the record.
 */
describe('636 §5 · F2 · the question passed up to a person, and what this conversation shows', () => {
  const passingUp = (): SessionRecord =>
    liveConversation(
      { type: 'status', state: 'idle' },
      // ⚑ The act, as the provider reports it: `pass_question_up` is an in-process tool, so the
      // calling conversation's own stream carries the call (`brobot2-tools-are-in-process-not-stdio`).
      { type: 'tool_call', id: 'call_pass', name: 'pass_question_up', summary: 'ask the person' },
      // ⛔ And the ledger row the act writes — `RuntimeHost.passQuestionUp`'s own publish.
      { type: 'request_routed', requestId: 'req_1', to: 'a-person' },
    )

  it('⛔ the routing row draws NO item, and the tool call beside it does — the pair', () => {
    const record = passingUp()
    const kinds = record.control.items.map((item) => item.kind)
    // 🔴 **The neighbour `394`'s ruling depends on**, measured rather than quoted.
    expect(kinds).toContain('tool')
    // ⚑ **And nothing was drawn for the routing itself.** The control is the line above: a
    // transcript that drew nothing at all would satisfy this assertion vacuously
    // (`a-negative-is-only-as-strong-as-the-search-shape`).
    expect(kinds.filter((kind) => kind === 'tool')).toHaveLength(1)
    expect(
      record.control.items.some((item) => JSON.stringify(item).includes('request_routed')),
    ).toBe(false)
  })

  it('🔴 …and `pending` is empty, which is exactly why the surface used to say `idle`', () => {
    const record = passingUp()
    // ⛔ **`621` F2's mechanism, reproduced**: no card, so the counts `needingFor` reads are
    // zero, so `recordFacets` composed no `needing` and every surface said `idle`.
    expect(record.control.pending.permissions).toBe(0)
    expect(record.control.pending.questions).toBe(0)
    expect(surfaces(record, null).pill).toBe('Idle')

    // 🔴 **THE REPAIR**: the reading carries `aPerson`, and the in-conversation surfaces say so.
    const told = surfaces(record, readingOf({ sess_brobot: 'waiting-on-a-person' }))
    expect(told.standing).toBe('waiting')
    // ⚑ **UI-008** — the pill and the screen reader say the one state's *needs you* (F051).
    expect(told.pill).toBe('Needs you')
    expect(told.pillTone).toBe('waiting')
    expect(told.read).toBe('brobot — idle, needs you')
  })
})
