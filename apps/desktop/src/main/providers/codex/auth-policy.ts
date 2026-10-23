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

const refusedLabels: ReadonlySet<string> = new Set([
  'thread/status/changed',
  'mcpServer/startupStatus/updated',
  'account/rateLimits/read',
])
const reopenedLabels: ReadonlySet<string> = new Set([
  ...refusedLabels,
  'remoteControl/status/changed',
  'account/updated',
  'skills/changed',
  'thread/goal/cleared',
])
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
  identity: { launch: tagOf, limit: tagOf },
  copy: {
    read: codexCopyIdentityIn,
    same: (one, other) =>
      isTheSameCodexCopy(
        one as CodexCopyIdentity | null | undefined,
        other as CodexCopyIdentity | null | undefined,
      ),
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
