/**
 * Whether a profile's managed credential can drive a turn **right now** (098) — as a value the app
 * can switch on, never as a sentence it has to read.
 *
 * ## The defect this exists to close
 *
 * A stale managed credential can fail only after the person sends a message, with an error such as:
 *
 * > `turn failed: Your access token could not be refreshed because your refresh token was already`
 * > `used. Please log out and sign in again.`
 *
 * Every word of that is true and every word of it is written for whoever wrote Codex. It arrives
 * **after** the turn, as turn output, which is why it slipped past 085's conversion of seven throw
 * sites: it was never a refusal, it was a result. And the state it describes had been knowable for
 * days — the credential's own access token had expired at a timestamp sitting in a file on disk.
 *
 * So the rule here is 085's rule, applied one layer out: **the diagnostic stays verbatim on the
 * error's `message`, for the log and the ledger, and a value beside it says what happened** — so a
 * surface can offer the two ways out without matching English, and so the same state can be
 * discovered *before* a turn is spent instead of only after.
 *
 * ## Why `stale` and `absent` are different states
 *
 * They look identical to a user — "it will not run" — and they are opposite facts:
 *
 *  - **{@link AuthState.absent}** — there is no credential here at all. Nothing has been provisioned,
 *    or it was signed out. The way out is to put one in.
 *  - **{@link AuthState.stale}** — there IS one, it belongs to the right account, and it can no
 *    longer be used. Re-copying the machine credential fixes it *for now*; only a sign-in **inside
 *    the profile** stops it recurring, because the recurrence is caused by the copy sharing one
 *    rotating refresh token with the machine.
 *
 * Collapsing them would put "sign in" in front of a user whose profile is signed in perfectly well,
 * and it is the difference between a one-click fix and a browser round trip.
 *
 * ⚠️ **Nothing in this module ever carries a token.** Not an access token, not a refresh token, not
 * an id token, not an API key — not in `reason`, not in `account`, not in a log line built from
 * either. {@link AuthState.account} is an *identity* (the email the provider reports for the
 * signed-in account), which is what a person needs in order to answer "which profile am I on?" —
 * the question that started this ticket. A credential is what proves you are that account, and it
 * has no business anywhere near a UI.
 */

/**
 * Why there is no login to run on: none here, one that has expired, or a login file that is there
 * but could not be read just now.
 */
export type LoginAbsence = 'no-login' | 'expired' | 'unreadable'

/**
 * What a provider's managed credential can do for us at this instant.
 *
 * A discriminated union rather than `{ ok, reason? }` — the same argument 039's
 * `CapabilityStatus` makes: **an unusable credential cannot be declared without saying why in
 * words a user could read**, enforced by the type system rather than by remembering.
 */
export type AuthState =
  | {
      readonly state: 'usable'
      /**
       * Who this profile is signed in as, when the provider says — an email. Identity, never a
       * credential; see the module note.
       */
      readonly account?: string
      /**
       * What it runs on: a sign-in to an account, or an API key a person saved. ⚑ A saved key
       * outranks the sign-in, so `api-key` is what runs whenever one is saved.
       */
      readonly login: 'account' | 'api-key'
      /**
       * The provider's own word for the account's plan, when it is readable on this Mac without
       * asking the network — Claude's `subscriptionType` (`max`), Codex's `planType` (`plus`).
       * Absent otherwise, and for a key.
       */
      readonly plan?: string
      /**
       * When the login expires and the provider asks for a sign-in again, epoch ms — or `null`:
       * unknown, or a key, which does not expire. ⚑ Claude's is its refresh token's end; its
       * access token lasts hours and is renewed by Claude itself. Codex says none.
       */
      readonly expiresAt: number | null
      /**
       * On a saved key, whether the provider's own login is here too. Mac and Codex report only
       * item or file presence, never validity; Windows keeps its existing login-fact check.
       * `false` means no eligible backing login was found. Absent when unknown or running on a login.
       */
      readonly loginBehindTheKey?: boolean
    }
  | {
      readonly state: 'absent'
      /** Why there is nothing to use, in a sentence a person could act on. */
      readonly reason: string
      /** Which absence it is, for a surface that words it itself. Absent when the provider does not say. */
      readonly why?: LoginAbsence
    }
  | {
      readonly state: 'stale'
      /** Why the credential that IS here can no longer be used. */
      readonly reason: string
    }
  | {
      readonly state: 'unknown'
      /**
       * ⚠️ **We could not ask** — the probe itself failed, so this says nothing about the
       * credential.
       *
       * It exists so that a broken transport is never reported as a broken login. Callers must
       * treat it as "carry on and let the turn answer", not as a refusal: failing a launch closed
       * on an unanswerable question would turn every provider hiccup into "your sign-in expired",
       * which is the same fabrication in the other direction.
       */
      readonly reason: string
    }

/** Whether this credential can be used to run a turn. The one question every surface asks. */
/**
 * What a sign-in check that got no answer adds, so a person does not read it as signed out:
 * nothing was learned about the sign-in, and asking again is the next step.
 */
export const A_CHECK_NOT_ANSWERED_SAYS = 'That says nothing about the sign-in itself.'

/**
 * A sign-in check that ran out of time, in words: who was too slow, or `null` when the check as a
 * whole was (it may have waited its turn behind other starts).
 */
export function signInNotCheckedInTime(tooSlow: string | null): string {
  const who = tooSlow === null ? 'The check did not finish' : `${tooSlow} did not answer`
  return `${who} in time, so this sign-in was not checked. ${A_CHECK_NOT_ANSWERED_SAYS} Check again in a moment.`
}

export function isUsable(state: AuthState): boolean {
  return state.state === 'usable'
}

/**
 * Whether this state should STOP a launch.
 *
 * `stale` and `absent` are measured facts about the credential and are worth refusing on — the turn
 * would fail anyway, and refusing here is what makes the failure arrive *before* a message is spent
 * rather than after. `unknown` is not a fact about the credential at all (see above), so it never
 * blocks.
 */
export function blocksLaunch(state: AuthState): boolean {
  return state.state === 'stale' || state.state === 'absent'
}

/** The reason, for the states that have one; `''` for `usable`, which needs none. */
export function authStateReason(state: AuthState): string {
  return state.state === 'usable' ? '' : state.reason
}
