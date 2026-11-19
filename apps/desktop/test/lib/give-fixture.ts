import { personOpener } from '../helpers/person-opens-session'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { TASK_IS_OPEN } from '../../src/shared/tasks'
import type { AgentToolset } from '@brobot2/runtime'
import { agentCallerId } from '../../src/main/runtime/conversation-caller'
import { expect } from 'vitest'
import type { SessionStore } from '../../src/main/db/session-store'
import { agentToolsFor, type ToolName } from '../../src/main/runtime/agent-tools'
import type { RuntimeEventSink, RuntimeHost } from '../../src/main/runtime/runtime-host'
import { callOn } from '../helpers/call-agent-tool'
import { waitFor } from './f093-host'

const definitionOfDone = 'The requested result and its checks are recorded.'

export function newConversationGive(profile: string, title: string, brief: string) {
  return {
    to: 'new',
    conversation_title: title,
    definition_of_done: definitionOfDone,
    profile,
    title,
    brief,
  }
}

export function callNewConversationGive(
  tools: AgentToolset,
  profile: string,
  title: string,
  brief: string,
) {
  return callOn(tools, 'give_work', newConversationGive(profile, title, brief))
}

export async function giveAndWaitForBriefTurn(
  tools: AgentToolset,
  profile: string,
  title: string,
  ledger: (agent: string) => readonly { type: string }[],
): Promise<{ agent: string; piece: string; label: string }> {
  const given = await callNewConversationGive(tools, profile, title, title)
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  expect(given.started, JSON.stringify(given)).toBe(true)
  const agent = given.agent as string
  await waitFor(
    () => ledger(agent).some((event) => event.type === 'turn'),
    'the brief’s turn to end',
  )
  return { agent, piece: given.piece as string, label: given.label as string }
}

export function addressedGive<To, Profile>(to: To, profile: Profile, title: string, brief: string) {
  return { to, definition_of_done: definitionOfDone, profile, title, brief }
}

export function callAddressedGive(
  tools: AgentToolset,
  to: string,
  profile: string,
  title: string,
  brief = title,
) {
  return callOn(tools, 'give_work', addressedGive(to, profile, title, brief))
}

export function giveToConversation(to: string, profile: string, title: string, brief: string) {
  return to === 'new'
    ? newConversationGive(profile, title, brief)
    : addressedGive(to, profile, title, brief)
}

export async function openPmWithSeededWorker(
  open: (profile: string) => Promise<string>,
  close: (conversation: string) => Promise<unknown>,
) {
  await close(await open('worker'))
  return open('pm')
}

export async function readGivenTask(send: () => Promise<Record<string, unknown>>) {
  const answer = await send()
  expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
  const { agent, piece, label } = answer
  return { agent: agent as string, piece: piece as string, label: label as string, answer }
}

export function ownedFixturePiece(store: SessionStore, owner: string, piece: string) {
  const found = store.piecesOwnedBy(owner).find((one) => one.piece === piece)
  if (found === undefined) throw new Error(`${owner} owns no piece ${piece}`)
  return found
}

export async function giveWorkerAndClaimItsBrief(
  fixture: {
    host: RuntimeHost
    store: SessionStore
    window: RuntimeEventSink
    personOpens: (profile: string) => Promise<string>
  },
  suffix: string,
  title: string,
  brief: string,
) {
  const { host, store, window, personOpens } = fixture
  const profile = `worker${suffix}`
  await host.close(await personOpens(profile), window)
  const pm = await personOpens(`pm${suffix}`)
  const given = await readGivenTask(() =>
    callNewConversationGive(agentToolsFor(host, pm), profile, title, brief),
  )
  const worker = given.agent
  host.claimSession(worker, window)
  await waitFor(
    () => store.events(worker).some(({ event }) => event.type === 'permission_request'),
    'the worker to park on its first turn',
  )
  return { pm, worker, piece: given.piece, label: given.label, title }
}

export async function giveParkedWorker(
  fixture: Parameters<typeof giveWorkerAndClaimItsBrief>[0],
  title: string,
) {
  const given = await giveWorkerAndClaimItsBrief(fixture, '', title, 'migrate')
  const piece = fixture.store.piecesOwnedBy(given.worker)[0]
  if (piece === undefined) throw new Error('no piece')
  expect(piece.piece).toBe(given.piece)
  return { pm: given.pm, worker: given.worker, piece: piece.piece, label: piece.label }
}

export async function giveToSeededWorker(
  host: RuntimeHost,
  window: RuntimeEventSink,
  open: (profile: string) => Promise<string>,
  title: string,
  brief: string,
) {
  const pm = await openPmWithSeededWorker(open, (id) => host.close(id, window))
  const given = await readGivenTask(() =>
    callNewConversationGive(agentToolsFor(host, pm), 'worker', title, brief),
  )
  return { pm, given }
}

