import { z } from 'zod'
import { isMessageAct } from './message-act'
import { MAX_FILE_DIFF_BYTES } from './file-change'
import { MAX_BACKGROUND_ID } from './background-work'

/**
 * A coalesced chunk of streamed assistant text (001 gap 5 / streaming).
 *   - Claude: `content_block_delta` / `text_delta` (needs `includePartialMessages`).
 *   - Codex:  `item/agentMessage/delta`.
 * Adapters coalesce raw token deltas, then emit one authoritative
 * `assistant_message`.
 *
 * ⛔ **No `parentToolCallId` here, and that is a measurement rather than an omission** (128).
 * `SDKPartialAssistantMessage` declares `parent_tool_use_id: string | null` (sdk.d.ts:5282-5292), so
 * the field exists on every partial frame — and across the whole of this machine's ledger **4,220
 * stream frames carry that key and not one of them is non-null**, the sub-agent windows included.
 * A child's prose reaches us only as the authoritative message; its deltas are never forwarded. So
 * the head glimpse on the card fills at message boundary, which is honest, and a `parentToolCallId`
 * on this event would be machinery a type declaration justified and no traffic has ever exercised.
 */
export const assistantDeltaSchema = z.object({
  type: z.literal('assistant_delta'),
  text: z.string(),
})

/**
 * An authoritative assistant message block — the source of truth
 * the UI should render (replacing any delta-accumulated text). Preceding
 * `assistant_delta`s are best-effort progressive rendering and are NOT
 * guaranteed to concatenate exactly to this text.
 *   - Claude: `SDKAssistantMessage` text blocks.
 *   - Codex:  `item/completed` agentMessage.
 */
export const assistantMessageSchema = z.object({
  type: z.literal('assistant_message'),
  text: z.string(),
  /** The provider explicitly marked this message's role. Absent on older recordings. */
  phase: z.enum(['commentary', 'final']).optional(),
  /** Correlates confirmations of the same provider message without matching its text. */
  messageId: z.string().optional(),
  /**
   * WHOSE words these are (128) — the same attribution {@link toolCallSchema} has carried since 029,
   * on the other half of the very same message.
   *
   * ⛔ **029 fixed the tools and left the speech, and the two halves come from one envelope.**
   * `normalize.ts` computes the parent once per assistant message and spread it onto every
   * `tool_call` in that message while flushing the text runs beside them with nothing — so a child
   * that talked arrived in the conversation indistinguishable from the parent, which is the
   * misattribution 029 was written to end.
   *
   * Retain the parent tool-call id on child content, not only child tool calls. Otherwise forwarded background messages become loose top-level turns and foreground child text can disappear despite its envelope carrying a valid parent.
   *
   * Absent means the main agent said it, which is the overwhelmingly common case.
   */
  parentToolCallId: z.string().optional(),
  /**
   * ⚑ **Questions the agent asked WITHOUT waiting for the answer** (provider follow-ups 1) — Codex's
   * `request_user_input_async`, which `gpt-6.1-sol` offers: an `agentMessage` with
   * `delivery: "async"` and `questions`, while the turn goes on. The `text` already carries every
   * title and option, so nothing is lost where this is not drawn; it is here so a surface can draw
   * the options as choices. ⛔ **Nothing waits on them**: no request was raised, and an answer is an
   * ordinary reply. Bounded ({@link ASKED_QUESTION_LIMITS}). Absent on every other message.
   */
  questions: z
    .array(z.object({ title: z.string(), options: z.array(z.string()).optional() }))
    .optional(),
})

/**
 * 🔒 **How much of an asked question an event carries** — the provider bounds none of it, and the
 * message's `text` keeps the whole. Past a count the rest is dropped; past a length a string is cut
 * with an ellipsis (it is a choice to show, and the text is the record).
 */
export const ASKED_QUESTION_LIMITS = {
  questions: 10,
  options: 10,
  titleChars: 2000,
  optionChars: 500,
} as const

/**
 * The agent invoked a tool. `id` correlates with the matching `tool_result`
 * (001: Claude tool_use / Codex `itemId`).
 */
