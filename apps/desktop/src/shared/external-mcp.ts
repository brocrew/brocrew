import { foldProfileName, isPathSegment, PATH_SEGMENT_RULE } from './runtime-ipc'

/**
 * 🔴 **One external MCP server a person registered, and who may reach it** (516, HO-040 §4.2,
 * `HO-042` §6, built from `507` §2).
 *
 * ## ⛔ Register once globally — and since 524 the SERVER says who it is for
 *
 * 🔴 **`HO-048` §1 WITHDREW the default this module was built on, and the PO named their own error.**
 * HO-040 §4.2 read *"Register the server once, globally. Grant it per identity … this is the part
 * that makes focused identities genuinely specialised rather than differently named"*, and `516`
 * built exactly that. ⛔ **The PO's diagnosis:** *"I justified per-identity grants with* this is the
 * part that makes focused identities genuinely specialised*, which is an argument about one agent
 * that does not exist yet, applied to every agent that does."* ⚠️ **A Kibana server under
 * per-identity-by-default is three manual acts times every identity, forever.**
 *
 * ⚑ **So *is this server everyone's?* is now a property of the SERVER** — {@link
 * ExternalMcpServerReach}, one column, defaulting to `'everyone'` — **and the grant table is the
 * mechanism for the exception.** ⛔ *"Do not elaborate it"* (`HO-048` §1.1): a grant still either has
 * a row or it does not, with no nullable boolean and no role-derived default (standing rule 10), and
 * nobody has yet needed a restricted server.
 *
 * ## ⚠️ What this ruling does NOT change, because the next reader will assume otherwise
 *
 * ⛔ **It changes who gets OFFERED a tool. It changes nothing about what happens when one is CALLED**
 * (`HO-048` §1.2). ⚑ An available-to-all server is still governed by the permission a person answers
 * — on Claude every one of its tool calls reaches the guard hook and `canUseTool` and cards like any
 * other consequential action — and it is still refused WHOLE at registration if any of its tool
 * names collides with one of ours ({@link externalMcpCollisionRefusal}, HO-040 §4.3).
 *
 * ## ⛔ The URL is IMMUTABLE, and that is a constraint rather than a preference
 *
 * `HO-042` §6, quoting `507` §2.1: ⛔ *"a mutable URL would let one global row silently retarget
 * every identity that already trusted it."* ⚑ **So changing an endpoint is remove-and-add**, which
 * deletes every grant by cascade and makes a person grant the new target deliberately. ⚠️ This
 * module therefore offers no edit and the wire carries no save verb — the absence is the rule.
 *
 * ## ⚠️ What this module is NOT
 *
 * ⛔ **It holds no credential of any kind and there is no shape here for one** — stage 1 is
 * unauthenticated loopback only (brief §4, `507` §8). ⛔ **It holds no status, no tool list and no
 * last-seen time**: `507` §2.1 — *"A registry row says what a person configured; it does not claim
 * that the endpoint is presently alive."* What actually connected is the child's own inventory,
 * which `392` reads and `SessionTools.vue` draws.
 *
 * ⚑ **A `src/shared` module holding no zod and no main-only import**, which is the rule
 * `capabilities.ts` is written under: the renderer may name a registry row without pulling a
 * validator it never runs or a provider adapter it must never bundle.
 */
/**
 * 🔴 **Who a registered server is for — one property of the SERVER, with two values** (524,
 * `HO-048` §1).
 *
 * ⛔ **This is NOT `ExternalMcpReach` in `@brobot2/runtime`**, and the two are duals rather than
 * copies: that one is *the servers this launch may reach*, carried to an adapter; this one is *how
 * far one server reaches*, stored on its row. ⚠️ **Nor is it an availability**: the registry holds
 * no status, no tool list and no last-seen time (`507` §2.1), so a word that could be read as *is it
 * up* would be a claim this table has refused to make since `0032`.
 *
 *  - `'everyone'` — ⚑ **the default, and the whole of `HO-048` §1.** *"A registration form that
 *    starts restricted and asks a person to open it up would reproduce today's cost with one extra
 *    click, which is not a fix. It starts open."*
 *  - `'restricted'` — ⛔ *this one is somebody's speciality*. A person chooses it when the resource
 *    is genuinely exclusive — a Chrome profile, a device — **and that is rare and deliberate**.
 *    {@link externalMcpGrantRowId}'s table is then the only thing that reaches it.
 */
