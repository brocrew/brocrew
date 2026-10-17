import { providerName, type PermissionDecision, type Provider } from '../../../shared/runtime-ipc'

import type { NoPositiveBecause, PermissionOutcome, PermissionRequestEvent } from './transcript'

/**
 * # ⛔ Where a permission outcome may be DRAWN — decided once, for every surface (299 §1)
 *
 * `297`, reading the two consumers side by side: **the wholesale session grant is the second button
 * on the Home overview.**
 *
 * ## Why it could happen
 *
 * The same rule was written down once and consumed twice, and only one consumer held it:
 *
 * | surface | what it drew | |
 * |---|---|---|
 * | `PermissionCard.vue` | `ORDER.filter(…)` — four outcomes, wide grant apart, under its own warning | ✔ right |
 * | `attention.ts` | `scope.availableDecisions.map(…)` — **every** offered outcome, positionally | ⛔ wrong |
 *
 * `claudeDecisionsFor` is a `.filter` over a fixed array, so the provider's order is preserved: on a
 * `Write` card index 1 is `allow_for_session`, and on a `Bash` card — where `031` refuses the narrow
 * grant precisely because the card cannot describe what it would cover — index 1 is
 * `allow_all_for_session`. `AttentionQueue.vue` drew each as a peer `<button class="request-decide">`
 * with one shared `data-cy` and `.deny` as the only style variant. ⛔ **Same row, same slot, same
 * styling: a person who has learned that the second button means _this conversation_ presses it on a
 * Bash card and grants any Bash command for the session.**
 *
 * ⚑ **Both tests were correct.** `claude-runtime.test.ts:4272` proves the runtime really ships the
 * wholesale grant to an opaque tool; `wide-grant.render.test.ts:72` proves the CARD holds the rule
 * structurally. **There were two consumers and only one was ever asked.**
 *
 * ## ⛔ The rule, and it is ONE rule
 *
 * `permission.ts` states it normatively — *"a UI must never present the two as the same choice"* —
 * and this is where that sentence becomes code the surfaces cannot each interpret for themselves.
 * **{@link permissionOffer} decides both halves together**: what belongs in the button row, in what
 * order, and which outcome is not a button in a row at all.
 *
 * ⚠️ **A second filter beside the first would have been the same defect with a longer fuse** — the
 * `238` lesson about two implementations of one fold, and `214` §3's lesson about the overview and
 * the card holding one fact apart. There is no second predicate here to drift.
 *
 * ## ⚑ What is deliberately NOT shared, so this file is not read as more than it is
 *
 * **The WORDS on the buttons.** The card says `Approve` / `Cancel turn`; the overview says `Allow` /
 * `Cancel`. `297` looked at that pair and ruled it *"real but a different defect"*, and it is: two
 * surfaces may legitimately address a reader differently, and nothing about the divergence can widen
 * a grant. What may not differ is which outcomes are peers — so composition is shared here and
 * vocabulary stays where it is drawn. ⚑ **Except the words that name how long a grant lasts**: the
 * conversation grant is {@link ALLOW_FOR_THIS_CONVERSATION} on every surface, so the card and Waiting
 * on you never name one choice two ways.
 * ⚑ **730 · R80 — except where an MCP tool call made the words one ruling**: both surfaces say
 * {@link ALLOW_ONCE} and {@link ALLOW_FOR_THIS_CONVERSATION} there (and {@link ALWAYS_ALLOW}, the
 * *Always allow* R95 added at `736`, withdrawing R80's *"never always"*, drawn since `739` on every
 * surface — {@link PLACE}); and a cancel that cannot stop the turn (R81) is {@link CANCEL_REQUEST} on
 * the card.
 * ⚑ **737 · and where an MCP SERVER asks** (`mcpServerAsks`, `728`): both surfaces say {@link ALLOW},
 * its CLI's word.
 *
 * ⚠️ **One word IS shared, because it names a consequence rather than a surface**:
 * {@link wideGrantLabel}. The card puts it on the button and, since `743` (`739` F-1, ruled), so do
 * the overview and the person's queue — until then the overview quoted it in a sentence saying where
 * that button was — three surfaces naming one grant, which is the thing that must not come apart.
 */

/**
 * The one wholesale outcome. Its own constant so the placement table below and the two sentences
 * that name it cannot drift onto different members of {@link PermissionOutcome}.
 */
const WIDE = 'allow_all_for_session' as const satisfies PermissionOutcome

/**
 * ⛔ **Where each outcome is drawn, and a `Record` so a NEW outcome does not compile until somebody
 * rules on it.**
 *
 * A number is a slot in the button row, in that order — the card's own `ORDER`, which is now the
 * overview's too, so the second button means the same thing on both surfaces whatever the provider
 * happens to list first — ⚠️ except on a `defaultToNo` ask (695), whose refusals lead in this same
 * order and its allowing answers follow. `'apart'` is *not a button in the row*: every surface draws
 * it after the row, under its own warning ({@link wideGrantWarning}) — ⚑ since `743` (`739` F-1,
 * ruled) *Waiting on you* and the person's queue as well as the card; until then they said where it was. ⚑ Since
 * `739` the wholesale grant is the only outcome that is `'apart'`.
 *
 * ⚠️ **The alternative — a plain `PermissionOutcome[]` of the row members — is what the card had,
 * and it is silent about the outcome it leaves out.** A sixth outcome added to the runtime's enum
 * would simply not render anywhere, which is `106`'s defect (a control the provider offered and no
 * surface draws) arriving without a build error. Here it is a type error in this file, which is the
 * only place that has an opinion.
 */
const PLACE: Record<PermissionOutcome, number | 'apart'> = {
  allow: 0,
  allow_for_session: 1,
  // 🔴 **739 · `736` F-1 — R95's *Always allow*, a button in the row on every surface**, after the
  // conversation's grant and before the refusals — the Codex terminal's own order (*Allow* / *for
  // this session* / *Always allow*, `736` §1), and the brief's roster (`2 * 5`). ⚑ `'apart'` is the
  // wholesale grant's: EVERY use of a tool, whatever it is given — over a card that could not show
  // all of what that covers (058, `031`) — under its own warning. *Always allow* keeps the provider's
  // own rule for the ask, and the line under it names that rule and where it is kept
  // ({@link keptGrantOf}). ⚠️ **One card where the two meet**: on Codex's MCP card the kept rule IS
  // the whole tool, so the wider grant is the in-row one (`739` F-1; ruled — both on every surface,
  // drawn since `743`). ⚠️ Each
  // numbered entry stays alone on its line: `smoke:ui` step 82 and `step-census.test.mjs` count them
  // (`PERMISSION_MATRIX_UNITS`).
  allow_always: 2,
  deny: 3,
  cancel: 4,
  [WIDE]: 'apart',
}