/**
 * ⛔ **How long a memory target may be, on a row that exists to be READABLE** (330).
 *
 * ⚠️ **Much shorter than {@link MAX_RECALL_PATH}'s 4096, and that is a different question rather
 * than a disagreement.** That one bounds a path the MODEL wrote in prose, where the rule is *"a path
 * is DROPPED, never clipped"* because a shortened path is a wrong path. This one is DERIVED by this
 * app from a store root it attested, it is a filename inside one directory, and the untruncated
 * absolute path is on the same row's `summary` either way — so nothing is lost by bounding it and a
 * field that could carry four kilobytes into a one-line row is a field that will.
 *
 * ⚑ The provider's own memory instruction is *"write each memory to its own file (e.g.
 * `user_role.md`, `feedback_testing.md`)"*, and `NAME_MAX` is 255. This is that, with room for the
 * subdirectory a store may grow.
 */
export const MAX_MEMORY_PATH = 512

export const toolCallSchema = z.object({
  type: z.literal('tool_call'),
  /** Claude tool_use id / Codex itemId — correlates to `tool_result`. */
  id: z.string(),
  name: z.string(),
  /** Presentation only; absent on older calls, whose recorded name remains the label. */
  displayName: z.string().optional(),
  summary: z.string(),
  /** The sub-agent's dispatch tool-use id; absent for the main agent. Forwarded child calls
   * must stay on their own card instead of appearing as the parent's work. */
  parentToolCallId: z.string().optional(),
  /**
   * The id this provider accepts to list or stop the work this call started (247) — Codex states a
   * command's `processId` at `item/started`, so it is available a whole turn before any result.
   *
   * See {@link toolResultSchema}'s field of the same name for why presence is not a running claim.
   */
  backgroundId: z.string().max(MAX_BACKGROUND_ID).optional(),
  /**
   * 🔴 **This call's target, inside the profile's own memory store, relative to it** (330).
   *
   * A memory write arrives as an ordinary file-tool row. Preserve its store-relative target so a badge can identify it even when the full path's informative tail is truncated.
   *
   * ## ⚑ Where the store's location comes from — the PROVIDER, measured
   *
   * `330` §2 enumerated every key path at every depth of a real `2.1.218` session and found
   * `system/init.memory_paths.auto`: the directory the CLI's own resolver settled on, sent back on
   * every `init` frame. ⚠️ **Not our `claudeAutoMemoryDir` echoed** — the resolver takes
   * `policySettings` above the `flagSettings` this app writes, so the two can disagree and only one
   * of them is where the agent is actually writing. See `ClaudeMemoryStore`.
   *
   * ## ⚠️ What it is NOT
   *
   * ⛔ **Not a claim that the call succeeded** — it is read off the tool_use block, so a refused or
   * failed write still carries it and its `tool_result` still says `ok: false`. The row says where
   * the agent reached, which is true either way.
   *
   * ⛔ **Not derived from a `Bash` command string, ever.** `330` §3.3: grepping a shell command for
   * the store path is how a label becomes a lie. This is read only off a declared path field, by
   * `namesATarget` — the same classifier the permission layer uses — so the label and the card
   * cannot disagree about which string is the target.
   *
   * ⚑ **Not the whole path.** `summary` still carries that, untruncated, exactly as before.
   *
   * ⚠️ **Absent is the ordinary case**, and absent means *"nothing said this was in the store"* —
   * no `init` seen, no `memory_paths` on this build, a root that failed attestation, or a path
   * outside. Never *"it is not a memory"*: this app cannot say that about a provider that stopped
   * publishing where its memory lives.
   */
  memoryPath: z.string().max(MAX_MEMORY_PATH).optional(),
})

