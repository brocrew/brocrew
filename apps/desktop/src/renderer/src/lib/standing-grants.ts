import { grantRulesSaid } from './permission-offer'
import type { TranscriptItem } from './transcript'

/**
 * 🔴 **The two standing grants a conversation carries, in words** (529, `HO-050` §1.2).
 *
 * ⚑ **The subject is one question and the conversation's controls asked it first** — *what
 * does this conversation do without me*. It has two answers and neither of them is a control:
 * what it may run without asking, and who else may ask it to do something.
 *
 * ⛔ **Both were sitting in the Approvals group, and the PO ruled them out of it:** *"Controls are
 * things you press. Info is things you read."* ⚠️ **The exception in the same ruling is the reason
 * this module holds only two sentences and not three:** the yolo disclosure STAYS with the
 * approval-mode button, because `514` F1 is *a caveat placed after the verdict argues with a
 * decision the reader has already taken*, and a person who reads what yolo removes on a different
 * screen from the one where they turn it on has read it too late. 🔴 **Neither sentence below is
 * about a press.** One reports what earlier presses granted; the other reports a relationship
 * fixed at reservation. **That is what makes them readable material and the disclosure not.**
 *
 * ## ⚑ Two sentences about the caller, and the boundary between them is the point
 *
 * ⛔ **`527` made the Info surface an INDEX** — a narrow list that navigates, whose longest string
 * is a line rather than a paragraph — so a 484-character disclosure cannot stand in it inline.
 *
 * ⚑ {@link ANOTHER_CALLER_IS_ON_IT} is the index line and {@link ANOTHER_CALLER_MAY_REACH_IN} is
 * behind that row's *what this is*, which is `356 §1`'s own rule for this panel: *the row shows
 * the label, the value and a way to open it; the sentence explaining the concept goes behind a
 * per-row disclosure that starts collapsed.*
 *
 * 🔴 **The split is by KIND and a test pins it.** The line states that a caller EXISTS; the
 * paragraph states what it may DO. ⛔ **The line names no verb**, because a short summary that
 * listed two of the three would be `395`'s defect again — *a bounded list read as a complete one*
 * — on the surface a person sees first and the fold they may never open.
 *
 * ## ⚠️ Why a module rather than two paragraphs in the component they moved to
 *
 * ⛔ **A sentence that moves between components is a sentence that can be left behind in both.**
 * `the-layer-a-file-belongs-to.test.ts` counts copies rather than asking whether one exists,
 * because *a `toContain` finds the first copy and is blind to a second* — and the way a second
 * copy gets made is exactly this: somebody moves a block and leaves the old one rendering while a
 * later dispatch edits only the new one. ⚑ The constants are the one place either sentence
 * exists, and `press-read-and-a-word.test.ts` counts the literals in every renderer file.
 *
 * ## ⛔ What these deliberately do NOT say
 *
 * ⚠️ **Neither offers a way out, because there is none.** A session grant is a set inside the
 * adapter: there is no revoke on the handle, in the IPC, or in either provider's protocol, and
 * `commandedBy` is `readonly` on the slot and fixed at reservation (`340`). ⛔ A Revoke button
 * would be a control that cannot do what it says, and a sentence promising one would be worse.
 * **So both sentences say how the thing ENDS instead**, which is `031`'s actual requirement — a
 * person must be able to SEE what they granted.
 */

/**
 * ⛔ **Who else can give this conversation work** (`349`, HO-006 §4.5).
 *
 * **Each clause, and the code it is read off:**
 *
 * - *another caller … can reach into this conversation while you have it open* —
 *   `CreatedSession.hasACommander`, which is `SessionSlot.commandedBy` reduced to a boolean
 *   because there is no spawn-tree UI to resolve an `ownerId` into a name (`085`).
 * - *it can go as far as sending messages here, stopping what this conversation is doing, and
 *   ending it* — the three verbs `mayCommand` admits. ⚑ **"As far as", because sending also asks
 *   the caller's own `can_message`**, which a person may narrow; stopping and ending ask nothing
 *   more of a caller that started this conversation (D-014).
 * - *It cannot answer what this session stops to ask* — `mayAnswerAsAHuman`, which refuses every
 *   commander and refuses the app itself. ⚠️ **This clause is the one that does not move**: it is
 *   structural, so no grant widens it and no dispatch can add a verb that does.
 *
 * ⛔ **Not shown on an ENDED conversation.** Every verb named here is refused once the session is
 * over, so the sentence would describe a capability nobody has — `469`'s class, said once.
 */
