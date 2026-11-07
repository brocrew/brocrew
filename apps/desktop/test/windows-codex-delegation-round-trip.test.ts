import { neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly ownerId = 'window:birch'
  readonly aPersonIsBehindIt = true
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('fictional delegation did not finish')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// Real host, tools, SQLite and delivery; only provider execution and exit proof are fictional.
describe('Windows-suite Codex delegation round trip', () => {
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: Window
  let proveExit: () => void
  let exit: Promise<void>
  let parentRef: string | undefined
  let parentStarts: number
  let parentResumes: number
  let holdExit: boolean

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'birch-delegation-'))
    db = openDatabase(join(root, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    window = new Window()
    exit = new Promise<void>((resolve) => {
      proveExit = resolve
    })
    parentRef = undefined
    parentStarts = 0
    parentResumes = 0
    holdExit = false
    const sessions = new FakeProviderSessions()
    class Runtime extends FakeRuntime {
      override async start(options: StartOptions): Promise<FakeSessionHandle> {
        const handle = await super.start(options)
        if (options.providerHome.includes('birch-lead')) {
          parentRef = handle.ref.sessionId
          parentStarts++
          if (holdExit) {
            return new Proxy(handle, {
              get(target, property) {
                if (property === 'awaitProcessExit') return () => exit
                const value = Reflect.get(target, property, target) as unknown
                return typeof value === 'function' ? value.bind(target) : value
              },
            })
          }
        }
        return handle
      }
      override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
        if (ref.sessionId === parentRef) parentResumes++
        return super.resume(ref, options)
      }
    }
    let next = 0
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => root),
      resourcesRoot: () => resourcesRoot(root),
      createRuntime: () => new Runtime('codex', { sessions }),
      prepareProviderHome: (_provider, profile = 'default') => {
        const home = join(root, 'homes', profile, 'codex')
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: () => join(root, 'homes'),
      resolveCwd: () => root,
      newSessionId: () => `sess_birch_${++next}`,
      closeDrainTimeoutMs: 20,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake-codex-a',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    proveExit()
    await host.closeAll()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  const open = async (profileId: string) =>
    (
      await host.createSession(
        {
          provider: 'codex',
          profileId,
          cwd: root,
          approvalMode: holdExit ? 'ask' : 'auto',
        },
        window,
      )
    ).sessionId

  const call = async (id: string, name: ToolName, args: Record<string, unknown>) => {
    const tool = agentToolsFor(host, id).tools.find((one) => one.name === name)!
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const give = async (parent: string, profile: string) => {
    const given = await call(parent, 'give_work', {
      profile,
      title: `Read ${profile}`,
      brief: `Read the made-up ${profile} note`,
      definition_of_done: 'Return the fictional finding.',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { helper: given.agent as string, piece: given.piece as string }
  }

  const finish = async (work: { helper: string; piece: string }, summary: string) => {
    const answer = await call(work.helper, 'reply_to_parent', {
      piece: work.piece,
      outcome: 'done',
      summary,
    })
    expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
    return answer
  }

  const replies = (id: string) =>
    store.events(id).flatMap(({ event }) => {
      if (event.type !== 'user_turn') return []
      return ['Alder result', 'Cedar result'].filter((text) => event.text.includes(text))
    })

  const family = async () => {
    for (const name of ['alder-helper', 'cedar-helper']) {
      const identity = await open(name)
      await host.close(identity, window)
    }
    const parent = await open('birch-lead')
    const alder = await give(parent, 'alder-helper')
    const cedar = await give(parent, 'cedar-helper')
    return { parent, alder, cedar }
  }

  it('parent gives work to two helpers, reads both replies, and continues', async () => {
    const { parent, alder, cedar } = await family()
    await finish(alder, 'Alder result')
    await finish(cedar, 'Cedar result')
    await until(() => replies(parent).length === 2)
    expect(replies(parent)).toEqual(['Alder result', 'Cedar result'])
    await until(() => store.find(parent)?.status === 'idle')
    await host.send(parent, 'Continue with both findings', window)
    await until(() =>
      store
        .events(parent)
        .some(
          ({ event }) => event.type === 'user_turn' && event.text === 'Continue with both findings',
        ),
    )
    expect(replies(parent)).toEqual(['Alder result', 'Cedar result'])
  })

  it('keeps a missed-job notice for the next start without waking a stopped parent', async () => {
    holdExit = true
    const parent = await open('birch-lead')
    await host.close(parent, window)
    const holding = host as unknown as {
      holdUntilItStarts(id: string, text: string, facts: { appNotice: string }): void
    }
    holding.holdUntilItStarts(parent, 'A fictional missed job', {
      appNotice: 'a-scheduled-job-that-will-not-run',
    })
    proveExit()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(parentResumes).toBe(0)
    expect(host.sessionIds).not.toContain(parent)
    expect(store.messagesWaitingIn(parent)).toHaveLength(1)
  })

  it('late replies cannot launch a second provider and wake once after exit proof', async () => {
    holdExit = true
    const { parent, alder, cedar } = await family()
    await host.close(parent, window)
    expect(store.messagesWaitingIn(parent)).toHaveLength(0)
    expect(host.sessionIds).not.toContain(parent)
    expect(parentStarts).toBe(1)
    const manual = host.resumeSession(parent, window, 'manual-parent-reopen')
    let settled = false
    void manual.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled).toBe(false)
    expect(parentResumes).toBe(0)
    expect(await host.cancelLaunch('manual-parent-reopen', window.ownerId)).toBe(true)
    await expect(manual).rejects.toMatchObject({ cause: { unavailable: 'cancelled' } })
    let firstSettled = false
    const first = finish(alder, 'Alder result')
    void first.then(
      () => {
        firstSettled = true
      },
      () => {
        firstSettled = true
      },
    )
    let secondSettled = false
    const second = finish(cedar, 'Cedar result')
    void second.then(
      () => {
        secondSettled = true
      },
      () => {
        secondSettled = true
      },
    )
    for (const work of [alder, cedar]) {
      await until(() =>
        store.events(work.helper).some(({ event }) => {
          return event.type === 'work_replied' && event.piece === work.piece
        }),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)
    expect(replies(parent)).toEqual([])
    expect(host.sessionIds).not.toContain(parent)
    expect(parentStarts).toBe(1)
    expect(parentResumes).toBe(0)

    proveExit()
    const [firstReceipt, secondReceipt] = await Promise.all([first, second])
    expect(firstReceipt.delivered).toBe('sent')
    expect(secondReceipt.delivered).toBe('held')
    expect(parentStarts).toBe(1)
    expect(parentResumes).toBe(1)
    expect(replies(parent)).toEqual(['Alder result'])
    const held = store
      .events(parent)
      .map(({ event }) => event)
      .filter((event) => event.type === 'message_queued' && event.text.includes('Cedar result'))
    expect(held).toHaveLength(1)
    const queued = held[0]
    if (queued?.type !== 'message_queued') throw new Error('the second reply was not recorded')
    expect(store.messagesWaitingIn(parent).map((row) => row.messageId)).toEqual([queued.messageId])

    await until(() => store.events(parent).some(({ event }) => event.type === 'permission_request'))
    const request = store
      .events(parent)
      .map(({ event }) => event)
      .reverse()
      .find((event) => event.type === 'permission_request')
    if (request?.type !== 'permission_request') throw new Error('the fictional parent has no card')
    await host.respondPermission(parent, request.id, { outcome: 'allow' }, window)
    await until(() => replies(parent).length === 2)
    expect(replies(parent)).toEqual(['Alder result', 'Cedar result'])
    await until(() =>
      store.events(parent).some(({ event }) => {
        return event.type === 'permission_request' && event.id !== request.id
      }),
    )
    const nextRequest = store
      .events(parent)
      .map(({ event }) => event)
      .reverse()
      .find((event) => event.type === 'permission_request' && event.id !== request.id)
    if (nextRequest?.type !== 'permission_request')
      throw new Error('the fictional parent has no second card')
    expect(nextRequest.id).not.toBe(request.id)
    await host.respondPermission(parent, nextRequest.id, { outcome: 'allow' }, window)
    await until(() => store.find(parent)?.status === 'idle')
    expect(store.messagesWaitingIn(parent)).toHaveLength(0)
    expect(
      store
        .events(parent)
        .map(({ event }) => event)
        .filter(
          (event) => event.type === 'message_unqueued' && event.messageId === queued.messageId,
        ),
    ).toEqual([expect.objectContaining({ reason: 'sent' })])
    await host.send(parent, 'Continue after retirement', window)
    expect(store.messagesWaitingIn(parent)).toHaveLength(0)
    expect(replies(parent)).toEqual(['Alder result', 'Cedar result'])
    expect(parentStarts).toBe(1)
    expect(parentResumes).toBe(1)
  })
})
