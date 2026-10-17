import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from '../src/internal/async-queue'
import { claudeMcpServersFor, forbiddenExternalSpellings } from '../src/claude/agent-tools'
import { discoverExternalMcpTools, type ExternalMcpReach } from '../src/external-mcp'
import { CLAUDE_TOOL_NAMING, qualifyWith } from '../src/tool-inventory'
import { ClaudeRuntime, type AgentToolset, type ClaudeQuery } from '../src/index'

/**
 * 🔴 **516 · the Claude half of *one local server, one identity*** (HO-040 §4.2, `507` §3.1).
 *
 * ## ⚑ A REAL MCP server, on a real loopback socket
 *
 * ⛔ **The one thing this package gains is a CLIENT, and a client is worth what its handshake is
 * worth.** A fake that answered a hand-written JSON body would be this file's idea of the protocol
 * rather than the protocol — so the fixture is the reference implementation's own server, which is
 * what a person's local server will be in practice.
 *
 * ⚠️ **Its own free port and its own process**: `listen(0)` is kernel-assigned, the host is
 * `127.0.0.1`, and the server runs in THIS process — so it is this test's own port and its own pid
 * by construction, which is the rule every launch in this repo is held to.
 *
 * ## ⛔ What this file does NOT claim
 *
 * ⚠️ **It proves the projection reaches Claude's `Options`, not that a live Claude called a tool.**
 * The refusal rail itself needs `TOOL_NAMES`, which lives in the desktop app — so the paired
 * refusal-and-admission sample is `apps/desktop/test/one-local-server-one-identity.test.ts`, and
 * this file measures the two things only this package can answer: the handshake, and the launch.
 */

/* ────────────────────────────────────────────── a real local MCP server, for the length of a test */

interface LocalServer {
  readonly url: string
  close(): Promise<void>
}

const running: LocalServer[] = []

/**
 * ⚠️ **A fresh server and transport PER REQUEST, which is the reference implementation's own
 * stateless shape.** ⛔ One long-lived stateless transport rejects the `initialized` notification
 * that follows `initialize` — measured, not guessed: the client's `connect()` threw
 * *"Error POSTing to endpoint"* against a shared instance and succeeds against this one.
 */
async function localMcpServer(tools: readonly string[]): Promise<LocalServer> {
  const build = async (): Promise<StreamableHTTPServerTransport> => {
    const mcp = new McpServer({ name: 'fixture', version: '1' })
    for (const name of tools) {
      mcp.registerTool(name, { description: `the fixture's ${name}` }, () => ({
        content: [{ type: 'text' as const, text: 'never called' }],
      }))
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await mcp.connect(transport)
    return transport
  }
  const http: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const transport = await build()
      res.on('close', () => void transport.close())
      await transport.handleRequest(req, res)
    })()
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const port = (http.address() as AddressInfo).port
  const one: LocalServer = {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    close: async () => {
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
  running.push(one)
  return one
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close()
})

/* ───────────────────────────────────────────────────────────── §1 · the handshake, against a real server */

