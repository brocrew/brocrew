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

function sharedRuntime(provider: Provider, sessions: FakeProviderSessions): FakeRuntime {
  return new FakeRuntime(provider, { sessions })
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

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

describe('418 · two sessions of one agent', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let closeGate: { promise: Promise<void>; release: () => void } | null
  let windowA: DemoWindow
  let storeA: RendererStore
  let bridgeA: RuntimeBridge
  let sinkA: RuntimeEventSink

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-418-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-418-work-'))
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
    sinkA = webContentsSink(windowA as unknown as WebContents)
  })

  afterEach(async () => {
    closeGate?.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

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

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, sinkA)
  }

  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    return async (name: ToolName, args: Record<string, unknown>) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return answered.structured as Record<string, unknown>
    }
  }

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

  const aParkedChildOf = async (parent: string, title = 'one'): Promise<string> => {
    const child = (await gives(parent, title)).agent as string
    await waitFor(
      () => ledger.events(child).some((one) => one.event.type === 'permission_request'),
      'the brief’s turn to park on its card',
    )
    return child
  }

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

  const railList = async () => {
    const { resumable, unresumable } = await railLists()
    const fed = new Set(storeA.live.value.map((record) => record.sessionId))
    return conversationList({ resumable, unresumable }).filter((row) => !fed.has(row.sessionId))
  }

  describe('§1 · what the rail says about a conversation an agent started', () => {
    it('🔴 a LIVE agent-started conversation is a row of the one list, and says nothing is over', async () => {
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

    it('🔴 the wire carries what the app is DOING with the row, and the fold reads it', async () => {
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

  describe('§2 · what pressing that row does', () => {
    it('🔴 the reopen is no longer offered — and when it is asked for, the sentence is true', async () => {
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

  describe('§3 · the second give, and the conversation it reaches', () => {
    it('🔴 a PARENT’s second give to one agent goes to the SAME conversation, held behind its turn', async () => {
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

    it('⚑ 428 · a PERSON’s conversation of that agent is never the one a give reaches — and is still not this caller’s', async () => {
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

    it('⛔ a STOP opens no second conversation either — the give goes to the one it stopped', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const first = await aParkedChildOf(parent, 'one')
      const [one] = ledger.piecesGivenBy(parent)
      expect(
        await toolsOf(first)('reply_to_parent', {
          piece: one!.piece,
          outcome: 'done',
          summary: 'one is done',
        }),
      ).toMatchObject({ outcome: 'ok' })

      await host.close(first, THE_APP_ITSELF)
      expect(host.sessionIds).not.toContain(first)

      const retried = await toolsOf(parent)('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'two',
        brief: 'two',
      })
      expect(retried).toMatchObject({ outcome: 'ok', agent: first, started: false })
      expect(host.sessionIds.filter((id) => id !== parent)).toEqual([first])
    })

    it('🔴 the arrow can run the OTHER way: a CLOSING conversation is still the one a give finds', async () => {
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

      const record = sessions.record.bind(sessions)
      let launches = 0
      sessions.record = (...args: Parameters<FakeProviderSessions['record']>) => {
        launches++
        record(...args)
      }
      const during = call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'two',
        brief: 'two',
      })
      let settled = false
      void during.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      try {
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(settled).toBe(false)
        expect(launches).toBe(0)
        expect(host.sessionIds.filter((id) => id !== parent)).toEqual([first])
      } finally {
        closeGate.release()
        await ending
      }
      expect(await during).toMatchObject({ outcome: 'ok', agent: first, started: false })
      expect(launches).toBe(1)
      const afterTheStop = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'three',
        brief: 'three',
      })
      expect(afterTheStop).toMatchObject({ outcome: 'ok', agent: first, started: false })
    })
  })

  describe('§4 · one identity, many conversations, and the doors the lookup does not stand in', () => {
    it('⚑ 428 · two PARENTS each get their own conversation of one identity', async () => {
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

    it('⚑ a PERSON may open a second conversation of one identity — the lookup is an agent’s only', async () => {
      await bringIdentityIntoBeing('worker')

      const first = await personOpens('worker')
      const second = await personOpens('worker')
      expect(second).not.toBe(first)

      expect(host.sessionIds).toContain(first)
      expect(host.sessionIds).toContain(second)

      const parent = await personOpens('pm')
      const mine = await aParkedChildOf(parent, 'a third')
      expect([first, second]).not.toContain(mine)
      const again = (await gives(parent, 'a fourth')).agent
      expect(again).toBe(mine)
      expect([first, second]).not.toContain(again)
    })

    it('🔴 …and REOPENING one is ungated too — which is the person’s step 4, exactly', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')

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

  describe('§5 · what ends a live conversation, and what the ledger says about who did', () => {
    const kinds = (sessionId: string): string[] =>
      ledger.events(sessionId).map((one) => one.event.type)

    it('⛔ a second give to the same agent ends NOTHING — it is held for the one conversation', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const child = await aParkedChildOf(parent, 'one')
      const before = kinds(child)
      expect(before.length).toBeGreaterThan(0)

      expect((await gives(parent, 'two')).agent).toBe(child)

      expect(host.sessionIds).toContain(child)
      expect(ledger.find(child)?.status).not.toBe('ended')
      expect(kinds(child).slice(0, before.length)).toEqual(before)
      expect(kinds(child).slice(before.length).sort()).toEqual(['message_queued', 'work_given'])
      expect(kinds(child)).not.toContain('work_interrupted')
    })

    it('⛔ a REFUSED reopen of a live child ends nothing either', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      const child = await anIdleChildOf(parent)
      await waitFor(
        () =>
          ledger
            .reconciliationReceiptsForOwner(child)
            .some((row) => row.step === 'giver' && row.outcome === 'delivered'),
        'the existing holder ladder to finish its giver delivery',
      )
      const before = kinds(child)
      expect(before.length).toBeGreaterThan(0)

      expect(await storeA.resume(child)).toBeNull()

      expect(host.sessionIds).toContain(child)
      expect(kinds(child)).toEqual(before)
    })

    it('🔴 when an AGENT ends a conversation the ledger names it, and a person’s close does not', async () => {
      await bringIdentityIntoBeing('other')
      const byPerson = await personOpens('other')
      await bridgeA.close({ sessionId: byPerson })
      expect(kinds(byPerson)).toContain('user_command')
      expect(kinds(byPerson)).not.toContain('work_interrupted')
      expect(ledger.find(byPerson)?.status).toBe('ended')
    })

    it('🔴 the ONE ending nobody asked for: the window that STARTED a conversation going away', async () => {
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
