import type { ProviderLimitSeen } from '../provider-limit'
import type { AuthState, ProviderCapabilities } from '@brobot2/runtime'
import type { KeptRulesFile } from '@brobot2/runtime/provider-module'
import type { Provider } from '@brobot2/shared'

/**
 * 🔒 **Where a provider's API key stands** — what the Providers screen draws. ⛔ Never the key.
 */
export interface ApiKeyStatus {
  readonly provider: Provider
  /** A key is saved for this provider. */
  readonly set: boolean
  /** When it was saved, or `null` when none is. */
  readonly setAt: number | null
  /**
   * The key is what this provider's agents start on: it is set, and this Mac can read it. ⚑ A set
   * key outranks the provider's login from each conversation's next start; one already running may
   * go on with what it started with until it starts again.
   */
  readonly inUse: boolean
  /** A key is saved but can't be used: a start of this provider refuses, with the reason. */
  readonly readState?: 'unreadable'
  readonly unreadableReason?: string
  /**
   * The account this key belongs to can't pay: a turn on it, or a check, was refused for billing at
   * `at` (epoch ms). Absent when nothing on this key has been refused since it was saved, or a turn
   * or a check on it has worked since. Known only while the app runs.
   */
  readonly refusedForBilling?: {
    readonly at: number
    /**
     * Whether removing the key leaves a login this provider runs on here: Claude reads the Mac's own
     * login and has none on Windows; Codex has its own sign-in on either.
     */
    readonly aLoginRunsWithoutIt: boolean
  }
  /**
   * A check sends one one-token request after the provider's free model list, because that list is
   * answered even for a key whose account can't pay. Absent when the check spends nothing.
   */
  readonly aCheckSpendsAToken?: true
}

/**
 * 🔒 **What saving or removing a key answers**: where it stands now, and — never the key —
 * `refused` when it was not kept, words to act on; `notice` when it was, but a provider could not
 * be told everywhere yet (Codex profiles that are updated at their next start).
 */
export type ApiKeyChanged = ApiKeyStatus & {
  readonly refused?: string
  readonly notice?: string
}

/** Every provider's kept rules, file by file ({@link KeptRulesFile}). */
export type KeptRules = Readonly<Record<Provider, readonly KeptRulesFile[]>>

/** What Remove did: the rule is gone from its file, or why it was not removed. */
export type KeptRuleRemoved =
  { readonly removed: true } | { readonly removed: false; readonly why: string }

/**
 * ⚑ **One reading of a provider's metered window** — the newest one this app has seen, whether or
 * not it is near a limit. ⚑ `window` is the provider's own word for it (Claude's `five_hour`,
 * Codex's *a 7-day window*); `usedPercent` 0–100; `resetsAt` and `at` epoch ms. A field the
 * provider has not said is `null`.
 */
export interface ProviderUsageReading {
  readonly window: string
  /** Core warning for this current reading; absent on older serialized readings. */
  readonly warning?: ProviderLimitSeen | null
  /** Core interpretation of the raw window; absent on older serialized readings. */
  readonly period?: {
    readonly word: string | null
    readonly durationMs: number | null
    readonly bucket: boolean
    readonly bucketName: string | null
  }
  readonly usedPercent: number | null
  readonly resetsAt: number | null
  /** When this app received it. */
  readonly at: number
  /**
   * Kept from before this app last started, and not yet shown to be the current sign-in's: no
   * conversation has reported usage since. It is shown with its age and raises no warning. The
   * provider's next reading settles it: it stays if it was read on the same sign-in, and goes if not.
   */
  readonly unconfirmed?: true
}

/**
 * ⚑ **F096 — a metered window a provider has reported, and when** — first and last, epoch ms.
 * ⚑ A record of which windows arrive, not of the account's figures: it stays when the readings are
 * forgotten at a login change, so it can say whether a window (Claude's `seven_day`) comes at all.
 */
export interface UsageWindowSeen {
  readonly window: string
  readonly first: number
  readonly last: number
}

/**
 * ⚑ **What the agent processes this app started for one provider use right now** — counted from
 * this app's own record of the processes it spawned, each with the processes it started in turn
 * (its tool commands). ⚑ `running` is how many conversations of that provider have a process;
 * `rssBytes` and `cpuPercent` are their sum, or `null` with a sentence when they could not be read.
 * ⚠️ `cpuPercent` is the system's own recent average for each process, so 100 is one full core.
 */