/** A tool finished. `ok` from Claude's error marker / Codex terminal status. */
export const toolResultSchema = z.object({
  type: z.literal('tool_result'),
  id: z.string(),
  summary: z.string(),
  ok: z.boolean(),
  /** The app's message receipt identity, echoed by this exact provider tool result. */
  messageAct: z.string().max(48).refine(isMessageAct).optional(),
  /** Same attribution as {@link toolCallSchema}, carried so a result can be routed without
   *  depending on its call having been seen first. */
  parentToolCallId: z.string().optional(),
  /**
   * ⛔ **This receipt is a DETACHMENT, not a completion: the work it describes is still running**
   * (247).
   *
   * ⚠️ **`ok` stays `true` and that is correct** — the provider really did succeed at detaching, and
   * rewriting it to `false` would trade one lie for another by calling a successful backgrounding a
   * failure. What was missing is not a different `ok`; it is the sentence beside it. Measured live,
   * `245`'s window reproduced from the reachable path: BroBot settled the card at **6 102 ms** with
   * `ok:true` and the text *"Command running in background with ID: b23pvshmy…"*, and the command
   * ran until **36 150 ms**. Nothing in the transcript changed in between.
   *
   * ⚑ **Read this, not the summary text.** The receipt's wording is the provider's and has already
   * changed shape once across pins; this flag is derived from the level set, which is a fact.
   *
   * Absent means "not backgrounded, as far as the provider has said" — the ordinary case.
   */
  backgrounded: z.boolean().optional(),
  /**
   * The id this provider accepts to LIST or STOP the work this tool started (247) — Claude's
   * `task_id`, Codex's `processId`.
   *
   * ⚠️ **Its presence is not a claim that the work is backgrounded**; {@link backgrounded} is. Codex
   * puts a `processId` on every PTY-backed command it runs, foreground included, and reporting that
   * as "still running" would be the false-settled card's mirror image. It is here so a stop control
   * has something to call without re-deriving the binding from a registry payload the SDK's own doc
   * says not to correlate with this stream.
   */
  backgroundId: z.string().max(MAX_BACKGROUND_ID).optional(),
  /**
   * ⚑ **How long the tool itself took, as the PROVIDER measured it** (327) — milliseconds.
   *
   * ⛔ **Not the same measurement as the duration the row can already derive**, which is the gap
   * between two `RuntimeHost` delivery stamps and therefore includes transport and the host's own
   * pump. In the one capture carrying both, the envelopes were 7 ms apart and the item's own
   * `durationMs` was 4. A surface that has this should prefer it and show ONE duration, never two.
   *
   * ⚠️ **`0` is a value, not an absence.** A tool that failed instantly reported exactly that.
   *
   * ⛔ **Absent for a DETACHED call, by construction**: the work is still running, so no duration for
   * it exists yet — `248`'s rule that the receipt's timing must never be printed as the work's.
   *
   * Only Codex's `mcpToolCall` sets it today. Claude's SDK reports no per-tool duration at all, so
   * absence here means "this provider did not say", never "it was instantaneous".
   */
  durationMs: z.number().finite().nonnegative().optional(),
})

/**
 * The model's own reasoning, promoted out of `unknown{category:'reasoning'}` (027, designed in 026).
 *
 * **The text is usually not ours to show, and this shape says so rather than pretending.** Captured
 * live from both providers:
 *  - **Claude** reports a token ESTIMATE and never the words. Every `thinking_delta` observed
 *    carried `thinking:""` (20 of 20), and enabling `Options.thinking` yields a block that is empty
 *    but signed. So Claude populates {@link tokens} and sets {@link redacted}; `text` stays absent.
 *  - **Codex** delivers a SUMMARY — but only when the turn asks for one. By default its `reasoning`
 *    items arrive `{summary:[],content:[]}`; with `TurnStartParams.summary` set,
 *    `item/reasoning/summaryTextDelta` streams real text. `content` is never delivered, so what we
 *    show is a summary of the reasoning, never the raw chain of thought.
 *
 * `text` absent + `redacted:true` therefore means "it thought, and we cannot show you what" — which
 * is a different fact from "it did not think", and the UI must not collapse them.
 */
export const thinkingEventSchema = z.object({
  type: z.literal('thinking'),
  /** `delta` while it accumulates; `complete` when the block is closed. */
  phase: z.enum(['delta', 'complete']),
  /** The reasoning text, when the provider actually supplies words. Absent is normal. */
  text: z.string().optional(),
  /** True when reasoning happened but its text was withheld — never inferred from silence. */
  redacted: z.boolean().optional(),
  /** Reasoning tokens, as the provider counts them. Claude's is an estimate. */
  tokens: z.number().optional(),
})

