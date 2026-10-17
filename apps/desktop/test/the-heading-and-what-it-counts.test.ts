import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NEEDING_NOUN,
  NEEDINGS,
  summonsAttention,
  type Needing,
} from '../src/renderer/src/lib/agent-state'
import {
  NOTHING_OPEN_HEAD,
  PANEL_EMPTY_WORDS,
  panelEmptyWords,
  sessionPanel,
  WHAT_THIS_COLUMN_COUNTS,
} from '../src/renderer/src/lib/session-panel'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import type { RuntimeEvent } from '../src/shared/runtime-ipc'

/**
 * # 577 · ⛔ **The heading and what it counts may not drift apart**
 *
 * ## 🔴 The defect, verbatim
 *
 * ⛔ **`EXT-010` §3.1: BroBot finished its turn with *Waiting on you* and three questions in
 * prose — correct behaviour, it had been told to stop and ask — and the right pane beside it said
 * *"Nothing is waiting"*.**
 *
 * ⚑ **The PO named two legal repairs and did not choose**: either the pane counts only STRUCTURED
 * waits and its HEADING is the thing that is wrong, or a prose *Waiting on you* is a wait the COUNT
 * should see. ⛔ **`577` derived the first from the code**, and this file is what makes the repair
 * durable rather than a better sentence somebody can silently un-write.
 *
 * ## ⚠️ Why every pin that existed was the sentence agreeing with itself
 *
 * ⛔ **Before this file, seventeen assertions read the heading and every one of them typed the
 * words out.** They all stay green through an edit that changes the heading and what it counts
 * TOGETHER — which is exactly the drift the PO is asking to be caught. ⚑ **Neither side of the
 * comparison below is typed here:**
 *
 * | side | where it comes from | what moves it |
 * |---|---|---|
 * | what is COUNTED | building one card per {@link NEEDINGS} member and reading `sessionPanel(state).waiting` | the fold itself — `isAwaitingAnswer`, and the summands of `waiting` |
 * | what is NAMED | parsing {@link PANEL_EMPTY_WORDS}' own head against {@link NEEDING_NOUN} | the heading's words |
 *
 * ⚑ **And `plan` is the negative control this app already owns**: it is a `NEEDING`, a person has
 * to press it, and `summonsAttention` deliberately refuses it — so a sweep that admitted everything
 * would be caught by the one member that must fall out.
 *
 * ## ⛔ What this file deliberately does NOT assert
 *
 * ⚠️ **The exact words.** Those are pinned as literals in `idle-truth.test.ts` and
 * `session-panel.render.test.ts`, which is `169` §2's rule — a person reads words, and a test that
 * only ever derived them could watch the heading become a slug. ⚑ This file asserts the PROPERTY;
 * those files assert the READING. Both are needed and neither replaces the other.
 */

/** One card of each NEEDING, or the nearest thing the transcript fold can be handed. */
const A_CARD_OF_EACH_NEEDING: Readonly<Record<Needing, RuntimeEvent>> = {
  permission: {
    type: 'permission_request',
    id: 'req_perm',
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
  } as RuntimeEvent,
  question: {
    type: 'user_input_request',
    id: 'req_ask',
    prompt: 'Which colour?',
    questions: [{ id: 'q1', prompt: 'Pick a colour', options: [{ label: 'Red' }] }],
  } as RuntimeEvent,
  /**
   * ⛔ **The closest a plan go-ahead can come to this fold, and the gap is the point.** A `plan`
   * NEEDING is raised from `SessionRecord.meta.planNeedsGoAhead`, which `sessionPanel` is never
   * handed — it is a pure function of {@link TranscriptState}. ⚑ What the transcript DOES carry is
   * the checklist, and it reaches `todo` rather than `waiting`, which is `standingOf`'s own line:
   * *"a go-ahead blocks nothing and can be pressed whenever"*.
   */
  plan: {
    type: 'plan_update',
    steps: [
      { text: 'read', status: 'done' },
      { text: 'write', status: 'active' },
    ],
  } as RuntimeEvent,
}

function transcriptWith(...events: readonly RuntimeEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event, 1_000)
  return state
}

/**
 * 🔴 **What the fold COUNTS, measured one card at a time.** Nothing here reads
 * {@link summonsAttention} or {@link WHAT_THIS_COLUMN_COUNTS} — a member is in this list because a
 * card of its kind moved `waiting`, and for no other reason.
 */
