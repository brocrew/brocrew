import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  composeProfileBundle,
  type InstructionContext,
  thisConversationSpans,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { RULE_WRITING_POLICY, capabilityField } from '../src/shared/capabilities'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **544 · what a chain is told about its own depth, and whether the rail agrees.**
 *
 * ## ⛔ The two halves of `HO-054` §1, measured on one machine
 *
 * ⚠️ **BroBot read `Deepest chain: 2` as *me (1), project manager (2), nothing below*, instructed
 * its project manager to report the refusal that would follow, and none came.** The PO measured the
 * chain against its own ruling and it was legal — `HO-005` §2 Q3: *a conversation a person creates
 * is depth 0; a spawn is its parent's depth + 1*, so BroBot 0 → project-manager 1 → `web-builder` 2
 * is inside a bound of 2. ⛔ **Two things follow and this file is both of them.**
 *
 * **§1 · the rail, by an actual refusal** (standing rule 3, `HO-054` §1.3). `540` created the doubt
 * — *"spawn depth is not capped at three"* — and its own search shape could not have seen this rail:
 * `too-deep`, `max_depth` and `maxDepth` appear zero times in that response. ⚑ A rail proven once in
 * Slice 3 and not exercised since is a rail that may have regressed, so it is exercised here, and
 * the counting is measured against the RULING rather than against the constant's name.
 *
 * **§2 · the sentence, and it may only say what the rail does** (`HO-054` §1.2, standing rule 15).
 * ⚑ The bound is rendered as what will happen to the next conversation this one tries to start —
 * see {@link ProfileCapabilities.maxDepth}'s own `says`. ⛔ **Every arm of it is asserted BESIDE the
 * rail's answer for the same conversation**, in both directions: a sentence and a door that are
 * measured separately are a sentence and a door that come apart.
 *
 * ## ⚑ D-016 · the chain is a chain of PIECES
 *
 * ⛔ `spawn_agent` is gone: a conversation is started by the first piece given to it, and depth is
 * counted below the ROOT a person's conversation owns — the root is 0, the piece it gives is 1
 * (`SessionStore.depthOf`, which takes a piece). ⚑ Every rail and every sentence below is asked of
 * `give_work`, and the ruling it is counted against is unchanged: a person's conversation is 0.
 *
 * ## ⚑ Why this is not `341`'s test again
 *
 * ⛔ `the-rails-before-anything-can-reach-them.test.ts` proves the refusal and its shallower
 * control, on a real chain, and `a-top-tier-that-can-delegate.test.ts` proves it through the tool a
 * model calls. ⚠️ **Neither asserts the root is `0`** — the one sentence `HO-005` §2 Q3 is made of —
 * and neither reads what the conversation was TOLD. This file asks both of a single chain.
 *
 * ## ⚑ D-024 · the sentence is in the conversation's OWN block
 *
 * ⛔ **Not in the profile's file any more** (R1): one profile runs several conversations, and the
 * grants are said for this one's depth, so `## What you have been granted` is composed per launch by
 * `thisConversationSpans` and appended LAST to the hint the adapter is handed — never written to
 * disk. ⚑ Every assertion below reads that hint, as the adapter received it.
 */

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

/**
 * 🔴 **The two arms, held here as BYTES rather than imported** — `a-mutation-on-a-census-is-
 * invisible-to-that-census`.
 *
 * ⛔ **A test that imported the constants would go green on any rewording, including one that put
 * a bare number back.** ⚑ These are the independent half; `the-text-a-child-is-actually-told.test.ts`
 * §10 holds the derived half, and standing rule 5 is why the load-bearing clause is pinned by name
 * rather than by a `toContain` over a fragment.
 */
const REACHED =
  '- You have reached your delegation limit and cannot give work from this conversation.'
const ONE_MORE =
  "- You may give work one level below this conversation; the helper's own limit decides what it may give."
const NOT_REACHED = ''
const GRANTS_HEADING = '## What you may do'