/**
 * What the agent is doing RIGHT NOW — the live indicator (027). One pill, replaced as the phase
 * changes, cleared by the `turn` event; it is a statement about the present, never a log line.
 * ⚑ **And a `compaction` event ENDS a `compacting` phase — that phase only** (`717`): the row is the
 * compaction over, and Codex says nothing else between its item opening and closing. Both folds that
 * read this stream apply it (`transcript.ts`, `being-done.ts`).
 *
 * ⚑ **`compacting` comes from BOTH providers, each from its own words for a compaction under way.**
 * Claude sends `{"type":"system","subtype":"status","status":"compacting"}` while it compacts (097,
 * correcting this comment's own earlier claim that the phase *"was NEVER observed in capture"*).
 * Codex opens its `contextCompaction` item as the compaction starts — `item/started` came 140 ms
 * before `item/completed`, with Codex's summary request between them (`713`,
 * `probe:codex-command-as-typed`, arm `compact-person`) — and since `717` that `started` phase raises
 * it. ⛔ Nothing fabricates a pill from a boundary already crossed: Codex's `thread/compacted` and the
 * item's `completed` phase are past tense, and each draws only the `compaction` row. (This said
 * *"CLAUDE-ONLY"* until `717`, and *"both past tense"* until `713`.)
 *
 * Neither this nor {@link thinkingEventSchema} carries a turn id, deliberately. Staleness is an
 * ADAPTER concern and is settled before normalization: Codex drops any turn-scoped notification
 * whose `turnId` is not the bound one, and Claude's SDK yields one turn at a time. A `turnId` here
 * would be a field no adapter sets and no consumer reads — an invitation to correlate on `undefined`.
 */
export const activityEventSchema = z.object({
  type: z.literal('activity'),
  phase: z.enum(['thinking', 'tool', 'waiting', 'compacting']),
  /** A short human-readable qualifier (a tool name, say). Optional by design. */
  detail: z.string().optional(),
})

/**
 * **An image the agent produced — as a FILE, never as bytes** (067).
 *
 * The provider hands us the image twice: once as a ~2 MB base64 `result` inside the event, and once
 * as a real PNG it has already written to disk under its own home. This event carries the second
 * one. Nothing here is large, so nothing here is bounded, discarded, or copied through IPC — which
 * is the entire reason images can be displayed at all without touching 052's ceiling.
 *
 * Before this existed the whole item was an `unknown{raw}` whose payload was 45× the ceiling, so
 * {@link boundRaw} replaced it with a marker — and the marker took the small useful fields down
 * with the big useless one. The path was in there all along.
 *
 * ⚠️ **`path` is a fact about the filesystem, not a claim from the provider.** The adapter checks
 * the provider's claim (absolute, a regular file, an image type, by real path) or looks the file up
 * under the provider's own home by the item's id, and sets it only when the file exists. **It is
 * absent when no file was found**, which is a real and expected state rather than an error: Codex's
 * own image-generation skill instructs the model to *move or copy* the file into the workspace for
 * project work, so an image can legitimately no longer be where it was made. A consumer that finds
 * no `path` should say the image is not there — never invent one.
 */
export const imageEventSchema = z.object({
  type: z.literal('image'),
  /** The provider's own id for the item. Codex names the file after it. */
  imageId: z.string(),
  /**
   * Absolute path to the image on disk, **resolved and checked by the adapter**. Absent when the
   * file could not be found where the provider said it was — see the ⚠️ above.
   */
  path: z.string().optional(),
  /**
   * The prompt the image was actually generated from — the provider's revision of what was asked,
   * not the user's words. Hundreds of bytes, and the only description of the picture there is, so
   * it is what a caption and an `alt` are written from.
   *
   * ⚠️ **Capped in the SCHEMA as well as at the adapter** (067, from its review). The Codex adapter
   * already truncates this to 200 characters, but that only guards the LIVE path: an event arriving
   * from an imported bundle is appended to the ledger without passing through any adapter, so a
   * corrupt or hostile bundle could carry a megabyte here and have it cloned across IPC for the life
   * of the session. The cap is generous — 20× what the adapter emits — so it can only ever reject
   * something no adapter produced, and rejecting degrades the event to `unknown{raw}`, where 052's
   * ceiling catches it. The safety net that already exists, reached on purpose.
   */
  prompt: z.string().max(4096).optional(),
})

