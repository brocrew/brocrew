import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

/**
 * 🔴 **434 · HO-025 criterion 17 — the attention queue is COMPLETE REGARDLESS OF AGE.**
 *
 * > ⛔ *"A digest is **what changed lately**; a queue is **what you owe**. A summary may be scoped.
 * > A list of obligations may not."*
 *
 * ## ⛔ Why this file exists as well as `persons-queue.test.ts`
 *
 * ⚠️ **Completeness is a property of the READ, and the read is SQL.** Everything above it — the
 * host's two mappers, the module's fold, the component — is handed a list and cannot put back
 * anything the query did not return. So the only place this can be asserted is against a real
 * database with real migrations, which is what this file is.
 *
 * ## 🔴 The answer, and it is measured rather than assumed
 *
 * ⛔ **The waiting set can be read completely at any age, on this base, with no change.** Neither
 * statement in the path carries a time window, a `LIMIT`, or a bound of any kind:
 *
 *  - `SELECT DISTINCT session_id FROM events WHERE type = 'request_routed'` — every conversation
 *    that ever routed, served by the partial index `events_request_routed_idx`.
 *  - `… WHERE session_id = ? AND generation = ? AND type IN (…) AND ordinal >= (SELECT min(ordinal)
 *    … type = 'request_routed') ORDER BY ordinal` — from that conversation's FIRST routing onward.
 *
 * ⚑ **`432`'s finding does not reach this reader**, and that is worth stating because the relay
 * was right to ask: the digest reads an EVENT WINDOW, so its old-open rows are the ones a bounded
 * read cannot see. This one has never had a window. What it pays instead is history — see §2 and
 * `scripts/waiting-set-probe.mjs` — and that cost is about how much has happened, not about how
 * old the thing you owe is.
 *
 * ⛔ **So the property is asserted TWICE and in two shapes**: behaviourally, against a ledger
 * whose oldest open request is 400 days older than everything else in it, and structurally,
 * against the text of the two statements — because a `created_at >=` added to either one later is
 * a change nothing else in this repo would make red.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

/** ⚑ **400 days, so *old* is not a few minutes of test clock.** */
const DAY = 86_400_000
const NOW = 1_800_000_000_000
const ANCIENT = NOW - 400 * DAY

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-434-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function conversation(id: string): void {
  store.create({ id, provider: 'codex', cwd: dir, approvalMode: 'ask', profileId: 'd' })
}

/** A permission-shaped routing — the population a spawned child parks on. */
function parksOnAPermission(id: string, requestId: string, at: number, ordinal = 0): void {
  store.append(
    id,
    ordinal,
    {
      type: 'request_routed',
      requestId,
      to: 'a-person',
      because: 'a-permission-decision',
      parent: 'sess_pm',
    },
    at,
  )
}

/** A question that travelled and was then escalated to a person. */
function escalates(id: string, requestId: string, at: number, ordinal = 0): void {
  store.append(
    id,
    ordinal,
    { type: 'request_routed', requestId, to: 'the-parent', parent: 'sess_pm' },
    at,
  )
  store.append(id, ordinal + 1, { type: 'request_escalated', requestId }, at + 30_000)
}

describe('§1 · nothing waiting is omitted because it is old', () => {
  it('🔴 a request open for 400 days is returned, and returned FIRST', () => {
    conversation('sess_ancient')
    parksOnAPermission('sess_ancient', 'req_ancient', ANCIENT)
    // ⚠️ **Buried under a lot of newer history**, because the failure this is about is a read that
    // answers the recent and not the old. Sixty conversations, each with its own open request and
    // a tail of ordinary rows after it.
    for (let n = 0; n < 60; n++) {
      const id = `sess_${n}`
      conversation(id)
      parksOnAPermission(id, `req_${n}`, NOW - n * 1_000)
      for (let ordinal = 1; ordinal < 40; ordinal++) {
        store.append(id, ordinal, { type: 'assistant_delta', text: 'x' }, NOW + ordinal)
      }
    }

    const waiting = store.decisionsAwaitingAPerson().rows
    expect(waiting).toHaveLength(61)
    // ⛔ **First, because the list is oldest-first and 400 days is the oldest thing in it.**
    expect(waiting[0]?.requestId).toBe('req_ancient')
    expect(waiting[0]?.at).toBe(ANCIENT)
  })

  it('🔴 an escalated question is complete at any age too — both readers, one property', () => {
    conversation('sess_old-question')
    escalates('sess_old-question', 'req_old', ANCIENT)
    for (let n = 0; n < 20; n++) {
      const id = `sess_recent_${n}`
      conversation(id)
      escalates(id, `req_recent_${n}`, NOW - n * 1_000)
    }

    const asked = store.questionsAPersonMustAnswer().rows
    expect(asked).toHaveLength(21)
    expect(asked[0]?.requestId).toBe('req_old')
    expect(asked[0]?.escalatedAt).toBe(ANCIENT + 30_000)
  })

  /**
   * ⛔ **The control, and without it the two above say only *it returns rows*.** An ancient request
   * that WAS answered is absent — so completeness is *nothing open is dropped*, which is the
   * property, rather than *everything is listed*, which would be a reader that ignores state.
   */
  it('⛔ and an ancient request that was ANSWERED is absent — the read is not just "everything"', () => {
    conversation('sess_settled')
    parksOnAPermission('sess_settled', 'req_settled', ANCIENT)
    store.append(
      'sess_settled',
      1,
      { type: 'user_decision', requestId: 'req_settled', outcome: 'deny' },
      ANCIENT + 1_000,
    )
    conversation('sess_open')
    parksOnAPermission('sess_open', 'req_open', ANCIENT)

    expect(store.decisionsAwaitingAPerson().rows.map((one) => one.requestId)).toEqual(['req_open'])
  })
})

