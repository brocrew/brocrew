import { agoWords } from './clock'
import {
  EXTERNAL_MCP_EVERYONE,
  EXTERNAL_MCP_RESTRICTED,
  type ExternalMcpServerReach,
} from '../../../shared/external-mcp'
import { providerName } from '../../../shared/runtime-ipc'
import type {
  AgentIdentities,
  CapabilityStatus,
  Provider,
  ProviderCapabilityMap,
} from '../../../shared/runtime-ipc'

/**
 * 🔴 **The Tools register, folded — `564`'s missing "adapter for safe fields"** (566).
 *
 * > ⚑ **`564`, naming the gap this module closes:** *"`ToolRegistryView` can be sourced from
 * > `AgentIdentities.externalMcpServers` / `externalMcpServers()`, **but needs an adapter for safe
 * > fields and a workspace projection**; the current registry is not a seven-destination read."*
 *
 * ## ⛔ What SAFE means here, derived from the door rather than from v2.10
 *
 * ⚠️ **v2.10's own contract asks the host to redact:** *"The host must redact sensitive URL/command
 * information before populating location."* ⛔ **This product needs no redaction step, and the
 * reason is a rail that already ran.** {@link externalMcpUrlRefusal} refuses, at registration, a URL
 * carrying a username or password — *"BroBot2 stores no credential for an external server yet, so a
 * URL that contains one is refused rather than saved"* — and refuses every host but loopback. ⚑ **So
 * a stored `url` cannot hold a secret**: the only way one reaches this column is a door that turned
 * it away. 🔴 **A renderer-side redactor would be a second authority on that rail**, free to disagree
 * with it the day the door's alphabet moves, and it would hide from a person the one string they
 * must be able to read to know which server this is.
 *
 * ⛔ **The row is drawn WHOLE and nothing about it is invented.** Five columns exist
 * ({@link ExternalMcpServerRow}) and five are what this answers for. v2.10's register also draws a
 * description, a transport pill, a tool standing and reported conversation links; **this product has
 * none of those four**, and `564` priced exactly that: *"no health claim, no session links"*.
 *
 * ## ⚑ A module and not a `computed` inside the SFC, for `468`'s reason
 *
 * ⛔ *"A derivation written inside an SFC is reachable by no mutation row and by no test that is not
 * a render."* ⚠️ Both functions here are pure and total, so the node suite drives every arm — an
 * unreadable `reach`, an identity list that has not landed, a provider whose capability map has not
 * been answered — **with no renderer at all**, which is the shape `the-document-a-report-names.ts`
 * and `where-the-work-is.ts` are written in.
 */
export interface RegisteredServer {
  /** `ems:<folded name>` — the key, and what a removal would name. Never drawn. */
  readonly id: string
  readonly name: string
  /**
   * ⛔ **The address, whole.** See the module note: it cannot carry a credential, because the door
   * refuses one, and a person who cannot read it cannot tell two servers on one machine apart.
   */
  readonly url: string
  readonly reach: ExternalMcpServerReach
  /**
   * ⚑ **`566` §4.1 — the only per-server decision a person makes, in the words the registration
   * form used to ask it.**
   *
   * ⛔ **{@link EXTERNAL_MCP_EVERYONE} and {@link EXTERNAL_MCP_RESTRICTED}, not a second pair.** The
   * radio a person chose between is labelled with these two constants and each row on the
   * registration sheet already echoes them; a third wording would be `169` §1's two spellings, and
   * the question *which did I pick* is answerable only if the answer is spelled the way the question
   * was.
   */
  readonly reachSays: string
  readonly registeredAt: number
  /**
   * 🔴 **How many identities were granted this one — and `null` where the question does not apply.**
   *
   * ⛔ **`null` on an `'everyone'` row is not zero and not unknown**: `HO-048` §1 made availability a
   * property of the server, so *how many were granted it* is a question about a mechanism that row
   * does not use. ⚠️ **`AgentIdentity.externalMcpServerIds` carries grants only** and an `'everyone'`
   * row *"appears in none of these lists"* — so a count taken over it would read `0` for a server
   * every agent can use, which is the reading this field exists to make impossible.
   *
   * ⚑ **A restricted server granted to nobody is the state worth drawing.** Nothing in this app says
   * it today: the rail drew no reach at all, and the capability sheet answers the other question —
   * *what may THIS identity use* — one identity at a time. ⛔ **It is measured, never claimed**: the
   * roster is the same `agentIdentities()` answer the rows come from, so the count and the row cannot
   * be read at two different moments.
   */
  readonly grantedTo: number | null
}

