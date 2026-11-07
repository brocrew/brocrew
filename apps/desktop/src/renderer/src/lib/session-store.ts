import type { MoveRequestAck } from '../../../shared/move-contracts'
import type {
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
} from '../../../shared/question-contracts'
import type { McpServerRequestForAPerson } from '../../../shared/conversation-events'
import type { WhatEachConversationIsWaitingOn, WorkGivenOut } from '../../../shared/task-contracts'
import type { WhatAPickBecame } from '../../../shared/model-choice-contracts'
import type { HandedPath } from '../../../shared/attachment-contracts'
import { MOVE_WORDS } from '../../../shared/move-request'
import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import { hasSomethingToSend } from '../../../shared/runtime-ipc'

import type { WhoCalledWhom } from '../../../shared/who-called-whom'
import type { ProviderLimitSeen } from '../../../shared/provider-limit'
import type { LimitsDisplayAnswer } from '../../../shared/limits-display'
import type { StalledWork } from '../../../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../../shared/stopped-work'
import type { WorkIncident } from '../../../shared/work-incidents'
import type { WaitingOnWhoWrote } from '../../../shared/waiting-on-who-wrote'
import type { InstructionAskWaiting } from '../../../shared/own-instructions'

import type { RecentActivityReading } from '../../../shared/recent-activity'
import type { WorkspaceReading } from '../../../shared/workspace-reading'
import { activityOf, type WhatIsBeingDone } from '../../../shared/what-is-being-done'

import type { TheWholeForest } from '../../../shared/the-whole-forest'
import type {
  AnswerAck,
  ProviderAnswerAck,
  CreateSessionInput,
  PermissionDecision,
  ReleasedSession,
  ResumedSession,
  RuntimeBridge,
  SetSessionSettingInput,
  UserInputResponse,
  ChildWorkInput,
  ChildSendResult,
  ChildStateResult,
  CommandTail,
  ToolAnswer,
  ChildWorkResult,
  ResourceDrawing,
  ResourceReading,
  ResourceReveal,
  WorkflowOutputResult,
  InstructionSourceResult,
  RevealResult,
  ConfigFileResult,
  SessionPathTarget,
  LaunchRefusal,
  FirstMessageNotSent,
  ProcessMemory,
  RuntimeStatesMessage,
} from '../../../shared/runtime-ipc'
import { markAnswerRefused, markReopened, markRequestFailed } from './transcript'
import { createProviderBlockStore, type ProviderBlockStore } from './provider-limit-facts'
import {
  acceptEvent,
  acceptProviderBlock,
  acceptLiveness,
  adoptSession,
  createSessionRecord,
  foldHeldEvents,
  openWindow,
  prependOlder,
  reopenAtLatest,
  readableError,
  requestDraft,
  type SessionPhase,
  type SessionRecord,
} from './session-record'

const NEW_LAUNCH = 'new-conversation'

const PLACED_LAUNCH = 'placed-conversation'

export type FirstMessageCameTo =
  | { readonly sent: true; readonly openHere: boolean; readonly tookItsPlace?: string }
  | {
      readonly sent: false
      readonly refusal: FirstMessageNotSent['notSent']
      readonly openHere: boolean
      readonly tookItsPlace?: string
    }

export type LookedBy = 'press' | 'again'

export type LaunchDoor = 'front-door' | 'sheet'

class AnsweredRefusal extends Error {
  constructor(
    readonly reason: LaunchRefusal,
    said: string,
  ) {
    super(said)
  }
}

export type SendIntent = 'now' | 'interrupt' | 'queue'

export interface SessionStore {
  readonly providerBlocks: ProviderBlockStore
  hearProviderStates(message: RuntimeStatesMessage): void
  live: ComputedRef<SessionRecord[]>
  get(sessionId: string): SessionRecord | null
  isLive(sessionId: string): boolean
  launchError: Ref<string | null>
  launchRefusal: Ref<LaunchRefusal | null>
  resumeError: Ref<string | null>
  lookError: Ref<string | null>
  placedError: Ref<string | null>
  isLaunching(sessionId?: string): boolean
  isPlacing(): boolean

