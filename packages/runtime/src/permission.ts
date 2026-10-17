import { z } from 'zod'

/**
 * A forward-compatible decision object for answering a `permission_request`
 * (HO-001 §6 refinement 2). A bare `'allow' | 'deny'` string is deliberately
 * NOT used: the 001 spike showed both providers need more shape than that.
 *
 * Provider mapping (001 §Q3 per provider):
 *   - `allow`             → Claude `canUseTool` allow (may carry `updatedInput`);
 *                            Codex `{ decision: 'accept' }`.
 *   - `deny`              → Claude `canUseTool` deny (with a `message` the model
 *                            reads); Codex `{ decision: 'decline' }`. **This is
 *                            what UI "Deny" maps to** — graceful, the turn
 *                            continues. Never `cancel`.
 *   - `allow_for_session` → Codex `{ decision: 'acceptForSession' }` (its MCP approval:
 *                            `_meta.persist: 'session'`); Claude
 *                            `{ behavior:'allow', updatedPermissions:[…] }` carrying the CLI's
 *                            OWN `suggestions` for that ask, each held to
 *                            `destination:'session'` — 🔴 **736 · R94: the rule the CLI itself
 *                            suggests, never a narrower one of this app's** (for a read outside
 *                            the folder, the CLI's directory rule; for an edit, its
 *                            *allow all edits* mode).
 *                            **This line used to read "Claude has no session-scope, so
 *                            an adapter maps it to `allow`". It has one** — `CanUseTool`
 *                            takes `suggestions`, `PermissionResult` takes
 *                            `updatedPermissions` — and that false belief is exactly what
 *                            shipped as the 031 bug: every tool re-prompted whichever
 *                            button was clicked, which does not merely annoy, it rots the
 *                            safety model, because a user who is asked anyway turns yolo
 *                            on permanently.
 *   - `allow_all_for_session` → **every future use of this tool this session, whatever
 *                            its arguments** (058). See the ⚠️ below — it is a
 *                            different grant from the one above, not a stronger
 *                            wording of it.
 *   - `allow_always`      → 🔴 **736 · R95 — the CLI's own choice that outlives the
 *                            conversation, with the persistence the CLI gives it**,
 *                            kept where its CLI keeps it (740 · R99) — Codex's in
 *                            the conversation's provider home: its command approval
 *                            `{ acceptWithExecpolicyAmendment }` (its *don't ask
 *                            again for commands that start with …*, kept in
 *                            `rules/default.rules`), its MCP approval
 *                            `_meta.persist: 'always'` (*Always allow*, kept in
 *                            `brobot-kept-tool-approvals.json` beside `config.toml`
 *                            and declared with its server at every launch);
 *                            Claude's own choice where it keeps a rule
 *                            (`localSettings`), kept where the CLI keeps it — the
 *                            PROJECT's `.claude/settings.local.json` (🔴 **740 ·
 *                            R99**; `736` held it to the provider home's
 *                            `settings.json`). Offered only where the provider
 *                            offered it — never on an `rm`, whose own choice keeps
 *                            nothing (measured).
 *   - `cancel`            → the provider's own cancel, with the CLI's effect (🔴 **736 ·
 *                            R97**): Codex's `{ decision: 'cancel' }` on a command or
 *                            file approval **ends the turn** — Codex's doing, as its
 *                            terminal's *No* does; an elicitation's `{ action: 'cancel' }`
 *                            cancels that request and the turn RUNS ON, as its terminal's
 *                            Esc does; Claude's deny with `interrupt: true`. Distinct from
 *                            `deny`; never emitted for a UI "Deny". This app adds no stop
 *                            of its own to it.
 *
 * ⚠️ **`allow_for_session` and `allow_all_for_session` are two grants, and the difference is the
 * whole point of the second one (058).**
 *
 * `allow_for_session` is the provider's OWN rule for the ask (🔴 **736 · R94**: on Claude the CLI's
 * suggestions held to the conversation; on Codex its `acceptForSession`), and the card's
 * `grants.allow_for_session` says what that covers. ⚠️ Until `736` it was scoped to what the CARD
 * DISCLOSED — for Claude, the tool *and the paths in its input*, which is why 031 refused to offer
 * it for an opaque tool: a `Bash` card states a
 * command it does not decompose, so a grant read off it would cover things the card never showed.
 * The measurement behind that ruling is quoted at `claudeDecisionsFor`, and it is not hypothetical —
 * approving `Bash — echo ALPHA` for the session let `rm -f …` run afterwards with no card at all.
 *
 * The consequence was that the tool with the worst approval fatigue was the one tool offered no
 * relief. `allow_all_for_session` closes that by making the wide grant **askable for**, never
 * inferable: it means exactly what 031 measured and refused to grant silently, so the only honest
 * way to have it is a button that says so. Adapters offer it only on an under-disclosed card; since
 * `736` it may sit beside the provider's own rule as a second, separate button, and a UI must never
 * present the two as the same choice.
 */
export const permissionDecisionSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('allow'),
    /** Claude allow may rewrite the tool input before it runs. */
    updatedInput: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    outcome: z.literal('deny'),
    /** Message the model reads when the request is declined. */
    message: z.string().optional(),
  }),
  z.object({ outcome: z.literal('allow_for_session') }),
  z.object({ outcome: z.literal('allow_all_for_session') }),
  /** 🔴 736 · R95 — the provider's own choice that outlives the conversation. */
  z.object({ outcome: z.literal('allow_always') }),
  z.object({ outcome: z.literal('cancel') }),
])

export type PermissionDecision = z.infer<typeof permissionDecisionSchema>

/**
 * The neutral outcomes a user can choose for a `permission_request` (the `outcome` axis).
 *
 * Adding one here is not enough to make it reachable, deliberately: a card only ever offers what its
 * own `scope.availableDecisions` lists, and every adapter validates an answer against what it
 * offered. So a new outcome starts life offered by nobody.
 *
 * ⚠️ **With ONE exception, and it is not an oversight — see {@link ALWAYS_HONOURED}** (482). The
 * two refusals are exempt from that validation in both adapters, and the paragraph above described
 * the rule as though they were not. ⛔ A description that is wrong about an exemption is how a
 * producer comes to build an offer as if the exemption did not exist, which is exactly what
 * `478` F4 found on one card and this dispatch found on three more.
 */
export const permissionOutcomeSchema = z.enum([
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'allow_always',
  'deny',
  'cancel',
])
export type PermissionOutcome = z.infer<typeof permissionOutcomeSchema>

