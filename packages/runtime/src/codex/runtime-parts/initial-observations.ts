import type { CodexTransport } from '../codex-transport'
import { RateLimitWatch, rateLimitUsage } from '../normalize'
import { wrapUnknown, type RuntimeEvent } from '../../events'
import { providerCommandsFrom } from './session-views'
import { RATE_LIMIT_READ } from './turn-state'

export function seedRateLimitBaseline(
  transport: CodexTransport,
  rateLimits: RateLimitWatch,
  emit: (event: RuntimeEvent) => void,
): void {
  const askedAt = Date.now()
  void (async () => {
    let response: unknown
    try {
      response = await transport.request('account/rateLimits/read', undefined)
    } catch (error) {
      emit(
        wrapUnknown(
          'codex',
          { method: RATE_LIMIT_READ, error: String(error) },
          'lifecycle',
          RATE_LIMIT_READ,
        ),
      )
      return
    }
    emit(
      wrapUnknown(
        'codex',
        { method: RATE_LIMIT_READ, result: response },
        'lifecycle',
        RATE_LIMIT_READ,
      ),
    )
    for (const line of rateLimits.seed(response, Date.now(), askedAt)) {
      emit({ type: 'error', message: line, fatal: false })
    }
    for (const bucket of rateLimits.heldReadings()) {
      const usage = rateLimitUsage(bucket)
      if (usage !== null) emit(usage)
    }
  })()
}

export function readProviderCommands(
  transport: CodexTransport,
  why: string,
  emit: (event: RuntimeEvent) => void,
): void {
  void (async () => {
    let response: unknown
    try {
      response = await transport.request('skills/list', {})
    } catch {
      return
    }
    emit(providerCommandsFrom(response, why))
  })()
}
