import { refusalWords } from './refusal-words'
import { keyPolicy } from './api-key'
import { CodexUnavailableError } from './program'
import { NoCodexSignInOnThisComputerError, codexSignInTagIn } from '@brobot2/runtime/codex'
import type {
  IdentityHandle,
  IdentityFact,
  ProtocolNotice,
  ProviderAuthPolicy,
} from '../auth-policy'

/** Protocol housekeeping observed while an accepted give was being refused. */
const refusedLabels: ReadonlySet<string> = new Set([
  'thread/status/changed',
  'mcpServer/startupStatus/updated',
  'account/rateLimits/read',
])
/** Startup notifications a renewed conversation can publish before its retained give continues. */
const reopenedLabels: ReadonlySet<string> = new Set([
  ...refusedLabels,
  'remoteControl/status/changed',
  'account/updated',
  'skills/changed',
  'thread/goal/cleared',
])
/** A classified notification, never an erased event or an arbitrary provider payload. */
function lifecycle(event: ProtocolNotice, labels: ReadonlySet<string>): boolean {
  return (
    event.type === 'unknown' &&
    event.provider === 'codex' &&
    event.category === 'lifecycle' &&
    event.degradedFrom === undefined &&
    event.passing !== true &&
    event.label !== undefined &&
    labels.has(event.label)
  )
}
function tagOf(handle: IdentityHandle): IdentityFact {
  const tag = handle.signInTag?.() ?? null
  return tag === null ? null : { kind: 'tag', tag }
}

export const authPolicy: ProviderAuthPolicy = {
  refusalWords,
  // Every Codex agent on an account shares one sign-in, so a refusal is that account's. Codex's
  // own check reads only the file, so only a sign-in or a working turn ends it.
  remembersRejectedMachineLogin: {
    says: 'Codex refused this sign-in. Sign in again.',
    aCheckEndsIt: false,
    loginIn: codexSignInTagIn,
  },
  launchRefusal: (error) =>
    error instanceof NoCodexSignInOnThisComputerError
      ? 'no-copy'
      : error instanceof CodexUnavailableError
        ? 'program'
        : null,
  setup: () => null,
  renewedNotice: null,
  key: keyPolicy,
  identity: { waitsForAccount: false, launch: tagOf, limit: tagOf },
  // No agent holds a copy of its own to replace: a refused sign-in is signed in again.
  copy: {
    carriesAcceptedAfterAccountChange: true,
    same: () => false,
    refused: () => null,
  },
  protocol: {
    refusedGive: (event) =>
      lifecycle(event, refusedLabels) ||
      (event.type === 'unknown' &&
        event.provider === 'codex' &&
        event.category === 'echo' &&
        event.label === 'userMessage' &&
        event.degradedFrom === undefined &&
        event.passing !== true),
    reopenedGive: (event) =>
      lifecycle(event, reopenedLabels) ||
      (event.type === 'background_work' &&
        event.source === 'thread/backgroundTerminals/list' &&
        Array.isArray(event.running) &&
        event.running.length === 0 &&
        event.ended === undefined &&
        (event.dropped === undefined || event.dropped === 0) &&
        Object.keys(event).every((key) => ['type', 'source', 'running', 'dropped'].includes(key))),
  },
}