/**
 * ⛔ **Whether pressing an outcome ALLOWS the request or REFUSES it** (487) — a `Record`, for
 * {@link PLACE}'s reason: a sixth outcome does not compile until somebody has ruled on which it is.
 *
 * ⚠️ **A second table rather than an import**, and the trade is measured. The runtime's
 * {@link ALWAYS_HONOURED} is the same two members, and a VALUE import of it drags zod into the
 * renderer bundle (`a-value-import-from-shared-costs-the-renderer-135kb`). ⛔ So the agreement is
 * ASSERTED instead of assumed: `the-card-nobody-could-answer.render.test.ts` §1 walks the schema's
 * own outcome list and fails if these two sets ever come apart.
 */
const SENSE: Record<PermissionOutcome, 'allows' | 'refuses'> = {
  allow: 'allows',
  allow_for_session: 'allows',
  allow_all_for_session: 'allows',
  allow_always: 'allows',
  deny: 'refuses',
  cancel: 'refuses',
}

/** Whether pressing this outcome is a way to ALLOW the request — see {@link SENSE}. */
export function outcomeAllows(outcome: PermissionOutcome): boolean {
  return SENSE[outcome] === 'allows'
}

/** The WHOLESALE grant, once a request offers one. */
export interface WideGrant {
  outcome: typeof WIDE
  /** What it says, with the tool in it — see {@link wideGrantLabel} (and its R80 arm, which has none). */
  label: string
}

/** What every surface may draw for one permission request. */
export interface PermissionOffer {
  /**
   * The button ROW, in a stable order, containing only what the provider offered.
   *
   * ⛔ **The wholesale grant is never in here**, whatever the provider listed and in whatever order.
   * That is the whole rule; see {@link wide} for where it goes instead.
   */
  row: PermissionOutcome[]
  /**
   * The wholesale grant this request offers, or null.
   *
   * ⚠️ **Null means the provider did not offer one — never "this surface would rather not show it".**
   * A surface that chooses not to draw it still has to say so, because the grant exists and the
   * relief it offers is real (`058`): silently dropping it would leave `Bash` — the tool with the
   * worst approval fatigue and the reason the outcome exists — looking like a tool with no relief at
   * all.
   */
  wide: WideGrant | null
  /**
   * 🔴 **695 · R36b — which KIND of answer is the card's default: the filled, first one.**
   *
   * `'allows'` everywhere except where the provider marked the ask `defaultToNo`, which makes it
   * `'refuses'` — and then the row leads with the refusals, the card draws Approve OUTLINED rather
   * than filled (Deny keeps the tint every Deny has), and *Waiting on you* stops dimming the refusals. ⚑ Decided
   * here, beside the order, so the card's styling and *Waiting on you*'s row cannot come apart the way `299`
   * found the grant's placement had.
   */
  primary: 'allows' | 'refuses'
}

/**
 * 🔴 **695 · the two marks a provider can put on an ask, as the request carries them** — the same two
 * optional fields `permission_request` carries (`events.ts`, `suppressAlwaysAllowRule` and
 * `defaultToNo`). A type rather than the event, so a caller holding a stored row passes it as is.
 * ⚑ **700 · and the provider's own reason for them** (`695` F-f), which rides a marked ask — and, since `720` (R73) a Codex command an exec-policy rule stopped carries it too, labelled `providerReasonFrom: 'a-policy-rule'`, which every surface draws as the provider's RULE since `725`.
 */
export interface AskMarks {
  readonly suppressAlwaysAllowRule?: true
  readonly defaultToNo?: true
  /** 🔴 700 · `events.ts`'s `providerReason` — see {@link inTheProvidersWords}. */
  readonly providerReason?: string
  /**
   * 🔴 **725 · R73 — `events.ts`'s `providerReasonFrom`**: `'a-policy-rule'` when {@link providerReason}
   * is the provider's RULE (Codex's *"`<command>` requires approval: <rule text>"*, `720`), and absent
   * on every other row — see {@link inItsRulesWords}.
   */
  readonly providerReasonFrom?: 'a-policy-rule'
  /**
   * 🔴 **730 · R80 — Codex's own approval before an MCP tool runs** (`events.ts`' `mcpToolCall`,
   * carried since `723`): the server and the tool, which is all the grant's WORDS need. ⚑ Present
   * only on the card Codex raised for a call of its own; ⛔ never inferred from a question's text —
   * a server can send that text byte for byte (`723`'s `spoof` arm).
   */
  readonly mcpToolCall?: { readonly server: string; readonly tool: string }
}

/**
 * 🔴 **700 · `695` F-f — the provider's own reason for a marked ask, as a surface draws it** (a
 * Codex policy's rule, carried since `720`, is drawn by {@link inItsRulesWords} since `725`).
 *
 * ⚑ **Quoted and attributed, never restated.** The words are the provider's (the adapter cleaned them
 * of terminal codes and refused to carry our own hook's sentence as one), so they go between quotation
 * marks after a label that says whose they are. ⛔ **Like {@link GRANT_WITHHELD}, it does not name a
 * provider**: the field is on the neutral event.
 */
export function inTheProvidersWords(reason: string): string {
  return `The provider’s reason: “${reason}”`
}

/**
 * 🔴 **725 · R73 — a policy's own words, labelled as its RULE** (`709` F-5, ruled by the PM): Codex's
 * *"… requires approval: <rule text>"* is the provider's words, labelled as Codex's rule.
 *
 * ⚑ **The whole sentence, between the quotation marks, exactly as {@link inTheProvidersWords} draws a
 * reason** — the adapter cleaned it (`wordsForACard`) and carried it only when it names a rule.
 * ⚠️ **It is not split**: its head is the command in backticks, which is bytes the MODEL wrote, so a
 * crafted command can put its own *"requires approval: …"* first (`720` F-G) — and the rule text
 * cannot be cut off it here, because the carried sentence is whitespace-collapsed and the `action`
 * beside it is not. The quotation marks say where the provider's words begin and end; they do not
 * vouch for what the model put inside the command.
 *
 * ⚑ **The provider is NAMED where the surface knows it** — composed from {@link providerName}, never
 * typed (`317`) — and is *the provider* where it does not (a card mounted without its conversation).
 */
