import { isAbsolute } from 'node:path'
import { z } from 'zod'
import {
  PATH_SEGMENT_RULE,
  MAX_HANDED_PATHS,
  MAX_PATH_CHARS,
  MAX_READING_BYTES,
  PATH_SEGMENT_MAX_LENGTH,
  AGENT_DISPLAY_NAME_CHARS,
  NOTHING_TO_SEND,
  hasSomethingToSend,
  isPathSegment,
} from '../../shared/runtime-ipc'
import { OWN_INSTRUCTIONS_CHARS } from '../../shared/own-instructions'
import { ownNotesTextFits, OWN_NOTES_TEXT_PROBLEM } from '../../shared/own-notes'
// ⚑ **625 · a CONSTANT, and this file still imports nothing from `node:fs`** — which is what
// `no-byte-authority.test.ts` measures. ⛔ The cap the wire bound is derived from is the one the
// guarded reader enforces, and importing it is how the two cannot drift.
import { INSTRUCTION_FILE_CAP } from './instructions'

/**
 * The field decoders the runtime command union is built from, and the sentence a rejected
 * command is refused with. Split out of `ipc.ts` (card 73); every declaration is unchanged.
 */

/**
 * Bounded as well as non-empty. Every id here crosses a process boundary and is then used — as a
 * database key, a correlation id, or (in `exportSession`, which narrows this further) a filename.
 * None of them is ever legitimately long, and an unbounded string is a free way to make the main
 * process do work on the renderer's behalf.
 */
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
        .refine((each) => isAbsolute(each), 'a handed path must be absolute'),
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

/** A readable one-line rejection — a raw `ZodError` dump is useless in a UI toast. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ')
}

export {
  sessionId,
  requestId,
  messageId,
  deletePartId,
  profileId,
  aModelsName,
  agentSlug,
  agentDisplayName,
  ownInstructions,
  ownNotesText,
  ownNotesVersion,
  readingBody,
  memoryText,
  externalMcpServerName,
  externalMcpUrl,
  externalMcpServerId,
  launchKey,
  sendShaped,
  goAheadText,
  childMessage,
  describeIssues,
}
