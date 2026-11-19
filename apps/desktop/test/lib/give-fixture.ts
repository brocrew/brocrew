import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { type RuntimeHost, type RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import { agentToolsFor } from '../../src/main/runtime/agent-tools'
import { personOpener } from '../helpers/person-opens-session'
import { expect } from 'vitest'
import type { AgentToolset } from '@brobot2/runtime'
import { callOn } from '../helpers/call-agent-tool'
import type { SessionStore } from '../../src/main/db/session-store'
import { TASK_IS_OPEN } from '../../src/shared/tasks'

const definition_of_done = 'The requested result and its checks are recorded.'

function newConversationTask(conversation_title: string) {
  return { to: 'new', conversation_title, definition_of_done }
}

function addressedTask<To>(to: To) {
  return { to, definition_of_done }
}

export function newConversationGive(profile: string, title: string, brief: string) {
  return { ...newConversationTask(title), profile, title, brief }
}

export function addressedGive<To>(to: To, profile: string, title: string, brief: string) {
  return { ...addressedTask(to), profile, title, brief }
}

export function callNewConversationGive(
  tools: AgentToolset,
  profile: string,
  title: string,
  brief: string,
) {
  return callOn(tools, 'give_work', newConversationGive(profile, title, brief))
}

export async function giveWorkWithTitleAsBrief(
  tools: AgentToolset,
  profile: string,
  title: string,
  to = 'new',
) {
  const args =
    to === 'new'
      ? newConversationGive(profile, title, title)
      : addressedGive(to, profile, title, title)
  const given = await callOn(tools, 'give_work', args)
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  return {
    agent: given.agent as string,
    piece: given.piece as string,
    label: given.label as string,
  }
}

export async function pmGivesNewWorkerTask(
  personOpens: (profile: string) => Promise<string>,
  lastToolset: () => AgentToolset,
  title: string,
  brief: string,
) {
  const pm = await personOpens('pm')
  const pmTools = lastToolset()
  const given = await callNewConversationGive(pmTools, 'worker', title, brief)
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  const worker = given.agent as string
  const workerTools = lastToolset()
  return { pm, pmTools, worker, workerTools, given }
}

export async function giveOpenWorkerTask(
  store: Pick<SessionStore, 'piecesOwnedBy'>,
  personOpens: (profile: string) => Promise<string>,
  lastToolset: () => AgentToolset,
  title: string,
  brief: string,
) {
  const given = await pmGivesNewWorkerTask(personOpens, lastToolset, title, brief)
  const open = store.piecesOwnedBy(given.worker).find((one) => TASK_IS_OPEN[one.state])
  if (open === undefined) throw new Error('the give never opened a piece')
  const { pm, worker, pmTools, workerTools } = given
  return { pm, worker, pmTools, workerTools, piece: open.piece }
}

export async function openPmWithSeededWorker(
  open: (profile: string) => Promise<string>,
  close: (conversation: string) => Promise<unknown>,
) {
  await close(await open('worker'))
  return open('pm')
}

export async function openPmAndGiveToWorker(
  open: (profile: string) => Promise<string>,
  close: (conversation: string) => Promise<unknown>,
  give: (
    pm: string,
    name: 'give_work',
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
  title: string,
  brief: string,
) {
  const pm = await openPmWithSeededWorker(open, close)
  const given = await readSuccessfulGive(() =>
    give(pm, 'give_work', newConversationGive('worker', title, brief)),
  )
  return { pm, given }
}

export async function openAndGiveToNewChild(
  fixture: { host: RuntimeHost; root: string; window: RuntimeEventSink },
  title: string,
  brief: string,
) {
  const { host, window } = fixture
  const open = personOpener(() => fixture, 'ask')
  await host.close(await open('worker'), window)
  const pm = await open(DEFAULT_PROFILE_ID)
  const given = await callNewConversationGive(agentToolsFor(host, pm), 'worker', title, brief)
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  return { pm, child: given.agent as string }
}

export function ownedFixturePiece(
  store: Pick<SessionStore, 'piecesOwnedBy'>,
  owner: string,
  piece: string,
) {
  const found = store.piecesOwnedBy(owner).find((one) => one.piece === piece)
  if (found === undefined) throw new Error(`${owner} owns no piece ${piece}`)
  return found
}

export async function createFirstWorkerTask(
  tools: AgentToolset,
  title: string,
  brief: string,
) {
  const given = await createWorkerAndGive(tools, title, brief)
  expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
  return given
}

export async function giveAndReadItsTask(
  call: (name: 'give_work', args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  to: string,
  profile: string,
  title: string,
  brief: string,
  extra: Record<string, unknown> = {},
) {
  const args =
    to === 'new'
      ? newConversationGive(profile, title, brief)
      : addressedGive(to, profile, title, brief)
  const answer = await call('give_work', { ...args, ...extra })
  expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
  return {
    agent: answer.agent as string,
    piece: answer.piece as string,
    label: answer.label as string,
    answer,
  }
}

export async function giveNewWorkerChecked(
  tools: AgentToolset,
  profile: string,
  title: string,
  brief: string,
) {
  const given = await callNewConversationGive(tools, profile, title, brief)
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  expect(given.started, JSON.stringify(given)).toBe(true)
  return given
}

export async function readSuccessfulGive(send: () => Promise<Record<string, unknown>>) {
  const given = await send()
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  return given
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

export async function createWorkerAndGive(tools: AgentToolset, title: string, brief: string) {
  await callOn(tools, 'create_agent', { profile_slug: 'worker' })
  return callNewConversationGive(tools, 'worker', title, brief)
}

export async function giveWorkerWithToolsets(lastToolset: () => AgentToolset, title: string) {
  const pmTools = lastToolset()
  const given = await giveWorkWithTitleAsBrief(pmTools, 'worker', title)
  return {
    worker: given.agent,
    pmTools,
    workerTools: lastToolset(),
    piece: given.piece,
    label: given.label,
  }
}

export function giveWorkBeforeProviderStart(
  send: (name: 'give_work', args: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  return send('give_work', newConversationGive('worker', 'The work', 'the work'))
}

async function readSuccessfulRawGive(
  send: () => Promise<{ structured: Record<string, unknown> }>,
) {
  const given = await send()
  expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
  return given
}

export async function giveChildWithProfileTitle(
  send: (name: 'give_work', args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  profile: string,
  brief: string,
) {
  const given = await readSuccessfulGive(() =>
    send('give_work', newConversationGive(profile, `The ${profile}`, brief)),
  )
  return {
    child: given.agent as string,
    piece: given.piece as string,
    label: given.label as string,
  }
}

export async function giveWorkerThroughRawTool(
  send: (
    toolset: AgentToolset,
    name: 'give_work',
    args: Record<string, unknown>,
  ) => Promise<{ structured: Record<string, unknown> }>,
  pmTools: AgentToolset,
  lastToolset: () => AgentToolset,
) {
  const given = await readSuccessfulRawGive(() =>
    send(
      pmTools,
      'give_work',
      newConversationGive('worker', 'The work this dispatch is about', 'build it'),
    ),
  )
  return {
    worker: given.structured.agent as string,
    pmTools,
    workerTools: lastToolset(),
    piece: given.structured.piece as string,
    label: given.structured.label as string,
  }
}

export async function openWorldClockParent(
  host: RuntimeHost,
  open: (profile: string, mode: 'ask') => Promise<string>,
) {
  const parent = await open(DEFAULT_PROFILE_ID, 'ask')
  const parentTools = agentToolsFor(host, parent)
  const first = await createFirstWorkerTask(
    parentTools,
    'Build the world clock page',
    'build the world clock page',
  )
  return { parent, parentTools, first }
}