const COUNTED: Needing[] = NEEDINGS.filter(
  (needing) => sessionPanel(transcriptWith(A_CARD_OF_EACH_NEEDING[needing])).waiting === 1,
)

/**
 * ⛔ **Which NEEDINGS a heading NAMES**, read out of the string itself through the app's own noun
 * table. ⚑ Lowercased, because the first noun in a heading is capitalised by English rather than
 * by a decision.
 */
function scopeOf(head: string): Needing[] {
  const said = head.toLowerCase()
  return NEEDINGS.filter((needing) => said.includes(NEEDING_NOUN[needing]))
}

describe('§1 · what the column counts, derived from the fold and not from a list', () => {
  it('🔴 a card of a counted kind moves `waiting`, and the checklist is the member that does not', () => {
    // ⚑ **The vacuity floor first** — a sweep that counted nothing would satisfy every equality
    // below and measure none of them.
    expect(COUNTED.length).toBeGreaterThan(0)
    // ⛔ **And it is not simply everything**, which is what makes the comparison in §2 a
    // measurement: one NEEDING has to fall out, or the sweep is admitting by default.
    expect(COUNTED).not.toEqual([...NEEDINGS])
    expect(COUNTED).not.toContain('plan')

    // ⚠️ The paired positive for that negative: a plan really did land, it is really open, and the
    // panel really did see it — as a CHECKLIST, which is a thing happening rather than a wait.
    const withPlan = sessionPanel(transcriptWith(A_CARD_OF_EACH_NEEDING.plan))
    expect(withPlan.todo).not.toBeNull()
    expect(withPlan.waiting).toBe(0)
    expect(withPlan.empty).toBe(false)
  })

  it('⚑ …and the predicate the rest of the app asks agrees with the fold, in a second voice', () => {
    // ⛔ **Two derivations of one set through two code paths**: `summonsAttention` is what
    // `standingOf` asks for the pill and the rail word, and the `if`-chain inside `sessionPanel` is
    // what fills the lists. ⚠️ `446` widened both and had to find four places by hand; this
    // is the assertion that would have named the fourth.
    expect([...WHAT_THIS_COLUMN_COUNTS].sort()).toEqual([...COUNTED].sort())
    expect(NEEDINGS.filter(summonsAttention).sort()).toEqual([...COUNTED].sort())
  })
})

