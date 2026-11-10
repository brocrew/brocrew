import { waitFor } from './lib/f093-host'
import { syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { WebContents } from 'electron'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { webContentsSink } from '../src/main/runtime/ipc'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { conversationList } from '../src/renderer/src/lib/conversation-list'
import { createSessionStore as createRendererStore } from '../src/renderer/src/lib/session-store'
import type { SessionStore as RendererStore } from '../src/renderer/src/lib/session-store'
import {
  type ResumableSessionInfo,
  type RuntimeBridge,
  type UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'
import { DemoWindow } from './lib/demo-runtime-window'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * Two conversations of one agent, as a person meets them: the chain from the provider through the
 * host, the real IPC boundary and the renderer store to the rail's own fold, with only the provider
 * doubled.
 */

/** A `FakeRuntime` per launch over one shared session ledger — the shape a resume needs. */
function sharedRuntime(provider: Provider, sessions: FakeProviderSessions): FakeRuntime {
  return new FakeRuntime(provider, { sessions })
}

/** A promise somebody else resolves. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

/**
 * A handle that announces its ending and then keeps tearing down until the gate opens. A Proxy,
 * because the Fake's state lives in fields its own methods mutate.
 */
function holdingItsClose(handle: SessionHandle, gate: Promise<void>): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          await target.close()
          await gate
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

describe('two sessions of one agent', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  /** Null unless a test asks for one; a suite-wide gate would park every close. */
  let closeGate: { promise: Promise<void>; release: () => void } | null
  let windowA: DemoWindow
  let storeA: RendererStore
  let bridgeA: RuntimeBridge
  let sinkA: RuntimeEventSink

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-two-sessions-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-two-sessions-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 2_000_000
    ledger = createSessionStore(db, tick)
    sessions = new FakeProviderSessions()
    counter = 0
    closeGate = null
    host = new RuntimeHost({
      store: ledger,
      ...neutralHostDeps(() => userData),
      // Use the provider requested by the reproduction, allowing `codex` rather than
      // substituting the harness’s preference.
      createRuntime: (provider: Provider) => {
        const runtime = sharedRuntime(provider, sessions)
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          const handle = await start(opts)
          const gate = closeGate
          return (gate === null ? handle : holdingItsClose(handle, gate.promise)) as never
        }
        return runtime
      },
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      // One test parks a teardown on purpose; keep the drain short.
      closeDrainTimeoutMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    windowA = new DemoWindow(1)
    bridgeA = windowA.bridge(host)
    storeA = createRendererStore(bridgeA)
    // One sink for the window, so its owner id is the one closeSessionsForOwner is asked about.
    sinkA = webContentsSink(windowA as unknown as WebContents)
  })

  afterEach(async () => {
    // Released first, or closeAll waits on a gate nobody opens.
    closeGate?.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  /**
   * A conversation a person opened in this window. A give starts the child in its giver's mode:
   * in auto its brief's turn ends at once, in ask it parks on the Fake's card.
   */
  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'codex', profileId, cwd: work, approvalMode },
      sinkA,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, sinkA)
  }

  /** The toolset one session is offered, called the way a provider would call it. */
  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    return async (name: ToolName, args: Record<string, unknown>) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return answered.structured as Record<string, unknown>
    }
  }

  /** A give from parent to worker, through the real tool. */
  const gives = async (parent: string, title = 'x'): Promise<Record<string, unknown>> => {
    const given = await toolsOf(parent)('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title,
      brief: title,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return given
  }

  /** The child a give started, idle once its brief's turn is over. */
  const anIdleChildOf = async (parent: string, title = 'x'): Promise<string> => {
    const child = (await gives(parent, title)).agent as string
    await waitFor(
      () =>
        ledger.events(child).some((one) => one.event.type === 'turn') &&
        host.unclaimedSessions().some((one) => one.sessionId === child) &&
        ledger.find(child)?.status === 'idle',
      'the brief’s turn to end',
    )
    return child
  }

  /** The child a give started, parked on its brief's card. */
  const aParkedChildOf = async (parent: string, title = 'one'): Promise<string> => {
    const child = (await gives(parent, title)).agent as string
    await waitFor(
      () => ledger.events(child).some((one) => one.event.type === 'permission_request'),
      'the brief’s turn to park on its card',
    )
    return child
  }

  /** The rail's own two lists, through the real IPC boundary. */
  const railLists = async (): Promise<{
    resumable: ResumableSessionInfo[]
    unresumable: UnresumableSessionInfo[]
  }> => {
    const [resumable, unresumable] = await Promise.all([
      bridgeA.listResumable(),
      bridgeA.listUnresumable(),
    ])
    return { resumable, unresumable }
  }

  /** The rail's one list, minus the conversations this window is fed. */
  const railList = async () => {
    const { resumable, unresumable } = await railLists()
    const fed = new Set(storeA.live.value.map((record) => record.sessionId))
    return conversationList({ resumable, unresumable }).filter((row) => !fed.has(row.sessionId))
  }

  describe('what the rail says about a conversation an agent started', () => {
    it('a LIVE agent-started conversation is a row of the one list, and says nothing is over', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()

      const child = await anIdleChildOf(parent, 'do the thing')

      expect(host.sessionIds).toContain(child)
      expect(ledger.find(child)?.status).not.toBe('ended')

      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(child)
      expect(host.unclaimedSessions()).toMatchObject([{ sessionId: child, running: true }])

      const rail = await railList()
      const row = rail.find((one) => one.sessionId === child)
      expect(row).toBeDefined()

      expect(row!.state).toEqual({ is: 'idle' })
      expect(row).not.toHaveProperty('running')
      expect(row!.inAnotherWindow).toBe(false)

      expect(rail.map((one) => one.sessionId)).not.toContain(parent)
      const { resumable, unresumable } = await railLists()
      expect(
        conversationList({ resumable, unresumable }).find((one) => one.sessionId === parent)
          ?.inAnotherWindow,
      ).toBe(true)

      const over = await personOpens('worker')
      await host.close(over, sinkA)
      const ended = (await railList()).find((one) => one.sessionId === over)
      expect(ended).toBeDefined()
      expect(ended!.state).toEqual({ is: 'idle' })
      expect(ended!.inAnotherWindow).toBe(false)
    })

    it('the wire carries what the app is DOING with the row, and the fold reads it', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()
      const child = await anIdleChildOf(parent)

      const { resumable } = await railLists()
      const row = resumable.find((one) => one.sessionId === child)
      expect(row).toBeDefined()
      expect(row!.profileId).toBe('worker')
      expect(row!.running).toBe('unwatched')

      const neverRan = 'sess_never_ran'
      ledger.create({
        id: neverRan,
        provider: 'codex',
        cwd: work,
        approvalMode: 'ask',
        profileId: 'worker',
      })
      const stale = (await railLists()).unresumable.find((one) => one.sessionId === neverRan)
      expect(stale).toBeDefined()
      expect(stale!.status).toBe(row!.status)
      expect(stale!.status).toBe('idle')
      expect(stale!.running).toBe('not-running')

      const rail = await railList()
      for (const id of [child, neverRan]) {
        const listed = rail.find((one) => one.sessionId === id)
        expect(listed, `${id} is not in the one list`).toBeDefined()
        expect(listed).not.toHaveProperty('running')
        expect(listed!.inAnotherWindow).toBe(false)
      }

      const ended = await personOpens('other-one')
      await bridgeA.close({ sessionId: ended })
      const dead = (await railList()).find((one) => one.sessionId === ended)
      expect(dead).toBeDefined()
      expect(dead!.state).toEqual({ is: 'idle' })
      expect(ledger.find(ended)?.status).toBe('ended')
    })
  })

  describe('what pressing that row does', () => {
    it('the reopen is no longer offered — and when it is asked for, the sentence is true', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()
      const child = await anIdleChildOf(parent)

      const opened = await storeA.resume(child)
      expect(opened).toBeNull()
      expect(storeA.resumeError.value).toBe(
        'No window holds this conversation, so nothing was done to it. Take it over by pressing its row, then send to it or answer it.',
      )

      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(child)
      expect(storeA.resumeError.value).not.toContain('another window')

      const windowB = new DemoWindow(2)
      const sinkB = webContentsSink(windowB as unknown as WebContents)
      const theirs = await host.createSession(
        { provider: 'codex', profileId: 'other-one', cwd: work, approvalMode: 'ask' },
        sinkB,
      )
      await expect(host.resumeSession(theirs.sessionId, sinkA)).rejects.toThrow(
        /already open in another window/,
      )

      const rail = await railList()
      expect(rail.find((one) => one.sessionId === child)?.inAnotherWindow).toBe(false)
      expect(rail.find((one) => one.sessionId === theirs.sessionId)?.inAnotherWindow).toBe(true)
    })

    it('the rail’s press takes the stream and removes the conversation from the unclaimed list', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()
      const child = await anIdleChildOf(parent)

      const before = (await railList()).find((one) => one.sessionId === child)
      expect(before?.inAnotherWindow).toBe(false)
      expect(await storeA.look(child)).toBe(child)
      expect(storeA.live.value.map((one) => one.sessionId)).toContain(child)
      expect(host.unclaimedSessions().map((one) => one.sessionId)).not.toContain(child)

      const rail = await railList()
      expect(rail.map((one) => one.sessionId)).not.toContain(child)
      const seen = (await railLists()).resumable.find((one) => one.sessionId === child)
      expect(seen?.running).toBe('in-a-window')
    })
  })

  describe('the second give, and the conversation it reaches', () => {
    it('a PARENT’s second give to one agent goes to the SAME conversation, held behind its turn', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const first = await aParkedChildOf(parent, 'one')

      const second = await gives(parent, 'two')
      expect(second.agent).toBe(first)
      expect(second.started).toBe(false)
      expect(second.delivery).toBe('held')
      expect(host.sessionIds.filter((id) => id !== parent)).toEqual([first])
      expect(ledger.piecesGivenBy(parent).map((one) => [one.owner, one.title])).toEqual([
        [first, 'one'],
        [first, 'two'],
      ])
    })

    it('a person’s conversation of that agent is never the one a give reaches', async () => {
      await bringIdentityIntoBeing('worker')

      const theirs = await personOpens('worker')

      const parent = await personOpens('pm')
      const call = toolsOf(parent)

      const mine = await aParkedChildOf(parent, 'mine')
      expect(mine).not.toBe(theirs)
      expect(host.sessionIds).toContain(theirs)
      expect(host.sessionIds).toContain(mine)

      const [piece] = ledger.piecesGivenBy(parent)
      const said = await call('message_agent', {
        agent: theirs,
        text: 'carry on with mine',
        kind: 'follow-up',
        piece: piece!.label,
      })
      expect(said).toMatchObject({ outcome: 'refused', rail: 'not-a-piece-you-gave' })
      expect(host.sessionIds).toContain(theirs)

      expect((await gives(parent, 'a second')).agent).toBe(mine)
      expect(
        await call('message_agent', {
          agent: mine,
          text: 'carry on with mine',
          kind: 'follow-up',
          piece: piece!.label,
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('the arrow can run the OTHER way: a CLOSING conversation is still the one a give finds', async () => {
      closeGate = deferred()
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const call = toolsOf(parent)
      const first = await aParkedChildOf(parent, 'one')
      const [one] = ledger.piecesGivenBy(parent)
      expect(
        await toolsOf(first)('reply_to_parent', {
          piece: one!.piece,
          outcome: 'done',
          summary: 'one is done',
        }),
      ).toMatchObject({ outcome: 'ok' })

      const ending = host.close(first, THE_APP_ITSELF)

      await waitFor(
        () => ledger.events(first).some((one) => one.event.type === 'status'),
        'the provider to announce its ending while the teardown is parked',
      )
      expect(host.sessionIds).toContain(first)

      const during = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'two',
        brief: 'two',
      })
      expect(during).toMatchObject({
        outcome: 'refused',
        rail: 'that-conversation-is-still-stopping',
        retryable: true,
        detail: { agent: first },
      })

      closeGate.release()
      await ending
      const afterTheStop = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'three',
        brief: 'three',
      })
      expect(afterTheStop).toMatchObject({ outcome: 'ok', agent: first, started: false })
    })
  })

  describe('one identity, many conversations, and the doors the lookup does not stand in', () => {
    it('two parents each get their own conversation of one identity', async () => {
      await bringIdentityIntoBeing('worker')

      const here = await personOpens('pm')
      const mineHere = await aParkedChildOf(here, 'the work here')

      const overThere = await personOpens('pm')
      const mineThere = await aParkedChildOf(overThere, 'the work over there')

      expect(mineThere).not.toBe(mineHere)
      expect(host.sessionIds).toContain(mineHere)
      expect(host.sessionIds).toContain(mineThere)

      expect((await gives(overThere, 'a second over there')).agent).toBe(mineThere)
    })

    it('and REOPENING one is ungated too — which is the person’s step 4, exactly', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')

      // Stop the first child, then reopen it. The app’s own close supplies the stop formerly
      // performed through `end_agent`.
      const first = await aParkedChildOf(parent, 'one')
      await host.close(first, THE_APP_ITSELF)
      expect(host.sessionIds).not.toContain(first)

      expect(await storeA.resume(first)).toBe(first)

      expect(host.sessionIds).toContain(first)
      const second = await toolsOf(parent)('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'two',
        brief: 'two',
      })
      expect(second).toMatchObject({
        outcome: 'ok',
        agent: first,
        stalled: [ledger.piecesGivenBy(parent)[0]?.label],
      })
      expect(host.sessionIds.filter((id) => id !== parent)).toEqual([first])
    })
  })

  describe('what ends a live conversation, and what the ledger says about who did', () => {
    /** The ledger's event kinds for one session, in order. */
    const kinds = (sessionId: string): string[] =>
      ledger.events(sessionId).map((one) => one.event.type)

    it('a person’s close is recorded as the person’s command, not an interruption', async () => {
      await bringIdentityIntoBeing('other')
      const byPerson = await personOpens('other')
      await bridgeA.close({ sessionId: byPerson })
      expect(kinds(byPerson)).toContain('user_command')
      expect(kinds(byPerson)).not.toContain('work_interrupted')
      expect(ledger.find(byPerson)?.status).toBe('ended')
    })

    it('the ONE ending nobody asked for: the window that STARTED a conversation going away', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      const child = await anIdleChildOf(parent)
      expect(await storeA.claim(child)).toBe(true)

      windowA.destroy()
      await host.closeSessionsForOwner('webContents:1')

      expect(host.sessionIds).not.toContain(parent)
      expect(ledger.find(parent)?.status).toBe('ended')
      expect(kinds(parent)).not.toContain('work_interrupted')
      expect(kinds(parent)).not.toContain('user_command')

      expect(host.sessionIds).toContain(child)
      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(child)
      expect(ledger.find(child)?.status).not.toBe('ended')
    })
  })
})
