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
  underWhat,
  type SessionStore,
} from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { LEDGER_WALK_KINDS, WALK_COVERS } from '../src/shared/questions'
import type { RuntimeChangeMessage, RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  MAX_FOREST_CONVERSATIONS,
  type ForestConversation,
  type ForestTask,
  type TheWholeForest,
} from '../src/shared/the-whole-forest'

/**
 * The whole forest is drawn from the person downward:
 *
 * > ⚑ ***"In the Team ui: I want a tab to switch to a graph vue. we see the user at the top,
 * > followed by all brobot conversations right after, and each brobot converation with its own
 * > children etc.. each of them represent a task or converation."***
 *
 * ## ⛔ What each section is for
 *
 *  - **§1** — the shape of the tree: the person is a KIND, and a conversation another one started
 *    hangs under that one.
 *  - **§2** — a node is a conversation OR a piece of work (a task node), and a piece hangs off the
 *    conversation holding it.
 *  - **§3** — what the forest EXCLUDES, and that the exclusion is counted rather than silent.
 *  - **§4** — the bound: short, counted, and a parent that fell outside says so in a word.
 *  - **§6** — the door, the entitlement and the quit.
 *
 * Leave §5 unused: the live-update path uses the `work` change subject rather than a second
 * mechanism on `conversations`. Do not renumber sections, because
 * `scripts/mutations/637/mutations.py` cites them by number.
 *
 * 🔒 The provider is a double, every directory is temporary, and no live app, port, provider home
 * or `auth.json` is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const HOST_SRC = join(here, '../src/main/runtime/runtime-host.ts')
const IPC_SRC = join(here, '../src/main/runtime/ipc.ts')
const FOREST_SRC = join(here, '../src/shared/the-whole-forest.ts')

const NOW = 1_800_000_000_000

/** ⛔ **Prose stripped before anything is counted** — a docblock quoting a call is not a call. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** ⚑ **The conversations of a forest, in the order it drew them.** */
function conversationsOf(forest: TheWholeForest): readonly ForestConversation[] {
  return forest.nodes.rows.filter((row): row is ForestConversation => row.node === 'a-conversation')
}

/** ⚑ **The tasks of a forest, in the order it drew them.** */
function tasksOf(forest: TheWholeForest): readonly ForestTask[] {
  return forest.nodes.rows.filter((row): row is ForestTask => row.node === 'a-task')
}

