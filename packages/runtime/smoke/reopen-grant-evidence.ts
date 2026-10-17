import { persistenceOf, type PermissionOutcome } from '../src/permission'

/**
 * ⚑ **697 · what `probe:codex-reopen-grant` concludes, as pure functions a cheap gate can pin.**
 *
 * ⛔ A live rig's reading is the part nothing else checks — `pin-a-live-only-instrument-from-a-cheap-gate`:
 * a rig whose verdict logic drifted would print a confident answer from frames it misread. So the
 * smoke only COLLECTS (each turn's approvals, as the product published them); these decide, and
 * `test/codex-reopen-grant-evidence.test.ts` holds them to planted turns, each arm with its control
 * — `704`'s command sweep ({@link sweepVerdict}) included.
 */

/** One card the product published during a turn — `permission_request`, as the adapter built it. */
export interface CardSeen {
  readonly turn: string
  readonly kind: string
  readonly availableDecisions: readonly PermissionOutcome[]
  readonly persistence: 'once' | 'session' | 'always'
  /** How many policy amendments the provider PROPOSED on it (disclosed, applied by no answer). */
  readonly amendments: number
  /** ⚑ What the rig answered, and whether the product took it — `null` until it settles. */
  readonly answer: { readonly outcome: PermissionOutcome; accepted: boolean | null }
}

/** A turn's cards of one kind. */
export function cardsIn(cards: readonly CardSeen[], turn: string, kind: string): CardSeen[] {
  return cards.filter((card) => card.turn === turn && card.kind === kind)
}

/**
 * 🔴 **`672` F1, live — a card whose `persistence` promises more than its buttons can grant.**
 * ⚑ Empty on `697`'s product; on `main` every Codex command card with a proposed amendment is here.
 */
export function cardsThatOverpromise(cards: readonly CardSeen[]): CardSeen[] {
  return cards.filter((card) => card.persistence !== persistenceOf(card.availableDecisions))
}

/**
 * ⚑ **Does a Codex `allow for this session` on a FILE change survive a reopen?** Read off three
 * turns of one conversation: the grant turn, an in-server control after it, and the same kind of
 * change after `close` → `resume` on a new app-server.
 *
 * - ⛔ `not-performed` — the grant was never offered, never TAKEN (answered `allow_for_session` and
 *   accepted by the product), or the in-server control ASKED (so the grant never held even before
 *   the reopen, and the reopen turn cannot be read);
 * - ⚑ `forgotten` — the control did not ask and the reopened turn did: *"It forgets this session's
 *   'allow for this session' approvals"* (`reopening.ts`) is TRUE of Codex;
 * - ⚠️ `survived` — neither asked: the sentence is false of Codex.
 */
export type ReopenVerdict =
  | { readonly verdict: 'forgotten' | 'survived' }
  | { readonly verdict: 'not-performed'; readonly because: string }

export function reopenVerdict(
  cards: readonly CardSeen[],
  turns: { readonly grant: string; readonly control: string; readonly reopened: string },
): ReopenVerdict {
  const granted = cardsIn(cards, turns.grant, 'file')
  if (granted.length === 0) {
    return { verdict: 'not-performed', because: `turn ${turns.grant} raised no file card` }
  }
  if (!granted.some((card) => card.availableDecisions.includes('allow_for_session'))) {
    return { verdict: 'not-performed', because: `turn ${turns.grant} offered no session grant` }
  }
  if (
    !granted.some(
      (card) => card.answer.outcome === 'allow_for_session' && card.answer.accepted === true,
    )
  ) {
    return {
      verdict: 'not-performed',
      because: `turn ${turns.grant}'s session grant was not taken`,
    }
  }
  if (cardsIn(cards, turns.control, 'file').length > 0) {
    return {
      verdict: 'not-performed',
      because: `the in-server control (${turns.control}) asked, so the grant never held`,
    }
  }
  return { verdict: cardsIn(cards, turns.reopened, 'file').length > 0 ? 'forgotten' : 'survived' }
}

/**
 * 🔴 **704 · is a Codex COMMAND card ever offered `allow for this session`?** Read off the sweep
 * arm's turns, one command shape per turn — `reopening.ts` tells a reader it never is, on `672`'s
 * 14 shapes.
 *
 * - ⛔ `not-performed` — no shape was swept at all (an unenumerated sweep is not a success —
 *   `an-unenumerated-state-counts-as-success`), or a swept shape raised no command card, so the
 *   sentence was not measured on it;
 * - ⚑ `never-offered` — every swept shape raised a command card and none offered the session grant;
 * - ⚠️ `offered` — the shapes whose command card DID offer it: the sentence is false of them.
 *
 * ⚑ **`offered` is decided before `not-performed`, on purpose**: one offer falsifies *"never"*
 * whether or not every other shape was measured, and a silent shape beside it must not hide it.
 * ⛔ **Only `command` cards on the swept turns are read** — a file card offers the grant by design
 * (`c3`, `r2`), and a command card on another arm's turn is not one of the shapes.
 * ⚠️ A card-level offer cannot tell *the server enumerated `acceptForSession`* from *the server
 * named no list* (`commandScope`'s standard set) — both put the button in front of a person, so both
 * falsify the sentence, which is the subject here.
 */
export type SweepVerdict =
  | { readonly verdict: 'never-offered' }
  | { readonly verdict: 'offered'; readonly shapes: readonly string[] }
  | { readonly verdict: 'not-performed'; readonly because: string }

export function sweepVerdict(cards: readonly CardSeen[], shapes: readonly string[]): SweepVerdict {
  if (shapes.length === 0) return { verdict: 'not-performed', because: 'no shape was swept' }
  const offering = shapes.filter((shape) =>
    cardsIn(cards, shape, 'command').some((card) =>
      card.availableDecisions.includes('allow_for_session'),
    ),
  )
  if (offering.length > 0) return { verdict: 'offered', shapes: offering }
  const silent = shapes.filter((shape) => cardsIn(cards, shape, 'command').length === 0)
  if (silent.length > 0) {
    return { verdict: 'not-performed', because: `no command card on ${silent.join(', ')}` }
  }
  return { verdict: 'never-offered' }
}
