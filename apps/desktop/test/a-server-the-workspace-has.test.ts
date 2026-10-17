import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  capabilitiesFor,
  FakeProviderSessions,
  FakeRuntime,
  type ExternalMcpReach,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { composeProfileBundle, type InstructionContext } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { TOOL_NAMES } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { CAPABILITY_FIELDS, type CapabilityGrant } from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import {
  EXTERNAL_MCP_EVERYONE_MEANS,
  EXTERNAL_MCP_REACH_IS_FIXED,
  externalMcpServerRowId,
  foldExternalMcpReach,
  type ExternalMcpServerReach,
} from '../src/shared/external-mcp'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * A workspace server is available through the workspace’s server configuration.
 *
 * > ⛔ *"I am not sure why we even need to enable/disable the mcp tools, I really need them to
 * > actually be enabled always for all agents including brobot and the PM and the workers."*
 *
 * ## ⚑ What the ruling is, and what this file measures
 *
 * `HO-048` §1: ⚑ ***"Is this server everyone's?* is a property of the server, and the current model
 * asks it once per identity and can never answer it once."* ⛔ **One column, two values, defaulting
 * to *available to every identity*.** *"A registration form that starts restricted and asks a person
 * to open it up would reproduce today's cost with one extra click, which is not a fix. It starts
 * open."*
 *
 * ⚠️ **`516`'s suite is the other half of this measurement and is NOT duplicated here.** Every
 * registration in that file now passes `reach: 'restricted'` and every one of its assertions still
 * holds — the collision rail, *a registration grants nobody*, the tick, the cascade, the Codex arm —
 * which is `HO-048` §1.1's *"the narrow half survives"* asserted by re-running it rather than by
 * claiming it. **§3 below is the one row of it this file repeats**, because obligation 4 wants the
 * positive control standing beside the widening rather than in another file.
 *
 * ## 🔴 Standing rule 24 — this is a WIDENING, so *it can only refuse more* is unavailable
 *
 * ⛔ **§5 enumerates what is newly reachable and §6 enumerates what is NOT**, because the comfort
 * available to a narrowing is not available here: every combination this dispatch newly admits has
 * to be named, and checked against what the PO ruled rather than against what they did not picture.
 *
 * ## ⚑ A REAL local MCP server, because registration is a HANDSHAKE
 *
 * ⛔ The door asks the server what it offers before it writes (HO-040 §4.3), so a fake would make
 * every registration in this file a different act from the one a person performs. ⚠️ Each server
 * gets its own kernel-assigned port on `127.0.0.1`, in THIS process — its own free port and its own
 * pid by construction.
 */

/* ────────────────────────────────────────── a real local MCP server, for the length of a test */

interface LocalServer {
  readonly url: string
  close(): Promise<void>
}

const running: LocalServer[] = []

/** ⚠️ A fresh server and transport PER REQUEST — the reference implementation's stateless shape. */
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

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** One launch, as the provider saw it. */
interface Launched {
  provider: Provider
  externalMcp: ExternalMcpReach | undefined
  /** ⛔ Whether the launch context carried the field AT ALL — absent and empty are different. */
  hasField: boolean
}

class WatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly launches: Launched[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  private note(options: StartOptions | ResumeOptions): void {
    this.launches.push({
      provider: this.provider,
      externalMcp: options.externalMcp,
      hasField: 'externalMcp' in options,
    })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.note(options)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    this.note(options)
    return handle
  }
}

/** ⚠️ A grant that changes NO capability — derived, so a tenth capability cannot drop out of it. */
const NOTHING_CHOSEN = Object.fromEntries(
  CAPABILITY_FIELDS.map((field) => [field.key, null]),
) as unknown as CapabilityGrant

