import { expect, it, vi } from 'vitest'
import { F093World, waitFor } from './lib/f093-host'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import {
  recordFacets,
  stateHere,
  stateForRecord,
  standingOf,
} from '../src/renderer/src/lib/agent-state'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import type { AgentState } from '../src/shared/agent-state-contracts'
import type { RuntimeEventMessage, RuntimeStatesMessage } from '../src/shared/runtime-ipc'
import type { ClientSessionApi } from '../src/shared/client-session-api'
import type { PublicationEpoch } from '../src/shared/data-version'

it('carries the actual host state through the live store, including an equal-state flush', async () => {
  const world = new F093World()
  const messages: RuntimeEventMessage[] = []
  const states: RuntimeStatesMessage[] = []
  let receive: ((message: RuntimeEventMessage) => void) | undefined
  const host = world.buildHost(false, {
    statesMoved(message) {
      states.push(message)
      client?.hearProviderStates(message)
    },
  })
  const sink = {
    ownerId: 'fictional-window',
    aPersonIsBehindIt: true,
    alive: true,
    send(message: RuntimeEventMessage) {
      messages.push(message)
      receive?.(message)
    },
    sendLiveness() {},
  }
  const bridge: Partial<ClientSessionApi> = {
    currentEpoch: async () => host.currentEpoch(),
    listConversations: () => host.listConversations(),
    attachOpen: async () => [],
    createSession: (input) => host.createSession(input, sink),
    onEvent(listener) {
      receive = listener
      return () => {
        receive = undefined
      }
    },
    onLiveness: () => () => {},
  }
  const client = createSessionStore(bridge as ClientSessionApi)
  try {
    const id = await client.create({ provider: 'claude', cwd: world.project, approvalMode: 'auto' })
    expect(id).not.toBeNull()
    const record = client.get(id!)!
    await waitFor(() => record.agentState?.is === 'idle', 'initial canonical state')
    const stale = await host.listConversations()
    expect('refused' in stale).toBe(false)
    const handle = world.end.newest().handle
    const beforeMessages = messages.length
    handle.simulateBackgroundWork({ running: [{ id: 'fern-job', description: 'Fictional job' }] })
    await waitFor(() => record.agentState?.is === 'in-the-background', 'background state')
    expect(messages.slice(beforeMessages).some((row) => row.agentState === null)).toBe(true)
    expect(
      stateForRecord(record, () => {
        throw new Error('client state must not run')
      }),
    ).toEqual({ is: 'in-the-background', what: 'Fictional job' })

    // A conflicting local activity/status cannot promote the core's background state to active.
    record.control.status = 'working'
    expect(recordFacets(record)).toMatchObject({ doing: 'idle', detached: true })
    record.control.status = 'idle'
    const beforeStates = states.length
    handle.simulateBackgroundWork({ running: [{ id: 'fern-job', description: 'Fictional job' }] })
    await waitFor(() => states.length > beforeStates, 'equal state republished after invalidation')
    expect(record.agentState).toEqual({ is: 'in-the-background', what: 'Fictional job' })

    // A list composed before the fresh stream cannot overwrite the newer canonical reading.
    if (!('refused' in stale)) {
      const row = [...stale.resumable, ...stale.unresumable].find((one) => one.sessionId === id)!
      client.hearProviderStates({
        moved: [{ conversation: id!, state: row.state }],
        kept: [],
        published: stale.published,
      })
      expect(record.agentState?.is).toBe('in-the-background')
    }
    expect(
      messages.every((row, index) => index === 0 || row.ordinal >= messages[index - 1]!.ordinal),
    ).toBe(true)
    handle.simulateBackgroundWork({ running: [] })
    await waitFor(() => record.agentState?.is === 'idle', 'cleared background state')
    const rosterReads = vi.spyOn(world.store, 'agentIdentities')
    const beforeActivity = messages.length
    for (let index = 0; index < 10; index++) handle.simulateActivity('thinking')
    await waitFor(() => messages.length >= beforeActivity + 10, 'clean streaming frames')
    expect(rosterReads).not.toHaveBeenCalled()
    expect(messages.slice(beforeActivity).every((row) => row.agentState?.is === 'idle')).toBe(true)
    rosterReads.mockRestore()
    const beforeReset = states.length
    handle.simulateConversationReset()
    await waitFor(() => states.length > beforeReset, 'state after native reset')
    expect(record.agentState?.is).toBe('idle')
    expect(
      [...messages].reverse().find((row) => row.event.type === 'conversation_reset'),
    ).toHaveProperty('workAncestry')
  } finally {
    client.dispose()
    await world.dispose()
  }
})

