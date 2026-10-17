import { z, type ZodRawShape } from 'zod'

/**
 * **The tools one conversation has** (358) — the provider-neutral vocabulary for them.
 *
 * BroBot tools are in-process: `createSdkMcpServer` on Claude and `ThreadStartParams.dynamicTools` on Codex. They require no `config.toml`, stdio transport or separate server process. Inspect the published inventory; even a TOML table would not prove tool availability because the parser ignores unknown keys.
 *
 * ## 🔴 Two halves, and merging them would be the lie this event exists to prevent
 *
 * ⛔ **`declared` is what BroBot handed this session. `published` is what the child says it has.**
 * They are different facts, they come from different places, and only one of them is evidence.
 *
 * | | where it comes from | what it proves |
 * |---|---|---|
 * | {@link DeclaredToolset} | the `AgentToolset` this session was constructed with | what was OFFERED |
 * | {@link PublishedInventory} | the child's own `system/init` frame | what the child ACCEPTED |
 *
 * ⚠️ **`declared` is not a hardcoded list, and it is also not proof.** It is this session's own
 * toolset object — `353` measured the ordinary Codex launch path putting exactly the five qualified
 * names into the child's inventory, and its negative control put in none — but the whole reason
 * `353` had to be run at all is that a declaration can be made and not arrive. So a surface may
 * render `declared` as *offered* and may render only `published` as *confirmed*, and Slice 2's
 * acceptance #7 (*nothing unwired may imply a working state*) is why that distinction is in the
 * type rather than in a component's discretion.
 *
 * ## ⚠️ The providers do not both publish, and this vocabulary says so out loud
 *
 * | provider | publishes an inventory | measured where |
 * |---|---|---|
 * | **Claude** | ⚑ **yes** — `SDKSystemMessage.tools` + `.mcp_servers`, on the first `system/init` | `probe:tool-inventory` |
 * | **Codex** | ⛔ **no** — `dynamicTools` is write-only; no response, notification or thread field carries one back | this file's §"Codex publishes nothing" |
 *
 * ⛔ **So `published: null` is a first-class state and not a missing value.** It means *this
 * provider does not publish an inventory*, which is permanently different from *we have not been
 * told yet* — and the second of those is the ABSENCE of the event, exactly as
 * `provider-commands.ts` makes `undefined ≠ []` unforgeable by leaving `commands` required. Three
 * states, three renderings, and no adapter can produce the wrong one by accident.
 *
 * ## ⛔ Codex publishes nothing, and that is measured rather than assumed
 *
 * `348` sends the namespace on `thread/start` and `ThreadResumeParams` has no field for it — the
 * app-server remembers the DECLARATION in its own `thread_dynamic_tools` table. Every type that
 * could carry an inventory back was read: `ThreadStartResponse`, `ThreadStartedNotification`,
 * `ThreadResumeResponse`, `Thread` (whose `extra` is `Record<string, never>`), `ThreadReadResponse`
 * and `ThreadSettings` have no tools field at all. The one echo anywhere on that protocol is
 * `mcpServerStatus/list`, which is about servers configured in `config.toml` and therefore about
 * the exact mechanism this app does not use. ⚑ **`353` saw a Codex inventory once, and only by
 * standing up a fake Responses endpoint and reading the child's own outbound request body** — an
 * instrument that cannot exist for a conversation talking to OpenAI.
 *
 * ## ⚠️ The published inventory names tools; it never describes them
 *
 * Measured (`probe:tool-inventory`, two independent runs): `SDKSystemMessage.tools` is a flat array
 * of strings. The sibling door `Query.mcpServerStatus()` carries a `tools[]` per server whose
 * `description` is declared optional — and for an in-process SDK server the CLI **sends none**, so
 * every one came back `undefined`. ⛔ **That is why {@link DeclaredTool} carries the sentence.** A
 * description shown beside a published name is BroBot's own words about its own tool, joined by
 * name; for a third-party MCP server there is no sentence available from anywhere, and a surface
 * must show the row with no second line rather than invent one.
 *
 * ⛔ **And `mcpServerStatus()` is not a second door worth opening.** Asked before the stream is
 * consumed it answers `[]` — *answered, and named no server* — which is byte-identical to the
 * honest answer for a conversation that genuinely has none. A surface built on it at launch would
 * say *"no tools"* about a conversation holding five. It becomes truthful at exactly the moment
 * `system/init` does, and by then `system/init` has already said everything it would have added.
 */

