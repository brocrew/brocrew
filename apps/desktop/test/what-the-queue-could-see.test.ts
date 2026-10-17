import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import {
  LEDGER_WALK_KINDS,
  WALK_COVERS,
  type LedgerWalk,
  type LedgerWalkKind,
} from '../src/shared/questions'
import { personsQueueView, type PersonsQueueWorld } from '../src/renderer/src/lib/persons-queue'
import { homeAttention } from '../src/renderer/src/lib/home-attention'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

/**
 * 🔴 **453 · what the queue could SEE, and where each row lives** (HO-024 criterion 17's
 * *everything*, criterion 22's route into it).
 *
 * ## ⛔ The two questions, and neither of them is the one `434-relay-1` answered
 *
 * ⚠️ **That relay settled the WINDOW**: `the-queue-is-complete-regardless-of-age.test.ts` measures
 * that no statement in this path carries a time bound or a `LIMIT`, behaviourally against a ledger
 * 400 days old and structurally against the text of the two statements. ⛔ **It says nothing about
 * SCOPE.** An unwindowed read can still be short because it walked no ledgers at all, or because it
 * could not read part of one — and the word `complete` did not occur anywhere in this path.
 *
 * 🔴 **And the empty case is the one a person reads most often**, because it is the one that lets
 * them stop looking. Every assertion in §1 is about a list with no rows in it.
 *
 * ## ⚑ What is deliberately NOT here
 *
 * ⛔ **No assertion that a walk is *complete*.** Completeness is not a property this app can state
 * about a database it did not write; what it can state is which question it asked, how many ledgers
 * that opened and how many rows it failed to read. ⚠️ A flag spelled `complete: true` would be a
 * positive assertion that cannot be false — `§3`'s trap, written as a field.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-453-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** A conversation this app started. */
