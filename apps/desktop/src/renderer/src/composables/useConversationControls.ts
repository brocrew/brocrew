import { computed, type ComputedRef } from 'vue'
import {
  YOLO_LABEL,
  type CreatedSession,
  type ProviderCapabilityMap,
  type SetSessionSettingInput,
} from '../../../shared/runtime-ipc'
import { LEAVE_PLAN_UNAVAILABLE } from '../lib/plan-mode'

/**
 * A conversation's plan and approval mode, and what is queued for its next message, as the agent
 * panel draws them: the Plan chip beside the model and effort, the approval mode beside the plate,
 * and the queued changes under the run strip.
 */
export interface ConversationControlsSources {
  readonly session: () => CreatedSession | null
  readonly capabilities: () => ProviderCapabilityMap | null
  /** Nothing set here would reach the conversation (`CreatedSession.settingsFixed`). */
  readonly fixed: () => boolean
  /** Drawn from its ledger: its next start leaves planning, so plan first is not offered. */
  readonly recorded: () => boolean
  readonly setApprovalMode: (mode: 'ask' | 'auto') => void
  readonly setSessionSetting: (body: SetSessionSettingInput['body']) => void
}

/** Said in every explanation of a change: no setting moves a turn already running. */
export const CHANGES_APPLY_NEXT = 'Changes apply from your next message.'

export const PLAN_OFF_WORD = 'Plan off'
export const PLANNING_WORD = 'Planning'

const NOT_A_SAFETY_GATE =
  'It is not a safety gate — a planning agent still runs commands; approvals are what gate those.'

/** The words a fixed conversation's controls say instead of offering a change. */
export const FIXED_SAYS =
  'This conversation’s settings can’t be changed from this window, so they are shown as they are.'
const RECORDED_PLAN_SAYS =
  'Its next start leaves planning, so plan first can’t be turned on from here.'

export interface PlanControl {
  /** What the chip shows: whether the conversation plans now, never what was asked for. */
  readonly word: string
  readonly state: 'off' | 'starting' | 'planning' | 'stopping' | 'deferred'
  /** Whether a press turns plan first on; elsewhere the chip is plain text. */
  readonly canTurnOn: boolean
  /** A change is queued for the next message, in either direction. */
  readonly pending: boolean
  readonly title: string
  /** The press's accessible name, where it is a press. */
  readonly label: string
}

export interface ApprovalControl {
  readonly mode: 'ask' | 'auto'
  readonly pending: 'ask' | 'auto' | null
  /** The mode now, as the button shows it. */
  readonly word: string
  /** Now and next, while a change is queued; `null` with nothing queued. */
  readonly pendingLine: string | null
  readonly changeable: boolean
  readonly label: string
  /** What the mode does now, and when a change applies. */
  readonly now: string
  /** The host's own line for the mode. */
  readonly note: string
  /** This provider's half of what yolo means; empty where its map has not arrived. */
  readonly reach: string
  /** What the confirm asks for: the other mode, or back to the current one while one is queued. */
  readonly next: 'ask' | 'auto'
  readonly confirmWords: string
}

export interface PendingLine {
  readonly cy: string
  readonly text: string
}

export interface ConversationControls {
  readonly plan: ComputedRef<PlanControl | null>
  readonly approval: ComputedRef<ApprovalControl | null>
  /** What is queued for the next message, against what runs now; empty with nothing queued. */
  readonly pending: ComputedRef<readonly PendingLine[]>
  turnPlanOn(): void
  chooseApproval(mode: 'ask' | 'auto'): void
}

const modeWord = (mode: 'ask' | 'auto'): string => (mode === 'auto' ? YOLO_LABEL : 'Ask')

