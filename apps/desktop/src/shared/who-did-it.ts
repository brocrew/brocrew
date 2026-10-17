/**
 * 🔴 **Who performed an act this app wrote down** (477, HO-029 §2.1) — the vocabulary, and the
 * one phrasing every surface reads it through.
 *
 * ## ⛔ Why a vocabulary and not a name
 *
 * ⚠️ **This app has no person identity and no name to write.** The three kinds of caller it has
 * are a window on somebody's screen, a conversation's model calling a tool, and the runtime acting
 * with nobody behind it — `Caller` is exactly that union — so the honest thing a row can say is
 * WHICH KIND acted, plus the conversation's own id on the arm that has one.
 *
 * `a-person` identifies a request from an app window, not a named human. At {@link RuntimeHost.requireToAnswer}'s guarded doors, the calling surface must also declare a person behind it through `SessionSlot.ownerIsAPerson`. The vocabulary itself claims only what every writer can prove.
 *
 * ## ⚑ Reused rather than minted — and the one word that is new
 *
 * ⚠️ **`a-person` and `an-agent` were `WHO_ASKED_IT_TO_STOP`'s two members**, spelled the same and
 * meaning the same, with the conversation named beside the agent arm exactly as
 * `WorkInterruptedEvent.agent` does. ⚑ **`501` retired that pair** and pointed the event at
 * `WhoStoppedIt`, which is this list minus the app — so the two spellings are one.
 * ⛔ **`the-app-itself` is the caller model's third kind**, the one `THE_APP_ITSELF` stands for.
 * ⚑ Those are the three the vocabulary already had, and `HO-029` §2.1 says to use them.
 *
 * 🔴 **{@link WHO_DID_IT}'s fourth member is new, and it is the price of three POSITIVE tests.**
 * See {@link WhoDidIt} for the argument.
 *
 * ## ⚠️ What ABSENCE means, and it is not a fourth kind of actor
 *
 * ⛔ **A row with no actor at all was written before this app recorded one** — HO-029 §2.2, *"every
 * event written before this answers unknown, and the digest must keep saying so"*. ⚑ That is why
 * the field is optional on every event that carries it and why nothing backfills: an absence is a
 * fact about WHEN the row was written, and {@link WHO_DID_IT}'s fourth member is a fact about the
 * caller. Folding them together would report a discontinuity in this app's own history as a
 * property of the caller that acted.
 */

/**
 * ⛔ **The four answers a row may give**, and the fourth is the one that needed arguing.
 *
 * ## ⚑ The three that were already here
 *
 * **`a-person`** — a window on somebody's screen. **`an-agent`** — a conversation's model, through
 * a tool; {@link ActedBy} carries which. **`the-app-itself`** — the runtime, acting with nobody
 * behind it: a launch sweep, a teardown, a deadline falling due.
 *
 * ## 🔴 `a-caller-this-app-cannot-name`, and why it is not the coverage `395` refused
 *
 * ⚠️ **`how-work-stopped.ts` removed a third member because *nothing would ever have written it*,
 * and *a member nothing reaches guards nothing while making every census that walks the list
 * report a coverage it does not have*.** ⛔ That argument is about a member for an ACT that cannot
 * be performed that way. This one is about a CALLER, and the difference is what makes it a
 * different question.
 *
 * ⚑ **The reading is `BlockedSinceIs`' fourth word one subject over: the reading is the same and
 * the WORD is not.** `whoDidIt` asks three positive questions — is this the app symbol, does this
 * id decode to a conversation, is this a window — and **something has to be true of a caller that
 * answers no to all three.** ⛔ Without a word for it one of the other three becomes a
 * fall-through and inherits every caller that does not exist yet, which is `413` §3's measured
 * defect: *"the dangerous default is the one that credits a person with words they never wrote."*
 * ⚑ **`501` closed the last place that spelled it the other way.** `recordTheAsk` wrote
 * `speaking === null ? 'a-person' : 'an-agent'` — guarded only by a source-level claim about who
 * its callers are — and now asks this derivation like every other writer.
 *
 * 🔴 **And it is reachable, which is the test the removed member failed.** `Caller` is
 * `Pick<RuntimeEventSink, 'ownerId'>`, an opaque string minted at a boundary, and
 * `THE_APP_ITSELF`'s own docblock names the next mint: *"tomorrow the MCP tool a PM would spawn
 * agents through … gets its own prefix from whatever registers it."* ⚑ A caller with such an id
 * reaches `mayAnswerAsAHuman` today the moment its sink declares a person, so this member is
 * written the day that prefix exists rather than never.
 */
