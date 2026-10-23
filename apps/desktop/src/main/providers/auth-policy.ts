import type { ApiKeyCheck } from '../../shared/runtime-ipc'
import type { ProviderSetup, SessionAccount, SessionHandle } from '@brobot2/runtime'

export type IdentityHandle = Pick<SessionHandle, 'account' | 'signInTag'>

/** Raw facts only; the host owns account waits, salts and persisted identity prefixes. */
export type IdentityFact =
  | { readonly kind: 'account'; readonly account: SessionAccount }
  | { readonly kind: 'tag'; readonly tag: string; readonly launchOnly?: true }
  | null

/** A classified protocol notice, with no native payload interpreted by the host. */
export interface ProtocolNotice {
  readonly type: string
  readonly provider?: string
  readonly category?: string
  readonly label?: string
  readonly degradedFrom?: unknown
  readonly passing?: boolean
  readonly source?: unknown
  readonly running?: unknown
  readonly ended?: unknown
  readonly dropped?: unknown
}

/** Native facts and comparisons are separate from bound credential and launch services. */
export interface ProviderAuthPolicy {
  /** A provider asks for its installed program only if its own setup steps need one. */
  setup(platform: NodeJS.Platform, installedPath: () => string | null): ProviderSetup | null
  readonly renewedNotice: string | null
  readonly key: {
    check(key: string, fetchFor?: typeof fetch): Promise<ApiKeyCheck>
    loginRunsWithoutAKey(platform?: NodeJS.Platform, readLogin?: () => string | null): boolean
  }
  readonly identity: {
    readonly waitsForAccount: boolean
    /** Undefined means that this life has not answered yet. */
    launch(handle: IdentityHandle): IdentityFact | undefined
    /** Never waits or supplies a launch-only fallback. */
    limit(handle: IdentityHandle): IdentityFact
  }
  readonly copy: {
    readonly carriesAcceptedAfterAccountChange: boolean
    read?(home: string): unknown | null
    same(one: unknown, other: unknown): boolean
    refused(error: unknown): unknown | null
  }
  readonly protocol: {
    refusedGive(event: ProtocolNotice): boolean
    reopenedGive(event: ProtocolNotice): boolean
  }
}