export function useConversationControls(
  sources: ConversationControlsSources,
): ConversationControls {
  const plan = computed<PlanControl | null>(() => {
    const session = sources.session()
    if (session === null) return null
    const settings = session.settings
    const pending = settings.pendingPlanMode
    const planningTitle =
      pending === false
        ? 'This conversation is planning, and you have asked it to stop — that takes effect from your next message.'
        : `This conversation is planning: it proposes what it intends to do before acting. ${LEAVE_PLAN_UNAVAILABLE} ${NOT_A_SAFETY_GATE}`
    const text = (word: string, state: PlanControl['state'], title: string): PlanControl => ({
      word,
      state,
      canTurnOn: false,
      pending: pending !== null,
      title,
      label: '',
    })

    if (sources.fixed() || sources.recorded()) {
      if (settings.planMode) return text(PLANNING_WORD, 'planning', planningTitle)
      return text(PLAN_OFF_WORD, 'off', sources.fixed() ? FIXED_SAYS : RECORDED_PLAN_SAYS)
    }
    // The plan itself holds the go-ahead below the transcript, so the chip offers no second exit.
    if (session.planNeedsGoAhead) {
      return text(
        PLANNING_WORD,
        'deferred',
        'This conversation is planning. Below the transcript you can start work on the plan, or leave planning without approving it — both stop the proposing, and only the first says anything to the agent.',
      )
    }
    if (settings.planMode) {
      return text(PLANNING_WORD, pending === false ? 'stopping' : 'planning', planningTitle)
    }
    if (pending === true) {
      return text(
        PLAN_OFF_WORD,
        'starting',
        `Plan first is asked for, from your next message. ${NOT_A_SAFETY_GATE}`,
      )
    }
    return {
      word: PLAN_OFF_WORD,
      state: 'off',
      canTurnOn: true,
      pending: false,
      title: `Ask this conversation to work out what it intends to do and propose it, before acting. Applies from your next message. ${NOT_A_SAFETY_GATE}`,
      label: 'Plan first is off. Turn it on from your next message',
    }
  })

  const approval = computed<ApprovalControl | null>(() => {
    const session = sources.session()
    if (session === null) return null
    const mode = session.approvalMode
    const pending = session.pendingApprovalMode
    const auto = mode === 'auto'
    const word = auto ? `${YOLO_LABEL} now` : `${YOLO_LABEL} off`
    const nowSays = auto
      ? 'This session runs commands and edits files without asking, except what the provider’s own plan mode asks while it plans.'
      : 'This session asks what its provider’s own CLI asks by default.'
    const now = pending
      ? `${nowSays} You have asked it to ${pending === 'auto' ? 'stop asking' : 'start asking again'} — that ` +
        'takes effect from your next message, because neither provider can change the mode of a turn ' +
        'that is already running.'
      : `${nowSays} ${CHANGES_APPLY_NEXT}`
    // Indexed by the session's provider, never compared to one.
    const capabilities = sources.capabilities()
    const status = capabilities?.[session.provider]?.approvals
    const changeable = !sources.fixed()
    const next = (pending ?? mode) === 'auto' ? 'ask' : 'auto'
    const pendingLine = pending
      ? `${modeWord(mode)} now · ${modeWord(pending)} from your next message`
      : null
    return {
      mode,
      pending,
      word,
      pendingLine,
      changeable,
      label: `Approval mode: ${word}${pending ? `; ${modeWord(pending)} from your next message` : ''}`,
      now,
      note: session.approvalNote,
      reach: status?.state === 'available' ? (status.note ?? '') : '',
      next,
      confirmWords: pending
        ? auto
          ? `Keep ${YOLO_LABEL} on`
          : 'Keep asking'
        : next === 'auto'
          ? `Turn ${YOLO_LABEL} on from your next message`
          : 'Ask again from your next message',
    }
  })

  const pending = computed<readonly PendingLine[]>(() => {
    const session = sources.session()
    if (session === null) return []
    const settings = session.settings
    const lines: PendingLine[] = []
    const asked = (
      cy: string,
      noun: string,
      queued: { value: string | undefined } | null,
      runs: string | null,
    ): void => {
      if (queued === null) return
      const value = queued.value ?? 'the provider default'
      lines.push({
        cy,
        text: `${noun} ${value} is asked for${runs === null ? '' : `; ${runs} runs now`}.`,
      })
    }
    asked('card-pending-model', 'Model', settings.pendingModel, settings.model)
    asked(
      'card-pending-effort',
      'Effort',
      settings.pendingReasoningEffort,
      settings.reasoningEffort,
    )
    if (settings.pendingPlanMode === true && !settings.planMode) {
      lines.push({ cy: 'card-pending-plan', text: 'Plan first is asked for; it is off now.' })
    } else if (settings.pendingPlanMode === false && settings.planMode) {
      lines.push({
        cy: 'card-pending-plan',
        text: 'Leaving planning is asked for; it is planning now.',
      })
    }
    return lines
  })

  return {
    plan,
    approval,
    pending,
    turnPlanOn() {
      if (plan.value?.canTurnOn) sources.setSessionSetting({ kind: 'planMode', on: true })
    },
    chooseApproval(mode) {
      if (approval.value?.changeable) sources.setApprovalMode(mode)
    },
  }
}