/**
 * One argument a tool takes.
 *
 * ⚑ **Flattened from the JSON Schema the MODEL was given**, not from a second reading of the zod
 * shape beside it — see {@link parametersOf}. Raw JSON Schema is never shown: a person reading a
 * tool row wants to know what it takes, and a `{"type":"object","properties":…}` block is the
 * schema wearing the costume of an answer.
 */
export interface ToolParameter {
  /** The argument's own key, as the model must spell it — `profile_slug`, not `profileSlug`. */
  readonly name: string
  /**
   * The JSON Schema type word, or `'unknown'` when the schema states none.
   *
   * ⚠️ **A word, never a rendering of the schema.** A union comes back as its members joined by
   * `|`; anything this cannot read says `unknown` rather than guessing `string`, because a type
   * shown wrongly is worse than a type not shown at all.
   */
  readonly type: string
  /**
   * ⛔ **Required by the schema the child was handed** — the same document that decides whether a
   * call is well-formed, so this cannot drift from what the model is actually held to.
   */
  readonly required: boolean
  /** The `.describe()` sentence, when the declaration carries one. Absent is a real state. */
  readonly description?: string
}

/** One tool BroBot declared for this session — its name, what it does, and what it takes. */
export interface DeclaredTool {
  /**
   * The tool's own name, UNQUALIFIED.
   *
   * ⚠️ **Not the name the model says.** Each provider qualifies it its own way —
   * `mcp__brobot__give_work` on Claude, `brobot__give_work` on Codex (327 §2.4) — which is why
   * a surface joining this to a published name must qualify rather than compare bare strings. See
   * {@link qualifiedName}.
   */
  readonly name: string
  /** What it does, in BroBot's own words — the same sentence the model reads. */
  readonly description: string
  readonly parameters: readonly ToolParameter[]
}

/** What BroBot handed this session: one server, and the tools under it. */
export interface DeclaredToolset {
  /** The server/namespace name every tool is qualified with — `brobot`. */
  readonly server: string
  /** The sentence offered to the model alongside the catalogue, when there is one. */
  readonly instructions?: string
  readonly tools: readonly DeclaredTool[]
}

/**
 * One MCP server the child named, in the child's own words.
 *
 * ⛔ **`status` is the provider's string and is NOT narrowed to a union here.** The pinned SDK types
 * it `'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'`, but this vocabulary is
 * neutral and a provider that ships a sixth word must arrive as that word rather than as a parse
 * failure that loses the whole frame. A surface gives an unknown word its own neutral tone; it may
 * never count it as connected.
 */
export interface PublishedServer {
  readonly name: string
  readonly status: string
}

/** What the child published about itself, on the one frame that carries it. */
export interface PublishedInventory {
  /**
   * Every model-visible tool name, VERBATIM and qualified as the provider qualifies it.
   *
   * ⚑ Built-ins and MCP tools in one list, because that is how the child states it — measured at 37
   * names for an ordinary launch, of which 5 were `mcp__brobot__*` and 32 were built-ins, against a
   * control with the toolset detached that reported 32 and none.
   */
  readonly tools: readonly string[]
  /** Every MCP server the child named, with its own word for the connection. */
  readonly servers: readonly PublishedServer[]
}

/**
 * The most tools one declaration will carry.
 *
 * ⚑ Same shape of bound as `MAX_PROVIDER_COMMANDS`, and the same rule: a cap is never silent
 * — `tool_inventory.dropped` says out loud when it bit. Measured, this app declares **five**; 100
 * exists so one malformed toolset cannot become a permanent list in every store downstream (052).
 */
export const MAX_DECLARED_TOOLS = 100

/**
 * The most published names one frame will carry.
 *
 * Measured at **37** for an ordinary Claude launch. 400 is an order of magnitude above it and is
 * about a payload ceiling rather than about any expected catalogue: `ToolSearch` exists in that
 * list precisely because a session can defer hundreds of tools, and a build that surfaced them all
 * must not be able to write an unbounded row.
 */
export const MAX_PUBLISHED_TOOLS = 400

