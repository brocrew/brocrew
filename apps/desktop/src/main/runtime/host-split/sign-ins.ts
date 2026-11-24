import { A_CHECK_NOT_ANSWERED_SAYS, signInNotCheckedInTime } from '@brobot2/runtime'
import { type Provider } from '@brobot2/shared'
import { signInKey } from '../../providers/sign-in-reservation-facts'
import type { ProviderSignIn } from '../../providers/auth-types'

/**
 * How long a sign-in may stay open before the host gives up on it (098).
 *
 * Five minutes is the OAuth flow's own comfortable ceiling — open a browser, sign in, approve — and
 * the bound exists for the person who closes the tab and walks away: without it, the app-server
 * holding the loopback redirect port would live for the rest of the app's run.
 */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

/**
 * How long a credential CHECK may take before it is reported as unaskable (098, review finding 14).
 *
 * For Codex the check spawns a real app-server — measured at ~0.6 s — so ten seconds is generous.
 * The bound is not about speed: without it a wedged spawn leaves the renderer's buttons disabled on
 * a promise that can never settle, which is a worse answer than "could not ask".
 */
const AUTH_CHECK_TIMEOUT_MS = 10_000

/**
 * What a sign-in check the host could not get an answer to says. A check that ran out of time is
 * said apart from one that failed: it may only have waited its turn behind other starts.
 */
export function signInNotChecked(tooSlow: boolean): string {
  return tooSlow
    ? signInNotCheckedInTime(null)
    : `BroCrew could not ask about this sign-in, so it was not checked. ${A_CHECK_NOT_ANSWERED_SAYS} Check again.`
}

/**
 * How long to wait for a sign-in to acknowledge its own cancellation (098, review findings 12/13).
 *
 * `account/login/cancel` is a request to the very app-server that may have stopped answering, and a
 * `finally` that waited on it forever would defeat the deadline it runs after. Short, because the
 * process is reaped by the transport's own bounded teardown regardless of whether it replies.
 */
const SIGN_IN_CANCEL_TIMEOUT_MS = 3_000

/**
 * The reservation held in {@link RuntimeHost.signIns} between claiming a profile's key and the real
 * {@link ProviderSignIn} existing (098, review finding 5).
 *
 * A value rather than a nullable, so the map's presence check means one thing — "this profile is
 * busy" — whether or not a process has been spawned yet.
 *
 * ⛔ **It used to cancel nothing, on the grounds that there was nothing yet to cancel** (185, from
 * 182 H2). That was false the moment `CodexLogin.start` reached its transport factory: from there
 * on a detached `codex app-server` exists, and this reservation is the ONLY thing either Cancel or
 * quit can find for it — the real handle does not arrive until the handshake has answered, which is
 * exactly the interval where a wedged app-server never returns one. Measured at 5/5: Cancel was a
 * no-op, quit was a no-op, the child outlived both.
 *
 * So the reservation now carries the launch's abort controller, and cancelling it aborts. What that
 * reaches is `cancelWith` inside `CodexLogin.start`, which closes the transport — the same mechanism
 * a session launch has used since 070, rather than a second one invented here.
 *
 * ⛔ **The controller is the LAUNCH REGISTRY's, since 202** (191 H1/H2). It used to be a private
 * `AbortController` this method made, which meant a quit could only reach it through a snapshot
 * `closeAll` took by hand — and anything that started after that snapshot was reachable by nothing.
 * `withdraw` is now `LaunchRegistry.cancel(launch)`, so Cancel and quit abort the same object by the
 * same route, and the route is the one door the module already owns.
 */
function pendingSignIn(withdraw: () => void): ProviderSignIn {
  return {
    authUrl: '',
    completed: new Promise<never>(() => {}),
    cancel: async () => withdraw(),
  }
}

/**
 * The two keys the process-wide registry knows, spelled in one place (293 §2).
 *
 * ⚠️ **Namespaced, because one flat map now holds both** — a credential home is an absolute path and
 * a sign-in key is `codex` or `claude:<profile>`, so a collision needs a profile called after a
 * directory. Prefixing costs nothing and removes the argument.
 */
function oauthPortKey(provider: Provider, profileId: string): string {
  return `oauth:${signInKey(provider, profileId)}`
}

function credentialHomeKey(home: string): string {
  return `credential:${home}`
}

/** A switch belongs to one home even when OAuth ports are shared. */
function profileSignInKey(provider: Provider, profileId: string): string {
  return `${provider}:${profileId}`
}

/**
 * ⚑ **The turn gate's refusal of a Claude conversation holding a sign-in the machine has moved on
 * from** ({@link RuntimeHost.assertSignInCurrent}) — a class, so a delivery can tell it from every
 * other refusal and be held for a reopen instead ({@link RuntimeHost.reopenForWhatWaits}).
 */
class ItsSignInMovedOn extends Error {}

/** One remembered refusal: a provider and the login refused, '' where only one is told apart. */
function refusedLoginKey(provider: Provider, login: string): string {
  return `${provider}\u0000${login}`
}

export {
  AUTH_CHECK_TIMEOUT_MS,
  credentialHomeKey,
  ItsSignInMovedOn,
  oauthPortKey,
  pendingSignIn,
  profileSignInKey,
  refusedLoginKey,
  SIGN_IN_CANCEL_TIMEOUT_MS,
  SIGN_IN_TIMEOUT_MS,
}
