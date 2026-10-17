import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { signInNotCheckedInTime, type AuthState } from '../auth-state'
import { assertCodexSqliteHomeContained } from '../internal/auth'
import {
  assertNotCancelled,
  cancelWith,
  didNotAnswerInTime,
  withDeadline,
  type LaunchCancel,
} from '../internal/bounded'
import { probeCodexAuth } from './auth-probe'
import type { CodexTransport } from './codex-transport'
import type { TransportFactory } from './codex-runtime'
import { beginCodexHomeBoot } from './home-boot'
import { transientSetupFailureOf } from '../runtime'

/**
 * Signing a profile home into its **own** Codex account (098) — the remedy that actually ends the
 * problem, as opposed to the one that postpones it.
 *
 * ## Why this exists rather than "just re-copy the file again"
 *
 * `provisionCodexAuth` copies the machine's `~/.codex/auth.json` into the profile once. Both copies then share a refresh token; using it rotates the token and invalidates the other copy. Observed refresh sequencing is:
 *
 * | | `~/.codex/auth.json` | the profile copy |
 * |---|---|---|
 * | refresh token | one | **a different one** |
 * | account id | one | the same account |
 * | last refresh | 2026-08-08T16:11:21Z | 2026-07-29T14:34:11Z |
 * | access token expires | 2026-08-18T16:11:20Z | **2026-08-08T14:34:11Z** |
 * | file mtime | 2026-08-08T16:11:21Z | 2026-07-31T23:24:38Z — never rewritten |
 *
 * The profile's access token died at 14:34Z; the machine refreshed at 16:11Z and took the shared
 * refresh token with it. Re-copying puts a working credential back and **rebuilds exactly this
 * situation**, so the next rotation breaks it again. That is not a criticism of the copy — it is
 * what a copy is.
 *
 * A login started *here*, in the profile home, ends it: the profile gets its own token pair and
 * stops sharing. It is also the coherent version of what this app already claims — a profile is an
 * identity, not a container.
 *
 * ## The flow, measured end to end on the bundled 0.146.0 binary
 *
 * ```
 * → {"method":"account/login/start","params":{"type":"chatgpt"}}
 * ← {"type":"chatgpt","loginId":"8ed7a419-…","authUrl":"https://auth.openai.com/oauth/authorize?…"}
 * → {"method":"account/login/cancel","params":{"loginId":"8ed7a419-…"}}
 * ← {"status":"canceled"}
 * ```
 *
 * The app-server serves the OAuth redirect itself and reports the outcome on
 * `account/login/completed`; **the client opens the URL**, which is why this returns one rather than
 * launching a browser — deciding how a link reaches a browser is the host's job (095), not a
 * library's.
 *
 * ⚠️ **The transport stays alive until the login settles.** The loopback listener that receives the
 * OAuth redirect belongs to that process; killing it early is a cancel with extra steps.
 */

/** What a started sign-in gives the caller: a URL to open, and the id that can cancel it. */
export interface CodexLoginStart {
  loginId: string
  /** The provider's own authorize URL. Opened by the host, never fetched by us. */
  authUrl: string
}

/** How a sign-in ended. `error` is the provider's diagnostic, never a credential. */
export interface CodexLoginOutcome {
  success: boolean
  error?: string
  /** The credential's standing after the attempt, re-asked rather than assumed. */
  state: AuthState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : ''
}

const INITIALIZE_PARAMS = {
  clientInfo: { name: 'brobot2', title: null, version: '0.0.0' },
  capabilities: { experimentalApi: true, requestAttestation: false },
}