export function inItsRulesWords(rule: string, provider: Provider | null): string {
  return provider === null
    ? `The provider’s rule: “${rule}”`
    : `${providerName(provider)}’s rule: “${rule}”`
}

/** 🔴 725 · R44 — who said it, where a surface cannot name the agent. */
export const THE_AGENT = 'The agent'

/**
 * 🔴 **725 · R44 — what the MODEL wrote on a card, as its agent's words** (`704` H-4/H-5, ruled by
 * the PM): *"words the MODEL wrote that reach a card are the agent's, drawn under the agent's name;
 * never unlabelled, never the provider's."*
 *
 * ⚑ **Quoted and attributed, never restated** — {@link inTheProvidersWords}' form, with the agent's
 * name where the provider's label is. The name is the one this app gives the conversation's own
 * agent (`agentName`); ⚠️ where a surface has none it says {@link THE_AGENT}, the absence said out
 * loud rather than an identity invented.
 *
 * ⛔ **Never the disclosure of what Allow runs** (`181`) and never a scope line
 * (`permission.ts`): a sentence the agent wrote ABOUT the command or the access, drawn beside them.
 * ⛔ **And only off the field that names its author** (`agentReason`): a row written before `709`
 * carries the same words unlabelled in `permission.reason`, with no author recorded, and is drawn
 * as it was.
 */
export function inTheAgentsWords(name: string | null, words: string): string {
  return `${name ?? THE_AGENT} says: “${words}”`
}

/**
 * 🔴 **695 · R36a — why a card offers nothing for the rest of the conversation, when the provider
 * said so.** ⚑ The offer already obeys the mark — the adapter withholds both session grants — so
 * this sentence explains an absence; it grants and refuses nothing. ⛔ **It does not name a
 * provider**: the mark is on the neutral event, and naming one here would be a claim about which
 * adapter can raise it that nothing checks.
 * 🔴 **743 · `739` F-8's word** — *for the rest of this conversation*, the span the two grants it
 * explains the absence of say on their buttons (it said *session*).
 */
export const GRANT_WITHHELD =
  'Nothing here allows it for the rest of this conversation: the provider marked this request as one where a standing permission would allow more than this one action.'

/**
 * 🔴 **695 · R36 — what the provider's marks SAY on a surface, from ONE function for every surface.**
 *
 * ⚑ The card and *Waiting on you*'s row both draw these, and `299` is why they read one function rather than
 * two predicates: a sentence one surface drew and the other did not would be the same fact held apart.
 *
 * ⛔ **`grantWithheld` follows the OFFER as well as the mark.** The sentence explains an absence, so it
 * is drawn only where the absence is real — a marked card that still offered a session grant (no
 * producer does, today) would otherwise say *"nothing here allows it for the rest of this conversation"*
 * beside a button that does. `defaultIsNo` follows the offer's own {@link PermissionOffer.primary}.
 * ⚑ **700 · `providerReason` is the provider's own reason**, whenever the request carries one —
 * {@link inTheProvidersWords} — ⚑ **and, since `725` (R73), its RULE where the request says so**
 * (`providerReasonFrom: 'a-policy-rule'`) — {@link inItsRulesWords}, naming `provider` where the
 * caller knows it.
 */
export function whatTheMarksSay(
  marks: AskMarks,
  offer: PermissionOffer,
  provider: Provider | null = null,
): {
  readonly grantWithheld: string | null
  readonly defaultIsNo: string | null
  readonly providerReason: string | null
} {
  const offersAGrant = offer.wide !== null || offer.row.includes('allow_for_session')
  return {
    grantWithheld: marks.suppressAlwaysAllowRule === true && !offersAGrant ? GRANT_WITHHELD : null,
    defaultIsNo: offer.primary === 'refuses' ? DEFAULT_IS_NO : null,
    providerReason: !marks.providerReason
      ? null
      : marks.providerReasonFrom === 'a-policy-rule'
        ? inItsRulesWords(marks.providerReason, provider)
        : inTheProvidersWords(marks.providerReason),
  }
}

/**
 * 🔴 **695 · R36b — why Deny comes first on this card.** The provider's own words for the mark are
 * *"must not be approvable by a single stray keystroke"* (`sdk.d.ts:263-267`).
 */
export const DEFAULT_IS_NO =
  'Deny comes first here: the provider marked this request as one to decline unless you are sure.'

/**
 * 🔴 **730 · R80, ruled by the PM** (`720` F-A): *"When Codex asks to run an MCP tool, a person sees
 * it. A card naming the server, the tool and the parameters, with Allow once, Allow for this
 * conversation (when Codex offers `session`) and Deny. ⛔ Never always."* — its two words.
 * ⚑ **`736` · R95 withdrew the *"never always"***: the runtime now offers the Codex terminal's
 * *Always allow* (`allow_always`) beside these, drawn since `739` as {@link ALWAYS_ALLOW}.
 *
 * ⚑ **Each is what the answer does, measured** (`723` §1): *Allow once* — the tool ran, and the next
 * call was asked again; *Allow for this conversation* — the same tool with different parameters ran
 * with no ask, and another tool of the same server was asked again (`allow_all_for_session`, the
 * tool's grant whatever it is given).
 */
export const ALLOW_ONCE = 'Allow once'
export const ALLOW_FOR_THIS_CONVERSATION = 'Allow for this conversation'

/**
 * 🔴 **739 · `737` F-5 — what Codex's MCP card reads back after {@link ALLOW_ONCE}**: what was
 * granted and for how long, in its button's word — the tool ran, once, and the next call is asked
 * again (`723` §1, measured). ⛔ Never *Approved*, a word no button on that card says.
 */
export const ALLOWED_ONCE = 'Allowed once'