  create(
    input: CreateSessionInput,
    door?: LaunchDoor,
    refused?: (sentence: string) => void,
  ): Promise<string | null>
  resume(sessionId: string): Promise<string | null>
  look(sessionId: string, by?: LookedBy): Promise<string | null>
  forget(sessionId: string): void
  startAndSend(
    sessionId: string,
    text: string,
    attachments: readonly HandedPath[],
  ): Promise<FirstMessageCameTo | null>
  cancelLaunch(sessionId?: string): Promise<boolean>
  cancelPlaced(): Promise<boolean>
  attachOpen(): Promise<string[]>
  claim(sessionId: string): Promise<boolean>
  release(sessionId: string): Promise<ReleasedSession>
  questionsForAPerson(): Promise<LedgerWalk<PersonsQuestion> | null>
  decisionsForAPerson(): Promise<LedgerWalk<PersonsDecision> | null>
  limitsForAPerson(): Promise<LedgerWalk<ProviderLimitSeen> | null>
  readLimitsDisplay(): Promise<LimitsDisplayAnswer | null>
  stalledWorkForAPerson(): Promise<LedgerWalk<StalledWork> | null>
  stoppedWorkForAPerson(): Promise<LedgerWalk<StoppedWorkForAPerson> | null>
  workIncidentsForAPerson(): Promise<LedgerWalk<WorkIncident> | null>
  waitingOnWhoWroteForAPerson(): Promise<LedgerWalk<WaitingOnWhoWrote> | null>
  instructionAsksForAPerson(): Promise<readonly InstructionAskWaiting[] | null>
  mcpServerRequestsForAPerson(): Promise<readonly McpServerRequestForAPerson[] | null>
  readWorkspace(): Promise<WorkspaceReading | null>
  whatIsBeingDone(): Promise<WhatIsBeingDone | null>
  whatEachConversationIsWaitingOn(): Promise<WhatEachConversationIsWaitingOn | null>
  theWholeForest(): Promise<TheWholeForest | null>
  processMemory(): Promise<ProcessMemory | null>
  recentActivity(from: number, to: number): Promise<RecentActivityReading | null>
  workGivenBy(sessionId: string): Promise<LedgerWalk<WorkGivenOut> | null>
  whoCalledWhom(sessionId: string): Promise<WhoCalledWhom | null>
  send(
    sessionId: string,
    text: string,
    intent?: SendIntent,
    attachments?: readonly HandedPath[],
  ): Promise<boolean>
  queueMessage(sessionId: string, text: string): Promise<boolean>
  cancelQueuedMessage(sessionId: string, messageId: string): Promise<void>
  takeBackAndStop(sessionId: string, messageId: string): Promise<void>
  respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<string | null>
  decideMoveRequest(
    sessionId: string,
    requestId: string,
    decision: 'move' | 'here',
  ): Promise<MoveRequestAck>
  respondUserInput(
    sessionId: string,
    requestId: string,
    response: UserInputResponse,
  ): Promise<string | null>
  answerAction(
    sessionId: string,
    requestId: string,
    done: boolean,
    note: string,
  ): Promise<AnswerAck>
  interrupt(sessionId: string): Promise<void>
  stopBackgroundWork(sessionId: string, id: string): Promise<boolean>
  readCommandOutput(sessionId: string, toolCallId: string): Promise<CommandTail | null>
  readToolAnswer(sessionId: string, toolCallId: string): Promise<ToolAnswer | null>
  close(sessionId: string): Promise<boolean>
  loadOlder(sessionId: string): Promise<void>
  jumpToLatest(sessionId: string): Promise<void>
  readWorkflowOutput(sessionId: string, taskId: string): Promise<WorkflowOutputResult>
  readInstructionSource(sessionId: string, index: number): Promise<InstructionSourceResult>
  readResource(resourceId: string): Promise<ResourceReading>
  drawResource(resourceId: string): Promise<ResourceDrawing>
  revealResource(resourceId: string): Promise<ResourceReveal>
  revealPath(sessionId: string, target: SessionPathTarget): Promise<RevealResult>
  readConfigFile(sessionId: string, name: string): Promise<ConfigFileResult>
  readChildWork(sessionId: string, what: ChildWorkInput): Promise<ChildWorkResult>
  readChildState(sessionId: string, agentId: string): Promise<ChildStateResult>
  sendToChild(sessionId: string, agentId: string, text: string): Promise<ChildSendResult>
  refreshConfig(sessionId: string): Promise<void>
  setApprovalMode(sessionId: string, mode: 'ask' | 'auto'): Promise<void>
  endPlanMode(sessionId: string, text?: string): Promise<void>
  setSessionSetting(
    sessionId: string,
    body: SetSessionSettingInput['body'],
  ): Promise<WhatAPickBecame | null | undefined>
  dispose(): void
}

export function overTheWire(handed: readonly HandedPath[]): HandedPath[] {
  return handed.map(({ path, kind, outsideCwd }) => ({ path, kind, outsideCwd }))
}

export function answerNeverLeftThisWindow(cause: string | null): string {
  return (
    'that answer did not reach the conversation, so it is still waiting — ' +
    `you can send it again: ${cause ?? 'this window could not say why'}`
  )
}

function whatAnAnswerAckSays(ack: ProviderAnswerAck): string | null {
  if (ack.outcome === 'refused') return ack.reason
  if (ack.outcome === 'taken') return ack.reason ?? null
  return null
}

export const A_COMMAND_IS_WAITED_ON_MS = 15_000

export const A_COMMAND_HAS_NOT_ANSWERED =
  `Something you asked of this conversation has had no answer in ${A_COMMAND_IS_WAITED_ON_MS / 1_000} ` +
  'seconds. An answer may still come — this line goes once every answer has.'