/**
 * ⛔ **How long a credential gesture gives the app-server to answer its handshake and its one
 * question** (185, from 182 H2).
 *
 * ## Why there was no number here at all
 *
 * `transport.request` settles when the child answers, when it EXITS, or when the transport is
 * closed — so an app-server that is **alive and silent** settles nothing, and both functions below
 * awaited exactly that with no bound. Their `finally` clauses do close the transport and release the
 * home's boot slot; neither can run until the `await` above it returns. 185 measured the result on
 * the pinned 0.146.0 binary, 5 trials per path: **5/5 left a live `codex app-server` and a boot gate
 * still held**, on both paths, surviving the app's own quit.
 *
 * ## The number
 *
 * | | |
 * |---|---|
 * | a cold handshake, measured by 180 | **85–95 ms**, 239 ms on the first spawn after a boot |
 * | the whole check — spawn, handshake, two auth round trips | **~0.6 s**, measured in 098 |
 * | this bound | **8 s** — 33× the worst measured handshake, 13× the whole call |
 *
 * ⚑ **The ceiling is what picks it, not the floor.** `RuntimeHost` gives a credential check ten
 * seconds; a bound at or above that would never be the one that fires, and the caller would be back
 * to a generic *"could not ask"* with no idea which step went quiet — while the child it is about
 * stays alive for the difference. Eight leaves two seconds of headroom and still sits far above
 * anything this binary has been measured doing (`176`'s rule: catch a 15× regression, not a slow
 * morning).
 *
 * ⚠️ **It is a budget for the whole gesture, not a per-request timeout** — the same choice
 * `listModels` made and for the same reason: the budget belongs to the QUESTION, and a per-request
 * bound lets a server that is slow twice spend it twice. The browser round trip on the sign-in path
 * is deliberately outside it (the host's five minutes owns that), because a person reading their
 * email is not a wedged provider.
 */
export const CREDENTIAL_HANDSHAKE_TIMEOUT_MS = 8_000

/**
 * How long {@link CodexLogin.cancel} waits for the provider to acknowledge its own withdrawal (185).
 *
 * Deliberately shorter than `RuntimeHost`'s three-second `SIGN_IN_CANCEL_TIMEOUT_MS`, so this one is
 * always the deadline that fires and the teardown always runs here, where the transport is. It is a
 * courtesy round trip on a local socket; two seconds is far more than it has ever needed and the
 * cost of it expiring is one `loginId` the app-server is about to be killed holding.
 */
const LOGIN_CANCEL_ACK_TIMEOUT_MS = 2_000

/** A budget shared by every request of one credential gesture. See {@link CREDENTIAL_HANDSHAKE_TIMEOUT_MS}. */
function handshakeBudget(): <T>(p: Promise<T>, what: string) => Promise<T> {
  const deadline = Date.now() + CREDENTIAL_HANDSHAKE_TIMEOUT_MS
  return <T>(p: Promise<T>, what: string): Promise<T> =>
    withDeadline(p, Math.max(1, deadline - Date.now()), `codex ${what}`)
}

/** Canonical absolute path (resolving symlinks like macOS `/tmp` → `/private/tmp`), lexical if not. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * 🔒 **Initialize, and REFUSE to go on unless the child adopted the home we pinned** (098, review
 * finding 6; the rule is 027's, fixing 023 P1-H).
 *
 * `CODEX_HOME` is an environment variable, and `CodexSessionHandle.begin` has treated pinning it as
 * insufficient on its own since 027: it reads the `codexHome` the app-server echoes from
 * `initialize` and throws if it is not the profile home. These two flows spawn the identical binary
 * through the identical factory and skipped that check.
 *
 * ⚠️ **On the sign-in path it matters more than anywhere else in the app.** Every other Codex spawn
 * *reads* the credential; a sign-in makes the app-server **write a brand-new `auth.json`** wherever
 * it decided its home is. A child that ignored the pin would put a freshly minted OAuth credential
 * into the user's real `~/.codex` — overwriting and rotating their machine login, which is the one
 * thing this whole change exists to stop happening to them.
 *
 * `sqlite_home` is attested too, for the same reason `begin` attests it: a profile `config.toml` can
 * redirect state out of the home, and this runs before any of it is written.
 */
