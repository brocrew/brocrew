import { SkillsRequest } from '../../shared/skills-window'
import { LINK_TARGET_LIMIT } from '../../shared/link-resolution'
import { MOVE_WORDS } from '../../shared/move-request'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { workSearchQuery } from '../../shared/work-search'
import { filesLibraryRequest } from '../../shared/files-library'
import { teamProfileGraphRequest } from '../../shared/team-profile-graph'
import {
  MAX_BACKGROUND_ID,
  MAX_SETTINGS_BYTES,
  permissionDecisionSchema,
  userInputResponseSchema,
} from '@brobot2/runtime'
import { providerSchema } from '@brobot2/shared'
import {
  CONTROL_CHARACTER_IN_PATH,
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  RUNTIME_LIVENESS_CHANNEL,
  PATH_SEGMENT_RULE,
  MAX_HANDED_PATHS,
  MAX_MESSAGE_PATH_LENGTH,
  MAX_MESSAGE_PATHS,
  hasControlCharacter,
  LIBRARY_ARCHIVED,
  LIBRARY_KINDS,
  LIBRARY_ORIGINS,
  LIBRARY_QUERY_MAX,
  MAX_PATH_CHARS,
  MAX_READING_BYTES,
  PATH_SEGMENT_MAX_LENGTH,
  AGENT_DISPLAY_NAME_CHARS,
  NOTHING_TO_SEND,
  hasSomethingToSend,
  isPathSegment,
  type RuntimeCommand,
  type RuntimeCommandKind,
} from '../../shared/runtime-ipc'
// ⚑ **516 · the one bound this file needs from the registry's own module.** The RULES stay at the
// door — see {@link externalMcpServerName} for why a validator must not hold half of them.
import { MAX_EXTERNAL_MCP_GRANTS } from '../../shared/external-mcp'
import { REPLY_SUMMARY_LIMIT } from './reply-rails'
// ⚑ **D-016 · commit 7 · R4 — a title's bound**, the one `give_work` and `update_work` hold.
import { PIECE_TITLE_CHARS } from '../../shared/piece-called'
import {
  CAPABILITY_FIELDS,
  MAX_CAPABILITY_COUNT,
  type AnyCapabilityField,
  type CapabilityGrant,
} from '../../shared/capabilities'
import { MEMORY_EDIT } from '../../shared/agent-memory'
import { OWN_INSTRUCTIONS_CHARS } from '../../shared/own-instructions'
import {
  ownNotesTextFits,
  OWN_NOTES_TEXT_PROBLEM,
  OWN_NOTES_REASON_PROBLEM,
} from '../../shared/own-notes'
// ⚑ **625 · a CONSTANT, and this file still imports nothing from `node:fs`** — which is what
// `no-byte-authority.test.ts` measures. ⛔ The cap the wire bound is derived from is the one the
// guarded reader enforces, and importing it is how the two cannot drift.
import { AGENT_MEMORY_NOTES_SHOWN, INSTRUCTION_FILE_CAP } from './instructions'
import type { RuntimeEventSink, RuntimeHost } from './runtime-host'
import type { MainThreadWork } from '../stall-watch'
import { DEFAULT_PROFILE_ID } from './provider-homes'
import { whyALaunchWasRefused } from './launch-refusal'
import { sinkOwnerId } from './window-caller'
import { isAPageReport, type PageReceipt } from './page-performance'

/**
 * The renderer→main half of the boundary. One `invoke` channel carries every
 * command as a discriminated union, so there is exactly one place where renderer
 * input is validated — and the decision/response payloads are validated with the
 * runtime's own schemas rather than a re-typed copy, so the bridge cannot drift
 * from the contract it forwards to. The one other shape the channel carries is the
 * page's own freeze report, checked by its own schema (`page-performance.ts`) and
 * never handed to the host.
 *
 * Electron is imported for types only: this module must stay loadable in a plain
 * Node test process.
 */

/**
 * Bounded as well as non-empty. Every id here crosses a process boundary and is then used — as a
 * database key, a correlation id, or (in `exportSession`, which narrows this further) a filename.
 * None of them is ever legitimately long, and an unbounded string is a free way to make the main
 * process do work on the renderer's behalf.
 */
/**
 * 🔴 **One capability's value on the wire, DERIVED from the schema rather than typed out** (355 §2).
 *
 * ⛔ **HO-008 §3 made the enumeration the requirement, not a suggestion**: *"Build it to enumerate
 * the capability schema rather than hardcode a field list."* A hand-written zod member per field
 * would be one more hardcoded list, and the one furthest from anybody's eye when a capability
 * lands or leaves.
 *
 * ⚑ **Keyed on the EDITOR kind, so a fifth capability of an existing kind validates for free** — and
 * a kind nobody has taught this function about is a compile error rather than a field that quietly
 * accepts anything. ⚠️ `choice` reads the field's own vocabulary, which is why this takes the whole
 * field and not just its kind.
 *
 * ⚠️ **Declared ABOVE `const sessionId` on purpose.** `wire-bounds.test.ts` pins the ordered list of
 * every `z.string()` declared between that line and the union's `satisfies`, and
 * `send-refusals.test.ts` counts every `.min`/`.max`/`.refine`/`z.enum`/`z.boolean` in three slices
 * below it. Both of those censuses are about the SEND commands; a capability grant is not one, and
 * putting it inside their regions would have made it look like one.
 */
function capabilityValueSchema(field: AnyCapabilityField): z.ZodType {
  const count = z.number().int().min(0).max(MAX_CAPABILITY_COUNT)
  switch (field.editor) {
    case 'count':
      return count
    case 'choice':
      // ⚠️ The field's own vocabulary. `z.enum` needs a non-empty tuple, which the descriptor's type
      // cannot promise, so the emptiness is checked rather than asserted away.
      if (field.vocabulary === undefined || field.vocabulary.length === 0) {
        throw new Error(`capability ${field.key} is a choice with no vocabulary`)
      }
      return z.enum([...field.vocabulary] as [string, ...string[]])
  }
}

/**
 * ⛔ **Every capability, always, each either a value or `null`** (355) — {@link CapabilityGrant}.
 *
 * 339's `.nullable()` ruling, and its exact reason: *"an absent key and an explicit null are the
 * same value to a `Partial`, and they are not the same intent"*. Here `null` is a person saying
 * **use the default**, which the store writes as NULL — the gesture that makes a grant reversible
 * and stops a first Save freezing today's defaults into a row that had chosen nothing.
 *
 * ⛔ **The cast at the end CHECKS NOTHING, and saying so is the point** (355, review — the first
 * version of this comment claimed the opposite). `z.object` over a `fromEntries` infers
 * `Record<string, …>`, and `as unknown as` erases whatever disagreement there might have been; there
 * is no `satisfies` that can hold a computed shape to a declared one.
 *
 * ⚑ **So the totality is asserted at RUN time instead**, in `the-grant-nobody-can-give.test.ts` §3:
 * a grant missing each field in turn is refused, one case per capability, derived from the same
 * list. That is a weaker guarantee than a compile error and it is the one that is actually
 * available — the compile-time half of this dispatch's enumeration lives in `capabilities.ts`,
 * where `KEYS_AGREE` and the `satisfies` on the descriptor are real.
 */
const capabilityGrantSchema = z
  .object(
    Object.fromEntries(
      CAPABILITY_FIELDS.map((field) => [field.key, capabilityValueSchema(field).nullable()]),
    ),
  )
  // ⛔ **`.strict()`, so a capability nobody declared is a REFUSAL and not a silent strip.** `303` B
  // measured what stripping costs — eight keys in, seven keys out, and *"the agent it spawned never
  // started, looking exactly like a slow provider"*. Rail 1 of the spawn door makes the same ruling
  // for the same reason, and a door that WRITES a rule can afford it least of all: a caller sending
  // a capability this app does not have must be told so, not quietly granted nothing.
  .strict() as unknown as z.ZodType<CapabilityGrant>

const sessionId = z.string().min(1).max(200)
const requestId = z.string().min(1).max(200)
/**
 * ⛔ **The held message a cancel names** (354) — the same bound as every other id here, and see
 * {@link sessionId} for why every one of them has one.
 *
 * ⚠️ **Declared BELOW `requestId` on purpose.** `send-refusals.test.ts` slices this file from
 * `const sessionId =` to `const requestId` and counts the constraints it finds, one row per rule;
 * a declaration placed inside that slice would be counted as a rule on the message-carrying
 * commands, which this is not — it belongs to `cancelQueuedMessage`.
 */
const messageId = z.string().min(1).max(200)
/**
 * A part of a delete, by the id its check gave it: `records`, `files:<conversation>` or
 * `note:<path>`, so a note's path plus its prefix is the longest.
 */
const deletePartId = z
  .string()
  .min(1)
  .max(MAX_PATH_CHARS + 16)
/**
 * The profile a credential question is about (098) — the SAME rule `createSession` holds its own
 * `profileId` to, declared once here now that four more commands need it. Optional means the
 * default profile, which is what every surface asks about until profiles have a picker.
 */
const profileId = z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`).optional()
/**
 * ⚑ **D-042 · a model's name as a person types it** — `createSession`'s bound, trimmed, with no
 * control characters.
 */
const aModelsName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  // eslint-disable-next-line no-control-regex -- the control characters are what this refuses
  .refine((said) => !/[\u0000-\u001f\u007f]/.test(said), 'must have no control characters')
/**
 * 🔴 **The name a new identity is created with** (419) — the same alphabet {@link profileId} carries,
 * declared separately because the two are different values that happen to share a rule.
 *
 * ⛔ **Not `profileId` reused**, which is the nearest-looking option and is `.optional()`: this one
 * is REQUIRED, because a creation with no name is not a creation, and an optional field would make
 * an omitted name mean *the default profile* — the one identity that always already exists.
 */
const agentSlug = z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`)
/** ⚠️ The bound the CONTROL will carry too — see {@link AGENT_DISPLAY_NAME_CHARS} (221 §3, 419). */
const agentDisplayName = z.string().max(AGENT_DISPLAY_NAME_CHARS)
/**
 * ⛔ **582 · the `configured` layer's text, bounded where it enters** — `OWN_INSTRUCTIONS_CHARS`,
 * derived in that constant's own note against the bundle it joins rather than guessed here.
 */
const ownInstructions = z.string().max(OWN_INSTRUCTIONS_CHARS)
const ownNotesText = z.string().refine(ownNotesTextFits, OWN_NOTES_TEXT_PROBLEM)
const ownNotesVersion = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
/**
 * 🔴 **625 · the replacement text a person types over one memory entry**, bounded where it enters.
 *
 * ⛔ **`INSTRUCTION_FILE_CAP` and not a new number**, and it is derived rather than chosen: that is
 * the cap the guarded reader enforces on every memory file WHILE reading, so a correction longer
 * than it would write bytes this app could never read back. ⚠️ **A bound a writer may exceed and a
 * reader will truncate is the shape `a-bound-written-as-the-constant-cannot-pin-it` warns about**,
 * arriving as a file that grows a `truncated` flag the moment it is saved.
 *
 * ⚑ **BYTES, not characters, and that is the opposite of `ownInstructions` above** — deliberately.
 * `OWN_INSTRUCTIONS_CHARS` counts characters because a person counting what they typed counts
 * characters; this one has to agree with a reader that counts BYTES, and an accented correction
 * that passed a character bound and failed the byte one would be refused by the filesystem after
 * the door said yes.
 */
/**
 * 🔴 **633 · the Markdown a readable export carries, bounded where it ENTERS.**
 *
 * ⛔ **BYTES, not characters**, and it is {@link memoryText}'s argument one field over: the writer
 * counts bytes and so does a filesystem, and an accented conversation is longer than its length.
 * ⚑ The ceiling is `MAX_READING_BYTES` — a SHARED constant, so the wire and `write-reading.ts`
 * cannot hold two different numbers.
 *
 * ⚠️ **No `.min(1)`**: an empty body is refused by the WRITER, with a sentence, rather than by a
 * schema answering *the arguments did not match what this tool accepts* about a conversation that
 * happens to be empty.
 */
const readingBody = z
  .string()
  .refine(
    (text) => Buffer.byteLength(text, 'utf8') <= MAX_READING_BYTES,
    `must be at most ${String(MAX_READING_BYTES)} bytes`,
  )

const memoryText = z
  .string()
  .refine(
    (text) => Buffer.byteLength(text, 'utf8') <= INSTRUCTION_FILE_CAP,
    `must be at most ${String(INSTRUCTION_FILE_CAP)} bytes`,
  )
/**
 * 🔴 **The name a person types for an external MCP server** (516).
 *
 * ⛔ **A LENGTH only, and the rule lives at the door.** {@link isPathSegment} would have been the
 * nearest-looking refinement and it is the wrong one HERE: the name rule is
 * `externalMcpNameRefusal`, which also reserves `AGENT_TOOL_SERVER` and forbids `__` — and a
 * validator that checked half of it would refuse with a message about an alphabet while the other
 * half refused with a sentence a person could act on. ⚑ One authority, and this is the boundary's
 * job rather than the policy's.
 *
 * ⚠️ **Its own declaration rather than `agentSlug` reused** — two names for one bound is how a
 * bound comes to be relaxed for the wrong reason, and a server name is not a directory.
 */
const externalMcpServerName = z.string().max(PATH_SEGMENT_MAX_LENGTH)
/**
 * ⛔ **The local address, bounded at the boundary and judged at the door** —
 * {@link externalMcpServerName}'s split, for its reason. `MAX_PATH_CHARS` is the ceiling every other
 * long string on this wire holds, asked of a value of the same order.
 */
const externalMcpUrl = z.string().max(MAX_PATH_CHARS)
/**
 * ⛔ **A registry row's id — `ems:<folded name>`, which is NOT an `isPathSegment`.** The `:` is
 * deliberately outside that alphabet so no name can spell a separator, which is exactly why this id
 * cannot be held to it. ⚑ A length is the honest bound: the value is one this app minted and handed
 * to the window, and the FOREIGN KEY is what refuses one that names no row.
 */
const externalMcpServerId = z.string().max(PATH_SEGMENT_MAX_LENGTH + 8)
/**
 * What a window calls a launch it may want to take back (102).
 *
 * Bounded and non-blank on the same rule as every other renderer-supplied string here. It is only
 * ever compared for equality against a slot this host reserved for this owner — never a path, never
 * a lookup key into anything on disk — so shape is the whole of what needs checking.
 */
const launchKey = z.string().min(1).max(200)
/**
 * ⛔ **Paths a person attached (216) — bounded, absolute, and NOT trusted for what they claim.**
 *
 * The `kind` and `outsideCwd` a renderer sends back are a caption main wrote a moment ago, and
 * neither is trusted for what it CLAIMS about the filesystem — `recheckHandedPaths` asks again
 * before the turn goes out. ⚠️ **So what this schema has to hold is that the payload cannot be used
 * to make main do work on the renderer's behalf**: a bounded array of bounded absolute paths.
 *
 * ⛔ **`kind` is no longer *thrown away*, and this sentence used to say it was** (232 §1, corrected
 * in review). It is one of the two fields consent is measured over, so a `kind` that no longer
 * matches what is on disk REFUSES the send rather than being silently corrected — see
 * `consentChanged`. ⚑ `outsideCwd` genuinely is still re-derived and overwritten, because it is a
 * fact about a folder rather than about the thing chosen.
 *
 * {@link MAX_PATH_CHARS} is `PATH_MAX` on macOS with room to spare, the same bound
 * `importBundleFile` and `checkCwd` hold — one constant now rather than the literal written out four
 * times (221 §3).
 */
const attachments = z
  .array(
    z.object({
      // ⛔ **ABSOLUTE, enforced rather than described** (review). This comment block claimed "a
      // bounded array of bounded absolute paths" and the schema held only the first two, so a
      // relative path reached `classifyHandedPath` and was resolved against the MAIN PROCESS's own
      // working directory. Refused at the door as well as in the classifier: the door is where a
      // renderer's claim stops being taken at face value.
      path: z
        .string()
        .min(1)
        .max(MAX_PATH_CHARS)
        .refine((each) => isAbsolute(each), 'a handed path must be absolute')
        // ⛔ **NO CONTROL CHARACTERS, at the door as well as in the classifier** (232 §2, from `227`
        // HIGH 2). ⚠️ **The dispatch asks whether the wire is the right place to refuse, and the
        // answer is that it is not the ONLY place — it is the second one.** `classifyHandedPath`
        // refuses first, at the picker and the drop, where a person is standing and can be told a
        // sentence; this is the same rule where a renderer's claim stops being taken at face value,
        // exactly as the absoluteness refine above is. ⚑ **What a person sees if it reaches HERE**:
        // `describeIssues` renders `path: <the sentence>` on the composer's refusal line, because
        // the message is {@link CONTROL_CHARACTER_IN_PATH} rather than a zod default (169 §1 / 118).
        // ⚠️ Reaching it means the renderer sent a path no classifier of ours produced — a forged or
        // replayed command — so the sentence is a backstop, not the ordinary road.
        .refine((each) => !hasControlCharacter(each), CONTROL_CHARACTER_IN_PATH),
      kind: z.enum(['file', 'directory']),
      outsideCwd: z.boolean(),
    }),
  )
  .max(MAX_HANDED_PATHS)
  .optional()

