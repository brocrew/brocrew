/**
 * # 🔴 The machine resources a credential gesture takes, held **per process** (293 §2)
 *
 * (289 rank 4 — Reviewer-26, round 5 lens E.)
 *
 * ## ⛔ The finding: two reservations that neither survived a teardown nor crossed a host
 *
 * `RuntimeHost` guarded both credential gestures with **private maps** — `signIns` for Codex's
 * provider-wide OAuth callback port, `credentialWrites` for the profile home an auth writer writes.
 * Three things were wrong with that, and they are three different sentences:
 *
 *  1. ⛔ **The port claim was dropped before the port was free.** `runSignIn` deleted its
 *     provider-wide entry in its `finally` and only THEN awaited `boundedCancel` — so sign-in B for
 *     another profile could start a second app-server on port 1455 while A's cancellation was still
 *     in flight. That is the exact collision `257` closed, reachable again through the door `257`
 *     did not look at.
 *  2. ⛔ **The credential claim was dropped on a THREE-SECOND bound.** `boundedCancel` stops waiting
 *     after `SIGN_IN_CANCEL_TIMEOUT_MS`; the app-server is not due to be gone until about t+8 s and
 *     may still land `auth.json`. A same-home re-copy admitted in that window is `265` §2 reopened
 *     from the other side.
 *  3. ⛔ **Neither map crossed a host.** `live-hosts.ts` explains at length why a second
 *     `RuntimeHost` in one process is reachable — *"one host per process is an invariant of the app
 *     rather than of this class"* — and `live-hosts.ts` itself exposes only ledger identity and
 *     session ids. So host A could begin OAuth for `work` while host B began a re-copy for `work`,
 *     each seeing an empty private map, and **the loser reports success for an account that is not
 *     the credential on disk.**
 *
 * ## ⚑ Why a module-level registry, and why it is not a durable one
 *
 * The same argument `live-hosts.ts` makes, and it is worth not re-deriving: a durable owner stamp —
 * a pid, a lease, a lock file — answers *"who claimed this"* and then has to answer *"is that
 * claimant still alive"*, which has no local answer. **A claim that can go stale is a claim that
 * will.** These claims are held by promises inside this process; when the process ends they end
 * with it, and nothing has to decide whether a corpse still owns a port.
 *
 * ⛔ **What this does NOT cover, said out loud, because `signInKey`'s own comment says the same
 * thing about the map it replaces:** the port is the MACHINE's. A second BroBot, or a `codex login`
 * typed into a terminal, collides exactly as before and nothing here can see it. `198`'s one-host
 * gate makes the second app improbable rather than impossible, and 293 does not change that.
 *
 * ## ⚠️ Ownership tokens, because an old `finally` must not erase a newer claim
 *
 * Every gesture in this file ends in a `finally`, and several of them can be reached twice on the
 * same path — a bounded wait that gave up, then the outer method's own release. A release keyed on
 * the KEY alone would let a claim that has already ended delete the claim that replaced it, which is
 * the guard removing itself. So a release names the claim it took, and a claim that is no longer the
 * holder releases nothing.
 */

/** What a caller needs back to reconstruct its own refusal, verbatim. */
interface HeldResource {
  /**
   * ⚠️ **Whatever the CALLER needs to say who is holding it** — a profile id for the OAuth port
   * (`signInHeldBy` names the profile), a gesture for a credential home (*"a sign-in"* / *"a
   * re-copy"*). This module never composes a sentence: 085's rule about what reaches a screen is the
   * call site's to keep, and a generic registry that invented wording would be a second voice.
   */
  readonly holder: string
  /** Identity, so a release can prove it is releasing its own claim and not its successor's. */
  readonly token: object
}

/**
 * Module-level, because the thing it models is the process — see the header, and `live-hosts.ts` for
 * the same decision made for the same reason.
 */
const held = new Map<string, HeldResource>()

/** A claim in hand. Releasing it is the holder's job, on every path, in a `finally`. */
export interface ResourceClaim {
  readonly key: string
  /**
   * Let go.
   *
   * ⛔ **`after` is the whole of finding 1 and 2**: pass the promise that settles when the thing
   * this claim is ABOUT is really finished — the un-deadlined provider teardown, not the bounded
   * wait a caller made on it — and the key stays held until then. Without an argument the claim goes
   * at once, which is right for a gesture whose work is over when it returns.
   *
   * ⚠️ **The FIRST call decides**, and later ones are no-ops. Both `signInProvider` and `runSignIn`
   * can reach a release on one path; the inner one is the one that knows what to wait for, and an
   * outer `finally` must not be able to shorten it.
   */
  release(after?: Promise<unknown>): void
}

/** Taken, or refused with the holder the caller has to name. */
export type ResourceClaimResult =
  | { readonly ok: true; readonly claim: ResourceClaim }
  | { readonly ok: false; readonly holder: string }

/**
 * Claim `key` for `holder`, or be refused.
 *
 * ⚠️ **Synchronous, so nothing runs between deciding and claiming.** The check-then-act this
 * replaces was already correct in `RuntimeHost` for that reason; it is restated here because a
 * registry that awaited anything would reintroduce it for every caller at once.
 */
export function claimResource(key: string, holder: string): ResourceClaimResult {
  const already = held.get(key)
  if (already !== undefined) return { ok: false, holder: already.holder }
  const token = {}
  held.set(key, { holder, token })
  let released = false
  const drop = (): void => {
    // ⛔ Only if this claim is still the holder. See the header on ownership tokens.
    if (held.get(key)?.token === token) held.delete(key)
  }
  return {
    ok: true,
    claim: {
      key,
      release(after) {
        if (released) return
        released = true
        if (after === undefined) {
          drop()
          return
        }
        // Settled either way: a teardown that REJECTED still ended, and a key held for the life of
        // the app because a cancel threw would be the guard becoming the outage.
        void Promise.resolve(after).then(drop, drop)
      },
    },
  }
}

/** Who holds `key`, or null. Diagnostics and tests; no admission decision is made from this. */
export function resourceHolder(key: string): string | null {
  return held.get(key)?.holder ?? null
}
