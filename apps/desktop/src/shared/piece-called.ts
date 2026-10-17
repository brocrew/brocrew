/**
 * 🔴 **D-016 · how a piece of work is named — its LABEL, `W1.4.2`, built and read in one module.**
 *
 * ⚑ **A label is the numbers from the root down.** A conversation with no parent owns a root, and
 * roots are numbered across this app (`W1`, `W2`); a piece given under another is numbered under
 * its parent (`W1.1`, `W1.2`). Numbers are never reused (`work_sequence`), so one label names one
 * piece for good, and a label a model or a person quotes can be resolved one level at a time.
 *
 * ⛔ **Every surface that names a piece says its label, never its id**: the brief's sender line,
 * the notices a giver is pushed, `list_tasks`' lines, the person's queue and the transcript's cards
 * — and, since D-016 · commit 7, every sentence that names another conversation, by the piece it
 * owns ({@link theConversationCalled}). An id (`work_…`) is what a door takes back; every door that
 * takes a piece takes the label too, and every door that takes an agent takes the label of a piece
 * it owns.
 *
 * ⚑ **And a person's rename of a piece** (R4): {@link RETITLE_RAILS}, the words for each, and what
 * the door answers.
 *
 * ⚑ **In `shared/` and importing nothing**, as the task spelling it replaces was (`672`, `697`): main
 * composes notices and digest lines whole, and the renderer draws the same words, so the one spelling
 * must be reachable from both. ⚠️ Importing nothing is what keeps it free to the renderer.
 */

/**
 * ⛔ **The most characters a piece's title may hold** — `give_work`'s and `update_work`'s bound.
 *
 * ⚑ A title is the line a person and a model read beside the label ({@link pieceLine}); the brief is
 * where the work is said at length, and it has no bound of this kind.
 */
export const PIECE_TITLE_CHARS = 200

/** `'W'` + the numbers from the root down, joined by `'.'`: `[1]` → `'W1'`, `[1, 4, 2]` → `'W1.4.2'`. */
export function pieceCalled(numbers: readonly number[]): string {
  return `W${numbers.map((number) => String(number)).join('.')}`
}

/**
 * ⚑ **{@link pieceCalled}'s inverse** — `null` unless the label is exactly `W<n>(.<n>)*`, with every
 * `n` at least 1 and written with no leading zero.
 *
 * ⛔ **Strict, so one piece has one spelling.** `W01` and `w1` are not `W1`: a lookup that admitted
 * them would let two strings name one piece, and a stored label that is not one this module writes
 * is dropped where it is read rather than repaired.
 */
export function pieceNumbersOf(label: string): readonly number[] | null {
  if (!/^W[1-9][0-9]*(\.[1-9][0-9]*)*$/.test(label)) return null
  const numbers = label.slice(1).split('.').map(Number)
  return numbers.every(Number.isSafeInteger) ? numbers : null
}

/**
 * ⚑ **How a piece is named beside its title**, in words a model or a person reads:
 * `'W1.2 · Draft the plan'`. ⛔ A root nobody has titled yet reads as its label alone.
 */
export function pieceLine(label: string, title: string | null): string {
  return title === null ? label : `${label} · ${title}`
}

/**
 * ⚑ **F033 · how a piece ended, when it names a conversation that holds nothing open** — its state:
 * answered, taken back (`withdrawn`) or closed. ⚑ A root never ends, so it never carries one.
 */
export type HowAPieceEnded = 'answered' | 'withdrawn' | 'closed'

/**
 * ⚑ **F033 · {@link HowAPieceEnded} in the words a model or a person reads beside the piece** — a
 * withdrawn piece is one *taken back*, as `withdraw_task` and its refusals say it.
 */
export const HOW_A_PIECE_ENDED_SAID: Readonly<Record<HowAPieceEnded, string>> = {
  answered: 'answered',
  withdrawn: 'taken back',
  closed: 'closed',
}

/**
 * 🔴 **D-016 · commit 7 · R2 — the work that names a conversation** — `SessionStore.workThatNames`'
 * answer: a label, and the title it now stands under (`null`: a root nobody has titled yet).
 *
 * ⚑ **F033 · and what is true of it beside that** — a piece is named while it is open, and only the
 * newest of several is: `more` says how many other open pieces it holds. With none open, the piece
 * that ended last names it, and `ended` says how — so an idle helper never reads as working on a
 * piece it already handed back. ⚠️ Each is absent when it does not apply — a root, one open piece,
 * or a sentence about one piece (`SessionStore.workThatNamesUnder`), which says what became of that
 * piece itself.
 */
export interface WorkThatNamesIt {
  readonly definitionOfDone?: string | null
  readonly label: string
  readonly title: string | null
  /** ⚑ **F033** — how many more open pieces it holds than this one; absent for none. */
  readonly more?: number
  /** ⚑ **F033** — how this piece ended, when nothing it holds is open; absent while it is open. */
  readonly ended?: HowAPieceEnded
}

/**
 * ⚑ **F033 · the work that names a conversation, as one line** — `W1.3 · Ship the page`;
 * `W1.3 · Ship the page (and 2 more)` beside more open pieces; `W1.1 · Plan the trip (answered)`,
 * `(taken back)` or `(closed)` once it ended — parenthesised, so a title's own commas never run
 * into it. ⚑ The one spelling every sentence draws ({@link theOwnerOf}), and the window's rail row,
 * palette, header title and Team roster draw it too.
 */