/**
 * One line of the agent's checklist. Three statuses, because that is what both providers actually
 * distinguish — Codex's `pending|inProgress|completed` and Claude's `pending|in_progress|completed`
 * map onto these one-for-one.
 *
 * Claude has a FOURTH, `deleted`, which is deliberately not here: a deleted task is REMOVED from
 * {@link planUpdateEventSchema}'s `steps`, because "deleted" and "done" are opposite facts and
 * rendering one as the other would be a lie the user cannot detect.
 */
const planStepSchema = z.object({
  text: z.string(),
  status: z.enum(['pending', 'active', 'done']),
})

export type PlanStep = z.infer<typeof planStepSchema>

/**
 * The agent's working checklist — the thing that makes a long task legible (028, designed in 026).
 *
 * **`steps` REPLACES the list; it never appends.** Both providers state the complete list at this
 * boundary even though only one of them is wholesale on the wire, and absorbing that difference is
 * the adapters' job rather than every consumer's:
 *  - **Codex** sends the whole plan on every `turn/plan/updated` — captured live as
 *    `[inProgress, pending, pending]` then `[completed, completed, completed]` — so it maps across
 *    unchanged.
 *  - **Claude** is INCREMENTAL: its todo tools add one task (`TaskCreate`) or change one
 *    (`TaskUpdate`) at a time, so the Claude adapter keeps the running list itself and restates it
 *    in full here. Emitting the increment instead would make the checklist flicker down to a single
 *    row on every change.
 *
 * `note` is Codex's `explanation` — a sentence ABOUT the plan, never a step in it. Observed `null`
 * while the plan is being worked and populated when it completes.
 *
 * `body` is a plan DOCUMENT and is unpopulated today: 030 (plan mode) fills it from `ExitPlanMode`.
 * It ships now so the variant does not change shape under already-persisted rows later.
 *
 * `supersedes` names the `tool_call` ids this event ABSORBED — Claude's todo tool calls, which
 * would otherwise show up twice, once as ordinary tool rows and once as the checklist they built.
 * Each event carries only the ids it absorbed itself, not every id so far: superseding is permanent
 * once applied, so the accumulated effect is identical and the payload stays O(1) per event instead
 * of growing with the length of the session. Absent for Codex, whose plan is a notification and not
 * a tool call at all — the asymmetry lives in the data, so no consumer has to branch on provider.
 *
 * No `turnId`, for the reason {@link activityEventSchema} gives at length: staleness is an ADAPTER
 * concern, settled before normalization.
 */
export const planUpdateEventSchema = z.object({
  type: z.literal('plan_update'),
  steps: z.array(planStepSchema),
  note: z.string().optional(),
  body: z.string().optional(),
  supersedes: z.array(z.string()).optional(),
})

