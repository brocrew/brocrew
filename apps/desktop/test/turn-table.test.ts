import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  type RecordedTurn,
  type SessionStore,
} from '../src/main/db/session-store'

/**
 * The turn as a row (Slice 2 · 045).
 *
 * 042 measured the defect these tests exist for: a turn was not a thing that existed, so "is this
 * session busy" was a guess with nothing to reconcile against, and an interrupted turn's late
 * message was invisible. The headline test is §"the shape 042 recorded" — it is that exact ledger,
 * replayed.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('the turn table', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let at = 1_700_000_000_000

  const SESSION = 'sess_turns'

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-turns-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    store.create({
      id: SESSION,
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    at = 1_700_000_000_000
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Append in order, each event one millisecond after the last — real ledgers are ordered. */
  let ordinal = 0
  const feed = (...events: TranscriptEvent[]): void => {
    for (const event of events) store.append(SESSION, ordinal++, event, ++at)
  }
  beforeEach(() => {
    ordinal = 0
  })

  const status = (): string =>
    (
      db.prepare('SELECT status FROM provider_session WHERE id = ?').get(SESSION) as {
        status: string
      }
    ).status

  describe('a turn is a row', () => {
    it('opens with the prompt and closes with how it ended', () => {
      feed({ type: 'user_turn', text: 'count the files' })
      const open = store.turns(SESSION)
      expect(open).toHaveLength(1)
      expect(open[0]).toMatchObject({
        ordinal: 0,
        prompt: 'count the files',
        closedAt: null,
        endReason: null,
      })

      feed({ type: 'turn', state: 'completed' })
      const closed = store.turns(SESSION)[0]
      expect(closed?.endReason).toBe('completed')
      expect(closed?.closedAt).toBeGreaterThan(closed!.openedAt)
    })

    it('a QUEUED message opens no turn — the turn appears only when it is sent (077)', () => {
      // ⚠️ **The dispatch's rule, at the layer that decides it**: *"do not invent a turn for a
      // message that has not gone."* `appendTx` opens a row from `user_turn` and from nothing else,
      // so these two events are recorded and pass straight through — which is the property, not an
      // accident of them being unhandled.
      feed(
        { type: 'user_turn', text: 'the running one' },
        { type: 'message_queued', text: 'the waiting one' },
      )
      expect(store.turns(SESSION).map((turn) => turn.prompt)).toEqual(['the running one'])

      // The turn ends, we send it, and only now is there a second turn — with the queued text as
      // its own prompt, not appended to the first.
      feed(
        { type: 'turn', state: 'completed' },
        { type: 'message_unqueued', reason: 'sent', text: 'the waiting one' },
        { type: 'user_turn', text: 'the waiting one' },
      )
      expect(store.turns(SESSION).map((turn) => [turn.ordinal, turn.prompt])).toEqual([
        [0, 'the running one'],
        [1, 'the waiting one'],
      ])
    })

    it('a message that is never sent leaves no turn behind at all (077)', () => {
      feed(
        { type: 'user_turn', text: 'the running one' },
        { type: 'message_queued', text: 'abandoned before it went' },
        { type: 'turn', state: 'completed' },
        { type: 'message_unqueued', reason: 'abandoned', text: 'abandoned before it went' },
      )
      // One turn, and it is the one that was actually sent. A row here would be a prompt no
      // provider ever received, permanently indistinguishable from one that was.
      expect(store.turns(SESSION).map((turn) => turn.prompt)).toEqual(['the running one'])
    })

    it('a user_command opens no turn, and lands on the one it interrupted (097)', () => {
      // ⚠️ **The same rule as the queued message above, at the same layer** — 045 opens a turn from
      // `user_turn` and from nothing else, and a gesture is not a prompt. Asserted here rather than
      // trusted, because `appendTx` is where the decision is made and nothing else can make it.
      feed(
        { type: 'user_command', command: 'changed_model', target: 'claude-haiku-4-5' },
        { type: 'user_turn', text: 'the only prompt' },
        { type: 'user_command', command: 'interrupted' },
        { type: 'turn', state: 'interrupted' },
        { type: 'user_command', command: 'closed' },
      )
      expect(store.turns(SESSION).map((turn) => turn.prompt)).toEqual(['the only prompt'])

      // …and attribution, which is the whole point of the breadcrumb. The Stop pressed DURING the
      // turn belongs to it; the model change before it and the close after it belong to no turn,
      // because a decision made between turns is not part of either.
      //
      // ⚠️ **This is the STORE's rule and nothing more, and the distinction cost a real defect**
      // (097 review). The order fed above is chosen by this test; whether the product ever produces
      // it is a different question, and the first version of 097 got it wrong — `handle.interrupt()`
      // terminalizes from inside its own promise, so a breadcrumb written after the `await` arrived
      // to find the turn closed and was stamped `null`. A green test over a hand-made ordering read
      // as coverage of a path it had never touched. What the product actually produces is asserted
      // in `user-command.test.ts`, through `executeRuntimeCommand` against a real handle.
      const turnId = store.turns(SESSION)[0]!.id
      const rows = db
        .prepare(
          `SELECT json_extract(payload, '$.command') AS command, turn_id
             FROM events WHERE type = 'user_command' ORDER BY ordinal`,
        )
        .all() as { command: string; turn_id: string | null }[]
      expect(rows).toEqual([
        { command: 'changed_model', turn_id: null },
        { command: 'interrupted', turn_id: turnId },
        { command: 'closed', turn_id: null },
      ])
    })

    it('counts turns in order, one row each', () => {
      feed(
        { type: 'user_turn', text: 'one' },
        { type: 'turn', state: 'completed' },
        { type: 'user_turn', text: 'two' },
        { type: 'turn', state: 'interrupted' },
      )
      expect(store.turns(SESSION).map((t) => [t.ordinal, t.prompt, t.endReason])).toEqual([
        [0, 'one', 'completed'],
        [1, 'two', 'interrupted'],
      ])
    })

    it('will not let a turn close without saying how — the database refuses it', () => {
      // `closed_at` and `end_reason` are one fact, so a writer cannot set half of it.
      feed({ type: 'user_turn', text: 'one' })
      const id = store.turns(SESSION)[0]!.id
      expect(() =>
        db.prepare('UPDATE turn SET closed_at = ? WHERE id = ?').run(at, id),
      ).toThrowError(/CHECK/i)
    })
  })

  describe('endings we did not choose', () => {
    it('a session ending under an open turn is `ended`, not `completed`', () => {
      feed({ type: 'user_turn', text: 'one' }, { type: 'status', state: 'ended' })
      expect(store.turns(SESSION)[0]?.endReason).toBe('ended')
    })

    it('a turn whose ending we never saw is `unknown` — never back-filled', () => {
      // The app was quit mid-turn: the ledger simply stops. Resume closes it, and the only truthful
      // reason is that we did not observe how it went. Recording `completed` here would be the app
      // inventing an outcome, which is the whole reason the enum has this member.
      feed({ type: 'user_turn', text: 'one' })
      expect(store.closeOpenTurn(SESSION, 'unknown', ++at)).toBe(true)
      expect(store.turns(SESSION)[0]?.endReason).toBe('unknown')
      // …and the session stops claiming to be running.
      expect(status()).toBe('idle')
    })

    it('closing when nothing is open says so rather than inventing a turn', () => {
      expect(store.closeOpenTurn(SESSION, 'unknown', ++at)).toBe(false)
      expect(store.turns(SESSION)).toEqual([])
    })

    it('⛔ closing a turn does NOT un-end a session — but reopening one does (179)', () => {
      // The two halves of "terminal is permanent", which 179 found were one rule doing two jobs.
      //
      // ⚠️ **Closing an orphan turn must not touch the ending**, because the resume path calls it
      // BEFORE the provider is asked: a resume that then failed would leave a row calling a session
      // that never came back `idle`. That is the half this pins first, and it is unchanged.
      feed({ type: 'user_turn', text: 'one' }, { type: 'status', state: 'ended' })
      expect(status(), 'non-vacuity: it really did record an ending').toBe('ended')
      feed({ type: 'user_turn', text: 'interrupted by a quit' })
      expect(store.closeOpenTurn(SESSION, 'unknown', ++at)).toBe(true)
      expect(status(), 'the ending it recorded still stands').toBe('ended')

      // After reopen the conversation is running again. A measured sequence appended `status:
      // working`, `user_turn`, completed turn, and `status: idle` across ordinals 33–59 while
      // the stale column stayed `ended`; the column must reflect the resumed life.
      expect(store.reopened(SESSION, ++at), 'a terminal was there to clear').toBe(true)
      expect(status()).toBe('idle')
      // …and from here the ordinary derivation runs again, which is what was pinned shut before.
      feed({ type: 'user_turn', text: 'the second life' })
      expect(status()).toBe('working')

      // Nothing to clear on a session that is already running — said, not assumed.
      expect(store.reopened(SESSION, ++at)).toBe(false)
      expect(status(), 'and a session mid-turn is not knocked back to idle').toBe('working')
    })
  })

  describe('the shape 042 recorded', () => {
    it('attributes the post-interrupt message to the turn that had already closed', () => {
      // Preserve the measured order `assistant_delta → turn:interrupted → status:idle →
      // assistant_message → user_turn`. The late assistant message needs a ledger marker
      // recording that it arrived after the ending. This occurred in 1 of 6 interrupts and 0
      // of 47 completions.
      feed(
        { type: 'user_turn', text: 'a long job' },
        { type: 'assistant_delta', text: 'still streaming' },
        { type: 'turn', state: 'interrupted' },
        { type: 'status', state: 'idle' },
        { type: 'assistant_message', text: 'the tail of the reply' },
        { type: 'user_turn', text: 'the next thing' },
      )

      const [first] = store.turns(SESSION)
      expect(first?.endReason).toBe('interrupted')

      const late = db
        .prepare(
          `SELECT e.ordinal, e.type, t.end_reason AS reason FROM events e
             JOIN turn t ON e.turn_id = t.id
            WHERE t.closed_at IS NOT NULL AND e.created_at > t.closed_at ORDER BY e.ordinal`,
        )
        .all() as { ordinal: number; type: string; reason: string }[]

      // Exactly one late event, and it names the turn it arrived after.
      expect(late).toEqual([{ ordinal: 4, type: 'assistant_message', reason: 'interrupted' }])
    })

    it('⚠️ a generated image is CONTENT — it belongs to the turn that made it (067)', () => {
      // `CONTENT_EVENTS` is a plain Set, not an exhaustive switch, so an event type left out of it
      // is attributed to no turn at all and NOTHING fails. That silence is the reason this test
      // exists: a picture missing from 042's late-content query would look exactly like a picture
      // that arrived on time.
      feed(
        { type: 'user_turn', text: 'draw me a fox' },
        { type: 'image', imageId: 'exec-1', path: '/x/generated_images/t/exec-1.png' },
        { type: 'turn', state: 'completed' },
        // …and one that arrived AFTER the turn closed, which is the anomaly shape 042 recorded.
        { type: 'image', imageId: 'exec-2' },
      )
      const rows = db
        .prepare(
          `SELECT ordinal, turn_id AS turnId FROM events WHERE type = 'image' ORDER BY ordinal`,
        )
        .all() as { ordinal: number; turnId: string | null }[]
      expect(rows).toHaveLength(2)
      // Both attributed — the second to the turn it arrived after, which is what makes it queryable.
      expect(rows[0]?.turnId).not.toBeNull()
      expect(rows[1]?.turnId).toBe(rows[0]?.turnId)

      const late = db
        .prepare(
          `SELECT e.type FROM events e JOIN turn t ON e.turn_id = t.id
            WHERE t.closed_at IS NOT NULL AND e.created_at > t.closed_at`,
        )
        .all() as { type: string }[]
      expect(late).toEqual([{ type: 'image' }])
    })

    it('⚠️ a FILE CHANGE is content — it belongs to the turn that made it (096)', () => {
      // The exact hazard the `image` test above names, one type later, and it is the type most
      // likely to arrive late: Codex sends `turn/diff/updated` three to five times per turn and the
      // last one lands on the boundary. Left out of `CONTENT_EVENTS`, the files a turn changed would
      // be precisely the rows 042's late-content query cannot see — and nothing would fail.
      feed(
        { type: 'user_turn', text: 'fix the resolver' },
        {
          type: 'file_change',
          changes: [{ path: 'src/a.ts', status: 'modified', added: 3, removed: 1 }],
          source: 'turn/diff/updated',
        },
        { type: 'turn', state: 'completed' },
        // …and the snapshot that lands after the turn closed, which is the measured pattern.
        {
          type: 'file_change',
          changes: [{ path: 'src/a.ts', status: 'modified', added: 4, removed: 1 }],
          source: 'turn/diff/updated',
        },
      )
      const rows = db
        .prepare(
          `SELECT ordinal, turn_id AS turnId FROM events WHERE type = 'file_change' ORDER BY ordinal`,
        )
        .all() as { ordinal: number; turnId: string | null }[]
      expect(rows).toHaveLength(2)
      expect(rows[0]?.turnId, 'the one inside the turn').not.toBeNull()
      expect(rows[1]?.turnId, 'and the one after it, to the same turn').toBe(rows[0]?.turnId)

      const late = db
        .prepare(
          `SELECT e.type FROM events e JOIN turn t ON e.turn_id = t.id
            WHERE t.closed_at IS NOT NULL AND e.created_at > t.closed_at`,
        )
        .all() as { type: string }[]
      expect(late).toEqual([{ type: 'file_change' }])
    })

    it('the message is KEPT — the anomaly is recorded, never dropped', () => {
      // The PM ruling: the late message is real, the emission of `idle` is correct, and the defect
      // was only that nothing recorded the anomaly. Losing the message would be a worse bug.
      feed(
        { type: 'user_turn', text: 'a long job' },
        { type: 'turn', state: 'interrupted' },
        { type: 'assistant_message', text: 'the tail of the reply' },
      )
      const texts = store
        .events(SESSION)
        .map((e) => ('text' in e.event ? e.event.text : null))
        .filter(Boolean)
      expect(texts).toContain('the tail of the reply')
    })

    it('a normal completion attributes nothing late — 47/47 stay clean', () => {
      feed(
        { type: 'user_turn', text: 'a job' },
        { type: 'assistant_message', text: 'done' },
        { type: 'turn', state: 'completed' },
        { type: 'status', state: 'idle' },
      )
      // NON-VACUOUS, which the review caught it not being: a zero here would also be produced by an
      // implementation that attributed nothing at all. So the positive is asserted first — the
      // content really did land on the turn — and only then that none of it is late.
      const attributed = db
        .prepare(
          `SELECT COUNT(*) AS n FROM events e JOIN turn t ON e.turn_id = t.id
            WHERE e.type = 'assistant_message'`,
        )
        .get() as { n: number }
      expect(attributed.n, 'the reply is attributed to its turn at all').toBe(1)

      const late = db
        .prepare(
          `SELECT COUNT(*) AS n FROM events e JOIN turn t ON e.turn_id = t.id
            WHERE t.closed_at IS NOT NULL AND e.created_at > t.closed_at`,
        )
        .get() as { n: number }
      expect(late.n).toBe(0)
    })

    it('back-to-back prompts do not orphan the first turn open forever', () => {
      // An imported ledger can hold two prompts with no reply between them. The newest open turn is
      // the only one any lookup can reach, so a turn left open behind it would be unreachable — and
      // would hold the session at `working` for the rest of its life.
      feed({ type: 'user_turn', text: 'one' }, { type: 'user_turn', text: 'two' })
      const turns = store.turns(SESSION)
      expect(turns.map((t) => t.endReason)).toEqual(['unknown', null])
      expect(status()).toBe('working') // the SECOND is genuinely still open
      feed({ type: 'turn', state: 'completed' })
      expect(store.turns(SESSION).map((t) => t.endReason)).toEqual(['unknown', 'completed'])
      expect(status()).toBe('idle')
    })

    it('a turn closed while blocked does not stay looking blocked', () => {
      feed(
        { type: 'user_turn', text: 'one' },
        { type: 'status', state: 'waiting_permission' },
        { type: 'status', state: 'ended' },
      )
      const turn = store.turns(SESSION)[0]
      expect(turn?.endReason).toBe('ended')
      expect(turn?.blockedAt, 'a finished turn waits on nobody').toBeNull()
    })

    it('the status column tracks the TURN, not just status events', () => {
      // The window the review found: a `turn` event closes the row but is not itself a status
      // event, so deriving only from status events left the column saying `working` until the
      // machine's `idle` happened to follow — and permanently if it never did.
      feed({ type: 'user_turn', text: 'one' })
      expect(status()).toBe('working')
      feed({ type: 'turn', state: 'completed' })
      expect(status(), 'no status event needed').toBe('idle')
    })

    it('a session that has ended stays ended, whatever arrives afterwards', () => {
      feed(
        { type: 'user_turn', text: 'one' },
        { type: 'status', state: 'ended' },
        { type: 'assistant_message', text: 'a straggler' },
      )
      expect(status()).toBe('ended')
    })

    it('lifecycle events outside a turn are left unattributed, not re-parented', () => {
      // Nullable is load-bearing: a `session`/`status` row genuinely belongs to no turn, and forcing
      // it into one would be the fabrication pattern 035 already cost us.
      feed(
        { type: 'user_turn', text: 'one' },
        { type: 'turn', state: 'completed' },
        { type: 'status', state: 'ended' },
      )
      const rows = db
        .prepare('SELECT type, turn_id FROM events WHERE session_id = ? ORDER BY ordinal')
        .all(SESSION) as { type: string; turn_id: string | null }[]
      expect(rows.find((r) => r.type === 'status')?.turn_id).toBeNull()
      expect(rows.find((r) => r.type === 'user_turn')?.turn_id).not.toBeNull()
    })
  })

  describe('one derived status, and three distinguishable silences', () => {
    it('waiting for the USER is idle — no open turn', () => {
      feed({ type: 'user_turn', text: 'one' }, { type: 'turn', state: 'completed' })
      // The `status` event the machine emits alongside is derived, not echoed.
      feed({ type: 'status', state: 'idle' })
      expect(status()).toBe('idle')
      expect(store.turns(SESSION).every((t) => t.closedAt !== null)).toBe(true)
    })

    it('waiting for an ANSWER survives — the adapters bypass the machine, and it still counts', () => {
      // 042's third writer: both adapters emit `waiting_permission`/`working` around their own
      // awaits without telling the session machine. Recorded on the turn, it stops being a second
      // opinion — and it is the ONLY signal for this silence, so it could not simply be deleted.
      feed({ type: 'user_turn', text: 'one' }, { type: 'status', state: 'working' })
      expect(status()).toBe('working')

      feed({ type: 'status', state: 'waiting_permission' })
      expect(status()).toBe('waiting_permission')
      expect(store.turns(SESSION)[0]?.blockedAt).not.toBeNull()

      feed({ type: 'status', state: 'working' })
      expect(status()).toBe('working')
      expect(store.turns(SESSION)[0]?.blockedAt).toBeNull()
    })

    it('DEAD is its own answer, and the machine alone declares it', () => {
      feed({ type: 'user_turn', text: 'one' }, { type: 'status', state: 'errored' })
      expect(status()).toBe('errored')
      expect(store.turns(SESSION)[0]?.endReason).toBe('ended')
    })

    it('a stale `idle` cannot make a running turn look finished', () => {
      // The bug class in one assertion: the persisted column is now DERIVED from the turn, so a
      // status event claiming idle while a turn is open cannot be taken at its word.
      feed({ type: 'user_turn', text: 'one' })
      feed({ type: 'status', state: 'idle' })
      expect(status()).toBe('working')
    })
  })

  describe('replay rebuilds the same turns', () => {
    it('the same ledger produces identical rows', () => {
      const script: TranscriptEvent[] = [
        { type: 'user_turn', text: 'one' },
        { type: 'assistant_message', text: 'hi' },
        { type: 'turn', state: 'completed' },
        { type: 'user_turn', text: 'two' },
        { type: 'turn', state: 'interrupted' },
      ]
      feed(...script)
      // Ids are per-row and will differ; everything else about the two must not.
      const shape = (t: RecordedTurn): Omit<RecordedTurn, 'id'> => ({
        ordinal: t.ordinal,
        prompt: t.prompt,
        openedAt: t.openedAt,
        closedAt: t.closedAt,
        endReason: t.endReason,
        blockedAt: t.blockedAt,
      })
      const first = store.turns(SESSION).map(shape)

      store.create({
        id: 'sess_replay',
        provider: 'claude',
        cwd: dir,
        approvalMode: 'ask',
        profileId: 'default',
      })
      let replayOrdinal = 0
      let replayAt = 1_700_000_000_000
      for (const event of script) store.append('sess_replay', replayOrdinal++, event, ++replayAt)
      const second = store.turns('sess_replay').map(shape)

      expect(second).toEqual(first)
    })
  })
})
