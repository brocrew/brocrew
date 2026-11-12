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
  underWhat,
  type SessionStore,
} from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { type RuntimeChangeMessage } from '../src/shared/runtime-ipc'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  ALL_ADMITS_NEWEST,
  FOREST_PAGE,
  type ForestConversation,
  type ForestReading,
  type ForestScope,
  type ForestTask,
  type ForestWindow,
  type TheWholeForest,
} from '../src/shared/the-whole-forest'
import { archivedInMemory } from '../src/main/archived-file'
import { RecordingSink, syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'
import { forestOf, forestSnapshotOf } from './lib/forest-of-host'

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
 *  - **§4** — the windows: their counts, the `all` budget, and the ancestors that connect a window.
 *  - **§6** — the door, the entitlement and the quit.
 *  - **§7** — a conversation's own tree, whole across every date, replacements included.
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

const NOW = 1_800_000_000_000

/** A tree reading of a conversation nothing holds. */
const TREE_OF_NOTHING = {
  scope: { is: 'the-tree-of', conversation: 'sess_a' },
  measuredFrom: NOW,
  running: [],
  hidden: [],
  insteadOf: [],
} as const

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

describe('637 · the whole forest, from the person down', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let announced: RuntimeChangeMessage[]
  let archived: ReturnType<typeof archivedInMemory>
  const hosts: RuntimeHost[] = []

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-637-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-637-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    announced = []
    store = createSessionStore(db, tick)
    archived = archivedInMemory()
    host = aHost()
  })

  /** A host over this test's store: a second one is this app after a restart. */
  const aHost = (): RuntimeHost => {
    const made = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: syntheticProviderHome(() => userData),
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
      archived,
    })
    hosts.push(made)
    return made
  }

  afterEach(async () => {
    for (const one of hosts.splice(0)) await one.closeAll()
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

  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR
  /** Moves a conversation's last activity `ms` into the past. */
  const ago = (id: string, ms: number): string => {
    db.prepare('UPDATE provider_session SET updated_at = ? WHERE id = ?').run(clock - ms, id)
    return id
  }
  const numbered = (n: number): string => `sess_${String(n).padStart(4, '0')}`
  const windowOf = (window: ForestWindow): ForestScope => ({ is: 'the-workspace', window })
  const treeOf = (conversation: string): ForestScope => ({ is: 'the-tree-of', conversation })
  const read = (scope: ForestScope): Promise<ForestReading> => host.forestReading(scope)
  const listedBy = (reading: ForestReading): string[] => [
    ...reading.members.admitted,
    ...reading.context,
    ...reading.behind,
  ]
  /** Records that `standIn` took `old`'s place, and reads it as this app does after a restart. */
  const replace = (old: string, standIn: string): void => {
    store.append(old, nextOrdinal(old), { type: 'replaced_by', sessionId: standIn }, tick())
    host = aHost()
  }

  /* ═══════════════════ §1 · the shape of the tree ═══════════════════ */

  describe('§1 · the person is a KIND, and a conversation hangs under the one that started it', () => {
    it('🔴 a conversation nothing spawned hangs under THE PERSON, as a word', async () => {
      const mine = conversation('sess_mine', 'brobot')
      const forest = await forestOf(host)

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

    it('🔴 a conversation another one spawned hangs under THAT CONVERSATION', async () => {
      const parent = conversation('sess_parent', 'brobot')
      const child = conversation('sess_child', 'worker', { parent })
      const forest = await forestOf(host)

      expect(nodeFor(forest, child).under).toEqual({ is: 'a-conversation', conversation: parent })
      // ⚑ **The parent is still the person's** — a forest is rooted, and the root is not a spawn.
      expect(nodeFor(forest, parent).under).toEqual({ is: 'the-person' })
    })

    it('⚑ a grandchild reaches its own parent and NOT the root — the tree has depth', async () => {
      const top = conversation('sess_top', 'brobot')
      const middle = conversation('sess_middle', 'project-manager', { parent: top })
      const bottom = conversation('sess_bottom', 'worker', { parent: middle })
      const forest = await forestOf(host)

      expect(nodeFor(forest, bottom).under).toEqual({ is: 'a-conversation', conversation: middle })
      expect(nodeFor(forest, middle).under).toEqual({ is: 'a-conversation', conversation: top })
      expect(nodeFor(forest, top).under).toEqual({ is: 'the-person' })
    })

    it('⛔ the identity is the BINDING’s folded slug and never the caller’s spelling', async () => {
      // 🔴 **The spelling that separates the two fields** — a person typing `Dev` mints
      // `agent_identity.slug = 'dev'`, and `ConversationAtWork.identity` would hold `Dev`.
      // ⚠️ This forest carries the folded one, which is what `agentName` joins on.
      const mine = conversation('sess_capital', 'Dev')
      expect(nodeFor(await forestOf(host), mine).identity).toBe('dev')
    })

    it('⚑ `running` is the SLOT MAP’s answer and never the status column', async () => {
      const recorded = conversation('sess_recorded', 'worker')
      const live = await host.createSession(
        { provider: 'codex', cwd: workspace, profileId: 'pm' },
        new RecordingSink('window:1'),
      )
      const forest = await forestOf(host)

      // ⛔ **A row this app is not running** — `status` says `idle` for it and for a live one
      // alike, which is the whole reason this field exists (`421`).
      expect(nodeFor(forest, recorded).running).toBe('not-running')
      expect(nodeFor(forest, recorded).status).toBe('idle')
      // ⚑ **And a row it IS running, in a window** — the paired positive that makes the negative
      // above a measurement.
      expect(nodeFor(forest, live.sessionId).running).toBe('in-a-window')
    })

    it('🔴 `underWhat` is total over its three arms, and the third is the reading’s', async () => {
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
    it('🔴 work given out appears as a TASK node under the conversation holding it', async () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker', { parent: pm })
      giveWork(pm, worker, 'work_one', 'W1.1', { title: 'read the migration' })

      const forest = await forestOf(host)
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

    it('⛔ `under` and `work.to` are the SAME conversation, which is what makes the arm narrow', async () => {
      const pm = conversation('sess_pm', 'project-manager')
      const a = conversation('sess_a', 'worker')
      const b = conversation('sess_b', 'worker')
      giveWork(pm, a, 'work_a', 'W1.1')
      giveWork(pm, b, 'work_b', 'W1.2')

      for (const task of tasksOf(await forestOf(host))) {
        expect(task.under.conversation).toBe(task.work.to)
      }
    })

    it('🔴 every node carries its KIND, and the two kinds are all there is', async () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_one', 'W1.1')

      const kinds = (await forestOf(host)).nodes.rows.map((row) => row.node)
      expect(new Set(kinds)).toEqual(new Set(['a-conversation', 'a-task']))
      expect(kinds).toHaveLength(3)
    })

    it('⚑ the task carries the STATE the ledger folded to, unfolded — `TASK_IS_OPEN` decides', async () => {
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

      const [task] = tasksOf(await forestOf(host))
      expect(task?.work.state).toBe('answered')
      // ⛔ **The fold is the SURFACE's** — this read carries the word and never a boolean.
      expect(TASK_IS_OPEN[task?.work.state ?? 'waiting']).toBe(false)
    })

    it('⛔ a conversation nobody gave work to holds NO task nodes, which is a fact and not a gap', async () => {
      conversation('sess_quiet', 'worker')
      expect(tasksOf(await forestOf(host))).toEqual([])
      expect((await forestOf(host)).nodes.walk).toBe('every-conversation-this-app-placed')
    })
  })

  /* ═══════════════════ §3 · what it excludes, and the disclosure ═══════════════════ */

  describe('§3 · the excluded population is COUNTED rather than silent', () => {
    it('🔴 a conversation this app never placed is in NO forest, and the count says how many', async () => {
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

      const forest = await forestOf(host)
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

    it('⚑ an empty workspace is a REAL answer, and the walk word is what says so', async () => {
      const forest = await forestOf(host)
      expect(forest.nodes.rows).toEqual([])
      expect(forest.nodes.walk).toBe('every-conversation-this-app-placed')
      expect(forest.conversations).toBe(0)
    })

    it('🔴 a store with NO database answers `no-ledger` and never the walk’s own word', async () => {
      // ⛔ **The forbidden sentence** — *this app has placed no conversations* said by an app that
      // did not look. `452` §5.1, one noun over.
      expect(NULL_SESSION_STORE.forestNodesOf(['sess_a'], new Set(), []).nodes.walk).toBe(
        'no-ledger',
      )
      expect(NULL_SESSION_STORE.forestListing(TREE_OF_NOTHING).total).toBe(0)
    })

    it('⚠️ `ledgers` counts the conversations walked and `rows.length` counts nothing of the sort', async () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_one', 'W1.1')
      giveWork(pm, worker, 'work_two', 'W1.2')

      const forest = await forestOf(host)
      // ⛔ **Two conversations walked, four nodes drawn** — a caller deriving one from the other
      // would answer *what was found* to a question that asked *what was read*.
      expect(forest.nodes.ledgers).toBe(2)
      expect(forest.nodes.rows).toHaveLength(4)
    })
  })

  /* ═══════════════════ §4 · the windows ═══════════════════ */

  describe('§4 · each window counts and draws by one rule, and connects what it draws', () => {
    it('🔴 every window counts its conversations by the rules it draws them by, from one clock', async () => {
      const fresh = ago(conversation('sess_fresh', 'worker'), 30 * MINUTE)
      const today = ago(conversation('sess_today', 'worker'), 3 * HOUR)
      const thisWeek = ago(conversation('sess_week', 'worker'), 2 * DAY)
      const old = ago(conversation('sess_old', 'worker'), 10 * DAY)
      const hidden = ago(conversation('sess_archived', 'worker'), MINUTE)
      archived.add([hidden], clock)
      store.adopt({
        id: 'sess_theirs',
        provider: 'claude',
        sessionId: 'theirs',
        cwd: workspace,
        profileId: null,
        updatedAt: tick(),
        createdAt: tick(),
      })

      const counts = { active: 0, hour: 1, day: 2, week: 3, all: 4 }
      const drawn = {
        active: [],
        hour: [fresh],
        day: [fresh, today],
        week: [fresh, today, thisWeek],
        all: [fresh, today, thisWeek, old],
      }
      for (const [window, members] of Object.entries(drawn)) {
        const reading = await read(windowOf(window as keyof typeof drawn))
        expect(reading.counts, window).toEqual(counts)
        expect(reading.members, window).toEqual({ total: members.length, admitted: members })
        expect(reading.context, window).toEqual([])
        expect(reading.root, window).toBeNull()
        expect(reading.heldByNoAgent, window).toBe(1)
      }
    })

    it('🔴 a window draws every ancestor that connects its conversations, and counts none of them', async () => {
      const top = ago(conversation('sess_top', 'brobot'), 40 * DAY)
      const middle = ago(conversation('sess_middle', 'project-manager', { parent: top }), 20 * DAY)
      const child = ago(conversation('sess_child', 'worker', { parent: middle }), 10 * MINUTE)
      const stranger = ago(conversation('sess_stranger', 'worker'), 30 * DAY)

      const reading = await read(windowOf('hour'))
      expect(reading.members).toEqual({ total: 1, admitted: [child] })
      expect(reading.counts?.hour).toBe(1)
      expect(reading.context).toEqual([middle, top])
      // Ancestors are read first, so the first page draws the connected tree.
      expect(reading.unfolded).toEqual([])
      const forest = await forestOf(host, windowOf('hour'))
      expect(nodeFor(forest, child).under).toEqual({ is: 'a-conversation', conversation: middle })
      expect(nodeFor(forest, middle).under).toEqual({ is: 'a-conversation', conversation: top })
      expect(nodeFor(forest, top).under).toEqual({ is: 'the-person' })
      expect(conversationsOf(forest).map((row) => row.conversation)).not.toContain(stranger)
      expect(forest.conversations).toBe(3)

      // The control: where the window admits them, they are members and nothing is context.
      const all = await read(windowOf('all'))
      expect(all.context).toEqual([])
      expect([...all.members.admitted].sort()).toEqual([child, middle, stranger, top].sort())
    })

    it('🔴 a task whose giver is outside the window says so in a word, and keeps its id', async () => {
      const pm = conversation('sess_pm', 'project-manager')
      const worker = conversation('sess_worker', 'worker')
      giveWork(pm, worker, 'work_one', 'W1.1')
      ago(pm, 10 * DAY)
      ago(worker, MINUTE)

      const [task] = tasksOf(await forestOf(host, windowOf('hour')))
      expect(task?.under).toEqual({ is: 'a-conversation', conversation: worker })
      expect(task?.givenBy).toEqual({
        is: 'a-conversation-this-reading-did-not-draw',
        conversation: pm,
      })
      expect(task?.work.from).toBe(pm)
      // The control: where the giver is drawn, the word names it.
      const [inAll] = tasksOf(await forestOf(host, windowOf('all')))
      expect(inAll?.givenBy).toEqual({ is: 'a-conversation', conversation: pm })
    })

    it('🔴 `all` admits the newest 500 and says how many there are; a parent past them is context', async () => {
      const parent = ago(conversation('sess_parent', 'brobot'), 30 * DAY)
      const over = ALL_ADMITS_NEWEST + 20
      for (let n = 0; n < over; n += 1)
        conversation(numbered(n), 'worker', n === over - 1 ? { parent } : {})

      const began = Date.now()
      const snapshot = await forestSnapshotOf(host, windowOf('all'))
      const took = Date.now() - began
      const reading = snapshot.reading
      expect(reading.counts?.all).toBe(over + 1)
      expect(reading.members.total).toBe(over + 1)
      expect(reading.members.admitted).toHaveLength(ALL_ADMITS_NEWEST)
      expect(reading.members.admitted[0]).toBe(numbered(over - 1))
      expect(reading.members.admitted.at(-1)).toBe(numbered(over - ALL_ADMITS_NEWEST))
      expect(reading.members.admitted).not.toContain(numbered(0))
      expect(reading.context).toEqual([parent])
      expect(snapshot.complete).toBe(true)
      expect(conversationsOf(snapshot.forest)).toHaveLength(ALL_ADMITS_NEWEST + 1)
      expect(snapshot.forest.nodes.ledgers).toBe(ALL_ADMITS_NEWEST + 1)
      // A smoke bound over empty ledgers: it catches a hang or a fold per row, not a regression.
      expect(took).toBeLessThan(20_000)
      console.info(
        `a forest of ${String(over + 1)}, ${String(ALL_ADMITS_NEWEST)} admitted, took ${String(took)}ms`,
      )
    })

    it('🔴 a time window admits every match past 500, in pages, and nothing is cut', async () => {
      const over = ALL_ADMITS_NEWEST + 20
      for (let n = 0; n < over; n += 1) conversation(numbered(n), 'worker')

      const snapshot = await forestSnapshotOf(host, windowOf('day'))
      const reading = snapshot.reading
      expect(reading.members.total).toBe(over)
      expect(reading.members.admitted).toHaveLength(over)
      expect(reading.nodes.ledgers).toBe(FOREST_PAGE)
      expect(reading.unfolded).toHaveLength(over - FOREST_PAGE)
      expect(snapshot.complete).toBe(true)
      expect(new Set(conversationsOf(snapshot.forest).map((row) => row.conversation)).size).toBe(
        over,
      )
      expect(snapshot.forest.conversations).toBe(snapshot.forest.nodes.ledgers)
    })

    it('⚑ a page names the conversations archived since its reading as gone', async () => {
      for (let n = 0; n < FOREST_PAGE + 5; n += 1) conversation(numbered(n), 'worker')
      const reading = await read(windowOf('all'))
      const later = reading.unfolded
      expect(later).toHaveLength(5)
      archived.add([later[0]!], clock)
      const page = await host.forestNodes(listedBy(reading), later)
      expect(page.gone).toEqual([later[0]])
      expect(page.nodes.ledgers).toBe(4)
    })

    it('⛔ conversations of one moment are drawn by id, highest first, every time', async () => {
      const at = clock - MINUTE
      for (const id of ['sess_aaa', 'sess_bbb', 'sess_ccc']) {
        conversation(id, 'worker')
        db.prepare('UPDATE provider_session SET updated_at = ? WHERE id = ?').run(at, id)
      }
      for (let twice = 0; twice < 2; twice += 1) {
        expect((await read(windowOf('hour'))).members.admitted).toEqual([
          'sess_ccc',
          'sess_bbb',
          'sess_aaa',
        ])
      }
    })

    it('🔴 a replaced conversation is counted as its stand-in, and drawn behind it', async () => {
      const pm = conversation('sess_pm', 'project-manager')
      const old = conversation('sess_old', 'worker', { parent: pm })
      const standIn = conversation('sess_new', 'worker', { parent: pm })
      replace(old, standIn)

      const reading = await read(windowOf('all'))
      expect(reading.counts?.all).toBe(2)
      expect([...reading.members.admitted].sort()).toEqual([pm, standIn].sort())
      expect(reading.behind).toEqual([old])
      const forest = await forestOf(host, windowOf('all'))
      expect(nodeFor(forest, old).inItsPlace).toEqual({
        is: 'a-conversation',
        conversation: standIn,
      })
      expect(nodeFor(forest, standIn).standsInFor).toEqual([
        { is: 'a-conversation', conversation: old },
      ])
    })
  })

  /* ═══════════════════ §6 · the door ═══════════════════ */

  describe('§6 · the wire, the entitlement and the quit', () => {
    it('⚑ a reading and its page answer through the dispatcher, with no sink and no owner', async () => {
      const mine = conversation('sess_mine', 'brobot')
      const sink = new RecordingSink('window:1')
      const before = Date.now()
      const answer = (await executeRuntimeCommand(host, sink, {
        kind: 'forestReading',
        scope: windowOf('all'),
      })) as ForestReading
      expect(answer.members.admitted).toEqual([mine])
      expect(answer.nodes.rows.map((row) => row.node)).toEqual(['a-conversation'])
      // Stamped last, on the app's wall clock and not the injected one.
      expect(answer.readAt).toBeGreaterThanOrEqual(before)
      expect(answer.readAt).toBeLessThanOrEqual(Date.now())
      const page = (await executeRuntimeCommand(host, sink, {
        kind: 'forestNodes',
        drawn: [mine],
        conversations: [mine],
      })) as { nodes: TheWholeForest['nodes']; gone: string[] }
      expect(page.gone).toEqual([])
      expect(page.nodes.rows).toEqual(answer.nodes.rows)
    })
  })

  /* ═══════════════════ §7 · a conversation's own tree ═══════════════════ */

  describe('§7 · a conversation’s own tree is whole, across every date', () => {
    it('🔴 its tree holds every helper of every age, whatever the workspace’s windows hold', async () => {
      const root = ago(conversation('sess_root', 'brobot'), 90 * DAY)
      const helpers = Array.from({ length: 14 }, (_, n) =>
        ago(
          conversation(`sess_helper_${String(n)}`, 'worker', { parent: root }),
          (30 + 3 * n) * DAY,
        ),
      )
      const elsewhere = conversation('sess_elsewhere', 'worker')

      const reading = await read(treeOf(helpers[3]!))
      expect(reading.root).toBe(root)
      expect(reading.counts).toBeNull()
      expect(reading.members.total).toBe(15)
      expect([...reading.members.admitted].sort()).toEqual([root, ...helpers].sort())
      expect(reading.context).toEqual([])
      expect(reading.behind).toEqual([])
      expect((await read(treeOf(root))).members).toEqual(reading.members)
      // The control: the workspace's past week holds none of the tree.
      expect((await read(windowOf('week'))).members.admitted).toEqual([elsewhere])
    })

    it('🔴 a nested conversation reads the whole top-level tree, its other branches too', async () => {
      const top = conversation('sess_top', 'brobot')
      const left = conversation('sess_left', 'project-manager', { parent: top })
      const right = conversation('sess_right', 'project-manager', { parent: top })
      const deep = conversation('sess_deep', 'worker', { parent: left })
      const cousin = conversation('sess_cousin', 'worker', { parent: right })
      const other = conversation('sess_other', 'brobot')

      const reading = await read(treeOf(deep))
      expect(reading.root).toBe(top)
      expect([...reading.members.admitted].sort()).toEqual([cousin, deep, left, right, top].sort())
      expect(reading.members.admitted).not.toContain(other)
    })

    it('🔴 a tree past a page is read whole, its root first so the drawing does not move', async () => {
      const root = ago(conversation('sess_root', 'brobot'), 60 * DAY)
      const size = 2 * FOREST_PAGE + 100
      for (let n = 0; n < size; n += 1) conversation(numbered(n), 'worker', { parent: root })

      const snapshot = await forestSnapshotOf(host, treeOf(numbered(7)))
      const reading = snapshot.reading
      expect(reading.members.total).toBe(size + 1)
      expect(reading.nodes.rows[0]).toMatchObject({ node: 'a-conversation', conversation: root })
      expect(reading.unfolded).toHaveLength(size + 1 - FOREST_PAGE)
      expect(snapshot.complete).toBe(true)
      expect(conversationsOf(snapshot.forest)).toHaveLength(size + 1)
      expect(nodeFor(snapshot.forest, numbered(7)).under).toEqual({
        is: 'a-conversation',
        conversation: root,
      })
    })

    it('🔴 a stand-in at the top reads its predecessor’s helpers as well as its own', async () => {
      const old = conversation('sess_old', 'brobot')
      const oldHelper = conversation('sess_old_helper', 'worker', { parent: old })
      const standIn = conversation('sess_new', 'brobot')
      const newHelper = conversation('sess_new_helper', 'worker', { parent: standIn })
      replace(old, standIn)

      for (const asked of [standIn, old, oldHelper, newHelper]) {
        const reading = await read(treeOf(asked))
        expect(reading.root, asked).toBe(standIn)
        expect([...reading.members.admitted].sort(), asked).toEqual(
          [newHelper, oldHelper, standIn].sort(),
        )
        expect(reading.behind, asked).toEqual([old])
      }
    })

    it('🔴 a replaced conversation inside a tree keeps the helpers it started', async () => {
      const top = conversation('sess_top', 'brobot')
      const old = conversation('sess_old', 'project-manager', { parent: top })
      const oldHelper = conversation('sess_old_helper', 'worker', { parent: old })
      const standIn = conversation('sess_new', 'project-manager', { parent: top })
      const newHelper = conversation('sess_new_helper', 'worker', { parent: standIn })
      replace(old, standIn)

      for (const asked of [standIn, old, oldHelper]) {
        const reading = await read(treeOf(asked))
        expect(reading.root, asked).toBe(top)
        expect([...reading.members.admitted].sort(), asked).toEqual(
          [newHelper, oldHelper, standIn, top].sort(),
        )
        expect(reading.behind, asked).toEqual([old])
      }
    })

    it('🔴 a stand-in recorded under its own predecessor climbs past it to the top', async () => {
      const top = conversation('sess_top', 'brobot')
      const old = conversation('sess_old', 'project-manager', { parent: top })
      const standIn = conversation('sess_new', 'project-manager', { parent: old })
      replace(old, standIn)

      const reading = await read(treeOf(standIn))
      expect(reading.root).toBe(top)
      expect([...reading.members.admitted].sort()).toEqual([standIn, top].sort())
      expect(reading.behind).toEqual([old])
    })

    it('⛔ an archived tree is in no reading, and says so with no root', async () => {
      const root = conversation('sess_root', 'brobot')
      const helper = conversation('sess_helper', 'worker', { parent: root })
      archived.add([root, helper], clock)
      expect(await read(treeOf(helper))).toMatchObject({
        root: null,
        members: { total: 0, admitted: [] },
        unfolded: [],
      })
    })
  })
})