describe('§2 · the read shape, pinned — a window added later is a red line', () => {
  /**
   * ⛔ **A source census, because the behavioural tests above cannot see a window that is not
   * there yet.** ⚠️ Comments are stripped first: this file's own §0 quotes the SQL, and
   * `session-store.ts` discusses `created_at` in the prose around these statements —
   * `a-source-census-must-strip-prose-before-it-asserts`.
   */
  const source = readFileSync(join(here, '../src/main/db/session-store.ts'), 'utf8')

  function statement(name: string, text = source): string {
    const at = text.indexOf(`const ${name} = db.prepare(`)
    expect(at, `${name} is not declared where this census looks`).toBeGreaterThan(-1)
    const open = text.indexOf('`', at)
    // The prepared SQL ends before its argument comma; an interpolation can contain backticks.
    const close = text.indexOf('`,', open + 1)
    expect(close, `${name}'s SQL template argument has no ending`).toBeGreaterThan(open)
    return text.slice(open + 1, close)
  }

  /**
   * ⛔ **A COMPARISON on `created_at`, not the word.** `selectRoutedRequestEvents` SELECTS that
   * column — the fold needs each event's time — so a census for the word alone is red on a
   * statement that bounds nothing, which is the shape that gets a census deleted rather than
   * fixed.
   */
  const BOUNDED_BY_TIME = /created_at\s*(>=|<=|>|<|=|between)/i

  it('🔴 neither statement in the waiting-set read bounds by TIME or by COUNT', () => {
    for (const name of ['selectSessionsThatRouted', 'selectRoutedRequestEvents']) {
      const sql = statement(name)
      expect(BOUNDED_BY_TIME.test(sql), `${name} bounds the queue by time`).toBe(false)
      expect(sql.toLowerCase(), `${name} bounds the queue by count`).not.toContain('limit')
      // ⚑ **Non-vacuity**: the extractor really read SQL and not an empty string.
      expect(sql.toLowerCase()).toContain('from events')
    }
  })

  /**
   * ⚑ **The pattern's own positive control** — a windowed statement really would be caught, so
   * the negative above is about these two rather than about a regex that never matches.
   */
  it('⚑ the time-bound pattern matches a windowed read when there is one', () => {
    expect(BOUNDED_BY_TIME.test('SELECT 1 FROM events WHERE created_at >= ?')).toBe(true)
    expect(BOUNDED_BY_TIME.test('SELECT ordinal, payload, created_at FROM events')).toBe(false)
  })

  it('a time floor after the shared row-type interpolation is still seen', () => {
    const bounded = source.replace(
      'AND (ordinal >= (SELECT min(ordinal) FROM events',
      'AND created_at >= @since AND (ordinal >= (SELECT min(ordinal) FROM events',
    )
    expect(bounded).not.toBe(source)
    expect(BOUNDED_BY_TIME.test(statement('selectRoutedRequestEvents', bounded))).toBe(true)
  })

  /**
   * ⚑ **The positive control, and it is what makes the negative mean something**: a windowed read
   * of this same table DOES exist in this file, so *"no `created_at` here"* is a fact about these
   * two statements rather than about a word the file never uses.
   */
  it('⚑ the file does bound OTHER reads by time — the negative is about these two', () => {
    expect(BOUNDED_BY_TIME.test(source), 'nothing in this file bounds by time').toBe(true)
  })

  /**
   * 🔴 **The ordinal floor is not an age bound, and the difference is the whole answer** — it
   * starts at the conversation's FIRST routing, so every request it ever raised is inside the
   * read however long ago that was. ⛔ Asserted so that a later `ordinal >=` computed from
   * anything else has to be argued for here.
   */
  it('⛔ the only floor is the conversation’s own first routing — or its first question', () => {
    // ⚑ **D-017 · R4 — the floor moved one row type, and it is still the conversation's own**: the
    // first `request_routed` OR `question_asked` (this app writes the question before it routes
    // it), so every request it ever raised is inside the read however long ago that was. ⚑ And ONE
    // row below it may be read — the last `launched` marker before that floor, which the fold needs
    // to know that this app's questions outlive a stop. ⛔ An ordinal, one row, never a range.
    const sql = statement('selectRoutedRequestEvents').replace(/\s+/g, ' ')
    expect(sql).toContain(
      "AND type IN (${ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})",
    )
    expect(sql).toContain(
      "ordinal >= (SELECT min(ordinal) FROM events INDEXED BY events_kind_owner_idx WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation AND type IN ('request_routed', 'question_asked'))",
    )
    expect(sql).toContain(
      "OR ordinal = (SELECT max(ordinal) FROM events INDEXED BY events_kind_owner_idx WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation AND type = 'launched' AND ordinal < (SELECT min(ordinal) FROM events",
    )
    // ⛔ **And no third floor**: exactly two comparisons against `ordinal`'s own column at the top
    // level, the floor and the one marker.
    expect(sql.match(/\( ?ordinal >= |OR ordinal = /g)).toHaveLength(2)
  })
})