/**
 * 🔴 **The outcomes every adapter honours WHATEVER the request offered** (482, from `478` F4).
 *
 * ## ⛔ This is the ADAPTERS' floor, and until now it was a literal written twice
 *
 * ⚠️ **`claude-runtime.ts` and `codex-runtime.ts` each held their own
 * `decision.outcome === 'deny' || decision.outcome === 'cancel'`**, each under a comment explaining
 * the same rule in different words — *"declining has to stay possible whatever was offered, or
 * fail-closed stops being usable"* on one, *"a decline is always a valid Codex reply and cancel is
 * a client-side turn-kill"* on the other. ⛔ Two copies of one rule with no name is why the
 * PRODUCERS of {@link permissionScopeSchema}'s `availableDecisions` were free to build an offer as
 * if the rule did not exist.
 *
 * ## 🔴 What it does NOT do
 *
 * ⛔ **It does not put a button anywhere.** A surface draws `scope.availableDecisions` and nothing
 * else; naming the floor here is what lets a producer ADD to its own offer deliberately.
 * ⚑ **Since 487 every producer adds it through {@link publishedOffer}**, so the floor is one
 * derivation rather than a habit four call sites happen to share — the paragraph that used to
 * stand here named three producers that omitted a member and deferred the repair to a ruling, and
 * `483`'s repair 1 is that ruling.
 *
 * ⛔ **And it is never a widening.** Both members are refusals the adapter already accepts; a
 * positive is gated by the offered set on Claude always, and on Codex whenever the provider
 * enumerated one.
 */
export const ALWAYS_HONOURED: readonly PermissionOutcome[] = ['deny', 'cancel']

/**
 * Whether {@link ALWAYS_HONOURED} covers this outcome — the gate both adapters ask, in one place.
 *
 * ⚠️ **A function rather than a `Set`**, because the two call sites are on the hot answer path and
 * a two-member `includes` is cheaper than the allocation, and because a `Set` export invites a
 * caller to mutate the floor.
 */
export function isAlwaysHonoured(outcome: PermissionOutcome): boolean {
  return ALWAYS_HONOURED.includes(outcome)
}

/**
 * 🔴 **What a request PUBLISHES, with {@link ALWAYS_HONOURED} kept** (487, `483`'s repair 1).
 *
 * ## ⛔ The defect it closes, and why it was not a card bug
 *
 * ⚠️ **`482` proved the gap at the GATE and could not close it at the PRODUCER.** Both adapters
 * exempt the two refusals from the offered-set check, so a `deny` or a `cancel` is honoured on a
 * request that named neither — and four shapes of Codex command approval published an offer that
 * named neither, so no surface drew a control the rails had admitted all along.
 *
 * 🔴 **One of those four is BroBot's own fail-closed** (`483`): when a command approval carries a
 * requested-permission profile this app cannot display faithfully, every positive is withheld on
 * purpose. ⛔ **Withholding the positives is right; withholding the REFUSALS with them left a
 * person holding a card they could not answer at all**, which is `106` — a control that cannot act
 * must say so rather than be absent — arriving through a fail-closed rather than through an
 * omission.
 *
 * ## ⚑ What it is
 *
 * **The positives as the producer decided them, then the floor.** A refusal already in the
 * positives is not drawn twice, and the published order is therefore stable: what this app can
 * allow, in the producer's own order, followed by what it always honours.
 *
 * ⛔ **It widens nothing.** The two members are refusals every gate already accepts whatever was
 * offered; the POSITIVE gate is a separate value in every producer and this function never sees
 * it. ⚠️ **So the card it changes is the one that could not be answered, and no other.**
 *
 * ⚠️ **It is not a renderer's rule.** A surface still draws `scope.availableDecisions` and nothing
 * else — an event this window did not produce (a replayed ledger, an adapter it has never met) can
 * still carry an offer with no refusal in it, and a surface that invented one would be promising a
 * gate it cannot see. The floor belongs to whoever publishes the request.
 */
export function publishedOffer(positives: readonly PermissionOutcome[]): PermissionOutcome[] {
  return [...positives.filter((outcome) => !isAlwaysHonoured(outcome)), ...ALWAYS_HONOURED]
}

/**
 * 🔴 **697 · `672` F1 — a card's `persistence` is what its BUTTONS can grant, and nothing else.**
 *
 * ⛔ Codex's command card said `session` whenever the server PROPOSED an exec-policy amendment —
 * and no answer this app could send applied one (until `736` the amendment forms mapped to `null`;
 * since R95 the one Codex OFFERS is `allow_always`, and reads as `always`). So every ordinary Codex command card measured by `672`
 * (14 of 14 shapes) told a person *"for the whole conversation, not just this action"* above a
 * one-shot Allow. ⚑ A proposal is not an offer: `session` exactly when a positive the card PUBLISHES
 * grants beyond this one action — one derivation, read by every producer (`031`'s Claude rule was
 * already this, written out in place).
 */
export function persistenceOf(offer: readonly PermissionOutcome[]): 'once' | 'session' | 'always' {
  // 🔴 736 · R95 — a button that outlives the conversation is the widest thing the card can grant.
  if (offer.includes('allow_always')) return 'always'
  return offer.some(
    (outcome) => outcome === 'allow_for_session' || outcome === 'allow_all_for_session',
  )
    ? 'session'
    : 'once'
}

/**
 * A policy amendment the provider PROPOSED alongside a request, for FUTURE actions — disclosed
 * because it would widen standing permission beyond this one action. ⚠️ **Proposed, not applied**
 * (697): the provider applies one only on an answer that chooses it — since `736` (R95) that answer
 * is `allow_always` where Codex OFFERS the amendment as a decision, and the rule it writes is in
 * {@link permissionScopeSchema}'s `grants`. A card's Allow is still the plain accept.
 */
export const permissionAmendmentSchema = z.object({
  /** `exec` = auto-allow similar commands; `network` = allow/deny a host for later requests. */
  kind: z.enum(['exec', 'network']),
  /** Human-readable amendment scope (the command pattern, or e.g. `allow api.example.com`). */
  detail: z.string(),
})
export type PermissionAmendment = z.infer<typeof permissionAmendmentSchema>

/**
 * 🔴 **736 · R94 — one rule a grant installs, in the provider's own terms.** ⚑ R94: *"The card's words
 * say what the rule covers"* — so the card carries the RULE, and the surface carries the sentence
 * (`persons-queue.ts`'s rule: the row carries the word).
 *
 *  - `tool` — a provider permission rule: the tool it covers as the provider names it, and its
 *    content as the provider spells it (`//Users/x/dir/**`, `rm -f x.txt`, `domain:example.com`);
 *    no `content` is the whole tool. `server` names an MCP server where the provider keys the rule
 *    by server and tool (Codex's `mcp_servers.<server>.tools.<tool>`).
 *  - `mode` — a mode the grant switches the conversation into (Claude's `acceptEdits`: *allow all
 *    edits*).
 *  - `directory` — a folder the grant adds to the conversation's working set (Claude's
 *    `addDirectories`).
 *  - `command-prefix` — Codex's `prefix_rule`: every command whose argv starts with `prefix`.
 */
