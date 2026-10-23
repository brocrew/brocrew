import type { DeclaredTool, ToolNaming, ToolParameter } from '../../../shared/runtime-ipc'
import { fullTime } from './clock'
import type { ToolRegistry } from './transcript'

/**
 * **What tools this conversation has, as one reading** (358) — the renderer half.
 *
 * BroBot's MCP tools are in-process on both providers and need not appear in a configuration file. Use the child's published inventory as the source of connected-tool facts.
 *
 * ## 🔴 Offered is not confirmed, and this file will not let a component blur them
 *
 * `ToolRegistry` carries a declaration and a publication. A row's {@link ToolRow.standing} is
 * computed here, once, from both — never chosen by a template — because the failure this whole
 * dispatch serves is a surface saying a conversation HAS a tool on the strength of BroBot having
 * offered it. `353` measured the ordinary Codex path really delivering the five, and its negative
 * control delivering none; the reason that investigation had to happen at all is that a declaration
 * can be made and not arrive.
 *
 * ## ⚠️ The provider decides how much of this can be known, and the sentence says which one you are on
 *
 * | provider | what the child publishes | what a row can say |
 * |---|---|---|
 * | Claude | every model-visible name + every MCP server's connection | **confirmed** / **not listed** |
 * | Codex | nothing at all | **offered**, and never more |
 *
 * ⛔ **`unconfirmable` is not a degraded `confirmed`.** It is the honest standing for a provider
 * that does not report, and it must read differently from a tool the child was offered and did not
 * list — which on Claude is a real defect and on Codex is not a state that can be observed.
 */

/** How a row's colour reads. Never a colour alone — every tone here has a word beside it. */
export type Tone = 'ok' | 'bad' | 'wait' | 'off' | 'unknown'

/**
 * ⛔ **Every connection word this app knows, and what each one MEANS**, written out one by one so
 * a new status cannot inherit a plausible word or be silently counted as connected.
 *
 * ⚠️ **The five keys are the pinned SDK's own union** (`McpServerStatus.status`). A sixth word must
 * arrive as itself — see {@link statusWord} — because the vocabulary that carries it is deliberately
 * not narrowed: a provider that ships a new state would otherwise fail the schema and take the whole
 * inventory with it.
 */
const STATUS_WORDS: Readonly<Record<string, { label: string; tone: Tone; connected: boolean }>> = {
  connected: { label: 'connected', tone: 'ok', connected: true },
  failed: { label: 'failed', tone: 'bad', connected: false },
  'needs-auth': { label: 'needs sign-in', tone: 'bad', connected: false },
  pending: { label: 'connecting', tone: 'wait', connected: false },
  disabled: { label: 'disabled', tone: 'off', connected: false },
}

/**
 * What one connection word means.
 *
 * ⛔ **An unrecognised word is shown VERBATIM and counted as not connected.** Both halves matter:
 * translating it would be inventing the provider's meaning, and defaulting `connected` to `true`
 * would let a state nobody has enumerated pass as working — which is
 * `an-unenumerated-state-counts-as-success` exactly.
 */
export function statusWord(status: string): { label: string; tone: Tone; connected: boolean } {
  return STATUS_WORDS[status] ?? { label: status, tone: 'unknown', connected: false }
}

/**
 * Whether this conversation is known to hold a tool.
 *
 *  - **`confirmed`** — BroBot declared it AND the child listed it. The only standing that is
 *    evidence.
 *  - **`offered`** — BroBot declared it and the child did not list it, on a provider that lists.
 *    ⛔ A real problem, and the state this surface exists to make visible.
 *  - **`unconfirmable`** — BroBot declared it and the provider publishes no inventory at all. Not a
 *    problem, and not a confirmation either.
 */
export type ToolStanding = 'confirmed' | 'offered' | 'unconfirmable'

/** One tool row: what BroBot says it is, and what the child says about it. */
export interface ToolRow {
  /** The tool's own name — `give_work`. */
  readonly name: string
  /** How the MODEL must spell it on this provider — `mcp__brobot__give_work`. */
  readonly qualified: string
  readonly description: string
  readonly parameters: readonly ToolParameter[]
  readonly standing: ToolStanding
}

