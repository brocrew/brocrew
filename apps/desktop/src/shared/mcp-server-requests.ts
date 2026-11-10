import type { ActedBy } from './who-did-it'
import { pendingProposals } from './pending-proposals'
/**
 * An agent asking the person to register an external MCP server: the words, the limits and the
 * fold that says which requests still wait.
 *
 * A request is a pair of ledger rows in the asking conversation, `mcp_server_requested` and
 * `mcp_server_request_settled`. Nothing is written to the server registry, and no address is
 * contacted, until a person approves it. It imports only types and an import-free fold, so the
 * renderer can use this module without pulling in the host.
 */

/** Who a requested server would be for: every agent, or only the agents the request names. */
export const MCP_SERVER_REQUEST_WHO = ['everyone', 'only-these-agents'] as const

/** One of {@link MCP_SERVER_REQUEST_WHO}. */
export type McpServerRequestWho = (typeof MCP_SERVER_REQUEST_WHO)[number]

/**
 * How a request stopped waiting. `approved` and `refused` are a person's press. `could-not-register`
 * is an approval the registration refused, such as a tool name that clashes with this app's own.
 * `superseded` is the person registering a server of that name themselves while the request waited.
 */
export const MCP_SERVER_REQUEST_ENDINGS = [
  'approved',
  'refused',
  'could-not-register',
  'superseded',
] as const

/** One of {@link MCP_SERVER_REQUEST_ENDINGS}. */
export type McpServerRequestEnding = (typeof MCP_SERVER_REQUEST_ENDINGS)[number]

/** How many requests one conversation may have waiting on the person at once. */
export const MCP_SERVER_REQUESTS_PER_CONVERSATION = 3

/** How many requests may wait on the person at once, from every conversation together. */
export const MCP_SERVER_REQUESTS_IN_ALL = 20

/** The longest address a request may carry, in characters. */
export const MCP_SERVER_URL_CHARS = 2_048

/** How many of the tools a registered server offered an agent is told by name. */
export const MCP_SERVER_TOOLS_NAMED = 20

/**
 * An agent asked the person to register an external MCP server (`request_mcp_server`). The row is
 * written in the asking conversation's ledger and contacts nothing; only a person's press settles
 * it ({@link McpServerRequestSettledEvent}).
 */
export interface McpServerRequestedEvent {
  type: 'mcp_server_requested'
  /** `msreq_<uuid>`, made by this app. */
  requestId: string
  /** The server's name, folded, as it would be registered. */
  name: string
  /** The address, as `new URL(…).href` gives it, so its host is lowercase and in punycode. */
  url: string
  /** What the agent says the server can read and do. Its claim; nothing checked it. */
  reaches: string
  /** Who would get the server. */
  whoGetsIt: McpServerRequestWho
  /** With `only-these-agents`: the agents, by folded profile slug. */
  agents?: readonly string[]
  /** The asking agent, by profile slug. */
  requestedBy: string
  /** The asking conversation's own piece of work this is for, when it named one. */
  piece?: string
  /** That piece's label. Present only beside {@link piece}. */
  label?: string
}

/**
 * How one {@link McpServerRequestedEvent} stopped waiting. No agent tool writes this row: a person's
 * press does, or this app when the person registers a server of that name themselves.
 */
export interface McpServerRequestSettledEvent {
  type: 'mcp_server_request_settled'
  /** The request this ends. */
  requestId: string
  ending: McpServerRequestEnding
  /** Who settled it. */
  by?: ActedBy
  /** With `approved`: the tool names the server offered when it was registered. */
  offered?: readonly string[]
  /** With `approved`: agents the request named that no longer existed, so got nothing. */
  notGiven?: readonly string[]
  /** With `could-not-register`: why. */
  why?: string
}

/** One request nobody has decided, with the conversation that asked and when. */
export interface McpServerRequestWaiting {
  readonly requested: McpServerRequestedEvent
  /** The conversation that asked: the ledger the request was written into. */
  readonly conversation: string
  /** When it was asked, epoch ms. */
  readonly at: number
}

/**
 * The requests still waiting on a person, oldest first. A request waits until a settled row names
 * it. A rebuilt ledger replays the same request id, so requests are keyed by id and a duplicate
 * collapses.
 */
export function mcpServerRequestsWaiting(
  rows: readonly {
    readonly conversation: string
    readonly at: number
    readonly event: McpServerRequestedEvent | McpServerRequestSettledEvent
  }[],
): readonly McpServerRequestWaiting[] {
  return pendingProposals<
    McpServerRequestedEvent,
    McpServerRequestSettledEvent,
    McpServerRequestWaiting
  >(rows, {
    settled: (event): event is McpServerRequestSettledEvent =>
      event.type === 'mcp_server_request_settled',
    id: (event) => event.requestId,
    pending: (requested, conversation, at) => ({ requested, conversation, at }),
  })
}

