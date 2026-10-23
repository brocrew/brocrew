import {
  CodexRefusedItsSignInError,
  codexCopyIdentityIn,
  isTheSameCodexCopy,
  type CodexCopyIdentity,
} from '@brobot2/runtime'
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

/** Only this provider interprets its opaque file identity. */
function isCopy(value: unknown): value is CodexCopyIdentity {
  if (typeof value !== 'object' || value === null) return false
  const copy = value as Partial<CodexCopyIdentity>
  return (
    typeof copy.dev === 'bigint' &&
    typeof copy.ino === 'bigint' &&
    typeof copy.size === 'bigint' &&
    typeof copy.mtimeNs === 'bigint'
  )
}

export const authPolicy: ProviderAuthPolicy = {
  identity: { waitsForAccount: false, launch: tagOf, limit: tagOf },
  copy: {
    read: codexCopyIdentityIn,
    same: (one, other) => isCopy(one) && isCopy(other) && isTheSameCodexCopy(one, other),
    refused: (error) => (error instanceof CodexRefusedItsSignInError ? error.refusedCopy : null),
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
    reopenedGive: (event) => lifecycle(event, reopenedLabels),
  },
}