export const grantRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool'),
    tool: z.string(),
    content: z.string().optional(),
    server: z.string().optional(),
  }),
  z.object({ kind: z.literal('mode'), mode: z.string() }),
  z.object({ kind: z.literal('directory'), path: z.string() }),
  z.object({ kind: z.literal('command-prefix'), prefix: z.array(z.string()) }),
])
export type GrantRule = z.infer<typeof grantRuleSchema>

/**
 * 🔴 **736 · what each standing button on a card installs** (R94, R95), keyed by the button's own
 * outcome so two conversation grants on one card cannot be read as each other — the rules, and for a grant
 * that outlives the conversation the FILE the provider keeps it in: 🔴 **`740` · R99** — *"kept where
 * the CLI keeps it"*: Claude's in the project's `.claude/settings.local.json`; Codex's in the
 * conversation's provider home (`rules/default.rules`, `brobot-kept-tool-approvals.json`), where the
 * Codex terminal keeps them. (`736`'s R95 put Claude's in the provider home too.)
 *
 * ⚠️ **Absent is not "nothing"**: an adapter that cannot say what a grant installs leaves it absent,
 * and a surface must not read a grant with no rules as one that covers nothing.
 */
export const permissionGrantsSchema = z.object({
  /** What `allow_for_session` installs, for this conversation — the provider's own rule (R94). */
  allow_for_session: z.array(grantRuleSchema).optional(),
  /** What `allow_all_for_session` installs, for this conversation — the whole tool (058). */
  allow_all_for_session: z.array(grantRuleSchema).optional(),
  /**
   * What `allow_always` KEEPS, beyond this conversation (R95). ⚠️ On Claude, pressing it also
   * installs for this conversation what `allow_for_session` lists — the CLI's same choice held to the
   * session, an added directory among them.
   */
  allow_always: z.array(grantRuleSchema).optional(),
  /** Where `allow_always` is kept — Claude's project local settings, Codex's provider home (740). */
  alwaysFile: z.string().optional(),
})
export type PermissionGrants = z.infer<typeof permissionGrantsSchema>

/**
 * Provider-neutral security scope of a `permission_request` (014, fixing 007
 * P1-7). The pre-014 event reduced an approval to `kind` + a generic action +
 * a truncated reason, so a user could approve materially more than the card
 * showed. Both adapters now populate this typed shape from their own request so
 * the UI can disclose the FULL consequence of approving.
 *
 * Deliberately **neutral**: it never embeds raw provider JSON. The adapter keeps
 * the original typed request stored by id to answer on; only this distilled
 * scope crosses into the neutral event.
 */
export const permissionScopeSchema = z.object({
  /** Working directory the action runs in, if known. */
  cwd: z.string().optional(),
  /**
   * Filesystem paths the action would read/write/affect. Two entry forms (039):
   *  - **Access-labelled** — an entry an adapter derived from a REQUESTED permission, prefixed
   *    with `read ` / `write ` / `restrict ` and a space (`"write /etc"`,
   *    `"read glob:**\/*.ts"`, `"write special:tmpdir"`, `"restrict /etc"` for a sandbox DENY
   *    entry). These show what accepting would actually open (or close).
   *  - **Bare** — a path parsed as a best-effort HINT from the action itself; no prefix.
   * The target after a prefix may be a plain path, `glob:<pattern>`, or `special:<kind>` — so a
   * UI should render entries as text, not assume every entry is a filesystem path it can stat.
   */
  paths: z.array(z.string()),
  /** Network hosts the action would reach. */
  networkHosts: z.array(z.string()),
  /**
   * `once` = this action only; `session` = a session-wide grant (e.g. a write grant root);
   * 🔴 `always` (`736`, R95) = a button on the card installs a rule that outlives the conversation.
   * ⚑ What a button on the card can grant — {@link persistenceOf} — never what the provider merely
   * proposed.
   */
  persistence: z.enum(['once', 'session', 'always']),
  /** 🔴 736 · R94 — what each standing button installs; see {@link permissionGrantsSchema}. */
  grants: permissionGrantsSchema.optional(),
  /** A session-wide filesystem grant root the request asks to open, if any. */
  grantRoot: z.string().optional(),
  /** Policy amendments the provider proposed for future actions — see {@link permissionAmendmentSchema}. */
  amendments: z.array(permissionAmendmentSchema),
  /** The outcomes the provider actually offers for this request (drives decision validation). */
  availableDecisions: z.array(permissionOutcomeSchema),
  /**
   * 🔴 **Why this request offers no way to ALLOW it** (487) — present only when it offers none.
   *
   * ## ⛔ It exists because {@link publishedOffer} spends the channel that used to carry it
   *
   * ⚠️ **Until 487 the fact was carried by accident**, as `availableDecisions: []`. A surface could
   * read *nothing is on offer* out of the empty array and nothing else, which is why the one
   * sentence drawn on it — *"The provider offered no decisions for this request."* — attributed
   * this app's own fail-closed to the provider (`483`). ⛔ Keeping the two refusals is right and it
   * overwrites that array, so **the fact has to be written rather than inferred** or the repair
   * would take away the only thing a surface had to go on.
   *
   * ## ⚑ The WORD, and the surface carries the sentence
   *
   * `persons-queue.ts`'s rule — *the row carries the word, the surface carries the sentence* — so a
   * string that crossed this boundary would be a second copy of copy the renderer can derive.
   *
   *  - `could-not-describe-the-grant` — accepting would grant something this app cannot display
   *    faithfully, so every positive is withheld. ⚠️ **It says THAT, never WHAT**: the eleven
   *    undisplayable profile shapes all produce this one word, so the negative offer discloses
   *    nothing the positives were withheld to keep back.
   *  - `could-not-represent-the-answers` — the provider DID offer a way to accept and this app has
   *    no neutral outcome for it (the network amendment or a look-alike — the exec-policy one is
   *    `allow_always` since `736`), so it could not put it on a card.
   *  - `none-was-offered` — the provider enumerated no way to allow at all.
   *
   * ⛔ **Absent is not a fourth member.** Absent means this request offers a way to allow it, and
   * every producer that can offer one leaves it absent.
   */
  noPositiveBecause: z
    .enum(['could-not-describe-the-grant', 'could-not-represent-the-answers', 'none-was-offered'])
    .optional(),
  /**
   * True when the adapter could not fully represent the request's scope in this
   * neutral shape (a broader/opaque request — e.g. extra permission profiles, or
   * a decision option we can't map). The UI must treat it as broad; it is
   * surfaced, never silently dropped (007 P1-7).
   */
  underDisclosed: z.boolean(),
  /**
   * The session's approval mode (078) — part of the honest scope, not decoration.
   *
   * In `auto` a card is rare, so one that does surface is worth labelling: it tells the user that
   * everything ELSE in this session is running unprompted. ⚑ Since `728` one kind is expected, not an
   * anomaly: while Claude is planning, its own plan mode's asks reach the person even in `auto`, as
   * the CLI's do. Absent means `ask`.
   */
  approvalMode: z.enum(['ask', 'auto']).optional(),
})
export type PermissionScope = z.infer<typeof permissionScopeSchema>

