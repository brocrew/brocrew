import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import type { ForestConversation, NamedConversation } from '../src/shared/the-whole-forest'

/**
 * # D-034 — a chain of replacements, a restart, and a hand-edited loop
 *
 * ⚑ **`theWholeForest()` follows each replacement to the END of its chain** (`theOneInItsPlace`,
 * the rule every other door follows), so every link names the same stand-in and the stand-in
 * names every link; **it reads them from the host's memory of replacements**, which a new host
 * loads off the old ledgers' `replaced_by` rows as it starts; and **a chain that loops** — only a
 * hand-edited ledger can make one — **has no end, so it names none**.
 *
 * Lifted from the dev's scratch cases D–F, with the chain carried across a restart, and a hand-edited chain that ends set beside the loop.
 *
 * ⚑ The harness is `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`'s, with every
 * read and tool call taking the host it runs on, since two hosts share one database here.
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

type Place = Pick<ForestConversation, 'standsInFor' | 'inItsPlace'>

const drawnOne = (conversation: string): NamedConversation => ({
  is: 'a-conversation',
  conversation,
})

const NOWHERE: Place = { standsInFor: [], inItsPlace: null }

/** ⚑ `standsInFor` has no defined order, so it is compared as a sorted list of ids and arms. */
const sortedIds = (named: readonly NamedConversation[]): string[] =>
  named.map((one) => `${one.is}:${one.conversation}`).sort()

