import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  type ForestedConversation,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  MAX_FOREST_CONVERSATIONS,
  type ForestConversation,
  type ForestTask,
  type NamedConversation,
} from '../src/shared/the-whole-forest'

/**
 * # D-034 — the forest says, for each conversation, whose place it stands in
 *
 * ⚑ **A conversation that could never be reopened is replaced** by a new conversation of the same
 * agent (D-017 · R10, `replaceWhatCanNeverBeReopened`). Until D-034 the forest drew both as two
 * unrelated nodes, so a parent's new work to its child hung off a conversation the Graph did not
 * draw over that child. `RuntimeHost.theWholeForest()` now names, on each conversation,
 * `standsInFor` (the ones whose chain of replacements ends at it) and `inItsPlace` (the end of its
 * own chain), each named with whether this reading drew it.
 *
 * Lifted from the dev's scratch cases A–C, with what the scratch only logged now asserted, plus what the scratch never reached: a named conversation
 * this reading did not draw, and the store's half, which carries neither field.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, a plain `FakeRuntime` over
 * `FakeProviderSessions`**: the harness of `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`.
 * `issued.forgetAll()` is what makes a stopped conversation one its provider no longer has.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** ⚑ The forest as a window reads it: each conversation by id, and every piece. */
interface Reading {
  readonly conversations: ReadonlyMap<string, ForestConversation>
  readonly pieces: readonly ForestTask[]
}

const drawnOne = (conversation: string): NamedConversation => ({
  is: 'a-conversation',
  conversation,
})
const notDrawn = (conversation: string): NamedConversation => ({
  is: 'a-conversation-this-reading-did-not-draw',
  conversation,
})

/** ⚑ Whether a type carries a key — for the store's half, which must carry neither new field. */
type Carries<K extends PropertyKey, T> = K extends keyof T ? true : false

