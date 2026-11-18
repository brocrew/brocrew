import { fixtureHostPaths, fixtureProviderConfig } from './host-fixture'
import { expect } from 'vitest'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../../src/main/runtime/runtime-host'
import type { SessionStore } from '../../src/main/db/session-store'

export async function openAgentTestConversation(
  host: Pick<RuntimeHost, 'createSession'>,
  window: RuntimeEventSink,
  cwd: string,
  profileId: string,
  approvalMode: 'ask' | 'auto',
): Promise<string> {
  const { sessionId } = await host.createSession(
    { provider: 'claude', profileId, cwd, approvalMode },
    window,
  )
  return sessionId
}

export async function makeAgentTestIdentity(
  open: (profileId: string) => Promise<string>,
  close: (sessionId: string) => Promise<void>,
  profileId: string,
): Promise<void> {
  const id = await open(profileId)
  await close(id)
}

export function grantAgentTestCapabilities(
  store: Pick<SessionStore, 'setCapabilities'>,
  profileId: string,
  edit: Parameters<SessionStore['setCapabilities']>[1],
): void {
  expect(store.setCapabilities(profileId, edit)).toBe(true)
}

export function createAgentTestHost(
  store: RuntimeHostDeps['store'],
  root: () => string,
  createRuntime: RuntimeHostDeps['createRuntime'],
  newSessionId: RuntimeHostDeps['newSessionId'],
  now: () => number,
): RuntimeHost {
  return new RuntimeHost({
    store,
    ...fixtureHostPaths(root),
    createRuntime,
    newSessionId,
    now,
    readProviderConfig: fixtureProviderConfig,
  })
}
