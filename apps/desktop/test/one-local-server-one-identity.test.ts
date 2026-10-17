import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  FakeProviderSessions,
  FakeRuntime,
  capabilitiesFor,
  type ExternalMcpReach,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
// ⚑ **The adapter's own two functions, by path** — `two-verbs-one-sentence.test.ts`'s idiom, and
// for its reason: these are Claude's half and are not on the package's neutral surface.
import {
  claudeMcpServersFor,
  forbiddenExternalSpellings,
} from '../../../packages/runtime/src/claude/agent-tools'
import type { Provider } from '@brobot2/shared'
import type { ExternalMcpServerRow } from '../src/shared/external-mcp'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { composeProfileBundle, type InstructionContext } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { AGENT_TOOL_SERVER, TOOL_NAMES } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand, noPersonBehindIt } from '../src/main/runtime/ipc'
import { CAPABILITY_FIELDS, type CapabilityGrant } from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { EXTERNAL_MCP_REMOVAL_MEANS, externalMcpServerRowId } from '../src/shared/external-mcp'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * One local server is bound to one identity and one provider.
 *
 * > ⚑ *"For actual real work, I need to give some mcp tools to brobot and the agents… an interface
 * > where I can add a new mcp server (by its local unauthenticated url) and then all the agents can
 * > see it."*
 *
 * ⛔ **"All the agents" became *register once, grant per identity*** (HO-040 §4.2) — *"this is the
 * part that makes focused identities genuinely specialised rather than differently named"* — so
 * §2's whole subject is one identity holding a server and its neighbour not holding it, in one
 * sample.
 *
 * ## ⛔ A REAL local MCP server, twice, because the rail is a HANDSHAKE
 *
 * ⚠️ **The refusal HO-040 §4.3 ruled cannot be measured against a fake.** *"No external server's
 * tools may arrive under a name that collides with one of ours"* — and the only way this app learns
 * what a server publishes is to ask it. ⚑ So §1 stands up two reference-implementation servers that
 * differ **in exactly one tool name**, puts both through the real door, and reads the two answers in
 * one sample (standing rule 3).
 *
 * ⛔ **Each server gets its own kernel-assigned port on `127.0.0.1`, in THIS process** — its own
 * free port and its own pid by construction.
 *
 * ## ⚑ Real host, real SQLite ledger, real migrations, real rails
 *
 * The only doubles are the provider adapter and the MCP server a person would have started
 * themselves.
 */

/* ────────────────────────────────────────── a real local MCP server, for the length of a test */

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
  kind: 'start' | 'resume'
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
  private note(kind: 'start' | 'resume', options: StartOptions | ResumeOptions): void {
    this.launches.push({
      kind,
      provider: this.provider,
      externalMcp: options.externalMcp,
      hasField: 'externalMcp' in options,
    })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.note('start', options)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    this.note('resume', options)
    return handle
  }
}

/**
 * ⚠️ **A grant that changes NO capability**, so every save in this file is about the servers and
 * nothing else. ⛔ **Derived from `CAPABILITY_FIELDS`** rather than typed out: a tenth capability
 * must not silently drop out of this literal, which would make every save here narrow a field it
 * never meant to touch.
 */
const NOTHING_CHOSEN = Object.fromEntries(
  CAPABILITY_FIELDS.map((field) => [field.key, null]),
) as unknown as CapabilityGrant

