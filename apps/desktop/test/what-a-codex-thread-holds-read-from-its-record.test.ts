import { describe, expect, it } from 'vitest'
import type { ThreadLeadRow } from '../src/main/db/session-store'
import {
  LEADS_OPEN_WITH,
  leadRowsFrom,
  sectionsOf,
  theLeadOwed,
  whatChangedBlock,
  whatTheThreadHolds,
  type ThisConversationComposed,
} from '../src/main/runtime/codex-lead'
import { conversationBlock, THIS_CONVERSATION_HEADER } from '../src/main/runtime/instructions'
import type { LeadInFront } from '../src/shared/runtime-ipc'
import type { InstructionSpan } from '../src/shared/whose-text'

/**
 * # adc4232b · a Codex thread carries BroBot's lead once, then only what changed — the record's read
 *
 * `codex-lead.ts` decides, from a conversation's own rows, what a reopened Codex thread still holds
 * of this conversation's text and so what the next life sends: the whole, only the sections that
 * changed, or nothing. The devs' tests reach it through one happy path only (a close and a reopen
 * whose "This conversation" changed: `what-this-agent-was-given.test.ts`,
 * `a-launch-lists-…-are-doing.test.ts` §4). Every rule that makes it send the WHOLE again was
 * unpinned, and each one, lost, leaves a thread without its tool instructions for good: the next
 * life sends nothing, believing the thread holds what it does not.
 *
 *  - §1 · ⛔ a lead whose turn this app ended as failed (`wordOf: 'this-app'`) is not held — the
 *    whole is owed again, and a what-changed lead leaves what was held before it. ⚑ The same rows
 *    with the turn completed hold it.
 *  - §2 · ⛔ a compaction or a new thread (`conversation_reset`) empties what is held. ⚑ Without it
 *    the same record holds the lead. Read through `leadRowsFrom`, which maps the two row types.
 *  - §3 · ⛔ the record cannot say, so the whole goes: (a) a message opening with this
 *    conversation's line that is no lead the record knows; (b) a held section this launch no longer
 *    has; (c) a row that kept no text before any lead of its launch; (d) a lead in a launch that kept
 *    no record of its text. ⚑ Each beside the nearest case that is read as held.
 *
 * ⚑ Pure functions, fed rows shaped as `SessionStore.threadLeadRows` hands them back (a launch's
 * text JSON-parsed, `sent` only when it opens with {@link LEADS_OPEN_WITH}). No host, no folder.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The rows, as the store reads them
// ─────────────────────────────────────────────────────────────────────────────

type Section = readonly [heading: string, body: string]

/**
 * A launch's own text for this conversation, laid out the way `thisConversationSpans` lays it out:
 * `## heading`, a blank line, the body, sections a blank line apart, one newline at the end.
 */
function composed(...sections: readonly Section[]): ThisConversationComposed {
  let text = ''
  const spans: InstructionSpan[] = []
  sections.forEach(([heading, body], index) => {
    const start = text.length
    text += `## ${heading}\n\n${body}${index === sections.length - 1 ? '\n' : '\n\n'}`
    spans.push({ whose: index === 0 ? 'factory' : 'dynamic', heading, start, end: text.length })
  })
  return { text, sections: spans }
}

const TOOLS: Section = ['The brobot tools', 'Use give_work to hand a piece out.']
const THIS: Section = ['This conversation', '- You work for a person, on W1.']
const THIS_LATER: Section = ['This conversation', '- You work for a person, on W1.\n- W2 is open.']
const GRANTED: Section = ['What you have been granted', '- You may give work.']

/** The first launch's text, and a later launch where only "This conversation" moved. */
const A = composed(TOOLS, THIS, GRANTED)
const B = composed(TOOLS, THIS_LATER, GRANTED)

/** The whole lead a launch owes: its text under this conversation's header. */
const wholeOf = (given: ThisConversationComposed): string => conversationBlock(given.text)

/** The one section of B that differs from A, as the thread would be sent it. */
const B_CHANGED = whatChangedBlock([`## This conversation\n\n${THIS_LATER[1]}`])

const nothing = {
  conversation: null,
  handedOver: false,
  sent: null,
  lead: null,
  failedByThisApp: false,
} as const

/** A launch, with its text as the store hands it back — the JSON parsed — or none kept. */
const aLaunch = (ordinal: number, given: ThisConversationComposed | null): ThreadLeadRow => ({
  ...nothing,
  ordinal,
  rowType: 'launched',
  conversation: given === null ? null : (JSON.parse(JSON.stringify(given)) as unknown),
})

/** A message that carried `lead` in front of its words, and the row's record of it (`user_turn.lead`). */
const aMessageCarrying = (ordinal: number, lead: string, is: LeadInFront['is']): ThreadLeadRow => ({
  ...nothing,
  ordinal,
  rowType: 'user_turn',
  handedOver: true,
  sent: `${lead}\n\nhello`,
  lead: { is, chars: lead.length },
})

