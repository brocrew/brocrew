import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { ZodError } from 'zod'
import { didNotAnswerInTime, withDeadline } from './internal/bounded'

/**
 * 🔴 **One external MCP server, as a launch is handed it** (516, HO-040 §4.2, `507` §2.1).
 *
 * ⛔ **Two fields and no third, and each absence is a decision somebody made.** There is no
 * `enabled`, no status, no tool cache, no provider and no last-seen time: `507` §2.1 — *"A registry
 * row says what a person configured; it does not claim that the endpoint is presently alive."*
 * ⚑ What actually connected is the CHILD's own inventory, which `392` already reads and this build
 * deliberately does not duplicate.
 *
 * ⚠️ **No `headers` and no credential of any kind.** Stage 1 is unauthenticated loopback only
 * (`507` §8, brief §4) — an authenticated server needs Keychain storage, a login/refresh/revoke
 * surface and redaction tests, and none of that is priced.
 */
export interface ExternalMcpServer {
  /** ⛔ Folded, and it is the namespace both providers publish the server's tools under. */
  readonly name: string
  /** ⛔ The endpoint, immutable for the life of the row — see the desktop's `external-mcp.ts`. */
  readonly url: string
}

/**
 * 🔴 **What one launch may reach, plus the names no external server may spell** (516).
 *
 * ## ⛔ Why the reserved roster rides HERE rather than being read from this package
 *
 * `TOOL_NAMES` is the app's own inventory and it lives in `apps/desktop/src/main/runtime/agent-tools.ts`.
 * ⚠️ **This package cannot import it and must not restate it** — brief §3.2: *"imported from
 * `agent-tools.ts`, never copied"* — so the roster arrives as an argument from its single
 * definition, exactly as {@link ExternalMcpServer} arrives from its single table.
 *
 * ⚑ **The adapters need it because the BACKSTOP is provider-side.** `HO-042` §2 ruled the refusal
 * rail sufficient *and* named its limit: the rail asks a server what it offers, and the provider
 * asks again a moment later. What closes that window is each provider's own deny vocabulary —
 * Claude's `disallowedTools` — and only an adapter knows how its provider spells
 * `<server>__<tool>`.
 *
 * ⛔ **Absent means this session was granted nothing**, which is every session until a person
 * registers a server and ticks an identity. An absent field and an empty `servers` array must reach
 * the provider identically, so nothing changes for a launch nobody granted anything.
 */
export interface ExternalMcpReach {
  /** The servers this identity holds a grant row for, in the store's own order. */
  readonly servers: readonly ExternalMcpServer[]
  /** ⛔ OUR tool names, so no external spelling of one can be called. Never spelled in here. */
  readonly reservedToolNames: readonly string[]
}

/**
 * ⚠️ **How long a registration handshake may take before it is NOT PERFORMED** (standing rule 13).
 *
 * ⛔ **A bound, and the failure is reported rather than inferred.** `395` measured an unbounded
 * provider wait costing an afternoon; a local server that accepts a connection and never answers
 * `initialize` would wedge the Add button for ever without this. ⚑ Ten seconds is generous for a
 * loopback endpoint and short enough that a person learns the answer while they are still looking.
 */
export const EXTERNAL_MCP_DISCOVERY_MS = 10_000

/** What this app calls itself when it asks a server what it offers. */
const DISCOVERY_CLIENT = { name: 'brobot2-registry-preflight', version: '1' }

/** The discovery failure category, without putting a server's raw reply into window copy. */
export class ExternalMcpDiscoveryError extends Error {
  constructor(
    readonly kind: 'unreachable' | 'refused' | 'unreadable' | 'timeout',
    readonly status: number | null,
  ) {
    super(
      kind === 'timeout'
        ? 'The MCP check did not answer within its deadline.'
        : 'The MCP check failed.',
    )
    this.name = 'ExternalMcpDiscoveryError'
  }
}

/**
 * 🔴 **Ask one external server what it offers — `initialize` then `tools/list`, and nothing else**
 * (516, `507` §4.2).
 *
 * ⛔ **This is the only place this app speaks MCP as a CLIENT**, and it exists because the ruled
 * refusal needs a roster to refuse against: `HO-042` §2 — *"The property I ruled is none of our verb
 * names reaches the model, and your rail guarantees it."* ⚠️ A rail that guessed what a server
 * offers would guarantee nothing.
 *
 * ⚑ **It calls no tool and reads no resource.** A preflight that executed anything would be this
 * app running a stranger's code to decide whether to trust it.
 *
 * ⛔ **It always closes**, including on the deadline path — {@link withDeadline} releases the
 * AWAITER and never the work, which is the distinction that module is written around.
 *
 * @throws an `Error` whose message is what a person is shown when the endpoint could not be asked.
 */
export async function discoverExternalMcpTools(
  url: string,
  options: { deadlineMs?: number } = {},
): Promise<readonly string[]> {
  const deadline = options.deadlineMs ?? EXTERNAL_MCP_DISCOVERY_MS
  const client = new Client(DISCOVERY_CLIENT)
  let refusedStatus: number | null = null
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: async (input, init) => {
      let response: Response
      try {
        response = await fetch(input, init)
      } catch {
        throw new ExternalMcpDiscoveryError('unreachable', null)
      }
      if (init?.method === 'POST') refusedStatus = response.ok ? null : response.status
      return response
    },
  })
  let unreadable: (() => void) | undefined
  const decodeFailure = new Promise<never>((_resolve, reject) => {
    unreadable = () => reject(new ExternalMcpDiscoveryError('unreadable', null))
  })
  client.onerror = (error) => {
    // The optional GET stream may be unsupported. Its HTTP/network errors do not reject a
    // healthy POST. A malformed JSON or JSON-RPC frame is an unreadable server message.
    if (error instanceof SyntaxError || error instanceof ZodError) unreadable?.()
  }
  try {
    await withDeadline(
      Promise.race([client.connect(transport), decodeFailure]),
      deadline,
      `${url} (MCP initialize)`,
    )
    const listed = await withDeadline(
      Promise.race([client.listTools(), decodeFailure]),
      deadline,
      `${url} (MCP tools/list)`,
    )
    return listed.tools.map((one) => one.name)
  } catch (error) {
    if (error instanceof ExternalMcpDiscoveryError) throw error
    if (didNotAnswerInTime(error)) throw new ExternalMcpDiscoveryError('timeout', null)
    if (refusedStatus !== null) throw new ExternalMcpDiscoveryError('refused', refusedStatus)
    const status = error instanceof StreamableHTTPError ? error.code : undefined
    if (typeof status === 'number' && status >= 100 && status <= 599) {
      throw new ExternalMcpDiscoveryError('refused', status)
    }
    if (error instanceof McpError) throw new ExternalMcpDiscoveryError('refused', null)
    throw new ExternalMcpDiscoveryError('unreadable', null)
  } finally {
    unreadable = undefined
    client.onerror = undefined
    // ⚠️ **Best-effort, and swallowing its own failure**: a preflight that left a socket open
    // because it could not close it cleanly is worse than one that reports a stale error.
    try {
      await client.close()
    } catch {
      /* nothing further this can do about a transport that will not close */
    }
  }
}