/**
 * 🔴 **739 · `736` F-1 — R95's *Always allow*, the word on its button on every surface**: the Codex
 * terminal's own (`736` §1: *Allow* / *for this session* / *Always allow*) and R95's. ⚑ What it keeps
 * and where is said under it, off the wire ({@link keptGrantOf}), never in the word.
 */
export const ALWAYS_ALLOW = 'Always allow'

/**
 * 🔴 **730 · R81 — the card's word for a Cancel that asks no turn to stop** (`cancelStopsNothing`):
 * *"the request is cancelled"* — never `Cancel turn`, which is what the press does everywhere else.
 */
export const CANCEL_REQUEST = 'Cancel request'

/** 🔴 **730 · R80 — the card's kind, where Codex asks before an MCP tool runs** (not *command*). */
export const MCP_TOOL_KIND = 'MCP tool'

/**
 * 🔴 **737 · `728` — the card's kind where an MCP SERVER asks the person** (`mcpServerAsks`) on a
 * PERMISSION card — a server's zero-field form, and the url and `openai/form` cards Codex also marks
 * — not *command* (`730` F-9). ⚠️ A server's form WITH fields is a question card (`UserInputCard`),
 * which draws no kind chip. ⚑ It interpolates nothing: the server is named in the runtime's own
 * first sentence on the card, and its name reaches the renderer uncleaned (`737` GAP).
 */
export const MCP_SERVER_KIND = 'MCP server'

/**
 * 🔴 **737 · `728` — the word on a server form's Allow, as the CLI draws it** (`728` §2: Codex's
 * terminal UI shows a server's zero-field form as *Allow* / *Deny* / *Cancel*) — and the word the
 * overview has always drawn for `allow` (`attention.ts`' `OUTCOME_LABEL`), so the card, *Waiting on you* and
 * the person's queue say one word for the one answer a server is told.
 */
export const ALLOW = 'Allow'

/**
 * Allow tells the server `accept` when the person says they opened the URL shown on the card. BroBot does not open it or verify that they did.
 */
export const I_OPENED_IT = 'I opened it'

/**
 * What the wholesale grant says, with the tool in it.
 *
 * The tool name comes from `request.action` — the backend's word for what is being asked about —
 * rather than being written here: the renderer does not know what tools exist, and a hardcoded
 * `Bash` would be it deciding.
 *
 * ⚑ **730 · R80 — except on Codex's MCP tool card**, where the label is the ruling's own
 * {@link ALLOW_FOR_THIS_CONVERSATION} and names no tool: the tool and its server are in the warning
 * beside it ({@link mcpToolGrantCovers}) and in the line under it ({@link mcpToolGrantDoes}).
 */
export function wideGrantLabel(action: string, marks: AskMarks = {}): string {
  // ⚑ 730 · R80 — Codex's MCP tool grant FOR THE CONVERSATION, in the ruling's own words (the
  // *Always allow* the runtime offers beside it since `736` is `allow_always`, another outcome).
  if (marks.mcpToolCall !== undefined) return ALLOW_FOR_THIS_CONVERSATION
  // 🔴 **739 · `730` F-1's reason, on the button** — it said *"Always allow <tool> this session"*,
  // and since R95 *Always allow* is the grant that OUTLIVES the conversation ({@link ALWAYS_ALLOW}),
  // drawn beside this one on a card that offers both. ⚑ This grant ends with the conversation, so
  // it says so — in {@link ruleSaid}'s own words for a whole-tool rule (*every <tool> call*).
  return `Allow every ${action} call for this conversation`
}

/**
 * 🔴 **730 · R80 — who asks, on the card Codex raised before an MCP tool runs.** ⚑ The provider is
 * NAMED where the surface knows it — composed from {@link providerName}, never typed (`317`) — and
 * is *the provider* where it does not. ⛔ **Only on a card carrying `mcpToolCall`**: a request a
 * server makes on its own is the server asking, never Codex (`730` §2) — ⚑ since `728` that card
 * carries `mcpServerAsks` and is drawn as {@link MCP_SERVER_KIND}, in the server's own words (`737`).
 */
export function mcpToolAsker(provider: Provider | null): string {
  const who = provider === null ? `The provider` : providerName(provider)
  return `${who} asks to run an MCP tool`
}

/**
 * ⚑ **730 review · the tool as a sentence names it** — *this tool* where the adapter could not clean
 * its name (`aToolApprovalCard`: `wordsForACard(approval.tool) ?? ''`), never an empty gap.
 */
function theMcpTool(call: { readonly tool: string }): string {
  return call.tool === '' ? `this tool` : call.tool
}

/**
 * 🔴 **730 · R80 — what the conversation's grant covers, said before it is pressed** (the card's
 * warning, where every other wholesale grant says *any <tool> command*). ⚑ Measured (`723` §1): the
 * same tool, whatever it is given, and not the server's other tools. ⚑ It ends with the conversation
 * — the conversation grant does; since `736` (R95) the offer's *Always allow* is the one that does
 * not, and says so under its own button ({@link keptGrantOf}).
 *
 * ⛔ **It says what the grant does NOT cover, and never that the rest is asked about** (`730`
 * review): Codex runs a tool its server marks as only reading, or as destroying nothing and reaching
 * nothing outside, with no ask at all (`capabilities.ts`, `external-mcp.ts` — measured).
 */
export function mcpToolGrantCovers(
  call: { readonly server: string; readonly tool: string },
  provider: Provider | null,
): string {
  const asker = provider === null ? `The provider` : providerName(provider)
  const tool = theMcpTool(call)
  return (
    `⚠ Covers every call to ${tool} on ${call.server} for the rest of this conversation, ` +
    `whatever it is given — not just this one. ${asker} will not ask about ${tool} again; ` +
    `the grant does not cover ${call.server}’s other tools.`
  )
}

/**
 * 🔴 **730 review · R80 — the line under the conversation's grant on the MCP card**, in place of
 * `PERMISSION_EFFECTS`' *"anything of this kind"*: beside a chip that says *MCP tool*, that read as
 * every MCP tool, and the grant is one tool of one server.
 */
export function mcpToolGrantDoes(call: { readonly server: string; readonly tool: string }): string {
  return `the agent may call ${theMcpTool(call)} on ${call.server}, whatever it is given, for this conversation`
}