it.each<AgentState>([
  { is: 'needs-you' },
  { is: 'active' },
  { is: 'waiting-on-an-answer', from: 'Fern, owner of W1', since: 11 },
  { is: 'owes-an-answer', to: ['Willow, owner of W2'], since: 12 },
  { is: 'in-the-background', what: 'Fictional command' },
  { is: 'scheduled', dueAt: null },
  {
    is: 'waiting-on-a-worker',
    on: ['Willow, owner of W2'],
    stopped: [{ label: 'W3', holder: 'Willow, owner of W2', at: 13 }],
  },
  { is: 'idle' },
])('keeps the core state and names despite a conflicting partial local history: %j', (state) => {
  const record = createSessionRecord('fern')
  record.phase = 'recorded'
  record.window.hasOlder = true
  record.control.status = 'working'
  record.control.pending = { permissions: 2, questions: 1 }
  record.agentState = state
  const legacy = vi.fn((): AgentState => ({ is: 'needs-you' }))
  expect(stateForRecord(record, legacy)).toBe(state)
  expect(legacy).not.toHaveBeenCalled()
  const expected =
    state.is === 'active'
      ? 'working'
      : state.is === 'needs-you'
        ? 'waiting'
        : state.is === 'idle'
          ? 'idle'
          : state.is === 'waiting-on-an-answer' || state.is === 'waiting-on-a-worker'
            ? 'elsewhere'
            : state.is === 'owes-an-answer'
              ? 'owes'
              : state.is === 'in-the-background'
                ? 'background'
                : 'scheduled'
  expect(standingOf(recordFacets(record))).toBe(expected)
})