export async function givePagesToWorker(
  call: typeof callOn,
  tools: AgentToolset,
  title: string,
  to: string,
) {
  if (to === 'new') await call(tools, 'create_agent', { profile_slug: 'worker' })
  return call(tools, 'give_work', giveToConversation(to, 'worker', title, title.toLowerCase()))
}

export async function openGiverAndGivePages(
  { host, root, window }: { host: RuntimeHost; root: string; window: RuntimeEventSink },
  settle: () => Promise<unknown>,
  give: (giver: string, title: string, to: string) => Promise<{ ada: string; piece: string }>,
) {
  const { sessionId: brobot } = await host.createSession(
    { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: root },
    window,
  )
  await settle()
  const { ada, piece } = await give(brobot, 'Build the pages', 'new')
  return { brobot, ada, piece }
}

export async function openNumberedPmAndGive(
  nth: number,
  seedWorker: (profile: string) => Promise<void>,
  personOpens: (profile: string) => Promise<string>,
  toolsFor: (conversation: string) => AgentToolset,
  title: string,
  brief: string,
) {
  const pmProfile = `pm-${String(nth)}`
  const workerProfile = `worker-${String(nth)}`
  await seedWorker(workerProfile)
  const pm = await personOpens(pmProfile)
  const pmTools = toolsFor(pm)
  const given = await callNewConversationGive(pmTools, workerProfile, title, brief)
  return { pm, pmProfile, pmTools, given }
}

export async function giveWorkerThroughRawTool(
  send: (
    toolset: AgentToolset,
    name: 'give_work',
    args: Record<string, unknown>,
  ) => Promise<{ structured: Record<string, unknown> }>,
  pmTools: AgentToolset,
  lastToolset: () => AgentToolset,
  title: string,
  brief: string,
) {
  const given = await readGivenTask(
    async () =>
      (await send(pmTools, 'give_work', newConversationGive('worker', title, brief))).structured,
  )
  return {
    worker: given.agent,
    pmTools,
    workerTools: lastToolset(),
    piece: given.piece,
    label: given.label,
  }
}

export async function giveWorkWithTitleAsBrief(
  tools: AgentToolset,
  profile: string,
  title: string,
  to = 'new',
) {
  const { agent, piece, label } = await readGivenTask(() =>
    callOn(tools, 'give_work', giveToConversation(to, profile, title, title)),
  )
  return { agent, piece, label }
}

export async function giveOpenWorkerTask(
  store: SessionStore,
  personOpens: (profile: string) => Promise<string>,
  lastToolset: () => AgentToolset,
  title: string,
  brief: string,
) {
  const pm = await personOpens('pm')
  const pmTools = lastToolset()
  const given = await readGivenTask(() => callNewConversationGive(pmTools, 'worker', title, brief))
  const worker = given.agent
  const workerTools = lastToolset()
  const open = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
  if (open === undefined) throw new Error('the give never opened a piece')
  return { pm, worker, pmTools, workerTools, piece: open.piece }
}

export function spawnFailureFixture(
  world: () => { host: RuntimeHost; root: string; window: RuntimeEventSink },
) {
  const open = personOpener(world, 'auto')
  const call = (caller: string, name: ToolName, args: Record<string, unknown> = {}) =>
    callOn(agentToolsFor(world().host, caller), name, args)
  return {
    callOn: call,
    aPmThatMaySpawn: () =>
      openPmWithSeededWorker(open, (id) => world().host.close(id, world().window)),
    spawnWorker: (pm: string) =>
      call(pm, 'give_work', newConversationGive('worker', 'The work', 'the work')),
  }
}

export const giveLateServiceTask = (host: RuntimeHost, caller: string, under: string) =>
  host.giveWork(
    {
      profile: 'browser-driver',
      title: 'Late',
      brief: 'late',
      under,
      definition_of_done: definitionOfDone,
    },
    { ownerId: agentCallerId(caller) },
  )

export async function givePagesToNewWorker(
  tools: AgentToolset,
  title = 'Build the pages',
  brief = 'build the pages',
) {
  await callOn(tools, 'create_agent', { profile_slug: 'worker' })
  const given = await callNewConversationGive(tools, 'worker', title, brief)
  expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
  return given
}

export async function givePagesAndWaitForStall(
  { host, root, window }: { host: RuntimeHost; root: string; window: RuntimeEventSink },
  settle: () => Promise<unknown>,
  stallNoticesIn: (conversation: string) => readonly unknown[],
  turnsIn: (conversation: string) => number,
) {
  const { sessionId: brobot } = await host.createSession(
    { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: root },
    window,
  )
  await settle()
  const brobotTools = agentToolsFor(host, brobot)
  const given = await givePagesToNewWorker(brobotTools)
  const ada = given.agent as string
  await waitFor(() => stallNoticesIn(brobot).length === 1, 'the giver to be told of the stall')
  await waitFor(() => turnsIn(brobot) >= 1, 'the turn the notice opened')
  await settle()
  return { brobot, brobotTools, ada, piece: given.piece as string }
}
