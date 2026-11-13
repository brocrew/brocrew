import { reactive } from 'vue'
import type { AuthState, Provider } from '../../../shared/runtime-ipc'
import type { ClientProviderApi } from '../../../shared/client-provider-api'
import { readableError } from './session-record'

export type SignInPhase = 'idle' | 'checking' | 'copying' | 'signing-in'

/** The provider and profile a sign-in is about: the host keys every gesture by this pair. */
export interface SignInPair {
  readonly provider: Provider
  readonly profileId: string
}

/**
 * What one pair's sign-in is known to be, shared by every surface that asks about it.
 *
 * Several surfaces observe one pair without waiting for each other, and the host answers a check
 * whenever it is asked, sign-in or not. So each observation takes a ticket from the pair: a check
 * when it is asked, and a sign-in when it completes, because that is when the credential it reports
 * became true. The fact keeps the newest-ticketed answer, and an answer to an older question never
 * replaces it: a check asked before a sign-in finished cannot undo what the sign-in learned.
 */
export interface SignInFact {
  auth: AuthState | null
  /** The last ticket handed out for this pair. */
  issued: number
  /** The ticket of the observation `auth` holds. */
  observed: number
}

/** A ticket for an observation of this pair, taken at the moment it is asked or becomes true. */
export function ticketFor(fact: SignInFact): number {
  fact.issued += 1
  return fact.issued
}

/** Keep `said` as the pair's sign-in unless a newer observation is already held. */
export function observe(fact: SignInFact, ticket: number, said: AuthState | null): boolean {
  if (ticket <= fact.observed) return false
  fact.observed = ticket
  fact.auth = said
  return true
}

/** The sentences a surface says for its own gestures. */
export interface SignInWords {
  signedIn(pair: SignInPair): string
  /** A copy of the machine sign-in that changed nothing. */
  unchanged: string
}

export const SIGN_IN_WORDS = {
  finishInTheBrowser: 'Finish signing in in your browser, then come back.',
  didNotComplete: 'The sign-in did not complete.',
  copied: 'Copied your machine sign-in into this profile.',
} as const

type SignInBridge = Pick<
  ClientProviderApi,
  'checkProviderAuth' | 'signInProvider' | 'reprovisionProviderAuth' | 'cancelProviderSignIn'
>

export interface SignInGestureOptions {
  /** The pair a gesture started now is about. */
  readonly pair: () => SignInPair
  readonly bridge: () => SignInBridge
  /** Where an answer about a pair is kept for every surface, whichever surface asked. */
  readonly fact: (pair: SignInPair) => SignInFact
  /**
   * Whether a check that could not be asked at all is kept as the pair's fact too. Only the fact's
   * own holder says so: another surface's failed call learned nothing about the credential, so the
   * fact keeps the last answer the host gave.
   */
  readonly keepsFailedChecks?: boolean
  readonly words: SignInWords
  /**
   * Whether an answer about `asked` still describes this surface. One that does not is not drawn
   * here, and when its gesture ends what this surface showed is cleared; the shared fact still
   * takes it, because it is still true of its own pair.
   */
  readonly stillAsking?: (asked: SignInPair) => boolean
  /** A check asked while another gesture runs: run it once that ends, or drop it. */
  readonly checkWhileBusy: 'after' | 'drop'
  /** Called as each gesture ends, whatever came of it. */
  readonly settled?: (phase: Exclude<SignInPhase, 'idle'>, asked: SignInPair) => void
}

/**
 * One surface's sign-in gestures: check, sign in inside the profile, copy the machine sign-in, and
 * cancel. Its busy phase, notice and drawn answer are this instance's own, so two surfaces never
 * show each other's progress. What a gesture learns about a pair goes into that pair's shared fact
 * too, so every surface reading it agrees. Two sign-ins for one pair are refused by the host,
 * which keys them by pair, and the refusal is said on the surface that asked.
 */
