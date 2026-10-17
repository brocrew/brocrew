import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ALWAYS_HONOURED } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { THE_APP_ITSELF, mayAnswerAsAHuman } from '../src/main/runtime/runtime-host'
import {
  WHO_STOPPED_IT,
  howWorkStopped,
  stoppedBy,
  whoCancelledIt,
  type WhoStoppedIt,
} from '../src/shared/how-work-stopped'
import { WHO_DID_IT, WHO_DID_IT_SAYS, type ActedBy } from '../src/shared/who-did-it'
import { TASK_STALL_CAUSES, UNDRIVEN_SENTENCES, derivePieces } from '../src/shared/tasks'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **494 · the act this app knows the author of** — `492` F2, repaired at the READER.
 *
 * ## ⛔ The defect, and the framing the PM corrected before it was built
 *
 * ⚠️ **`492` measured `stalled_by: null` (`asked_to_stop_by` since `724`, R82) for a turn a person
 * had genuinely stopped** and priced a
 * second {@link WorkInterruptedEvent} written from `RuntimeHost.respondPermission`. ⛔ **The actor
 * was already recorded.** {@link UserDecisionEvent.by} has carried it since `477` — derived from
 * the caller, written unconditionally, by the one writer that can spell `cancel` — and
 * `how-work-stopped.ts` read three event types, none of which was that one.
 *
 * 🔴 **So this dispatch writes NOTHING new.** `491`'s assertion — *a cancel writes no
 * `work_interrupted`* — is still true and is asserted beside every repaired reading; HO-029 §2.2's
 * *do not backfill* was never in the way, because nothing is backfilled. ⚑ **It is `484`'s own
 * sentence — *every reader joins on the turn* — recurring inside the reader `484` built.**
 *
 * ## ⚑ What this suite establishes
 *
 *  - **§1** — {@link whoCancelledIt} over every shape a decision row can hold, including the two
 *    this build's own producers cannot write.
 *  - **§2** — both folds, over ledgers where the two producers DIVERGE, so neither field is a
 *    constant and a leak and a join give different answers.
 *  - **§3** — the doors: a search shape over the writers, not a claim about how many there are.
 *  - **§4** — the vocabulary, derived rather than chosen, and the excluded member's RAIL.
 *  - **§5** — the replayed path: the three narrow reads that must name the new type.
 *
 * ⚑ **The product-path halves live where their subjects do** — `list_tasks` in
 * `state-a-supervisor-can-trust.test.ts` §7, the card and both card-level fields in
 * `the-interruption-that-looks-like-a-fault.test.ts` §3.
 */