/** One MCP server the child named that BroBot did not declare. */
export interface ForeignServer {
  readonly name: string
  readonly status: string
  /** Its tools, by qualified name only — nothing publishes a description for them. */
  readonly tools: readonly string[]
}

/** BroBot's own server, joined. */
export interface OwnServer {
  readonly name: string
  /**
   * The child's own word for the connection, or `null` when the child did not name this server.
   *
   * ⛔ **`null` is NOT "disconnected".** On Codex it means the provider never reports; on Claude it
   * means the server BroBot attached is missing from the child's own list, which is the shape `353`
   * had to run an investigation to rule out.
   */
  readonly status: string | null
  readonly instructions?: string
  readonly tools: readonly ToolRow[]
}

/** Everything the sheet draws, decided once. */
export interface InventoryReading {
  /**
   * Which of {@link ToolRegistry}'s three states this is.
   *
   *  - `untold` — no adapter has said anything. Draw the sentence, draw no list.
   *  - `unpublished` — the provider publishes no inventory. BroBot's declaration only.
   *  - `published` — the child stated its own inventory; the join is real.
   */
  readonly kind: 'untold' | 'unpublished' | 'published'
  /** ⛔ Where this came from and what it can prove — one sentence, always shown. */
  readonly provenance: string
  /**
   * 🔴 **WHEN the conversation stated it, epoch ms — `null` when nothing has** (444 relay 1).
   *
   * ⛔ **Where it comes from is the whole point: the ledger row's own `created_at`.** The host
   * stamps a row as it records it and puts the same number on the wire, so this is a moment the
   * engine WATCHED rather than one this window computed — `438`'s `observed` register, with the
   * moment stated. ⚠️ It must never be drawn as a `DigestGap`: a gap says *the ledger cannot
   * answer this*, and this is the opposite case.
   *
   * ⚑ **It is `null` on an `untold` reading by construction** — no frame, no row, no stamp — and
   * it can also be `null` on a reading folded without a clock (`ChildWorkViewer`). Draw nothing,
   * never a zero and never an epoch-0 time.
   */
  readonly at: number | null
  readonly own: OwnServer | null
  readonly foreign: readonly ForeignServer[]
  /**
   * The provider's own built-in tools, by name.
   *
   * ⚠️ **Names and nothing else, and that is the provider's limit rather than ours** — measured, the
   * published inventory is a flat array of strings, and the sibling door that carries a per-tool
   * `description` sends none. A row with no second line is the honest rendering; inventing one
   * would be this app describing tools it did not write.
   */
  readonly builtins: readonly string[]
  /**
   * 🔴 **Names the child listed under BroBot's OWN server that BroBot never declared** (392).
   *
   * ⛔ **They were invisible until `392` built a catalogue and counted it.** `own.tools` is built
   * from the DECLARATION, and a published name under our server that no declaration matches is
   * removed from {@link foreign} too — because that server is ours. So the frame carried the name,
   * every list dropped it, and {@link dropped} did not count it either: a silent shortfall in the
   * one surface whose whole job is to say what a conversation really has.
   *
   * ⚠️ **It is the mirror of `offered` and it is the more alarming half.** `offered` is BroBot
   * saying *"I gave you this"* and the child not listing it; this is the CHILD naming a tool in
   * BroBot's namespace that BroBot did not give it. In production the two lists are `TOOL_NAMES`
   * and this is empty; it is not empty in exactly the state this surface exists for.
   *
   * ⚠️ **It said *"the same five"* until `395`, and it had been wrong since `380` published a
   * sixth.** ⛔ *A number can survive the death of its derivation*: nothing here ever counted, so
   * nothing went red as the list grew from five to ten. The list has a name, and naming it cannot
   * drift.
   *
   * ⛔ **They carry no {@link ToolStanding}**, because standing joins a declaration to a listing and
   * there is no declaration here — see `EntrySource`.
   */
  readonly unclaimed: readonly string[]
  /** How many rows the last frame named and did not carry. Non-zero ⇒ this list understates. */
  readonly dropped: number
}

