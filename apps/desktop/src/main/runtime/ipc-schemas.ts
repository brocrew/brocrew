import { resolveProviderLaunchSchema } from '../connections/launch-schema'
import { SkillsRequest } from '../../shared/skills-window'
import { FOREST_PAGE, FOREST_WINDOWS } from '../../shared/the-whole-forest'
import { z } from 'zod'
import { CONVERSATION_IDENTITY_BATCH_SIZE } from '../../shared/conversation-title'
import { ALL_TASKS_FILTERS } from '../../shared/conversation-task-page'
import { MAX_SETTINGS_BYTES } from '@brobot2/runtime'
import { providerSchema } from '@brobot2/shared'
import { MAX_PATH_CHARS, type RuntimeCommand } from '../../shared/runtime-ipc'
// ⚑ **516 · the one bound this file needs from the registry's own module.** The RULES stay at the
// door — see {@link externalMcpServerName} for why a validator must not hold half of them.
import { MAX_EXTERNAL_MCP_GRANTS } from '../../shared/external-mcp'
// ⚑ **D-016 · commit 7 · R4 — a title's bound**, the one `give_work` and `update_work` hold.
import { PIECE_TITLE_CHARS } from '../../shared/piece-called'
import { MEMORY_EDIT } from '../../shared/agent-memory'
import { OWN_NOTES_REASON_PROBLEM } from '../../shared/own-notes'
import {
  sessionId,
  deletePartId,
  profileId,
  aModelsName,
  agentSlug,
  agentDisplayName,
  ownInstructions,
  ownNotesText,
  ownNotesVersion,
  memoryText,
  externalMcpServerName,
  externalMcpUrl,
  externalMcpServerId,
} from './ipc-input'
import { conversationCommands } from './ipc-conversation-commands'

export const runtimeCommandSchema = z.discriminatedUnion('kind', [
  ...conversationCommands,
  /**
   * What each provider can do (039). No parameters at all: the renderer does not get to ask about
   * one provider, because asking about one means naming one. It receives every declaration and
   * looks up whichever provider is selected.
   */
  z.object({ kind: z.literal('capabilities') }),
  z.object({ kind: z.literal('providerCatalogue') }),
  z.object({ kind: z.literal('providerConnections') }),
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
  z.object({
    kind: z.literal('checkProviderAuth'),
    provider: providerSchema,
    profileId,
    probe: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('reprovisionProviderHomes'),
    provider: providerSchema,
    statusOnly: z.boolean().optional(),
  }),
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
  z.object({
    kind: z.literal('forestReading'),
    scope: z.discriminatedUnion('is', [
      z.object({ is: z.literal('the-workspace'), window: z.enum(FOREST_WINDOWS) }),
      z.object({ is: z.literal('the-tree-of'), conversation: sessionId }),
    ]),
  }),
  z.object({
    kind: z.literal('forestNodes'),
    drawn: z.array(sessionId),
    conversations: z.array(sessionId).min(1).max(FOREST_PAGE),
  }),
  // ⚑ **D-018 · no fields at all, and it is `whatIsBeingDone`'s ruling**: the answer is every
  // conversation this app is RUNNING, and the pids are main's own. ⛔ A pid on the wire would be a
  // renderer naming a process for main to read — the one thing this read must never do.
  z.object({ kind: z.literal('processMemory') }),
  // ⚑ **The identity door** (355, HO-008 §3 · P0b) — the read, the write and the switch.
  // ⚠️ An identity is global, so neither names anything but the identity.
  // ⛔ **D-020 · strict, both** (`z.strictObject`): a field nobody declared is a REFUSAL, not a
  // silent strip — a person's settings are the last place a mistyped field should be dropped
  // without a word.
  z.strictObject({ kind: z.literal('skills'), request: SkillsRequest }),
  z.strictObject({ kind: z.literal('agentIdentities') }),
  z.strictObject({
    kind: z.literal('setExternalMcpServers'),
    // ⛔ **REQUIRED here, unlike the shared `profileId`.** This command is about one identity by
    // name; an absent one is not "the default profile", it is a caller that has not said which.
    profileId: profileId.unwrap(),
    /**
     * 🔴 **516 · the COMPLETE set of RESTRICTED servers this identity is granted** (narrowed by 524).
     *
     * ⛔ **Required, not `.optional()`** — an empty list is *this person unticked every box*.
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
   * ⛔ **`profileId.unwrap()`, exactly as `setExternalMcpServers` above**: this command is about one
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
  z.object({ kind: z.literal('readConversationIdentity'), sessionId }),
  z.object({
    kind: z.literal('readConversationIdentities'),
    sessionIds: z.array(sessionId).max(CONVERSATION_IDENTITY_BATCH_SIZE),
  }),
  z.object({
    kind: z.literal('readConversationTasks'),
    sessionId,
    cursor: z.string().max(2048).optional(),
  }),
  z.object({
    kind: z.literal('readAllConversationTasks'),
    sessionId,
    filter: z.enum(ALL_TASKS_FILTERS),
    text: z.string().optional(),
    cursor: z.string().optional(),
  }),
  z.object({
    kind: z.literal('readConversationTitleHistory'),
    sessionId,
    before: z
      .object({ generation: z.int().nonnegative(), ordinal: z.int().nonnegative() })
      .optional(),
  }),
  z.object({
    kind: z.literal('renameConversation'),
    conversation: z.string(),
    title: z.string(),
  }),
  z.object({
    kind: z.literal('setCurrentRules'),
    conversation: z.string(),
    text: z.string(),
  }),
  // ⚑ A person takes back the piece a service is on, by its label or its id: `retitleWork`'s bound.
  z.object({
    kind: z.literal('takeBackWork'),
    piece: z.string().min(1).max(200),
  }),
  // ⚑ A person closes stopped work, by its label or its id: `takeBackWork`'s bound.
  z.object({
    kind: z.literal('closeWork'),
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
  z.object({ kind: z.literal('providerLaunchChoices'), provider: providerSchema, profileId }),
  resolveProviderLaunchSchema(profileId),
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
    baseline: z.object({ expectedVersion: z.number().int().min(0) }).optional(),
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
    asAService: z.literal(true).optional(),
  }),
]) satisfies z.ZodType<RuntimeCommand>