export type ExternalMcpServerReach = 'everyone' | 'restricted'

/**
 * ⛔ **The vocabulary, closed in the READER because the column carries no CHECK** (524).
 *
 * ⚠️ **SQLite has no `ADD CONSTRAINT`**, so a CHECK on `external_mcp_server` — a table
 * `external_mcp_server_grant` already points at — would have forced drizzle's 12-step rebuild with a
 * `DROP TABLE` in it. ⛔ `0033`'s prose prices that; this function is what buys the guarantee
 * instead.
 *
 * 🔴 **Anything that is not literally `'everyone'` is `'restricted'`** — a typo, a hand-edited row,
 * a word a later build writes that this one predates, a value arriving as `unknown` from anywhere.
 * ⚠️ **A NULL is NOT among them and the column is why**: `0033` is `NOT NULL DEFAULT 'everyone'`, and
 * `a-server-the-workspace-has.test.ts` §4 drives an `UPDATE … SET reach = NULL` to prove the database
 * refuses one rather than claiming it here. ⚑ **The fold answers narrow for it anyway**, because the
 * argument is `unknown` and a reader that trusted one constraint to cover a second question is how
 * `169` §1's two spellings begin. ⛔ **Narrowest and never the default**, which is the rule
 * `a-check-constraint-on-an-existing-sqlite-table-rebuilds-it` states for exactly this trade: *"an
 * unrecognised value must fold to the NARROWEST meaning, never to the default, or a typo becomes a
 * widening."*
 *
 * ⚠️ **The DEFAULT and this FOLD point in opposite directions, deliberately.** They answer different
 * questions: *what does a person who said nothing get* is the widest and is the ruling; *what does a
 * value this app cannot read mean* is the narrowest and is every other fold in this codebase.
 */
export function foldExternalMcpReach(said: unknown): ExternalMcpServerReach {
  return said === 'everyone' ? 'everyone' : 'restricted'
}

export interface ExternalMcpServerRow {
  /** `ems:<folded name>` — derived, like every other id in this schema. */
  readonly id: string
  /** ⛔ Folded, globally unique, and the namespace both providers publish this server's tools under. */
  readonly name: string
  /** ⛔ The endpoint, as typed and as validated. Immutable — see the module note. */
  readonly url: string
  /** When a person added it. Audit, and the order the list is drawn in. */
  readonly registeredAt: number
  /**
   * 🔴 **Who it is for** (524, `HO-048` §1) — see {@link ExternalMcpServerReach}.
   *
   * ⛔ **Always folded on the way out of the store**, so no reader of this row has to decide what an
   * unreadable column means. ⚠️ **Fixed at registration, like the URL**: there is no save verb on
   * this wire at all (`516` shipped none, deliberately), and changing this is remove-and-add — which
   * is the same act the immutable URL already makes a person perform, and it cascades the grants
   * away in the same breath.
   */
  readonly reach: ExternalMcpServerReach
}

/** `ems:<folded name>` — the registry row's derived id. */
export function externalMcpServerRowId(name: string): string {
  return `ems:${foldProfileName(name)}`
}

/**
 * `emg:<folded identity slug>:<folded server name>` — the grant row's derived id.
 *
 * ⚑ **Derived rather than generated**, which is this schema's rule everywhere: the domain key for a
 * grant is *identity + server*, and a surrogate would be a second name for that key, free to have
 * two values the moment two writers race. ⛔ `:` is outside {@link isPathSegment}'s alphabet, so no
 * name can spell a separator and collide.
 */
export function externalMcpGrantRowId(profileSlug: string, serverName: string): string {
  return `emg:${foldProfileName(profileSlug)}:${foldProfileName(serverName)}`
}