/** A message whose text did not open with this conversation's line: the store keeps no `sent`. */
const aPlainMessage = (ordinal: number): ThreadLeadRow => ({
  ...nothing,
  ordinal,
  rowType: 'user_turn',
  handedOver: true,
})

/** A message whose row kept no text at all (`handedOver: false`): a row from before R2. */
const aMessageThatKeptNoText = (ordinal: number): ThreadLeadRow => ({
  ...nothing,
  ordinal,
  rowType: 'user_turn',
})

/** A turn's ending; `failedByThisApp` is a `failed` turn whose word is this app's. */
const aTurnEnded = (ordinal: number, failedByThisApp = false): ThreadLeadRow => ({
  ...nothing,
  ordinal,
  rowType: 'turn',
  failedByThisApp,
})

/** A row that rewrote the thread's history. */
const rewritten = (
  ordinal: number,
  rowType: 'compaction' | 'conversation_reset',
): ThreadLeadRow => ({
  ...nothing,
  ordinal,
  rowType,
})

/** What a new life composed as `now` owes, read from the whole record. */
const owed = (rows: readonly ThreadLeadRow[], now: ThisConversationComposed) =>
  theLeadOwed(whatTheThreadHolds(leadRowsFrom(rows), Infinity), now)

const theWhole = (given: ThisConversationComposed) => ({ text: wholeOf(given), is: 'whole' })

