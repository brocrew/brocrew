import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type StartOptions,
} from '@brobot2/runtime'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import { codexDynamicToolsFor } from '../../../packages/runtime/src/codex/agent-tools'
import type { Provider } from '@brobot2/shared'
import type { SessionInstructions } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **456 · two verbs that both said *create*, and the run that died on it.**
 *
 * ## ⛔ What it cost, measured — `445` F2, from the first Claude arm's own ledger
 *
 * ⚠️ **BroBot held `canCreateAgents: 'any'` and took five attempts to delegate**: `create_agent` →
 * `malformed-request`, `message_agent` → `no-such-agent`, `create_agent` → `agent-name-taken`,
 * `message_agent` → `no-such-agent`, then `ToolSearch` and `spawn_agent` ✔. ⛔ **The project manager
 * beside it, holding no creation grant, called `create_agent` once, met `may-not-create-agents`,
 * and handed the work back.** The diagram died at row 4 with nineteen rows NOT REACHED.
 *
 * ⚑ **What turned BroBot was a refusal that happens to disclose existence** — `agent-name-taken`.
 * ⛔ **`341`'s ordering is entitlement before existence and is not to be touched**, so the grantless
 * caller can never be told that by a refusal. 🔴 **Which is why every assertion below is about what
 * a caller is told BEFORE it calls anything.**
 *
 * ## ⚠️ Three surfaces, all spending the same word on the same side
 *
 * | surface | what it said | which verb it gates |
 * |---|---|---|
 * | `spawn_agent`'s description | *"**Create** another agent."* | itself |
 * | `canSpawn`'s label, rendered into every agent's bundle | *"May **create** agents as"* | `spawn_agent` |
 * | `canCreateAgents`' label | *"May add new agents"* | `create_agent` |
 *
 * ⛔ **So the word `create` was on `spawn_agent`'s side twice and on `create_agent`'s side only in
 * its NAME** — and the project manager's own instructions read, two lines apart:
 *
 * > `- May create agents as: login-explorer`
 * > `- May add new agents: none`
 *
 * ⚑ **It then called `create_agent` with `login-explorer`.** It took the value off the line labelled
 * *create* and handed it to the tool named *create*, and the line below had already told it that
 * tool was closed. 🔴 **Its grant sheet had named the identity it was allowed to start.**
 *
 * ## ⚑ D-016 · the pair is `give_work` and `create_agent` now
 *
 * ⛔ `spawn_agent` is gone: a conversation is started by the first piece of work given to an agent,
 * and `give_work` is the verb beside `create_agent`. ⚑ Every assertion below is re-aimed at it — the
 * two sentences still part on what each verb makes, and what makes one is still asked before any
 * call.
 */
