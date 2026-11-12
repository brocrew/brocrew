import { providerSchema } from '@brobot2/shared'
import type { Provider } from '@brobot2/shared'
import type { AgentModelChoice } from '../../../shared/model-choice-contracts'

export function parseProvider(stored: string | null): Provider | null {
  return providerSchema.safeParse(stored).data ?? null
}

export function parseModelChoice(stored: string | null): AgentModelChoice | null {
  if (stored === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const said = raw as Record<string, unknown>
  const provider = parseProvider(typeof said['provider'] === 'string' ? said['provider'] : null)
  if (provider === null) return null
  const model = said['model']
  if (typeof model !== 'string' || model.trim() === '') return null
  const effort = said['effort']
  if (effort === null || effort === undefined) return { provider, model, effort: null }
  if (typeof effort !== 'string') return null
  return { provider, model, effort: effort.trim() === '' ? null : effort }
}

export function modelChoiceWritten(choice: AgentModelChoice | null): string | null {
  if (choice === null) return null
  return JSON.stringify({ provider: choice.provider, model: choice.model, effort: choice.effort })
}
