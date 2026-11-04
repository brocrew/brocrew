import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { LIBRARY_QUERY_MAX, MAX_PATH_CHARS } from '../src/shared/runtime-ipc'

/**
 * # ⛔ Which command shapes can put raw zod on a person's screen (221 §3)
 *
 * ## The question
 *
 * `220` dropped a file on the launcher, pressed Send, and read
 * **`invalid runtime command: text: Too small: expected string to have >=1 characters`**. That is a
 * library talking, and this app has a standard for refusals — `169` §1 / `118`: the reason is a
 * sentence, and a control that cannot act says why. §1 removes that INSTANCE. ⚠️ **§3 asks about the
 * class: how many other shapes can do the same, and is that one fix or thirty?**
 *
 * ## The count, and how it was arrived at
 *
 * ⛔ **At `221` there were twenty-two string fields on `runtimeCommandSchema`. Six carried a value a
 * PERSON supplies. Four of those six had a bound with no control enforcing it.** ⚠️ **The number is
 * written as history rather than as a present count, and 354 is the third dispatch to add a field
 * without it being true any more** — the list below is the count, and it is the thing a test can
 * keep honest. Everything else is the app's own —
 * session ids, request ids, launch keys, task and agent ids, a discovered provider session id — or
 * comes from a menu the provider filled (`model`, `reasoningEffort`, and the two
 * `setSessionSetting` values), or from a checkbox, an enum, or a constant (`endPlanMode.text` is
 * `GO_AHEAD_MESSAGE`). ⚑ **A bound is only reachable when a person can type or paste past it.**
 *
 * | field | supplied by | before 221 |
 * |---|---|---|
 * | `send`/`sendInterrupting`/`queueMessage` `text` | the composer | ⛔ **the defect** — §1 |
 * | `listLibrary.query` | the library search box | ⛔ 200 chars, one paste away, no `maxlength` |
 * | `checkCwd.path` | 🔴 **nobody since D-016** — the project sheet's folder field was its last | ⚠️ `PATH_MAX`, paste-only |
 * | `importBundleFile.path` | the library's restore field | ⚠️ `PATH_MAX`, paste-only |
 * | `createSession.profileId` | 🔴 **nobody — a constant, since 417** | ⚑ gated before the press (169 §1) |
 * | `createSession.cwd` | 🔴 **nobody — never sent, since 417** | ⚑ unbounded — nothing to violate |
 * | `agentSlug` | 🔴 **the new-agent sheet's name field, since 423** | ⚑ `isPathSegment`, not a length |
 * | `agentDisplayName` | 🔴 **the new-agent sheet's display name, since 423** | ⛔ `AGENT_DISPLAY_NAME_CHARS` |
 * | `resolveLink.target` | copied from an app-authored navigation link or recorded work label | `LINK_TARGET_LIMIT`; no control types it |
 * | `agentMethodBody.key` and `removeAgentMethod.selection.key` | copied from a saved-method row | 1–1,024 characters; main resolves the key afresh |
 * | `removeAgentMethod.selection.fingerprint` and `.indexFingerprint` | copied from main's file reading | 64 lowercase hex characters or null; no control types them |
 * | `undoAgentMethod.changeId` | copied from a saved-method history row | 1–1,024 characters; main checks the latest effective change |
 *
 * ⛔ **Three rows changed hands at `417` (HO-022 §2) and none of them lost a bound.** The launcher
 * used to be the person-facing end of all three: it had a folder row (`cwd-input` / `cwd-choose`),
 * which asked `checkCwd` as you typed and sent its value as `createSession.cwd`, and a profile menu
 * whose `+ New profile…` name box supplied `createSession.profileId`. *"Opening a new conversation
 * opens a conversation with BroBot. That is all."* — so the front door now sends
 * `{ provider, profileId: 'default', approvalMode: 'ask' }` and nothing else. ⚑ **`checkCwd` was
 * then asked by a person's keystrokes from `ProjectSheet` through `ProjectStore.checkFolder`**, and
 * **D-016 deleted both** with projects: no control types into it now, and the wire still holds it
 * to `MAX_PATH_CHARS` below. ⚠️ **The two `createSession`
 * fields are now unreachable from any control**, which is a narrowing, not a gap: the wire still
 * declares them and the census below still counts them, so a field that becomes typeable again has
 * to be re-classified here.
 *
 * ⚠️ **`endPlanMode`'s FIELD moved in 234 §3 and its classification did not** — the row in the
 * table above is unchanged, because the table is about who supplies a value. Its text is declared
 * as `goAheadText` now, above the union, so `send-refusals.test.ts` can census it as the fourth
 * message-carrying verb — and it is held to `hasSomethingToSend` rather than `min(1)`. What is
 * unchanged is the answer this table cares about: the app only ever sends `GO_AHEAD_MESSAGE`, so
 * no person can type past a bound on it.
 *
 * ## So: one fix, and it is not a nicer message
 *
 * ⛔ **The control carries the schema's own constant.** `169` §1's rule — one rule spelled in two
 * places drifts — applied before the drift instead of after it. A bound the field enforces is a
 * refusal that never has to be worded, which beats every improvement to the wording.
 *
 * ⚠️ **What this file does NOT claim.** It is not a proof that no zod message can reach a screen:
 * a forged command from a compromised renderer, or a field added tomorrow, still can. What it pins
 * is that the four reachable ones are gated, and that a twenty-second string field cannot be added
 * without somebody classifying it here.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA = join(here, '../src/main/runtime/ipc.ts')
const LIBRARY = join(here, '../src/renderer/src/components/SessionLibrary.vue')
// ⚑ `LAUNCHER` (`NewConversation.vue`) was read here for its `cwd-input` bound. 417 (HO-022 §2)
// removed the folder row from the front door, so this file has nothing left to ask that component.
// ⚑ `PROJECT_SHEET` (`ProjectSheet.vue`) went with projects at D-016, and its three bounds with it.
/** 423 · the creation sheet that closed `419`'s open promise — see the test below. */
const NEW_AGENT = join(here, '../src/renderer/src/components/NewAgent.vue')

