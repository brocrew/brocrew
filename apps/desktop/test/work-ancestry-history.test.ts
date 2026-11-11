import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  FakeLaunchGate,
  FakeProviderSessions,
  type FakeSessionHandle,
  type StartOptions,
  type RuntimeEvent,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, NULL_SESSION_STORE } from '../src/main/db/session-store'
import {
  ancestrySeekSql,
  ancestryResetBeforeSql,
  ancestryResetsInPageSql,
} from '../src/main/db/work-ancestry-reader'
import { ANCESTRY_ACCESS } from '../src/main/db/work-ancestry-index'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  ancestryBranch,
  ancestryHostDeps,
  publishAncestryEvent,
  ResumingRuntime,
} from './lib/work-ancestry-fixture'
import {
  acceptEvent,
  createSessionRecord,
  openWindow,
  reopenAtLatest,
} from '../src/renderer/src/lib/session-record'
import { everyCard, type ToolItem } from '../src/renderer/src/lib/transcript'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { legacyConversation } from './fixtures/legacy-migration-data'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

it('adds identity seeks to an existing ledger, restores out-of-page ancestry, and bounds missing context', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'work-ancestry-upgrade-'))
  const prior = join(directory, 'prior')
  mkdirSync(join(prior, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
  const cut = journal.entries.findIndex((entry) => entry.tag === '0030_work_ancestry')
  expect(cut).toBeGreaterThan(0)
  const previous = { ...journal, entries: journal.entries.slice(0, cut) }
  for (const entry of previous.entries)
    copyFileSync(join(migrations, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`))
  writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify(previous))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  let host: RuntimeHost | undefined
  try {
    applyMigrations(db, prior)
    legacyConversation(db, {
      id: 's',
      provider: 'codex',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    const events: TranscriptEvent[] = [
      { type: 'user_turn', text: 'Earlier work' },
      ...ancestryBranch(),
      { type: 'sub_agent', agentId: 'grandchild', phase: 'ended', outcome: 'completed' },
      { type: 'user_turn', text: 'The visible page' },
      { type: 'tool_call', id: 'read', parentToolCallId: 'inner', name: 'Read', summary: 'notes' },
      {
        type: 'tool_result',
        id: 'read',
        parentToolCallId: 'inner',
        summary: 'kept result',
        ok: true,
      },
    ]
    const insert = db.prepare(
      'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
    )
    for (const [ordinal, event] of events.entries())
      insert.run(`row-${ordinal}`, 's', ordinal, event.type, JSON.stringify(event), 1000 + ordinal)
    const before = db.prepare('SELECT id,ordinal,payload FROM events ORDER BY ordinal').all()
    applyMigrations(db, migrations)
    expect(db.prepare('SELECT id,ordinal,payload FROM events ORDER BY ordinal').all()).toEqual(
      before,
    )
    for (const kind of ['tool', 'agent', 'dispatch'] as const) {
      const detail = (
        db
          .prepare(`EXPLAIN QUERY PLAN ${ancestrySeekSql(kind, 1)}`)
          .all(
            kind === 'tool' ? 'inner' : kind === 'agent' ? 'grandchild' : 'inner',
            's',
            0,
            's',
            0,
            -1,
            8,
          ) as { detail: string }[]
      )
        .map((row) => row.detail)
        .join('\n')
      expect(detail).toContain(`SEARCH events USING INDEX ${ANCESTRY_ACCESS[kind].index}`)
      expect(detail).not.toMatch(/SCAN (?:events|e)\b/)
      console.info('work-ancestry-index-plan', kind, detail)
    }
    for (const [sql, params] of [
      [ancestryResetBeforeSql, ['s', 0, 6]],
      [ancestryResetsInPageSql, ['s', 0, 6, 8]],
    ] as const) {
      const detail = (
        db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]
      )
        .map((row) => row.detail)
        .join('\n')
      expect(detail).toContain('events_kind_owner_idx')
      expect(detail).not.toMatch(/SCAN (?:events|e)\b/)
      console.info('work-ancestry-reset-index-plan', detail)
    }
    const store = createSessionStore(db)
    const window = store.turnWindow('s', { turns: 1, maxEvents: 3, before: 9 })
    expect(window.entries.map((row) => row.ordinal)).toEqual([6, 7, 8])
    const context = store.ancestryContext('s', window.entries, 8, 40)
    expect(context.truncated).toBe(false)
    expect(context.missing).toEqual([])
    expect(context.entries.map((row) => row.ordinal)).toEqual([1, 2, 3, 4, 5, 7])
    const limited = store.ancestryContext('s', window.entries, 8, 1)
    expect(limited.truncated).toBe(true)
    expect(limited.entries.map((row) => row.ordinal)).toEqual([4])
    const missing = store.ancestryContext(
      's',
      [
        {
          ordinal: 8,
          at: 1008,
          event: {
            type: 'tool_call',
            id: 'orphan',
            name: 'Read',
            summary: 'unknown',
            parentToolCallId: 'missing-dispatch',
          },
        },
      ],
      8,
      40,
    )
    expect(missing.missing).toContainEqual({ kind: 'dispatch', id: 'missing-dispatch' })
    expect(missing.truncated).toBe(false)
    host = new RuntimeHost({
      store,
      createRuntime: () => new FakeRuntime('codex'),
      ...ancestryHostDeps(directory),
      newSessionId: () => 'new-fictional',
    })
    const page = host.earlierHistory('s', 9, 1)
    expect(page.from).toBe(6)
    expect(page.workAncestry?.agents.find((agent) => agent.agentId === 'grandchild')).toMatchObject(
      { dispatch: 'inner', parentAgentId: 'child', complete: true },
    )
    const record = createSessionRecord('s')
    openWindow(record, page)
    for (const entry of page.entries) acceptEvent(record, { sessionId: 's', ...entry })
    const root = record.transcript.items.find(
      (row): row is ToolItem => row.kind === 'tool' && row.callId === 'outer',
    )!
    const child = root.subAgents![0]!
    expect(child.agentId).toBe('child')
    const inner = child.body.find((row) => row.kind === 'tool' && row.callId === 'inner')!
    const grandchild = inner.kind === 'tool' ? inner.subAgents?.[0] : undefined
    expect(grandchild?.agentId).toBe('grandchild')
    expect(grandchild?.running).toBe(false)
    expect(grandchild?.outcome).toBe('completed')
    expect(grandchild?.body).toEqual([
      {
        kind: 'tool',
        callId: 'read',
        name: 'Read',
        summary: 'notes',
        result: { summary: 'kept result', ok: true },
      },
    ])
    expect(everyCard(record.transcript).map((card) => card.agentId)).toEqual([
      'child',
      'grandchild',
    ])
  } finally {
    await host?.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('restores the off-page call when a bounded history page starts with a grandchild result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'work-ancestry-result-page-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  let host: RuntimeHost | undefined
  try {
    applyMigrations(db, migrations)
    legacyConversation(db, {
      id: 's',
      provider: 'codex',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    const store = createSessionStore(db)
    const events: TranscriptEvent[] = [
      ...ancestryBranch(),
      {
        type: 'tool_call',
        id: 'read',
        parentToolCallId: 'inner',
        name: 'Read',
        summary: 'earlier notes',
      },
      {
        type: 'tool_result',
        id: 'read',
        parentToolCallId: 'inner',
        summary: 'kept result',
        ok: true,
      },
    ]
    for (const [ordinal, event] of events.entries())
      store.append('s', ordinal, event, 1000 + ordinal)
    host = new RuntimeHost({
      store: {
        ...store,
        turnWindow: (id, options) => store.turnWindow(id, { ...options, maxEvents: 1 }),
      },
      createRuntime: () => new FakeRuntime('codex'),
      ...ancestryHostDeps(directory),
      newSessionId: () => 'new-fictional',
    })
    const page = host.latestHistory('s')
    expect(page.entries.map((row) => row.event)).toEqual([events[5]])
    expect(page.entries[0]!.ancestryContext?.map((row) => row.ordinal)).toEqual([0, 1, 2, 3, 4])
    expect(page.workAncestry?.tools).toContainEqual({ callId: 'read', agentId: 'grandchild' })
    expect(page.workAncestry?.missing).toEqual([])
    expect(page.workAncestry?.truncated).toBe(false)
    const record = createSessionRecord('s')
    openWindow(record, page)
    for (const entry of page.entries) acceptEvent(record, { sessionId: 's', ...entry })
    const child = everyCard(record.transcript).find((card) => card.agentId === 'child')!
    const grandchild = everyCard(record.transcript).find((card) => card.agentId === 'grandchild')!
    const inner = child.body.find((row) => row.kind === 'tool' && row.callId === 'inner')!
    expect(inner.kind === 'tool' && inner.subAgents?.[0]).toBe(grandchild)
    expect(grandchild.body).toEqual([
      {
        kind: 'tool',
        callId: 'read',
        name: 'Read',
        summary: 'earlier notes',
        result: { summary: 'kept result', ok: true },
      },
    ])
    expect(
      record.transcript.items.some((row) => row.kind === 'tool' && row.callId === 'read'),
    ).toBe(false)
  } finally {
    await host?.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('publishes the updated core relationship before delivery without a live context query', async () => {
  class Runtime extends FakeRuntime {
    handle!: FakeSessionHandle
    override async start(options: StartOptions): Promise<FakeSessionHandle> {
      this.handle = await super.start(options)
      return this.handle
    }
  }
  const directory = mkdtempSync(join(tmpdir(), 'work-ancestry-live-'))
  const runtime = new Runtime('codex')
  const ancestryContext = vi.fn(NULL_SESSION_STORE.ancestryContext)
  const host = new RuntimeHost({
    store: { ...NULL_SESSION_STORE, ancestryContext },
    createRuntime: () => runtime,
    ...ancestryHostDeps(directory),
    newSessionId: () => 'live-fictional',
  })
  const messages: RuntimeEventMessage[] = []
  let delivered!: () => void
  const last = new Promise<void>((resolve) => {
    delivered = resolve
  })
  try {
    await host.createSession(
      { provider: 'codex' },
      {
        ownerId: 'fictional-reader',
        alive: true,
        aPersonIsBehindIt: true,
        sendLiveness() {},
        send(message) {
          messages.push(message)
          if (message.event.type === 'sub_agent' && message.event.phase === 'ended') delivered()
        },
      },
    )
    runtime.handle.simulateSubAgent('late')
    runtime.handle.simulateSubAgent('late', 'started', { parentToolCallId: 'dispatch' })
    runtime.handle.simulateSubAgent('late', 'ended', { outcome: 'completed' })
    await last
    const work = messages.filter((message) => message.event.type === 'sub_agent')
    expect(work[0]?.workAncestry?.agents).toEqual([{ agentId: 'late', complete: false }])
    expect(work[1]?.workAncestry?.agents).toEqual([
      { agentId: 'late', dispatch: 'dispatch', complete: false },
    ])
    expect(work[2]?.workAncestry).toBeUndefined()
    expect(ancestryContext).not.toHaveBeenCalled()
  } finally {
    await host.closeAll()
    rmSync(directory, { recursive: true, force: true })
  }
})

async function resumeFixture(gate?: FakeLaunchGate) {
  const directory = mkdtempSync(join(tmpdir(), 'work-ancestry-resume-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  applyMigrations(db, migrations)
  const sessions = new FakeProviderSessions()
  const original = await new FakeRuntime('codex', { sessions }).start({
    cwd: directory,
    providerHome: directory,
    approvalMode: 'ask',
  })
  const ref = original.ref
  await original.close()
  legacyConversation(db, {
    id: 's',
    provider: 'codex',
    cwd: directory,
    approvalMode: 'ask',
    profileId: 'fictional',
  })
  db.prepare('UPDATE provider_session SET external_ref = ? WHERE id = ?').run(
    JSON.stringify(ref),
    's',
  )
  const real = createSessionStore(db)
  const prior: TranscriptEvent[] = [
    { type: 'tool_call', id: 'outer', name: 'Agent', summary: 'prior child dispatch' },
    { type: 'sub_agent', agentId: 'child', phase: 'started', parentToolCallId: 'outer' },
    {
      type: 'tool_call',
      id: 'inner',
      name: 'Agent',
      summary: 'prior grandchild dispatch',
      parentToolCallId: 'outer',
    },
  ]
  for (const [ordinal, event] of prior.entries()) real.append('s', ordinal, event, 1000 + ordinal)
  const turnWindow = vi.fn(real.turnWindow)
  const ancestryContext = vi.fn(real.ancestryContext)
  const runtime = new ResumingRuntime('codex', {
    sessions,
    ...(gate === undefined ? {} : { gate }),
  })
  const host = new RuntimeHost({
    store: { ...real, turnWindow, ancestryContext },
    createRuntime: () => runtime,
    ...ancestryHostDeps(directory),
    newSessionId: () => 'unused',
  })
  const messages: RuntimeEventMessage[] = []
  let delivered!: () => void
  const next = new Promise<void>((resolve) => {
    delivered = resolve
  })
  const sink: RuntimeEventSink = {
    ownerId: 'fictional-reader',
    alive: true,
    aPersonIsBehindIt: true,
    sendLiveness() {},
    send(message) {
      messages.push(message)
      if (message.event.type === 'sub_agent' && message.event.agentId === 'grandchild') delivered()
    },
  }
  return {
    host,
    runtime,
    turnWindow,
    ancestryContext,
    messages,
    next,
    sink,
    async close() {
      await host.closeAll()
      db.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

it('seeds a background resume once before live adoption without delivering historical rows', async () => {
  const world = await resumeFixture()
  try {
    const resumed = await world.host.resumeSession('s', world.sink, null, undefined, 'not-read')
    expect(resumed.history.entries).toEqual([])
    expect(world.turnWindow).toHaveBeenLastCalledWith(
      's',
      expect.objectContaining({ maxEvents: 2500 }),
    )
    expect(world.ancestryContext).toHaveBeenCalledTimes(1)
    expect(
      world.messages.some(
        (message) => message.event.type === 'tool_call' && message.event.id === 'outer',
      ),
    ).toBe(false)
    world.runtime.handle.simulateSubAgent('grandchild', 'started', { parentToolCallId: 'inner' })
    await world.next
    const live = world.messages.find(
      (message) => message.event.type === 'sub_agent' && message.event.agentId === 'grandchild',
    )!
    expect(live.workAncestry?.agents.find((agent) => agent.agentId === 'grandchild')).toEqual({
      agentId: 'grandchild',
      dispatch: 'inner',
      parentAgentId: 'child',
      complete: true,
    })
    expect(world.ancestryContext).toHaveBeenCalledTimes(1)
    const attached = world.host
      .attachOpenSessions(world.sink)
      .find((session) => session.sessionId === 's')!
    expect(
      attached.history.workAncestry?.agents.find((agent) => agent.agentId === 'grandchild'),
    ).toEqual(live.workAncestry?.agents.find((agent) => agent.agentId === 'grandchild'))
    expect(
      attached.history.workAncestry?.agents.find((agent) => agent.agentId === 'child'),
    ).toMatchObject({ dispatch: 'outer', complete: true })
    // The live tail changed: attach reads its new page/context once, then reuses that exact range.
    expect(world.ancestryContext).toHaveBeenCalledTimes(2)
    world.host.attachOpenSessions(world.sink)
    expect(world.ancestryContext).toHaveBeenCalledTimes(2)
  } finally {
    await world.close()
  }
})

it('does not retain a background seed in a failed or cancelled registration', async () => {
  const failed = await resumeFixture()
  try {
    failed.runtime.failure = new Error('fictional resume rejection')
    await expect(
      failed.host.resumeSession('s', failed.sink, null, undefined, 'not-read'),
    ).rejects.toThrow('fictional resume rejection')
    expect(failed.ancestryContext).toHaveBeenCalledTimes(1)
    expect(failed.host.sessionIds).toEqual([])
    expect(failed.host.attachOpenSessions(failed.sink)).toEqual([])
    expect(failed.messages.some((message) => message.workAncestry !== undefined)).toBe(false)
  } finally {
    await failed.close()
  }
  const gate = new FakeLaunchGate()
  const cancelled = await resumeFixture(gate)
  try {
    const result = cancelled.host.resumeSession(
      's',
      cancelled.sink,
      'fictional-launch',
      undefined,
      'not-read',
    )
    const settled = result.catch((error: unknown) => error)
    await cancelled.runtime.entered
    expect(cancelled.ancestryContext).toHaveBeenCalledTimes(1)
    expect(await cancelled.host.cancelLaunch('fictional-launch', cancelled.sink.ownerId)).toBe(true)
    expect(await settled).toBeInstanceOf(Error)
    expect(gate.held).toBe(0)
    expect(cancelled.host.sessionIds).toEqual([])
    expect(cancelled.host.attachOpenSessions(cancelled.sink)).toEqual([])
    expect(cancelled.messages.some((message) => message.workAncestry !== undefined)).toBe(false)
  } finally {
    gate.release()
    await cancelled.close()
  }
})

it('keeps missing and capped startup context explicit on pre-attach live updates', async () => {
  const world = await resumeFixture()
  try {
    const readWindow = world.turnWindow.getMockImplementation()!
    world.turnWindow.mockImplementation((...args) => {
      const page = readWindow(...args)
      return {
        ...page,
        entries: page.entries.filter(
          (row) => row.event.type === 'tool_call' && row.event.id === 'inner',
        ),
        from: 2,
        hasOlder: true,
      }
    })
    world.ancestryContext.mockReturnValue({
      epochs: [
        {
          after: -1,
          through: 2,
          entries: [],
          missing: [{ kind: 'dispatch', id: 'outer' }],
          truncated: true,
        },
      ],
      entries: [],
      missing: [{ kind: 'dispatch', id: 'outer' }],
      truncated: true,
    })
    await world.host.resumeSession('s', world.sink, null, undefined, 'not-read')
    world.runtime.handle.simulateSubAgent('grandchild', 'started', { parentToolCallId: 'inner' })
    await world.next
    const live = world.messages.find(
      (message) => message.event.type === 'sub_agent' && message.event.agentId === 'grandchild',
    )!
    expect(live.workAncestry?.truncated).toBe(true)
    expect(live.workAncestry?.missing).toEqual([{ kind: 'dispatch', id: 'outer' }])
    expect(live.workAncestry?.agents.find((agent) => agent.agentId === 'grandchild')).toEqual({
      agentId: 'grandchild',
      dispatch: 'inner',
      complete: false,
    })
    expect(world.turnWindow).toHaveBeenCalledTimes(1)
    expect(world.ancestryContext).toHaveBeenCalledTimes(1)
  } finally {
    await world.close()
  }
})

class StreamingRuntime extends FakeRuntime {
  constructor(private readonly queue: AsyncQueue<RuntimeEvent>) {
    super('codex')
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    const queue = this.queue
    return new Proxy(handle, {
      get(target, property) {
        if (property === 'events') return (): AsyncIterable<RuntimeEvent> => queue
        if (property === 'close')
          return async (): Promise<void> => {
            await target.close()
            queue.close()
          }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
}

it('delivers affected live facts through the host while preserving the adopted grandchild object and result', async () => {
  const queue = new AsyncQueue<RuntimeEvent>()
  const directory = mkdtempSync(join(tmpdir(), 'work-ancestry-live-adoption-'))
  const record = createSessionRecord('live-fictional')
  const messages: RuntimeEventMessage[] = []
  let received: ((message: RuntimeEventMessage) => void) | undefined
  const host = new RuntimeHost({
    store: NULL_SESSION_STORE,
    createRuntime: () => new StreamingRuntime(queue),
    ...ancestryHostDeps(directory),
    newSessionId: () => 'live-fictional',
  })
  const publish = (event: RuntimeEvent): Promise<void> =>
    publishAncestryEvent(queue, (listener) => (received = listener), event)
  try {
    await host.createSession(
      { provider: 'codex' },
      {
        ownerId: 'fictional-reader',
        alive: true,
        aPersonIsBehindIt: true,
        sendLiveness() {},
        send(message) {
          messages.push(message)
          acceptEvent(record, message)
          received?.(message)
        },
      },
    )
    await publish({ type: 'tool_call', id: 'outer', name: 'Agent', summary: 'outer dispatch' })
    await publish({
      type: 'tool_call',
      id: 'inner',
      parentToolCallId: 'outer',
      name: 'Agent',
      summary: 'inner dispatch',
    })
    await publish({
      type: 'sub_agent',
      agentId: 'grandchild',
      phase: 'started',
      parentToolCallId: 'inner',
    })
    const grandchild = everyCard(record.transcript).find((card) => card.agentId === 'grandchild')!
    await publish({
      type: 'tool_call',
      id: 'read',
      parentToolCallId: 'inner',
      name: 'Read',
      summary: 'notes',
    })
    await publish({
      type: 'tool_result',
      id: 'read',
      parentToolCallId: 'inner',
      ok: true,
      summary: 'kept result',
    })
    await publish({
      type: 'sub_agent',
      agentId: 'child',
      phase: 'started',
      parentToolCallId: 'outer',
    })
    const child = everyCard(record.transcript).find((card) => card.agentId === 'child')!
    const inner = child.body.find((row) => row.kind === 'tool' && row.callId === 'inner')!
    expect(inner.kind === 'tool' && inner.subAgents?.[0]).toBe(grandchild)
    expect(grandchild.body).toEqual([
      {
        kind: 'tool',
        callId: 'read',
        name: 'Read',
        summary: 'notes',
        result: { ok: true, summary: 'kept result' },
      },
    ])
    const update = messages.at(-1)!.workAncestry!
    expect(update.update).toBe(true)
    expect(update.agents.map((one) => one.agentId)).toEqual(['child', 'grandchild'])
    expect(update.tools).toEqual([{ callId: 'inner', agentId: 'child' }])
    expect(update.dispatches).toEqual([{ callId: 'outer', agentIds: ['child'] }])
    await publish({
      type: 'sub_agent',
      agentId: 'grandchild',
      phase: 'ended',
      outcome: 'completed',
    })
    expect(messages.at(-1)!.workAncestry).toBeUndefined()
    expect(everyCard(record.transcript).find((card) => card.agentId === 'grandchild')).toBe(
      grandchild,
    )
    expect(grandchild.outcome).toBe('completed')
  } finally {
    queue.close()
    await host.closeAll()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps reused provider IDs in their reset epoch for off-page and spanning history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'work-ancestry-reset-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  applyMigrations(db, migrations)
  const store = createSessionStore(db)
  const queue = new AsyncQueue<RuntimeEvent>()
  let cap = 100
  const host = new RuntimeHost({
    store: {
      ...store,
      turnWindow: (sessionId, options) =>
        store.turnWindow(sessionId, { ...options, maxEvents: cap }),
    },
    createRuntime: () => new StreamingRuntime(queue),
    ...ancestryHostDeps(directory),
    newSessionId: () => 'live-fictional',
  })
  const live = createSessionRecord('live-fictional')
  const messages: RuntimeEventMessage[] = []
  let received: ((message: RuntimeEventMessage) => void) | undefined
  const publish = (event: RuntimeEvent): Promise<void> =>
    publishAncestryEvent(queue, (listener) => (received = listener), event)
  try {
    const opened = await host.createSession(
      { provider: 'codex' },
      {
        ownerId: 'fictional-reader',
        alive: true,
        aPersonIsBehindIt: true,
        sendLiveness() {},
        send(message) {
          messages.push(message)
          acceptEvent(live, message)
          received?.(message)
        },
      },
    )
    await publish({ type: 'tool_call', id: 'outer', name: 'Agent', summary: 'old parent dispatch' })
    await publish({
      type: 'sub_agent',
      agentId: 'old-parent',
      phase: 'started',
      parentToolCallId: 'outer',
    })
    await publish({
      type: 'tool_call',
      id: 'd',
      name: 'Agent',
      summary: 'old child dispatch',
      parentToolCallId: 'outer',
    })
    await publish({ type: 'sub_agent', agentId: 'child', phase: 'started', parentToolCallId: 'd' })
    const oldChild = everyCard(live.transcript).find((card) => card.agentId === 'child')!
    await publish({
      type: 'conversation_reset',
      ref: { ...opened.ref!, sessionId: 'new-provider-life' },
      source: 'fake/clear',
    })
    const reset = messages.find((message) => message.event.type === 'conversation_reset')!
    await publish({ type: 'sub_agent', agentId: 'child', phase: 'started', parentToolCallId: 'd' })
    await publish({
      type: 'tool_call',
      id: 'read',
      name: 'Read',
      summary: 'current notes',
      parentToolCallId: 'd',
    })
    await publish({
      type: 'tool_result',
      id: 'read',
      ok: true,
      summary: 'current result',
      parentToolCallId: 'd',
    })
    const current = live.transcript.workAncestry.agents.get('child')!
    expect(current).toEqual({ agentId: 'child', dispatch: 'd', complete: false })
    expect(live.transcript.workAncestry.agents.has('old-parent')).toBe(false)
    const currentChild = everyCard(live.transcript)
      .filter((card) => card.agentId === 'child')
      .at(-1)!
    expect(currentChild).not.toBe(oldChild)
    expect(oldChild.body).toEqual([])
    expect(currentChild.body).toEqual([
      {
        kind: 'tool',
        callId: 'read',
        name: 'Read',
        summary: 'current notes',
        result: { ok: true, summary: 'current result' },
      },
    ])
    const before = db
      .prepare(
        'SELECT ordinal,payload,generation FROM events WHERE session_id = ? ORDER BY ordinal',
      )
      .all('live-fictional')
    cap = 3
    const page = host.latestHistory('live-fictional')
    expect(page.from).toBeGreaterThan(reset.ordinal)
    expect(page.entries.some((entry) => entry.event.type === 'conversation_reset')).toBe(false)
    const context = store.ancestryContext(
      'live-fictional',
      page.entries,
      page.entries.at(-1)!.ordinal,
      40,
    )
    expect(context.epochs.map((epoch) => epoch.after)).toEqual([reset.ordinal])
    expect(context.entries.every((entry) => entry.ordinal > reset.ordinal)).toBe(true)
    expect(context.missing).toContainEqual({ kind: 'tool', id: 'd' })
    expect(page.workAncestry?.agents).toEqual([current])
    const replay = createSessionRecord('live-fictional')
    openWindow(replay, page)
    for (const entry of page.entries) acceptEvent(replay, { sessionId: 'live-fictional', ...entry })
    expect(replay.transcript.workAncestry.agents.get('child')).toEqual(current)
    expect(everyCard(replay.transcript).map((card) => card.agentId)).toEqual(['child'])
    expect(everyCard(replay.transcript)[0]?.body).toEqual(currentChild.body)
    cap = 100
    const spanning = host.latestHistory('live-fictional')
    const resetEntry = spanning.entries.find((entry) => entry.ordinal === reset.ordinal)!
    expect(resetEntry.workAncestry?.reset).toBe(true)
    const span = createSessionRecord('live-fictional')
    openWindow(span, spanning)
    for (const entry of spanning.entries)
      acceptEvent(span, { sessionId: 'live-fictional', ...entry })
    const reused = everyCard(span.transcript).filter((card) => card.agentId === 'child')
    expect(reused).toHaveLength(2)
    expect(reused[0]).not.toBe(reused[1])
    expect(reused[0]?.body).toEqual([])
    expect(reused[1]?.body).toEqual(currentChild.body)
    expect(span.transcript.workAncestry.agents.get('child')).toEqual(current)
    expect(span.transcript.items.filter((item) => item.kind === 'reset')).toHaveLength(1)
    const tail = messages.slice(-2)
    const folded = foldWindow(tail, null, carryForward(live.transcript, tail))
    expect(everyCard(folded).map((card) => card.agentId)).toEqual(['child'])
    expect(everyCard(folded)[0]?.body).toEqual(currentChild.body)
    expect(folded.workAncestry.agents.get('child')).toEqual(current)
    expect(
      db
        .prepare(
          'SELECT ordinal,payload,generation FROM events WHERE session_id = ? ORDER BY ordinal',
        )
        .all('live-fictional'),
    ).toEqual(before)
  } finally {
    queue.close()
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('restores a quiet off-page child for a fresh attach and keeps its original object on latest-page reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'work-ancestry-quiet-attach-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  applyMigrations(db, migrations)
  const store = createSessionStore(db)
  const queue = new AsyncQueue<RuntimeEvent>()
  const host = new RuntimeHost({
    store: {
      ...store,
      turnWindow: (id, options) => store.turnWindow(id, { ...options, maxEvents: 3 }),
    },
    createRuntime: () => new StreamingRuntime(queue),
    ...ancestryHostDeps(directory),
    newSessionId: () => 'quiet-fictional',
  })
  const original = createSessionRecord('quiet-fictional')
  let fresh: ReturnType<typeof createSessionRecord> | undefined
  const messages: RuntimeEventMessage[] = []
  let received: ((message: RuntimeEventMessage) => void) | undefined
  const sink: RuntimeEventSink = {
    ownerId: 'fictional-reader',
    alive: true,
    aPersonIsBehindIt: true,
    sendLiveness() {},
    send(message) {
      messages.push(message)
      acceptEvent(original, message)
      if (fresh !== undefined) acceptEvent(fresh, message)
      received?.(message)
    },
  }
  const publish = (event: RuntimeEvent): Promise<void> =>
    publishAncestryEvent(queue, (listener) => (received = listener), event)
  try {
    await host.createSession({ provider: 'codex' }, sink)
    await publish({ type: 'tool_call', id: 'd', name: 'Agent', summary: 'quiet dispatch' })
    await publish({
      type: 'sub_agent',
      agentId: 'a',
      phase: 'started',
      parentToolCallId: 'd',
      title: 'Quiet child',
    })
    await publish({
      type: 'tool_call',
      id: 'old-read',
      parentToolCallId: 'd',
      name: 'Read',
      summary: 'earlier notes',
    })
    await publish({
      type: 'tool_result',
      id: 'old-read',
      parentToolCallId: 'd',
      ok: true,
      summary: 'original result',
    })
    await publish({ type: 'sub_agent', agentId: 'a', phase: 'ended', outcome: 'completed' })
    const child = everyCard(original.transcript).find((card) => card.agentId === 'a')!
    const oldResult = child.body[0]!
    await publish({ type: 'sub_agent', agentId: 'a', phase: 'progress', lastTool: 'Read' })
    expect(messages.at(-1)!.event).toMatchObject({
      type: 'sub_agent',
      phase: 'progress',
      lastTool: 'Read',
    })
    expect(messages.at(-1)!.workAncestry).toBeUndefined()
    expect(everyCard(original.transcript).find((card) => card.agentId === 'a')).toBe(child)
    expect(child.running).toBe(false)
    expect(child.outcome).toBe('completed')
    for (let index = 0; index < 5; index++)
      await publish({
        type: 'tool_call',
        id: `unrelated-${index}`,
        name: 'Read',
        summary: 'elsewhere',
      })
    const attached = host
      .attachOpenSessions(sink)
      .find((session) => session.sessionId === 'quiet-fictional')!
    const page = attached.history
    expect(page.entries).toHaveLength(3)
    expect(
      page.entries.every(
        (row) => row.event.type === 'tool_call' && row.event.id.startsWith('unrelated-'),
      ),
    ).toBe(true)
    expect(page.workAncestry?.agents).toEqual([])
    fresh = createSessionRecord('quiet-fictional')
    openWindow(fresh, page)
    for (const entry of page.entries) acceptEvent(fresh, { sessionId: 'quiet-fictional', ...entry })
    expect(everyCard(fresh.transcript)).toEqual([])
    reopenAtLatest(original, page)
    expect(everyCard(original.transcript).find((card) => card.agentId === 'a')).toBe(child)
    expect(child.body[0]).toBe(oldResult)
    expect(original.transcript.workAncestry.dispatches.get('d')?.agentIds).toEqual(['a'])
    await publish({
      type: 'tool_call',
      id: 't',
      parentToolCallId: 'd',
      name: 'Read',
      summary: 'later notes',
    })
    const receipt = messages.at(-1)!.workAncestry!
    expect(receipt.agents).toContainEqual({ agentId: 'a', dispatch: 'd', complete: true })
    expect(
      receipt.baseline?.some(
        (row) =>
          row.event.type === 'sub_agent' &&
          row.event.agentId === 'a' &&
          row.event.phase === 'ended',
      ),
    ).toBe(true)
    const freshChild = everyCard(fresh.transcript).find((card) => card.agentId === 'a')!
    expect(freshChild.title).toBe('Quiet child')
    expect(freshChild.running).toBe(false)
    expect(freshChild.outcome).toBe('completed')
    expect(freshChild.running).toBe(child.running)
    expect(freshChild.outcome).toBe(child.outcome)
    expect(freshChild.lastTool).toBe('Read')
    await publish({
      type: 'tool_result',
      id: 't',
      parentToolCallId: 'd',
      ok: true,
      summary: 'later result',
    })
    await publish({ type: 'sub_agent', agentId: 'a', phase: 'ended', outcome: 'completed' })
    expect(messages.at(-1)!.workAncestry).toBeUndefined()
    expect(everyCard(fresh.transcript).find((card) => card.agentId === 'a')).toBe(freshChild)
    expect(freshChild.body).toEqual([
      {
        kind: 'tool',
        callId: 't',
        name: 'Read',
        summary: 'later notes',
        result: { ok: true, summary: 'later result' },
      },
    ])
    expect(everyCard(original.transcript).find((card) => card.agentId === 'a')).toBe(child)
    expect(child.body[0]).toBe(oldResult)
    expect(child.body.at(-1)).toEqual(freshChild.body[0])
    expect(original.transcript.items.some((row) => row.kind === 'tool' && row.callId === 't')).toBe(
      false,
    )
    expect(fresh.transcript.items.some((row) => row.kind === 'tool' && row.callId === 't')).toBe(
      false,
    )
    for (let index = 5; index < 10; index++)
      await publish({
        type: 'tool_call',
        id: `unrelated-${index}`,
        name: 'Read',
        summary: 'elsewhere',
      })
    const terminalPage = host
      .attachOpenSessions(sink)
      .find((session) => session.sessionId === 'quiet-fictional')!.history
    fresh = createSessionRecord('quiet-fictional')
    openWindow(fresh, terminalPage)
    for (const entry of terminalPage.entries)
      acceptEvent(fresh, { sessionId: 'quiet-fictional', ...entry })
    await publish({ type: 'sub_agent', agentId: 'a', phase: 'ended', outcome: 'completed' })
    expect(messages.at(-1)!.workAncestry?.agents).toContainEqual({
      agentId: 'a',
      dispatch: 'd',
      complete: true,
    })
    expect(everyCard(fresh.transcript).find((card) => card.agentId === 'a')).toMatchObject({
      title: 'Quiet child',
      running: false,
      outcome: 'completed',
      body: [],
    })
  } finally {
    queue.close()
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
