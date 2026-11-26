import { z } from 'zod'
import {
  permissionScopeSchema,
  PLAN_CONSENTS,
  userInputPermissionSchema,
  userInputQuestionSchema,
} from './permission'

/**
 * A command/file approval. Answer via `respondPermission(id, decision)`; leaving it unanswered
 * hangs the provider.
 *   - Claude: `canUseTool` (id = `toolUseID`, action = tool name).
 *   - Codex:  `item/commandExecution/requestApproval` (`kind: 'command'`) or
 *             `item/fileChange/requestApproval` (`kind: 'file'`); id = RPC id.
 */
/**
 * The explicit, visible ceiling on a permission card's disclosure.
 *
 * A transport bound must be *explicit and visible — a marked truncation the user can see, and never
 * a silent one.* This is that bound. It is 64 Ki **characters**, deliberately the same order as
 * {@link MAX_UNKNOWN_RAW_BYTES}, because the hazard is the same one — a single tool input becoming
 * a permanent row in every store downstream — and two unrelated numbers for one hazard is how one
 * of them ends up stale.
 *
 * It is ~565× the longest command this app has ever recorded on a card — 116 characters, measured
 * over the whole ledger, not the largest imaginable — so no real approval is anywhere near it. That
 * is the point: a bound nothing legitimate reaches is a bound whose marking nobody has to read.
 */
export const MAX_PERMISSION_DETAIL_CHARS = 64 * 1024

/** A disclosure and, when the bound bit, how much of it is missing. */
export interface BoundedDetail {
  detail: string
  detailOmitted?: number
}

/**
 * Apply {@link MAX_PERMISSION_DETAIL_CHARS}, saying so when it bites.
 *
 * Truncated rather than dropped — the opposite of {@link boundRaw}'s choice, and for the opposite
 * reason. An oversized `unknown` payload is a verbatim copy whose whole value is being verbatim, so
 * a fragment of it is a lie; a command's first 64 KiB is genuinely the first 64 KiB of what will
 * run, and hiding it would leave the user with less than the truncation did. What must never happen
 * is the fragment being handed over as though it were whole.
 */
export function boundPermissionDetail(detail: string): BoundedDetail {
  if (detail.length <= MAX_PERMISSION_DETAIL_CHARS) return { detail }
  // Never cut a surrogate PAIR in half. A lone surrogate is not a character: `JSON.stringify`
  // escapes it, SQLite keeps it, and the card renders a replacement glyph — a tiny lie in the one
  // string this whole change exists to keep honest. One character back is the whole fix, and the
  // count below is derived from what was kept rather than from the limit, so the two cannot drift.
  const cut = isHighSurrogate(detail.charCodeAt(MAX_PERMISSION_DETAIL_CHARS - 1))
    ? MAX_PERMISSION_DETAIL_CHARS - 1
    : MAX_PERMISSION_DETAIL_CHARS
  return { detail: detail.slice(0, cut), detailOmitted: detail.length - cut }
}

