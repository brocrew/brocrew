import { LEDGER_WALK_KINDS } from '../src/shared/question-contracts'
import { TASK_STATES } from '../src/shared/task-contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { openElsewhere } from '../src/renderer/src/lib/taking-over'
import { walkCovers } from '../src/shared/questions'
import { type RuntimeChangeMessage } from '../src/shared/runtime-ipc'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { WhoCalledWhom } from '../src/shared/who-called-whom'
import { RecordingSink, syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'

/**
 * Who called whom: the host's read of which conversation started which and what work passed
 * between them, by conversation rather than by profile slug, driven through the host on a real
 * database. `WorkGivenOut` carries only `givenToProfile`, which is why §0 shows two conversations
 * of one identity reading as one word there.
 *
 * The provider is a double and every directory is temporary.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000

describe('543 · who called whom', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let announced: RuntimeChangeMessage[]

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-543-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-543-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    announced = []
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_543_${String(tick())}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      announce: (message) => {
        announced.push(message)
      },
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  /** A conversation this app started, as an identity, optionally started BY another one. */
  const conversation = (id: string, profileId: string, over: { parent?: string } = {}): string => {
    store.create({
      id,
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId,
      ...(over.parent === undefined ? {} : { parentSessionId: over.parent }),
    })
    return id
  }

  /**
   * A piece of work given BY one conversation TO another, as the store records it — hung under the
   * giver's root, through the store's own writer.
   *
   * ⛔ **Its life is written into the OWNER's ledger**, which is where `work_given` lives: the owner
   * is not on the event at all, because *"an event that named the session it is stored in would be
   * a second spelling of one fact"*.
   */
  let ordinals = new Map<string, number>()
  const nextOrdinal = (id: string): number => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    return next
  }
  const giveWork = (
    from: string,
    to: string,
    piece: string,
    over: { title?: string; held?: boolean } = {},
  ): string => {
    const root = store.rootOf(from)
    if (root === null) throw new Error(`${from} holds no root to give from`)
    const number = store.numberUnder(root.piece)
    const title = over.title ?? 'look at the migration'
    store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner: to,
        givenBy: from,
        title,
        brief: title,
        folder: null,
        inputs: [],
      },
      nextOrdinal(to),
      {
        type: 'work_given',
        piece,
        label: `${root.label}.${String(number)}`,
        parent: root.piece,
        givenBy: from,
        title,
        brief: title,
        ...(over.held === true ? { messageId: `msg_${piece}` } : {}),
      },
      tick(),
    )
    return piece
  }

  const answerWork = (inSession: string, piece: string): void => {
    store.append(
      inSession,
      nextOrdinal(inSession),
      { type: 'work_replied', piece, outcome: 'done', summary: 'did it', resources: [] },
      tick(),
    )
  }

  beforeEach(() => {
    ordinals = new Map<string, number>()
  })

  /* ══════════ §0 · the premise: one identity, two conversations, one word for both ══════════ */

  describe('§0 · the defect `540` measured, asserted against the shipped reader', () => {
    it('🔴 two conversations of ONE identity are ONE word to the reader that crosses today', () => {
      const pm = conversation('sess_pm', 'project-manager')
      // ⚑ **The same identity, twice** — nothing keys a conversation on its identity alone, so a
      // second conversation of one agent is an ordinary row and not an exotic one. ⛔ **This is the
      // case the whole dispatch exists for.**
      const first = conversation('sess_worker_1', 'worker')
      const second = conversation('sess_worker_2', 'worker')
      giveWork(pm, first, 'work_a', { title: 'the first job' })
      giveWork(pm, second, 'work_b', { title: 'the second job' })

      const given = host.workGivenBy(pm)
      expect(given.rows.map((row) => row.piece)).toEqual(['work_a', 'work_b'])
      // ⛔ **`540`'s line, in this app's own bytes**: *"`WorkGivenOut` exposes only `givenToProfile`
      // and explicitly has no session id. The recipient CONVERSATION is dropped on the way to the
      // renderer."* ⚠️ Two different conversations, one slug, and nothing on the row separates them.
      expect(new Set(given.rows.map((row) => row.givenToProfile))).toEqual(new Set(['worker']))
      expect(Object.keys(given.rows[0] ?? {})).not.toContain('to')
      // ⚑ **And the two conversations really are different** — the control that stops this reading
      // as *the fixture only made one*.
      expect(first).not.toBe(second)
      expect(store.identityOf(first)?.profileSlug).toBe(store.identityOf(second)?.profileSlug)
    })
  })

  /* ═════════════════════ §1 · the property, through the host, end to end ═════════════════════ */

  describe('§1 · who started it, what it started, and what work passed between them', () => {
    /** A parent, two children, work to one child and work to a conversation that is not one. */
    const aFamily = (): { pm: string; child: string; quiet: string; stranger: string } => {
      const pm = conversation('sess_pm', 'project-manager')
      const child = conversation('sess_child', 'worker', { parent: pm })
      const quiet = conversation('sess_quiet', 'reviewer', { parent: pm })
      const stranger = conversation('sess_stranger', 'auditor')
      giveWork(pm, child, 'work_a', { title: 'the migration' })
      giveWork(pm, stranger, 'work_b', { title: 'audit it' })
      return { pm, child, quiet, stranger }
    }

    it('🔴 the answer names every edge by CONVERSATION and never by slug', () => {
      const { pm, child, quiet, stranger } = aFamily()
      const read = host.whoCalledWhom(pm)

      expect(read.conversation).toBe(pm)
      expect(read.parent).toBeNull()
      expect(read.children.rows.map((row) => row.conversation)).toEqual([child, quiet])
      // ⛔ **Both ends of every work edge, explicitly** — the field `540` measured as missing.
      expect(read.workGivenOut.rows.map((row) => [row.from, row.to])).toEqual([
        [pm, child],
        [pm, stranger],
      ])
      expect(read.workGivenOut.rows.map((row) => row.title)).toEqual(['the migration', 'audit it'])
      // ⚑ **The giver's identity is its CONVERSATION's**, read once for the walk — a piece carries
      // its giver's conversation and nothing else, and a conversation never changes identity.
      expect(read.workGivenOut.rows.map((row) => row.fromIdentity)).toEqual([
        'project-manager',
        'project-manager',
      ])
      // ⚑ **And the child's own side of the same edge**, read from ITS conversation.
      const fromTheChild = host.whoCalledWhom(child)
      expect(fromTheChild.parent?.conversation).toBe(pm)
      expect(fromTheChild.workTakenIn.rows.map((row) => [row.from, row.to])).toEqual([[pm, child]])
      expect(fromTheChild.workGivenOut.rows).toEqual([])
    })

    it('⛔ the case a SLUG cannot tell apart — one identity, two conversations, two edges', () => {
      const pm = conversation('sess_pm', 'project-manager')
      // One conversation of this identity is a child and the other is not, both are given work
      // with the same title, so only explicit ids can separate them.
      const born = conversation('sess_worker_1', 'worker', { parent: pm })
      const adopted = conversation('sess_worker_2', 'worker')
      giveWork(pm, born, 'work_a', { title: 'do the thing' })
      giveWork(pm, adopted, 'work_b', { title: 'do the thing' })

      const read = host.whoCalledWhom(pm)
      expect(read.children.rows.map((row) => row.conversation)).toEqual([born])
      expect(read.children.rows.map((row) => row.identity)).toEqual(['worker'])
      expect(read.workGivenOut.rows.map((row) => row.to)).toEqual([born, adopted])
      expect(new Set(read.workGivenOut.rows.map((row) => row.toIdentity))).toEqual(
        new Set(['worker']),
      )
      expect(new Set(read.workGivenOut.rows.map((row) => row.title)).size).toBe(1)
      // The identity is the same word and the edge is not.
      expect(read.workGivenOut.rows[0]?.toIdentity).toBe(read.workGivenOut.rows[1]?.toIdentity)
      expect(read.workGivenOut.rows[0]?.to).not.toBe(read.workGivenOut.rows[1]?.to)
    })

    // ⚑ **D-016** · it named where the parent was placed too, until projects went.
    it('⚠️ a breadcrumb names the identity the parent runs as', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const child = conversation('sess_child', 'worker', { parent: pm })
      const parent = host.whoCalledWhom(child).parent
      expect(parent).toEqual({
        conversation: pm,
        identity: 'project-manager',
        provider: 'codex',
        running: 'not-running',
      })
    })

    it('⛔ a conversation this app never PLACED is still an edge, with a null identity', () => {
      const pm = conversation('sess_pm', 'project-manager')
      // ⚑ `438`'s `never-placed` — `agent_identity_id IS NULL`, which an INNER join would have
      // dropped out of a list whose whole subject is *what did this conversation start*.
      store.adopt({
        id: 'sess_swept',
        provider: 'claude',
        sessionId: 'claude_swept',
        cwd: workspace,
        profileId: null,
        createdAt: NOW,
        updatedAt: NOW,
      })
      db.prepare(`UPDATE provider_session SET parent_session_id = ? WHERE id = ?`).run(
        pm,
        'sess_swept',
      )
      const read = host.whoCalledWhom(pm)
      expect(read.children.rows).toEqual([
        {
          conversation: 'sess_swept',
          identity: null,
          provider: 'claude',
          running: 'not-running',
        },
      ])
      // ⛔ **`provider` is the field that says *this app holds a row***, and it is not null here —
      // which is what makes `identity: null` readable as *never placed* rather than as *no such row*.
      expect(read.children.rows[0]?.provider).not.toBeNull()
    })

    it('🔴 a parent id this app holds NO row for is named, and says it cannot name it', () => {
      const child = conversation('sess_child', 'worker')
      // ⚑ **A database this app did not write** — the FK is `ON` at every door of this app, so the
      // only way to build this row is to turn it off, which is exactly the provenance the field's
      // docblock claims for it (a hand edit, a restored bundle).
      db.pragma('foreign_keys = OFF')
      db.prepare(`UPDATE provider_session SET parent_session_id = ? WHERE id = ?`).run(
        'sess_ghost',
        child,
      )
      db.pragma('foreign_keys = ON')
      const parent = host.whoCalledWhom(child).parent
      expect(parent?.conversation).toBe('sess_ghost')
      // ⛔ **The one null on this shape that is about the READ** — the column is `NOT NULL`, so a
      // row that exists always answers it.
      expect(parent?.provider).toBeNull()
      expect(parent?.identity).toBeNull()
    })
  })

  /* ═══════════════════════════ §3 · completeness, four ways and three words ══════════════════ */

  describe('§3 · every list says what it covered (brief §4)', () => {
    it('🔴 an id this app holds no conversation for is `no-such-conversation`, never `0 spawned`', () => {
      const read = host.whoCalledWhom('sess_nobody')
      expect(read.children.walk).toBe('no-such-conversation')
      expect(read.children.rows).toEqual([])
      expect(read.parent).toBeNull()
      // ⛔ **`452` §5.1's forbidden sentence, one noun over** — the two words draw different copy.
      expect(walkCovers('no-such-conversation')).toContain('no conversation by that id')
      expect(walkCovers('no-such-conversation')).not.toBe(
        walkCovers('every-conversation-this-one-spawned'),
      )
      // ⚑ **The control**: a conversation that really exists and spawned nothing gets the OTHER
      // word over the same empty list.
      const lonely = conversation('sess_lonely', 'worker')
      expect(host.whoCalledWhom(lonely).children.walk).toBe('every-conversation-this-one-spawned')
      expect(host.whoCalledWhom(lonely).children.rows).toEqual([])
    })

    it('⛔ the LEDGER half still answers over an id no session row holds, and says which walk', () => {
      const pm = conversation('sess_pm', 'project-manager')
      // ⚑ A ledger that names a `session_id` no `provider_session` row holds is exactly what
      // `selectSessionsAssignedBy` LEFT-joins for — so the lineage half refuses and the work half
      // does not, which is the reason `no-such-conversation` is documented as the lineage's word.
      giveWork(pm, pm, 'work_self')
      const read = host.whoCalledWhom('sess_nobody')
      expect(read.children.walk).toBe('no-such-conversation')
      expect(read.workGivenOut.walk).toBe('every-conversation-this-one-gave-work-to')
      expect(read.workTakenIn.walk).toBe('every-piece-of-work-this-one-was-given')
    })

    it('⚠️ a store with no database answers `no-ledger` on all three, and never a narrower word', () => {
      expect(NULL_SESSION_STORE.spawnedBy('sess_x').walk).toBe('no-ledger')
      expect(NULL_SESSION_STORE.workThisOneGaveOut('sess_x').walk).toBe('no-ledger')
      expect(NULL_SESSION_STORE.workThisOneWasGiven('sess_x').walk).toBe('no-ledger')
      expect(NULL_SESSION_STORE.conversationBinding('sess_x')).toBeNull()
      // ⛔ **`no-ledger` and never `no-such-conversation`** — a store that cannot look an id up has
      // nothing to say about whether that conversation exists.
      expect(walkCovers('no-ledger')).toContain('no ledger')
    })

    it('⛔ every word this read can answer with is in the register and has a sentence', () => {
      const words = [
        'every-conversation-this-one-spawned',
        'every-piece-of-work-this-one-was-given',
        'no-such-conversation',
      ] as const
      for (const word of words) {
        expect(LEDGER_WALK_KINDS).toContain(word)
        // ⛔ **Fail-closed** — `walkCovers` answers null for a word this build cannot spell, and a
        // surface treats that as *the read did not answer*.
        expect(walkCovers(word)).toBeTruthy()
      }
      // ⚑ **Distinct sentences**: two words that draw the same copy are one word with two names.
      const said = words.map((word) => walkCovers(word))
      expect(new Set(said).size).toBe(words.length)
      // ⚠️ **The one that promises NOTHING about a ledger**, because that walk opens none.
      expect(walkCovers('every-conversation-this-one-spawned')).toContain(
        'No conversation’s record was opened',
      )
    })

    it('🔴 `workTakenIn` opens exactly ONE ledger, and says so in its count', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const other = conversation('sess_other', 'lead')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_a')
      giveWork(other, worker, 'work_b')
      const read = host.whoCalledWhom(worker)
      // ⛔ **Two GIVERS, one ledger** — the work a conversation was given is exactly what its own
      // ledger holds, which is why this is not the other walk with its arguments swapped.
      expect(read.workTakenIn.ledgers).toBe(1)
      expect(read.workTakenIn.rows.map((row) => row.from)).toEqual([pm, other])
      expect(read.workTakenIn.rows.every((row) => row.to === worker)).toBe(true)
      // ⚑ **And the giver's side agrees**: each of them sees one edge, to this conversation.
      expect(host.whoCalledWhom(pm).workGivenOut.rows.map((row) => row.to)).toEqual([worker])
      expect(host.whoCalledWhom(other).workGivenOut.rows.map((row) => row.to)).toEqual([worker])
    })

    it('⚠️ a ledger row this app cannot parse is COUNTED on the work walks, not dropped in silence', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_a')
      // ⛔ `toPersistedEvents` has skipped an unreadable row since `150`, silently. `453`'s rule is
      // that a list of obligations may not be quietly short, and a relationship read is one.
      // ⚠️ **A `work_replied` row and NOT a `work_given` one** — a torn give is the test below's
      // subject; ⚑ since `671` both are counts.
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'work_replied', ?, ?)`,
      ).run('evt_torn', worker, 900, '{not json', NOW + 50)
      const read = host.whoCalledWhom(worker)
      expect(read.workTakenIn.rowsUnread).toBe(1)
      expect(read.workTakenIn.rows).toHaveLength(1)
      // ⚑ **The giver's walk opens the same ledger and counts the same row** — one fact, both ends.
      expect(host.whoCalledWhom(pm).workGivenOut.rowsUnread).toBe(1)
      expect(host.whoCalledWhom(pm).workGivenOut.ledgers).toBe(1)
      // ⚑ **The control that this is measuring the SKIP and not the fixture**: a conversation whose
      // ledger holds nothing torn counts none.
      const clean = conversation('sess_clean', 'clean')
      giveWork(pm, clean, 'work_c')
      expect(host.whoCalledWhom(clean).workTakenIn.rowsUnread).toBe(0)
    })

    /**
     * 🔴 **671 · R18 — RE-AIMED from LOUD to COUNTED AND CARRIED, on purpose** (`671` §5).
     *
     * ⛔ **This test pinned the RAISE** and said why: *"LOUD is the safe direction … and because a
     * later repair that made this statement tolerant would silently move it into `rowsUnread`'s
     * territory."* ⚑ **`671` is that repair, made on the PM's ruling, and it moves the row there
     * LOUDLY**: every walk answers and every walk carries the count. ⚠️ Rule 26, strip AND re-aim —
     * the torn row, the four readers and the finished-work control all stay; what each asserts moved
     * from *throws* to *answers, and says so*. ⛔ **`664` F1's growth of the blast radius is gone with
     * it**: nothing on this list fails any more.
     */
    it('🔴 a payload that is not JSON at all is COUNTED on every walk that meets it, and none of them raises', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_a')
      // ⚑ **THE CONTROL, before anything is torn**: the same four reads on a clean database count 0.
      expect(host.whoCalledWhom(pm).workGivenOut.rowsUnread).toBe(0)
      expect(store.workGivenOutBy(pm).rowsUnread).toBe(0)
      expect(host.whoCalledWhom(worker).workTakenIn.rowsUnread).toBe(0)
      expect(store.workThisOneWasGiven(worker).rowsUnread).toBe(0)
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'work_given', ?, ?)`,
      ).run('evt_bytes', worker, 901, '{not json', NOW + 60)
      // 🔴 **The giver's drawer answers, and the torn row is ONE row** — the fold of the worker's
      // ledger meets it; `RowsUnread` counts it once.
      const drawer = host.whoCalledWhom(pm).workGivenOut
      expect(drawer.rows.map((edge) => edge.piece)).toEqual(['work_a'])
      expect(drawer.rowsUnread).toBe(1)
      // ⚑ **The shipped Work-tab reader walks the same statement and answers identically.**
      expect(store.workGivenOutBy(pm).rowsUnread).toBe(1)
      expect(store.workGivenOutBy(pm).rows).toHaveLength(1)
      // ⚠️ **ONE torn row reaches only the reads that open the ledger holding it** — the candidates
      // of *what I gave out* are `work` rows naming the giver, never a scan of every ledger — so
      // the worker, which gave nothing out, opens no ledger and has nothing to count.
      expect(host.whoCalledWhom(worker).workGivenOut.rows).toEqual([])
      expect(host.whoCalledWhom(worker).workGivenOut.rowsUnread).toBe(0)
      // 🔴 **The receiver's line answers WHILE the work is open** — its composition's wait read asks
      // what the worker gave out, which RAISED here before `671`. ⚠️ **The count is 1 because the
      // worker's OWN fold meets the row** (it is in the worker's ledger); so this pins *answers, and
      // does not double-count* — not *the wait read counts*, which `what-main-hands-the-cards` §5
      // pins with a row only a wait read can meet.
      const line = store.workThisOneWasGiven(worker)
      expect(line.rows).toHaveLength(1)
      expect(line.rowsUnread).toBe(1)
      expect(host.whoCalledWhom(worker).workTakenIn.rowsUnread).toBe(1)
      // ⚑ **And once the work has finished it still counts the row** — its own ledger holds it.
      answerWork(worker, 'work_a')
      expect(store.workThisOneWasGiven(worker).rowsUnread).toBe(1)
      expect(store.workThisOneWasGiven(worker).rows).toHaveLength(1)
    })
  })

  /* ══════════════════ §4 · one aggregate read, one honest completion point ═══════════════════ */

  describe('§4 · `540` MI-19, decided: one read and one `readAt` (brief §3.2)', () => {
    it('⛔ `readAt` is taken LAST, inside the call, and is a completion point', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const before = Date.now()
      const read = host.whoCalledWhom(pm)
      const after = Date.now()
      expect(read.readAt).toBeGreaterThanOrEqual(before)
      expect(read.readAt).toBeLessThanOrEqual(after)
      // ⚑ **It is the app's WALL clock and not the store's injected tick**, because it is a claim
      // about when this answer was finished rather than about the ledger's own ordering.
      expect(read.readAt).not.toBe(NOW)
    })

    it('⛔ there is exactly ONE stamp on the answer, and no per-list time', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const read = host.whoCalledWhom(pm)
      const stamped = Object.entries(read).filter(([key]) => /At$|^at$|time/i.test(key))
      expect(stamped.map(([key]) => key)).toEqual(['readAt'])
      // ⚑ **The alternative `540` offered was per-scope times**, and it is refused rather than
      // forgotten: a list here carries a walk word and three counts, and no clock of its own.
      for (const walk of [read.children, read.workGivenOut, read.workTakenIn]) {
        expect(Object.keys(walk).sort()).toEqual(['ledgers', 'rows', 'rowsUnread', 'walk'])
      }
    })
  })

  /* ═══════════════════ §5 · the status fold is lossy, and the loss is the surface's ══════════ */

  describe('§5 · the product state is carried and never folded here (brief §3.3)', () => {
    it('🔴 a work edge carries the PRODUCT state, not v2.8’s two-valued view of it', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_open')
      giveWork(pm, worker, 'work_held', { held: true })
      giveWork(pm, worker, 'work_done')
      answerWork(worker, 'work_done')
      const states = new Map(
        host.whoCalledWhom(pm).workGivenOut.rows.map((row) => [row.piece, row.state]),
      )
      // ⛔ **Three different words where `open | answered` has two** — `540`: *"the status fold is
      // LOSSY and must not silently be."*
      expect(states.get('work_open')).toBe('working')
      expect(states.get('work_held')).toBe('waiting')
      expect(states.get('work_done')).toBe('answered')
      // ⚑ **And the fold lives where it always did** — `TASK_IS_OPEN`, which a surface asks.
      expect(TASK_IS_OPEN[states.get('work_open') ?? 'answered']).toBe(true)
      expect(TASK_IS_OPEN[states.get('work_done') ?? 'working']).toBe(false)
      // ⛔ **The vocabulary is the product's whole one**, so a sixth state reaches this edge.
      expect(TASK_STATES).toContain('stalled')
      expect(TASK_STATES).toContain('withdrawn')
    })

    it('⛔ *answered* is NEVER inferred from the CONVERSATION’s state', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_open')
      // ⚑ **The conversation ends with the work unfinished**, which is the population `393` §5's
      // *"a derived state a parent can see"* exists for: `list_agents` reads live slots and a
      // conversation that ended has none.
      store.terminate(worker, 'ended', 'completed', tick())
      expect(store.recordedOne(worker)?.status).toBe('ended')
      const row = host.whoCalledWhom(pm).workGivenOut.rows[0]
      // ⛔ **`540` calls this out by name.** The work is still `working`, and `outcome` is ABSENT
      // rather than a fourth value: *"null is not a fourth outcome and must never be read as one."*
      expect(row?.state).toBe('working')
      expect(row?.outcome).toBeUndefined()
      expect(row?.endedAt).toBeNull()
      // ⚑ **The control**: a task that really was answered carries the outcome and an ending.
      answerWork(worker, 'work_open')
      const answered = host.whoCalledWhom(pm).workGivenOut.rows[0]
      expect(answered?.state).toBe('answered')
      expect(answered?.outcome).toBe('done')
      expect(answered?.endedAt).not.toBeNull()
    })
  })

  /* ══════════════ §6 · the FOURTH navigation state, left reachable rather than folded ════════ */

  describe('§6 · `open-in-another-window` stays reachable (brief §3.4)', () => {
    it('🔴 the read carries the raw `running`, and *open in another window* is reachable from it', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const child = conversation('sess_child', 'worker', { parent: pm })
      const row = host.whoCalledWhom(pm).children.rows[0]
      expect(row?.conversation).toBe(child)
      expect(row?.running).toBe('not-running')
      // ⛔ **The fold is the WINDOW's, because it needs a fact the host does not have.** `held` is
      // *the records THIS window holds contain it*, and `RUNNING_STATES`' own docblock says the
      // host cannot answer that about a list command.
      // ⚑ **D-017b · one fact about WHERE is left**, and it is this one: every other state opens the
      // conversation in its full view, so only *another window has it* is still a row's to say.
      expect(openElsewhere('in-a-window', false)).toBe(true)
      // ⚑ **The controls** — the same `running` held by THIS window, and the two states no window
      // holds, are not *elsewhere*.
      expect(openElsewhere('in-a-window', true)).toBe(false)
      expect(openElsewhere('unwatched', false)).toBe(false)
      expect(openElsewhere('not-running', false)).toBe(false)
    })
  })

  /* ═════════════════════════ §8 · the wire, the doors and the entitlement ═══════════════════ */

  describe('§8 · one verb, on the window wire and on no toolset', () => {
    it('🔴 it answers through the real door, with a sink that owns nothing', async () => {
      const pm = conversation('sess_pm', 'project-manager')
      const child = conversation('sess_child', 'worker', { parent: pm })
      const stranger = new RecordingSink('webContents:543')
      // ⛔ **Driven through `executeRuntimeCommand`, not through the host's method** — `203`'s door
      // is what a window reaches, and the classification is `reads`: a window that owns nothing
      // still gets the answer, exactly as the session library does.
      const answer = (await executeRuntimeCommand(host, stranger, {
        kind: 'whoCalledWhom',
        sessionId: pm,
      })) as WhoCalledWhom
      expect(answer.children.rows.map((row) => row.conversation)).toEqual([child])
      // ⚑ **And it offers no act** — nothing on this answer is a press. ⚑ **D-016** · `710`'s
      // `readersProject` (a fact, not a press) went with projects. ⚑ W4.203 · `lastReported` is a
      // fact too.
      expect(Object.keys(answer).sort()).toEqual([
        'children',
        'conversation',
        'lastReported',
        'parent',
        'readAt',
        'workGivenOut',
        'workTakenIn',
      ])
    })
  })

  /* ═════════════════════════ §9 · what moves this population, measured ═════════════════════════ */

  describe('§9 · `runtime:changed` — the answer is ADD NOTHING, and here is the measurement', () => {
    it('⛔ 638 · a RAW ledger append still announces nothing — the announcement is at the VERB', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      announced.length = 0
      giveWork(pm, worker, 'work_a')
      // `giveWork` writes to the store directly; the announcement belongs to the host's verbs
      // (`recordTheGive`, `replyToParent`, ...), so a raw write announces nothing.
      expect(host.whoCalledWhom(pm).workGivenOut.rows).toHaveLength(1)
      // Only `persons`, which the store's record of the commit carries for the work a person is
      // asked about; every other subject is the verb's.
      expect(announced.filter((message) => message.what !== 'persons')).toEqual([])
      // The control: a session row written through the host's own door announces, so the emptiness
      // above is about raw appends and not about an unwired channel.
      announced.length = 0
      host.createAgent({ slug: 'a-control-agent' } as never)
      expect(announced, 'the channel is live in this harness').not.toEqual([])
    })
  })
})