async function initializeInHome(
  transport: CodexTransport,
  providerHome: string,
  bounded: <T>(p: Promise<T>, what: string) => Promise<T>,
): Promise<void> {
  assertCodexSqliteHomeContained(providerHome) // pre-traffic, exactly as `begin` does
  const result = await bounded(transport.request('initialize', INITIALIZE_PARAMS), 'initialize')
  const reported =
    typeof result === 'object' &&
    result !== null &&
    typeof (result as Record<string, unknown>)['codexHome'] === 'string'
      ? ((result as Record<string, unknown>)['codexHome'] as string)
      : ''
  if (!reported) {
    throw new Error('codex initialize did not report a codexHome (required for home attestation)')
  }
  if (canonicalPath(reported) !== canonicalPath(providerHome)) {
    throw new Error(
      `codex did not adopt the profile home: expected ${providerHome}, got ${reported}`,
    )
  }
}

/**
 * A sign-in in progress, owning the app-server that is listening for the redirect.
 *
 * One at a time per instance: {@link start} is called once by {@link startCodexLogin}, and the
 * object is finished by exactly one of {@link completed} resolving or {@link cancel}.
 */
export class CodexLogin {
  private settled: ((outcome: CodexLoginOutcome) => void) | null = null
  private readonly outcome: Promise<CodexLoginOutcome>
  private loginId = ''
  /** The one teardown, or null while none has been started. See {@link dispose}. */
  private disposal: Promise<void> | null = null

  private constructor(private readonly transport: CodexTransport) {
    this.outcome = new Promise<CodexLoginOutcome>((resolve) => {
      this.settled = resolve
    })
    void this.pump()
  }

  /**
   * Spawn an app-server in `providerHome`, initialize it, and ask for a sign-in URL.
   *
   * The transport is torn down if any of that throws, so a failed start never leaves a process
   * holding a loopback port.
   *
   * ⛔ **`signal` is what owns the child until this returns** (185, from 182 H2). Everything above
   * is about what happens when the handshake FAILS; the signal is for when nothing fails and nobody
   * is coming — the caller closed the panel, or the app is quitting, while the app-server sits
   * silently on a request that will never be answered. Until 185 the only handle to that process
   * arrived with the return value below, so there was a whole handshake in which it did not exist.
   */
  static async start(
    transports: TransportFactory,
    providerHome: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ login: CodexLogin; start: CodexLoginStart }> {
    // Above everything, so a cancelled sign-in leaves no state to unwind (070's rule).
    assertNotCancelled(signal, 'codex sign-in')
    // ⛔ **A sign-in is a boot like any other** (180). It spawns an app-server in the same home a
    // session or the model probe may be booting into, and a credential gesture arriving while the
    // launcher is still starting up is the ordinary way to reach that — the panel sits on the
    // launcher. Held only to `initialize`; the browser round trip below is unbounded by design.
    const bootSettled = await beginCodexHomeBoot(providerHome, { signal })
    let transport: CodexTransport
    try {
      transport = transports({ cwd, providerHome })
    } catch (error) {
      bootSettled()
      throw error
    }
    // ⚠️ **On the line after the spawn, exactly as `CodexRuntime.start` does it** (070). The child is
    // detached and exists from here; `cancelWith` is the app's one mechanism for reaching one, and
    // 180 already fixed it to tear down on a signal that had ALREADY aborted — which is what makes
    // it safe to wire after an await.
    const spawned = transport
    const cancel = cancelWith(signal, () => spawned.close())
    const login = new CodexLogin(transport)
    const bounded = handshakeBudget()
    try {
      await initializeInHome(transport, providerHome, bounded)
      bootSettled()
      const result = await bounded(
        transport.request('account/login/start', { type: 'chatgpt' }),
        'account/login/start',
      )
      const loginId = readString(result, 'loginId')
      const authUrl = readString(result, 'authUrl')
      if (!loginId || !authUrl) {
        throw new Error(
          `Codex did not return a sign-in URL (got ${JSON.stringify(result)?.slice(0, 200)})`,
        )
      }
      // Asked after the awaits, because that is the interval it is about: a cancel that landed
      // during the handshake has already closed the transport, and handing back a login whose
      // app-server is being killed would be a sign-in the caller can only discover is dead.
      if (cancel.cancelled) throw new Error('codex sign-in was cancelled')
      login.loginId = loginId
      return { login, start: { loginId, authUrl } }
    } catch (error) {
      await login.dispose()
      throw error
    } finally {
      bootSettled() // the backstop for a sign-in whose `initialize` never answered (180)
      // The login is the caller's from here, and only {@link cancel} may stop it — see
      // {@link LaunchCancel.release} for why leaving this wired would be worse than not having it.
      cancel.release()
    }
  }