/**
 * The agent dispatched an agent of its OWN (029, designed in 026) — one card per sub-agent, from
 * `started` through `progress` to `ended`.
 *
 * **BOTH providers dispatch sub-agents, and 029's claim that only Claude does was false** (033).
 * 029 read one Codex capture that happened to spawn nothing, concluded `collabAgentToolCall` and
 * `subAgentActivity` "never fire", and wrote that they are gated behind `effort:'ultra'`. Neither
 * half survived contact: a session at the ordinary default (`effort: medium`, `gpt-5.6-sol`) spawned
 * three agents and reported every one of them, and three more sessions since have done the same.
 * **Absence in a capture is not absence in the provider** — the reason this paragraph now names the
 * evidence rather than the inference.
 *
 * The two providers report the same fact through different channels, and absorbing that is the
 * adapters' job rather than every consumer's:
 *  - **Claude** reports richly and in one stream (`system/task_started|task_progress|task_updated|
 *    task_notification`), carrying parentage, usage and the child's final answer.
 *  - **Codex** reports the BIRTH on the parent's item stream (a `subAgentActivity` item) and
 *    everything after it under the CHILD's own thread id — its status, its token usage, its tool
 *    items and its `turn/completed`. ⚠️ **That sentence used to end "It sends no usage… and no
 *    answer"; 226 measured all of it on the wire.** What is still true is the parentage: the call it
 *    carries is one no tool row in this app has ever borne. The child's ANSWER is on the connection
 *    too and is deliberately not forwarded — there is no card body to own it (128).
 *
 * `agentId` is the identity, and every phase carries it — that is what the fold correlates on. It is
 * Claude's `task_id` and Codex's `agentThreadId`; that the second is also a real thread the app
 * could one day read is a fact about Codex, not a second meaning for this field.
 *
 * `parentToolCallId` is the tool-use that dispatched it, and is what NESTS the card under the right
 * tool row. It is optional because `task_updated` genuinely does not carry it. Codex's is a subtler
 * case worth stating: it names the collab call that spawned the child, and NO ROW with that id has
 * ever been rendered, so its cards sit top-level — which is not a fallback but the same place-once
 * rule doing its job, since the fold adopts an orphan the moment a matching row appears. Correlating
 * on `agentId` is what lets a card exist perfectly well before, or without, either of those.
 *
 * `outcome` is only ever set from a status the provider actually reported and this adapter
 * recognizes. A sub-agent whose turn ends without one is shown as ended WITHOUT an outcome, because
 * "we were not told how it went" is a different fact from "it succeeded". ⚠️ **It used to be the
 * whole of Codex's ending; since 226 it is not** — a child going idle still says only that it
 * stopped, and its own `turn/completed` one frame later says which of these three words applies.
 * The absence stays reachable: a child cut off with its parent never completes a turn. `interrupted` is a
 * third real answer rather than a shade of the other two: rounding it to `failed` accuses a
 * sub-agent that was stopped from outside, and dropping it to no outcome claims we were never told.
 *
 * No `turnId` — 027's precedent, for the third time; staleness is settled in the adapter.
 */
export const subAgentEventSchema = z.object({
  type: z.literal('sub_agent'),
  /** Claude's `task_id`, Codex's `agentThreadId`. Stable across every phase — the correlation key. */
  agentId: z.string(),
  /**
   * **What kind of thing `agentId` IS** (111) — because the two providers hand back different kinds
   * of identifier and the card was calling both "agent".
   *
   * - `task` — Claude's `task_id`: a dispatch inside the parent's own process. There is nothing to
   *   open; it names work, not a conversation.
   * - `thread` — Codex's `agentThreadId`: a **real thread**, with its own rollout file on disk. That
   *   is why `109` could read a child's complete transcript that this app never opens.
   *
   * ⚠️ **On the wire rather than derived in the renderer, and that is 039's rule doing its job.**
   * The dispatch asked for wording that names the provider — *"Claude child ID"* versus *"Codex
   * child thread"* — and `provider-neutrality.test.ts` refuses a renderer that recognises a
   * provider, correctly: the surface would be deciding a capability from a brand. The fact that
   * genuinely differs is the KIND of identifier, which is a wire fact each adapter already knows.
   * Optional, because a persisted event written before this existed does not carry one and must
   * still validate.
   */
  idKind: z.enum(['task', 'thread']).optional(),
  phase: z.enum(['started', 'progress', 'ended']),
  /** The dispatch tool-use id, for nesting. Optional because `task_updated` omits it. Codex always
   *  carries one — no ROW has ever borne that id, so the card stays top-level until one does. */
  parentToolCallId: z.string().optional(),
  /** What kind of agent: Claude's `subagent_type` (`general-purpose`, `Explore`, …), or Codex's
   *  `agentPath` — a name the model coined for this one child (`workspace_mapper`). */
  kind: z.string().optional(),
  /**
   * **How this agent became known** (135) — `announced`, its dispatcher told us about it, or
   * `observed`, nothing did and we know it exists only because its own thread reported status.
   *
   * ⚠️ **It was introduced for the GRANDCHILD, and 226 measured that a grandchild is not one.** 135
   * read two ROLLOUT FILES — the root's for `sess_d5c8c9ca` names the grandchild thread zero times,
   * the child's carries its `sub_agent_activity{kind:'started'}` — and concluded the announcement
   * never reaches this app. On the socket it does: the depth-2 birth arrives stamped with the
   * depth-1 child's `threadId`, carrying `agentPath: '/root/coordinator/gamma'` and its dispatching
   * call, and the adapter's own thread gate was discarding it. A descendant is `announced` now.
   *
   * ⛔ **So this stays for the case that is still real: a working thread nothing announced at all.**
   * `observed` is not a lesser `announced` — it names a card whose PARENT IS UNKNOWN and must be
   * rendered as such. 111's rule, which is `086`/`104`'s: an honest blank beats a fabricated one,
   * and inventing a parent would put an agent under a conversation it never belonged to, as it
   * would for the 3 of 815 real children whose provider records no parent id.
   *
   * ⚠️ **It also decides what may be READ, not only what is drawn** (226). A card opened on nothing
   * but "that thread went active" gets its status and nothing else: no tokens, no tool count, no
   * outcome, and no announcement of a child of its own. See `CodexSubAgents.report`.
   *
   * Absent means NOT STATED, which is the ordinary case and reads as today. Only an explicit
   * `observed` changes what the card says, so an event persisted before this existed — and Claude's
   * `task_updated`, which omits the dispatch id for its own reasons — cannot be mistaken for one.
   */
  origin: z.enum(['announced', 'observed']).optional(),
  /** The dispatch's `description`: what this sub-agent was asked to do. */
  title: z.string().optional(),
  /** The tool it most recently ran, while it works. */
  lastTool: z.string().optional(),
  usage: z
    .object({
      tokens: z.number().optional(),
      toolCalls: z.number().optional(),
      ms: z.number().optional(),
    })
    .optional(),
  outcome: z.enum(['completed', 'failed', 'interrupted']).optional(),
  /** What it reported back. Claude sends the child's whole answer here. */
  summary: z.string().optional(),
})