describe('524 · a server the workspace has', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let launches: Launched[]
  let counter: number
  let window: Sink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-524-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-524-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_000_000
    store = createSessionStore(db, tick)
    counter = 0
    launches = []
    sessions = new FakeProviderSessions()
    const seen: InstructionContext[] = []
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new WatchingRuntime(provider, launches, sessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      readInstructions: (provider, cwd, providerHome, ctx) => {
        seen.push(ctx)
        const bundle = publishProfileBundle(provider, providerHome, composeProfileBundle(ctx))
        const read = readSessionInstructions({ provider, cwd, providerHome, bundle })
        return { instructions: read.instructions, systemHint: undefined, memoryLoaded: null }
      },
    })
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    while (running.length > 0) await running.pop()?.close()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, provider: Provider = 'claude'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  const openAndClose = async (profileId: string, provider: Provider = 'claude'): Promise<void> => {
    await host.close(await personOpens(profileId, provider), window)
  }

  const lastLaunch = (): Launched => {
    const one = launches.at(-1)
    if (one === undefined) throw new Error('nothing was launched')
    return one
  }

  /** ⚑ The names the provider was actually handed, which is the only thing that decides reach. */
  const handedTo = async (profileId: string, provider: Provider = 'claude'): Promise<string[]> => {
    await openAndClose(profileId, provider)
    return [...(lastLaunch().externalMcp?.servers ?? [])].map((one) => one.name).sort()
  }

  const register = (
    name: string,
    url: string,
    reach: ExternalMcpServerReach,
  ): ReturnType<RuntimeHost['registerExternalMcpServer']> =>
    host.registerExternalMcpServer({ name, url, reach })

  /** ⛔ Tick a set of servers on one identity, through the door a person's Save goes through. */
  const grant = (slug: string, serverIds: readonly string[]): void => {
    expect(host.setCapabilities(slug, NOTHING_CHOSEN, serverIds)).not.toBeNull()
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the two answers, one identity, one sample
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · an identity with NO grant row', () => {
    it('🔴 reaches the available-to-all server and NOT the restricted one, in one sample', async () => {
      // ⛔ **The two servers differ in exactly ONE fact** — standing rule 3's *"the same call one
      // fact over allowed"*. ⚠️ Same tool roster, same loopback shape, same registration door; the
      // only thing that is different is the word `HO-048` §1 put on the row.
      const everyones = await localMcpServer(['search_issues'])
      const somebodys = await localMcpServer(['search_issues'])
      await register('kibana', everyones.url, 'everyone')
      await register('browser', somebodys.url, 'restricted')

      // `worker` holds no conversation: workspace server access must also cover identities
      // created by BroBot that nobody has opened.
      await openAndClose('worker')
      expect(
        host.agentIdentities().identities.find((one) => one.slug === 'worker')
          ?.externalMcpServerIds,
        'the premise: this identity has been granted nothing',
      ).toEqual([])

      expect(await handedTo('worker')).toEqual(['kibana'])

      // ⚑ **The control, on the SAME identity in the SAME sample**: tick the restricted one and it
      // arrives, so the absence above is the reach rule and not a broken launch path.
      grant('worker', [externalMcpServerRowId('browser')])
      expect(await handedTo('worker')).toEqual(['browser', 'kibana'])
    })

    it('⚑ …and every identity gets it, including one that has never been opened', async () => {
      const everyones = await localMcpServer(['search_issues'])
      await register('kibana', everyones.url, 'everyone')
      await openAndClose(DEFAULT_PROFILE_ID)
      await openAndClose('pm')
      await openAndClose('worker')

      // 🔴 **The fold is asked of the STORE, which is the thing a launch reads** — three identities,
      // none of them granted anything, all three reaching it.
      for (const slug of [DEFAULT_PROFILE_ID, 'pm', 'worker']) {
        expect(
          store.externalMcpServersFor(slug).map((one) => one.name),
          `${slug} does not reach a server registered as everyone's`,
        ).toEqual(['kibana'])
      }
      // ⛔ **…and a slug no identity has ever run as reaches it too**, which is what *every identity*
      // means and is not an accident: the column is a property of the SERVER, so there is nothing
      // about an identity for this answer to depend on. ⚠️ Existence is `capabilitiesOf`'s question
      // (criterion 12) and a second answer here would be a second place for it to be decided.
      expect(store.externalMcpServersFor('nobody-has-this-name').map((one) => one.name)).toEqual([
        'kibana',
      ])
    })
  })

  // §2 · an identity BroBot creates and nobody opens

  describe('§2 · an identity an AGENT created, with no capabilities and no provider', () => {
    it('🔴 reaches the server with nobody having ticked anything', async () => {
      const kibana = await localMcpServer(['search_logs'])
      await register('kibana', kibana.url, 'everyone')

      // Create the identity through the agent’s door, covering agents that a person never
      // opens. Using `createAgent` would measure the person’s path instead. With no grant
      // set, agents may create profiles by default.
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const made = host.createAgentFor(
        brobot,
        { slug: 'archivist', displayName: null, provider: null },
        { ownerId: `agent:${brobot}` },
        // ⚑ **618 · *no rules* said explicitly** — the parameter is required, so no call site can
        // fall through to a default nobody chose (`a-default-no-call-site-reaches`).
        null,
        // ⚑ **D-042 · R2 · *no default model* said explicitly, the same idiom** — the population
        // the PO named is one created with nothing chosen, so it names no model or effort either.
        null,
      )
      expect(
        made,
        'the identity was not created, so nothing below measures anything',
      ).toMatchObject({ ok: true })

      // ⚑ **The premise, asserted rather than assumed** — no capabilities chosen, no provider named
      // (it keeps its creator's), no grant row, and nobody has opened it.
      const row = host.agentIdentities().identities.find((one) => one.slug === 'archivist')
      expect(row?.provider, 'it keeps the provider of the agent that created it').toBe(
        store.recordedOne(brobot)?.provider,
      )
      expect(row?.externalMcpServerIds).toEqual([])

      // 🔴 **And it reaches the server.** ⛔ This is the assertion `HO-047` exists for: before this
      // ruling the same state cost three manual acts — set a provider, tick, start a conversation —
      // and two of them have gone.
      expect(await handedTo('archivist')).toEqual(['kibana'])
      await host.close(brobot, window)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the narrow half survives, unelaborated
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a RESTRICTED server still works exactly as 516 built it', () => {
    it('⚑ granted reaches, un-granted stops, and the neighbour never moves', async () => {
      const somebodys = await localMcpServer(['drive_browser'])
      const everyones = await localMcpServer(['search_logs'])
      const browser = await register('browser', somebodys.url, 'restricted')
      await register('kibana', everyones.url, 'everyone')
      await openAndClose('worker')
      await openAndClose('pm')

      grant('worker', [browser.id])
      expect(await handedTo('worker')).toEqual(['browser', 'kibana'])
      // ⛔ **One identity holds it and its neighbour does not**, which is `516` §2's whole subject
      // and the one thing `HO-048` §1.1 keeps: *"the mechanism for the exception."*
      expect(await handedTo('pm')).toEqual(['kibana'])

      // ⚑ **Un-ticking takes it away and leaves the other alone** — the save carries the COMPLETE
      // set, so a person who unticked everything and a payload naming nothing are the same act.
      grant('worker', [])
      expect(await handedTo('worker')).toEqual(['kibana'])
    })

    it('🔴 a server that is everyone’s AND separately granted arrives ONCE', async () => {
      // ⛔ **A state the schema admits, not a hypothetical.** The reach and a grant row are two
      // independent facts — a server can be everyone's while an identity still carries a `516`
      // grant of it — so *everyone's and granted* is a shape a real database can hold.
      const clean = await localMcpServer(['search_logs'])
      const row = await register('kibana', clean.url, 'everyone')
      await openAndClose('worker')
      grant('worker', [row.id])
      expect(
        host.agentIdentities().identities.find((one) => one.slug === 'worker')
          ?.externalMcpServerIds,
        'the premise: the grant row was not written',
      ).toEqual([row.id])

      // 🔴 **Once, and the `EXISTS` is what makes that true.** ⚠️ A `JOIN` — which is the shape `516`
      // shipped and this dispatch replaced — returns the row for the reach arm AND for the grant
      // row, and a duplicated server reaches the adapter as two entries under one name.
      expect(await handedTo('worker')).toEqual(['kibana'])
      expect(lastLaunch().externalMcp?.servers).toHaveLength(1)
    })

    it('⛔ a restricted server reaches NOBODY until somebody ticks it', async () => {
      const somebodys = await localMcpServer(['drive_browser'])
      await register('browser', somebodys.url, 'restricted')
      await openAndClose(DEFAULT_PROFILE_ID)
      await openAndClose('worker')
      // ⛔ **`516` §3's sentence, re-asserted against the row it is now true of**: a registration
      // grants nobody. ⚠️ It stopped being true of the default at `HO-048` §1 and is still true here,
      // which is exactly why the narrow half had to keep its own test.
      expect(store.externalMcpServersFor(DEFAULT_PROFILE_ID)).toEqual([])
      expect(store.externalMcpServersFor('worker')).toEqual([])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the vocabulary is closed in the reader, and it closes NARROW
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a value this build cannot read', () => {
    it('🔴 folds to RESTRICTED — the CHECK the column could not afford, bought in the reader', async () => {
      const server = await localMcpServer(['search_logs'])
      const row = await register('kibana', server.url, 'everyone')
      await openAndClose('worker')
      expect(
        await handedTo('worker'),
        'the premise: it reaches before the column is broken',
      ).toEqual(['kibana'])

      // ⛔ **Written straight into the column, which is the only way this state can arise** — the
      // column carries no CHECK (D-016's migration built the table afresh and left the vocabulary to
      // the fold, see `schema.ts`). ⚠️ A hand-edit and a future build's third word are this shape.
      for (const bad of ['EVERYONE', 'everybody', 'all', '']) {
        db.prepare(`UPDATE external_mcp_server SET reach = ? WHERE id = ?`).run(bad, row.id)
        expect(await handedTo('worker'), `"${bad}" widened instead of narrowing`).toEqual([])
      }
      // 🔴 **A NULL is not one of the shapes, and the DATABASE is what says so** — measured here
      // rather than assumed, because the fold's old prose claimed it defended against one. ⛔ The
      // column is `NOT NULL DEFAULT 'everyone'`, so the one unreadable value that CANNOT
      // arrive through this column is the empty one. ⚑ What the fold defends is every other: a typo,
      // a hand-edit, a word a future build writes and this one predates.
      expect(() =>
        db.prepare(`UPDATE external_mcp_server SET reach = NULL WHERE id = ?`).run(row.id),
      ).toThrow(/NOT NULL/)

      // ⚑ **And the pairing**: the exact word still works, so the four refusals above are a fold and
      // not a launch path that stopped carrying servers.
      db.prepare(`UPDATE external_mcp_server SET reach = 'everyone' WHERE id = ?`).run(row.id)
      expect(await handedTo('worker')).toEqual(['kibana'])
    })

    it('🔴 …but the WIRE refuses a third word whole, which is the opposite behaviour on purpose', async () => {
      // ⛔ **The two readings of one vocabulary, tested where they DIVERGE** (standing rule 3). The
      // fold above defends a COLUMN that carries no CHECK and answers `'restricted'` for anything it
      // cannot read; the zod row defends a PAYLOAD and refuses the whole command. ⚑ **They want
      // opposite behaviour and that is the decision**: a row already in the database has to mean
      // something, and a caller this app does not understand has not asked for anything.
      // ⚠️ **The first version of this row OMITTED the field instead of naming a third word**, and
      // `524 M12` caught it: *required* and *closed* are different rules, and a payload with no
      // `reach` at all is refused by `z.string()` exactly as it is by `z.enum`. ⛔ So the row
      // asserted *the field is required* while its own docblock claimed the vocabulary — which is
      // standing rule 19 inside a test. ⚑ **Both are driven now**, and only the first can tell a
      // closed vocabulary from an open one.
      const server = await localMcpServer(['search_logs'])
      const bad = (over: Record<string, unknown>): Parameters<typeof executeRuntimeCommand>[2] =>
        ({
          kind: 'registerExternalMcpServer',
          name: 'kibana',
          url: server.url,
          ...over,
          // ⚠️ Cast because the TYPE already refuses these — which is the point: a word outside the
          // union only arrives from a renderer this build did not compile, and the boundary is what
          // stands there.
        }) as unknown as Parameters<typeof executeRuntimeCommand>[2]

      // 🔴 **A THIRD WORD**, which is the assertion this row exists for. An open `z.string()` takes
      // it, the store folds it to `'restricted'`, and a payload the app did not understand has been
      // acted on rather than refused.
      await expect(
        executeRuntimeCommand(host, window, bad({ reach: 'everybody' })),
      ).rejects.toThrow(/reach/i)
      expect(host.agentIdentities().externalMcpServers, 'a third word registered a server').toEqual(
        [],
      )

      // ⚠️ **…and the field is REQUIRED**, which is a second rule and is not the one above.
      await expect(executeRuntimeCommand(host, window, bad({}))).rejects.toThrow(/reach/i)
      expect(host.agentIdentities().externalMcpServers).toEqual([])

      // ⚑ **The pairing, one fact over allowed**: the same payload with a word the enum names
      // registers, so the refusal above is about the vocabulary and not about the door.
      await executeRuntimeCommand(host, window, {
        kind: 'registerExternalMcpServer',
        name: 'kibana',
        url: server.url,
        reach: 'everyone',
      })
      expect(host.agentIdentities().externalMcpServers.map((one) => one.reach)).toEqual([
        'everyone',
      ])
    })

    it('⚑ …and the fold answers the same way for a value that arrives in JavaScript', () => {
      // ⛔ **The SQL comparison and {@link foldExternalMcpReach} are two implementations of one rule**
      // and this is what keeps them equal — the launch path folds in SQLite, every surface folds
      // here, and a disagreement would mean a sheet drawing a tick-box for a server a launch treats
      // as everyone's.
      expect(foldExternalMcpReach('everyone')).toBe('everyone')
      for (const bad of ['EVERYONE', 'Everyone', 'everybody', '', null, undefined, 7, {}]) {
        expect(foldExternalMcpReach(bad), `${String(bad)} folded wide`).toBe('restricted')
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the widening, enumerated — standing rule 24
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what is newly reachable, and what is still governed', () => {
    it('🔴 nothing about what happens when a tool is CALLED moved', async () => {
      // ⛔ **`HO-048` §1.2, asserted rather than restated in a docblock**: *"An available-to-all
      // server is still governed by the permission a person answers, and still refused whole if it
      // collides with one of our verb names. This ruling changes who gets OFFERED a tool. It changes
      // nothing about what happens when one is CALLED."*
      const ours = TOOL_NAMES[0]
      const colliding = await localMcpServer(['search_logs', ours])
      // ⚑ **Registered as EVERYONE'S**, which is the arm this dispatch created: the refusal has to
      // hold on the wide row, not only on the narrow one `516` measured.
      await expect(register('bad', colliding.url, 'everyone')).rejects.toThrow(new RegExp(ours))
      expect(host.agentIdentities().externalMcpServers).toEqual([])

      // ⛔ **And the reserved roster still travels with the servers** — it is what the adapter derives
      // Claude's `disallowedTools` from, and it is not conditioned on how a server was registered.
      const clean = await localMcpServer(['search_logs'])
      await register('kibana', clean.url, 'everyone')
      await openAndClose('worker')
      await openAndClose('worker')
      expect(lastLaunch().externalMcp?.reservedToolNames).toEqual(TOOL_NAMES)
    })

    // 🔴 **RE-AIMED at `605`.** ⛔ This said *it reaches no CODEX conversation*, on `HO-042` §3.
    // ⚑ The PO withdrew that ruling (`HO-090` §1) and `605` measured the reach on the wire, so
    // the row keeps its subject — *an everyone's server reaches BOTH providers' conversations* —
    // and reverses its verdict on the arm that moved.
    it('⛔ an EVERYONE’S server reaches a CODEX conversation too', async () => {
      const clean = await localMcpServer(['search_logs'])
      await register('kibana', clean.url, 'everyone')
      await openAndClose('worker', 'codex')
      expect(lastLaunch().provider).toBe('codex')
      expect(lastLaunch().hasField, 'a Codex launch was handed external servers').toBe(true)
      expect(lastLaunch().externalMcp?.servers.map((one) => one.name)).toEqual(['kibana'])

      // ⚑ **The pairing, on the same identity and the same registration**: both arms get it, which
      // is what *everyone's* was ruled to mean (`HO-048` §1).
      expect(await handedTo('worker', 'claude')).toEqual(['kibana'])
      expect(capabilitiesFor('codex').externalMcpServers.state).toBe('available')
      expect(capabilitiesFor('claude').externalMcpServers.state).toBe('available')

      // ⛔ **And the reserved roster travels on BOTH**, because it is derived from the app's own
      // inventory and not from the provider. ⚠️ **What each adapter can DO with it differs** —
      // Claude turns it into `disallowedTools`, Codex has no deny vocabulary to turn it into
      // anything — and `605`'s response says so rather than letting this line imply parity.
      expect(lastLaunch().externalMcp?.reservedToolNames).toEqual(TOOL_NAMES)
    })

    it('⛔ …and no conversation with no identity at all', async () => {
      // ⚠️ **`externalMcpContext` answers `{}` for a null slug and 524 did NOT widen that.** An
      // available-to-all server is available to every IDENTITY; an adopted conversation is running
      // as nobody, and handing tool servers to a row whose owner this app cannot name is not what
      // *everyone's* means. ⛔ Asserted at the source of the answer, because no door in this build
      // can produce an adopted row synchronously.
      const clean = await localMcpServer(['search_logs'])
      await register('kibana', clean.url, 'everyone')
      const source = readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8')
      expect(source).toContain('if (profileSlug === null) return {}')
      // ⚑ The pairing: the same function DOES answer for a slug, so the line above is a guard and
      // not a function that never returns anything.
      expect(store.externalMcpServersFor('worker').map((one) => one.name)).toEqual(['kibana'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the sentence the ruling owes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the words', () => {
    it('⚑ the disclosure `HO-048` §2 owes exists, says what it widens, and gates nothing', () => {
      // ⛔ **Standing rule 5: a safety sentence with no test is a comment.** ⚠️ The load-bearing
      // clauses are named one at a time, so a reword that dropped one cannot pass on the others.
      expect(EXTERNAL_MCP_EVERYONE_MEANS).toContain('Every agent in this app')
      expect(EXTERNAL_MCP_EVERYONE_MEANS).toContain(
        'agents that other agents create and whose conversations you never open',
      )
      expect(EXTERNAL_MCP_EVERYONE_MEANS).toContain('yolo')
      // 🔴 **And it does NOT say *reaches*, which would be false on one of the two providers** and is
      // read before any provider is fixed — see the constant's own docblock for the measurement.
      expect(EXTERNAL_MCP_EVERYONE_MEANS).not.toMatch(/reach/i)
    })

    it('⛔ …and the claim that a server’s reach CANNOT be edited is enforced, not asserted', () => {
      // 🔴 **`EXTERNAL_MCP_REACH_IS_FIXED` is a sentence a person reads before a press they cannot
      // undo**, so standing rule 5 applies to it in full. ⚑ **The enforcement is `516`'s and it was
      // inherited rather than rebuilt**: `one-local-server-one-identity.test.ts` §3 censuses the
      // ABSENCE of any `UPDATE external_mcp_server` and of any save verb on the wire, which is a
      // rule about the ROW and therefore already about this column. ⛔ What is asserted here is that
      // the sentence and that census are about the same act.
      expect(EXTERNAL_MCP_REACH_IS_FIXED).toContain('cannot be edited afterwards')
      expect(EXTERNAL_MCP_REACH_IS_FIXED).toContain('remove it and add it again')
      const store = readFileSync(join(here, '../src/main/db/session-store.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      // ⚑ **The positive control first** — without it an empty read passes the negative below.
      expect(store).toContain('INSERT OR IGNORE INTO external_mcp_server')
      expect(store).not.toMatch(/UPDATE\s+external_mcp_server/i)
    })
  })
})