/**
 * ⛔ **How many servers one identity's grant may name on the wire.**
 *
 * ⚠️ **A boundary bound and not a product opinion**, exactly like `MAX_CAPABILITY_COUNT`: it exists
 * so a forged payload cannot hand the main process an unbounded list. The registry itself is not
 * bounded here — a person adding rows to their own app is not the threat this answers.
 */
export const MAX_EXTERNAL_MCP_GRANTS = 32

/**
 * 🔴 **The two characters a server name may not contain, and the measurement behind them** (`507`
 * F4).
 *
 * ⛔ **`tool-inventory.ts`'s `splitQualified` splits at the FIRST `__`**, so a server called
 * `work__browser` is read as server `work` with a tool called `browser__…` — a row mis-grouped in
 * the one surface that tells a person what their agent can see. ⚠️ **That is an existing
 * representational defect, newly REACHABLE because a person may now choose a server name**, which
 * is why the refusal is here rather than a rewrite of the splitter.
 *
 * ⚑ **A compatibility policy and not a claim about the alphabet.** {@link isPathSegment} admits
 * `_`, and one underscore is fine; the measured incompatibility is exactly two of them adjacent.
 */
export const EXTERNAL_MCP_FORBIDDEN_IN_A_NAME = '__'

/** How to say the name rule, once, wherever a bad one has to be explained. */
export const EXTERNAL_MCP_NAME_RULE = `${PATH_SEGMENT_RULE}, and never two underscores together`

/**
 * 🔴 **Why a name is refused, as the sentence a person reads — or null when it is fine** (516).
 *
 * ⛔ **The reserved name arrives as an ARGUMENT and is never spelled here.** `AGENT_TOOL_SERVER`
 * owns the word `brobot` (`466`) and it lives in `main/runtime/agent-tools.ts`, which this module
 * may not import; a copy would be a second authority on the one name that must never be taken.
 * ⚠️ The door passes it, and `an-external-server-and-the-names-it-may-not-take.test.ts` drives the
 * real constant through this function rather than a literal.
 *
 * ⚑ **It folds first and judges the FOLD**, because the fold is what the column holds and what the
 * `external_mcp_server_name_folded_ck` CHECK asserts — so a name this answers `null` for is a name
 * the database will accept.
 */
export function externalMcpNameRefusal(said: string, reservedServer: string): string | null {
  const name = foldProfileName(said.trim())
  if (name === '') return 'A server needs a name.'
  if (!isPathSegment(name))
    return `“${said}” is not a usable server name — use ${EXTERNAL_MCP_NAME_RULE}.`
  if (name.includes(EXTERNAL_MCP_FORBIDDEN_IN_A_NAME)) {
    return (
      `“${said}” contains “${EXTERNAL_MCP_FORBIDDEN_IN_A_NAME}”, which is how both providers ` +
      `separate a server from its tools — a server named this way is read as a different server ` +
      `with a longer tool name. Use ${EXTERNAL_MCP_NAME_RULE}.`
    )
  }
  if (name === foldProfileName(reservedServer)) {
    return (
      `“${said}” is the name BroCrew publishes its own tools under, so it is reserved. ` +
      `Give this server another name.`
    )
  }
  return null
}

/**
 * ⛔ **The hosts a registered URL may name** — loopback, and nothing else (brief §4, `507` §8).
 *
 * ⚠️ **`127.` covers the whole `127.0.0.0/8` block** rather than the one address people type, because
 * every one of them is the same machine and refusing `127.0.0.2` would be a rule about a habit.
 */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  )
}

/**
 * 🔴 **Why a URL is refused, as the sentence a person reads — or null when it is fine** (516).
 *
 * Accept only loopback HTTP(S) URLs without user-info. This registry has no credential shape and is intended for servers on the person's machine, not unauthenticated endpoints on someone else's network.
 *
 * ⚠️ **It bounds the URL THIS APP STORES and not every hop the providers make** — `507` F5, stated
 * rather than implied: Claude opens its own connection to this address and may follow whatever that
 * server answers with. ⛔ **A no-redirect network sandbox is the app-owned proxy class the PO
 * declined in `HO-042` §2**, and this function does not claim to be one.
 */