function nodeFor(forest: TheWholeForest, conversation: string): ForestConversation {
  const found = conversationsOf(forest).find((row) => row.conversation === conversation)
  if (found === undefined) throw new Error(`no node for ${conversation}`)
  return found
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

describe('637 · the whole forest, from the person down', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let announced: RuntimeChangeMessage[]

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-637-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-637-cwd-'))
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
      newSessionId: () => `sess_637_${String(tick())}`,
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

  let ordinals = new Map<string, number>()
  const nextOrdinal = (id: string): number => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    return next
  }

  /**
   * A piece of work given BY one conversation TO another, as the ledger records it — hung under the
   * giver's root.
   *
   * ⛔ **Written into the OWNER's ledger**, which is where `work_given` lives — the fact §2 is built
   * on.
   */
  const giveWork = (
    from: string,
    to: string,
    piece: string,
    label: string,
    over: { title?: string } = {},
  ): string => {
    const root = store.rootOf(from)
    if (root === null) throw new Error(`${from} holds no root to give from`)
    const title = over.title ?? 'look at the migration'
    store.append(
      to,
      nextOrdinal(to),
      { type: 'work_given', piece, label, parent: root.piece, givenBy: from, title, brief: title },
      tick(),
    )
    return piece
  }

  beforeEach(() => {
    ordinals = new Map<string, number>()
  })

  /* ═══════════════════ §1 · the shape of the tree ═══════════════════ */

  describe('§1 · the person is a KIND, and a conversation hangs under the one that started it', () => {
    it('🔴 a conversation nothing spawned hangs under THE PERSON, as a word', () => {
      const mine = conversation('sess_mine', 'brobot')
      const forest = host.theWholeForest()

      expect(nodeFor(forest, mine).under).toEqual({ is: 'the-person' })
      // ⚑ **The fields nothing else in this file reads**, asserted here so a column swapped for its
      // neighbour in the SELECT goes red. ⛔ `profile_slug` and `provider` are adjacent text
      // aliases of the same statement, so nothing but an assertion tells them apart
      // (`a-column-name-is-a-claim`).
      expect(nodeFor(forest, mine).identity).toBe('brobot')
      expect(nodeFor(forest, mine).provider).toBe('codex')
      expect(nodeFor(forest, mine).startedAt).toBeGreaterThanOrEqual(NOW)
      expect(nodeFor(forest, mine).updatedAt).toBeGreaterThanOrEqual(
        nodeFor(forest, mine).startedAt,
      )
    })

    it('🔴 a conversation another one spawned hangs under THAT CONVERSATION', () => {
      const parent = conversation('sess_parent', 'brobot')
      const child = conversation('sess_child', 'worker', { parent })
      const forest = host.theWholeForest()

      expect(nodeFor(forest, child).under).toEqual({ is: 'a-conversation', conversation: parent })
      // ⚑ **The parent is still the person's** — a forest is rooted, and the root is not a spawn.
      expect(nodeFor(forest, parent).under).toEqual({ is: 'the-person' })
    })

    it('⚑ a grandchild reaches its own parent and NOT the root — the tree has depth', () => {
      const top = conversation('sess_top', 'brobot')
      const middle = conversation('sess_middle', 'project-manager', { parent: top })
      const bottom = conversation('sess_bottom', 'worker', { parent: middle })
      const forest = host.theWholeForest()

      expect(nodeFor(forest, bottom).under).toEqual({ is: 'a-conversation', conversation: middle })
      expect(nodeFor(forest, middle).under).toEqual({ is: 'a-conversation', conversation: top })
      expect(nodeFor(forest, top).under).toEqual({ is: 'the-person' })
    })

    it('⛔ the identity is the BINDING’s folded slug and never the caller’s spelling', () => {
      // 🔴 **The spelling that separates the two fields** — a person typing `Dev` mints
      // `agent_identity.slug = 'dev'`, and `ConversationAtWork.identity` would hold `Dev`.
      // ⚠️ This forest carries the folded one, which is what `agentName` joins on.
      const mine = conversation('sess_capital', 'Dev')
      expect(nodeFor(host.theWholeForest(), mine).identity).toBe('dev')
    })

    it('⚑ `running` is the SLOT MAP’s answer and never the status column', async () => {
      const recorded = conversation('sess_recorded', 'worker')
      const live = await host.createSession(
        { provider: 'codex', cwd: workspace, profileId: 'pm' },
        new RecordingSink('window:1'),
      )
      const forest = host.theWholeForest()

      // ⛔ **A row this app is not running** — `status` says `idle` for it and for a live one
      // alike, which is the whole reason this field exists (`421`).
      expect(nodeFor(forest, recorded).running).toBe('not-running')
      expect(nodeFor(forest, recorded).status).toBe('idle')
      // ⚑ **And a row it IS running, in a window** — the paired positive that makes the negative
      // above a measurement.
      expect(nodeFor(forest, live.sessionId).running).toBe('in-a-window')
    })

    it('🔴 `underWhat` is total over its three arms, and the third is the BOUND’s', () => {
      const drawn = new Set(['sess_a'])
      expect(underWhat(null, drawn)).toEqual({ is: 'the-person' })
      expect(underWhat('sess_a', drawn)).toEqual({ is: 'a-conversation', conversation: 'sess_a' })
      // ⛔ **Not `the-person` and not a dangling `a-conversation`** — the parent exists, this
      // reading did not reach it, and the word says exactly that.
      expect(underWhat('sess_b', drawn)).toEqual({
        is: 'a-conversation-this-reading-did-not-draw',
        conversation: 'sess_b',
      })
    })
  })

  /* ═══════════════════ §2 · a node is a conversation OR a task ═══════════════════ */

  describe('§2 · each node says which it is, and a task hangs off its HOLDER', () => {
    it('🔴 work given out appears as a TASK node under the conversation holding it', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker', { parent: pm })
      giveWork(pm, worker, 'work_one', 'W1.1', { title: 'read the migration' })

      const forest = host.theWholeForest()
      const tasks = tasksOf(forest)
      expect(tasks).toHaveLength(1)
      // ⛔ **The HOLDER, which is the ledger the row lives in** — never the giver.
      expect(tasks[0]?.under).toEqual({ is: 'a-conversation', conversation: worker })
      // ⚑ **And the giver is a FIELD**, so the handoff is drawable without a second read.
      expect(tasks[0]?.work.from).toBe(pm)
      expect(tasks[0]?.work.to).toBe(worker)
      expect(tasks[0]?.work.title).toBe('read the migration')
      expect(tasks[0]?.work.label).toBe('W1.1')
      // ⛔ **Both identities, read where the identity lives** — `workThisOneWasGiven`'s rule: a
      // caller cannot name one conversation and hand over another's slug. ⚑ The giver's is its
      // conversation's identity, because a piece carries its giver's conversation and nothing else.
      expect(tasks[0]?.work.toIdentity).toBe('worker')
      expect(tasks[0]?.work.fromIdentity).toBe('project-manager')
      // ⛔ **The GIVER gets a word too** — `work.from` alone would be an id the renderer has to
      // look up, and two things can put a giver outside this reading.
      expect(tasks[0]?.givenBy).toEqual({ is: 'a-conversation', conversation: pm })
    })

    it('⛔ `under` and `work.to` are the SAME conversation, which is what makes the arm narrow', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const a = conversation('sess_a', 'worker')
      const b = conversation('sess_b', 'worker')
      giveWork(pm, a, 'work_a', 'W1.1')
      giveWork(pm, b, 'work_b', 'W1.2')

      for (const task of tasksOf(host.theWholeForest())) {
        expect(task.under.conversation).toBe(task.work.to)
      }
    })

    it('🔴 every node carries its KIND, and the two kinds are all there is', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_one', 'W1.1')

      const kinds = host.theWholeForest().nodes.rows.map((row) => row.node)
      expect(new Set(kinds)).toEqual(new Set(['a-conversation', 'a-task']))
      expect(kinds).toHaveLength(3)
    })

    it('⚑ the task carries the STATE the ledger folded to, unfolded — `TASK_IS_OPEN` decides', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_one', 'W1.1')
      store.append(
        worker,
        nextOrdinal(worker),
        {
          type: 'work_replied',
          piece: 'work_one',
          outcome: 'done',
          summary: 'did it',
          resources: [],
        },
        tick(),
      )

      const [task] = tasksOf(host.theWholeForest())
      expect(task?.work.state).toBe('answered')
      // ⛔ **The fold is the SURFACE's** — this read carries the word and never a boolean.
      expect(TASK_IS_OPEN[task?.work.state ?? 'waiting']).toBe(false)
    })

    it('⛔ a conversation nobody gave work to holds NO task nodes, which is a fact and not a gap', () => {
      conversation('sess_quiet', 'worker')
      expect(tasksOf(host.theWholeForest())).toEqual([])
      expect(host.theWholeForest().nodes.walk).toBe('every-conversation-this-app-placed')
    })
  })

  /* ═══════════════════ §3 · what it excludes, and the disclosure ═══════════════════ */

  describe('§3 · the excluded population is COUNTED rather than silent', () => {
    it('🔴 a conversation this app never placed is in NO forest, and the count says how many', () => {
      const mine = conversation('sess_mine', 'brobot')
      // A conversation swept from a personal provider home has `agent_identity_id IS NULL`;
      // the measured population has 2,027 adopted, never-placed rows.
      store.adopt({
        id: 'sess_theirs',
        provider: 'claude',
        sessionId: 'theirs',
        cwd: workspace,
        // ⛔ **`null` is *no home of OURS holds this conversation*** — the one value that makes a
        // row honestly unplaced, and the population `438` counts.
        profileId: null,
        updatedAt: tick(),
        createdAt: tick(),
      })

      const alsoMine = conversation('sess_also_mine', 'worker')

      const forest = host.theWholeForest()
      expect(new Set(conversationsOf(forest).map((row) => row.conversation))).toEqual(
        new Set([mine, alsoMine]),
      )
      // ⛔ **Excluded by the JOIN and DISCLOSED by a number**, which is `HO-024` §5.3 applied to a
      // read: an omission nobody counts is indistinguishable from nothing having happened.
      // ⚑ **TWO placed and ONE outside, so the two counts cannot be each other** — a fixture where
      // they happened to agree would measure neither (`a-comparison-tested-where-both-sides-agree-measures-nothing`).
      expect(forest.heldByNoAgent).toBe(1)
      expect(forest.conversations).toBe(2)
    })

    it('⚑ an empty workspace is a REAL answer, and the walk word is what says so', () => {
      const forest = host.theWholeForest()
      expect(forest.nodes.rows).toEqual([])
      expect(forest.nodes.walk).toBe('every-conversation-this-app-placed')
      expect(forest.conversations).toBe(0)
    })

    it('🔴 a store with NO database answers `no-ledger` and never the walk’s own word', () => {
      // ⛔ **The forbidden sentence** — *this app has placed no conversations* said by an app that
      // did not look. `452` §5.1, one noun over.
      expect(NULL_SESSION_STORE.everyPlacedConversation(MAX_FOREST_CONVERSATIONS).walk).toBe(
        'no-ledger',
      )
      expect(NULL_SESSION_STORE.placedConversations()).toBe(0)
    })

    it('⚠️ `ledgers` counts the conversations walked and `rows.length` counts nothing of the sort', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_one', 'W1.1')
      giveWork(pm, worker, 'work_two', 'W1.2')

      const forest = host.theWholeForest()
      // ⛔ **Two conversations walked, four nodes drawn** — a caller deriving one from the other
      // would answer *what was found* to a question that asked *what was read*.
      expect(forest.nodes.ledgers).toBe(2)
      expect(forest.nodes.rows).toHaveLength(4)
    })
  })

  /* ═══════════════════ §4 · the bound ═══════════════════ */

  describe('§4 · past the bound the forest is SHORT and says so', () => {
    it('🔴 the walk sentence a person reads still names the constant', () => {
      // ⛔ **The device this table already uses for a constant it cannot import** —
      // `every-provider-wall-recently-recorded` spells `PROVIDER_WALL_LOOKBACK_MS` as *"the last
      // month"*, pinned the same way. ⚑ Without this, `a-number-can-survive-the-death-of-its-derivation`.
      // ⛔ **The WHOLE phrase and not the digits.** ⚠️ `toContain('500')` is satisfied by *"up to
      // 1500 of them"* — the sentence could drift to a bound three times the constant and stay
      // green, which is the drift this pin exists to stop rather than a narrower version of it.
      expect(WALK_COVERS['every-conversation-this-app-placed']).toContain(
        `up to ${String(MAX_FOREST_CONVERSATIONS)} of them`,
      )
      // ⚑ **The control**: the weaker assertion this replaces would pass on a wrong sentence, and
      // the stronger one does not — planted here so the choice is a measurement.
      expect('Newest first, up to 1500 of them').toContain('500')
      expect('Newest first, up to 1500 of them').not.toContain('up to 500 of them')
      // ⚠️ **It is the ONE sentence in the table that does not promise *no limit*.**
      expect(WALK_COVERS['every-conversation-this-app-placed']).not.toContain('no limit')
      // 🔴 **And the claim is CHECKED rather than asserted in prose** — every other walk that
      // reads anything says those words. ⛔ `every-provider-wall-recently-recorded` is the one
      // exception and it is the interesting one: it is bounded by TIME rather than by a count, so
      // it promises *no page* and stops there. ⚑ Naming it here is what keeps this
      // loop from being the vacuous kind that passes over an empty set.
      const reading = LEDGER_WALK_KINDS.filter(
        (walk) => !walk.startsWith('no-') && walk !== 'every-conversation-this-app-placed',
      )
      expect(reading.length).toBeGreaterThan(5)
      for (const walk of reading) {
        if (walk === 'every-conversation-that-holds-work') {
          expect(WALK_COVERS[walk]).toBe('Every conversation that holds work, including roots.')
          continue
        }
        if (walk === 'every-provider-wall-recently-recorded') {
          expect(WALK_COVERS[walk]).not.toContain('no limit')
          expect(WALK_COVERS[walk]).toContain('the last month')
          continue
        }
        expect(WALK_COVERS[walk]).toContain('no limit')
      }
    })

    it('⛔ the store draws at most the bound it is given, NEWEST first', () => {
      for (let n = 0; n < 5; n += 1) conversation(`sess_${String(n)}`, 'worker')
      const walked = store.everyPlacedConversation(3)
      expect(walked.ledgers).toBe(3)
      // ⚑ **Newest first by LAST ACTIVITY**, because the order decides what is dropped. ⚠️ In this
      // fixture `store.create` stamps both columns from one incrementing clock, so creation order
      // and activity order agree — the test above is where they are pulled apart.
      expect(
        walked.rows
          .filter((row): row is ForestConversation => row.node === 'a-conversation')
          .map((row) => row.conversation),
      ).toEqual(['sess_4', 'sess_3', 'sess_2'])
      // 🔴 **And the population is still counted whole**, which is how short is sayable.
      expect(store.placedConversations()).toBe(5)
    })

    it('⛔ the `id DESC` tiebreak decides ties, and a clock with ms resolution makes them', () => {
      // ⚠️ **The fixture's own clock increments on every call**, so every other test in this file
      // has distinct timestamps and the tiebreak is never exercised. ⛔ In the app the store is
      // built with `Date.now`, and a spawn burst or an adoption sweep puts several conversations
      // in one millisecond — where SQLite's order among ties is UNSPECIFIED and two polls can
      // straddle the bound differently.
      //
      // ⚑ **`updated_at` and not `created_at`**, because the bound drops by LAST ACTIVITY: a
      // conversation begun a month ago and worked in this morning must outrank one opened
      // yesterday and never touched, which is what the SELECT's own docblock argues.
      const at = NOW + 10_000
      for (const id of ['sess_aaa', 'sess_bbb', 'sess_ccc']) {
        conversation(id, 'worker')
        db.prepare('UPDATE provider_session SET updated_at = ? WHERE id = ?').run(at, id)
      }
      const drawnTwice = [1, 2].map(() =>
        store
          .everyPlacedConversation(2)
          .rows.filter((row): row is ForestConversation => row.node === 'a-conversation')
          .map((row) => row.conversation),
      )
      // ⛔ **`id DESC` among equal `created_at`** — the two highest ids, in that order, twice.
      expect(drawnTwice[0]).toEqual(['sess_ccc', 'sess_bbb'])
      expect(drawnTwice[1]).toEqual(drawnTwice[0])
      // ⚑ **The control that makes the tie real**: all three rows really do share one moment, so
      // the order above is the tiebreak's answer and not the clock's.
      expect(
        (
          db.prepare('SELECT count(DISTINCT updated_at) AS n FROM provider_session').get() as {
            n: number
          }
        ).n,
      ).toBe(1)
    })

    it('🔴 a drawn conversation whose parent fell outside says so in a WORD', () => {
      const parent = conversation('sess_parent', 'brobot')
      const child = conversation('sess_child', 'worker', { parent })
      // ⛔ **A bound of one keeps the NEWEST — the child — and drops its parent.**
      const walked = store.everyPlacedConversation(1)
      const rows = walked.rows.filter(
        (row): row is ForestConversation => row.node === 'a-conversation',
      )
      expect(rows.map((row) => row.conversation)).toEqual([child])
      expect(rows[0]?.under).toEqual({
        is: 'a-conversation-this-reading-did-not-draw',
        conversation: parent,
      })
    })

    it('🔴 a task whose GIVER fell outside says so in the same WORD', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_one', 'W1.1')

      // ⛔ **A bound of one keeps the NEWEST — the worker, which HOLDS the task — and drops the
      // conversation that gave it.** ⚠️ The task still belongs in the picture; what this reading
      // cannot do is point at its other end.
      const walked = store.everyPlacedConversation(1)
      const tasks = walked.rows.filter((row): row is ForestTask => row.node === 'a-task')
      expect(tasks).toHaveLength(1)
      expect(tasks[0]?.under).toEqual({ is: 'a-conversation', conversation: worker })
      expect(tasks[0]?.givenBy).toEqual({
        is: 'a-conversation-this-reading-did-not-draw',
        conversation: pm,
      })
      // ⚑ **The id is still carried on the edge itself**, unchanged — the word says what this
      // reading can do about it, and `WorkEdge` goes on naming both ends.
      expect(tasks[0]?.work.from).toBe(pm)
    })

    it('⚠️ `the-person` never appears on a task — a task always has a conversation at its giving end', () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_one', 'W1.1')
      giveWork(worker, pm, 'work_two', 'W2.1')

      // ⛔ **The arm is in the TYPE and unreachable in the DATA**, because only a conversation gives
      // a piece — a person's work is a ROOT, which no `work_given` opens and no task node draws.
      // ⚑ Asserted rather than narrowed away, so the claim in the docblock is a measurement.
      for (const task of tasksOf(host.theWholeForest())) {
        expect(task.givenBy.is).not.toBe('the-person')
      }
      expect(tasksOf(host.theWholeForest())).toHaveLength(2)
    })

    it('⚑ under the bound, nothing ever reads the third arm — a planted control', () => {
      const parent = conversation('sess_parent', 'brobot')
      conversation('sess_child', 'worker', { parent })
      const forest = host.theWholeForest()
      // 🔴 **The control for the test above**: same tree, bound not reached, and the arm that
      // fired there does not fire here. Without it, that assertion would pass over a shape that
      // says `did-not-draw` for every child.
      // ⚠️ **Newest first**, which is the walk's own order — the child was created second.
      expect(conversationsOf(forest).map((row) => row.under.is)).toEqual([
        'a-conversation',
        'the-person',
      ])
      expect(forest.conversations).toBe(forest.nodes.ledgers)
    })

    it('🔴 a workspace PAST the bound is short, and the two counts say how short — with the cost', () => {
      // ⛔ **The fixture CROSSES the bound, and it has to.** ⚠️ `M9` — *how many there ARE becomes
      // how many were DRAWN* — SURVIVED against every fixture that sat under it, because under the
      // bound the two numbers are equal by construction
      // (`a-comparison-tested-where-both-sides-agree-measures-nothing`).
      const over = MAX_FOREST_CONVERSATIONS + 1
      for (let n = 0; n < over; n += 1) conversation(`sess_${String(n).padStart(4, '0')}`, 'worker')

      const began = Date.now()
      const forest = host.theWholeForest()
      const took = Date.now() - began

      expect(forest.conversations).toBe(over)
      expect(forest.nodes.ledgers).toBe(MAX_FOREST_CONVERSATIONS)
      expect(conversationsOf(forest)).toHaveLength(MAX_FOREST_CONVERSATIONS)
      // ⚑ **The newest survived and the oldest did not**, which is the order's whole job.
      expect(nodeFor(forest, 'sess_0500').conversation).toBe('sess_0500')
      expect(conversationsOf(forest).some((row) => row.conversation === 'sess_0000')).toBe(false)
      // 🔴 **The COST, measured rather than assumed** (standing rule 29 · size M). ⛔ Five hundred
      // conversations, five hundred ledger folds and two counts, in one synchronous call.
      // ⛔ **The assertion is a SMOKE BOUND and NOT a regression detector, which is standing rule
      // 22 honoured rather than cited.** ⚠️ A wall-clock bound reports the machine; at 5,000 ms
      // over a 4 ms measurement it would stay green through a fifty-fold regression, and saying
      // otherwise would be `a-title-that-names-a-count-the-assertion-never-checks` in a comment.
      // ⚑ **What it DOES catch is the shape that would make this read unusable** — a hang, an
      // accidental N+1 over a provider home, a fold that never terminates — and the NUMBER is
      // reported by `console.info` for a person to read rather than asserted.
      //
      // 🔴 **What this measurement CANNOT say, stated because the number is small.** ⛔ These five
      // hundred ledgers are EMPTY, so what is timed is the scan, the two joins and five hundred
      // `activeGeneration` lookups — not the fold. ⚠️ `derivePieces` walks whatever each ledger
      // holds, so a workspace of long conversations costs more than this and the honest claim is
      // *the STRUCTURE is cheap at the bound*, never *the forest is cheap*.
      expect(took).toBeLessThan(5_000)
      console.info(`637 · a forest of ${String(MAX_FOREST_CONVERSATIONS)} took ${String(took)}ms`)
    })

    it('⛔ the host passes the wire constant and does not hold a second copy of it', () => {
      const source = code(readFileSync(HOST_SRC, 'utf8'))
      expect(source).toContain('everyPlacedConversation(MAX_FOREST_CONVERSATIONS, archived)')
      // ⚠️ **One number, on the wire** — a literal here would be `169` §1's drift with a number
      // in it. A control, so the negative has a shape: the constant's NAME is present.
      expect(source).not.toMatch(/everyPlacedConversation\(\s*\d/)
      expect(code(readFileSync(FOREST_SRC, 'utf8'))).toContain('MAX_FOREST_CONVERSATIONS = 500')
    })
  })

  /* ═══════════════════ §6 · the door ═══════════════════ */

  describe('§6 · the wire, the entitlement and the quit', () => {
    it('🔴 the command takes NO fields, so there is no page a caller can widen', () => {
      const source = code(readFileSync(IPC_SRC, 'utf8'))
      expect(source).toContain("z.object({ kind: z.literal('theWholeForest') })")
      // ⛔ **No `limit`, no `sessionId`, no `projectSlug`** — the answer is rooted at the person.
      expect(source).not.toMatch(/z\.literal\('theWholeForest'\),\s*\w+:/)
    })

    it('⛔ it is refused DURING A QUIT, like both of its population neighbours', () => {
      const source = code(readFileSync(IPC_SRC, 'utf8'))
      expect(source).toContain("theWholeForest: 'refused'")
    })

    it('⚑ it answers through the dispatcher, with no sink and no owner', async () => {
      const mine = conversation('sess_mine', 'brobot')
      const before = Date.now()
      const answer = (await executeRuntimeCommand(host, new RecordingSink('window:1'), {
        kind: 'theWholeForest',
      })) as TheWholeForest
      expect(conversationsOf(answer).map((row) => row.conversation)).toEqual([mine])
      // ⚠️ **One completion point, stamped LAST** — every node was read by it. ⛔ **The app's WALL
      // clock and not the injected one**, which is `WhoCalledWhom.readAt`'s rule and the reason
      // this is bracketed rather than compared to the fixture's `NOW`.
      expect(answer.readAt).toBeGreaterThanOrEqual(before)
      expect(answer.readAt).toBeLessThanOrEqual(Date.now())
    })

    it('🔴 no toolset reaches it — a picture of every conversation is not an agent’s fact', () => {
      const tools = code(readFileSync(join(here, '../src/main/runtime/agent-tools.ts'), 'utf8'))
      // ⛔ **A negative with a shape**: the verb's own name, in the file that builds every tool.
      expect(tools).not.toContain('theWholeForest')
      // ⚑ **The control** — its neighbours are not there either, and a verb that IS reaches this
      // search, which is what makes the absence a measurement.
      expect(tools).not.toContain('whatEachConversationIsWaitingOn')
      expect(tools).toContain('list_agents')
    })
  })
})