/** The most servers one frame will carry. Measured at **1**; 50 is the same kind of ceiling. */
export const MAX_PUBLISHED_SERVERS = 50

/**
 * The most parameters one tool row will carry.
 *
 * Measured at **7** (`spawn_agent`, which this app declared until D-016: `profile_slug`, `purpose`,
 * `project`, `provider`, `model`, `cwd`, `approval_mode`). 40 is far above anything this app
 * declares and exists so a third-party schema cannot make one row unbounded.
 */
export const MAX_TOOL_PARAMETERS = 40

/**
 * The ceiling on a tool or server NAME, in characters.
 *
 * Measured at **16** (`get_agent_status`) unqualified and **29** (`mcp__brobot__get_agent_status`)
 * qualified. 200 is nearly seven times the longest real one. ⛔ **A name past it is DROPPED, not clipped** —
 * {@link boundInventory}'s own rule, and the same one `boundCommands` is written under: a name is
 * an identity, and a truncated identity joins to nothing and can only mislead.
 */
export const MAX_TOOL_NAME = 200

/**
 * The ceiling on a tool or parameter DESCRIPTION, in characters — **ellipsis included**.
 *
 * ⚑ 500, matching `MAX_COMMAND_TEXT`'s measured knee rather than inventing a second number — `279`
 * measured a live Claude catalogue whose longest description was 1 135 characters, of which 40 of 44
 * rows were whole at 500 and one more at 1 000. ⚠️ **Several descriptions THIS app declares now run
 * past it** — `give_work`'s and `ask_question`'s among them — so their rows carry them cut, with the
 * ellipsis; the bound is on this inventory row only, and the model is handed each description whole
 * where the tool is declared.
 */
export const MAX_TOOL_TEXT = 500

/**
 * The ceiling on a status WORD, in characters. Measured at 10 (`needs-auth`).
 *
 * ⚠️ Generous rather than tight, because {@link PublishedServer.status} deliberately admits a word
 * this app has never seen — the point of not narrowing it is that a new one must ARRIVE, and a
 * bound that rejected it would turn the whole frame into `unknown` and lose the inventory with it.
 */
export const MAX_STATUS_WORD = 60

/**
 * 🔴 **How this provider spells a server's tool, stated as DATA rather than branched on.**
 *
 * ⛔ **The two spellings are the provider's, not a preference** (327 §2.4, measured by
 * `probe:tool-inventory` on Claude and by `353` on Codex): `mcp__<server>__<tool>` on Claude,
 * `<server>__<tool>` on Codex. ⚠️ **A join that compared BARE names would match nothing on Claude
 * and would look exactly like a conversation whose tools did not arrive** — the failure this event
 * exists to make visible, produced by the instrument meant to detect it.
 *
 * ⚑ **It rides the event because 039 forbids the alternative, and the census enforced it.** The
 * first draft of the renderer's join wrote `provider === 'claude' ? …` twice, and
 * `provider-neutrality.test.ts` refused it by name: *"ask the backend what the session SUPPORTS…
 * rather than widening this list."* This is `provider_commands.prefix`'s idiom applied to a second
 * fact — one statement about the provider, made once by the adapter that knows it, so no surface
 * downstream has to recognise a provider to read a name.
 */
export interface ToolNaming {
  /** What comes before the server name — `mcp__` on Claude, empty on Codex. */
  readonly prefix: string
  /** What separates the server from the tool — `__` on both, measured. */
  readonly separator: string
}

/** ⛔ Claude's, measured: `mcp__brobot__spawn_agent` appeared in `system/init.tools`, 5 of 5. */
export const CLAUDE_TOOL_NAMING: ToolNaming = { prefix: 'mcp__', separator: '__' }

/** ⛔ Codex's, measured by `353`: the five names arrived as `brobot__spawn_agent`, unprefixed. */
export const CODEX_TOOL_NAMING: ToolNaming = { prefix: '', separator: '__' }

/** How the model must spell one of `server`'s tools, given the provider's own convention. */
export function qualifyWith(naming: ToolNaming, server: string, tool: string): string {
  return `${naming.prefix}${server}${naming.separator}${tool}`
}