/**
 * ⛔ **Every registered server, in the order the store answered** — or an empty roster where nobody
 * has read yet.
 *
 * ⚠️ **`null` in, empty out, and the CALLER draws the difference.** *Nobody has looked* and *this
 * install has none* are two facts (`452` §5.1) and the surface separates them with
 * `store.loaded`/`store.loadError`, exactly as the registration sheet does. ⚑ Collapsing them here
 * would hand the page one answer to two questions, which is the defect `506 M5` names.
 *
 * ⚑ **The order is the database's** — `ORDER BY registered_at, name` — and is not re-sorted here. A
 * second ordering in the renderer is a second answer to *which came first*.
 */
export function registeredServers(identities: AgentIdentities | null): readonly RegisteredServer[] {
  if (identities === null) return []
  const roster = identities.identities
  return identities.externalMcpServers.map((server) => ({
    id: server.id,
    name: server.name,
    url: server.url,
    reach: server.reach,
    reachSays: server.reach === 'everyone' ? EXTERNAL_MCP_EVERYONE : EXTERNAL_MCP_RESTRICTED,
    registeredAt: server.registeredAt,
    grantedTo:
      server.reach === 'everyone'
        ? null
        : roster.filter((identity) => identity.externalMcpServerIds.includes(server.id)).length,
  }))
}

/**
 * ⚑ **`Registered 3d ago`** — the house idiom (`agoWords`).
 *
 * ⛔ **Sampled at mount rather than driven by `useMinuteClock`, and the difference is the subject.**
 * `211` §5's clock exists because a displayed MINUTE stops being true a minute later; a
 * registration's age crosses a threshold this function can print at most once an hour after the
 * first hour.
 */
export function registeredWords(registeredAt: number, now: number): string {
  return `Registered ${agoWords(registeredAt, now)}`
}

/**
 * 🔴 **What ONE provider does with a registered server, in that provider's own declared words**
 * (566 §4.2).
 */
export interface ProviderStanding {
  readonly provider: Provider
  /** The display name, through {@link providerName} — never printed from the key. */
  readonly name: string
  /**
   * ⛔ **Whether a conversation on this provider is handed these servers at all.** `available` is the
   * only true arm; `unwired` is *we have not built it* and `absent` is *the provider does not have
   * it*, and both mean the same thing to a person looking at this page.
   *
   * ⚠️ **Both shipped providers answer `true` as of `605`**, so nothing on this page currently
   * draws a difference — ⛔ **and the field is not therefore decoration.** It is the one thing a
   * reader of a `says` sentence needs in order to know whether it describes a capability or its
   * absence, and the next entry that is not `available` will need it unchanged.
   */
  readonly handsThemOver: boolean
  /** ⛔ The provider's OWN sentence. Never composed here — see {@link whatEachProviderDoesWithThem}. */
  readonly says: string
}

/**
 * ⚑ **The fallback for an `available` entry that declared no note** — {@link profileCredential}'s
 * shape and its reason: *"every real declaration carries one; a provider that omitted it would still
 * have to say something, because silence here is the original defect."*
 */
export const A_PROVIDER_THAT_SAID_ONLY_YES =
  'A server this identity may use is handed to conversations on this provider.'