/**
 * 🔴 **743 · the wholesale grant's own warning, on EVERY surface that offers the grant** (058: the one
 * control that explains itself before it can be pressed).
 *
 * ⚑ **`739` F-1, ruled by the PM** (2026-09-27): *"a surface that offers the choices offers ALL of
 * them. Where Always allow is a one-click answer (Home, the person's queue), Allow for this
 * conversation is too. Neither is card-only while the other is not."* So *Waiting on you* and the person's
 * queue offer this grant as a one-click answer, after the row (the card draws it below the row), and
 * draw this warning with it — one function, so the three surfaces cannot word it three ways.
 * ⚠️ **Until `743` they said instead that it was not offered there** (`wideGrantElsewhere`, 299 §1:
 * *"… is not offered here — … lives on the card. Open it to grant that."*), which the ruling made
 * false.
 *
 * ⚑ The MCP arm is {@link mcpToolGrantCovers} (R80: the tool, whatever it is given, and not the
 * server's other tools). ⚑ **`739` F-8 — the other arm says *"for this conversation"***, the words on
 * its button ({@link wideGrantLabel}); it said *"for the rest of this session"* until `743`.
 */
export function wideGrantWarning(
  action: string,
  marks: AskMarks = {},
  provider: Provider | null = null,
): string {
  const call = marks.mcpToolCall
  if (call !== undefined) return mcpToolGrantCovers(call, provider)
  const { lead, reach, rest } = wideGrantWarningParts(action)
  return `${lead}${reach}${rest}`
}

/**
 * 🔴 **743 · the plain arm of {@link wideGrantWarning}, in three parts** — so the card can set its
 * REACH in bold (058: *"any … command"* and *"not just this one"* are what a person has to take in
 * before pressing it) while *Waiting on you* and the person's queue draw the same sentence whole.
 */
export function wideGrantWarningParts(action: string): {
  readonly lead: string
  readonly reach: string
  readonly rest: string
} {
  return {
    lead: '⚠ Covers ',
    reach: `any ${action} command`,
    rest: ' for this conversation — not just this one. Nothing will ask again, whatever it runs.',
  }
}

/** 🔴 743 · what a settled card that granted nothing says in its `persistence` row. */
export const NOTHING_GRANTED = 'nothing granted'

/**
 * 🔴 **743 · `739` F-7 — what a SETTLED card's `persistence` row says: how long its ANSWER grants
 * for**, never the offer's summary. ⛔ `scope.persistence` is the widest thing the card COULD grant
 * (`persistenceOf`), so a card answered *Allow once* read *always* under its own *Allowed once*.
 *
 * ⚑ A `Record`, for {@link PLACE}'s reason: a new outcome does not compile until somebody has said
 * how long it grants for. ⚑ In the offer's own words (`once` / `session` / `always`); a refusal
 * granted nothing, and says so.
 */
const GRANTED_FOR: Record<PermissionOutcome, GrantedFor> = {
  allow: 'once',
  allow_for_session: 'session',
  [WIDE]: 'session',
  allow_always: 'always',
  deny: NOTHING_GRANTED,
  cancel: NOTHING_GRANTED,
}

/** 🔴 743 · a settled card's `persistence`: the offer's own three words, or {@link NOTHING_GRANTED}. */
export type GrantedFor = 'once' | 'session' | 'always' | typeof NOTHING_GRANTED

/**
 * 🔴 **743 · `739` F-7 — how long an answer granted for** ({@link GRANTED_FOR}), or
 * {@link NOTHING_GRANTED} for a card that closed with no answer at all.
 */
export function grantedFor(outcome: PermissionOutcome | null): GrantedFor {
  return outcome === null ? NOTHING_GRANTED : GRANTED_FOR[outcome]
}

/**
 * 🔴 **What a surface says when a request offers no way to ALLOW it** (487, `483`'s repair 1).
 *
 * ## ⛔ The sentence this replaces said the opposite of what happened
 *
 * `PermissionCard` said *"The provider offered no decisions for this request."* on every card
 * whose offer came back empty. ⚠️ **On the branch `483` traced as reachable the provider offered
 * plenty** — BroBot withheld every positive because the grant riding along with the command could
 * not be displayed faithfully. ⛔ **A claim drawn as an observation about someone else** is
 * criterion 18's shape, and this is it on a card.
 *
 * ## ⚑ Three reasons, because there are three and they are not the same fact
 *
 * ⛔ **Keyed by the adapter's own word, so a fourth reason does not compile until somebody writes
 * its sentence** — `PLACE`'s device above, applied to copy rather than to placement. The word is
 * what crosses the wire; the sentence is made here, which is `persons-queue.ts`'s rule and the
 * reason a string never travels.
 *
 * ⚠️ **Not one of them names the shape that could not be described.** That is the whole reason
 * the positives were withheld, and a sentence that leaked it through the refusal would hand back
 * exactly what withholding them was for.
 *
 * ⚑ **Every one of them ends with what a person can still do**, because after 487 there is always
 * something: both refusals are on the card whatever the request offered.
 */
const NO_POSITIVE_SAYS: Record<NoPositiveBecause, string> = {
  'could-not-describe-the-grant':
    'BroCrew is offering no way to allow this: accepting would grant something it cannot show you, ' +
    'so it withheld every way to allow it. Refusing still works, and always does.',
  // ⚠️ **It does NOT say an accept was offered** (corrected by this dispatch's own review).
  // `outcomeOfCodexDecision` returns null for the network-amendment accept (the exec-policy one is
  // `allow_always` since `736`) AND for any value it
  // does not recognise, so a list of `['decline','cancel','somethingNew']` reaches this word — and
  // whether that third token was an accept is precisely what this app could not read.
  'could-not-represent-the-answers':
    'BroCrew is offering no way to allow this: part of what this request offered came in a form ' +
    'BroCrew cannot put on a card. Refusing still works, and always does.',
  'none-was-offered':
    'This request was raised with no way to allow it — nothing was offered to accept. Refusing ' +
    'still works, and always does.',
}

/**
 * ⛔ **The sentence for one reason** — a function rather than the `Record`, so no caller can
 * rewrite the copy three surfaces read.
 */
export function noPositiveSays(because: NoPositiveBecause): string {
  return NO_POSITIVE_SAYS[because]
}