/**
 * ⛔ **That there IS one, and nothing about what it may do** (529 relay 1).
 *
 * ⚑ **The index line.** `527`'s Info surface is a list of facts, one line each; this is the fact.
 * ⚠️ *usually an agent* is the only gloss it carries, because *caller* alone is jargon and the
 * row would state something a reader cannot picture.
 *
 * ⛔ **It names no verb, and that is asserted rather than intended.** `395` corrected this copy
 * once already for reading as a complete list of what a commander may do. **A summary is where that
 * mistake comes back**, so the summary says only that the caller is there and the paragraph says
 * the rest.
 */
export const ANOTHER_CALLER_IS_ON_IT =
  'There is another caller on this conversation — usually an agent.'

/**
 * ⚑ **The paragraph behind the Info row's *what this is*** — what the other caller can do, and
 * what it cannot.
 * ⚑ **D-017 · *"and ending it"* went with `end_agent`**: nothing ends a conversation (`05` rule 2).
 */
export const ANOTHER_CALLER_MAY_REACH_IN =
  'Another caller — usually an agent, through BroCrew’s own tools — can reach into this ' +
  'conversation while you have it open. It can go as far as sending messages here and stopping ' +
  'what this conversation is doing. It cannot answer what this session stops to ask: an ' +
  'agent can give this conversation work, but not decide what that work is allowed to do. That is ' +
  'a person’s decision, and while you have this conversation it is yours. Your own messages are ' +
  'unaffected — they go, or wait for a running turn, exactly as they would anyway.'

/**
 * 🔴 **739 · `730` F-1 — the label for what this session is not asked about again** — the Info
 * row's. ⛔ It said *always allowed*, and almost every entry is a CONVERSATION
 * grant, which a later start of the conversation may ask about again; ⚠️ and since `736` a Codex tool kept with *Always allow*
 * is on the same list (read back at every launch that declares its server), so no word about how
 * long could be true of the whole list — `blanketGrants` carries no lifetime (`739` GAP). ⚑ *Not
 * asked again* is true of every entry, whichever it is — by this grant: the Claude CLI still runs
 * its own safety checks before any allow rule (`728`'s review), as `HOW_THESE_GRANTS_END` says by
 * leaving out *at all*.
 */
export const NOT_ASKED_AGAIN = 'not asked again'

/**
 * ⛔ **What a blanket grant is, and how it ends** (`031`, `079`) — renamed at `739` from
 * `GRANTS_END_WITH_THE_CONVERSATION`, which since `736` was false of one of them.
 *
 * **Each clause, and the code it is read off:**
 *
 * - *no longer asks before running these — whatever the arguments* —
 *   `CreatedSession.blanketGrants`, an `ApprovalModeDisclosure` field: the grant is by TOOL, not
 *   by invocation, so a person who allowed one `Bash` allowed every `Bash`. ⚠️ Not *at all*: the
 *   Claude CLI still asks its own safety checks before any allow rule (`728`'s review).
 * - *BroBot cannot take them back* — there is no revoke anywhere on the path; see the module note.
 * - *One allowed for this conversation may be asked about again later; one kept with “Always
 *   allow” is not* — ⛔ it said *they end when the conversation is closed*, true until `736`: a
 *   Codex tool kept with *Always allow* is on this list too (kept in the provider home and listed at
 *   every later launch that declares its server), and the list carries no lifetime to tell the two
 *   apart (`739` GAP) — so the sentence says both, and each entry is one of them. ⚑ **D-017b** — and
 *   not *ends when it is closed* any more: nothing closes a conversation, and a grant for it lasts
 *   as long as the run that took it, so a later start may ask again — said without naming the run
 *   (`05` rule 5). The ones kept in THIS conversation are also listed apart
 *   ({@link keptInThisConversation}).
 */
export const HOW_THESE_GRANTS_END =
  'This conversation no longer asks before running these — whatever the arguments. BroCrew cannot ' +
  'take them back. One allowed for this conversation may be asked about again later; one kept ' +
  'with “Always allow” is not.'

/**
 * 🔴 **739 · `736` F-1 — one grant *Always allow* kept in THIS conversation**, read off its own card:
 * what it keeps (`scope.grants.allow_always`, in the card's words; where the card named no rule,
 * *the provider’s own rule for <action>, which its card did not name* — never the bare action),
 * the file it is kept in (`alwaysFile`, verbatim — `740` moves it, R99), and the names it is listed
 * under in `blanketGrants`, where it is a whole tool (Codex's `mcp__<server>__<tool>`), so the
 * not-asked-again list does not also claim it.
 */