/** {@link permissionScopeSchema}'s `noPositiveBecause` — the closed set of reasons, on its own. */
export type NoPositiveBecause = NonNullable<PermissionScope['noPositiveBecause']>

/**
 * The object half of {@link userInputOptionSchema} — what an option IS, once the legacy string form
 * has been coerced into it. Declared on its own so both union branches produce this exact type.
 */
const userInputOptionObject = z.object({
  /** What the user picks, and **what the answer is made of** — forwarded to the provider verbatim. */
  label: z.string(),
  /**
   * Why the model offered it — the sentence the user needs in order to choose (143).
   *
   * ⚠️ **Both providers declare it REQUIRED and BroBot dropped it on both.** Codex's
   * `ToolRequestUserInputOption` is `{label, description}`, neither nullable; Claude's pinned
   * `AskUserQuestionInput` option is `{label, description, preview?}` with only `preview` optional.
   * So this is not a field that is usually sent — it is one both providers guarantee, and the user
   * was choosing between labels with the reasoning removed.
   *
   * ⚑ **Optional HERE for one reason only: the ledger.** Every `user_input_request` recorded before
   * 143 has options that were bare strings, and {@link storedQuestionsParsed} gives those a
   * `label` and nothing else — there is no description to invent for them (086). An absent one
   * renders as nothing at all; see `UserInputCard.vue`.
   *
   * ⛔ **`preview` is deliberately NOT here.** 142 measured it real in the corpus (three previews of
   * 266/251/315 characters in `sess_865688c3`'s `raw_frame` archive), and it is a second surface —
   * a panel, not a line under a label. 108 refused `promptPreview` on that judgement and 139
   * refused `description` on it; this dispatch was scoped to take `description` and say so.
   */
  description: z.string().optional(),
})

/**
 * One offered choice on a {@link userInputQuestionSchema} (143).
 *
 * ⚠️ **A union because the LEDGER holds both shapes, and only one of them can be parsed.** Before
 * 143 an option was a bare string, and five such `user_input_request` rows exist in the live
 * database this was measured against — including the two-question call that motivated 139. A
 * string branch that coerces to `{label}` means every path which PARSES normalizes for free: the
 * adapters, the IPC boundary, and `toWireEvent`.
 *
 * Apply the same option coercion on replay through {@link storedQuestionsParsed}. `session-store.ts`'s `toPersistedEvents` casts stored events without Zod parsing, so legacy string options otherwise reach a card expecting objects and render blank.
 */
export const userInputOptionSchema = z.union([
  z.string().transform((label): UserInputOption => ({ label })),
  userInputOptionObject,
])
export type UserInputOption = z.infer<typeof userInputOptionObject>

/**
 * One structured question on a `user_input_request` (020, fixing 007 P2-1) — the
 * neutral shape a future UI answers per-question. Provider-neutral: built from
 * Claude `AskUserQuestion` questions or Codex `item/tool/requestUserInput`
 * questions; carries no raw provider payload.
 */
export const userInputQuestionSchema = z.object({
  /** Stable id to answer against (Codex question id, or a positional `q{n}`). */
  id: z.string(),
  /** The question text. */
  prompt: z.string(),
  /**
   * The compact label the providers DESIGNED for this card — `"Scope"`, `"Demo files"` (143).
   *
   * ⚑ **Both send one and both bound it.** Claude's pinned typings: *"Very short label displayed as
   * a chip/tag (max 12 chars)"*, required on every question. Codex's `ToolRequestUserInputQuestion`
   * declares `header: string`, non-null. The bound is the provider's, not ours — nothing here
   * truncates, because a header longer than its own documented limit is a fact about the model's
   * output and 086 says show it rather than tidy it away.
   *
   * Optional for the ledger, exactly as {@link UserInputOption.description} is: rows recorded before
   * 143 have no header, and a question without one shows none.
   */
  header: z.string().optional(),
  /** Available choices; empty = free-form answer. */
  options: z.array(userInputOptionSchema),
  /**
   * **This question also takes an answer that is not on the list** (143).
   *
   * ⛔ **The defect this fixes: BroBot could never show a free-form escape that BOTH providers
   * guarantee.** The card rendered a text field only when `options.length === 0` — and both
   * normalizers forbid exactly that. Codex's `normalize_request_user_input_args` forces
   * `is_other = true` on every ordinary question and its options are *"2–3 mutually exclusive
   * choices"*; Claude's pinned typings tell the model *"There should be no 'Other' option, that
   * will be provided automatically"*. So on both providers every ordinary question offers one, the
   * provider expects an answer that may not be a label, and the user had no way to give it. That is
   * `multiSelect` again — the provider distinguished something and we did not.
   *
   * ⚑ **Read, not assumed, on the provider that sends it.** Codex states `isOther` per question and
   * `codexQuestions` copies it; Claude has no field to copy because the escape is unconditional, so
   * `claudeQuestions` sets it from the one thing the SDK makes it depend on — whether there are
   * options at all.
   *
   * ⚠️ **It is load-bearing rather than decorative: {@link answerToForward} enforces it.** A value
   * that matches no option label is only forwardable when this is `true`. Absent means unknown, and
   * unknown is read as "labels only" — the safe reading, and the one every pre-143 row was
   * genuinely built under, since no card could produce anything else.
   */
  allowOther: z.boolean().optional(),
  /**
   * **What the user types here must not be shown as they type it** (143, from 141 §3.1).
   *
   * Codex declares `isSecret` per question. 141 measured that it *"is not exposed by the ordinary
   * pinned model-tool schema and defaults false"* — so no ordinary Codex question sets it today —
   * and that BroBot dropped it anyway, *"leaving a latent masking gap if another valid producer
   * sets it"*. Carried rather than dropped a second time: it costs one attribute on one input, and
   * the alternative is a field that silently renders a secret in clear text the first time any
   * producer does set it.
   *
   * ⚑ **It masks the FREE-FORM input and nothing else.** Options are labels the model wrote and the
   * user picks; there is no secret in choosing one. Claude has no equivalent field, so a Claude
   * question never sets this — stated rather than emulated (035).
   *
   * ⛔ **Masking is a display rule, not a storage one.** The answer VALUES are not persisted at all
   * — `RuntimeHost` records the outcome `answered`/`rejected` and never the text (141 §MEDIUM 3) —
   * so there is no ledger row for this flag to have to protect.
   */
  secret: z.boolean().optional(),
  /**
   * **This question takes SEVERAL answers** (139).
   *
   * ⚠️ **A question that needed this really did arrive, and there was nowhere to put it.** Claude's
   * `AskUserQuestion` declares `multiSelect: boolean` on every question — REQUIRED in the SDK's own
   * input type, not optional — and `sess_71a5b654` ord 234 sent two questions in one call, one
   * `"multiSelect": true` and one `false`. This shape had exactly three members, so the normalizer
   * had nothing to copy the flag INTO: both questions crossed as the same neutral thing and the card
   * rendered them identically. The app asked a multiple-choice question as though only one answer
   * were allowed, and the `string[]` half of {@link userInputResponseSchema} — built in 033 — could
   * not be reached by any question the product could render.
   *
   * ⚑ **Optional, and that is a fact about the LEDGER rather than a licence for the adapters.**
   * Every `user_input_request` recorded before 139 carries no such field, and a persisted row is
   * replayed by CAST (`session-store.ts` `toPersistedEvents`), never re-parsed — so a required
   * boolean would type every historical question as carrying a flag it does not have. Both adapters
   * state it explicitly on every question they build (`claudeQuestions`, `codexQuestions`), so an
   * absent flag on a NEW question is an adapter that forgot rather than a mode nobody ruled on —
   * and the difference is legible in the ledger.
   *
   * ⛔ **Two things this used to say are false, and 141 measured both** (142 §5). It claimed a
   * `.default(false)` "would fill one in on its behalf" for historical replay: replay never invokes
   * Zod at all, so a default would not run on a single one of those rows — it would only fill in
   * fresh parses, answering for the adapters on the one path where they are supposed to speak. And
   * it claimed absent means single-select, *"which is what those questions were"*: the very call
   * that motivated 139 carried one `true` and one `false` before the normalizer dropped both, so
   * absent means **unknown**. The card renders an unknown flag as single-select — the only safe
   * reading available to it — and at least one historical row is genuinely misrepresented by that.
   *
   * ⛔ **Codex has no equivalent, and its plural answer is not one.** `ToolRequestUserInputQuestion`
   * is `{id, header, question, isOther, isSecret, options}` — measured in the generated protocol,
   * no multi-select flag anywhere — while `ToolRequestUserInputAnswer` is `{answers: Array<string>}`,
   * plural for every question. A response shape that CAN carry several is not a question that asked
   * for several, and reading one as the other would invent a signal the provider does not send
   * (035). A Codex question is single-select and `codexQuestions` says so in one word.
   */
  multiSelect: z.boolean().optional(),
})
export type UserInputQuestion = z.infer<typeof userInputQuestionSchema>