describe('§2 · the reader itself, before it is trusted with anything', () => {
  it('\u26d4 no noun contains another, so a bare substring match cannot name the wrong population', () => {
    // ⛔ **An enumeration whose members must DIFFER needs a distinctness check**, and a
    // substring matcher needs the stronger one: `plans` inside `plansomething` would make
    // `scopeOf` report a population the heading never named. ⚠️ Nothing else in the app asserts
    // this, because nothing else reads these nouns by containment.
    const nouns = NEEDINGS.map((needing) => NEEDING_NOUN[needing])
    expect(new Set(nouns).size).toBe(nouns.length)
    for (const one of nouns) {
      for (const other of nouns) {
        if (one === other) continue
        expect(other.includes(one), `${other} contains ${one}`).toBe(false)
      }
    }
    // ⚑ …and the paired positive, so the loop above is not passing over an empty comparison.
    expect(nouns.length).toBeGreaterThan(2)
  })

  it('⚠️ …and each noun is the word the panel\u2019s own band is headed by', () => {
    // 🔴 **The heading derives its nouns and the bands beside it still type theirs**, which is
    // a drift pair of exactly the kind this file exists for — one word, two claims, six inches
    // apart (`492`). ⛔ A source census rather than a render, because `SECTIONS` is a `const` inside
    // the SFC and a test that imported the component would be checked by a different tsconfig.
    const panel = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/AgentCard.vue', import.meta.url)),
      'utf8',
    )
    for (const needing of COUNTED) {
      const label = NEEDING_NOUN[needing]
      const headed = `label: '${label[0]!.toUpperCase()}${label.slice(1)}'`
      expect(panel, `no band headed ${headed}`).toContain(headed)
    }
    // ⚑ The floor, so a `COUNTED` that emptied would pass this vacuously.
    expect(COUNTED.length).toBeGreaterThan(0)
  })

  /**
   * No panel component draws the removed empty-state heading, either by binding or copied
   * words. The library derivation remains available to its readers. Strip comments before the
   * source census because prose can quote the subject
   * (`a-source-census-must-strip-prose-before-it-asserts`).
   */
  it('⛔ no panel component draws the heading, bound or copied', () => {
    for (const name of ['SessionPanel.vue', 'AgentCard.vue']) {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/renderer/src/components/${name}`, import.meta.url)),
        'utf8',
      )
      const code = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(code, name).not.toContain('emptyWords')
      expect(code, name).not.toContain(NOTHING_OPEN_HEAD)
      // ⚑ The file was really read: it is the panel's own component.
      expect(code, name).toContain('<template>')
    }
  })
})

describe('§3 · the heading names exactly that, and every arm says the same thing', () => {
  it('🔴 the heading names the counted set and nothing else — the drift this file exists for', () => {
    expect(scopeOf(NOTHING_OPEN_HEAD).sort()).toEqual([...COUNTED].sort())
  })

  it('⛔ …on every arm, derived from the constant so a sixth arm is covered the day it is written', () => {
    const arms = Object.values(PANEL_EMPTY_WORDS)
    expect(arms.length).toBeGreaterThan(4)
    for (const arm of arms) expect(scopeOf(arm.head).sort()).toEqual([...COUNTED].sort())
    // ⚑ And through the chooser rather than only the constant, because that is the function the
    // component calls.
    const quiet = panelEmptyWords({ stillRunning: false, runningNamed: false, scheduled: false })
    expect(scopeOf(quiet.head).sort()).toEqual([...COUNTED].sort())
  })

  it('⚠️ the comparison can FAIL — two planted headings through the same reader', () => {
    // ⛔ **Plant TWO, not one** (standing rule 12). An equality between two expressions of one
    // intent proves nothing until something is shown to break it, and one plant only ever exercises
    // one side of the boundary.
    const namesEverything = `No ${NEEDINGS.map((needing) => NEEDING_NOUN[needing]).join(', ')} are open`
    expect(scopeOf(namesEverything).sort()).toEqual([...NEEDINGS].sort())
    expect(scopeOf(namesEverything).sort()).not.toEqual([...COUNTED].sort())

    const namesNothing = 'Nothing is waiting'
    expect(scopeOf(namesNothing)).toEqual([])
    expect(scopeOf(namesNothing)).not.toEqual([...COUNTED].sort())
  })
})

describe('§4 · the screen EXT-010 §3.1 was taken from', () => {
  /** The turn the PO watched: the agent asked in its own words and called nothing. */
  const ASKED_IN_PROSE: readonly RuntimeEvent[] = [
    // ⛔ Through `unknown`: `user_turn` is an event THIS APP authors, so a direct cast is the
    // mistake `tsc` names.
    { type: 'user_turn', text: 'plan the importer' } as unknown as RuntimeEvent,
    {
      type: 'assistant_message',
      text: 'Waiting on you.\n\n1. Which database?\n2. Which window?\n3. Who owns the run?',
    } as RuntimeEvent,
    { type: 'turn', state: 'completed' } as RuntimeEvent,
  ]

  it('🔴 three questions in prose move nothing, and the column says what it looked at', () => {
    const state = transcriptWith(...ASKED_IN_PROSE)
    // ⚑ **The fixture really did land** — the words are in the transcript this fold walked, so the
    // zero below is a reading of that state and not of an empty one.
    expect(JSON.stringify(state.items)).toContain('Waiting on you')

    const panel = sessionPanel(state)
    expect(panel.waiting).toBe(0)
    expect(panel.empty).toBe(true)
    // ⛔ **Honest, and it is the heading that had to move.** Derived, never typed: whatever the
    // heading says, it says only what the number above counted.
    expect(scopeOf(panelEmptyWords(panel).head).sort()).toEqual([...COUNTED].sort())
  })

  it('⚑ …and the same conversation with a real card is not empty — the paired positive', () => {
    const panel = sessionPanel(transcriptWith(...ASKED_IN_PROSE, A_CARD_OF_EACH_NEEDING.question))
    expect(panel.waiting).toBe(1)
    expect(panel.empty).toBe(false)
  })
})
