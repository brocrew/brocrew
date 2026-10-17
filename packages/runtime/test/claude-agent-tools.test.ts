import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { claudeMcpServersFor } from '../src/claude/agent-tools'
import { agentToolStringEnum, type AgentToolset } from '../src/agent-tools'

const here = dirname(fileURLToPath(import.meta.url))
const adapter = join(here, '../src/claude/claude-runtime.ts')

const oneTool: AgentToolset = {
  server: 'brobot',
  tools: [
    {
      name: 'ping',
      description: 'ping',
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: { text: z.string() },
      call: async () => ({ text: 'pong' }),
    },
  ],
}

describe('347 · the Claude half of the tool asymmetry', () => {
  it('⚑ a toolset becomes one in-process MCP server under its own name', () => {
    const servers = claudeMcpServersFor(oneTool)
    expect(servers).toBeDefined()
    expect(Object.keys(servers!)).toEqual(['brobot'])
    // ⚑ **In-process, not stdio** — which is the whole reason 347 needed no wire door. The SDK's
    // own discriminator for this is the `sdk` type with a live instance attached.
    expect((servers!['brobot'] as { type?: string }).type).toBe('sdk')
  })

  it('⛔ no toolset and an EMPTY toolset both mean no server at all', () => {
    expect(claudeMcpServersFor(undefined)).toBeUndefined()
    // ⛔ **An empty one is not "a server with nothing in it".** A server advertising no tools still
    // appears in the child's inventory and in its prompt — a capability block that promises a
    // catalogue and then lists none, which is acceptance #7 written as an MCP handshake.
    expect(claudeMcpServersFor({ server: 'brobot', tools: [] })).toBeUndefined()
  })

  it('🔴 the adapter builds the server exactly ONCE per query', () => {
    // ⛔ **`createSdkMcpServer` returns a LIVE instance**, so calling it twice constructs two servers
    // and hands the child one while the other is dropped on the floor. ⚠️ Nothing observable
    // distinguishes the two objects — both are perfectly valid — so this is pinned from the source
    // rather than from behaviour, which is the only place the difference exists.
    const source = readFileSync(adapter, 'utf8')
    const start = source.indexOf('  private optionsFor(')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('\n  }\n', start))
    const built = body.match(/claudeMcpServersFor\(/g) ?? []
    expect(built).toHaveLength(1)
    // ⚑ Non-vacuity: it really is built here, and really is assigned.
    // ⚑ **516 · it takes a second argument now**, and the assertion moved with the line rather than
    // being relaxed to a prefix: the granted external servers ride the launch context, and a call
    // that dropped them would build a child whose registry grant silently did nothing.
    expect(body).toContain(
      'const mcpServers = claudeMcpServersFor(agentTools, externalMcp?.servers ?? [])',
    )
    expect(body).toContain('if (mcpServers) options.mcpServers = mcpServers')
  })
})

/**
 * 🔴 **348 · the argument that reaches the handler, driven through the SDK's own server.**
 *
 * ⛔ **This is the test `347` did not have, and its absence let a false comment ship.** Everything
 * above asserts the SERVER's shape; nothing asked what the handler is HANDED — and the answer was
 * *"whatever survived a strict zod parse"*, which is `303` B in the model's hands.
 */
