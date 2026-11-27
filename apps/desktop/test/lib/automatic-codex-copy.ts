import type { FakeRuntime } from '@brobot2/runtime/testing'
import { expect, it, vi } from 'vitest'
import type { ProviderAuthOps } from '../../src/main/providers/auth-operations'
import type { RuntimeHost, RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'

interface AutomaticCopyFixture {
  host: RuntimeHost
  root: string
  sink: RuntimeEventSink
  ops: ProviderAuthOps
  copy: ReturnType<typeof vi.fn>
  messages: RuntimeEventMessage[]
  readonly launches: number
  readonly stopped: number
}

async function copiesBeforeEveryTurn(fixture: AutomaticCopyFixture): Promise<void> {
  const { host, root, sink, ops, copy, messages } = fixture
  const current = await host.createSession(
    { provider: 'codex', profileId: 'alpha', cwd: root },
    sink,
  )
  let fresh = true
  Object.assign(ops, { hasNewerCopy: () => fresh })
  copy.mockImplementation(async () => {
    expect(fixture.stopped).toBe(fixture.launches)
    const progress = await host.reprovisionProviderHomes('codex', true)
    expect.soft(progress.profiles.find((one) => one.profileId === 'alpha')).toEqual({
      profileId: 'alpha',
      state: 'pending',
    })
    fresh = false
    return 'replaced'
  })

  await host.send(current.sessionId, 'use the newer fictional sign-in', sink)

  await vi.waitFor(() =>
    expect(copy).toHaveBeenCalledWith('codex', 'alpha', true, expect.any(Function)),
  )
  await vi.waitFor(() => expect(fixture.launches).toBe(2))
  await vi.waitFor(() =>
    expect(messages.some((one) => one.event.type === 'permission_request')).toBe(true),
  )
  expect(copy).toHaveBeenCalledTimes(1)
  expect(host.sessionIds).toContain(current.sessionId)
  await host.respondPermission(current.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
  await vi.waitFor(() =>
    expect(
      messages.some((one) => one.event.type === 'turn' && one.event.state === 'completed'),
    ).toBe(true),
  )
  fresh = true
  await host.send(current.sessionId, 'check the machine sign-in again for this turn', sink)
  await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(fixture.launches).toBe(3))
  await vi.waitFor(() =>
    expect(
      messages.some(
        (one) =>
          one.event.type === 'user_turn' &&
          one.event.text === 'check the machine sign-in again for this turn',
      ),
    ).toBe(true),
  )
}

async function keepsTheKeySession(fixture: AutomaticCopyFixture): Promise<void> {
  const { host, root, sink, ops, copy } = fixture
  const newer = vi.fn(() => true)
  Object.assign(ops, { hasNewerCopy: newer })
  const current = await host.createSession(
    { provider: 'codex', profileId: 'alpha', cwd: root },
    sink,
  )

  await host.send(current.sessionId, 'keep the API-key session', sink)

  expect(newer).not.toHaveBeenCalled()
  expect(copy).not.toHaveBeenCalled()
  expect(fixture.launches).toBe(1)
}

async function copiesBeforeApprovingAPlan(fixture: AutomaticCopyFixture): Promise<void> {
  const { host, root, sink, ops, copy, messages } = fixture
  const current = await host.createSession(
    { provider: 'codex', profileId: 'alpha', cwd: root, planMode: true },
    sink,
  )
  let fresh = true
  Object.assign(ops, { hasNewerCopy: () => fresh })
  copy.mockImplementation(async () => {
    expect(fixture.stopped).toBe(1)
    fresh = false
    return 'replaced'
  })
  const goAhead = 'Proceed with the approved fictional plan.'
  await host.endPlanMode(current.sessionId, sink, goAhead)
  await vi.waitFor(() => expect(fixture.launches).toBe(2))
  await vi.waitFor(() =>
    expect(
      messages.some((one) => one.event.type === 'user_turn' && one.event.text === goAhead),
    ).toBe(true),
  )
  expect(copy).toHaveBeenCalledTimes(1)
}

interface CurrentCopyFixture extends AutomaticCopyFixture {
  currentSignIn: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  activeHandle: Awaited<ReturnType<FakeRuntime['start']>>
  setKeySaved(): void
}

export function currentSignInAdmission(getFixture: () => CurrentCopyFixture): void {
  it('does not queue an automatic Claude copy without a provider freshness hook', async () => {
    const fixture = getFixture()
    const { host, copy } = fixture
    const automatic = host as unknown as {
      queueANewerHomeCopy(provider: 'claude', profileId: string): boolean
    }
    expect(automatic.queueANewerHomeCopy('claude', 'other-provider')).toBe(false)
    await expect(host.reprovisionProviderHomes('claude', true)).rejects.toThrow(
      'This provider does not keep a separate sign-in for each agent.',
    )
    expect(copy).not.toHaveBeenCalled()
  })

  for (const door of ['send', 'queue'] as const) {
    it(`lets ${door} reach a working child while a newer sign-in waits`, async () => {
      const fixture = getFixture()
      const { host, root, sink, ops, copy, messages, currentSignIn } = fixture
      const current = await host.createSession(
        { provider: 'codex', profileId: 'alpha', cwd: root },
        sink,
      )
      Object.assign(ops, { hasNewerCopy: () => true })
      const automatic = host as unknown as {
        queueANewerHomeCopy(provider: 'codex', profileId: string): boolean
      }
      expect(automatic.queueANewerHomeCopy('codex', 'alpha')).toBe(true)
      const pending = await host.reprovisionProviderHomes('codex', true)
      expect(pending.profiles.find((one) => one.profileId === 'alpha')?.state).toBe('pending')
      const text = `continue ${door} on the working sign-in`

      if (door === 'send') await host.send(current.sessionId, text, sink)
      else await host.queueMessage(current.sessionId, text, sink)

      await vi.waitFor(() =>
        expect(
          messages.some((one) => one.event.type === 'user_turn' && one.event.text.includes(text)),
        ).toBe(true),
      )
      expect(currentSignIn).toHaveBeenCalled()
      expect(copy).not.toHaveBeenCalled()
      expect(fixture.stopped).toBe(0)
      expect(fixture.launches).toBe(1)
    })
  }

  it('starts a new conversation while a sibling works with an automatic copy pending', async () => {
    const fixture = getFixture()
    const { host, root, sink, ops, copy, messages } = fixture
    const sibling = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    Object.assign(ops, { hasNewerCopy: () => true })
    await host.send(sibling.sessionId, 'keep the sibling working', sink)
    const siblingHandle = fixture.activeHandle
    await vi.waitFor(() => expect(siblingHandle.status()).toBe('waiting_permission'))
    let accepted = false
    let newSessionId = ''
    const starting = host
      .createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
      .then(async (created) => {
        newSessionId = created.sessionId
        await host.send(created.sessionId, 'the new first give', sink)
        accepted = true
      })
      .catch(() => {})

    await vi.waitFor(() => expect(accepted).toBe(true))
    await starting
    expect(
      messages.some(
        (one) => one.event.type === 'user_turn' && one.event.text === 'the new first give',
      ),
    ).toBe(true)
    const newHandle = fixture.activeHandle
    await host.respondPermission(sibling.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await vi.waitFor(() => expect(siblingHandle.status()).toBe('idle'))
    await host.respondPermission(newSessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await vi.waitFor(() => expect(newHandle.status()).toBe('idle'))
    await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(copy).not.toHaveBeenCalled()
    expect(fixture.stopped).toBe(0)
    expect(fixture.launches).toBe(3)
  })

  it('releases a new start when the pending refusal is no longer wanted', async () => {
    const fixture = getFixture()
    const { host, root, sink, ops, copy } = fixture
    const sibling = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    Object.assign(ops, { hasNewerCopy: () => true })
    await host.send(sibling.sessionId, 'finish before the requester goes away', sink)
    const siblingHandle = fixture.activeHandle
    await vi.waitFor(() => expect(siblingHandle.status()).toBe('waiting_permission'))
    let wanted = true
    const automatic = host as unknown as {
      queueANewerHomeCopy(provider: 'codex', profileId: string, wanted?: () => boolean): boolean
    }
    expect(automatic.queueANewerHomeCopy('codex', 'alpha', () => wanted)).toBe(true)
    let started = false
    const next = host
      .createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
      .then(() => {
        started = true
      })
      .catch(() => {})
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(started).toBe(false)

    wanted = false
    await host.respondPermission(sibling.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await vi.waitFor(() => expect(siblingHandle.status()).toBe('idle'))
    await vi.waitFor(() => expect(started).toBe(true))
    await next
    expect(copy).not.toHaveBeenCalled()
    expect(fixture.stopped).toBe(0)
    expect(fixture.launches).toBe(2)
    expect(automatic.queueANewerHomeCopy('codex', 'alpha')).toBe(true)
  })

  for (const requesters of [1, 2]) {
    it(`only stops siblings for a still-wanted refusal among ${requesters} requesters`, async () => {
      const fixture = getFixture()
      const { host, root, sink, ops, copy } = fixture
      await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
      Object.assign(ops, { hasNewerCopy: () => true })
      const automatic = host as unknown as {
        queueANewerHomeCopy(provider: 'codex', profileId: string, wanted?: () => boolean): boolean
        copyHomeWhenIdle(provider: 'codex', profileId: string): Promise<void>
      }
      let firstWanted = true
      let secondWanted = true
      expect(automatic.queueANewerHomeCopy('codex', 'alpha', () => firstWanted)).toBe(true)
      if (requesters === 2)
        expect(automatic.queueANewerHomeCopy('codex', 'alpha', () => secondWanted)).toBe(true)
      if (requesters === 1) firstWanted = false
      else secondWanted = false

      await automatic.copyHomeWhenIdle('codex', 'alpha')

      expect(fixture.stopped).toBe(requesters === 1 ? 0 : 1)
      expect(copy).toHaveBeenCalledTimes(requesters === 1 ? 0 : 1)
    })
  }

  for (const boundary of ['idle', 'background', 'plan-exit'] as const) {
    it(`leaves a working child alone after ${boundary} with an automatic copy pending`, async () => {
      const fixture = getFixture()
      const { host, root, sink, ops, copy, messages } = fixture
      const current = await host.createSession(
        { provider: 'codex', profileId: 'alpha', cwd: root, planMode: boundary === 'plan-exit' },
        sink,
      )
      Object.assign(ops, { hasNewerCopy: () => true })
      const automatic = host as unknown as {
        queueANewerHomeCopy(provider: 'codex', profileId: string): boolean
      }
      expect(automatic.queueANewerHomeCopy('codex', 'alpha')).toBe(true)
      if (boundary === 'plan-exit') await host.endPlanMode(current.sessionId, sink)
      else {
        await host.send(current.sessionId, 'finish on the working sign-in', sink)
        await vi.waitFor(() => expect(fixture.activeHandle.status()).toBe('waiting_permission'))
        await host.respondPermission(current.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
        await vi.waitFor(() => expect(fixture.activeHandle.status()).toBe('idle'))
        if (boundary === 'background') fixture.activeHandle.simulateBackgroundWork({ running: [] })
      }
      if (boundary === 'background')
        await vi.waitFor(() =>
          expect(messages.some((one) => one.event.type === 'background_work')).toBe(true),
        )
      if (boundary === 'plan-exit')
        expect(fixture.activeHandle.settings.planMode.requested).toBe(false)
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(fixture.stopped).toBe(0)
      expect(copy).not.toHaveBeenCalled()
      expect(fixture.launches).toBe(1)
    })
  }

  it('stops a stale child and copies a newer sign-in before sending once', () => {
    const fixture = getFixture()
    const { ops, currentSignIn } = fixture
    currentSignIn.mockImplementation(async () => ops.hasNewerCopy?.('codex', 'alpha') === true)
    return copiesBeforeEveryTurn(getFixture())
  })

  it('does not check or copy machine sign-ins for an API-key turn', async () => {
    const fixture = getFixture()
    fixture.setKeySaved()
    await keepsTheKeySession(getFixture())
  })

  it('copies a newer sign-in before approving a plan on a stale child', () => {
    const fixture = getFixture()
    const { ops, currentSignIn } = fixture
    currentSignIn.mockImplementation(async () => ops.hasNewerCopy?.('codex', 'alpha') === true)
    return copiesBeforeApprovingAPlan(getFixture())
  })
}