/**
 * Tool declarations share one vocabulary, with a role-bound exception for the direct rules
 * writer. The host builds the offered set for start, resume and inventory reads from the
 * conversation's origin. All calls still pass the host's authority and capability rails.
 * Having a declaration is not permission to use it.
 */
export const WHY_EVERY_CONVERSATION =
  'Every conversation gets the same tools, except write_agent_rules. ' +
  'Only a BroBot conversation a person started gets it, to change another agent’s rules. ' +
  'BroCrew still checks every call against its rules.'

/**
 * 🔴 **A count that does not say WHEN it was true** (444 relay 1).
 *
 * ⛔ **The observation this exists for.** A conversation started before `441` showed **15** tools;
 * a new one showed **16**; then the old one showed `create_project` too. ⚑ **Nothing was broken and
 * nothing was lost** — `agentToolsFor` is reached from `startSessionInProfile` and from
 * `reopenSession` and from nowhere else, both adapters re-state the inventory from that rebuilt
 * set, and the renderer's fold ASSIGNS rather than merges, so the newest row wins. `15` was true
 * when it was written and a reopen replaced it with `16`.
 *
 * 🔴 **The defect was that a person reading *"15 tools"* could not tell whether it meant *as of
 * this conversation's last launch* or *now*** — and the two differ for exactly as long as a
 * session stays live. This is `442`'s finding with a different object, and `442` already ruled how
 * to answer it: the honest label is the deliverable.
 *
 * ⚠️ **Three things this sentence may NOT say**, each measured:
 *
 *  1. ⛔ **Not *"the provider published this"*.** The number every surface draws is the DECLARED
 *     half — what BroBot handed over — and Codex's `published` is hard-coded `null` for ever. The
 *     register is still `observed`, because the engine watched this conversation STATE it.
 *  2. ⛔ **Not *"when we last asked"*, and NOT *"only at launch"*.** Claude publishes on every
 *     `system/init` and writes a row only when the payload MOVES, so within one life the count
 *     CAN change without a reopen — measured at `claude-runtime.ts:2211` and `:1579`. ⚠️ An
 *     earlier draft of this sentence said the inventory *"is not asked again while it runs"* and
 *     **contradicted this very paragraph**; the sentence says *last stated* and makes no claim
 *     about what cannot happen in between.
 *  3. ⚠️ **Not *"reload the window"*.** A window reload re-ATTACHES a held session
 *     (`handover: 'attached'`), which launches nothing and emits no new inventory. Only the
 *     reopen path re-states it, so naming the wrong act would name a remedy that does not work —
 *     `425`'s rule applies to copy as much as to rails.
 */
export const TOOLS_ARE_AS_OF_A_STATEMENT =
  'What this conversation last stated it has, at the moment shown. Nothing re-reads it on a ' +
  'schedule, and a conversation states one at every launch — so reopening it is what makes this ' +
  'current. Reloading the window does not.'

/**
 * The moment {@link TOOLS_ARE_AS_OF_A_STATEMENT} is about, or `null` when there is none.
 *
 * ⛔ **Composed here and not in a template**, like every other judgement in this file — and it is
 * the ONE rule, so the header's title and the workbench's line cannot drift apart the way
 * {@link inventorySummary}'s docblock says two spellings of one fact always do.
 *
 * ⚠️ **The whole date, not the wall clock.** A conversation launched yesterday and read today
 * would show a bare `09:41` that a person would read as this morning.
 *
 * ⛔ **Guarded on the FORMATTED value and not only on `null`** (444, found reviewing this diff).
 * `fullTime` answers `''` for `undefined`, for a NaN, and for anything past `Intl`'s TimeClip
 * bound — so `at === null` alone let a refused moment through as the dangling string
 * `'Stated '`, which is non-null, which draws. ⚑ Every other caller of `fullTime` in this app
 * drops its result into a bare span where `''` degrades to nothing; this is the first one to put
 * literal text in front of it, and that is what turns an empty string into a visible fragment.
 */
export function inventoryAsOf(reading: InventoryReading): string | null {
  if (reading.at === null) return null
  const when = fullTime(reading.at)
  return when === '' ? null : `Stated ${when}`
}

