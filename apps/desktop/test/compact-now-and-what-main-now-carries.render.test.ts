import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canSend, sendIntentFor } from '../src/renderer/src/components/PromptComposer.vue'
import {
  COMPACT_HEADING,
  COMPACT_HEADING_AFTER_THE_TURN,
  COMPACT_LINE,
  compactHeading,
  NOT_DECLARED,
  NOT_NOW,
  NOT_OFFERED,
  THE_COMPACT_COMMAND,
  compactionOffer,
  type CompactionFacts,
} from '../src/renderer/src/lib/compaction-offer'
import { outgoingCard, type OutgoingCardWords } from '../src/renderer/src/lib/outgoing-card'
import { pieceSays } from '../src/renderer/src/lib/relayed-turn'
import { afterAPlacedLaunch } from '../src/renderer/src/lib/placed-launch'
import { SIGN_IN_SUPERSEDED_BLOCK } from '../src/renderer/src/lib/send-refusals'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import {
  applyEvent,
  createTranscript,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { workingTogetherView } from '../src/renderer/src/lib/working-together'
import { workGivenOutView } from '../src/renderer/src/lib/work-given-out'
import type {
  CapabilityStatus,
  CreateSessionInput,
  CreatedSession,
  RuntimeBridge,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import type { WorkGivenOut } from '../src/shared/tasks'
import type { WhoCalledWhom, WorkEdge } from '../src/shared/who-called-whom'
import { everythingOverTheWire } from './lib/the-wire'
import { CLAUDE_COMPACTION_NOTE, CODEX_COMPACTION_NOTE } from './provider-capability-fixture'

/**
 * # 🔴 718 — Compact now, and what main now carries: the halves a node process can reach
 *
 * ⚑ **The dispatch's seven draws, as rules**, each with its control one fact over:
 *
 *  - **§1 · `R60`** — *"Compact now…"* is offered exactly where the composer's plain Send of
 *    `/compact` would go, with that press's intent (`now`, or `queue` behind a turn), and withheld
 *    in words everywhere else (`compaction-offer.ts`). ⚠️ **The fold is NEW**, so its own arms
 *    cannot be RED on `main` and are marked ⚑; the draw they feed is, in the DOM file.
 *  - **§2 · `707` GAP-2** — the SENDER's card says the piece its receipt names. ⚑ **D-016** took
 *    the project out and the tree put the label in: *W1.1*, whatever an older receipt's
 *    `elsewhere` said.
 *  - **§3 · `707` GAP-3 / GAP-4** — the Work tab and the work a conversation was given spell each
 *    piece by its label alone. ⚑ **D-016**: no reader's project, no *in <project>*. ⛔ The band's
 *    given-out lines went (PM ruling, 2026-10-01), and their check with them.
 *  - **§4 · `710` F-5** — the take-over notice said what happened and what to press; ⚑ D-017b
 *    retired it with the fork, so §4 pins the one open door's words and where the store forgets.
 *  - **§5 · `710` F-9** — a start from the StartAsAgent sheet is its OWN launch: its own key, its
 *    own error, its own Cancel, and the screen closes the sheet only when the conversation opens.
 *
 * ⚠️ The drawn halves — the door, the dark button, the sheet's refusal box, the window's title —
 * are `compact-now-and-what-main-now-carries.dom.test.ts`'.
 */

const here = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(here, '../src/renderer/src')
const read = (path: string): string => readFileSync(join(RENDERER, path), 'utf8')

/* ================================================================ §1 · R60 — the offer */

const AVAILABLE: CapabilityStatus = { state: 'available', note: CLAUDE_COMPACTION_NOTE }

const facts = (over: Partial<CompactionFacts> = {}): CompactionFacts => ({
  state: 'idle',
  closing: false,
  signInSuperseded: false,
  hasQueued: false,
  compactionIsWaiting: false,
  who: 'Ada',
  ...over,
})

describe('§1 · `R60` — "Compact now…" is offered where a plain Send of /compact would go', () => {
  it('⚑ idle: offered NOW, and the sentence names the provider’s road', () => {
    const offer = compactionOffer(AVAILABLE, facts())
    expect(offer).toEqual({
      offered: true,
      intent: 'now',
      why: `The provider can be asked — ${CLAUDE_COMPACTION_NOTE}.`,
    })
  })

  it('⚑ busy: offered, QUEUED behind the turn — the composer’s plain press — and said before it', () => {
    const offer = compactionOffer(AVAILABLE, facts({ state: 'busy' }))
    expect(offer.offered && offer.intent).toBe('queue')
    // ⚑ The composer's own answer for the plain press from `busy` (⇧ not held).
    expect(sendIntentFor('busy', false)).toBe('queue')
    expect(offer.why).toContain('Ada is working, so it goes when this turn ends.')
    // ⛔ Never `interrupt`: a turn thrown away inside a confirmed compaction is a second,
    // unconfirmed irreversible act.
    for (const state of ['idle', 'busy'] as const) {
      const one = compactionOffer(AVAILABLE, facts({ state }))
      expect(one.offered && one.intent).not.toBe('interrupt')
    }
  })

  it('⚑ Codex: the same offer, in ITS note — the road differs, the press does not', () => {
    const codex = compactionOffer({ state: 'available', note: CODEX_COMPACTION_NOTE }, facts())
    expect(codex.offered).toBe(true)
    expect(codex.why).toContain('Codex takes no instructions')
    // ⚑ …which is why the press sends the bare word: `/compact <instructions>` is refused on Codex
    // (`R68`), and the bare word is the one spelling both providers take.
    expect(THE_COMPACT_COMMAND).toBe('/compact')
  })

  /**
   * 🔴 **Parity with the composer, over every state it has** — `canSend('/compact', state, blocked)`
   * answers where a typed `/compact` could be sent, and the offer agrees in every cell. ⚑ **D-010**:
   * a message already held is no longer a cell of its own — the host holds any number, so the
   * press queues behind it as a typed `/compact` would.
   */
  // ⚑ **D-017b · four states, not five** — there is no `ended` composer: every conversation takes a
  // message, and one nothing runs is continued by it.
  it('⚑ it agrees with the composer’s own gate, state by state — a held message included', () => {
    const STATES = ['idle', 'busy', 'starting', 'frozen'] as const
    let compared = 0
    for (const state of STATES) {
      for (const closing of [false, true]) {
        for (const signInSuperseded of [false, true]) {
          for (const hasQueued of [false, true]) {
            const one = facts({ state, closing, signInSuperseded, hasQueued })
            // ⚑ The pane's `sendBlocked` precedence, minus the draft's own reason.
            const blocked = closing
              ? 'closing'
              : state !== 'idle' && state !== 'busy'
                ? null
                : signInSuperseded
                  ? SIGN_IN_SUPERSEDED_BLOCK
                  : null
            const composerWould = canSend(THE_COMPACT_COMMAND, state, blocked)
            const offered = compactionOffer(AVAILABLE, one).offered
            expect(offered, JSON.stringify(one)).toBe(composerWould)
            compared += 1
          }
        }
      }
    }
    expect(compared).toBe(STATES.length * 8)
  })

  it('⛔ withheld in WORDS — every state that cannot send says why, never a blank', () => {
    // ⚑ **D-017b** — no `ended` case: there is no ended conversation. And the closing words say no
    // process fact (`05` rule 5): what a person meets is a conversation taking up a change.
    const cases: [Partial<CompactionFacts>, string][] = [
      [{ closing: true }, 'this conversation is taking up the change'],
      [{ signInSuperseded: true }, 'reopen it on the current one from the bar above the composer'],
      [{ state: 'starting' }, 'still opening'],
      [{ state: 'frozen' }, 'A request in the conversation is waiting on you'],
    ]
    for (const [over, words] of cases) {
      const offer = compactionOffer(AVAILABLE, facts(over))
      expect(offer.offered, JSON.stringify(over)).toBe(false)
      expect(offer.offered === false && offer.lead).toBe(NOT_NOW)
      expect(offer.why, JSON.stringify(over)).toContain(words)
      // ⛔ **`718`'s review**: the drawer sits BESIDE the conversation, so nothing it points at is
      // *above* it — the composer's own words said so, and were false here.
      expect(offer.why, JSON.stringify(over)).not.toMatch(/\babove\b(?! the composer)/)
    }
  })

  /**
   * 🔴 **D-010 · a held message does not withhold it** — whoever wrote it. ⛔ Until D-010 the host
   * refused a second held message, so the drawer said *cancel it or wait*; now the compaction waits
   * its turn behind it, as anything sent would.
   */
  it('🔴 a message already waiting: offered, to go after it when the turn ends', () => {
    const behind = compactionOffer(AVAILABLE, facts({ state: 'busy', hasQueued: true }))
    expect(behind.offered).toBe(true)
    expect(behind.offered && behind.intent).toBe('queue')
    // ⚑ THE CONTROL, one fact over: nothing held — the same offer.
    expect(compactionOffer(AVAILABLE, facts({ state: 'busy' }))).toEqual(behind)
  })

  /**
   * 🔴 **`718`'s second review round — the held message IS the person's `/compact`.** ⛔ The foot
   * told a person who had just confirmed a compaction behind the turn to cancel it *"to compact"*.
   */
  it('🔴 a waiting /compact is the answer on its way — not a message to cancel', () => {
    const waiting = compactionOffer(
      AVAILABLE,
      facts({ state: 'busy', hasQueued: true, compactionIsWaiting: true }),
    )
    expect(waiting.offered).toBe(false)
    expect(waiting.why).toContain('A /compact is already waiting to go when Ada finishes')
    expect(waiting.why).not.toContain('Cancel it')
  })

  it('⚑ the confirm asks in the words of what the answer will DO — now, or when this turn ends', () => {
    expect(compactHeading('now')).toBe(COMPACT_HEADING)
    expect(compactHeading('queue')).toBe(COMPACT_HEADING_AFTER_THE_TURN)
    expect(COMPACT_HEADING_AFTER_THE_TURN).toContain('when this turn ends')
    expect(COMPACT_HEADING).not.toBe(COMPACT_HEADING_AFTER_THE_TURN)
  })

  it('⛔ the capability first: not declared, absent, unwired — `087`’s lead, the adapter’s words', () => {
    expect(compactionOffer(null, facts())).toEqual({
      offered: false,
      lead: NOT_OFFERED,
      why: NOT_DECLARED,
    })
    const absent = compactionOffer(
      { state: 'absent', reason: 'It cannot.', checkedAgainst: 'the SDK' },
      facts(),
    )
    expect(absent).toEqual({
      offered: false,
      lead: NOT_OFFERED,
      why: 'It cannot. Checked against: the SDK',
    })
    const unwired = compactionOffer({ state: 'unwired', reason: 'Not wired yet.' }, facts())
    expect(unwired.offered === false && unwired.why).toBe('Not wired yet.')
    // ⚑ …and a conversation with nothing behind the view offers nothing, saying so.
    const alone = compactionOffer(AVAILABLE, null)
    expect(alone.offered).toBe(false)
    expect(alone.why).toContain('no conversation to send it to')
  })

  /**
   * ⚠️ **`RuntimeScreen` is mounted by no test**, so the last hop is read where it is written: the
   * pane's `compactNow` reaches `store.send` with the bare word, and never the screen's `send`,
   * which would write a refused `/compact` into the person's own draft.
   */
  it('🔴 the screen sends the person’s /compact through the composer’s door, and nothing else', () => {
    const screen = read('components/RuntimeScreen.vue')
    const body = bodyOf(screen, 'function compactNow(')
    expect(body).toContain('void store.send(sessionId, THE_COMPACT_COMMAND, intent, [])')
    expect(body).not.toMatch(/restoreRefused|drafts\./)
    const from = screen.indexOf('<ConversationPane\n')
    expect(screen.indexOf('<ConversationPane\n', from + 1), 'a second pane').toBe(-1)
    expect(screen.slice(from, screen.indexOf('/>', from))).toContain('@compact-now="compactNow"')
  })

  it('⚑ rule 5 — the confirm’s load-bearing clause, by name', () => {
    expect(COMPACT_LINE).toContain('It cannot be undone.')
    expect(COMPACT_LINE).toContain('loses the detail')
  })
})

/* ================================================================ §2 · GAP-2 */

const MESSAGE = 'mcp__brobot__message_agent'

const fold = (events: readonly TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const theCall = (over: object): TranscriptState =>
  fold([
    {
      type: 'tool_inventory',
      naming: { prefix: 'mcp__', separator: '__' },
      declared: {
        server: 'brobot',
        tools: ['message_agent'].map((name) => ({ name, description: '', parameters: [] })),
      },
      published: null,
    } as unknown as TranscriptEvent,
    { type: 'tool_call', id: 'c1', name: MESSAGE, summary: '{}' } as TranscriptEvent,
    {
      type: 'message_sent',
      to: 'sess_pm',
      toProfile: 'pm',
      kind: 'follow-up',
      delivery: 'sent',
      onBehalfOfAPerson: false,
      piece: 'work_1',
      ...over,
    } as TranscriptEvent,
    { type: 'tool_result', id: 'c1', summary: 'ok', ok: true } as TranscriptEvent,
  ])

const cardTask = (state: TranscriptState): string | null => {
  const item = state.items.find((one) => one.kind === 'tool') as ToolItem | undefined
  expect(item?.outgoing, 'the call did not land as a card').toBeTruthy()
  return outgoingCard(item!, item!.outgoing as OutgoingCardWords, null, null).piece
}

describe('§2 · `707` GAP-2, D-016 — the sender’s card says the piece its receipt names', () => {
  it('⚑ the receipt’s label → *W1.1*', () => {
    expect(cardTask(theCall({ label: 'W1.1' }))).toBe('W1.1')
  })

  /**
   * ⛔ **D-016 took the project out of a piece's name**, and a ledger written before it still holds
   * receipts carrying `elsewhere`. Replay is a trust boundary: whatever such a row says — a slug,
   * nothing, a wrong type — the card draws the label alone, and *Piece* where there is none.
   */
  it('⛔ a receipt written before D-016, still carrying `elsewhere`, draws the label alone', () => {
    expect(cardTask(theCall({ label: 'W1.1', elsewhere: 'beta' }))).toBe('W1.1')
    expect(cardTask(theCall({ label: 'W1.1', elsewhere: '' }))).toBe('W1.1')
    expect(cardTask(theCall({ label: 'W1.1', elsewhere: 7 }))).toBe('W1.1')
    expect(cardTask(theCall({ elsewhere: 'beta' }))).toBe('Piece')
  })

  it('⚑ the reader both cards share says the label, *Piece* without one, nothing for no piece', () => {
    expect(pieceSays({ label: 'W1.3' })).toBe('W1.3')
    expect(pieceSays({})).toBe('Piece')
    expect(pieceSays(undefined)).toBeNull()
  })
})

/* ================================================================ §3 · GAP-3 / GAP-4 */

const AT = 1_900_000_000_000

const given = (piece: string): WorkGivenOut => ({
  piece,
  label: 'W1.1',
  title: 'the work',
  state: 'working',
  givenToProfile: 'worker',
  givenAt: AT - 60_000,
})

describe('§3 · `707` GAP-3, D-016 — the Work tab spells each row by its label alone', () => {
  const tab = (rows: readonly WorkGivenOut[]) =>
    workGivenOutView({
      reading: {
        conversation: 'sess_brobot',
        walk: {
          rows,
          walk: 'every-conversation-this-one-gave-work-to',
          ledgers: rows.length,
          rowsUnread: 0,
        },
        answered: true,
        at: AT,
      },
      forConversation: 'sess_brobot',
      identities: null,
      now: AT,
    })?.rows.map((row) => row.heading)

  it('⚑ a row’s heading is its label, *W1.1*, and names no project', () => {
    expect(tab([given('work_1')])).toEqual(['W1.1'])
  })
})

const edge = (piece: string, over: Partial<WorkEdge> = {}): WorkEdge => ({
  piece,
  label: 'W1.1',
  title: 'the work',
  from: 'sess_brobot',
  fromIdentity: 'brobot',
  to: 'sess_pm',
  toIdentity: 'pm',
  state: 'working',
  givenAt: AT - 60_000,
  endedAt: null,
  ...over,
})

describe('§3b · `707` GAP-4, D-016 — the work this conversation was GIVEN, by label alone', () => {
  const band = (taken: readonly WorkEdge[]) => {
    const answer = {
      conversation: 'sess_brobot',
      parent: null,
      children: {
        rows: [],
        walk: 'every-conversation-this-one-spawned',
        ledgers: 0,
        rowsUnread: 0,
      },
      workGivenOut: {
        rows: [],
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 0,
        rowsUnread: 0,
      },
      workTakenIn: {
        rows: taken,
        walk: 'every-piece-of-work-this-one-was-given',
        ledgers: taken.length,
        rowsUnread: 0,
      },
      readAt: AT,
    } as unknown as WhoCalledWhom
    return workingTogetherView({
      reading: { conversation: 'sess_brobot', read: answer, answered: true, atWork: null },
      forConversation: 'sess_brobot',
      identities: null,
      now: AT,
    })
  }

  it('⚑ every piece of work this conversation was GIVEN reads by its label', () => {
    const view = band([edge('work_in', { from: 'sess_parent', to: 'sess_brobot' })])
    expect(view?.taken.map((one) => one.piece.reading.heading)).toEqual(['W1.1'])
  })
})

/* ================================================================ §4 · F-5 */

/** The body of one top-level function in a source file, bounded by the next top-level line. */
function bodyOf(source: string, header: string): string {
  const from = source.indexOf(header)
  expect(from, `no ${header} in the source`).toBeGreaterThan(-1)
  expect(source.indexOf(header, from + 1), `a second ${header}`).toBe(-1)
  const end = source.indexOf('\n}\n', from)
  expect(end).toBeGreaterThan(from)
  return source.slice(from, end)
}

/**
 * ⚑ **D-017b retired the take-over notice and the reopen's**: the three presses that could meet a
 * take-over answered and let go in the same moment are one door now (`openConversation`, which
 * looks and starts nothing), `release` keeps the record — the view stays, drawn from its ledger —
 * and a reopen that stopped again as it was handed over is shown, recorded. ⚑ What §4 keeps is
 * standing rule 8.4 (no *try again*) at the door that replaced them, and the store's deletes, each
 * located on a path that opened nothing here.
 */
describe('§4 · `710` F-5, D-017b — the one open door says the host’s words, and never *try again*', () => {
  const screen = read('components/RuntimeScreen.vue')

  it('🔴 the presses go through ONE door, which says the host’s refusal and never *try again*', () => {
    // ⚑ **The door**: it looks, and a refusal is the host's own sentence (`lookError`) — ⚑ UI-007:
    // through `refusedToOpen`, which says the plain sentence where the host gave no words.
    const door = bodyOf(screen, 'async function openConversation(')
    expect(door).toContain('await store.look(sessionId)')
    expect(door).toContain('say(refusedToOpen(store.lookError.value))')
    expect(door).not.toMatch(/try again/i)
    // ⚑ **Its presses** — the queue's travel and a work report's link — reach it, and say nothing
    // of their own.
    for (const header of ['async function goToQuestion(', 'async function goToTheWork(']) {
      const body = bodyOf(screen, header)
      expect(body, header).toContain('openConversation(')
      expect(body, header).not.toMatch(/try again/i)
    }
    // ⛔ The take-over press and its sentence are gone with the fork they answered.
    expect(screen).not.toContain('async function takeOver(')
    expect(screen).not.toContain('HANDED_BACK_AS_IT_WAS_TAKEN')
    // ⚑ …and none left anywhere on the screen, so a copy cannot hide in another function.
    expect(screen).not.toMatch(/try again in a moment/i)
  })

  /**
   * ⚑ **The wider search's fourth** (standing rule 38.4): the reopen's own refusal ended *"— try
   * again"* too. ⚑ **D-017b** — a record that stopped again as it was handed over is SHOWN, recorded
   * (its next message continues it), so there is no refusal left to word: the reopen answers the id
   * whenever the record it adopted is the one the store holds.
   */
  it('🔴 …and the reopen that stopped on its way in is shown, with no refusal to word', () => {
    const store = read('lib/session-store.ts')
    expect(store).not.toContain('ENDED_AS_IT_REOPENED')
    expect(store).toContain('return sessions.get(opened) === into ? opened : null')
    expect(store).not.toMatch(/'[^'\n]*— try again'/)
  })

  /**
   * ⛔ **Where the store forgets a record, pinned where it is derived** — every delete sits on a path
   * that opened nothing here, or lets go of a recorded view nobody looks at. ⚑ **D-017b · and
   * `release` is NOT one**: the record stays and is looked at again, so the view a person was reading
   * stays where it is. If a delete ever appears on a success path, this reddens.
   */
  it('⛔ the store deletes a record only where nothing opened — and never on a release', () => {
    const store = read('lib/session-store.ts')
    const deletes = [...store.matchAll(/sessions\.delete\(/g)].length
    // ⚑ **737 · 3 → 5**, **D-017 · R10 · 5 → 7**, ⚑ **D-017b · 7 → 8, re-aimed and not loosened**:
    // `release` lost its delete, and `look` (a refused look) and `forget` (a recorded view nobody is
    // looking at) each gained one — all located below.
    expect(deletes).toBe(8)
    const method = (header: string): string => {
      const from = store.indexOf(header)
      expect(from, `no ${header}`).toBeGreaterThan(-1)
      return store.slice(from, store.indexOf('\n    },\n', from))
    }
    // ⚑ **D-017b · the release keeps it, recorded, and looks at it again.**
    const release = method('    async release(')
    expect(release).not.toContain('sessions.delete(')
    expect(release).toContain("record.phase = 'recorded'")
    expect(release).toContain("void store.look(released.sessionId, 'again')")
    const claim = method('    async claim(sessionId')
    expect(claim).toContain('const holding = slot(sessionId)')
    const inCatch = claim.slice(claim.indexOf('} catch (error) {'), claim.indexOf('} finally {'))
    expect(inCatch).toContain('if (holding.meta === null) sessions.delete(sessionId)')
    expect(claim.match(/sessions\.delete\(/g)).toHaveLength(1)
    const resume = method('    async resume(sessionId')
    const refused = resume.slice(resume.indexOf('if (!resumed) {'))
    expect(refused.slice(0, refused.indexOf('\n        }\n'))).toContain(
      'if (record.meta === null) sessions.delete(sessionId)',
    )
    // ⚑ **D-017 · R10 — the replaced id's record, and only when nothing was adopted into it.**
    expect(resume).toContain(
      'if (opened !== sessionId && record.meta === null) sessions.delete(sessionId)',
    )
    expect(resume.match(/sessions\.delete\(/g)).toHaveLength(2)
    // ⚑ **D-017b · a look the host refused** — only a record this call made up.
    const look = method("    async look(sessionId, by = 'press')")
    const lookCatch = look.slice(look.indexOf('} catch (cause) {'), look.indexOf('} finally {'))
    expect(lookCatch).toContain('if (holding.meta === null) sessions.delete(sessionId)')
    expect(look.match(/sessions\.delete\(/g)).toHaveLength(1)
    // ⚑ **D-017b · `forget`** — only a RECORDED record nothing is handing over or commanding.
    const forget = method('    forget(sessionId)')
    expect(forget).toContain(
      "if (record === undefined || record.phase !== 'recorded' || record.handover > 0) return",
    )
    expect(forget.match(/sessions\.delete\(/g)).toHaveLength(1)
    // ⚑ **737 · `startAndSend`'s** — no answer (a rejection), an answer that sent nothing and handed
    // nothing over, and R10's replaced id; ⛔ never after an adoption, where the conversation IS here.
    const first = method('    async startAndSend(sessionId')
    const noAnswer = first.slice(first.indexOf('if (answer === undefined) {'))
    expect(noAnswer.slice(0, noAnswer.indexOf('\n        }\n'))).toContain(
      'if (starting.meta === null) sessions.delete(sessionId)',
    )
    expect(first).toMatch(
      /if \(starting\.meta === null\) sessions\.delete\(sessionId\)\n\s*else starting\.error = said\n\s*return \{ sent: false, refusal, openHere: false \}/,
    )
    expect(first).toContain(
      'if (went !== null && starting.meta === null) sessions.delete(sessionId)',
    )
    expect(first.match(/sessions\.delete\(/g)).toHaveLength(3)
  })
})

/* ================================================================ §5 · F-9 */

type Pending = { resolve: (created: CreatedSession) => void; reject: (cause: Error) => void }

function aBridge(): { bridge: RuntimeBridge; launches: Map<string, Pending>; cancelled: string[] } {
  const launches = new Map<string, Pending>()
  const cancelled: string[] = []
  const bridge = {
    onEvent: () => () => {},
    onLiveness: () => () => {},
    attachOpen: () => Promise.resolve({ sessions: [] }),
    createSession: (input: CreateSessionInput & { launchKey: string }) =>
      new Promise<CreatedSession>((resolve, reject) =>
        launches.set(input.launchKey, { resolve, reject }),
      ),
    cancelLaunch: ({ launchKey }: { launchKey: string }) => {
      cancelled.push(launchKey)
      launches.get(launchKey)?.reject(new Error('cancelled'))
      return Promise.resolve(true)
    },
  } as unknown as RuntimeBridge
  // ⚑ **Over the wire** (`361` §2): the store is handed what `ipcRenderer.invoke` would hand it.
  return { bridge: everythingOverTheWire(bridge), launches, cancelled }
}

const INPUT: CreateSessionInput = { provider: 'claude', profileId: 'pm', approvalMode: 'ask' }

describe('§5 · `710` F-9 — the sheet’s launch is its own: key, error and Cancel', () => {
  it('🔴 a refused start from the SHEET lands in `placedError`, and the launcher shows nothing', async () => {
    const { bridge, launches } = aBridge()
    const store = createSessionStore(bridge)
    const started = store.create(INPUT, 'sheet')
    expect(store.isPlacing()).toBe(true)
    // ⛔ The launcher is NOT put into `starting` by a press it did not make.
    expect(store.isLaunching()).toBe(false)
    const [key] = [...launches.keys()]
    launches.get(key!)!.reject(new Error('Claude is not signed in on this machine.'))
    expect(await started).toBeNull()
    expect(store.placedError.value).toBe('Claude is not signed in on this machine.')
    expect(store.launchError.value).toBeNull()
    expect(store.isPlacing()).toBe(false)
  })

  it('⚑ THE CONTROL — the front door’s refusal is the launcher’s, as it always was', async () => {
    const { bridge, launches } = aBridge()
    const store = createSessionStore(bridge)
    const started = store.create(INPUT)
    expect(store.isLaunching()).toBe(true)
    launches.get([...launches.keys()][0]!)!.reject(new Error('refused'))
    expect(await started).toBeNull()
    expect(store.launchError.value).toBe('refused')
  })

  it('🔴 …and the front door’s launch is not the sheet’s: neither its flag nor its refusal', async () => {
    const { bridge, launches } = aBridge()
    const store = createSessionStore(bridge)
    const started = store.create(INPUT)
    expect(store.isPlacing()).toBe(false)
    launches.get([...launches.keys()][0]!)!.reject(new Error('refused'))
    await started
    expect(store.placedError.value).toBeNull()
  })

  it('⛔ a second try clears the sheet’s last refusal the moment it is asked — never beside its own spinner', async () => {
    const { bridge, launches } = aBridge()
    const store = createSessionStore(bridge)
    const first = store.create(INPUT, 'sheet')
    launches.get([...launches.keys()][0]!)!.reject(new Error('refused once'))
    await first
    expect(store.placedError.value).toBe('refused once')
    void store.create(INPUT, 'sheet')
    expect(store.isPlacing()).toBe(true)
    expect(store.placedError.value).toBeNull()
  })

  /**
   * 🔴 **`718`'s review — two sheet launches at once** (a sheet closed while its start ran, and
   * another started): the first one's refusal is ITS OWN, handed to its own caller, and never drawn
   * beside the second one's spinner.
   */
  it('🔴 a superseded sheet launch’s refusal goes to its own caller — never into the current launch’s ref', async () => {
    const { bridge, launches } = aBridge()
    const store = createSessionStore(bridge)
    const heardByA: string[] = []
    const heardByB: string[] = []
    const a = store.create(INPUT, 'sheet', (said) => heardByA.push(said))
    void store.create(INPUT, 'sheet', (said) => heardByB.push(said))
    const [aKey] = [...launches.keys()]
    launches.get(aKey!)!.reject(new Error('A was refused'))
    expect(await a).toBeNull()
    expect(heardByA).toEqual(['A was refused'])
    // ⛔ B is still starting, and its surface is handed nothing of A's.
    expect(store.isPlacing()).toBe(true)
    expect(store.placedError.value).toBeNull()
    expect(heardByB).toEqual([])
  })

  it('⚑ THE CONTROL — the CURRENT launch’s refusal lands in the ref and in its caller alike', async () => {
    const { bridge, launches } = aBridge()
    const store = createSessionStore(bridge)
    const heard: string[] = []
    const one = store.create(INPUT, 'sheet', (said) => heard.push(said))
    launches.get([...launches.keys()][0]!)!.reject(new Error('refused'))
    await one
    expect(store.placedError.value).toBe('refused')
    expect(heard).toEqual(['refused'])
  })

  it('🔴 the sheet’s Cancel stops the SHEET’s launch — and says nothing, as a Cancel should', async () => {
    const { bridge, cancelled, launches } = aBridge()
    const store = createSessionStore(bridge)
    const front = store.create(INPUT)
    const sheet = store.create(INPUT, 'sheet')
    const [frontKey, sheetKey] = [...launches.keys()]
    expect(await store.cancelPlaced()).toBe(true)
    // ⛔ **Asserted BEFORE awaiting the sheet** (`718`'s review): were the front door's launch the one
    // cancelled, the sheet's promise would never settle and the defect would read as a timeout.
    expect(cancelled).toEqual([sheetKey])
    expect(cancelled).not.toContain(frontKey)
    expect(store.isLaunching()).toBe(true)
    expect(await sheet).toBeNull()
    expect(store.placedError.value).toBeNull()
    expect(store.isPlacing()).toBe(false)
    void front
  })

  /**
   * 🔴 **The two moments a sheet launch settles in, as data** (`placed-launch.ts`) — `RuntimeScreen`
   * is mounted by no test, so the decision it makes is made HERE and the screen is read below for
   * routing through it (`718`'s review: its guards were pinned by nothing).
   */
  it('🔴 opened: close the sheet that asked — and only if it is still the one up', () => {
    expect(afterAPlacedLaunch({ kind: 'opened' }, true)).toEqual({ close: true, notice: null })
    // ⛔ Another overlay is up now — a fresh sheet mid-typing — and it is not this launch's to close.
    expect(afterAPlacedLaunch({ kind: 'opened' }, false)).toEqual({ close: false, notice: null })
  })

  it('🔴 refused: the sheet that asked draws it; a sheet that is gone has it SAID, once', () => {
    expect(afterAPlacedLaunch({ kind: 'refused', sentence: 'no' }, true)).toEqual({
      close: false,
      notice: null,
    })
    expect(afterAPlacedLaunch({ kind: 'refused', sentence: 'no' }, false)).toEqual({
      close: false,
      notice: 'no',
    })
  })

  it('🔴 the screen closes the sheet only when the conversation OPENS, and scopes what it draws to it', () => {
    const screen = read('components/RuntimeScreen.vue')
    const placed = bodyOf(screen, 'function startPlaced(')
    // ⛔ **The close is inside `start`'s `opened` callback and nowhere else** (`718`'s review: a text
    // order could not tell a close in the callback from one right after the ask).
    const opened = placed.slice(placed.indexOf('opened: () => {'), placed.indexOf('refused: ('))
    expect(opened).toContain(
      "if (afterAPlacedLaunch({ kind: 'opened' }, stillThere()).close) overlays.close()",
    )
    expect(placed.split('overlays.close()')).toHaveLength(2)
    expect(placed).toContain("'sheet'")
    // ⚑ A refusal whose sheet is gone goes to the lane that paints ABOVE an overlay — never the
    // frame's own `.toast`, which paints under the scrim (`718`'s review).
    expect(placed).toContain(
      "const { notice } = afterAPlacedLaunch({ kind: 'refused', sentence: refusal }, stillThere())",
    )
    expect(placed).toContain('if (notice !== null) overlays.notify(notice)')
    expect(placed).not.toMatch(/\bsay\(/)
    // ⚑ …and the sheet is handed the store's ONE sheet launch only if it is the sheet that asked.
    const tag = screen.slice(
      screen.indexOf('<StartAsAgent\n'),
      screen.indexOf('/>', screen.indexOf('<StartAsAgent\n')),
    )
    expect(tag).toContain(':busy="placedHere && store.isPlacing()"')
    expect(tag).toContain(':error="placedHere ? store.placedError.value : null"')
    expect(tag).toContain('@cancel="void store.cancelPlaced()"')
    // ⛔ And `start` hands the sheet's words to no one — its composer keeps them.
    const start = bodyOf(screen, 'async function start(')
    expect(start).toContain("if (door === 'sheet') return")
  })

  /**
   * 🔴 **`718`'s second review round — the screen's own hops, each pinned where it is written.**
   * ⛔ Every one of these reintroduces `710` F-9 with every other test green: the sheet never learns
   * its launch is its own (`placedFrom`), a close is taken for the sheet still being up
   * (`stillThere`), the refusal never reaches the caller (`told.refused`), the sheet never closes on
   * success (`told.opened`), or the refusal is never kept for the notice.
   */
  it('🔴 the screen’s own hops for a sheet launch — each one read where it is written', () => {
    const screen = read('components/RuntimeScreen.vue')
    const placed = bodyOf(screen, 'function startPlaced(')
    expect(placed).toContain('  placedFrom.value = sheet\n')
    expect(placed).toContain(
      'const stillThere = (): boolean => sheet !== null && overlays.overlay.value === sheet',
    )
    expect(placed).toMatch(/refused: \(sentence\) => \{\s*refusal = sentence\s*\}/)
    expect(screen).toMatch(
      /const placedHere = computed\(\s*\(\) => placedFrom\.value !== null && placedFrom\.value === overlays\.overlay\.value,?\s*\)/,
    )
    const start = bodyOf(screen, 'async function start(')
    expect(start).toContain('const sessionId = await store.create(input, door, told.refused)')
    // ⚑ The sheet closes when the conversation OPENS — after the refused arm, before it is shown.
    const opened = start.indexOf('  told.opened?.()\n  showConversation(sessionId, from)')
    expect(opened).toBeGreaterThan(start.indexOf('if (!sessionId) {'))
  })

  /**
   * 🔴 **`718`'s second review round — closing the sheet while its launch runs cancels it.** ⛔ The
   * sheet is that launch's only Cancel, and a closed sheet could neither draw its refusal nor give
   * its words back. ⚑ Every overlay closes through `closeOverlay` — the sheet's ×, and the host's Esc
   * and backdrop — so no way of closing it skips the rule.
   */
  it('🔴 closing the sheet while its launch runs cancels that launch — by every way of closing it', () => {
    const screen = read('components/RuntimeScreen.vue')
    const close = bodyOf(screen, 'function closeOverlay(')
    expect(close).toContain('if (placedHere.value && store.isPlacing()) void store.cancelPlaced()')
    expect(close.indexOf('overlays.close()')).toBeGreaterThan(close.indexOf('cancelPlaced'))
    const host = screen.slice(
      screen.indexOf('<OverlayHost'),
      screen.indexOf('>', screen.indexOf('<OverlayHost')),
    )
    expect(host).toContain('v-if="overlays.overlay.value"')
    expect(host).toContain('@close="closeOverlay()"')
    const tag = screen.slice(
      screen.indexOf('<StartAsAgent\n'),
      screen.indexOf('/>', screen.indexOf('<StartAsAgent\n')),
    )
    expect(tag).toContain('@close="closeOverlay()"')
  })
})
