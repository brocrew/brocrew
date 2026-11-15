import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AuthUnavailableError,
  FakeRuntime,
  type FakeSessionHandle,
  type ResumeOptions,
  type RuntimeEvent,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import { CodexRefusedItsSignInError, codexCopyIdentityIn } from '@brobot2/runtime/codex'

type CopiedSignIn = ReturnType<typeof codexCopyIdentityIn>

export const digestOf = (bytes: string | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16)
export const signInAt = (path: string): string => digestOf(readFileSync(path))


export class StandInCodex extends FakeRuntime {
  readonly handles: FakeSessionHandle[] = []
  constructor(
    private readonly accepts: () => ReadonlySet<string>,
    private readonly starts: string[],
  ) {
    super('codex')
  }
  failsOtherwise = false
  refusesBeforeCodexIsAsked = false
  asItRefuses: () => void = () => {}
  checksItsSignIn: () => Promise<boolean> = async () => false
  readonly turnModes: TurnMode[] = []
  readonly sent: string[] = []
  /** The thread retains its input across a reopen; carrying on adds no message to it. */
  private readonly retained = new Map<string, string>()
  readonly answeredInputs: string[] = []
  carriedOn = 0
  asItCarriesOn: () => void = () => {}
  carryOnIsHeldOpen = false
  carryOnIsRefusedAtOnce = false
  aStopMeetsTheRefusal = false
  cannotCarryOn = false
  asItStarts: () => void = () => {}
  asItResumes: (handle: FakeSessionHandle) => void = () => {}
  private openTurn: { refuse: (loginRefused?: boolean) => void; answer: () => void } | null = null
  refuseTheOpenTurn(loginRefused = true): void {
    const end = this.openTurn
    this.openTurn = null
    end?.refuse(loginRefused)
  }
  answerTheOpenTurn(): void {
    const end = this.openTurn
    this.openTurn = null
    end?.answer()
  }
  private taken(providerHome: string): CopiedSignIn {
    const beganOn = codexCopyIdentityIn(providerHome)
    const held = signInAt(join(providerHome, 'auth.json'))
    this.starts.push(held)
    if (this.failsOtherwise) throw new Error('the program did not start')
    if (this.refusesBeforeCodexIsAsked) {
      throw new AuthUnavailableError('codex', 'Codex auth.json has insecure permissions.')
    }
    if (!this.accepts().has(held)) {
      this.asItRefuses()
      throw new CodexRefusedItsSignInError('Your Codex sign-in has expired.', beganOn)
    }
    this.asItStarts()
    return beganOn
  }
  private kept(handle: FakeSessionHandle, beganOn: CopiedSignIn): FakeSessionHandle {
    const inside = handle as unknown as {
      machine: {
        beginTurn(): number | null
        completeTurn(
          state: 'completed' | 'failed',
          why?: string,
          a?: undefined,
          b?: undefined,
          c?: object,
        ): void
      }
      push(event: RuntimeEvent): void
    }
    const refused = (loginRefused = true): void => {
      if (loginRefused) this.asItRefuses()
      inside.machine.completeTurn('failed', 'simulated refusal', undefined, undefined, {
        ...(loginRefused ? { loginRefused: true } : {}),
      })
    }
    const answered = (): void => {
      this.answeredInputs.push(this.retained.get(handle.ref.sessionId) ?? '')
      inside.push({ type: 'assistant_message', text: 'answered' })
      inside.machine.completeTurn('completed')
    }
    const stop = handle.interrupt.bind(handle)
    Object.assign(handle, {
      interrupt: async () => {
        if (this.aStopMeetsTheRefusal && this.openTurn !== null) this.refuseTheOpenTurn()
        else await stop()
      },
      checkSignIn: () => this.checksItsSignIn(),
      signInCopyAtLaunch: () => beganOn,
      // A turn of words, as the test says it goes: refused on its sign-in before doing anything,
      // refused after a word of a reply, left open to be refused later, or answered. ⚑ As Codex's
      // adapter does, the turn begins as it is handed over and goes on after the call returns.
      send: async (text: string) => {
        this.sent.push(text)
        this.retained.set(handle.ref.sessionId, text)
        const mode = this.turnModes.shift() ?? 'answered'
        inside.machine.beginTurn()
        if (mode === 'held-open') {
          this.openTurn = { refuse: refused, answer: answered }
          return
        }
        setTimeout(() => {
          if (mode === 'stopped-on-a-limit') {
            inside.machine.completeTurn('failed', 'usage limit', undefined, undefined, {
              limit: { provider: 'codex', resetsAt: Date.now() + 3_600_000 },
            })
          } else if (mode === 'refused') refused()
          else if (mode === 'refused-after-a-word') {
            inside.push({ type: 'assistant_delta', text: 'Let me' })
            refused()
          } else answered()
        }, 0)
      },
      ...(this.cannotCarryOn
        ? {}
        : {
            carryOn: async () => {
              this.carriedOn += 1
              this.asItCarriesOn()
              inside.machine.beginTurn()
              if (this.carryOnIsRefusedAtOnce) refused()
              else if (this.carryOnIsHeldOpen) this.openTurn = { refuse: refused, answer: answered }
              else setTimeout(answered, 0)
            },
          }),
    })
    this.handles.push(handle)
    return handle
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const beganOn = this.taken(options.providerHome)
    return this.kept(await super.start(options), beganOn)
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const beganOn = this.taken(options.providerHome)
    const handle = this.kept(await super.resume(ref, options), beganOn)
    this.asItResumes(handle)
    return handle
  }
}

export type TurnMode = 'refused' | 'refused-after-a-word' | 'held-open' | 'stopped-on-a-limit' | 'answered'