/** Comment-free, so a field NAMED in prose is not counted as a field declared. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
}

/** The element carrying `data-cy="<cy>"`, from its opening `<` to the `/>` that closes it. */
function elementWith(source: string, cy: string): string {
  const at = source.indexOf(`data-cy="${cy}"`)
  if (at === -1) return ''
  const from = source.lastIndexOf('<', at)
  const to = source.indexOf('/>', at)
  return from === -1 || to === -1 ? '' : source.slice(from, to)
}

describe('221 §3 · the count is pinned, so a new field must be classified', () => {
  it('⚑ `runtimeCommandSchema` still declares exactly the string fields this file classified', () => {
    const code = codeOf(SCHEMA)
    const region = code.slice(
      code.indexOf('const sessionId ='),
      code.indexOf('satisfies z.ZodType<RuntimeCommand>'),
    )
    // ⛔ Non-vacuity first: an empty region would make the count zero and this test silent.
    expect(region.length, 'the schema region was not found').toBeGreaterThan(2_000)
    const fields = [...region.replace(/\s+/g, ' ').matchAll(/(\w+)\s*[:=]\s*z\s*\.\s*string\(\)/g)]
    // ⚠️ **A COUNT, deliberately, and it is the cheapest instrument that does the job.** A
    // twenty-second string field is somebody adding a value that crosses the boundary; this fails,
    // and whoever added it has to say in the table above whether a person can type it. That is the
    // whole guard — 219 §2's *"write it down where the code is, not only in a doc"*.
    expect(
      fields.map(([, name]) => name),
      'a string field was added to or removed from the wire — classify it in the table above',
    ).toEqual([
      'sessionId',
      'requestId',
      // ⛔ **`messageId`** (354) — classified: **no person types it.** It is the name the main
      // process minted for a held message (`msg_<uuid>`), published on the queued disclosure and
      // sent straight back by `cancelQueuedMessage`. ⚑ A bound with nothing to violate, exactly
      // like `sessionId` and `requestId` beside it — and REQUIRED rather than optional, so an older
      // renderer's session-shaped cancel is refused rather than cancelling whatever is held.
      'messageId',
      // ⛔ **`deletePartId`** — classified: **no person types it.** It is one of the ids a delete's
      // check gave its parts (`records`, `files:<conversation>`, `note:<path>`), sent back for the
      // parts a person ticked. ⚑ A guessed value reaches nothing: the delete reads its list again
      // and refuses an id that list does not hold. Bounded at the path ceiling plus the prefix.
      'deletePartId',
      'profileId',
      // 🔴 **`aModelsName`** (D-042 · R3) — classified: **a person types it**, once, and it is
      // declared above the union the way `profileId` is because two fields share it. ⛔ The ONE
      // typed use is `addHandAddedModel.model`: a model a person adds to a provider's list by hand,
      // which by definition is not on any menu the provider filled. ⚑ The other is not for typing —
      // `deleteHandAddedModel.model` names a hand-added row the list drew. ⚑ Its bound is
      // `createSession`'s `model` bound (120), plus a trim and no control characters: it is shown in
      // a list and sent to a provider as is.
      // ⚠️ **No control draws it yet**, and the next describe pins only the three controls it
      // names, so UI-012's hand-add field owes the wire's bound and a case here when it lands.
      'aModelsName',
      // 🔴 **`agentSlug`** (419) — classified: **a person types it.** It is the name of an identity
      // a person is bringing into existence, and there is no menu it can come from: the identity
      // does not exist yet, which is the whole point of the verb.
      //
      // ⚑ **Not bounded by a length, which is the STRONGER guard rather than a gap** — as the
      // project slug was until D-016. `isPathSegment` is `[A-Za-z0-9][A-Za-z0-9._-]*` under
      // `PATH_SEGMENT_MAX_LENGTH`, and it is load-bearing twice here: this value becomes a directory
      // under `provider-homes/<project>/<this>/` on the identity's first launch, and it is folded
      // into a primary key spelled `aid:<slug>`, where `:` is deliberately outside the alphabet.
      //
      // ⚠️ **Its own declaration rather than `profileId` reused**, and that is why the count grew by
      // one rather than staying still: `profileId` is `.optional()`, and an omitted name on a
      // creation would mean *the default profile* — the one identity that always already exists.
      'agentSlug',
      // 🔴 **`agentDisplayName`** (419) — classified: **a person types it**, and it was the second
      // hand-typed prose field on this wire after the project's three (gone at D-016).
      //
      // ⛔ **`AGENT_DISPLAY_NAME_CHARS`, its own constant rather than `PROJECT_NAME_CHARS` reused**
      // (169 §1 read forwards): two values that happen to be equal today and belong to two owners
      // are one edit away from one of them silently changing the other. ⚑ Same number, same reason —
      // a display name is a LABEL, it goes in a roster row and a sheet header, and a
      // five-thousand-character one is a layout attack rather than a name.
      'agentDisplayName',
      // 🔴 **`ownInstructions`** (582) — classified: **A PERSON TYPES IT, and it is the longest
      // thing anybody types into this app.** ⛔ `OWN_INSTRUCTIONS_CHARS` is 16,000, derived in that
      // constant's own note against the 3.5 KB bundle it joins rather than picked here — so this is
      // a bound with something real to violate, unlike the minted ids above it. ⚠️ **No `.min(1)`**:
      // an empty string is a person taking their rules away, and a bound that refused it would make
      // that unreachable through the only door that can express it.
      'ownInstructions',
      // A person types notes, baseline text and reasons. The refinement bounds each to 4000
      // Unicode code points and refuses text that SQLite cannot preserve exactly. Empty is valid.
      'ownNotesText',
      // 🔴 **`readingBody`** (633) — classified: **a person does not type it, and no person ever
      // will.** ⛔ It is the MARKDOWN the renderer composed from `TranscriptItem[]` — the fold the
      // screen is made of — sent back for the host to write into `exports/`. ⚑ A person chooses a
      // conversation and a toggle; every byte in this field was produced by this app from its own
      // ledger.
      //
      // ⚠️ **It is the largest field on this wire and the bound is therefore the load-bearing
      // one.** 🔴 `MAX_READING_BYTES` is a SHARED constant — `write-reading.ts` refuses on the same
      // number — and it is counted in BYTES rather than characters, which is the one place this
      // table's fields differ: a `.max()` here would count characters and the filesystem does not.
      // ⛔ **And it REFUSES rather than truncating**, which is `read-bundle.ts`' discipline carried
      // over by instruction: *"Nothing is silently truncated: past this size the answer is `no`,
      // with the size in it."*
      'readingBody',
      // 🔴 **`memoryText`** (625) — classified: **a person types it.** It is the replacement a
      // person writes over one entry of an agent's memory, and it is the only field on this wire
      // whose bound is in BYTES rather than characters. ⛔ **That is deliberate and it is the
      // opposite of `ownInstructions` directly above**: this one has to agree with a READER that
      // counts bytes (`INSTRUCTION_FILE_CAP`, enforced while reading), and an accented correction
      // that passed a character bound would be refused after the door said yes. ⚠️ **The bound is
      // the reader's own constant, imported** — a number chosen here would be
      // `a-bound-written-as-the-constant-cannot-pin-it` with two constants instead of one.
      'memoryText',
      // 🔴 **`externalMcpServerName`** (516) — classified: **a person types it.** It is the
      // namespace an agent will see a registered server's tools under, typed into the registry
      // block, and there is no menu it could come from: the server does not exist to this app yet.
      //
      // ⛔ **A LENGTH only, and the RULE is at the door.** `isPathSegment` would have been the
      // nearest-looking refinement and it is the wrong one: the name rule also reserves
      // `AGENT_TOOL_SERVER` and forbids `__` (`507` F4), and a validator holding half of it would
      // refuse with a message about an alphabet while the other half refused with a sentence a
      // person could act on. ⚑ One authority — `externalMcpNameRefusal` — and this is the boundary
      // bounding a payload rather than the policy.
      'externalMcpServerName',
      // 🔴 **`externalMcpUrl`** (516) — classified: **a person types it**, and it is the second
      // hand-typed field this verb carries.
      //
      // ⛔ **`MAX_PATH_CHARS`, the ceiling every other long string here holds**, asked of a value of
      // the same order. ⚠️ The bound is NOT what makes it safe: `externalMcpUrlRefusal` is — loopback
      // host, no user-info, http(s) only — and the host asks it before the value can reach a column.
      'externalMcpUrl',
      // ⛔ **`externalMcpServerId`** (516) — classified: **no person types it.** It is the id this
      // app minted (`ems:<folded name>`), drawn on a registry row and sent straight back by a
      // remove or a save — a bound with nothing to violate, exactly like `messageId` above.
      //
      // ⚠️ **It is NOT an `isPathSegment`, and that is deliberate rather than a gap**: the `:` is
      // outside that alphabet precisely so no name can spell a separator, which is exactly why the
      // id derived from it cannot be held to the rule its name is. ⚑ The FOREIGN KEY is what
      // refuses one that names no row.
      'externalMcpServerId',
      'launchKey',
      'path', // attachments[] — main classified it, never typed
      'text', // sendShaped, once, for all four send-shaped verbs (735 added `startAndSend`)
      // ⛔ **`endPlanMode`'s text, named and hoisted out of the union** (234 §3, from `228` M3). It
      // was declared inline below, held to `min(1)` — the rule 221 removed from the other three —
      // and invisible to `send-refusals.test.ts`, whose census reads the declarations a
      // message-carrying command is built from. Still a CONSTANT in the shipped app
      // (`GO_AHEAD_MESSAGE`), so it is still not a field a person can type past a bound.
      'goAheadText',
      // ⛔ **`sendToChild`'s message** (296) — the FIFTH message-carrying command, hoisted out of
      // the union for exactly the reason `goAheadText` above it was. ⚠️ **And unlike that one, this
      // IS a field a person types**: it is a composer in the sub-agent viewer, so it is held to
      // `hasSomethingToSend` like every other message and to no length bound at all — the same
      // answer `sendShaped`'s `text` gets, because a message to a child is a message.
      'childMessage',
      'cwd',
      'reasoningEffort',
      'model',
      // Copied from an app-authored link or a recorded work label; never typed into a control.
      'target',
      // A person writes the optional action-answer note, limited to 1,280 characters.
      'note',
      // ⛔ **`stopBackgroundWork.id`** (248) — classified: it is the PROVIDER's own stop key
      // (Claude's `task_id`, Codex's `processId`), handed to the renderer on
      // `background_work.running[].id` and sent back unmodified. No person can type past its bound
      // because no person types it at all: the only control that produces it is a button rendered
      // from a row the provider named, and the bound is the same `.max(200)` the event that carried
      // it declares — a command whose bound disagreed would reject exactly the ids we published.
      'id',
      'value', // setSessionSetting: model
      'value', // setSessionSetting: reasoningEffort
      'sessionId', // exportSession, narrowed to a filename
      'path', // importBundleFile
      'query', // listLibrary
      'providerSessionId',
      'taskId',
      // ⛔ **`revealPath`'s `config-file` name** (356) — classified: **no person types it.** It is one
      // of the `name`s `readProviderConfig` composed and the panel drew, sent back unmodified by a
      // button on that row; the host looks it up in its own list and answers `no-path` when it names
      // nothing. ⚑ **And there is no path behind a guessed value**, which is the whole shape of
      // 356 §1: the renderer names a ROW, so the worst a wrong string can do is fail to match.
      // Bounded at 200 like every other id on this wire.
      'name',
      // ⛔ **`readConfigFile.name`** (733) — the SAME name, classified on the line above's argument:
      // the panel's Open sends back the row's name unmodified, the host looks it up in the same list,
      // and a name that matches nothing answers `no-path`. Listed, not folded — two commands.
      'name',
      // ⛔ **`readCommandOutput.toolCallId`** (300) — classified on `stopBackgroundWork.id`'s
      // argument one field up, and it is the weaker of the two claims for the same reason it is the
      // safer command: no person types it, because the only thing that produces it is a card the
      // app rendered from a call the PROVIDER named. ⚑ **And unlike the stop, a guessed value
      // reaches nothing** — the answer is a map the adapter keyed with ids it minted itself, so an
      // id that names nothing in it is `null` and there is no path, process or directory behind it.
      // The bound is `MAX_BACKGROUND_ID`, the same `.max(200)` `background_work.ended.toolCallId`
      // declares, so this command accepts exactly the ids the events already carry.
      'toolCallId',
      // ⛔ **`readToolAnswer.toolCallId`** (462) — the SAME id, the same classification and the same
      // bound as the line above. ⚑ It is listed rather than folded because this table is a list of
      // FIELDS on the wire and two commands carrying one field name is two entries: a census that
      // deduplicated them would stop noticing if one of the two lost its bound.
      'toolCallId',
      // ⛔ **`readResource.resourceId`** (D-016; `readCanonicalDocument.documentId` from `510`) —
      // classified: **no person types it.** It is `res_<32 hex>` (`src/main/db/ids.ts`), the name this
      // app minted when it kept a file a reply handed in, drawn on the report row, the reply card or
      // in an agent's text, and sent back unmodified. ⚑ **And a guessed value reaches nothing**: the
      // store looks it up in `work_resource` by a parameterised id, so a string that names no row
      // answers `no-such-resource`, and the bytes behind a row are found by the hash it recorded —
      // `readCommandOutput.toolCallId`'s argument two fields up, and the stronger half of it.
      // ⚠️ Bounded at 200 like every other id on this wire; the ids the app mints are far shorter,
      // and a tighter bound would be a second opinion about a format `ids.ts` owns.
      //
      // 🔴 **And the value a person presses is one this file cannot see** (518). That id is read
      // off a REPLAYED `work` report — `WorkReport.documentId` in `510`, `WorkReport.resources`
      // since D-016 — so until `518` the store could hand back an id a million characters long and
      // the row drew a live control whose press answered `Too big: expected string to have <=200
      // characters`: **`221 §3`'s own defect, produced by the one field on this wire that nobody
      // types, arriving from the direction this census does not read.** ⚑ `session-store.ts`'s
      // `MAX_STORED_ID_CHARS` holds the same 200 now, over every resource id a stored report
      // carries, and `two-bounds.test.ts` §5 is where the two numbers are pinned to each other —
      // see the last describe in this file for why it is not pinned here.
      'resourceId',
      // ⛔ **`drawResource.resourceId` and `revealResource.resourceId`** (D-032) — the SAME id, the
      // same classification and the same bound as the line above, listed apart for `toolCallId`'s
      // reason: two commands carrying one field name is two entries.
      'resourceId',
      'resourceId',
      // ⛔ **`openMessagePath.text` and `revealMessagePath.text`** — what a message wrote, as an
      // agent or a person typed it, bounded at `MAX_MESSAGE_PATH_LENGTH`; main resolves it itself.
      'text',
      'text',
      // ⛔ **`filesKept.piece`** (D-026) — classified: **no person types it**, `retitleWork.piece`'s
      // reading below. It is a label or an id the window drew and sends back; a guessed value
      // reaches nothing (`no-piece-by-that-name`). Bounded at 200 like every other id on this wire.
      'piece',
      'agentId',
      'taskId',
      'taskId',
      // 296 — the same child id, asked about and then spoken to. Same `.min(1).max(200)` as the
      // transcript read above it, because it is the same id from the same ledger.
      'agentId', // readChildState
      'agentId', // sendToChild
      'path', // checkCwd
      // ⛔ **`retitleWork.piece`** (D-016 · R4) — classified: **no person types it.** It is the
      // label of a root (`W1`) the header read off the conversation's row in the one list, sent
      // back unmodified by the rename in place. ⚑ **And a guessed value reaches nothing**: the host
      // looks it up by label, else by id, and answers `no-piece-by-that-name` for a string that
      // names no piece. Bounded at 200 like every other id on this wire.
      'piece',
      // 🔴 **`retitleWork.title`** (D-016 · R4) — classified: **a person types it**, in the
      // header's rename field. ⛔ **`PIECE_TITLE_CHARS`, the bound every title already has** — the
      // one `give_work` and `update_work` hold — and the field carries the same constant as its
      // `maxlength`, so no person can type past it. ⚠️ **No `.min(1)`**: a blank title is the
      // host's to judge, and it answers one as a value with a person's sentence
      // (`a-title-is-one-line`) rather than as a wire error.
      'title',
      // ⛔ **`takeBackWork.piece`** — classified: **no person types it**, `retitleWork.piece`'s
      // reading: a label or an id the window drew. A guessed value reaches nothing
      // (`not-a-piece-a-service-is-on`). Bounded at 200 like every other id on this wire.
      'piece',
      // ⛔ **`closeWork.piece`** — classified: **no person types it**, `takeBackWork.piece`'s
      // reading. A guessed value reaches nothing (`not-a-stopped-piece`). Bounded at 200.
      'piece',
      // ⛔ **`setAgentModelAndEffort`'s `model` and `effort`** (677, `R25`) — classified: **no person
      // types either.** They come from a menu — the `models` catalogue — exactly as
      // `createSession`'s `model` and `reasoningEffort` above, and they carry `createSession`'s own
      // bounds (120 and 60) for the same two values. ⚑ **And a guessed value reaches nothing**: the
      // host checks it before a byte is written, and answers `model-not-offered` /
      // `effort-not-offered`. ⚑ **D-042 · R3 moved what it is checked against**: the LIST
      // (`judgeAgainstTheList`) — the provider's rows and the models a person added by hand — so
      // a model a person added is admitted, and anything the list does not hold is refused.
      'model',
      'effort',
      // 🔒 **`setApiKey.key`** — classified: **a person types it** (pastes it), once, on the
      // Providers screen. ⚑ Bounded at 4096 on the wire and by `api-keys.ts`' own words after it
      // (`whyNotAKey`): a bound's message names its limit, never the value, so a refusal here quotes
      // no key either.
      'key',
      // ⛔ **`removeKeptRule.file` and `.kept`** — classified: **no person types either.** They are a
      // file and a rule the kept-rules list drew, sent back by a person's Remove. ⚑ A guessed value
      // reaches nothing: main reads the list again and refuses a file or a rule it does not hold.
      // The file is bounded at 4096, as a path is; the rule at the settings file's own size cap.
      'file',
      'kept',
      // Saved-method keys come from main's listing; no person types them. Each command
      // carries its own bounded key, and main resolves it against a fresh listing.
      'key', // agentMethodBody
      'key', // removeAgentMethod.selection
      // These nullable hashes come from main's guarded reading, never a text control.
      // The wire requires 64 lowercase hex characters; main rechecks both images.
      'fingerprint',
      'indexFingerprint',
      // A person chooses a history row. Main checks its id still names the latest
      // effective change; no person types this 1–1,024-character ledger identifier.
      'changeId',
      // ⚑ **D-050** — `setAgentModelLimit.highestEffort` was classified here; it went with the
      // agents' limit, and the limit's `models[]` with it (a third field `aModelsName` bounded).
      // 🔴 **`entry`** (625) — classified: **no person types it, and it is not a PATH either.** ⛔
      // It is the absolute path THIS APP produced in a previous `agentMemory` reading, sent
      // straight back by `amendAgentMemory` — `messageId`'s classification, on a string that
      // happens to look like a filename. ⚠️ **Nothing validates it as a path because nothing
      // treats it as one**: main re-derives the store and looks this string up in what came back,
      // so a value this app never produced matches nothing and is refused. ⚑ **A path check here
      // would be a second, weaker answer to a question the lookup already answers exactly** —
      // `a-positive-assertion-must-differ-from-the-default` at a validator. 🔴 The `.max(4096)` is
      // the ordinary size bound every string on this wire carries, and nothing turns on it.
      'entry',
      // Hash of the text displayed to the person, and a main-issued source record id.
      'fingerprint',
      'sourceId',
      // ⛔ **`askId`** (582) — classified: **no person types it.** It is the name this app minted
      // for an ask an agent made (`iprop_<uuid>`), drawn on the identity's sheet and sent straight
      // back by `decideInstruction`. ⚑ A bound with nothing to violate, exactly like `messageId`
      // above it — and its own schema rather than `messageId` reused, because the two ids are
      // looked up in different places and one bound over two populations is how a door comes to
      // answer about the wrong row.
      'askId',
      // `requestId` on `decideMcpServerRequest` — classified: no person types it. It is the id this
      // app made for an agent's request to register an MCP server (`msreq_<uuid>`), drawn on its
      // card and sent straight back. A guessed one finds no waiting request and registers nothing.
      'requestId',
    ])
  })
})