/**
 * ⚠️ **What a surface says when a request offers NOTHING AT ALL and does not say why** (487).
 *
 * ⛔ **Every producer this app owns now publishes the two refusals** — see `publishedOffer` — and
 * says why when it withholds the positives. ⚑ **This component still renders events off the
 * WIRE**: a ledger replayed from before that change, or an adapter this window has never met, can
 * carry an offer with nothing in it and no reason beside it. 🔴 **A surface may not invent the
 * refusals for one.** The floor is a promise about the gate that will answer, and this window
 * cannot see which gate that is; drawing a Deny that the far side may not honour is the same
 * class of lie as drawing an Allow it will reject.
 *
 * ⚠️ **And it does not say who.** The old copy said *the provider* offered nothing; nothing here
 * knows that, which is exactly how the sentence came to be false.
 */
export const NO_ANSWER_ON_THIS_REQUEST =
  'This request reached this window with no answers on it, so there is nothing to press here.'

/**
 * ⚠️ **What a surface says when a request can only be REFUSED and does not say why** (487).
 *
 * ⛔ **This arm exists because the first draft tested for an EMPTY row and that was the wrong
 * question** (found by this dispatch's own review). A ledger persisted before 487 can hold a
 * Codex command approval whose provider list was `['decline','cancel']` — two refusals, no
 * positive, and no reason field, because the field did not exist yet. ⚠️ **On an empty-row test
 * that request falls through to silence**, and the overview then drew *"Open it before you allow it"*
 * over a card with no Allow on it: `483`'s defect, surviving the repair, on replayed data.
 *
 * ⚑ **It does not guess at a reason.** The request did not record one and this window cannot
 * derive it, so the sentence says only what it can see and what a person can still do.
 *
 * ⚑ **739 · a Codex command whose only accept is its *don't ask again for commands that start with
 * …*** (`allow_always`) is no longer a case: since `739` that answer is drawn, so the card offers a
 * way to allow it (from `736` until `739` a sentence said BroBot did not offer that choice yet).
 */
export const NO_REASON_ON_THIS_REQUEST =
  'BroCrew is offering no way to allow this, and this request did not record why. Refusing still ' +
  'works, and always does.'

/** ⛔ **Why nothing on a card can ALLOW its request**, and the sentence that says so. */
export interface NoWayToAllow {
  /**
   * The adapter's own word, or one of the two residuals for a request that carried none — kept
   * beside the sentence so a test can name the case without matching on copy.
   */
  readonly why: NoPositiveBecause | 'not-said' | 'nothing-at-all'
  /** {@link noPositiveSays} for {@link why}, or one of the two residual constants. */
  readonly says: string
}

/**
 * ⛔ **Whether a request offers a way to allow it, and what to say when it does not** (487).
 *
 * ## 🔴 The question is *is there a POSITIVE*, and the first draft asked something else
 *
 * ⚠️ **It read the adapter's word first and tested the row for EMPTINESS**, and both halves were
 * wrong (found by this dispatch's own review):
 *
 *  - ⛔ **A word with a positive beside it** — reachable off any event this window did not build,
 *    and off the double — rendered *"BroBot is offering no way to allow this"* directly above a
 *    live Approve button. The two fields are independent on the wire and nothing cross-checks
 *    them, so the OFFER has to be the thing that decides, and the word only says why.
 *  - ⛔ **A pre-487 ledger row offering `['deny','cancel']` and no reason** is not an empty row,
 *    so it fell through to silence — and Home kept telling a person to open it and allow it. That
 *    is the defect this dispatch exists to remove, surviving on replayed data.
 *
 * ⚑ **So: the offer decides WHETHER, and the word decides WHY.** Three answers, and the first is
 * the only one that can be read off the buttons a person can actually see.
 */
export function noWayToAllow(
  because: NoPositiveBecause | undefined,
  offer: PermissionOffer,
): NoWayToAllow | null {
  // ⛔ **The wholesale grant is a way to allow**, even though it is never in the row (299 §1).
  if (offer.wide !== null || offer.row.some(outcomeAllows)) return null
  if (because !== undefined) return { why: because, says: noPositiveSays(because) }
  return offer.row.length === 0
    ? { why: 'nothing-at-all', says: NO_ANSWER_ON_THIS_REQUEST }
    : { why: 'not-said', says: NO_REASON_ON_THIS_REQUEST }
}

/**
 * What may be drawn for this request, from a dashboard and from the card.
 *
 * Takes the offered outcomes, the action and the request's two {@link AskMarks} (695) rather than
 * the whole request, so the two callers can pass what they have — the overview walks a fold item,
 * the card holds a computed — and so this cannot reach for anything else about the session and
 * become a second opinion about it.
 *
 * ⚠️ **The provider's ORDER is discarded, deliberately.** `availableDecisions` arrives in whatever
 * order the adapter's own filter produced, and "whatever the adapter listed first" is not a fact
 * about what a reader should press first. Sorting by {@link PLACE} is what makes the second button
 * the same choice on every card and on every surface — ⚠️ except a `defaultToNo` ask, whose
 * refusals lead in {@link PLACE} order (695 · R36b).
 *
 * An outcome offered twice is drawn once: the row is built from the placement table, not from the
 * provider's array, so a duplicate cannot become a duplicate button.
 */
export function permissionOffer(
  available: readonly PermissionOutcome[],
  action: string,
  marks: AskMarks = {},
): PermissionOffer {
  const offered = new Set(available)
  const placed = (Object.keys(PLACE) as PermissionOutcome[])
    .filter((outcome) => offered.has(outcome) && typeof PLACE[outcome] === 'number')
    .sort((a, b) => (PLACE[a] as number) - (PLACE[b] as number))
  // ⚑ 695 · R36b: a `defaultToNo` ask leads with its refusals, in their own stable order — the
  // allowing answers keep theirs, after. Nothing is added or dropped; only the order moves.
  const refusesFirst = marks.defaultToNo === true
  const row = refusesFirst
    ? [...placed.filter((one) => !outcomeAllows(one)), ...placed.filter(outcomeAllows)]
    : placed
  return {
    row,
    wide: offered.has(WIDE) ? { outcome: WIDE, label: wideGrantLabel(action, marks) } : null,
    primary: refusesFirst ? 'refuses' : 'allows',
  }
}

