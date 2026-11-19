import type { SessionHandle } from '@brobot2/runtime'
import type { AgentState } from '../../shared/agent-state-contracts'
import { sessionSpeakingAs, type Caller } from './conversation-caller'
import { admitInterrupt, refuseInterrupt } from './interrupt-rails'
import type { InterruptOutcome } from './message-records'

export interface ExplicitStopNotice {
  readonly asker: string
  readonly reason: string
  readonly interrupted: boolean | null
}

export function explicitStopWords(notice: ExplicitStopNotice, actor: string): string {
  return notice.interrupted === true
    ? `${actor}, stopped your turn: ${notice.reason}. Read what was recorded before continuing instead of redoing it.`
    : `${actor}, asked your turn to stop: ${notice.reason}. Read what was recorded before continuing instead of redoing it.`
}

interface RunningTurn {
  readonly handle: Pick<SessionHandle, 'status' | 'endEverythingTheTurnStarted'>
  readonly turnOpened: boolean
  readonly flushing: Promise<void> | null
  readonly handingOver: readonly unknown[]
}

export interface StopTurnInput {
  readonly conversation: string
  readonly caller: Caller
  readonly reason?: string
}

export interface StopTurnDependencies<Running extends RunningTurn> {
  readonly waitMs: number
  currentConversation(conversation: string): string
  findSlot(conversation: string): { session: Running | null; closing: boolean } | undefined
  isRecorded(conversation: string): boolean
  whoseAnswerItAwaits(conversation: string): string | null
  pendingApproval(conversation: string): string | null
  conversationLine(conversation: string): string
  waitForEnding(session: Running): Promise<readonly string[] | undefined>
  askToStop(session: Running, caller: Caller, reason?: string): Promise<void>
  reportUnanswered(session: Running, asked: Promise<void>, caller: Caller): void
  waitUntilSettled(asked: Promise<void>, ms: number): Promise<boolean>
  stateOf(conversation: string): AgentState
  stillRunningIn(conversation: string): readonly string[]
}

export async function stopTurn<Running extends RunningTurn>(
  { conversation, caller, reason }: StopTurnInput,
  deps: StopTurnDependencies<Running>,
): Promise<InterruptOutcome> {
  const id = deps.currentConversation(conversation)
  const slot = deps.findSlot(id)
  if (slot === undefined && !deps.isRecorded(id)) return { ok: false, refusal: 'no-such-agent' }
  const speaking = sessionSpeakingAs(caller)
  if (speaking !== null && deps.currentConversation(speaking) === id) {
    return { ok: false, refusal: 'that-agent-is-you' }
  }
  const result = (asked: boolean, ended?: readonly string[]): InterruptOutcome => ({
    ok: true,
    agent: id,
    asked,
    state: deps.stateOf(id),
    ...(ended === undefined ? {} : { ended }),
    stillRunning: deps.stillRunningIn(id),
  })
  if (slot === undefined || slot.closing) return result(false)
  const { session } = slot
  if (session === null) {
    return {
      ok: false,
      refusal: refuseInterrupt('that-conversation-has-not-started', { agent: id }),
    }
  }
  const status = session.handle.status()
  if (status === 'ended' || status === 'errored') return result(false)
  if (
    status === 'idle' &&
    !session.turnOpened &&
    session.flushing === null &&
    session.handingOver.length === 0
  ) {
    return result(false)
  }

  // A provider interruption would settle a parked card. Return before asking it to stop.
  const waitingOn = status === 'waiting_permission' ? deps.whoseAnswerItAwaits(id) : null
  const refusal = admitInterrupt(id, status, waitingOn)
  if (refusal !== null) {
    if (refusal.rail !== 'a-person-is-being-asked') return { ok: false, refusal }
    const approval = deps.pendingApproval(id)
    if (approval === null) return { ok: false, refusal }
    return {
      ok: false,
      refusal: {
        ...refusal,
        detail: { ...refusal.detail, approval },
        reason: `Not stopped: ${deps.conversationLine(id)} is waiting for the person to approve ${approval}, and only the person can settle that. Nothing was ended and your reason was not sent. The person can approve, deny or stop it themselves.`,
      },
    }
  }

  const ending = deps.waitForEnding(session)
  const asked = deps.askToStop(session, caller, reason)
  session.handle.endEverythingTheTurnStarted?.()
  deps.reportUnanswered(session, asked, caller)
  await deps.waitUntilSettled(asked, deps.waitMs)
  return result(true, await ending)
}
