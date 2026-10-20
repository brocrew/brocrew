import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import * as claudeTools from '../src/claude/agent-tools'
import { claudeMcpServersFor } from '../src/claude/agent-tools'
import { ClaudeRuntime, type ClaudeQuery, type QueryFactory } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'
import {
  withManagedPluginAttachments,
  type ManagedPluginAttachment,
} from '../src/managed-plugin-session'
import type { SessionHandle } from '../src/runtime'
import { TheCliAnswersInOrder } from './the-cli-answers-in-order'
import { agentToolStringEnum, type AgentToolset } from '../src/agent-tools'

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

  it('🔴 the adapter builds the server exactly ONCE per query', async () => {
    // Count live constructions, including discarded instances, rather than lazy callback sites.
    const built = vi.spyOn(claudeTools, 'claudeMcpServersFor')
    try {
      for (const resume of [false, true]) {
        built.mockClear()
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-claude-build-')))
        const providerHome = join(root, 'home')
        mkdirSync(providerHome)
        const frames = new AsyncQueue<SDKMessage>()
        const cli = new TheCliAnswersInOrder()
        const setMcpServers = vi.fn<NonNullable<ClaudeQuery['setMcpServers']>>(async () => ({
          added: [],
          removed: [],
          errors: {},
        }))
        const query: ClaudeQuery = {
          interrupt: async () => {},
          close: () => frames.close(),
          return: async () => frames.close(),
          setMcpServers,
          [Symbol.asyncIterator]: () => cli.over(frames[Symbol.asyncIterator]()),
        }
        const queryFactory = vi.fn((args: Parameters<QueryFactory>[0]) => {
          cli.listen(args.prompt)
          return query
        })
        const route = {
          name: 'plugin-fern',
          url: 'http://127.0.0.1:8123/mcp',
          capability: 'a'.repeat(64),
        }
        let attachment: ManagedPluginAttachment = { revision: 'one', servers: [route] }
        const runtime = withManagedPluginAttachments(
          new ClaudeRuntime(queryFactory, async () => true),
          {
            read: async () => attachment,
            close: async () => {},
          },
        )
        const options = {
          cwd: root,
          providerHome,
          agentTools: oneTool,
          externalMcp: {
            servers: [{ name: 'person-server', url: 'http://127.0.0.1:9234/mcp' }],
            reservedToolNames: [],
          },
        }
        let handle: SessionHandle | undefined
        try {
          handle = resume
            ? await runtime.resume(
                { provider: 'claude', sessionId: 'fictional-thread', cwd: root, rotation: 0 },
                options,
              )
            : await runtime.start(options)
          expect(built).toHaveBeenCalledTimes(1)
          expect(queryFactory).toHaveBeenCalledTimes(1)
          expect(queryFactory.mock.calls[0]![0].options.mcpServers).toBe(
            built.mock.results[0]!.value,
          )
          expect(built.mock.results[0]!.value).toMatchObject({
            brobot: { type: 'sdk' },
            'person-server': { type: 'http' },
            'plugin-fern': { type: 'http' },
          })
          const finishTurn = async () => {
            frames.push({ type: 'result', subtype: 'success', is_error: false } as SDKMessage)
            await vi.waitFor(() => expect(handle!.status()).toBe('idle'))
          }
          await handle.send('fictional first turn')
          attachment = { revision: 'two', servers: [{ ...route, name: 'plugin-willow' }] }
          await expect(handle.send('fictional busy turn')).rejects.toThrow()
          expect(built).toHaveBeenCalledTimes(1)
          expect(setMcpServers).not.toHaveBeenCalled()
          await finishTurn()

          await handle.send('fictional changed inventory')
          expect(built).toHaveBeenCalledTimes(2)
          expect(setMcpServers).toHaveBeenCalledTimes(1)
          expect(setMcpServers.mock.calls[0]![0]).toBe(built.mock.results[1]!.value)
          expect(Object.keys(built.mock.results[1]!.value!).sort()).toEqual([
            'brobot',
            'person-server',
            'plugin-willow',
          ])
          await finishTurn()

          await handle.send('fictional unchanged inventory')
          expect(built).toHaveBeenCalledTimes(2)
          expect(setMcpServers).toHaveBeenCalledTimes(1)
          await finishTurn()

          attachment = { revision: 'three', servers: [] }
          await handle.send('fictional removed inventory')
          expect(built).toHaveBeenCalledTimes(3)
          expect(setMcpServers).toHaveBeenCalledTimes(2)
          expect(setMcpServers.mock.calls[1]![0]).toBe(built.mock.results[2]!.value)
          expect(Object.keys(built.mock.results[2]!.value!).sort()).toEqual([
            'brobot',
            'person-server',
          ])
          expect(queryFactory).toHaveBeenCalledTimes(1)
          await finishTurn()
        } finally {
          await handle?.close()
          for (const result of built.mock.results) {
            if (result.type === 'return' && result.value?.brobot?.type === 'sdk') {
              await result.value.brobot.instance.close()
            }
          }
          rmSync(root, { recursive: true, force: true })
        }
      }
    } finally {
      built.mockRestore()
    }
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
