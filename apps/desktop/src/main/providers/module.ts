import type {
  AgentRuntime,
  AuthHealth,
  AuthState,
  CodexCopyIdentity,
  CodexCopySource,
  ReprovisionOutcome,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { CodexKeySeam, CodexSignIn } from './codex/types'

/**
 * The credential seams, defaulted to the real ones. They are injectable so tests —
 * and `pnpm run ci` — never read the machine Keychain or the personal `~/.codex`.
 */
export interface ProviderHomeSeams {
  provisionHome?: (managedRoot: string, providerHome: string) => void | Promise<void>
  provisionCodexAuth?: (providerHome: string) => void | Promise<void>
  /** Where this computer keeps its own Codex sign-in; `~/.codex/auth.json` when not given. */
  machineCodexAuthPath?: () => string
  claudeAuthHealth?: () => AuthHealth | Promise<AuthHealth>
  /** The API key a person entered for a provider, or null — see `api-keys.ts`. */
  apiKey?: (provider: Provider) => string | null | Promise<string | null>
  /** 🔒 The person's Codex key, and Codex's own login with it — see {@link CodexKeySeam}. */
  codexKey?: CodexKeySeam
  /** {@link ProviderRuntimeSeams.claudeProgramFound}. */
  claudeProgramFound?: () => string | null
}

/**
 * What the composition root must supply to build a runtime. `codexCommand` is the absolute path
 * of the codex executable the app ships (014) — REQUIRED, so no caller can fall back to the bare
 * `codex` PATH lookup that only ever worked on a developer's shell. It is a thunk, resolved per
 * launch inside `createSession`'s error path: a missing binary becomes the actionable command
 * error the surface shows, not a raw `spawn ENOENT` — and never at startup, where nothing could
 * display it. Claude launches never invoke it.
 */
export interface ProviderRuntimeSeams {
  managedProviderHomesRoot?: string
  codexCommand: () => string
  /**
   * The absolute path of the person's Claude Code (`claude-program.ts`). Called at every Claude
   * launch, so a program installed, moved or removed is seen by the next one; it throws the error a
   * person reads when there is none. Codex launches never call it.
   */
  claudeProgram: () => string
  /**
   * The API key a person entered for a provider, or null — see `api-keys.ts`. Read on every launch;
   * absent in tests and for a library caller, which then run on the machine login.
   */
  apiKey?: (provider: Provider) => string | null | Promise<string | null>
  /** 🔒 The person's Codex key, and Codex's own login with it — see {@link CodexKeySeam}. */
  codexKey?: CodexKeySeam
  keyStatus?: (provider: Provider) => { set: boolean; unreadableReason?: string }
  /** Where this computer keeps its own Codex sign-in; `~/.codex/auth.json` when not given. */
  machineCodexAuthPath?: () => string
  /**
   * The person's own Claude Code by its full path, or `null` when none is installed: what a sentence
   * tells them to run to sign in. Never a copy this app's own checkout carries. Absent: `null`.
   */
  claudeProgramFound?: () => string | null
}

/**
 * The three credential gestures a person can make about a profile home (098), composed here for the
 * same reason every other credential decision is: the runtime owns the mechanism and this module
 * owns which mechanism a provider gets.
 *
 * ⚠️ **`signIn` is the only one that ends the problem, and `reprovision` is the only one that is
 * cheap — they are not alternatives to each other, they are a fast fix and a real one.** See
 * `codex-login.ts` for the measurement of why re-copying breaks again.
 */
export interface ProviderAuthOps {
  /**
   * 🔴 **The home whose authentication state a gesture would change — the identity, not a
   * provisioning** (265 §2, from 259 lens B finding 2).
   *
   * ⛔ **Two writers reached one home with no shared admission.** `signIn` runs an OAuth flow the
   * app-server completes by writing `auth.json`; `reprovision` takes the provider-home lock and
   * atomically replaces the same file — and the app-server participates in no filesystem lock at
   * all. Either operation's success result can therefore be false: a re-copy reports `replaced` and
   * a pending OAuth overwrites it afterwards, or a sign-in probes account A as usable while a late
   * re-copy leaves account B's machine credential on disk. `RuntimeHost` serializes them, and it
   * needs a key to serialize them BY.
   *
   * ⚑ **Pure and synchronous — it is a name, not a directory.** An admission key that had to be
   * awaited would be taken after the window it is meant to close, and one that provisioned would
   * make asking the question create the very identity `assertProfileMayBeOpened` refuses to
   * manufacture (197 §2). Both real gestures still do their own resolving and their own refusing.
   *
   * ⚠️ **The `signIns` reservation does NOT subsume this and must not be re-keyed to it** (257 §1):
   * that one is provider-wide because the OAuth redirect PORT is, and this one is per home because
   * the credential file is. They are two resources and a gesture can need both.
   */
  credentialHome(provider: Provider, profileId: string): string
  /**
   * Ask the provider whether this profile's credential can run a turn. Never spends or refreshes it.
   *
   * ⛔ **`signal` reaches the app-server; the caller's deadline does not** (185). For Codex this
   * spawns a real detached child, and a host that has given up waiting has released only itself.
   */
  check(provider: Provider, profileId: string, signal?: AbortSignal): Promise<AuthState>
  /**
   * Re-copy the machine credential over the profile's. Explicit, user-initiated, does NOT end the race.
   *
   * ⚠️ **The union is what keeps every existing double honest** (243). The real implementation
   * became promise-returning when the provisioning lock did; a test double that answers
   * `'replaced'` outright is still describing the same gesture, and narrowing this to `Promise<…>`
   * would have made it a compile error to say so.
   */
  reprovision(
    provider: Provider,
    profileId: string,
  ): ReprovisionOutcome | Promise<ReprovisionOutcome>
  /**
   * Sign this profile into its own account. Resolves when the browser flow settles.
   *
   * ⛔ **`signal` is the only thing that can stop the sign-in before this resolves** (185): the
   * handle that cancels it does not exist until then, so the whole spawn-and-handshake interval is
   * otherwise unreachable by Cancel and by quit.
   */
  signIn(provider: Provider, profileId: string, signal?: AbortSignal): Promise<CodexSignIn>
  /**
   * 🔒 **Bring every existing home of a provider in line with its API key** — at once, when a
   * person saves or removes the key ({@link bringTheCodexKeyTo}); each home that cannot is brought
   * in line at its next launch instead. ⚑ Answers `null`, or a sentence saying how many could not.
   * Claude keeps nothing in its homes: always `null`.
   */
  bringTheKeyToItsHomes(provider: Provider): Promise<string | null>
  /**
   * Replace a profile's Codex sign-in that Codex has just refused with a fresh copy of the same
   * account, from this computer's own or BroBot's own, whichever Codex refreshed last and later than
   * the copy, only while the copy on disk is still the one that was refused (`refused`), and only
   * while whoever asked still wants it, asked again once the home's lock is held. Says
   * where the copy came from, or that none was made; never while an API key is saved,
   * never for Claude. BroBot's own profile is one of its own candidates, and is never later than
   * itself.
   */
  replaceARefusedCopy(
    provider: Provider,
    profileId: string,
    refused: CodexCopyIdentity,
    stillWanted: () => boolean,
  ): Promise<CodexCopySource | 'not-tried'>
}

/** Pure state paths and profile admission, bound once without creating a folder. */
export interface ProviderHomePaths {
  readonly managedRoot: string
  readonly defaultProfile: string
  homeOf(profileId: string): string
  profiles(): string[]
  assertMayOpen(profileId: string): void
}

/** A reservation names a state home; it does not identify the actual credential store. */
export type HomeAuthOperations = {
  [K in keyof ProviderAuthOps]: ProviderAuthOps[K] extends (
    provider: Provider,
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Result
    : never
}

/**
 * The provider chooses preparation; its credential services are bound separately from state paths.
 * Today state folders also establish profile existence. A later shared-login strategy must retain
 * those folders, or first provide a profile registry. Existing conversations keep their paths.
 */
export interface ProviderHomeStrategy {
  prepare(profileId: string): Promise<string>
}

export interface ProviderModule {
  /** A fresh runtime for this launch; the program is resolved only when called. */
  createRuntime(): AgentRuntime
  readonly home: ProviderHomeStrategy
  readonly auth: HomeAuthOperations
}
export type ProviderModules = Readonly<Record<Provider, ProviderModule>>
export interface ProviderModuleInputs {
  readonly runtime: ProviderRuntimeSeams
  readonly home: ProviderHomeSeams
  readonly auth: Omit<ProviderRuntimeSeams, 'claudeProgram'>
}