export const WHO_DID_IT = [
  'a-person',
  'an-agent',
  'the-app-itself',
  'a-caller-this-app-cannot-name',
] as const

export type WhoDidIt = (typeof WHO_DID_IT)[number]

/**
 * ⛔ **What each member means, in a person's words** — the vocabulary owns its own sentences, so a
 * member added here is a compile error rather than a blank space on a surface.
 *
 * ⚑ **Third person, never *"you"***, for {@link stoppedBy}'s measured reason: a digest is read by
 * somebody who was not the one who pressed the button, and by the same person a week later.
 */
export const WHO_DID_IT_SAYS: Readonly<Record<WhoDidIt, string>> = {
  'a-person': 'a person',
  'an-agent': 'an agent',
  'the-app-itself': 'this app itself',
  'a-caller-this-app-cannot-name': 'a caller this app has no word for',
}

/**
 * 🔴 **One act's actor, as a durable row states it** — a discriminated union, so the agent's
 * conversation exists on the arm that has one and nowhere else.
 *
 * ⛔ **Not a word beside an optional id.** `WorkInterruptedEvent` is the flat pair — `by` plus an
 * `agent?` that is *"present if and only if"* the agent arm — and that sentence is a rule a reader
 * has to keep rather than a shape a writer cannot break: `{ by: 'a-person', agent: 'sess_x' }`
 * compiles there and is unconstructable here. ⚠️ **The value exists on exactly one arm**, which is
 * this app's stated test for a union over a pair.
 *
 * ⚑ **The agent arm carries the answering conversation's SESSION id**, which is
 * {@link WorkInterruptedEvent.agent}'s own rule: a reader can join the row to that conversation's
 * ledger instead of having to know how a caller id is spelled.
 */
export type ActedBy =
  | { readonly who: 'an-agent'; readonly agent: string }
  | { readonly who: Exclude<WhoDidIt, 'an-agent'> }

/**
 * ⚑ **The app, as an actor** — ONE spelling, imported by every writer that is the app.
 *
 * ⛔ **A second object literal anywhere is a second thing to keep in step**, and — the sharper
 * reason — a mutation on one of two byte-identical literals is a row that changes nothing a reader
 * can see. `whoDidIt` returns this value rather than building its own, so the app arm has exactly
 * one definition in the tree.
 */
export const THE_APP_DID_IT: ActedBy = { who: 'the-app-itself' }

/**
 * ⛔ **Who did it, in a person's words** — ONE phrasing, for every surface that names an actor.
 *
 * ⚠️ **Not composed at a call site**, which is {@link stoppedBy}'s standing rule and is
 * load-bearing here for the same reason: the digest names the actor of a row weeks later and the
 * Events tab names it while the conversation is running, and two spellings would be two chances to
 * disagree about a fact this dispatch exists to get right.
 *
 * ⛔ **`undefined` is the row that predates provenance, and it says so** rather than naming
 * anybody. ⚑ It is the sentence HO-029 §2.2 keeps for ever.
 */
export function didIt(actor: ActedBy | undefined): string {
  if (actor === undefined) return 'nobody this ledger records'
  // ⚠️ **The conversation's id when the row carries one**, and the bare word otherwise — the
  // agent arm always carries one, so this is a narrowing rather than a fallback.
  //
  // 🔴 **503 · the other arm goes through {@link whoDidItSays} and used to index the table
  // directly.** ⛔ The value reaching here has crossed the ledger — `TranscriptEvent` is
  // `JSON.parse`d and cast with no schema — so a row written by a build whose vocabulary has moved
  // arrives as a word this one has no sentence for, and `WHO_DID_IT_SAYS[word]` is `undefined`.
  // ⚠️ The Events tab has drawn this value since `477` and would have printed the string
  // `undefined` for such a row, which is {@link isWhoDidIt}'s own stated reason for existing.
  return actor.who === 'an-agent' ? actor.agent : whoDidItSays(actor.who)
}

/**
 * ⛔ **Is this a member of the vocabulary, asked of a value that has crossed the ledger?**
 *
 * ⚠️ **The boundary is the ledger, not the wire** — `isProposalEnding`'s reason, verbatim:
 * `TranscriptEvent` is `JSON.parse`d and cast with no schema between the database and a fold, so a
 * row written by a build whose vocabulary has moved reaches a reader as a word it does not know.
 * ⛔ A digest that printed `undefined` for who answered a request would be the confident sentence
 * criterion 18 exists to prevent.
 */
