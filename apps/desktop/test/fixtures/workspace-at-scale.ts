import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentState } from '../../src/shared/agent-state'
import type {
  AgentIdentity,
  ProcessMemory,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import type { ConversationWaiting, WhatEachConversationIsWaitingOn } from '../../src/shared/tasks'
import type { ForestNode, TheWholeForest } from '../../src/shared/the-whole-forest'
import type { WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'

/**
 * A fictional workspace at the size a busy person runs: one conversation with 300 children among
 * 700 listed conversations, 60 identities, about 3,000 pieces of work, and the waits of every
 * running conversation. Children are the oldest rows, so a search of the list finds each of them
 * late, as it does in a real workspace where a long-running parent's helpers sink below newer work.
 */

export const NOW = 1_800_000_000_000
export const OWNER = 'fictional-owner'
const CWD = '/fictional/work'

export interface WorkspaceSize {
  readonly children: number
  readonly conversations: number
  readonly identities: number
  readonly piecesPerConversation: number
}

export const REALISTIC: WorkspaceSize = {
  children: 300,
  conversations: 700,
  identities: 60,
  piecesPerConversation: 4,
}

export const childId = (index: number): string => `fictional-child-${String(index + 1)}`
export const otherId = (index: number): string => `fictional-other-${String(index + 1)}`

const NAMES = ['Maple', 'Cedar', 'Willow', 'Aspen', 'Hazel', 'Rowan', 'Birch', 'Alder', 'Linden']

export function identityAt(index: number): AgentIdentity {
  const slug = `fictional-role-${String(index + 1)}`
  return {
    id: `aid:${slug}`,
    slug,
    displayName: `${NAMES[index % NAMES.length]!} ${String(index + 1)}`,
    createdAt: 1,
    createdBy: null,
    provider: 'codex',
    externalMcpServerIds: [],
    capabilities: { ...DEFAULT_CAPABILITIES },
    chosen: {
      maxDepth: 'default',
      canMessage: 'default',
      canAssignWork: 'default',
      canCreateAgents: 'default',
      canWriteRules: 'default',
    },
  } as AgentIdentity
}

/** Which state a conversation is in: one in five working, the rest idle. */
export const stateAt = (index: number): AgentState =>
  index % 5 === 0 ? { is: 'active' } : { is: 'idle' }

function row(
  sessionId: string,
  index: number,
  identities: readonly AgentIdentity[],
  over: Partial<ResumableSessionInfo> = {},
): ResumableSessionInfo {
  return {
    provider: 'codex',
    cwd: CWD,
    status: 'idle',
    state: stateAt(index),
    named: { label: `W9.${String(index + 1)}`, title: `Fictional piece ${String(index + 1)}` },
    approvalMode: 'ask',
    profileId: identities[index % identities.length]!.slug,
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    child: null,
    lastEnding: 'completed',
    running: 'unwatched',
    sessionId,
    ref: { provider: 'codex', sessionId: `thread-${sessionId}`, cwd: CWD, rotation: 0 },
    resumeRefusal: null,
    updatedAt: NOW - 1_000 * (index + 1),
    ...over,
  } as ResumableSessionInfo
}

export interface WorkspaceAtScale {
  readonly identities: readonly AgentIdentity[]
  readonly resumable: ResumableSessionInfo[]
  readonly unresumable: UnresumableSessionInfo[]
  readonly cast: WhoCalledWhom
  readonly forest: TheWholeForest
  readonly waits: WhatEachConversationIsWaitingOn
  readonly memory: ProcessMemory
  readonly atWork: WhatIsBeingDone
}

export function workspaceAtScale(size: WorkspaceSize = REALISTIC): WorkspaceAtScale {
  const identities = Array.from({ length: size.identities }, (_, index) => identityAt(index))
  const others = size.conversations - size.children - 1
  const resumable: ResumableSessionInfo[] = [
    row(OWNER, 0, identities, { running: 'in-a-window', state: { is: 'active' } }),
  ]
  for (let index = 0; index < others; index++)
    resumable.push(row(otherId(index), index + 1, identities))
  for (let index = 0; index < size.children; index++) {
    // Every tenth child is a numbered worker of the owner, as a parallel give makes one.
    const worker =
      index % 10 === 9
        ? {
            worker: {
              identity: identities[0]!.id,
              giver: OWNER,
              number: index + 2,
              bornAs: childId(index),
            },
          }
        : {}
    resumable.push(row(childId(index), others + 1 + index, identities, worker))
  }
  // A personal conversation found in a provider's own folder: the list never shows it.
  const unresumable: UnresumableSessionInfo[] = [
    {
      sessionId: 'fictional-found-at-home',
      provider: 'codex',
      cwd: '/fictional/elsewhere',
      status: 'ended',
      running: 'not-running',
      state: { is: 'idle' },
      named: null,
      profileId: null,
      adoptedAt: NOW - 172_800_000,
      updatedAt: NOW - 7_200_000,
      hasTranscript: true,
      lastEnding: 'completed',
      foundInUserHome: true,
      restoredFromBundle: false,
      reason: 'a fictional conversation found in its provider folder',
    } as UnresumableSessionInfo,
  ]

  const children: SpawnEdge[] = Array.from({ length: size.children }, (_, index) => ({
    conversation: childId(index),
    identity: identities[(others + 1 + index) % identities.length]!.slug,
    provider: 'codex',
    running: 'unwatched',
  }))
  const given: WorkEdge[] = Array.from({ length: size.children }, (_, index) => ({
    piece: `fictional-piece-owner-${String(index + 1)}`,
    label: `W1.${String(index + 1)}`,
    title: `Fictional task ${String(index + 1)}`,
    from: OWNER,
    fromIdentity: identities[0]!.slug,
    to: childId(index),
    toIdentity: identities[(others + 1 + index) % identities.length]!.slug,
    state: index % 3 === 0 ? 'answered' : 'working',
    givenAt: NOW - 60_000,
    endedAt: null,
  })) as WorkEdge[]
  const walk = <Row>(rows: readonly Row[], kind: string) => ({
    rows,
    walk: kind,
    ledgers: rows.length,
    rowsUnread: 0,
  })
  const cast = {
    conversation: OWNER,
    readAt: NOW,
    parent: null,
    children: walk(children, 'every-conversation-this-one-spawned'),
    workGivenOut: walk(given, 'every-conversation-this-one-gave-work-to'),
    workTakenIn: walk([], 'every-piece-of-work-this-one-was-given'),
  } as unknown as WhoCalledWhom

  const nodes: ForestNode[] = []
  for (const listed of resumable) {
    nodes.push({
      node: 'a-conversation',
      conversation: listed.sessionId,
      under: listed.sessionId.startsWith('fictional-child-')
        ? { is: 'a-conversation', conversation: OWNER }
        : { is: 'the-person' },
      identity: listed.profileId,
      provider: 'codex',
      status: 'idle',
      running: listed.running,
      standsInFor: [],
      inItsPlace: null,
      startedAt: NOW - 600_000,
      updatedAt: listed.updatedAt,
    } as unknown as ForestNode)
    for (let piece = 0; piece < size.piecesPerConversation; piece++) {
      nodes.push({
        node: 'a-task',
        under: { is: 'a-conversation', conversation: listed.sessionId },
        givenBy: { is: 'a-conversation', conversation: OWNER },
        work: {
          piece: `fictional-piece-${listed.sessionId}-${String(piece)}`,
          label: `W2.${String(piece)}`,
          title: `Fictional work ${String(piece)} of ${listed.sessionId}`,
          from: OWNER,
          fromIdentity: identities[0]!.slug,
          to: listed.sessionId,
          toIdentity: listed.profileId,
          state: piece % 2 === 0 ? 'working' : 'answered',
          givenAt: NOW - 30_000,
          endedAt: null,
        },
      } as unknown as ForestNode)
    }
  }
  const forest = {
    readAt: NOW,
    nodes: {
      rows: nodes,
      walk: 'every-conversation-this-app-placed',
      ledgers: resumable.length,
      rowsUnread: 0,
    },
    conversations: resumable.length,
    heldByNoAgent: 0,
  } as unknown as TheWholeForest

  const running = resumable.filter((listed) => listed.running !== 'not-running')
  const waits: WhatEachConversationIsWaitingOn = {
    readAt: NOW,
    rowsUnread: 2,
    conversations: running.map((listed, index): ConversationWaiting => {
      if (listed.sessionId === OWNER)
        return {
          conversation: OWNER,
          identity: identities[0]!.slug,
          waiting: 'waiting-on-a-worker',
          work: null,
          needsYou: false,
          waitingOnTheAnswerOf: null,
          waitingOnTheWorkOf: ['Maple 1'],
          waitingOnTheWorkSince: NOW - 60_000,
          stoppedWork: [],
        }
      return {
        conversation: listed.sessionId,
        identity: listed.profileId ?? 'default',
        waiting: index % 7 === 0 ? 'waiting-on-an-answer' : null,
        work: null,
        needsYou: false,
        waitingOnTheAnswerOf: index % 7 === 0 ? 'Maple 1' : null,
        waitingOnTheWorkOf: [],
        stoppedWork: [],
      }
    }),
  }
  const memory: ProcessMemory = {
    conversations: running.map((listed, index) => ({
      conversation: listed.sessionId,
      bytes: 100_000_000 + index,
    })),
  }
  const atWork: WhatIsBeingDone = { readAt: NOW, conversations: [] }
  return { identities, resumable, unresumable, cast, forest, waits, memory, atWork }
}
