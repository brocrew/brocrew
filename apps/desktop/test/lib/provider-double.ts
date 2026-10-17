import { FakeRuntime, type FakeProviderSessions } from '@brobot2/runtime'
import type {
  FakeSessionHandle,
  ResumeOptions,
  RuntimeEvent,
  SessionHandle,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

/**
 * 🔴 **663 · the provider double a resume test needs, lifted out of `661` so every wake test can
 * run on BOTH shapes** — standing rule 39's instrument for `661`, built there and shared here.
 *
 * ## ⛔ The gap this exists for
 *
 * ⚑ **`FakeRuntime` publishes at construction; Claude writes nothing until its first turn.** The
 * Fake's handle calls `sessionStarted(ref, opening)` in its constructor, so a resumed conversation
 * already holds `session: resumed` and `status: idle` before anybody has said a word. ⚠️ **Claude
 * publishes `session` only at `system/init`, inside the first turn.** Two defects hid in that gap and
 * shipped past a green suite built on the Fake alone — `652` F1 (a woken conversation drawn ended,
 * repaired by `653`, whose own F2 named this gap) and `661` round two's **A** (a trigger on a
 * provider row, dark on a Claude resume).
 *
 * ## ⚑ What is here — ONE Claude shape (673, from `663` F5)
 *
 *  - {@link claudeOnAResume} — **Claude on a resume, in Claude's order**: nothing until the first
 *    `send`, whose `working` lands before the `session` row, and no `idle` at construction. ⚑ `653`'s double,
 *    moved here from `a-woken-conversation-drawn-as-ended.test.ts` (exported, generic over the
 *    handle), where it was the only one that reproduced the ORDER. ⚠️ Two changes since, both from
 *    `673`'s review: `send` passes every argument through (`661`'s proxy did; `653`'s dropped the
 *    provenance), and a `user_input_request` is renamed with its resolution.
 *  - {@link ResumeGate} — a resume the test can hold at the provider's door, count, and switch to
 *    Claude's shape — which is now {@link claudeOnAResume}.
 *  - {@link ProviderDouble} — `394`'s double with the handles kept, so a test can BE the provider.
 *
 * ⛔ **There used to be two spellings of Claude's resume shape**, and that is how the next Fake-only
 * trigger hides: `661` wrote `silentUntilItsFirstTurn` — the stream withheld until the first send,
 * then the Fake's buffered `session` and `idle` let out BEFORE `working` — beside `653`'s fuller one.
 * ⚑ `673` retired the cut-down proxy; the gate's switch keeps its name and now means the one shape.
 */

/**
 * ⚑ **A resume the test can hold at the provider's door** — and count, and switch to Claude's shape.
 */
export interface ResumeGate {
  held: Promise<void> | null
  entered: number
  /**
   * ⚑ **Claude's shape on a resume** — {@link claudeOnAResume}: the provider says NOTHING until its
   * first turn, and then `working` before `session`, and no `idle` at construction (a turn's own
   * ending still says `idle`, as Claude's does). ⚠️ The Fake publishes
   * `session` and `idle` on construction, which is the row the correction used to ride in on (round
   * two of `661`'s review). ⛔ Until `673` this switch applied a cut-down copy of that shape.
   */
  silentUntilItsFirstTurn: boolean
  /**
   * ⚑ **673 · a resume that fails the way a provider says so** — thrown from the provider's door,
   * before any handle exists, so a test can hand the wake exactly the two shapes Codex's `resume`
   * now produces (`663` F6).
   */
  resumeFails?: (() => Error) | undefined
  /**
   * ⚑ **707 · a START that fails the way a provider says so** — {@link resumeFails}, one door over:
   * thrown from the provider's `start` before any handle exists, so `spawn_agent` can be handed the
   * error an adapter's own start rejects with (`the-errno-a-start-carries.test.ts`).
   */
  startFails?: (() => Error) | undefined
  /**
   * ⚑ **673 · the next START's close waits on this** — {@link closingOnlyWhenReleased}, a teardown
   * the test holds open for exactly as long as it needs. Consumed by that start.
   */
  closeOfTheNextStart?: Promise<void> | null
}

/** ⚑ A gate that holds nothing and speaks as the Fake does — every test's starting point. */
export const anOpenGate = (): ResumeGate => ({
  held: null,
  entered: 0,
  silentUntilItsFirstTurn: false,
})

/**
 * ⛔ **Claude on a RESUME, in Claude's order** (`agent-rows.test.ts` records the measurement,
 * `probe:resume-agent-info`).
 *
 * ⚑ **What the Fake does instead, and why it hides the defect:** its constructor calls
 * `sessionStarted(ref, opening)` (`fake-runtime.ts`), which publishes `session: resumed` and then
 * `status: idle` before anybody has said a word — and the renderer's `session` arm is what clears
 * `ended` (`transcript.ts`). A page with that row on it can never be drawn ended.
 *
 * ⚑ **What Claude does:** nothing until the first `send`, whose `beginTurn` publishes
 * `status: working` BEFORE the handshake; the handshake's `system/init` then publishes
 * `session: resumed`, and repeats no status (`session-machine.ts`). So this double withholds the
 * stream until `send`, holds the constructor's `session`, drops the constructor's `idle`, and lets
 * the held `session` out right after the first `working`. ⚠️ **That order is load-bearing**: the
 * woken life's first PROVIDER row is `working`, and a correction applied one row late would clobber
 * it — found by `653`'s own review, after an earlier version of this double put `session` first.
 * ⚑ Since `673` the host's `reopened` precedes it at the seam, which is why `653 M9` takes the
 * replay's epoch past that row to see the crossing at all.
 *
 * ⚑ `control.pause`, when set, holds the stream right after that `session` — the moment a person
 * can take over a conversation that is mid-turn and has raised nothing yet.
 */
export interface ResumeControl {
  pause: Promise<void> | null
  /** See {@link ownIds}. */
  renameIds: boolean
}
export function claudeOnAResume<Handle extends SessionHandle>(
  handle: Handle,
  control: ResumeControl,
): Handle {
  let release!: () => void
  const firstTurn = new Promise<void>((resolve) => {
    release = resolve
  })
  const rename = control.renameIds
  /** Resolves once the pump has taken the `working` a `send` opened — see `send` below. */
  let workingTaken: (() => void) | null = null
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return () => ({
          async *[Symbol.asyncIterator]() {
            await firstTurn
            let opening: RuntimeEvent | null = null
            let openingPassed = false
            for await (const raw of target.events()) {
              if (!openingPassed) {
                if (raw.type === 'session') {
                  opening = raw
                  continue
                }
                openingPassed = true
                if (raw.type === 'status' && raw.state === 'idle') continue
              }
              yield rename ? ownIds(raw) : raw
              if (raw.type === 'status' && raw.state === 'working' && workingTaken !== null) {
                workingTaken()
                workingTaken = null
              }
              if (opening !== null && raw.type === 'status' && raw.state === 'working') {
                yield opening
                opening = null
                if (control.pause !== null) await control.pause
              }
            }
          },
        })
      }
      if (property === 'send') {
        // ⚠️ **`working` lands before the host's `user_turn`, measured on Claude at every turn
        // boundary** (`claude-runtime.ts`, the re-entrant publish). The host writes `user_turn`
        // after `await handle.send(…)`, and this Proxy's own async hop would otherwise let it win —
        // so `send` resolves only once the pump has taken this turn's `working`.
        // ⚠️ **Every argument goes through** (`673`'s review): the host sends a provenance beside
        // the words (`662`), and a double that dropped it would record none on Claude's arm only.
        return async (...args: Parameters<SessionHandle['send']>) => {
          const taken = new Promise<void>((resolve) => {
            workingTaken = resolve
          })
          release()
          await target.send(...args)
          await taken
        }
      }
      if (property === 'close') {
        return () => {
          release()
          return target.close()
        }
      }
      if (property === 'respondPermission') {
        return (id: string, decision: unknown) =>
          target.respondPermission(
            id.startsWith(WOKEN) ? id.slice(WOKEN.length) : id,
            decision as Parameters<SessionHandle['respondPermission']>[1],
          )
      }
      if (property === 'respondUserInput') {
        return (id: string, response: unknown) =>
          target.respondUserInput(
            id.startsWith(WOKEN) ? id.slice(WOKEN.length) : id,
            response as Parameters<SessionHandle['respondUserInput']>[1],
          )
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

/**
 * ⚠️ **Whether a card id can repeat across lives depends on the provider.** Claude's are its
 * `toolUseID`s and do not repeat; Codex's are `requestKey(jsonRpcId)` over a connection that starts
 * again with each life, so its first card is `number:0` in every life. The Fake behaves like Codex
 * here — every handle names its first card `turn_1_perm`.
 *
 * ⚑ So both shapes are measured: `renameIds: true` gives the woken life its own ids (Claude's
 * shape, `a-woken-conversation-drawn-as-ended.test.ts` §2.1-§2.3), and `false` leaves them colliding
 * (Codex's shape, the same file's §2.4), where the two cards
 * are told apart by their ORDER on the page rather than by id.
 */
export const WOKEN = 'woken:'
export function ownIds(event: RuntimeEvent): RuntimeEvent {
  // ⚠️ **Every request a card is raised for, and its resolution** (`673`'s review): renaming the
  // resolution of a request that was NOT renamed would settle nothing on the page.
  if (
    event.type !== 'permission_request' &&
    event.type !== 'user_input_request' &&
    event.type !== 'request_resolved'
  ) {
    return event
  }
  return { ...event, id: `${WOKEN}${event.id}` }
}

/**
 * ⛔ **A handle whose `close` waits on `held`** (`663`, moved here by `673` so both files spell it
 * once) — a conversation on its way out for exactly as long as the test holds it, with no clock in it.
 */
export function closingOnlyWhenReleased<Handle extends SessionHandle>(
  handle: Handle,
  held: Promise<void>,
): Handle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') return async () => held.then(() => target.close())
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

/** `394`'s double, with the handles kept — a test has to BE the provider to emit a status row. */
export class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly resumeGate: ResumeGate,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const fails = this.resumeGate.startFails
    if (fails !== undefined) throw fails()
    const handle = await super.start(options)
    this.handles.push(handle)
    const held = this.resumeGate.closeOfTheNextStart
    if (held === undefined || held === null) return handle
    this.resumeGate.closeOfTheNextStart = null
    return closingOnlyWhenReleased(handle, held)
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    this.resumeGate.entered++
    if (this.resumeGate.held !== null) await this.resumeGate.held
    const fails = this.resumeGate.resumeFails
    if (fails !== undefined) throw fails()
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    // ⚑ **673 · Claude's shape is ONE function now** — {@link claudeOnAResume}, with Claude's own
    // card ids (they do not repeat across lives) and no pause.
    return this.resumeGate.silentUntilItsFirstTurn
      ? claudeOnAResume(handle, { pause: null, renameIds: true })
      : handle
  }
}