/**
 * Split a model-visible name into the server that qualifies it and the tool under it, or `null`
 * for one the provider owns itself.
 *
 * ⛔ **It takes the CONVENTION and never a provider** (039). The first draft of this function read
 * `provider === 'claude' ? …` and `provider-neutrality.test.ts` refused it by name: *"ask the
 * backend what the session SUPPORTS… rather than widening this list."* The two spellings ride the
 * event as {@link ToolNaming}, stated once by the adapter that knows them.
 *
 * ⚠️ **The server is everything up to the FIRST separator and the tool is the rest**, rather than a
 * split into exactly two: a tool name may contain `__` and a server name in practice does not, so
 * rejoining the tail is the reading that cannot lose half a name.
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

/** How the model must spell one of `server`'s tools, given the provider's own convention. */
export function qualify(naming: ToolNaming, server: string, tool: string): string {
  return `${naming.prefix}${server}${naming.separator}${tool}`
}

/**
 * 🔴 **Read the registry into the one shape the sheet draws.**
 *
 * ⛔ **Every judgement is made here and none in a template.** A component deciding which of the
 * three standings a row has would be a second answer to the question this dispatch is about; a
 * component deciding whether an empty list means *"none"* or *"we were not told"* would be the
 * `279` §2 failure with a new noun.
 */
export function readInventory(registry: ToolRegistry): InventoryReading {
  const set = registry.set
  if (set === null) {
    return {
      kind: 'untold',
      provenance:
        'BroCrew has not been told what this conversation has. A conversation publishes its ' +
        'inventory when it starts; one that has not started, or one being read back from the ' +
        'library, has nothing to report yet.',
      at: registry.at,
      own: null,
      foreign: [],
      builtins: [],
      unclaimed: [],
      dropped: registry.dropped,
    }
  }

  const published = set.published
  const declared = set.declared

  // ⚑ **Grouped once**, so the three sections below read the same parse rather than three of them.
  const grouped = new Map<string, string[]>()
  const builtins: string[] = []
  for (const name of published?.tools ?? []) {
    const split = splitQualified(set.naming, name)
    if (split === null) {
      builtins.push(name)
      continue
    }
    const under = grouped.get(split.server) ?? []
    under.push(name)
    grouped.set(split.server, under)
  }

  const listedUnderOurs = new Set(declared === null ? [] : (grouped.get(declared.server) ?? []))

  // ⛔ **What the child named under our server that we did not declare** — see `unclaimed`. Built
  // from the two sets that already exist rather than from a second parse, so it cannot disagree
  // with the standing above it.
  const declaredQualified = new Set(
    declared === null
      ? []
      : declared.tools.map((tool) => qualify(set.naming, declared.server, tool.name)),
  )
  const unclaimed = [...listedUnderOurs].filter((name) => !declaredQualified.has(name))

  const own: OwnServer | null =
    declared === null
      ? null
      : {
          name: declared.server,
          status:
            published === null
              ? null
              : (published.servers.find((server) => server.name === declared.server)?.status ??
                null),
          ...(declared.instructions === undefined ? {} : { instructions: declared.instructions }),
          tools: declared.tools.map((tool: DeclaredTool) => {
            const qualified = qualify(set.naming, declared.server, tool.name)
            return {
              name: tool.name,
              qualified,
              description: tool.description,
              parameters: tool.parameters,
              standing:
                published === null
                  ? ('unconfirmable' as const)
                  : listedUnderOurs.has(qualified)
                    ? ('confirmed' as const)
                    : ('offered' as const),
            }
          }),
        }

  // ⚠️ **Union of both halves, not just the servers the child named.** A server that published a
  // tool but no status row, and a status row with no tools, are both real and both must appear —
  // deriving the list from one of them alone is `a-negative-is-only-as-strong-as-the-search-shape`.
  const foreignNames = new Set<string>()
  for (const server of published?.servers ?? []) foreignNames.add(server.name)
  for (const server of grouped.keys()) foreignNames.add(server)
  if (declared !== null) foreignNames.delete(declared.server)

  const foreign: ForeignServer[] = [...foreignNames].sort().map((name) => ({
    name,
    status: published?.servers.find((server) => server.name === name)?.status ?? '',
    tools: grouped.get(name) ?? [],
  }))

  return {
    kind: published === null ? 'unpublished' : 'published',
    provenance:
      published === null
        ? // 🔴 **`the agent can call them` used to stand in this sentence and 392 removed it.** It
          // was the one promise an `unpublished` reading may not make: the provider does not report
          // back what the model was given, so whether the declaration ARRIVED is exactly what
          // cannot be known — the question `353` had to run an investigation to answer once, for
          // one run. ⛔ And it was wrong a second way even where delivery is granted: a capability
          // gates the CALL (see {@link WHY_EVERY_CONVERSATION}), so *"can call"* was a claim about
          // a rail this window cannot read. The three clauses below are asserted by name in
          // `tool-inventory.test.ts`, because a safety sentence with no test is a comment.
          // ⚠️ **`when it started` stood here until 444 and it was false on a reopened
          // conversation.** `agentToolsFor` runs at `startSessionInProfile` AND at
          // `reopenSession`, so a conversation opened from the library is handed today's
          // declaration, not the one its first life got — which is the whole subject of
          // {@link TOOLS_ARE_AS_OF_A_STATEMENT}. ⛔ Its three neighbouring clauses were pinned by
          // name and this one was not; it is pinned now.
          'This provider publishes no tool inventory. These are the tools BroCrew declared for ' +
          'this conversation at its most recent launch; nothing here is a confirmation that the ' +
          'agent received them. Not a complete account of what this conversation has, and not a ' +
          'list of what it can call.'
        : 'Read from the conversation’s own opening frame — the child’s list of every tool it can ' +
          'see, and of every MCP server it connected to. Not from a config file: BroCrew’s tools ' +
          'run in-process and are written to no file on either provider.',
    at: registry.at,
    own,
    foreign,
    builtins,
    unclaimed,
    dropped: registry.dropped,
  }
}