describe('221 §3 · the CONTROL holds the bound the wire holds', () => {
  it('🔴 the library search box carries `LIBRARY_QUERY_MAX`, not a number of its own', () => {
    // ⛔ The instance that was live: 200 characters is one paste, and the answer was
    // `query: Too big: expected string to have <=200 characters` in the library's error line.
    const input = elementWith(codeOf(LIBRARY), 'library-search')
    expect(input, 'the search input was not found').toContain('<input')
    expect(input).toContain(':maxlength="LIBRARY_QUERY_MAX"')
  })

  it("🔴 the library's restore field carries `MAX_PATH_CHARS`, the ceiling its command holds", () => {
    expect(elementWith(codeOf(LIBRARY), 'library-bundle-path')).toContain(
      ':maxlength="MAX_PATH_CHARS"',
    )
    // ⚑ **417 (HO-022 §2) removed the second half of this test, and it was the launcher's.** The
    // assertion here was `elementWith(codeOf(LAUNCHER), 'cwd-input')` — the front door's folder
    // field, the control that asked `checkCwd` and supplied `createSession.cwd`. The whole row
    // (`cwd-input`, `cwd-choose`, `cwd-refusal`) went with every other question the launcher used
    // to ask. ⛔ **The RULE did not go**: the project sheet's `project-cwd-input` was the other
    // person-typed path field bounded by the same constant until D-016 deleted the sheet with
    // projects. There is no unbounded path field left — this is a deletion, not a hole.
  })

  it('🔴 the new-agent sheet carries `AGENT_DISPLAY_NAME_CHARS`, and the name box carries no length', () => {
    // ⛔ **`419` wrote the promise and could not keep it.** `ipc.ts:171` reads *"⚠️ The bound the
    // CONTROL will carry too — see {@link AGENT_DISPLAY_NAME_CHARS} (221 §3, 419)"*, and
    // `scripts/mutations/419/mutations.py` says the same out loud — *"No row on
    // `AGENT_DISPLAY_NAME_CHARS`. Nothing in this app renders an identity's display name"*. `423`
    // is the control, so this is the assertion that stops the classification in §1's table from
    // being a claim about a field that does not exist.
    const form = codeOf(NEW_AGENT)
    expect(elementWith(form, 'new-agent-name')).toContain(':maxlength="AGENT_DISPLAY_NAME_CHARS"')
    // 🔴 **And the name box deliberately carries NONE.** §1's table classifies `agentSlug` as
    // bounded by its ALPHABET rather than by a length — `isPathSegment` is the stronger guard —
    // and a `maxlength` beside it would be a second, weaker rule about the same field.
    expect(elementWith(form, 'new-agent-slug')).not.toContain('maxlength')
    expect(form, 'the slug is bounded by the shared refinement, or this test is a hole').toContain(
      'isPathSegment(folded.value)',
    )
  })

  it('⚑ the extractor notices an input with NO bound — the teeth', () => {
    // Without this, a version of `elementWith` that returned the whole file would find every string
    // above somewhere in it and pass forever. This is the false-green direction.
    const bare = '<div><input v-model="q" type="search" data-cy="library-search" /></div>'
    expect(elementWith(bare, 'library-search')).not.toContain('maxlength')
    expect(elementWith(bare, 'nothing-by-this-name')).toBe('')
    // …and it stops at the element it was asked about rather than swallowing the next one.
    const two = '<input data-cy="a" /><input :maxlength="9" data-cy="b" />'
    expect(elementWith(two, 'a')).not.toContain('maxlength')
  })
})