export function createSessionStore(bridge: RuntimeBridge): SessionStore {
  const sessions = reactive(new Map<string, SessionRecord>())
  const providerBlocks = createProviderBlockStore()
  const approvalChoices = new Map<
    string,
    {
      requested: 'ask' | 'auto'
      nativePending: 'ask' | 'auto' | null
    }
  >()
  const launchError = ref<string | null>(null)
  const launchRefusal = ref<LaunchRefusal | null>(null)
  const resumeError = ref<string | null>(null)
  const lookError = ref<string | null>(null)
  const placedError = ref<string | null>(null)
  const inFlight = reactive(new Map<string, string>())
  const cancelled = new Set<string>()
  let launchCounter = 0
  const nextLaunchKey = (): string => `launch-${++launchCounter}`

  function slot(sessionId: string): SessionRecord {
    const existing = sessions.get(sessionId)
    if (existing) return existing
    const record = reactive(createSessionRecord(sessionId)) as SessionRecord
    sessions.set(sessionId, record)
    return record
  }

  function replayInto(record: SessionRecord, handed: ResumedSession): void {
    openWindow(record, handed.history)
    let epoch = record.liveFrom
    for (const past of handed.history.entries) {
      if (epoch !== null && past.ordinal >= epoch) {
        markReopened(record.control)
        epoch = null
      }
      acceptEvent(record, {
        sessionId: handed.sessionId,
        ordinal: past.ordinal,
        at: past.at,
        event: past.event,
        ...(past.humanFinal === undefined ? {} : { humanFinal: past.humanFinal }),
      })
    }
    if (epoch !== null) markReopened(record.control)
  }

  function adoptHandover(
    record: SessionRecord,
    handed: ResumedSession,
    providerReadAt: number,
  ): boolean {
    providerBlocks.acceptSession(handed, providerReadAt)
    if (record.meta !== null && record.phase !== 'recorded') return false
    if (handed.handover === 'recorded') {
      record.liveFrom = handed.liveFrom ?? null
      record.phase = 'recorded'
      replayInto(record, handed)
      record.meta = handed
      record.earlyLiveness = null
      return true
    }
    record.liveFrom = handed.handover === 'attached' ? (handed.liveFrom ?? null) : null
    replayInto(record, handed)
    if (handed.handover === 'resumed') {
      record.liveFrom = record.nextOrdinal
      markReopened(record.control)
    }
    if (handed.handover === 'attached' && handed.asHandedOver !== undefined) {
      record.control.status = handed.asHandedOver.status
      const activity = activityOf(handed.asHandedOver.told)
      if (activity !== null) record.control.activity = activity
    }
    record.phase = 'open'
    adoptSession(record, handed)
    if (phaseOf(record) === 'recorded') void store.look(record.sessionId, 'again')
    return true
  }

  function settleHeld(record: SessionRecord, mayLookAgain = true): void {
    if (record.phase !== 'recorded') {
      const wasOpen = record.phase === 'open'
      foldHeldEvents(record)
      if (wasOpen && phaseOf(record) === 'recorded' && mayLookAgain) {
        void store.look(record.sessionId, 'again')
      }
      return
    }
    record.earlyEvents = mayLookAgain
      ? record.earlyEvents.filter((held) => held.ordinal >= record.nextOrdinal)
      : []
    if (record.earlyEvents.length > 0) void store.look(record.sessionId, 'again')
  }

  async function takeBackOpenSessions(): Promise<string[]> {
    const providerReadAt = providerBlocks.beginRead()
    const attached = await bridge.attachOpen().catch((cause: unknown) => {
      console.warn('could not ask the host which sessions it is running:', cause)
      return []
    })
    const taken: string[] = []
    for (const session of attached) {
      if ((sessions.get(session.sessionId)?.handover ?? 0) > 0) continue
      try {
        if (adoptHandover(slot(session.sessionId), session, providerReadAt))
          taken.push(session.sessionId)
      } catch (cause) {
        console.warn(`could not take back session ${session.sessionId}:`, cause)
      }
    }
    return taken
  }

  const askedAbout = new Set<string>()

  function askAboutUnknown(sessionId: string): void {
    if ((sessions.get(sessionId)?.handover ?? 0) > 0) return
    if (askedAbout.has(sessionId)) return
    askedAbout.add(sessionId)
    void takeBackOpenSessions()
  }

  const phaseOf = (record: SessionRecord): SessionPhase => record.phase

  const unsubscribeEvents = bridge.onEvent((message) => {
    const record = sessions.get(message.sessionId)
    if (record?.meta && record.handover === 0 && record.phase !== 'recorded') {
      acceptEvent(record, message)
      if (phaseOf(record) === 'recorded') void store.look(message.sessionId, 'again')
    } else if (record?.meta && record.handover === 0) {
      record.earlyEvents.push(message)
      void store.look(message.sessionId, 'again')
    } else {
      slot(message.sessionId).earlyEvents.push(message)
      if (!record?.meta) askAboutUnknown(message.sessionId)
    }
  })

  const unsubscribeLiveness = bridge.onLiveness((message) => {
    providerBlocks.accept(message.sessionId, message.liveness)
    const record = slot(message.sessionId)
    const choice = approvalChoices.get(message.sessionId)
    if (choice && message.liveness.approval)
      choice.nativePending = message.liveness.approval.pendingApprovalMode
    acceptLiveness(record, message.liveness)
    if (choice && record.meta)
      record.meta = {
        ...record.meta,
        pendingApprovalMode:
          choice.requested === record.meta.approvalMode ? null : choice.requested,
      }
  })

  const commandsInFlight = new WeakMap<SessionRecord, number>()

  const bounds = new Set<ReturnType<typeof setTimeout>>()

  async function forSession<T>(
    sessionId: string,
    action: (record: SessionRecord) => Promise<T>,
  ): Promise<{ ok: boolean; value?: T }> {
    const record = sessions.get(sessionId)
    if (!record) return { ok: false }
    commandsInFlight.set(record, (commandsInFlight.get(record) ?? 0) + 1)
    record.busy = true
    record.error = null
    let counted = true
    const countDown = (): void => {
      if (!counted) return
      counted = false
      const stillOut = (commandsInFlight.get(record) ?? 1) - 1
      commandsInFlight.set(record, stillOut)
      record.busy = stillOut > 0
    }
    const bound = setTimeout(() => {
      bounds.delete(bound)
      countDown()
      record.unanswered += 1
    }, A_COMMAND_IS_WAITED_ON_MS)
    bounds.add(bound)
    try {
      return { ok: true, value: await action(record) }
    } catch (cause) {
      noteFailure(record, cause)
      return { ok: false }
    } finally {
      clearTimeout(bound)
      bounds.delete(bound)
      if (counted) countDown()
      else record.unanswered -= 1
    }
  }

  function noteFailure(record: SessionRecord, cause: unknown): void {
    record.error = readableError(cause)
  }

  function markSent(sessionId: string, requestId: string): void {
    const record = sessions.get(sessionId)
    if (!record) return
    const draft = requestDraft(record, requestId)
    draft.sent = true
    draft.answered = true
  }

  function noteAnswer(
    sessionId: string,
    requestId: string,
    ok: boolean,
    ack: ProviderAnswerAck | undefined,
  ): void {
    if (ok && ack?.outcome === 'taken' && ack.reason !== undefined) {
      const kept = sessions.get(sessionId)
      if (!kept) return
      markRequestFailed(kept.transcript, requestId, ack.reason)
      if (kept.control !== kept.transcript) markRequestFailed(kept.control, requestId, ack.reason)
      return
    }
    if (ok && ack?.outcome !== 'refused') return
    const record = sessions.get(sessionId)
    if (!record) return
    const message =
      ack?.outcome === 'refused' ? ack.reason : answerNeverLeftThisWindow(record.error)
    const mark =
      !ok || (ack?.outcome === 'refused' && ack.stillOpen) ? markAnswerRefused : markRequestFailed
    mark(record.transcript, requestId, message)
    if (record.control !== record.transcript) mark(record.control, requestId, message)
    requestDraft(record, requestId).sent = false
    if (mark === markAnswerRefused) requestDraft(record, requestId).answered = false
  }

  async function forLaunch<T>(
    into: Ref<string | null>,
    gesture: string,
    action: (launchKey: string) => Promise<T>,
    refused?: (sentence: string) => void,
  ): Promise<T | undefined> {
    const key = nextLaunchKey()
    inFlight.set(gesture, key)
    launchError.value = null
    resumeError.value = null
    placedError.value = null
    launchRefusal.value = null
    try {
      return await action(key)
    } catch (cause) {
      const answered = cause instanceof AnsweredRefusal ? cause.reason : null
      if (answered === 'cancelled') return undefined
      if (!cancelled.has(key)) {
        const said = readableError(cause)
        if (gesture === NEW_LAUNCH && inFlight.get(gesture) === key) launchRefusal.value = answered
        if (inFlight.get(gesture) === key) into.value = said
        refused?.(said)
      }
      return undefined
    } finally {
      cancelled.delete(key)
      if (inFlight.get(gesture) === key) inFlight.delete(gesture)
    }
  }

  async function cancelGesture(gesture: string): Promise<boolean> {
    const key = inFlight.get(gesture)
    if (key === undefined) return false
    cancelled.add(key)
    try {
      const stopped = await bridge.cancelLaunch({ launchKey: key })
      if (!stopped) cancelled.delete(key)
      return stopped
    } catch (cause) {
      cancelled.delete(key)
      console.warn('could not stop this launch:', cause)
      return false
    }
  }

  const store: SessionStore = {
    providerBlocks,
    hearProviderStates(message) {
      providerBlocks.acceptMany(message.moved)
      for (const moved of message.moved) {
        const record = sessions.get(moved.conversation)
        if (record) acceptProviderBlock(record, moved)
      }
    },
    live: computed(() =>
      [...sessions.values()].filter(
        (record) => record.phase !== 'recorded' && record.meta !== null,
      ),
    ),

    get: (sessionId) => sessions.get(sessionId) ?? null,

    isLive: (sessionId) => {
      const record = sessions.get(sessionId)
      return record !== undefined && record.phase !== 'recorded' && record.meta !== null
    },

    launchError,
    launchRefusal,
    resumeError,
    lookError,
    placedError,

    isLaunching: (sessionId) => inFlight.has(sessionId ?? NEW_LAUNCH),
    isPlacing: () => inFlight.has(PLACED_LAUNCH),

    async create(input, door = 'front-door', refused) {
      const providerReadAt = providerBlocks.beginRead()
      const created = await forLaunch(
        door === 'sheet' ? placedError : launchError,
        door === 'sheet' ? PLACED_LAUNCH : NEW_LAUNCH,
        async (launchKey) => {
          const answer = await bridge.createSession({ ...input, launchKey, answerARefusal: true })
          if ('refused' in answer) {
            throw new AnsweredRefusal(answer.refused.reason, answer.refused.said)
          }
          return answer
        },
        refused,
      )
      if (!created) return null
      providerBlocks.acceptSession(created, providerReadAt)
      adoptSession(slot(created.sessionId), created)
      return created.sessionId
    },

    async resume(sessionId) {
      if (this.isLive(sessionId)) {
        resumeError.value = null
        return sessionId
      }
      const record = slot(sessionId)
      const providerReadAt = providerBlocks.beginRead()
      record.handover += 1
      try {
        const resumed = await forLaunch(resumeError, sessionId, (launchKey) =>
          bridge.resume({ sessionId, launchKey }),
        )
        if (!resumed) {
          if (record.meta === null) sessions.delete(sessionId)
          return null
        }
        const opened = resumed.sessionId
        const into = opened === sessionId ? record : slot(opened)
        adoptHandover(into, resumed, providerReadAt)
        if (opened !== sessionId && record.meta === null) sessions.delete(sessionId)
        return sessions.get(opened) === into ? opened : null
      } finally {
        record.handover -= 1
        if (record.handover === 0 && sessions.get(sessionId) === record) settleHeld(record)
      }
    },

    async look(sessionId, by = 'press') {
      if (this.isLive(sessionId)) {
        lookError.value = null
        return sessionId
      }
      const holding = slot(sessionId)
      const providerReadAt = providerBlocks.beginRead()
      holding.handover += 1
      lookError.value = null
      let looked = false
      try {
        const handed = await bridge.look({ sessionId, claim: by === 'press' })
        const into = handed.sessionId === sessionId ? holding : slot(handed.sessionId)
        adoptHandover(into, handed, providerReadAt)
        looked = true
        return sessions.get(handed.sessionId) === into ? handed.sessionId : null
      } catch (cause) {
        if (holding.meta === null) sessions.delete(sessionId)
        lookError.value = readableError(cause)
        return null
      } finally {
        holding.handover -= 1
        if (holding.handover === 0 && sessions.get(sessionId) === holding) {
          settleHeld(holding, looked && by === 'press')
        }
      }
    },

    forget(sessionId) {
      const record = sessions.get(sessionId)
      if (record === undefined || record.phase !== 'recorded' || record.handover > 0) return
      if ((commandsInFlight.get(record) ?? 0) > 0) return
      sessions.delete(sessionId)
      askedAbout.delete(sessionId)
      void bridge.stopLooking({ sessionId }).catch((cause: unknown) => {
        console.warn(`could not tell the host this window stopped looking at ${sessionId}:`, cause)
      })
    },

    async startAndSend(sessionId, text, attachments) {
      const starting = slot(sessionId)
      const providerReadAt = providerBlocks.beginRead()
      starting.error = null
      starting.handover += 1
      try {
        const answer = await forLaunch(resumeError, sessionId, (launchKey) =>
          bridge.startAndSend({
            sessionId,
            text,
            ...(attachments.length === 0 ? {} : { attachments: overTheWire(attachments) }),
            launchKey,
          }),
        )
        if (answer === undefined) {
          if (starting.meta === null) sessions.delete(sessionId)
          else if (resumeError.value !== null) starting.error = resumeError.value
          return null
        }
        const tookItsPlace = (handed: ResumedSession): string | null =>
          handed.sessionId === sessionId ? null : handed.sessionId
        if ('sent' in answer) {
          const went = tookItsPlace(answer.sent)
          adoptHandover(went === null ? starting : slot(went), answer.sent, providerReadAt)
          if (went !== null && starting.meta === null) sessions.delete(sessionId)
          return {
            sent: true,
            openHere: this.isLive(went ?? sessionId),
            ...(went === null ? {} : { tookItsPlace: went }),
          }
        }
        const refusal = answer.notSent
        const said = refusal.launch === 'cancelled' ? null : refusal.said
        if (refusal.running !== null) {
          const went = tookItsPlace(refusal.running)
          const running = went === null ? starting : slot(went)
          adoptHandover(running, refusal.running, providerReadAt)
          if (this.isLive(went ?? sessionId)) {
            running.error = said
            return {
              sent: false,
              refusal,
              openHere: true,
              ...(went === null ? {} : { tookItsPlace: went }),
            }
          }
        }
        if (starting.meta === null) sessions.delete(sessionId)
        else starting.error = said
        return { sent: false, refusal, openHere: false }
      } finally {
        starting.handover -= 1
        if (starting.handover === 0 && sessions.get(sessionId) === starting) settleHeld(starting)
      }
    },

    cancelLaunch: (sessionId) => cancelGesture(sessionId ?? NEW_LAUNCH),
    cancelPlaced: () => cancelGesture(PLACED_LAUNCH),

    attachOpen: takeBackOpenSessions,

    async claim(sessionId: string): Promise<boolean> {
      const holding = slot(sessionId)
      const providerReadAt = providerBlocks.beginRead()
      holding.handover += 1
      try {
        const handed = await bridge.claim({ sessionId })
        return adoptHandover(slot(handed.sessionId), handed, providerReadAt)
      } catch (error) {
        if (holding.meta === null) sessions.delete(sessionId)
        throw error
      } finally {
        holding.handover -= 1
        if (holding.handover === 0 && sessions.get(sessionId) === holding) settleHeld(holding)
      }
    },

    async release(sessionId) {
      const released = await bridge.release({ sessionId })
      const record = sessions.get(released.sessionId)
      if (record !== undefined) {
        record.phase = 'recorded'
        void store.look(released.sessionId, 'again')
      }
      askedAbout.delete(released.sessionId)
      return released
    },

    async questionsForAPerson(): Promise<LedgerWalk<PersonsQuestion> | null> {
      try {
        return await bridge.questionsForAPerson()
      } catch {
        return null
      }
    },

    async decisionsForAPerson(): Promise<LedgerWalk<PersonsDecision> | null> {
      try {
        return await bridge.decisionsForAPerson()
      } catch {
        return null
      }
    },

    async limitsForAPerson(): Promise<LedgerWalk<ProviderLimitSeen> | null> {
      try {
        return await bridge.limitsForAPerson()
      } catch {
        return null
      }
    },
    async readLimitsDisplay(): Promise<LimitsDisplayAnswer | null> {
      try {
        return await bridge.readLimitsDisplay()
      } catch {
        return null
      }
    },
    async stalledWorkForAPerson(): Promise<LedgerWalk<StalledWork> | null> {
      try {
        return await bridge.stalledWorkForAPerson()
      } catch {
        return null
      }
    },
    async stoppedWorkForAPerson(): Promise<LedgerWalk<StoppedWorkForAPerson> | null> {
      try {
        return await bridge.stoppedWorkForAPerson()
      } catch {
        return null
      }
    },
    async workIncidentsForAPerson(): Promise<LedgerWalk<WorkIncident> | null> {
      try {
        return await bridge.workIncidentsForAPerson()
      } catch {
        return null
      }
    },
    async waitingOnWhoWroteForAPerson(): Promise<LedgerWalk<WaitingOnWhoWrote> | null> {
      try {
        return await bridge.waitingOnWhoWroteForAPerson()
      } catch {
        return null
      }
    },
    async instructionAsksForAPerson(): Promise<readonly InstructionAskWaiting[] | null> {
      try {
        return await bridge.instructionAsksForAPerson()
      } catch {
        return null
      }
    },
    async mcpServerRequestsForAPerson(): Promise<readonly McpServerRequestForAPerson[] | null> {
      try {
        return await bridge.mcpServerRequestsForAPerson()
      } catch {
        return null
      }
    },
    async readWorkspace(): Promise<WorkspaceReading | null> {
      try {
        return await bridge.readWorkspace()
      } catch {
        return null
      }
    },
    async whatIsBeingDone(): Promise<WhatIsBeingDone | null> {
      try {
        return await bridge.whatIsBeingDone()
      } catch {
        return null
      }
    },
    async whatEachConversationIsWaitingOn(): Promise<WhatEachConversationIsWaitingOn | null> {
      try {
        return await bridge.whatEachConversationIsWaitingOn()
      } catch {
        return null
      }
    },
    async theWholeForest(): Promise<TheWholeForest | null> {
      try {
        return await bridge.theWholeForest()
      } catch {
        return null
      }
    },
    async processMemory(): Promise<ProcessMemory | null> {
      try {
        return await bridge.processMemory()
      } catch {
        return null
      }
    },
    async recentActivity(from: number, to: number): Promise<RecentActivityReading | null> {
      try {
        return await bridge.recentActivity({ from, to })
      } catch {
        return null
      }
    },

    async workGivenBy(sessionId: string): Promise<LedgerWalk<WorkGivenOut> | null> {
      try {
        return await bridge.workGivenBy({ sessionId })
      } catch {
        return null
      }
    },

    async whoCalledWhom(sessionId: string): Promise<WhoCalledWhom | null> {
      try {
        return await bridge.whoCalledWhom({ sessionId })
      } catch {
        return null
      }
    },

    async send(sessionId, text, intent = 'now', attachments = []) {
      if (!hasSomethingToSend(text, attachments.length)) return true
      const { ok } = await forSession(sessionId, async (record) => {
        const input = {
          sessionId,
          text,
          ...(attachments.length > 0 ? { attachments: overTheWire(attachments) } : {}),
        }
        if (intent === 'interrupt') return await bridge.sendInterrupting(input)
        if (intent === 'queue') {
          await bridge.queueMessage(input)
          return
        }
        if (record.control.status !== 'idle') {
          await bridge.queueMessage(input)
          return
        }
        await bridge.send(input)
      })
      return ok
    },

    async queueMessage(sessionId, text) {
      if (text.trim() === '') return true
      const { ok } = await forSession(sessionId, () => bridge.queueMessage({ sessionId, text }))
      return ok
    },

    async cancelQueuedMessage(sessionId, messageId) {
      await forSession(sessionId, () => bridge.cancelQueuedMessage({ sessionId, messageId }))
    },

    async takeBackAndStop(sessionId, messageId) {
      await forSession(sessionId, () => bridge.takeBackAndStop({ sessionId, messageId }))
    },

    async respondPermission(sessionId, requestId, decision) {
      if (!sessions.has(sessionId)) {
        try {
          return whatAnAnswerAckSays(
            await bridge.respondPermission({ sessionId, requestId, decision }),
          )
        } catch (cause) {
          return answerNeverLeftThisWindow(readableError(cause))
        }
      }
      markSent(sessionId, requestId)
      const { ok, value } = await forSession(sessionId, () =>
        bridge.respondPermission({ sessionId, requestId, decision }),
      )
      noteAnswer(sessionId, requestId, ok, value)
      if (!ok) return answerNeverLeftThisWindow(sessions.get(sessionId)?.error ?? null)
      return value === undefined ? null : whatAnAnswerAckSays(value)
    },

    async decideMoveRequest(sessionId, requestId, decision) {
      markSent(sessionId, requestId)
      try {
        const ack = await bridge.decideMoveRequest({ sessionId, requestId, decision })
        noteAnswer(
          sessionId,
          requestId,
          true,
          ack.outcome === 'refused'
            ? { outcome: 'refused', reason: ack.reason, stillOpen: true }
            : { outcome: 'taken' },
        )
        return ack
      } catch (cause) {
        const reason = readableError(cause) || MOVE_WORDS.notRecorded
        noteAnswer(sessionId, requestId, true, { outcome: 'refused', reason, stillOpen: true })
        return { outcome: 'refused', reason }
      }
    },

    async respondUserInput(sessionId, requestId, response) {
      if (!sessions.has(sessionId)) {
        try {
          const ack = await bridge.respondUserInput({ sessionId, requestId, response })
          return whatAnAnswerAckSays(ack)
        } catch (cause) {
          return answerNeverLeftThisWindow(readableError(cause))
        }
      }
      markSent(sessionId, requestId)
      const { ok, value } = await forSession(sessionId, () =>
        bridge.respondUserInput({ sessionId, requestId, response }),
      )
      noteAnswer(sessionId, requestId, ok, value)
      if (!ok) return answerNeverLeftThisWindow(sessions.get(sessionId)?.error ?? null)
      return value === undefined ? null : whatAnAnswerAckSays(value)
    },

    async answerAction(sessionId, requestId, done, note) {
      const ack = await bridge.answerAction({
        sessionId,
        request: requestId,
        done,
        ...(note === '' ? {} : { note }),
      })
      const record = sessions.get(sessionId)
      if (ack.outcome === 'refused' && !ack.stillOpen && record) {
        markRequestFailed(record.transcript, requestId, ack.reason)
        if (record.control !== record.transcript)
          markRequestFailed(record.control, requestId, ack.reason)
      }
      return ack
    },

    async interrupt(sessionId) {
      await forSession(sessionId, () => bridge.interrupt({ sessionId }))
    },

    async stopBackgroundWork(sessionId, id) {
      const record = sessions.get(sessionId)
      if (!record) return false
      record.error = null
      try {
        return await bridge.stopBackgroundWork({ sessionId, id })
      } catch (cause) {
        noteFailure(record, cause)
        return false
      }
    },

    async readCommandOutput(sessionId, toolCallId) {
      try {
        return await bridge.readCommandOutput({ sessionId, toolCallId })
      } catch {
        return null
      }
    },

    async readToolAnswer(sessionId, toolCallId) {
      try {
        return await bridge.readToolAnswer({ sessionId, toolCallId })
      } catch {
        return null
      }
    },

    async loadOlder(sessionId) {
      const record = sessions.get(sessionId)
      if (!record || !record.window.hasOlder) return
      const before = record.window.from
      const { ok, value: page } = await forSession(sessionId, () =>
        bridge.earlierHistory({ sessionId, before }),
      )
      if (!ok || !page) return
      const latest = sessions.get(sessionId)
      if (!latest || latest.window.from !== before) return
      prependOlder(latest, page)
    },

    async readWorkflowOutput(sessionId, taskId) {
      try {
        return await bridge.readWorkflowOutput({ sessionId, taskId })
      } catch {
        return { ok: false, reason: 'no-output' }
      }
    },

    async readInstructionSource(sessionId, index) {
      try {
        return await bridge.readInstructionSource({ sessionId, index })
      } catch {
        return { ok: false, reason: 'no-source' }
      }
    },

    async readResource(resourceId) {
      try {
        return await bridge.readResource({ resourceId })
      } catch {
        return { ok: false, reason: 'no-store' }
      }
    },

    async drawResource(resourceId) {
      try {
        return await bridge.drawResource({ resourceId })
      } catch {
        return { ok: false, reason: 'no-store' }
      }
    },

    async revealResource(resourceId) {
      try {
        return await bridge.revealResource({ resourceId })
      } catch {
        return { ok: false, reason: 'no-store' }
      }
    },

    async revealPath(sessionId, target) {
      try {
        return await bridge.revealPath({ sessionId, target })
      } catch {
        return { ok: false, reason: 'no-path' }
      }
    },

    async readConfigFile(sessionId, name) {
      try {
        return await bridge.readConfigFile({ sessionId, name })
      } catch {
        return { ok: false, reason: 'no-path' }
      }
    },

    async readChildWork(sessionId, what) {
      try {
        return await bridge.readChildWork({ sessionId, ...what })
      } catch {
        return { ok: false, reason: 'unknown-agent' }
      }
    },

    async readChildState(sessionId, agentId) {
      try {
        return await bridge.readChildState({ sessionId, agentId })
      } catch {
        return { ok: false, reason: 'unreachable' }
      }
    },

    async sendToChild(sessionId, agentId, text) {
      try {
        return await bridge.sendToChild({ sessionId, agentId, text })
      } catch {
        return { ok: false, reason: 'unreachable' }
      }
    },

    async jumpToLatest(sessionId) {
      const record = sessions.get(sessionId)
      if (!record || record.window.atTail) return
      const { ok, value: page } = await forSession(sessionId, () =>
        bridge.latestHistory({ sessionId }),
      )
      if (!ok || !page) return
      const latest = sessions.get(sessionId)
      if (!latest) return
      reopenAtLatest(latest, page)
    },

    async close(sessionId) {
      const asked = sessions.get(sessionId)
      const was = asked?.phase
      if (was === 'open' || was === 'opening') asked!.phase = 'closing'
      const { ok } = await forSession(sessionId, () => bridge.close({ sessionId }))
      const record = sessions.get(sessionId)
      if (!record) return ok
      if (ok) record.phase = 'recorded'
      else if (record.phase === 'closing' && was !== undefined) record.phase = was
      return ok
    },

    async refreshConfig(sessionId) {
      const { value: config } = await forSession(sessionId, () =>
        bridge.refreshConfig({ sessionId }),
      )
      const record = sessions.get(sessionId)
      if (config && record?.meta) record.meta = { ...record.meta, config }
    },

    async setApprovalMode(sessionId, mode) {
      const record = sessions.get(sessionId)
      if (!record?.meta) return
      const choice = { requested: mode, nativePending: record.meta.pendingApprovalMode }
      approvalChoices.set(sessionId, choice)
      record.meta = {
        ...record.meta,
        pendingApprovalMode: mode === record.meta.approvalMode ? null : mode,
      }
      const { value: disclosure } = await forSession(sessionId, () =>
        bridge.setApprovalMode({ sessionId, mode }),
      )
      if (approvalChoices.get(sessionId) !== choice) return
      approvalChoices.delete(sessionId)
      if (record.meta)
        record.meta = disclosure
          ? { ...record.meta, ...disclosure }
          : { ...record.meta, pendingApprovalMode: choice.nativePending }
    },

    async setSessionSetting(sessionId, body) {
      const { value: changed } = await forSession(sessionId, () =>
        bridge.setSessionSetting({ sessionId, body }),
      )
      const record = sessions.get(sessionId)
      if (changed && record?.meta) record.meta = { ...record.meta, settings: changed.settings }
      return changed?.thePick
    },
    async endPlanMode(sessionId, text) {
      await forSession(sessionId, () =>
        bridge.endPlanMode({ sessionId, ...(text === undefined ? {} : { text }) }),
      )
    },

    dispose() {
      approvalChoices.clear()
      providerBlocks.dispose()
      unsubscribeEvents()
      unsubscribeLiveness()
      for (const bound of bounds) clearTimeout(bound)
      bounds.clear()
      sessions.clear()
    },
  }
  return store
}
