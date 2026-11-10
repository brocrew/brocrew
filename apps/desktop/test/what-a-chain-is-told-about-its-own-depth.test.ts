import { syntheticProviderHome, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { composeProfileBundle, thisConversationSpans } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
    /**
     * 🔴 **D-024 · R1 — what each launch's adapter was HANDED as its system prompt**, start and
     * resume alike: this conversation's own block rides there, and in no file.
     */
    private readonly told: string[],
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    this.hear(options.systemHint)
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    this.hear(options.systemHint)
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  /**
   * ⛔ **A launch handed no hint was told nothing**, which is a premise failing rather than a
   * reading — so it throws, as the reader seam below does, instead of reading as silence.
   */
  private hear(systemHint: string | undefined): void {
    if (systemHint === undefined) throw new Error('the adapter was handed no system prompt')
    this.told.push(systemHint)
  }
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

const REACHED =
  '- You have reached your delegation limit and cannot give work from this conversation.'
const ONE_MORE =
  "- You may give work one level below this conversation; the helper's own limit decides what it may give."
const NOT_REACHED = ''
const GRANTS_HEADING = '## What you may do'

describe('what a chain is told about its own depth', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** ⚑ Every host this test built, so a restart closes the one it replaced. */
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let told: string[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: Sink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-544-'))
    /** Its own folder, outside `userData` (which `checkSessionCwd` refused until `726` · R92). */
    work = mkdtempSync(join(tmpdir(), 'brobot2-544-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    told = []
    issued = new FakeProviderSessions()
    window = new Sink('webContents:1')
    hosts = []
    host = buildHost()
  })

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new ToolWatchingRuntime(provider, handed, issued, told),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
      // ⚑ **What the model receives, as the adapter is handed it** — not an `InstructionContext`
      // this file built, and not the composer's return value either. ⛔ **This read *"The BYTES ON
      // DISK, read back through the path the reader hands the provider"* until D-024 · R1**, which
      // took the grants out of the file: see {@link ToolWatchingRuntime}'s `told`.
      //
      // ⛔ **The second half of that is a correction to this harness's first draft**, which pushed
      // `composeProfileBundle(context)` and so measured the composer while claiming to measure
      // what a chain is TOLD. `publishProfileBundle` ANSWERS rather than throws when somebody
      // else's override sits at the leaf, so a publish that refused would have left every
      // assertion in this file green over a conversation told nothing about its depth at all.
      readInstructions: (provider, cwd, providerHome, context) => {
        const bundle = publishProfileBundle(provider, providerHome, composeProfileBundle(context))
        if (!bundle.ok) throw new Error(`the bundle was not published: ${bundle.reason}`)
        // 🔴 **D-024 · R1 — the depth line left that file.** What is true of THIS conversation —
        // its grants, and so the line this file reads — is composed for its launch alone and
        // handed to the reader beside the file, as `main/index.ts` hands it.
        const thisConversation = thisConversationSpans(context)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          thisConversation,
        })
        // ⚠️ **The file is still checked as SENT**, keyed on the leaf's own path —
        // `InjectedInstruction.text` is *the exact text appended, verbatim* — so the rules around
        // the block this file reads are the bytes the model receives, not the composer's.
        const appended = read.instructions.injected.find((one) => one.path === bundle.path)
        if (appended === undefined) throw new Error(`the reader did not hand over ${bundle.path}`)
        if (appended.truncated) throw new Error(`the bundle was truncated at ${bundle.path}`)
        if (appended.text !== readFileSync(bundle.path, 'utf8')) {
          throw new Error(`what was appended is not what was published at ${bundle.path}`)
        }
        // ⛔ **Untruncated, asserted** — of the block the grants are in now: last in the hint and
        // whole, because a cut that took the grant section off would otherwise read as a
        // conversation told nothing about its depth.
        if (read.systemHint === null || !read.systemHint.endsWith(thisConversation.text)) {
          throw new Error('this conversation’s own block is not the whole tail of the hint')
        }
        // ⚑ **Handed on, as `main/index.ts` hands it** — it was `undefined` here while the line was
        // on disk; now the host passes it to the adapter, and {@link ToolWatchingRuntime} is where
        // it is captured, on `start` and on `resume` both.
        return { instructions: read.instructions, systemHint: read.systemHint, memoryLoaded: null }
      },
    })
    hosts.push(built)
    return built
  }

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, work]) rmSync(dir, { recursive: true, force: true })
  })

  /** A conversation a PERSON opened, in a window. Depth 0 by the ruling — asserted in §1. */
  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /**
   * ⚠️ **An identity EXISTS once a conversation has run as it** (`341` criterion 12), so a grant
   * cannot be written for a name nobody has opened.
   */
  const bringIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const grant = (profileId: string, edit: Parameters<SessionStore['setCapabilities']>[1]): void => {
    expect(store.setCapabilities(profileId, edit)).toBe(true)
  }

  /** The toolset of the conversation launched most recently — the caller's own door. */
  const toolsOfTheLast = (): AgentToolset => handed.at(-1) as AgentToolset

  /**
   * ⚑ **D-016 · the give** — it starts the conversation the first time, and hangs the piece under
   * the one the caller holds (its root, or the piece it was given), which is the depth it counts.
   */
  const callGive = async (
    tools: AgentToolset,
    profileSlug: string,
  ): Promise<Record<string, unknown>> => {
    const tool = tools.tools.find((one) => one.name === 'give_work')
    if (tool === undefined) throw new Error('no give_work on this toolset')
    return (
      await tool.call({
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: profileSlug,
        title: 'The chain this file measures',
        brief: 'the chain this file measures',
      })
    ).structured as Record<string, unknown>
  }

  /**
   * ⚑ **D-014 · the chain this file walks**: `w1`…`w6` reach the default bound (`maxDepth` 6), and
   * `w7` is the one past it. Any agent may give work to any identity that exists, so no grant
   * builds it.
   */
  const CHAIN = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'] as const
  const TO_THE_BOUND = CHAIN.slice(0, 6)

  /** What the conversation launched most recently was told about the deepest chain. */
  const depthLineOfTheLast = (): string => {
    const said = told.at(-1) as string
    expect(said).toContain(GRANTS_HEADING)
    return said.split('\n').find((one) => one === REACHED || one === ONE_MORE) ?? ''
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the rail, by an actual refusal, counted the way the ruling counts
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the rail still fires', () => {
    it('🔴 HO-005 §2 Q3 · a conversation a PERSON created is depth 0 — the sentence itself, asserted', async () => {
      // ⛔ **Nothing in this repo asserted this before 544.** Every `depthOf` assertion in the tree
      // reads 1, 2 or `> 2`; the root's 0 was carried in a helper's comment — *"Depth 0 by
      // construction"* — and a prose claim is not a measurement. ⚠️ It is the half of the ruling the
      // bound is counted FROM, so if it ever became 1 the rail would refuse a chain the PO permits
      // and every number in the sentence would still look right.
      await bringIntoBeing('w1')
      const root = await personOpens('pm')
      // ⛔ **The premise, asserted**: the conversation a person opened owns a ROOT (D-016 · R1),
      // and that root is what a depth is counted from.
      expect(store.find(root), 'the root was never recorded').not.toBeNull()
      const itsRoot = store.rootOf(root)
      expect(itsRoot, 'the conversation owns no root').not.toBeNull()
      expect(store.depthOf(itsRoot!.piece)).toBe(0)
      // ⚑ **The control is the CHILD**, whose `1` is one real hop up `parent_id` over two real rows.
      const child = await callGive(toolsOfTheLast(), 'w1')
      expect(child.outcome, JSON.stringify(child)).toBe('ok')
      expect(store.depthOf(child.piece as string)).toBe(1)
      // ⚠️ …and a piece nobody minted has NO depth: `depthOf` throws rather than answering the
      // root's `0` for it (D-016), so the root's `0` above cannot be a default.
      expect(() => store.depthOf('work_nobody_minted')).toThrow()
    })

    it('⛔ …and the SENTENCE counts it the same way, which the store assertion above cannot see', async () => {
      // 🔴 **The row above measures `depthOf`; this one measures what the conversation is TOLD.**
      // ⛔ They come apart, and 544's own `M4` is the proof: a launch that counted a person's own
      // conversation as 1 left `depthOf` untouched and every assertion in this file green, because
      // at the ruled bound of 2 the arms read the same at 0 and at 1. ⚑ **So the bound is moved to
      // 1**, where the two readings finally disagree — *tested where the two readings DIVERGE*,
      // standing rule 3 applied to a number rather than to a rail.
      await bringIntoBeing('worker')
      await bringIntoBeing('pm')
      grant('pm', { maxDepth: 1 })
      grant('worker', { maxDepth: 1 })
      await personOpens('pm')
      // One level remains at the root; the same grant binds its helper.
      expect(depthLineOfTheLast()).toBe(ONE_MORE)
      const child = await callGive(toolsOfTheLast(), 'worker')
      expect(child.outcome, JSON.stringify(child)).toBe('ok')
      expect(store.depthOf(child.piece as string)).toBe(1)
      // depth 1 · and there it stops. ⚠️ Both halves in one test, because a root counted as 1 would
      // have moved the FIRST of them and left this one where it is.
      expect(depthLineOfTheLast()).toBe(REACHED)
      expect((await callGive(toolsOfTheLast(), 'worker')).rail).toBe('too-deep')
    })

    it('🔴 the refusal at the depth that must be refused, and the same call one step shallower allowed', async () => {
      for (const name of CHAIN) await bringIntoBeing(name)
      await personOpens('pm')

      // depths 1-6 — allowed. ⚑ Depth 6 is the SHALLOWER control for the refusal below, and it is
      // the same call through the same tool: only the conversation making it has moved.
      let under = ''
      for (const [at, name] of TO_THE_BOUND.entries()) {
        const started = await callGive(toolsOfTheLast(), name)
        expect(started.outcome, JSON.stringify(started)).toBe('ok')
        expect(store.depthOf(started.piece as string)).toBe(at + 1)
        under = started.label as string
      }
      // depth 7 — refused. ⚑ **D-016** — the detail names the piece it would have hung under.
      const seven = await callGive(toolsOfTheLast(), 'w7')
      expect(seven.outcome, JSON.stringify(seven)).toBe('refused')
      expect(seven.rail).toBe('too-deep')
      expect(seven.detail).toEqual({ depth: 7, maxDepth: 6, label: under, profileId: 'w7' })
      // ⛔ **Permanent, so *try again later* is not a reading of it.**
      expect(seven.permanence).toBe('until-a-person-changes-it')
      expect(seven.retryable).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the sentence, beside the rail's own answer, in both directions
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what each conversation in the chain is told', () => {
    it('🔴 the line says what the rail will do, at every depth of one real chain', async () => {
      // ⛔ **The biconditional, and it is the whole of `HO-054` §1.2 plus standing rule 15**: a
      // sentence may only describe a limit the rail enforces, so *reached* must mean refused and
      // *not reached* must mean admitted — measured on the same conversation, by calling the door.
      for (const name of CHAIN) await bringIntoBeing(name)
      await personOpens('pm')

      // depths 0-5 · from the conversation a person started, each told it may go on, and the door
      // agrees.
      for (const [index, name] of TO_THE_BOUND.entries()) {
        expect(depthLineOfTheLast()).toBe(index === 5 ? ONE_MORE : NOT_REACHED)
        expect((await callGive(toolsOfTheLast(), name)).outcome).toBe('ok')
      }
      // depth 6 · the deepest a ruled chain reaches, and the first one told so.
      expect(depthLineOfTheLast()).toBe(REACHED)
      const refused = await callGive(toolsOfTheLast(), 'w7')
      expect(refused.rail, 'the line said reached and the door did not refuse for depth').toBe(
        'too-deep',
      )
    })

    it('⛔ …and a deeper grant moves BOTH, which is the sentence rendered rather than asserted', async () => {
      // ⚑ Standing rule 8 on the axis the grant owns: one row moves, and the line a model reads
      // moves with it — while the rail moves the same way, on the same conversation.
      for (const name of CHAIN) await bringIntoBeing(name)
      await personOpens('pm')
      grant('w6', { maxDepth: 7 })
      for (const name of TO_THE_BOUND) {
        expect((await callGive(toolsOfTheLast(), name)).outcome).toBe('ok')
      }
      // ⛔ The same depth-6 conversation as the test above, one row different, and it is told the
      // other thing.
      expect(depthLineOfTheLast()).toBe(ONE_MORE)
      expect((await callGive(toolsOfTheLast(), 'w7')).outcome).toBe('ok')
    })

    it('🔴 a REOPENED conversation is told the same thing — the other launch path, which was dark', async () => {
      // ⛔ **`instructionContext` has two callers and the first draft of this file opened one.**
      // A reopen takes its parent from `slot.spawnedBy`, re-derived from the ledger by
      // `attachSession` — `373`'s repair, which exists so a child still knows who commands it after
      // a restart. ⚠️ **544 hangs a sentence on that fact**, so a reopen that lost the parent would
      // tell a conversation at the bound that it may start another while the door refuses it, and
      // nothing would have said so.
      for (const name of CHAIN) await bringIntoBeing(name)
      await personOpens('pm')
      for (const name of TO_THE_BOUND.slice(0, -1)) {
        expect((await callGive(toolsOfTheLast(), name)).outcome).toBe('ok')
      }
      const six = await callGive(toolsOfTheLast(), 'w6')
      expect(six.outcome, JSON.stringify(six)).toBe('ok')
      const deepest = six.agent as string
      expect(depthLineOfTheLast()).toBe(REACHED)

      // ⚑ **Every slot closed and the conversation reopened** — the slots go and the ledger
      // stays, which is the half of `373` this sentence now depends on. ⛔ `closeAll` rather than
      // `close`, because a person's window does not command a conversation an agent started and
      // `assertMayControl` refuses it — which is `340`'s rule doing its job, one door over.
      for (const built of hosts) await built.closeAll()
      host = buildHost()
      // ⚑ **D-024 · R1 — read off `ResumeOptions.systemHint`**: the block is composed again for this
      // launch, and nothing of it was left on disk for a reopen to find.
      await host.resumeSession(deepest, new Sink('webContents:2'))
      expect(depthLineOfTheLast(), 'the reopened conversation forgot how deep it sits').toBe(
        REACHED,
      )
      expect((await callGive(toolsOfTheLast(), 'w7')).rail).toBe('too-deep')
    })

    it('⚠️ …and a conversation DEEPER than its own identity may reach is told so, without saying it is at the bound', async () => {
      // 🔴 **The state the first wording of this sentence was false about.** ⛔ The grant bounds
      // where an identity may PLACE a child, so a spawner holding a wide bound can leave a
      // conversation sitting deeper than its OWN identity's bound — and *as deep as this identity
      // may go* was a claim about equality on a chain that had passed it.
      // ⚠️ Every other assertion in this file sits on `depth === bound` or below it
      // (`a-comparison-tested-where-both-sides-agree-measures-nothing`), and this is the only one
      // above it.
      for (const name of ['w1', 'w2', 'w3']) await bringIntoBeing(name)
      await personOpens('pm')
      grant('pm', { maxDepth: 9 })
      grant('w1', { maxDepth: 9 })
      grant('w2', { maxDepth: 9 })
      // ⛔ **`w3`'s own bound is the narrowest a person can choose**, and it is placed at depth 3
      // by spawners that never read it.
      grant('w3', { maxDepth: 0 })
      expect((await callGive(toolsOfTheLast(), 'w1')).outcome).toBe('ok')
      expect((await callGive(toolsOfTheLast(), 'w2')).outcome).toBe('ok')
      const three = await callGive(toolsOfTheLast(), 'w3')
      expect(three.outcome, JSON.stringify(three)).toBe('ok')
      expect(store.depthOf(three.piece as string)).toBe(3)
      expect(depthLineOfTheLast()).toBe(REACHED)
      const refused = await callGive(toolsOfTheLast(), 'w3')
      expect(refused.rail).toBe('too-deep')
      expect(refused.detail).toEqual({
        depth: 4,
        maxDepth: 0,
        label: three.label,
        profileId: 'w3',
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · an identity nobody anticipated — HO-054 §2.2's question asked of this sentence
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · grants the seeds did not make', () => {
    it('⛔ a bound of ZERO refuses the conversation a person started, and it is told so first', async () => {
      // 🔴 **`narrowest` is 0 and a person may choose it**, so the arm exists on a real install and
      // is reachable by one edit. ⚠️ It is the case an absolute number reads best on and a relative
      // one reads worst on — and the only one where a conversation at the very top may start
      // nothing at all.
      await bringIntoBeing('worker')
      await bringIntoBeing('pm')
      grant('pm', { maxDepth: 0 })
      const pm = await personOpens('pm')
      expect(depthLineOfTheLast()).toBe(REACHED)
      const refused = await callGive(toolsOfTheLast(), 'worker')
      expect(refused.rail).toBe('too-deep')
      expect(refused.detail).toEqual({
        depth: 1,
        maxDepth: 0,
        label: store.rootOf(pm)?.label,
        profileId: 'worker',
      })
    })

    it('⚠️ the app-wide switch and the depth line answer two different questions, and both are said', async () => {
      // ⛔ A conversation that is not too deep may still start nothing, because the switch is off —
      // and the depth line must not read as permission in that state either.
      await bringIntoBeing('pm')
      store.setSpawningEnabled(false)
      await personOpens('pm')
      expect(depthLineOfTheLast()).toBe(NOT_REACHED)
      // ⚑ **D-016** — the switch's sentence is the rail's own, worded for a give.
      expect(told.at(-1) as string).toContain(
        '- This app currently blocks creating agents and starting new agent conversations. Giving work to an existing conversation still depends on your permissions.',
      )
      // ⛔ **And the door, because this file's argument is that a sentence is measured beside the
      // rail it describes.** ⚠️ A switch nothing enforced would leave the paragraph above standing
      // as a safety sentence with nothing behind it — standing rule 5, and rule 15's shape.
      const refused = await callGive(toolsOfTheLast(), 'pm')
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('spawning-disabled')
    })
  })
})