export function externalMcpUrlRefusal(said: string): string | null {
  const raw = said.trim()
  if (raw === '') return 'A server needs a URL.'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return `“${said}” is not a URL. Give the full address, for example http://127.0.0.1:8765/mcp.`
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `“${said}” is not an http address. An MCP server is reached over http or https.`
  }
  if (url.username !== '' || url.password !== '') {
    return (
      `“${said}” carries a username or password in the address. BroCrew stores no credential for ` +
      `an external server yet, so a URL that contains one is refused rather than saved.`
    )
  }
  if (!isLoopbackHost(url.hostname)) {
    return (
      `“${said}” is not on this machine. BroCrew can only register an unauthenticated server ` +
      `running locally — localhost, 127.0.0.1 or [::1].`
    )
  }
  return null
}

/**
 * 🔴 **Which of a server's own tool names collide with ours** (516, HO-040 §4.3, `HO-042` §2).
 *
 * ⛔ **Compared BARE and not qualified, and that is the whole ruling.** Each provider qualifies a
 * server's tools — `mcp__<server>__<tool>` on Claude, `<server>__<tool>` on Codex — so byte equality
 * is already impossible. ⚠️ **Qualification does not solve `408`'s SEMANTIC collision**: an external
 * `give_work` teaches the model a second verb whose meaning and governance are not this app's, and
 * *"a model cannot be expected to tell them apart"* (HO-040 §4.3).
 *
 * ⚑ **Folded on both sides**, so `Give_Work` is the same collision as `give_work`.
 */
export function collidingToolNames(
  offered: readonly string[],
  ourToolNames: readonly string[],
): readonly string[] {
  const ours = new Set(ourToolNames.map((name) => foldProfileName(name)))
  return [...new Set(offered.filter((name) => ours.has(foldProfileName(name))))].sort()
}

/**
 * 🔴 **The refusal itself — the whole server, never the colliding leaf** (HO-042 §2).
 *
 * Refuse collisions at registration without a namespacing proxy. The current boundary assumes a local server at the person's configured URL and cannot prevent later inventory changes. Revisit proxy enforcement before admitting remote servers, credentials or marketplace servers.
 *
 * ⚠️ **It names the conflicts**, because a refusal a person cannot act on is a wall (`425`).
 */
export function externalMcpCollisionRefusal(name: string, colliding: readonly string[]): string {
  return (
    `“${name}” publishes ${colliding.length === 1 ? 'a tool' : 'tools'} BroCrew already governs — ` +
    `${colliding.join(', ')}. An agent cannot tell one of those apart from BroCrew’s own, so the ` +
    `whole server is refused rather than part of it. Rename ${colliding.length === 1 ? 'it' : 'them'} ` +
    `on the server, or register a server that does not publish ${colliding.length === 1 ? 'that name' : 'those names'}.`
  )
}

/**
 * ⚑ **WHEN a grant lands** — the same promise `CapabilityField.whenItTakesEffect` makes for the
 * grants beside it, said once for the block that is not one of them.
 *
 * ⛔ **A running conversation does not move.** Claude fixes a query's `Options` for its life, so the
 * servers a session holds are the ones it was started or reopened with (`307`).
 */
export const EXTERNAL_MCP_TAKES_EFFECT =
  'A change here reaches the next conversation this identity starts, or the next time one is ' +
  'reopened. Nothing running moves.'

/**
 * ⚑ **What removing a registry row does to every identity that was granted it** (`507` §5).
 *
 * ⛔ **Said before the press, not after it**: the grants go with the row by cascade, and a person
 * who removes a server to re-add it at a new address is the case the immutable URL creates.
 */
export const EXTERNAL_MCP_REMOVAL_MEANS =
  'Removing a server takes it away from every identity that was granted it. The address cannot be ' +
  'edited — add the new one and grant it again.'

/**
 * ⚑ **The two words a person chooses between when they register a server** (524, `HO-048` §1).
 *
 * ⛔ **The first is the DEFAULT and is pre-selected**, which is the ruling rather than a layout
 * decision: *"a registration form that starts restricted and asks a person to open it up would
 * reproduce today's cost with one extra click, which is not a fix."*
 */
export const EXTERNAL_MCP_EVERYONE = 'Available to every identity'

