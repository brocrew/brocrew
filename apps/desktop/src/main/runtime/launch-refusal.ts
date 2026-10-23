import {
  AuthUnavailableError,
  folderAPersonMustFixOf,
  spawnNoWaitClearsOf,
  transientSetupFailureOf,
} from '@brobot2/runtime'
import type { LaunchRefusal } from '../../shared/runtime-ipc'
import { SUPPORTED_PROVIDERS } from '@brobot2/shared'
import { providerAuthPolicies } from '../providers/auth-definitions'
import { unavailableOf } from './session-unavailable'

/**
 * 🔴 **716 · `710` F-7 — the word for a start main refused, or `null` for a failure it does not
 * recognise** — see `LAUNCH_REFUSALS` (`shared/runtime-ipc.ts`) for the table and why it travels as an answer.
 *
 * ⚑ **Asked at the window's door and nowhere else** (`executeRuntimeCommand`), of what
 * `RuntimeHost.createSession` threw — so the host's throw is unchanged, and `give_work`, which
 * shares that door, goes on classifying it by type in its own words (`aLaunchThatDidNotStart`).
 *
 * ⚑ **By TYPE and closed reason, never by text** — the same readers `give_work` asks, in the same
 * order of nearness: a sign-in (`AuthUnavailableError`), a missing program (R66/R67's two classes),
 * then the refusal's own reason — which `refusalTranslated` carries as the `cause` of the sentence it
 * throws — then an errno no translation took: a spawn's (R51), a shortage (R52), a folder (R66).
 */
export function whyALaunchWasRefused(error: unknown): LaunchRefusal | null {
  // Settings held by a profile are a launch's to say; no sign-in fixes them.
  const native = SUPPORTED_PROVIDERS.map((provider) =>
    providerAuthPolicies[provider].launchRefusal(error),
  )
  if (native.includes('profile')) return 'launch'
  if (error instanceof AuthUnavailableError) return 'sign-in'
  if (native.includes('program')) return 'program'
  const reason =
    unavailableOf(error) ??
    (error instanceof Error ? unavailableOf((error as { cause?: unknown }).cause) : null)
  if (reason === 'machine-ran-short') return 'machine'
  if (reason === 'its-folder-could-not-be-made') return 'folder'
  if (reason === 'cancelled') return 'cancelled'
  if (reason !== null) return 'launch'
  if (spawnNoWaitClearsOf(error) !== null) return 'program'
  if (transientSetupFailureOf(error) !== null) return 'machine'
  if (folderAPersonMustFixOf(error) !== null) return 'folder'
  return null
}