export interface SignInGesture {
  busy: SignInPhase
  /** What the last gesture said, in the words of whoever produced it. Never a credential. */
  notice: string | null
  /** The answer this surface draws, or `null` when it has none. */
  auth: AuthState | null
  /** The pair the gesture in flight was started for. */
  readonly running: SignInPair | null
  /** `draw` decides what this surface shows of the answer, when it arrives. */
  check(draw?: (said: AuthState) => AuthState | null, probe?: boolean): Promise<void>
  signIn(): Promise<void>
  copyMachineSignIn(): Promise<void>
  /** Cancels the sign-in that is running, under the pair it was started for. */
  cancel(): Promise<void>
}

export function createSignInGesture(options: SignInGestureOptions): SignInGesture {
  const current = (asked: SignInPair): boolean => options.stillAsking?.(asked) ?? true
  // A plain literal each time: a reactive proxy cannot cross the bridge.
  const literal = (pair: SignInPair): SignInPair => ({
    provider: pair.provider,
    profileId: pair.profileId,
  })
  let running: SignInPair | null = null
  let checkAgain = false

  const learned = (
    asked: SignInPair,
    ticket: number,
    said: AuthState,
    drawn: AuthState | null,
    answered: boolean,
  ): void => {
    if (answered || options.keepsFailedChecks === true) observe(options.fact(asked), ticket, said)
    if (current(asked)) gesture.auth = drawn
  }

  async function withGesture(
    phase: Exclude<SignInPhase, 'idle'>,
    run: (asked: SignInPair) => Promise<void>,
  ): Promise<void> {
    if (gesture.busy !== 'idle') {
      if (phase === 'checking' && options.checkWhileBusy === 'after') checkAgain = true
      return
    }
    const asked = literal(options.pair())
    running = asked
    gesture.busy = phase
    try {
      await run(asked)
    } finally {
      gesture.busy = 'idle'
      running = null
      if (!current(asked)) {
        gesture.auth = null
        gesture.notice = null
      }
      const again = checkAgain
      checkAgain = false
      options.settled?.(phase, asked)
      if (again && gesture.busy === 'idle') void gesture.check()
    }
  }

  const gesture: SignInGesture = reactive({
    busy: 'idle' as SignInPhase,
    notice: null as string | null,
    auth: null as AuthState | null,
    get running() {
      return running
    },
    async check(draw: (said: AuthState) => AuthState | null = (said) => said, probe = false) {
      await withGesture('checking', async (asked) => {
        const ticket = ticketFor(options.fact(asked))
        let said: AuthState
        let answered = true
        try {
          said = await options.bridge().checkProviderAuth({
            ...literal(asked),
            ...(probe ? { probe: true as const } : {}),
          })
        } catch (error) {
          said = { state: 'unknown', reason: readableError(error) }
          answered = false
        }
        learned(asked, ticket, said, draw(said), answered)
      })
    },
    async signIn() {
      await withGesture('signing-in', async (asked) => {
        gesture.notice = SIGN_IN_WORDS.finishInTheBrowser
        try {
          const result = await options.bridge().signInProvider(literal(asked))
          learned(asked, ticketFor(options.fact(asked)), result.state, result.state, true)
          if (current(asked)) {
            gesture.notice = result.success
              ? options.words.signedIn(asked)
              : (result.detail ?? SIGN_IN_WORDS.didNotComplete)
          }
        } catch (error) {
          if (current(asked)) gesture.notice = readableError(error)
        }
      })
    },
    async copyMachineSignIn() {
      await withGesture('copying', async (asked) => {
        gesture.notice = null
        try {
          const outcome = await options.bridge().reprovisionProviderAuth(literal(asked))
          if (current(asked)) {
            gesture.notice = outcome === 'replaced' ? SIGN_IN_WORDS.copied : options.words.unchanged
          }
        } catch (error) {
          if (current(asked)) gesture.notice = readableError(error)
        }
      })
    },
    async cancel() {
      try {
        await options.bridge().cancelProviderSignIn(literal(running ?? options.pair()))
      } catch (error) {
        gesture.notice = readableError(error)
      }
    },
  })
  return gesture
}