/**
 * The headline count, as a sentence.
 *
 * ⛔ **Counted off the INVENTORY and never off a filtered view**: a badge that counts matches says
 * nothing about what the server has. There is no filter on this surface today; the rule is written
 * here so adding one cannot quietly change what the number means.
 *
 * 🔴 **`392` is the dispatch that added the filter, and this line is why it did not touch this
 * function.** The workbench has a second number — *"N of M entries"*, beside the list — and it is a
 * statement about the FILTER, labelled as one. This one still counts the whole inventory and is
 * still the sentence on the header and on the button that opens it.
 */
export function inventorySummary(reading: InventoryReading): string {
  if (reading.kind === 'untold') return 'not reported yet'
  const ours = reading.own?.tools.length ?? 0
  const confirmed = reading.own?.tools.filter((tool) => tool.standing === 'confirmed').length ?? 0
  const foreign = reading.foreign.reduce((total, server) => total + server.tools.length, 0)
  const head =
    reading.kind === 'unpublished'
      ? `${ours} declared by BroCrew, none confirmed by the provider`
      : `${confirmed} of ${ours} BroCrew tools confirmed`
  const rest: string[] = []
  if (foreign > 0)
    rest.push(
      `${foreign} from ${reading.foreign.length} other server${reading.foreign.length === 1 ? '' : 's'}`,
    )
  if (reading.builtins.length > 0) rest.push(`${reading.builtins.length} built-in`)
  // ⛔ **Said out loud when it is not zero, and absent when it is** (392). In production the two
  // lists are the same six and this clause never appears; where it does appear, the child has
  // named a tool in BroBot's own namespace that BroBot's declaration does not carry.
  //
  // ⚠️ **It says *the declaration does not carry* rather than *BroBot did not declare*, and review
  // is why.** `MAX_DECLARED_TOOLS` can truncate the declaration on the wire — `dropped` says so out
  // loud beside this line — and after a truncation the missing names are exactly the ones the child
  // still publishes. The stronger sentence would then be a false accusation; this one is true
  // either way, and the shortfall row is what tells the two apart.
  if (reading.unclaimed.length > 0)
    rest.push(
      `${reading.unclaimed.length} the agent named that BroCrew’s declaration does not carry`,
    )
  return [head, ...rest].join(' · ')
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   392 · the catalogue — one browsable list over three lists that are not the same kind of thing
   ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 **Where one entry came from, and it is a THIRD axis rather than a third standing** (392).
 *
 * ⛔ **{@link ToolStanding} answers *"did BroBot declare it and did the child list it"*.** That
 * question has no answer for a tool BroBot never declared — a `github` server's tool, or one of the
 * provider's own thirty-two built-ins. ⚠️ **`null` standing is not a degraded `unconfirmable`**, the
 * same way `unconfirmable` is not a degraded `confirmed`: `unconfirmable` says *we declared it and
 * cannot check*, and an absent standing says *we did not declare it, so there is nothing of ours to
 * check*. Giving those one word would be `358`'s defect one level out.
 *
 *  - **`brobot`** — from {@link OwnServer.tools}. The only source that carries a standing, a
 *    description and an argument list.
 *  - **`unclaimed`** — a name the child listed under BroBot's OWN server that BroBot did not
 *    declare (see {@link InventoryReading.unclaimed}). ⛔ **Its own member rather than a `brobot`
 *    row with three `null`s**, and review found the reason: filed as `brobot`, the surface put it
 *    under a heading reading *"declared by BroBot"* and a detail cell reading *"BroBot's own
 *    toolset"*, beside a sentence saying BroBot never declared it. ⚠️ One row cannot say both.
 *  - **`server`** — a tool the CHILD named under some other MCP server. A qualified name, and the
 *    server's own connection word. Nothing publishes a sentence for it.
 *  - **`builtin`** — a name the child published under no server at all. A name, and that is the
 *    provider's limit rather than ours (see {@link InventoryReading.builtins}).
 */
export type EntrySource = 'brobot' | 'unclaimed' | 'server' | 'builtin'

/**
 * One row in the workbench's catalogue.
 *
 * ⛔ **Every `null` here is a different absence and none of them is an empty collection.**
 * {@link parameters} is the one that would be easiest to get wrong: `[]` means *BroBot declared this
 * tool and it takes no arguments*, and `null` means *no argument list exists for it anywhere*. `279`
 * §2's rule, applied to the field a person is most likely to read as "none".
 */
export interface CatalogEntry {
  /** Unique across every source — the qualified name, which is what a provider's own list holds. */
  readonly key: string
  /** ⚑ How the MODEL must spell it. The one name that is true on the wire. */
  readonly name: string
  /** BroBot's own unqualified name, for our tools; for everything else there is only the one name. */
  readonly bare: string
  readonly source: EntrySource
  /** The MCP server that qualifies it, or `null` for a provider built-in. */
  readonly server: string | null
  /**
   * The child's own word for that server's connection, or `null`.
   *
   * ⛔ **`null` is not "disconnected"** — {@link OwnServer.status}'s rule, carried onto every row:
   * on an unpublished provider nothing reports, and on a published one a server with no status row
   * is a server the child did not describe.
   */
  readonly serverStatus: string | null
  /** BroBot's own sentence, or `null` when nobody publishes one. */
  readonly description: string | null
  /** The flattened schema, or `null` when no argument list exists for this row at all. */
  readonly parameters: readonly ToolParameter[] | null
  /** ⛔ `null` for anything BroBot did not declare — see {@link EntrySource}. */
  readonly standing: ToolStanding | null
}

/**
 * Flatten a reading into the one list the workbench browses.
 *
 * ⚑ **Order is BroBot's declared tools, then what the child named under BroBot's server that the
 * declaration does not carry, then every other server, then the built-ins** — `358`'s three stacked
 * sections with the fourth `392` had to add, kept because it is the one grouping this surface must
 * get right (`358`'s `M23`). A search that reordered rows by relevance would put a provider built-in
 * above the tool this app declared and lose the only structure the data has.
 */
export function catalogue(reading: InventoryReading): readonly CatalogEntry[] {
  const rows: CatalogEntry[] = []
  // ⛔ **`key` is documented unique and nothing upstream makes it so.** The wire types a published
  // name list as `z.array(z.string())`, `boundInventory` filters and slices without deduplicating,
  // and the fold copies the array — so a provider naming a tool twice would give two rows one
  // `:key`, which is a Vue render fault rather than information. Found in review.
  const seen = new Set<string>()
  const push = (row: CatalogEntry): void => {
    if (seen.has(row.key)) return
    seen.add(row.key)
    rows.push(row)
  }
  const own = reading.own
  // ⚠️ `''` is the wire's legal *"a status word of no characters"*, and it is normalised on EVERY
  // server rather than only on the foreign ones — the first cut applied it to the foreign branch
  // and let BroBot's own through, which is `an-exception-made-at-one-depth-of-a-walk`.
  const ownStatus = own === null || own.status === '' ? null : own.status
  if (own !== null) {
    for (const tool of own.tools) {
      push({
        key: tool.qualified,
        name: tool.qualified,
        bare: tool.name,
        source: 'brobot',
        server: own.name,
        serverStatus: ownStatus,
        description: tool.description,
        parameters: tool.parameters,
        standing: tool.standing,
      })
    }
    // ⛔ **Under OUR server, and with no standing** — the child named them in BroBot's namespace and
    // BroBot did not declare them, so there is no declaration of ours to join a listing to.
    for (const name of reading.unclaimed) {
      push({
        key: name,
        name,
        bare: name,
        source: 'unclaimed',
        server: own.name,
        serverStatus: ownStatus,
        description: null,
        parameters: null,
        standing: null,
      })
    }
  }
  for (const server of reading.foreign) {
    for (const name of server.tools) {
      push({
        key: name,
        name,
        bare: name,
        source: 'server',
        server: server.name,
        // ⚠️ `''` is `readInventory`'s "the child named no status for this server"; it becomes the
        // same `null` every other row uses, rather than an empty string a template would print.
        serverStatus: server.status === '' ? null : server.status,
        description: null,
        parameters: null,
        standing: null,
      })
    }
  }
  for (const name of reading.builtins) {
    push({
      key: name,
      name,
      bare: name,
      source: 'builtin',
      server: null,
      serverStatus: null,
      description: null,
      parameters: null,
      standing: null,
    })
  }
  return rows
}

/**
 * ⛔ **Which standings this reading can actually produce**, derived from {@link readInventory}
 * rather than written down beside it.
 *
 * ⚠️ **This is the invariant `388` found v2.5 enforcing and asked us to keep**: *"the normalizer
 * rejects confirmed or offered unless the reading is published, and rejects unconfirmable unless it
 * is unpublished."* Here it is not a validator over supplied data — it is a statement about the one
 * function that mints a standing, and `tool-inventory.test.ts` checks the two against each other so
 * a fourth standing cannot be filtered for on a reading that can never carry it.
 */
export function standingChoices(kind: InventoryReading['kind']): readonly ToolStanding[] {
  switch (kind) {
    case 'untold':
      return []
    case 'unpublished':
      return ['unconfirmable']
    case 'published':
      return ['confirmed', 'offered']
  }
}

/** What the workbench's two controls are set to. `'all'` is not a standing and never joins one. */
export interface CatalogFilter {
  readonly query: string
  readonly standing: ToolStanding | 'all'
}

/**
 * 🔴 **The filter, as a pure function, because a template deciding what matches is a second answer.**
 *
 * ⛔ **Names and descriptions, and NOTHING else** (392 §3.2). `382` measured that a tool's `origin`
 * never crosses into this app, and the v2.5 standalone renders, searches AND filters on it; a search
 * that swept a field the product does not carry would match nothing forever and read as a broken
 * box. ⚠️ The server name is inside the qualified name — `mcp__github__create_issue` — so searching
 * the name already reaches it, without a second field that could later disagree.
 *
 * ⚠️ **A standing filter necessarily hides every row that has none**, because those rows are not
 * *"some other standing"* — the question does not apply to them. The count line beside the list is
 * what stops that reading as *"the agent has four tools"*.
 */
export function filterCatalogue(
  entries: readonly CatalogEntry[],
  filter: CatalogFilter,
): readonly CatalogEntry[] {
  const needle = filter.query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (filter.standing !== 'all' && entry.standing !== filter.standing) return false
    if (needle === '') return true
    return (
      entry.name.toLowerCase().includes(needle) ||
      (entry.description !== null && entry.description.toLowerCase().includes(needle))
    )
  })
}
