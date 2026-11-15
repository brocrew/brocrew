import { expect, vi } from 'vitest'
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

export async function copiesBeforeEveryTurn(fixture: AutomaticCopyFixture): Promise<void> {
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

export async function keepsTheKeySession(fixture: AutomaticCopyFixture): Promise<void> {
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

export async function copiesBeforeApprovingAPlan(fixture: AutomaticCopyFixture): Promise<void> {
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