/** A sentence that will be set inside another, without its closing full stop. */
const withoutItsStop = (sentence: string): string => sentence.trim().replace(/[.]+$/u, '')

/** How a request ended, with what its settled row carries: the tools offered, or why not. */
export interface McpServerRequestEnded {
  readonly ending: McpServerRequestEnding
  readonly offered?: readonly string[]
  readonly why?: string
}

/** How the asking conversation's own transcript says a request ended, after it was waiting. */
export function mcpServerRequestEndedSays({ ending, offered, why }: McpServerRequestEnded): string {
  switch (ending) {
    case 'approved':
      return offered === undefined
        ? 'The person approved it.'
        : `The person approved it. It offers: ${theToolsItOffered(offered)}.`
    case 'refused':
      return 'The person refused it.'
    case 'could-not-register':
      return why === undefined
        ? 'It could not be registered.'
        : `It could not be registered: ${withoutItsStop(why)}.`
    case 'superseded':
      return 'Taken down.'
  }
}

/**
 * The asking conversation's transcript line for one request: what was asked, then that it waits
 * under Waiting on you, or how it ended.
 */
export function mcpServerRequestedSentence(
  name: string,
  url: string,
  ended: McpServerRequestEnded | null,
): string {
  const asked = `Asked the person to register the MCP server “${name}” (${url}).`
  const now =
    ended === null ? 'Waiting on them under Waiting on you.' : mcpServerRequestEndedSays(ended)
  return `${asked} ${now}`
}

/** The transcript line for an ending whose request is not on the page. */
export function anEarlierMcpServerRequestEnded(ended: McpServerRequestEnded): string {
  return `Asked the person to register an MCP server earlier. ${mcpServerRequestEndedSays(ended)}`
}

/** What the asking conversation is told when the person decided its request. */
export const MCP_SERVER_REQUEST_TOLD = {
  /** Approved, and its own profile gets the server: it was reopened so the tools reach it. */
  approvedAndReopened: (
    requestId: string,
    name: string,
    url: string,
    forWhom: string,
    offered: readonly string[],
  ): string =>
    `The person approved request ${requestId}: the MCP server “${name}” at ${url} is registered for ${forWhom}. It offered: ${theToolsItOffered(offered)}. This conversation was reopened so its tools reach you. A call may still ask the person first, like any tool.`,
  /**
   * Approved, and its own profile gets the server, but a reopen would stop the work it runs in the
   * background or end its planning, so it was not reopened.
   */
  approvedNotReopened: (
    requestId: string,
    name: string,
    url: string,
    forWhom: string,
    offered: readonly string[],
    because: 'its-background-work' | 'its-planning',
  ): string =>
    `The person approved request ${requestId}: the MCP server “${name}” at ${url} is registered for ${forWhom}. It offered: ${theToolsItOffered(offered)}. ${
      because === 'its-background-work'
        ? 'Not reopened: a reopen would stop the work this conversation runs in the background.'
        : 'Not reopened: a reopen would end this conversation’s planning.'
    } The server’s tools reach it when it next starts or reopens.`,
  /** Approved, but its own profile is not among those that get it. */
  approvedNotHere: (requestId: string, name: string, forWhom: string): string =>
    `The person approved request ${requestId}: “${name}” is registered for ${forWhom}. Your own profile is not among them, so nothing changed here.`,
  refused: (requestId: string, name: string, url: string): string =>
    `The person refused request ${requestId} to register “${name}” at ${url}. Nothing was registered. Do not ask for it again unless the person asks you to.`,
  couldNotRegister: (requestId: string, name: string, why: string): string =>
    `The person approved request ${requestId}, but BroCrew could not register “${name}”: ${withoutItsStop(why)}. Nothing was registered.`,
  superseded: (requestId: string, name: string): string =>
    `The person registered a server called “${name}” themselves, so request ${requestId} was taken down.`,
} as const

/** Whether a word read back from a ledger is one of {@link MCP_SERVER_REQUEST_ENDINGS}. */
export function isMcpServerRequestEnding(said: unknown): said is McpServerRequestEnding {
  return (
    typeof said === 'string' && (MCP_SERVER_REQUEST_ENDINGS as readonly string[]).includes(said)
  )
}

/**
 * The tools a server offered, as an agent or a person reads them: the first
 * {@link MCP_SERVER_TOOLS_NAMED} by name, then how many more; "no tools" when it offered none.
 */
export function theToolsItOffered(offered: readonly string[]): string {
  if (offered.length === 0) return 'no tools'
  const named = offered.slice(0, MCP_SERVER_TOOLS_NAMED).join(', ')
  const more = offered.length - MCP_SERVER_TOOLS_NAMED
  return more > 0 ? `${named} and ${String(more)} more` : named
}
