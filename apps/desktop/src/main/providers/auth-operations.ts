import type { AuthState, ReprovisionOutcome } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { ProviderSignIn, SignInCopySource } from './auth-types'

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
  signIn(provider: Provider, profileId: string, signal?: AbortSignal): Promise<ProviderSignIn>
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
    refused: unknown,
    stillWanted: () => boolean,
  ): Promise<SignInCopySource | 'not-tried'>
}