/**
 * Parse the questions of a STORED `user_input_request` — the one path that never parsed (143, 146).
 *
 * ⚠️ **Replay is a cast.** `toPersistedEvents` does `JSON.parse(row.payload) as TranscriptEvent` and
 * hands the result to the renderer through `latestHistory` — `toWireEvent` is on the LIVE emit path
 * only. So a `user_input_request` recorded before 143 arrives at `UserInputCard.vue` with
 * `options: string[]` while the type promises `UserInputOption[]`, and `option.label` is `undefined`
 * for every chip. Measured, not hypothesised — and re-counted exactly by 145: of seven
 * `user_input_request` rows in the live database, five carry questions, **three with one question
 * and four options and two with two questions and seven options**, and all 26 of those options are
 * bare strings. One of the two-question rows is the very call 139 was raised for. (143 wrote "all
 * five have four options" here; that was never true of those two.)
 *
 * ⛔ **143 closed that with a hand-written coercion, and the coercion was the next defect** (145
 * MEDIUM 1). It looked for bare strings and CAST everything else, so it fixed the one malformed
 * shape it had been told about and trusted every other: `["A", 42]` produced a chip whose label was
 * a number, `{label: 42}` reached `label.trim()` and threw, and a `questions` field that was not an
 * array threw inside the migration itself. Two validators — this and
 * {@link userInputOptionSchema} — kept in step by hand, which is the class of hole 143 §0 named and
 * then re-opened one function down.
 *
 * ⚑ **So replay PARSES, with the same schema every other path uses.** There is now one definition
 * of what an option is, and the legacy string form is coerced by the union branch that was already
 * written for it rather than by a copy of it. Nothing has to be kept in step because there is no
 * second thing.
 *
 * ⛔ **A row that does not parse THROWS, and `toPersistedEvents` already says what that means:**
 * *"A row we cannot parse is skipped rather than replayed as something else: a transcript with a
 * hole is honest, a transcript with a fabricated entry is not."* All three malformed shapes above
 * now reach that one documented policy instead of three different accidents.
 *
 * ⚠️ **`unknown` in, because the type was the lie.** A caller holding `UserInputQuestion[]` from a
 * cast has a promise the database never made; taking `unknown` is what forces the check to happen.
 *
 * ⛔ **A string becomes `{label}` and gains NOTHING else.** There is no description in a row that
 * never carried one, and inventing an empty one would make "the model gave no reason" and "the
 * model gave the empty reason" the same thing on screen (086).
 *
 * ---
 *
 * ⛔ **It validates SHAPE and deliberately does not call {@link duplicateAnswerKey}** (150, ruling on
 * 148 L1). The omission is real — an old or imported row whose questions share an answer key parses
 * here without complaint — and fixing it would be the wrong trade, in the direction 086 cares about.
 *
 * The duplicate-key defect is about DELIVERY: two questions keyed alike means the second answer
 * overwrites the first on the way to the provider. A replayed row is not being delivered anywhere.
 * It is a record of a call the model really made, and rejecting it would not repair anything — it
 * would make {@link toPersistedEvents} SKIP the row, so a card that genuinely happened would vanish
 * from the transcript. *"A transcript with a hole is honest"* is the policy for a row we cannot
 * READ; this is a row we can read perfectly well and merely disapprove of.
 *
 * ⚑ **And nothing depends on the parse for safety.** The live path is closed at publication in both
 * adapters (146, and 150 for the other two malformations), a reopened card is settled and cannot be
 * answered, and the one gesture that could still destroy an answer — sending one — is refused
 * independently by {@link answerToForward} at the gesture. A check here would be a fourth guard on a
 * path with no way through, bought by deleting history.
 */
export function storedQuestionsParsed(questions: unknown): readonly UserInputQuestion[] {
  return z.array(userInputQuestionSchema).parse(questions)
}

/**
 * The first key that appears twice, or `null` when every one is distinct (146).
 *
 * ⛔ **A question set whose answers cannot be told apart must never become a card** (145 HIGH 3).
 * Both providers key their answer by a string they chose and neither constrains it: Claude's
 * `AskUserQuestionOutput.answers` is a dictionary of *question text* → answer and the pinned SDK
 * permits 1–4 questions with no uniqueness condition; Codex's `ToolRequestUserInputResponse` is
 * keyed by *question id* and its pinned normalizer validates options but not id uniqueness. Two
 * questions sharing that key means the second answer overwrites the first on the way out — one
 * human answer destroyed, and the gesture recorded as `Answered`.
 *
 * ⚑ **Which key is the provider's business, so the caller passes it.** For Codex the wire key and
 * the neutral id are the same string, so one check covers both the card's addressing and the
 * provider's. For Claude the neutral ids are positional (`q0`, `q1`) and cannot collide, while the
 * wire key is the question text — so the text is what is checked there.
 *
 * ⛔ **The remedy is to fail the call CLOSED, before anything is shown** — the same ruling 064 made
 * for `AskUserQuestion` with no questions at all, and for the same reason: the honest thing to tell
 * the model is that its call was malformed and can be retried, rather than to ask a human to answer
 * questions only some of whose answers can be delivered.
 */