export function theWorkThatNamesItSaid(named: WorkThatNamesIt): string {
  const line = pieceLine(named.label, named.title)
  if (named.ended !== undefined) return `${line} (${HOW_A_PIECE_ENDED_SAID[named.ended]})`
  return named.more === undefined || named.more < 1
    ? line
    : `${line} (and ${String(named.more)} more)`
}

/**
 * ⚑ **F033 · the work that names a conversation, as one piece alone** — its label and title, with no
 * count of more and no word on how it ended: for a sentence about one question, one message or one
 * wait, which says what became of its own subject itself (*"is waiting on an answer"*, a line's
 * *"· open"*, a wait's *"+1"*), so a second state word beside the name would read as about it.
 */
export function theWorkAlone(named: WorkThatNamesIt | null): WorkThatNamesIt | null {
  return named === null ? null : { label: named.label, title: named.title }
}

/**
 * ⚑ **R3 · a conversation named by the piece it owns** — `the owner of W1.2 · Build the pages` —
 * ⚑ F033 · with what {@link theWorkThatNamesItSaid} adds beside it.
 */
export function theOwnerOf(named: WorkThatNamesIt): string {
  return `the owner of ${theWorkThatNamesItSaid(named)}`
}

/**
 * 🔴 **R3 · the ONE way a sentence names another conversation** — its agent's name and the piece it
 * owns: `Ada (the owner of W1.2 · Build the pages)`; its agent's name alone when it holds no piece.
 * ⛔ Never an id: a sentence that needs one to be passed back says {@link anAddressOf}.
 */
export function theConversationCalled(agent: string, named: WorkThatNamesIt | null): string {
  return named === null ? agent : `${agent} (${theOwnerOf(named)})`
}

/**
 * ⚑ **R3 · what a reader passes back to name a conversation** — the label of the piece that names it,
 * which every door that takes an agent takes (R1), or its id when it holds no piece and has no label.
 */
export function anAddressOf(named: WorkThatNamesIt | null, id: string): string {
  return named === null ? id : named.label
}

/**
 * 🔴 **D-016 · commit 7 · R4 — why a person's rename was refused** — the door names a piece a person
 * gave (a root, or work taken on for a person); a conversation names what it gave. ⚑ See
 * {@link RETITLE_SAID} for what each says.
 */
export const RETITLE_RAILS = [
  /** No piece has that label or id. */
  'no-piece-by-that-name',
  /** A conversation gave it, and that conversation names it (R4). */
  'a-conversation-names-that-piece',
  /**
   * Blank once trimmed. ⚑ The other bound every title has, {@link PIECE_TITLE_CHARS}, is held where
   * the title enters — the wire and the header's field — so a longer one never reaches the door.
   */
  'a-title-is-one-line',
] as const

export type RetitleRail = (typeof RETITLE_RAILS)[number]

/** ⚑ **R4 · the words for each, a person's** — the header shows them under the field. */
export const RETITLE_SAID: Readonly<Record<RetitleRail, string>> = {
  'no-piece-by-that-name': 'Nothing was renamed: this app holds no piece by that name.',
  'a-conversation-names-that-piece':
    'Nothing was renamed: a conversation gave that piece, and that conversation names it.',
  'a-title-is-one-line': `Nothing was renamed: a title is one line of 1 to ${String(PIECE_TITLE_CHARS)} characters.`,
}

/**
 * 🔴 **R4 · what the rename answers** — the piece as it now stands, or the rail and its words.
 *
 * ⛔ **A refusal is a VALUE**, `ModelChoiceSaved`'s shape: each is a person's ordinary mistake, and a
 * thrown error would reach the header as *the app broke*.
 */
export type WorkRetitled =
  | { readonly ok: true; readonly piece: string; readonly label: string; readonly title: string }
  | { readonly ok: false; readonly rail: RetitleRail; readonly reason: string }

/**
 * Why a person's take-back was refused: it names no piece a service is on, or a piece at another
 * agent whose holder is no longer stopped with it, or that conversation is still starting, or the
 * brief carrying the piece is on its way to it; or a conversation holding a question passed up
 * about it is starting, or its questions could not all be read, so the copies could not end with
 * it. The window says each.
 */
export const PERSON_TAKE_BACK_RAILS = [
  'not-a-piece-a-service-is-on',
  'not-a-stopped-piece',
  'that-conversation-has-not-started',
  'that-work-is-being-sent',
  'a-conversation-with-its-questions-is-starting',
  'its-questions-could-not-all-be-read',
] as const

export type PersonTakeBackRail = (typeof PERSON_TAKE_BACK_RAILS)[number]

/**
 * What a person's take-back answers: the piece taken back, and whether the turn working on it was
 * asked to stop with it — or the rail that refused it.
 */
export type WorkTakenBackByAPerson =
  | {
      readonly ok: true
      readonly piece: string
      readonly label: string
      readonly askedItsTurnToStop: boolean
    }
  | { readonly ok: false; readonly rail: PersonTakeBackRail }