/** ⛔ **The exception, and it is meant to be rare** — see {@link EXTERNAL_MCP_RESTRICTED_MEANS}. */
export const EXTERNAL_MCP_RESTRICTED = 'Only the identities I grant it to'

/**
 * 🔴 **The one sentence `HO-048` §2 owes, on the registration form** — stated, and NOT gated.
 *
 * ## ⛔ The PO's ruling, in their own words
 *
 * Explain that shared servers are reachable by every app agent, including agents the person never opens, and automatic mode may use their tools without asking. Put that scope on the registration form before the press.
 *
 * ## ⚑ `367`'s shape, which is what makes it a disclosure rather than a warning
 *
 * Show the explanation before registration without blocking it or requiring an acknowledgment, matching the properties of `YOLO_MEANS` in `renderer/src/lib/approval-mode.ts`. Describe reach plainly without judging the choice.
 *
 * ## 🔴 Why it says *may use* and not *reaches*
 *
 * ⛔ **Because *reaches* is a delivery claim and this sentence is read before any provider is
 * fixed.** `RuntimeHost.externalMcpContext` hands a launch nothing at all unless
 * `capabilitiesFor(provider).externalMcpServers` is `available`.
 *
 * ⚠️ **This paragraph used to rest on *one of the two providers is `unwired`*, and `605` moved
 * that entry**, so the argument is restated on the ground that outlives it: ⛔ **a registration is
 * a permission and not a delivery.** The day a third provider arrives — or an existing one moves
 * the other way — *reaches* would be false again, with nothing red.
 *
 * ⚑ **What this column decides is PERMISSION, which is true on every provider**; what a given
 * conversation is actually handed is a delivery fact the capability sheet already states in that
 * provider's own words. ⚠️ **It is deliberately not restated here** — a second copy of another
 * file's sentence is a second authority on it, which is the drift `169` §1 names — and `524`'s
 * response files the alternative as a finding rather than leaving it implied.
 *
 * ⛔ **That clause cited `HO-042` §3 until `605`, and the ruling is WITHDRAWN** (`HO-090` §1).
 * ⚑ The reason to keep one copy is unchanged and never depended on which sentence was being
 * copied.
 *
 * ⚠️ **The yolo clause is true on both arms**, including vacuously on the one that is handed no
 * servers: it says what happens when tools ARE called without asking, and never that they will be.
 */
export const EXTERNAL_MCP_EVERYONE_MEANS =
  'Every agent in this app may use this server — including agents that other agents create and ' +
  'whose conversations you never open — and in a conversation running in yolo, nothing asks ' +
  'before it does.'

/**
 * ⚑ **What the exception is FOR, said beside it** (524, `HO-048` §1).
 *
 * ⛔ **It names resources rather than agents**, because that is the PO's test for when to reach for
 * it: *"a person ticks it when the resource is genuinely exclusive — a Chrome profile, a device —
 * and that is rare and deliberate."* ⚠️ Nobody has needed one yet — the browser agent is designed
 * and unbuilt — **so the narrow case is unproven, and an unproven case earns one column and no
 * more**.
 */
export const EXTERNAL_MCP_RESTRICTED_MEANS =
  'Tick this only for a resource that can have one holder at a time — a browser profile, a device. ' +
  'Everything else is everyone’s.'

/**
 * ⚑ **What an identity's own sheet says about a server it did not have to be granted** (524).
 *
 * ⛔ **Drawn instead of a tick-box and never as a TICKED one.** A checked box a person cannot uncheck
 * is a control that lies about what it is; this row is not a grant and there is nothing on it to
 * change. ⚠️ It is drawn rather than hidden because a sheet that listed only the restricted servers
 * would under-report what this identity may use, which is the one thing this surface exists to say.
 */
export const EXTERNAL_MCP_EVERYONES = 'Available to every identity'

/**
 * 🔴 **Where the answer lives, for a person looking at this sheet for the box that is not there** —
 * `106`'s rule, which is that a control a person cannot move must say what would move it.
 *
 * ⛔ **It names the act rather than a menu path this file cannot verify**: a server's reach is fixed
 * at registration for the same reason its URL is (there is no save verb on this wire at all), so the
 * way to narrow one is the way to retarget one.
 */