/** The leading half of a surrogate pair. See {@link isLowSurrogate} for the other one. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

export const permissionRequestSchema = z.object({
  type: z.literal('permission_request'),
  id: z.string(),
  kind: z.enum(['command', 'file']),
  action: z.string(),
  /**
   * **What approving this actually authorizes, in full.**
   *
   * A command with a readable prefix and `; curl … | sh` past a cut would reach a card showing less
   * than Allow authorizes, so nothing here is cut silently.
   *
   * An adapter MUST put the whole disclosure here. If it cannot, it says so in `detailOmitted`
   * below — never silently.
   */
  detail: z.string(),
  /**
   * How many characters of {@link detail} are **not** here. Absent ⇒ the disclosure is whole.
   *
   * The bound is {@link MAX_PERMISSION_DETAIL_CHARS} and it exists so one pathological tool input
   * cannot put a megabyte in every downstream store. What matters is that exceeding it is a FACT ON
   * THE EVENT rather than a shorter string: the card renders this in its own chrome, so the marker
   * cannot be forged by a model that writes "… (truncated)" into its own command.
   */
  detailOmitted: z.number().int().positive().optional(),
  /**
   * The provider's own one-sentence rendering of the request, when it sends one — *"Claude wants to
   * read foo.txt"*. A label BESIDE the disclosure, never instead of it.
   *
   * It exists because the pinned SDK offers `title` on the `canUseTool` options and says *"Use this
   * as the primary prompt text when present instead of reconstructing from toolName+input"*
   * (`sdk.d.ts:249`) — advice this app cannot take, because "the primary prompt text" and "the
   * thing Allow authorizes" are not the same string, and the second one is what a card is for.
   *
   * **Measured**: across all 23 Claude permission requests in this app's ledger, `title` was absent
   * — every recorded `detail` is exactly the input-derived value (16 bare tool names, 4 file paths,
   * 3 verbatim commands). So this is the field for a sentence that has never yet arrived, kept
   * because it is genuinely better than a bare tool name on the 16 cards that had nothing else to
   * show.
   */
  summary: z.string().optional(),
  /**
   * Provider-neutral security scope — the full consequence of approving (cwd, paths, network,
   * persistence/grant root, amendments, allowed decisions). Populated by both adapters; carries NO
   * raw provider payload. See {@link permissionScopeSchema}.
   */
  scope: permissionScopeSchema,
  /**
   * 🔴 **R36a — the provider said this ask must offer no *"don't ask again"*.** Present only as
   * `true`, and only when the provider marked the ask; absent on every other card and on every row
   * written before 695, which is why it is optional.
   *
   * ⚑ The pinned SDK (0.3.281, `sdk.d.ts:268-272`): *"The ask must not offer a persistent 'don't
   * ask again' choice: the rule it would write grants more than this ask's own action."* Measured
   * by `probe:permission-markers` on CLI 2.1.281: `echo … &` — a background operator — arrives
   * marked, `echo …` does not. ⛔ **It is a fact about the offer, and the offer already obeys it**:
   * the adapter withholds both session grants from {@link permissionScopeSchema}'s
   * `availableDecisions` and refuses them at `respondPermission`. This flag is what lets a surface
   * say WHY there is no such button, rather than leaving a person to wonder where it went.
   */
  suppressAlwaysAllowRule: z.literal(true).optional(),
  /**
   * 🔴 **R36b — the provider said *no* is this ask's default.** Present only as `true`.
   *
   * ⚑ The pinned SDK (`sdk.d.ts:263-267`): *"The ask must not be approvable by a single stray
   * keystroke: open the prompt on its decline option and offer no one-key approve shortcut."* A card
   * that carries it draws Deny as its primary answer. ⚠️ **Not measured live**: no BroBot ask
   * carries it today, and the surface is ready for the day one does.
   */
  defaultToNo: z.literal(true).optional(),
  /**
   * 🔴 **`695` F-f — the provider's own reason for an ask it MARKED, in its words.** Present only
   * beside {@link suppressAlwaysAllowRule} or {@link defaultToNo}, and absent on every other card
   * and on every row written before 700 — ⚑ **with ONE named exception (R73)**: a Codex command an
   * exec-policy `prompt` rule stopped, beside {@link providerReasonFrom}. The "marked asks only"
   * contract widens to this one named case, and no further.
   *
   * ⚑ **Measured by `probe:permission-markers` (CLI 2.1.281):** the marked `echo r36 &` said *"This
   * command uses the `&` background operator, which defers execution past approval-time safety
   * checks. Approve only if you trust it."* ⚠️ **The SDK hands over a reason on EVERY ask**, and on
   * the unmarked control it was *"brobot2 requires explicit approval for consequential tools"*: our
   * own guard hook's words, echoed back. ⛔ So the adapter carries it only where the provider marked
   * the ask, and never where the words are its own hook's: a surface draws this as *the provider's*
   * reason, and on the unmarked arm that would be false.
   *
   * ⚠️ **Cleaned, never reworded.** The CLI's own schema says the field *"may carry ANSI escapes;
   * sanitize before rendering"*, so the adapter takes out terminal escapes and the marks that
   * reorder drawn text, and turns a control character into a space. A reason longer than
   * {@link MAX_PERMISSION_DETAIL_CHARS} is dropped rather than cut, as {@link summary} is.
   */
  providerReason: z.string().optional(),
  /**
   * 🔴 **R73 — {@link providerReason} is a POLICY's rule, not a mark's reason.**
   *
   * ⚑ The ruling (`709` F-5): *"A policy's own words are the provider's. Codex's '… requires
   * approval: <rule text>' is carried as the provider's words (`providerReason`), labelled as
   * Codex's rule."* ⚑ Measured by `probe:codex-approval-reason` (bundled 0.146.0): an exec-policy
   * `prompt` rule stops a command, and Codex writes the request's `reason` itself — *"`<command>`
   * requires approval: <the rule's text>"* — over the model's own escalation. The provider is the
   * session's; this names what KIND of its words they are, so a surface can say *its rule*.
   *
   * ⛔ **Present only beside a `providerReason`, and only on that one Codex shape** (the adapter's
   * `thePolicysWords`). ⚠️ The words are tied to the request's own `command`, but no field on the
   * wire separates a policy stop from a model escalation Codex offered no rule for (`709` F-11), so
   * a model that wrote Codex's exact sentence about the exact command would be labelled a rule — a
   * bound stated here, as {@link providerReason}'s refusal of our own hook's words is.
   */
  providerReasonFrom: z.literal('a-policy-rule').optional(),
  /**
   * 🔴 **R44 — the MODEL's own words for this ask, carried under its author's name.** Present only
   * on the approval shape MEASURED to carry them — a command the model escalated with a
   * justification (a `command` with Codex's offered prefix rule, and no network context, subcommand
   * `approvalId` or `additionalPermissions`); absent on every other card, and on every row before
   * `709`. (A permissions request carries its own, on `UserInputPermission`.) ⛔ A command an
   * exec-policy `prompt` rule stopped has the same `command` and no offered rule, and Codex writes
   * its `reason` itself (*"… requires approval: …"*) — measured, so it is never carried here.
   *
   * ⚑ **Measured, not assumed** (`probe:codex-approval-reason`, bundled Codex 0.146.0 on BroBot's
   * `ask` profile): a command escalated with a `justification` arrives with `reason` equal to it,
   * verbatim — Codex's own instructions tell the model to put *"a short question asking the user if
   * they want to allow the action"* there — and one escalated without a justification has no
   * `reason` at all.
   *
   * ⛔ **Never the disclosure of what Allow runs**: {@link detail} is still the command, and this is
   * a sentence the agent wrote ABOUT it. ⛔ **Never the provider's**: it is not
   * {@link providerReason}, which is words the provider itself wrote. ⚑ **The drawing is the
   * frontend's**: this app's rule is that a model's words on a card are drawn as that agent's
   * words, by the agent's name — so the field says who wrote it, and the card says whose name that
   * is.
   *
   * ⚠️ **Cleaned, never reworded** — `wordsForACard` (`words-on-a-card.ts`), the same policy as
   * {@link providerReason}.
   */
  agentReason: z.string().optional(),
  /**
   * 🔴 **R80 — the provider asks before an EXTERNAL MCP server's tool runs: which server, which
   * tool, and with what.** Present only on that card; absent on every other, and on every row
   * written before 723.
   *
   * ⚑ The ruling (`720` F-A): *"Codex's own approval (`mcpServer/elicitation/request` with
   * `_meta.codex_approval_kind: 'mcp_tool_call'`) becomes a card naming the server, the tool and the
   * parameters (`tool_params_display`)."* ⚑ Measured by `probe:codex-mcp-tool-approval` (bundled
   * Codex 0.146.0, BroBot's `ask` profile): the frame names the server (`serverName`) and the
   * parameters (`_meta.tool_params_display`, one `{name, value, display_name}` each), and the tool
   * only inside Codex's own question — *"Allow the <server> MCP server to run tool "<tool>"?"*.
   *
   * - `server` — the server's name as Codex sent it, never composed.
   * - `tool` — the tool Codex's OWN running `mcpToolCall` item names. ⛔ **Never a string read out
   *   of a question alone**: a server can send a form wearing Codex's marker and any question it
   *   likes (measured, the probe's `spoof` arm), so a card exists only for a call Codex's item says
   *   is running and waiting — and its question, where it names a tool, must name that one.
   * - `parameters` — each parameter's display name and value, in Codex's order; a value that is
   *   not a string is its JSON. ⚠️ **Cleaned** by `wordsForACard`, like every provider string a
   *   surface draws — and so a display, never the disclosure: {@link detail} is the call's whole
   *   parameters, as JSON.
   * - `parametersOmitted` — how many were left out to keep the list inside
   *   {@link MAX_PERMISSION_DETAIL_CHARS}; absent ⇒ none. A fact on the event rather than a shorter
   *   list, for {@link detailOmitted}'s reason.
   */
  mcpToolCall: z
    .object({
      server: z.string(),
      tool: z.string(),
      parameters: z.array(z.object({ name: z.string(), value: z.string() })),
      parametersOmitted: z.number().int().positive().optional(),
    })
    .optional(),
  /**
   * 🔴 **R81 — this card's Cancel asks no turn to stop.** Present only as `true`, on every card
   * whose Cancel is the provider's own cancel and nothing more; absent on every other card, and on
   * every row written before 723.
   *
   * ⚑ The ruling (`720` F-B): *"When the frame names no turn, its line says only what the press
   * does (the request is cancelled; the turn is not asked to stop), and the host records no ask."*
   * ⚠️ **Only an MCP elicitation can arrive without a turn** — every other request's `turnId` is
   * required, and one without it is refused before a card exists. ⚑ EVERY external-MCP elicitation
   * card on Codex carries it (R97), whether or not its frame named a turn; Codex rows written
   * before `736` carry it only where the frame named no turn. Claude's server form always carries
   * it. ⛔ **A fact about the press, and the adapter already obeys it**: such a Cancel sends the
   * provider no `turn/interrupt` and latches nothing. This is what lets a surface say so, and what
   * tells the host the press is no ask (`user_decision.stopsNothing`).
   */
  cancelStopsNothing: z.literal(true).optional(),
  /**
   * 🔴 **R93 — an MCP SERVER is asking the person, not the agent.** Present on the card a server's
   * own request raises — a form, a zero-field form, a url visit — on both providers; absent on
   * every other card (Codex's own approval of a tool call carries {@link mcpToolCall} instead), and
   * on every row written before `728`. ⚠️ **Except the one `723` F-2 leaves open**: a frame wearing
   * Codex's marker during a call Codex ran unasked is drawn as Codex's, unmarked.
   *
   * ⚑ R93 keeps *"saying truly WHO is asking and WHAT a press does"*: without this field a surface
   * would draw *"the agent may do this once"* under Allow, and the question channel would carry a
   * server's form to a parent agent as the MODEL's question. ⚑ Read by both: the renderer's
   * `serversAskOf` says what the SERVER is told under each button, and `askedOfTheChannel` refuses
   * it by name. `server` is the name the provider sent, never composed.
   */
  mcpServerAsks: z
    .object({
      server: z.string(),
      /** ⚑ The page a server's `url` request asks the person to open, as sent (provider follow-ups 1). */
      url: z.string().optional(),
    })
    .optional(),
})

