import { keyPolicy } from './api-key'
import type { ProviderAuthPolicy } from '../auth-policy'

export const authPolicy: ProviderAuthPolicy = {
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
