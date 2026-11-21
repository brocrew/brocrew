import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import { deferred } from '../../../packages/runtime/test/fixtures/plugin-readiness'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { readProfileExecution, writeProfileExecution } from '../src/main/profile-execution-file'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  fixtureProviderConfig,
  neutralHostDeps,
  RecordingSink,
  syntheticProviderHome,
} from './lib/host-fixture'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

function app() {
  const folder = mkdtempSync(join(tmpdir(), 'compaction-history-'))
  const db = openDatabase(join(folder, 'app.sqlite'))
  applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
  const store = createSessionStore(db)
  const sessions = new FakeProviderSessions()
  const gate = deferred<void>()
  const handles: FakeSessionHandle[] = []
  let compactions = 0
  let serial = 0
  const decorate = (handle: FakeSessionHandle) => {
    handle.compact = async () => {
      compactions++
      await gate.promise
    }
    handles.push(handle)
    return handle
  }
  class Runtime extends FakeRuntime {
    override async start(...args: Parameters<FakeRuntime['start']>) {
      return decorate(await super.start(...args))
    }
    override async resume(...args: Parameters<FakeRuntime['resume']>) {
      return decorate(await super.resume(...args))
    }
  }
  const hosts: RuntimeHost[] = []
  const makeHost = () => {
    const host = new RuntimeHost({
      store,
      profileExecution: {
        read: () => readProfileExecution(db),
        write: (kept) => writeProfileExecution(db, kept),
        owned: true,
      },
      ...neutralHostDeps(() => folder),
      createRuntime: (provider) => new Runtime(provider, { sessions }),
      prepareProviderHome: syntheticProviderHome(() => folder),
      providerHomePath: (provider) => join(folder, 'homes', provider),
      resolveCwd: () => folder,
      readProviderConfig: fixtureProviderConfig,
      newSessionId: () => `history_${++serial}`,
    })
    hosts.push(host)
    return host
  }
  cleanups.push(async () => {
    gate.resolve()
    for (const host of hosts) await host.closeAll()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })
  const sink = new RecordingSink('webContents:1')
  return { store, makeHost, sink, handles, compactions: () => compactions }
}

async function settled(read: () => boolean) {
  await vi.waitFor(() => expect(read()).toBe(true))
}

describe('queued compaction uses the conversation history', () => {
  it('accepts a never-started service without a row, mailbox entry or provider start', async () => {
    const rig = app()
    const host = rig.makeHost()
    host.createAgent({ slug: 'service', displayName: null, provider: 'codex', asAService: true })
    const target = rig.store.servicesBorn()[0]!.conversation
    expect(await host.compactConversation({ conversation: target, agent: target })).toMatchObject({
      ok: true,
      empty: true,
    })
    expect(rig.handles).toEqual([])
    expect(rig.store.messagesWaitingIn(target)).toEqual([])
    expect(rig.store.events(target).some((row) => row.event.type === 'pending_compaction')).toBe(
      false,
    )
  })

  it('reads only the current life and retains the first actor and reason on repeats', async () => {
    const rig = app()
    const host = rig.makeHost()
    const { sessionId: target } = await host.createSession(
      { provider: 'codex', approvalMode: 'auto' },
      rig.sink,
    )
    await host.close(target, rig.sink)
    for (let n = 0; n < 1000; n++) {
      rig.store.append(
        target,
        rig.store.nextOrdinal(target),
        { type: 'titled', title: `Plan ${n}`, author: { kind: 'person' } },
        Date.now(),
      )
    }
    await host.reopenForAPerson(target, rig.sink, null)
    await host.close(target, rig.sink)
    const floor = rig.store.newestOfType!(target, 'launched')!.ordinal
    expect(floor).toBeGreaterThan(1000)
    const newest = vi.spyOn(rig.store, 'newestOfType')
    const request = { conversation: target, agent: target, reason: 'The first plan' }
    expect(await host.compactConversation(request)).toMatchObject({ ok: true, queued: true })
    expect(await host.compactConversation({ ...request, reason: 'A replacement' })).toMatchObject({
      ok: true,
      queued: true,
    })
    expect(newest.mock.calls.filter((args) => args[1] === 'pending_compaction')).toEqual([
      [target, 'pending_compaction', undefined, floor],
      [target, 'pending_compaction', undefined, floor],
    ])
    expect(
      rig.store
        .events(target)
        .filter((row) => row.event.type === 'pending_compaction')
        .map((row) => row.event),
    ).toEqual([
      { type: 'pending_compaction', request: { agent: target, reason: 'The first plan' } },
    ])
  })

  it('consumes the request before confirmation, so ending that life never retries it', async () => {
    const rig = app()
    let host = rig.makeHost()
    const { sessionId: target } = await host.createSession(
      { provider: 'codex', approvalMode: 'auto' },
      rig.sink,
    )
    await host.close(target, rig.sink)
    await host.compactConversation({ conversation: target, agent: target })
    await host.reopenForAPerson(target, rig.sink, null)
    await settled(() => rig.compactions() === 1)
    expect(rig.store.newestOfType!(target, 'pending_compaction')!.event).toEqual({
      type: 'pending_compaction',
      request: null,
    })
    await host.closeAll()
    host = rig.makeHost()
    await host.reopenForAPerson(target, rig.sink, null)
    await host.send(target, 'The next ordinary input', rig.sink)
    expect(rig.compactions()).toBe(1)
    expect(
      rig.store
        .events(target)
        .some(
          (row) =>
            row.event.type === 'message_queued' &&
            row.event.appNotice === 'a-conversation-was-compacted',
        ),
    ).toBe(false)
  })

  it('logs a failed consume write and releases input without claiming compaction', async () => {
    const rig = app()
    const host = rig.makeHost()
    const { sessionId: target } = await host.createSession(
      { provider: 'codex', approvalMode: 'auto' },
      rig.sink,
    )
    await host.close(target, rig.sink)
    await host.compactConversation({ conversation: target, agent: target })
    const append = rig.store.append.bind(rig.store)
    vi.spyOn(rig.store, 'append').mockImplementation((id, ordinal, event, at) => {
      if (event.type === 'pending_compaction' && event.request === null)
        throw new Error('consume write failed')
      append(id, ordinal, event, at)
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await host.reopenForAPerson(target, rig.sink, null)
    await host.send(target, 'Proceed without compaction', rig.sink)
    expect(rig.compactions()).toBe(0)
    expect(warn.mock.calls.flat().join('\n')).toContain('consume write failed')
    expect(
      rig.store
        .events(target)
        .some(
          (row) =>
            row.event.type === 'user_turn' && row.event.text === 'Proceed without compaction',
        ),
    ).toBe(true)
  })
})
