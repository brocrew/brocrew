import { refusalWords } from './refusal-words'
import { keyPolicy } from './api-key'
import { CLAUDE_LOGIN_RENEWED, ClaudeUnavailableError, claudeSetup } from '@brobot2/runtime'
import type { ProviderAuthPolicy } from '../auth-policy'

export const authPolicy: ProviderAuthPolicy = {
  refusalWords,
  launchRefusal: (error) => (error instanceof ClaudeUnavailableError ? 'program' : null),
  setup: (platform, installedPath) => claudeSetup(platform, installedPath()),
  renewedNotice: CLAUDE_LOGIN_RENEWED,
  key: keyPolicy,
  identity: {
    waitsForAccount: true,
    launch(handle) {
      const account = handle.account === undefined ? null : handle.account()
      if (account === undefined) return undefined
      if (account !== null) return { kind: 'account', account }
      const tag = handle.signInTag?.() ?? null
      return tag === null ? null : { kind: 'tag', tag, launchOnly: true }
    },
    limit(handle) {
      const account = handle.account?.()
      return account == null ? null : { kind: 'account', account }
    },
  },
  copy: {
    carriesAcceptedAfterAccountChange: false,
    same: () => false,
    refused: () => null,
  },
  protocol: {
    refusedGive: () => false,
    reopenedGive: () => false,
  },
}