describe('221 §3 · and the wire still refuses past the bound', () => {
  it('an action answer note accepts 1,280 characters and refuses the next one', () => {
    const answer = (note: string) => ({
      kind: 'answerAction',
      sessionId: 'fictional-session',
      request: 'fictional-request',
      done: true,
      note,
    })
    expect(runtimeCommandSchema.safeParse(answer('n'.repeat(1_280))).success).toBe(true)
    expect(runtimeCommandSchema.safeParse(answer('n'.repeat(1_281))).success).toBe(false)
  })

  it('🔴 accepts a value AT the ceiling and refuses one past it, on all three fields', () => {
    const ok = (command: unknown): boolean => runtimeCommandSchema.safeParse(command).success

    expect(ok({ kind: 'listLibrary', query: 'q'.repeat(LIBRARY_QUERY_MAX) })).toBe(true)
    expect(ok({ kind: 'listLibrary', query: 'q'.repeat(LIBRARY_QUERY_MAX + 1) })).toBe(false)

    expect(ok({ kind: 'checkCwd', path: '/'.repeat(MAX_PATH_CHARS) })).toBe(true)
    expect(ok({ kind: 'checkCwd', path: '/'.repeat(MAX_PATH_CHARS + 1) })).toBe(false)

    const bundle = (path: string) => ({ kind: 'importBundleFile', path })
    expect(ok(bundle('/'.repeat(MAX_PATH_CHARS)))).toBe(true)
    expect(ok(bundle('/'.repeat(MAX_PATH_CHARS + 1)))).toBe(false)
    // ⚠️ …and the `min(1)` beside it, which the restore button gates but the wire must still hold.
    expect(ok(bundle(''))).toBe(false)
  })
})