/**
 * 🔴 **The permission value that crosses the wire, built HERE and nowhere else** (473, from `469`).
 *
 * ⛔ **It was written twice, and only one copy was safe.** `PermissionCard` had this switch; the
 * overview's `answerFor` returned `decision.decision` — the object it was handed — and
 * `createPersonsQueue` keeps its world in a deep `ref`, so by the time a person pressed **Deny** on
 * a spawned child's card that object was a Vue reactive `Proxy`. 🔴 **Electron cannot
 * structured-clone one**, so `ipcRenderer.invoke` rejected before `ipcMain` saw the call: the child
 * ledger held zero `user_decision` rows, the provider stayed `waiting_permission`, and the window
 * drew the card as settled. ⚠️ **The card's copy was never wrong** — which is exactly why a second
 * copy was the defect: one producer held the rule and the other never learned it.
 *
 * ⚑ **A fresh literal per outcome, and every field of it is written here.** That is standing rule
 * 2's question answered on both halves — this builds the outer object, and there is no field it did
 * not build — so a `Proxy` cannot survive the way in however reactive the caller's state is.
 *
 * ⛔ **No `updatedInput` and no deny `message`, deliberately.** Both are edits to what will RUN, and
 * a surface that sends one has to be showing what it is editing (071). ⚠️ **No surface in this app
 * sends either today** — `PermissionCard` has no field to type into, and this sentence used to say
 * it rewrote a request "through its own form", which is a form that does not exist (found by this
 * dispatch's own review). Every answer this app sends is the bare outcome. ⚠️ **A producer
 * that needs to send an edit adds the field HERE**, where the copy it needs is one function rather
 * than one per surface — `the-press-that-cloned-nothing.test.ts` §4 walks the whole renderer for a
 * second construction, and §9 of `the-bridge-that-clones-nothing.test.ts` lists the producers of
 * every handed-over verb.
 *
 * ⚠️ **A `Record` would not do**, unlike {@link PLACE} above: the two outcomes that carry an
 * optional field are different SHAPES of {@link PermissionDecision}, so the exhaustiveness has to
 * come from the switch narrowing the discriminant. A sixth outcome still fails to compile here.
 */
export function permissionDecisionFor(outcome: PermissionOutcome): PermissionDecision {
  switch (outcome) {
    case 'allow':
      return { outcome: 'allow' }
    case 'allow_for_session':
      return { outcome: 'allow_for_session' }
    case 'allow_all_for_session':
      return { outcome: 'allow_all_for_session' }
    case 'allow_always':
      return { outcome: 'allow_always' }
    case 'deny':
      return { outcome: 'deny' }
    case 'cancel':
      return { outcome: 'cancel' }
  }
}

type GrantRules = NonNullable<
  NonNullable<PermissionRequestEvent['scope']['grants']>['allow_for_session']
>

/**
 * 🔴 **739 · `726` F-14 — a Claude rule for reading ONE folder, in the words its CLI shows**: the
 * interactive CLI's own row for that ask is *"allow reading from <dir>"* (`736` §1, measured), and
 * the rule the SDK suggests is `Read(//<dir>/**)`. ⚠️ **Only the `//` form is a folder named from
 * the root** — a single `/` is relative to the settings file and a bare path to the working folder
 * (Claude's rule syntax), so nothing else is turned into a folder here. ⛔ **And it names no
 * subfolder**: measured was a second file in that folder read unasked and a file in another folder
 * asked (`736`'s loopback), nothing deeper — so the rule itself is kept beside the words.
 */
const A_FOLDER_FROM_THE_ROOT = /^\/\/(.+)\/\*\*$/

/** A command rule with any further arguments — `make build *`, `npm run test:*` — and its prefix. */
const A_COMMAND_PREFIX = /^(.*\S)(?: \*|:\*)$/

/** One rule a grant installs, in words a person weighs. */
function ruleSaid(rule: GrantRules[number], cwd?: string): string {
  switch (rule.kind) {
    case 'tool': {
      // 🔴 739 · `726` F-14 — see {@link A_FOLDER_FROM_THE_ROOT}.
      const folder = rule.tool === 'Read' ? A_FOLDER_FROM_THE_ROOT.exec(rule.content ?? '') : null
      if (folder !== null) return `reading from /${folder[1]} (${rule.tool}(${rule.content}))`
      // ⚑ 739 · a rule keyed by server and tool (Codex's `mcp_servers.<server>.tools.<tool>`)
      // names its server, as the MCP card's own warning does.
      const on = rule.server === undefined ? '' : ` on ${rule.server}`
      // ⚑ 739 review — a server's tool the adapter could not clean is *this tool*, as
      // {@link theMcpTool} says it, never an empty gap.
      if (rule.server !== undefined && rule.tool === '') {
        return rule.content === undefined
          ? `every call to this tool${on}`
          : `this tool (${rule.content})${on}`
      }
      if (rule.content === undefined) return `every ${rule.tool} call${on}`
      // ⚑ A rule ending in ` *` or `:*` covers a command with any further arguments: said in Codex's
      // prefix rule's words, with the rule itself beside them.
      const prefix = A_COMMAND_PREFIX.exec(rule.content)
      return prefix !== null
        ? `commands starting with ${prefix[1]} (${rule.tool}(${rule.content}))${on}`
        : `${rule.tool}(${rule.content})${on}`
    }
    case 'mode':
      // 🔴 **739 · review — what *accept edits* was measured to cover**: the next edit in the
      // conversation's folder ran unasked and one outside it was asked (`736`'s loopback,
      // `claude-runtime.ts`' `sessionGrantOf`). ⛔ It said *"every file edit"*.
      return rule.mode === 'acceptEdits'
        ? 'every file edit in the folders it works in, without asking (accept edits)'
        : rule.mode === 'bypassPermissions'
          ? 'every action, without asking'
          : `${rule.mode} mode`
    case 'directory':
      // 🔴 **740 · R99 (`736` F-9)** — an `rm`'s grant is its FOLDER (the interactive CLI's own
      // choice), which is the folder the conversation already works in: it adds nothing, and the same
      // `rm` is asked again (measured, K1). ⛔ *"working in <cwd>"* alone promised coverage it lacks.
      return sameFolder(rule.path, cwd)
        ? `working in ${rule.path} — the folder it already works in, so the same request is still asked`
        : `working in ${rule.path}`
    case 'command-prefix':
      return `commands starting with ${rule.prefix.join(' ')}`
  }
}