export function duplicateAnswerKey(
  questions: readonly UserInputQuestion[],
  keyOf: (question: UserInputQuestion) => string,
): string | null {
  const seen = new Set<string>()
  for (const question of questions) {
    const key = keyOf(question)
    if (seen.has(key)) return key
    seen.add(key)
  }
  return null
}

/**
 * ⛔ **An option nobody can choose — the dead control 148 M6 found, refused at the gesture** (150).
 *
 * A single-select question offering `"   "` and `"real"` rendered two chips. Picking the blank one
 * stored it, {@link answerToForward} trimmed it away as *nothing chosen*, `aria-pressed` reverted,
 * Answer stayed disabled, and the explanatory hint renders only for multi-select — so the user got a
 * control that visibly does nothing and says nothing about why. **A control that cannot act,
 * reachable from a label both providers permit** (106).
 *
 * ⚑ **Refused before any card is published**, which is 064's ruling for `AskUserQuestion` with no
 * questions and 146's for two questions sharing an answer key, applied to the third way the same
 * call can be malformed. The honest thing to tell the model is that its option list cannot be
 * answered, which it can see and retry; the alternative is a human staring at a chip that is not a
 * chip.
 *
 * ⛔ **This does NOT trim, rename or filter the provider's labels** (143/146). Exact non-blank
 * labels — including meaningful leading, trailing and non-breaking spaces — are deliberately
 * byte-preserved, and dropping a choice would change what the model asked. The test is only whether
 * a label consists of nothing but whitespace, and the answer is to refuse the whole call.
 *
 * ⚠️ **`answerToForward`'s own nothing-chosen rule stays exactly as it is** (146 §1). That path is
 * still reachable — a stored or imported card, answered after this adapter published it — and it is
 * correct there. This closes the branch that had no way to say anything at all.
 *
 * Returns the offending label so the message can quote it back, or `null` when every option is
 * answerable. `\u00a0` and friends count as whitespace to `trim`, which is the point: they are
 * invisible to the person being asked to click one.
 */
export function unanswerableOptionLabel(questions: readonly UserInputQuestion[]): string | null {
  for (const question of questions) {
    for (const option of question.options ?? []) {
      if (option.label.trim() === '') return option.label
    }
  }
  return null
}

/**
 * 🔴 **The two consent cards that MOVE plan mode, as a closed vocabulary** (478).
 *
 * ⛔ **Named by what approving one DOES, not by the tool that raised it.** The tool names are
 * Claude's — `EnterPlanMode` and `ExitPlanMode` — and `317` forbids the renderer naming a provider
 * in anything a person reads; a surface keyed on a tool name would also be `464`'s rename hazard,
 * spelling a label somebody else owns. ⚑ The adapter reads its own `PLAN_GESTURES` and says which
 * of these it is, once, on the event.
 *
 * ⚠️ **Closed because the sentence a person reads before pressing is keyed by it**, so a third
 * consent card cannot reach a surface without somebody writing what approving it does.
 *
 * ⚑ **`start-planning` is on ledger rows written before `736` only.** R98 took `EnterPlanMode`'s
 * card away (the CLI does not ask before it, measured); the member stays because this is the
 * stored-event contract, and an older row must still parse and still say what its press did.
 */
export const PLAN_CONSENTS = ['start-planning', 'stop-planning'] as const

/**
 * Which way approving a zero-question consent card moves the conversation. See
 * {@link PLAN_CONSENTS}; absent on every request that is not one of those two.
 */
export type PlanConsent = (typeof PLAN_CONSENTS)[number]

/**
 * The requested scope of a permission-grant `user_input_request` (Codex
 * `item/permissions/requestApproval`) — neutral, no raw payload (020).
 */
export const userInputPermissionSchema = z.object({
  /** Working directory the request applies to, if given. */
  cwd: z.string().optional(),
  /**
   * ⛔ **709 · written by no producer since `709` — rows from before it still carry it.** It was the
   * request's `reason` with no author, and the model writes that (measured: see {@link agentReason}),
   * so it was the agent's sentence drawn unlabelled — on the card, as its headline, and on Home as the
   * first line of what a grant would authorize. ⚑ Kept so an old row still parses.
   */
  reason: z.string().optional(),
  /**
   * 🔴 **709 · R44 — the MODEL's own words for this request, under its author's name.** Present only
   * when the model wrote some.
   *
   * ⚑ **Measured** (`probe:codex-approval-reason`, bundled Codex 0.146.0): with Codex's
   * `request_permissions` tool enabled, the `reason` the model passes arrives on
   * `item/permissions/requestApproval` verbatim. ⚠️ **On BroBot's `ask` profile as shipped the model
   * is not offered that tool at all** (the call fails *"`tools.request_permissions` is not a
   * function"*), so no model can raise this card today; the field is ready for the day one can.
   *
   * ⛔ Never a scope line: {@link paths} and {@link network} are what a grant authorizes, and this is
   * a sentence the agent wrote about them. The drawing is the frontend's, by the agent's name.
   */
  agentReason: z.string().optional(),
  /**
   * Requested extra filesystem access, every entry **access-labelled** with a `read ` /
   * `write ` / `restrict ` prefix (`"write /etc"`, `"read glob:**\/*.ts"`,
   * `"write special:project_roots"`; `restrict ` marks a sandbox DENY entry) — covering both
   * the legacy read/write arrays and the newer `entries` (path / glob / special) forms, so the
   * UI sees everything a positive decision would grant (039). A request whose shapes cannot be
   * displayed truthfully is failed closed by the adapter rather than granted unseen.
   */
  paths: z.array(z.string()),
  /** Whether extra network access is requested. */
  network: z.boolean(),
})
export type UserInputPermission = z.infer<typeof userInputPermissionSchema>

