import { waitFor } from './lib/f093-host'
import { LEDGER_WALK_KINDS } from '../src/shared/question-contracts'
import type { PieceRow, WorkStallTold } from '../src/shared/task-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { WALK_COVERS } from '../src/shared/questions'
import { UNDRIVEN_SENTENCES, stalledWithACause } from '../src/shared/tasks'
import { stalledWorkKey, stalledWorkSaid } from '../src/shared/stalled-work'
import type { StalledWork } from '../src/shared/stalled-work'
import { KIND_WORDS, stalledWorkLead, stalledWorkView } from '../src/renderer/src/lib/persons-queue'
import { OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { ProviderDouble, anOpenGate } from './lib/provider-double'
import { callOn } from './helpers/call-tool'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, anOpenGate()),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
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

  const A_SECOND_PARAGRAPH = 'and a second paragraph nobody should read on the band'

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

  const receiptsTo = (parent: string): string[] =>
    events(parent)
      .filter((event): event is WorkStallTold => event.type === 'work_stall_told')
      .map((event) => event.piece)

  const namedToAPerson = (on: RuntimeHost = host): readonly StalledWork[] =>
    on.stalledWorkForAPerson().rows

  const idsNamedToAPerson = (on: RuntimeHost = host): string[] =>
    namedToAPerson(on).map((work) => work.piece)

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
    await host.close(gone.pm, window)
    issued.forgetAll()
    await interruptTheTurn(gone.worker)
    await interruptTheTurn(live.worker)
    await waitFor(() => receiptsTo(live.pm).includes(toldTask), 'the live giver to be told')
    return {
      told: { pm: live.pm, worker: live.worker, task: toldTask },
      nobody: { pm: gone.pm, worker: gone.worker, task: nobodyTask },
    }
  }

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

      for (const [holder, task] of [
        [told.worker, told.task],
        [nobody.worker, nobody.task],
      ] as const) {
        const row = store.piecesOwnedBy(holder).find((one) => one.piece === task)
        expect(row, `${task} is missing from ${holder}`).toBeDefined()
        expect(row).toMatchObject({ state: 'stalled', stalledBecause: 'turn_interrupted' })
        expect(stalledWithACause(row as PieceRow)).toBe(true)
      }

      expect(idsNamedToAPerson()).toEqual([nobody.task])

      expect(receiptsTo(told.pm)).toEqual([told.task])
      expect(receiptsTo(nobody.pm)).toEqual([])
    })

    it('⛔ the row says whose work it is, where it is, and what the engine observed', async () => {
      const { nobody } = await aStallEachWay()
      const work = namedToAPerson()[0] as StalledWork

      expect(work.owner).toBe(nobody.worker)
      expect(work.giver).toBe(nobody.pm)
      expect(work.title).toBe('the work whose giver went away')
      expect(work.because).toBe('turn_interrupted')
      expect(work.stalledAt).toBeGreaterThan(0)
      expect(work.askedToStop).toEqual({ by: 'a-person', asker: null, askerName: null })
      expect(work.ownerName).not.toBe(work.owner)
      expect(work.giverName).not.toBe(work.giver)

      expect(stalledWorkSaid(work).toLowerCase()).toContain(
        UNDRIVEN_SENTENCES.turn_interrupted.replace(/\.$/, ''),
      )
      expect(work.ownerName).not.toBe(work.giverName)
      expect(stalledWorkLead(work)).toContain('is not being worked on')
      expect(stalledWorkLead(work)).toContain('which gave it out')
      expect(stalledWorkLead(work)).toContain('has not been told')
      expect(stalledWorkKey(work)).toBe(nobody.task)
    })

    it('🔴 729 · `725` draw 9 — a PERSON asked the turn to stop: the row says so, and names no conversation', async () => {
      const { pm, worker } = await aGiverAndItsWorker('the work a person stops')
      await cardOn(worker)
      const task = pieceOf(worker).piece
      await host.close(pm, window)
      issued.forgetAll()
      host.claimSession(worker, window)
      await host.interrupt(worker, window)
      await waitFor(() => pieceOf(worker).state === 'stalled', 'the stopped work to stall')
      const work = namedToAPerson().find((one) => one.piece === task)
      expect(work?.askedToStop).toEqual({ by: 'a-person', asker: null, askerName: null })
    })

    it('⛔ the sentence names BOTH conversations, measured where the two words differ', () => {
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
      expect(said).toContain('W1.3 ')
      expect(said).not.toContain('W1.3 in ')
      expect(made.ownerName).not.toBe(made.giverName)
    })

    it('⛔ a giver that is LIVE and has NOT been told is a person’s — the failure path, planted', async () => {
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

      expect(
        host.agentsVisibleTo({ ownerId: `agent:${giver}` }, giver).agents.map((one) => one.agent),
      ).toContain(giver)
      expect(store.workReportedTo(giver).size).toBe(0)
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
      const alone = await personOpens('lonely')
      await host.send(alone, 'do something', window)
      await cardOn(alone)
      expect(store.rootOf(alone)).not.toBeNull()
      expect(store.piecesOwnedBy(alone)).toEqual([])
      expect(idsNamedToAPerson()).toEqual([])
    })
  })

  describe('§2 · he closes the app, comes back, and the work is still stopped', () => {
    it('🔴 a person is told across a relaunch, and OPENING THE GIVER hands it back to the agent path', async () => {
      const { pm, worker } = await aGiverAndItsWorker('the work he stopped watching')
      await cardOn(worker)
      const task = pieceOf(worker).piece
      await host.close(pm, window)
      window.alive = false

      const next = buildHost(createSessionStore(db, tick))
      const restarted = store.piecesOwnedBy(worker)[0]
      expect(restarted).toMatchObject({ state: 'stalled', stalledBecause: 'app_restarted' })

      expect(receiptsTo(pm)).toEqual([])
      expect(idsNamedToAPerson(next)).toEqual([task])

      await next.resumeSession(pm, window)
      await waitFor(() => receiptsTo(pm).includes(task), 'the giver to be told at its next launch')
      expect(idsNamedToAPerson(next)).toEqual([])
    })

    it('⛔ a piece that was ANSWERED is named to nobody — the paired negative, in one gesture', async () => {
      const { pm, worker, pmTools, workerProfile } = await aGiverAndItsWorker('the finished one')
      await cardOn(worker)
      const finished = store.piecesOwnedBy(worker)[0]?.piece ?? ''
      const answered = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: finished,
        outcome: 'done',
        summary: 'it is done',
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
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

      expect(idsNamedToAPerson(next)).toEqual([unfinished])
    })
  })

  describe('§3 · SOMETHING a person can read names the work, and the roster is derived', () => {
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
      expect(kinds.length).toBeGreaterThanOrEqual(4)
      const { told, nobody } = await aStallEachWay()
      const answers = everythingAPersonCanRead(host, kinds)

      expect(answers, 'no reader a window polls names the stalled work').toContain(nobody.task)
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
      expect(naming).toEqual(['stalledWorkForAPerson'])
    })
  })

  describe('§4 · the read discloses its own scope', () => {
    it('⛔ the walk names its candidate set, counts the ledgers it opened and has a sentence', async () => {
      await aStallEachWay()
      const walked = host.stalledWorkForAPerson()
      expect(walked.walk).toBe('every-conversation-that-was-given-work')
      expect(walked.ledgers).toBe(2)
      expect(walked.rows).toHaveLength(1)
      expect(walked.rowsUnread).toBe(0)
      expect(LEDGER_WALK_KINDS).toContain('every-conversation-that-was-given-work')
      expect(WALK_COVERS['every-conversation-that-was-given-work'].length).toBeGreaterThan(80)
    })

    it('⚑ a workspace where nothing was ever given work answers the same word with zero ledgers', async () => {
      const quiet = await personOpens('quiet')
      await host.send(quiet, 'hello', window)
      const walked = host.stalledWorkForAPerson()
      expect(walked.rows).toEqual([])
      expect(walked.ledgers).toBe(0)
      expect(walked.walk).toBe('every-conversation-that-was-given-work')
    })
  })

  describe('§5 · it is a READ, and the PO’s withdrawn timeout stays withdrawn', () => {
    it('🔴 the answer does not move with the clock — nothing here expires and nothing fires', async () => {
      const { nobody } = await aStallEachWay()
      const first = idsNamedToAPerson()
      expect(first).toEqual([nobody.task])
      clock += 7 * 24 * 60 * 60 * 1000
      expect(idsNamedToAPerson()).toEqual(first)
      const row = store.piecesOwnedBy(nobody.worker).find((one) => one.piece === nobody.task)
      expect(row?.state).toBe('stalled')
      expect(row?.endedAt).toBeNull()
    })
  })

  describe('§6 · it is carried BESIDE a person’s queue and never as a row in it', () => {
    it('⛔ the queue’s vocabulary is unchanged, and the band draws from its own read', async () => {
      const { nobody } = await aStallEachWay()
      expect([...Object.keys(KIND_WORDS)].sort()).toEqual(['a-decision', 'a-question'])
      const band = stalledWorkView(host.stalledWorkForAPerson(), true, clock, new Set())
      expect(band?.rows).toHaveLength(1)
      const row = band?.rows[0]
      expect(row?.key).toBe(nobody.task)
      expect(row?.sessionId).toBe(nobody.worker)
      expect(row?.what).toBe('the work whose giver went away')
      expect(pieceOf(nobody.worker).brief).toContain(A_SECOND_PARAGRAPH)
      expect(row?.what).not.toContain(A_SECOND_PARAGRAPH)
      expect(row?.since).not.toBeNull()
      expect(row?.action).not.toBe('')
    })

    it('🔴 `null` is *nobody has looked*, and a refused look is DRAWN rather than dropped', () => {
      expect(stalledWorkView(null, true, clock, new Set())).toBeNull()
      expect(stalledWorkView(null, false, clock, new Set())).toEqual({ rows: [], unread: true })
    })

    it('⚠️ a band with ROWS still discloses that the last look stopped answering', async () => {
      await aStallEachWay()
      const walked = host.stalledWorkForAPerson()
      expect(stalledWorkView(walked, true, clock, new Set())?.unread).toBe(false)
      const stale = stalledWorkView(walked, false, clock, new Set())
      expect(stale?.unread).toBe(true)
      expect(stale?.rows).toHaveLength(1)
    })

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

  describe('§7 · oldest first, and an unknown age is not an old age', () => {
    it('⛔ two stalls come back oldest-first, by the moment the engine observed each one', async () => {
      const first = await aGiverAndItsWorker('the older work')
      await cardOn(first.worker)
      await host.close(first.pm, window)
      const second = await aGiverAndItsWorker('the newer work')
      await cardOn(second.worker)
      await host.close(second.pm, window)
      issued.forgetAll()
      const older = pieceOf(first.worker).piece
      const newer = pieceOf(second.worker).piece
      await interruptTheTurn(first.worker)
      await interruptTheTurn(second.worker)

      const rows = namedToAPerson()
      expect(rows.map((row) => row.piece)).toEqual([older, newer])
      expect(rows[0]?.stalledAt).toBeLessThan(rows[1]?.stalledAt ?? 0)
    })
  })
})