describe('348 · what the child’s arguments look like by the time a tool sees them', () => {
  /**
   * Drive the in-process server the way the CLI does: a minimal duck-typed transport, an
   * `initialize` handshake, then one `tools/call`.
   *
   * ⚠️ **Deliberately not a hand-rolled reimplementation of the parse.** The stripping happens
   * inside the MCP SDK, so a test that called `one.call(args)` directly would measure nothing at all
   * — it would pass identically before and after the fix.
   */
  async function callThrough(
    toolset: AgentToolset,
    args: Record<string, unknown>,
  ): Promise<{ seen: Record<string, unknown> | null; advertised: unknown }> {
    const servers = claudeMcpServersFor(toolset)
    const low = (servers!['brobot'] as { instance: { server: unknown } }).instance.server as {
      connect(transport: unknown): Promise<void>
    }
    const out: Record<string, unknown>[] = []
    const transport: Record<string, unknown> = {
      start: async () => {},
      send: async (message: Record<string, unknown>) => {
        out.push(message)
      },
      close: async () => {},
    }
    await low.connect(transport)
    const post = (message: unknown): void => {
      ;(transport['onmessage'] as (m: unknown) => void)(message)
    }
    post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    })
    await vi.waitFor(() => expect(out.some((m) => m['id'] === 1)).toBe(true))
    post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    await vi.waitFor(() => expect(out.some((m) => m['id'] === 2)).toBe(true))
    post({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'spawn_agent', arguments: args },
    })
    await vi.waitFor(() => expect(out.some((m) => m['id'] === 3)).toBe(true))
    const listed = out.find((m) => m['id'] === 2) as {
      result?: { tools?: { inputSchema?: unknown }[] }
    }
    return { seen: handed, advertised: listed.result?.tools?.[0]?.inputSchema }
  }

  let handed: Record<string, unknown> | null = null
  const spawner: AgentToolset = {
    server: 'brobot',
    tools: [
      {
        name: 'spawn_agent',
        description: 'Create another agent.',
        beyondItsRails: 'it-starts-something-outside-this-app',
        input: {
          profile_slug: z.string(),
          purpose: z.string(),
          kind: agentToolStringEnum(['work', 'question'] as const)
            .describe("'work' assigns work. 'question' asks a question.")
            .optional(),
          details: z
            .object({
              urgency: agentToolStringEnum(['low', 'high'] as const).describe(
                "'low' can wait. 'high' goes first.",
              ),
            })
            .optional(),
          batches: z
            .array(
              z.object({
                channel: agentToolStringEnum(['foreground', 'background'] as const).describe(
                  "'foreground' is visible. 'background' is deferred.",
                ),
              }),
            )
            .optional(),
        },
        call: async (args) => {
          handed = args
          return { text: 'ok' }
        },
      },
    ],
  }

  it('🔴 an undocumented key survives to the handler, so rail 1 can refuse it BY NAME', async () => {
    handed = null
    const { seen, advertised } = await callThrough(spawner, {
      profile_slug: 'worker',
      purpose: 'why',
      priority: 'high',
    })
    // ⛔ Before 348 this was `{profile_slug, purpose}` — `priority` was gone, and `341`'s rail 1
    // could never fire for the one cause it exists for.
    expect(seen).toEqual({ profile_slug: 'worker', purpose: 'why', priority: 'high' })
    // ⚑ …and the child is TOLD, rather than having the key silently dropped.
    expect((advertised as { additionalProperties?: unknown }).additionalProperties).not.toBe(false)
  })

  it('⚠️ …and the declared keys still arrive, so the loosening did not empty the schema', async () => {
    handed = null
    const { advertised } = await callThrough(spawner, { profile_slug: 'worker', purpose: 'why' })
    expect(handed).toEqual({ profile_slug: 'worker', purpose: 'why' })
    expect(Object.keys((advertised as { properties: object }).properties).sort()).toEqual([
      'batches',
      'details',
      'kind',
      'profile_slug',
      'purpose',
    ])
  })

  it('🔴 advertises a closed vocabulary AND lets an unknown member reach the app’s rail', async () => {
    handed = null
    const { seen, advertised } = await callThrough(spawner, {
      profile_slug: 'worker',
      purpose: 'why',
      kind: 'status',
    })
    const kind = (advertised as { properties: { kind: Record<string, unknown> } }).properties.kind
    expect(kind['enum']).toEqual(['work', 'question'])
    expect(kind['description']).toContain("'work' assigns work.")
    expect(kind).not.toHaveProperty('default')
    const properties = (advertised as { properties: Record<string, Record<string, unknown>> })
      .properties
    const details = properties['details'] as {
      properties: { urgency: Record<string, unknown> }
    }
    expect(details.properties.urgency['enum']).toEqual(['low', 'high'])
    expect(details.properties.urgency['description']).toContain("'high' goes first.")
    const batches = properties['batches'] as {
      items: { properties: { channel: Record<string, unknown> } }
    }
    expect(batches.items.properties.channel['enum']).toEqual(['foreground', 'background'])
    expect(batches.items.properties.channel['description']).toContain("'background' is deferred.")
    // ⛔ The provider did not turn the unknown word into -32602. The real handler receives it
    // and can return the same structured malformed-request payload it returns on Codex.
    expect(seen).toMatchObject({ kind: 'status' })
  })
})