  /** Resolves when the provider reports the sign-in finished, or when {@link cancel} runs. */
  completed(): Promise<CodexLoginOutcome> {
    return this.outcome
  }

  /**
   * Withdraw the sign-in. Idempotent, and it tells the provider first — an abandoned `loginId`
   * would otherwise leave the app-server waiting on a redirect that is never coming.
   *
   * ⛔ **The courtesy is bounded, because the thing being told is the thing that may have gone
   * quiet** (185). Unbounded, this `await` never returned against a wedged-but-alive app-server, so
   * the `dispose()` below — the only line that kills the process — was never reached.
   * `RuntimeHost.boundedCancel` wraps this in three seconds and its docblock says *"the process is
   * still reaped, because the transport's own `close()` is a bounded teardown"*: true only if
   * `close()` is CALLED, and it was not. A bound of two seconds keeps that outer deadline what it
   * claims to be — a backstop — rather than the mechanism.
   */
  async cancel(): Promise<void> {
    // ⛔ **JOIN the teardown rather than walk past it** (202, from 191 H2). This used to `return` the
    // moment `closed` was true, and `closed` was set BEFORE `transport.close()` was awaited — so a
    // second caller (quit arriving behind the user's Cancel, which is the ordinary way to get two)
    // resolved on a receipt for work that was still in flight, and the app-server was still being
    // SIGTERMed when the process it belonged to exited. See {@link dispose}.
    if (this.disposal !== null) return this.disposal
    try {
      if (this.loginId)
        await withDeadline(
          this.transport.request('account/login/cancel', { loginId: this.loginId }),
          LOGIN_CANCEL_ACK_TIMEOUT_MS,
          'codex account/login/cancel',
        )
    } catch {
      // The provider is already gone, has forgotten the id, or has stopped answering — and in every
      // one of those cases the teardown below is what actually ends the sign-in.
    }
    this.finish({
      success: false,
      error: 'canceled',
      state: { state: 'unknown', reason: 'canceled' },
    })
    await this.dispose()
  }

  /** Read the notification stream until the login settles; a stream that ends is a login that failed. */
  private async pump(): Promise<void> {
    try {
      for await (const message of this.transport.incoming()) {
        if (message.kind !== 'notification') continue
        if (message.method !== 'account/login/completed') continue
        const success = isRecord(message.params) && message.params['success'] === true
        const error = readString(message.params, 'error')
        // Ask rather than assume: a `success` that did not leave a usable credential is a fact the
        // caller needs, and the probe is two local round trips on a transport already in hand.
        const state = await probeCodexAuth(this.transport)
        this.finish({ success, ...(error ? { error } : {}), state })
        await this.dispose()
        return
      }
    } catch {
      // fall through to the terminal below
    }
    this.finish({
      success: false,
      error: 'the Codex sign-in process ended before reporting a result',
      state: { state: 'unknown', reason: 'the sign-in process ended before reporting a result' },
    })
  }

  private finish(outcome: CodexLoginOutcome): void {
    const settle = this.settled
    this.settled = null
    settle?.(outcome)
  }