describe('516 · one local server, one identity', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let launches: Launched[]
  let seen: InstructionContext[]
  let counter: number
  let window: Sink
  let clock: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
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

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-516-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-516-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_000_000
    store = createSessionStore(db, tick)
    counter = 0
    launches = []
    seen = []
    sessions = new FakeProviderSessions()
    host = buildHost()
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

  /** ⚑ The grant one identity holds, as the SHEET reads it back. */
  const grantedTo = (slug: string): readonly string[] =>
    host.agentIdentities().identities.find((one) => one.slug === slug)?.externalMcpServerIds ?? []

  /** ⛔ Tick a set of servers on one identity, through the door a person's Save goes through. */
  const grant = (slug: string, serverIds: readonly string[]): void => {
    expect(host.setCapabilities(slug, NOTHING_CHOSEN, serverIds)).not.toBeNull()
  }

  const registeredNames = (): string[] =>
    host.agentIdentities().externalMcpServers.map((one) => one.name)

  /**
   * 🔴 **524 · every registration in THIS file is `'restricted'`, and that is what the file now is**
   * (`HO-048` §1.1, §4 obligation 4).
   *
   * ⛔ **`516` was written when per-identity grants were the only model.** `HO-048` §1 withdrew that
   * default — *"is this server everyone's? is a property of the server"* — and made the grant table
   * *"exactly what it should always have been: the mechanism for the exception"*, with *"do not
   * elaborate it"* beside it. ⚑ **So this suite became the POSITIVE CONTROL for the narrow half**:
   * every assertion below — the collision rail, *a registration grants nobody*, the tick, the
   * cascade, the Codex arm — is re-run unchanged against a restricted server, and every one of them
   * still holds.
   *
   * ⚠️ **It is a helper and not a default, deliberately.** The door REQUIRES the field; the product's
   * default lives on the registration form, and `a-server-the-workspace-has.render.test.ts` is what
   * pins it. ⛔ A `reach?: … = 'restricted'` on the host would have made this file's premise
   * invisible and put a second copy of the ruling one argument away from the first.
   */
  const registerRestricted = (said: { name: string; url: string }): Promise<ExternalMcpServerRow> =>
    host.registerExternalMcpServer({ ...said, reach: 'restricted' })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the refusal rail, against two real servers, in one sample
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a colliding server is refused and a non-colliding one is admitted', () => {
    it('🔴 both answers in ONE sample, from two servers one tool name apart', async () => {
      // ⛔ **The two fixtures differ in exactly ONE name**, which is standing rule 3's *"the same
      // call one fact over allowed"*: anything else and the pairing would be measuring the
      // difference between two unrelated servers.
      const ours = TOOL_NAMES[0]
      const colliding = await localMcpServer(['search_issues', ours])
      const clean = await localMcpServer(['search_issues', 'create_issue'])

      await expect(registerRestricted({ name: 'bad', url: colliding.url })).rejects.toThrow(
        new RegExp(ours),
      )
      const admitted = await registerRestricted({ name: 'jira', url: clean.url })

      expect(admitted.name).toBe('jira')
      expect(admitted.url).toBe(clean.url)
      // ⛔ **The refused one left NOTHING behind**, which is the half a refusal message cannot show:
      // *refuse the server* means the row is not written, not that it is written and ignored.
      expect(registeredNames()).toEqual(['jira'])
    })

    it('⛔ a one-character rename is the SAME collision — both sides are folded', async () => {
      // 🔴 **The rail is about a NAME the model would learn, and a model cannot tell `Give_Work`
      // from `give_work`** (HO-040 §4.3: *"a model cannot be expected to tell them apart"*).
      // ⛔ A comparison that folded only our side would let a capitalisation walk straight past the
      // one rail this build has.
      const shouty = await localMcpServer([TOOL_NAMES[0]!.toUpperCase()])
      await expect(registerRestricted({ name: 'shouty', url: shouty.url })).rejects.toThrow(
        /already governs/,
      )
      // ⚑ **The pairing, one fact over**: a name that merely LOOKS like one of ours is admitted, so
      // the fold is a fold rather than a substring match.
      const near = await localMcpServer([`${TOOL_NAMES[0]!}_v2`])
      expect((await registerRestricted({ name: 'near', url: near.url })).name).toBe('near')
    })

    it('⛔ the refusal names the tools, so a person can act on it', async () => {
      // ⚑ **Two of OUR names, read from `TOOL_NAMES` rather than typed**, offered in the reverse of
      // the order the refusal names them — so the sentence is shown to list them in its own order
      // (sorted), not to echo the server's.
      const ours: string[] = [...TOOL_NAMES.slice(0, 2)].sort()
      const server = await localMcpServer([...[...ours].reverse(), 'search_issues'])
      await expect(registerRestricted({ name: 'bad', url: server.url })).rejects.toThrow(
        new RegExp(ours.join(', ')),
      )
      // ⚑ **And it says what to do** — `425`'s rule: a refusal a person cannot act on is a wall.
      await expect(registerRestricted({ name: 'bad', url: server.url })).rejects.toThrow(
        /Rename them on the server/,
      )
    })

    it('⛔ `brobot` is reserved, and a name one letter over is admitted in the same sample', async () => {
      // ⚑ **`AGENT_TOOL_SERVER`, read rather than typed** — `466` owns the word, and a literal here
      // would be a second authority on the one name that must never be taken.
      const server = await localMcpServer(['search_issues'])
      await expect(
        registerRestricted({ name: AGENT_TOOL_SERVER, url: server.url }),
      ).rejects.toThrow(/reserved/)
      // ⛔ **Folded before it is compared**, so the reservation cannot be walked around with a
      // capital letter — `Brobot` and `brobot` are one name.
      await expect(registerRestricted({ name: 'BroBot', url: server.url })).rejects.toThrow(
        /reserved/,
      )
      expect((await registerRestricted({ name: 'brobot2', url: server.url })).name).toBe('brobot2')
    })

    it('⛔ `__` is forbidden, and ONE underscore is admitted in the same sample', async () => {
      // 🔴 **`507` F4**: `tool-inventory.ts` splits a qualified name at the FIRST `__`, so
      // `work__browser` reads as server `work` with a tool called `browser__…`. ⚠️ The pairing is
      // what makes this a rule about two adjacent underscores rather than about the alphabet.
      const server = await localMcpServer(['search_issues'])
      await expect(registerRestricted({ name: 'work__browser', url: server.url })).rejects.toThrow(
        /separate a server from its tools/,
      )
      expect((await registerRestricted({ name: 'work_browser', url: server.url })).name).toBe(
        'work_browser',
      )
    })

    it('⛔ a URL that is not loopback, or carries a credential, is refused', async () => {
      const server = await localMcpServer(['search_issues'])
      await expect(
        registerRestricted({ name: 'remote', url: 'http://example.com/mcp' }),
      ).rejects.toThrow(/not on this machine/)
      await expect(
        registerRestricted({ name: 'creds', url: 'http://me:pw@127.0.0.1:8765/mcp' }),
      ).rejects.toThrow(/username or password/)
      // ⚑ **The pairing**: the same door, one fact over, admits the local one.
      expect((await registerRestricted({ name: 'local', url: server.url })).name).toBe('local')
      expect(registeredNames()).toEqual(['local'])
    })

    it('⚠️ a server that could not be asked is NOT PERFORMED, and nothing is registered', async () => {
      // 🔴 **Standing rule 13, and the distinction is load-bearing.** A server that answers an empty
      // roster has no collision and REGISTERS; one that cannot be asked has not been found clean,
      // and registering it would be this app inferring a fact it never measured.
      await expect(
        registerRestricted({ name: 'down', url: 'http://127.0.0.1:9/mcp' }),
      ).rejects.toThrow(
        "Couldn't reach the server at http://127.0.0.1:9/mcp. Check that it's running and try again.",
      )
      expect(registeredNames()).toEqual([])
    })

    it('⛔ a name already registered is refused by NAME, and the first row is untouched', async () => {
      const first = await localMcpServer(['search_issues'])
      const second = await localMcpServer(['create_issue'])
      await registerRestricted({ name: 'jira', url: first.url })
      await expect(registerRestricted({ name: 'jira', url: second.url })).rejects.toThrow(
        /already a server called jira/,
      )
      expect(host.agentIdentities().externalMcpServers.map((one) => one.url)).toEqual([first.url])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the live case — a person types a URL, ticks one identity, and Claude gets the server
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the granted identity gets it and its neighbour does not', () => {
    it('🔴 both halves in ONE sample, on a real launch', async () => {
      const server = await localMcpServer(['search_issues'])
      // 1 · the identities exist, because a grant may not create one (criterion 12).
      await openAndClose(DEFAULT_PROFILE_ID)
      await openAndClose('worker')

      // 2 · a person registers the server, once, globally.
      const row = await registerRestricted({ name: 'jira', url: server.url })
      expect(row.id).toBe(externalMcpServerRowId('jira'))

      // 3 · ⛔ **and grants it to ONE identity**, which is the word the PO changed.
      grant('worker', [row.id])
      expect(grantedTo('worker')).toEqual([row.id])
      expect(grantedTo(DEFAULT_PROFILE_ID)).toEqual([])

      // 4 · 🔴 the launch the person then makes carries it…
      await personOpens('worker')
      const granted = lastLaunch()
      expect(granted.externalMcp?.servers).toEqual([{ name: 'jira', url: server.url }])
      // ⛔ **…and the roster travels with it**, because the adapter derives the deny vocabulary from
      // it and `packages/runtime` cannot see `TOOL_NAMES`.
      expect(granted.externalMcp?.reservedToolNames).toEqual([...TOOL_NAMES])

      // 5 · ⚑ **the control, in the same sample**: the identity nobody ticked is handed NOTHING —
      //     and the field is absent rather than empty, so its launch is what it was before `516`.
      await personOpens(DEFAULT_PROFILE_ID)
      expect(lastLaunch().hasField).toBe(false)
      expect(lastLaunch().externalMcp).toBeUndefined()

      // 6 · 🔴 **and what Claude is actually handed, through the product's own two functions.** A
      //     second spelling of the union here would be this test's idea of the launch rather than
      //     the launch.
      const servers = claudeMcpServersFor(
        { server: AGENT_TOOL_SERVER, tools: [] },
        granted.externalMcp?.servers ?? [],
      )
      expect(servers).toEqual({ jira: { type: 'http', url: server.url } })
      expect(forbiddenExternalSpellings(granted.externalMcp)).toContain(
        `mcp__jira__${TOOL_NAMES[0]}`,
      )
    })

    it('⛔ a REOPEN carries it too — for Claude that is the only way it comes back', async () => {
      const server = await localMcpServer(['search_issues'])
      const sessionId = await personOpens('worker')
      await host.close(sessionId, window)
      const row = await registerRestricted({ name: 'jira', url: server.url })
      grant('worker', [row.id])

      await host.resumeSession(sessionId, window)
      const reopened = lastLaunch()
      expect(reopened.kind).toBe('resume')
      expect(reopened.externalMcp?.servers).toEqual([{ name: 'jira', url: server.url }])
    })

    it('⛔ …and a grant REMOVED while the conversation was closed does not come back', async () => {
      // ⚑ **Standing rule 11's direction, one table over**: a reopen re-resolves from the row rather
      // than from what the launch was given, so a person's narrowing reaches the next life.
      const server = await localMcpServer(['search_issues'])
      const row = await registerRestricted({ name: 'jira', url: server.url })
      await openAndClose('worker')
      grant('worker', [row.id])
      const sessionId = await personOpens('worker')
      expect(lastLaunch().externalMcp?.servers).toHaveLength(1)
      await host.close(sessionId, window)

      grant('worker', [])
      await host.resumeSession(sessionId, window)
      expect(lastLaunch().hasField).toBe(false)
    })

    // 🔴 **RE-AIMED at `605`, and the ruling it tested is WITHDRAWN.** ⛔ This asserted that a
    // Codex launch is handed nothing, on `HO-042` §3 — *"a card that cannot name its subject
    // cannot meet criterion 20"*. ⚑ The PO withdrew that (`HO-090` §1), `605` built the card and
    // measured the reach end to end, so the SUBJECT is unchanged — *what does a Codex launch get,
    // and does the declaration say the same thing* — and every expectation flipped with the world.
    it('🔴 a CODEX launch is handed the grant, and the declaration says the same', async () => {
      const server = await localMcpServer(['search_issues'])
      const row = await registerRestricted({ name: 'jira', url: server.url })
      await openAndClose('worker', 'codex')
      grant('worker', [row.id])

      await personOpens('worker', 'codex')
      expect(lastLaunch().provider).toBe('codex')
      expect(lastLaunch().hasField, 'a Codex launch is handed its identity’s servers').toBe(true)
      expect(lastLaunch().externalMcp?.servers).toEqual([{ name: 'jira', url: server.url }])

      // ⚑ **The GRANT itself is still not destroyed by moving the identity** — `HO-037` §1's
      // *tell, don't clamp*, which `516` pinned while one provider was held back. ⚠️ **The reason
      // it was written is withdrawn and the PROPERTY is not**: a grant is a durable fact about an
      // identity and an identity's provider is a mutable default, so nothing about a launch may
      // rewrite the row. ⛔ Kept rather than deleted with its framing — never remove an assertion
      // because the sentence above it went stale (rule 26).
      expect(grantedTo('worker')).toEqual([row.id])

      // ⚑ **The same identity on the other provider gets the same servers**, which is what makes
      // the line above a fact about the GRANT rather than about one adapter.
      await personOpens('worker', 'claude')
      expect(lastLaunch().externalMcp?.servers).toHaveLength(1)

      // ⛔ **The CONTROL, in the same sample** (rule 12): an identity nobody granted anything is
      // handed no field at all, on the same provider, through the same door. Without it a launch
      // that handed EVERY identity EVERY server would pass the assertions above.
      await openAndClose('other', 'codex')
      await personOpens('other', 'codex')
      expect(lastLaunch().provider).toBe('codex')
      expect(lastLaunch().hasField, 'an identity with no grant is handed nothing').toBe(false)

      // ⛔ **And the DECLARATION both readers share carries the sentence a person is shown** —
      // standing rule 5: a safety sentence with no test is a comment. ⚑ `available` on BOTH now,
      // and each says what its own provider does with a server rather than what it cannot do.
      const codex = capabilitiesFor('codex').externalMcpServers
      expect(codex.state).toBe('available')
      expect(codex.state === 'available' ? (codex.note ?? '') : '').toContain(
        'names the server and not the call',
      )
      // 🔴 **723 · R80 — and the clauses a person decides on, by name** (review: a safety sentence
      // with no test is a comment). ⚑ Each was measured by `probe:codex-mcp-tool-approval`; a Codex
      // bump that moves one must move this sentence with it.
      for (const clause of [
        'Codex asks before one of them runs',
        'naming the server, the tool and what it is given',
        'which Codex runs without asking',
        'as it runs every tool in a conversation that does not ask',
      ]) {
        expect(codex.state === 'available' ? (codex.note ?? '') : '', clause).toContain(clause)
      }
      // ⛔ …and never the sentence R80 corrected.
      expect(codex.state === 'available' ? (codex.note ?? '') : '').not.toContain('asks nothing')
      // ⚠️ **The pair, in the same sample**: two `available` entries that say DIFFERENT things, so
      // the fold that renders them is measured where the two readings diverge (rule 3).
      const claude = capabilitiesFor('claude').externalMcpServers
      expect(claude.state).toBe('available')
      expect(claude.state === 'available' ? (claude.note ?? '') : '').not.toBe(
        codex.state === 'available' ? (codex.note ?? '') : '',
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · registering grants nobody, the URL cannot move, and removal takes the grants with it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the registry’s own rules', () => {
    it('⚑ a registration grants NOBODY — every identity holds it only after a tick', async () => {
      const server = await localMcpServer(['search_issues'])
      await openAndClose(DEFAULT_PROFILE_ID)
      await openAndClose('worker')
      const row = await registerRestricted({ name: 'jira', url: server.url })

      // ⛔ **The row exists and nobody reaches it** — HO-040 §4.2's split, measured.
      expect(registeredNames()).toEqual(['jira'])
      for (const identity of host.agentIdentities().identities) {
        expect(identity.externalMcpServerIds, identity.slug).toEqual([])
      }
      await personOpens('worker')
      expect(lastLaunch().hasField).toBe(false)

      grant('worker', [row.id])
      await personOpens('worker')
      expect(lastLaunch().externalMcp?.servers).toHaveLength(1)
    })

    it('⛔ removing a server takes every grant with it, and the rail sees the difference', async () => {
      const server = await localMcpServer(['search_issues'])
      await openAndClose('worker')
      const row = await registerRestricted({ name: 'jira', url: server.url })
      grant('worker', [row.id])
      await personOpens('worker')
      expect(lastLaunch().externalMcp?.servers).toHaveLength(1)

      expect(host.removeExternalMcpServer(row.id)).toBe(true)
      expect(registeredNames()).toEqual([])
      // 🔴 **The cascade, read back from the identity rather than from the schema.** A grant naming
      // a row that is gone would be a tick-box with nothing behind it and a launch resolving half a
      // server.
      expect(grantedTo('worker')).toEqual([])
      await personOpens('worker')
      expect(lastLaunch().hasField).toBe(false)

      // ⚑ **And the sentence a person reads BEFORE the press says so** — the immutable URL makes
      // remove-and-add the only way to change an address, so the cascade is on the path they walk.
      expect(EXTERNAL_MCP_REMOVAL_MEANS).toContain('every identity that was granted it')
      // ⚠️ **`false` is *it was already gone* and is not an error** — a second press, or another
      // window's, asks for a state that already holds.
      expect(host.removeExternalMcpServer(row.id)).toBe(false)
    })

    it('⛔ there is no way to EDIT a registered server — the absence is the rule', () => {
      // 🔴 **`HO-042` §6 endorsed the immutable URL by name**: *"a mutable URL would let one global
      // row silently retarget every identity that already trusted it."* ⚑ The enforcement is that
      // no `UPDATE external_mcp_server` statement exists anywhere and no wire verb asks for one.
      //
      // ⚑ **524 · it now holds TWO facts still, and the second arrived without touching this test.**
      // `HO-048` §1 put `reach` on this row, and because the enforcement is *no UPDATE on this
      // table* rather than *no UPDATE of this column*, the new fact inherited the rule the day it
      // was added. ⚠️ `EXTERNAL_MCP_REACH_IS_FIXED` is the sentence a person reads before the press,
      // and the verb list below grew the reach-shaped spelling so a future save verb meets this
      // census under either name.
      //
      // ⚠️ **Prose stripped first**, because this file and the store both DISCUSS the rule — a
      // census that cannot tell a warning about a hazard from the hazard is one that gets deleted
      // the first time it fires on a docblock.
      const strip = (text: string): string =>
        text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      const store = strip(readFileSync(join(srcRoot, 'main/db/session-store.ts'), 'utf8'))
      const wire = strip(readFileSync(join(srcRoot, 'shared/runtime-ipc.ts'), 'utf8'))
      // ⛔ **The positive control first**: without it an empty read passes every negative below.
      expect(store).toContain('INSERT OR IGNORE INTO external_mcp_server')
      expect(wire).toContain('registerExternalMcpServer')

      expect(store).not.toMatch(/UPDATE\s+external_mcp_server/i)
      for (const verb of [
        'saveExternalMcpServer',
        'editExternalMcpServer',
        'setExternalMcpUrl',
        'setExternalMcpReach',
      ]) {
        expect(wire, `${verb} would make a registered server mutable`).not.toContain(verb)
        expect(store, `${verb} would make a registered server mutable`).not.toContain(verb)
      }
    })

    it('🔴 a grant survives a restart — a NEW store object over the same ledger', async () => {
      const server = await localMcpServer(['search_issues'])
      await openAndClose('worker')
      const row = await registerRestricted({ name: 'jira', url: server.url })
      grant('worker', [row.id])

      // ⚠️ **A new STORE, not just a new host** — the statements are prepared on the store, so one
      // that outlived the restart would be the object under test answering for itself
      // (`a-next-launch-test-needs-its-own-store-object`).
      await host.closeAll()
      store = createSessionStore(db, tick)
      host = buildHost()

      expect(registeredNames()).toEqual(['jira'])
      expect(grantedTo('worker')).toEqual([row.id])
      await personOpens('worker')
      expect(lastLaunch().externalMcp?.servers).toEqual([{ name: 'jira', url: server.url }])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · what a fresh install holds, and what no migration writes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · both tables start EMPTY, and no migration seeds either', () => {
    it('⛔ a migrated database holds no registered server and no grant', () => {
      // ⚑ **There is no built-in `brobot` row and there never will be** (`507` §2.3): this app's own
      // in-process server is product plumbing with no URL to store. ⚠️ That is what makes
      // `clean-base`'s sentence — *no external MCP servers and no grants* — a fact rather than a
      // hope.
      const count = (table: string): number =>
        (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
      expect(count('external_mcp_server')).toBe(0)
      expect(count('external_mcp_server_grant')).toBe(0)
    })

    it('⛔ no migration writes a row into either table — a census, with its control', () => {
      // ⚠️ **Prose stripped**, so a migration's own header — which may discuss a seed it does not
      // write — cannot answer for a statement (`a-source-census-must-strip-prose-before-it-asserts`).
      const files = readdirSync(migrationsFolder)
        .filter((name) => name.endsWith('.sql'))
        .map((name) => ({
          name,
          sql: readFileSync(join(migrationsFolder, name), 'utf8').replace(/^\s*--.*$/gm, ' '),
        }))
      // ⛔ **The positive control the negative needs** (standing rule 4): the census really reads
      // the file that creates the tables — since D-016 the one migration, `0000_the_tree.sql` — so an
      // empty or mis-pathed read cannot pass it.
      expect(
        files
          .filter((one) => /CREATE TABLE `external_mcp_server`/.test(one.sql))
          .map((o) => o.name),
      ).toEqual(['0000_the_tree.sql'])
      const writesARegistryRow = /INSERT\s+(OR\s+\w+\s+)?INTO\s+`?external_mcp_server/i
      for (const one of files) {
        expect(one.sql, `${one.name} writes a registry row`).not.toMatch(writesARegistryRow)
      }
      // ⚑ **And the pattern really fires** on the statement it is looking for, bare and with a
      // conflict clause, so the negative above is a measurement rather than a regex nothing matches.
      expect('INSERT INTO `external_mcp_server` (`id`) VALUES (1)').toMatch(writesARegistryRow)
      expect('INSERT OR IGNORE INTO external_mcp_server_grant VALUES (1)').toMatch(
        writesARegistryRow,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the door itself — a person's, and nobody else's
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · both registry verbs are refused unless a person is asking', () => {
    /** ⛔ A sink that declares nothing — every channel but a window (349). */
    class Anonymous implements RuntimeEventSink {
      readonly aPersonIsBehindIt = false
      readonly alive = true
      constructor(readonly ownerId: string) {}
      send(): void {}
      sendLiveness(): void {}
    }

    it('🔴 refused on a channel with nobody behind it, and ALLOWED on the window, at one moment', async () => {
      // ⛔ **`requireAPerson`, with `setCapabilities` as the precedent** (355, 349). ⚠️ **Not because
      // a registry row is a capability** — it is not, and it grants nobody — but because this door
      // decides what an agent may be GIVEN, and HO-005's *"the human is unrestricted"* is a
      // statement about a HUMAN.
      const server = await localMcpServer(['search_issues'])
      const add = {
        kind: 'registerExternalMcpServer' as const,
        name: 'jira',
        url: server.url,
        // ⚑ **524 · the field is on the PAYLOAD, so this stays a test about the PERSON rail.** ⛔
        // Without it `executeRuntimeCommand` refuses at the zod row instead, and both halves of this
        // pairing would go red for a reason that has nothing to do with who is asking — a refusal
        // measured one door earlier than the one it names.
        reach: 'restricted' as const,
      }
      await expect(executeRuntimeCommand(host, new Anonymous('mcp:someone'), add)).rejects.toThrow(
        noPersonBehindIt('registerExternalMcpServer'),
      )
      // ⚑ **The pair, and it is what stops this passing over a broken verb.** The same payload on
      // the window's sink registers.
      const row = (await executeRuntimeCommand(host, window, add)) as { id: string }
      expect(registeredNames()).toEqual(['jira'])

      const remove = { kind: 'removeExternalMcpServer' as const, serverId: row.id }
      await expect(
        executeRuntimeCommand(host, new Anonymous('mcp:someone'), remove),
      ).rejects.toThrow(noPersonBehindIt('removeExternalMcpServer'))
      // ⛔ **The refusal left the row standing**, which is the half the sentence cannot show.
      expect(registeredNames()).toEqual(['jira'])
      expect(await executeRuntimeCommand(host, window, remove)).toBe(true)
      expect(registeredNames()).toEqual([])
    })

    it('⚠️ …and the sentence names the verb, so a log says what was missing', () => {
      for (const verb of ['registerExternalMcpServer', 'removeExternalMcpServer'] as const) {
        expect(noPersonBehindIt(verb)).toContain('a person is asking')
        expect(noPersonBehindIt(verb)).toContain(verb)
      }
    })
  })
})
