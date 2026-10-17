import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { openElsewhere } from '../src/renderer/src/lib/taking-over'
import { LEDGER_WALK_KINDS, walkCovers } from '../src/shared/questions'
import { RUNTIME_CHANGE_SUBJECTS } from '../src/shared/runtime-ipc'
import type { RuntimeChangeMessage, RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { TASK_IS_OPEN, TASK_STATES } from '../src/shared/tasks'
import type { WhoCalledWhom } from '../src/shared/who-called-whom'

/**
 * 🔴 **543 · who called whom — the read that has to exist first** (`540` §7 slice 1).
 *
 * ## ⛔ The premise, asserted rather than quoted (§0)
 *
 * Navigation needs the recipient conversation, not just a profile slug. `WorkGivenOut`
 * carries `givenToProfile` without a session id. §0 uses two conversations of one identity to
 * demonstrate the shipped reader returning the same word for both; this is a retained defect
 * demonstration rather than a claim that the reader was changed.
 *
 * ## ⚑ What each section is for
 *
 *  - **§0** — the premise: one identity, two conversations, and the answer that cannot separate them.
 *  - **§1** — the property, driven through the host on a real database.
 *  - **§2** — a start and a handoff are INDEPENDENT edges (`540` §5).
 *  - **§3** — completeness: four empties, three words, and a `rowsUnread` that measures something.
 *  - **§4** — one aggregate, one honest completion point (`540` MI-19, brief §3.2).
 *  - **§5** — the status fold is lossy and is not folded here (brief §3.3).
 *  - **§6** — the FOURTH navigation state stays reachable (brief §3.4).
 *  - **§7** — lineage from explicit ids and from nothing else (brief §3.1).
 *  - **§8** — the wire, the doors and the entitlement.
 *  - **§9** — `runtime:changed`: what moves this population, measured (brief §5.3).
 *
 * 🔒 The provider is a double, every directory is temporary, and no live app, port, provider home
 * or `auth.json` is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const HOST_SRC = join(here, '../src/main/runtime/runtime-host.ts')
const IPC_SRC = join(here, '../src/main/runtime/ipc.ts')
const EDGES_SRC = join(here, '../src/shared/who-called-whom.ts')
const STORE_SRC = join(here, '../src/main/db/session-store.ts')

const NOW = 1_800_000_000_000

/** ⛔ **Prose stripped before anything is counted** — a docblock quoting a call is not a call. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

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
      // ⚑ **Standing rule 12: plant TWO.** One conversation of this identity is a child and the
      // other is not, and both are given work — so every field of the answer has to separate them.
      const born = conversation('sess_worker_1', 'worker', { parent: pm })
      const adopted = conversation('sess_worker_2', 'worker')
      giveWork(pm, born, 'work_a', { title: 'the first job' })
      giveWork(pm, adopted, 'work_b', { title: 'the second job' })

      const read = host.whoCalledWhom(pm)
      // ⛔ **One of the two is a child and the other is not**, and a reader keyed on the identity
      // would have had to say *both* or *neither*.
      expect(read.children.rows.map((row) => row.conversation)).toEqual([born])
      expect(read.children.rows.map((row) => row.identity)).toEqual(['worker'])
      // ⛔ **Both were given work, and the two edges land on two different conversations.**
      expect(read.workGivenOut.rows.map((row) => row.to)).toEqual([born, adopted])
      expect(new Set(read.workGivenOut.rows.map((row) => row.toIdentity))).toEqual(
        new Set(['worker']),
      )
      // 🔴 **The whole point, in one line**: the identity is the same word and the edge is not.
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

  /* ═════════════ §2 · a start and a handoff are two edges and never derived from each other ═══ */

  describe('§2 · `540` §5 — work outside the child list is a real product case', () => {
    it('⛔ work to a conversation this one never spawned is an edge, and not a child', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const stranger = conversation('sess_stranger', 'auditor')
      giveWork(pm, stranger, 'work_a')
      const read = host.whoCalledWhom(pm)
      expect(read.workGivenOut.rows.map((row) => row.to)).toEqual([stranger])
      expect(read.children.rows).toEqual([])
      // ⛔ **So `childIds` may never be derived from the work list** — it would invent a start.
      expect(read.children.walk).toBe('every-conversation-this-one-spawned')
    })

    it('⛔ a child this one never gave work to is a child, and not a work edge', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const child = conversation('sess_child', 'worker', { parent: pm })
      const read = host.whoCalledWhom(pm)
      expect(read.children.rows.map((row) => row.conversation)).toEqual([child])
      expect(read.workGivenOut.rows).toEqual([])
      // ⛔ **And the work list may never be derived from the child list** — it would invent work.
      expect(read.workGivenOut.walk).toBe('every-conversation-this-one-gave-work-to')
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
    it('🔴 the host answers SYNCHRONOUSLY, which is what makes one stamp honest', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const answer: WhoCalledWhom | Promise<WhoCalledWhom> = host.whoCalledWhom(pm)
      // ⛔ **The condition `540` named:** *"One timestamp is honest only if the host performs one
      // atomic/defined aggregate read and records the common completion point."* ⚑ Nothing can be
      // written between two of these lists if the whole read is one uninterrupted stretch, and
      // *not a thenable* is the form of that claim a test can hold.
      expect(typeof (answer as { then?: unknown }).then).toBe('undefined')
      expect((answer as WhoCalledWhom).conversation).toBe(pm)
    })

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

    it('⚠️ there is no `await` between the first statement of the read and the stamp', () => {
      const host_ = code(readFileSync(HOST_SRC, 'utf8'))
      const at = host_.indexOf('whoCalledWhom(sessionId: string): WhoCalledWhom {')
      expect(at).toBeGreaterThan(-1)
      const body = host_.slice(at, host_.indexOf('\n  }', at))
      expect(body).toContain('readAt: Date.now(),')
      // ⛔ **A source census, because the property is about the SHAPE of the method** and a runtime
      // assertion can only see that this call happened not to be interrupted.
      expect(body).not.toContain('await ')
      expect(body).not.toContain('async ')
      // ⚑ **The control** (standing rule 12's shape): the same slice of a method that DOES await
      // is found by the same expression, so this is not a search that could never fire.
      const awaits = host_.slice(host_.indexOf('async closeAll('))
      expect(awaits).toContain('await ')
      // ⛔ **And the door does not await it either** — an `await` on the `case` would not create the
      // gap, but it would be the one line a later reader could take as permission.
      const ipc = code(readFileSync(IPC_SRC, 'utf8'))
      expect(ipc).toContain('return host.whoCalledWhom(command.sessionId)')
      expect(ipc).not.toContain('return await host.whoCalledWhom(')
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

    it('⛔ the read publishes no `HereIs`, no gesture and no liveness', () => {
      const edges = code(readFileSync(EDGES_SRC, 'utf8'))
      const host_ = code(readFileSync(HOST_SRC, 'utf8'))
      const at = host_.indexOf('whoCalledWhom(sessionId: string): WhoCalledWhom {')
      const body = host_.slice(at, host_.indexOf('\n  }', at))
      // ⛔ **Collapsing the state here is the defect `540` MI-20 names**, and the shape is asserted
      // rather than the intention documented.
      expect(edges).not.toContain('HereIs')
      // ⚑ **D-017b · the window's fold is `openElsewhere` now**, and it stays the window's.
      expect(edges).not.toContain('openElsewhere')
      expect(edges).not.toContain('gesture')
      expect(body).not.toContain('livenessStateOf')
      // 🔴 **`509`'s rule is why liveness is absent**: the word may go on a reader whose re-read
      // cadence is shorter than the silence window, and nothing bounds this one's. ⚠️ `540` says
      // the same of this panel in particular.
      expect(edges).not.toContain('LivenessState')
      // ⚑ **The control**: the word this read DOES publish is found by the same expressions.
      expect(edges).toContain('RunningState')
      expect(body).toContain('runningStateOf')
    })
  })

  /* ═════════════════════ §7 · lineage from explicit ids and from nothing else ════════════════ */

  describe('§7 · `540` §3.1 — never derive lineage from role, title or task text', () => {
    it('🔴 two conversations with ONE identity and ONE task text are still two edges', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const a = conversation('sess_a', 'worker', { parent: pm })
      const b = conversation('sess_b', 'worker')
      // ⚑ **Everything a derivation could have keyed on is identical** — same identity, same
      // title — and the two rows are still told apart, because nothing keys on those.
      giveWork(pm, a, 'work_a', { title: 'do the thing' })
      giveWork(pm, b, 'work_b', { title: 'do the thing' })
      const read = host.whoCalledWhom(pm)
      expect(read.children.rows.map((row) => row.conversation)).toEqual([a])
      expect(read.workGivenOut.rows.map((row) => row.to)).toEqual([a, b])
      expect(new Set(read.workGivenOut.rows.map((row) => row.title)).size).toBe(1)
    })

    it('⛔ the two statements behind the lineage name an ID column and nothing else', () => {
      const store_ = code(readFileSync(STORE_SRC, 'utf8'))
      const spawnedBy = store_.slice(store_.indexOf('spawnedBy: db.prepare('))
      const sql = spawnedBy.slice(0, spawnedBy.indexOf('),'))
      // ⛔ **The candidate set is the self-FK and is not a heuristic.**
      expect(sql).toContain('WHERE s.parent_session_id = ?')
      for (const forbidden of ['role', 'display_name', 'text', 'title']) {
        expect(sql, `the child query reads ${forbidden}`).not.toContain(forbidden)
      }
      // ⚑ **The control**: the same expression finds a column the query really does read.
      expect(sql).toContain('s.provider')
      // ⛔ **And the work edge is built from the row's own two id fields.**
      const edges = code(readFileSync(EDGES_SRC, 'utf8'))
      expect(edges).toContain('from: row.giver,')
      expect(edges).toContain('to: row.owner,')
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

    it('⛔ no toolset reaches it, and the agent doors are unchanged', () => {
      const tools = code(readFileSync(join(here, '../src/main/runtime/agent-tools.ts'), 'utf8'))
      expect(tools).not.toContain('whoCalledWhom')
      // ⚑ **What keeps an agent off this door is that the verb lives on the window wire and on no
      // toolset** — `the-rails-before-anything-can-reach-them.test.ts` is where that inventory is
      // pinned, and this is the one line of it this dispatch owes.
      const host_ = code(readFileSync(HOST_SRC, 'utf8'))
      const at = host_.indexOf('whoCalledWhom(sessionId: string): WhoCalledWhom {')
      const body = host_.slice(at, host_.indexOf('\n  }', at))
      expect(body).not.toContain('requireAPerson')
      expect(body).not.toContain('Caller')
    })
  })

  /* ═══════════════════ §9 · what moves this population, measured (brief §5.3) ════════════════ */

  describe('§9 · `runtime:changed` — the answer is ADD NOTHING, and here is the measurement', () => {
    it('🔴 the LINEAGE half moves only when a session ROW is written, which already announces', () => {
      const pm = conversation('sess_pm', 'project-manager')
      expect(host.whoCalledWhom(pm).children.rows).toEqual([])
      // ⛔ **`parent_session_id` has exactly one writer on the creation path** — `store.create`'s
      // parent — so the lineage answer moves exactly when a row is written, which is
      // `theWorldMoved('conversations')`' own stated CATEGORY (`534`, standing rule 20).
      const store_ = code(readFileSync(STORE_SRC, 'utf8'))
      expect(store_.split('SET parent_session_id = ?').length - 1).toBe(1)
      conversation('sess_child', 'worker', { parent: pm })
      expect(host.whoCalledWhom(pm).children.rows).toHaveLength(1)
      // ⚑ **Two subjects and no third** — a member added here is a compile error in
      // `the-world-moved.ts`'s `Record<RuntimeChangeSubject, () => void>` until somebody says what
      // to re-read, and this read gives nobody anything new to re-read.
      // ⚑ **638 · a THIRD member**, `work` — the condition `534` set (*do not add a subject
      // nothing reads*) lapsed when `631` built the task lists that read it.
      expect([...RUNTIME_CHANGE_SUBJECTS]).toEqual(['conversations', 'agents', 'work'])
    })

    it('⛔ 638 · a RAW ledger append still announces nothing — the announcement is at the VERB', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      announced.length = 0
      giveWork(pm, worker, 'work_a')
      // 🔴 **638 · RE-AIMED, not stripped** (standing rule 26). ⛔ **The sentence that went false
      // is *"and that is unchanged"***: `638` added the `work` subject and five announcements, so
      // the app DOES announce when work moves. ⚑ **What this test measures is narrower and still
      // true, and it is the more useful half**: `giveWork` writes to the STORE directly, and a raw
      // write announces nothing — because the announcement is at the VERB (`recordTheGive`,
      // `replyToParent`, `takeBackPiece`, `takeQueuedBack`, `runFlush`), which is where `534` put
      // its own and where a durable write has already committed.
      // ⚠️ **The arrival half is pinned in `work-moved-and-nothing-announced-it.test.ts`**, driven
      // through the host's verbs end to end.
      expect(host.whoCalledWhom(pm).workGivenOut.rows).toHaveLength(1)
      expect(announced).toEqual([])
      // ⛔ **THE CONTROL, REPAIRED.** ⚠️ It read `expect(announced.length).toBeGreaterThanOrEqual(0)`
      // — true of every array there is, so it proved nothing
      // (`a-positive-assertion-must-differ-from-the-default`). ⚑ A session row written through the
      // host's own door announces, so the emptiness above is a fact about RAW APPENDS and not about
      // a dep nobody wired.
      announced.length = 0
      host.createAgent({ slug: 'a-control-agent' } as never)
      expect(announced, 'the channel is live in this harness').not.toEqual([])
    })
  })
})