describe('456 · two verbs, one sentence', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let handed: AgentToolset[]
  let counter: number
  let window: Sink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-456-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-456-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new WatchingRuntime(provider, handed, sessions),
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
      readInstructions: () => ({
        instructions: NOTHING_INJECTED,
        systemHint: undefined,
        memoryLoaded: null,
      }),
    })
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  /** ⚑ The toolset a model on BroBot's own conversation would be handed. */
  const brobotsTools = async (): Promise<AgentToolset> => {
    await host.createSession(
      { provider: 'codex', profileId: DEFAULT_PROFILE_ID, cwd: work, approvalMode: 'ask' },
      window,
    )
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no launch was handed a toolset')
    return one
  }

  /**
   * ⚑ **532 · the toolset a model on a PROJECT MANAGER's conversation is handed.**
   *
   * ⛔ **Nothing is granted here, and that is still the whole point.** ⚠️ **Every `setCapabilities`
   * call in this file is aimed at {@link DEFAULT_PROFILE_ID}**; nothing writes a capability column
   * on this row.
   *
   * 🔴 **584 · the row is CREATED here, because a fresh install no longer has one**
   * (`HO-078` §1). ⚑ **D-014 · and it is created with nothing said but its name**: there are no
   * roles and no category templates any more, so every agent reads the one default set — which is
   * the state a person gets at the creation door.
   */
  const projectManagersTools = async (): Promise<AgentToolset> => {
    host.createAgent({
      slug: PROJECT_MANAGER_PROFILE_ID,
      displayName: null,
      provider: null,
    })
    await host.createSession(
      { provider: 'codex', profileId: PROJECT_MANAGER_PROFILE_ID, cwd: work, approvalMode: 'ask' },
      window,
    )
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no launch was handed a toolset')
    return one
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const one = toolset.tools.find((tool) => tool.name === name)
    if (one === undefined) throw new Error(`no such tool: ${name}`)
    return (await one.call(args)).structured as Record<string, unknown>
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the pair, as each provider receives it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the two sentences, on the bytes each provider is sent', () => {
    /**
     * ⛔ **Read off the PROVIDER SPEC and never off this repo's source text** — `456` §3's first
     * trap. ⚠️ A census that grepped `agent-tools.ts` would pass on a description that never
     * reaches a model: the Claude half goes through an in-process MCP server whose `tools/list` is
     * the actual answer, and the Codex half through a namespace translation. ⚑ **Both are driven
     * here, and nothing is stripped** — what comes back is what the model reads.
     */
    it('🔴 both providers are sent the SAME two sentences, and they are the product’s own', async () => {
      const toolset = await brobotsTools()
      const fromCodex = codexDescriptions(toolset)
      const fromClaude = await claudeDescriptions(toolset)

      // ⚠️ **Two non-vacuity controls before any claim.** A reader that found nothing would
      // otherwise satisfy every assertion below by having no opinion at all.
      expect(Object.keys(fromCodex).length, 'the Codex reader found no tools').toBeGreaterThan(10)
      expect(Object.keys(fromClaude).length, 'the Claude reader found no tools').toBeGreaterThan(10)

      // 🔴 **One string, two providers.** `348` made both adapters derive from the same spelling;
      // a pair written for one provider and drifting on the other is the defect that would make
      // every sentence below true of half the app.
      expect(fromClaude).toEqual(fromCodex)

      // ⚑ The third control: a tool this dispatch did NOT touch still reads back, so the equality
      // above is over real descriptions rather than over two empty maps.
      // ⚠️ **553 · re-aimed, and the CONTROL is what it always was** (standing rule 26). ⛔ The
      // sentence this line quoted — *either a piece of work for it to do* — was rewritten when
      // HO-060 §2 stopped the two kinds being equal options, and again at D-016, when work left
      // `message_agent` for `give_work`; what this assertion is for is that the two maps hold REAL
      // descriptions rather than two empty ones, so it quotes a clause of the current sentence.
      expect(fromCodex['message_agent']).toContain('a follow-up on a piece of work you gave it')
    })

    it('⛔ neither sentence opens on the OTHER verb’s product — the moment of choosing', async () => {
      const said = codexDescriptions(await brobotsTools())
      const give = firstSentence(said['give_work'] ?? '')
      const create = firstSentence(said['create_agent'] ?? '')

      // 🔴 **The word the pair turns on is what each verb MAKES, and this is the whole
      // discriminator.** ⛔ Not *creation*: `456` §2.1 rules that out by name, and it is right —
      // both verbs can bring something into being, so the question a model has to answer is WHAT.
      // ⚑ **D-016** — it was `conversation` while `spawn_agent` started one; `give_work` makes a
      // piece of WORK, and a conversation is only where that work goes.
      expect(give.toLowerCase()).toContain('work')
      expect(create.toLowerCase()).not.toContain('work')

      // ⛔ **And the collision itself, in the one place it can be stated mechanically.** Before
      // `456` the starting verb opened *"Create another agent."* — the word that became
      // `create_agent`'s NAME at `419`. ⚠️ It may not carry that word at all in its opening claim.
      expect(give.toLowerCase()).not.toContain('creat')
      expect(give.toLowerCase()).not.toContain('existence')

      // ⚑ The paired positive, so the assertion above cannot be satisfied by an empty string.
      expect(create.toLowerCase()).toContain('existence')
      expect(give.length).toBeGreaterThan(30)
    })

    it('⚑ `creat` is nowhere in give_work’s sentence, and create_agent names give_work', async () => {
      // ⛔ **`456` §2.2: a sentence that names its sibling is free.** It carries no existence
      // disclosure — it is a fact about the app's vocabulary, not about which identities exist — and
      // it is readable before any call, which is the only place a grantless caller can be helped.
      // ⚑ **D-016** — `give_work` carries its own way to a new agent (`new: true`) rather than
      // pointing at `create_agent`, so the stem is gone from it whole.
      const said = codexDescriptions(await brobotsTools())
      const give = said['give_work'] ?? ''
      expect(give.toLowerCase()).not.toContain('creat')
      // ⚠️ **The census is not vacuous**: the sentence is there, and the erasure on the untouched
      // sentence one verb over leaves plenty behind, so the reader is not quietly empty.
      expect(give.length).toBeGreaterThan(100)
      expect((said['create_agent'] ?? '').replaceAll('create_agent', '').length).toBeGreaterThan(
        100,
      )
      // ⚑ …and `create_agent` names the verb its job goes to, which is the half §2.2 asks for.
      expect(said['create_agent']).toContain('give_work')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the clause is pinned to the behaviour it describes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · making a name does not buy the right to start it', () => {
    /**
     * 🔴 **The sentence twelve live arms actually obeyed**, and the reason `456` found a second
     * defect where it expected one.
     *
     * ⛔ **`create_agent`'s SUCCESS answer used to end *"use spawn_agent to start a conversation as
     * it"*** — an instruction the very next rail refuses. ⚠️ `probe:two-verbs`, three rounds on each
     * provider under each wording: eleven of twelve arms called `create_agent` first, ten of those
     * then called `spawn_agent` for the name they had just made, and all ten left an identity behind
     * that nothing can start. ⚑ **The models were not confusing the two verbs. They were doing what
     * the answer told them.**
     */
    /**
     * 🔴 **532 · the arm that makes the sentence above a HALF of the rule rather than the rule.**
     *
     * ⛔ **D-014 · any agent may give work to any identity that exists**, so the name a caller has
     * just made is one it may give work to — no grant, no role and nothing else said. ⚑ The
     * fixture is a plain created identity, which is what every agent in this app now is.
     *
     * ⚠️ **The control is the same caller on a name that does NOT exist**, one fact over (standing
     * rule 3): without it this would assert only that some give was admitted, and a door that
     * admitted everything would pass.
     */
    it('🔴 532 · a caller gives work to the name it just made, and not to one nobody made', async () => {
      const tools = await projectManagersTools()

      const created = await callOn(tools, 'create_agent', { profile_slug: 'archivist' })
      expect(created['outcome'], 'the creation this test is about did not happen').toBe('ok')

      // ⛔ **The very call `456`'s retired sentence said only a person could unlock.**
      const started = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'The work it was made for',
        brief: 'the work it was made for',
      })
      expect(started['outcome']).toBe('ok')

      // ⚑ **The control**: a name nobody created is refused by the same caller on the same verb,
      // so the arm above measures the existence rail rather than the absence of a rail.
      // ⚑ **D-016 · R3** — `no-such-profile` (it was `unknown-profile`): without `new`, a give
      // names an agent this app holds.
      const refused = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'nobody-made-this',
        title: 'The work it was made for',
        brief: 'the work it was made for',
      })
      expect(refused['rail']).toBe('no-such-profile')
    })

    it('🔴 the SUCCESS answer no longer sends the caller at a door that will refuse it', async () => {
      const tools = await brobotsTools()
      const one = tools.tools.find((tool) => tool.name === 'create_agent')
      const said = (await one!.call({ profile_slug: 'archivist' })).text
      // It says the name this app gave the agent, and does not echo the slug it was sent.
      const archivist = store.agentIdentities().find((agent) => agent.slug === 'archivist')
      const named = archivist?.displayName ?? null
      const opens =
        named === null
          ? 'Created; it goes by its profile name.'
          : `Created; this app named it ${named}.`
      expect(said.startsWith(opens), said).toBe(true)
      expect(said).not.toContain('archivist')
      // ⛔ **The retired clause, by name** (standing rule 5 / HO-013 §5), so it cannot come back
      // quietly on a sentence somebody rewords. ⚠️ `456`'s OWN replacement, retired by `532`:
      // *"if your grant does not list it, only a person can"*. ⚑ **D-014 · no grant decides who may
      // be started any more**, so the answer names no grant at all.
      expect(said).not.toContain('only one your grant already names')
      expect(said).not.toContain('grant')
      // ⚑ …and what it says instead is what happened, which is the positive that keeps the two
      // negatives above from passing on an empty answer.
      expect(said).toContain('It is not running and has been sent nothing.')
    })

    it('🔴 …and the two descriptions SAY so, so the sentence dies with the behaviour', async () => {
      const said = codexDescriptions(await brobotsTools())
      // ⚠️ Pinned BY NAME, the way HO-013 §5 asks. ⛔ **Re-aimed at `532` and again at D-014 rather
      // than stripped** (standing rule 26): the retired absolutes are pinned as negatives.
      expect(said['give_work']).not.toContain(
        'a name you made yourself is not until a person grants it',
      )
      expect(said['create_agent']).not.toContain(
        'Making a name does not grant you the right to start it',
      )
      // ⛔ **D-014 · `532`'s literals are retired too**: no grant decides which name may be started,
      // so neither description says one does.
      expect(said['give_work']).not.toContain('the name must be one your own grant admits')
      expect(said['create_agent']).not.toContain(
        'Making a name does not by itself grant you the right to start it',
      )
      // ⚑ **What `give_work` says instead is the rule in force** — the name must EXIST — and the
      // field it is given in names the door that answers which names do, HO-052 §2: *"a project
      // manager that can list identities can look before it mints."* ⚑ **D-016** — the door is on
      // the `profile` argument, where the name is written.
      expect(said['give_work']).toContain('a name this app does not hold is refused')
      const give = (await brobotsTools()).tools.find((one) => one.name === 'give_work')
      const profile = (give?.input as Record<string, { description?: string }> | undefined)?.[
        'profile'
      ]
      expect(profile?.description).toContain('list_profiles')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · attempt 1, reproduced
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · what the first `malformed-request` actually was', () => {
    /**
     * ⛔ **`445`'s Claude arm, `sess_a4` ordinal 1244, verbatim from its ledger:**
     *
     * > `mcp__brobot__create_agent {"profile_slug":"project-manager","role":"DEV-75297"}`
     *
     * ⚠️ **It put the TICKET in `role`.** `role` advertised a closed vocabulary and the model went
     * past it — which says how hard it was pulling, because the field it wanted was `purpose`, and
     * `create_agent` has none. ⛔ **Every spawn takes a purpose; no creation does**, so a model
     * carrying one has exactly one free-shaped optional to put it in, beside the name. ⚑ **D-016**
     * — the job is a give's `brief` now, and a creation still takes none.
     *
     * ⚑ **D-014 · `role` is gone from `create_agent`'s input**, so the door that refused the ticket
     * there is gone with it; what is left of this section is the schema that invited it.
     */
    it('🔴 the schema invited it: a give REQUIRES a brief and a creation advertises none', async () => {
      const toolset = await brobotsTools()
      const give = toolset.tools.find((one) => one.name === 'give_work')
      const create = toolset.tools.find((one) => one.name === 'create_agent')
      expect(Object.keys(give?.input ?? {})).toContain('brief')
      expect(Object.keys(create?.input ?? {})).not.toContain('brief')
      expect(Object.keys(create?.input ?? {})).not.toContain('purpose')
      // ⛔ **So the remedy is a CLAUSE and not a column** — the sentence says where a purpose
      // belongs rather than leaving the model to guess.
      const said = codexDescriptions(toolset)
      expect(said['create_agent']).toContain('no purpose is recorded')
      // 🔴 **618 · this comment read *"an identity is a name and nothing else"* and `HO-078` §4
      // made that false**: creation now takes the new identity's own standing rules, so there IS a
      // free-shaped optional beside the name — the shape `445`'s arm filled with a ticket number.
      // ⛔ **The clause above is therefore load-bearing in a way it was not before**, and the line
      // that DISTINGUISHES the two is pinned beside it (standing rule 5) rather than left in the
      // middle of a paragraph nothing reads.
      // ⚑ **D-016** — the job goes in a piece of work, and `give_work` is the verb that takes one.
      expect(said['create_agent']).toContain(
        'the job goes in a piece of work you give it with give_work, while rules are what this agent is in every conversation it ever runs',
      )
      // ⚑ **And the field is advertised**, so the pair is *the purpose has no column* and *the
      // rules do* rather than two halves of one negative.
      expect(Object.keys(create?.input ?? {})).toContain('rules')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the readers
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ What Codex is handed on `thread/start`: one namespace holding every tool. */
function codexDescriptions(toolset: AgentToolset): Record<string, string> {
  const specs = codexDynamicToolsFor(toolset) as
    { tools: { name: string; description: string }[] }[] | undefined
  if (specs === undefined || specs.length !== 1) throw new Error('no Codex namespace was built')
  return Object.fromEntries(specs[0]!.tools.map((one) => [one.name, one.description]))
}

/**
 * ⚑ What Claude is handed: the in-process MCP server's own `tools/list`, driven through the SDK's
 * transport the way the CLI drives it.
 *
 * ⛔ **Deliberately not a read of `toolset.tools`.** The description a model sees passes through
 * `tool()` and the MCP server before it reaches anybody, and `348` is the measurement that says
 * this layer can change what arrives.
 */
async function claudeDescriptions(toolset: AgentToolset): Promise<Record<string, string>> {
  const servers = claudeMcpServersFor(toolset)
  const low = (servers?.['brobot'] as { instance: { server: unknown } } | undefined)?.instance
    .server as { connect(transport: unknown): Promise<void> }
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
      clientInfo: { name: '456', version: '1' },
    },
  })
  await vi.waitFor(() => expect(out.some((m) => m['id'] === 1)).toBe(true))
  post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  await vi.waitFor(() => expect(out.some((m) => m['id'] === 2)).toBe(true))
  const listed = out.find((m) => m['id'] === 2) as {
    result?: { tools?: { name: string; description: string }[] }
  }
  return Object.fromEntries((listed.result?.tools ?? []).map((one) => [one.name, one.description]))
}

/**
 * ⚠️ **The opening claim, and nothing after it.** `456` §2.1 is about *"the moment of choosing"* —
 * a model skimming a catalogue reads the first clause of each, so that is the string the pair has to
 * part on. ⛔ Splitting on the em dash too, because both sentences use one to hang the sibling
 * clause off, and a reader that took the whole sentence would be reading the pointer as the claim.
 */
function firstSentence(description: string): string {
  return description.split(/[.—:]/)[0] ?? ''
}

/** ⚠️ This file is about what a caller is TOLD, and never about what a launch injects. */
const NOTHING_INJECTED: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
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

class WatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}
