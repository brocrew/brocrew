/**
 * ⚑ **704 · what `probe:codex-early-interrupt` concludes, as pure functions a cheap gate can pin.**
 *
 * ⛔ A live rig's reading is the part nothing else checks — `pin-a-live-only-instrument-from-a-cheap-gate`.
 * So the probe only COLLECTS — per turn, every `turn/interrupt` the product sent and what Codex
 * answered, when Codex's own `turn/started` arrived, and the status Codex itself put on
 * `turn/completed` — and this decides. `test/codex-early-interrupt-evidence.test.ts` holds it to
 * planted turns, each verdict beside the one fact that moves it.
 *
 * ⚠️ **Codex's word decides the verdict, never the product's.** Until `709`,
 * `SessionMachine.completeTurn` relabelled ANY provider outcome `interrupted` once an interrupt was
 * asked, so the product's own `turn` event could not tell an interrupt Codex honoured from one it
 * ignored — which is exactly how `smoke:ui` step 48's run of 03:04 passed *"turn closed
 * interrupted"* over a count Codex ran to the end (704's response §1).
 *
 * 🔴 **709 · R43 — and the product's word is now CHECKED against Codex's** ({@link renamed}): the
 * ledger records the provider's word, so on every turn the two must be one word. ⚑ On `main`'s
 * adapter before `704` the early arm read `completed` in Codex's word and `interrupted` in the
 * product's; with `709` the pre-`704` adapter reads `completed` in both, and `704`'s reads
 * `interrupted` in both.
 */

export type Arm = 'early' | 'late' | 'none'

/** One `turn/interrupt` the product wrote, and what came back — `ok`, Codex's error, or `pending`. */
export interface InterruptSent {
  /** ms after this turn's `turn/start` was written */
  readonly sentAt: number
  readonly answer: string
}

export interface TurnSeen {
  readonly arm: Arm
  readonly turn: string
  /** ms after `turn/start` the product was asked to interrupt, or `null` on the control that is not */
  readonly askedAt: number | null
  readonly interrupts: readonly InterruptSent[]
  /** ms after `turn/start` Codex's `turn/started` for THIS turn arrived, or `null` if it never did */
  readonly startedAt: number | null
  /** Codex's own `turn/completed.turn.status` for this turn, or `null` if none arrived */
  readonly providerStatus: string | null
  /** 🔴 709 · the product's own `turn` event for this turn, or `null` if none arrived */
  readonly productWord: string | null
}

/**
 * 🔴 **709 · R43 — the turns whose product word is not Codex's.** ⚑ `[]` is the ruling kept: the
 * ledger records the provider's word, whatever was asked. ⛔ A turn with no word on either side is
 * not counted here — {@link earlyInterruptVerdict} already calls a turn Codex never ended NOT
 * PERFORMED, and a missing product word is the probe's premise to assert, not this function's.
 */
export function renamed(turns: readonly TurnSeen[]): string[] {
  return turns
    .filter(
      (turn) =>
        turn.providerStatus !== null &&
        turn.productWord !== null &&
        turn.providerStatus !== turn.productWord,
    )
    .map((turn) => `${turn.turn}: Codex ${turn.providerStatus}, product ${turn.productWord}`)
}

/**
 * ⚑ **The two words Codex refuses an interrupt with when the turn it names is not running** —
 * measured on the bundled 0.146.0 (`probe:codex-early-interrupt`): `no active turn to interrupt`
 * when nothing holds its active slot, and `expected active turn id <this> but found <previous>` when
 * the turn before — one interrupted a moment ago — still does. Both are `-32600`.
 */
const NOT_RUNNING = /"code":-32600[\s\S]*(no active turn to interrupt|expected active turn id)/

/**
 * Did Codex itself say the turn was not running yet when this turn's FIRST interrupt reached it?
 * ⛔ **Codex's answer, never this probe's clocks** (704's review): a send time and an arrival time
 * are stamped on two sides of a pipe, and a turn Codex had already started can arrive late.
 */
export function refusedAsNotRunning(turn: TurnSeen): boolean {
  const first = turn.interrupts[0]
  return first !== undefined && NOT_RUNNING.test(first.answer)
}

/**
 * ⚑ **Does an interrupt asked before Codex has started the turn stop it?**
 *
 * - ⛔ `not-performed` — a control failed (the uninterrupted turn did not complete, or the one
 *   interrupted mid-turn was not `interrupted`), an early turn has no ending of Codex's own, or
 *   Codex refused no early interrupt as *not running* — the window this measures was not hit;
 * - 🔴 `lost` — Codex COMPLETED a turn the product was asked to interrupt: the 13:21 shape, where the
 *   count ran to 60 and the person's replacement message was refused five seconds later;
 * - ⚑ `honoured` — every early turn ended `interrupted` in Codex's own word, and Codex refused at
 *   least one of their first interrupts as *not running* — so the window was hit and survived.
 */
export type EarlyInterruptVerdict =
  | { readonly verdict: 'honoured' }
  | { readonly verdict: 'lost'; readonly turns: readonly string[] }
  | { readonly verdict: 'not-performed'; readonly because: string }

export function earlyInterruptVerdict(turns: readonly TurnSeen[]): EarlyInterruptVerdict {
  const of = (arm: Arm): TurnSeen[] => turns.filter((turn) => turn.arm === arm)
  const none = of('none')
  if (none.length === 0 || none.some((turn) => turn.providerStatus !== 'completed')) {
    return { verdict: 'not-performed', because: 'the uninterrupted control did not complete' }
  }
  const late = of('late')
  if (late.length === 0 || late.some((turn) => turn.providerStatus !== 'interrupted')) {
    return { verdict: 'not-performed', because: 'the mid-turn control was not interrupted' }
  }
  const early = of('early')
  if (early.length === 0) return { verdict: 'not-performed', because: 'no early turn was driven' }
  const silent = early.filter((turn) => turn.providerStatus === null)
  if (silent.length > 0) {
    return {
      verdict: 'not-performed',
      because: `Codex reported no ending for ${silent.map((turn) => turn.turn).join(', ')}`,
    }
  }
  const lost = early.filter((turn) => turn.providerStatus === 'completed')
  if (lost.length > 0) return { verdict: 'lost', turns: lost.map((turn) => turn.turn) }
  const odd = early.filter((turn) => turn.providerStatus !== 'interrupted')
  if (odd.length > 0) {
    return {
      verdict: 'not-performed',
      because: `early turns ended neither completed nor interrupted: ${odd
        .map((turn) => `${turn.turn}=${String(turn.providerStatus)}`)
        .join(', ')}`,
    }
  }
  if (!early.some(refusedAsNotRunning)) {
    return {
      verdict: 'not-performed',
      because: 'Codex refused no early interrupt as not running — the window was not hit',
    }
  }
  return { verdict: 'honoured' }
}