/**
 * ⛔ **The send-shaped commands, built by ONE factory** (221 §1) — `send`, `sendInterrupting`,
 * `queueMessage`, and since 🔴 **735** `startAndSend` (a first message and the start it causes, which
 * IS a send, so it takes a send's shape and rule here and adds only the name for its wait). See
 * {@link goAheadText} below for the go-ahead, which carries a message too and was censused only at
 * 234 §3.
 *
 * ## The line this replaces
 *
 * `text: z.string().min(1)`, written three times. ⚠️ **It refused what every other layer accepts.**
 * `216` decided an attachment-only send should work and said so in as many words — *"the fix is
 * `canSend` allowing attachment-only sends — the press now works — rather than taking the control
 * away"* — and `RuntimeHost.send`, `runSendInterrupting` and `runFlush` all compose one through
 * `messageWithHandedPaths`, whose empty-text branch had never executed in production. `220` found
 * the gap the only way it could be found: by dropping a file on the launcher and pressing Send.
 *
 * ⛔ **The rule is {@link hasSomethingToSend}, imported from `shared` rather than restated here**,
 * because the composer's `canSend` asks the same question and `169` §1 is the dispatch about what
 * happens when one rule is spelled in two places. It is the same function on both sides of the
 * boundary now, so the wire cannot refuse a press the button offered.
 *
 * ⚠️ **The refusal is a SENTENCE and it is attached to `text`**, so `describeIssues` renders
 * `text: that message has no words and nothing attached…` rather than zod's `Too small: expected
 * string to have >=1 characters`. `169` §1 / `118`: a refusal a person can reach is a refusal a
 * person can read.
 *
 * ⚑ **A function rather than three literals**, so the three cannot drift — which is not
 * hypothetical: `220` measured `send` and could not reach the other two, and they carried the same
 * defect for the same two dispatches with nothing on either side of the wire that would have said
 * so.
 */
function sendShaped<K extends 'send' | 'sendInterrupting' | 'queueMessage' | 'startAndSend'>(
  kind: K,
) {
  return z
    .object({ kind: z.literal(kind), sessionId, text: z.string(), attachments })
    .refine((command) => hasSomethingToSend(command.text, command.attachments?.length ?? 0), {
      message: NOTHING_TO_SEND,
      path: ['text'],
    })
}

/**
 * ⛔ **The FOURTH command that carries a message** (234 §3, from `228` M3) — the plan go-ahead (060).
 *
 * ## Why it was not one of the three
 *
 * ⚠️ **Because nobody had asked.** `221` §1 converged `send`, `sendInterrupting` and `queueMessage`
 * onto {@link hasSomethingToSend} and this line kept `z.string().min(1)` — the very rule that
 * dispatch removed — so the wire held a weaker, older answer for a fourth verb that reaches
 * `session.handle.send` and writes a `user_turn` like any other. A whitespace-only `text` passed:
 * the host durably left plan mode and then recorded a turn made of spaces.
 *
 * ⚑ **"The UI only ever sends a constant" is the argument for censusing it, not for leaving it
 * out.** `221`'s whole finding was a rule that was true of every caller until it was not, and the
 * endgame's MCP spawn tools are exactly the caller that would not be a button.
 *
 * ⚠️ **`.optional()` is still the LEAVE, and it is not a weakening.** An absent `text` asks for the
 * mode change alone — `endPlanMode` sends nothing and starts no turn on that branch (085), so there
 * is no message for a content rule to be about. What changes is that a PRESENT one is now held to
 * the same rule as every other message on this wire: `''` was rejected before and still is, and
 * `'   '` is rejected now as well.
 *
 * ⛔ **Declared HERE, above `runtimeCommandSchema`, so `send-refusals.test.ts` counts it.** That
 * census reads the declarations a message-carrying command is built from and asserts one
 * `WIRE_REFUSALS` row per constraint; a rule written inline in the union below is invisible to it,
 * which is precisely how this one stayed unclassified for six dispatches.
 */
const goAheadText = z
  .string()
  .refine((text) => hasSomethingToSend(text, 0), NOTHING_TO_SEND)
  .optional()

/**
 * ⛔ **The FIFTH command that carries a message** (296) — a word to a sub-agent.
 *
 * ⚠️ **Declared HERE, above `runtimeCommandSchema`, and that placement is the whole lesson of 234
 * §3.** `endPlanMode`'s rule was written inline inside the union, below where `send-refusals.test.ts`
 * stops reading, and it kept a weaker `min(1)` for six dispatches with a census two feet away that
 * could not see it. A message-carrying verb that hid from that census would be the same defect with
 * a new number on it.
 *
 * ⚑ **The same {@link hasSomethingToSend} as the other five** (four send-shaped since `735`, and the
 * go-ahead), so *"a message with no words"* means
 * one thing on this wire. ⛔ **Not `.optional()`, unlike `goAheadText`**: the go-ahead has a legal
 * shape that carries no message at all (085's LEAVE), and this one does not — a send to a child with
 * nothing in it is a press that should never have been offered.
 *
 * ⚠️ **No attachments, and the absence is a scope decision rather than an oversight.** `216`-`219`
 * built the handed-path machinery for a session's own composer, and every part of it — the cwd
 * classification, the outside-cwd disclosure, the `MAX_HANDED_PATHS` bound — is about the workspace
 * THIS session opened. A child runs in its own, so pointing one at a path would need that whole
 * question asked again for a directory nobody has classified.
 */
const childMessage = z.string().refine((text) => hasSomethingToSend(text, 0), NOTHING_TO_SEND)

