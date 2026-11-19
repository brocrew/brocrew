import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { expect } from 'vitest'
import type { AgentToolset, FakeSessionHandle } from '@brobot2/runtime'
import type { SessionStore } from '../../src/main/db/session-store'
import { addressedGive, callNewConversationGive, newConversationGive } from './give-fixture'
import { callOn } from '../helpers/call-agent-tool'
import { agentToolsFor } from '../../src/main/runtime/agent-tools'
import type { RuntimeEventSink, RuntimeHost } from '../../src/main/runtime/runtime-host'
import { RecordingSink, waitFor } from './host-fixture'

export async function startThinking(handle: FakeSessionHandle): Promise<void> {
  handle.simulateThinking({ text: 'driving the browser', redacted: false })
  await waitFor(() => handle.status() === 'working', 'the conversation to be working')
}

export async function giveAfterBriefTurn(
  store: Pick<SessionStore, 'events'>,
  tools: AgentToolset,
  profile: string,
  title: string,
) {
  const given = await callNewConversationGive(tools, profile, title, title)
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  expect(given.started, JSON.stringify(given)).toBe(true)
  const agent = given.agent as string
  await waitFor(
    () => store.events(agent).some(({ event }) => event.type === 'turn'),
    'the brief’s turn to end',
  )
  return { agent, piece: given.piece as string, label: given.label as string }
}

interface WorkerFixture {
  host: RuntimeHost
  store: SessionStore
  window: RuntimeEventSink
  personOpens: (profile: string) => Promise<string>
}

export async function giveParkedWorker(fixture: WorkerFixture, title: string) {
  const given = await giveWorkerAndClaimItsBrief(fixture, '', title, 'migrate')
  const piece = fixture.store.piecesOwnedBy(given.worker)[0]?.piece
  if (piece === undefined) throw new Error('no piece')
  expect(piece).toBe(given.piece)
  return given
}

export async function giveStalledWorker(
  store: Pick<SessionStore, 'piecesOwnedBy'>,
  tools: AgentToolset,
  title: string,
  to: string,
) {
  if (to === 'new') {
    const created = await callOn(tools, 'create_agent', { profile_slug: 'worker' })
    expect(created, JSON.stringify(created)).toMatchObject({ outcome: 'ok' })
  }
  const brief = title.toLowerCase()
  const args =
    to === 'new'
      ? newConversationGive('worker', title, brief)
      : addressedGive(to, 'worker', title, brief)
  const given = await callOn(tools, 'give_work', args)
  expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok' })
  const ada = given.agent as string
  const piece = given.piece as string
  await waitFor(
    () => store.piecesOwnedBy(ada).find((one) => one.piece === piece)?.state === 'stalled',
    `the brief of ${title} to end`,
  )
  return { ada, piece, label: given.label as string }
}

export async function giveWorkerAndClaimItsBrief(
  { host, store, window, personOpens }: WorkerFixture,
  suffix: string,
  title: string,
  brief: string,
) {
  const profile = `worker${suffix}`
  await host.close(await personOpens(profile), window)
  const pm = await personOpens(`pm${suffix}`)
  const given = await callNewConversationGive(agentToolsFor(host, pm), profile, title, brief)
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  const worker = given.agent as string
  host.claimSession(worker, window)
  await waitFor(
    () => store.events(worker).some(({ event }) => event.type === 'permission_request'),
    'the worker to park on its first turn',
  )
  return { pm, worker, piece: given.piece as string, label: given.label as string, title }
}

export const testResumeShapes = [
  ['the Fake', false],
  ['Claude', true],
] as const

export function stalledWorkFixture(
  read: () => Pick<WorkerFixture, 'host' | 'store' | 'personOpens'>,
  settle: () => Promise<void>,
) {
  const give = async (brobot: string, title: string, to: string) => {
    const { host, store } = read()
    const piece = await giveStalledWorker(store, agentToolsFor(host, brobot), title, to)
    await settle()
    return piece
  }
  return {
    give,
    open: async () => {
      const brobot = await read().personOpens(DEFAULT_PROFILE_ID)
      await settle()
      const { ada, piece } = await give(brobot, 'Build the pages', 'new')
      return { brobot, ada, piece }
    },
  }
}

export async function waitForGiverToBeToldAboutStalledWork(
  giver: string,
  worker: string,
  turnsIn: (conversation: string) => number,
  stateOf: (conversation: string) => { is: string } | undefined,
  settle: () => Promise<void>,
  workerLine: string,
): Promise<void> {
  await waitFor(() => turnsIn(worker) >= 1 && turnsIn(giver) >= 1, 'the stall notice’s turn')
  await waitFor(
    () => stateOf(giver)?.is === 'waiting-on-a-worker',
    'the giver to be pushed as waiting on its helper',
  )
  await settle()
  expect(stateOf(giver)).toEqual({
    is: 'waiting-on-a-worker',
    on: [workerLine],
    since: expect.any(Number),
  })
}

export async function giveTwoHopsAfterBriefTurns(
  store: Pick<SessionStore, 'events'>,
  openBrobot: () => Promise<string>,
  toolsFor: (conversation: string) => AgentToolset,
  latestHandle: () => FakeSessionHandle,
  pmProfile: string,
  workerProfile: string,
) {
  const brobot = await openBrobot()
  const brobotTools = toolsFor(brobot)
  const { agent: ada } = await giveAfterBriefTurn(
    store,
    brobotTools,
    pmProfile,
    'run the front-end work',
  )
  const adaHandle = latestHandle()
  const adaTools = toolsFor(ada)
  const toAli = await giveAfterBriefTurn(
    store,
    adaTools,
    workerProfile,
    'build the world-clock page',
  )
  return { brobot, brobotTools, ada, adaHandle, adaTools, toAli }
}

export async function giveWorkerAndObserveItsParkedCard<
  T extends { id: string; tools: AgentToolset },
>(
  { host, store, window }: Omit<WorkerFixture, 'personOpens'>,
  personOpens: (profile: string) => Promise<T>,
  lastToolset: () => AgentToolset | undefined,
) {
  await host.close((await personOpens('worker')).id, window)
  const pm = await personOpens(DEFAULT_PROFILE_ID)
  const given = await callNewConversationGive(pm.tools, 'worker', 'The notes', 'write it')
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  const worker = given.agent as string
  const workerTools = lastToolset()
  if (workerTools === undefined) throw new Error('no worker toolset')
  const surface = new RecordingSink('webContents:9')
  host.claimSession(worker, surface)
  await waitFor(
    () => store.events(worker).some(({ event }) => event.type === 'permission_request'),
    'the worker to park on its card',
  )
  return { pm, worker, workerTools, piece: given.label as string, surface }
}
