import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { distil } from '../src/main/runtime/digest'
import { DIGEST_EVENT_TYPES } from '../src/shared/digest'
import { TASK_STALL_CAUSES } from '../src/shared/tasks'

/**
 * 🔴 **475 · the two projects the digest still read *partly*** — `466`'s remainder, and the
 * SELECTION question the PM asked underneath it.
 *
 * ## ⛔ What the measurement was, and why only one of five moved
 *
 * ⚠️ **`463`'s Operations sentence wants five stall causes attributed to task numbers.** The PM's
 * framing was that two of them are blocked by what the read SELECTS. ⛔ **The code says the
 * division is somewhere else**: of the five {@link TASK_STALL_CAUSES}, exactly ONE is written by
 * a row that names the work.
 *
 *  - `turn_ended` and `turn_interrupted` ← `turn`, which is `{type, state}` and names no task;
 *  - `app_restarted` ← `work_restarted`, which was `{type}` with no other field at all (since
 *    D-016 it names the pieces it stalls, and the digest speaks for them — §2);
 *  - `status`, which names a conversation and no task, has no cause of its own since D-016c (a
 *    stop moves no piece; a drive it cut ends `turn_interrupted`);
 *  - `could_not_be_reopened` ← `replaced_by` (D-017 · R10), which names the conversation that took
 *    its place and no task;
 *  - `message_never_sent` ← `message_unqueued`, which names the HELD MESSAGE — and
 *    `work_given` names the same one (`task_assigned` until D-016).
 *
 * 🔴 **So selecting `status` would have cost the scan and bought no attribution**, and `438`'s
 * cost ruling never had to be argued with. ⚑ Selecting `message_unqueued` buys exactly one
 * cause, through the same kind of edge `437` minted for a question's subject.
 *
 * ## ⚠️ What this file owns
 *
 * ⛔ **The verdicts are in `a-nights-backlog-rehearsed.render.test.ts`, as they must be** — that
 * is `463`'s own instrument and a night nobody wrote to match these sentences. ⚑ What is here is
 * the pairs that one night has at most one of: the edge and every way it must REFUSE to join, the
 * gap's subtraction, and the shape breakdown's own control.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const FOLD = join(here, '../src/main/runtime/digest.ts')
const STORE = join(here, '../src/main/db/session-store.ts')

const TO = 1_800_000_000_000
const FROM = TO - 12 * 3_600_000
const INSIDE = TO - 3_600_000
const BEFORE = FROM - 3_600_000

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-475-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function conversation(id: string): void {
  store.create({ id, provider: 'codex', cwd: dir, approvalMode: 'ask', profileId: id })
}

let ordinals = new Map<string, number>()
beforeEach(() => {
  ordinals = new Map()
})

function at(id: string, when: number, event: Parameters<SessionStore['append']>[2]): void {
  const next = ordinals.get(id) ?? 0
  ordinals.set(id, next + 1)
  store.append(id, next, event, when)
}

/**
 * Work handed to a BUSY child: it goes out as a held message, which is what gives it a name.
 * ⚑ **D-016 · a piece, labelled `W1.<number>`** under the giver's root, titled `the job`.
 */
function held(id: string, when: number, piece: string, number: number, messageId: string): void {
  at(id, when, {
    type: 'work_given',
    piece,
    label: `W1.${String(number)}`,
    parent: 'work_root_parent',
    givenBy: 'sess_parent',
    title: 'the job',
    brief: 'the work itself, which this digest never draws',
    messageId,
  })
}

const digestOf = (): ReturnType<typeof distil> =>
  distil(store.digestWindow(FROM, TO), (session) => session.replace('sess_', ''))

const lineOf = (kind: string): string | undefined =>
  digestOf().lines.find((one) => one.kind === kind)?.text