describe('D-034 — the forest says, for each conversation, whose place it stands in', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d034-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d034-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_100_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const stopped = (id: string): Promise<void> =>
    waitFor(
      () =>
        ![...host.resumableSessions()].some(
          (row) => row.sessionId === id && row.running !== 'not-running',
        ),
      `${id} to be over`,
    )

  const read = (): Reading => {
    const conversations = new Map<string, ForestConversation>()
    const pieces: ForestTask[] = []
    for (const node of host.theWholeForest().nodes.rows) {
      if (node.node === 'a-conversation') conversations.set(node.conversation, node)
      else pieces.push(node)
    }
    return { conversations, pieces }
  }

  /** ⚑ A conversation's two D-034 fields, or a throw when this reading did not draw it. */
  const placeOf = (
    reading: Reading,
    conversation: string,
  ): Pick<ForestConversation, 'standsInFor' | 'inItsPlace'> => {
    const node = reading.conversations.get(conversation)
    if (node === undefined) throw new Error(`${conversation} is not in this reading`)
    return { standsInFor: node.standsInFor, inItsPlace: node.inItsPlace }
  }

  const NOWHERE: Pick<ForestConversation, 'standsInFor' | 'inItsPlace'> = {
    standsInFor: [],
    inItsPlace: null,
  }

  /**
   * ⚑ A pm a person opened, and one `worker` it gave work to, then stopped by the app while its
   * piece stays open — `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`'s fixture.
   */
  const aWorkerOver = async (): Promise<{ pm: string; worker: string; label: string }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(() => turnsIn(worker) > 0, 'the turn the brief opened to end')
    expect(store.piecesOwnedBy(worker).some((one) => TASK_IS_OPEN[one.state])).toBe(true)
    await host.close(worker, THE_APP_ITSELF)
    await stopped(worker)
    return { pm, worker, label: given.label as string }
  }

  /** ⚑ The worker's provider forgets it, and its parent's follow-up replaces it. */
  const replaceTheWorker = async (): Promise<{
    pm: string
    worker: string
    label: string
    next: string
  }> => {
    const { pm, worker, label } = await aWorkerOver()
    issued.forgetAll()
    const sent = await callOn(pm, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })
    expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    const next = sent.went_to as string
    expect(typeof next).toBe('string')
    expect(next).not.toBe(worker)
    return { pm, worker, label, next }
  }

  it('A · a CHILD that could never be reopened: its stand-in stands in for it, it names its stand-in, and nobody else moves', async () => {
    const { pm, worker, label } = await aWorkerOver()
    // ⚑ Before the replacement nothing stands anywhere: the same conversation, the same reading.
    const before = read()
    expect(placeOf(before, worker)).toEqual(NOWHERE)
    expect(placeOf(before, pm)).toEqual(NOWHERE)

    issued.forgetAll()
    const sent = await callOn(pm, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })
    expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    const next = sent.went_to as string
    expect(next).not.toBe(worker)
    expect(host.tookItsPlace(worker)).toBe(next)

    const after = read()
    expect(placeOf(after, worker)).toEqual({ standsInFor: [], inItsPlace: drawnOne(next) })
    expect(placeOf(after, next)).toEqual({ standsInFor: [drawnOne(worker)], inItsPlace: null })
    // ⚑ The stand-in hangs under the same parent, and the old child's stalled piece is still held
    // by the old child, given by the pm: the window re-hangs it by the two new fields.
    expect(after.conversations.get(next)?.under).toEqual(drawnOne(pm))
    const piece = after.pieces.find((one) => one.work.label === label)
    expect(piece?.under).toEqual({ is: 'a-conversation', conversation: worker })
    expect(piece?.givenBy).toEqual(drawnOne(pm))
    expect(piece?.work.state).toBe('stalled')
    // ⛔ Every other conversation — the pm, and the worker the person opened first — stands nowhere.
    const elsewhere = [...after.conversations.keys()].filter((id) => id !== worker && id !== next)
    expect(elsewhere).toContain(pm)
    expect(elsewhere.length).toBeGreaterThanOrEqual(2)
    for (const id of elsewhere) expect(placeOf(after, id), id).toEqual(NOWHERE)

    // ⚑ Read again: built for each read, so a second read says the same and nothing piles up.
    const again = read()
    expect(placeOf(again, next)).toEqual({ standsInFor: [drawnOne(worker)], inItsPlace: null })
    expect(placeOf(again, worker)).toEqual({ standsInFor: [], inItsPlace: drawnOne(next) })
  })

  it('B · a PARENT that could never be reopened: its stand-in names it, and the work the stand-in gives hangs off the stand-in while the child still hangs under the old one', async () => {
    // ⚑ Unlike `aWorkerOver`, the worker stays up: were it stopped too, the provider forgetting
    // every conversation would put a stand-in in ITS place as well, and the give below would go there.
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const first = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const worker = first.agent as string
    const label = first.label as string
    await waitFor(() => turnsIn(worker) > 0, 'the turn the brief opened to end')
    await host.close(pm, THE_APP_ITSELF)
    await stopped(pm)
    issued.forgetAll()
    // ⚑ The worker's note to its stopped parent starts it, and its provider no longer has it.
    const noted = await callOn(worker, 'message_agent', {
      agent: pm,
      text: 'a question for you',
      kind: 'note',
    })
    expect(noted.outcome, JSON.stringify(noted)).toBe('ok')
    const pmNext = host.tookItsPlace(pm)
    if (pmNext === null) throw new Error('the premise: the parent was replaced')
    expect(noted.went_to).toBe(pmNext)
    await waitFor(() => turnsIn(pmNext) > 0, 'the stand-in to take its first turn')

    // ⚑ The stand-in takes back the old parent's piece and gives the child new work, in its own name.
    const back = await callOn(pmNext, 'withdraw_task', { piece: label })
    expect(back.outcome, JSON.stringify(back)).toBe('ok')
    const second = await callOn(pmNext, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The index',
      brief: 'add the index',
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    expect(second.agent).toBe(worker)

    const after = read()
    expect(placeOf(after, pm)).toEqual({ standsInFor: [], inItsPlace: drawnOne(pmNext) })
    expect(placeOf(after, pmNext)).toEqual({ standsInFor: [drawnOne(pm)], inItsPlace: null })
    // ⚑ D-034's symptom, which the two fields are what let a window mend: the child still hangs
    // under the OLD id, while its new piece is given by the stand-in.
    expect(after.conversations.get(worker)?.under).toEqual(drawnOne(pm))
    expect(placeOf(after, worker)).toEqual(NOWHERE)
    const given = after.pieces.find((one) => one.work.label === second.label)
    expect(given?.givenBy).toEqual(drawnOne(pmNext))
    expect(given?.under).toEqual({ is: 'a-conversation', conversation: worker })
    const old = after.pieces.find((one) => one.work.label === label)
    expect(old?.givenBy).toEqual(drawnOne(pm))
    expect(old?.work.state).toBe('withdrawn')
  })

  it('C · the control — a conversation reopened on its own id stands in for nobody, and nobody stands in for it', async () => {
    const pm = await personOpens('pm')
    await host.close(pm, THE_APP_ITSELF)
    await stopped(pm)
    // ⚑ Its provider still has it, so the reopen keeps its id, as a reopen on a renewed sign-in does.
    await host.resumeSession(pm, window)
    const after = read()
    expect(placeOf(after, pm)).toEqual(NOWHERE)
    expect(host.tookItsPlace(pm)).toBeNull()
    expect(ledger(pm).some((event) => event.type === 'replaced_by')).toBe(false)
    // ⚑ Paired: the one row in this reading is that conversation, drawn.
    expect([...after.conversations.keys()]).toEqual([pm])
  })

  describe('a conversation this reading did not draw is still named, and says so', () => {
    it('a predecessor no agent holds any more is named by its stand-in as one this reading did not draw', async () => {
      const { worker, next } = await replaceTheWorker()
      // ⚑ Paired positive: while it is placed, the stand-in names it as drawn.
      expect(placeOf(read(), next).standsInFor).toEqual([drawnOne(worker)])

      db.prepare('UPDATE provider_session SET agent_identity_id = NULL WHERE id = ?').run(worker)

      const after = read()
      expect(after.conversations.has(worker)).toBe(false)
      expect(placeOf(after, next)).toEqual({ standsInFor: [notDrawn(worker)], inItsPlace: null })
    })

    it('a stand-in no agent holds is named by the one it replaced as one this reading did not draw', async () => {
      const { worker, next } = await replaceTheWorker()
      // ⚑ Paired positive: while the stand-in is placed, the old one names it as drawn.
      expect(placeOf(read(), worker).inItsPlace).toEqual(drawnOne(next))

      db.prepare('UPDATE provider_session SET agent_identity_id = NULL WHERE id = ?').run(next)

      const after = read()
      expect(after.conversations.has(next)).toBe(false)
      expect(placeOf(after, worker)).toEqual({ standsInFor: [], inItsPlace: notDrawn(next) })
    })
  })

  it("the store's half carries neither field: who took whose place is the host's memory, and the store adds no read for it", async () => {
    const { worker, next } = await replaceTheWorker()
    // ⛔ The type: `ForestedConversation` omits both, as it omits `running`; the host's shape has them.
    const theStoreCarries: readonly [
      Carries<'standsInFor', ForestedConversation>,
      Carries<'inItsPlace', ForestedConversation>,
      Carries<'running', ForestedConversation>,
    ] = [false, false, false]
    const theHostCarries: readonly [
      Carries<'standsInFor', ForestConversation>,
      Carries<'inItsPlace', ForestConversation>,
    ] = [true, true]
    expect([theStoreCarries, theHostCarries]).toEqual([
      [false, false, false],
      [true, true],
    ])

    // ⚑ And the rows: the store's rows for both ends of the replacement carry neither key …
    const fromTheStore = store
      .everyPlacedConversation(MAX_FOREST_CONVERSATIONS)
      .rows.flatMap((row) => (row.node === 'a-conversation' ? [row] : []))
    const storeRow = (id: string): ForestedConversation | undefined =>
      fromTheStore.find((row) => row.conversation === id)
    for (const id of [worker, next]) {
      const row = storeRow(id)
      expect(row, id).toBeDefined()
      expect(row !== undefined && 'standsInFor' in row, id).toBe(false)
      expect(row !== undefined && 'inItsPlace' in row, id).toBe(false)
    }
    // … while the host's rows for the same two carry both, filled.
    const fromTheHost = read()
    expect(placeOf(fromTheHost, worker).inItsPlace).toEqual(drawnOne(next))
    expect(placeOf(fromTheHost, next).standsInFor).toEqual([drawnOne(worker)])
  })
})