/**
 * **How full the model's context window is** (087, designed in 086) — the live gauge's one input.
 *
 * ⚠️ **`reading` is a discriminated union because the alternative is a fabricated denominator.**
 * The two providers do not report the same shape, and neither of them reports the shape 086 expected
 * — measured on 198 real `thread/tokenUsage/updated` payloads and 227 real Claude usage frames in
 * this machine's own database:
 *  - **Codex** sends `modelContextWindow` on every reading (never `null` in 198 of 198, two distinct
 *    values), so it is `proportional` and a percentage is a fact.
 *  - **Claude** sends token counts on `message_start`/`message_delta` and **never a window** — the
 *    string `contextWindow` appears in zero Claude payloads. So it is `tokens`, and there is nothing
 *    to divide by.
 *
 * With `kind` on the wire, a `tokens` reading has **no `window` field to read**: computing a
 * percentage from one is not a rule a reviewer has to enforce, it is a type error. That is the whole
 * reason this is not `{used, window?}` with a helper.
 *
 * ⚠️ **`window` is `.positive()`, not `.nonnegative()`.** A zero would divide, and `used/0` is
 * `Infinity` — a number, rendered, wrong. A persisted or imported event carrying one is REJECTED by
 * this schema and degrades to `unknown{raw}` (the same safety net {@link imageEventSchema}'s `prompt`
 * cap reaches), which is loud and lossless rather than a gauge reading ∞%.
 *
 * `source` is the provider's own signal name — `thread/tokenUsage/updated`, `message_start`. It is
 * what the meter's unit line shows, so a reader can see WHICH wire fact they are looking at rather
 * than a claim we made about it. Opaque here, exactly as `unknown.label` is (072).
 */
export const contextReadingSchema = z.object({
  type: z.literal('context_reading'),
  reading: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tokens'), used: z.number().finite().nonnegative() }),
    z.object({
      kind: z.literal('proportional'),
      used: z.number().finite().nonnegative(),
      window: z.number().finite().positive(),
    }),
  ]),
  source: z.string().max(120),
})

/**
 * **Context was dropped** — the one fact about a compaction worth keeping (087, designed in 086).
 *
 * A compaction is not chatter and it is not attention: it is the moment earlier turns stopped being
 * in the model's head, and a reader who cannot see it cannot explain why the agent forgot something.
 * So it is a first-class event and a durable transcript row, never filtered by the lifecycle toggle.
 *
 * ⚠️ **Every magnitude is optional because one provider reports none at all.** Codex's
 * `contextCompaction` item is `{id}` and its `thread/compacted` notification is `{threadId, turnId}`
 * — verified in the generated protocol and in four real events on this machine. Claude's
 * `compact_boundary` carries `compact_metadata.pre_tokens` (always) and `post_tokens` (optional).
 * A row with no numbers says a compaction happened and stops there; the alternative is a plausible
 * number nobody can check, which is the failure this whole task exists to avoid.
 *
 * `compactionId` is the provider's own id, and it is the DEDUP key rather than decoration: Codex
 * reports its item TWICE (`item/started` then `item/completed`) — both observed, same id — so
 * without it one compaction draws two boundaries and the history tally counts two.
 */