export function isWhoDidIt(said: unknown): said is WhoDidIt {
  return typeof said === 'string' && (WHO_DID_IT as readonly string[]).includes(said)
}

/**
 * 🔴 **An {@link ActedBy} read back out of storage, folded — never trusted, never `undefined`**
 * (582).
 *
 * ## ⛔ Why a fold and not a cast, at a boundary the ledger's own values cross without one
 *
 * ⚠️ **{@link isWhoDidIt}'s boundary argument, one shape out.** A stored `ActedBy` reaches a reader
 * as `JSON.parse`d `unknown`: a build whose vocabulary has moved, a hand-edited row and a column
 * holding a bare word instead of an object are all reachable, and a cast would hand every one of
 * them to a surface that prints *"this was done by undefined"*.
 *
 * Fold unreadable provenance to `the-app-itself` via {@link THE_APP_DID_IT}, as `settleStrandedProposals` does. This avoids falsely claiming that the person performed an act whose origin cannot be established.
 *
 * ⚠️ **The agent arm needs BOTH halves** — `who` and a non-empty `agent` — because the union's whole
 * point is that the id exists on exactly one arm, and an arm with no id is the flat pair this type
 * was written to make unconstructable.
 */
export function actedByFrom(stored: unknown): ActedBy {
  if (typeof stored !== 'object' || stored === null) return THE_APP_DID_IT
  const said = (stored as { who?: unknown; agent?: unknown }).who
  if (!isWhoDidIt(said)) return THE_APP_DID_IT
  if (said !== 'an-agent') return { who: said }
  const agent = (stored as { agent?: unknown }).agent
  return typeof agent === 'string' && agent !== '' ? { who: said, agent } : THE_APP_DID_IT
}

/**
 * ⚑ **A word off a replayed ledger, said as itself when this build has no sentence for it** —
 * `permanenceSaid`'s shape, and the one place a digest must not print `undefined`.
 */
export function whoDidItSays(said: string): string {
  return isWhoDidIt(said) ? WHO_DID_IT_SAYS[said] : said
}

/**
 * ⛔ **What a ledger that names nobody says, and the ONE place its bytes live** (503, from `465`
 * via HO-029 §2.2).
 *
 * ⚠️ **`465` shipped this sentence and the digest composed it inline.** `477` then scoped it —
 * *"a window holding only old rows composes `465`'s sentence byte for byte"* — and `503` gave a
 * second surface the same population to describe. ⛔ **Two composers would be two chances to
 * disagree about the one fact this app has to be most careful with**, which is `stoppedBy`'s
 * standing rule applied to a sentence rather than to an actor.
 *
 * 🔴 **It is NOT *an actor we failed to write*.** The absence is a fact about WHEN the row was
 * written — before this app recorded who — and nothing backfills, so this stays the true thing to
 * say about that population for ever.
 *
 * @param verb what was done to the thing nobody is recorded as having done — `answered` for a
 *   request, `settled` for a proposal.
 * @param count how many rows in this population; one row says `it`, several say `them`.
 */
export function nothingRecordsWho(verb: string, count: number): string {
  return `Nothing in the ledger records who ${verb} ${count === 1 ? 'it' : 'them'}`
}

/**
 * 🔴 **What a SETTLED request says about who answered it** (503, HO-037 §2) — one phrasing,
 * for every surface that draws a request's own answer.
 *
 * ⛔ **The words are {@link WHO_DID_IT_SAYS}' and never the conversation's id.** {@link didIt}
 * draws the id, deliberately, because `describe-event.ts` is the ledger made readable and `413` §4
 * put the id *"HERE and nowhere a person reads"*. ⚠️ A request card is somewhere a person reads,
 * so it gets the KIND — which is also the whole of what the PO asked this to distinguish: *I
 * decided this* from *the project manager handled it*.
 *
 * ⚑ **A clause and not a sentence on the named arm**, which is {@link stoppedBy}'s shape: the card
 * supplies the subject it sits beside (its own verdict word) and this supplies the claim. ⛔ **The
 * absent arm IS a sentence**, because there is no actor for a clause to name and a bare `by …`
 * would need one.
 *
 * ⚠️ **Only for a request that was ANSWERED.** A card settled by a teardown was answered by
 * nobody at all — a third population, and neither of these two arms is true of it — so the
 * surfaces draw this only where a decision exists.
 */
export function whoAnsweredIt(actor: ActedBy | undefined): string {
  return actor === undefined ? nothingRecordsWho('answered', 1) : `by ${whoDidItSays(actor.who)}`
}
