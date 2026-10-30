import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { LEDGER_WALK_KINDS, WALK_COVERS } from '../src/shared/questions'
import { UNDRIVEN_SENTENCES, stalledWithACause } from '../src/shared/tasks'
import type { PieceRow } from '../src/shared/tasks'
import { stalledWorkKey, stalledWorkSaid } from '../src/shared/stalled-work'
import type { StalledWork } from '../src/shared/stalled-work'
import { KIND_WORDS, stalledWorkLead, stalledWorkView } from '../src/renderer/src/lib/persons-queue'
import { OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import type { RuntimeEventMessage, TranscriptEvent, WorkStallTold } from '../src/shared/runtime-ipc'

/**
 * 🔴 **557 · work that stalls with nobody left to tell** — HO-018 §2.1's criterion 4, whose
 * property had lost its subject.
 *
 * ## ⛔ The hole, as `555` §3.1 measured it rather than as this file restates it
 *
 * ⚠️ **HO-062 §2's degradation table promises that a dropped instruction fails loudly**: *the task
 * stalls and the parent is told*. ⛔ `555` was asked to verify each row and could not defeat the
 * STALL half — it is a pure fold over a `turn` row the app already writes, permanent and named.
 * 🔴 **The TELLING half is conditional:**
 *
 * > `tellIfNobodyHasYet` returns unless the giver is LIVE in this host right now, **HO-018 §2.2
 * > removed the timeout so there is no sweep and no deadline**, and `persons-queue.ts` had no
 * > stalled-work lane — **so a giver never relaunched was told by nothing, ever.**
 *
 * Check the unattended case: a giver assigns work, the person closes the app, and returns the
 * next morning. Stalled work must still be reported.
 *
 * ## 🔴 The property this file is the assertion for, both clauses
 *
 * > ⚑ **Work that has stalled reaches somebody who can act on it** — ⛔ **and *somebody* is the
 * > person when no agent can be told.**
 *
 * ## ⚠️ Standing rule 12 — it plants TWO, and the control is the half that already worked
 *
 * ⛔ **A stall whose giver is LIVE** — the control, and it is the one `400` and `404` built: the
 * push lands, a receipt is written, and a person is told NOTHING about it. ⛔ **A stall whose giver
 * was never relaunched** — the defect, and before this dispatch every surface in this app was
 * silent about it.
 *
 * ⚑ **Both are planted in ONE database and read by ONE call**, which is what makes the silence
 * about the first a decision rather than a channel that was shut.
 *
 * ## ⛔ What §3 pins, and it is the assertion that fails on `main` for a BEHAVIOURAL reason
 *
 * ⚠️ **A new reader is trivially absent from an older tree, and *the symbol does not exist* is weak
 * evidence.** ⛔ So §3 states the property over a roster it DERIVES from the wire — every
 * `RuntimeCommandKind` ending `ForAPerson` — and asks whether ANY of them names the stalled work.
 * ⚑ On `main` that roster has four members and none of them does; the assertion is red because the
 * property is false there, and it cannot be satisfied by adding a name.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is
 * the provider — `404`'s harness, which this file borrows rather than re-invents.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const hostSource = readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8')
const storeSource = readFileSync(join(here, '../src/main/db/session-store.ts'), 'utf8')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
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

/** `394`'s double, with the handles kept — a test has to BE the provider to ask like one. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

describe('557 · work that stalls with nobody left to tell', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-557-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-557-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    claimed = new Set()
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const personOpens = async (
    profileId: string,
    on: RuntimeHost = host,
    provider: Provider = 'claude',
  ): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider, profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /**
   * ⚑ **The second paragraph of every brief given here** — so the brief and the piece's one-line
   * TITLE differ, and a surface that drew the brief where it should draw the title is caught.
   */
  const A_SECOND_PARAGRAPH = 'and a second paragraph nobody should read on the band'

  /**
   * `393`'s helper: a giver in a window with one child of its own, given work through the real
   * door. ⚑ **D-016 · the give IS the work** — `give_work` starts the child, titled `title`, and the
   * brief is the child's first turn, which the FakeRuntime parks on a card.
   */
  const aGiverAndItsWorker = async (
    title: string,
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerProfile: string
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title,
      brief: `${title}\n\n${A_SECOND_PARAGRAPH}`,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, worker: given.agent as string, pmTools, workerProfile }
  }

  const cardsOn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'permission_request').length

  const cardOn = async (sessionId: string, after = 0): Promise<string> => {
    await waitFor(() => cardsOn(sessionId) > after, 'the card the turn parks on')
    const asked = events(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  /** Cancelled provider cards keep the immediate legacy notice; quiet turns use the ladder. */
  const interruptTheTurn = async (sessionId: string): Promise<void> => {
    const before = events(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'cancel' }, window)
    await waitFor(
      () => events(sessionId).filter((event) => event.type === 'turn').length > before,
      'the provider interruption to reach the record',
    )
    expect(pieceOf(sessionId)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_interrupted',
    })
  }

  const pieceOf = (sessionId: string): PieceRow => {
    const row = store.piecesOwnedBy(sessionId)[0]
    if (row === undefined) throw new Error(`no piece in ${sessionId}`)
    return row
  }

  /** The durable receipts in a conversation's own ledger — {@link WorkStallTold}. */
  const receiptsTo = (parent: string): string[] =>
    events(parent)
      .filter((event): event is WorkStallTold => event.type === 'work_stall_told')
      .map((event) => event.piece)

  const namedToAPerson = (on: RuntimeHost = host): readonly StalledWork[] =>
    on.stalledWorkForAPerson().rows

  const idsNamedToAPerson = (on: RuntimeHost = host): string[] =>
    namedToAPerson(on).map((work) => work.piece)

  /**
   * 🔴 **The two cases the brief asked for, in ONE database and read by ONE call** (§4.3).
   *
   * ⛔ **`told` — a stall whose giver is LIVE.** The push `400` and `404` built lands, the receipt
   * is written, and this is the control that proves nothing that worked was broken.
   *
   * For `nobody`, the giver closes before its worker’s turn ends, leaving no live slot or
   * sweep. An in-run stall normally restarts a stopped giver and notifies it; this fixture
   * makes that giver unstartable because the provider no longer has it. §2 checks the
   * overnight launch, which starts nobody.
   */
  const aStallEachWay = async (): Promise<{
    told: { pm: string; worker: string; task: string }
    nobody: { pm: string; worker: string; task: string }
  }> => {
    const live = await aGiverAndItsWorker('the work whose giver is watching')
    await cardOn(live.worker)
    const gone = await aGiverAndItsWorker('the work whose giver went away')
    await cardOn(gone.worker)
    const toldTask = pieceOf(live.worker).piece
    const nobodyTask = pieceOf(gone.worker).piece
    // ⛔ **The giver goes away BEFORE its worker's turn ends**, which is the whole difference
    // between the two arms: the stall is folded identically and only the recipient differs.
    await host.close(gone.pm, window)
    // ⚑ **D-017 · R1 — and it cannot come back.** A giver that has merely STOPPED is started by
    // its worker's stall and told, so *nobody left to tell* is now a giver whose start fails: here
    // its provider no longer has it. ⚠️ `forgetAll` forgets every record, and nothing below starts
    // any conversation but this giver — every other one is still running.
    issued.forgetAll()
    await interruptTheTurn(gone.worker)
    await interruptTheTurn(live.worker)
    await waitFor(() => receiptsTo(live.pm).includes(toldTask), 'the live giver to be told')
    return {
      told: { pm: live.pm, worker: live.worker, task: toldTask },
      nobody: { pm: gone.pm, worker: gone.worker, task: nobodyTask },
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the property, with the control beside it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a stall with nobody to tell reaches a person, and one with a live giver does not', () => {
    it('ordinary ending pairs with the interrupted band: a failed reminder tells the giver once', async () => {
      const { pm, worker } = await aGiverAndItsWorker('Fictional ordinary ending')
      const id = await cardOn(worker)
      const task = pieceOf(worker).piece
      const admission = host as unknown as { reconciliationMayWake(target: string): boolean }
      const original = admission.reconciliationMayWake.bind(host)
      vi.spyOn(admission, 'reconciliationMayWake').mockImplementation(
        (target) => target !== worker && original(target),
      )
      host.claimSession(worker, window)
      await host.respondPermission(worker, id, { outcome: 'allow' }, window)
      await waitFor(
        () =>
          store
            .reconciliationReceipts(worker, task)
            .some((row) => row.step === 'giver' && row.outcome === 'delivered'),
        'the ladder giver notice',
      )
      expect(pieceOf(worker)).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
      expect(idsNamedToAPerson()).not.toContain(task)
      expect(host.workIncidentsForAPerson().rows.map((row) => row.piece)).not.toContain(task)
      expect(receiptsTo(pm)).toEqual([])
      const steps = store.reconciliationReceipts(worker, task)
      expect(steps.filter((row) => row.step === 'holder' && row.outcome === 'failed')).toHaveLength(
        1,
      )
      expect(
        steps.filter((row) => row.step === 'giver' && row.outcome === 'delivered'),
      ).toHaveLength(1)
      expect(
        events(pm).filter(
          (row) => row.type === 'message_queued' && row.appNotice === 'a-work-wait-needs-attention',
        ),
      ).toHaveLength(1)
    })

    it('🔴 the headline: both stalls are folded the same way, and only one of them is a person’s', async () => {
      const { told, nobody } = await aStallEachWay()

      // ⚑ **The premise, asserted before any verdict**: the two tasks are in the SAME state for the
      // SAME reason, so nothing below can be explained by one of them not having stalled.
      for (const [holder, task] of [
        [told.worker, told.task],
        [nobody.worker, nobody.task],
      ] as const) {
        const row = store.piecesOwnedBy(holder).find((one) => one.piece === task)
        expect(row, `${task} is missing from ${holder}`).toBeDefined()
        expect(row).toMatchObject({ state: 'stalled', stalledBecause: 'turn_interrupted' })
        expect(stalledWithACause(row as PieceRow)).toBe(true)
      }

      // 🔴 **The defect, closed.** Before this dispatch nothing in this app named the second one.
      expect(idsNamedToAPerson()).toEqual([nobody.task])

      // ⛔ **And the control is a DECISION rather than a channel that was shut**: the first one is
      // absent from a person's list because an agent was told about it, and the receipt says so.
      expect(receiptsTo(told.pm)).toEqual([told.task])
      expect(receiptsTo(nobody.pm)).toEqual([])
    })

    it('⛔ the row says whose work it is, where it is, and what the engine observed', async () => {
      const { nobody } = await aStallEachWay()
      const work = namedToAPerson()[0] as StalledWork

      // ⛔ **The conversation HOLDING the work is where a person goes**, and the one that gave it
      // out is what the sentence is about — two different ids, and a row that confused them would
      // send a person to the conversation that is not stuck.
      // ⚑ **D-016** — `owner` and `giver` (they were `assignedTo` and `assignedBy`), and the piece's
      // one-line title where the task carried its text.
      expect(work.owner).toBe(nobody.worker)
      expect(work.giver).toBe(nobody.pm)
      expect(work.title).toBe('the work whose giver went away')
      expect(work.because).toBe('turn_interrupted')
      expect(work.stalledAt).toBeGreaterThan(0)
      // The cancellation records the person who asked the turn to stop.
      expect(work.askedToStop).toEqual({ by: 'a-person', asker: null, askerName: null })
      // ⚑ **Named main-side**, because a renderer cannot turn a `sess_<uuid>` into a word — and
      // the name is really a NAME rather than the id handed back, which is what a fallback that
      // had swallowed the naming would look like.
      expect(work.ownerName).not.toBe(work.owner)
      expect(work.giverName).not.toBe(work.giver)

      // ⛔ **One table for the observation and not a second vocabulary** — the words a person reads
      // here are the words the parent's own notice is built from.
      expect(stalledWorkSaid(work).toLowerCase()).toContain(
        UNDRIVEN_SENTENCES.turn_interrupted.replace(/\.$/, ''),
      )
      // ⛔ **The clauses BY NAME** (standing rule 5), and not only the two names: this fixture's
      // giver and holder share a working directory, so until `732` they shared a word (the folder) —
      // asserting *both names appear* was `a-comparison-tested-where-both-sides-agree`, and it is what
      // let a mutation that deleted the giver clause survive. ⚑ Since `732` they are named by
      // identity (`729` F-1, R41), and the two words differ.
      expect(work.ownerName).not.toBe(work.giverName)
      // ⚑ 697 · `672` H2: the line a person reads is the renderer's `stalledWorkLead` — the shared
      // `stalledWorkSays` had no product caller and is gone, so these pins moved to the live one.
      expect(stalledWorkLead(work)).toContain('is not being worked on')
      expect(stalledWorkLead(work)).toContain('which gave it out')
      expect(stalledWorkLead(work)).toContain('has not been told')
      expect(stalledWorkKey(work)).toBe(nobody.task)
    })

    it('🔴 729 · `725` draw 9 — a PERSON asked the turn to stop: the row says so, and names no conversation', async () => {
      // ⚑ The band's own rig, one gesture over: the giver goes away, and then a person presses Stop
      // on the worker mid-turn. ⛔ RED on `main`: the row carried no ask at all. ⚑ `asker` and its
      // name are `null` — a person's ask names no conversation (the agent's arm, with its identity
      // name, is `state-a-supervisor-can-trust`'s `729` test).
      const { pm, worker } = await aGiverAndItsWorker('the work a person stops')
      await cardOn(worker)
      const task = pieceOf(worker).piece
      await host.close(pm, window)
      // ⚑ **D-017 · R1 — a giver that cannot be started**, as `aStallEachWay`'s: one that has only
      // stopped is started by the stall and told, and the row would leave the band.
      issued.forgetAll()
      host.claimSession(worker, window)
      await host.interrupt(worker, window)
      await waitFor(() => pieceOf(worker).state === 'stalled', 'the stopped work to stall')
      const work = namedToAPerson().find((one) => one.piece === task)
      expect(work?.askedToStop).toEqual({ by: 'a-person', asker: null, askerName: null })
    })

    it('⛔ the sentence names BOTH conversations, measured where the two words differ', () => {
      // ⚑ **A pure value rather than a planted world**, because what this asserts is a fact about
      // the SENTENCE: the holder and the giver are two different things and the line says both.
      const made: StalledWork = {
        piece: 'work_x',
        label: 'W1.3',
        title: 'do the thing',
        owner: 'sess_holder',
        ownerName: 'the-worker',
        giver: 'sess_giver',
        giverName: 'the-boss',
        because: 'turn_ended',
        askedToStop: null,
        stalledAt: 1_000,
      }
      const said = stalledWorkLead(made)
      expect(said).toContain('the-worker')
      expect(said).toContain('the-boss')
      // ⚑ The card's spelling — `672`'s one name, not the retired *"Work #3"*, and (D-016) the
      // piece's label where *"Task #3"* was, with no *"in <project>"* after it.
      expect(said).toContain('W1.3 ')
      expect(said).not.toContain('W1.3 in ')
      // ⛔ **And the two words really are different**, or the assertions above are one assertion
      // twice — `a-positive-assertion-must-differ-from-the-default`.
      expect(made.ownerName).not.toBe(made.giverName)
    })

    it('🔴 the RECEIPT is the discriminator, and it is the same row the push de-duplicates on', async () => {
      // ⛔ **The brief's §3.4 answered as an assertion rather than as a sentence.** The two arms are
      // complements of one durable fact: `work_stall_told` (D-016's `work_reported`) in the GIVER's
      // own ledger. ⚠️ Asserted as
      // a pair over ONE database, so *told* and *not told* are read the same way.
      const { told, nobody } = await aStallEachWay()
      const walked = store.stalledWorkNobodyWasToldAbout()
      expect(walked.rows.map((row) => row.piece)).toEqual([nobody.task])
      expect(store.workReportedTo(told.pm).has(told.task)).toBe(true)
      expect(store.workReportedTo(nobody.pm).has(nobody.task)).toBe(false)
    })

    it('⛔ a giver that is LIVE and has NOT been told is a person’s — the failure path, planted', async () => {
      // 🔴 **The clause this reader deliberately does NOT have.** A liveness test would read *a live
      // giver will be told*, and {@link RuntimeHost.tellOneParent} writes no receipt when a delivery
      // throws — so the silent case would be exactly *a live giver that was never told*.
      //
      // ⚠️ **Planted rather than provoked**: a stall folded for a conversation this host is not
      // running, whose giver IS registered and holds no receipt. ⛔ `tellWhoeverGaveTheWork` hangs
      // off the holder's own pump, and nothing is pumping it.
      // ⚑ **D-016** — a piece is planted through the store's own writer (`recordGive`: the `work`
      // row and its `work_given`, in one transaction), under the giver's root, because the walk's
      // candidates are the `work` table's owners.
      const giver = await personOpens('a-live-giver')
      const holder = 'sess_never_run'
      store.create({
        id: holder,
        provider: 'codex',
        cwd: root,
        approvalMode: 'ask',
        profileId: 'd',
        parentSessionId: giver,
      })
      const giversRoot = store.rootOf(giver)
      if (giversRoot === null) throw new Error('the giver owns no root')
      const number = store.numberUnder(giversRoot.piece)
      const words = 'work nobody was told stopped'
      store.recordGive(
        {
          piece: 'work_planted',
          parent: giversRoot.piece,
          number,
          owner: holder,
          givenBy: giver,
          title: words,
          brief: words,
          folder: null,
          inputs: [],
        },
        0,
        {
          type: 'work_given',
          piece: 'work_planted',
          label: `${giversRoot.label}.${String(number)}`,
          parent: giversRoot.piece,
          givenBy: giver,
          title: words,
          brief: words,
        },
        clock++,
      )
      store.append(holder, 1, { type: 'turn', state: 'interrupted' }, clock++)

      // ⚑ **The premise**: the giver really is running in this host, and really holds no receipt.
      // ⚠️ **D-017 · R12 — the list proves it EXISTS, and no longer that it runs**: one list names
      // running and stopped alike. ⚑ It runs because `personOpens` started it and nothing here
      // stopped it — which is the half this reader must not ask, so it is not re-measured here.
      expect(
        host.agentsVisibleTo({ ownerId: `agent:${giver}` }, giver).agents.map((one) => one.agent),
      ).toContain(giver)
      expect(store.workReportedTo(giver).size).toBe(0)
      // 🔴 **And a person is told**, which a liveness clause would have refused.
      expect(idsNamedToAPerson()).toEqual(['work_planted'])
      expect(await host.closeForAPerson('work_planted', window)).toMatchObject({
        ok: true,
        piece: 'work_planted',
      })
      expect(store.piecesOwnedBy(holder).find((one) => one.piece === 'work_planted')?.state).toBe(
        'closed',
      )
      expect(idsNamedToAPerson()).toEqual([])
    })

    it('⛔ work a person gave out mints no piece row, so no row of this walk can be one', async () => {
      // ⚠️ **Stated in the reader's docblock and measured here**, because a sentence with no test
      // is a comment (standing rule 5). ⚑ **D-016** — a person's work is the conversation's ROOT,
      // which is never a folded piece (R1): never stalled, and never a row.
      const alone = await personOpens('lonely')
      await host.send(alone, 'do something', window)
      await cardOn(alone)
      expect(store.rootOf(alone)).not.toBeNull()
      expect(store.piecesOwnedBy(alone)).toEqual([])
      expect(idsNamedToAPerson()).toEqual([])
    })
  })

  // §2 · unattended overnight work and the gesture that clears a row

  describe('§2 · he closes the app, comes back, and the work is still stopped', () => {
    it('🔴 a person is told across a relaunch, and OPENING THE GIVER hands it back to the agent path', async () => {
      const { pm, worker } = await aGiverAndItsWorker('the work he stopped watching')
      await cardOn(worker)
      const task = pieceOf(worker).piece
      // ⛔ **The app dies holding the work** — `404`'s own helper shape: the giver's conversation is
      // closed first because a test process keeps the first host alive, and what is measured is
      // unchanged.
      await host.close(pm, window)
      window.alive = false

      // ⚠️ **A second `SessionStore` OBJECT is what makes the next launch see it** — `live-hosts.ts`
      // identifies a ledger by object.
      const next = buildHost(createSessionStore(db, tick))
      const restarted = store.piecesOwnedBy(worker)[0]
      expect(restarted).toMatchObject({ state: 'stalled', stalledBecause: 'app_restarted' })

      // 🔴 **Nothing is running, nobody has been told, and the person's read names it.** This is the
      // state that was silent before this dispatch.
      expect(receiptsTo(pm)).toEqual([])
      expect(idsNamedToAPerson(next)).toEqual([task])

      // ⚑ **The clearing gesture, and it is the one that REPAIRS the defect**: the giver comes back,
      // `tellAboutWorkItGaveOut` pushes, the receipt lands, and the row goes.
      await next.resumeSession(pm, window)
      await waitFor(() => receiptsTo(pm).includes(task), 'the giver to be told at its next launch')
      expect(idsNamedToAPerson(next)).toEqual([])
    })

    it('⛔ a piece that was ANSWERED is named to nobody — the paired negative, in one gesture', async () => {
      // ⚑ **D-016** — the first piece is answered before the second is given, as `415`'s one-slot
      // rule made it; that rule went, and the order is kept so the answered one is answered first.
      const { pm, worker, pmTools, workerProfile } = await aGiverAndItsWorker('the finished one')
      await cardOn(worker)
      const finished = store.piecesOwnedBy(worker)[0]?.piece ?? ''
      const answered = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: finished,
        outcome: 'done',
        summary: 'it is done',
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      // ⚑ A second give from the same giver reaches the SAME conversation.
      const second = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: workerProfile,
        title: 'the unfinished one',
        brief: 'the unfinished one',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      expect(second.agent).toBe(worker)
      const unfinished = store.piecesOwnedBy(worker)[1]?.piece ?? ''
      await host.close(pm, window)
      window.alive = false
      const next = buildHost(createSessionStore(db, tick))

      // ⛔ **One conversation, two pieces, one read** — the silence about the answered one is a
      // decision rather than a conversation this walk never opened.
      expect(idsNamedToAPerson(next)).toEqual([unfinished])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the property over the wire's OWN roster — this is what goes red on `main`
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · SOMETHING a person can read names the work, and the roster is derived', () => {
    /**
     * 🔴 **Every `RuntimeCommandKind` ending `ForAPerson`, read off the zod union that governs the
     * wire** — `everything-a-person-must-answer-is-in-the-queue.test.ts`' own device, borrowed
     * rather than re-invented.
     *
     * ⛔ **This is the assertion that is red on `main` for a reason that is not *the symbol is
     * missing*.** There the roster has four members, a stall with no live giver is named by none of
     * them, and the property *work that has stalled reaches somebody who can act on it* is false.
     * ⚑ A dispatch that added a fifth reader with a different name would still have to make this
     * pass, because what it asks about is the ANSWER and not the name.
     */
    const readersForAPerson = (): string[] => {
      type Node = {
        def: {
          type: string
          shape?: Record<string, Node>
          options?: Node[]
          values?: readonly string[]
        }
      }
      const kindsOf = (node: Node): string[] => {
        if (node.def.options !== undefined) return node.def.options.flatMap(kindsOf)
        const literal = node.def.shape?.kind
        return literal?.def.values === undefined ? [] : [...literal.def.values]
      }
      return kindsOf(runtimeCommandSchema as unknown as Node).filter((kind) =>
        kind.endsWith('ForAPerson'),
      )
    }

    /** What every one of those readers answers, as one string a task id can be looked for in. */
    const everythingAPersonCanRead = (on: RuntimeHost, kinds: readonly string[]): string =>
      kinds
        .map((kind) => {
          const read = (on as unknown as Record<string, () => unknown>)[kind]
          if (typeof read !== 'function') throw new Error(`no host reader for ${kind}`)
          return JSON.stringify(read.call(on))
        })
        .join('\n')

    it('🔴 work that stalled with nobody to tell is NAMED by one of the readers a window polls', async () => {
      const kinds = readersForAPerson()
      // ⛔ **A positive floor first**: a roster that found nothing would pass every assertion below
      // vacuously, which is the shape `316` was measured going wrong.
      expect(kinds.length).toBeGreaterThanOrEqual(4)
      const { told, nobody } = await aStallEachWay()
      const answers = everythingAPersonCanRead(host, kinds)

      // 🔴 **The property, stated over what a person can actually read.** On `main` this is false:
      // four readers answer, and none of them has ever heard of a task.
      expect(answers, 'no reader a window polls names the stalled work').toContain(nobody.task)
      // ⛔ **And the control is in the same string**: the stall an agent WAS told about is named by
      // none of them, so this is not a reader that lists every task it can find. ⚑ Save one: work
      // whose holder stopped with it, which a person may look at or hand back (F131), names only
      // stalls its giver was told about, so the two never share a piece.
      const theOthers = everythingAPersonCanRead(
        host,
        kinds.filter((kind) => kind !== 'stoppedWorkForAPerson'),
      )
      expect(theOthers, 'a person is told about work an agent already heard about').not.toContain(
        told.task,
      )
      const stopped = JSON.stringify(host.stoppedWorkForAPerson())
      expect(stopped).toContain(told.task)
      expect(stopped).not.toContain(nobody.task)
    })

    it('⚠️ exactly one of those readers names it, and it is the one whose walk says so', async () => {
      const { nobody } = await aStallEachWay()
      const kinds = readersForAPerson()
      const naming = kinds.filter((kind) =>
        everythingAPersonCanRead(host, [kind]).includes(nobody.task),
      )
      // ⛔ **One, and not *at least one***: two readers naming one row is two populations a person
      // has to reconcile, which is the defect `452` §5.1 is about wearing a different hat.
      expect(naming).toEqual(['stalledWorkForAPerson'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the walk says what it read, and the register has a word for it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the read discloses its own scope', () => {
    it('⛔ the walk names its candidate set, counts the ledgers it opened and has a sentence', async () => {
      await aStallEachWay()
      const walked = host.stalledWorkForAPerson()
      expect(walked.walk).toBe('every-conversation-that-was-given-work')
      // ⚑ **Two ledgers opened, ONE row found** — `453`'s two different facts, and `rows.length`
      // answers the wrong one.
      expect(walked.ledgers).toBe(2)
      expect(walked.rows).toHaveLength(1)
      expect(walked.rowsUnread).toBe(0)
      // ⛔ **The word is in the register and carries a sentence a person reads** — a walk kind with
      // no `WALK_COVERS` entry is a count nobody can interpret.
      expect(LEDGER_WALK_KINDS).toContain('every-conversation-that-was-given-work')
      expect(WALK_COVERS['every-conversation-that-was-given-work'].length).toBeGreaterThan(80)
    })

    it('⚑ a workspace where nothing was ever given work answers the same word with zero ledgers', async () => {
      const quiet = await personOpens('quiet')
      await host.send(quiet, 'hello', window)
      const walked = host.stalledWorkForAPerson()
      expect(walked.rows).toEqual([])
      // 🔴 **The discriminant.** Without this the `ledgers` above could be `rows.length` and both
      // assertions would pass — `a-comparison-tested-where-both-sides-agree`.
      expect(walked.ledgers).toBe(0)
      expect(walked.walk).toBe('every-conversation-that-was-given-work')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · HO-018 §2.2 — no timer was reintroduced, and that is measured rather than promised
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · it is a READ, and the PO’s withdrawn timeout stays withdrawn', () => {
    it('🔴 the answer does not move with the clock — nothing here expires and nothing fires', async () => {
      const { nobody } = await aStallEachWay()
      const first = idsNamedToAPerson()
      expect(first).toEqual([nobody.task])
      // ⛔ **A whole week of the host's own clock**, which is far past any threshold anybody could
      // have named. ⚑ HO-018 §2.2: *"an idle timeout on a working child is the guess, and the
      // measurement says we cannot pick the number honestly"* — so this read may not have one.
      clock += 7 * 24 * 60 * 60 * 1000
      expect(idsNamedToAPerson()).toEqual(first)
      // ⚠️ **And the task is still OPEN**: a deadline that had closed it would make the list shrink
      // for the wrong reason, which is the irreversible close the PO refused.
      const row = store.piecesOwnedBy(nobody.worker).find((one) => one.piece === nobody.task)
      expect(row?.state).toBe('stalled')
      expect(row?.endedAt).toBeNull()
    })

    it('⛔ neither the reader nor the store’s walk arms a timer — the source, with prose stripped', () => {
      const codeOf = (source: string, from: string): string => {
        const at = source.indexOf(from)
        expect(at, `${from} is not in the source any more`).toBeGreaterThan(-1)
        const body = source.slice(at, source.indexOf('\n  }\n', at) + 5)
        return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      }
      const reader = codeOf(hostSource, 'stalledWorkForAPerson(): LedgerWalk<StalledWork> {')
      const walk = codeOf(storeSource, 'stalledWorkNobodyWasToldAbout(counted) {')
      for (const [name, body] of [
        ['the host reader', reader],
        ["the store's walk", walk],
      ] as const) {
        for (const forbidden of ['setTimeout', 'setInterval', 'Date.now']) {
          expect(body, `${name} reaches for ${forbidden}`).not.toContain(forbidden)
        }
      }
      // ⚑ **The control for the extractor** (standing rule 12): it really did cut a body out, and a
      // strip that removed everything would pass the loop above over nothing.
      expect(reader).toContain('stalledWorkNobodyWasToldAbout')
      // ⚑ **D-016** — the candidate query reads the `work` table's owners now: since commit 6, only
      // the owners of pieces a conversation gave, the only pieces the band can draw.
      expect(walk).toContain('selectOwnersOfPiecesAConversationGave')
      // ⛔ **And prose about a timer is not a timer** — the same strip the other censuses use.
      expect(
        codeOf('x() {\n  // setTimeout would be the obvious answer\n  return 1\n  }\n', 'x() {'),
      ).not.toContain('setTimeout')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the shape decision — a band beside the rows, not a fourth population
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · it is carried BESIDE a person’s queue and never as a row in it', () => {
    it('⛔ the queue’s vocabulary is unchanged, and the band draws from its own read', async () => {
      const { nobody } = await aStallEachWay()
      // 🔴 **The vocabulary read off an exhaustive `Record<PersonsQueueKind, …>`** — `KIND_WORDS` —
      // so this roster is the compiler's rather than a list typed here.
      expect([...Object.keys(KIND_WORDS)].sort()).toEqual(['a-decision', 'a-question'])
      const band = stalledWorkView(host.stalledWorkForAPerson(), true, clock, new Set())
      expect(band?.rows).toHaveLength(1)
      const row = band?.rows[0]
      expect(row?.key).toBe(nobody.task)
      // ⛔ **The destination is the conversation HOLDING the work**, which is the one place this
      // band's door differs from what its sentence is about.
      expect(row?.sessionId).toBe(nobody.worker)
      expect(row?.what).toBe('the work whose giver went away')
      // ⛔ **The band draws the one LINE and never the whole brief**, measured where the two
      // readings diverge: the brief here has a second paragraph, which is how a mutation that put
      // the whole thing on the band would be seen. ⚑ **D-016** — the line is the piece's TITLE,
      // which is one line by construction, where the task's text was cut at its first line.
      expect(pieceOf(nobody.worker).brief).toContain(A_SECOND_PARAGRAPH)
      expect(row?.what).not.toContain(A_SECOND_PARAGRAPH)
      expect(row?.since).not.toBeNull()
      // ⚑ **`106`: a control that can name no gesture is a control that cannot act.**
      expect(row?.action).not.toBe('')
    })

    it('🔴 `null` is *nobody has looked*, and a refused look is DRAWN rather than dropped', () => {
      // ⛔ **`086`'s rule on the read where the wrong default is a false all-clear.** An empty band
      // says *every piece of work that stopped has reached somebody*, which is the claim `555` §3.1
      // measured this app making silently.
      expect(stalledWorkView(null, true, clock, new Set())).toBeNull()
      expect(stalledWorkView(null, false, clock, new Set())).toEqual({ rows: [], unread: true })
    })

    it('⚠️ a band with ROWS still discloses that the last look stopped answering', async () => {
      // ⛔ **The case the `null` arm above cannot reach.** A read that answered once and has since
      // stopped keeps its last good rows — `434`'s rule — so `unread` is the ONLY thing saying the
      // list may be short, and a band that hard-coded it would look up to date for ever.
      await aStallEachWay()
      const walked = host.stalledWorkForAPerson()
      expect(stalledWorkView(walked, true, clock, new Set())?.unread).toBe(false)
      const stale = stalledWorkView(walked, false, clock, new Set())
      expect(stale?.unread).toBe(true)
      // ⚑ **And the rows are still there**, which is what makes `unread` a disclosure rather than
      // an empty list wearing a flag.
      expect(stale?.rows).toHaveLength(1)
    })

    it('⛔ the band and the rows are supplied in ONE call, so the card cannot come from two looks', () => {
      // 🔴 **`PersonsQueue.supply`'s own rule** — *one supply, one moment* — as a census over the
      // one call site, because a caller that named no stalls means *nobody has looked* and would
      // draw a permanently empty band while the read beside it answered perfectly.
      const screen = readFileSync(
        join(here, '../src/renderer/src/components/RuntimeScreen.vue'),
        'utf8',
      )
      const at = screen.indexOf('persons.supply(')
      expect(at, 'the one supply call has moved or gone').toBeGreaterThan(-1)
      const call = screen.slice(at, screen.indexOf('\n  )\n', at))
      // ⛔ **Both bands in the same call**, which is what makes *one moment* a property of the code
      // rather than a sentence in a docblock.
      expect(call).toContain('walked: limitsDisplay.value.reading?.walked ?? null')
      expect(call).toContain("lastLookAnswered: limitsDisplay.value.status === 'ready'")
      expect(call).toContain('display: limitsDisplay.value')
      expect(call).toContain('stalledWork.value')
      expect(call).toContain('lastStallLookAnswered.value')
      // ⚑ **D-017 · R19 — and the instruction asks, the sixth read, in that same call.**
      expect(call).toContain('instructionAsks.value')
      // ⚑ **The control for the slice** (standing rule 12): it really did cut the call out, and a
      // slice that ran to the end of the file would contain every one of those strings anyway.
      // The whole supply call, including typed-wait incidents, fits in 5,000 characters.
      // This bounds the extracted call, so accidentally taking the file tail cannot pass.
      expect(call.length).toBeLessThan(5_000)
      expect(screen.length).toBeGreaterThan(30 * 3_500)
      expect(call).toContain('escalated.value')
    })

    // ⚑ **D-017b · re-aimed, not stripped** (rule 26): there were two gestures — open one this
    // window holds, take over one nobody holds — and now there is ONE press everywhere (*Open the
    // conversation*), which opens it in its full view whatever holds it (the host's `look` claims one
    // nobody holds, on the press). ⛔ So the button says the one press's words, before it is pressed,
    // whoever holds the conversation — and the band still carries WHO holds it, one fact over.
    it('⚠️ the button says the one press it performs, before it is pressed, whoever holds it', async () => {
      const { nobody } = await aStallEachWay()
      const walked = host.stalledWorkForAPerson()
      const notHeld = stalledWorkView(walked, true, clock, new Set())?.rows[0]
      const held = stalledWorkView(walked, true, clock, new Set([nobody.worker]))?.rows[0]
      expect(notHeld?.held).toBe(false)
      expect(held?.held).toBe(true)
      expect(notHeld?.action).toBe(OPEN_THE_CONVERSATION)
      expect(held?.action).toBe(OPEN_THE_CONVERSATION)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the order, and where a row with no stamp goes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · oldest first, and an unknown age is not an old age', () => {
    it('⛔ two stalls come back oldest-first, by the moment the engine observed each one', async () => {
      const first = await aGiverAndItsWorker('the older work')
      await cardOn(first.worker)
      await host.close(first.pm, window)
      const second = await aGiverAndItsWorker('the newer work')
      await cardOn(second.worker)
      await host.close(second.pm, window)
      // ⚑ **D-017 · R1 — givers that cannot be started**, as `aStallEachWay`'s: ones that have only
      // stopped are started by their workers' stalls and told, and nothing would be a person's.
      issued.forgetAll()
      const older = pieceOf(first.worker).piece
      const newer = pieceOf(second.worker).piece
      await interruptTheTurn(first.worker)
      await interruptTheTurn(second.worker)

      const rows = namedToAPerson()
      expect(rows.map((row) => row.piece)).toEqual([older, newer])
      // ⚑ **Non-vacuity**: the two stamps really do differ, or the order above is an accident of
      // insertion — `a-positive-assertion-must-differ-from-the-default`.
      expect(rows[0]?.stalledAt).toBeLessThan(rows[1]?.stalledAt ?? 0)
    })
  })
})