export type ProviderResources = {
  readonly running: number
  /** When it was measured, epoch ms. */
  readonly at: number
} & (
  | { readonly rssBytes: number; readonly cpuPercent: number }
  | { readonly rssBytes: null; readonly cpuPercent: null; readonly reason: string }
)

/**
 * ⚑ **A provider fact moved** — its `login` (a key saved or removed, a sign-in, a copy, or the
 * machine login found to have changed), or its `usage` (a new reading, or the readings forgotten
 * because what it runs on changed). ⚑ A window that draws them asks again:
 * {@link RuntimeBridge.checkProviderAuth}, {@link RuntimeBridge.providerUsage}.
 */
export interface ProvidersChangedMessage {
  /** `key`: whether the saved key's account can pay moved ({@link ApiKeyStatus.refusedForBilling}). */
  readonly what: 'login' | 'usage' | 'key'
  readonly provider: Provider
}

export interface ProviderConfigFile {
  name: string
  path: string
  exists: boolean
  /** What this file is — worth saying whether or not it is there. */
  note: string
}

/** Where a session's provider config lives, and how that provider is configured at all. */
export interface ProviderConfigInfo {
  /** The isolated per-profile home. */
  home: string
  /** The environment variable the adapter pins that home to. */
  homeEnv: string
  /** How this provider takes configuration — file-based, or programmatic via the SDK. */
  model: string
  /** Where the credential lives when it is not one of `files`; null when it is one of them. */
  authNote: string | null
  /** The files worth reporting for this provider, each with its real state. */
  files: ProviderConfigFile[]
}

/**
 * Every provider's declared capabilities, keyed by provider (039).
 *
 * A MAP rather than one provider's answer, because the surface that needs it — the launcher — has
 * no session yet and changes provider live. Handing over the whole thing lets that surface answer
 * the select by *looking the provider up*, which is the one shape that does not require it to write
 * a provider's name down. The renderer is forbidden from writing one down; the gate is
 * `apps/desktop/test/provider-neutrality.test.ts`.
 *
 * It crosses as data rather than being imported, for the reason at the top of this file: the
 * renderer must not pull the provider adapters into its bundle. Every type here is erased at build
 * time — a value would not be.
 */
export type ProviderCapabilityMap = Record<Provider, ProviderCapabilities>

/**
 * Which profile's credential a question is about (098).
 *
 * The profile is optional and absent means the default, matching `createSession` — and it matters
 * that it is here at all: a credential belongs to a profile home, so "is Codex signed in?" is not a
 * question with one answer.
 */
export interface CheckProviderAuthInput extends ProviderProfileInput {
  /** Explicit user gesture only; passive refreshes must omit this. */
  probe?: boolean
}

/** The result of a person's request to replace this install's profile sign-ins. */
export interface ProviderHomesReprovision {
  readonly replaced: number
  readonly pending: number
  readonly skipped: number
  readonly failed: number
  readonly profiles: readonly (
    | { readonly profileId: string; readonly state: 'replaced' | 'pending' }
    | {
        readonly profileId: string
        readonly state: 'skipped'
        readonly reason: 'api-key' | 'key-status-unavailable' | 'unchanged'
      }
    | {
        readonly profileId: string
        readonly state: 'failed'
        readonly reason: 'copy-failed' | 'restart-failed' | 'stop-failed'
      }
  )[]
}

export interface ProviderProfileInput {
  provider: Provider
  profileId?: string
}

/**
 * How a sign-in ended.
 *
 * `state` is re-asked of the provider rather than inferred from `success` — a flow can report itself
 * complete and still leave nothing usable behind, and the surface must show what is true rather than
 * what was attempted. `detail` is the provider's own diagnostic; ⚠️ **it is never a credential**, and
 * every producer of it is a sentence about the flow, not about the token.
 */
export interface ProviderSignInResult {
  /** Opaque completion words; success and state remain the actual sign-in result. */
  presentation?: { readonly message: string }
  success: boolean
  detail?: string
  state: AuthState
}
