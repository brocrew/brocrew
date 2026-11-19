import type { ProviderTurnFailure, RuntimeEvent, TurnLimit } from '../events'

type TurnEvent = Extract<RuntimeEvent, { type: 'turn' }>

/** A provider failure records its error before the terminal turn. */
export function providerTurnEnding(
  outcome: TurnEvent['state'],
  errorMessage: string | undefined,
  limit: TurnLimit | undefined,
  marks: Pick<TurnEvent, 'startedBy' | 'endedCommands'>,
  refused: Pick<TurnEvent, 'loginRefused' | 'billingRefused' | 'onAKey'> = {},
  providerFailure?: ProviderTurnFailure,
): readonly RuntimeEvent[] {
  if (outcome !== 'failed') return [{ type: 'turn', state: outcome, ...marks }]
  return [
    { type: 'error', message: errorMessage ?? 'turn failed', fatal: false },
    {
      type: 'turn',
      state: 'failed',
      ...(providerFailure === undefined ? {} : { providerFailure }),
      ...(limit === undefined ? {} : { limit }),
      ...(refused.loginRefused === true ? { loginRefused: true } : {}),
      ...(refused.billingRefused === true ? { billingRefused: true } : {}),
      ...((refused.loginRefused === true || refused.billingRefused === true) &&
      refused.onAKey === true
        ? { onAKey: true }
        : {}),
      ...marks,
    },
  ]
}
