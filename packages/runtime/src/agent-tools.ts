import { z, type ZodRawShape } from 'zod'

/**
 * ⛔ **Tools an agent may call to reach the app it is running inside — declared once, neutrally,
 * and translated by each adapter into whatever its provider reads** (347).
 *
 * ⚑ **This file holds no policy.** Not one rail, not one capability check, not one refusal. `341`
 * landed twelve rails at the session-creation chokepoint and the whole point of that ordering is
 * that the tool layer arrives into a door that already refuses — *"if you find yourself writing a
 * capability check in the tool layer, that is the defect this ordering exists to prevent"* (169 §1:
 * one rule in two places drifts). What lives here is a SHAPE: a name, a description, an argument
 * schema and a call. What the call is allowed to do is decided somewhere else.
 *
 * ## 🔴 Why the declaration is neutral when only one provider reads it today
 *
 * ⚠️ **The two providers acquire tools by different mechanics, and that asymmetry is the design
 * constraint** (307). **Claude** is handed its servers as an option on every `query()` — including
 * the query a RESUME constructs, because the old one died with the process. **Codex** is handed
 * them ONCE, on `thread/start`, and the app-server remembers them: `348` measured a second
 * app-server process resuming a thread and rebuilding the same inventory from its own
 * `thread_dynamic_tools` table. One is re-supply, the other is survival.
 *
 * ⚠️ **`307` said the durable thing was `[mcp_servers]` in the home's `config.toml`, and `348`
 * corrected the noun rather than the shape.** Codex does read that file, and this app writes
 * nothing into it — `ThreadStartParams.dynamicTools` is a door on the connection we already hold,
 * so the tools cost no subprocess, no port, and not one byte of a file Codex co-owns. The
 * asymmetry survives the correction: Claude re-supplies, Codex survives.
 *
 * ⛔ **Forgetting the re-supply is how a spawned agent silently loses its tools**, and a neutral
 * declaration is what makes forgetting it hard: this rides on {@link ProviderRuntimeContext}, the
 * one type both `StartOptions` and `ResumeOptions` extend, whose every member documents the same
 * promise — *"a RESUMED session must come back with the value it was created with"*. A resume that
 * dropped the toolset would have to delete a field it never sets, rather than merely forget to add
 * one.
 *
 * ⚑ **And the neutral declaration is what made the second adapter cheap.** `347` shipped this file
 * with one reader and wrote that *"the adapter that gains one later translates the same declaration
 * rather than being handed a second one"*. `348` is that adapter, and it did: five tools, two
 * providers, one declaration, and not one line of policy in either translation.
 */

/**
 * What one call answered with.
 *
 * ⛔ **A refusal is a SUCCESSFUL call whose payload says refused, and this type has no error
 * member because of it** (307). A thrown handler becomes transport-shaped `-32603` on both
 * providers and *"carries no machine-readable policy meaning"* — neither child learns which rail
 * stopped it, whether the answer is permanent, or whether retrying could ever work. The structured
 * form was measured to be read as policy by both models; the thrown one was read as a broken tool.
 *
 * ⚠️ **So a handler that throws is a defect, not a refusal path**, and the one thing every
 * implementation owes this contract is to answer rather than raise.
 */
export interface AgentToolAnswer {
  /**
   * The text the model reads.
   *
   * ⚠️ **Bounded by the caller, not here.** `327` measured a real MCP result come back as a single
   * 90,047-character text block which the app-server passed through whole; what to do about that is
   * the transcript's problem and is already solved there.
   */
  readonly text: string
  /**
   * The same answer as data, when there is one.
   *
   * Internal data for application consumers. Adapters send only the prose to the model;
   * message receipts use a separate bounded pairing route.
   */
  readonly structured?: Readonly<Record<string, unknown>>
}