export interface KeptHere {
  readonly said: string
  readonly file: string | null
  readonly listedAs: readonly string[]
}

/**
 * 🔴 **739 · `736` F-1 — the grants kept in this conversation, apart from its conversation grants.**
 *
 * ⚑ Read off the cards a person answered *Always allow* (`outcome === 'allow_always'`, which the
 * host writes only once the adapter took the answer — a failed keep is refused first and writes
 * nothing, so it is never listed). ⚠️ **A POSITIVE list, never *nothing was kept***: the transcript
 * is a window (a long conversation releases its oldest items, and a reopen loads its tail), and a
 * Codex tool kept by another conversation is on `blanketGrants` with no card here at all — so the
 * words that draw this say which part they were read from ({@link KEPT_BEYOND_IT_SAYS}).
 */
export function keptInThisConversation(items: readonly TranscriptItem[]): KeptHere[] {
  const kept: KeptHere[] = []
  for (const item of items) {
    if (item.kind !== 'permission' || item.outcome !== 'allow_always') continue
    const grants = item.request.scope.grants
    const rules = grants?.allow_always ?? []
    const said =
      rules.length === 0
        ? // ⚑ 739 · a card that named no rule — never the bare action, which in Info's row reads as
          // the whole tool (the card's own kept row says the rule was not named).
          `the provider’s own rule for ${item.request.action}, which its card did not name`
        : grantRulesSaid(rules, item.request.scope.cwd)
    const file = grants?.alwaysFile ?? null
    if (kept.some((one) => one.said === said && one.file === file)) continue
    const listedAs = rules.flatMap((rule) =>
      rule.kind === 'tool' && rule.content === undefined
        ? [rule.server === undefined ? rule.tool : `mcp__${rule.server}__${rule.tool}`]
        : [],
    )
    kept.push({ said, file, listedAs })
  }
  return kept
}

/** 🔴 739 · the not-asked-again list without the entries {@link keptInThisConversation} lists apart. */
export function notKeptHere(blanketGrants: readonly string[], kept: readonly KeptHere[]): string[] {
  return blanketGrants.filter((name) => !kept.some((one) => one.listedAs.includes(name)))
}

/** 🔴 739 · the label for the grants kept in this conversation — Info's row. */
export const KEPT_BEYOND_THIS_CONVERSATION = 'kept beyond this conversation'

/**
 * 🔴 **739 · `736` F-1 — what a kept grant is**, behind the Info row.
 *
 * - *kept with “Always allow” in this conversation, each in the file named beside it* —
 *   `alwaysFile`, the file the card said it would be kept in.
 * - *a later conversation whose launch applies that file is not asked about what it covers, beyond
 *   the provider's own safety checks* — ⛔ never WHICH later conversation: that is the file's
 *   reader's (Codex: a prefix rule in the provider home's `rules/default.rules`, read at every launch
 *   of that home; a tool kept in `brobot-kept-tool-approvals.json`, declared at every launch of that
 *   home that declares its server at the same address; since `740`, R99, a Claude rule in the
 *   project's own settings, read for launches in that project — and NOT applied where the repository
 *   carries that file: BroBot records no trust for a folder, so its host drops that file's allows,
 *   740's `projectRulesFor` / `carriedByTheRepository`), and the name of the file is what says which. *applies*, not *reads*,
 *   for that last case; *beyond the provider's own safety checks* for the CLI's (`728`'s review).
 * - *BroBot cannot take them back* — no revoke, as above; the file is a person's to edit.
 * - *Listed from the part of this conversation this window has loaded* — see
 *   {@link keptInThisConversation}: a positive list.
 */
export const KEPT_BEYOND_IT_SAYS =
  'Kept with “Always allow” in this conversation, each in the file named beside it: a later ' +
  'conversation whose launch applies that file is not asked about what it covers, beyond the ' +
  'provider’s own safety checks. BroCrew cannot take them back. Listed from the part of this ' +
  'conversation this window has loaded.'

/** 🔴 739 · one kept grant with its file, as the Info note lists it. */
export function keptAndWhere(kept: KeptHere): string {
  return kept.file === null ? kept.said : `${kept.said} — in ${kept.file}`
}
