import { LINK_TARGET_LIMIT } from '../../shared/link-resolution'
import { z } from 'zod'
import { workSearchQuery } from '../../shared/work-search'
import { filesLibraryRequest } from '../../shared/files-library'
import { teamProfileGraphRequest } from '../../shared/team-profile-graph'
import {
  MAX_BACKGROUND_ID,
  permissionDecisionSchema,
  userInputResponseSchema,
} from '@brobot2/runtime'
import { providerSchema } from '@brobot2/shared'
import {
  PATH_SEGMENT_RULE,
  MAX_MESSAGE_PATH_LENGTH,
  MAX_MESSAGE_PATHS,
  LIBRARY_ARCHIVED,
  LIBRARY_KINDS,
  LIBRARY_ORIGINS,
  LIBRARY_QUERY_MAX,
  MAX_PATH_CHARS,
  isPathSegment,
} from '../../shared/runtime-ipc'
import { REPLY_SUMMARY_LIMIT } from './reply-rails'
import {
  sessionId,
  requestId,
  messageId,
  profileId,
  readingBody,
  launchKey,
  sendShaped,
  goAheadText,
  childMessage,
} from './ipc-input'

/**
 * The first half of {@link runtimeCommandSchema}: the commands about one conversation — opening,
 * sending, answering, controlling, listing and reading it. Split out of `ipc.ts` (card 73) so
 * neither half of the union passes the file-size limit; every arm is unchanged and in order.
 */
