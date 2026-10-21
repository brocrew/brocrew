import type { AuthState, ModelList, Provider, ProviderProgram } from '../../../shared/runtime-ipc'
import { theFormStartsOn, type HeldList } from './model-lists'

export function needsProviderSetup(detail: string): boolean {
  return /not signed in|not logged in|credentials expired|no (?:\w+ )?sign-in|auth\.json[^\n]*(?:not found|missing)|not installed|(?:spawn[^\n]*ENOENT)|no login/i.test(
    detail,
  )
}

/** Readiness from the window's existing sign-in, program and model-list answers. */
export function providerReady(
  held: HeldList | null,
  auth?: AuthState | null,
  program?: ProviderProgram | null,
): boolean | null {
  if (program?.standing === 'missing' || auth?.state === 'absent' || auth?.state === 'stale')
    return false
  const refused = held?.state === 'answered' ? held.list.notAsked : null
  const detail =
    held?.state === 'unread' ? held.why : refused?.reason === 'refused' ? refused.detail : ''
  if (needsProviderSetup(detail)) return false
  if (auth?.state === 'usable') return true
  return held?.state === 'answered' && held.list.notAsked === null ? true : null
}

export function readyProvider(
  preferred: Provider,
  ready: Readonly<Partial<Record<Provider, boolean | null>>>,
): Provider {
  if (ready[preferred] === true) return preferred
  return (
    (Object.keys(ready) as Provider[]).find((provider) => ready[provider] === true) ?? preferred
  )
}

export function defaultModel(list: ModelList | null) {
  const starts = theFormStartsOn(list)
  if (starts !== null) return starts
  const row = list?.models.find((model) => model.isDefault)
  return row === undefined ? null : { model: row.id, effort: row.defaultEffort ?? null }
}
