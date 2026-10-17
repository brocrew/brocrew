import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  query,
  type McpServerStatus,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import { claudeKeychainTokenProvider, claudeProjectDirName } from '@brobot2/runtime'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import { buildChildEnv } from '../../../packages/runtime/src/internal/child-env'
import {
  describeHits,
  describeScan,
  pathsNaming,
  type Hit,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import { agentToolsFor, type AgentToolHost } from '../src/main/runtime/agent-tools'

/**
 * 🔴 **358 · which door publishes a conversation's tool inventory, and when it first exists.**
 *
 * `pnpm run probe:tool-inventory`. ⛔ **The dispatch says to read the PUBLISHED inventory rather
 * than a config file or a hardcoded list, and there are two candidate doors on Claude.** They are
 * not equivalent, and nothing in this repository had ever compared them:
 *
 * | door | what it carries | when it first exists | costs a turn |
 * |---|---|---|---|
 * | `Query.mcpServerStatus()` | per SERVER: name, status, and `tools[]` with **descriptions** | ⚠️ unmeasured | ⚠️ unmeasured |
 * | `system/init.tools` | one FLAT list of model-visible names, no descriptions | first `system/init` | **yes** |
 *
 * ⚑ **`toolset-probe` measured the second door and passed no `mcpServers`**, so it has only ever
 * seen built-ins — *"it shows built-ins only and never the five agent tools"*. This probe attaches
 * the app's REAL toolset (`agentToolsFor` → `claudeMcpServersFor`, both product functions) so what
 * it reports is this build's inventory rather than a hand-written stand-in.
 *
 * ## ⚠️ The control is the whole measurement
 *
 * Arm **b** launches exactly the same way with `mcpServers` **omitted**. A name found in **a** and
 * absent from **b** is attributable to the toolset; a name in both is the provider's own. Without
 * it, "`mcp__brobot__give_work` appears" would be a string found in a stream — the shape
 * [[a-comparison-tested-where-both-sides-agree-measures-nothing]] warns about.
 *
 * ## 🔒 Nothing personal is read or written
 *
 * Every query runs against a throwaway `CLAUDE_CONFIG_DIR` under `tmpdir()`, and the run FAILS if
 * anything **it owns** turns up in a personal home — the same three-part check `toolset-probe` uses
 * (176): the markers are found where the work landed, the isolated config was born in this run, and
 * neither personal tree names any of it.
 *
 * ⚠️ **It costs, and the bill is kept to nothing that matters**: `haiku`, a one-line prompt, and
 * every query is closed the moment `system/init` lands — usually before the model has answered.
 */

/** The real tools, with a host whose methods this probe never reaches. */
function realToolset(): ReturnType<typeof agentToolsFor> {
  const never = (): never => {
    throw new Error('the probe closes at system/init; no tool call can happen')
  }
  const host = {
    giveWork: never,
    queueMessage: never,
    agentsVisibleTo: never,
    agentCard: never,
  } as unknown as AgentToolHost
  return agentToolsFor(host, 'sess_probe_358')
}

/** The isolation a real launch gets — `toolset-probe`'s `optionsFor`, plus the toolset under test. */
function optionsFor(home: string, token: string, extra: Partial<Options>): Options {
  return {
    model: 'haiku',
    canUseTool: () => Promise.resolve({ behavior: 'deny' as const, message: 'probe: no tools' }),
    env: buildChildEnv({
      CLAUDE_CONFIG_DIR: home,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_OAUTH_TOKEN: token,
    }),
    strictMcpConfig: true,
    settingSources: [],
    ...extra,
  }
}

/** One user message and then silence: enough to make the CLI emit `system/init`, and no more. */
async function* saysHello(): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    session_id: '',
    parent_tool_use_id: null,
    message: { role: 'user', content: 'Reply with the single word OK.' },
  } as unknown as SDKUserMessage
  await new Promise<void>(() => {}) // never a second turn
}