/**
 * # 🔴 518 · what this census is the boundary OF
 *
 * ⛔ **`510` F3 asked whatever makes this file blind to `work` to be named**, because a bound added
 * where the suite still cannot see it leaves the next payload unguarded exactly as that one was.
 *
 * ## ⚠️ What it reads, in one sentence
 *
 * Every `z.string()` DECLARATION inside `runtimeCommandSchema` — one schema, one direction
 * (**renderer → main**), one JS type — plus the four controls that must carry those bounds, plus
 * the wire's own refusal at three ceilings.
 *
 * ## ⛔ Why `work` is not a hole in it
 *
 * 🔴 **`work` is not on this wire.** It is a field on three app-authored TRANSCRIPT EVENT
 * interfaces in `shared/runtime-ipc.ts`, which travel **main → renderer** and into the database,
 * and which carry **no zod anywhere** — `shared/runtime-ipc.ts` does not import it, and the
 * `TranscriptEvent` union's 23 app-authored members are TypeScript interfaces only. ⚠️ So this
 * file's regex has nothing to match, and the census can neither grow nor shrink because of a
 * stored field. ⛔ **The blindness is the census's BOUNDARY, not a defect in it.**
 *
 * ## ⚑ So it cannot be extended to them, and what notices instead
 *
 * ⛔ **Not the way it reads this wire.** There is no schema on the other side to lift a constraint
 * from: `toWireEvent`'s `runtimeEventSchema` is 26 PROVIDER arms and contains no `user_turn`, and
 * the stored path deliberately never re-parses — `boundStoredEvent`'s own first line is *"on the
 * one path that never re-parses"*. ⚠️ A second census here could extract field NAMES and nothing
 * more, and the bound decision would still live in a hand-written table.
 *
 * 🔴 **What notices is a census addressed to the BOUND, on the other side**: `two-bounds.test.ts`
 * §4 reads `WorkReport`'s declaration against the keys `boundedWorkReport` constructs and goes red
 * when they disagree — which is the edit that produced this gap, made visible where it happens.
 * ⚠️ **That covers one payload and not the class.** The general instrument — a classification per
 * declared field of all 23 app-authored event types — is named as a finding rather than built
 * here, because it is a census and not a bound.
 */