/**
 * A server-initiated request that is NOT a plain command/file approval: Claude `AskUserQuestion`,
 * Codex `item/tool/requestUserInput` or `item/permissions/requestApproval` (permission-profile
 * subset grants). It is surfaced (never silently dropped) and MUST be answered via
 * `respondUserInput(id, response)`; `{ kind: 'reject' }` is the protocol-safe default so the
 * provider cannot hang.
 *
 * Carries the **typed, neutral** request scope for a future UI to answer: `questions` (id + prompt
 * + options) and, for a permission grant, `permission`. It carries **no raw provider payload** —
 * the adapter keeps the original typed request to build a provider-valid answer/decline (mirrors
 * `PermissionScope`).
 */
export const userInputRequestSchema = z.object({
  type: z.literal('user_input_request'),
  id: z.string(),
  prompt: z.string(),
  /** Structured questions to answer (empty for a pure permission-grant request). */
  questions: z.array(userInputQuestionSchema),
  /** The requested scope of a permission-grant request (Codex permissions requestApproval). */
  permission: userInputPermissionSchema.optional(),
  /**
   * 🔴 **Which way approving a zero-question CONSENT card moves this conversation.**
   *
   * ⛔ **Absent on every request that is not one of those**, and it is the adapter that knows:
   * Claude's `PLAN_GESTURES` is the map that actually moves the floor, and this is read off the
   * same map at the same moment, so the card and the effect cannot come apart. ⚠️ **A card with
   * neither this nor {@link userInputPermissionSchema} is a consent this app cannot name**, and a
   * surface must say so rather than pick one of these two.
   *
   * ## ⚠️ Why the DIRECTION and not just *"a plan card"*
   *
   * ⛔ **The two directions are not one effect with a sign on it.** Approving `ExitPlanMode` ends
   * the provider's own plan mode and approving `EnterPlanMode` starts it. ⚑ No `EnterPlanMode` card
   * is raised (R98) — the CLI does not ask before it — so `start-planning` is on older rows only.
   * One *"Enter/ExitPlanMode consent"* would be one sentence over two materially different effects.
   *
   * ## ⛔ Optional because the LEDGER is older than this field
   *
   * ⚠️ This schema is also the stored-event contract. A `user_input_request` written before `478`
   * carries no key here, and it must still parse — so the absence means *nobody said*, exactly as
   * `477`'s ruling has it, and never *"neither direction"*.
   */
  consent: z.enum(PLAN_CONSENTS).optional(),
  /**
   * ⚑ **Codex's own `isBlocking`, carried as DATA and nothing more** (provider follow-ups 1, W4's
   * ruling). 0.160.0 sets it `true` only in Plan mode; ⛔ it does NOT mean the turn goes on without
   * the answer — Codex's `request_user_input` waits for the answer either way (its source:
   * `session/mod.rs` awaits it unconditionally), so this card puts the conversation in "waiting on
   * you" whatever it says. Absent where the provider did not send it.
   */
  isBlocking: z.boolean().optional(),
  /**
   * 🔴 **R93 — an MCP SERVER is asking the person, not the agent.** Present on the card a server's
   * own request raises — a form, a zero-field form, a url visit — on both providers; absent on
   * every other card (Codex's own approval of a tool call carries {@link mcpToolCall} instead), and
   * on every row written before `728`. ⚠️ **Except the one `723` F-2 leaves open**: a frame wearing
   * Codex's marker during a call Codex ran unasked is drawn as Codex's, unmarked.
   *
   * ⚑ R93 keeps *"saying truly WHO is asking and WHAT a press does"*: without this field a surface
   * would draw *"the agent may do this once"* under Allow, and the question channel would carry a
   * server's form to a parent agent as the MODEL's question. ⚑ Read by both: the renderer's
   * `serversAskOf` says what the SERVER is told under each button, and `askedOfTheChannel` refuses
   * it by name. `server` is the name the provider sent, never composed.
   */
  mcpServerAsks: z
    .object({
      server: z.string(),
      /** ⚑ The page a server's `url` request asks the person to open, as sent (provider follow-ups 1). */
      url: z.string().optional(),
    })
    .optional(),
})

/**
 * A pending `permission_request` / `user_input_request` was **resolved or cleared by the
 * PROVIDER**, not by this app.
 *
 * Codex clears server requests on turn start/completion/interruption and confirms it with
 * `serverRequest/resolved`. Ignoring it would leave a card actionable after the provider moved on,
 * and a late answer to a cleared request would still reach the wire: an out-of-lifecycle
 * authorization. This event is the neutral signal that the request is gone: the adapter has already
 * retired it (no further response will be sent, and answering it is refused), so the UI must stop
 * offering it.
 *
 * `id` is the SAME neutral request id the card carries, so correlation needs nothing else — and
 * nothing provider-specific crosses the boundary.
 */
export const requestResolvedSchema = z.object({
  type: z.literal('request_resolved'),
  id: z.string(),
})