describe('544 · what a chain is told about its own depth', () => {
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
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ToolWatchingRuntime(provider, handed, issued, told),
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

    it('⚑ the bound is the SPAWNER’s own row, so the same call passes one row over', async () => {
      // 🔴 **Tested where the two readings DIVERGE** (standing rule 3). ⛔ A rail reading the ROOT's
      // grant, or the child's, gives the same answer as one reading the spawner's while every row
      // holds the ruled `6` — which is every install. ⚠️ So the sixth spawner's row is moved and
      // nothing else is.
      for (const name of CHAIN) await bringIntoBeing(name)
      await personOpens('pm')
      grant('w6', { maxDepth: 7 })
      for (const name of TO_THE_BOUND) {
        expect((await callGive(toolsOfTheLast(), name)).outcome).toBe('ok')
      }
      const deeper = await callGive(toolsOfTheLast(), 'w7')
      expect(deeper.outcome, JSON.stringify(deeper)).toBe('ok')
      expect(store.depthOf(deeper.piece as string)).toBe(7)
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

    it('🔴 the number is GONE, and with it the position the reader was never given', async () => {
      // ⛔ **The defect, pinned as an absence.** `Deepest chain: 2` is an absolute depth counted
      // from the conversation a person started, and nothing in the bundle ever said where that was
      // — the sentence that supplies the origin is `CapabilityField.help`, whose only reader is
      // `CapabilitiesSheet.vue`. ⚠️ **A digit on this line is the defect returning**, whatever it
      // is spelled as.
      await personOpens('pm')
      const line = depthLineOfTheLast()
      expect(line, 'a bare number is back on the line a model reads').not.toMatch(/[0-9]/)
      const said = told.at(-1) as string
      expect(said).not.toContain('- Deepest chain:')
      // ⚑ **And the GRANT-SHEET question still answers with the count**, which is the half that
      // must not change: what a person edits is a number.
      //
      // ⚠️ **Said precisely, because the obvious wording would be false:** no surface asks that
      // question of THIS field today. `grantSays(…, null)` is reached from the roster row alone,
      // and that row walks `canSpawn` and `canStaff`; `CapabilitiesSheet.vue` draws this grant
      // through its count editor off the raw value and never calls `says`. ⛔ So this pins the
      // schema's answer, not a rendered surface — see {@link CapabilityField.says}, which says the
      // same thing about itself.
      expect(capabilityField('maxDepth').says(2, null)).toBe('2')
    })

    it('⚠️ …and NO grant line carries a bare number except the one this dispatch reports and does not repair', async () => {
      // 🔴 **A census over the whole block, because the assertion above is about one line and the
      // defect is about a CATEGORY** (HO-037 §4: *a category defined by the pipe leaves everything
      // outside the pipe unguarded*). ⛔ A tenth grant whose `says` ignores its second argument
      // compiles, and would ship the next absolute number into the block with every existing test
      // green. ⚑ This is what makes that visible on the commit that does it.
      //
      // ⚑ **D-014 took the one exemption away with its grant** — `At once` printed *3 from one
      // conversation, 8 in this app at once*, which 544 reported rather than repaired; the counts
      // are gone, so no line is exempt now.
      await personOpens('pm')
      const said = told.at(-1) as string
      // ⚑ **D-024 · R1 — the slice still ends at the grants**: they are the last section of this
      // conversation's own block, and `composeSystemHint` appends that block last.
      const heading = said.indexOf(GRANTS_HEADING)
      expect(heading, 'the hint has no grant section').toBeGreaterThan(-1)
      const block = said
        .slice(heading)
        .split('\n')
        .filter((line) => line.startsWith('- '))
      expect(block).toHaveLength(4)
      expect(block.slice(0, 3).every((line) => line.startsWith('- You may'))).toBe(true)
      expect(block[3]).toBe(`- ${RULE_WRITING_POLICY}`)
      expect(/[0-9]/.test(capabilityField('maxDepth').says(6, null))).toBe(true)
      expect(block.filter((line) => /[0-9]/.test(line))).toEqual([])
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

    it('⚠️ …and a bound far past the default says the other thing, at a depth no default chain reaches', async () => {
      // ⛔ **The off-by-one in the other direction, which `HO-054` §1.3 asks to be measured rather
      // than assumed**: if the counting were one out, a conversation at depth 6 holding 9 would be
      // told the wrong thing, and the door would disagree.
      for (const name of CHAIN) await bringIntoBeing(name)
      await personOpens('pm')
      grant('w6', { maxDepth: 9 })
      for (const name of TO_THE_BOUND) {
        expect((await callGive(toolsOfTheLast(), name)).outcome).toBe('ok')
      }
      expect(depthLineOfTheLast()).toBe(NOT_REACHED)
      expect((await callGive(toolsOfTheLast(), 'w7')).outcome).toBe('ok')
    })

    it('🔴 *not reached* promises no give — the door refuses this one for a different reason', async () => {
      // ⛔ **The over-claim this sentence must not make.** It is about ONE rail. A give that is not
      // too deep can still be refused, with another word — so a reader that took *not reached* for
      // permission would be wrong. ⚑ D-014: this was an identity that may start nobody
      // (`can_spawn`), which is gone; ⚑ **D-016** — and then the second start of one identity,
      // which a give now REACHES instead: a name this app does not hold is the refusal left that
      // depth does not answer (R3).
      await bringIntoBeing('worker')
      await personOpens('pm')
      const itsOwnDoor = toolsOfTheLast()
      expect(depthLineOfTheLast()).toBe(NOT_REACHED)
      expect((await callGive(itsOwnDoor, 'worker')).outcome).toBe('ok')
      const refused = await callGive(itsOwnDoor, 'nobody-made-this')
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('no-such-profile')
    })

    it('⚑ an identity this app cannot NAME is told nothing about depth — silence, not a guess', async () => {
      // 🔴 **`HO-054` §2.2's own answer, and it needed no new code**: an adopted row carries no
      // profile, `capabilities` is null, and the whole grant list is replaced by the sentence that
      // says the record is missing (485). ⛔ A depth sentence composed for it would be this app
      // telling a conversation what a row it cannot find permits.
      const nameless: InstructionContext = {
        profileSlug: null,
        cwd: work,
        startedBy: null,
        depth: 0,
        capabilities: null,
        spawningEnabled: true,
        // ⚑ **D-016** — the conversation's root: none is read for a row this app cannot name.
        root: null,
        // ⚑ **D-024 · R1** — and no other conversations: a row with no identity is in no
        // profile's list.
        others: { shown: [], more: 0 },
      }
      // 🔴 **D-024 · R1 — the grants, and the sentence that replaces them, are in this
      // conversation's own block now**, which is where the missing record is said…
      const none = thisConversationSpans(nameless).text
      expect(none).not.toContain(capabilityField('maxDepth').label)
      expect(none).not.toContain(REACHED)
      expect(none).not.toContain(ONE_MORE)
      expect(none).toContain("The app cannot identify this conversation's profile")
      // ⚠️ …and the profile's file is the other half of what it is told — one string with the block
      // until D-024 — so its silence is asked too, or a depth line could come back in the half this
      // case would otherwise have stopped reading.
      const itsFile = composeProfileBundle(nameless)
      expect(itsFile).not.toContain(capabilityField('maxDepth').label)
      expect(itsFile).not.toContain(REACHED)
      expect(itsFile).not.toContain(ONE_MORE)
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