/**
 * Response to a `user_input_request` (Claude `AskUserQuestion`, Codex
 * `item/tool/requestUserInput` / `item/permissions/requestApproval`) — HO-001
 * §6 refinements 3 & 4.
 *
 * These are server-initiated *requests*, not events: the provider blocks until
 * answered. `reject` is the **protocol-safe default** so the provider can never
 * hang when the app has no richer UI for the request. Each adapter maps it to
 * that method's **documented denied/empty payload** — never a JSON-RPC error
 * (020, fixing 007 P2-1) — so the turn continues predictably.
 *
 * **Multi-question answers (033, deliberate contract change fixing 023 P2 #1):** a
 * `user_input_request` can carry SEVERAL `questions` (020), so the `answer` variant
 * correlates answers to questions **by question id** — `{ answers: { [questionId]:
 * string | string[] } }` — instead of a single `text` that only answered question 1.
 * A value is a single answer or several (multi-select). Adapters build each
 * provider's payload for **every** question and validate **completeness**: a request
 * whose questions are not all answered is **failed closed** (safe-declined), never
 * partially forwarded. An answer to an unknown id (no matching question) is ignored.
 *
 * ⚠️ **The `string[]` half was unreachable until 139, and the gap was on the QUESTION side.** This
 * union has allowed several answers since 033, and nothing in the product could ever produce one:
 * the neutral question carried no `multiSelect` (see {@link userInputQuestionSchema}), so every card
 * rendered single-select and every answer was a string. That is why 139 is a question-shape change
 * rather than an answer-shape one, and why a single-select answer is still exactly the string it
 * always was — no existing caller had to move.
 *
 * ⛔ **Completeness is not usefulness, and {@link answerToForward} is where both are decided.** A
 * key being present says only that the id was answered; it does not say the value can be told to a
 * provider. Nothing chosen (`''`, `[]`, blanks) and several chosen for a question that declared ONE
 * are both failed closed, because forwarding either would state a human decision nobody made —
 * 064's rule, applied to the value instead of to the question.
 *
 * ⚠️ **139 wrote that paragraph and only one adapter kept it** (142 §2). Claude validated; Codex
 * checked completeness alone and forwarded `[]`, a blank, and two selections for a one-answer
 * question straight to the provider. A promise made in this file and kept in one adapter is a
 * promise the other silently breaks, which is why the rule now lives HERE as code rather than here
 * as prose — see {@link answerToForward}.
 */
const answerValueSchema = z.union([z.string(), z.array(z.string())])

/**
 * The answers, keyed by ids the PROVIDER chose — parsed so that no key can be a special one (146).
 *
 * ⛔ **`z.record` was the wrong tool and it took a measurement to see it.** A Codex question id and
 * a Claude question text are unrestricted strings on both wires: the pinned `0.146.0`
 * `request_user_input_spec.rs` validates options but not id syntax, uniqueness or reserved names,
 * and the SDK's `AskUserQuestionInput` declares `question: string` with no condition either. So
 * `__proto__` is a legal id, and this is what each shape does with one — measured on the versions
 * this repo pins, not reasoned about:
 *
 *  - `plain['__proto__'] = 'alpha'` sets the object's PROTOTYPE. `Object.getOwnPropertyNames` is
 *    `[]` and `JSON.stringify` is `{}`. The answer is gone, silently.
 *  - Electron's structured clone carries an own `__proto__` faithfully — v8 defines it as an own
 *    data property rather than assigning it, so the renderer's answer arrives here intact.
 *  - **`z.record` then DROPS it.** Zod 4.4.3 refuses to write `__proto__` into the plain object it
 *    builds — a proto-pollution guard, and the right call for a plain object. The key simply
 *    vanishes from the parsed result, so the question reads as unanswered.
 *
 * ⚑ **So the map is rebuilt on a NULL-PROTOTYPE object, and then every one of those problems is
 * gone at once.** There is no inherited `constructor` to read back, no `__proto__` setter to
 * swallow a write, and `JSON.stringify` emits the key like any other. Zod's guard exists because
 * the target has `Object.prototype`; removing the prototype removes the need for the guard rather
 * than working around it.
 *
 * ⚠️ **The prototype does not survive IPC, and it does not have to.** Structured clone rebuilds an
 * ordinary object on the far side — which is exactly why this parse, at the trust boundary, is
 * where the null-prototype copy is made. Everything downstream reads it with `Object.hasOwn` and a
 * type check anyway (see {@link answerToForward}), because a shared function cannot assume it was
 * handed the object this schema produced.
 */
const answerMapSchema = z.unknown().transform((value, ctx): Record<string, string | string[]> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    ctx.addIssue({ code: 'custom', message: 'answers must be an object keyed by question id' })
    return z.NEVER
  }
  const answers: Record<string, string | string[]> = Object.create(null)
  for (const key of Object.keys(value)) {
    const parsed = answerValueSchema.safeParse((value as Record<string, unknown>)[key])
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: `the answer for '${key}' must be a string or a list of strings`,
      })
      return z.NEVER
    }
    answers[key] = parsed.data
  }
  return answers
})

export const userInputResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('answer'),
    /** Answers keyed by the neutral question id (`UserInputQuestion.id`); value = one or many. */
    answers: answerMapSchema,
  }),
  z.object({
    kind: z.literal('reject'),
    /** Why it was declined, for a provider whose answer can carry it; absent when none was given. */
    reason: z.string().optional(),
  }),
])

export type UserInputResponse = z.infer<typeof userInputResponseSchema>

/**
 * What an answer becomes on the wire — or why it cannot go at all (142 §1/§2/§3).
 *
 * `forwardable` carries the CANONICAL value of every question, keyed by neutral question id: the
 * chosen labels with nothing-at-all members dropped, in the order the user sent them, each one
 * verbatim. It is the only thing an adapter has to forward from, which is the point.
 */
export type AnswerToForward =
  | {
      readonly forwardable: true
      readonly values: ReadonlyMap<string, readonly string[]>
      /**
       * The answers that were TYPED rather than picked — the `Other` half, by question id (143).
       *
       * ⚠️ **Neither provider distinguishes these on the wire, and that is a measured fact rather
       * than an omission here.** Codex's `ToolRequestUserInputAnswer` is `{answers: string[]}` with
       * nothing to mark a free-form member, and its own pinned test client *"selects one option or
       * accepts a free-form Other response"* into that same array. Claude's per-question `answers`
       * map is `question text → string`. So on both, a typed answer and a chosen label occupy the
       * identical slot, and an adapter that wanted to tell them apart on the wire could not.
       *
       * ⚑ **The distinction is drawn HERE, where the options are, and it is what makes
       * {@link UserInputQuestion.allowOther} enforceable** — a typed value is refused outright for a
       * question that does not take one. Claude additionally has one top-level `response` field for
       * it; see `claudeFreeformResponse` for why it is filled only when it can be filled honestly.
       */
      readonly typed: ReadonlyMap<string, readonly string[]>
    }
  /** Why not — an adapter diagnostic for the log, naming the question ids. Never UI copy (085). */
  | { readonly forwardable: false; readonly why: string }