const gapCount = (kind: string): number | undefined =>
  digestOf().gaps.find((one) => one.kind === kind)?.count

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the edge, and every way it must refuse to join
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · a held message that was not sent names the work it carried', () => {
  it('🔴 the pair joins by name and the line carries the number', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 7, 'msg_a')
    at('sess_child', INSIDE + 1, {
      type: 'message_unqueued',
      messageId: 'msg_a',
      reason: 'abandoned',
      text: 'the work itself, which this digest never draws',
    })
    expect(lineOf('work-not-sent')).toBe(
      '1 held message carrying work was not sent — the most recent carried W1.7 · the job.',
    )
  })

  it('⛔ an ending with no name pairs with nothing, and the SAME row with one does', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 7, 'msg_a')
    // ⚠️ **`354`'s rule, which `derivePieces` states and this fold carries**: a ledger written
    // before messages had names holds endings with no `messageId`, and treating `undefined` as a
    // match would close whichever piece happened to be open.
    at('sess_child', INSIDE + 1, {
      type: 'message_unqueued',
      reason: 'abandoned',
      text: 'an ending from before messages had names',
    })
    expect(lineOf('work-not-sent')).toBeUndefined()
    // ⚑ **The positive control on the same fixture**: the only difference is the name.
    at('sess_child', INSIDE + 2, {
      type: 'message_unqueued',
      messageId: 'msg_a',
      reason: 'abandoned',
      text: 'an ending that names its message',
    })
    expect(lineOf('work-not-sent')).toContain('W1.7')
  })

  it('⛔ an ending whose assignment is OUTSIDE the window draws nothing at all', () => {
    conversation('sess_child')
    // ⚠️ **Not *"work handed out before this window"*, which is what `work-taken-back` says.**
    // ⛔ Without the give there is nothing to say this message carried WORK: every held
    // message ends with one of these rows, and most of them are somebody typing.
    held('sess_child', BEFORE, 'work_old', 3, 'msg_old')
    at('sess_child', INSIDE, {
      type: 'message_unqueued',
      messageId: 'msg_old',
      reason: 'abandoned',
      text: 'an ending whose beginning is in yesterday',
    })
    expect(lineOf('work-not-sent')).toBeUndefined()
    // ⚑ The control: the row really is in the window and really was read — it just says nothing.
    expect(store.digestWindow(FROM, TO).rows).toHaveLength(1)
  })

  it('⛔ `sent` and `cancelled` draw nothing, and `cancelled` is a finding rather than a line', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 7, 'msg_a')
    held('sess_child', INSIDE + 1, 'work_2', 8, 'msg_b')
    at('sess_child', INSIDE + 2, {
      type: 'message_unqueued',
      messageId: 'msg_a',
      reason: 'sent',
      text: 'it went out, which is the ordinary path',
    })
    // 🔴 **`takeBackPiece` publishes BOTH this and `work_taken_back` for one piece**, so a line
    // built on the cancel would count one taking back twice. ⚠️ A person cancelling a held message that
    // carried work writes only this one, and the digest draws nothing for it — reported as a
    // finding rather than fixed here, because de-duplicating needs a second pass over the window.
    at('sess_child', INSIDE + 3, {
      type: 'message_unqueued',
      messageId: 'msg_b',
      reason: 'cancelled',
      text: 'somebody took it back',
    })
    expect(lineOf('work-not-sent')).toBeUndefined()
    expect(lineOf('work-taken-back')).toBeUndefined()
  })

  it('⚠️ the row’s `detail` is never drawn, whatever it says', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 7, 'msg_a')
    at('sess_child', INSIDE + 1, {
      type: 'message_unqueued',
      messageId: 'msg_a',
      reason: 'abandoned',
      text: 'the work itself',
      // ⛔ **One of the three shapes `abandoned` reaches**, and it names what a person attached —
      // `405` §2's rule about a request's arguments, one field over. ⚑ The other shape says the
      // provider MAY have received the message, which would contradict any count hung on it.
      detail: 'the file you attached at /Users/somebody/secret-plan.pdf is no longer there',
    })
    const drawn = JSON.stringify(digestOf())
    expect(drawn).toContain('W1.7')
    expect(drawn).not.toContain('secret-plan.pdf')
    expect(drawn).not.toContain('no longer there')
  })

  it('⛔ the work’s own TEXT is never drawn — `405` §2, and this row carries a second copy of it', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 7, 'msg_a')
    at('sess_child', INSIDE + 1, {
      type: 'message_unqueued',
      messageId: 'msg_a',
      reason: 'abandoned',
      // ⚠️ **`UnqueuedMessageEvent.text` repeats what was queued so the ending can be read alone**
      // — which makes this the SECOND place the work's words live, and the first was already
      // refused.
      text: 'rewrite the launcher and tell nobody',
    })
    expect(JSON.stringify(digestOf())).not.toContain('rewrite the launcher')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the gap that says what became of the rest
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · work handed out that this read cannot account for', () => {
  it('🔴 a reply, a withdrawal and a never-sent message each take one off the count', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 1, 'msg_1')
    held('sess_child', INSIDE + 1, 'work_2', 2, 'msg_2')
    held('sess_child', INSIDE + 2, 'work_3', 3, 'msg_3')
    held('sess_child', INSIDE + 3, 'work_4', 4, 'msg_4')
    expect(gapCount('work-without-an-ending')).toBe(4)

    at('sess_child', INSIDE + 4, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'a worker’s own sentence',
      resources: [],
    })
    expect(gapCount('work-without-an-ending')).toBe(3)

    at('sess_child', INSIDE + 5, {
      type: 'work_taken_back',
      piece: 'work_2',
      by: 'sess_parent',
    })
    expect(gapCount('work-without-an-ending')).toBe(2)

    at('sess_child', INSIDE + 6, {
      type: 'message_unqueued',
      messageId: 'msg_3',
      reason: 'abandoned',
      text: 'never went',
    })
    // 🔴 **The pairing that makes the new line worth having**: a fact the card states is not also
    // a fact the card says it cannot state.
    expect(gapCount('work-without-an-ending')).toBe(1)
    expect(lineOf('work-not-sent')).toContain('W1.3')
  })

  it('⛔ the four rows that DO leave work undriven move the count by nothing', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 1, 'msg_1')
    at('sess_child', INSIDE + 1, { type: 'turn', state: 'failed' })
    at('sess_child', INSIDE + 2, { type: 'turn', state: 'interrupted' })
    // ⚑ A restart row that names no pieces — the shape written before D-016 — stalls nothing.
    at('sess_child', INSIDE + 3, { type: 'work_restarted' })
    at('sess_child', INSIDE + 4, { type: 'status', state: 'ended' })
    // ⚠️ **Three of those four ARE in the read and one is not, and it makes no difference** —
    // which is the whole of 475's answer to the selection question. ⛔ None of them names a piece,
    // so the gap is unmoved and a widened selection would move it just as little.
    expect(gapCount('work-without-an-ending')).toBe(1)
    expect(lineOf('turn-ended')).toBe('2 turns ended — 1 failed, 1 interrupted.')
    expect(lineOf('work-restarted')).toContain('The app restarted')
    // 🔴 **D-016 · the control: a restart that NAMES the piece it stalls** speaks for its work, so
    // the gap closes on it — which is what the bare row above does not do.
    at('sess_child', INSIDE + 5, { type: 'work_restarted', pieces: ['work_1'] })
    expect(gapCount('work-without-an-ending')).toBeUndefined()
  })

  it('⚑ a window that handed out nothing shows no gap, and neither does one that answered all of it', () => {
    conversation('sess_quiet')
    at('sess_quiet', INSIDE, { type: 'turn', state: 'completed' })
    // ⛔ `DIGEST_GAP_KINDS`' own rule: every member is conditional on rows the window contains,
    // and a gap on every window every time would be a design fault rather than a ledger limit.
    expect(gapCount('work-without-an-ending')).toBeUndefined()

    // ⚑ **`D-016`: one window over every agent's conversation**, so the second half is a second
    // conversation in the SAME read — it hands work out and has it answered inside the window.
    conversation('sess_busy')
    held('sess_busy', INSIDE, 'work_1', 1, 'msg_1')
    at('sess_busy', INSIDE + 1, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'answered inside the same window',
      resources: [],
    })
    // ⚑ The read really holds the work, so the absent gap is about the answer and not an empty read.
    expect(lineOf('work-handed-out')).toContain('W1.1')
    expect(gapCount('work-without-an-ending')).toBeUndefined()
  })

  it('⛔ work handed out BEFORE the window is not in this hole — `carried-in` is the one that speaks for it', () => {
    conversation('sess_child')
    held('sess_child', BEFORE, 'work_old', 3, 'msg_old')
    at('sess_child', INSIDE, {
      type: 'work_replied',
      piece: 'work_old',
      outcome: 'blocked',
      summary: 'a reply to work from yesterday',
      resources: [],
    })
    expect(gapCount('work-without-an-ending')).toBeUndefined()
    expect(gapCount('carried-in')).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · ⚑ gone at `D-016` — it pinned the grouped *proposal* line (`work-proposed`) and its shape
// breakdown; proposals went, and the digest has no such kind any more.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the selection, censused — what came in, and what stayed out and why
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · one type joined the read and one stayed out', () => {
  const fold = readFileSync(FOLD, 'utf8')
  const storeSource = readFileSync(STORE, 'utf8')

  it('🔴 `message_unqueued` is in the vocabulary, in the SQL, and has an arm', () => {
    expect(DIGEST_EVENT_TYPES).toContain('message_unqueued')
    // ⚠️ The SQL spells its own list inline so the probe can lift it; both halves are asserted
    // here because a type in one and not the other reads as *"that never happened"*, silently.
    expect(storeSource).toContain("'tool_call', 'tool_result', 'message_unqueued')")
    expect(fold).toContain("case 'message_unqueued':")
  })

  it('⛔ `status` stayed out, and the reason is that it would close NOTHING', () => {
    expect(DIGEST_EVENT_TYPES).not.toContain('status')
    // 🔴 **The structural half of the argument, asserted rather than written in prose.** Every
    // stall cause but two is written by a row with no piece on it; `message_never_sent`'s row
    // carries the message name, and `work_given` carries the same field; and since D-016
    // `app_restarted`'s row names the pieces it stalls (asserted off its declaration below).
    // ⚑ **D-017 · R10's member is one more of the many**: `could_not_be_reopened` is written at the
    // old conversation's `replaced_by` row, over every open piece it held, and that row names only
    // the conversation that took its place — no piece (asserted off its declaration below).
    // ⚑ **D-016c · `status` has no cause of its own**: a stop moves no piece, and a drive a stop cut
    // ends `turn_interrupted` — still a row with no piece on it. ⚑ `background_stopped` is written at
    // a `status: ended` over running background work — the same row, still naming no piece, so
    // reading it would still close nothing. ⚑ **F074's `provider_limited`** is written at a `turn`
    // row that carries its provider's usage limit — still a row with no piece on it. ⚑ **F076's
    // `login_refused`** is written at a `turn` row or a terminal `status` that says its provider
    // refused the login its conversation was started with — rows with no piece on them.
    // `billing_refused` is written at a `turn` row that says its provider would not bill the account
    // it ran on, still a row with no piece on it.
    expect(TASK_STALL_CAUSES).toEqual([
      'turn_ended',
      'turn_interrupted',
      'app_restarted',
      'message_never_sent',
      'could_not_be_reopened',
      'background_stopped',
      'provider_limited',
      'login_refused',
      'billing_refused',
    ])
    const ipc = readFileSync(join(here, '../src/shared/runtime-ipc.ts'), 'utf8')
    // ⚑ `work_restarted` has ONE field, the pieces it stalls (D-016) — read off its own
    // declaration, and a positive control on this being a real census of the shape.
    const restarted = ipc.slice(ipc.indexOf('export interface WorkRestartedEvent {'))
    expect(restarted.slice(0, restarted.indexOf('\n}\n'))).toMatch(
      /^export interface WorkRestartedEvent \{\n {2}type: 'work_restarted'\n {2}\/\*\*(?:(?!\*\/)[\s\S])*\*\/\n {2}pieces\?: readonly string\[\]$/,
    )
    expect(ipc).toContain(
      "export interface ReplacedByEvent {\n  type: 'replaced_by'\n  /** The conversation that took its place. */\n  sessionId: string\n}",
    )
  })

  it('⚠️ a `status` row in the window is still not read at all', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 1, 'msg_1')
    at('sess_child', INSIDE + 1, { type: 'status', state: 'ended' })
    // ⛔ One give and one ending were written; the read returns the give alone.
    expect(store.digestWindow(FROM, TO).rows).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 697 · `672` H1 — the digest says a task the way every card says it
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **697 · `672` H1 — every digest line that names a piece says it as every card does.** ⛔ Main
 * composed five of them with a bare `#3` (*"…the most recent is #3, to child."*, *"child reported #3
 * done"*) — the one person-facing spelling `672` handed back, because the one spelling lived where
 * main could not import it. ⚑ **Since D-016 a piece is its LABEL beside its title** —
 * `piece-called.ts`' `pieceLine`, in `shared/` so main and the window say one thing — and there is
 * no `Task #N` left to spell. Driven through `distil` over the real store's `digestWindow`, the
 * door `RuntimeHost.digest` calls.
 */
describe('697 · 672 H1 — every line the fold SPELLS a piece in says its label', () => {
  const A_NUMBER_WITH_A_HASH = /#\d/

  it('🔴 the five kinds, each byte for byte, and none with a bare #N', () => {
    conversation('sess_child')
    held('sess_child', INSIDE, 'work_1', 3, 'msg_a')
    at('sess_child', INSIDE + 1, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'did it',
      resources: [],
    })
    at('sess_child', INSIDE + 2, {
      type: 'work_taken_back',
      piece: 'work_1',
      by: 'sess_parent',
    })
    at('sess_child', INSIDE + 3, {
      type: 'message_unqueued',
      messageId: 'msg_a',
      reason: 'abandoned',
      text: 'the work itself, which this digest never draws',
    })
    at('sess_child', INSIDE + 4, {
      type: 'question_asked',
      requestId: 'req_1',
      piece: 'work_1',
      label: 'W1.3',
      prompt: 'which one?',
      questions: [],
    })
    const lines = digestOf().lines
    const said = (kind: string): string | undefined => lines.find((one) => one.kind === kind)?.text
    expect(said('work-handed-out')).toBe(
      '1 piece of work was handed out — the most recent is W1.3 · the job, to child.',
    )
    expect(lines.some((one) => one.text === 'child reported W1.3 · the job done — did it')).toBe(
      true,
    )
    expect(said('work-taken-back')).toBe(
      '1 piece of work was taken back by whoever gave it — the most recent is W1.3 · the job.',
    )
    expect(said('work-not-sent')).toBe(
      '1 held message carrying work was not sent — the most recent carried W1.3 · the job.',
    )
    // ⚑ **The question's line names the label its OWN row carries** — `question_asked.label`.
    expect(said('question-about-work')).toBe(
      '1 question says which piece of work it is about — the most recent is W1.3.',
    )
    expect(
      lines.filter((one) => A_NUMBER_WITH_A_HASH.test(one.text)).map((one) => one.text),
    ).toEqual([])
  })

  it('⚑ controls: the negative can fail, and work from before the window names no number at all', () => {
    // ⛔ The shapes `main` wrote, before and after `672` — the negative's regex finds both.
    expect(A_NUMBER_WITH_A_HASH.test('the most recent is #3, to child.')).toBe(true)
    expect(A_NUMBER_WITH_A_HASH.test('the most recent is Task #3, to child.')).toBe(true)
    expect(A_NUMBER_WITH_A_HASH.test('the most recent is W1.3 · the job, to child.')).toBe(false)
    conversation('sess_child')
    at('sess_child', INSIDE, {
      type: 'work_replied',
      piece: 'work_old',
      outcome: 'done',
      summary: 'x',
      resources: [],
    })
    expect(
      digestOf().lines.some(
        (one) => one.text === 'child reported work it was given before this window done — x',
      ),
    ).toBe(true)
  })
})
