import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, whatTheChildWouldLack } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  DEFAULT_CAPABILITIES,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { CAPABILITY_COLUMNS, CAPABILITY_FIELDS } from '../src/shared/capabilities'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, type CallerIdentity } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  SPAWN_RAILS,
  admitGive,
  describeRail,
  giveRequestSchema,
  permanenceOf,
  remedyOf,
  retryableOf,
  type AdmittedSpawn,
  type GiveFacts,
  type GiveOutcome,
  type SpawnRail,
} from '../src/main/runtime/spawn-rails'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * 🔴 **341 · the rails, before anything can reach them.**
 *
 * ⛔ **The ordering ruling this file demonstrates** (341 §0). *"Tools and rails together — NOT tools
 * first. A rail added afterwards is a rail that was optional once."* This is rails FIRST: nothing on
 * any wire can reach `RuntimeHost.spawnSession` today, so by the time a `spawn_agent` tool
 * exists the chokepoint it calls already refuses.
 *
 * ⚑ **D-016 · the chokepoint is `RuntimeHost.giveWork` now** — `spawn_agent` went, and the one door
 * that starts a conversation is a give that finds none — so every rail below is asked of it, AS the
 * giving conversation, and `admitGive` is the one function that answers in R2's order.
 *
 * ## ⚑ Criterion 3, which the PO said they would protect if the slice ran long
 *
 * *"A gate nobody has watched fail is a claim."* So **every rail below is performed** — the same
 * call, one fact over, allowed and then refused — and **every refusal is paired with the positive
 * that proves the test was reaching the rule** rather than failing for some other reason.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

/**
 * A commander (340) — a {@link CallerIdentity} and deliberately not a sink: it has no screen, and it
 * speaks as no conversation, so it holds no piece to give from.
 */
const PLANNER: CallerIdentity = { ownerId: 'mcp:planner' }
/** A second caller, which was given nothing. */
const STRANGER: CallerIdentity = { ownerId: 'mcp:other' }