describe('516 §1 · asking a local server what it offers', () => {
  it('🔴 answers the server’s own tool names, over a real loopback MCP handshake', async () => {
    const server = await localMcpServer(['search_issues', 'create_issue'])
    expect([...(await discoverExternalMcpTools(server.url))].sort()).toEqual([
      'create_issue',
      'search_issues',
    ])
  })

  it('⛔ a server that is not there is NOT PERFORMED — it rejects rather than answering empty', async () => {
    // 🔴 **The distinction standing rule 13 is about.** An empty list would mean *this server
    // publishes nothing*, which is a clean roster and would REGISTER; a rejection means *we could
    // not ask*, and the door refuses. ⚠️ Port 9 is the discard port — nothing in this repo binds it.
    await expect(
      discoverExternalMcpTools('http://127.0.0.1:9/mcp', { deadlineMs: 2_000 }),
    ).rejects.toThrow()
  })

  it('⚠️ …and a server that accepts a socket and never answers is bounded, not waited on', async () => {
    // ⛔ **A deadline, and the failure is reported rather than inferred** (standing rule 13). `395`
    // measured an unbounded provider wait costing an afternoon; this fixture is that shape — a
    // listener that accepts and says nothing — and without the bound this test would never finish.
    const silent = createServer(() => {
      /* accept the connection and answer nothing, for ever */
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const port = (silent.address() as AddressInfo).port
    try {
      const started = Date.now()
      await expect(
        discoverExternalMcpTools(`http://127.0.0.1:${String(port)}/mcp`, { deadlineMs: 750 }),
      ).rejects.toThrow(/did not answer within/)
      // ⚠️ **A generous ceiling, not a stopwatch on the machine** (standing rule 22): what is being
      // measured is that the wait ENDED, and the number is ten times the bound so the claim is
      // about the code rather than about the load this ran under.
      expect(Date.now() - started).toBeLessThan(7_500)
    } finally {
      await new Promise<void>((resolve) => silent.close(() => resolve()))
    }
  })
})

/* ─────────────────────────────────────────────────── §2 · the known-server union, and what it refuses */

const TOOLSET: AgentToolset = {
  server: 'brobot',
  tools: [
    {
      name: 'spawn_agent',
      description: 'start a conversation',
      input: {},
      beyondItsRails: 'it-starts-something-outside-this-app',
      call: async () => ({ text: 'never called' }),
    },
  ],
}

describe('516 §2 · Claude’s known-server union', () => {
  it('🔴 an external server arrives BESIDE the in-process one, never instead of it', () => {
    const servers = claudeMcpServersFor(TOOLSET, [{ name: 'jira', url: 'http://127.0.0.1:1/mcp' }])
    expect(Object.keys(servers ?? {}).sort()).toEqual(['brobot', 'jira'])
    expect(servers?.brobot).toMatchObject({ type: 'sdk' })
    // ⛔ **`{type:'http', url}` and nothing else.** No `headers` — there is no credential anywhere in
    // this build — and no `tools` policy, because an external tool is not auto-allowed: it reaches
    // `canUseTool` like every other consequential call (HO-040 §4.1).
    expect(servers?.jira).toEqual({ type: 'http', url: 'http://127.0.0.1:1/mcp' })
  })

  it('⛔ an external row named `brobot` REFUSES the launch rather than replacing the toolset', () => {
    // 🔴 **The substitution nothing downstream could see.** Written as a spread, this row would
    // overwrite the in-process server and every one of this app's own tools would be answered by
    // somebody else's endpoint. ⚠️ Registration reserves the name, so the only way here is a
    // hand-edited database — and failing loudly is the answer to that.
    expect(() =>
      claudeMcpServersFor(TOOLSET, [{ name: 'brobot', url: 'http://127.0.0.1:1/mcp' }]),
    ).toThrow(/collides with a server this launch already has/)
  })

  it('⛔ …and so does a second external row with the same name', () => {
    expect(() =>
      claudeMcpServersFor(TOOLSET, [
        { name: 'jira', url: 'http://127.0.0.1:1/mcp' },
        { name: 'jira', url: 'http://127.0.0.1:2/mcp' },
      ]),
    ).toThrow(/collides with a server this launch already has/)
  })

  it('⚑ a launch with a grant and NO toolset still gets the server, and one with neither gets nothing', () => {
    // ⛔ **The two halves are independent.** `agentTools` is what this app offers; a registry grant
    // is what a person gave. ⚠️ The second half is the control that keeps every pre-516 launch
    // byte-identical: nothing granted and nothing offered still answers `undefined`.
    expect(
      claudeMcpServersFor(undefined, [{ name: 'jira', url: 'http://127.0.0.1:1/mcp' }]),
    ).toEqual({ jira: { type: 'http', url: 'http://127.0.0.1:1/mcp' } })
    expect(claudeMcpServersFor(undefined, [])).toBeUndefined()
    expect(claudeMcpServersFor(undefined)).toBeUndefined()
  })
})

/* ───────────────────────────────────────────── §3 · the provider-side backstop, derived and not typed */

describe('516 §3 · the names no external server may present to the model', () => {
  it('🔴 every one of OUR tool names, in Claude’s own spelling, for every granted server', () => {
    const reach: ExternalMcpReach = {
      servers: [
        { name: 'jira', url: 'http://127.0.0.1:1/mcp' },
        { name: 'browser', url: 'http://127.0.0.1:2/mcp' },
      ],
      reservedToolNames: ['spawn_agent', 'end_agent'],
    }
    // ⛔ **Built with `qualifyWith` on BOTH sides**, so this assertion cannot be satisfied by a
    // spelling this file invented — `tool-inventory.ts` is where `mcp__<server>__<tool>` was
    // MEASURED off a real `system/init`, and a literal here would be a second authority on it.
    expect([...forbiddenExternalSpellings(reach)].sort()).toEqual(
      [
        qualifyWith(CLAUDE_TOOL_NAMING, 'jira', 'spawn_agent'),
        qualifyWith(CLAUDE_TOOL_NAMING, 'jira', 'end_agent'),
        qualifyWith(CLAUDE_TOOL_NAMING, 'browser', 'spawn_agent'),
        qualifyWith(CLAUDE_TOOL_NAMING, 'browser', 'end_agent'),
      ].sort(),
    )
    // ⚠️ **And the shape, once, so a change of convention is visible here rather than only in a set
    // comparison that would still be equal to itself.**
    expect(qualifyWith(CLAUDE_TOOL_NAMING, 'jira', 'spawn_agent')).toBe('mcp__jira__spawn_agent')
  })

  it('⚑ nothing granted derives nothing — the launch every session before 516 had', () => {
    expect(forbiddenExternalSpellings(undefined)).toEqual([])
    expect(forbiddenExternalSpellings({ servers: [], reservedToolNames: ['spawn_agent'] })).toEqual(
      [],
    )
  })
})

/* ──────────────────────────────────────────────── §4 · the launch, on start AND on reopen */

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {}
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

async function capturedOptions(
  launch: 'start' | 'resume',
  externalMcp?: ExternalMcpReach,
): Promise<Options> {
  const query = new FakeQuery()
  let captured: Options | undefined
  const runtime = new ClaudeRuntime(
    (params) => {
      captured = params.options
      return query
    },
    async () => true,
  )
  const context = {
    providerHome: '/tmp/x/home',
    agentTools: TOOLSET,
    ...(externalMcp === undefined ? {} : { externalMcp }),
  }
  const handle =
    launch === 'start'
      ? await runtime.start({ cwd: '/tmp/x', ...context })
      : await runtime.resume(
          { provider: 'claude', sessionId: 'sess_516', cwd: '/tmp/x', rotation: 0 },
          context,
        )
  await handle.close()
  if (!captured) throw new Error('query factory never called')
  return captured
}

describe('516 §4 · what a launch is actually handed', () => {
  const REACH: ExternalMcpReach = {
    servers: [{ name: 'jira', url: 'http://127.0.0.1:8765/mcp' }],
    reservedToolNames: ['spawn_agent'],
  }

  it('🔴 start AND reopen carry the granted server, and the pin does not move', async () => {
    // ⛔ **Both launches, because for Claude a resume is the ONLY way anything comes back** (307):
    // a query's `Options` are fixed for its life, so a reopen that dropped the field would hand back
    // a conversation whose external tools had silently gone.
    for (const launch of ['start', 'resume'] as const) {
      const options = await capturedOptions(launch, REACH)
      expect(Object.keys(options.mcpServers ?? {}).sort(), launch).toEqual(['brobot', 'jira'])
      expect(options.mcpServers?.jira, launch).toEqual({
        type: 'http',
        url: 'http://127.0.0.1:8765/mcp',
      })
      // 🔴 **`strictMcpConfig` STAYS TRUE, and that is the sentence `507` §3.1 asked for.** It does
      // not mean *no MCP*; it means this child may load MCP only from the app-known set assembled
      // for this launch. ⛔ A reader meeting a second server here will think the rule was dropped —
      // §5 below is the census that keeps the docblock saying otherwise.
      expect(options.strictMcpConfig, launch).toBe(true)
      expect(options.settingSources, launch).toEqual([])
      // ⛔ **And the backstop, on the same launch**: none of our names is callable under it. Beside
      // it stands only Claude's own question tool, off on every launch — Claude's own `Agent`,
      // `Workflow` and `Task` stay offered (D-014).
      expect(options.disallowedTools, launch).toEqual(['AskUserQuestion', 'mcp__jira__spawn_agent'])
    }
  })

  it('🔴 the docblock SAYS the pin was not abandoned, and the next reader is who it is for', () => {
    // ⛔ **Brief §3.4, and it is standing rule 5's shape**: *"Say the rule was not abandoned, because
    // the next reader will think it was."* A sentence with no test is a comment, and this one is
    // load-bearing — HO-040 §4.4 approved the WIDENING on the strength of the invariant being
    // written down: *"Adding a second KNOWN source is not undoing the property; admitting an UNKNOWN
    // one would be. Say so in the docblock when you change it."*
    //
    // ⚠️ **Read from the file rather than from a constant**, because what is being asserted is that
    // a person opening the adapter meets the sentence — a constant would move the words somewhere
    // nobody reads them.
    const source = readFileSync(
      fileURLToPath(new URL('../src/claude/agent-tools.ts', import.meta.url)),
      'utf8',
    )
    // ⛔ **The clause that says the flag did NOT change meaning.**
    expect(source).toContain('strictMcpConfig` remains true')
    expect(source).toContain('It does not mean *"no MCP"*')
    // ⚑ **…and the clause that says what it now admits, which is the half that makes it checkable.**
    expect(source).toContain('globally registered external servers granted to this identity')
    expect(source).toContain('Project\n * > `.mcp.json`, user settings, plugins')
    // 🔴 **And the flag really is still pinned in the adapter**, so the sentence is not describing a
    // rule the code stopped keeping — `a-description-hardens-into-a-ruling-in-the-docblock-it-leaves`.
    //
    // ⚠️ **Prose stripped, because this adapter DISCUSSES the pin in three docblocks** — a raw count
    // would be satisfied by a comment about a flag somebody had deleted
    // (`a-source-census-must-strip-prose-before-it-asserts`).
    const adapter = readFileSync(
      fileURLToPath(new URL('../src/claude/claude-runtime.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
    // ⛔ **TWO assignments and exactly two**: the real query and the model probe. `507` §3.1 —
    // *"The brief's three places are two executable assignments … plus the declarative claim in
    // `provider-config.ts`. There is no third runtime assignment to invent."*
    expect(adapter.match(/strictMcpConfig: true/g) ?? []).toHaveLength(2)
  })

  it('⚑ a launch with no grant names no server but BroBot’s, and denies none of another server’s tools', async () => {
    // ⛔ **The control that keeps `516` invisible to every session nobody granted anything.** With
    // no grant, the only name denied is Claude's own question tool, which every launch turns off.
    const options = await capturedOptions('start')
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['brobot'])
    expect(options.disallowedTools).toEqual(['AskUserQuestion'])
  })
})
