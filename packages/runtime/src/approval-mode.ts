import { providerDescriptor, providerRecord, type Provider } from '@brobot2/shared'
import { NextTurnSetting } from './next-turn'
import type { ApprovalMode } from './runtime'

// Claude's delay is OURS, chosen: different timing would be a control that lies half the time.
export class ApprovalModeSwitch extends NextTurnSetting<ApprovalMode> {
  /** Absent resolves to `'ask'` — the same fail-safe direction as {@link isAutoApprove}. */
  constructor(initial: ApprovalMode | undefined) {
    super(initial === 'auto' ? 'auto' : 'ask')
  }

  /** Record what the user asked for. Exact-match opt-in: only `'auto'` turns approvals off. */
  override request(mode: ApprovalMode): void {
    super.request(mode === 'auto' ? 'auto' : 'ask')
  }
}

export type { ApprovalModeState } from './runtime'

// Provider descriptors own the protection rows; comparisons use absolute protections, not removed ones.
export const PROTECTIONS = [
  /** A person answers before an action runs. */
  'the-card-before-an-act',
  /** OS confinement around an action, when the provider supplies it. */
  'the-sandbox-around-an-act',
] as const

export type Protection = (typeof PROTECTIONS)[number]

/** A conversation's approval posture: the mode, and the provider that decides what the mode means. */
export interface ApprovalPosture {
  readonly provider: Provider
  readonly approvalMode: ApprovalMode
}

/** Absolute protections retained by each provider and approval mode. */
export const WHAT_STANDS_PAST_ITS_FOLDER: Readonly<
  Record<Provider, Readonly<Record<ApprovalMode, readonly Protection[]>>>
> = providerRecord((provider) => providerDescriptor(provider).approval.protections)

// Compare any protection against none, so differing protections do not introduce new refusals.
export function whatTheChildWouldLack(
  child: ApprovalPosture,
  parent: ApprovalPosture,
): readonly Protection[] {
  const keeps = ({ provider, approvalMode }: ApprovalPosture): readonly Protection[] =>
    WHAT_STANDS_PAST_ITS_FOLDER[provider][approvalMode]
  if (keeps(child).length > 0) return []
  const kept = keeps(parent)
  return PROTECTIONS.filter((one) => kept.includes(one))
}