describe('494 · the act this app knows the author of', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const sharedRoot = join(here, '../src/shared')
  const mainRoot = join(here, '../src/main')
  const sourceOf = (root: string, file: string): string => readFileSync(join(root, file), 'utf8')
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const person: ActedBy = { who: 'a-person' }
  const agent = (id: string): ActedBy => ({ who: 'an-agent', agent: id })

  let ordinal = 0
  let clock = 1_700_000_000_000
  const row = (event: TranscriptEvent): PersistedEventInfo => ({
    ordinal: ordinal++,
    at: (clock += 1_000),
    event,
  })
  const cancelled = (by?: ActedBy): TranscriptEvent =>
    ({
      type: 'user_decision',
      requestId: `req_${String(ordinal)}`,
      outcome: 'cancel',
      ...(by === undefined ? {} : { by }),
    }) as TranscriptEvent
  const given = (piece: string, label = 'W1.1'): TranscriptEvent => ({
    type: 'work_given',
    piece,
    label,
    parent: 'work_root_pm',
    givenBy: 'sess_pm',
    title: 'the work this dispatch is about',
    brief: 'the work this dispatch is about',
  })

  beforeEach(() => {
    ordinal = 0
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the derivation — every shape a decision row can carry
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · whoCancelledIt', () => {
    it('🔴 names the two actors that answer cards, and carries the conversation on the arm that has one', () => {
      expect(whoCancelledIt(person)).toEqual({ by: 'a-person', asker: null })
      expect(whoCancelledIt(agent('sess_pm'))).toEqual({ by: 'an-agent', asker: 'sess_pm' })
    })

    it('⚠️ a row written before 477 answers null — HO-029 §2.2, and nothing backfills it', () => {
      // ⛔ **`undefined` is a fact about WHEN the row was written**, never *an actor we failed to
      // write*: every writer writes it unconditionally. ⚑ So this stays `null` for that population
      // for as long as its ledger exists.
      expect(whoCancelledIt(undefined)).toBeNull()
    })

    it('⛔ an agent arm with no id reads as the bare word, exactly as a replayed ask always has', () => {
      // ⚠️ **A persisted payload is `JSON.parse`d and CAST**, so the union's guarantee is a
      // compile-time one and this is the runtime. ⛔ `stoppedBy`'s own sentence — *"'an agent' when
      // the row carries no id"* — is the honest generalisation, and a blank would not be.
      const replayed = { who: 'an-agent' } as unknown as ActedBy
      expect(whoCancelledIt(replayed)).toEqual({ by: 'an-agent', asker: null })
      expect(stoppedBy('an-agent', null)).toBe('an agent')
    })

    it('🔴 the two words this build cannot write here are DROPPED rather than guessed at', () => {
      // ⛔ **`the-app-itself` is refused at the door** — see §4, where the rail is exercised rather
      // than described. ⚑ A reading that named it would claim an actor `mayAnswerAsAHuman` makes
      // unreachable.
      expect(whoCancelledIt({ who: 'the-app-itself' })).toBeNull()
      // ⚠️ **A word from a build whose vocabulary has moved** — the LEDGER boundary, `isWhoDidIt`'s
      // rule. ⛔ Reporting it as `a-person` is the confident sentence criterion 18 exists to prevent.
      expect(whoCancelledIt({ who: 'a-word-from-the-future' } as unknown as ActedBy)).toBeNull()
      // ⚑ **And the member that IS in**, so the two drops are not one blanket refusal.
      expect(whoCancelledIt({ who: 'a-caller-this-app-cannot-name' })).toEqual({
        by: 'a-caller-this-app-cannot-name',
        asker: null,
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · both folds, measured where the two readings diverge
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the folds', () => {
    it('🔴 a cancel and an interrupt in ONE ledger — the last ask wins, and neither field is the constant', () => {
      // ⛔ **The divergence** (standing rule 3): an AGENT asks first and a PERSON cancels second, so
      // *the old ask leaked* answers `an-agent` and *the decision was read* answers `a-person`.
      // ⚠️ Tested where both readings give the same answer, this would measure nothing.
      const entries = [
        row(given('work_1')),
        row({ type: 'work_interrupted', by: 'an-agent', agent: 'sess_pm' }),
        row(cancelled(person)),
        row({ type: 'turn', state: 'interrupted' }),
      ]
      expect(derivePieces('sess_worker', entries)[0]).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
        stalledBy: { by: 'a-person', asker: null },
      })
      expect(howWorkStopped(entries)).toEqual({
        how: 'it-was-stopped',
        who: 'a-person',
        asker: null,
      })
    })

    it('⚑ and the other order gives the other answer, which is what makes it the LAST ask', () => {
      const entries = [
        row(given('work_1')),
        row(cancelled(person)),
        row({ type: 'work_interrupted', by: 'an-agent', agent: 'sess_pm' }),
        row({ type: 'turn', state: 'interrupted' }),
      ]
      expect(derivePieces('sess_worker', entries)[0]).toMatchObject({
        stalledBy: { by: 'an-agent', asker: 'sess_pm' },
      })
      expect(howWorkStopped(entries)).toMatchObject({ who: 'an-agent', asker: 'sess_pm' })
    })

    it('⛔ a cancel this app cannot name CLEARS an earlier ask rather than inheriting it', () => {
      // 🔴 **`491`'s defect, one producer over.** ⚠️ The agent asked, the app then recorded a
      // cancellation whose author it does not know, and the turn ended. ⛔ Naming the agent would
      // put them on a press they did not make; `null` is *this ledger does not say*.
      const entries = [
        row(given('work_1')),
        row({ type: 'work_interrupted', by: 'an-agent', agent: 'sess_pm' }),
        row(cancelled()),
        row({ type: 'turn', state: 'interrupted' }),
      ]
      expect(derivePieces('sess_worker', entries)[0]).toMatchObject({
        stalledBecause: 'turn_interrupted',
        stalledBy: null,
      })
      expect(howWorkStopped(entries)).toMatchObject({ who: null, asker: null })
    })

    it('⚠️ every OTHER decision outcome moves nothing — they answer a request, not a turn', () => {
      // ⛔ **The control that makes `cancel` the discriminator rather than the event type.** ⚑ A
      // branch that remembered them all would name whoever allowed a tool as the author of whatever
      // ended the turn next.
      for (const outcome of [
        'allow',
        'allow_for_session',
        'allow_all_for_session',
        'deny',
        'answered',
        'rejected',
      ]) {
        const entries = [
          row(given('work_1')),
          row({ type: 'user_decision', requestId: 'r', outcome, by: person } as TranscriptEvent),
          row({ type: 'turn', state: 'interrupted' }),
        ]
        expect(derivePieces('sess_worker', entries)[0], outcome).toMatchObject({ stalledBy: null })
        expect(howWorkStopped(entries), outcome).toMatchObject({ who: null })
      }
      // ⚑ **The same fixture one fact over, ALLOWED** — so the loop above is a refusal and not a
      // fold that ignores this event type altogether.
      const admitted = [
        row(given('work_1')),
        row(cancelled(person)),
        row({ type: 'turn', state: 'interrupted' }),
      ]
      expect(derivePieces('sess_worker', admitted)[0]).toMatchObject({
        stalledBy: { by: 'a-person', asker: null },
      })
    })

    it('🔴 720 · R72 — a cancel whose turn FINISHED anyway stalls on the provider’s word AND names who asked', () => {
      // ⛔ **`494`'s pin, MOVED ON PURPOSE.** It read `stalledBy: null` here — *"a turn that
      // completed is `turn_ended` and carries no actor"* — while `howWorkStopped`, over the same
      // rows, said `who: 'a-person'`: two readers of one ledger disagreeing about one fact (`709`
      // F-2). ⚑ **R72:** *"A turn asked to stop that the provider completed anyway stalls with the
      // provider's word AND the one who asked (R43's two facts)."* ⚑ The CAUSE is still the turn's own
      // word — `turn_ended`, never `turn_interrupted` — so nothing claims anybody stopped it; the ask
      // rides beside it, and the stall notice says it as an ask (`theStallAndItsAsk`).
      const entries = [
        row(given('work_1')),
        row(cancelled(person)),
        row({ type: 'turn', state: 'completed' }),
      ]
      expect(derivePieces('sess_worker', entries)[0]).toMatchObject({
        stalledBecause: 'turn_ended',
        stalledBy: { by: 'a-person', asker: null },
      })
      // ⚑ …and the two readers now AGREE about the ledger.
      expect(howWorkStopped(entries)).toMatchObject({ how: 'it-finished', who: 'a-person' })
    })

    it('🔴 720 · R72 — …and a Stop (`work_interrupted`) the provider finished anyway, and one it FAILED', () => {
      // ⚑ `probe:codex-early-interrupt` measured Codex completing a turn after `turn/interrupt`
      // (`709`, R43), so this is an ordinary state rather than a race.
      for (const ending of ['completed', 'failed'] as const) {
        const entries = [
          row(given('work_1')),
          row({ type: 'work_interrupted', by: 'an-agent', agent: 'sess_pm' }),
          row({ type: 'turn', state: ending }),
        ]
        expect(derivePieces('sess_worker', entries)[0], ending).toMatchObject({
          stalledBecause: 'turn_ended',
          stalledBy: { by: 'an-agent', asker: 'sess_pm' },
        })
        expect(howWorkStopped(entries), ending).toMatchObject({ who: 'an-agent', asker: 'sess_pm' })
      }
    })

    it('⚑ 720 · CONTROLS — a completed turn nobody asked, an ask from another turn, an ask after the ending', () => {
      const cases: [string, TranscriptEvent[]][] = [
        ['nobody asked', [given('work_1'), { type: 'turn', state: 'completed' }]],
        // ⚑ 491's boundary: the ask belonged to the turn a `user_turn` closed. ⚑ **F097** — the
        // giver's note opens it: one a person's own words opened would leave the work waiting on them.
        [
          'an earlier turn’s ask',
          [
            given('work_1'),
            cancelled(person),
            {
              type: 'user_turn',
              text: 'go on',
              attribution: 'app_authored',
              relayedFrom: 'sess_pm',
              says: 'note',
            } as TranscriptEvent,
            { type: 'turn', state: 'completed' },
          ],
        ],
        [
          'an ask after the ending',
          [
            given('work_1'),
            { type: 'turn', state: 'completed' },
            { type: 'work_interrupted', by: 'a-person' },
          ],
        ],
      ]
      for (const [what, events] of cases) {
        expect(derivePieces('sess_worker', events.map(row))[0], what).toMatchObject({
          stalledBecause: 'turn_ended',
          stalledBy: null,
        })
      }
    })

    it('⚑ a later turn cannot inherit an earlier turn’s cancel — 491’s boundary, for the new producer', () => {
      const entries = [
        row(given('work_1')),
        row(cancelled(person)),
        row({ type: 'turn', state: 'interrupted' }),
        row({ type: 'user_turn', text: 'carry on' } as TranscriptEvent),
        row(given('work_2', 'W1.2')),
        row({ type: 'turn', state: 'interrupted' }),
      ]
      // ⚑ **The control: the first turn's ending carries the person's cancel.**
      expect(derivePieces('sess_worker', entries.slice(0, 3))[0]).toMatchObject({
        stalledBy: { by: 'a-person', asker: null },
      })
      const rows = derivePieces('sess_worker', entries)
      // ⛔ **The second task's turn was interrupted by something that wrote no ask at all** — a
      // window closing a conversation, say. ⚑ The first turn's person must not be lent to it.
      expect(rows[1]).toMatchObject({
        piece: 'work_2',
        label: 'W1.2',
        stalledBecause: 'turn_interrupted',
        stalledBy: null,
      })
      // 🔴 **D-005 (F019): `carry on` drove the first task again**, so its stall is the later
      // turn's too — and that turn's ending does not inherit the earlier cancel either.
      expect(rows[0]).toMatchObject({
        piece: 'work_1',
        label: 'W1.1',
        stalledBecause: 'turn_interrupted',
        stalledBy: null,
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the doors — a search shape, never a count
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · every door a person can stop a turn from', () => {
    it('🔴 exactly ONE writer of a `user_decision` can spell `cancel`, and it is the permission door', () => {
      // ⛔ **The search shape** (standing rule 4): the enumeration is every place the host builds
      // this event, and what each one puts in `outcome`. ⚠️ A claim of the form *"the N doors"*
      // would go quietly wrong the first time a sixth writer appeared; this goes red.
      const host = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const outcomes = [
        ...host.matchAll(/type: 'user_decision',[\s\S]{0,200}?outcome: ([^,\n]+)/g),
      ].map((match) => (match[1] ?? '').trim())
      expect(outcomes.length, 'the writers of a decision row').toBeGreaterThan(1)
      expect(outcomes.filter((one) => one === 'decision.outcome')).toHaveLength(1)
      for (const other of outcomes.filter((one) => one !== 'decision.outcome')) {
        expect(other, 'a writer that can spell cancel without being the permission door').toMatch(
          // ⚑ **D-009 · `'rejected'` — an agent saying it cannot answer**, which cannot spell cancel.
          /^('answered'|'rejected'|response\.kind === 'answer' \? 'answered' : 'rejected')$/,
        )
      }
      // ⚑ **The control that plants TWO** (standing rule 12): the matcher over two writers in one
      // string, so a pattern that could only ever see the first fails here.
      const planted = [
        "      type: 'user_decision',\n      requestId,\n      outcome: 'answered',",
        "      type: 'user_decision',\n      requestId,\n      outcome: decision.outcome,",
      ].join('\n')
      expect([
        ...planted.matchAll(/type: 'user_decision',[\s\S]{0,200}?outcome: ([^,\n]+)/g),
      ]).toHaveLength(2)
    })

    it('⛔ so the door set is the CARD set — `cancel` is a floor every adapter honours', () => {
      // ⚠️ **This is what makes the answer *every door* rather than *the doors I looked at*.**
      // `ALWAYS_HONOURED` is the outcome both adapters accept whatever the request offered, so a
      // card that never listed `cancel` still takes one — and every such answer reaches the one
      // host writer above.
      expect(ALWAYS_HONOURED).toContain('cancel')
    })

    it('🔴 three adapter mechanisms stop a turn, and each is found where it lives', () => {
      // ⛔ **The doors differ in the ADAPTER and not in the ledger**, which is why one reader
      // repairs all of them. ⚠️ Each mechanism is asserted by name so a fourth adapter arriving
      // with a fourth mechanism is a red test rather than a silent gap in a sentence.
      const runtime = join(here, '../../../packages/runtime/src')
      const codex = codeOnly(sourceOf(join(runtime, 'codex'), 'codex-runtime.ts'))
      const claude = codeOnly(sourceOf(join(runtime, 'claude'), 'claude-runtime.ts'))
      // 492 · the agent-tool card, where the ask IS the frame.
      expect(codex).toContain('await this.askTheTurnToStop(')
      // the command or file approval, where the ask is Codex's own decision word.
      expect(codex).toContain("if (decision.outcome === 'cancel') this.machine.requestInterrupt()")
      // Claude's `canUseTool`, where the ask is a field of the result.
      expect(claude).toContain(
        "return { behavior: 'deny', message: 'cancelled by user', interrupt: true }",
      )
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the vocabulary the reading may name
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · WHO_STOPPED_IT', () => {
    it('🔴 is DERIVED from the caller vocabulary, so a fifth caller kind cannot be missed', () => {
      expect([...WHO_STOPPED_IT]).toEqual(WHO_DID_IT.filter((word) => word !== 'the-app-itself'))
      // ⚠️ **501 · the event's vocabulary IS this one, and it used to be a SUBSET.**
      // `WorkInterruptedEvent.by` took a hand-written `WHO_ASKED_IT_TO_STOP` of two words while
      // `recordTheAsk` spelled them itself; that writer now asks `whoDidIt` and refuses the app,
      // so the two lists collapsed into this one. ⛔ The pin is the WRITER's source, because a
      // type cannot be asserted at runtime — see §4's producer test below.
      expect(codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))).toContain(
        'by: actor.who,',
      )
      // ⚑ **Every member owns a sentence, and it is the vocabulary's own table** — one phrasing,
      // so the Sessions row and the digest cannot disagree about an actor.
      for (const word of WHO_STOPPED_IT) {
        expect(stoppedBy(word, null), word).toBe(WHO_DID_IT_SAYS[word])
      }
      // ⛔ **The agent arm prefers the conversation id**, which is the one place the two differ.
      expect(stoppedBy('an-agent', 'sess_pm')).toBe('sess_pm')
    })

    it('⛔ the excluded member is excluded by a RAIL — the app cannot answer a card at all', () => {
      // 🔴 **An actual refusal paired with the same call one fact over ALLOWED** (standing rule 3).
      // ⚠️ `mayAnswerAsAHuman` opens with `by !== THE_APP_ITSELF`, so `respondPermission` never
      // writes a row whose actor is the app — which is why `the-app-itself` is not a member above,
      // and why it is not a coverage gap either.
      const slot = { ownerId: 'webContents:494', ownerIsAPerson: true }
      expect(mayAnswerAsAHuman(slot, THE_APP_ITSELF)).toBe(false)
      expect(mayAnswerAsAHuman(slot, { ownerId: 'webContents:494' })).toBe(true)
      // ⚑ **And the other two conjuncts still refuse**, so the positive above is the app-ness and
      // not a slot that admits anybody.
      expect(mayAnswerAsAHuman(slot, { ownerId: 'webContents:other' })).toBe(false)
      expect(
        mayAnswerAsAHuman(
          { ownerId: 'webContents:494', ownerIsAPerson: false },
          { ownerId: 'webContents:494' },
        ),
      ).toBe(false)
    })

    it('⚑ `stalled_because` is NOT widened — the word was already truthful and already produced', () => {
      // 🔴 **The PM's §2.1, answered from the code rather than from a preference.** ⛔ The cause is
      // read off the TURN's own terminal and never off the door, so a cancel has produced
      // `turn_interrupted` since `400` and this dispatch adds no member and changes no sentence.
      // ⚑ **D-017 · R10 added one, and it is not about who stopped a turn**: `could_not_be_reopened`
      // is written at a `replaced_by` row — the conversation holding the work was replaced — so the
      // cancel's word is still `turn_interrupted` and nothing here moved. ⚑ **D-016c took one away,
      // and it was not about who stopped a turn either**: a stop moves no piece, so there is no stop
      // cause, and a cancel's word is still `turn_interrupted`. ⚑ **`background_stopped` added one,
      // and it is not about who stopped a turn**: it is written where a conversation's end took the
      // background work a piece waited on — what stopped is that work — so a cancel's word is still
      // `turn_interrupted`, and a stop that cut no background work still moves no piece.
      expect([...TASK_STALL_CAUSES]).toEqual([
        'turn_ended',
        'turn_interrupted',
        'app_restarted',
        'message_never_sent',
        'could_not_be_reopened',
        'background_stopped',
        // ⚑ **F074 added one, and it is not about who stopped a turn either**: the provider refused
        // the turn for its usage limit, which its `turn` row says — a cancel's word is still
        // `turn_interrupted`.
        'provider_limited',
        // ⚑ **F076 added one, and it is not about who stopped a turn either**: the provider refused
        // the turn on a login this Mac had moved on from, which its `turn` row or its session's
        // terminal `status` says — a cancel's word is still `turn_interrupted`.
        'login_refused',
        // Not about who stopped a turn either: the provider would not bill the account the turn ran
        // on, which its `turn` row says, so a cancel's word is still `turn_interrupted`.
        'billing_refused',
      ])
      expect(UNDRIVEN_SENTENCES.turn_interrupted).toBe('the turn it was running in was stopped.')
      const fold = codeOnly(sourceOf(sharedRoot, 'tasks.ts'))
      // ⚑ **D-013 · re-aimed, the property unchanged**: the turn arm hands `endOfDrive` its own
      // terminal's state, and that one helper chooses the cause — so a background wake's end, which
      // has no terminal, is judged by the same choice rather than a second one.
      // ⚑ **F074** — and the usage limit its row carries, which chooses the third word.
      // ⚑ **F076** — and whether its row says it failed on a refused login, which chooses the fourth;
      // and whether that login was an API key, which changes the words and not the cause.
      // And whether its row says its provider would not bill, which chooses the fifth.
      expect(fold.replace(/\s+/g, ' ')).toContain(
        "endOfDrive( event.state === 'interrupted', entry.at, theLimitItEndedOn(event, entry.at), event.state === 'failed' && event.loginRefused === true, event.state === 'failed' && event.onAKey === true, event.state === 'failed' && event.billingRefused === true, )",
      )
      expect(fold.replace(/\s+/g, ' ')).toContain(
        "interrupted ? 'turn_interrupted' : limit !== undefined ? 'provider_limited' : billingRefused ? 'billing_refused' : 'turn_ended'",
      )
      // ⚠️ **And the decision branch chooses no cause**, which is what keeps *the ending stalls the
      // work* true: it assigns the remembered actor and nothing else.
      const opens = fold.indexOf("if (event.type === 'user_decision') {")
      expect(opens, 'the decision branch was renamed or removed').toBeGreaterThan(0)
      const branch = fold.slice(
        opens,
        fold.indexOf("if (event.type === 'work_interrupted')", opens),
      )
      expect(branch).toContain('asked = whoCancelledIt(event.by)')
      expect(branch).not.toContain('stall(')
      expect(branch).not.toContain('settle(')
    })

    it('⚠️ every member of the reading vocabulary has a producer, named', () => {
      // ⛔ **The test the removed `this-app` failed, applied to an actor.** ⚑ **501 · all three
      // are now written by both producers**, and the third used to be `whoDidIt`'s alone: the
      // residue reaches `mayAnswerAsAHuman` the moment a caller that is neither a window nor a
      // conversation declares a person — {@link WhoDidIt}'s own shipped argument — and it reaches
      // `recordTheAsk` through any door that stops a turn.
      const producers: Readonly<Record<WhoStoppedIt, string>> = {
        'a-person': 'recordTheAsk and whoDidIt',
        'an-agent': 'recordTheAsk and whoDidIt',
        'a-caller-this-app-cannot-name': 'recordTheAsk and whoDidIt',
      }
      expect(Object.keys(producers).sort()).toEqual([...WHO_STOPPED_IT].sort())
      const host = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      expect(host).toContain("return { who: 'a-caller-this-app-cannot-name' }")
      // 🔴 **501 · the writer asks the one derivation, and the negative is what keeps it asked.**
      // ⛔ `recordTheAsk` wrote `speaking === null ? 'a-person' : 'an-agent'` — a NEGATIVE test
      // that put every caller which is neither a window nor a conversation on the person's side —
      // and this file asserted that spelling until `501`. ⚑ `codeOnly` strips comments, so the
      // withdrawn line quoted in that method's docblock does not satisfy either assertion.
      expect(host).toContain('const actor = whoDidIt(by)')
      expect(host).not.toContain("speaking === null ? 'a-person' : 'an-agent'")
      // ⚠️ **The control for the negative** (standing rule 4): the same `toContain` shape over the
      // same text finds the spelling one function over, so the absence above is a measurement.
      expect(host).toContain('const speaking = sessionSpeakingAs(by)')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the replayed path, and the old population through a real store
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the store', () => {
    let db: AppDatabase
    let store: SessionStore
    let userData: string
    let now = 1_700_000_000_000

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-494-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, join(here, '../src/main/db/migrations'))
      store = createSessionStore(db, () => (now += 1_000))
    })

    afterEach(() => {
      db.close()
      rmSync(userData, { recursive: true, force: true })
    })

    const ledgerFor = (id: string, events: readonly TranscriptEvent[]): void => {
      store.create({
        id,
        provider: 'codex',
        cwd: userData,
        approvalMode: 'ask',
        profileId: id,
      })
      events.forEach((event, index) => {
        store.append(id, index, event, (now += 1_000))
      })
    }

    it('🔴 the three narrow reads all name the new type — a fold that reads it and a query that does not is silent', () => {
      // ⛔ **The pair that can drift, for the two statements that had no census.** ⚠️
      // `selectPieceEvents` is censused against `derivePieces` in `a-task-you-can-see.test.ts` §7;
      // these two are censused against the fold that reads them. ⚑ A type folded but not selected
      // reads as *that event never happened* — silently, on the replayed path only.
      const statement = sourceOf(join(mainRoot, 'db'), 'session-store.ts')
      for (const name of [
        'selectLastTurnEndingEvents',
        'selectLastAskToStop',
        'selectPieceEvents',
      ]) {
        const opens = statement.indexOf(`const ${name} = db.prepare(`)
        expect(opens, `${name} was renamed or removed`).toBeGreaterThan(0)
        const body = statement.slice(opens, statement.indexOf('  )', opens))
        expect(body, name).toContain("'user_decision'")
      }
      // ⚑ **The control that plants TWO** (standing rule 12): a second `db.prepare(` in the same
      // string, so a slice that ran to the end of the file rather than to its own statement fails.
      const planted = [
        '  const selectLastAskToStop = db.prepare(\n    `SELECT 1`,\n  )',
        "  const selectSomethingElse = db.prepare(\n    `SELECT 'user_decision'`,\n  )",
      ].join('\n')
      const opens = planted.indexOf('const selectLastAskToStop = db.prepare(')
      expect(planted.slice(opens, planted.indexOf('  )', opens))).not.toContain("'user_decision'")
    })

    it('⚠️ a cancel from before 477 still answers null, in all three readers, off a real ledger', () => {
      // ⛔ **Planted, and it is the ONE thing here that may not come from a door**: a row written
      // before this app recorded an actor cannot be produced by today's code, and deleting the
      // field afterwards would be a fixture built out of the thing under test.
      ledgerFor('sess_old', [
        { type: 'user_turn', text: 'go' },
        {
          type: 'work_given',
          piece: 'work_old',
          label: 'W1.1',
          parent: 'work_root_pm',
          givenBy: 'sess_pm',
          title: 'old work',
          brief: 'old work',
        },
        { type: 'user_decision', requestId: 'req_old', outcome: 'cancel' },
        { type: 'turn', state: 'interrupted' },
      ])
      expect(store.piecesOwnedBy('sess_old')[0]).toMatchObject({
        stalledBecause: 'turn_interrupted',
        stalledBy: null,
      })
      expect(store.lastEndedTurn('sess_old')).toMatchObject({ how: 'it-was-stopped', who: null })
      // ⚑ **And the conversation-level read too**: the row is found and DROPPED for want of an
      // actor, which is not the same as the row not being there.
      expect(store.lastAskToStop('sess_old')).toBeNull()
    })

    it('🔴 the same ledger with 477’s key names the person — one row apart, and nothing else moved', () => {
      // ⚠️ **The pair `491` set the standard for**: the emptied field and the filled one, from
      // ledgers that differ by exactly the key HO-029 §2.2 is about.
      ledgerFor('sess_new', [
        { type: 'user_turn', text: 'go' },
        {
          type: 'work_given',
          piece: 'work_new',
          label: 'W1.1',
          parent: 'work_root_pm',
          givenBy: 'sess_pm',
          title: 'new work',
          brief: 'new work',
        },
        { type: 'user_decision', requestId: 'req_new', outcome: 'cancel', by: { who: 'a-person' } },
        { type: 'turn', state: 'interrupted' },
      ])
      expect(store.piecesOwnedBy('sess_new')[0]).toMatchObject({
        stalledBecause: 'turn_interrupted',
        stalledBy: { by: 'a-person', asker: null },
      })
      expect(store.lastEndedTurn('sess_new')).toMatchObject({
        how: 'it-was-stopped',
        who: 'a-person',
        asker: null,
      })
      expect(store.lastAskToStop('sess_new')).toMatchObject({
        by: 'a-person',
        asker: null,
        turn: 'the-turn-that-ended-last',
      })
    })

    it('⛔ the conversation-level read passes over a decision that is not a cancel', () => {
      // ⚑ **The SQL narrows, not the reader** — `json_extract` over the payload, so an `allow` is
      // not a row this query can return and a reader never has to decide what one would mean.
      ledgerFor('sess_allow', [
        { type: 'user_turn', text: 'go' },
        { type: 'user_decision', requestId: 'req_a', outcome: 'allow', by: { who: 'a-person' } },
        { type: 'turn', state: 'completed' },
      ])
      expect(store.lastAskToStop('sess_allow')).toBeNull()
      // ⚠️ **The same ledger one outcome over**, so the negative above is a narrowing and not a
      // query that returns nothing.
      ledgerFor('sess_cancel', [
        { type: 'user_turn', text: 'go' },
        { type: 'user_decision', requestId: 'req_c', outcome: 'cancel', by: { who: 'a-person' } },
        { type: 'turn', state: 'interrupted' },
      ])
      expect(store.lastAskToStop('sess_cancel')).toMatchObject({ by: 'a-person' })
    })

    it('⛔ 501 · a flat `by` this build has no word for is DROPPED, and the new word is not', () => {
      // ⛔ **The ledger boundary on the FLAT producer** — the question {@link whoCancelledIt} asks
      // one row type over, asked of `work_interrupted`'s bare string. ⚠️ A payload is
      // `JSON.parse`d and CAST, so a row written by a build whose vocabulary has moved arrives
      // here as a word this one has no member for, and `isWhoDidIt`'s rule is that it is dropped
      // rather than reported.
      ledgerFor('sess_later', [
        { type: 'user_turn', text: 'go' },
        { type: 'work_interrupted', by: 'a-word-from-a-later-build' as never },
      ])
      expect(store.lastAskToStop('sess_later')).toBeNull()
      // 🔴 **501 · the membership test was a hand-written `'a-person'`/`'an-agent'` pair here** —
      // the event's old vocabulary, restated in a second file — so the day the writer gained its
      // third word this reader would have dropped it with the words from the future. ⛔ It would
      // not have failed; `AgentCard.lastAskToStop` would simply have said *nobody asked* about an
      // ask this app recorded. ⚑ The list is {@link WHO_STOPPED_IT} now, and this is the paired
      // positive that keeps the `null` above a refusal rather than a reader that stopped working.
      ledgerFor('sess_unnameable', [
        { type: 'user_turn', text: 'go' },
        { type: 'work_interrupted', by: 'a-caller-this-app-cannot-name' },
      ])
      expect(store.lastAskToStop('sess_unnameable')).toMatchObject({
        by: 'a-caller-this-app-cannot-name',
        asker: null,
      })
    })
  })
})