/**
 * 🔴 **What a verb does that its own rails do not cover** (486, HO-031 §2.4).
 *
 * ## ⛔ A fact about the VERB, and deliberately not a policy about the card
 *
 * ⚠️ **This file holds no policy and this vocabulary does not break that** — see the module note.
 * Each word describes what CALLING the verb does in the world; what an app should therefore ask a
 * person is decided by the adapters' permission floors, which read this the way they read a tool's
 * name. ⛔ A member spelled *ask-a-person* would be the policy arriving here in a costume.
 *
 * ## 🔴 The ruling it exists to make derivable
 *
 * ⚑ **HO-031 §2.4:** *"The brobot tools are gated by RAILS. Permissions are for acts that reach
 * outside this app."* ⚠️ **§2.9 measured the cost of not having this**: a project manager needed a
 * human approval to call `reply_to_parent` — *"it had to ask permission to answer its parent"* —
 * and *"double-gating them means every task needs a human click to close, which breaks the loop the
 * tools exist to make."*
 *
 * ⛔ **Required, not optional, so a verb added later cannot skip the question.** That is standing
 * rule 2's shape — *a verb added to the vocabulary is classified in the same commit* — bought with
 * a compile error rather than with a reviewer's memory.
 *
 * ⚑ **And the SPLIT is then derivable from the declarations** rather than from anybody's prose,
 * which is standing rule 8: a table rendered from the data cannot drift from what the app does.
 */
export const BEYOND_ITS_RAILS = [
  /**
   * ⚑ **Nothing.** The rails answer *may you* for this verb and there is no second question: it
   * reads or writes this app's own state, through a door that already refuses.
   */
  'nothing-its-rails-do-not-cover',
  /**
   * ⛔ **It starts something outside this app** — a process, a provider, a spend. ⚠️ The rails can
   * answer *may you*; they cannot answer *should you, now*, and the thing on the other side is not
   * ours to take back.
   */
  'it-starts-something-outside-this-app',
  /**
   * ⛔ **It destroys work that is in flight.** ⚠️ What is part-way through is thrown away and no
   * verb in this roster puts it back.
   */
  'it-destroys-work-in-flight',
] as const

export type BeyondItsRails = (typeof BEYOND_ITS_RAILS)[number]

/** One tool: what it is called, what it is for, what it takes, and what it does. */
export interface AgentToolDefinition {
  /**
   * The tool's own name, unqualified.
   *
   * ⚠️ **Not the name the model will say.** Both providers qualify it with the server —
   * `mcp__<server>__<tool>` — and `307` measured Codex reporting the pair separately while Claude
   * reports the qualified string. The declaration stays unqualified on both.
   */
  readonly name: string
  readonly description: string
  /**
   * 🔴 **What calling it does that its rails do not cover** (486) — see {@link BEYOND_ITS_RAILS}.
   *
   * ⛔ **Required, so the question cannot be skipped by a verb added later**, and read by each
   * adapter's permission floor to decide whether a person is asked as well as the rails.
   */
  readonly beyondItsRails: BeyondItsRails
  /** For a verb some of whose calls do more than its word says: the word for the call with these arguments. */
  readonly beyondItsRailsWhen?: (args: Readonly<Record<string, unknown>>) => BeyondItsRails
  /** The argument schema, as a zod object shape. */
  readonly input: ZodRawShape
  /** Missing declared fields reach this tool's own validator, with its typed schema still advertised. */
  readonly handlerOwnsMissingInput?: boolean
  /**
   * Do it.
   *
   * ⛔ **Must not throw.** See {@link AgentToolAnswer}.
   */
  readonly call: (args: Record<string, unknown>) => Promise<AgentToolAnswer>
}

/** What this call does that its rails do not cover: the tool's word, unless its arguments say more. */
export function beyondItsRailsOf(tool: AgentToolDefinition, args: unknown): BeyondItsRails {
  if (tool.beyondItsRailsWhen === undefined) return tool.beyondItsRails
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return tool.beyondItsRails
  return tool.beyondItsRailsWhen(args as Readonly<Record<string, unknown>>)
}

/** A named set of tools, offered to one session. */
export interface AgentToolset {
  /**
   * The server name the provider will qualify every tool with.
   *
   * ⚠️ **Part of the tool names the model sees**, so it is as good as public and changing it renames
   * every tool.
   */
  readonly server: string
  /**
   * How to use the tools, when there is anything to say.
   *
   * ⚑ **Claude is handed them with the catalogue**, as the in-process MCP server's `instructions`.
   * 🔴 **D-039 · Codex is not**: its catalogue is one namespace whose description the app-server caps
   * (`CODEX_NAMESPACE_DESCRIPTION_LIMIT`), and these outgrew it — so its adapter declares one
   * sentence (`CODEX_TOOLS_DESCRIPTION`) and never reads this field. ⛔ **A caller that launches Codex
   * says them in the conversation itself**: the app puts them in front of the first message of every
   * life (`thisConversationSpans`'s tools section), and again after a compaction or a turn its
   * provider never began. A caller that does not leaves its Codex model without them.
   */
  readonly instructions?: string
  readonly tools: readonly AgentToolDefinition[]
}