export const compactionEventSchema = z.object({
  type: z.literal('compaction'),
  compactionId: z.string().max(200).optional(),
  /** The sub-agent call whose own context was compacted; absent for the conversation's own. */
  parentToolCallId: z.string().optional(),
  /** Tokens in context BEFORE, when the provider said. Claude's `pre_tokens`. */
  before: z.number().finite().nonnegative().optional(),
  /** Tokens in context AFTER, when the provider said. Claude's `post_tokens`, itself optional. */
  after: z.number().finite().nonnegative().optional(),
  /**
   * Whether a human asked for it. Claude reports this; Codex does not — ⚑ except for a compaction
   * BroBot itself asked Codex for (713, `R59`), which its adapter marks `manual` because it made the
   * request.
   */
  trigger: z.enum(['manual', 'auto']).optional(),
  /** The provider's own signal name — `compact_boundary`, `contextCompaction`. */
  source: z.string().max(120),
})

/**
 * **The agent changed files** (096, designed in 092) — the answer to *"what did this conversation do
 * to my working tree?"*, which the app could not give at all before this.
 *
 * One event per report, carrying every file that report named. It is a REPLACEMENT, not a delta:
 * Codex sends a full snapshot of the turn's diff three to five times as the turn runs (measured,
 * byte-identical), so the fold keeps the latest record per path and never accumulates duplicates.
 *
 * ⚠️ **`changes` may legitimately be empty while the event still means something.** That is the
 * `underDisclosed` case — a file change we know happened and were not told the contents of. The pane
 * draws it as a faceless row and, emphatically, does not invent a path or a count for it. An event
 * with no changes and no `underDisclosed` flag is not emitted at all.
 *
 * ⚠️ **`dropped` exists so a cap can never be silent** (092 §4). If a report names more files than
 * {@link MAX_CHANGED_FILES}, the surplus rows are counted here and the pane says so out loud. The
 * alternative — a truncated list that looks complete — is the failure this project keeps finding.
 *
 * `source` is the provider's own signal name, opaque here exactly as `unknown.label` is:
 * `turn/diff/updated` for Codex, the tool name for Claude. It is what lets a reader see WHICH wire
 * fact a row came from, and it is why the pane can label an asymmetry instead of faking a common
 * unit — the two providers do not report the same thing and the surface says so.
 */
export const fileChangeEventSchema = z.object({
  type: z.literal('file_change'),
  changes: z.array(
    z.object({
      path: z.string().max(4096),
      status: z.enum(['added', 'modified', 'deleted', 'renamed', 'touched']),
      oldPath: z.string().max(4096).optional(),
      added: z.number().int().nonnegative().optional(),
      removed: z.number().int().nonnegative().optional(),
      // ⚠️ **Bytes, not `.max()`** (review). `z.string().max(n)` counts UTF-16 code units, and the
      // bound it is enforcing is named — and documented — in BYTES. For ASCII they agree, which is
      // why nothing live was affected; for CJK they differ by three, so an IMPORTED bundle could
      // carry a 32,768-character diff weighing 98,304 bytes straight past the only gate on that
      // path. 052 added this class of bound precisely to stop an oversized payload crossing IPC.
      diff: z
        .string()
        .refine((text) => Buffer.byteLength(text, 'utf8') <= MAX_FILE_DIFF_BYTES, {
          message: `diff exceeds ${MAX_FILE_DIFF_BYTES} bytes`,
        })
        .optional(),
      oversize: z.boolean().optional(),
      crowdedOut: z.boolean().optional(),
    }),
  ),
  /** True when a change is known to have happened and the provider did not say which files. */
  underDisclosed: z.boolean().optional(),
  /** Files the report named beyond the cap. Absent or 0 normally. */
  dropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})