it.each(['compaction', 'conversation_reset'] as const)(
  'a message after %s still needs its earlier launch to identify the held sections',
  (kind) => {
    const rows = [
      aLaunch(0, A),
      aMessageCarrying(1, wholeOf(A), 'whole'),
      rewritten(2, kind),
      aMessageCarrying(3, wholeOf(A), 'whole'),
      aTurnEnded(4),
    ]
    expect(owed(rows, B)).toEqual({ text: B_CHANGED, is: 'what-changed' })
    // Dropping the pre-rewrite launch loses its composition even when the later lead is recorded.
    const floored = rows.filter((row) => row.ordinal >= 2)
    expect(owed(floored, B)).toEqual(theWhole(B))
    expect(owed(floored, B)).not.toEqual(owed(rows, B))
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// §1 · a lead whose turn this app failed
// ─────────────────────────────────────────────────────────────────────────────

describe('§1 · ⛔ a lead whose turn this app ended as failed is not held', () => {
  it('⛔ the whole lead went with a turn this app failed: the reopen owes the whole — ⚑ the same lead, its turn completed, is held and nothing is owed', () => {
    // Premise: the rows are what the store would hand back — the lead opens the way every lead does.
    expect(wholeOf(A).startsWith(LEADS_OPEN_WITH)).toBe(true)
    const life = (failed: boolean): ThreadLeadRow[] => [
      aLaunch(0, A),
      aMessageCarrying(1, wholeOf(A), 'whole'),
      aTurnEnded(2, failed),
      aLaunch(3, A),
    ]
    // ⛔ This app failed its turn: the provider may never have begun it.
    expect(owed(life(true), A)).toEqual(theWhole(A))
    expect(whatTheThreadHolds(leadRowsFrom(life(true)), Infinity).carried).toEqual([])
    // ⚑ The control, one fact over: the turn completed, so the thread holds it.
    expect(owed(life(false), A)).toBeNull()
    expect(whatTheThreadHolds(leadRowsFrom(life(false)), Infinity).carried).toEqual([
      { ordinal: 1, is: 'whole', text: wholeOf(A), firstOfItsLaunch: true },
    ])
    // ⚑ …and a failed turn that carried no lead takes nothing away from the one before it.
    expect(
      owed([...life(false).slice(0, 3), aPlainMessage(3), aTurnEnded(4, true), aLaunch(5, A)], A),
    ).toBeNull()
  })

  it('⛔ a what-changed lead whose turn this app failed leaves the thread holding what it held before: the change is owed again — ⚑ once its turn completes, nothing is', () => {
    const lives = (failed: boolean): ThreadLeadRow[] => [
      aLaunch(0, A),
      aMessageCarrying(1, wholeOf(A), 'whole'),
      aTurnEnded(2),
      aLaunch(3, B),
      aMessageCarrying(4, B_CHANGED, 'what-changed'),
      aTurnEnded(5, failed),
      aLaunch(6, B),
    ]
    // ⛔ The change never reached the thread: it still holds A's "This conversation".
    expect(owed(lives(true), B)).toEqual({ text: B_CHANGED, is: 'what-changed' })
    // ⚑ The control: the change landed, so B's sections are all held.
    expect(owed(lives(false), B)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 · a history rewritten
// ─────────────────────────────────────────────────────────────────────────────

describe('§2 · ⛔ a compaction or a new thread empties what the thread holds', () => {
  it.each(['compaction', 'conversation_reset'] as const)(
    '⛔ after a %s the reopen owes the whole — ⚑ without it the same record owes nothing, and a lead sent after it is held',
    (kind) => {
      const before: ThreadLeadRow[] = [
        aLaunch(0, A),
        aMessageCarrying(1, wholeOf(A), 'whole'),
        aTurnEnded(2),
      ]
      // ⛔ The history the lead rode in was rewritten.
      expect(owed([...before, rewritten(3, kind), aLaunch(4, A)], A)).toEqual(theWhole(A))
      // ⚑ The control: the same record with no such row holds the lead.
      expect(owed([...before, aLaunch(3, A)], A)).toBeNull()
      // ⚑ …and the lead owed again after it (D-039), once sent, is held again.
      expect(
        owed(
          [
            ...before,
            rewritten(3, kind),
            aMessageCarrying(4, wholeOf(A), 'whole'),
            aTurnEnded(5),
            aLaunch(6, A),
          ],
          A,
        ),
      ).toBeNull()
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 · a record that cannot say
// ─────────────────────────────────────────────────────────────────────────────

describe('§3 · ⛔ a record that cannot say what the thread holds sends the whole', () => {
  /** A first life whose whole lead landed. */
  const aLifeThatHeldA: ThreadLeadRow[] = [
    aLaunch(0, A),
    aMessageCarrying(1, wholeOf(A), 'whole'),
    aTurnEnded(2),
  ]

  it('⛔ (a) a message that opens with this conversation’s line but is no lead this record knows leaves what is held unknown — ⚑ a message that opens with anything else leaves it as it was', () => {
    const unknown: ThreadLeadRow = {
      ...aPlainMessage(4),
      // An older composition of this conversation's text, which matches no launch and has no record.
      sent: `${THIS_CONVERSATION_HEADER}\n\n## This conversation\n\n- something else\n\nhello`,
    }
    // Premise: the store would keep this `sent` — it opens with every lead's opening.
    expect(unknown.sent?.startsWith(LEADS_OPEN_WITH)).toBe(true)
    expect(
      owed([...aLifeThatHeldA, aLaunch(3, A), unknown, aTurnEnded(5), aLaunch(6, A)], A),
    ).toEqual(theWhole(A))
    // ⚑ The control: the reopen's first message carried nothing in front (none was owed).
    expect(
      owed([...aLifeThatHeldA, aLaunch(3, A), aPlainMessage(4), aTurnEnded(5), aLaunch(6, A)], A),
    ).toBeNull()
  })

  it('⛔ (b) a section the thread holds that this launch no longer has means the whole, never a partial — ⚑ a changed or new section with every held heading kept is sent alone', () => {
    const renamed = composed(TOOLS, THIS, ['What you may do', GRANTED[1]])
    const dropped = composed(TOOLS, THIS)
    // ⛔ The thread would keep the old "What you have been granted" beside whatever is sent.
    expect(owed(aLifeThatHeldA, renamed)).toEqual(theWhole(renamed))
    expect(owed(aLifeThatHeldA, dropped)).toEqual(theWhole(dropped))
    // ⚑ The controls: every held heading still there — only what changed goes, or nothing.
    expect(owed(aLifeThatHeldA, B)).toEqual({ text: B_CHANGED, is: 'what-changed' })
    const added = composed(TOOLS, THIS, GRANTED, ['Your memory', '- Two notes.'])
    expect(owed(aLifeThatHeldA, added)).toEqual({
      text: whatChangedBlock(['## Your memory\n\n- Two notes.']),
      is: 'what-changed',
    })
    expect(owed(aLifeThatHeldA, A)).toBeNull()
    // The held sections are A's, by heading — what the comparison is made against.
    expect([...sectionsOf(A).keys()]).toEqual([
      'The brobot tools',
      'This conversation',
      'What you have been granted',
    ])
  })

  it('⛔ (c) a row that kept no text, before any lead of its launch, may have taken that launch’s lead: the whole is owed — ⚑ the same row after its launch’s lead leaves what is held as it was', () => {
    expect(
      owed(
        [...aLifeThatHeldA, aLaunch(3, A), aMessageThatKeptNoText(4), aTurnEnded(5), aLaunch(6, A)],
        A,
      ),
    ).toEqual(theWhole(A))
    // ⚑ The control: in the first life, after its lead rode.
    expect(
      owed([...aLifeThatHeldA, aMessageThatKeptNoText(3), aTurnEnded(4), aLaunch(5, A)], A),
    ).toBeNull()
  })

  it('⛔ (d) a lead recorded in a launch that kept no record of its text leaves what is held unknown — ⚑ the same lead in a launch that kept one is read', () => {
    const second = (given: ThisConversationComposed | null): ThreadLeadRow[] => [
      ...aLifeThatHeldA,
      aLaunch(3, given),
      aMessageCarrying(4, B_CHANGED, 'what-changed'),
      aTurnEnded(5),
      aLaunch(6, B),
    ]
    // ⛔ What the what-changed lead replaced cannot be told without its launch's text.
    expect(owed(second(null), B)).toEqual(theWhole(B))
    // ⚑ The control: its launch kept B, so the thread holds B.
    expect(owed(second(B), B)).toBeNull()
  })
})