  /**
   * Tear the app-server down — **single-flight, and the receipt is the promise itself** (202, from
   * 191 H2).
   *
   * ⛔ **It used to set a boolean and THEN await.** Between those two statements the transport was
   * still running its bounded stdin→SIGTERM→SIGKILL, and any concurrent caller read the boolean,
   * returned, and told its own caller the sign-in was finished. That is `180`'s `cancelWith` lesson
   * in a different file — *a receipt issued before the thing it certifies* — and here the thing was
   * a detached process holding a loopback port during a quit.
   *
   * ⚑ Memoizing the PROMISE is what makes the second caller wait for the first caller's teardown
   * instead of for a flag: the same shape `SpawnCodexTransport.reapGroup` and
   * `ClaudeSessionHandle.close` already use, and for the same reason.
   */
  private dispose(): Promise<void> {
    // `Promise.resolve` because the interface allows a synchronous `close()` (fakes use one) — the
    // memoized value has to be a promise either way, or the second caller has nothing to await.
    return (this.disposal ??= Promise.resolve(this.transport.close()).then(() => undefined))
  }
}

/**
 * Start a sign-in in `providerHome` and hand back the URL to open plus the handle that will say how
 * it went. See {@link CodexLogin} for why the process stays up.
 */
export function startCodexLogin(
  transports: TransportFactory,
  providerHome: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ login: CodexLogin; start: CodexLoginStart }> {
  return CodexLogin.start(transports, providerHome, cwd, signal)
}

/**
 * Ask a profile home about its credential with **no session running** — spawn, ask, tear down.
 *
 * The session-start path uses {@link probeCodexAuth} on the transport it already has; this is for
 * the surface that wants to check before anything is launched, and it pays a real process spawn
 * (~0.6 s measured) to do it. Bounded: the transport is closed on every path, including a throw.
 *
 * ⛔ **"Bounded" was not true, and 185 measured how untrue** (182 H2). The `finally` below closes the
 * transport on every path it can REACH, and a silent app-server means it reaches none of them: the
 * `await` never returns. `RuntimeHost` wrapping this call in a ten-second deadline changed only who
 * was waiting. Two things make the sentence true now — a budget on the requests
 * ({@link CREDENTIAL_HANDSHAKE_TIMEOUT_MS}) and `signal`, which reaches the child rather than the
 * awaiter.
 *
 * ⚠️ **A cancelled check answers `unknown`; it does not throw.** That is this function's contract
 * and 098's whole point — *a question we could not get an answer to says nothing about the
 * credential* — and a cancel is one more way of not getting an answer.
 */
