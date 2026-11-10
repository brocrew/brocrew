import { fixtureProviderConfig, RecordingSink, neutralHostDeps } from './lib/host-fixture'

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { TranscriptEvent } from '../src/shared/conversation-events'

import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A real host over a real SQLite ledger, with the runtime the group chooses, and the helpers every
 * group that mounts one reaches for. Torn down by {@link Mounted.dispose}.
 */
interface Mounted {
  readonly host: RuntimeHost
  readonly store: SessionStore
  readonly window: RecordingSink
  readonly root: string
  readonly issued: FakeProviderSessions
  events(sessionId: string): TranscriptEvent[]
  personOpens(profileId: string, approvalMode?: 'ask' | 'auto'): Promise<string>
  callOn(
    caller: string,
    name: ToolName,
    args?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  giveAChild(
    pm: string,
    profile: string,
    brief: string,
    title?: string,
  ): Promise<{ child: string; piece: string; label: string }>
  cardsOn(sessionId: string): number
  dispose(): Promise<void>
}

const mount = (
  tag: string,
  clockStart: number,
  makeRuntime: (provider: Provider, issued: FakeProviderSessions) => FakeRuntime,
): Mounted => {
  const userData = mkdtempSync(join(tmpdir(), `brobot2-${tag}-`))
  const root = mkdtempSync(join(tmpdir(), `brobot2-${tag}-root-`))
  const db: AppDatabase = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  let clock = clockStart
  const tick = (): number => clock++
  const store = createSessionStore(db, tick)
  let counter = 0
  const issued = new FakeProviderSessions()
  const host = new RuntimeHost({
    store,
    ...neutralHostDeps(() => userData),
    createRuntime: (provider: Provider) => makeRuntime(provider, issued),
    prepareProviderHome: (provider: Provider, profileId?: string) => {
      const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_${++counter}`,
    now: tick,
    readProviderConfig: fixtureProviderConfig,
  })
  const window = new RecordingSink('webContents:1')
  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }
  return {
    host,
    store,
    window,
    root,
    issued,
    events,
    callOn,
    async personOpens(profileId, approvalMode = 'auto') {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId, approvalMode, cwd: root },
        window,
      )
      return sessionId
    },
    async giveAChild(pm, profile, brief, title = `The ${profile}`) {
      const given = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title,
        brief,
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      return {
        child: given.agent as string,
        piece: given.piece as string,
        label: given.label as string,
      }
    },
    cardsOn: (sessionId) =>
      events(sessionId).filter((event) => event.type === 'permission_request').length,
    async dispose() {
      await host.closeAll()
      db.close()
      for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
    },
  }
}

const plainFake = (provider: Provider, issued: FakeProviderSessions): FakeRuntime =>
  new FakeRuntime(provider, { sessions: issued })

describe('the Work tab row carries the piece’s title', () => {
  let rig: Mounted

  beforeEach(() => {
    rig = mount('508', 5_080_000, plainFake)
  })

  afterEach(async () => {
    await rig.dispose()
  })

  it('the Work tab row carries the piece’s title, never its brief', async () => {
    const { store, personOpens, giveAChild } = rig
    // The identities a give names have to exist first.
    await rig.host.close(await personOpens('worker', 'ask'), rig.window)
    await rig.host.close(await personOpens('other', 'ask'), rig.window)
    const pm = await personOpens('pm', 'ask')

    const brief = 'a long first line\nand a second line of detail'
    const first = await giveAChild(pm, 'worker', brief, 'short name')
    // The paired positive: a piece whose title IS its brief still reads back that title, whole.
    const same = await giveAChild(
      pm,
      'other',
      'read the brief and report',
      'read the brief and report',
    )

    const rows = store.workGivenOutBy(pm).rows
    const row = rows.find((one) => one.piece === first.piece)
    const sameRow = rows.find((one) => one.piece === same.piece)
    expect(rows).toHaveLength(2)
    if (row === undefined || sameRow === undefined) throw new Error('the Work walk lost a row')

    expect(sameRow.title).toBe('read the brief and report')
    expect(row.title).toBe('short name')
    expect(JSON.stringify(row)).not.toContain('second line of detail')
    expect(JSON.stringify(row)).not.toContain('a long first line')
  })
})

describe('a question is routed by the task edge, not the spawn edge', () => {
  let rig: Mounted

  beforeEach(() => {
    rig = mount('437', 4_370_000, plainFake)
  })

  afterEach(async () => {
    await rig.dispose()
  })

  /** A person's pm, and one worker of it parked mid-turn on the piece it was given. */
  const aPmAndItsParkedWorker = async (): Promise<{
    pm: string
    worker: string
    piece: string
  }> => {
    const { host, window, personOpens, giveAChild, cardsOn } = rig
    await host.close(await personOpens('worker', 'ask'), window)
    const pm = await personOpens('pm', 'ask')
    const { child: worker, piece } = await giveAChild(pm, 'worker', 'migrate the schema')
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker) > 0, 'the worker to park mid-turn')
    return { pm, worker, piece }
  }

  /** The worker asks its parent, and the ledger's routing of THAT question (a card is routed too). */
  const theWorkerAsks = async (
    worker: string,
    piece: string,
  ): Promise<{ requestId: string; routed: TranscriptEvent[] }> => {
    const asked = await rig.callOn(worker, 'ask_question', {
      who_answers: 'the-parent',
      piece,
      question: 'which one?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const requestId = asked.question as string
    const routed = rig
      .events(worker)
      .filter((event) => event.type === 'request_routed' && event.requestId === requestId)
    return { requestId, routed }
  }

  const waitingOn = (parent: string, requestId: string): boolean =>
    rig.host.questionsWaitingOn(parent).some((row) => row.request.requestId === requestId)

  it('after the giver is replaced the ledger names the replacement, not the dead predecessor', async () => {
    const { host, store, window, events } = rig
    const { pm, worker, piece } = await aPmAndItsParkedWorker()

    // The giver's provider forgets it, and a person's message wakes it: R10 replaces it.
    await host.close(pm, window)
    rig.issued.forgetAll()
    await host.send(pm, 'carry on', window)
    const replaced = events(pm).find((event) => event.type === 'replaced_by')
    if (replaced === undefined || replaced.type !== 'replaced_by') {
      throw new Error('the giver was not replaced')
    }
    const next = replaced.sessionId

    // The premise, before the question: the spawn edge still names the dead one, and a
    // replacement stands in its place.
    expect(next).not.toBe(pm)
    expect(store.parentOf(worker)).toBe(pm)

    const { requestId, routed } = await theWorkerAsks(worker, piece)
    expect(routed).toHaveLength(1)
    expect(routed[0]).toMatchObject({ type: 'request_routed', to: 'the-parent', parent: next })
    expect(waitingOn(next, requestId)).toBe(true)
    expect(waitingOn(pm, requestId)).toBe(false)
  })

  it('with no replacement the same question is routed to the giver the worker was given by', async () => {
    const { store } = rig
    const { pm, worker, piece } = await aPmAndItsParkedWorker()

    expect(store.parentOf(worker)).toBe(pm)
    expect(rig.events(pm).some((event) => event.type === 'replaced_by')).toBe(false)

    const { requestId, routed } = await theWorkerAsks(worker, piece)
    expect(routed).toHaveLength(1)
    expect(routed[0]).toMatchObject({ type: 'request_routed', to: 'the-parent', parent: pm })
    expect(waitingOn(pm, requestId)).toBe(true)
  })
})