/**
 * Split a model-visible name back into its server and its tool, or `null` for a built-in.
 *
 * ⚠️ **The server is everything up to the FIRST separator and the tool is the rest**, rather than a
 * split into exactly two: a tool name may contain `__` and a server name in practice does not, so
 * rejoining the tail is the reading that cannot lose half a name. A server that really did contain
 * one would be read as a shorter server with a longer tool — which mis-groups a row and never drops
 * it.
 */
export function splitQualified(
  naming: ToolNaming,
  name: string,
): { server: string; tool: string } | null {
  if (!name.startsWith(naming.prefix)) return null
  const body = name.slice(naming.prefix.length)
  const at = body.indexOf(naming.separator)
  if (at <= 0) return null
  const tool = body.slice(at + naming.separator.length)
  if (tool === '') return null
  return { server: body.slice(0, at), tool }
}

/**
 * ⛔ **The bounded payload, in the shape the event carries it** (358).
 *
 * ⚠️ **Mutable arrays, unlike the readonly interfaces above, and that is not an oversight.** The
 * event's own type is inferred from its zod schema, and `z.array(...)` infers a mutable array — so
 * a `readonly` payload does not assign to it. ⛔ **Every adapter would otherwise spread the whole
 * structure back into mutable form at its emit**, which is `169` §1 at its most avoidable: two
 * copies of one flattening, in two adapters, drifting the first time a field is added.
 *
 * ⚑ The INPUT to {@link boundInventory} stays readonly. Bounding is a boundary, and a boundary that
 * takes what it is given and answers with what the wire needs is doing its job.
 */
export interface ToolInventoryPayload {
  /** ⛔ How this provider spells a server's tool — see {@link ToolNaming}. */
  naming: { prefix: string; separator: string }
  declared: {
    server: string
    instructions?: string
    tools: {
      name: string
      description: string
      parameters: { name: string; type: string; required: boolean; description?: string }[]
    }[]
  } | null
  published: { tools: string[]; servers: { name: string; status: string }[] } | null
  /** Rows either half named that the payload does not carry — see the field on the event. */
  dropped: number
}

/**
 * ⛔ **The ONE bounding rule, for both providers and every producer.**
 *
 * ⚠️ **Not a convenience** — the same finding `boundCommands` is written under (`169` §1: one rule
 * spelled in N places drifts). A drift here means one adapter shipping a payload the schema
 * rejects, which `toWireEvent` degrades to `unknown` and loses in silence.
 *
 * ⚑ **`dropped` counts DECLARED and PUBLISHED rows together, and that is deliberate.** The number
 * means one thing to a reader — *this list is understating what the conversation has* — and a
 * surface that had to explain which half it was short in would be explaining the bound instead of
 * the inventory. A row with no usable name is counted, never quietly skipped (`092`'s rule in
 * `247`'s wording).
 */
export function boundInventory(sent: {
  readonly naming: ToolNaming
  readonly declared: DeclaredToolset | null
  readonly published: PublishedInventory | null
}): ToolInventoryPayload {
  let dropped = 0

  let declared: ToolInventoryPayload['declared'] = null
  if (sent.declared !== null) {
    const tools = sent.declared.tools
      .filter((tool) => usableName(tool.name))
      .slice(0, MAX_DECLARED_TOOLS)
      .map((tool) => ({
        name: tool.name,
        description: clip(tool.description, MAX_TOOL_TEXT),
        parameters: tool.parameters
          .filter((parameter) => usableName(parameter.name))
          .slice(0, MAX_TOOL_PARAMETERS)
          .map((parameter) => ({
            name: parameter.name,
            type: clip(parameter.type, MAX_TOOL_NAME),
            required: parameter.required,
            ...(parameter.description
              ? { description: clip(parameter.description, MAX_TOOL_TEXT) }
              : {}),
          })),
      }))
    dropped += sent.declared.tools.length - tools.length
    declared = {
      server: sent.declared.server,
      ...(sent.declared.instructions
        ? { instructions: clip(sent.declared.instructions, MAX_TOOL_TEXT) }
        : {}),
      tools,
    }
  }

  let published: ToolInventoryPayload['published'] = null
  if (sent.published !== null) {
    const tools = sent.published.tools.filter(usableName).slice(0, MAX_PUBLISHED_TOOLS)
    const servers = sent.published.servers
      .filter((server) => usableName(server.name))
      .slice(0, MAX_PUBLISHED_SERVERS)
      .map((server) => ({ name: server.name, status: clip(server.status, MAX_STATUS_WORD) }))
    dropped += sent.published.tools.length - tools.length
    dropped += sent.published.servers.length - servers.length
    published = { tools, servers }
  }

  return {
    naming: { prefix: sent.naming.prefix, separator: sent.naming.separator },
    declared,
    published,
    dropped,
  }
}