describe('341 · the rails, before anything can reach them', () => {
  let userData: string
  /** Its own folder, outside `userData` (which `checkSessionCwd` refused until `726` · R92). */
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let counter: number
  let window: RecordingSink
  /**
   * ⛔ **One strictly-increasing clock, shared by the host and the store** (341) — so two facts
   * written one after the other never share a stamp. ⚠️ It was there for `spawned_at < created_at`,
   * which went with the provenance columns (D-016).
   */
  let clock: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      // ⚑ **339's own rule, wired in rather than faked** (341 §1C: *"call it, do not write a second
      // one"*). `checkCwd` — which the folder rail asks — resolves through this exact seam, so the
      // folder refusal below is `checkSessionCwd`'s sentence and not a double's.
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

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-rails-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-rails-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_000_000
    store = createSessionStore(db, tick)
    counter = 0
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  /** A conversation a PERSON opened, in a window. Depth 0 by construction. */
  const personOpens = async (
    profileId: string,
    options: { approvalMode?: 'ask' | 'auto'; sink?: RecordingSink } = {},
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: options.approvalMode ?? 'ask' },
      options.sink ?? window,
    )
    return sessionId
  }

  /**
   * ⛔ **Bring an identity into existence the only way anything can** — by a person running a
   * conversation as it — and then close that conversation so the identity is free.
   *
   * ⚑ This IS criterion 12 from the inside. `setCapabilities` refuses to create a row, and a give
   * refuses a name with no row — ⚑ unless it asks for a new agent (D-016 · R3), which is
   * `create_agent`'s door one call over — so **an agent is only ever given work as an identity that
   * a person, or an entitled agent, has deliberately brought into being.**
   */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const grant = (profileId: string, edit: Parameters<SessionStore['setCapabilities']>[1]): void => {
    expect(store.setCapabilities(profileId, edit)).toBe(true)
  }

  /**
   * ⚑ **D-016 · the door is `giveWork`, asked AS the giving conversation** — `spawnSession` and its
   * `parentSessionId` went with `spawn_agent`: the giver is whoever the caller speaks as, and a
   * conversation it starts is its child.
   */
  const give = async (
    request: Record<string, unknown>,
    by: CallerIdentity | typeof THE_APP_ITSELF,
  ): Promise<GiveOutcome> => host.giveWork(request, by)

  /** The giving conversation, as a caller — the only caller a give is answered for. */
  const as = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  /** A give of `profile`, with a title and a brief — the shape every case below starts from. */
  const aPiece = (
    profile: string,
    more: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    definition_of_done: 'The requested result and its checks are recorded.',
    profile,
    title: 'Summarise the ledger',
    brief: 'summarise the ledger',
    ...more,
  })

  /** The refusal, or a failure naming the conversation the give should not have reached. */
  const refusalOf = async (outcome: GiveOutcome): Promise<string> => {
    if (outcome.ok) throw new Error(`the give was allowed: ${outcome.owner}`)
    return outcome.refusal.rail
  }

  /** An admitted give, or a failure naming the rail that refused it. */
  const admitted = (outcome: GiveOutcome): Extract<GiveOutcome, { ok: true }> => {
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal.rail}`)
    return outcome
  }

  const sessionIdsOf = (): string[] => host.sessionIds

  /** Bounded, and it waits on the THING. */
  const until = async (check: () => boolean, what: string): Promise<void> => {
    for (let n = 0; n < 400; n += 1) {
      if (check()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §0 · the chokepoint, and the fact that nothing can walk round it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§0 · a tool cannot arrive into an ungated chokepoint', () => {
    /**
     * ⚑ **A REAL token, minted the only way one can be** — by `admitGive` answering *start a new
     * conversation*. The facts are a double so this stays a unit test of the chokepoint rather than
     * a second launch, and the three tests below then compare the genuine article against two
     * forgeries.
     */
    const mintARealToken = (parentSessionId: string): AdmittedSpawn => {
      const facts: GiveFacts = {
        // ⚠️ `'ask'` is the strict answer and the one this section wants: it is about the admission
        // TOKEN, and a lax giver would make the token's mode depend on a fact these tests are not
        // about.
        giver: () => ({
          sessionId: parentSessionId,
          profileId: 'pm',
          provider: 'claude',
          cwd: work,
          approvalMode: 'ask',
        }),
        held: () => [{ piece: 'work_root', label: 'W1', root: true, giver: null, received: true }],
        drivenByTheTurn: () => null,
        isAHelper: () => false,
        mayGiveWork: () => null,
        depthOf: () => 0,
        capabilitiesOf: () => DEFAULT_CAPABILITIES,
        // ⚑ **Nothing found**, so the answer is a START — the only answer that carries a token.
        helperAs: () => null,
        serviceAt: () => ({ is: 'normal' }),
        spawningEnabled: () => true,
        mayCreateAgents: () => null,
        // ⚑ **Null — *nobody has said*** (419), and the agent has no default (677; D-042 · R2): the
        // token's provider is then the giver's. ⚑ **D-042 took the model off the token** (its
        // `runsOn` went): the launch names R1's pair, so no token carries one.
        itsProvider: () => ({ provider: null, from: 'nothing-yet' }),
        theNamedModelsProvider: () => null,
        modelChoiceOf: () => null,
        checkFolder: (path) => ({ ok: true, path }),
      }
      const admission = admitGive(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'worker',
          title: 'A real one',
          brief: 'a real one',
        },
        PLANNER,
        facts,
      )
      if (!admission.ok) throw new Error(`the double refused: ${admission.refusal.rail}`)
      if (admission.goes.to !== 'a-new-conversation') throw new Error('the double found one')
      return admission.goes.start
    }

    it('🔴 a forged admission token is refused by `createSession`, and nothing is created', async () => {
      const parent = await personOpens('pm')
      const before = sessionIdsOf().length
      // ⛔ **The cast a tool written in a hurry would make.** The brand is a compile-time gate and
      // this is what defeating it looks like; the `WeakSet` is what catches it anyway.
      const forged = { ...mintARealToken(parent) } as unknown as AdmittedSpawn
      await expect(
        host.createSession({ provider: 'claude', cwd: work }, null, null, forged),
      ).rejects.toThrow(/admitted by the rails/)
      expect(sessionIdsOf()).toHaveLength(before)
    })

    it('⚑ …and the SAME object, unspread, is accepted — so the refusal above is about provenance', async () => {
      // 🔴 **The positive that makes the test above mean something.** Every field is identical; the
      // only difference is that this object is the one `admitGive` minted.
      const parent = await personOpens('pm')
      const real = mintARealToken(parent)
      const created = await host.createSession({ provider: 'claude', cwd: work }, null, null, real)
      expect(created.sessionId).toMatch(/^sess_/)
      // ⚑ **D-016 · the parent is the row's** (`parentOf`); the spawn reason and stamp are gone.
      expect(store.parentOf(created.sessionId)).toBe(parent)
      // ⛔ …and a conversation another one started owns no root (R1).
      expect(store.rootOf(created.sessionId)).toBeNull()
    })

    it('⛔ a spawn may not also be handed a second commanding caller', async () => {
      const parent = await personOpens('pm')
      const real = mintARealToken(parent)
      await expect(
        host.createSession({ provider: 'claude', cwd: work }, null, PLANNER, real),
      ).rejects.toThrow(/do not pass a second one/)
    })

    /**
     * 🔴 **Nothing crossing the renderer wire can SPAWN** — and since 355, two of the four names
     * this once banned are on it, deliberately.
     *
     * ## ⛔ What 341 asserted, and why 355 is allowed to change it
     *
     * Capability editing needs deliberate doors in `ipc.ts` and the wire contract, matching
     * the boundary described in `session-store.ts`. Banning `spawnSession`, `admitSpawn`,
     * `setCapabilities`, and `setSpawningEnabled` from both would leave `can_spawn` empty
     * forever and make the grants impossible for a person to exercise.
     *
     * ⛔ **So the ban SPLITS rather than softens.** The door that starts a conversation and its rails
     * stay banned in both files and always will — `giveWork` and `admitGive` since D-016, where
     * they were `spawnSession` and `admitSpawn`: a renderer must never be able to create a conversation an agent's
     * entitlements were spent on, and the admission token's own census next door is the second half
     * of that. What is now permitted is a door that WRITES A RULE, and the replacement for the ban
     * is not silence — it is the three positives below.
     *
     * ⚠️ **A rename would have been the dishonest way through this** and is worth naming: the ban
     * is a lowercased substring test, so a verb called `setAgentCapabilities` would have slipped it
     * while leaving its prose — *"must not be reachable from the IPC layer"* — standing as a lie
     * about a door that exists. The verbs are called what the store calls them.
     */
    it('🔴 nothing crossing the renderer wire can spawn, and the capability door is a person’s', () => {
      const ipc = readFileSync(join(srcRoot, 'main/runtime/ipc.ts'), 'utf8')
      const wire = readFileSync(join(srcRoot, 'shared/runtime-ipc.ts'), 'utf8')
      /**
       * ⚠️ **Comments stripped, and 355 is what paid for it.** The ban was over raw text, and this
       * dispatch's own docblocks — *"rail 1 of `admitSpawn` is the same ruling one door over"* —
       * turned it red about a sentence explaining why the door is safe. That is the shape the
       * admission-token census next door already strips for: *"a census that cannot tell a warning
       * about a hazard from the hazard is one that will be deleted the first time it fires on a
       * docblock."*
       *
       * ⛔ **It is not a narrowing, because the pair below closes it.** A name that is gone from the
       * stripped text and present in the raw one was, necessarily, only ever in a comment.
       */
      const withoutComments = (text: string): string =>
        text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      const ipcCode = withoutComments(ipc)
      const wireCode = withoutComments(wire)
      // ⛔ **The strip did not eat the file** — without this every ban below passes over nothing.
      expect(ipcCode).toContain('runtimeCommandSchema')
      expect(wireCode).toContain('RuntimeCommandResults')
      // ⚠️ **Case-insensitive**, because `a-case-sensitive-grep-became-a-false-claim` is exactly the
      // shape of mistake a census like this makes.
      for (const forbidden of ['giveWork', 'admitGive']) {
        expect(
          ipcCode.toLowerCase(),
          `${forbidden} must not be reachable from the IPC layer`,
        ).not.toContain(forbidden.toLowerCase())
        expect(
          wireCode.toLowerCase(),
          `${forbidden} must not be on the wire contract`,
        ).not.toContain(forbidden.toLowerCase())
      }
      // ⛔ **And the positive that proves this census is reading the right files** — a name that IS
      // on the wire, so an empty or mis-pathed read cannot pass over both halves.
      expect(ipc).toContain('createSession')
      expect(wire).toContain('createSession')

      // 1 · the door exists, and it is the store's own two names rather than a spelling chosen to
      //     slip past the ban this test used to make.
      // ⚠️ **Over the STRIPPED text, like the bans above** — this dispatch's own docblocks name both
      // verbs in prose, so a positive over the raw file would be satisfied by a comment about a door
      // that had been deleted. Found in review.
      // ⚑ **500 joined `setDefaultApprovalMode` to all three loops deliberately.** It goes red in
      // none of them — the rosters are hand-written — and `setAgentProvider` and `createAgent` each
      // shipped without being added, which is how a roster stops being a roster. ⚠️ It is the same
      // kind of door as the two beside it: a person-gated wire verb that reaches no toolset.
      // ⚑ **516 joined its two registry writes to all three loops deliberately**, for `500`'s
      // reason: the rosters are hand-written, and `setAgentProvider` and `createAgent` each shipped
      // without being added — which is how a roster stops being a roster. ⚠️ They are the same kind
      // of door as the three beside them: person-gated wire verbs that reach no toolset.
      // ⚑ **558 joined its two identity writes to all three loops deliberately**, for `500`'s and
      // `516`'s reason: the rosters are hand-written, and `setAgentProvider` and `createAgent` each
      // shipped without being added — which is how a roster stops being a roster. ⚠️ They are the
      // same kind of door as the five beside them: person-gated wire verbs that reach no toolset.
      for (const permitted of [
        'setCapabilities',
        'setSpawningEnabled',
        'setDefaultApprovalMode',
        'registerExternalMcpServer',
        'removeExternalMcpServer',
        // Only a person can decide an agent’s request to register a server.
        'decideMcpServerRequest',
        'setAgentDisplayName',
        'removeAgent',
        // A person archives, restores or deletes a conversation; an agent never does.
        'archiveConversation',
        'restoreConversation',
        'checkDeleteConversation',
        'deleteConversation',
        // ⚑ **677 joined its write and its read to all three loops deliberately**, for `500`'s
        // reason: the rosters are hand-written. ⛔ And the write is the strongest case yet for the
        // gate — standing rule 32 makes a choice a RAIL only because a person made it.
        // ⚑ **D-042 · R2 moved that reason, not the gate**: the write sets the agent's DEFAULT —
        // what its new conversations start on, no longer a rail a give cannot cross — and a caller
        // reaching it unasked could change any agent's default.
        'setAgentModelAndEffort',
        'agentModelAndEffort',
      ]) {
        expect(ipcCode, `${permitted} is the door 355 built`).toContain(permitted)
        expect(wireCode, `${permitted} is on the wire contract`).toContain(permitted)
      }

      // 2 · 🔴 **every capability verb is gated on a PERSON**, and the gate is 349's declaration
      //     rather than a second notion of one. Scoped to each `case`, because
      //     `an-assertion-can-be-satisfied-by-a-neighbouring-element`: a single
      //     `toContain('requireAPerson')` over the whole file would pass on one guarded verb and two
      //     unguarded ones.
      for (const kind of [
        'agentIdentities',
        'setCapabilities',
        'setSpawningEnabled',
        'setDefaultApprovalMode',
        // ⛔ **516 · adding a server is what makes a grant possible, and removing one takes a
        // capability away from every identity that held it** — `noPersonBehindIt`'s own sentence is
        // true of both directions.
        'registerExternalMcpServer',
        'removeExternalMcpServer',
        // Only a person can decide an agent’s request to register a server.
        'decideMcpServerRequest',
        // ⛔ **558 · the rename and the removal** (`HO-063` gaps 1 and 2). ⚠️ The removal is the
        // strongest member of this list: an agent that could remove an identity could remove the
        // one holding the grant that refuses it.
        'setAgentDisplayName',
        'removeAgent',
        // A person archives, restores or deletes a conversation; an agent never does.
        'archiveConversation',
        'restoreConversation',
        'checkDeleteConversation',
        'deleteConversation',
        // ⛔ **677 · a person's model and effort, and its read** (`R25`).
        'setAgentModelAndEffort',
        'agentModelAndEffort',
      ]) {
        const at = ipcCode.indexOf(`case '${kind}':`)
        expect(at, `${kind} has no case in the command dispatcher`).toBeGreaterThan(0)
        expect(ipcCode.slice(at, at + 200), `${kind} is not gated on a person asking`).toContain(
          'requireAPerson(sink, command.kind)',
        )
      }
      expect(ipcCode).toContain('sink.aPersonIsBehindIt')

      // 3 · ⛔ **and the door does not reach an agent.** `agent-tools.ts` publishes a closed
      //     inventory (347); this is the negative with a search shape — the tools module names
      //     none of the three verbs and none of the capability columns.
      const tools = withoutComments(
        readFileSync(join(srcRoot, 'main/runtime/agent-tools.ts'), 'utf8'),
      )
      expect(tools).toContain('give_work')
      for (const name of [
        'agentIdentities',
        'setCapabilities',
        'setSpawningEnabled',
        // 🔴 **500 · and this is the one that matters most in this list.** A tool that could set the
        // person's launch default would let an agent decide what the NEXT conversation a person
        // opens asks before acting — the same shape as granting itself a capability, one door over.
        'setDefaultApprovalMode',
        // 🔴 **516 · and these two most of all.** A tool that could register an MCP server would let
        // an agent hand ITSELF a set of tools this app has never seen, at an address it chose — the
        // whole point of HO-040 §4.2 being that a person registers and a person grants.
        'registerExternalMcpServer',
        'removeExternalMcpServer',
        // Only a person can decide an agent’s request to register a server.
        'decideMcpServerRequest',
        // 🔴 **558 · and the removal most of all.** ⛔ A tool that could remove an identity could
        // remove the one whose grant refuses it — and could take out the project manager a person
        // is mid-conversation with. ⚑ The rename is beside it for `485`'s reason: what an agent is
        // CALLED is what every surface in this app draws it by.
        'setAgentDisplayName',
        'removeAgent',
        // A person archives, restores or deletes a conversation; an agent never does.
        'archiveConversation',
        'restoreConversation',
        'checkDeleteConversation',
        'deleteConversation',
        // 🔴 **677 · and the model choice most of all for THIS rule.** ⛔ A tool that could set an
        // identity's model would let a spawner write the very choice the spawn rail refuses it to
        // overrule — the habit standing rule 32 exists to stop, laundered through a second door.
        // ⚑ **D-042 moved the fact this sentence stood on**: an agent now CHOOSES — `give_work`
        // names its helper's pair for that one conversation, and `create_agent` the default of the
        // agent it makes — both through `model-rails.ts`' one seam.
        // ⛔ What stays banned is the person's door: a tool reaching it would rewrite ANY agent's
        // default, past that seam.
        'setAgentModelAndEffort',
        'agentModelAndEffort',
        'model_choice',
        ...CAPABILITY_FIELDS.map((field) => field.key),
        ...CAPABILITY_FIELDS.map((field) => field.column),
      ]) {
        expect(tools.toLowerCase(), `an agent tool names ${name}`).not.toContain(name.toLowerCase())
      }
    })

    it('🔴 the admission token appears in exactly two files, and nothing in `src` forges one', () => {
      // ⛔ **A census over the WHOLE of `src`, because the claim is about the whole of it.** The
      // brand makes an unadmitted spawn a compile error; the only way past that is a cast, and a
      // cast is a string this walk can find. ⚠️ It is written as an enumeration rather than as
      // *"grep runtime-host"* because a pointer clause is a claim: 340's census could name its one
      // caller, and this one has to be able to see a second file appearing.
      const files = new Map<string, string>()
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) walk(path)
          else if (entry.name.endsWith('.ts'))
            files.set(
              path.slice(srcRoot.length + 1).replaceAll('\\', '/'),
              readFileSync(path, 'utf8'),
            )
        }
      }
      walk(srcRoot)
      // The positive that proves the walk ran and found real code.
      expect(files.size).toBeGreaterThan(50)
      expect([...files.keys()]).toContain('main/runtime/runtime-host.ts')

      // ⚠️ **Comments stripped first, because these files DISCUSS the cast in prose** — and a census
      // that cannot tell a warning about a hazard from the hazard is one that will be deleted the
      // first time it fires on a docblock.
      //
      // 🔴 **This was declared BELOW the enumeration and applied only to the cast half, and `379`
      // found it by writing a docblock** — one that quotes `362` §4.2's finding that a task id is
      // *"absent from `SpawnRequest`, `AdmittedSpawn`, …"*. ⛔ The naming line then reported
      // `shared/runtime-ipc.ts` as a third file holding the admission token, which is a sentence
      // about a type it does not use. ⚠️ The comment above already claimed the stripping; it is now
      // true of both halves, which is what it says.
      const withoutComments = (text: string): string =>
        text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      const naming = [...files]
        .filter(([, text]) => withoutComments(text).includes('AdmittedSpawn'))
        .map(([name]) => name)
      expect(naming.sort()).toEqual(['main/runtime/runtime-host.ts', 'main/runtime/spawn-rails.ts'])
      // ⚑ **The control that the strip did not blind the census**: the two files are still found,
      // and they are found because their CODE names the type — which is exactly what a third file
      // appearing would have to do to be reported.
      expect(naming).toHaveLength(2)
      const RAILS = 'main/runtime/spawn-rails.ts'
      const casts = (text: string): RegExpMatchArray[] => [
        ...withoutComments(text).matchAll(/as\s+(?:unknown\s+as\s+)?AdmittedSpawn/g),
      ]
      for (const [name, text] of files) {
        if (name === RAILS) continue
        expect(casts(text), `${name} forges an admission token`).toHaveLength(0)
      }
      // ⛔ **One cast, in the module that owns the brand, on the line that REGISTERS the token.** The
      // brand has to be constructed somewhere; what makes that safe is that the only place it can be
      // is the place `minted.add` runs, so a construction that does not register is not expressible
      // without adding a second cast this census would then see.
      //
      // ⚑ **D-017 · R10 — TWO doors mint one now, and each cast is still the line that registers
      // it**: `admitGive`'s (it was `admitSpawn`'s until D-016), and `admitAReplacement`'s — the
      // conversation a parent already started,
      // carried on in a new one because its own record can never be reopened. ⛔ So the count is
      // two, and each cast is followed by the `minted.add` of that very object: a construction that
      // does not register is still not expressible without a third cast this census would see.
      const rails = files.get(RAILS) ?? ''
      expect(casts(rails)).toHaveLength(2)
      expect([...withoutComments(rails).matchAll(/minted\.add\(/g)]).toHaveLength(2)
      // ⚑ **Each cast registers the object it built**: `start` in `admitGive`, `admitted` in
      // `admitAReplacement`.
      expect(
        [...withoutComments(rails).matchAll(/\} as AdmittedSpawn\n\s*minted\.add\((\w+)\)/g)]
          .map((one) => one[1])
          .sort(),
      ).toEqual(['admitted', 'start'])
      expect(withoutComments(rails)).toMatch(/const start = \{/)
      expect(withoutComments(rails)).toMatch(/const admitted = \{/)
      // ⚑ **The positive that keeps the strip honest** — both files WARN about the cast in prose, so
      // a `withoutComments` that ate nothing would have failed the loop above, and one that ate the
      // whole file would fail here.
      // ⚑ **D-016** — the rails' prose names the cast as *"out of a cast"* (`wasAdmitted`).
      expect(rails).toMatch(/rather than out of a cast/)
      expect(withoutComments(rails)).not.toMatch(/rather than out of a cast/)
      // …and the calls that may pass one are the give door's and — ⚑ **D-017 · R10** — the
      // replacement's, whose token is `admitAReplacement`'s or none.
      // ⛔ **Prose-stripped BEFORE the slice, and 376 is what found that it had to be.** This read
      // `host_.slice(at, at + 700)`, and a comment added inside the call pushed `admitted,` past
      // 700 characters — a green that depends on how much a neighbouring line explains itself.
      // ⚑ A fixed-width slice is also the hazard from the other side: too wide and it runs into the
      // next region and answers this question with somebody else's lines.
      const host_ = withoutComments(files.get('main/runtime/runtime-host.ts') ?? '')
      // ⚠️ **Scoped to each call by its own closing `)`**, not by a character count —
      // `an-assertion-can-be-satisfied-by-a-neighbouring-element`, and `a-fixed-width-slice` beside
      // it. A call ends at the first `)` that closes it; the token is its last argument.
      const calls = [...host_.matchAll(/this\.createSession\(/g)].map((one) =>
        host_.slice(one.index, host_.indexOf('\n    )', one.index)),
      )
      expect(calls).toHaveLength(2)
      const door = calls.find((call) => call.includes('provider: start.provider'))
      expect(door, "the give door's createSession call was not found whole").toBeDefined()
      expect(door).toMatch(/\bstart,\s*$/)
      // ⚑ …and that `start` is the one `admitGive` minted — never one built here.
      expect(host_).toMatch(/const \{ start \} = goes/)
      const replacing = calls.find((call) => call !== door)
      expect(replacing, "the replacement's createSession call was not found whole").toMatch(
        /\bspawn,\s*$/,
      )
      // ⚑ …and that `spawn` is the replacement door's token or nothing — never one built here.
      expect(host_).toMatch(/const spawn =\s*parent === null\s*\? null\s*: admitAReplacement\(/)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · every rail, refused — and the same call, one fact over, allowed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · each rail, watched failing', () => {
    /** The world in which a give of `worker` from `pm` is allowed. Every test below breaks ONE fact. */
    const ready = async (): Promise<string> => {
      const parent = await personOpens('pm')
      await bringIdentityIntoBeing('worker')
      return parent
    }
    /** The person's window, as a caller — the one that may change a conversation's mode. */
    const theWindow = { ownerId: 'webContents:1' }

    it('⚑ THE POSITIVE · a give that passes every rail opens a conversation nobody is watching', async () => {
      const parent = await ready()
      const outcome = await give(aPiece('worker'), as(parent))
      // ⚑ **677 · the answer says what the launch ran on** (`R25`). 🔴 **D-042 · R1 moved a fact
      // here: `started` became `runsOn`, and a start NAMES its pair** — with nothing chosen (the give
      // names none, `worker` has no default, nobody picked one on Claude) it is no longer NOTHING
      // from nobody but the provider's default BY NAME: Claude's `default` alias at `medium` (W4.28) — its
      // effort said as a request (`effortReported: false`, R5), because Claude reports none.
      expect(outcome).toEqual({
        ok: true,
        piece: expect.any(String),
        // ⚑ **R4 — the first piece under the giver's root**, numbered before the brief was sent.
        label: `${String(store.rootOf(parent)?.label)}.1`,
        owner: expect.any(String),
        found: expect.any(String),
        profile: 'worker',
        delivery: 'sent',
        runsOn: {
          provider: 'claude',
          model: 'default',
          effort: 'medium',
          effortReported: false,
          how: 'started',
          from: 'the-providers-default',
          // ⚑ What the give itself named — nothing, so the answer claims neither half.
          named: { model: false, effort: false },
        },
        startedIn: work,
        startedOnDefault: true,
        // ⚑ W4.189 · a give that names no folder records none.
        givenFolder: null,
        folderNotGranted: null,
        grantReach: null,
        // ⚑ **D-016, commit 5 · the files kept as its inputs** — none handed over, so none kept.
        inputs: [],
      })
      const given = admitted(outcome)
      expect(given.found).toBe(given.owner)
      // ⛔ Born without a surface (336's door), and drivable by the giver (340's). The window that
      // opened the PARENT is handed nothing when it asks for what it may attach to.
      expect(host.attachOpenSessions(window).map((open) => open.sessionId)).toEqual([parent])
      expect(sessionIdsOf()).toContain(given.owner)
      // …and it is the giver's child, and the piece sits one below the giver's root.
      expect(store.parentOf(given.owner)).toBe(parent)
      expect(store.depthOf(given.piece)).toBe(1)
    })

    it('🔴 criterion 10 · an unrecognised key is REFUSED, not stripped — and no session is created', async () => {
      const parent = await ready()
      const before = sessionIdsOf().length
      const outcome = await give(
        // ⛔ **303 B, verbatim**: a command arrived with eight keys and parsed to seven. Zod's
        // DEFAULT is to strip this silently, which is the defect; `.strict()` is the rail.
        aPiece('worker', { priority: 'high' }),
        as(parent),
      )
      expect(await refusalOf(outcome)).toBe('malformed-request')
      if (outcome.ok) throw new Error('unreachable')
      expect(
        (outcome.refusal.detail as { problems?: readonly string[] }).problems?.join(' '),
      ).toMatch(/priority/)
      expect(sessionIdsOf()).toHaveLength(before)
    })

    it('⛔ criterion 8 · a give with no brief is refused by the schema, before anything exists', async () => {
      // ⚑ **D-016 · the why is the piece** — its title and its brief — where it was a spawn's reason.
      const parent = await ready()
      const before = sessionIdsOf().length
      expect(await refusalOf(await give({ profile: 'worker', title: 'x' }, as(parent)))).toBe(
        'malformed-request',
      )
      expect(await refusalOf(await give(aPiece('worker', { brief: '   ' }), as(parent)))).toBe(
        'malformed-request',
      )
      expect(await refusalOf(await give(aPiece('worker', { title: '  ' }), as(parent)))).toBe(
        'malformed-request',
      )
      expect(sessionIdsOf()).toHaveLength(before)
    })

    it('🔴 criterion 7 · the kill switch refuses a START mid-session, ends nothing running, and still lets work reach a conversation the giver has', async () => {
      const parent = await ready()
      const first = admitted(await give(aPiece('worker'), as(parent)))

      // ⛔ Thrown while both conversations are running — that is what "mid-session" means.
      store.setSpawningEnabled(false)
      await bringIdentityIntoBeing('second')
      expect(await refusalOf(await give(aPiece('second'), as(parent)))).toBe('spawning-disabled')
      // ⚑ **…and the child that was already running is still running.** The switch refuses; it does
      // not kill.
      expect(sessionIdsOf()).toContain(first.owner)
      // ⚑ **Plan ruling 12 — the switch refuses only a give that would START a conversation**: the
      // one this giver already has with `worker` still takes work.
      expect(admitted(await give(aPiece('worker'), as(parent))).owner).toBe(first.owner)

      // The paired positive: flip it back and the identical call succeeds.
      store.setSpawningEnabled(true)
      expect((await give(aPiece('second'), as(parent))).ok).toBe(true)
    })

    it('⛔ the fail-closed half · a database with no policy row refuses every start', async () => {
      const parent = await ready()
      db.prepare(`DELETE FROM app_policy`).run()
      expect(store.spawnPolicy()).toEqual({ spawningEnabled: false })
      expect(await refusalOf(await give(aPiece('worker'), as(parent)))).toBe('spawning-disabled')
    })

    it('⛔ a giver that is not running here gives nothing, and a live one gives', async () => {
      // ⚑ **D-016c · ruling (b)** — a caller that speaks as no conversation this host holds has no
      // piece to give from, and is told so before the rails are asked; it was `malformed-request`,
      // which said a well-formed request could not be read.
      const parent = await ready()
      expect(await refusalOf(await give(aPiece('worker'), as('sess_nobody')))).toBe(
        'no-piece-to-give-from',
      )
      expect((await give(aPiece('worker'), as(parent))).ok).toBe(true)
    })

    it('🔴 a caller that is not the giving conversation — its commander, or a stranger — may not spend it', async () => {
      // ⚑ **D-016 · a give takes no parent**: the giver is the conversation the caller speaks AS, so
      // a caller that commands a conversation (340) and one that was given nothing are one answer —
      // neither holds a piece to give from, and D-016c's ruling (b) says exactly that.
      await bringIdentityIntoBeing('worker')
      await bringIdentityIntoBeing('pm')
      const { sessionId: parent } = await host.createSession(
        { provider: 'claude', profileId: 'pm', cwd: work },
        null,
        PLANNER,
      )
      expect(await refusalOf(await give(aPiece('worker'), PLANNER))).toBe('no-piece-to-give-from')
      expect(await refusalOf(await give(aPiece('worker'), STRANGER))).toBe('no-piece-to-give-from')
      expect((await give(aPiece('worker'), as(parent))).ok).toBe(true)
    })

    it('🔴 criterion 12 · an unknown profile slug is REFUSED, and no identity is created for it', async () => {
      const parent = await personOpens('pm')
      // ⛔ Any agent may give work to any identity that EXISTS (D-014); R3 refuses the rest unless
      // the giver asks for a new one.
      expect(await refusalOf(await give(aPiece('ghost'), as(parent)))).toBe('no-such-profile')
      // ⚑ **And nothing was created for it** — not a row, not a capability, not a home.
      expect(store.capabilitiesOf('ghost')).toBeNull()
      expect(store.setCapabilities('ghost', { maxDepth: 9 })).toBe(false)
      // The paired positive: the same call against a name a PERSON has used.
      await bringIdentityIntoBeing('ghost')
      expect((await give(aPiece('ghost'), as(parent))).ok).toBe(true)
    })

    it('⚑ an identity, not a spelling — `worker` exists, so a give to `Worker` is admitted', async () => {
      const parent = await personOpens('pm')
      await bringIdentityIntoBeing('worker')
      // ⛔ **The identity is what the existence rail is about** (187/238): `Worker` and `worker` are
      // one agent over one home, so refusing this would be telling an agent it may not be itself.
      const allowed = admitted(await give(aPiece('Worker'), as(parent)))
      // ⚠️ …and the SPELLING survives into the row, because that column names a directory.
      expect(store.find(allowed.owner)?.profileId).toBe('Worker')
    })

    /**
     * ⚑ **A chain of gives, one level at a time, from the conversation a person opened.** Each level
     * gives its own identity a piece under the one it holds, asked AS that level's conversation.
     * Returns the conversation at each depth, index 0 being the person's own.
     */
    const chainTo = async (deepest: number): Promise<string[]> => {
      for (let depth = 1; depth <= deepest + 1; depth++) await bringIdentityIntoBeing(`w${depth}`)
      const chain = [await personOpens('pm')]
      for (let depth = 1; depth <= deepest; depth++) {
        const next = await give(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: `w${depth}`,
            title: `Level ${depth}`,
            brief: `level ${depth}`,
          },
          as(chain[depth - 1] as string),
        )
        if (!next.ok) throw new Error(`depth ${depth} was refused: ${next.refusal.rail}`)
        expect(store.depthOf(next.piece)).toBe(depth)
        chain.push(next.owner)
      }
      return chain
    }

    it('🔴 HO-005 Q3 · a person’s root is depth 0, the default admits depth 6, and depth 7 is refused', async () => {
      const [person, ...below] = await chainTo(6)
      if (person === undefined) throw new Error('no conversation was opened')
      expect(store.depthOf(store.rootOf(person)?.piece ?? 'no root')).toBe(0)
      expect(below).toHaveLength(6)
      // ⛔ The conversation holding depth 6 gives at depth 7, and the default `max_depth` of 6
      // refuses it.
      const seven = await give(aPiece('w7'), as(below.at(-1) as string))
      expect(await refusalOf(seven)).toBe('too-deep')
      if (seven.ok) throw new Error('unreachable')
      expect(seven.refusal.detail).toMatchObject({ depth: 7, maxDepth: 6 })
    })

    it('⚑ `max_depth` is overridable per profile, which is the ruling — an exception you can point at', async () => {
      const chain = await chainTo(6)
      // ⛔ **The GIVER's row decides**, and the giver here is `w6` — the same call that was refused
      // in the test above now passes, and the only thing that changed is one row.
      grant('w6', { maxDepth: 7 })
      expect((await give(aPiece('w7'), as(chain[6] as string))).ok).toBe(true)
    })

    it('🔴 HO-036 · a conversation a give starts may never be WIDER than the giver starting it', async () => {
      // ⚑ **D-016 · a give carries no mode**: the conversation it starts runs in its giver's, on
      // the identity's own provider — so the rail weighs that provider.
      // 🔴 **D-038 moved this fact (F050)**: the rail compares REACH — what each side keeps between
      // a write or a command past its folder and that act running unasked — and no longer what each
      // mode takes off its own provider's `ask`. Claude `auto` keeps nothing there and Codex `auto`
      // keeps nothing, so a lax Claude giver's Codex agent reaches no further than its giver: it was
      // refused here for the sandbox Codex's `auto` takes off, and ⛔ it is GIVEN now, and runs.
      await bringIdentityIntoBeing('worker')
      expect(store.setAgentProvider('worker', 'codex')).toBe(true)
      const lax = await personOpens('pm', { approvalMode: 'auto' })
      const given = admitted(await give(aPiece('worker'), as(lax)))
      // ⚑ **D-042 moved where a start is said** — `started` (null for a conversation that existed)
      // became `runsOn.how`.
      expect(given.runsOn.how).toBe('started')
      expect(given.delivery).toBe('sent')
      expect(host.sessionIds).toContain(given.owner)
      expect(store.find(given.owner)).toMatchObject({ approvalMode: 'auto', provider: 'codex' })

      // ⚑ **The paired positive, one fact over** — an `ask` giver: its Codex child starts in `ask`,
      // which keeps the card AND the sandbox past its folder. ⏸ In its folder that child writes and
      // runs commands with nobody asked, where its Claude `ask` giver is asked — the pair held for a
      // ruling (D-038 F-A), given as before.
      const asking = await personOpens('pm2', { approvalMode: 'ask' })
      const allowed = admitted(await give(aPiece('worker'), as(asking)))
      expect(store.find(allowed.owner)).toMatchObject({ approvalMode: 'ask', provider: 'codex' })

      // 🔴 **…and WIDER is still refused: an `ask` giver whose child would run in `auto`.** ⚠️ No
      // give can ask for it — the child takes its giver's mode, so a same-mode pair is never wider
      // (D-038 F-B) — so the rail's own comparison is asked, the one `admitGive` calls.
      const wouldLack = whatTheChildWouldLack(
        { provider: 'codex', approvalMode: 'auto' },
        { provider: 'claude', approvalMode: 'ask' },
      )
      expect(wouldLack).toEqual(['the-card-before-an-act'])
      // ⚑ …against the admission above, one fact over: the same child under an `auto` giver.
      expect(
        whatTheChildWouldLack(
          { provider: 'codex', approvalMode: 'auto' },
          { provider: 'claude', approvalMode: 'auto' },
        ),
      ).toEqual([])
      // ⛔ **The third field names what the GIVER keeps** (D-038: `alsoRemoves` became `wouldLack`),
      // and the sentence leads with the act.
      const said = describeRail('wider-than-its-parent', {
        asked: 'auto',
        spawnerRunsAs: 'ask',
        wouldLack,
      })
      expect(said).toContain(
        'Do this work here, or ask a person whether to change your approval mode',
      )
      expect(said).toContain('you run in “ask”, with the card before you act,')
      expect(said).toContain('would run in “auto”')
      expect(permanenceOf('wider-than-its-parent')).toBe('until-a-person-changes-it')
      expect(retryableOf('wider-than-its-parent')).toBe(false)
    })

    it('🔴 THE DIVERGENCE · an `auto` giver hands `auto` down, which is the half HO-036 restored', async () => {
      await bringIdentityIntoBeing('worker')
      // Use the `auto` giver’s give call, where mode inheritance is observable. An `ask`
      // giver cannot exercise the distinction.
      const lax = await personOpens('pm', { approvalMode: 'auto' })
      const loud = admitted(await give(aPiece('worker'), as(lax)))
      expect(store.find(loud.owner)?.approvalMode).toBe('auto')
      // …and the giver is still what it was. Inheritance reads it; it does not move it.
      expect(store.find(lax)?.approvalMode).toBe('auto')
    })

    it('🔴 a giver GIVING UP its laxness counts as `ask` already — 341 M18`s clause, restored', async () => {
      // 🔴 **The one state where *what is running* and *what may be spent* differ** — `499`
      // restored `effectiveApprovalOf`. ⛔ A giver that has asked to start prompting again is one
      // whose laxness is being GIVEN UP; spending it on a child would hand a permanent `auto`
      // conversation to a giver that will be prompting by the time the child says anything.
      await bringIdentityIntoBeing('worker')
      await bringIdentityIntoBeing('reviewer')
      expect(store.setAgentProvider('reviewer', 'codex')).toBe(true)
      const lax = await personOpens('pm', { approvalMode: 'auto' })
      // ⚠️ **Requested, not adopted.** No turn has been sent, so `effective` is still `auto`.
      await host.setApprovalMode(lax, 'ask', theWindow)

      // ⚑ **The strict reading is what a give spends**: the child starts in `ask` …
      const quiet = admitted(await give(aPiece('worker'), as(lax)))
      expect(store.find(quiet.owner)?.approvalMode).toBe('ask')
      // ⛔ …and the Codex identity is admitted, and starts in `ask` too — so this is a test of the
      // FOLD, not of a door that refuses a giver mid-change. ⚑ **D-038 moved this fact (F050)**: the
      // lax reading would no longer be refused `wider-than-its-parent` either — it would start the
      // Codex conversation in `auto` — so what tells the fold here is the mode, not the admission.
      const codex = admitted(await give(aPiece('reviewer'), as(lax)))
      expect(store.find(codex.owner)?.approvalMode).toBe('ask')
      // ⚠️ **And the giver's ROW says `ask` already** — the change lands at the next turn, and a
      // resume IS a next turn. ⛔ Three readings of one setting; the rail spends the strictest.
      expect(store.find(lax)?.approvalMode).toBe('ask')
    })

    it('⛔ …and the giver and the depth are asked first, whatever the identity runs on — R2’s order', async () => {
      // 🔴 **The ordering claim, performed** (R2): the giver, its piece, the grant and the depth are
      // asked before the lookup, and `wider-than-its-parent` only when nothing was found — so each
      // case below answers its OWN rail whichever provider the identity it names runs on.
      // ⚠️ **D-038 took this test's last rail away (F-B)**: a Codex identity under a lax Claude
      // giver is no longer wider (F050), and no give can meet `wider-than-its-parent` at all — the
      // child takes its giver's mode, and a same-mode pair is never wider — so the rail's place
      // after these two can no longer be performed here. ⏸ What stays performed is that these two
      // answer before the identity's provider is read, and that the give they stood in front of
      // now goes through.
      await bringIdentityIntoBeing('worker')
      expect(store.setAgentProvider('worker', 'codex')).toBe(true)
      await bringIdentityIntoBeing('plain')
      const lax = await personOpens('pm', { approvalMode: 'auto' })
      // ⚑ A second lax giver whose own row admits no depth at all — so the controls below land on
      // DIFFERENT rails rather than one twice.
      const shallow = await personOpens('shallow', { approvalMode: 'auto' })
      grant('shallow', { maxDepth: 0 })
      const cases: { name: string; by: CallerIdentity; otherwise: string }[] = [
        {
          name: 'a giver that is not running',
          by: as('sess_nobody'),
          otherwise: 'no-piece-to-give-from',
        },
        { name: 'a giver already at its deepest', by: as(shallow), otherwise: 'too-deep' },
      ]
      for (const { name, by, otherwise } of cases) {
        // ⛔ **The Codex identity changes NOTHING about which rail answers.**
        expect(await refusalOf(await give(aPiece('worker'), by)), name).toBe(otherwise)
        // ⚑ **The control that makes the line above a statement about ORDER**: the same call to an
        // identity on the giver's own provider reaches the same rail.
        expect(await refusalOf(await give(aPiece('plain'), by)), name).toBe(otherwise)
      }
      // 🔴 **…and the paired POSITIVE**: every fact those rails read is present here, so the give
      // goes on past them — ⚑ and since D-038 (F050) nothing below refuses it: it was
      // `wider-than-its-parent` here, and it is given, and runs in `auto` on Codex.
      const given = admitted(await give(aPiece('worker'), as(lax)))
      expect(given.delivery).toBe('sent')
      expect(store.find(given.owner)).toMatchObject({ approvalMode: 'auto', provider: 'codex' })
      expect(new Set(cases.map((one) => one.otherwise)).size).toBe(cases.length)
    })

    it('⛔ the kill switch still answers first, because that is the more important sentence', async () => {
      await bringIdentityIntoBeing('worker')
      expect(store.setAgentProvider('worker', 'codex')).toBe(true)
      const lax = await personOpens('pm', { approvalMode: 'auto' })
      store.setSpawningEnabled(false)
      // ⚠️ With starting switched off app-wide, a giver must hear the switch — being told about
      // anything else would send it to fix a thing that was never going to be the reason.
      // ⚑ **D-038 moved this fact (F050)**: this give was also wider until the rail compared reach;
      // it is not now, so the switch is the ONLY thing standing in front of it.
      expect(await refusalOf(await give(aPiece('worker'), as(lax)))).toBe('spawning-disabled')
      // 🔴 **…and the paired positive, one fact over**: the switch back on, and the same give goes.
      store.setSpawningEnabled(true)
      const given = admitted(await give(aPiece('worker'), as(lax)))
      expect(store.find(given.owner)).toMatchObject({ approvalMode: 'auto', provider: 'codex' })
    })

    it('🔴 HO-005 §3 · a giver that has this identity’s conversation gives to IT — a piece that stalled there is NAMED to the next give, a stop keeps the stalls, and the give after a take-back finds the one in its place', async () => {
      // ⚑ **D-016 · the one conversation per helper per giver** — the second give is not refused
      // for the conversation it finds (`profile-already-live` went), it REACHES it; ⚑ and
      // its outcome names the piece that stalled there. ⚠️ An `auto` giver, so the child's brief
      // turn ends at once — with its piece still open.
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', { approvalMode: 'auto' })
      const first = admitted(await give(aPiece('worker'), as(parent)))
      const live = first.owner
      await until(
        () => store.events(live).some((row) => row.event.type === 'turn'),
        'the brief turn to end',
      )
      const second = admitted(await give(aPiece('worker'), as(parent)))
      // ⚑ **Actionable**: the caller is told WHICH of its pieces stalled, in the same conversation.
      expect(second.owner).toBe(live)
      expect(second.stalled).toEqual([{ label: first.label, cause: 'turn_ended' }])

      // ⚑ **A STOP changes nothing about the pieces** — both stalled before the stop (the
      // second's own brief ended with it open too), so both keep their cause. ⛔ And the give found
      // the one conversation of that identity this giver has: no second one was started.
      await until(
        () => store.events(live).filter((row) => row.event.type === 'turn').length >= 2,
        'the second brief turn to end',
      )
      await host.close(live, THE_APP_ITSELF)
      expect(sessionIdsOf()).not.toContain(live)
      expect(store.openPiecesOf(live).map((one) => one.stalledBecause)).toEqual([
        'turn_ended',
        'turn_ended',
      ])
      // ⚑ **Once the giver takes the piece back — the remedy it was named — the next give reaches
      // the stopped child's place.** ⚠️ This host's provider keeps no session across launches, so
      // the stopped one can never be reopened: the take-back's telling is where the conversation
      // that takes its place (R10) is started, and the give finds THAT one — never a second one of
      // the giver's own.
      expect(await host.takeBackPiece({ piece: first.piece }, as(parent))).toMatchObject({
        ok: true,
        owner: live,
      })
      const inItsPlace = host.tookItsPlace(live)
      expect(inItsPlace).not.toBeNull()
      const again = admitted(await give(aPiece('worker'), as(parent)))
      expect(again.found).toBe(inItsPlace)
      // ⚑ **D-042 moved where *no start* is said** — `started: null` became `runsOn.how`: a give
      // that reaches the conversation it has, naming no model, leaves its pair `unchanged`.
      expect(again.runsOn.how).toBe('unchanged')
      expect(again.owner).toBe(inItsPlace)
      expect(store.parentOf(again.owner)).toBe(parent)
      // ⚑ **The paired positive, one fact over** — another identity, same giver, same call: a new
      // conversation, because this giver has none with that one.
      await bringIdentityIntoBeing('reviewer')
      expect((await give(aPiece('reviewer'), as(parent))).ok).toBe(true)
    })

    it('⚑ 428 · …and a conversation a PERSON opened as that identity is never the one a give finds', async () => {
      // ⛔ **HO-023 §4's other half.** A person talking to `worker` is not any giver's child, so the
      // lookup does not find it — and the person's conversation stands untouched beside the one the
      // give starts.
      const parent = await ready()
      const theirs = await personOpens('worker')
      const given = admitted(await give(aPiece('worker'), as(parent)))
      expect(given.owner).not.toBe(theirs)
      // ⚑ **D-042** — `started` became `runsOn.how` (see THE POSITIVE).
      expect(given.runsOn.how).toBe('started')
      expect(sessionIdsOf()).toContain(theirs)
    })

    it('⚑ 428 · …and a SECOND giver starts its own conversation of the identity the first has', async () => {
      // ⚠️ *"Two different parents, in the same project or different ones, is demand."*
      const first = await ready()
      const second = await personOpens('pm2')
      const mine = admitted(await give(aPiece('worker'), as(first)))
      const theirs = admitted(await give(aPiece('worker'), as(second)))
      expect(theirs.owner).not.toBe(mine.owner)
      // ⚑ **D-042** — `started` became `runsOn.how` (see THE POSITIVE).
      expect(theirs.runsOn.how).toBe('started')
      // …and the first giver's next give reaches the one it has, which is the paired negative.
      const again = admitted(await give(aPiece('worker'), as(first)))
      expect(again.owner).toBe(mine.owner)
      // ⚑ It names no model, so the one it has is left `unchanged` — never `started`.
      expect(again.runsOn.how).toBe('unchanged')
    })

    it('⛔ …and the lookup folds case, because `Developer` and `developer` are one identity', async () => {
      const parent = await personOpens('pm')
      await bringIdentityIntoBeing('worker')
      // ⚑ **The conversation is this giver's own child, started under the OTHER spelling** (`428`).
      const first = admitted(await give(aPiece('Worker'), as(parent)))
      const second = admitted(await give(aPiece('worker'), as(parent)))
      expect(second.owner).toBe(first.owner)
      // ⚑ **D-042** — `started: null` became `runsOn.how`: found, so `unchanged`, never `started`.
      expect(first.runsOn.how).toBe('started')
      expect(second.runsOn.how).toBe('unchanged')
    })

    it('🔴 criterion 11 · the folder is verified before anything is created, in 339’s own words', async () => {
      const parent = await ready()
      const missing = join(work, 'not-here')
      const before = sessionIdsOf().length
      const refused = await give(aPiece('worker', { folder: missing }), as(parent))
      expect(await refusalOf(refused)).toBe('folder-unusable')
      if (refused.ok) throw new Error('unreachable')
      // ⛔ **`checkSessionCwd`'s sentence, naming the directory** — not a second, friendlier copy.
      expect(refused.refusal.detail).toMatchObject({
        folderReason: `cwd does not exist: ${missing}`,
      })
      expect(refused.refusal.reason).toContain(missing)
      // …and nothing was created for it.
      expect(sessionIdsOf()).toHaveLength(before)

      mkdirSync(missing)
      const allowed = admitted(await give(aPiece('worker', { folder: missing }), as(parent)))
      expect(store.find(allowed.owner)?.cwd).toBe(missing)
    })

    it('⚑ an absent folder means the GIVER’s, and it is verified too rather than trusted', async () => {
      const parent = await ready()
      const allowed = admitted(await give(aPiece('worker'), as(parent)))
      expect(store.find(allowed.owner)?.cwd).toBe(work)
      // ⛔ **Verified, not inherited on trust** (170 §3: a cwd that resolved is not a cwd that
      // stays). The giver keeps running in a folder that no longer exists, and the next give that
      // would start a conversation from it is refused for the folder rather than launched into
      // nothing.
      await bringIdentityIntoBeing('second')
      rmSync(work, { recursive: true, force: true })
      expect(await refusalOf(await give(aPiece('second'), as(parent)))).toBe('folder-unusable')
    })

    it('🔴 THE APP ITSELF gives nothing — it holds no piece, and nothing is created', async () => {
      // ⚑ **D-016** — the superuser could spawn on a conversation's behalf until `give_work`; a
      // give is hung under the GIVER's piece, and this app holds none. ⛔ So the one caller a
      // *"trust ourselves"* shortcut would exempt is answered as no giver at all — ⚑ D-016c: in the
      // word that says so.
      await ready()
      const before = sessionIdsOf().length
      const refused = await give(aPiece('worker'), THE_APP_ITSELF)
      expect(await refusalOf(refused)).toBe('no-piece-to-give-from')
      expect(sessionIdsOf()).toHaveLength(before)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the refusal payload — HO-005 criterion 4's shape
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the payload, and the rule that a retry never succeeds', () => {
    it('⛔ every rail has a permanence, and `retryable` is derived from it rather than stated twice', () => {
      for (const rail of SPAWN_RAILS) {
        const permanence = permanenceOf(rail)
        expect(['permanent', 'until-a-person-changes-it', 'while-this-holds']).toContain(permanence)
        expect(retryableOf(rail)).toBe(permanence === 'while-this-holds')
      }
      // ⚠️ **A positive that differs from the default**: the vocabulary is genuinely used, so a
      // table that answered one value for everything would not pass this.
      //
      // 🔴 **All three words again since D-016** (HO-023 §2.1). ⛔ `424` left no spawn rail
      // retryable — nothing a caller could legitimately do made any of them clear. ⚑ **A service's
      // waits are what do**: the same give answers once the work it waits on has ended. ⚑ The stall
      // rule used to refuse, and refuses nothing now.
      expect(new Set(SPAWN_RAILS.map(permanenceOf))).toEqual(
        new Set(['permanent', 'until-a-person-changes-it', 'while-this-holds']),
      )
      // ⛔ **The derivation is measured where the two answers DIFFER**, inside this one vocabulary.
      expect(SPAWN_RAILS.filter(retryableOf)).toEqual([
        'no-free-worker-at-capacity',
        'it-would-wait-on-itself',
        'its-waits-cannot-all-be-checked',
      ])
      expect(remedyOf('no-free-worker-at-capacity')).toBe('make-the-same-call-when-this-settles')
      // ⚑ A service waiting on its caller clears when that work ends: the same give then answers.
      expect(remedyOf('it-would-wait-on-itself')).toBe('make-the-same-call-when-this-settles')
      // ⚑ …and one whose waits reach too far to check clears as that work ends.
      expect(remedyOf('its-waits-cannot-all-be-checked')).toBe(
        'make-the-same-call-when-this-settles',
      )
    })

    it('🔴 no two rails answer with the same sentence — 340’s finding, applied to this vocabulary', () => {
      // ⛔ **The gate 118, 214 and 336 each argued for in prose and none of them left behind.** A
      // rail given another rail's sentence is a refusal that is right and a reason that is a lie,
      // and every per-rail assertion below is about SHAPE, which survives a copy.
      const seen = new Map<string, SpawnRail>()
      for (const rail of SPAWN_RAILS) {
        const sentence = describeRail(rail)
        const first = seen.get(sentence)
        expect(first, `${rail} answers with ${String(first)}'s sentence`).toBeUndefined()
        seen.set(sentence, rail)
      }
      expect(seen.size).toBe(SPAWN_RAILS.length)
    })

    it('🔴 every rail in the vocabulary is REACHED by the door — the twin of 341’s ordering rule', () => {
      // ⛔ **`341` wrote *"a rail added afterwards is a rail that was optional once."* This is the
      // other half, and `366` is where it cost something**: `laxer-approval-mode` asked whether the
      // child would be laxer than its parent, `spawn-must-prompt` refuses `auto` outright, and the
      // moment the second existed the first could not fire. ⚠️ Nothing noticed. Every guard in §2
      // still passed — it had a permanence, a distinct sentence, a row in the table — because all of
      // them ask what a rail SAYS and none of them asked whether anything reaches it. A vocabulary
      // that lists a rule the door no longer applies is a committed statement of a false machine
      // fact, which is the one defect this project treats as worse than no statement at all.
      const rails = readFileSync(join(srcRoot, 'main/runtime/spawn-rails.ts'), 'utf8')
      // ⚑ Prose-stripped, so a rail that survives only as a sentence in a docblock — the exact shape
      // of a retired one — cannot answer for itself.
      const code = rails.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      // ⛔ **The strip did not eat the file**, or every assertion below passes over nothing.
      expect(code).toContain('export function admitGive')
      for (const rail of SPAWN_RAILS) {
        expect(code, `${rail} is in the vocabulary and nothing refuses with it`).toContain(
          `no('${rail}'`,
        )
      }
      // ⚑ **The control, and it is what makes the loop a claim about CODE.** A name that appears
      // only inside a comment must fail the same test — so the strip is doing the work rather than a
      // `toContain` that a docblock quoting `no('…')` would satisfy on its own.
      const planted = `/** a retired rail nothing calls: no('${'once-a-rail'}') */`
      expect(rails + planted).toContain(`no('once-a-rail'`)
      expect((rails + planted).replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toContain(`no('once-a-rail'`)
    })

    it('⛔ every sentence reads as one, names no session id, and says what to do', () => {
      for (const rail of SPAWN_RAILS) {
        const sentence = describeRail(rail)
        expect(sentence.length, rail).toBeGreaterThan(40)
        expect(sentence, rail).toMatch(/[.!]$/)
        expect(sentence, rail).not.toMatch(/sess_/)
        // ⚠️ **No internal state name.** A rail's own slug must not be the thing a reader is handed.
        expect(sentence.toLowerCase(), rail).not.toContain(rail)
      }
    })

    it('🔴 a model that retries a permanent refusal is refused every time, and creates nothing', async () => {
      const parent = await personOpens('pm')
      const before = sessionIdsOf().length
      const rails: string[] = []
      for (let attempt = 0; attempt < 5; attempt++) {
        rails.push(await refusalOf(await give(aPiece('ghost'), as(parent))))
      }
      // ⚑ *"A model that retries against a permanent refusal is a finding worth recording, not a
      // failed criterion. **What must never happen is a retry that SUCCEEDS.**"*
      expect(rails).toEqual(Array.from({ length: 5 }, () => 'no-such-profile'))
      expect(permanenceOf('no-such-profile')).toBe('permanent')
      expect(retryableOf('no-such-profile')).toBe(false)
      expect(sessionIdsOf()).toHaveLength(before)
      expect(store.capabilitiesOf('ghost')).toBeNull()
    })

    it('⚠️ the request schema is `.strict()`, which is the whole of criterion 10', () => {
      const good = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      }
      expect(giveRequestSchema.safeParse(good).success).toBe(true)
      // ⛔ **The mutation this pins**: drop `.strict()` and this parse SUCCEEDS with the key gone —
      // 303 B's eight-keys-into-seven, exactly.
      const extra = giveRequestSchema.safeParse({ ...good, priority: 'high' })
      expect(extra.success).toBe(false)
      // …and the path a profile name may not take.
      expect(giveRequestSchema.safeParse({ ...good, profile: '../escape' }).success).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · what survives a restart, and what does not
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · who started it, and why, outlives the process', () => {
    it('🔴 criterion 8 · who created this and why is still there after a second host over one ledger', async () => {
      const parent = await personOpens('pm')
      await bringIdentityIntoBeing('worker')
      // ⚑ A value that is NOT the ruled default, so the row surviving is what the read below measures.
      grant('pm', { maxDepth: 3 })
      const given = admitted(
        await give(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'worker',
            title: 'Read the ledger',
            brief: 'read the ledger',
          },
          as(parent),
        ),
      )
      await host.closeAll()

      // A restart: a second store and a second host over the same file.
      const reborn = createSessionStore(db)
      // ⚑ **D-016 · WHO is the conversation's parent, and WHY is the piece** — its title and brief,
      // its giver and its owner — where it was the spawn reason on the row.
      expect(reborn.parentOf(given.owner)).toBe(parent)
      expect(reborn.workById(given.piece)).toMatchObject({
        label: given.label,
        owner: given.owner,
        givenBy: parent,
        title: 'Read the ledger',
        brief: 'read the ledger',
      })
      expect(reborn.depthOf(given.piece)).toBe(1)
      // ⛔ **And the capability rows survive too**, which is what makes the rails a property of the
      // app rather than of one run.
      expect(reborn.capabilitiesOf('pm')?.maxDepth).toBe(3)
      expect(reborn.spawnPolicy()).toEqual({ spawningEnabled: true })
    })

    // ⚑ **D-016 · three cases went with the three provenance columns** — `spawned_at` earlier than
    // the row, a row holding only PART of the provenance, and no row holding one column without the
    // other two. The one migration made `parent_session_id` the only column left, and the piece
    // holds the why.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the capability schema itself
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the capability schema', () => {
    it('⛔ an unconfigured profile reads the ruled defaults, and none of them is stored', async () => {
      await bringIdentityIntoBeing('pm')
      expect(store.capabilitiesOf('pm')).toEqual(DEFAULT_CAPABILITIES)
      // ⚑ **Nothing was backfilled** — the columns are still null, so changing the default in code
      // changes every profile that has not chosen. 0016's argument, asserted.
      const row = db
        .prepare(
          // ⚑ **Derived since 374**, so *"none of them is stored"* keeps meaning ALL of them: the
          // four-column list this used to spell could not see a fifth capability go in with a
          // backfill behind it.
          `SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_identity WHERE slug = ?`,
        )
        .get('pm') as Record<string, unknown>
      expect(Object.values(row)).toEqual(CAPABILITY_COLUMNS.map(() => null))
      expect(CAPABILITY_COLUMNS.length).toBeGreaterThanOrEqual(5)
    })

    it('⛔ an edit leaves every field it did not name alone, nulls included', async () => {
      await bringIdentityIntoBeing('pm')
      grant('pm', { canMessage: 'none' })
      const row = db
        .prepare(`SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_identity WHERE slug = ?`)
        .get('pm') as Record<string, unknown>
      // ⛔ **The one field written, and every other one still null** — a round trip through the
      // resolver would have frozen today's defaults into all of them. ⚑ **Derived since 374**: the
      // list this used to name by hand was the one place a new column could arrive already written.
      expect(row.can_message).toBe('none')
      expect(
        CAPABILITY_COLUMNS.filter((column) => column !== 'can_message').map(
          (column) => row[column],
        ),
      ).toEqual(CAPABILITY_COLUMNS.filter((column) => column !== 'can_message').map(() => null))
      expect(CAPABILITY_COLUMNS.length).toBeGreaterThanOrEqual(5)
    })

    it('🔴 a word that is not the right SHAPE never reaches the column — its CHECK refuses it (R6)', async () => {
      await bringIdentityIntoBeing('pm')
      const write = (column: string, value: unknown): void => {
        db.prepare(`UPDATE agent_identity SET ${column} = ? WHERE slug = 'pm'`).run(value)
      }
      // 🔴 **D-016 · R6 — re-aimed from the fold to the CHECK.** `can_message` was the one column
      // `schema.ts` could not afford a CHECK for, so the fold WAS the constraint; ⚑ the one migration
      // builds each column's CHECK from the descriptor the wire's own schema is built from, so a
      // word outside the vocabulary is refused where it is written, by the constraint named for it.
      expect(() => write('can_message', 'everyone')).toThrow(/agent_identity_can_message_ck/)
      // ⛔ …and the row keeps what it said: nothing, which reads the ruled default.
      expect(store.capabilitiesOf('pm')?.canMessage).toBe(DEFAULT_CAPABILITIES.canMessage)
      // ⚑ **The pair, and it is what makes the refusal about the WORD**: both words of the
      // vocabulary land and read as written — `none` is not the default, `any` is not the narrowest.
      write('can_message', 'none')
      expect(store.capabilitiesOf('pm')?.canMessage).toBe('none')
      write('can_message', 'any')
      expect(store.capabilitiesOf('pm')?.canMessage).toBe('any')
      // ⛔ **And a SECOND choice column over the same vocabulary** — `can_assign_work` — refused by
      // its OWN constraint, so a CHECK that named one column for both would fail here.
      expect(() => write('can_assign_work', 'whenever')).toThrow(
        /agent_identity_can_assign_work_ck/,
      )
      write('can_assign_work', 'none')
      expect(store.capabilitiesOf('pm')?.canAssignWork).toBe('none')
      // ⚑ **…and the two are INDEPENDENT.** `can_message` is still `any` while `can_assign_work`
      // is `none`, so a reader that answered one column from the other would disagree with one.
      expect(store.capabilitiesOf('pm')?.canMessage).toBe('any')
      expect(store.capabilitiesOf('pm')?.canMessage).not.toBe(
        store.capabilitiesOf('pm')?.canAssignWork,
      )
    })

    /**
     * 🔴 **374 FLIPPED this assertion, and the flip is the deliverable** (HO-007 §2.1 P3: *"The test
     * asserting no rail branches on `can_message` flips to asserting that one does."*).
     *
     * ⛔ **What it said before, verbatim, and why it was right at the time:**
     *
     * ```
     * it('⚑ `can_message` is shape only in 341, and nothing reads it — said out loud', () => {
     *   const rails = readFileSync(join(srcRoot, 'main/runtime/spawn-rails.ts'), 'utf8')
     *   expect(rails).not.toMatch(/canMessage\s*[=!]==/)
     *   expect(rails).not.toMatch(/\.canMessage\b(?![^\n]*\*)/)
     *   expect(rails).toContain('.canSpawn')
     *   ...
     * ```
     *
     * ⚠️ **Both halves survive, and only one of them moved.** No SPAWN rail branches on it — that
     * assertion is unchanged and is now a claim about a door that is not the messaging one, which is
     * the whole reason `message-rails.ts` is a second file. What flips is the second half: the
     * capability is READ, by name, at a chokepoint, and this is where that stops being a plan.
     */
    it('🔴 `can_message` is a rail now, and the SPAWN door still does not read it', () => {
      const spawn = readFileSync(join(srcRoot, 'main/runtime/spawn-rails.ts'), 'utf8')
      // ⛔ Unchanged from 341: the spawn door may TALK about it in prose; no spawn rail branches on
      // it. A capability read at two doors is 169 §1's defect, and messaging is not spawning.
      expect(spawn).not.toMatch(/canMessage\s*[=!]==/)
      expect(spawn).not.toMatch(/\.canMessage\b(?![^\n]*\*)/)
      // The positive: the one field the SPAWN rails DO read is read (D-014 left `max_depth` alone).
      expect(spawn).toContain('.maxDepth')

      // 🔴 **…and the flip.** Prose-stripped, so a docblock naming the field cannot answer for code.
      const messaging = readFileSync(join(srcRoot, 'main/runtime/message-rails.ts'), 'utf8')
      const code = messaging.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      expect(code).toContain('export function admitReachAtAll')
      // ⛔ **Both capabilities, BY NAME and not by line.** ⚠️ This asked for the two dispatch-table
      // entries verbatim until it was measured: `374`'s own `M7` — *both acts read one capability* —
      // then went red through THIS assertion rather than through the behaviour test written to kill
      // it, which is a row whose verdict it never earned. ⚑ The names are what the flip is about, so
      // the names are what it pins.
      for (const key of ['canMessage', 'canAssignWork']) expect(code).toContain(key)
      // ⚑ **The control, and it is what makes the two lines above a claim about CODE.** A file that
      // only mentioned the field in a comment must fail the same test.
      const planted = `/** a capability nothing reads: message: 'canBroadcast' */`
      expect(messaging + planted).toContain("message: 'canBroadcast'")
      expect((messaging + planted).replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toContain(
        "message: 'canBroadcast'",
      )
    })
  })
})