describe('D-034 — a chain, a restart and a hand-edited loop', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d034-chain-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d034-chain-root-'))
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
    on: RuntimeHost,
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(on, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const stopped = (on: RuntimeHost, id: string): Promise<void> =>
    waitFor(
      () =>
        ![...on.resumableSessions()].some(
          (row) => row.sessionId === id && row.running !== 'not-running',
        ),
      `${id} to be over`,
    )

  /** ⚑ Each drawn conversation's two D-034 fields, by id, as the host `on` reads the forest. */
  const places = (on: RuntimeHost): Map<string, Place> => {
    const read = new Map<string, Place>()
    for (const node of on.theWholeForest().nodes.rows) {
      if (node.node !== 'a-conversation') continue
      read.set(node.conversation, { standsInFor: node.standsInFor, inItsPlace: node.inItsPlace })
    }
    return read
  }

  const placeIn = (read: ReadonlyMap<string, Place>, id: string): Place => {
    const place = read.get(id)
    if (place === undefined) throw new Error(`${id} is not in this reading`)
    return place
  }

  /** ⚑ A pm and the worker it gave work to, the worker stopped by the app with its piece open. */
  const aWorkerOver = async (): Promise<{ pm: string; worker: string; label: string }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(host, pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate it',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(() => turnsIn(worker) > 0, 'the brief turn')
    await host.close(worker, THE_APP_ITSELF)
    await stopped(host, worker)
    return { pm, worker, label: given.label as string }
  }

  /** ⚑ The worker replaced, its stand-in stopped and forgotten, and that stand-in replaced too. */
  const aChainOfTwo = async (): Promise<{
    pm: string
    worker: string
    worker2: string
    worker3: string
  }> => {
    const { pm, worker, label } = await aWorkerOver()
    issued.forgetAll()
    const first = await callOn(host, pm, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const worker2 = first.went_to as string
    await waitFor(() => turnsIn(worker2) > 0, 'the first stand-in turn')
    await host.close(worker2, THE_APP_ITSELF)
    await stopped(host, worker2)
    issued.forgetAll()
    const second = await callOn(host, pm, 'message_agent', {
      agent: worker,
      text: 'and again',
      kind: 'note',
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    const worker3 = second.went_to as string
    expect(new Set([worker, worker2, worker3]).size).toBe(3)
    // ⚑ The premise: two replacements, one in each old ledger.
    expect(ledger(worker)).toContainEqual({ type: 'replaced_by', sessionId: worker2 })
    expect(ledger(worker2)).toContainEqual({ type: 'replaced_by', sessionId: worker3 })
    return { pm, worker, worker2, worker3 }
  }

  /** ⚑ A hand edit: a `replaced_by` row written straight into `from`'s ledger. */
  const handWrites = (from: string, to: string): void => {
    store.append(from, store.nextOrdinal(from), { type: 'replaced_by', sessionId: to }, tick())
  }

  /** ⚑ Conversations a person opened, each stopped by the app. */
  const stoppedConversations = async (profiles: readonly string[]): Promise<string[]> => {
    const ids: string[] = []
    for (const profile of profiles) ids.push(await personOpens(profile))
    for (const id of ids) {
      await host.close(id, THE_APP_ITSELF)
      await stopped(host, id)
    }
    return ids
  }

  /** ⚑ Every host stopped, and a new one on the same database: what a restart is. */
  const restart = async (): Promise<RuntimeHost> => {
    for (const built of hosts) await built.closeAll()
    return buildHost()
  }

  it('D · a chain: the worker replaced twice — the end of the chain stands in for both, and both name the end', async () => {
    const { pm, worker, worker2, worker3 } = await aChainOfTwo()
    const read = places(host)
    // ⚑ Every link names the END, never the next link.
    expect(placeIn(read, worker).inItsPlace).toEqual(drawnOne(worker3))
    expect(placeIn(read, worker2).inItsPlace).toEqual(drawnOne(worker3))
    // ⛔ The middle link stands in for nobody: the one at the end stands in for them all.
    expect(placeIn(read, worker2).standsInFor).toEqual([])
    expect(placeIn(read, worker).standsInFor).toEqual([])
    expect(sortedIds(placeIn(read, worker3).standsInFor)).toEqual(
      sortedIds([drawnOne(worker), drawnOne(worker2)]),
    )
    expect(placeIn(read, worker3).inItsPlace).toBeNull()
    // ⚑ Paired: the parent that gave the work stands nowhere.
    expect(placeIn(read, pm)).toEqual(NOWHERE)
  })

  it('E · a restart: a second host on the same database reads the same places off the ledgers', async () => {
    const { pm, worker, label } = await aWorkerOver()
    issued.forgetAll()
    const sent = await callOn(host, pm, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })
    expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    const next = sent.went_to as string
    const beforeTheRestart = places(host)
    expect(placeIn(beforeTheRestart, worker).inItsPlace).toEqual(drawnOne(next))

    const again = await restart()
    const afterTheRestart = places(again)
    expect(placeIn(afterTheRestart, worker)).toEqual({
      standsInFor: [],
      inItsPlace: drawnOne(next),
    })
    expect(placeIn(afterTheRestart, next)).toEqual({
      standsInFor: [drawnOne(worker)],
      inItsPlace: null,
    })
    // ⚑ Paired: the pm stands nowhere on either host, and every conversation reads the same on both.
    expect(placeIn(afterTheRestart, pm)).toEqual(NOWHERE)
    expect(afterTheRestart).toEqual(beforeTheRestart)
  })

  it('E · a chain survives a restart: on a second host both links still name the end, and the end both links', async () => {
    const { worker, worker2, worker3 } = await aChainOfTwo()
    const again = await restart()
    const read = places(again)
    expect(placeIn(read, worker).inItsPlace).toEqual(drawnOne(worker3))
    expect(placeIn(read, worker2)).toEqual({ standsInFor: [], inItsPlace: drawnOne(worker3) })
    expect(sortedIds(placeIn(read, worker3).standsInFor)).toEqual(
      sortedIds([drawnOne(worker), drawnOne(worker2)]),
    )
    expect(placeIn(read, worker3).inItsPlace).toBeNull()
  })

  it('F · a hand-edited loop of three names no stand-in, so no conversation is hidden behind another', async () => {
    const [a, b, c] = await stoppedConversations(['pm', 'worker', 'lead'])
    if (a === undefined || b === undefined || c === undefined)
      throw new Error('three conversations')
    // ⚑ Paired: before the hand edit, nobody stands anywhere.
    for (const id of [a, b, c]) expect(placeIn(places(host), id), id).toEqual(NOWHERE)
    // A loop of three, written straight into the ledgers: a → b → c → a.
    handWrites(a, b)
    handWrites(b, c)
    handWrites(c, a)
    const again = await restart()
    const read = places(again)
    for (const id of [a, b, c]) expect(placeIn(read, id), id).toEqual(NOWHERE)
  })

  it('F · the same hand edit WITHOUT the loop names the end, and a chain that runs into a loop names none', async () => {
    const [a, b, c, d] = await stoppedConversations(['pm', 'worker', 'lead', 'worker'])
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error('four conversations')
    }
    // ⚑ a → b → c ends at c: the loop guard is what silences the loop above, not the hand edit.
    handWrites(a, b)
    handWrites(b, c)
    const ended = places(await restart())
    expect(placeIn(ended, a)).toEqual({ standsInFor: [], inItsPlace: drawnOne(c) })
    expect(placeIn(ended, b)).toEqual({ standsInFor: [], inItsPlace: drawnOne(c) })
    expect(sortedIds(placeIn(ended, c).standsInFor)).toEqual(sortedIds([drawnOne(a), drawnOne(b)]))
    expect(placeIn(ended, c).inItsPlace).toBeNull()
    expect(placeIn(ended, d)).toEqual(NOWHERE)

    // ⛔ c → a closes the loop, and d → a runs into it: none of the four names a stand-in now.
    handWrites(c, a)
    handWrites(d, a)
    const looped = places(await restart())
    for (const id of [a, b, c, d]) expect(placeIn(looped, id), id).toEqual(NOWHERE)
  })
})
