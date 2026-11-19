import type { AgentToolset } from '@brobot2/runtime'
import { agentCallerId } from '../../src/main/runtime/conversation-caller'
import { expect } from 'vitest'
import type { SessionStore } from '../../src/main/db/session-store'
import { agentToolsFor } from '../../src/main/runtime/agent-tools'
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

export function addressedGive<To, Profile>(to: To, profile: Profile, title: string, brief: string) {
  return { to, definition_of_done: definitionOfDone, profile, title, brief }
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

export async function openGiverAndGivePages(
  open: () => Promise<{ sessionId: string }>,
  settle: () => Promise<unknown>,
  give: (giver: string, title: string, to: string) => Promise<{ ada: string; piece: string }>,
) {
  const { sessionId: brobot } = await open()
  await settle()
  const { ada, piece } = await give(brobot, 'Build the pages', 'new')
  return { brobot, ada, piece }
}

export function spawnFailureFixture(
  open: (profile: string) => Promise<string>,
  close: (conversation: string) => Promise<unknown>,
  send: (
    caller: string,
    name: 'give_work',
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
) {
  return {
    aPmThatMaySpawn: () => openPmWithSeededWorker(open, close),
    spawnWorker: (pm: string) =>
      send(pm, 'give_work', newConversationGive('worker', 'The work', 'the work')),
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