/**
 * Publish a closed string vocabulary without moving malformed calls out of the app's own door.
 *
 * ## The ordinary spellings each lose one half
 *
 * `z.string()` lets an unknown word reach a handler, where the app can answer with its structured
 * `malformed-request` rail, but both providers advertise only `{ type: "string" }`. `z.enum()`
 * advertises the members, but Claude validates before the handler and turns an unknown word into
 * transport error `-32602` — no rail, permanence, retryability or list of legal values.
 *
 * This schema deliberately does both jobs. The enum is the JSON Schema both adapters publish. Its
 * catch returns the original bad input at runtime, so the handler still owns the refusal. That
 * deliberately makes the parsed output `unknown`, not the advertised member union: every door
 * must narrow the value it receives, and this exported helper must not promise a type its catch
 * does not enforce. The outer `nonoptional()` keeps a required field required; callers that want
 * omission call `.optional()` on the returned schema.
 *
 * ## Why the callback has an `undefined` arm
 *
 * Zod's JSON-Schema converter asks a catch for a static value by invoking its callback with
 * `undefined`. Returning `undefined` there keeps a false `default` out of the schema. During a real
 * failed parse Zod supplies a context object, whose `input` is the value the handler must see.
 * The Claude adapter test drives both `tools/list` and `tools/call` through the pinned MCP SDK; the
 * Codex test reads the dynamic-tool schema and drives the raw call. This is therefore a measured
 * provider boundary, not an assumption about Zod internals.
 */
export function agentToolStringEnum<const Members extends readonly [string, ...string[]]>(
  members: Members,
): z.ZodType<unknown> {
  const schema = z
    .enum(members)
    // Zod types a catch fallback as the successful output even though it returns that fallback at
    // runtime. Keep that unavoidable cast inside this helper; the exported type below is honest.
    .catch((failure) => (failure === undefined ? undefined : failure.input) as Members[number])
    .nonoptional()
  return schema as z.ZodType<unknown>
}

const MISSING_TOOL_ARGUMENT = Symbol('missing tool argument')
const REQUIRED_HANDLER_FIELDS = new WeakSet<z.core.$ZodType>()

/** Catch the object's separate absent-property check without discarding its advertised shape. */
export function agentToolHandlerObject(shape: ZodRawShape): z.ZodType<unknown> {
  const advertised = z.looseObject(shape)
  return advertised.catch((failure) => {
    // JSON Schema conversion asks for a static fallback; no default is advertised.
    if (failure === undefined) return undefined as never
    // Zod supplies the parsed object here; reply field schemas preserve values without transforms.
    const raw = failure.input
    const request: Record<string, unknown> =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {}
    for (const [field, schema] of Object.entries(shape)) {
      if (
        !Object.hasOwn(request, field) &&
        (REQUIRED_HANDLER_FIELDS.has(schema) || !z.core.safeParse(schema, undefined).success)
      ) {
        request[field] = MISSING_TOOL_ARGUMENT
      }
    }
    return request
  })
}

/** Preserve advertised field types while handing malformed values to the app's validator. */
export function agentToolHandlerInput(schema: z.core.$ZodType): z.ZodType<unknown> {
  const caught = z.catch(schema, (failure: z.core.$ZodCatchCtx | undefined) =>
    failure === undefined
      ? undefined
      : failure.input === undefined
        ? MISSING_TOOL_ARGUMENT
        : failure.input,
  )
  const optional = z.core.safeParse(schema, undefined).success
  const input = optional ? caught : caught.nonoptional()
  const description = z.globalRegistry.get(schema)?.description
  const described = description === undefined ? input : input.describe(description)
  if (!optional) REQUIRED_HANDLER_FIELDS.add(described)
  return described
}

/** The private missing token is not a value a JSON caller can supply. */
export function toolArgumentsAtHandler(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      value === MISSING_TOOL_ARGUMENT ? undefined : value,
    ]),
  )
}
