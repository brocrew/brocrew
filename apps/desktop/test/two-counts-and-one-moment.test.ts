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
import { RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { personsQueueView, type PersonsQueueKind } from '../src/renderer/src/lib/persons-queue'
import { RUNTIME_CHANGE_SUBJECTS } from '../src/shared/runtime-ipc'
import type {
  RuntimeChangeMessage,
  RuntimeCommand,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import {
  WHAT_A_READING_COUNTS,
  WHAT_NEEDS_A_PERSON,
  WHY_NOTHING_WAS_COUNTED,
  aWholeReading,
  countedTogether,
  countsIn,
  scopesOmittedFrom,
  scopesShortIn,
  type OneCount,
  type WhatNeedsAPerson,
  type WorkspaceReading,
} from '../src/shared/workspace-reading'

/**
 * # 567 · two counts and one moment
 *
 * 🔴 **`564`'s second slice, and the one every other v2.10 surface waits on.**
 *
 * ## ⚑ D-017b · one count now, and the moment is unchanged
 *
 * ⛔ **The OPEN count is gone** (`WorkspaceReading`'s own note): *open* was a status every stop
 * writes, so after a restart the rail read *nothing open* above a full list of conversations —
 * the open/closed split, and a process fact, the window no longer draws (`05` rule 5). ⚑ Every test
 * here whose SUBJECT was that count — the rosters that could not compose it, the table that
 * classified a status as open, the store's `GROUP BY status` read and its index — went with it.
 * What is left is the `needsYou` count and everything this file said about ONE honest moment,
 * re-aimed at the one count where it named two.
 *
 * ## ⛔ The premise, asserted rather than quoted (§0)
 *
 * ⚠️ **`564`'s verdict:** *"There is no product `WorkspaceReadView`, no main-side `openCount` or
 * `needsYouCount` aggregate… A renderer cannot honestly derive it from the currently loaded page,
 * roster, or work cards."* ⛔ §0 builds the world and drives the reads that DO exist at it: each
 * one answers correctly about its own scope, and no composition of them answers the workspace.
 * 🔴 **Those tests pass on `main` and pass here** — they are the DEFECT, not the repair.
 *
 * ## ⚑ What each section is for
 *
 *  - **§0** — the premise: the reads a person must answer, and a composition of them that
 *    races.
 *  - **§1** — the property: one count, one stamp, over a world where it disagrees with every
 *    single existing read.
 *  - **§2** — the populations are the queue's, and the count is the queue's count.
 *  - **§3** — one aggregate, one honest completion point (`540` MI-19, brief §3).
 *  - **§4** — a missing count is OMITTED and a short one says so (brief §3.1).
 *  - **§5** — the count is the ledger's, and a window attaching does not move it (brief §4).
 *  - **§6** — the wire, the doors, the entitlement, and what announces this population (brief §5).
 *
 * 🔒 The provider is a double, every directory is temporary, and no live app, port, provider home
 * or `auth.json` is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const HOST_SRC = join(here, '../src/main/runtime/runtime-host.ts')
const IPC_SRC = join(here, '../src/main/runtime/ipc.ts')
const SHAPE_SRC = join(here, '../src/shared/workspace-reading.ts')

const NOW = 1_800_000_000_000

/** MEASURED — `533` §0's claude line, which is what makes a wall a wall. */
const A_PROVIDER_WALL =
  'claude is approaching its rate limit (seven_day); resets 2126-09-23T11:00:00.000Z'

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

describe('567 · two counts and one moment', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let announced: RuntimeChangeMessage[]
  let window: RecordingSink

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-567-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-567-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    announced = []
    window = new RecordingSink('webContents:1')
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
      newSessionId: () => `sess_567_${String(tick())}`,
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

  /* ─────────────────────────────── the world, planted by hand ─────────────────────────────── */

  /** A conversation this app started. */
  const conversation = (id: string, profileId: string): string => {
    store.create({
      id,
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId,
    })
    return id
  }

  const ordinals = new Map<string, number>()
  const append = (id: string, event: TranscriptEvent, at = tick()): void => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    store.append(id, next, event, at)
  }

  /**
   * ⚑ **A question that TRAVELLED and was escalated** — `questionsAPersonMustAnswer`' population: a
   * routing with no `because` plus the stamp that made it a person's.
   */
  const aQuestionAPersonNowOwes = (id: string, requestId: string): string => {
    append(id, { type: 'request_routed', requestId, to: 'the-parent', parent: 'sess_parent' })
    append(id, { type: 'request_escalated', requestId } as TranscriptEvent)
    return requestId
  }

  /**
   * ⚑ **A request that never travelled** — `decisionsAwaitingAPerson`'s population, which is a
   * routing carrying a `because`.
   */
  const aDecisionOnlyAPersonCanMake = (id: string, requestId: string): string => {
    append(id, {
      type: 'request_routed',
      requestId,
      to: 'a-person',
      because: 'a-permission-decision',
      parent: 'sess_parent',
    })
    return requestId
  }

  /** ⛔ **A person answered it** — the settlement that takes a row out of every open population. */
  const answered = (id: string, requestId: string): void => {
    append(id, { type: 'user_decision', requestId, outcome: 'answered' } as TranscriptEvent)
  }

  /**
   * ⚑ **Work that stalled with nobody told** (557) — given, then a turn that ended. ⚑ **D-016 · a
   * piece under the giver's root, through the store's own give** — the `work` row is what the
   * stalled-work walk finds its holders by, and `recordGive` writes it with its `work_given`.
   */
  const workThatStalled = (holder: string, giver: string, piece: string): void => {
    const root = store.rootOf(giver)
    if (root === null) throw new Error(`${giver} has no root`)
    const number = store.numberUnder(root.piece)
    const title = 'Run the migration'
    const brief = 'run the migration'
    const ordinal = ordinals.get(holder) ?? 0
    ordinals.set(holder, ordinal + 1)
    store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner: holder,
        givenBy: giver,
        title,
        brief,
        folder: null,
        inputs: [],
      },
      ordinal,
      {
        type: 'work_given',
        piece,
        label: `${root.label}.${String(number)}`,
        parent: root.piece,
        givenBy: giver,
        title,
        brief,
      },
      tick(),
    )
    append(holder, { type: 'turn', state: 'interrupted' } as TranscriptEvent)
  }

  /** ⚑ **A provider WALL** (533) — the non-fatal error row `providerLimitsSeen` folds. */
  const aWall = (id: string): void => {
    append(id, { type: 'error', message: A_PROVIDER_WALL, fatal: false } as TranscriptEvent)
  }

  /**
   * 🔴 **The world both §0 and §1 are measured over, and every number in it is deliberate.**
   *
   * | conversation | state | why it is here |
   * |---|---|---|
   * | `sess_pm` | idle | where the escalated question lives |
   * | `sess_worker` | idle | the decision, in a DIFFERENT conversation |
   * | `sess_loner` | idle | holds the stalled work |
   * | `sess_done` | ended | a stopped conversation, which moves no count |
   * | `sess_broke` | errored | the same, stopped by a failure |
   *
   * ⚑ **D-017b** — the state column fed the OPEN count (three open, two not); that count is gone,
   * and the two stopped rows stay as the world a person has, not as a population anything counts.
   *
   * ⚑ **Two things a person must answer** — one of each queue population (D-016 took the
   * proposal out) — and **two things that must NOT be counted**: a provider wall and a stalled
   * piece of work.
   */
  const theWorkspace = (): {
    pm: string
    worker: string
    loner: string
    done: string
    broke: string
    escalated: string
    decision: string
  } => {
    const pm = conversation('sess_pm', 'project-manager')
    const worker = conversation('sess_worker', 'worker')
    const loner = conversation('sess_loner', 'auditor')
    const done = conversation('sess_done', 'reviewer')
    const broke = conversation('sess_broke', 'reviewer')
    const escalated = aQuestionAPersonNowOwes(pm, 'req_escalated')
    const decision = aDecisionOnlyAPersonCanMake(worker, 'req_decision')
    // ⛔ **Two things a person READS and cannot ANSWER** — see `WHAT_NEEDS_A_PERSON`.
    aWall(pm)
    workThatStalled(loner, pm, 'work_stalled')
    store.terminate(done, 'ended', 'completed', tick())
    store.terminate(broke, 'errored', 'failed', tick())
    return { pm, worker, loner, done, broke, escalated, decision }
  }

  /* ══════════ §0 · the premise: four reads, none of them the workspace ══════════ */

  describe('§0 · what `564` measured, asserted against the shipped readers', () => {
    it('⛔ the two things a person must answer are TWO reads on two clocks', async () => {
      theWorkspace()
      // ⚑ **Each one answers correctly about its own population** — the premise, and it holds on
      // `main` exactly as it holds here.
      expect(host.questionsForAPerson().rows).toHaveLength(1)
      expect(host.decisionsForAPerson().rows).toHaveLength(1)

      // 🔴 **And composing them is a race, which is what `564` warned about**: *"a renderer sum
      // would race the separate reads."* ⛔ The wire is real — `executeRuntimeCommand`, the function
      // `ipcMain.handle` calls — so the `await` between two scopes is the one a renderer cannot
      // avoid.
      const run = async (command: RuntimeCommand): Promise<{ rows: readonly unknown[] }> =>
        (await executeRuntimeCommand(host, window, command)) as { rows: readonly unknown[] }
      const questions = await run({ kind: 'questionsForAPerson' })
      // ⛔ **The brief's own plant, in the gap between two scopes**: a request is resolved and
      // another arrives. ⚑ Two before, two after — the two writes cancel — so what follows is
      // not merely a stale number.
      answered('sess_pm', 'req_escalated')
      aDecisionOnlyAPersonCanMake('sess_worker', 'req_second')
      const decisions = await run({ kind: 'decisionsForAPerson' })
      const composed = questions.rows.length + decisions.rows.length

      // ⚠️ **THREE, and three was never true.** The escalated row was read before it was answered
      // and the decisions after the second one arrived.
      expect(composed).toBe(3)
      // ⚑ **The control**: at rest the same composition is exact, and the aggregate agrees with it.
      const still = host.questionsForAPerson().rows.length + host.decisionsForAPerson().rows.length
      expect(still).toBe(2)
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 2 })
    })
  })

  /* ══════════════ §1 · the property: two counts, one moment, one call ══════════════ */

  describe('§1 · the read, over a world where it disagrees with every single existing read', () => {
    it('🔴 one call answers the count, and it is the whole workspace', () => {
      theWorkspace()
      const read = host.readWorkspace()

      // ⛔ **Two needing a person: one of each queue population, in two different conversations**
      // — the question in `sess_pm`, the decision in `sess_worker`. ⚑ D-017b · it answered an OPEN
      // count beside this one, and that count went.
      expect(read.needsYou).toEqual({ counted: 'in-full', count: 2 })
      expect(aWholeReading(read)).toBe(true)
    })

    it('⛔ the two things a person READS but cannot ANSWER are outside `needsYou`', () => {
      theWorkspace()
      // ⚑ **Both really are there** — the positive control, without which this test would pass over
      // a fixture that planted neither.
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      expect(host.stalledWorkForAPerson().rows).toHaveLength(1)
      // 🔴 **And the count is still two.** See `WHAT_NEEDS_A_PERSON`: a wall ends on the
      // provider's clock and a stall is cleared by the AGENT path, so a count holding either would
      // go down on its own.
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 2 })
    })

    it('⚠️ an answered request moves the count, and a conversation stopping does not', () => {
      const { pm, escalated } = theWorkspace()
      expect(host.readWorkspace()).toMatchObject({ needsYou: { count: 2 } })

      // ⛔ **The brief's own plant: a conversation ended, and a request resolved.** ⚑ D-017b — the
      // stop moved the OPEN count, which is gone; it moves nothing now, because the decision it
      // holds still waits on a person.
      store.terminate('sess_worker', 'ended', 'completed', tick())
      expect(host.readWorkspace()).toMatchObject({ needsYou: { count: 2 } })
      answered(pm, escalated)
      const after = host.readWorkspace()
      expect(after).toMatchObject({ needsYou: { count: 1 } })

      // ⚑ **And it moved in one call, under one time** — the property a composed read cannot have.
      expect(after.readAt).toBeGreaterThanOrEqual(Date.now() - 60_000)
    })

    it('🔴 an empty workspace counts ZERO, and zero is not the same answer as *not counted*', () => {
      const read = host.readWorkspace()
      expect(read.needsYou).toEqual({ counted: 'in-full', count: 0 })
      // ⛔ **The distinction `453` built `LedgerWalk` for, one shape over**: this app has a database
      // and there is nothing in it, which is a different sentence from *there was nothing to ask*.
      expect(scopesOmittedFrom(read)).toEqual([])
      expect(aWholeReading(read)).toBe(true)
    })
  })

  /* ══════ §2 · the populations are the queue's, and the count is the queue's count ══════ */

  describe('§2 · one derivation, so Home and the queue cannot disagree', () => {
    it('🔴 `WHAT_NEEDS_A_PERSON` is `PersonsQueueKind`, the instruction asks and the work waiting on a reply, spelled twice and pinned BY TYPE', () => {
      // ⛔ **A compile-time cross-check in both directions** — main may not import a renderer type,
      // so this is the rail that stops the two spellings drifting
      // (`a-value-import-from-shared-costs-the-renderer-135kb`'s own prescription).
      //
      // ⚑ **D-017 · R19 — one member is not a queue kind: `an-instruction-ask`**, ⚑ **and since
      // F097 a second: `a-reply`.** *Waiting on you* draws both BESIDE the queue's rows and the
      // badge counts them, so the count has two populations more than the queue. ⛔ The pin is
      // therefore the queue's kinds against the counted ones WITHOUT those members — still by type,
      // and still in both directions.
      const everyQueueKind = {
        'a-question': true,
        'a-decision': true,
      } as const satisfies Readonly<Record<PersonsQueueKind, true>>
      const everyCountedQueueKind = {
        'a-question': true,
        'a-decision': true,
      } as const satisfies Readonly<
        Record<
          Exclude<WhatNeedsAPerson, 'an-instruction-ask' | 'a-reply' | 'a-server-request'>,
          true
        >
      >
      const everyCountedKind = {
        ...everyCountedQueueKind,
        'an-instruction-ask': true,
        'a-reply': true,
        'a-server-request': true,
      } as const satisfies Readonly<Record<WhatNeedsAPerson, true>>
      const besideTheQueue: readonly string[] = [
        'an-instruction-ask',
        'a-reply',
        'a-server-request',
      ]
      expect(Object.keys(everyQueueKind).sort()).toEqual(
        WHAT_NEEDS_A_PERSON.filter((one) => !besideTheQueue.includes(one)).sort(),
      )
      expect(Object.keys(everyCountedQueueKind).sort()).toEqual(Object.keys(everyQueueKind).sort())
      expect(Object.keys(everyCountedKind).sort()).toEqual([...WHAT_NEEDS_A_PERSON].sort())
      // Non-vacuity: the vocabulary has five members, so a `satisfies` over a record that had lost
      // one would not read as covered; and the three populations drawn beside the queue (the
      // instruction asks, the replies owed and the requests to register an MCP server) are among them.
      expect(WHAT_NEEDS_A_PERSON).toHaveLength(5)
      expect([...WHAT_NEEDS_A_PERSON]).toEqual(expect.arrayContaining([...besideTheQueue]))
    })

    it('⛔ `needsYou` equals the number the QUEUE draws, over the same world', () => {
      theWorkspace()
      const queue = personsQueueView(host.questionsForAPerson(), host.decisionsForAPerson(), {
        now: NOW,
        held: new Set(),
        answerable: new Map(),
        answeredFromHere: new Set(),
        lastLookAnswered: { questions: true, decisions: true },
      })
      // 🔴 **`460` F1's shape refused**: one answer derived twice is two answers waiting to
      // disagree. ⚑ The queue's own rule is that it *"never rounds the count"* —
      // `PersonsQueueView.count` is `rows.length` — and this is that number from the other side of
      // the wire.
      expect(queue?.count).toBe(2)
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 2 })
    })

    it('⚑ the host reads the STORE walks, not its own mappers, and the counts are identical', () => {
      theWorkspace()
      // ⛔ **The mappers map one row to one row**, which is what makes the cheap read exact rather
      // than approximate. ⚠️ Asserted rather than assumed, because a filter added to either end
      // would make Home and the queue disagree silently.
      expect(store.questionsAPersonMustAnswer().rows).toHaveLength(
        host.questionsForAPerson().rows.length,
      )
      expect(store.decisionsAwaitingAPerson().rows).toHaveLength(
        host.decisionsForAPerson().rows.length,
      )
      // ⛔ **And the host really does read the cheap side** — a source census, because the saving is
      // invisible to a runtime assertion that only sees the number.
      const body = bodyOfReadWorkspace()
      expect(body).toContain('this.deps.store.questionsAPersonMustAnswer()')
      expect(body).toContain('this.deps.store.decisionsAwaitingAPerson()')
      expect(body).not.toContain('this.questionsForAPerson(')
      expect(body).not.toContain('this.decisionsForAPerson(')
    })

    it('🔴 a CLOSED thing is in neither count, and each population is closed by its own writer', () => {
      const { pm, worker, escalated, decision } = theWorkspace()
      answered(pm, escalated)
      answered(worker, decision)
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })
    })
  })

  /* ══════════ §3 · one aggregate read, one honest completion point ══════════ */

  describe('§3 · `540` MI-19, decided a second time (brief §3)', () => {
    it('🔴 the host answers SYNCHRONOUSLY, which is what makes one stamp honest', () => {
      theWorkspace()
      const answer: WorkspaceReading | Promise<WorkspaceReading> = host.readWorkspace()
      // ⛔ **The condition `540` named:** *"One timestamp is honest only if the host performs one
      // atomic/defined aggregate read and records the common completion point."* ⚑ *Not a thenable*
      // is the form of that claim a test can hold.
      expect(typeof (answer as { then?: unknown }).then).toBe('undefined')
      expect((answer as WorkspaceReading).needsYou.counted).toBe('in-full')
    })

    it('⛔ `readAt` is taken LAST, inside the call, and is a completion point', () => {
      theWorkspace()
      const before = Date.now()
      const read = host.readWorkspace()
      const after = Date.now()
      expect(read.readAt).toBeGreaterThanOrEqual(before)
      expect(read.readAt).toBeLessThanOrEqual(after)
      // ⚑ **The app's WALL clock and not the store's injected tick**, because it is a claim about
      // when this answer was finished rather than about the ledger's own ordering.
      expect(read.readAt).not.toBe(NOW)
    })

    it('⚠️ there is no `await` between the first statement of the read and the stamp', () => {
      const body = bodyOfReadWorkspace()
      expect(body).toContain('readAt: Date.now(),')
      // ⛔ **A source census, because the property is about the SHAPE of the method** and a runtime
      // assertion can only see that this call happened not to be interrupted.
      expect(body).not.toContain('await ')
      expect(body).not.toContain('async ')
      // ⚑ **The control** (standing rule 12's shape): the same slice of a method that DOES await is
      // found by the same expression, so this is not a search that could never fire.
      const host_ = code(readFileSync(HOST_SRC, 'utf8'))
      expect(host_.slice(host_.indexOf('async closeAll('))).toContain('await ')
      // ⛔ **And the door does not await it either** — an `await` on the `case` would not create the
      // gap, but it would be the one line a later reader could take as permission.
      const ipc = code(readFileSync(IPC_SRC, 'utf8'))
      expect(ipc).toContain('return host.readWorkspace()')
      expect(ipc).not.toContain('return await host.readWorkspace(')
    })

    it('⛔ there is exactly ONE stamp on the answer, and no per-scope time', () => {
      theWorkspace()
      const read = host.readWorkspace()
      const stamped = Object.entries(read).filter(([key]) => /At$|^at$|time/i.test(key))
      expect(stamped.map(([key]) => key)).toEqual(['readAt'])
      // ⚑ **The alternative `540` offered was per-scope times**, and it is refused rather than
      // forgotten: a scope carries a word and a number and no clock of its own.
      for (const scope of WHAT_A_READING_COUNTS) {
        expect(Object.keys(countsIn(read)[scope]).sort()).toEqual(['count', 'counted'])
      }
      // ⛔ **And over EVERY arm, not only the one this fixture happens to produce** — the assertion
      // above is satisfied by a whole reading and would say nothing about a short or an omitted
      // scope (`a-positive-assertion-must-differ-from-the-default`).
      const everyArm: OneCount[] = [
        { counted: 'in-full', count: 1 },
        { counted: 'short', count: 1, unread: 1 },
        { counted: 'not-at-all', because: 'no-ledger' },
      ]
      for (const arm of everyArm) {
        expect(Object.keys(arm).filter((key) => /At$|^at$|time/i.test(key))).toEqual([])
      }
    })

    it('🔴 the stamp cannot be advanced by anything but the read returning', () => {
      theWorkspace()
      const first = host.readWorkspace()
      // ⛔ **v2.10's third honesty rule, and the trap it names**: *"Delivering a refresh intent,
      // resolving its callback or repainting the page never produces a newer reading."* ⚑ The rail
      // is the NAME: there is no `refreshWorkspace` on this wire, so there is nothing to stamp but
      // a measurement.
      const wire = code(readFileSync(IPC_SRC, 'utf8'))
      expect(wire).not.toContain('refreshWorkspace')
      expect(code(readFileSync(SHAPE_SRC, 'utf8'))).not.toContain('refreshWorkspace')
      // ⚑ **And a second read really does mint a second moment** — the positive control, so the
      // negative above is not satisfied by a stamp nothing ever moves.
      const second = host.readWorkspace()
      expect(second.readAt).toBeGreaterThanOrEqual(first.readAt)
    })
  })

  /* ══════════ §4 · omitted, short, or whole — and never zeroed ══════════ */

  describe('§4 · a missing count is OMITTED and a short one says so (brief §3.1)', () => {
    it('⛔ a store with no database omits the count and zeroes nothing', () => {
      const blind = new RuntimeHost({
        store: NULL_SESSION_STORE,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new FakeRuntime(provider),
        prepareProviderHome: () => join(userData, 'nowhere'),
        providerHomePath: () => join(userData, 'nowhere'),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => 'sess_blind',
        now: tick,
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
      const read = blind.readWorkspace()
      // 🔴 **No `count` key at all on the scope** — honesty rule 1 made structural: a reader cannot
      // add an omitted scope to anything, because there is nothing there to add. ⚑ D-017b — one
      // scope now (`open` went).
      expect(read.needsYou).toEqual({ counted: 'not-at-all', because: 'no-ledger' })
      expect(Object.keys(read.needsYou)).not.toContain('count')
      expect(scopesOmittedFrom(read)).toEqual(['needs-you'])
      expect(aWholeReading(read)).toBe(false)
      // ⚑ **And it still carries a moment**, because the read DID happen — what it could not do is
      // count. ⛔ A surface draws the time and omits the numbers; it may not back-fill older ones
      // under this stamp.
      expect(read.readAt).toBeGreaterThan(0)
    })

    it('⚠️ a walk that dropped a row makes `needsYou` a LOWER BOUND that says so', () => {
      const { worker } = theWorkspace()
      // ⛔ **The hazard on the path the code walks**: a ledger row this build cannot read. `453`'s
      // `rowsUnread` is what counts it, and the count above it is short by exactly that much.
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'request_routed', '{not json', ?)`,
      ).run('evt_unreadable', worker, 900, tick())
      expect(store.decisionsAwaitingAPerson().rowsUnread).toBe(1)
      // 🔴 **TWO for ONE row, and that is measured rather than a slip.** `questionsAPersonMustAnswer` and
      // `decisionsAwaitingAPerson` open the same candidate set — *"a poll that asks for both walks
      // every ledger that has ever routed a request twice"* — so one malformed row is skipped
      // twice. ⛔ `unread` is therefore an UPPER BOUND on what is missing, which is the safe
      // direction for an asterisk; see {@link CountShort}, where the number is argued.
      expect(store.questionsAPersonMustAnswer().rowsUnread).toBe(1)
      const read = host.readWorkspace()
      expect(read.needsYou).toEqual({ counted: 'short', count: 2, unread: 2 })
      expect(scopesShortIn(read)).toEqual(['needs-you'])
      expect(aWholeReading(read)).toBe(false)
    })

    it('⛔ `countedTogether` is ANY for short and EVERY for absent, which is the queue’s rule', () => {
      const empty = { rows: [], ledgers: 0, rowsUnread: 0 } as const
      // ⚑ **`no-ledger` on ALL of them is the only absence** — one quiet scope beside two that
      // answered must not delete a number the others measured (`personsQueueView`'s own note).
      expect(
        countedTogether([
          { ...empty, walk: 'no-ledger' },
          { ...empty, walk: 'no-ledger' },
        ]),
      ).toEqual({ counted: 'not-at-all', because: 'no-ledger' })
      expect(
        countedTogether([
          { ...empty, walk: 'no-ledger' },
          { ...empty, walk: 'every-conversation-that-routed' },
        ]),
      ).toEqual({ counted: 'in-full', count: 0 })
      // ⚠️ **ANY, not all**, for `rowsUnread`: one walk that dropped a row makes the merged count
      // short.
      expect(
        countedTogether([
          { rows: [1], ledgers: 1, rowsUnread: 0, walk: 'every-conversation-that-routed' },
          { rows: [], ledgers: 1, rowsUnread: 2, walk: 'every-conversation-that-routed' },
        ]),
      ).toEqual({ counted: 'short', count: 1, unread: 2 })
    })

    it('⛔ `WHY_NOTHING_WAS_COUNTED` has one member, and it is the one the store can produce', () => {
      expect([...WHY_NOTHING_WAS_COUNTED]).toEqual(['no-ledger'])
    })
  })

  /* ══════════ §5 · the count is the ledger's (brief §4) ══════════ */

  describe('§5 · the count is the ledger’s, never a live fact (brief §4)', () => {
    // ⚑ **D-017b** — this section said *"`open` is a different claim from `live`, `working` and
    // *doing*"*, and its six tests were about the OPEN count: its table, the row it counted, the
    // errored and adopted rows it did not. That count is gone; the one claim of this section that
    // was about the READ rather than about *open* is kept.
    it('⛔ the count does not move because a window attached, and the census says why', () => {
      const body = bodyOfReadWorkspace()
      // 🔴 **No slot map**: *needs you* is derivable from a ledger alone, which is the property that
      // keeps a `.brobot` bundle able to answer it.
      expect(body).not.toContain('runningStateOf')
      expect(body).not.toContain('livenessStateOf')
      expect(body).not.toContain('this.slots')
      // ⚑ **The control**: the method that DOES publish the word is found by the same expression.
      const host_ = code(readFileSync(HOST_SRC, 'utf8'))
      expect(host_).toContain('running: this.runningStateOf(conversation),')
    })
  })

  /* ══════════ §6 · the wire, the doors and what announces this population ══════════ */

  describe('§6 · the rails before anything can reach it (brief §5, §6.6)', () => {
    it('⛔ the command carries NO fields, so there is nothing on the wire to bound', () => {
      const wire = code(readFileSync(IPC_SRC, 'utf8'))
      expect(wire).toContain("z.object({ kind: z.literal('readWorkspace') })")
    })

    it('⛔ it is REFUSED during a quit, with its five neighbours', async () => {
      // ⛔ **Through the real door, over a host that IS closing** — `executeRuntimeCommand` asks
      // `host.closing` and `DURING_A_QUIT[kind]`, and both halves are exercised here.
      const quitting = new Proxy(host, {
        get: (target, property, receiver) =>
          property === 'closing' ? true : Reflect.get(target, property, receiver),
      }) as RuntimeHost
      await expect(
        executeRuntimeCommand(quitting, window, { kind: 'readWorkspace' }),
      ).rejects.toThrow(/shutting down/)
      // ⚑ **The control**: the same door over a host that is NOT closing answers.
      const answered_ = await executeRuntimeCommand(host, window, { kind: 'readWorkspace' })
      expect((answered_ as WorkspaceReading).needsYou.counted).toBe('in-full')
    })

    it('🔴 no toolset reaches it, and its name does not end `ForAPerson`', () => {
      // ⛔ **A count of everything a person owns, across every conversation, is not a fact this
      // app hands to a conversation.** The rail is that the verb exists only on the window wire.
      //
      // ⚠️ **The search shape, named** (standing rule 4): every file under `src/` that declares or
      // names an agent tool, found by the ONE file agent tools are built in plus the two that spell
      // the vocabulary — and the positive control is that the same sweep finds a verb that IS on a
      // toolset.
      const agentSide = ['main/runtime/agent-tools.ts', 'shared/capabilities.ts'].map((name) =>
        readFileSync(join(here, '../src', name), 'utf8'),
      )
      for (const source of agentSide) expect(source).not.toContain('readWorkspace')
      // ⚑ **The control**: `list_agents` is a real tool and the same two files know it, so this is
      // not a search that could never fire.
      expect(agentSide.some((source) => source.includes('list_agents'))).toBe(true)
      // ⚠️ **And the suffix rail is avoided on purpose** — a name ending `ForAPerson` is
      // CONSCRIPTED into `RuntimeScreen.lookForWhatIsYours`'s poll, and `564` ordered a read with
      // no reader.
      expect('readWorkspace').not.toMatch(/ForAPerson$/)
    })

    /**
     * ⚠️ **571 · RE-AIMED, not stripped** (standing rule 26).
     *
     * ⛔ **This read `expect(screen).not.toContain('readWorkspace')`**, which was `567` §6.6's
     * scope boundary — *"No renderer surface, as §6.6 ordered"* — and `567` filed the consequence
     * itself, as **F9**: *"`AgentIdentities.use` and this reading are both ahead of their readers…
     * each one is a place where a shape can be wrong for a whole slice without anything going
     * red."*
     *
     * 🔴 **`571` is that reader, so the assertion had to move or become a lie.** ⚑ What it pins
     * NOW is the half that was always the point: the verb is on the WINDOW wire and on no toolset,
     * and the window actually asks it. ⛔ Stripping it instead would have left this file green
     * over both worlds — a read with a reader and a read without one — which is the one repair
     * `520`'s census was told never to make.
     */
    it('🔴 571 · the window now ASKS it, and it is still the window that asks', () => {
      const screen = readFileSync(
        join(here, '../src/renderer/src/components/RuntimeScreen.vue'),
        'utf8',
      )
      // ⛔ **A reader exists**, which is what `EXT-008` §4.3 ordered and what `567` F9 predicted
      // would be owed.
      expect(screen).toContain('store.readWorkspace()')
      // ⚑ **And it rides the cadence that was already here.** A poll of its own is the thing
      // `571` §3 forbids — *"a poll would be a second authority on liveness"* — so the call sits
      // in the queue's own interval rather than one this read was given.
      // ⛔ **Sliced, not merely searched for**: `LOOK_EVERY_MS` is in this file whatever happens,
      // so a bare `toContain` would be green over every world
      // (`a-positive-assertion-must-differ-from-the-default`, found reviewing this diff).
      const armed = screen.slice(screen.indexOf('looking = setInterval('))
      expect(armed.slice(0, armed.indexOf('LOOK_EVERY_MS)'))).toContain('readTheWorkspace()')
      // ⚠️ **The suffix is still not there**, so the rail that would have conscripted it into
      // `lookForWhatIsYours`'s `Promise.all` is still doing nothing — the call is deliberate.
      expect(screen).not.toContain('readWorkspaceForAPerson')
    })

    it('⚑ it announces NOTHING, and `RUNTIME_CHANGE_SUBJECTS` is unchanged', () => {
      theWorkspace()
      announced.length = 0
      host.readWorkspace()
      // ⛔ **A read announces nothing** — the trivial half.
      expect(announced).toEqual([])
      // 🔴 **And no subject was added.** `534` built the vocabulary as a VALUE so every subject has
      // a reader BY TYPE; `564` ordered no renderer, so a subject for this would be one nothing
      // reads — which is exactly what the brief forbids and what `543` measured it needed none of.
      // ⚑ **638 · a THIRD member**, `work` — the condition `534` set (*do not add a subject
      // nothing reads*) lapsed when `631` built the task lists that read it.
      expect([...RUNTIME_CHANGE_SUBJECTS]).toEqual(['conversations', 'agents', 'work'])
    })
  })

  /** ⛔ **The body of the read, prose stripped**, so a docblock quoting a call is not a call. */
  function bodyOfReadWorkspace(): string {
    const host_ = code(readFileSync(HOST_SRC, 'utf8'))
    const at = host_.indexOf('readWorkspace(): WorkspaceReading {')
    expect(at).toBeGreaterThan(-1)
    return host_.slice(at, host_.indexOf('\n  }', at))
  }
})
