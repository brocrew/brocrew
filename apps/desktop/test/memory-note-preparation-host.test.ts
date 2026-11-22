import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import { codexAdHocNotesDir } from '@brobot2/runtime/codex'
import {
  createSessionStore,
  NULL_SESSION_STORE,
  type SessionStore,
} from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { deferred } from './helpers/quit-open-list-cases'
import {
  fixtureFolder,
  fixtureDatabase,
  closeHostFixture,
  numberedFixtureHostPaths,
  ObservedProviderLaunches,
  RecordingSink,
  waitFor,
} from './lib/host-fixture'

const observation = vi.hoisted(() => ({
  before: async (): Promise<void> => {},
  after: async (): Promise<void> => {},
}))
vi.mock('../src/main/runtime/memory-notes', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/main/runtime/memory-notes')>()
  return {
    ...original,
    noteNamesInAsync: async (...args: Parameters<typeof original.noteNamesInAsync>) => {
      await observation.before()
      const names = await original.noteNamesInAsync(...args)
      await observation.after()
      return names
    },
  }
})

describe('note preparation before input admission', () => {
  let root: string
  let home: string
  let notes: string
  let host: RuntimeHost
  let sink: RecordingSink
  let handles: FakeSessionHandle[]
  let sessions: FakeProviderSessions
  let db: ReturnType<typeof fixtureDatabase> | undefined
  let release: (() => void) | undefined

  function buildHost(store: SessionStore = NULL_SESSION_STORE): RuntimeHost {
    return new RuntimeHost({
      store,
      ...numberedFixtureHostPaths(() => root, Date.now),
      prepareProviderHome: () => home,
      providerHomePath: () => home,
      createRuntime: (provider) =>
        new ObservedProviderLaunches(provider, sessions, (_kind, _options, handle) => {
          handles.push(handle)
        }),
    })
  }

  beforeEach(() => {
    root = fixtureFolder('brocrew-note-preparation-')
    home = join(root, 'provider-home')
    notes = codexAdHocNotesDir(home)
    mkdirSync(notes, { recursive: true })
    handles = []
    sessions = new FakeProviderSessions()
    db = undefined
    host = buildHost()
    sink = new RecordingSink('owner:note-preparation')
  })

  afterEach(async () => {
    release?.()
    observation.before = async () => {}
    observation.after = async () => {}
    vi.restoreAllMocks()
    if (db !== undefined) {
      await closeHostFixture(host, db, root)
      return
    }
    try {
      await host.closeAll()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function holdObservation(): Promise<void> {
    const entered = deferred()
    const held = deferred()
    release = () => held.resolve()
    observation.before = async () => {
      entered.resolve()
      await held.promise
    }
    return entered.promise
  }

  const turns = (): number => sink.messages.filter(({ event }) => event.type === 'user_turn').length

  async function finishTurn(sessionId: string, previousCards: number): Promise<void> {
    await waitFor(
      () =>
        sink.messages.filter(({ event }) => event.type === 'permission_request').length >
        previousCards,
      'the next permission',
    )
    const idleBefore = sink.messages.filter(
      ({ event }) => event.type === 'status' && event.state === 'idle',
    ).length
    const card = [...sink.messages]
      .reverse()
      .find(({ event }) => event.type === 'permission_request')!
    if (card.event.type !== 'permission_request') throw new Error('missing fixture card')
    await host.respondPermission(sessionId, card.event.id, { outcome: 'allow' }, sink)
    await waitFor(
      () =>
        sink.messages.filter(({ event }) => event.type === 'status' && event.state === 'idle')
          .length > idleBefore,
      'the turn ending',
    )
  }

  it('seeds registration without starting the provider while the listing is pending', async () => {
    const entered = holdObservation()
    const creating = host.createSession({ provider: 'codex' }, sink)
    await entered
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(handles).toHaveLength(0)
      expect(turns()).toBe(0)
    } finally {
      release?.()
    }
    await creating
    expect(handles).toHaveLength(1)
  })

  it('does not start a provider when quit cancels a pending registration listing', async () => {
    const entered = holdObservation()
    const creating = host.createSession({ provider: 'codex' }, sink)
    await entered
    const refused = expect(creating).rejects.toThrow()
    const closing = host.closeAll()
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(handles).toHaveLength(0)
    } finally {
      release?.()
    }
    await refused
    await closing
    expect(handles).toHaveLength(0)
  })

  it('prepares a recorded resume before invoking its provider', async () => {
    await host.closeAll()
    db = fixtureDatabase(root)
    host = buildHost(createSessionStore(db, Date.now))
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.close(created.sessionId, sink)
    const entered = holdObservation()
    const resuming = host.resumeSession(created.sessionId, sink)
    await entered
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(handles).toHaveLength(1)
    } finally {
      release?.()
    }
    await resuming
    expect(handles).toHaveLength(2)
  })

  it('refreshes a listing if another accepted turn runs and ends before admission', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    const listed = deferred()
    const held = deferred()
    release = () => held.resolve()
    let first = true
    observation.after = async () => {
      if (!first) return
      first = false
      listed.resolve()
      await held.promise
    }
    const earlier = host.send(created.sessionId, 'prepared first, admitted last', sink)
    await listed.promise
    try {
      await host.send(created.sessionId, 'admitted first', sink)
      await waitFor(
        () => sink.messages.some(({ event }) => event.type === 'permission_request'),
        'the intervening turn permission',
      )
      writeFileSync(join(notes, 'other-turn.md'), 'the intervening turn wrote this')
      await finishTurn(created.sessionId, 0)
      expect(sink.messages.filter(({ event }) => event.type === 'memory_note')).toHaveLength(1)
    } finally {
      release?.()
    }
    await earlier
    await finishTurn(created.sessionId, 1)
    expect(turns()).toBe(2)
    expect(sink.messages.filter(({ event }) => event.type === 'memory_note')).toHaveLength(1)
  })

  it.each(['direct', 'interrupting', 'plan', 'queued', 'grouped'] as const)(
    'prepares %s input without blocking main or recording input before acceptance',
    async (route) => {
      const created = await host.createSession(
        { provider: 'codex', ...(route === 'plan' ? { planMode: true } : {}) },
        sink,
      )
      if (route === 'interrupting' || route === 'queued' || route === 'grouped') {
        await host.send(created.sessionId, 'first turn', sink)
        await waitFor(
          () => sink.messages.some(({ event }) => event.type === 'permission_request'),
          'the first turn permission',
        )
      }
      if (route === 'queued' || route === 'grouped') {
        await host.queueMessage(created.sessionId, 'next turn', sink)
        if (route === 'grouped') {
          await host.queueMessage(created.sessionId, 'same next turn', sink)
        }
      }
      const before = turns()
      const handle = handles[0]!
      const send = handle.send.bind(handle)
      vi.spyOn(handle, 'send').mockImplementation(async (...args) => {
        await send(...args)
        writeFileSync(join(notes, 'during-input.md'), 'written after input acceptance')
      })
      const entered = holdObservation()
      const sending = (async () => {
        if (route === 'queued' || route === 'grouped') {
          const card = sink.messages.find(({ event }) => event.type === 'permission_request')!
          if (card.event.type !== 'permission_request') throw new Error('missing fixture card')
          await host.respondPermission(created.sessionId, card.event.id, { outcome: 'allow' }, sink)
        } else if (route === 'plan') {
          await host.endPlanMode(created.sessionId, sink, 'start the plan')
        } else if (route === 'interrupting') {
          await host.sendInterrupting(created.sessionId, 'start work', sink)
        } else {
          await host.send(created.sessionId, 'start work', sink)
        }
      })()
      await entered
      try {
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(turns()).toBe(before)
        expect(handle.status()).toBe('idle')
      } finally {
        release?.()
      }
      await sending
      await waitFor(() => turns() === before + 1, 'the accepted input row')
      await finishTurn(created.sessionId, before)
      await waitFor(
        () => sink.messages.some(({ event }) => event.type === 'memory_note'),
        'the note written after acceptance',
      )
      const note = sink.messages.find(({ event }) => event.type === 'memory_note')!.event
      expect(note.type === 'memory_note' && note.notes.map(({ path }) => path)).toEqual([
        join(notes, 'during-input.md'),
      ])
    },
  )
})