export const runtimeCommandSchema = z.discriminatedUnion('kind', [
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
     * The structured narrowing (121) — nine optional predicates, ANDed with `query` main-side.
     *
     * ⚠️ **Every value is a CLOSED set, and that is the point of validating it here.** A provider
     * comes from the shared enum, `origin`, `kind` and `archived` from the shared VALUE arrays, and the five
     * state fields are booleans. Nothing in here reaches a filesystem, a query or a template — the
     * worst a malformed one can do is narrow a list — but a shape the host does not expect is still
     * a shape the host should not have to defend against, and this is where the app decided such
     * things are settled.
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
  /**
   * What each provider can do (039). No parameters at all: the renderer does not get to ask about
   * one provider, because asking about one means naming one. It receives every declaration and
   * looks up whichever provider is selected.
   */
  z.object({ kind: z.literal('capabilities') }),
  /**
   * Which profiles exist (167). Parameterless for the same reason again, and one more: the renderer
   * has nothing to narrow the answer WITH — it is asking precisely because it does not know what
   * profiles there are. The answer is a directory listing, so there is no input to validate.
   */
  z.object({ kind: z.literal('profiles') }),
  /**
   * The three credential gestures (098), all keyed by a profile — unlike `capabilities` above,
   * because a credential belongs to a profile home rather than to a provider.
   *
   * ⚠️ `profileId` is held to the SAME `isPathSegment` rule `createSession` uses, and for the same
   * reason: it becomes a path segment on the way to a provider home, so `../…` must be a rejected
   * command rather than a directory walk. A credential path is the last place to be lenient.
   */
  z.object({ kind: z.literal('checkProviderAuth'), provider: providerSchema, profileId }),
  z.object({ kind: z.literal('reprovisionProviderAuth'), provider: providerSchema, profileId }),
  z.object({ kind: z.literal('signInProvider'), provider: providerSchema, profileId }),
  z.object({ kind: z.literal('cancelProviderSignIn'), provider: providerSchema, profileId }),
  /**
   * Would the launch accept this folder (203). Bounded like every other renderer-supplied string
   * here; NOT `isPathSegment`, because this one is a whole path and is meant to be — it is the same
   * value `createSession.cwd` carries, asked about a keystroke earlier.
   *
   * ⚠️ **A blank path is a legitimate question and not an empty one**: it means "the workspace
   * default", which the launcher's placeholder says, so `.min(1)` would refuse the case the field
   * spends most of its life in.
   */
  z.object({ kind: z.literal('checkCwd'), path: z.string().max(MAX_PATH_CHARS) }),
  // ⛔ **508 · the SHARED `sessionId` schema and never a fresh `z.string()`.** `wire-bounds.test.ts`
  // asserts an exact, ordered list of every `z.string()` between the `sessionId` declaration and
  // this union's `satisfies` — a hard equality, not a floor — so a new unbounded string here is a
  // classification somebody owes rather than a field that quietly arrives.
  z.object({ kind: z.literal('workGivenBy'), sessionId }),
  // 🔴 **543 · who called whom, for one conversation.** ⛔ The SHARED `sessionId` schema, for the
  // reason the line above states: `wire-bounds.test.ts` asserts an exact, ordered list of every
  // `z.string()` between the `sessionId` declaration and this union's `satisfies`, so a fresh
  // `z.string()` here would be a classification somebody owes. ⚑ **One field and no others** — no
  // depth, no page and no limit — because the answer is the DIRECT edges and a bound nobody has
  // measured is how a walk becomes a hang.
  z.object({ kind: z.literal('whoCalledWhom'), sessionId }),
  // ⚑ **567 · no fields at all.** The answer is about the whole workspace, so there is nothing to
  // narrow it by and nothing on the wire for `wire-bounds.test.ts` to bound.
  z.object({ kind: z.literal('readWorkspace') }),
  // ⚑ **575 · no fields at all**, and for a stronger reason than the line above: the answer is
  // every conversation this app is RUNNING, and a set the caller named would bound the answer by
  // the question it happened to ask. ⛔ Nothing on the wire for `wire-bounds.test.ts` to bound, and
  // no array for a hostile renderer to make unbounded — see `RuntimeCommand`'s own note.
  z.object({ kind: z.literal('whatIsBeingDone') }),
  // ⚑ **621 · no fields at all, and it is the line above's ruling rather than a second one**:
  // the answer is every conversation this app is RUNNING, and a set the caller named would bound
  // it by the question it happened to ask. ⛔ Nothing on the wire for `wire-bounds.test.ts` to
  // bound, and no array for a hostile renderer to make unbounded.
  z.object({ kind: z.literal('whatEachConversationIsWaitingOn') }),
  // ⚑ **637 · no fields at all, and it is the two lines above's ruling with one more reason.** The
  // answer is rooted at the PERSON, so there is nothing above it for an argument to name.
  // ⛔ **The BOUND is deliberately not a field**: `MAX_FOREST_CONVERSATIONS` is a rule about what
  // may cross this boundary, and a `limit` here would let a hostile renderer ask for every row —
  // which is the thing the constant exists to refuse. ⚠️ Nothing on the wire for
  // `wire-bounds.test.ts` to bound, and no array for a caller to make unbounded.
  z.object({ kind: z.literal('theWholeForest') }),
  // ⚑ **D-018 · no fields at all, and it is `whatIsBeingDone`'s ruling**: the answer is every
  // conversation this app is RUNNING, and the pids are main's own. ⛔ A pid on the wire would be a
  // renderer naming a process for main to read — the one thing this read must never do.
  z.object({ kind: z.literal('processMemory') }),
  // ⚑ **The capability door** (355, HO-008 §3 · P0b) — the read, the write and the switch.
  // ⚠️ An identity is global, so neither names anything but the identity.
  // ⛔ **D-020 · strict, both** (`z.strictObject`): a field nobody declared is a REFUSAL, not a
  // silent strip — the `grant` inside is already refused so (`capabilityGrantSchema`), and a
  // person's settings are the last place a mistyped field should be dropped without a word.
  z.strictObject({ kind: z.literal('skills'), request: SkillsRequest }),
  z.strictObject({ kind: z.literal('agentIdentities') }),
  z.strictObject({
    kind: z.literal('setCapabilities'),
    // ⛔ **REQUIRED here, unlike the shared `profileId`.** This command is about one identity by
    // name; an absent one is not "the default profile", it is a caller that has not said which.
    profileId: profileId.unwrap(),
    grant: capabilityGrantSchema,
    /**
     * 🔴 **516 · the COMPLETE set of RESTRICTED servers this identity is granted** (narrowed by 524).
     *
     * ⛔ **Required, not `.optional()`** — 339's rule, and here the two readings are *this caller
     * does not know about external servers* and *this person unticked every box*, which the store's
     * third argument distinguishes by `undefined` versus `[]`. A wire that made them one would let
     * an older renderer silently clear a person's grants.
     *
     * ⛔ **`externalMcpServerId` and not `profileId` reused.** A registry id is `ems:<name>`, which
     * contains a `:` and is therefore NOT an `isPathSegment` — two names for one bound is how a
     * bound comes to be relaxed for the wrong reason.
     */
    externalMcpServerIds: z.array(externalMcpServerId).max(MAX_EXTERNAL_MCP_GRANTS),
  }),
  /**
   * 🔴 **Register one external MCP server, globally** (516, HO-040 §4.2).
   *
   * ⛔ **The wire checks SHAPE and the host checks the RULES**, and the split is deliberate. The
   * reserved name is `AGENT_TOOL_SERVER`'s, the `__` rule is `tool-inventory.ts`' splitter's, the
   * loopback rule is this build's, and the collision rail needs `TOOL_NAMES` and a handshake — none
   * of which is a thing to restate in a validator. ⚑ What this bounds is what a boundary bounds: a
   * length, so a forged payload cannot hand the main process a megabyte.
   *
   * ⚠️ **`externalMcpUrl` is its own declaration and not a path bound reused** — same reason as
   * every other id on this wire: two names for one bound is how a bound comes to be relaxed for the
   * wrong reason, and these values belong to different owners.
   */
  z.object({
    kind: z.literal('registerExternalMcpServer'),
    name: externalMcpServerName,
    url: externalMcpUrl,
    /**
     * 🔴 **524 · who the server is for** (`HO-048` §1) — a closed vocabulary, spelled here.
     *
     * ⛔ **`z.enum` and NOT a string this door folds.** The fold in `shared/external-mcp.ts` defends
     * a COLUMN that has no CHECK; this defends a PAYLOAD, and the two want opposite behaviour — a
     * third word arriving from a forged renderer is a caller this app does not understand and the
     * whole command is refused, rather than quietly becoming `restricted` and being acted on.
     * ⚠️ **No new `z.string()` declaration**, so `wire-bounds.test.ts`'s list does not move.
     */
    reach: z.enum(['everyone', 'restricted']),
  }),
  /** ⚑ **516 · remove one registered server, by the id the registry answered with.** */
  z.object({ kind: z.literal('removeExternalMcpServer'), serverId: externalMcpServerId }),
  /**
   * 🔴 **Which provider this identity's next conversation starts on** (433, HO-024 §2.2).
   *
   * ⛔ **`profileId.unwrap()`, exactly as `setCapabilities` above**: this command is about one
   * identity by name, and an absent one is not *the default profile*, it is a caller that has not
   * said which. ⚑ **No new `z.string()` declaration** — `wire-bounds.test.ts`'s list is unchanged,
   * because this verb adds no hand-typed field to the wire: a slug that is already declared, and a
   * word out of a closed vocabulary.
   *
   * ⚠️ **`.nullable()` and never `.optional()`** (339, criterion 10): an absent key and an explicit
   * null are the same value to a `Partial` and are not the same intent. Null is a person saying
   * *use the app's fallback*, which the column holds and a later read can tell from a choice.
   *
   * ⛔ **`providerSchema` and not `z.string()`**, which is `createAgent`'s rule one arm down: a
   * window is this app's own code, so a word outside the vocabulary is a bug to fail loudly on
   * rather than a stranger to teach.
   */
  z.object({
    kind: z.literal('setAgentProvider'),
    profileId: profileId.unwrap(),
    provider: providerSchema.nullable(),
  }),
  /**
   * 🔴 **The rename** (558, `HO-063` gap 2).
   *
   * ⛔ **`agentDisplayName` and not `z.string()`**, which is `createAgent`'s own bound one arm
   * down and the same constant: a name a person can type is bounded where it enters, once
   * (`AGENT_DISPLAY_NAME_CHARS`, 221 §3). ⚠️ **`.nullable()` and not `.optional()`** — 339's
   * ruling: *clear the name* is a value a person can send, and an absent key would make it
   * indistinguishable from *do not change it*, which this verb does not have.
   */
  z.object({
    kind: z.literal('setAgentDisplayName'),
    profileId: profileId.unwrap(),
    displayName: agentDisplayName.nullable(),
  }),
  /**
   * 🔴 **D-016 · commit 7 · R4 — a person renames a piece a person gave.**
   *
   * ⚑ **`piece` is `.max(200)` like every other id here** — a label (`W1`) or an id the row a person
   * pressed carries. ⛔ **The title's length is bounded HERE, by {@link PIECE_TITLE_CHARS}**, and
   * the header's field carries the same constant as its `maxlength` (221 §3: the control carries the
   * schema's own bound, so no person can type past it) — `agentDisplayName`'s rule above. ⚑ A BLANK
   * title is the host's to judge, since the field can send one: it answers that as a value with a
   * person's sentence, never as a wire error.
   */
  z.object({
    kind: z.literal('retitleWork'),
    piece: z.string().min(1).max(200),
    title: z.string().max(PIECE_TITLE_CHARS),
  }),
  // ⚑ A person takes back the piece a service is on, by its label or its id: `retitleWork`'s bound.
  z.object({
    kind: z.literal('takeBackWork'),
    piece: z.string().min(1).max(200),
  }),
  /**
   * 🔴 **A person sets an identity's DEFAULT model and effort** (677; D-042 · R2) — or `provider:
   * null` to clear.
   *
   * ⛔ **`providerSchema` and not `z.string()`**, `setAgentProvider`'s rule: a window is this app's
   * own code. ⚑ **`model` and `effort` are BOUNDED shape only**, `createSession`'s own bounds for the
   * same two values — whether the provider offers them is the HOST's question, asked of the
   * provider's catalogue, and a list here would be the stale second vocabulary `058` removed.
   *
   * ⛔ **A model or an effort with no provider beside it is refused HERE**, before any host code
   * runs: it is the one shape that could make a model name mean a different provider's model
   * (`R25` §1.2), and the wire is where its absence is cheapest to state. 🔴 **D-042 · and a
   * provider with no model**: a default is a model and the effort it runs at (R1), so *leave the
   * model to the provider* is no longer a value — the provider's own default is a model by name.
   * ⚠️ `.nullable()` and not `.optional()` (339): `effort: null` is the model's own default effort.
   */
  z
    .object({
      kind: z.literal('setAgentModelAndEffort'),
      profileId: profileId.unwrap(),
      provider: providerSchema.nullable(),
      model: z.string().min(1).max(120).nullable(),
      effort: z.string().min(1).max(60).nullable(),
    })
    .refine(
      (command) =>
        command.provider === null
          ? command.model === null && command.effort === null
          : command.model !== null,
      'a default is a model for a provider; clear it with all three null',
    ),
  /** ⚑ **677 · the choice, read** — a slug and nothing else. */
  z.object({ kind: z.literal('agentModelAndEffort'), profileId: profileId.unwrap() }),
  /**
   * 🔴 **D-042 · R3 — the one list a person picks from**: a provider off the closed enum and the
   * `isPathSegment`-checked profile, absent meaning BroBot's own — the credential gestures' shape.
   */
  z.object({ kind: z.literal('modelList'), provider: providerSchema, profileId }),
  /**
   * ⚑ **D-042 · R3 — a model a person adds to, or takes off, a provider's list** — bounded as
   * `createSession`'s `model` is, with no control characters: it is shown in a list and sent as is.
   */
  z.object({ kind: z.literal('addHandAddedModel'), provider: providerSchema, model: aModelsName }),
  z.object({
    kind: z.literal('deleteHandAddedModel'),
    provider: providerSchema,
    model: aModelsName,
  }),
  /**
   * 🔒 **A person's API key, the one time it crosses the wire.** Bounded only, and well past any
   * provider's key: what a key may be is `api-keys.ts`'s to say, in words a person can act on.
   * ⚠️ A refusal here would be logged with its message, and a bound's message never quotes the value.
   */
  z.object({ kind: z.literal('apiKeyStatus'), provider: providerSchema }),
  z.object({ kind: z.literal('setApiKey'), provider: providerSchema, key: z.string().max(4096) }),
  z.object({ kind: z.literal('removeApiKey'), provider: providerSchema }),
  z.object({ kind: z.literal('checkApiKey'), provider: providerSchema }),
  // ⚑ The Providers screen's four reads: no fields, so nothing to bound.
  z.object({ kind: z.literal('providerVersions') }),
  z.object({ kind: z.literal('providerSetup') }),
  z.object({ kind: z.literal('providerUsage') }),
  z.object({ kind: z.literal('providerResources') }),
  // ⚑ The kept rules' list, and a person's Remove — a file and a rule the list showed, each bounded.
  z.object({ kind: z.literal('keptRules') }),
  z.object({
    kind: z.literal('removeKeptRule'),
    provider: providerSchema,
    file: z.string().max(4096),
    // ⚑ A rule as long as the settings file that keeps it can be, so any listed rule can be removed.
    kept: z.string().max(MAX_SETTINGS_BYTES),
  }),
  /**
   * 🔴 **The removal** (558, `HO-063` gap 1).
   *
   * ⛔ **`profileId` and nothing else.** There is no *are you sure* on the wire and there must not
   * be: HO-029 §3's rule is that a surface may not report an act as done until it is recorded, and
   * a confirmation flag would put the decision on the payload instead of in front of the person.
   * ⚑ What a person is told BEFORE the press is `AGENT_REMOVAL_MEANS`.
   */
  z.object({ kind: z.literal('removeAgent'), profileId: profileId.unwrap() }),
  z.object({ kind: z.literal('archiveConversation'), sessionId }),
  z.object({ kind: z.literal('restoreConversation'), sessionId }),
  z.object({ kind: z.literal('checkDeleteConversation'), sessionId }),
  z.object({
    kind: z.literal('deleteConversation'),
    sessionId,
    parts: z.array(deletePartId).max(1000),
  }),
  /**
   * 🔴 **582 · a person's own rules for one identity** — the `configured` layer's writer.
   *
   * ⛔ **`ownInstructions` and not `z.string()`**, which is `agentDisplayName`'s own bound one
   * schema up and the same shape: text a person types is bounded where it ENTERS, once
   * (`OWN_INSTRUCTIONS_CHARS`). ⚠️ **No `.min(1)`**: an empty string is a real save meaning *take
   * them away*, and refusing it here would make *clear my rules* unreachable through the only door
   * that can express it.
   *
   * ⚑ **`broughtBack` is `.optional()` and not `.nullable()`** — 339's ruling read the other way
   * round from `setAgentDisplayName`'s: *this is new text* is the ABSENCE of a revert rather than a
   * value a person sends, and a `null` arm would be a second spelling of it.
   *
   * ⛔ **`.int().min(1)`, because version 0 does not exist** — the schema CHECKs the same thing, and
   * this says it where there is a refusal to report rather than an exception to catch.
   */
  z.object({
    kind: z.literal('instructAgent'),
    baseline: z
      .object({ expectedVersion: z.number().int().min(0), currentText: ownInstructions })
      .optional(),
    profileId: profileId.unwrap(),
    text: ownInstructions,
    broughtBack: z.number().int().min(1).optional(),
  }),
  /** 🔴 **582 · the read** — every version, and every ask waiting against this identity. */
  z.object({ kind: z.literal('agentInstructions'), profileId: profileId.unwrap() }),
  z
    .object({
      kind: z.literal('agentMethods'),
      profileId: profileId.unwrap(),
      offset: z.number().int().min(0).max(1_000_000).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('agentMethodBody'),
      profileId: profileId.unwrap(),
      key: z.string().min(1).max(1024),
    })
    .strict(),
  z
    .object({
      kind: z.literal('agentMethodChanges'),
      profileId: profileId.unwrap(),
      offset: z.number().int().min(0).max(1_000_000).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('removeAgentMethod'),
      profileId: profileId.unwrap(),
      selection: z
        .object({
          confirmed: z.boolean(),
          key: z.string().min(1).max(1024),
          fingerprint: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .nullable(),
          indexState: z.enum(['absent', 'ok', 'problem']),
          indexFingerprint: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('undoAgentMethod'),
      profileId: profileId.unwrap(),
      changeId: z.string().min(1).max(1024),
    })
    .strict(),
  z
    .object({
      kind: z.literal('checkInterruptedAgentMethods'),
      profileId: profileId.unwrap(),
      confirmed: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('agentOwnNotes'), profileId: profileId.unwrap() }).strict(),
  z.object({ kind: z.literal('agentOwnNotesUnread'), profileId: profileId.unwrap() }).strict(),
  z
    .object({
      kind: z.literal('saveOwnNotes'),
      profileId: profileId.unwrap(),
      expectedVersion: ownNotesVersion,
      currentText: ownNotesText,
      text: ownNotesText,
      why: ownNotesText.refine((value) => value.trim() !== '', OWN_NOTES_REASON_PROBLEM),
    })
    .strict(),
  z
    .object({
      kind: z.literal('undoOwnNotes'),
      profileId: profileId.unwrap(),
      // Zero is the empty-page baseline; the host returns no change for it.
      expectedVersion: ownNotesVersion,
    })
    .strict(),
  z
    .object({
      kind: z.literal('markOwnNotesSeen'),
      profileId: profileId.unwrap(),
      throughVersion: ownNotesVersion,
    })
    .strict(),
  z.object({ kind: z.literal('agentRulesUnread'), profileId: profileId.unwrap() }),
  z.object({
    kind: z.literal('undoAgentRules'),
    profileId: profileId.unwrap(),
    expectedVersion: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('markAgentRulesSeen'),
    profileId: profileId.unwrap(),
    throughVersion: z.number().int().min(0),
  }),
  /**
   * 🔴 **625 · the memory read** — every provider's store for this identity, taken right now.
   * ⚑ **F093 · paged** with `offset` and `limit`.
   */
  z.object({
    kind: z.literal('agentMemory'),
    profileId: profileId.unwrap(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  /** 🔴 **F093 · the agent-input popup's one read** — what a conversation's agent was given. */
  z.object({ kind: z.literal('whatThisAgentWasGiven'), sessionId }),
  /** 🔴 **F093 · C9 d — one message as the model got it**, named by its place in the record. */
  z.object({
    kind: z.literal('whatTheModelGot'),
    sessionId,
    ordinal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  /**
   * 🔴 **625 · a person removing or correcting one memory entry** (`EXT-015` §3.2).
   *
   * ⛔ **`entry` is `z.string()` and it is deliberately NOT bounded as a path.** ⚠️ Nothing here
   * validates it as one, because nothing downstream treats it as one: `amendAgentMemory` re-derives
   * the store and looks this string up in what came back, so a value that is not a path this app
   * produced matches nothing and is refused. ⚑ **A path check here would be a second, weaker answer
   * to a question the lookup already answers exactly** — and `wire-bounds.test.ts` is where the
   * classification of this string is written down.
   *
   * ⛔ **`memoryText` and not `z.string()` for the replacement**, which is `ownInstructions`' own
   * bound one schema up and the same shape: text a person types is bounded where it ENTERS, once.
   * ⚠️ **No `.min(1)`**: an empty correction is a real act — a person emptying an entry rather than
   * removing it — and the two are different facts the record keeps apart.
   *
   * ⚑ **`act` is `z.enum(MEMORY_EDIT)`**, so the closed vocabulary is enforced at the door as
   * well as by the column's CHECK. ⛔ A word this build does not know never reaches the filesystem.
   */
  z
    .object({
      kind: z.literal('amendAgentMemory'),
      profileId: profileId.unwrap(),
      provider: providerSchema,
      entry: z.string().min(1).max(4096),
      act: z.enum([...MEMORY_EDIT]),
      text: memoryText,
      fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
      confirmed: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('undoAgentMemory'),
      profileId: profileId.unwrap(),
      sourceId: z.string().min(1).max(1024),
      confirmed: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('checkInterruptedMemory'),
      profileId: profileId.unwrap(),
      confirmed: z.boolean(),
    })
    .strict(),
  /**
   * 🔴 **582 · a person answering one ask an agent made** (`HO-009` §2.2).
   *
   * ⛔ **`askId` and no session**: the ask is answered on the IDENTITY it is about, which is in no
   * conversation. ⚑ The id is what finds the
   * ledger it was written into.
   */
  z.object({
    kind: z.literal('decideInstruction'),
    askId: z.string().min(1).max(200),
    approve: z.boolean(),
  }),
  // A person deciding an agent's request for an MCP server: the id and the press. Strict, so a
  // window that sends anything more (an address, a name, who gets it) is refused before anything
  // happens rather than having the field dropped: what is registered is read from the request.
  z
    .object({
      kind: z.literal('decideMcpServerRequest'),
      requestId: z.string().min(1).max(200),
      approve: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('setSpawningEnabled'), enabled: z.boolean() }),
  z.object({ kind: z.literal('setServicesOn'), on: z.boolean() }),
  /**
   * 🔴 **The mode a person's next conversation begins in** (500, HO-036 §3.1).
   *
   * ⛔ **`z.enum` and not `z.string()`**, which is `setAgentProvider`'s rule two arms up: a window
   * is this app's own code, so a word outside the vocabulary is a bug to fail loudly on rather than
   * a stranger to teach. ⚑ It also means the wire cannot carry the value the store's fold would
   * have to narrow — the fold stays because a ROW can hold a word this wire never accepted, written
   * by an older build or by hand.
   *
   * ⚠️ **Required, not `.optional()`.** There is no *leave it alone* press: the control has two
   * positions and a payload that named neither would be a person's choice this app could not read.
   */
  z.object({ kind: z.literal('setDefaultApprovalMode'), mode: z.enum(['ask', 'auto']) }),
  /**
   * 🔴 **Bring an identity into existence — a person's door** (419, HO-023 §2.4).
   *
   * ⛔ **`agentSlug` is the same `isPathSegment` refinement `profileId` carries, and here it is
   * load-bearing twice over**: the value BECOMES a directory under `provider-homes/`
   * on the first launch, so a value that could spell `..` or a separator would be a path rather than
   * a name — and it is also a primary key derived as `aid:<folded>`, where `:` is deliberately
   * outside the alphabet so no name can spell a separator.
   *
   * ⚠️ **`.nullable()` on both optional facts, and never `.optional()`** (339, HO-005 criterion
   * 10): an absent key and an explicit null are the same value to a `Partial` and are not the same
   * intent, so a payload that drops one fails by name rather than being read as *nobody has said*.
   *
   * ⚑ **`provider` is a `z.enum` here and a `z.string()` on the TOOL**, and the difference
   * is who is on the other side. A window is this app's own code and a malformed payload is a bug to
   * fail loudly on; a model is a stranger that has to be TAUGHT the vocabulary, which is `325`'s
   * rule and why `create_agent` refuses by name instead of letting the transport reject the call.
   */
  z.object({
    kind: z.literal('createAgent'),
    slug: agentSlug,
    displayName: agentDisplayName.nullable(),
    provider: providerSchema.nullable(),
    // A person makes a service only while services are on; the host refuses it otherwise.
    asAService: z.literal(true).optional(),
  }),
]) satisfies z.ZodType<RuntimeCommand>

/** A readable one-line rejection — a raw `ZodError` dump is useless in a UI toast. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ')
}

/**
 * What the shutdown door does with one command. See {@link DURING_A_QUIT}.
 *
 * ⚠️ Named for what the DOOR does, not for what the command is — `answered` never means "safe", it
 * means "this door is not the thing that stops it", and each entry below says which of the two
 * reasons applies to it.
 */
type QuitRuling = 'refused' | 'answered'

/**
 * 🔴 **What every renderer command does once a quit has begun** (273 §2, from `272` finding 1).
 *
 * ## ⛔ The defect this table is the answer to
 *
 * `272` used `271`'s new shutdown report to catch what `271` had left as a stated residual, twice,
 * on clean quits: *"After `close its database`, the old process logged one failed `runtime:command`
 * query for resumable sessions and one for unresumable sessions. Both failed with `The database
 * connection is not open`."* Reproduced here on the shipped entry point by `app-closes-check.mjs`,
 * which now asks for both lists across the quit and fails on that sentence.
 *
 * The two arrive together and not by chance: `closeAll()` ends every conversation, each emits its
 * terminal event, `RuntimeScreen` watches the open list's length, and both surfaces re-read their
 * closed list. So the quit itself is what asks the question the quit then cannot answer.
 *
 * ## ⚠️ Why a table and not a flag in two handlers
 *
 * 273 §2 asks the wider question once: *"the two it found are a floor, not the set"*. A `Record` over
 * {@link RuntimeCommandKind} is the only form of that answer that cannot go stale — a command added
 * to the union does not compile until somebody rules on it here, which is the same reason
 * `ProviderCapabilities` is a closed table.
 *
 * ⛔ **The default is `refused`, and the burden of proof is on the exemptions.** Being wrong in the
 * `refused` direction costs an intentional sentence for a command nobody sends during a quit; being
 * wrong in the other direction is the defect. So `answered` is claimed only where one of exactly two
 * things was checked in the source:
 *
 *  - **it touches no database at all** — `capabilities` returns a constant table, `profiles` is a
 *    `readdir`, `checkCwd` is a path check, `providerUsage` hands back readings held in memory, and
 *    the four credential commands work on provider homes on disk. None of them reads
 *    `deps.store`, directly or below.
 *  - **the host refuses it FIRST, in a better sentence than this door has** — `createSession`, whose
 *    very first statement is `reserve()`, which throws `SessionUnavailable('shutting-down')` before
 *    anything is read. That reason names the conversation and reaches the person as *"BroBot is
 *    shutting down, so this conversation was not opened."*
 *
 * ⚠️ **And the question was asked of the other channels too, once, so it does not have to be asked
 * again.** `runtime:command` is the only one that reaches SQLite: `app:info` reads the packaged
 * version, the three pickers open a dialog and `stat`,
 * `app:classify-attachments` and `app:hand-dropped-paths` `stat`, and `app:paste-image` reads the
 * clipboard and writes a PNG. None of them touches `deps.store`, so none of them needs a door.
 * ⚠️ **Except one, since `744`**: `app:saved-drafts` asks `store.recordedOne` whether each kept
 * draft's conversation still exists — and answers *keep it* once the database is closed
 * (`main/index.ts`' `recordedConversation`), so a window that reloads during a quit gets its drafts
 * rather than a closed connection. `app:save-drafts` writes a file and touches no store.
 *
 * ⚑ **`resume` looks like `createSession` and is NOT it**, which is the one asymmetry worth stating:
 * `resumeSession` reaches `attachHeldSession` before `reserve`, and that reads `store.findLive` and a
 * history window. Two sibling commands, one exempt and one refused, for a difference four call
 * frames down — which is exactly why this is a table somebody had to fill in rather than a rule
 * about "read commands".
 *
 * ## ⚠️ What this door is NOT
 *
 * ⛔ **It is not the reason a clean quit is quiet.** Electron `console.error`s every rejected
 * `ipcMain.handle` with a full stack — measured, not assumed — so a refusal thrown here still prints.
 * What stops the app printing anything on an ordinary quit is the renderer no longer ASKING once it
 * has been told (271's `app:closing`, now read by both closed-conversation lists). This door is the
 * boundary's own guarantee, for the window that did not stop, the surface added later, and the rule
 * that main never depends on a renderer behaving.
 */
const DURING_A_QUIT: Record<RuntimeCommandKind, QuitRuling> = {
  // ── Touches no database ────────────────────────────────────────────────────────────────────────
  capabilities: 'answered',
  profiles: 'answered',
  checkCwd: 'answered',
  // ⚑ Forgets which window looks at a conversation, held in memory only.
  stopLooking: 'answered',

  // ⛔ **The capability door, refused for its neighbours' reason** (355). Both statements are the
  // ledger's. The READ is worth nothing — the surface asking is on a window that is going — and the
  // WRITE is a person widening what an agent may do, which is not a thing to accept in the moment
  // the app stops being able to act on it. ⚠️ `setSpawningEnabled` is refused in BOTH directions and
  // that is deliberate: turning the switch OFF during a quit reads like the one exemption worth
  // making, and it is not one. `admitGive` asks the switch at the moment a give would start a
  // conversation, and by the time this door is closed there is no give left to refuse — so the
  // write would change a row nothing will read before the process ends, and the person would be
  // told it took effect.
  skills: 'refused',
  agentIdentities: 'refused',
  setCapabilities: 'refused',
  // 🔴 **516 · refused, with the capability door above as the precedent and one reason of its own.**
  // ⛔ The statement is the ledger's, and it writes a row only a later LAUNCH could use — and there
  // are no later launches, because `createSession` is already refused by the host. ⚠️ **The reason
  // of its own is that this verb opens a SOCKET**: a registration during a quit would hold the
  // shutdown open on a handshake with a server that may never answer, which is exactly the shape
  // `273` §1 built this door to stop. ⚑ `removeExternalMcpServer` is refused in the same breath and
  // for the capability switch's reason: the narrowing direction is not an exemption either, because
  // nothing is left running for it to narrow.
  registerExternalMcpServer: 'refused',
  removeExternalMcpServer: 'refused',
  // 433. ⛔ **Refused with the capability door it sits beside, and on that door's own argument**: the
  // statement is the ledger's, and the write is a person saying what the NEXT conversation should
  // start on — while there are no next conversations, because `createSession` is already refused by
  // the host. ⚑ A person told the choice took effect would be told about a row nothing will read
  // before the process ends.
  setAgentProvider: 'refused',
  setSpawningEnabled: 'refused',
  // A person turning services on or off while the app quits would be told of a change nothing acts on.
  setServicesOn: 'refused',
  // 500. ⛔ **Refused, and `setAgentProvider` above is the precedent word for word**: this is a
  // person saying what their NEXT conversation should start in, and there are no next conversations
  // — `createSession` is already refused by the host. ⚑ A person told their default took effect, in
  // the moment nothing will ever read it again, would be told about a write rather than about a
  // consequence. ⚠️ And the OFF direction is not an exemption worth making either: nothing is
  // running that this value could narrow, because it has never described a running conversation.
  setDefaultApprovalMode: 'refused',
  // 419. ⛔ **Refused, with the capability door above as the precedent and its argument**: the
  // statement is the ledger's, and it writes a row that only a later LAUNCH could use — and there
  // are no later launches, because `createSession` is already refused by the host. ⚑ An identity
  // created in the moment the app stops being able to act on it would be a person told a creation
  // took effect that nothing will read before the process ends.
  createAgent: 'refused',
  // 558. ⛔ **Refused, with `setAgentProvider` as the precedent word for word**: this is a person
  // configuring an identity, and the surfaces that would re-read the new name are going away with
  // the process. ⚑ A person told their rename took effect, in the moment nothing will draw it
  // again, would be told about a write rather than about a consequence.
  setAgentDisplayName: 'refused',
  // D-016 · commit 7 · R4. ⛔ **Refused, with `setAgentDisplayName` as the precedent**: a person
  // naming work, while the surfaces that would draw the new title are going away with the process.
  retitleWork: 'refused',
  // ⛔ Refused, with `retitleWork` as the precedent: a person acting on work, while the service that
  // would go on to its next piece is closing with the process.
  takeBackWork: 'refused',
  // 677. ⛔ **Refused, with `setAgentProvider` as the precedent word for word**: a person configuring
  // an identity's NEXT conversations, while there are no next launches — `createSession` is already
  // refused by the host. ⚠️ And the door asks a provider for its catalogue, which is a launch of its
  // own, in the moment launches are being closed.
  setAgentModelAndEffort: 'refused',
  // 677. ⛔ **Refused, and a READ**: it touches the database, which is `agentInstructions`' reason one
  // door over — a quit closes the ledger this would read from.
  agentModelAndEffort: 'refused',
  // ⚑ **D-042 · the model list's three doors — refused, `agentModelAndEffort`'s reason**: each reads
  // or writes the database a quit closes, and the list read may ask a provider, which is a launch.
  modelList: 'refused',
  addHandAddedModel: 'refused',
  deleteHandAddedModel: 'refused',
  // 🔒 **The API-key doors — refused, `modelList`'s reason**: each reads or writes the database a
  // quit closes.
  apiKeyStatus: 'refused',
  setApiKey: 'refused',
  removeApiKey: 'refused',
  // ⚑ …and the check, which also asks a provider over the network: nothing a quit should start.
  checkApiKey: 'refused',
  // ⚑ **The Providers screen's reads.** `providerUsage` is held in memory and touches nothing a quit
  // closes, so it is answered. ⛔ The other two start a process — `codex --version`, one process
  // listing — and nothing a quit is ending should start one.
  providerVersions: 'refused',
  // Refused, the default: nothing a person needs from it while the app quits.
  providerSetup: 'refused',
  providerUsage: 'answered',
  providerResources: 'refused',
  // ⚑ The kept rules: a list a person reads and edits from the Providers page — nothing a quit
  // should start.
  keptRules: 'refused',
  removeKeptRule: 'refused',
  // 582. ⛔ **Refused, with `setAgentDisplayName` directly above as the precedent word for word**:
  // this is a person configuring an identity, and the sheet that would re-read the new version is
  // going away with the process. ⚑ And the sharper reason here: what this writes takes effect at
  // the NEXT LAUNCH, so a person told it landed while the app is closing has been told about a
  // write whose consequence they cannot see until the thing that would show it has restarted.
  instructAgent: 'refused',
  // 582. ⛔ **Refused, and it is a READ, which is where it parts company with `capabilities` and
  // `profiles` above.** Those touch no database; this one does — and `DURING_A_QUIT`'s line is the
  // database rather than the direction, because a read that opens a statement against a store the
  // quit is tearing down is the same hazard as a write.
  agentInstructions: 'refused',
  agentMethods: 'refused',
  agentMethodBody: 'refused',
  agentMethodChanges: 'refused',
  removeAgentMethod: 'refused',
  undoAgentMethod: 'refused',
  checkInterruptedAgentMethods: 'refused',
  agentOwnNotes: 'refused',
  agentOwnNotesUnread: 'refused',
  saveOwnNotes: 'refused',
  undoOwnNotes: 'refused',
  markOwnNotesSeen: 'refused',
  agentRulesUnread: 'refused',
  undoAgentRules: 'refused',
  markAgentRulesSeen: 'refused',
  // 625. ⛔ **Refused, with `agentInstructions` directly above as the precedent**, and one reason
  // more: this read walks two provider homes, and a quit that is tearing the app down is the worst
  // moment to start a filesystem walk whose answer nothing will draw.
  agentMemory: 'refused',
  // F093. ⛔ **Refused, with `agentMemory` directly above as the precedent**: it reads the ledger,
  // the files a launch named and the memory stores — the same walk, and more of it.
  whatThisAgentWasGiven: 'refused',
  // F093 · C9 d. ⛔ **Refused, with `whatThisAgentWasGiven` directly above as the precedent**: a read
  // whose answer nothing will draw while the app is going away.
  whatTheModelGot: 'refused',
  // Refused during quit: no new memory change may start while its service is closing.
  amendAgentMemory: 'refused',
  undoAgentMemory: 'refused',
  checkInterruptedMemory: 'refused',
  // 582. ⛔ **Refused**: a decision answered during a quit settles a card nobody will see settle, and the person presses it again on the
  // next launch where the sheet can show them what happened.
  decideInstruction: 'refused',
  // Refused: an approval asks the server what it offers, and a decision during a quit settles a card
  // nobody will see settle. The request waits for the next launch.
  decideMcpServerRequest: 'refused',
  // 558. ⛔ **Refused, and the DESTRUCTIVE direction is not an exemption worth making** — which is
  // `removeExternalMcpServer`'s own ruling above, read at a higher price. ⚠️ A removal answered
  // during a quit is the one write in this app that cannot be looked at afterwards to see whether
  // it landed: the window that asked is closing, and the row it would have re-read is gone. ⚑ A
  // person presses it again on the next launch, where they can see what happened.
  removeAgent: 'refused',
  // ⛔ Refused, for `removeAgent`'s reason: what a person archives or deletes during a quit is
  // pressed again on the next launch, where they can see what happened.
  archiveConversation: 'refused',
  restoreConversation: 'refused',
  checkDeleteConversation: 'refused',
  deleteConversation: 'refused',
  // The credential four (098, 202). They live on provider homes, not in the ledger — and each is
  // already refused during a quit by `launches.open`, `checkProviderAuth` in its own `unknown`
  // vocabulary. ⚑ Left to say so themselves rather than being flattened into one sentence here.
  checkProviderAuth: 'answered',
  reprovisionProviderAuth: 'answered',
  signInProvider: 'answered',
  cancelProviderSignIn: 'answered',

  // ── Refused first by the host, in a sentence that names the conversation ───────────────────────
  createSession: 'answered',

  // ── Everything else: refused at this door ──────────────────────────────────────────────────────
  // The pair `272` measured. They are the reason this table exists and they are ordinary rows in it.
  listResumable: 'refused',
  listUnresumable: 'refused',
  send: 'refused',
  sendInterrupting: 'refused',
  queueMessage: 'refused',
  cancelQueuedMessage: 'refused',
  takeBackAndStop: 'refused',
  respondPermission: 'refused',
  respondUserInput: 'refused',
  resolveLink: 'refused',
  // ⛔ `refused`, for its neighbour's reason: an answer whose asker the quit is ending.
  answerAction: 'refused',
  decideMoveRequest: 'refused',
  interrupt: 'refused',
  stopBackgroundWork: 'refused',
  close: 'refused',
  refreshConfig: 'refused',
  setApprovalMode: 'refused',
  setSessionSetting: 'refused',
  endPlanMode: 'refused',
  adoptSessions: 'refused',
  exportSession: 'refused',
  importBundleFile: 'refused',
  // See the asymmetry with `createSession` above — this one reads before it refuses.
  resume: 'refused',
  // ⚑ **D-017b** · refused with `resume`: it reads the ledger and the row before it answers, and a
  // conversation drawn into a window that is closing is worth nothing.
  look: 'refused',
  // 🔴 **735** · `resume` and a send in one act, refused for both their reasons: it reads and writes
  // the ledger, and it would start a provider into a quit.
  startAndSend: 'refused',
  cancelLaunch: 'refused',
  attachOpen: 'refused',
  // 336. ⚑ Refused for the reason `resume` is, and it is the same reason exactly: it reads
  // `store.findLive` and a history window before it decides anything. ⚠️ And it would be refused on
  // the merits anyway — during a quit every unclaimed session is already being closed by
  // `closeAll`, so a take-over could only hand somebody a conversation that is going away.
  claim: 'refused',
  // 523. ⛔ Refused, and NOT because a hand-back is a read — it touches no database at all, which
  // is the first of the two grounds this table allows. ⚑ It is refused on the SECOND ground: during
  // a quit `closeAll` is already ending every session this host holds, so the only thing a release
  // could do is take a window's name off a conversation that is going away — and it would report
  // `unwatched` for a slot one step from `not-running`, which is a truthful answer to a question
  // nobody should be able to ask. ⚠️ `refused` is also the cheap side to be wrong on.
  release: 'refused',
  // ⛔ **398 · `refused`, and it is the reading that costs nothing to be wrong about.** It reads
  // `deps.store` — three statements and two folds — which is the one thing this door exists to keep
  // out of a quit. ⚠️ The `answered` case would have to be argued from *"a read is harmless"*, and
  // this table's own note says why that argument is not available here: the ruling is per COMMAND
  // and per what the source was checked to touch, never per a category like "read commands".
  questionsForAPerson: 'refused',
  // ⛔ **403 · `refused`, for its neighbour's reason exactly.** One `SELECT DISTINCT` and a fold
  // per candidate ledger — a store read, which is the one thing this door exists to keep out of a
  // quit. ⚠️ And there is nothing a person could do with the answer during a quit: the window that
  // asked is going away, and the row it names is durable and will be there at the next launch.
  decisionsForAPerson: 'refused',
  // ⛔ **533 · `refused`, for its two neighbours' reason exactly.** One indexed read over the
  // error rows of the last month plus a count — a store read, which is the one thing this door
  // exists to keep out of a quit. ⚠️ And there is nothing a person could do with the answer while
  // the window is going away: a wall ends on the provider's own word — its clock, or its next
  // answer (`586`) — the rows it was read from are durable, and the next launch reads the same ones.
  limitsForAPerson: 'refused',
  readLimitsDisplay: 'refused',
  // ⛔ **D-017 · R19 · `refused`, for its neighbours' reason exactly**: a store read, and the asks
  // are durable rows the next launch reads again.
  instructionAsksForAPerson: 'refused',
  // Refused for its neighbours' reason: a store read of durable rows the next launch reads again.
  mcpServerRequestsForAPerson: 'refused',
  // ⛔ **557 · `refused`, for its four neighbours' reason exactly.** It reads `deps.store` — one
  // indexed candidate query plus a piece fold per ledger — which is the one thing this door exists
  // to keep out of a quit. ⚠️ And nothing is lost by refusing it during one: the rows are durable,
  // nothing about a stall changes because a window went away, and the next launch reads the same
  // ones.
  stalledWorkForAPerson: 'refused',
  // ⛔ `refused`, for its neighbour's reason: a store walk, over rows the next launch reads again.
  stoppedWorkForAPerson: 'refused',
  // ⛔ `refused`, for its neighbour's reason: a store walk, over rows the next launch reads again.
  workIncidentsForAPerson: 'refused',
  // ⛔ **F097 · `refused`, for its neighbour's reason exactly**: one indexed candidate query plus a
  // piece fold per ledger — a store read — and the wait is durable rows the next launch reads again.
  waitingOnWhoWroteForAPerson: 'refused',
  // ⛔ **438 · `refused`, and its two neighbours' reading exactly.** It reads `deps.store` — one
  // statement plus a count — which is the one thing this door exists to keep out of a
  // quit. ⚠️ Ruled per COMMAND and on what the source was checked to touch, never on the category
  // *"it is only a read"*.
  digest: 'refused',
  recentActivity: 'refused',
  // ⛔ **`refused`, on the default rather than on an argument** (508): it reads `deps.store`, which
  // is the one thing this door's own rule says earns the word without further discussion.
  workGivenBy: 'refused',
  // ⛔ **543 · `refused`, on the default rather than on an argument** — `workGivenBy`'s reading
  // exactly: it reads `deps.store`, which is the one thing this door exists to keep out of a quit.
  // ⚠️ And there is nothing a person could do with the answer while the window is going away: every
  // edge it names is durable and the next launch reads the same rows.
  whoCalledWhom: 'refused',
  // ⛔ **567 · `refused`, on the default rather than on an argument** — `whoCalledWhom`'s reading
  // exactly: it reads `deps.store`, which is the one thing this door exists to keep out of a quit.
  // ⚠️ And a COUNT is the least useful thing to answer during one: the window that asked is going
  // away, the number would be about a workspace that is closing, and the next launch reads the same
  // rows. ⛔ **And it would be actively wrong to answer**: `closeAll` is ending sessions while the
  // quit runs, so an `open` count taken mid-teardown is a reading of a moment nobody was in.
  readWorkspace: 'refused',
  // ⛔ **575 · `refused`, and this one does not even reach the store.** It reads the SLOT MAP,
  // which `closeAll` is emptying while the quit runs — so the answer would be a picture of a
  // teardown rather than of the app, which is `readWorkspace`'s last clause with the population
  // changed. ⚠️ And there is nothing a person could do with it: the window that asked is going
  // away and every conversation it names is being closed.
  whatIsBeingDone: 'refused',
  // ⛔ **621 · `refused`, for the line above's reason plus one of its own.** ⚑ It walks the SLOT
  // MAP that `closeAll` is emptying, AND it opens three ledgers per conversation — so during a quit
  // it would be a picture of a teardown bought with reads the app is shutting down around.
  whatEachConversationIsWaitingOn: 'refused',
  // ⛔ **637 · `refused`, for the line above's reason and one of its own.** ⚑ It walks the SLOT MAP
  // that `closeAll` is emptying for `running`, AND it folds one ledger per drawn conversation — so
  // during a quit it would be the most expensive picture this app can take, of a teardown, bought
  // with reads the app is shutting down around.
  theWholeForest: 'refused',
  // ⛔ **D-018 · `refused`, for `whatIsBeingDone`'s reason**: it walks the SLOT MAP that `closeAll`
  // is emptying, and would fork a `ps` about the very processes the quit is stopping. ⚠️ And the
  // window that asked is going away: a figure for a process on its way out is worth nothing.
  processMemory: 'refused',
  listLibrary: 'refused',
  importRecordedSession: 'refused',
  importUserHomeSession: 'refused',
  rebuildLedger: 'refused',
  readWorkflowOutput: 'refused',
  // 356. Refused with its neighbours — it goes through the session store, and a document opened on a
  // window that is closing is worth nothing.
  readInstructionSource: 'refused',
  // 356. ⛔ Refused, and this one for a reason of its own: a reveal raises a FILE MANAGER WINDOW, and
  // a quit that scattered Finder windows behind itself would be the app arguing with the gesture
  // that ended it.
  revealPath: 'refused',
  // 733. Refused with `readInstructionSource`, for its reason: a file opened on a window that is
  // closing is worth nothing — and it reads the slot map and then the disk, which is what a quit
  // keeps out.
  readConfigFile: 'refused',
  // 300. Refused for the reason `readChildState` is, and with less to weigh: it is a buffer read on
  // a window that is closing, and a tail nobody will see is worth nothing.
  readCommandOutput: 'refused',
  // 462. Refused with it, and the weighing is the same one: a panel raised on a window that is
  // closing is a panel nobody reads. ⚠️ **And the answer is not durable**, so there is nothing a
  // refusal here can cost a person that the quit was not already going to cost them.
  readToolAnswer: 'refused',
  // ⛔ **510 · `refused`, and its five neighbours' reading exactly.** It reads `deps.store` — one
  // primary-key lookup — and then the disk, which is the one thing this door exists to keep out
  // of a quit. ⚠️ Ruled per COMMAND and on what the source was checked to touch, never on the
  // category *"it is only a read"*. ⚑ And a resource opened on a window that is closing is worth
  // nothing: the row is durable and will be there at the next launch.
  readResource: 'refused',
  // ⛔ **D-032 · `refused`, `readResource`'s reading**: a store lookup, then up to 16 MiB off the
  // disk, for a viewer on a window that is closing.
  drawResource: 'refused',
  // ⛔ **D-032 · `refused`, `revealPath`'s reason**: a quit that raised a Finder window behind
  // itself would be arguing with the gesture that ended it.
  revealResource: 'refused',
  // A quit is no moment to stat files for a message, open an app or raise a file manager window.
  resolveMessagePaths: 'refused',
  openMessagePath: 'refused',
  revealMessagePath: 'refused',
  // ⛔ **D-026 · `refused`, on the default rather than on an argument** — `whoCalledWhom`'s reading:
  // it reads `deps.store`, the one thing this door exists to keep out of a quit, and every file it
  // lists is durable and read the same at the next launch.
  filesKept: 'refused',
  filesLibrary: 'refused',
  teamProfileGraph: 'refused',
  searchWork: 'refused',
  readChildWork: 'refused',
  // 296. Both refused, and the send is the easier of the two to rule on: a quit is the moment this
  // app stops starting work, and a message to a child starts a turn. ⚠️ The READ is refused for the
  // ordinary reason its neighbours are — it goes through the session store — and it would be a poor
  // trade anyway: the viewer that polls it is on a window that is closing.
  readChildState: 'refused',
  sendToChild: 'refused',
  earlierHistory: 'refused',
  latestHistory: 'refused',
}

/**
 * The one sentence a refused command gets, in the family every other shutdown refusal is already in
 * — *"BroBot2 is shutting down, so X was not Y"* (070, 098, 100, 202).
 *
 * ⚠️ **It names the command**, because this string reaches two readers with opposite needs: a
 * developer reading a quit's output, who has to know WHICH request was still in flight, and a person
 * whose list shows its `loadError` for the fraction of a second before the window goes. The wire word
 * is the cheapest thing that serves the first without lying to the second.
 */
export function refusedDuringAQuit(kind: RuntimeCommandKind): string {
  return `BroCrew is shutting down, so ${kind} was not asked of its database`
}

/**
 * 🔴 **The sentence a capability verb refuses with, and the fact it refuses on** (355, on 349).
 *
 * ## ⛔ Why a capability door needs a gate that a conversation's door does not
 *
 * `341` built the rails and deliberately built no door, so that *"the surface that eventually edits
 * capabilities arrives as a deliberate act rather than as a consequence"*. `355` is that act, and
 * the act it must not also be is **an agent widening what agents may do**. A conversation's verbs
 * on this wire are gated by ownership.
 *
 * ⚠️ **Capabilities are not about one conversation.** They are app-wide, and they are the thing an
 * agent would most want to change about itself. So the gate is not ownership; it is `349`'s
 * question: **is a person behind this call at all.**
 *
 * ⚑ **`RuntimeEventSink.aPersonIsBehindIt` is that answer and it already exists.** Exactly one
 * thing in this app declares it true — the window sink, below — and `349` built it precisely so
 * that owning a session would stop being, by itself, a claim to be a person. This is its first
 * reader at the IPC layer, and reading it changes nothing about the declaration: the census that
 * pins one `aPersonIsBehindIt: true` in all of `src/main` stays exactly as green as it was.
 *
 * ⛔ **It throws rather than answering a refusal value.** A refusal payload is HO-005 criterion 4's
 * shape for a rail a MODEL has to reason about; this is not one. Nothing that can legitimately
 * reach this door can fail it, so a caller that does is a caller that should never have been built,
 * and an `Error` with a sentence is what says so.
 */
export function noPersonBehindIt(kind: RuntimeCommandKind): string {
  const does = WHAT_A_PERSONS_VERB_DOES[kind] ?? 'changes what agents are allowed to do'
  return `${kind} ${does}, so it is refused unless a person is asking`
}

/**
 * ⚑ **What each person's verb does, as its refusal says it** — a read says it reads. ⚠️ A verb not
 * listed changes what agents are allowed to do: their grants, their tools, how far they may go
 * without asking, or which agents there are.
 */
const WHAT_A_PERSONS_VERB_DOES: Partial<Record<RuntimeCommandKind, string>> = {
  skills: 'reads and saves skills and agent choices',
  agentIdentities: 'reads every agent and what each may do',
  agentInstructions: 'reads an agent’s own instructions',
  agentMethods: 'reads saved methods',
  agentMethodBody: 'reads a saved method',
  agentMethodChanges: 'reads saved-method history',
  removeAgentMethod: 'removes a saved method',
  undoAgentMethod: 'undoes a saved-method change',
  checkInterruptedAgentMethods: 'checks an interrupted saved-method change',
  agentOwnNotes: 'reads an agent’s own notes',
  agentOwnNotesUnread: 'reads unread own-notes changes',
  saveOwnNotes: 'saves an agent’s own notes',
  undoOwnNotes: 'undoes the latest own-notes change',
  markOwnNotesSeen: 'marks displayed own-notes changes as read',
  agentRulesUnread: 'reads unread standing-rule changes',
  undoAgentRules: 'undoes the latest standing-rule change',
  markAgentRulesSeen: 'marks displayed standing-rule changes as read',
  agentMemory: 'reads an agent’s own memory',
  agentModelAndEffort: 'reads the model an agent starts on',
  modelList: 'reads the models a provider offers',
  whatThisAgentWasGiven:
    'reads everything an agent was given: its instructions, its tools and its memory',
  whatTheModelGot: 'reads a message as the model got it, with the agent’s own instructions',
  checkApiKey: 'asks a provider whether a key works',
  setApiKey: 'sets a provider’s key',
  removeApiKey: 'removes a provider’s key',
  addHandAddedModel: 'adds a model to a provider’s list',
  deleteHandAddedModel: 'removes a model from a provider’s list',
  instructAgent: 'changes an agent’s own instructions',
  decideInstruction: 'approves or declines rules proposed for an agent',
  amendAgentMemory: 'changes an agent’s own memory',
  undoAgentMemory: 'undoes a change to an agent’s memory',
  checkInterruptedMemory: 'records what happened to an interrupted memory change',
  setAgentDisplayName: 'renames an agent',
  setAgentModelAndEffort: 'sets the model an agent starts on',
  setAgentProvider: 'sets the provider an agent runs on',
  retitleWork: 'renames a piece of work',
  takeBackWork: 'takes back a piece of work',
}

/** Throw {@link noPersonBehindIt} unless the channel this arrived on declares a person behind it. */
function requireAPerson(sink: RuntimeEventSink, kind: RuntimeCommandKind): void {
  if (!sink.aPersonIsBehindIt) throw new Error(noPersonBehindIt(kind))
}

/**
 * Validate one command and run it against the host. Every rejection carries a readable message,
 * which `ipcMain.handle` propagates to the renderer's awaiting promise — ⚠️ **as `toString()`, so as
 * `${name}: ${message}`**, which is why {@link registerRuntimeIpc} re-throws a named class as a
 * plain `Error` (675). Rejections that are already plain pass through as they were.
 *
 * ## Where the `user_command` breadcrumbs are written, and why it differs by command (097)
 *
 * This is the layer that records WHICH control the user pressed, because it is the only layer that
 * knows a person pressed one — the window closing underneath a session and the app quitting call
 * the same host methods and correctly leave no trail. See {@link UserCommandEvent}.
 *
 * ⚠️ **Two placements, one rule, and the first version of this got it wrong twice** (review):
 *
 *  - **Before the call** for gestures that act on the conversation AS IT IS — `close`, `interrupt`,
 *    `sendInterrupting`, `endPlanMode`. Each of them either destroys the thing being written to,
 *    terminalizes the turn the breadcrumb has to attach to, or composes two operations of which the
 *    first can land and the second throw. Recorded afterwards, every one of them loses exactly the
 *    fact it exists to record.
 *  - **After the call** for `setApprovalMode` and `setSessionSetting`, whose breadcrumb carries an
 *    OBJECT — the setting's new value. That value is only true once the provider has accepted it,
 *    and `changed_model → X` written before a provider refused X would be a fact about a session
 *    that never existed.
 *
 * The cost of "before" is stated rather than hidden: a command refused after the note leaves a
 * breadcrumb for a gesture that did not take effect. That is bounded — each of these four either
 * cannot be refused, refuses only for a session `noteUserCommand` also skips, or refuses with an
 * error the user is shown — and it is the cheaper mistake than the one 085 actually reported.
 *
 * ⛔ **203 broke the middle clause of that sentence and repaired it in `noteUserCommand` rather
 * than here.** `close` can now be refused for a session that function would happily write to — a
 * foreign window forging `closed` into somebody else's ledger — so the skip it already performs for
 * an unknown session performs for an unowned one too. The placement rule above is unchanged.
 *
 * ## Who is asking (203, from 195 H1)
 *
 * ⛔ **Every session-scoped CONTROL verb below passes `sink`, and that is not a convenience.** The
 * sink is the only trustworthy statement of who is asking — it is the channel the ask arrived on,
 * not a value the caller typed — and {@link RuntimeHost.require} now demands one. Before this,
 * `create`, `resume`, `cancelLaunch` and `attachOpen` took it and the other thirteen did not: a
 * window that `attachOpen` returned nothing for and `resume` refused could still approve another
 * window's tool, inject a message, change its approval mode, interrupt it or close it, with an id
 * `listLibrary` hands out by design.
 *
 * ⚠️ **The READ verbs deliberately do not pass it, and that is 064's line rather than an omission.**
 * `earlierHistory`, `latestHistory`, `exportSession` and the two
 * `read*Work` commands answer about a conversation without driving it — the session library is
 * built on exactly that, and scoping reads to the owning window would break reading a running
 * conversation from the library, which is a feature. `latestHistory` does hand over a pending
 * request id and the decisions it offers; what 203 removes is the ability to USE one.
 */
export async function executeRuntimeCommand(
  host: RuntimeHost,
  sink: RuntimeEventSink,
  raw: unknown,
): Promise<unknown> {
  const parsed = runtimeCommandSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`invalid runtime command: ${describeIssues(parsed.error)}`)
  }
  const command = parsed.data
  // 🔴 **The shutdown door** (273 §1) — see {@link DURING_A_QUIT} for what it refuses and why the
  // exemptions are exemptions.
  //
  // ⚠️ **After the parse and before the switch**, and both halves of that are deliberate. After,
  // because the ruling is per command and there is no kind to rule on until the wire has been
  // checked — an unparseable payload is still an unparseable payload during a quit, and saying so is
  // more use than "we are shutting down". Before, because the whole point is that nothing reaches a
  // host method: a refusal written inside one would be the try/catch 273 §1 forbids, hiding the call
  // rather than stopping it.
  if (host.closing && DURING_A_QUIT[command.kind] === 'refused') {
    throw new Error(refusedDuringAQuit(command.kind))
  }
  switch (command.kind) {
    case 'createSession':
      try {
        const created = await host.createSession(
          {
            provider: command.provider,
            cwd: command.cwd,
            approvalMode: command.approvalMode,
            profileId: command.profileId,
            reasoningEffort: command.reasoningEffort,
            model: command.model,
            planMode: command.planMode,
            // The max-effort orchestration mode (106) — and the line above is why this one has a test
            // of its own. Every other launch setting lands in a session row that a later assertion
            // can read; this one is deliberately recorded nowhere, so a drop here would be invisible
            // everywhere downstream. `runtime-ipc.test.ts` asserts it where it lands, and did in fact
            // catch this exact omission on the first run.
            ultracode: command.ultracode,
            // ⚠️ **Every field is listed by hand here, and 102's review found what that costs.** The
            // schema accepted `launchKey`, the renderer sent one, and this rebuild dropped it — so
            // every slot was reserved with `launchKey: null` and the launcher's Cancel could never
            // find the launch it was pressed on. A dead button, with a passing test suite on both
            // sides of it, because nothing crossed this line. `launch-deadline.test.ts` does now.
            launchKey: command.launchKey,
          },
          sink,
        )
        // 🔴 **D-042 · R2 — a model a PERSON named for a new conversation is their last pick** on that
        // provider — written here, the one door that knows a window asked, from what the launch
        // named, ⛔ when the list holds it ({@link RuntimeHost.aPersonPicked}). ⚑ Not awaited: the
        // conversation is made either way, and its answer waits on no list.
        if (
          command.model !== undefined &&
          sink.aPersonIsBehindIt &&
          created.settings.model !== null
        ) {
          void host.aPersonPicked(created.provider, created.profileId, {
            model: created.settings.model,
            effort: created.settings.reasoningEffort,
          })
        }
        return created
      } catch (error) {
        // 🔴 **716 · `710` F-7 — a refusal the caller asked to have ANSWERED**, with its word
        // ({@link whyALaunchWasRefused}). ⚑ `said` is the message a rejection would have carried;
        // ⛔ a failure with no word is still thrown, and so is every refusal nobody asked about.
        const reason = command.answerARefusal === true ? whyALaunchWasRefused(error) : null
        if (reason === null) throw error
        // ⚑ **…and logged, whole** (review of `716`): Electron prints every REJECTED handler with its
        // stack and cause, and nothing prints an answer — so without this line a missing program's
        // own words (its `cause`) would be recorded nowhere.
        console.warn(`runtime command createSession was refused (${reason}) and answered:`, error)
        return { refused: { reason, said: error instanceof Error ? error.message : String(error) } }
      }
    case 'send':
      return await host.send(command.sessionId, command.text, sink, command.attachments)
    case 'sendInterrupting':
      // ⚠️ **085's breadcrumb moved INTO `sendInterrupting` in 150** (148 L2). Written here it ran
      // before the sign-in gate, so a refused turn left the ledger saying the user had interrupted
      // one — a gesture that did not happen (039). It is now written on the far side of that gate
      // and still ahead of the interrupt, which keeps the reason it was early in the first place:
      // an interruption that lands and a send that then throws must not vanish.
      //
      // ⚠️ The text is deliberately still not part of it — the `user_turn` holds it, and the
      // breadcrumb is a verb rather than a second copy of the message.
      return await host.sendInterrupting(command.sessionId, command.text, sink, command.attachments)
    case 'queueMessage':
      return await host.queueMessage(command.sessionId, command.text, sink, command.attachments)
    case 'cancelQueuedMessage':
      return await host.cancelQueuedMessage(command.sessionId, command.messageId, sink)
    case 'takeBackAndStop':
      return await host.takeBackAndStop(command.sessionId, command.messageId, sink)
    case 'respondPermission':
      return await host.respondPermission(
        command.sessionId,
        command.requestId,
        command.decision,
        sink,
      )
    case 'resolveLink':
      // A link reads only its target's indexed facts, without a whole-window snapshot.
      return host.resolveLink(command.target)
    case 'decideMoveRequest':
      if (!sink.aPersonIsBehindIt) throw new Error(MOVE_WORDS.personOnly)
      return await host.decideMoveRequest(command, sink)
    case 'respondUserInput':
      return await host.respondUserInput(
        command.sessionId,
        command.requestId,
        command.response,
        sink,
      )
    case 'answerAction':
      return await host.answerAction(
        command.sessionId,
        command.request,
        command.done,
        command.note ?? null,
        sink,
      )
    case 'interrupt':
      // ⚠️ **BEFORE, and this one was written the other way round and was WRONG** (097 review,
      // finding 1). `handle.interrupt()` terminalizes the running turn from inside its own promise:
      // the `turn` event is pushed to the queue, the pump delivers it, and `appendTx` closes the
      // turn row — all on microtasks that land BEFORE the `await` here resumes. `sendInterrupting`
      // already documents that ordering as a fact found in review. So a breadcrumb written after
      // the await arrives to find no open turn, and `turnFor` stamps it `null` — the ONE gesture
      // whose whole value is being attached to the turn it stopped, detached from it.
      //
      // Refusal costs nothing: `host.interrupt`'s entry rails reject via `require()` for a session
      // that is unknown or still starting, and `noteUserCommand` is a silent no-op in exactly those
      // cases. ⚠️ Since `720` (`709` F-6) it can also reject AFTER the breadcrumb: a provider that
      // refuses the interrupt inside the bounded wait — and that is a Stop the person did press.
      host.noteUserCommand(command.sessionId, 'interrupted', sink)
      return await host.interrupt(command.sessionId, sink)
    case 'stopBackgroundWork':
      // ⚠️ **No breadcrumb, and that is a decision rather than an omission** (097). `UserCommandEvent`
      // has a CLOSED set of commands, every one of which changes the CONVERSATION's own state — the
      // turn that stopped, the session that closed, the mode that changed — so the transcript can
      // say "you did this" beside the effect. This changes one detached command and leaves the
      // conversation exactly as it was, and its effect already arrives as its own event: the
      // `background_work.ended` carrying `stopped`. A breadcrumb here would be a second telling of
      // one fact, which is 246's whole subject.
      return await host.stopBackgroundWork(command.sessionId, command.id, sink)
    case 'close':
      // BEFORE, per the rule above: a close destroys the thing being written to, and `close()`
      // cannot be refused anyway (it is a tolerant no-op on a session that has already ended).
      // Recorded after, this breadcrumb would exist for no close at all.
      //
      // ⚠️ A second Close on a session already tearing down writes a second row. That is not a
      // duplicate of one gesture: the button really was pressed twice, and a ledger that hid the
      // second press would be answering "which control produced this" less well, not better.
      host.noteUserCommand(command.sessionId, 'closed', sink)
      return await host.close(command.sessionId, sink)
    case 'refreshConfig':
      return host.refreshConfig(command.sessionId, sink)
    case 'setApprovalMode': {
      const result = await host.setApprovalMode(command.sessionId, command.mode, sink)
      host.noteUserCommand(command.sessionId, 'changed_approval_mode', sink, command.mode)
      return result
    }
    case 'setSessionSetting': {
      const result = await host.setSessionSetting(
        command.sessionId,
        command.body.kind === 'model'
          ? { kind: 'model', model: command.body.value }
          : command.body.kind === 'reasoningEffort'
            ? { kind: 'reasoningEffort', effort: command.body.value }
            : { kind: 'planMode', on: command.body.on },
        sink,
      )
      // The value is carried as the breadcrumb's object; ABSENT means the user cleared it back to
      // the provider's own default, which is a different gesture from choosing a model that happens
      // to be the default one, and the ledger can now tell them apart.
      host.noteUserCommand(
        command.sessionId,
        command.body.kind === 'model'
          ? 'changed_model'
          : command.body.kind === 'reasoningEffort'
            ? 'changed_effort'
            : 'entered_plan_mode',
        sink,
        command.body.kind === 'planMode' ? undefined : command.body.value,
      )
      return result
    }
    case 'endPlanMode':
      // 085's own case, and the two endings are kept apart because they are different decisions:
      // leaving planning is *"I am done proposing"*, starting the plan is *"do this"*. The text is
      // not carried — the `user_turn` the second one produced is already the record of it.
      //
      // ⚠️ BEFORE, per the rule above, and this one was written the other way and was wrong (097
      // review, finding 3). `endPlanMode` COMPOSES a mode change and a send: the mode change is
      // committed and published, then the send can throw. Written afterwards, the case where plan
      // mode really ended and the message did not go — the case a reader most needs explaining —
      // is the exact case that left no trace. Its up-front refusals happen before anything moves
      // AND raise an error the user sees, so a breadcrumb beside one is a visible pair, not a
      // silent lie.
      host.noteUserCommand(
        command.sessionId,
        command.text === undefined ? 'left_plan_mode' : 'started_the_plan',
        sink,
      )
      return await host.endPlanMode(command.sessionId, sink, command.text)
    case 'listResumable':
      return host.readForWindow(() => host.resumableSessions())
    case 'listUnresumable':
      return host.readForWindow(() => host.unresumableSessions())
    case 'adoptSessions':
      // Awaited like every other async host call here: it became one in 046, when importing moved
      // to the streaming path, and a bare `return` of a promise would be the only case in this
      // switch whose rejection is not this function's to own.
      return await host.adoptSessions()
    case 'exportSession':
      // ⚑ **633 · the whole command, not two fields** — one kind carries a body and the TYPE is
      // what says which, so the host is handed the payload rather than a pair somebody has to keep
      // in step. ⛔ `readingBody` arrives as `readingBody`; the host reads `body`, so the one
      // translation lives here where the wire's own name is chosen.
      // ⛔ **The pairing is refused HERE, once, because the schema could not say it** — see the
      // `readingBody` note above. ⚠️ A `reading` with no body is a caller that named a kind and
      // sent nothing to write; saying so is better than a host arm reached with `undefined`.
      if (command.exportKind === 'reading') {
        if (command.readingBody === undefined) {
          throw new Error('a readable export needs the composed body')
        }
        return await host.exportSession({
          sessionId: command.sessionId,
          exportKind: 'reading',
          body: command.readingBody,
        })
      }
      if (command.readingBody !== undefined) {
        throw new Error(
          `only a readable export carries a body, and this one is ${command.exportKind}`,
        )
      }
      return await host.exportSession({
        sessionId: command.sessionId,
        exportKind: command.exportKind,
      })
    case 'importBundleFile':
      return host.importBundleFile(command.path)
    case 'resume':
      // ⚑ **D-017 · R1** — joins a start a delivery is already making, then takes or attaches it.
      return await host.reopenForAPerson(command.sessionId, sink, command.launchKey ?? null)
    case 'look':
      // ⚑ **D-017b** — the owner and the sink change in one block when a press takes a conversation,
      // and the page is read in the same block; only a life whose provider has said it is over is
      // waited out first (`RuntimeHost.look`).
      return await host.look(command.sessionId, sink, command.claim === true)
    case 'stopLooking':
      // ⚑ Whose look ends comes from the channel, so a window cannot end another window's.
      return host.stopLooking(command.sessionId, sink.ownerId)
    case 'startAndSend':
      // 🔴 **735 · `701` F-8** — see `RuntimeHost.startAndSend`. ⚑ A refusal it can name is ANSWERED
      // (`FirstMessageAnswer`), with its word, and logged there.
      return await host.startAndSend(
        command.sessionId,
        command.text,
        sink,
        command.attachments,
        command.launchKey ?? null,
      )
    case 'cancelLaunch':
      // ⚠️ The owner comes from the SINK, never from the command (102). A window may only cancel
      // what it started, and the only trustworthy statement of who is asking is the channel the ask
      // arrived on — the same reason `attachOpen` takes no parameters.
      return await host.cancelLaunch(command.launchKey, sink.ownerId)
    case 'attachOpen':
      // Synchronous host-side, and returned without an `await`: there is nothing asynchronous to
      // wait for, and adding one would open a window in which a session could be torn down between
      // being attached and being reported.
      return host.attachOpenSessions(sink)
    case 'questionsForAPerson':
      // ⛔ **A read, and it takes no sink and no owner** (398). Every other verb in this switch acts
      // on one conversation and is gated by who holds it; this one asks what has been left waiting
      // on a PERSON, which is a question about the app rather than about a session. ⚠️ There is
      // nothing here to entitle: a window that can reach this IPC channel is already a surface a
      // person is sitting at — and it is on no agent's toolset. ⚑ **D-046 · it carries each
      // question's words**, which the person it is waiting on is the one to read; a window may
      // already read any conversation they sit in. ⛔ And never a refused request's: the store's
      // reader leaves out by name every request only a person may settle at its card — a
      // permission, a grant, a consent, a secret, a server's form — so none of their words cross.
      return host.readForWindow(() => host.questionsForAPerson())
    case 'decisionsForAPerson':
      // ⛔ **A read, and it takes no sink and no owner** (403) — `questionsForAPerson`'s note: ids,
      // one named hop, the line and the vocabulary's own sentence for the refusal. A row whose
      // conversation no window holds also carries the request as its card draws it, so the person
      // it waits on can read and answer it there. This read is on no agent's toolset, so a parent
      // still never reads a permission's words.
      return host.readForWindow(() => host.decisionsForAPerson())
    case 'limitsForAPerson':
      // ⛔ **A read, and it takes no sink and no owner** (533) — `questionsForAPerson`'s note, and
      // this is the NARROWEST payload of them. ⚠️ Nothing of a conversation
      // crosses here at all: every field is the provider's own statement about the provider's own
      // account — which provider, which metered window, when it resets, and the sentence the
      // adapter already wrote (⚑ F096: or, for a window near its limit, this app's own sentence from
      // the provider's own usage figure — `wallsFromUsage`). ⛔ No request text, no prompt, no
      // assignment, and not even the id of the conversation the line was recorded in.
      return host.readLimitsForWindow()
    case 'readLimitsDisplay':
      return host.readLimitsDisplay()
    case 'instructionAsksForAPerson':
      // ⛔ **A read, and it takes no sink and no owner** — `questionsForAPerson`'s note. ⚑ The asks
      // are what `agentInstructions` already hands the window for one identity, for every one.
      return host.instructionAsksForAPerson()
    case 'mcpServerRequestsForAPerson':
      // A read, and it takes no sink and no owner, as its neighbour above.
      return host.mcpServerRequestsForAPerson()
    case 'stalledWorkForAPerson':
      // This read sends the window the assignment text, piece number, holder and giver names,
      // what stopped the work and who asked for the stop. It sends no request text, prompt or
      // transcript, and nothing the person could not already read on the Work tab.
      // The store walk uses no worker snapshot, so it waits for no routing read.
      return host.stalledWorkForAPerson()
    case 'stoppedWorkForAPerson':
      // A read, and it takes no sink and no owner, as its neighbour above. It reads no routing, so
      // it waits for no window snapshot.
      return host.stoppedWorkForAPerson()
    case 'workIncidentsForAPerson':
      // A read, and it takes no sink and no owner, as its neighbours. It sends each piece's label,
      // title, holder and giver names and what is wrong with it; no brief and no transcript.
      return host.workIncidentsForWindow()
    case 'waitingOnWhoWroteForAPerson':
      // This read sends the window the piece's label, title, holder name and the moment its turn
      // ended. It sends no brief, prompt, transcript or the person's own words.
      // The store walk uses no worker snapshot, so it waits for no routing read.
      return host.waitingOnWhoWroteForAPerson()
    case 'recentActivity':
      return host.recentActivity({ from: command.from, to: command.to })
    case 'digest':
      // ⛔ **A read, and it takes no sink and no owner** (438) — `questionsForAPerson`'s note, a
      // third time. ⚠️ **No request text, no prompt and no assignment text crosses here**: the
      // payload is composed sentences about counts, an agent's own report of how its work went,
      // and a list of what could not be answered. ⚑ Synchronous, like its neighbours, so there is
      // no `await`: the host folds rows it has already read.
      return host.digest(command.from, command.to)
    case 'workGivenBy':
      // ⛔ **A read, and it takes no sink and no owner** (508) — `digest`'s note, one verb over.
      // ⚠️ **No `requireAPerson`**: the answer is what THIS window's conversation
      // handed out, and no agent reaches this door — `list_tasks` is the toolset's own way in and
      // it goes through `pieceBoard`. ⚑ Synchronous: the host folds rows it has already read.
      return host.workGivenBy(command.sessionId)
    case 'whoCalledWhom':
      // ⛔ **A read, and it takes no sink and no owner** (543) — `workGivenBy`'s note, one verb
      // over. ⚠️ **No `requireAPerson`**: it discloses this app's own record of which conversation
      // started which and which handed work to which, offers no act at all, and no agent reaches
      // this door — an agent asking about its own children has `list_agents` and `list_tasks`, both
      // through their own rails. ⚑ **Synchronous, and here that is load-bearing rather than an
      // economy**: {@link WhoCalledWhom.readAt} is one completion point over four walks, and an
      // `await` anywhere between them would be a moment a write could land in one list and not the
      // others — see that field, which carries the whole argument.
      return host.whoCalledWhom(command.sessionId)
    case 'readWorkspace':
      // ⛔ **A read, and it takes no sink and no owner** (567) — `whoCalledWhom`'s note one verb
      // over. ⚠️ **No `requireAPerson`**: it discloses two numbers about this app's own workspace,
      // offers no act at all, and no agent reaches this door. ⚑ **Synchronous, and here that is
      // load-bearing rather than an economy**: `WorkspaceReading.readAt` is one completion point
      // over every read it makes, and an `await` anywhere between them would be a moment a write
      // could land in one count and not the other — see that field, which carries the whole
      // argument. ⚠️ **No number here on purpose** — a count in prose is a claim nothing asserts
      // (`a-number-can-survive-the-death-of-its-derivation`).
      return host.readForWindow(() => {
        return host.readWorkspace()
      })
    case 'whatIsBeingDone':
      // ⛔ **A read, and it takes no sink and no owner** (575) — `readWorkspace`'s note one verb
      // over. ⚠️ **No `requireAPerson`**: it discloses what this app's own live conversations were
      // last told they are doing, offers no act at all, and no agent reaches this door. ⚑
      // **Synchronous, and here that is load-bearing rather than an economy**: `WhatIsBeingDone.readAt`
      // is one completion point over every row, and an `await` anywhere between them would be a
      // moment a session could move between two rows and land in one of them.
      return host.readForWindow(() => host.whatIsBeingDone())
    case 'whatEachConversationIsWaitingOn':
      // ⛔ **A read, and it takes no sink and no owner** (621) — `whatIsBeingDone`'s note one verb
      // over, and the same three clauses. ⚠️ **No `requireAPerson`**: it names no conversation, so
      // `203`'s owner check has nothing to be about, and it offers no act. ⚑ **Synchronous, and
      // load-bearing for the same reason**: `WhatEachConversationIsWaitingOn.readAt` is one
      // completion point over every row, and `better-sqlite3` runs on this thread — so nothing can
      // be written between two of the three reads a row is built from.
      return host.readForWindow(() => {
        return host.whatEachConversationIsWaitingOn()
      })
    case 'theWholeForest':
      // ⛔ **A read, and it takes no sink and no owner** (637) — `whatEachConversationIsWaitingOn`'s
      // note one verb over, and the same three clauses. ⚠️ **No `requireAPerson`**: it names no
      // conversation, so `203`'s owner check has nothing to be about, and it offers no act.
      // ⚑ **Synchronous, and load-bearing for the same reason**: `TheWholeForest.readAt` is one
      // completion point over every node, and `better-sqlite3` runs on this thread — so nothing can
      // be written between two of the ledgers this folds.
      return host.readForWindow(() => host.theWholeForest())
    case 'processMemory':
      // ⛔ **A read, and it takes no sink and no owner** (D-018) — `whatIsBeingDone`'s note. ⚠️ **No
      // `requireAPerson`**: it names no conversation, so `203`'s owner check has nothing to be
      // about, and it offers no act; no agent reaches this door.
      return host.processMemory()
    case 'claim':
      // ⛔ **Synchronous, and here that is a requirement rather than an economy** (336): the owner
      // changes and the sink is swapped in one block with nothing awaited across it, so there is no
      // instant at which this surface owns the conversation and is not yet receiving it. An `await`
      // on this line would not create that gap, but it is the same rule `attachOpen` states and the
      // reason to state it here is that the gap it protects is one event wide.
      return host.claimSession(command.sessionId, sink)
    case 'release':
      // ⛔ **Synchronous for {@link RuntimeHost.claimSession}'s reason read backwards** (523): the
      // owner is cleared and the sink is put back to nothing in one block, so there is no instant
      // at which this surface has given the conversation up and is still being told about it.
      //
      // ⚑ **`sink`, not a payload field.** The host answers *is this yours* off the channel the ask
      // arrived on — the rule stated at the top of this switch — so a window cannot hand back a
      // conversation by naming somebody else's id.
      return host.releaseSession(command.sessionId, sink)
    case 'listLibrary':
      return await host.listLibrary({
        query: command.query,
        recordId: command.recordId,
        filters: command.filters,
        limit: command.limit,
        offset: command.offset,
      })
    case 'importRecordedSession':
      return await host.importRecordedSession(command.sessionId)
    case 'importUserHomeSession':
      return await host.importUserHomeSession(command.provider, command.providerSessionId)
    case 'rebuildLedger':
      return await host.rebuildLedger(command.sessionId)
    case 'readWorkflowOutput':
      // No sink, no session: this is a file read scoped to one recorded run (108).
      return host.readWorkflowOutput(command.sessionId, command.taskId)
    case 'readInstructionSource':
      // 356. No sink and no turn: one file off the list this session's provider reported, read at
      // the moment somebody pressed the row. See `main/instruction-source.ts` for the confinement.
      return host.readInstructionSource(command.sessionId, command.index)
    case 'revealPath':
      // 356. The only command in this union whose effect is outside the app. It still takes no path:
      // the host resolves the target against the session it launched, and hands the OS a string the
      // renderer never chose.
      return host.revealPath(command.sessionId, command.target)
    case 'readConfigFile':
      // 733. No sink and no turn: one file off the list this session's provider config declares,
      // read at the moment somebody pressed its row. See `main/config-file.ts`.
      return host.readConfigFile(command.sessionId, command.name)
    case 'readCommandOutput':
      // 300. No sink either, and no file: this reads a buffer the live handle has been filling off
      // its own stream. A session that is not live has none, which is the `null` the card renders as
      // "this app is not holding it" rather than as "it printed nothing".
      return host.readCommandOutput(command.sessionId, command.toolCallId)
    case 'readToolAnswer':
      // 462. No sink and no file, exactly as above: this reads a bounded hold the live handle filled
      // off its own stream. A replayed conversation has no handle at all, which is the `null` the
      // panel renders as "this app is not holding it" rather than as "the tool said nothing".
      return host.readToolAnswer(command.sessionId, command.toolCallId)
    case 'readResource':
      // 🔴 **510 · no sink, no session and no path.** ⛔ The renderer names a resource ID — a row in
      // this app's own table — and the host finds the file from the row, inside `resourcesRoot`.
      // ⚠️ Neither door asks an entitlement: any agent may read any resource (HO-057, carried from
      // the documents resources replaced), and ⚑ **HO-005 is why THIS one never asked**: a window is
      // not an agent, and there was never a grant a person could be missing.
      return host.readResourceForAPerson(command.resourceId)
    case 'drawResource':
      // 🔴 **D-032 · `readResource`'s door, for a picture or a PDF**: an id in, the kept bytes and
      // the type to draw them as out. ⚠️ On no toolset, so only a window reaches it.
      return host.drawResourceForAPerson(command.resourceId)
    case 'revealResource':
      // 🔴 **D-032 · `revealPath`'s act, by a resource id**: the host finds the kept file from its
      // row, inside `resourcesRoot`, and hands the OS a path the renderer never saw.
      return host.revealResource(command.resourceId)
    case 'resolveMessagePaths':
      return await host.resolveMessagePaths(command)
    case 'openMessagePath':
      return await host.openMessagePath(command)
    case 'revealMessagePath':
      return await host.revealMessagePath(command)
    case 'filesKept':
      if (command.scope === 'tree' && command.withAdded === true)
        return await host.filesKeptForWindow(command.conversation)
      // ⛔ **D-026 · a read, and it takes no sink and no owner** — `whoCalledWhom`'s note. ⚠️ **No
      // `requireAPerson`**, `readResource`'s reading: a window is not an agent (HO-005), it offers no
      // act, and no agent reaches this door — it is on no toolset. ⚑ Synchronous, like every read
      // on this wire.
      return host.filesKept(command)
    case 'filesLibrary':
      return await host.filesLibraryForWindow(command.request, sink)
    case 'teamProfileGraph':
      return await host.teamProfileGraphForWindow(command.request, sink)
    case 'searchWork':
      return await host.searchWork(command.conversation, command.query)
    case 'readChildState':
      // 296. No sink and no session of its own: this asks the PARENT's live handle about one of its
      // children, and the ledger decides whether that child is ours to ask about.
      return await host.readChildState(command.sessionId, command.agentId, sink)
    case 'sendToChild':
      // ⛔ **The first command in this union that writes to a child** — the sentence two cases below
      // said there was none, and 296 is the dispatch that made it false. It still takes no sink: the
      // child's answer is not this session's stream, it is the child's own record.
      return await host.sendToChild(command.sessionId, command.agentId, command.text, sink)
    case 'readChildWork':
      // Same shape as `readWorkflowOutput` (112): a file read scoped to one recorded run. ⚑ **No
      // longer "read-only by construction"** — see the two cases above, which 296 added; this verb
      // is still a pure read, and that is now a property of the verb rather than of the union.
      return host.readChildWork(
        command.sessionId,
        command.part === 'transcript'
          ? { part: 'transcript', agentId: command.agentId }
          : { part: command.part, taskId: command.taskId },
      )
    case 'earlierHistory':
      // No sink either, and for a stronger reason: this is a query about the LEDGER. It is the same
      // call whether the session is live or a recording, which is what stops scrolling back from
      // being two features that could disagree.
      return host.earlierHistory(command.sessionId, command.before, command.turns)
    case 'latestHistory':
      // The way back after scrolling far enough to release the tail (054).
      return host.latestHistory(command.sessionId)
    case 'capabilities':
      return host.capabilities()
    case 'profiles':
      // Synchronous host-side — it is a `readdir` under `userData` — and returned without an
      // `await` for the same reason `attachOpen` is: there is nothing asynchronous to wait for.
      return host.profiles()
    // 098. The profile defaults HERE rather than in the host, so that every credential path resolves
    // "which profile" in one place — the same rule `createSession` follows.
    case 'checkProviderAuth':
      return await host.checkProviderAuth(command.provider, command.profileId ?? DEFAULT_PROFILE_ID)
    case 'reprovisionProviderAuth':
      return await host.reprovisionProviderAuth(
        command.provider,
        command.profileId ?? DEFAULT_PROFILE_ID,
      )
    case 'signInProvider':
      return await host.signInProvider(command.provider, command.profileId ?? DEFAULT_PROFILE_ID)
    case 'cancelProviderSignIn':
      return await host.cancelProviderSignIn(
        command.provider,
        command.profileId ?? DEFAULT_PROFILE_ID,
      )
    case 'checkCwd':
      // No sink and no session: this is a question about a directory, asked before there is a
      // conversation to own. Synchronous host-side — it is a `stat` — and returned without an
      // `await` for the same reason `profiles` is.
      return host.checkCwd(command.path)
    case 'skills':
      requireAPerson(sink, command.kind)
      return await host.skillsForAPerson(command.request)
    case 'agentIdentities':
      requireAPerson(sink, command.kind)
      return host.agentIdentities()
    case 'setCapabilities':
      requireAPerson(sink, command.kind)
      return host.setCapabilities(command.profileId, command.grant, command.externalMcpServerIds)
    case 'registerExternalMcpServer':
      // ⛔ **`requireAPerson`, with `setCapabilities` as the precedent** (516, 355, 349). ⚠️ **The
      // reason is not that a registry row is a capability — it is not, and it grants nobody** — it
      // is that this door decides what an agent may be given, and HO-005's *"the human is
      // unrestricted"* is a statement about a HUMAN. ⚑ What keeps an AGENT off it is the same thing
      // that keeps one off `createAgent`: the verb lives on this wire and on no toolset, which
      // `the-rails-before-anything-can-reach-them.test.ts` is where the inventory for is pinned.
      //
      // 🔴 **And it is the ONE command on this union that opens a socket**, to an address a person
      // typed. That is the collision preflight and it is the whole rail — see
      // `RuntimeHost.registerExternalMcpServer`.
      requireAPerson(sink, command.kind)
      return await host.registerExternalMcpServer({
        name: command.name,
        url: command.url,
        reach: command.reach,
      })
    case 'removeExternalMcpServer':
      // ⛔ **`requireAPerson`, for its neighbour's reason.** ⚠️ Removing is the direction that reads
      // like the exemption worth making and it is not one: it takes a capability away from every
      // identity that held it, which is exactly *"changes what agents are allowed to do"*.
      requireAPerson(sink, command.kind)
      return host.removeExternalMcpServer(command.serverId)
    case 'setAgentProvider':
      // ⛔ **`requireAPerson`, with `setCapabilities` as the precedent** (433, 419, 349). ⚠️ **The
      // reason is NOT that provider is a capability — it is not, and `419` §3 is explicit** — it is
      // that this door configures an identity, and HO-005's *"the human is unrestricted"* is a
      // statement about a HUMAN. ⚑ What keeps an AGENT off it is the same thing that keeps one off
      // `createAgent`: the verb lives on this wire and on no toolset, which
      // `the-rails-before-anything-can-reach-them.test.ts` is where the inventory for is pinned.
      requireAPerson(sink, command.kind)
      return host.setAgentProvider(command.profileId, command.provider)
    case 'setAgentDisplayName':
      // ⛔ **`requireAPerson`, with `setAgentProvider` directly above as the precedent** (558, 433,
      // 349). ⚠️ **The reason is not that a name is a capability — it is not, and no rail reads
      // this column** — it is that this door configures an identity, and HO-005's *"the human is
      // unrestricted"* is a statement about a HUMAN. ⚑ `HO-054` §2.3's neighbour is the sharper
      // version for this verb: an agent renaming another agent is not something anybody has asked
      // for, and the name is what every surface in this app draws that agent BY.
      //
      // ⚑ What keeps an AGENT off the door is the same thing that keeps one off `createAgent`: the
      // verb lives on this wire and on no toolset — pinned by
      // `the-rails-before-anything-can-reach-them.test.ts`.
      requireAPerson(sink, command.kind)
      return host.setAgentDisplayName(command.profileId, command.displayName)
    case 'retitleWork':
      // ⛔ **`requireAPerson`, with `setAgentDisplayName` directly above as the precedent** (D-016 ·
      // commit 7 · R4): a person names the work a person gave. ⚑ No toolset carries this verb — an
      // agent names its work with `update_work`, whose rails are its own.
      requireAPerson(sink, command.kind)
      return host.retitleForAPerson(command.piece, command.title)
    case 'takeBackWork':
      // ⛔ **`requireAPerson`, with `retitleWork` as the precedent**: a person clears the piece a
      // service is on. ⚑ An agent takes work back with `withdraw_task`, whose rails are its own.
      requireAPerson(sink, command.kind)
      return await host.takeBackForAPerson(command.piece, sink)
    case 'setAgentModelAndEffort':
      // ⛔ **`requireAPerson`, with `setAgentProvider` as the precedent** (677, 433). ⚑ **And here the
      // gate IS the ruling**: a person sets an agent's default, and `create_agent` the default of the
      // agent it makes (D-042 · R2) — an agent reaching this door could change any agent's. What
      // keeps an agent off it otherwise is that the verb is on this wire and on no toolset.
      requireAPerson(sink, command.kind)
      return host.setAgentModelAndEffort(
        command.profileId,
        command.provider === null || command.model === null
          ? null
          : { provider: command.provider, model: command.model, effort: command.effort },
      )
    case 'agentModelAndEffort':
      // ⚑ **Gated like `agentIdentities`, the roster it sits beside** (677): the sheet is a person's.
      requireAPerson(sink, command.kind)
      return host.agentModelAndEffort(command.profileId)
    case 'modelList':
      // ⚑ **D-042 · gated like `agentModelAndEffort`**: the list carries a person's own models and
      // last pick. ⚑ The profile defaults HERE, the credential gestures' rule: every path that
      // resolves "which profile" does it in one place (257 §2).
      requireAPerson(sink, command.kind)
      return host.modelList(command.provider, command.profileId ?? DEFAULT_PROFILE_ID)
    case 'addHandAddedModel':
      // ⛔ **D-042 · R3 — only the person adds and deletes them**, and no toolset carries the verb.
      requireAPerson(sink, command.kind)
      return host.addHandAddedModel(command.provider, command.model)
    case 'deleteHandAddedModel':
      requireAPerson(sink, command.kind)
      return host.deleteHandAddedModel(command.provider, command.model)
    case 'apiKeyStatus':
      // ⚑ Ungated, `capabilities`' reason: where a key stands is not the key, and a surface
      // deciding what to offer asks it before anything is started.
      return host.apiKeyStatus(command.provider)
    case 'setApiKey':
      // ⛔ **Only a person keeps, removes or checks a key**, and no toolset carries any of the verbs.
      requireAPerson(sink, command.kind)
      return host.setApiKey(command.provider, command.key)
    case 'removeApiKey':
      requireAPerson(sink, command.kind)
      return host.removeApiKey(command.provider)
    case 'checkApiKey':
      // ⚑ A real check asks the provider over the network, and only a person's press starts one.
      requireAPerson(sink, command.kind)
      return host.checkApiKey(command.provider)
    // ⚑ **The Providers screen's four reads** — open to any window, as `checkProviderAuth` is: none
    // carries a credential, a conversation or anything a person wrote.
    case 'providerVersions':
      return host.providerVersions()
    case 'providerSetup':
      return host.providerSetup()
    case 'providerUsage':
      return host.providerUsage()
    // ⚑ What an *Always allow* kept, and its removal — which edits a file of the person's, so only a
    // person's press does it.
    case 'keptRules':
      return host.keptRules()
    case 'removeKeptRule':
      requireAPerson(sink, command.kind)
      return host.removeKeptRule({
        provider: command.provider,
        file: command.file,
        kept: command.kept,
      })
    case 'providerResources':
      return host.providerResources()
    case 'instructAgent':
      // ⛔ **`requireAPerson`, with `setAgentDisplayName` directly above as the precedent** (582,
      // 558, 433, 349). ⚠️ **And here the gate is not a formality**: `a-person` is the one
      // authority this door writes, so a caller that is not a person reaching it would put an
      // agent's words into the ledger under a person's name, which is the one provenance a reader
      // cannot check afterwards.
      //
      // ⚠️ **618 · this read *"`HO-009` §2.2 gives the configured layer exactly three
      // authorities"*** and the count moved: `HO-078` §4 added `its-creator`, a creator writing
      // the first version of an identity it is bringing into existence. ⛔ **The gate on THIS door
      // is untouched** — the sentence is corrected because a count outlives its derivation
      // (`WHO_WROTE_IT` is where the four are argued).
      //
      // ⚑ An AGENT's route to this layer is `propose_agent_rules`, which writes
      // `instruction_proposed` and nothing else — pinned by
      // `the-rails-before-anything-can-reach-them.test.ts`. ⚠️ **The name in this line was
      // `propose_instruction` until `618` and no tool has ever been called that**; nothing read it,
      // which is why nothing went red.
      requireAPerson(sink, command.kind)
      return host.instructAgent(
        command.profileId,
        command.text,
        command.broughtBack,
        sink,
        command.baseline,
      )
    case 'agentInstructions':
      // ⛔ **`requireAPerson` on a READ, which is rarer in this switch than on a write.** ⚠️ The
      // reason is not secrecy — an agent already receives its own rules in its bundle at every
      // launch — it is that this payload carries every OTHER identity's asks and versions too, and
      // the verb lives on the window wire for the sheet that draws them.
      requireAPerson(sink, command.kind)
      return host.agentInstructions(command.profileId)
    case 'agentMethods':
      requireAPerson(sink, command.kind)
      return host.agentMethods(command.profileId, command.offset ?? 0, command.limit ?? 50, sink)
    case 'agentMethodBody':
      requireAPerson(sink, command.kind)
      return host.agentMethodBody(command.profileId, command.key, sink)
    case 'agentMethodChanges':
      requireAPerson(sink, command.kind)
      return host.agentMethodChanges(
        command.profileId,
        command.offset ?? 0,
        command.limit ?? 50,
        sink,
      )
    case 'removeAgentMethod':
      requireAPerson(sink, command.kind)
      return host.removeAgentMethod(command.profileId, command.selection, sink)
    case 'undoAgentMethod':
      requireAPerson(sink, command.kind)
      return host.undoAgentMethod(command.profileId, command.changeId, sink)
    case 'checkInterruptedAgentMethods':
      requireAPerson(sink, command.kind)
      return host.checkInterruptedAgentMethods(command.profileId, command.confirmed, sink)
    case 'agentOwnNotes':
      requireAPerson(sink, command.kind)
      return host.agentOwnNotes(command.profileId)
    case 'agentOwnNotesUnread':
      requireAPerson(sink, command.kind)
      return host.agentOwnNotesUnread(command.profileId)
    case 'saveOwnNotes':
      requireAPerson(sink, command.kind)
      return host.saveOwnNotes(command.profileId, command, sink)
    case 'undoOwnNotes':
      requireAPerson(sink, command.kind)
      return host.undoOwnNotes(command.profileId, command.expectedVersion, sink)
    case 'markOwnNotesSeen':
      requireAPerson(sink, command.kind)
      return host.markOwnNotesSeen(command.profileId, command.throughVersion, sink)
    case 'agentRulesUnread':
      requireAPerson(sink, command.kind)
      return host.agentRulesUnread(command.profileId)
    case 'undoAgentRules':
      requireAPerson(sink, command.kind)
      return host.undoAgentRules(command.profileId, command.expectedVersion, sink)
    case 'markAgentRulesSeen':
      requireAPerson(sink, command.kind)
      return host.markAgentRulesSeen(command.profileId, command.throughVersion, sink)
    case 'agentMemory':
      // ⚑ **F093 · C8 b — paged when a page is named**, behind the same gate; else the first
      // twenty, as before.
      if (command.offset !== undefined || command.limit !== undefined) {
        requireAPerson(sink, command.kind)
        return host.agentMemoryPage(
          command.profileId,
          command.offset ?? 0,
          command.limit ?? AGENT_MEMORY_NOTES_SHOWN,
        )
      }
      // ⛔ **`requireAPerson`, with `agentInstructions` directly above as the precedent** (625,
      // 582). ⚠️ **And here the reason is not the one above.** That payload carries other
      // identities' asks; this one carries only the identity named — but it carries an agent's own
      // memory VERBATIM, and `HO-005`'s *"the human is unrestricted"* is a statement about a HUMAN.
      // ⚑ An agent reading another agent's memory is not something anybody has asked for, and this
      // verb lives on this wire and on no toolset — pinned by
      // `the-rails-before-anything-can-reach-them.test.ts`.
      requireAPerson(sink, command.kind)
      return host.agentMemory(command.profileId)
    case 'whatThisAgentWasGiven':
      // 🔴 **F093 · `requireAPerson`, with `agentMemory` directly above as the precedent**: this
      // read carries an agent's memory VERBATIM, and its own instructions — a person's door, on no
      // toolset.
      requireAPerson(sink, command.kind)
      return host.whatThisAgentWasGiven(command.sessionId)
    case 'whatTheModelGot':
      // 🔴 **F093 · C9 d · `requireAPerson`, with `whatThisAgentWasGiven` directly above as the
      // precedent**: it carries an agent's own instructions and every message as it was handed over —
      // a person's door, on no toolset.
      requireAPerson(sink, command.kind)
      return host.whatTheModelGot(command.sessionId, command.ordinal)
    case 'amendAgentMemory':
      // ⛔ **`requireAPerson`, and it is the ONLY authority this door has** (625, `EXT-015` §3.3).
      // ⚠️ **This is what `A_PERSON_DID_THIS` asserts and what makes the record's missing
      // `wrote_it` column correct**: `identity_instruction` needs a provenance vocabulary because
      // four authorities can write a version, and this table needs none because one can. 🔴 **The
      // day that stops being true, the constant is the thing that goes red** — the vocabulary
      // question arrives with the door rather than after it.
      requireAPerson(sink, command.kind)
      return host.amendAgentMemory(command, sink)
    case 'undoAgentMemory':
      requireAPerson(sink, command.kind)
      return host.undoAgentMemory(command, sink)
    case 'checkInterruptedMemory':
      requireAPerson(sink, command.kind)
      return host.checkInterruptedMemory(command, sink)
    case 'decideInstruction':
      // ⛔ **`requireAPerson`, and `HO-009` §2.2 is what makes it load-bearing**: *"An agent
      // proposes. A proposal is a card; approval writes it."* ⚑ Approval is the only thing that
      // turns an ask into a version, so a gate an agent could open would be criterion 21's *his
      // approval is the ONLY gate* with the gate removed.
      requireAPerson(sink, command.kind)
      return host.decideInstruction(command.askId, command.approve, sink)
    case 'decideMcpServerRequest':
      // `requireAPerson`: approving registers a server agents may then use, which is the person's
      // call alone. No toolset carries this verb, so no agent can approve its own request.
      requireAPerson(sink, command.kind)
      return await host.decideMcpServerRequest(command.requestId, command.approve, sink)
    case 'removeAgent':
      // ⛔ **`requireAPerson`, and of every verb on this union it is the one the gate was written
      // for** (558). ⚠️ `removeExternalMcpServer`'s own note says removing *"reads like the
      // exemption worth making and it is not one"*; here it is stronger still — an agent that could
      // remove an identity could remove the one holding the grant that refuses it, which is
      // `noPersonBehindIt`'s sentence without any stretching at all.
      requireAPerson(sink, command.kind)
      return host.removeAgent(command.profileId)
    // At the window, a person's alone: they change what a person's lists show and remove what a
    // person chose to. An agent restores through its own tool, and archives or deletes nothing.
    case 'archiveConversation':
      requireAPerson(sink, command.kind)
      return host.archiveConversation(command.sessionId)
    case 'restoreConversation':
      requireAPerson(sink, command.kind)
      return host.restoreConversation(command.sessionId)
    case 'checkDeleteConversation':
      requireAPerson(sink, command.kind)
      return host.deleteVerdict(command.sessionId)
    case 'deleteConversation':
      requireAPerson(sink, command.kind)
      return host.deleteConversation(command.sessionId, command.parts)
    case 'setSpawningEnabled':
      requireAPerson(sink, command.kind)
      return host.setSpawningEnabled(command.enabled)
    case 'setServicesOn':
      requireAPerson(sink, command.kind)
      return host.setServicesOn(command.on)
    case 'setDefaultApprovalMode':
      // ⛔ **`requireAPerson`, and `noPersonBehindIt`'s sentence is true of it without stretching**:
      // *"changes what agents are allowed to do"* is exactly what a default of `auto` changes, one
      // launch later, for every conversation a person opens after it. ⚑ What keeps an AGENT off the
      // door is not this gate but the same thing that keeps one off `setAgentProvider` and
      // `createAgent`: the verb lives on this wire and on no toolset.
      requireAPerson(sink, command.kind)
      return host.setDefaultApprovalMode(command.mode)
    case 'createAgent':
      // ⛔ **`requireAPerson`, with `setCapabilities` as the precedent** (419, 349): this verb brings
      // into existence the thing every capability is a fact ABOUT, and HO-005's *"the human is
      // unrestricted"* is a statement about a HUMAN — so the sink has to declare one.
      //
      // ⚠️ **It is not what keeps an agent off this door.** That is the verb living on this wire and
      // on no toolset — `create_agent` is a separate door with its own rails, and
      // `the-rails-before-anything-can-reach-them.test.ts` pins the inventory that keeps the two
      // apart.
      requireAPerson(sink, command.kind)
      return host.createAgent({
        slug: command.slug,
        displayName: command.displayName,
        provider: command.provider,
        ...(command.asAService === true ? { asAService: true as const } : {}),
      })
  }
}

/** A sink that pushes events into one renderer, and reports honestly once it is gone. */
export function webContentsSink(
  contents: WebContents,
  timing?: Pick<MainThreadWork, 'start'>,
): RuntimeEventSink {
  const ownerId = sinkOwnerId(contents)
  return {
    ownerId,
    // A `WebContents` sink draws requests in a window where the person can read and answer them. Set `aPersonIsBehindIt` here; other sinks must declare their own audience instead of assuming one.
    //
    // ⚠️ **A literal and not a check.** There is no runtime question to ask a `WebContents`: a
    // destroyed window is what `alive` below is for, and a window with nobody looking at it is
    // still the surface a card is drawn on. What this field answers is *"could a person read this"*,
    // and for a renderer the answer does not vary.
    aPersonIsBehindIt: true,
    get alive(): boolean {
      return !contents.isDestroyed()
    },
    send(message): void {
      const finish = timing?.start('window conversation event send')
      try {
        if (contents.isDestroyed()) return
        contents.send(RUNTIME_EVENT_CHANNEL, message)
      } finally {
        finish?.()
      }
    },
    sendLiveness(message): void {
      const finish = timing?.start('window liveness send')
      try {
        if (contents.isDestroyed()) return
        contents.send(RUNTIME_LIVENESS_CHANNEL, message)
      } finally {
        finish?.()
      }
    },
  }
}

/** The subset of `ipcMain` this module needs — kept structural so tests can drive it. */
export interface IpcHandleRegistrar {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void
}

/**
 * A command's kind for a log line: one this app knows, or a fixed word — never text a page made up.
 */
export function aCommandsKind(raw: unknown): string {
  const kind =
    typeof raw === 'object' && raw !== null ? (raw as { kind?: unknown }).kind : undefined
  if (typeof kind !== 'string') return 'not a command'
  if (Object.hasOwn(DURING_A_QUIT, kind) || isAPageReport(raw)) return kind
  return 'of an unknown kind'
}

export function registerRuntimeIpc(options: {
  ipc: IpcHandleRegistrar
  host: RuntimeHost
  sinkFor: (event: IpcMainInvokeEvent) => RuntimeEventSink
  /** The page's own freeze reports, taken before any runtime command is parsed. */
  pageReceipt?: PageReceipt
}): void {
  const ipc =
    options.pageReceipt === undefined
      ? options.ipc
      : takingThePagesReports(options.ipc, options.pageReceipt)
  ipc.handle(RUNTIME_COMMAND_CHANNEL, (event, raw) =>
    executeRuntimeCommand(options.host, options.sinkFor(event), raw).catch((error: unknown) => {
      throw withoutItsClassName(error)
    }),
  )
}

/** The registrar, with the page's report answered by `receipt` before the command's listener. */
function takingThePagesReports(ipc: IpcHandleRegistrar, receipt: PageReceipt): IpcHandleRegistrar {
  return {
    handle: (channel, listener) =>
      ipc.handle(channel, (event, ...args) =>
        isAPageReport(args[0]) ? receipt.take(event, args[0]) : listener(event, ...args),
      ),
  }
}

/**
 * 🔴 **675 · a class name is a developer's word, and this is the door where it would become a
 * person's** (`670` F-c).
 *
 * ⛔ **Measured on Electron 43.2.0: `ipcMain.handle` sends a rejection as `error.toString()`** —
 * `${name}: ${message}` — and the renderer's `readableError` strips exactly one wrapper prefix,
 * `\w*Error:`. So a class that names itself anything not ending in `Error` reached a person whole:
 * *"MessageAlreadyHeld: a message is already waiting…"* at the Queue button and, since `670`, at a
 * send and an interrupt-and-send that lose their race and find work already held.
 *
 * ⚑ **Fixed HERE, once, rather than in each class**, because the property is about what crosses
 * this boundary and not about any one class: `ProfileUnopenable` reached the same screen at two
 * credential doors, and a class added tomorrow would too. ⚠️ **Nothing reads `.name`** — every
 * classifier in this app is `instanceof` — so the classes keep their names for the log, and the
 * original rides as `cause`. ⛔ A plain `Error` passes through untouched: its `toString()` already
 * says `Error: …`, which is the one prefix the renderer strips.
 *
 * ⚠️ **Scoped to this channel**, which is the one every runtime command crosses. The other
 * `ipcMain.handle` registrations (`main/index.ts`, `window-controls.ts`) throw no named class today.
 */
export function withoutItsClassName(error: unknown): unknown {
  if (!(error instanceof Error) || error.name === 'Error') return error
  return new Error(error.message, { cause: error })
}