/**
 * 🔴 **739 · a grant's rules in {@link ruleSaid}'s words** — for a surface that holds the rules a
 * press installed and no scope to read them off (the kept list, `standing-grants.ts`).
 */
export function grantRulesSaid(rules: GrantRules, cwd?: string): string {
  return rules.map((rule) => ruleSaid(rule, cwd)).join('; ')
}

/**
 * 🔴 **739 · `726` F-14 — what the conversation grant a card draws covers, as ONE list of rules**
 * (`scope.grants.allow_for_session`), or `null` when the grant is not offered or carries no rules
 * to say. ⚑ The line under its button on every surface ({@link covers} on the decision) and the
 * card's and *Waiting on you*'s disclosure ({@link conversationGrantSaid}) read it, so the three cannot say two
 * things. ⚠️ **Absent is not "nothing"** (`permission.ts`): a card with no rules — every Codex card,
 * every row before `736` — keeps the line that says the provider's own rule without naming it.
 */
export function conversationGrantCovers(scope: {
  readonly availableDecisions?: readonly string[]
  readonly grants?: PermissionRequestEvent['scope']['grants']
  /** ⚑ 740 · the conversation's folder — a grant of it adds nothing, and says so. */
  readonly cwd?: string
}): string | null {
  if (!(scope.availableDecisions ?? []).includes('allow_for_session')) return null
  const rules = scope.grants?.allow_for_session ?? []
  if (rules.length === 0) return null
  return rules.map((rule) => ruleSaid(rule, scope.cwd)).join('; ')
}

/** Two spellings of one folder, as far as a renderer can tell — a trailing separator apart. */
function sameFolder(a: string, b: string | undefined): boolean {
  if (b === undefined || b === '') return false
  const bare = (path: string): string => path.replace(/[\\/]+$/, '')
  return bare(a) === bare(b)
}

/**
 * 🔴 **736 · R94 — *"The card's words say what the rule covers"*, for the conversation grant a card
 * DRAWS.** Since R94 that grant is the provider's own rule for the ask, which can be much wider than
 * the one action — an edit's is *every edit* — so the line is built from the rules the button installs
 * (`scope.grants.allow_for_session`, {@link conversationGrantCovers}), one derivation for the card and
 * for *Waiting on you*. `null` when the grant is not offered, or carries no rules to say.
 */
export function conversationGrantSaid(scope: {
  readonly availableDecisions?: readonly string[]
  readonly grants?: PermissionRequestEvent['scope']['grants']
  /** ⚑ 740 · the conversation's folder — a grant of it adds nothing, and says so. */
  readonly cwd?: string
}): string | null {
  const covers = conversationGrantCovers(scope)
  return covers === null ? null : `for this conversation, its grant covers: ${covers}`
}

/**
 * 🔴 **739 · `736` F-1 — what *Always allow* keeps, where, and what else it installs**, read off the
 * wire and never typed: `740` moves WHERE a Claude rule is kept (R99), and this prints whatever file
 * the request names, so it flows through with no redraw.
 *
 *  - `rules` — `scope.grants.allow_always`, in {@link ruleSaid}'s words; `null` where the request did
 *    not name them (⚠️ absent is not "nothing", `permission.ts`).
 *  - `file` — `scope.grants.alwaysFile`, verbatim; `null` where the request did not say.
 *  - `alsoForThisConversation` — the conversation grant's rules that the kept ones do not already
 *    say. ⚑ The wire's own contract (`permissionGrantsSchema.allow_always`): *"pressing it also
 *    installs for this conversation what `allow_for_session` lists"* — the CLI's same row held to
 *    the session: since `740` (R99) a shell ask's rules and a folder it adds (`736`'s `rm` also carried
 *    *accept edits*; 740's CLI row carries no mode on a shell ask, and offers an `rm` no *Always
 *    allow* at all). ⚠️ Only a card that publishes those rules (Claude's) has any; `null` otherwise.
 *    A folder rule for the conversation's own folder adds nothing and is left out.
 *
 * `null` when the card does not offer *Always allow*.
 */
export interface KeptGrant {
  readonly rules: string | null
  readonly file: string | null
  readonly alsoForThisConversation: string | null
}

export function keptGrantOf(scope: {
  readonly availableDecisions?: readonly string[]
  readonly grants?: PermissionRequestEvent['scope']['grants']
  /** ⚑ 740 · the conversation's folder, for {@link ruleSaid}'s folder arm. */
  readonly cwd?: string
}): KeptGrant | null {
  if (!(scope.availableDecisions ?? []).includes('allow_always')) return null
  const kept = (scope.grants?.allow_always ?? []).map((rule) => ruleSaid(rule, scope.cwd))
  // ⚑ 739 review — a folder rule for the conversation's OWN folder adds nothing, and beside a kept
  // rule that covers the request, 740's *"so the same request is still asked"* would be false: it
  // is left out of what the press also covers.
  const here = (scope.grants?.allow_for_session ?? [])
    .filter((rule) => !(rule.kind === 'directory' && sameFolder(rule.path, scope.cwd)))
    .map((rule) => ruleSaid(rule, scope.cwd))
  const also = here.filter((said) => !kept.includes(said))
  return {
    rules: kept.length === 0 ? null : kept.join('; '),
    file: scope.grants?.alwaysFile ?? null,
    alsoForThisConversation: also.length === 0 ? null : also.join('; '),
  }
}

/**
 * 🔴 **739 · the kept grant, said as a disclosure line** — the card's `kept grant` row and *Waiting on you*'s
 * scope line, beside {@link conversationGrantSaid}'s. `null` when the card does not offer it.
 */
export function keptGrantSaid(kept: KeptGrant | null): string | null {
  if (kept === null) return null
  const what = kept.rules ?? 'the provider’s own rule for this, which this request does not name'
  const where = kept.file === null ? 'where, this request does not say' : `in ${kept.file}`
  const also =
    kept.alsoForThisConversation === null
      ? ''
      : `; for this conversation it also covers: ${kept.alsoForThisConversation}`
  return `beyond this conversation, its grant keeps: ${what} — ${where}${also}`
}