/**
 * Whether a value IS one of the labels this question offers — the membership rule, once (146).
 *
 * ⛔ **It used to be two rules, and 145 MEDIUM 2 measured the gap between them.** The card asked
 * `option.label === value` while this file asked `option.label.trim() === member.trim()`, so a
 * label padded with NBSP and typed plainly into the `Other` field was free-form on screen and a
 * chosen label on the wire. Exact equality on both sides is the whole fix, and it is only available
 * because the card stopped trimming what it sends.
 *
 * ⚠️ **The card cannot import this, and that is a deliberate boundary rather than an oversight.**
 * `shared/runtime-ipc.ts` says it: the renderer takes TYPES from the runtime and no values, so that
 * the provider adapters never reach the renderer bundle. So the rule is one line on each side and
 * pinned by a test that drives the same NBSP fixture through both — the agreement is asserted
 * rather than assumed, which is the same route 146 took for replay.
 */
export function isOfferedLabel(question: UserInputQuestion, value: string): boolean {
  return question.options.some((option) => option.label === value)
}

/**
 * Can this answer be told to a provider as a human's choice, and as WHAT (142)?
 *
 * ## Three defects, one function
 *
 * **§1 — the ledger said `Answered` when the adapter said deny.** 139 put this check inside Claude's
 * `canUseTool` continuation, which runs *after* `respondUserInput` has already taken the broker slot
 * and returned. `RuntimeHost` could not observe the later outcome, so it recorded `answered` for an
 * answer the adapter had refused to state — *"the transcript states a human answer was accepted when
 * the adapter explicitly refused to tell it to the provider"* (141 HIGH 1). Both adapters now call
 * this at the **moment the answer is given** and refuse it there (`AnswerRefused('not-usable')`), so
 * the card stays open and answerable and nothing false is written. 039's rule is the reason:
 * `accepted` is a claim, and a claim needs a source — this is the source.
 *
 * **§2 — Codex enforced none of it.** `userInputPayloadFor` checked only that every id was PRESENT,
 * so `[]`, a blank, two selections for a question `codexQuestions` publishes as `multiSelect:false`,
 * and a substantively partial answer all reached the provider (141 HIGH 2). One implementation, both
 * adapters — a rule kept in one place cannot be kept by one provider.
 *
 * **§3 — the value validated was not the value forwarded.** Claude's guard filtered blanks *to
 * count* and then joined the ORIGINAL array, so `["the root", "   "]` passed and became
 * `"the root,    "` (141 MEDIUM 2). Returning the canonical values instead of a boolean is what
 * makes that class of defect unrepresentable: an adapter cannot forward something this function did
 * not approve, because approval and value are the same call.
 *
 * ## The rules
 *
 *  - **Every question answered.** An id that is absent fails closed; a partial answer that silently
 *    drops questions 2..n is never forwarded (033).
 *  - **Something chosen.** `''`, `[]`, and arrays of blanks all say nothing. 064 refused a question
 *    with nothing to ask because the model's own question came back successful and empty; an
 *    answered question with no answer in it is the same event one layer down.
 *  - **Not several, for a question that takes one.** `multiSelect !== true` means one — see
 *    `claudeAnswerText` for what joining two would build on the wire.
 *  - **A value that is not on the list only where the list says it may be** (143). A question with
 *    options takes its own labels; anything else is an `Other` answer, and
 *    {@link UserInputQuestion.allowOther} is the only thing that permits one. A question with NO
 *    options is free-form by definition and takes whatever was typed.
 *
 * ⚠️ **Membership is EXACT, and 146 is where the two halves of the old workaround came out
 * together.** 143 matched on the trimmed value and forwarded the option's own label, because
 * `UserInputCard.answer()` trimmed everything it sent and a label with real leading space would
 * otherwise have been refused as an `Other` answer to a question that takes none. 145 measured what
 * that bought: an offered label padded with NBSP, typed plainly into the `Other` field, was shown
 * to the user as free-form and arrived at the provider as the listed label, with Claude's freeform
 * signal omitted — *"the user saw one category of answer while the provider receives another"*, and
 * 139's own defect one layer along. The card no longer trims (its own contract said typed text is
 * never trimmed, and it was trimming it), so the tidying that needed forgiving is gone and
 * forgiving it is gone with it. **One rule: a value is a label when it IS that label.**
 *
 * ⚑ **A typed value is never trimmed** — it is the user's own words, and it is reported separately
 * in `typed` so an adapter can carry it where the provider has somewhere to put it. Blank members
 * are dropped throughout: emptiness is decided on the trimmed value, which is a test for "said
 * nothing", not a rewrite of what was said.
 *
 * ⚑ **An answer to an unknown id is ignored, not refused** — the loop is over the QUESTIONS. That
 * has been the contract since 033 and it is what lets a card send a draft key for a question the
 * provider withdrew.
 *
 * ⛔ **`Object.hasOwn`, never `in`** (146, from 145 HIGH 2). A provider-chosen id of `constructor`
 * made `'constructor' in answers` true on any ordinary object, so an unanswered question counted as
 * answered and the inherited FUNCTION reached `.trim()` — a throw, from a legal question id.
 */
export function answerToForward(
  questions: readonly UserInputQuestion[],
  answers: Record<string, string | string[]>,
): AnswerToForward {
  const values = new Map<string, readonly string[]>()
  const typed = new Map<string, readonly string[]>()
  const unanswered: string[] = []
  const unusable: string[] = []
  const notOffered: string[] = []
  for (const question of questions) {
    const value = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined
    if (value === undefined) {
      unanswered.push(question.id)
      continue
    }
    // `typeof member === 'string'` is not belt-and-braces over the type above: this function is
    // called with hand-built objects by the fake runtime and by tests, and with a Zod-parsed one
    // only on the IPC path. A member that is not a string says nothing, exactly as `''` does.
    const chosen = (Array.isArray(value) ? value : [value]).filter(
      (member) => typeof member === 'string' && member.trim() !== '',
    )
    if (chosen.length === 0 || (chosen.length > 1 && question.multiSelect !== true)) {
      unusable.push(question.id)
      continue
    }
    // Anything that is not one of this question's own labels is an `Other` answer, and lives or
    // dies by `allowOther`. A question with no options offers no labels, so every member misses —
    // which is the free-form case, and it is why the permission below is
    // `options.length === 0 || allowOther` rather than `allowOther` alone.
    const free = chosen.filter((member) => !isOfferedLabel(question, member))
    if (free.length > 0 && question.options.length > 0 && question.allowOther !== true) {
      notOffered.push(question.id)
      continue
    }
    values.set(question.id, chosen)
    if (free.length > 0) typed.set(question.id, free)
  }
  if (unanswered.length === 0 && unusable.length === 0 && notOffered.length === 0) {
    return { forwardable: true, values, typed }
  }
  const why = [
    unanswered.length > 0 ? `unanswered: ${unanswered.join(', ')}` : '',
    unusable.length > 0
      ? `nothing chosen, or several for a question that takes one: ${unusable.join(', ')}`
      : '',
    notOffered.length > 0
      ? `not one of the offered options, on a question that takes no other: ${notOffered.join(', ')}`
      : '',
  ]
    .filter((part) => part !== '')
    .join('; ')
  return { forwardable: false, why }
}