/** Everything one arm saw, from both doors. */
interface Reading {
  /** ⚠️ `mcpServerStatus()` called BEFORE the stream is consumed — the "no turn yet" reading. */
  readonly statusBeforeTurn: readonly McpServerStatus[] | null
  readonly statusBeforeTurnError: string | null
  readonly statusBeforeTurnMs: number
  /** The same call again once `system/init` has landed, for the two to be compared. */
  readonly statusAfterInit: readonly McpServerStatus[] | null
  readonly statusAfterInitError: string | null
  /** `system/init.tools` — the flat model-visible list. */
  readonly initTools: readonly string[]
  /** `system/init.mcp_servers` — name + status, no tools. */
  readonly initServers: readonly { name: string; status: string }[]
  readonly initMs: number
  readonly sessionId?: string
  readonly error?: string
}

const EMPTY: Omit<Reading, 'error'> = {
  statusBeforeTurn: null,
  statusBeforeTurnError: null,
  statusBeforeTurnMs: 0,
  statusAfterInit: null,
  statusAfterInitError: null,
  initTools: [],
  initServers: [],
  initMs: 0,
}

async function readInventory(
  home: string,
  cwd: string,
  token: string,
  extra: Partial<Options>,
): Promise<Reading> {
  const startedAt = Date.now()
  const probe = query({ prompt: saysHello(), options: optionsFor(home, token, { cwd, ...extra }) })

  // ── door 1, before anything has been consumed off the stream ──────────────────────────────
  //
  // ⛔ **This is the question the dispatch turns on.** `initializationResult()` answers off the CLI
  // handshake with no turn (279, measured at 1 918 ms); if `mcpServerStatus()` does the same, the
  // inventory exists at LAUNCH and the surface can be truthful before a person has typed anything.
  // If it needs a turn, the surface must say "not yet" on a conversation nobody has spoken to.
  let statusBeforeTurn: readonly McpServerStatus[] | null = null
  let statusBeforeTurnError: string | null = null
  const askedAt = Date.now()
  try {
    statusBeforeTurn = await probe.mcpServerStatus()
  } catch (e) {
    statusBeforeTurnError = e instanceof Error ? e.message : String(e)
  }
  const statusBeforeTurnMs = Date.now() - askedAt

  try {
    for await (const message of probe as AsyncIterable<SDKMessage>) {
      if (message.type !== 'system' || message.subtype !== 'init') continue
      const initMs = Date.now() - startedAt
      let statusAfterInit: readonly McpServerStatus[] | null = null
      let statusAfterInitError: string | null = null
      try {
        statusAfterInit = await probe.mcpServerStatus()
      } catch (e) {
        statusAfterInitError = e instanceof Error ? e.message : String(e)
      }
      return {
        statusBeforeTurn,
        statusBeforeTurnError,
        statusBeforeTurnMs,
        statusAfterInit,
        statusAfterInitError,
        initTools: [...message.tools],
        initServers: message.mcp_servers.map((s) => ({ name: s.name, status: s.status })),
        initMs,
        sessionId: message.session_id,
      }
    }
    return {
      ...EMPTY,
      statusBeforeTurn,
      statusBeforeTurnError,
      statusBeforeTurnMs,
      error: 'the stream ended before system/init',
    }
  } catch (e) {
    return {
      ...EMPTY,
      statusBeforeTurn,
      statusBeforeTurnError,
      statusBeforeTurnMs,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    try {
      probe.close()
    } catch {
      /* best-effort: a probe that cannot close cleanly is still a probe */
    }
  }
}

/** When the config in a home was BORN, in epoch ms — `0` if there is no config or no such field. */
function firstStartTimeOf(config: string): number {
  if (!existsSync(config)) return 0
  const born = (JSON.parse(readFileSync(config, 'utf8')) as { firstStartTime?: unknown })
    .firstStartTime
  if (typeof born === 'number') return born
  return typeof born === 'string' ? Date.parse(born) : 0
}

function ownedMarkers(sessionIds: readonly string[], cwd: string): Marker[] {
  return [
    ...sessionIds.map((id) => ({ label: `session ${id.slice(0, 8)}`, value: id })),
    { label: 'our cwd', value: claudeProjectDirName(realpathSync(cwd)) },
  ]
}

function describeServers(servers: readonly McpServerStatus[] | null, error: string | null): string {
  if (error !== null) return `⛔ refused: ${error}`
  if (servers === null) return '(not asked)'
  if (servers.length === 0) return '[] — answered, and named no server'
  return servers
    .map(
      (s) =>
        `${s.name} [${s.status}]` +
        (s.tools === undefined
          ? ' · tools: ABSENT'
          : ` · tools(${s.tools.length}): ${s.tools.map((t) => `${t.name}${t.description === undefined ? '' : '✎'}`).join(', ')}`),
    )
    .join('\n                         ')
}

it('358 · which door publishes the tool inventory, and when', async () => {
  const startedAt = Date.now()
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine Keychain login must be inheritable or the probe measures nothing',
  ).not.toBeNull()

  const toolset = realToolset()
  const mcpServers = claudeMcpServersFor(toolset)
  expect(mcpServers, 'the real product translation must produce a server to measure').toBeDefined()

  const home = join(tmpdir(), `brobot2-tool-inventory-${process.pid}`)
  const cwd = join(tmpdir(), `brobot2-tool-inventory-cwd-${process.pid}-${startedAt}`)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(cwd, { recursive: true })

  let withTools: Reading
  let without: Reading
  let markers: Marker[]
  let isolatedHits: Hit[]
  let configBornAt: number
  try {
    // a · the app's real launch: the whole published toolset attached as an in-process MCP server.
    withTools = await readInventory(home, cwd, token as string, { mcpServers })
    // b · the control: identical, minus the one option under test.
    without = await readInventory(home, cwd, token as string, {})

    const report = (label: string, r: Reading): void => {
      console.log(
        `\n── ${label} ──\n` +
          `  error                  : ${r.error ?? 'none'}\n` +
          `  system/init at         : ${r.initMs} ms\n` +
          `  mcpServerStatus() BEFORE any turn (${r.statusBeforeTurnMs} ms):\n` +
          `                         ${describeServers(r.statusBeforeTurn, r.statusBeforeTurnError)}\n` +
          `  mcpServerStatus() after system/init:\n` +
          `                         ${describeServers(r.statusAfterInit, r.statusAfterInitError)}\n` +
          `  init.mcp_servers       : ${r.initServers.map((s) => `${s.name}[${s.status}]`).join(', ') || '(none)'}\n` +
          `  init.tools (${String(r.initTools.length).padStart(2)})       : ${r.initTools.join(', ')}`,
      )
    }
    report('a · the app’s real launch, the toolset attached', withTools)
    report('b · control — the same launch, no mcpServers', without)

    const qualified = toolset.tools.map((t) => `mcp__${toolset.server}__${t.name}`)
    const inInit = qualified.filter((n) => withTools.initTools.includes(n))
    const inControl = qualified.filter((n) => without.initTools.includes(n))
    const statusNames = (r: Reading): string[] => (r.statusBeforeTurn ?? []).map((s) => s.name)
    console.log(
      `\n── verdicts ──\n` +
        `  qualified names expected      : ${qualified.join(', ')}\n` +
        `  of those, in a.init.tools     : ${inInit.length}/${qualified.length}\n` +
        `  of those, in b.init.tools     : ${inControl.length}/${qualified.length}  ⟵ must be 0\n` +
        `  mcpServerStatus BEFORE a turn : ${withTools.statusBeforeTurnError === null ? `answered in ${withTools.statusBeforeTurnMs} ms` : 'REFUSED'}\n` +
        `  …and named                    : ${statusNames(withTools).join(', ') || '(nothing)'}\n` +
        `  …control named                : ${statusNames(without).join(', ') || '(nothing)'}\n` +
        `  descriptions available there  : ${(withTools.statusBeforeTurn ?? []).some((s) => (s.tools ?? []).some((t) => t.description !== undefined))}`,
    )

    markers = ownedMarkers([withTools, without].map((r) => r.sessionId ?? '').filter(Boolean), cwd)
    isolatedHits = pathsNaming(home, markers).hits
    configBornAt = firstStartTimeOf(join(home, '.claude.json'))
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }

  expect(withTools.error ?? 'none', 'the instrumented launch must succeed').toBe('none')
  expect(without.error ?? 'none', 'and so must the control').toBe('none')

  // ⛔ **The pair.** Both halves, or the positive one is a string found in a stream.
  const qualified = toolset.tools.map((t) => `mcp__${toolset.server}__${t.name}`)
  expect(
    qualified.filter((n) => withTools.initTools.includes(n)),
    'every one of them is model-visible when the toolset is attached',
  ).toEqual(qualified)
  expect(
    qualified.filter((n) => without.initTools.includes(n)),
    'and NOT ONE of them is, when it is not — so the finding is attributable',
  ).toEqual([])

  // ⛔ **THE TRAP, and it is why this app reads `system/init` and not this call** (358). The SAME
  // method, on the SAME session, answers twice and differently: before the stream has been
  // consumed it returns `[]` — *answered, and named no server* — which is byte-identical to the
  // honest answer for a conversation that really has none. A surface built on it at launch would
  // say "no tools" about a conversation holding the whole toolset.
  expect(
    withTools.statusBeforeTurnError,
    'mcpServerStatus() before a turn does not refuse — it ANSWERS, which is the hazard',
  ).toBeNull()
  expect(
    withTools.statusBeforeTurn,
    'and the answer is the empty list, on a session that has the whole toolset',
  ).toEqual([])
  // …and the divergence: the same call after `system/init` names the server. Without this half the
  // assertion above is satisfied by a session that simply has nothing.
  expect(
    (withTools.statusAfterInit ?? []).map((s) => s.name),
    'after system/init the very same call names the in-process server',
  ).toEqual(['brobot'])
  expect(
    (withTools.statusAfterInit ?? []).flatMap((s) => (s.tools ?? []).map((t) => t.name)),
    'with every tool by name',
  ).toEqual(toolset.tools.map((t) => t.name))
  // ⚠️ **`description` is declared optional on `McpServerStatus.tools[]` and the CLI does not send
  // one for an in-process SDK server** — measured. So the published inventory names tools and never
  // describes them, and a surface that wants a sentence per tool must join BroBot's own
  // declaration by name. That is the whole reason this dispatch's event carries two halves.
  expect(
    (withTools.statusAfterInit ?? []).flatMap((s) => (s.tools ?? []).map((t) => t.description)),
    'and NO description for any of them — the door publishes names, not sentences',
  ).toEqual(toolset.tools.map(() => undefined))
  // The control proves the reading above is the toolset's and not the provider's own furniture.
  expect(without.statusAfterInit, 'and the control names no server at the same moment').toEqual([])

  // ⚑ **What `system/init` carries that the status call does not need to be asked for.**
  expect(
    withTools.initServers,
    'the init frame states the server and the connection in one field',
  ).toEqual([{ name: 'brobot', status: 'connected' }])
  expect(without.initServers, 'and states none for the control').toEqual([])

  // ---- 🔒 isolation (176) ----
  const claudeHome = join(homedir(), '.claude')
  const codexHome = join(homedir(), '.codex')
  expect(markers.length, 'every session reported an id to key the isolation on').toBe(3)
  expect(
    isolatedHits.filter((hit) => hit.label.startsWith('session')).length,
    'the provider wrote a transcript for EVERY session, into the isolated home',
  ).toBe(2)
  expect(
    isolatedHits.filter((hit) => hit.label === 'our cwd').length,
    'and filed them under a project bucket named after our cwd',
  ).toBe(1)
  console.log(
    `\n── 🔒 isolation ──\n  in the isolated home : ${describeHits(isolatedHits)}\n` +
      `  config born at       : ${configBornAt} (run started ${startedAt})`,
  )
  expect(
    configBornAt,
    'the isolated config was created by this run, not copied from the user',
  ).toBeGreaterThanOrEqual(startedAt)
  expect(
    describeScan(pathsNaming(claudeHome, markers), pathsNaming(codexHome, markers)),
    'nothing this run made is in a personal home',
  ).toBe('none')
}, 300_000)
