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

export async function openAndGiveToNewChild(
  personOpens: (profile: string) => Promise<string>,
  close: (conversation: string) => Promise<unknown>,
  toolsFor: (conversation: string) => AgentToolset,
  giverProfile: string,
  childProfile: string,
  title: string,
  brief: string,
) {
  await close(await personOpens(childProfile))
  const parent = await personOpens(giverProfile)
  const given = await callNewConversationGive(toolsFor(parent), childProfile, title, brief)
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  return { parent, child: given.agent as string }
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

export async function readSuccessfulRawGive(
  send: () => Promise<{ structured: Record<string, unknown> }>,
) {
  const given = await send()
  expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
  return given
}
