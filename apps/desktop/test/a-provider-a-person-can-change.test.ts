import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import type { ExternalMcpServerRow } from '../src/shared/external-mcp'
import type { IdentityUse } from '../src/shared/agent-roster'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, noPersonBehindIt } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { providerForALaunch } from '../src/renderer/src/lib/agent-store'
import { providerTakesEffectNextTime } from '../src/renderer/src/lib/front-door-words'
import {
  DEFAULT_PROFILE_ID,
  PROVIDER_NAME,
  SEEDED_PROVIDERS,
  providerName,
  seededProviderFor,
  type AgentIdentity,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/**
 * 🔴 **433 §A · the provider a person can change** — HO-024 §2.2's *"required, not planned"*, and
 * the word the PO's ruling turns on: **changeable**.
 *
 * ## ⛔ The ruling this implements, and the one it must NOT implement
 *
 * ⚠️ **HO-024 §2.1 REVERTS HO-023 §3 and restores HO-022 §3:** *"Provider is a property of the
 * SESSION, with a per-identity DEFAULT. The identity carries a default; a session takes it at
 * launch; once started it is fixed."* ⛔ **So changing a default must reach no live session and no
 * recorded one** — the case that reverted the ruling is *the same identity on Codex in one project
 * and Claude in another*, and a setter that moved a running conversation would delete it.
 *
 * ⚑ **`417` measured the mechanism** (no `UPDATE provider_session` sets the column, `createRuntime`
 * returns a different class per provider) and **`427` measured that the column is READ at a
 * launch** — which is what made this buildable at all rather than a write nothing consults.
 *
 * ## 🔴 What HO-025 §4 withdrew, arriving mid-dispatch through `433` relay 1
 *
 * The person chooses the provider for each conversation, including BroBot and every agent. A
 * seeded provider is a first-run convenience rather than a fixed choice of orchestration
 * model.
 *
 * ⛔ **So §2 measures a MECHANISM and never a preference**: that a seed lands where nobody has
 * said, that it does not overwrite what somebody did say, and that the two places the value is
 * written down agree with each other.
 *
 * ## ⚠️ And the property HO-025 added, which is a sentence rather than a rail
 *
 * > *"Changing it means a new conversation, and the app should SAY that rather than offer a control
 * > that silently relaunches."*
 *
 * ⛔ §4 is that sentence, pinned against the thing that makes it true — standing rule 5.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

class RecordingSink implements RuntimeEventSink {
  /** ⚠️ `boolean` and not the literal, so {@link NobodyThere} below can be the other one. */
  readonly aPersonIsBehindIt: boolean = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** ⛔ The one sink shape that is NOT a window — `349`'s whole point, and §1's person gate. */
class NobodyThere extends RecordingSink {
  override readonly aPersonIsBehindIt = false
}

class ToolWatchingRuntime extends FakeRuntime {
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

describe('433 §A · the provider a person can change', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-provider-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-provider-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ask = (
    command: Parameters<typeof executeRuntimeCommand>[2],
    sink: RuntimeEventSink = window,
  ): Promise<unknown> => executeRuntimeCommand(host, sink, command)

  const personOpens = async (profileId: string, provider: Provider = 'claude'): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider,
      profileId,
      approvalMode: 'ask',
      cwd: root,
    })) as { sessionId: string }
    return opened.sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const chooseFor = (profileId: string, provider: Provider | null): Promise<unknown> =>
    ask({ kind: 'setAgentProvider', profileId, provider })

  /**
   * ⚑ **What one CONVERSATION runs on, read off its own row** — the value `createSession` wrote and
   * the one `417` proved nothing updates. ⛔ Read from the ledger rather than from a live handle,
   * because the claim is about the recorded fact as much as about the running process.
   */
  const sessionProvider = (sessionId: string): unknown =>
    (
      db.prepare('SELECT provider FROM provider_session WHERE id = ?').get(sessionId) as
        { provider: string } | undefined
    )?.provider ?? null

  /** ⛔ The RAW column, so *nobody has said* and *chose the fallback's value* stay two facts. */
  const providerColumn = (slug: string): unknown =>
    (
      db.prepare('SELECT provider FROM agent_identity WHERE slug = ?').get(slug) as
        { provider: string | null } | undefined
    )?.provider ?? null

  /**
   * ⛔ **Whether a ROW is there at all — the question {@link providerColumn} cannot answer**
   * (`584`). ⚠️ That reader says `null` for *nobody has said* and `null` for *there is no such
   * identity*, and `HO-078` §1 turned the second into the first for this file's other subject: the
   * project manager used to be minted by BroBot's own launch, and a fresh install ships no such row.
   * ⚑ So every `toBeNull()` about that slug is paired with this, or it passes on an absence.
   */
  const rowCount = (slug: string): unknown =>
    db.prepare('SELECT count(*) AS n FROM agent_identity WHERE slug = ?').get(slug)

  /**
   * 🔴 **584 · somebody CREATES the project manager, because this app ships only `brobot`**
   * (`HO-078` §1).
   *
   * ⚠️ **Without this the tests below stop measuring what they are about rather than failing at
   * it**: the give is refused `no-such-profile`, and `setAgentProvider` answers `null` by the rule
   * that a name nobody has run as is not a thing to configure into existence — which is a different
   * test, three cases down.
   *
   * ⚑ **No grant is set for the give that follows** (D-014): any agent may start a conversation as
   * any agent this app holds, so the row existing is the whole premise.
   *
   * ⚠️ **`displayName: null` is not what the row ends up with** (`HO-078` §5) — the app assigns a
   * human name to every identity it mints. Nothing here reads it; it is named so a reader does not
   * mistake the argument for the column.
   */
  const aProjectManagerSomebodyCreated = (): AgentIdentity => {
    const made = host.createAgent({
      slug: PROJECT_MANAGER_PROFILE_ID,
      displayName: null,
      provider: null,
    })
    // ⚠️ **The premise, asserted rather than assumed**: the row is there, and its provider column
    // says NOTHING — so what the tests below read as *nobody has said* is not an absent identity.
    expect(rowCount(PROJECT_MANAGER_PROFILE_ID)).toEqual({ n: 1 })
    expect(made.provider).toBeNull()
    return made
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the verb, through the product
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a person says what the NEXT conversation starts on', () => {
    /**
     * 🔴 **The whole of §A in one test: the choice reaches a launch, and reaches no running one.**
     *
     * ⛔ **The launch that reads it is a GIVE that starts a conversation** (D-016: `give_work` took
     * `spawn_agent`'s place), which is the one door inside main that resolves `asked.provider ??
     * providerOf(profileId) ?? parent.provider` (`419`, `spawn-rails.ts`). ⚑ That is not a detour:
     * it is the product path `427` measured the column being read on, and it is where a default
     * *for an identity* becomes a provider *for a conversation*.
     *
     * ⚠️ **The pair is BEFORE and AFTER over the same call**, so what differs is the column. A
     * give taken only after the choice would have measured that a started child runs on something.
     *
     * ⚑ **584 · the child is an identity somebody CREATED** (`HO-078` §1) — see
     * {@link aProjectManagerSomebodyCreated}. ⛔ The subject is unchanged: a default *for an
     * identity* becoming a provider *for a conversation*, measured over one call.
     */
    it('🔴 the next conversation takes the new default, and the running one does not move', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID, 'claude')
      const brobotTools = theToolsetJustHandedOut()
      aProjectManagerSomebodyCreated()

      // ⚑ **Before**: nobody has said, so the child inherits its parent's provider.
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).toBeNull()
      const inherited = (await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'the first child',
        brief: 'the first child',
      })) as { agent: string; outcome: string }
      expect(inherited.outcome, JSON.stringify(inherited)).toBe('ok')
      expect(sessionProvider(inherited.agent)).toBe('claude')
      // ⛔ **The second give below is a SECOND parent's**, because a give reaches the ONE
      // conversation a giver has with that agent (D-016): the same parent's second give would go to
      // the child that is already running, and start nothing. ⚠️ The second parent runs on
      // `claude` too, so the two readings still diverge.
      await personOpens(DEFAULT_PROFILE_ID, 'claude')
      const secondParentTools = theToolsetJustHandedOut()

      // 🔴 **A person changes the default** — through the real boundary, on the real wire.
      const saved = (await chooseFor(PROJECT_MANAGER_PROFILE_ID, 'codex')) as AgentIdentity | null
      expect(saved?.provider).toBe('codex')
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).toBe('codex')

      // ⚑ **After**: the same call, one column over, and the child runs on the chosen one.
      const chosen = (await callOn(secondParentTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'the second child',
        brief: 'the second child',
      })) as { agent: string; outcome: string }
      expect(chosen.outcome, JSON.stringify(chosen)).toBe('ok')
      expect(sessionProvider(chosen.agent)).toBe('codex')

      // ⛔ **And the conversation that was already running did not move**, which is HO-024 §2.1's
      // restored ruling and the reason this verb is not a setter.
      expect(sessionProvider(brobot)).toBe('claude')
      expect(host.agentCard(brobot, { ownerId: window.ownerId }, null)?.provider).toBe('claude')
      expect(host.sessionIds).toContain(brobot)
      // ⚑ …and neither did the first child, still running on what it started on.
      expect(sessionProvider(inherited.agent)).toBe('claude')
    })

    /**
     * ⛔ **`null` is *use the app's fallback*, and it is the gesture that makes a choice
     * reversible** — the capability sheet's `Use the default`, one column over.
     *
     * ⚠️ **Measured where the two readings DIVERGE**: the parent runs on `claude`, so a child that
     * fell back would run on `claude` and a child that kept the cleared word would run on `codex`.
     * A fixture whose parent ran on `codex` would have given the same answer either way.
     */
    it('⛔ clearing it hands the identity back to what it would have followed', async () => {
      await personOpens(DEFAULT_PROFILE_ID, 'claude')
      const brobotTools = theToolsetJustHandedOut()
      // ⚑ **584** — the identity this clears a choice on is created rather than shipped
      // (`HO-078` §1); {@link aProjectManagerSomebodyCreated} argues it.
      aProjectManagerSomebodyCreated()
      expect(
        (await chooseFor(PROJECT_MANAGER_PROFILE_ID, 'codex')) as AgentIdentity | null,
      ).toMatchObject({
        provider: 'codex',
      })

      const cleared = (await chooseFor(PROJECT_MANAGER_PROFILE_ID, null)) as AgentIdentity | null
      expect(cleared?.provider).toBeNull()
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).toBeNull()

      const child = (await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'after clearing',
        brief: 'after clearing',
      })) as { agent: string; outcome: string }
      expect(child.outcome, JSON.stringify(child)).toBe('ok')
      expect(sessionProvider(child.agent)).toBe('claude')
    })

    /**
     * ⛔ **Criterion 12 through the second configuration door**: a name nothing has ever run as is
     * not a thing to configure into existence.
     */
    it('⛔ an identity with no row answers null, and no row is created', async () => {
      expect(await chooseFor('nobody-has-run-as-this', 'codex')).toBeNull()
      expect(
        db
          .prepare('SELECT count(*) AS n FROM agent_identity WHERE slug = ?')
          .get('nobody-has-run-as-this'),
      ).toEqual({ n: 0 })
    })

    /**
     * ⛔ **A person, not an agent** (§A.3.3) — `419`'s pattern, and `requireAPerson`'s first reader
     * one verb over.
     *
     * ⚑ **The pair is the SINK and nothing else**: the same command, the same payload, through a
     * channel that does not declare a person behind it.
     */
    it('⛔ a channel with nobody behind it is refused by name, and writes nothing', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      await expect(
        ask(
          { kind: 'setAgentProvider', profileId: DEFAULT_PROFILE_ID, provider: 'codex' },
          new NobodyThere('agent:sess_1'),
        ),
      ).rejects.toThrow(noPersonBehindIt('setAgentProvider'))
      // ⚑ **The seed is still what is there**, so the refusal refused rather than skipped.
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBe(seededProviderFor(DEFAULT_PROFILE_ID))
      // ⛔ …and the very same call through a window writes.
      expect((await chooseFor(DEFAULT_PROFILE_ID, 'codex')) as AgentIdentity | null).toMatchObject({
        provider: 'codex',
      })
    })

    /**
     * ⚑ **The renderer's own resolution follows it too, and it is the SAME derivation the front
     * door uses** — `433` relay 1: *"one derivation, or the two doors drift."*
     *
     * ⛔ **`providerForALaunch` is called here rather than re-implemented.** `RuntimeScreen` holds
     * the app's fallback and passes the answer into the capability sheet as a prop, so there are
     * two callers of one function and no second reader of the constant.
     */
    it('⚑ what a launch as this identity would run on follows the column, through one function', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      // ⚑ **584** — created, not shipped (`HO-078` §1). ⛔ **And it is load-bearing for the FIRST
      // reading below, which is the one that still passed with the row gone**: `providerForALaunch`
      // falls back for an identity that is absent from the roster and for one whose column says
      // nothing, and only the second of those is the claim. With the row there, the pair is *the
      // column is silent* against *the column was written*, one call apart.
      aProjectManagerSomebodyCreated()
      const roster = (): {
        identities: AgentIdentity[]
        foldersWithoutARow: string[]
        // 558 · and a third time, for the same reason: this reader ignores what each identity has
        // done, and the shape still has to be the one the host now answers with.
        use: readonly IdentityUse[]
        spawningEnabled: boolean
        // 500 · `providerForALaunch` reads the roster, never this — it is here because the
        // parameter is the whole payload and the shape has to match what the host now answers.
        defaultApprovalMode: 'ask' | 'auto'
        // 516 · and again, for the same reason: this reader ignores the registry, and the shape
        // still has to be the one the host answers with.
        externalMcpServers: readonly ExternalMcpServerRow[]
      } => host.agentIdentities() as never
      expect(providerForALaunch(roster(), PROJECT_MANAGER_PROFILE_ID, 'codex')).toBe('codex')
      await chooseFor(PROJECT_MANAGER_PROFILE_ID, 'claude')
      expect(providerForALaunch(roster(), PROJECT_MANAGER_PROFILE_ID, 'codex')).toBe('claude')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the seed, and the choice it must never overwrite
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a first-run convenience, and standing rule 11', () => {
    /** ⚑ **The seed lands at the LAUNCH that mints the row**, and only on the identity it names. */
    it('⚑ a first launch mints the seeded default, and every other identity says nothing', async () => {
      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      // 🔴 **The launch's OWN provider is `codex` and the column says the seed** — which is the
      // divergent pair: a row that recorded the provider a launch happened to run on would read
      // `codex` here, and that is `370`'s infer-from-an-accident defect with a new column.
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBe(seededProviderFor(DEFAULT_PROFILE_ID))
      expect(providerColumn(DEFAULT_PROFILE_ID)).not.toBe('codex')
      await personOpens('explorer', 'codex')
      expect(providerColumn('explorer')).toBeNull()
      expect(seededProviderFor('explorer')).toBeNull()
      // ⚠️ **Folded, as every slug is** — two spellings are one identity.
      // ⚑ **592 · the loud spelling is DERIVED** (`HO-078` §2): it was the literal `'DEFAULT'`,
      // which stopped being a spelling of anything the moment the slug was renamed.
      expect(seededProviderFor(DEFAULT_PROFILE_ID.toUpperCase())).toBe(
        seededProviderFor(DEFAULT_PROFILE_ID),
      )
    })

    /**
     * 🔴 **THE CALLER WINS, and the pair is measured where the two readings diverge.**
     *
     * ⛔ `419`'s ruling: *a person saying what an identity IS beats a seed.* ⚠️ **So the creation
     * door names `codex` here and never `claude`**
     * — a create that asked for the seed's own word would give the same column whichever way round
     * the `??` was written, which is `a-comparison-tested-where-both-sides-agree-measures-nothing`.
     */
    it('🔴 a person creating BroBot and naming a provider is not overruled by the seed', () => {
      const made = store.createAgentIdentity(
        {
          slug: DEFAULT_PROFILE_ID,
          displayName: null,
          provider: 'codex',
        },
        { by: 'a-person' },
      )
      expect(made?.provider).toBe('codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBe('codex')
      expect(seededProviderFor(DEFAULT_PROFILE_ID)).not.toBe('codex')
    })

    /**
     * 🔴 **The seed is resolved at the LAUNCH door and not at the creation door**, and that
     * distinction is a defect this dispatch's own review found.
     *
     * ⛔ **339's `.nullable()` ruling makes *the caller did not mention it* and *the caller said
     * `null`* ONE VALUE on the wire** — right for a wire, wrong for a seed, because the two doors
     * mean opposite things by it. ⚠️ A launch mentions nothing: the provider it runs on is an
     * accident. ⛔ **A person at the creation door who picks *Nobody has said* has ANSWERED**, and
     * `NewAgent.vue` tells them what that answer means — so a seed that overrode it would record a
     * word they declined to choose.
     *
     * ⚑ **Measured as a pair over the two doors, in one sample**, which is the only shape that can
     * tell them apart.
     */
    it('🔴 a launch takes the seed; a person who picks *nobody has said* keeps it', async () => {
      // ⛔ The creation door, first — a person, answering.
      const made = store.createAgentIdentity(
        {
          slug: DEFAULT_PROFILE_ID,
          displayName: null,
          provider: null,
        },
        { by: 'a-person' },
      )
      expect(made?.provider).toBeNull()
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()
      // ⚑ …and the launch that follows does NOT fill it, because the row already exists.
      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()

      // 🔴 **The other side of the pair**: an identity the LAUNCH brings into being takes the seed.
      // ⚠️ The launch runs on `codex` and the seed is the other word, so the two readings diverge.
      //
      // 🔴 **584 · the launch is OPENED here now, and that is a repair rather than a tidy-up**
      // (`HO-078` §1). ⛔ This row used to exist because a seeded grant brought it into being — so
      // the two lines below read a row no line of this test had asked for. ⚠️ **A fresh install
      // ships `brobot` and nothing else**, so the slug has NO ROW, `providerColumn` answers `null`
      // for the ABSENCE, and the pair would have gone on passing while measuring nothing —
      // `an-unenumerated-state-counts-as-success`, one column over. ⚑ So the conversation the
      // sentence above always claimed is opened, on `codex`, and the divergence is restored: a
      // launch that recorded the provider it happened to run on would read `codex` here.
      await personOpens(PROJECT_MANAGER_PROFILE_ID, 'codex')
      expect(rowCount(PROJECT_MANAGER_PROFILE_ID)).toEqual({ n: 1 })
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).toBeNull()
      expect(providerColumn(PROJECT_MANAGER_PROFILE_ID)).not.toBe('codex')
      expect(seededProviderFor(PROJECT_MANAGER_PROFILE_ID)).toBeNull()
      const seeded = seededProviderFor(DEFAULT_PROFILE_ID)
      expect(seeded, 'nothing is seeded, so this pair measures nothing').not.toBeNull()
      // ⚠️ **One identity and no more.** A seed that had grown a second entry would be the app
      // deciding what somebody else's conversations run on — HO-025 §4's *"on BroBot and on every
      // agent"*, read the other way — and it would need its own argument rather than this one.
      expect(SEEDED_PROVIDERS.map((seed) => seed.slug)).toEqual([DEFAULT_PROFILE_ID])
    })

    /**
     * 🔴 **Standing rule 11 through the APP rather than through the migration**: a person who clears
     * the seed keeps it cleared, across a restart and across a second launch.
     *
     * ⛔ **The `INSERT OR IGNORE` is the mechanism** and this is what makes it a measurement: a
     * second launch of the same identity runs `ensureIdentityRow` again, and a seed written by an
     * `INSERT` rather than ignored on collision would put the word straight back.
     */
    it('🔴 a person who clears the seed is not re-granted it by the next launch', async () => {
      const first = await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBe(seededProviderFor(DEFAULT_PROFILE_ID))
      expect(await chooseFor(DEFAULT_PROFILE_ID, null)).toMatchObject({ provider: null })
      // ⚑ **D-017 — a person's Close** (`endAgent` is gone): the second launch below is a new one.
      await host.close(first, window)

      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()

      // ⛔ **And a whole new STORE and host over the same database file**, which is the restart
      // this rule is about — `a-next-launch-test-needs-its-own-store-object`: a second host sharing
      // the first one's store object would be sharing its prepared statements and its caches, and
      // would answer for the launch that is already over.
      store = createSessionStore(db, tick)
      host = buildHost()
      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the name, and the sentence it must not make false
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · not `setProvider`, and what that census is really about', () => {
    /**
     * 🔴 **§A.3.2's live trap, measured from the other side.**
     *
     * ⛔ `a-front-door-that-asks-nothing.test.ts` §1 greps all of `src/main` for four names and
     * expects nothing, because `417` shipped the sentence *"the provider you cannot change"*. ⚑
     * **A verb called `setProvider` would take that census red for a reason it does not mean**
     * (`423` F5.1). ⚠️ **This is the positive half**: the verb 433 added really exists, it really
     * names an identity, and it really is not one of the four names — so the negative one file over
     * is a statement about SESSIONS rather than an accident of naming.
     */
    it('🔴 the verb exists, names an identity, and is none of the four forbidden names', () => {
      const ipc = readFileSync(join(srcRoot, 'main/runtime/ipc.ts'), 'utf8')
      expect(ipc).toContain("z.literal('setAgentProvider')")
      expect(ipc).toMatch(
        /case 'setAgentProvider':[\s\S]{0,600}requireAPerson\(sink, command\.kind\)/,
      )
      expect(ipc).toContain('host.setAgentProvider(command.profileId, command.provider)')
      expect(/\b(setProvider|changeProvider|switchProvider|swapProvider)\b/i.test(ipc)).toBe(false)
      // ⛔ **The payload names an identity and carries no session**, which is the intersection
      // `a-front-door-that-asks-nothing.test.ts` §1's third test requires to stay empty.
      const arm = ipc.slice(ipc.indexOf("z.literal('setAgentProvider')"))
      const body = arm.slice(0, arm.indexOf('}),'))
      expect(body).toContain('profileId')
      expect(body).not.toContain('sessionId')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the sentence HO-025 asks for
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the app SAYS that changing it means a new conversation', () => {
    /**
     * ⛔ **Standing rule 5: a safety sentence with no test is a comment.** Every clause is pinned
     * against the thing that makes it true, not against itself.
     */
    it('⛔ every clause of it, and the provider named the way a person reads it', () => {
      for (const provider of Object.keys(PROVIDER_NAME) as Provider[]) {
        const said = providerTakesEffectNextTime(provider)
        // ⚑ **The display name, not the wire id** — `151`'s rule, and `417`'s own assertion one
        // sentence over.
        expect(said).toContain(providerName(provider))
        expect(said, 'the wire id reached a sentence a person reads').not.toContain(provider)
        // ⛔ **The two load-bearing clauses, by name**: nothing moves, and it applies next time.
        expect(said).toContain('starts nothing and moves nothing')
        expect(said).toContain('keeps the provider it began on')
      }
      // ⚠️ **The two providers must produce different text**, or the sentence is not rendered from
      // the value at all.
      expect(providerTakesEffectNextTime('claude')).not.toBe(providerTakesEffectNextTime('codex'))
    })

    /**
     * ⛔ **The sheet RENDERS it, and renders it from the RESOLVED provider.**
     *
     * ⚠️ **`props.runsOn` and never `identity.provider`**: the column can say *nobody has said*,
     * which is not a thing to print in a sentence about what will happen — and the resolution is
     * the screen's, so the identity sheet and the front door cannot disagree about the fallback.
     */
    it('⛔ the capability sheet shows it, beside a control that is not a capability', () => {
      const sheet = readFileSync(
        join(srcRoot, 'renderer/src/components/CapabilitiesSheet.vue'),
        'utf8',
      )
      // ⚑ **696** · with a second argument — whether a door asks the provider (BroBot's front door) —
      // and still from `props.runsOn`, which is what this line pins.
      expect(sheet).toContain('providerTakesEffectNextTime(props.runsOn,')
      expect(sheet).toContain('data-cy="capabilities-provider-select"')
      expect(sheet).toContain('store.chooseProviderFor(props.profileSlug, chosen)')
      // 🔴 **NOT on the grant**, which is `419` §3's ruling and the reason the column has its own
      // writer: `grant()` is built from `props.fields`, and a provider that had leaked into it
      // would be a capability by accident.
      // ⚠️ **Prose-stripped, like the census below it** — four fifths of this slice is comment, and
      // a future sentence in `grant()` that happened to use the word *provider* would take this red
      // for a reason it does not mean.
      // ⛔ **Presence first, then order** — an absent anchor is `-1`, and a slice from `-1` is not
      // the builder. (D-014: the builder is a few lines now that every grant is a primitive, so a
      // length floor no longer tells *found* from *not found*.)
      const stripped = withoutProse(sheet)
      const start = stripped.indexOf('function grant(): CapabilityGrant {')
      const end = stripped.indexOf('async function save()')
      expect(start, 'the grant builder was not found, so this measures nothing').toBeGreaterThan(0)
      expect(end).toBeGreaterThan(start)
      const grantBody = stripped.slice(start, end)
      expect(grantBody).toContain('props.fields.map')
      expect(grantBody).not.toContain('provider')
      // ⚑ **One derivation of the fallback** — the sheet is HANDED the answer and reads no
      // constant. ⚠️ **Prose stripped first**: the prop's own docblock NAMES `DEFAULT_PROVIDER` to
      // say where the answer comes from, and a census that counted comments would have reported a
      // sheet that reads it.
      expect(withoutProse(sheet)).not.toContain('DEFAULT_PROVIDER')
      expect(sheet, 'the docblock that explains the prop is gone').toContain('DEFAULT_PROVIDER')
      const screen = readFileSync(
        join(srcRoot, 'renderer/src/components/RuntimeScreen.vue'),
        'utf8',
      )
      expect(screen).toContain(':runs-on="providerForAgent(overlays.overlay.value.profileSlug)"')
      // ⛔ **`DEFAULT_PROVIDER` is still declared once and read by exactly the two resolutions** —
      // `a-gesture-that-creates-an-agent.test.ts` §3 pins the count; this is the claim that 433
      // added no third reader of it.
      expect(withoutProse(screen).match(/\bDEFAULT_PROVIDER\b/g)).toHaveLength(3)
    })
  })
})

/** Line and block comments removed — `send-refusals.test.ts`'s stripper, for its reason. */
function withoutProse(source: string): string {
  let inBlock = false
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock) {
          if (!rest.startsWith('*/')) continue
          at += 1
          inBlock = false
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*')) {
          inBlock = true
          at += 1
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}
