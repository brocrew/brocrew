import { capabilitiesFor, ExternalMcpDiscoveryError, type ExternalMcpReach } from '@brobot2/runtime'
import { type Provider } from '@brobot2/shared'
import { type AnswerAck } from '../../../shared/runtime-ipc'
import type { SessionStore } from '../../db/session-store'
import { TOOL_NAMES } from '../agent-tools'
import { type ExternalMcpServerRow } from '../../../shared/external-mcp'
import type { ActedBy } from '../../../shared/who-did-it'
import { type McpServerRequestEnding } from '../../../shared/mcp-server-requests'

/**
 * 🔴 **516 · the external MCP servers a launch may reach — and the PROVIDER is half the answer**
 * (HO-040 §4.2, `HO-090` §1).
 *
 * ## ⛔ Asked of the PROVIDER's own declaration, never of its name
 *
 * ⛔ **This gate withheld every Codex grant from `516` until `605`**, on `HO-042` §3: *"stage 2 is
 * gated on authoritative call identity, not scoped to work around its absence. Until it exists:
 * no Codex grants."* ⚑ **The PO has WITHDRAWN that ruling** (`HO-090` §1) and `605` built the card
 * it was waiting on, so Codex's entry is `available` and this line now passes for both providers.
 *
 * ⚠️ **Not one byte of this function changed to do it, and that is the whole argument for asking
 * the table.** ⛔ **The question is `capabilitiesFor(provider).externalMcpServers`, and this
 * function spells no provider's name** — `039`'s rule, which `provider-neutrality.test.ts` holds
 * the renderer to and which is just as true here: *"If you find yourself writing `provider ===
 * 'claude'` to decide whether to show something, the answer is a new entry"* in the capability
 * table. ⚑ **The sheet reads the same entry**, so the control a person meets and the launch they
 * then make cannot come to disagree — and the day an entry moves, both move with it and neither
 * file is edited. ⚠️ **That day arrived and this is the receipt.**
 *
 * ## 🔴 524 · what this resolves is no longer *the grants*, and the difference IS the ruling
 *
 * `store.externalMcpServersFor` includes every server available to all and this identity's explicit grants, including for an identity never granted anything. Each tool still passes through provider permissions, and `reservedToolNames` is derived for every included server.
 *
 * ⛔ **`profileSlug === null` was NOT widened, and the guard below is the decision.** An
 * available-to-all server is available to every IDENTITY; an adopted conversation is running as
 * nobody, and handing tool servers to a row whose owner this app cannot name is not what
 * *everyone's* means.
 *
 * ⚑ **`605` · the projection is no longer empty for anybody, and the paragraph that stood here
 * described a world with one wired provider in it.** A grant was never destroyed and never refused
 * at the door — it is a durable fact about an IDENTITY, and an identity's provider is a mutable
 * default for its next conversation. ⚠️ **Refusing the WRITE on today's provider would still be
 * the wrong shape**: a person who granted on one provider and moved the identity would find a
 * grant they could no longer edit. ⛔ **That is why the guard is HERE and not on the write**, and
 * it is what will still be true the next time a provider's entry is not `available`.
 *
 * ## ⚑ The reserved roster travels with the servers
 *
 * ⛔ **`TOOL_NAMES` is handed over rather than read by the adapter**, because `packages/runtime`
 * cannot see this app's inventory and must not restate it (brief §3.2). ⚠️ It is what the adapter
 * derives Claude's `disallowedTools` from — the race backstop the PO accepted in place of a proxy.
 *
 * ## ⚠️ Absent when there is nothing, so nothing changes for a launch nobody granted anything
 *
 * ⛔ **An empty grant returns `{}` and not `{ externalMcp: { servers: [], … } }`.** The two are
 * equivalent downstream by construction — `claudeMcpServersFor` and `forbiddenExternalSpellings`
 * both treat an empty list as nothing — and returning the object anyway would make every existing
 * launch's options differ from what they were, for no fact.
 */
function externalMcpContext(
  store: SessionStore,
  provider: Provider,
  profileSlug: string | null,
): { externalMcp?: ExternalMcpReach } {
  if (capabilitiesFor(provider).externalMcpServers.state !== 'available') return {}
  if (profileSlug === null) return {}
  const servers = store.externalMcpServersFor(profileSlug)
  if (servers.length === 0) return {}
  return {
    externalMcp: {
      servers: servers.map((one) => ({ name: one.name, url: one.url })),
      reservedToolNames: TOOL_NAMES,
    },
  }
}

/**
 * A server to be registered could not be asked what it offers, so nothing was registered. A class,
 * so a person's approval of an agent's request can keep the request open to be approved again.
 */