export async function probeCodexAuthInHome(
  transports: TransportFactory,
  providerHome: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<AuthState> {
  let bootSettled: (() => void) | undefined
  let transport: CodexTransport | undefined
  let cancel: LaunchCancel | undefined
  try {
    assertNotCancelled(signal, 'codex sign-in check')
    // The same gate the launch paths take (180) — this is a real app-server boot in a real home, and
    // "check this profile's sign-in" is a button on the launcher, so it can land beside a launch.
    bootSettled = await beginCodexHomeBoot(providerHome, { signal })
    const spawned = transports({ cwd, providerHome })
    transport = spawned
    // Ownership from the spawn, not from the handshake (070/185) — see {@link CodexLogin.start}.
    cancel = cancelWith(signal, () => spawned.close())
    const bounded = handshakeBudget()
    await initializeInHome(spawned, providerHome, bounded)
    bootSettled()
    const state = await bounded(probeCodexAuth(spawned), 'auth status')
    if (cancel.cancelled) throw new Error('codex sign-in check was cancelled')
    return state
  } catch (error) {
    // 🔴 **710 · review — a machine that ran short is said, never its errno.** ⛔ The launcher runs
    // this check after EVERY failed start, so under a shortage it drew *"could not start Codex …:
    // codex app-server failed to spawn: spawn /…/codex EAGAIN"* — the binary's path — under the
    // sentence R52 gives the start itself. ⚑ By the CODE, as that sentence is (second review):
    // `EMFILE` is BroBot2's own table of open files, the rest are the machine's. ⚑ Still `unknown`:
    // nothing was learned about the sign-in.
    const shortage = transientSetupFailureOf(error)
    if (shortage !== null) {
      return {
        state: 'unknown',
        reason:
          shortage === 'EMFILE'
            ? 'BroCrew had too many files open to start Codex and ask about this profile’s sign-in.'
            : 'This machine ran short of open files, processes or memory, so Codex could not be started to ask about this profile’s sign-in.',
      }
    }
    // Codex was started and was too slow: said apart from a start that failed, because the next
    // ask often finds it answering.
    if (didNotAnswerInTime(error)) {
      return { state: 'unknown', reason: signInNotCheckedInTime('Codex') }
    }
    return {
      state: 'unknown',
      reason: `could not start Codex to ask about this profile's sign-in: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  } finally {
    bootSettled?.()
    cancel?.release()
    // ⚠️ Reached on the deadline and cancel paths too, and that is the point: `withDeadline` releases
    // the AWAITER, never the child. THIS releases the child — `close()` is itself a bounded teardown
    // (end stdin → SIGTERM → SIGKILL), so a check cannot leak an app-server even when the reason it
    // failed is that the app-server stopped talking.
    await transport?.close()
  }
}

/** What a person's API key does to one Codex profile home. */
export type CodexKeyChange =
  /** Log the home in with this key — Codex keeps it in its own `auth.json`. */
  | { readonly to: 'the-key'; readonly apiKey: string }
  /** Log the home out, so the copied machine login can take its place again. */
  | { readonly to: 'no-key' }

/** What the home holds after a {@link changeCodexKeyInHome}. */
export type CodexKeyOutcome =
  | { readonly ok: true; readonly authMethod: string | null }
  | { readonly ok: false; readonly reason: string }

/**
 * 🔒 **Log one Codex profile home in with a person's API key, or out of it** — Codex's own login
 * (`account/login/start {type:'apiKey'}`, `account/logout`), run in an app-server pinned to that home.
 *
 * ⚑ **Where the key goes**: into this app-server's stdin, as one JSON-RPC request, and from there
 * into the `auth.json` Codex writes in the profile home (`0600`), as a ChatGPT login is kept today.
 * ⛔ Never into an argument, an environment, a log or an error: a failure answers in this app's own
 * words, and the provider's text — which a request's rejection carries — is never handed on.
 *
 * ⚑ **The same gates as a sign-in**: the home's boot slot, the home attested at `initialize`, every
 * request bounded, and the app-server closed on every path.
 */
export async function changeCodexKeyInHome(
  transports: TransportFactory,
  providerHome: string,
  change: CodexKeyChange,
  signal?: AbortSignal,
): Promise<CodexKeyOutcome> {
  let bootSettled: (() => void) | undefined
  let transport: CodexTransport | undefined
  let cancel: LaunchCancel | undefined
  const what = change.to === 'the-key' ? 'log this profile in with the key' : 'log this profile out'
  try {
    assertNotCancelled(signal, 'codex api key')
    bootSettled = await beginCodexHomeBoot(providerHome, { signal })
    const spawned = transports({ cwd: providerHome, providerHome })
    transport = spawned
    cancel = cancelWith(signal, () => spawned.close())
    const bounded = handshakeBudget()
    await initializeInHome(spawned, providerHome, bounded)
    bootSettled()
    try {
      if (change.to === 'the-key') {
        await bounded(
          spawned.request('account/login/start', { type: 'apiKey', apiKey: change.apiKey }),
          'account/login/start',
        )
      } else {
        await bounded(spawned.request('account/logout', undefined), 'account/logout')
      }
    } catch {
      return { ok: false, reason: `Codex would not ${what}.` }
    }
    if (cancel.cancelled) return { ok: false, reason: `Codex was stopped before it could ${what}.` }
    let status: unknown
    try {
      status = await bounded(
        spawned.request('getAuthStatus', { includeToken: false, refreshToken: false }),
        'getAuthStatus',
      )
    } catch {
      return {
        ok: false,
        reason: `Codex did not say what this profile runs on after it tried to ${what}.`,
      }
    }
    const method = readString(status, 'authMethod')
    return { ok: true, authMethod: method === '' ? null : method }
  } catch {
    return { ok: false, reason: `Codex could not be started to ${what}.` }
  } finally {
    bootSettled?.()
    cancel?.release()
    await transport?.close()
  }
}