describe('518 · the boundary of this census, asserted rather than assumed', () => {
  it('⛔ `runtimeCommandSchema` declares no `work` field — so the table above is silent by fact', () => {
    // ⚠️ **A negative is only as strong as its search shape** (standing rule 4), and the first
    // version of this was narrower than the sentence above it. It asked for `work` followed by
    // `z.` — which would have missed `grant: capabilityGrantSchema`, a real field on this very
    // schema declared through a named schema rather than an inline `z.`. ⛔ **The shape here is
    // the NAME being bound to anything at all**, so a field added in either style is a hit.
    //
    // ⚑ **And it reads the same REGION the census above reads**, not the whole file: `ipc.ts`
    // holds handlers and prose beside the schema, and a negative taken over all of it would be
    // answering a different question from the one this block's title asks.
    const code = codeOf(SCHEMA)
    const region = code
      .slice(code.indexOf('const sessionId ='), code.indexOf('satisfies z.ZodType<RuntimeCommand>'))
      .replace(/\s+/g, ' ')
    expect(region.length, 'the schema region was not found').toBeGreaterThan(2_000)
    const declarations = (source: string, field: string): number =>
      [...source.matchAll(new RegExp(`\\b${field}\\s*[:=]\\s*[\\w.]`, 'g'))].length
    expect(declarations(region, 'work')).toBe(0)
    // ⛔ **Two positive controls, and the second is the one that matters**: an inline `z.string()`
    // field, and a field bound to a NAMED schema — the style the first version of this search
    // could not see.
    // ⚑ D-016 · `readResource.resourceId` is the inline `z.string()` field `documentId` was.
    expect(declarations(region, 'resourceId')).toBeGreaterThan(0)
    expect(declarations(region, 'grant')).toBeGreaterThan(0)
    // ⚑ …and the extractor finds a declaration in either style when one is planted.
    expect(declarations('const work = z.string().max(9)', 'work')).toBe(1)
    expect(declarations('{ work: someNamedSchema }', 'work')).toBe(1)
    // ⚠️ …and is not satisfied by the NAME appearing on its own, which is what makes the zero a
    // measurement rather than an artefact of a word that happens to be absent.
    expect(declarations('host.work(command.work)', 'work')).toBe(0)
  })
})