class ServerNotReached extends Error {
  constructor(url: string, cause: unknown) {
    const kind = cause instanceof ExternalMcpDiscoveryError ? cause.kind : 'unreadable'
    const status = cause instanceof ExternalMcpDiscoveryError ? cause.status : null
    const words =
      kind === 'unreachable'
        ? `Couldn't reach the server at ${url}. Check that it's running and try again.`
        : kind === 'timeout'
          ? `The server at ${url} didn't answer in time. Nothing was registered.`
          : kind === 'refused'
            ? `The server at ${url} refused the MCP check${status === null ? '' : ` (HTTP ${status})`}. Nothing was registered.`
            : `Couldn't read the server's MCP reply at ${url}. Nothing was registered.`
    super(words)
  }
}

/**
 * One server's address as a key, so two spellings of one address compare equal: every loopback
 * host as one, the default port filled in, and no fragment. As stored when it is not a URL.
 */
function theAddressOf(url: string): string {
  try {
    const at = new URL(url.trim())
    const host =
      at.hostname === 'localhost' || at.hostname === '[::1]' || /^127\./u.test(at.hostname)
        ? 'loopback'
        : at.hostname
    const port = at.port !== '' ? at.port : at.protocol === 'https:' ? '443' : '80'
    return `${at.protocol}//${host}:${port}${at.pathname}${at.search}`
  } catch {
    return url
  }
}

/** Inside an approval's transaction: the asking conversation is starting, so it is rolled back. */
class ItsAskerIsStarting extends Error {}

/** What an approval's one transaction came to ({@link RuntimeHost.commitAnApproval}). */
type ApprovalCommitted =
  | { readonly is: 'gone' }
  | { readonly is: 'starting' }
  | { readonly is: 'taken'; readonly why: string }
  | { readonly is: 'superseded' }
  | {
      readonly is: 'approved'
      readonly row: ExternalMcpServerRow
      readonly granted: readonly string[] | null
      readonly notGiven: readonly string[]
    }

/**
 * What settling one request came to ({@link RuntimeHost.settleNow}): the ending written, and
 * whether its asker's words were kept.
 */
type RequestSettled =
  | { readonly is: 'settled'; readonly as: McpServerRequestEnding; readonly told: boolean }
  | { readonly is: 'gone' }
  | { readonly is: 'starting' }

/** How many starts in a row a piece's ending waits out, at most, for the copies it ends. */
const AN_ENDING_WAITS_OUT_STARTS = 3

/** The open copies passed up of questions about a piece, each with the conversation holding it. */
type PassedUpCopies = readonly { readonly passer: string; readonly requestId: string }[]

/** A press on a request that has already ended. */
const ANSWERED_FIRST: AnswerAck = {
  outcome: 'refused',
  reason: 'somebody answered that request first',
  stillOpen: false,
}

/** A press while the asking conversation is still starting: nothing was written. */
const ITS_ASKER_IS_STARTING: AnswerAck = {
  outcome: 'refused',
  reason:
    'the conversation that asked is starting right now, so nothing was decided. Press it again in a moment.',
  stillOpen: true,
}

/** Added to a press's answer when the asking conversation could not be told. */
const THE_ASKER_WAS_NOT_TOLD = 'BroCrew could not tell the conversation that asked.'

/** A press's answer when the person registered the request's name themselves meanwhile. */
function takenDownSays(name: string): AnswerAck {
  return {
    outcome: 'refused',
    reason: `A server called “${name}” is already registered, so this request was taken down instead.`,
    stillOpen: false,
  }
}

/**
 * The actor of a registration made at the person's Add form: that door is behind `requireAPerson`
 * on the window wire.
 */
const A_PERSON_DID_IT: ActedBy = { who: 'a-person' }

/** What a conversation's words say, as this app's notice, when a request of its was decided. */
const TOLD_ABOUT_A_SERVER_REQUEST = { appNotice: 'an-mcp-server-request-decided' } as const

/** How much of a request's own words an agent is told: one line, the card holds the rest. */
const ASKS_SAID_CHARS = 80

/** A person's answer to a request nobody is waiting on any more, in the provider's case and ours. */
const NO_LONGER_WAITING = 'the agent is no longer waiting for an answer to this'

export {
  A_PERSON_DID_IT,
  AN_ENDING_WAITS_OUT_STARTS,
  ANSWERED_FIRST,
  type ApprovalCommitted,
  ASKS_SAID_CHARS,
  externalMcpContext,
  ITS_ASKER_IS_STARTING,
  ItsAskerIsStarting,
  NO_LONGER_WAITING,
  type PassedUpCopies,
  type RequestSettled,
  ServerNotReached,
  takenDownSays,
  THE_ASKER_WAS_NOT_TOLD,
  theAddressOf,
  TOLD_ABOUT_A_SERVER_REQUEST,
}