function conversation(id: string): void {
  store.create({
    id,
    provider: 'codex',
    cwd: dir,
    approvalMode: 'ask',
    profileId: 'd',
  })
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

/* ═════════════════════════════ §1 · the completeness fact, from the QUERY ═════════════════════ */

describe('§1 · a walk says what it walked, and `rows` is not the answer', () => {
  it('🔴 an EMPTY list over ledgers that were read says so — the query`s number, not the result`s', () => {
    // ⛔ **Three conversations that have routed, and nothing open in any of them.** This is the
    // state a person reads most often, and before `453` it was byte-identical to a database that
    // holds nothing at all.
    for (const n of [1, 2, 3]) {
      conversation(`sess_${n}`)
      parksOnAPermission(`sess_${n}`, `req_${n}`, NOW)
      store.append(
        `sess_${n}`,
        1,
        { type: 'user_decision', requestId: `req_${n}`, outcome: 'deny' },
        NOW + 1,
      )
    }
    const walked = store.decisionsAwaitingAPerson()
    expect(walked.rows).toEqual([])
    // 🔴 **Three ledgers opened, zero rows found** — two different facts, and `rows.length` is `0`
    // for this and for a database with nothing in it.
    expect(walked.ledgers).toBe(3)
    expect(walked.walk).toBe('every-conversation-that-routed')
    expect(walked.rowsUnread).toBe(0)
  })

  it('⛔ …and a workspace where NOTHING has ever routed answers the same word with zero ledgers', () => {
    // ⚑ The control for the test above: same word, different number, and the number is the
    // discriminant. ⛔ Without it, `ledgers` could be `rows.length` and both tests would pass.
    conversation('sess_quiet')
    store.append('sess_quiet', 0, { type: 'assistant_delta', text: 'hello' }, NOW)
    const walked = store.decisionsAwaitingAPerson()
    expect(walked.rows).toEqual([])
    expect(walked.ledgers).toBe(0)
    expect(walked.walk).toBe('every-conversation-that-routed')
  })

  it('🔴 `ledgers` counts what was OPENED and never what was found', () => {
    // 🔴 **ONE ledger holding THREE open requests**, and that shape is the whole test.
    //
    // ⛔ **The first draft of this file used three conversations with one request each and every
    // assertion passed against `ledgers: rows.length`** — `a-comparison-tested-where-both-sides
    // -agree`: the two numbers coincided in every case it built. ⚑ A conversation that parks on
    // three permissions is `402`'s own measured shape, so this is the ordinary world rather than a
    // contrived one.
    conversation('sess_busy')
    parksOnAPermission('sess_busy', 'req_1', NOW, 0)
    parksOnAPermission('sess_busy', 'req_2', NOW, 1)
    parksOnAPermission('sess_busy', 'req_3', NOW, 2)
    const walked = store.decisionsAwaitingAPerson()
    expect(walked.rows).toHaveLength(3)
    expect(walked.ledgers).toBe(1)
  })

  it('⛔ the ESCALATED walk reports the same candidate set as the decision walk, and says so', () => {
    // ⛔ **Two readers of ONE population** — both start from `SELECT DISTINCT session_id … WHERE
    // type = 'request_routed'`, which is why they share a walk word. ⚑ A second word for the second
    // reader would be a distinction the SQL does not make, and a reader comparing the two
    // populations' coverage would read it as two different scopes.
    conversation('sess_asker')
    escalates('sess_asker', 'req_q', NOW)
    conversation('sess_child')
    parksOnAPermission('sess_child', 'req_d', NOW)
    const asked = store.questionsAPersonMustAnswer()
    const settled = store.decisionsAwaitingAPerson()
    expect(asked.rows.map((one) => one.requestId)).toEqual(['req_q'])
    expect(settled.rows.map((one) => one.requestId)).toEqual(['req_d'])
    expect(asked.walk).toBe(settled.walk)
    expect(asked.ledgers).toBe(settled.ledgers)
    // ⚑ …and both opened BOTH ledgers, which is the fact neither list's own length can carry.
    expect(asked.ledgers).toBe(2)
  })

  /**
   * 🔴 **The constructed case where the fact is FALSE — and it is the one `NULL_SESSION_STORE`
   * has answered all along.**
   *
   * ⛔ **`403` and `434` each closed a door on the false all-clear and this one was open behind
   * both.** That store answers `[]` to every one of these readers; `partial` reads a `null` and
   * `stale` reads a look that stopped, and neither of them is this. ⚑ So the queue drew *"Nothing
   * is waiting on you"* out of *"this app has no database"*, with nothing anywhere able to tell
   * them apart.
   */
  it('🔴 a store with NO LEDGER says so, and it is not an empty workspace', () => {
    expect(NULL_SESSION_STORE.questionsAPersonMustAnswer()).toEqual({
      rows: [],
      walk: 'no-ledger',
      ledgers: 0,
      rowsUnread: 0,
    })
    expect(NULL_SESSION_STORE.decisionsAwaitingAPerson().walk).toBe('no-ledger')
    // ⛔ **The discriminant, side by side**: the real store over an empty database answers the same
    // rows and a different word. Without this line the test above proves only that a constant is a
    // constant.
    expect(store.questionsAPersonMustAnswer()).toMatchObject({
      rows: [],
      walk: 'every-conversation-that-routed',
    })
  })

  /**
   * 🔴 **The partial load — a ledger row this app could not read, counted** (`150`'s backlogged
   * mark, come due on the surface that cannot carry it).
   *
   * ⛔ **`toPersistedEvents` has skipped an unparseable row since `150`** and that skip was
   * invisible to every reader above the store. ⚠️ A digest may be scoped; a list of obligations may
   * not, so a row this app dropped is an obligation a person is not being told about.
   */
  it('🔴 a ledger row this app cannot parse is COUNTED, and the rest of the walk still lands', () => {
    conversation('sess_torn')
    parksOnAPermission('sess_torn', 'req_good', NOW)
    // ⛔ **Raw, because nothing in this app can write an unparseable payload** — `append`
    // serialises. The reachable shapes are a torn write, a hand-edited database and a file whose
    // bytes a bundle carried in.
    db.prepare(
      `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('ev_torn', 'sess_torn', 1, 'request_routed', '{"type":"request_rou', NOW + 1, null, 0)
    // ⚠️ The warn is silenced rather than asserted away: `150` put it there on purpose and this
    // test is about the COUNT, which is the half that did not exist.
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const walked = store.decisionsAwaitingAPerson()
    // ⛔ **The good row still lands** — one bad row does not take the walk down, which is what
    // makes this a disclosure rather than a refusal.
    expect(walked.rows.map((one) => one.requestId)).toEqual(['req_good'])
    expect(walked.rowsUnread).toBe(1)
    expect(walked.ledgers).toBe(1)
  })

  it('⛔ …and a walk over the same ledger with nothing torn counts ZERO — the control', () => {
    conversation('sess_whole')
    parksOnAPermission('sess_whole', 'req_good', NOW)
    expect(store.decisionsAwaitingAPerson().rowsUnread).toBe(0)
  })

  it('⚑ every walk has a sentence, and no two of them are the same string', () => {
    // ⛔ `REACH_LISTS`' discipline: a table rather than a branch, so a fourth walk fails to compile
    // until somebody has decided what a list folded through it is.
    expect(Object.keys(WALK_COVERS).sort()).toEqual([...LEDGER_WALK_KINDS].sort())
    const said = Object.values(WALK_COVERS)
    expect(new Set(said).size).toBe(said.length)
    // ⚠️ And each one says what it is ABOUT rather than what it found.
    expect(WALK_COVERS['no-ledger']).toContain('no ledger')
    expect(WALK_COVERS['every-conversation-that-routed']).toContain('routed a request')
  })
})

/* ═════════════════════════ §2 · the empty case, as a person reads it ═════════════════════════ */

const WORLD: PersonsQueueWorld = {
  held: new Set<string>(),
  answerable: new Map<string, AttentionRequest>(),
  now: NOW,
  lastLookAnswered: { questions: true, decisions: true },
  /** ⚑ **468 · this window has answered nothing.** */
  answeredFromHere: new Set<string>(),
}

const blind = <Row>(): LedgerWalk<Row> => ({
  rows: [],
  walk: 'no-ledger',
  ledgers: 0,
  rowsUnread: 0,
})
const read = <Row>(walk: LedgerWalkKind = 'every-conversation-that-routed'): LedgerWalk<Row> => ({
  rows: [],
  walk,
  ledgers: 4,
  rowsUnread: 0,
})

describe('§2 · what the card says when there is nothing in it', () => {
  it('🔴 no ledger behind the answer is NOT "Nothing is waiting on you"', () => {
    const view = personsQueueView(blind(), blind(), WORLD)!
    expect(view.noLedger).toBe(true)
    expect(view.heading).not.toContain('Nothing is waiting on you')
    expect(view.heading).toBe('No list could be read at all')
    // ⛔ And it is the strongest disclosure, so it wins over the ones below it.
    expect(view.partial).toBe(false)
    expect(view.stale).toBe(false)
  })

  it('⛔ …and the SAME empty rows over ledgers that were read still say the quiet thing', () => {
    // ⚑ The control, and it is the whole measurement: identical `rows`, one word apart.
    const view = personsQueueView(read(), read(), WORLD)!
    expect(view.noLedger).toBe(false)
    expect(view.heading).toBe('Nothing is waiting on you')
  })

  it('🔴 a dropped ledger row stops the all-clear too, and says which hole it is', () => {
    const view = personsQueueView({ ...read<never>(), rowsUnread: 2 }, read(), WORLD)!
    expect(view.rowsDropped).toBe(true)
    expect(view.heading).toBe('Some of what is waiting could not be read')
    // ⚠️ **The count is per population and never summed** — the two walks read the SAME
    // candidate set, so a total would double-count every ledger and every unread row in it.
    expect(view.covers['a-question']?.rowsUnread).toBe(2)
    expect(view.covers['a-decision']?.rowsUnread).toBe(0)
  })

  it('⚑ a look that has never answered carries NO coverage, and that is not `no-ledger`', () => {
    const view = personsQueueView(null, read(), WORLD)!
    // ⛔ `null` is *this look has never answered* — the absence `partial` is drawn from — and it is
    // a different fact from *it walked nothing*, which is a look that DID answer.
    expect(view.covers['a-question']).toBeNull()
    expect(view.partial).toBe(true)
    expect(view.noLedger).toBe(false)
    expect(view.covers['a-decision']).toMatchObject({
      walk: 'every-conversation-that-routed',
      ledgers: 4,
    })
  })

  it('⛔ ONE blind look does not blind the card — `every`, and never `some`', () => {
    // ⚠️ **Reachable across a restart rather than hypothetical**: the two reads are two
    // separate IPC calls, so a window can hold a `no-ledger` answer for one population beside one
    // that was read. ⛔ Drawing *No list could be read at all* over it would spend the card's
    // strongest disclosure on a state half of which is known.
    const view = personsQueueView(read(), blind(), WORLD)!
    expect(view.noLedger).toBe(false)
    expect(view.heading).toBe('Nothing is waiting on you')
    // ⚑ …and the blind look still says so on its own coverage, which is where that fact belongs.
    expect(view.covers['a-decision']?.walk).toBe('no-ledger')
    expect(view.covers['a-question']?.walk).toBe('every-conversation-that-routed')
  })

  it('🔴 and the sentence is rendered from the word, so the two cannot drift', () => {
    const view = personsQueueView(blind(), blind(), WORLD)!
    expect(view.covers['a-question']?.says).toBe(WALK_COVERS['no-ledger'])
    const seen = personsQueueView(read(), read(), WORLD)!
    expect(seen.covers['a-decision']?.says).toBe(WALK_COVERS['every-conversation-that-routed'])
    // ⚑ Non-vacuity: the two sentences really are different strings.
    expect(view.covers['a-question']?.says).not.toBe(seen.covers['a-decision']?.says)
  })

  it('⛔ every one of these holes forbids Home’s all-clear', () => {
    for (const view of [
      personsQueueView(blind(), blind(), WORLD)!,
      personsQueueView({ ...read<never>(), rowsUnread: 1 }, read(), WORLD)!,
    ]) {
      expect(view.mayBeShort).toBe(true)
      expect(homeAttention({ requests: [], onlyYou: 0, unread: view.mayBeShort }).quiet).toBe(false)
    }
    // ⚑ The control: a read walk with nothing dropped leaves the all-clear standing.
    const seen = personsQueueView(read(), read(), WORLD)!
    expect(seen.mayBeShort).toBe(false)
    expect(homeAttention({ requests: [], onlyYou: 0, unread: seen.mayBeShort }).quiet).toBe(true)
  })
})

/* ═══════════════════════ §4 · both readers, through the real host ═══════════════════════════ */

/**
 * 🔴 **`a-census-that-asks-for-the-import-must-ask-for-the-call`: shipping the SHAPE is not
 * shipping the answer.**
 *
 * ⛔ **So this drives both readers on `RuntimeHost` over one database.** ⚑ D-016 took the
 * placement (a row's project) and the third reader (proposals) out; what is left is what a settle
 * does to both readers, and what one answer costs.
 */
describe('§4 · both readers answer through the real host', () => {
  let userData: string
  let hostDb: AppDatabase
  let hostStore: SessionStore
  let host: RuntimeHost
  let clock: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-453-host-'))
    hostDb = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(hostDb, migrationsDir)
    clock = NOW
    hostStore = createSessionStore(hostDb, () => clock++)
    host = new RuntimeHost({
      store: hostStore,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${clock}`,
      now: () => clock++,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    hostDb.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const started = (id: string): void => {
    hostStore.create({ id, provider: 'codex', cwd: userData, approvalMode: 'ask', profileId: 'd' })
  }

  /**
   * 🔴 **Criterion 17's SECOND clause — *clearing it there clears it everywhere* — on the two
   * readers that answer *what is waiting*.**
   *
   * ## ⛔ What this measures and what it deliberately does not
   *
   * ⚑ **The two readers hold no idea of their own about what is closed.** Every door a person can
   * settle through writes ONE event and every reader folds it: there is no dismissed-list, no
   * `cleared` column and no per-window copy — `PersonsQueueDoors.settle`'s own docblock says a
   * second write path *"would be a copy that can disagree with the ledger, which is the whole of
   * what clearing it there clears it everywhere forbids"*. ⛔ This is that property asserted rather
   * than argued, on both populations at once.
   *
   * ⚠️ **What it does NOT measure is the ACT.** The doors need a live slot with an owner; what is
   * written here is the event each door writes. ⚑ The window half is measured one file over —
   * `everything-a-person-must-answer-is-in-the-queue.test.ts` §4 drives a `request_resolved` through
   * the transcript fold and watches the card, the pending count, the panel and the live queue all
   * drop it together.
   */
  it('🔴 one settling event clears the row from every reader that answers "what is waiting"', () => {
    started('sess_worker')
    hostStore.append(
      'sess_worker',
      0,
      { type: 'request_routed', requestId: 'req_q', to: 'the-parent', parent: 'sess_pm' },
      NOW,
    )
    hostStore.append('sess_worker', 1, { type: 'request_escalated', requestId: 'req_q' }, NOW + 1)
    started('sess_child')
    hostStore.append(
      'sess_child',
      0,
      {
        type: 'request_routed',
        requestId: 'req_d',
        to: 'a-person',
        because: 'a-permission-decision',
        parent: 'sess_pm',
      },
      NOW,
    )
    // ⚑ **The paired positive, in the same test**: both are waiting before anything settles,
    // so the assertion below measures the SETTLE and not a reader that answers nothing.
    expect(host.questionsForAPerson().rows).toHaveLength(1)
    expect(host.decisionsForAPerson().rows).toHaveLength(1)

    // ⛔ **One event each, and they are the events the two doors write** — `respondUserInput` and
    // `respondPermission` both end a routed request with `user_decision`.
    hostStore.append(
      'sess_worker',
      2,
      { type: 'user_decision', requestId: 'req_q', outcome: 'allow' },
      NOW + 2,
    )
    hostStore.append(
      'sess_child',
      1,
      { type: 'user_decision', requestId: 'req_d', outcome: 'deny' },
      NOW + 2,
    )

    expect(host.questionsForAPerson().rows).toEqual([])
    expect(host.decisionsForAPerson().rows).toEqual([])
    // 🔴 **And the walk still says it LOOKED.** ⛔ This is the whole of `453`: two ledgers read
    // and nothing waiting is a different answer from two ledgers not read, and after a settle it
    // is the first of the two that a person is owed.
    expect(host.decisionsForAPerson()).toMatchObject({
      walk: 'every-conversation-that-routed',
      ledgers: 2,
    })
  })

  /**
   * ⚠️ **One binding read per conversation per answer** — {@link oneWorkReadPerAnswer}'s measured
   * reason, on a third reader. ⚑ **D-016 · the binding is read ONCE per answer again**: for the
   * NAME (a conversation is named by its agent); the placement read went with the placement.
   *
   * ⛔ **`402`'s shape is three permission cards on ONE worker**, and this poll runs every five
   * seconds for the life of a window; an unmemoised naming would ask that conversation's binding
   * three times for one look. ⚑ Asserted by COUNTING the store call rather than by reading the
   * source, because a memo is a behaviour and a census would pass over a `Map` that is written and
   * never read.
   */
  it('⛔ the binding is read ONCE per conversation, however many rows it has', () => {
    const asked: string[] = []
    const counting: SessionStore = {
      ...hostStore,
      identityOf: (id: string) => {
        asked.push(id)
        return hostStore.identityOf(id)
      },
    }
    // ⚠️ **Built BEFORE the rows exist**, because a host's constructor runs the launch repairs —
    // `settleStrandedRequests` strands every open request whose process is gone, which is every one
    // of them in a test. ⛔ The first draft of this case built it afterwards and measured a reader
    // over three stranded rows, which is a queue with nothing in it.
    const counted = new RuntimeHost({
      store: counting,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: () => join(userData, 'provider-homes'),
      providerHomePath: () => join(userData, 'provider-homes'),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${clock}`,
      now: () => clock++,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    started('sess_busy')
    for (const n of [0, 1, 2]) {
      hostStore.append(
        'sess_busy',
        n,
        {
          type: 'request_routed',
          requestId: `req_${n}`,
          to: 'a-person',
          because: 'a-permission-decision',
          parent: 'sess_pm',
        },
        NOW + n,
      )
    }
    asked.length = 0
    // ⚑ **Three rows, one conversation** — the non-vacuity, so the count below is a memo and not a
    // reader that happens to have one row to place.
    expect(counted.decisionsForAPerson().rows).toHaveLength(3)
    // ⚑ **D-016 · one**: the NAME's — a conversation is named by its agent since `734`, which is
    // the binding (`identityOf`), memoised per answer. ⛔ The memo taken out makes it three.
    expect(asked.filter((id) => id === 'sess_busy')).toHaveLength(1)
  })
})