/** A name that can be shown, typed by a model, and joined on. */
function usableName(name: string): boolean {
  return name.trim() !== '' && name.length <= MAX_TOOL_NAME
}

/**
 * 🔴 **A tool's arguments, flattened from the JSON Schema the child was actually handed.**
 *
 * ⛔ **`z.looseObject`, matching `inputSchemaOf` in `codex/agent-tools.ts` and `looseShape` in
 * `claude/agent-tools.ts` exactly.** `348` measured a strict object stripping an undocumented key
 * before `341`'s rail 1 could refuse it by name, and both adapters were corrected to the loose
 * spelling. ⚠️ **Deriving this from a plain `z.object` instead would put a `required` column on
 * screen computed from a document the model was never given** — a surface disagreeing with the
 * door, which is the one thing an inventory may not do.
 *
 * ⚑ **Empty on anything it cannot read**, rather than partial: a parameter list that silently lost
 * a row would understate what a tool takes, and this function has no `dropped` channel to say so
 * with. {@link boundInventory} owns that number.
 */
export function parametersOf(shape: ZodRawShape): ToolParameter[] {
  let document: unknown
  try {
    document = z.toJSONSchema(z.looseObject(shape))
  } catch {
    return []
  }
  if (!isRecord(document)) return []
  const properties = document['properties']
  if (!isRecord(properties)) return []
  const required = new Set(
    Array.isArray(document['required'])
      ? document['required'].filter((one): one is string => typeof one === 'string')
      : [],
  )
  return Object.entries(properties).map(([name, schema]) => ({
    name,
    type: typeWordOf(schema),
    required: required.has(name),
    ...(isRecord(schema) && typeof schema['description'] === 'string'
      ? { description: schema['description'] }
      : {}),
  }))
}

/**
 * The one word for a JSON Schema node's type.
 *
 * ⚠️ **`unknown` rather than a guess.** `z.optional(z.string())` compiles to an `anyOf` with a
 * `null` arm on some spellings and to a bare `type` on others; a reader who sees `unknown` knows to
 * open the tool, and a reader who sees `string` about an argument that is really an enum has been
 * told something false. ⛔ **An enum answers with its own MEMBERS** — `'ask' | 'auto'` — because a
 * closed set of values is more useful than the word `string`. Bounded by {@link MAX_TOOL_NAME} like
 * every other type word.
 */
function typeWordOf(schema: unknown): string {
  if (!isRecord(schema)) return 'unknown'
  // ⛔ **`enum` is read BEFORE `type`, and that ordering is the whole value of this branch.** Zod 4
  // emits an enum as `{type:'string', enum:['ask','auto']}`, so a reader that took `type` first
  // would print `string` about an argument with exactly two legal values — which is what the first
  // draft did, and what this file's own docblock claimed it did not. The members ARE the type.
  const members = schema['enum']
  if (Array.isArray(members) && members.length > 0) {
    return members.map((one) => (typeof one === 'string' ? `'${one}'` : String(one))).join(' | ')
  }
  const type = schema['type']
  if (typeof type === 'string') return type
  if (Array.isArray(type)) {
    const words = type.filter((one): one is string => typeof one === 'string')
    if (words.length > 0) return words.join(' | ')
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const arm = schema[key]
    if (!Array.isArray(arm)) continue
    const words = [...new Set(arm.map(typeWordOf))].filter((word) => word !== 'unknown')
    if (words.length > 0) return words.join(' | ')
  }
  return 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Keep `max` characters, ellipsis included.
 *
 * ⚑ **A local copy rather than an import of `provider-commands.ts`'s `clip`, and the reason is that
 * file's own note about itself**: *"The module it lives in is about command palettes and this is
 * about memory; nothing else crosses between them, and nothing else should."* Four lines of
 * arithmetic is a smaller debt than a dependency between two vocabularies that share nothing else.
 */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