export const EXTERNAL_MCP_REACH_IS_FIXED =
  'A server is registered as everyone’s or as restricted, and that cannot be edited afterwards — ' +
  'remove it and add it again to change it.'

/**
 * 🔴 **What a person reads where nothing is registered — one sentence, three surfaces** (566).
 *
 * ## ⛔ It exists because two of those three surfaces disagreed, and one of them was false
 *
 * ⚠️ **`516` wrote this sentence twice**, once in the rail and once in the registration sheet, and
 * both copies said *it grants nobody until you tick it on an agent's own sheet*. ⛔ **`524` moved the
 * default to `'everyone'` and corrected ONE of them** — `SideRail.vue`'s — **leaving
 * `ExternalMcpRegistry.vue`'s telling a person the exact opposite of what the pre-selected radio
 * eight lines below it was about to do.** ⚑ Found by `566` grepping `grants nobody`; the sweep that
 * missed it is `169` §1's rule arriving as a measurement rather than as an argument.
 *
 * ## ⚑ The rail's wording, minus its pointer, and that is what makes it sayable anywhere
 *
 * ⛔ **`EXT-008` §2 quoted the shipped rail's sentence as documentation living in navigation, and
 * `566` §4.3 ruled it TRUE and told this dispatch to take it or better it.** ⚠️ Bettering it was
 * removing *Add one above* — a claim about where a control sits, which was true in the rail, false
 * in the sheet where the form is BELOW, and is the reason one sentence could not already be two
 * surfaces' copy. ⚑ **What is left is the durable half: the ruling.** Each surface draws its own
 * entrance beside it.
 */
export const EXTERNAL_MCP_NONE_YET =
  'No external MCP servers yet. Every agent can use one unless you register it as restricted.'

/**
 * 🔴 **The two things this register REFUSES to claim, said once on the page that draws it** (566,
 * v2.10 §4).
 *
 * ## ⛔ Both halves are this module's own docblock, promoted to something a person reads
 *
 * ⚠️ **Neither clause is new and neither is the mock's.** *"A registry row says what a person
 * configured; it does not claim that the endpoint is presently alive"* is `507` §2.1, quoted at the
 * head of this file; *"what actually connected is the child's own inventory"* is the sentence beside
 * it. ⛔ **v2.10 asked for exactly these two refusals** — *"no tool standing badge, health claim,
 * tool execution control or injection toggle"* and *"registration is deliberately distinct from a
 * conversation's reported tool inventory"* — ⚑ **and the product had already written both as
 * comments.** Rule 5: a safety sentence with no test is a comment, and a comment no person reads is
 * a refusal the surface does not make.
 *
 * ## ⚠️ Why the second clause names no destination
 *
 * ⛔ **v2.10's version ends *"Inspect that conversation's Tools tab"*, and this one does not.** A
 * pointer clause is a claim (`a-pointer-clause-is-a-claim`): the inventory this app actually has is
 * `SessionTools`, an overlay opened from inside one conversation, and a sentence on a workspace page
 * that names a tab would be describing navigation this dispatch did not build and cannot enforce.
 * ⚑ **Saying WHERE the answer lives — in the conversation — is true and survives the day that
 * overlay is renamed.**
 */
export const EXTERNAL_MCP_REGISTER_IS_NOT_A_REPORT =
  'A registration says what you configured. It does not say the server is running, and it does not ' +
  'say which of its tools reached an agent — that is read from the conversation itself.'

/**
 * ⚑ **What the register IS, on the page whose whole subject it is** (566).
 *
 * ⛔ **It says *on this machine* because the door does** — {@link externalMcpUrlRefusal} admits
 * loopback and nothing else — ⚠️ **and it says *registered* rather than *available*, which is the
 * distinction `564` named as the one thing this projection must not blur:** *"registry presence is
 * not a live/usable-session claim."*
 */
export const EXTERNAL_MCP_REGISTER_IS =
  'Every MCP server you have registered on this machine. Registering one is a choice you made, not ' +
  'a report about what is running.'