/**
 * 🔴 **`566` §4.2, answered by rendering the capability table rather than by writing a sentence
 * about one provider.**
 *
 * ## ⛔ The brief asked for one true sentence. A sentence is the wrong shape and `524` said so first
 *
 * > ⚠️ **`566` §4.2:** *"Codex cannot reach external tools and the register must not imply
 * > otherwise… A person looking at this register will assume a registered server works everywhere.
 * > Say something true, once."*
 *
 * 🔴 **`605` · the premise in that quotation is no longer true, and the function is unchanged.**
 * ⛔ **Codex reaches external tools** — measured end to end, `probe:codex-external-mcp` — so its
 * entry is `available` and this fold now draws its `note` where it drew its `reason`. ⚑ **That is
 * the argument below arriving on schedule**: the brief asked for a sentence, the sentence would
 * have gone false tonight, and the render did not.
 *
 * ⛔ **`524` had already refused to write that sentence, one module over**, and its reason is the
 * whole of this function: *"what a given conversation is actually handed is a delivery fact the
 * capability sheet already states in that provider's own words. It is deliberately not restated here
 * — a second copy of `HO-042` §3's sentence is a second authority on it, which is the drift `169` §1
 * names."* ⚑ **So the page states it and composes none of it.** ⚠️ **That is `524` quoted as it
 * was written; `HO-042` §3 is withdrawn** (`HO-090` §1) **and the rule it illustrates is not** —
 * one copy of a sentence, wherever the sentence came from.
 *
 * 🔴 **And a hand-written sentence could not have named the provider anyway.** `039`'s rule —
 * *"the renderer must not branch on which provider a session is running"* — is enforced by
 * `provider-neutrality.test.ts`, and its own docblock records that display TEXT naming a provider
 * walks past the scanner. ⚠️ **So the census would have permitted it and the architecture forbids
 * it**: a page that spelled one provider's limitation would go false the day `HO-063` §6's *"the real
 * fix is upstream"* arrives, and nothing would turn red. ⛔ **Rendered from the table, that day
 * changes one `state` and the page changes with it.**
 *
 * ## ⚑ The words are already governed, which is the part worth knowing
 *
 * ⚠️ **`566` §4.2 cites *`516`'s copy sweep refuses the bare word `cannot`*. There is no such
 * sweep** — see that dispatch's response — ⛔ **but a rail the brief was reaching for exists**:
 * `provider-capabilities.render.test.ts` refuses `/\bcannot\b/i`, `has no`, `does not support`
 * and four more, with a single corroborated exemption.
 *
 * 🔴 **`605` · and that rail reads `unwired` REASONS ONLY** — `if (status.state !== 'unwired')
 * continue` — ⛔ **so since both providers moved to `available`, NOTHING this function renders is
 * governed by it.** ⚠️ **This paragraph claimed the opposite until `605`, and it was two
 * paragraphs away from the one saying the fold now draws a `note`**: a docblock contradicting
 * itself across twenty lines, which is standing rule 19's shape on a file that had just moved.
 *
 * ⚑ **The rail is not widened to `note`s, and that is a decision rather than an omission.** Its
 * forbidden list exists so an `unwired` reason cannot blame the PROVIDER for a gap that is ours —
 * and an `available` note is describing what a provider DOES, where `cannot` is often the true
 * word (Codex's own `approvals` note says it *"cannot write anywhere else … unless you approve it"*). ⛔ So the
 * sentence a person reads here is ungoverned copy, and the next dispatch that writes one should
 * know that rather than assume a sweep is holding it.
 *
 * ## ⛔ `null` draws NOTHING, and that is `086`
 *
 * ⚠️ *Nobody has asked the capability door yet* is not *every provider hands them over*, and it is
 * not *none does*. ⚑ An empty roster is what the page draws no block for — the same rule the rail's
 * own count is written under.
 */
export function whatEachProviderDoesWithThem(
  capabilities: ProviderCapabilityMap | null,
): readonly ProviderStanding[] {
  if (capabilities === null) return []
  // ⛔ **The map's OWN keys, and never `SUPPORTED_PROVIDERS`** — that name is one of the four shapes
  // `provider-neutrality.test.ts` flags *wherever it appears* in the renderer tree, on the argument
  // that it is a runtime VALUE the renderer does not import. ⚑ The answer the host gave is the
  // roster, in the order the host built it.
  return (Object.keys(capabilities) as Provider[]).flatMap((provider) => {
    const status: CapabilityStatus | undefined = capabilities[provider]?.externalMcpServers
    if (status === undefined) return []
    return [
      {
        provider,
        name: providerName(provider),
        handsThemOver: status.state === 'available',
        says:
          status.state === 'available'
            ? (status.note ?? A_PROVIDER_THAT_SAID_ONLY_YES)
            : status.reason,
      },
    ]
  })
}

/**
 * ⚑ **`Granted to 2 identities`** — the house idiom for a count, with the singular spelled
 * (`tool-answer.ts`'s shape).
 *
 * ⛔ **Zero gets its own words rather than `Granted to 0 identities`**, because zero is the state
 * that means something here: a restricted server nobody was granted is reachable by no agent at
 * all, and that is a thing to fix rather than a number to read. ⚠️ **It says *yet*** — the grant is
 * one tick on an identity's own sheet away, so the sentence describes a gap rather than a verdict.
 */
export function grantedWords(granted: number): string {
  if (granted === 0) return 'Granted to nobody yet'
  return granted === 1 ? 'Granted to 1 identity' : `Granted to ${granted} identities`
}