it('leaves older optional envelopes and an un-fed partial history on their existing path', () => {
  const record = createSessionRecord('legacy')
  record.window.hasOlder = true
  record.control.schedule = { jobs: [{ id: 'later', nominalAt: 1 }], dropped: 0, left: [] }
  const legacy = vi.fn(() => stateHere(record, { doing: 'idle' }, null, []))
  expect(stateForRecord(record, legacy)).toEqual({ is: 'scheduled', dueAt: null })
  expect(legacy).toHaveBeenCalledOnce()
  expect(record).not.toHaveProperty('agentState')
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

function liveStateWorld() {
  const world = new F093World()
  const states: RuntimeStatesMessage[] = []
  let receive: ((message: RuntimeEventMessage) => void) | undefined
  let client: ReturnType<typeof createSessionStore> | undefined
  let refusePush = false
  const host = world.buildHost(false, {
    statesMoved(message) {
      if (refusePush) throw new Error('Fictional window delivery failed')
      states.push(message)
      client?.hearProviderStates(message)
    },
  })
  const sink = {
    ownerId: 'recovery-window',
    aPersonIsBehindIt: true,
    alive: true,
    send(message: RuntimeEventMessage) {
      receive?.(message)
    },
    sendLiveness() {},
  }
  const epoch = vi.fn(async () => host.currentEpoch())
  const listing = vi.fn(() => host.listConversations())
  const bridge: Partial<ClientSessionApi> = {
    currentEpoch: epoch,
    listConversations: listing,
    attachOpen: async () => [],
    createSession: (input) => host.createSession(input, sink),
    close: ({ sessionId }) => host.close(sessionId, sink),
    resume: ({ sessionId, launchKey }) => host.resumeSession(sessionId, sink, launchKey),
    onEvent(listener) {
      receive = listener
      return () => {
        receive = undefined
      }
    },
    onLiveness: () => () => {},
  }
  return {
    world,
    host,
    states,
    sink,
    epoch,
    listing,
    connect() {
      client = createSessionStore(bridge as ClientSessionApi)
      return client
    },
    refusePush(value: boolean) {
      refusePush = value
    },
  }
}

it.each(['read', 'publication'] as const)(
  'recovers a failed host %s through a later successful listing without another provider event',
  async (failure) => {
    const fixture = liveStateWorld()
    const client = fixture.connect()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let restoreRoster: (() => void) | undefined
    try {
      const id = await client.create({
        provider: 'claude',
        cwd: fixture.world.project,
        approvalMode: 'auto',
      })
      const record = client.get(id!)!
      await waitFor(() => record.agentState?.is === 'idle', 'initial canonical state')
      if (failure === 'read') {
        const roster = vi.spyOn(fixture.world.store, 'agentIdentities').mockImplementation(() => {
          throw new Error('Fictional roster read failed')
        })
        restoreRoster = () => roster.mockRestore()
      } else fixture.refusePush(true)
      fixture.world.end.newest().handle.simulateBackgroundWork({
        running: [{ id: 'fern', description: 'Fictional recovery work' }],
      })
      if (failure === 'publication') {
        // Keep a successful listing before the failed push, so recovery must also work from cache.
        const listing = await fixture.host.listConversations()
        expect('refused' in listing).toBe(false)
      }
      await waitFor(
        () =>
          warn.mock.calls.some((call) =>
            String(call[0]).includes(
              failure === 'read' ? 'could not say what its agents' : 'could not tell the windows',
            ),
          ),
        'failed host flush',
      )
      expect(record.agentState).toBeNull()
      restoreRoster?.()
      restoreRoster = undefined
      fixture.refusePush(false)
      const before = fixture.states.length
      const answer = await fixture.host.listConversations()
      expect('refused' in answer).toBe(false)
      await waitFor(() => fixture.states.length > before, 'recovery publication')
      expect(record.agentState).toEqual({
        is: 'in-the-background',
        what: 'Fictional recovery work',
      })
      const reads = vi.spyOn(fixture.world.store, 'agentIdentities')
      fixture.world.end.newest().handle.simulateActivity('thinking')
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(reads).not.toHaveBeenCalled()
      expect(record.agentState?.is).toBe('in-the-background')
      reads.mockRestore()
    } finally {
      restoreRoster?.()
      warn.mockRestore()
      client.dispose()
      await fixture.world.dispose()
    }
  },
)

it.each(['epoch', 'listing'] as const)(
  'recovers an initial failed %s read on a later host publication and retains transcript delivery',
  async (failure) => {
    const fixture = liveStateWorld()
    const { sessionId: id } = await fixture.host.createSession(
      { provider: 'claude', cwd: fixture.world.project, approvalMode: 'auto' },
      fixture.sink,
    )
    fixture.world.end.newest().handle.simulateBackgroundWork({ running: [] })
    await waitFor(
      () =>
        fixture.states.some((message) =>
          message.moved.some((row) => row.conversation === id && row.state.is === 'idle'),
        ),
      'host initial state',
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    if (failure === 'epoch')
      fixture.epoch.mockRejectedValueOnce(new Error('Fictional epoch failure'))
    else fixture.listing.mockRejectedValueOnce(new Error('Fictional listing failure'))
    const client = fixture.connect()
    try {
      await waitFor(() => warn.mock.calls.length > 0, 'initial read failure')
      const handle = fixture.world.end.newest().handle
      const reads = fixture.epoch.mock.calls.length
      handle.simulateActivity('thinking')
      await new Promise<void>((resolve) => setImmediate(resolve))
      const record = client.get(id)!
      expect(fixture.epoch).toHaveBeenCalledTimes(reads)
      expect(record.earlyEvents.some((message) => message.event.type === 'activity')).toBe(true)
      if (failure === 'epoch') expect(record.agentState).toBeNull()
      const retry = deferred<PublicationEpoch>()
      if (failure === 'epoch') fixture.epoch.mockImplementationOnce(() => retry.promise)
      handle.simulateBackgroundWork({ running: [{ id: 'fern', description: 'Later work' }] })
      await waitFor(
        () =>
          fixture.states.some((message) =>
            message.moved.some(
              (row) => row.conversation === id && row.state.is === 'in-the-background',
            ),
          ),
        'later publication',
      )
      if (failure === 'epoch') {
        expect(record.agentState).toBeNull()
        handle.simulateBackgroundWork({ running: [{ id: 'fern', description: 'Newest work' }] })
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(fixture.epoch).toHaveBeenCalledTimes(reads + 1)
        retry.resolve(fixture.host.currentEpoch())
      }
      await waitFor(() => record.agentState?.is === 'in-the-background', 'canonical recovery')
      expect(record.agentState).toEqual({
        is: 'in-the-background',
        what: failure === 'epoch' ? 'Newest work' : 'Later work',
      })
      expect(record.earlyEvents.length).toBeGreaterThan(0)
    } finally {
      warn.mockRestore()
      client.dispose()
      await fixture.world.dispose()
    }
  },
)

it('recovers a failed reconnect handshake on adoption after an actual close and reopen', async () => {
  const fixture = liveStateWorld()
  const client = fixture.connect()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const id = await client.create({
      provider: 'claude',
      cwd: fixture.world.project,
      approvalMode: 'auto',
    })
    await waitFor(() => client.get(id!)?.agentState?.is === 'idle', 'initial state')
    expect(await client.close(id!)).toBe(true)
    expect(client.get(id!)?.phase).toBe('recorded')
    const reads = fixture.epoch.mock.calls.length
    fixture.epoch.mockRejectedValueOnce(new Error('Fictional reconnect epoch failure'))
    expect(await client.resume(id!)).toBe(id)
    await waitFor(() => fixture.epoch.mock.calls.length === reads + 2, 'adoption retries handshake')
    await waitFor(() => client.get(id!)?.agentState?.is === 'idle', 'reopened canonical state')
    const record = client.get(id!)!
    const accepted = record.agentStatePublication!
    client.hearProviderStates({
      moved: [{ conversation: id!, state: { is: 'needs-you' } }],
      kept: [],
      published: { ...accepted, seq: accepted.seq - 1 },
    })
    client.hearProviderStates({
      moved: [{ conversation: id!, state: { is: 'needs-you' } }],
      kept: [],
      published: { epoch: { run: 'retired-run', n: 0 }, seq: accepted.seq + 100 },
    })
    expect(record.agentState?.is).toBe('idle')
  } finally {
    warn.mockRestore()
    client.dispose()
    await fixture.world.dispose()
  }
})

it('disposes a publication-triggered retry without reading a listing or reviving its records', async () => {
  const fixture = liveStateWorld()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  fixture.epoch.mockRejectedValueOnce(new Error('Fictional initial epoch failure'))
  const client = fixture.connect()
  try {
    await waitFor(() => warn.mock.calls.length > 0, 'failed initial handshake')
    const retry = deferred<PublicationEpoch>()
    fixture.epoch.mockImplementationOnce(() => retry.promise)
    const { sessionId: id } = await fixture.host.createSession(
      { provider: 'claude', cwd: fixture.world.project, approvalMode: 'auto' },
      fixture.sink,
    )
    await waitFor(() => fixture.epoch.mock.calls.length === 2, 'publication-triggered retry')
    const reads = fixture.listing.mock.calls.length
    client.dispose()
    retry.resolve(fixture.host.currentEpoch())
    await retry.promise
    await new Promise<void>((resolve) => setImmediate(resolve))
    const message = fixture.states.at(-1)!
    client.hearProviderStates(message)
    expect(fixture.epoch).toHaveBeenCalledTimes(2)
    expect(fixture.listing).toHaveBeenCalledTimes(reads)
    expect(client.get(id)).toBeNull()
  } finally {
    warn.mockRestore()
    client.dispose()
    await fixture.world.dispose()
  }
})

it('keeps content while the epoch is unconfirmed, and disposes a delayed handshake', async () => {
  const epoch = deferred<PublicationEpoch>()
  let receive!: (message: RuntimeEventMessage) => void
  const list = vi.fn(async () => ({
    resumable: [],
    unresumable: [],
    published: {
      epoch: { run: 'fern', n: 0 },
      seq: 2,
      covers: { population: 'listing' as const, complete: true as const },
    },
  }))
  const bridge: Partial<ClientSessionApi> = {
    currentEpoch: () => epoch.promise,
    listConversations: list,
    attachOpen: async () => [],
    onEvent(listener) {
      receive = listener
      return () => {}
    },
    onLiveness: () => () => {},
  }
  const client = createSessionStore(bridge as ClientSessionApi)
  const event: RuntimeEventMessage = {
    sessionId: 'fern',
    ordinal: 0,
    at: 17,
    event: { type: 'assistant_delta', text: 'Keep this content' },
    agentState: { is: 'active' },
    published: { epoch: { run: 'fern', n: 0 }, seq: 1 },
  }
  receive(event)
  const record = client.get('fern')!
  expect(record.agentState).toBeNull()
  expect(stateForRecord(record, () => ({ is: 'idle' }))).toBeUndefined()
  expect(standingOf(recordFacets(record))).toBe('unknown')
  expect(record.earlyEvents).toContainEqual(event)
  client.dispose()
  epoch.resolve({ run: 'fern', n: 0 })
  await epoch.promise
  await Promise.resolve()
  expect(list).not.toHaveBeenCalled()
  expect(client.get('fern')).toBeNull()
})

it('rejects older publications and old runs after the reconnect handshake', async () => {
  const world = new F093World()
  let receive!: (message: RuntimeEventMessage) => void
  const host = world.buildHost(false, {
    statesMoved: (message) => client?.hearProviderStates(message),
  })
  let epoch = host.currentEpoch()
  const bridge: Partial<ClientSessionApi> = {
    currentEpoch: async () => epoch,
    listConversations: async () => ({
      resumable: [],
      unresumable: [],
      published: {
        epoch,
        seq: 0,
        covers: { population: 'listing' as const, complete: true as const },
      },
    }),
    attachOpen: async () => [],
    onEvent(listener) {
      receive = listener
      return () => {}
    },
    onLiveness: () => () => {},
    resume: async () => {
      throw new Error('Fictional reconnect has no session')
    },
  }
  const client = createSessionStore(bridge as ClientSessionApi)
  try {
    await Promise.resolve()
    const row = {
      sessionId: 'fern',
      ordinal: 0,
      at: 17,
      event: { type: 'assistant_delta' as const, text: 'First words' },
    }
    receive({ ...row, agentState: { is: 'active' }, published: { epoch, seq: 5 } })
    const record = client.get('fern')!
    expect(record.agentState).toEqual({ is: 'active' })
    receive({ ...row, ordinal: 1, agentState: { is: 'idle' }, published: { epoch, seq: 4 } })
    expect(record.agentState).toEqual({ is: 'active' })
    const old = epoch
    epoch = { run: 'new-fern', n: 1 }
    await client.resume('fern')
    receive({
      ...row,
      ordinal: 2,
      agentState: { is: 'scheduled', dueAt: null },
      published: { epoch, seq: 1 },
    })
    const reconnected = client.get('fern')!
    expect(reconnected.agentState).toEqual({ is: 'scheduled', dueAt: null })
    receive({ ...row, ordinal: 3, agentState: { is: 'idle' }, published: { epoch: old, seq: 999 } })
    receive({
      ...row,
      ordinal: 4,
      agentState: { is: 'idle' },
      published: { epoch: { ...epoch, n: 0 }, seq: 1000 },
    })
    expect(reconnected.agentState).toEqual({ is: 'scheduled', dueAt: null })
    expect(reconnected.earlyEvents.some((message) => message.ordinal === 3)).toBe(true)
  } finally {
    client.dispose()
    await world.dispose()
  }
})