export const conversationCommands = [
  z.object({
    kind: z.literal('createSession'),
    provider: providerSchema,
    /** Absent/blank means the durable BroBot workspace. */
    cwd: z.string().optional(),
    /**
     * Approval mode (078). Validated as an exact enum: anything else fails the wire schema rather
     * than being coerced, and an omitted value resolves to the prompting default downstream.
     */
    approvalMode: z.enum(['ask', 'auto']).optional(),
    /**
     * The profile whose home to run in (085). Checked against the SAME pattern the path
     * derivation uses, so `../…` is a rejected command rather than a path that walks out of
     * the managed root. Rejecting here means nothing is provisioned before the id is known good.
     *
     * ⚠️ **The shared `profileId` above, not a second copy of it** (169 §1). It was written out
     * again here, identically, and 169's whole first section is about what happens when one rule is
     * spelled in two places: the launcher now refuses a name BEFORE the press, and what it must
     * agree with is this — `profile-name-rule.test.ts` drives one corpus through both ends.
     */
    profileId,
    /**
     * Reasoning effort (024), **no longer an enum** (076).
     *
     * It was `z.enum(['low','medium','high'])` on the argument that those three were "a ladder both
     * providers share and we can enumerate honestly". The measurement says otherwise: Claude's own
     * union has five members and Codex's `ReasoningEffort` is an open string whose accepted set is
     * answered PER MODEL by `model/list`. So the enum was not a validation, it was a shorter menu —
     * it is the line that made `xhigh`, `max` and `ultra` unreachable from this app.
     *
     * ⚠️ **The shape check stays and matters more than before.** This schema STRIPS unknown keys, so
     * the field must be declared or it is silently dropped; and the value becomes a provider
     * argument, so it is bounded and non-blank. What it is NOT is a membership test — that belongs
     * to the adapter, which knows the provider's vocabulary and refuses by name. Exactly the reason
     * the model beside it has never been an enum.
     */
    reasoningEffort: z.string().min(1).max(60).optional(),
    /**
     * Which model (038). Bounded and non-blank rather than a membership test — model ids are the
     * providers' own vocabulary and are added and retired without us, so a fixed list here would
     * reject a model that works. The value crosses a process boundary and becomes a provider
     * argument, so it is checked for shape.
     */
    model: z.string().min(1).max(120).optional(),
    /** Plan mode (030). A plain boolean: unlike the model it has no vocabulary to get wrong. */
    planMode: z.boolean().optional(),
    /**
     * The provider's maximum-effort orchestration mode (106) — Claude's `ultracode`.
     *
     * A boolean here and not a `reasoningEffort` value, which is the whole point: it is a separate
     * `Settings` field in the pinned SDK, so routing it through the effort string would put a value
     * on the wire that `EffortLevel` rejects. Same shape as `planMode` and for the same reason —
     * there is no vocabulary to get wrong, so `z.boolean()` is the entire validation.
     *
     * ⚠️ Launch only. There is no `setSessionSetting` body for it, deliberately: it is
     * session-scoped, the provider never confirms it, and a mid-session control would report a
     * success it could not verify.
     */
    ultracode: z.boolean().optional(),
    /** What this window calls this launch, so it can cancel it before the id exists (102). */
    launchKey: launchKey.optional(),
    /**
     * 🔴 **716 · `710` F-7 — answer a refusal rather than throw it**, with its word
     * (`RefusedLaunch`). Only `true` or absent: absent is every caller before `716`, rejected as it
     * always was.
     */
    answerARefusal: z.literal(true).optional(),
  }),
  sendShaped('send'),
  // The same shape as a send, because it IS one — only sooner or later (077). All three (four with
  // `startAndSend`, 735) are built
  // by {@link sendShaped}, so the rule cannot hold on one verb and not the others: that is exactly
  // how `220` came to measure `send` failing while `sendInterrupting` and `queueMessage` sat
  // unmeasured with the identical line.
  sendShaped('sendInterrupting'),
  sendShaped('queueMessage'),
  // 🔴 **735 · `701` F-8 — a first message and the start it causes, in one act.** ⚑ A send's shape
  // and a send's rule, from {@link sendShaped}, because it IS a send — plus the name for the wait
  // its start needs ({@link launchKey}, as `resume` carries one), so the pane's Cancel reaches it.
  // ⚠️ `safeExtend`, which keeps the factory's refinement: `extend` refuses a refined object.
  sendShaped('startAndSend').safeExtend({ launchKey: launchKey.optional() }),
  // ⛔ **`messageId` is REQUIRED, so an older shape is REFUSED rather than stripped** (354). This
  // schema drops unknown keys, which is the hazard `303` B measured from the other side — eight keys
  // arrived, seven parsed, and the failure looked exactly like a slow provider. A cancel that named
  // no message used to take back whatever was held at the instant it landed; a command that still
  // names none now fails the parse and comes back as a sentence, rather than cancelling something
  // nobody pointed at.
  z.object({ kind: z.literal('cancelQueuedMessage'), sessionId, messageId }),
  z.object({ kind: z.literal('takeBackAndStop'), sessionId, messageId }),
  z.object({
    kind: z.literal('respondPermission'),
    sessionId,
    requestId,
    decision: permissionDecisionSchema,
  }),
  z.object({ kind: z.literal('resolveLink'), target: z.string().max(LINK_TARGET_LIMIT) }),
  z.object({
    kind: z.literal('decideMoveRequest'),
    sessionId,
    requestId,
    decision: z.enum(['move', 'here']),
  }),
  z.object({
    kind: z.literal('respondUserInput'),
    sessionId,
    requestId,
    response: userInputResponseSchema,
  }),
  // A person's answer to a to-do: the request, done or not, and a note of a status line's length.
  z.object({
    kind: z.literal('answerAction'),
    sessionId,
    request: requestId,
    done: z.boolean(),
    note: z.string().max(REPLY_SUMMARY_LIMIT).optional(),
  }),
  z.object({ kind: z.literal('interrupt'), sessionId }),
  // ⚠️ The id is the PROVIDER's own stop key, so it is bounded and never interpreted here — with the
  // SAME constant the event that carries it declares, rather than a fourth copy of the number: a
  // command whose bound disagreed with the event's would reject exactly the ids we published.
  z.object({
    kind: z.literal('stopBackgroundWork'),
    sessionId,
    id: z.string().min(1).max(MAX_BACKGROUND_ID),
  }),
  z.object({ kind: z.literal('close'), sessionId }),
  z.object({ kind: z.literal('refreshConfig'), sessionId }),
  z.object({ kind: z.literal('compact'), sessionId }),
  // Exact-match opt-in at the CONTRACT boundary too (078/034): the enum admits nothing else, so a
  // malformed value crossing IPC is a rejected command rather than a coerced guess in either
  // direction — and there is no `.optional()` here, because "change it to nothing" is not a request.
  z.object({ kind: z.literal('setApprovalMode'), sessionId, mode: z.enum(['ask', 'auto']) }),
  // The go-ahead (060). `text` is held to the same rule as the send-shaped verbs above — see
  // {@link goAheadText} for why it was not, and what changed.
  z.object({ kind: z.literal('endPlanMode'), sessionId, text: goAheadText }),
  // Changing a setting mid-conversation (076). One command with a discriminated body rather than
  // three, so the three cannot drift apart at the boundary.
  //
  // ⚠️ **`value` is `.optional()` and that is the REQUEST "back to the provider's own default", not
  // a missing field.** For model and effort the host names that default before anything is sent
  // (D-042 · R1, `SetSessionSettingInput`), and a schema demanding a string would make undoing a
  // choice impossible. The same bounds as at creation, because it is the same value going to the
  // same place.
  z.object({
    kind: z.literal('setSessionSetting'),
    sessionId,
    body: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('model'), value: z.string().min(1).max(120).optional() }),
      z.object({ kind: z.literal('reasoningEffort'), value: z.string().min(1).max(60).optional() }),
      // Only `true` is accepted: turning plan mode OFF is the go-ahead and has its own command,
      // which sends a message with it. `z.literal(true)` makes that a REJECTED command at the
      // boundary rather than a host-side throw — the 076 ruling, enforced where it cannot be
      // forgotten.
      z.object({ kind: z.literal('planMode'), on: z.literal(true) }),
    ]),
  }),
  z.object({ kind: z.literal('listResumable') }),
  z.object({ kind: z.literal('listUnresumable') }),
  z.object({ kind: z.literal('adoptSessions') }),
  z.object({
    kind: z.literal('exportSession'),
    /**
     * A bundle is written as `<sessionId>.brobot-session.json`, so this id becomes a FILENAME.
     * Today a bad one is stopped by the row lookup failing first, but that is an accident of
     * ordering rather than a rule — and `profileId` in this same schema already states its rule.
     */
    sessionId: z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`),
    /**
     * 🔴 **633 · a THIRD kind, and the one whose BODY the renderer supplies.**
     *
     * ⛔ **`readingBody` belongs to `reading` and to no other kind**, and that pairing is enforced
     * ONCE, in {@link RuntimeHost.exportSession}, rather than here. ⚠️ **Not a preference**: this
     * schema is a `z.discriminatedUnion('kind', …)`, whose members must be plain objects — a
     * `.refine()` would make this member a `ZodEffects` and a second member spelling
     * `kind: 'exportSession'` cannot be told apart by the discriminator at all. ⚑ `RuntimeCommand`'s
     * own note records both, so the next reader does not rediscover them.
     *
     * ⛔ **The BOUND is here and it is where it bites**: `readingBody` is the largest thing this
     * app puts on the wire, and {@link MAX_READING_BYTES} is the shared constant the writer holds
     * too.
     */
    exportKind: z.enum(['native', 'bundle', 'reading']),
    readingBody: readingBody.optional(),
  }),
  z.object({
    kind: z.literal('importBundleFile'),
    /**
     * ⛔ **A path the renderer supplies, checked in main — the same posture `createSession`'s `cwd`
     * has had since 076 §3** (214 §1).
     *
     * A picker is offered (`app:choose-bundle`) and it is not the only way in: the folder field
     * beside it is typed as often as it is picked, and a bundle that arrives by email needs a path
     * a person can paste. So this is bounded and non-blank here, and everything that decides whether
     * it may be READ lives in `readBundleFile`, which answers with a sentence rather than a throw.
     *
     * ⚠️ **Deliberately NOT `isPathSegment`.** This is a whole path, not a filename — the rule the
     * `exportSession` id above holds is for a string that BECOMES a filename, which is the opposite
     * direction. {@link MAX_PATH_CHARS} is `PATH_MAX` on macOS with room to spare — the shared
     * constant since 221 §3, so the field that carries this bound cannot hold a different one.
     */
    path: z.string().min(1).max(MAX_PATH_CHARS),
  }),
  z.object({ kind: z.literal('resume'), sessionId, launchKey: launchKey.optional() }),
  // ⚑ **D-017b** · draw one conversation in this window and start nothing. ⚠️ Who is looking comes
  // from the channel, as the claim's owner does; `claim` is only whether a person pressed.
  z.object({ kind: z.literal('look'), sessionId, claim: z.boolean().optional() }),
  // ⚑ The window that stops looking comes from the channel, as the one that looks does.
  z.object({ kind: z.literal('stopLooking'), sessionId }),
  // Optional on the launches, required here: a cancel with nothing to name is a cancel of whatever
  // happens to be starting, and this window may have two.
  z.object({ kind: z.literal('cancelLaunch'), launchKey }),
  // No parameters at all (100), like `capabilities` below: the renderer does not get
  // to ask about one session, because asking about one means naming one — and a store that has just
  // been built knows no names. The host answers with everything it holds for THIS sink.
  z.object({ kind: z.literal('attachOpen') }),
  // 336. ⚠️ The id is the only parameter, and the OWNER is not one: who is claiming comes from the
  // channel the ask arrived on, never from the payload — the same rule `cancelLaunch` states.
  z.object({ kind: z.literal('claim'), sessionId }),
  // 523. ⚑ The same one parameter, and the owner is not one here either: who is handing the
  // conversation back comes from the channel the ask arrived on. ⚠️ The shorthand reuses the
  // hoisted `sessionId` bound above, so this row adds no field to the wire's string census.
  z.object({ kind: z.literal('release'), sessionId }),
  // 398 · no fields, so nothing to validate beyond the discriminant — which is also why the bridge
  // census answers `nothing` for it rather than `plain-by-construction`.
  z.object({ kind: z.literal('questionsForAPerson') }),
  // 403 · no fields either, and the same census answer. ⚑ Two verbs rather than one with a
  // selector, because the two populations carry two different guarantees — see the union member.
  z.object({ kind: z.literal('decisionsForAPerson') }),
  z.object({ kind: z.literal('limitsForAPerson') }),
  z.object({ kind: z.literal('readLimitsDisplay') }),
  // ⚑ **D-017 · R19** — no fields, and the same census answer as its siblings.
  z.object({ kind: z.literal('instructionAsksForAPerson') }),
  // No fields, and the same census answer as its siblings.
  z.object({ kind: z.literal('mcpServerRequestsForAPerson') }),
  // 557 · no fields either, and the same census answer. ⚑ Its own verb rather than a selector on
  // any of the above: a stall is not a request and writes no `request_routed` row — see the union
  // member, and `555` §3.1 for the hole it closes.
  z.object({ kind: z.literal('stalledWorkForAPerson') }),
  // Work whose holder stopped with it: no fields, as its neighbour.
  z.object({ kind: z.literal('stoppedWorkForAPerson') }),
  // This run's publisher, and the person's queue as one publication: no fields, as their neighbours.
  z.object({ kind: z.literal('currentEpoch') }),
  z.object({ kind: z.literal('personsQueue') }),
  z.object({ kind: z.literal('listConversations') }),
  z.object({ kind: z.literal('listRecentConversations') }),
  z.object({ kind: z.literal('firstListPainted') }),
  // Open work no other list shows: no fields, as its neighbour.
  z.object({ kind: z.literal('workIncidentsForAPerson') }),
  // ⚑ **F097** · no fields, and the same census answer as its siblings. ⚑ Its own verb rather than a
  // selector on the stall read: one is a person's to read and nobody's to answer, this one theirs to
  // answer — see the union member.
  z.object({ kind: z.literal('waitingOnWhoWroteForAPerson') }),
  // 438 · the two numbers are a WINDOW a person chose. ⛔ `int()` because they are epoch
  // milliseconds and a fractional one is not a moment, it is a typo. ⚠️ **The SPAN is not bounded
  // here and cannot be**: a `.refine` returns a `ZodEffects`, which may not be a member of a
  // discriminated union. The rail that refuses `digest(0, Date.now())` is `MAX_DIGEST_SPAN_MS`,
  // in `RuntimeHost.digest`, and saying so here is the point — a reviewer trusting this comment
  // would otherwise believe the schema carried a bound it does not have.
  z
    .object({
      kind: z.literal('recentActivity'),
      from: z.number().int().nonnegative().safe(),
      to: z.number().int().nonnegative().safe(),
    })
    .strict(),
  z.object({
    kind: z.literal('digest'),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('listLibrary'),
    /**
     * Bounded because it crosses a process boundary and is then matched against every entry: a
     * megabyte of "query" would be compared to a couple of thousand titles. It is used as a plain
     * substring — never as a pattern — so there is no metacharacter to escape and nothing to inject
     * into; the only thing worth constraining is its size.
     */
    query: z.string().max(LIBRARY_QUERY_MAX).optional(),
    /**
     * One recorded row by id (118), rather than a substring over captions.
     *
     * ⚠️ **`sessionId`, the same shape every other command here uses**, because that is what it is:
     * our `provider_session` row id. It is an EXACT match on a value the store owns, so — unlike
     * `query` — it names one row or none, which is what a caller with an id in hand needs.
     */
    recordId: sessionId.optional(),
    /**
     * The structured narrowing (121), ANDed with `query` main-side.
     *
     * Provider and facet values use their shared enums, the state fields are booleans,
     * and the profile ID is compared to the recorded identity.
     *
     * ⚠️ **`LIBRARY_ORIGINS` / `LIBRARY_KINDS` / `LIBRARY_ARCHIVED`, not inline copies** (review). An inline
     * `z.enum(['ours', 'user-home'])` infers a NARROWER type than the shared union, so widening the
     * union would compile everywhere and be rejected here — a renderer sending a value the host
     * handles, refused at the wire, with nothing reporting the divergence. That is the rule stated
     * for `provider` below, and it applies to these three for the same reason.
     */
    filters: z
      .object({
        provider: providerSchema.optional(),
        profileId: z.string().optional(),
        origin: z.enum(LIBRARY_ORIGINS).optional(),
        kind: z.enum(LIBRARY_KINDS).optional(),
        notImported: z.boolean().optional(),
        unresumable: z.boolean().optional(),
        behind: z.boolean().optional(),
        offDisk: z.boolean().optional(),
        unreadable: z.boolean().optional(),
        archived: z.enum(LIBRARY_ARCHIVED).optional(),
      })
      .optional(),
    /** A page, not a corpus. Capped here as well as defaulted host-side — the wire is the boundary. */
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  // Fill in one recorded conversation's prior messages from the home this app provisioned (119).
  // ⚠️ OUR row id, not a provider's, and that is the whole difference from the command below: this
  // one names a row we already hold; that one names a file in the user's own home that has none.
  z.object({ kind: z.literal('importRecordedSession'), sessionId }),
  z.object({
    kind: z.literal('importUserHomeSession'),
    // The SHARED enum, like every other command here. An inline copy would still typecheck against
    // `Provider` while rejecting, at the wire, any provider added to the shared one — a divergence
    // nothing would report.
    provider: providerSchema,
    /**
     * The PROVIDER's id, not ours, and it is matched against the homes rather than turned into a
     * path: the import looks this up in what discovery actually found, so an id naming nothing
     * simply finds nothing. Bounded anyway, on the same principle as the query above.
     */
    providerSessionId: z.string().min(1).max(200),
  }),
  // Our own row id, not a provider's (065): the rebuild finds the row's own provider file, so the
  // only thing it needs to name is the row.
  z.object({ kind: z.literal('rebuildLedger'), sessionId }),
  // Read a workflow's output file (108). ⚠️ **No path parameter, and its absence is the design.**
  // The renderer names the run; the path comes from the ledger this app wrote. See
  // `workflow-output.ts` — a channel that took a path would be an arbitrary-file reader with a
  // friendly name.
  z.object({
    kind: z.literal('readWorkflowOutput'),
    sessionId,
    taskId: z.string().min(1).max(200),
  }),
  // 356. Read one file the PROVIDER said it loaded, so it can open on the app's own paper. ⚠️ **An
  // index rather than a path, and that is not squeamishness**: the readable set has to be *"what
  // this conversation's provider reported"*, and a path parameter would make it *"whatever the
  // renderer asks for"* however carefully the handler then checked it. ⛔ The bound is `nonnegative`
  // + `int` here as well as in the reader, because a schema that admits `-1` hands the reader a
  // value whose only defence is a second range check somewhere else.
  z.object({
    kind: z.literal('readInstructionSource'),
    sessionId,
    index: z.number().int().nonnegative().max(1_000),
  }),
  // 356. Show a path in the file manager. ⛔ **The target is an enum of things the HOST holds**, for
  // the reason every read door above takes no path: the renderer names the row it drew, and main
  // looks the string up in the session it launched.
  z.object({
    kind: z.literal('revealPath'),
    sessionId,
    target: z.discriminatedUnion('of', [
      z.object({ of: z.literal('cwd') }),
      z.object({ of: z.literal('home') }),
      z.object({ of: z.literal('config-file'), name: z.string().min(1).max(200) }),
      z.object({
        of: z.literal('instruction-source'),
        index: z.number().int().nonnegative().max(1_000),
      }),
    ]),
  }),
  // 733. One config file of this session's home, read on request — the Info panel's Open (`731`
  // F-2). ⛔ **By the NAME the config gave it, never a path**, for the reason every read door above
  // gives; ⚠️ and the bound is the reveal's own for the same row, one object up.
  z.object({
    kind: z.literal('readConfigFile'),
    sessionId,
    name: z.string().min(1).max(200),
  }),
  // Read what a running command has printed (300). ⚠️ **No path and no process id either** — the
  // renderer names the TOOL CALL it is showing, and the answer comes out of a buffer the adapter
  // filled off its own stream. Nothing here reaches the wire or the disk.
  //
  // ⛔ **`MAX_BACKGROUND_ID` rather than a number spelled here**, on `169` §1's rule and on the
  // precedent one field over: `background_work.ended.toolCallId` is bounded by that same constant in
  // `events.ts`, and this command has to accept exactly the ids those events carry. A tighter bound
  // here would reject precisely the calls the app had just published.
  z.object({
    kind: z.literal('readCommandOutput'),
    sessionId,
    toolCallId: z.string().min(1).max(MAX_BACKGROUND_ID),
  }),
  // Read the whole of what a tool answered (462). ⚠️ **The same shape as the read above it and the
  // same bound, deliberately**: it is the same id, addressing the same transcript row, and two
  // spellings of one bound is how one of them ends up stale. Nothing here reaches the wire or the
  // disk either — the answer comes out of a hold the adapter filled off its own stream.
  z.object({
    kind: z.literal('readToolAnswer'),
    sessionId,
    toolCallId: z.string().min(1).max(MAX_BACKGROUND_ID),
  }),
  // 🔴 **510 · one resource, for a person** (D-016). ⛔ **An id and no session**, and neither
  // absence is a shortcut: the id is a primary key in this app's own `work_resource` table, so the
  // lookup is a parameterised equality and a guessed string reaches no row rather than reaching
  // something it should not — the argument `readCommandOutput` makes two doors up. ⚠️ A path would
  // be the one string `380` keeps off every wire, and a `sessionId` would be a narrowing of the
  // question rather than an argument to it.
  //
  // ⚑ **`.max(200)` like every other id here.** No person types it: it is `newResourceId`'s
  // `res_<32 hex>`, drawn on the row a person pressed and sent back unmodified, and a bound tighter
  // than the ids the app mints would reject exactly what it published.
  z.object({
    kind: z.literal('readResource'),
    resourceId: z.string().min(1).max(200),
  }),
  // 🔴 **D-032 · a kept picture or PDF for a person to see, and the same file shown in Finder** —
  // `readResource`'s shape and its reasons: an id, no session, no path. ⛔ Strict: the preload sends
  // the id alone, and anything sent beside it is refused rather than dropped.
  z.strictObject({
    kind: z.literal('drawResource'),
    resourceId: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal('revealResource'),
    resourceId: z.string().min(1).max(200),
  }),
  // Paths a message wrote, as text: main resolves each one itself, on every call.
  z.strictObject({
    kind: z.literal('resolveMessagePaths'),
    sessionId: sessionId.nullable(),
    texts: z.array(z.string().max(MAX_MESSAGE_PATH_LENGTH)).max(MAX_MESSAGE_PATHS),
  }),
  z.strictObject({
    kind: z.literal('openMessagePath'),
    sessionId: sessionId.nullable(),
    text: z.string().min(1).max(MAX_MESSAGE_PATH_LENGTH),
  }),
  z.strictObject({
    kind: z.literal('revealMessagePath'),
    sessionId: sessionId.nullable(),
    text: z.string().min(1).max(MAX_MESSAGE_PATH_LENGTH),
  }),
  // 🔴 **D-026 · R1 — the files kept in one scope, for a person.** ⚑ `readChildWork`'s shape below:
  // one kind, a union on the field that says which of three. ⛔ **Strict, every arm**
  // (`z.strictObject`, D-020's rule): a field nobody declared — or a second scope's field beside
  // the first — is a REFUSAL, not a silent strip. ⚑ `piece` is a label or an id the window drew,
  // `.max(200)` as `retitleWork`'s is; a conversation is a `sessionId`.
  z.strictObject({
    kind: z.literal('searchWork'),
    conversation: sessionId,
    query: workSearchQuery,
  }),
  z.strictObject({ kind: z.literal('filesLibrary'), request: filesLibraryRequest }),
  z.strictObject({ kind: z.literal('teamProfileGraph'), request: teamProfileGraphRequest }),
  z.discriminatedUnion('scope', [
    z.strictObject({
      kind: z.literal('filesKept'),
      scope: z.literal('tree'),
      conversation: sessionId,
      withAdded: z.literal(true).optional(),
    }),
    z.strictObject({
      kind: z.literal('filesKept'),
      scope: z.literal('conversation'),
      conversation: sessionId,
    }),
    z.strictObject({
      kind: z.literal('filesKept'),
      scope: z.literal('piece'),
      piece: z.string().min(1).max(200),
    }),
  ]),
  // Read what a sub-agent did (112). Same shape and same absence of a path — and the id is checked
  // against the session's own ledger before any directory is looked at. `part` is an enum rather
  // than a filename for the same reason: the three artefacts are named here, not by the caller.
  // ⚠️ **A UNION, not one shape with an ignored field** (112, review MEDIUM). A transcript is
  // addressed by the agent that wrote it; a journal and a script belong to the RUN, and asking for
  // them by one agent breaks whenever that agent never started. Either way the id is checked
  // against this session's own ledger before any directory is looked at.
  z.discriminatedUnion('part', [
    z.object({
      kind: z.literal('readChildWork'),
      sessionId,
      part: z.literal('transcript'),
      agentId: z.string().min(1).max(200),
    }),
    z.object({
      kind: z.literal('readChildWork'),
      sessionId,
      part: z.literal('journal'),
      taskId: z.string().min(1).max(200),
    }),
    z.object({
      kind: z.literal('readChildWork'),
      sessionId,
      part: z.literal('script'),
      taskId: z.string().min(1).max(200),
    }),
  ]),
  // 296. Two verbs, one child, and the id is bounded exactly as the transcript read's is — the same
  // ledger check runs behind both, and neither carries anything that reaches a path.
  //
  // ⚠️ **`readChildState` is a READ that is called on a timer** while a viewer is open, which is why
  // it is separate from the send rather than a mode of it: a poll that could write is not a poll.
  z.object({
    kind: z.literal('readChildState'),
    sessionId,
    agentId: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal('sendToChild'),
    sessionId,
    agentId: z.string().min(1).max(200),
    text: childMessage,
  }),
  // No cursor at all: "the newest" is not a position anyone has to know, and taking one would
  // let a caller ask for the newest page ending somewhere that is not the end.
  z.object({ kind: z.literal('latestHistory'), sessionId }),
  z.object({
    kind: z.literal('earlierHistory'),
    sessionId,
    /**
     * The ordinal the caller's oldest page begins at. A non-negative integer because ordinals are:
     * a negative one is not "the start", it is a malformed cursor, and coercing it would hand back
     * a page the caller cannot place.
     */
    before: z.number().int().min(0),
    /**
     * A page, not a corpus — the same rule the library's `limit` follows. Capped at the wire as
     * well as defaulted host-side, because the renderer is where a request for ten thousand turns
     * would come from and the boundary is the only place that can refuse one.
     */
    turns: z.number().int().min(1).max(100).optional(),
  }),
] as const
