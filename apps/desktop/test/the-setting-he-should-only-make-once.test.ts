import { syntheticProviderHome, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  NULL_SESSION_STORE,
  type SessionStore,
} from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, noPersonBehindIt } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  CHANGEABLE_LIVE_IN,
  LAUNCH_APPROVAL_BOUND,
  LAUNCH_APPROVAL_GOVERNS,
  LAUNCH_APPROVAL_UNREAD,
  launchApprovalView,
} from '../src/renderer/src/lib/front-door-words'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/**
 * # 🔴 The setting he should only ever make once (500, `HO-036` §3.1)
 *
 * > ⛔ **"A person sets their approval mode once, and every conversation they start begins there."**
 *
 * Persist the person’s chosen default permission mode so a new conversation does not require
 * repeated setup before avoiding prompts on every read and command.
 *
 * ## ⛔ What this file is FOR, and it is one question
 *
 * 🔴 **Can a person's default reach a SPAWNED conversation?** `HO-036` §2 says a child takes its
 * PARENT's mode, and the half the withdrawal did NOT withdraw is *a child cannot grant itself more
 * than its parent holds*. ⚠️ **A person's default and a parent's mode are two different inputs to
 * one field**, and a feature that let the first win would reverse a rail the PO deliberately kept.
 *
 * ⚑ **The answer is structural and this file proves it in two directions**, because a behavioural
 * test alone could not:
 *
 *  - **§3 · the census.** The value is spent ABOVE the IPC boundary. `spawn-rails.ts` names neither
 *    the column nor the field; `RuntimeHost.startSessionInProfile` resolves the mode from what its
 *    caller sent and asks no store; and the only main-process readers are the policy pair and the
 *    roster read. ⛔ **A spawn never crosses IPC** — `agent-tools.ts` calls `host.giveWork`
 *    in-process — so there is no mechanism, not merely no call.
 *  - **§4 · the measurement, where the two readings DIVERGE** (standing rule 3). With the default
 *    set to `auto`, in one host, on one store, at one instant: a spawn comes out `ask`, and the
 *    host still resolves an OMITTED mode to `ask`. ⚠️ **Both of those cells are `ask`**, so neither
 *    alone would measure anything — `a-comparison-tested-where-both-sides-agree-measures-nothing`.
 *    ⚑ **The divergence is the third cell in the same test**: an EXPLICIT `auto` on the same host
 *    and the same store does reach a launch, which is what makes the first two about *who resolves
 *    it* rather than about a host that cannot launch in `auto` at all.
 *
 * ## ⚠️ What this file deliberately does NOT contain
 *
 * ⛔ **The renderer half.** The control, its three states and the payload the two person-doors build
 * are in `test/dom/the-setting-he-should-only-make-once.dom.test.ts`, because the default is
 * resolved on the renderer's side of the boundary and a node test cannot mount a screen. ⚑ **The
 * split is the architecture, not a convenience** — §3's census is what joins the two halves.
 *
 * ⛔ **Anything about inheritance.** `499` owns `HO-036` §2 and `spawn-rails.ts`; the assertions
 * below say what a spawn does with the DEFAULT, never what it does with its parent.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** ⛔ The one sink shape that is NOT a window — `349`'s person gate, from the other side. */
class NobodyThere extends RecordingSink {
  override readonly aPersonIsBehindIt = false
}

/**
 * ⛔ **A runtime that records the mode each launch was ACTUALLY given**, read out of the options the
 * host built rather than out of anything this test passed in.
 */
class ModeWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly seen: ('ask' | 'auto' | undefined)[],
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    // ⚠️ **In launch ORDER, because `StartOptions` carries no session id** — there is nothing on the
    // options object to key by, and inventing a key out of `providerHome` would name the PROFILE
    // rather than the conversation. ⛔ So this records what the PROVIDER was told, in order, and
    // {@link modeOf} reads the same fact per conversation out of the LEDGER. Two derivations of one
    // value, which is what makes either of them worth asserting.
    this.seen.push(options.approvalMode)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('500 · the setting he should only ever make once', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let launched: ('ask' | 'auto' | undefined)[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-500-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-500-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    launched = []
    handed = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new ModeWatchingRuntime(provider, launched, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work]) rmSync(dir, { recursive: true, force: true })
  })

  const ask = (
    command: Parameters<typeof executeRuntimeCommand>[2],
    sink: RuntimeEventSink = window,
  ): Promise<unknown> => executeRuntimeCommand(host, sink, command)

  /** A person opens a conversation the way `ipc.ts` receives one from a window. */
  const personOpens = async (over: Record<string, unknown> = {}): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider: 'claude',
      profileId: DEFAULT_PROFILE_ID,
      cwd: work,
      ...over,
    })) as { sessionId: string }
    return opened.sessionId
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens({ profileId, approvalMode: 'ask' })
    await host.close(id, window)
  }

  /**
   * The real spawn path: the parent's own toolset, called the way a model calls it. ⚑ **D-016** —
   * a child is started by `give_work` when the parent has no conversation with that agent.
   */
  const askToSpawn = async (parent: string, profileSlug: string): Promise<string> => {
    const set = agentToolsFor(host, parent)
    const tool = set.tools.find((one) => one.name === ('give_work' as ToolName))
    if (tool === undefined) throw new Error('no give_work tool')
    const answered = (await tool.call({
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: profileSlug,
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })) as { structured: Record<string, unknown> }
    const body = answered.structured
    // ⛔ **The RAIL and not its sentence** — `425` moved every refusal's prose behind a remedy.
    if (body.outcome !== 'ok') throw new Error(`give refused: ${String(body.rail)}`)
    if (body.started !== true) throw new Error('the give started no conversation')
    return String(body.agent)
  }

  /**
   * ⛔ **What the app RECORDED for one conversation** — the ledger, not the double.
   *
   * ⚠️ **`findLive` and not `find`**: `find` answers `null` for a row whose provider ref will not
   * parse, and these conversations have not produced one yet. `findLive` is the reader that keeps
   * the mode when the ref is unreadable, which is exactly the state a just-launched session is in.
   */
  const modeOf = (sessionId: string): 'ask' | 'auto' | null | undefined =>
    store.findLive(sessionId)?.approvalMode

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the value, and the fold that closes its vocabulary
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · where it lives, and what it answers when it cannot read', () => {
    /**
     * ⛔ **A first-time install has never been asked, and that is not `ask` spelled differently.**
     * `0017`'s seed names three columns, so the policy row exists with this one NULL — on a fresh
     * database and on an upgraded one alike.
     */
    it('⚑ a migrated database has a policy row and NO answer on it, which folds to ask', () => {
      const row = db
        .prepare(`SELECT default_approval_mode FROM app_policy WHERE id = 'policy'`)
        .get()
      expect(row).toEqual({ default_approval_mode: null })
      expect(store.defaultApprovalMode()).toBe('ask')
      expect(store.defaultApprovalModeChosen()).toBe(false)
      // ⚑ **The paired positive**: the fold is reading this column and not answering a constant.
      store.setDefaultApprovalMode('auto')
      expect(store.defaultApprovalMode()).toBe('auto')
      expect(store.defaultApprovalModeChosen()).toBe(true)
      store.setDefaultApprovalMode('ask')
      expect(store.defaultApprovalModeChosen()).toBe(true)
    })

    /**
     * 🔴 **The column carries no CHECK — `0030`'s header says why — so this fold IS the vocabulary.**
     * ⛔ And it closes towards the NARROWEST meaning: a word this build cannot read makes an agent
     * ask MORE, never less. `a-check-constraint-on-an-existing-sqlite-table-rebuilds-it` is the note
     * that rules this trade, and this is the assertion that makes the trade safe.
     */
    it('⛔ a word this app cannot read folds to ask, never to auto', () => {
      for (const planted of ['AUTO', 'yolo', 'Auto', '', 'auto ', 'never-ask']) {
        db.prepare(`UPDATE app_policy SET default_approval_mode = ? WHERE id = 'policy'`).run(
          planted,
        )
        expect(store.defaultApprovalMode(), planted).toBe('ask')
      }
      // ⛔ **The control that proves the planting reaches the reader** — without it every row above
      // is satisfied by a fold that ignores the column entirely.
      db.prepare(`UPDATE app_policy SET default_approval_mode = 'auto' WHERE id = 'policy'`).run()
      expect(store.defaultApprovalMode()).toBe('auto')
    })

    /**
     * ⛔ **Every way of losing the row answers `ask`** — the same shape `spawnPolicy` has for the
     * kill switch, arrived at from the other end: each fails towards the state in which somebody is
     * still being asked.
     */
    it('⛔ no row, and no database at all, both answer ask', () => {
      db.prepare(`DELETE FROM app_policy`).run()
      expect(store.defaultApprovalMode()).toBe('ask')
      expect(NULL_SESSION_STORE.defaultApprovalMode()).toBe('ask')
      // ⚑ …and the write on a store with no ledger is a no-op rather than a throw, which is what
      // lets a host with no database draw the control instead of failing the screen.
      expect(() => NULL_SESSION_STORE.setDefaultApprovalMode('auto')).not.toThrow()
      expect(NULL_SESSION_STORE.defaultApprovalMode()).toBe('ask')
    })

    /**
     * ⚠️ **The two writers on one row must not stamp each other's decision.** `updated_at` is the
     * only thing on `app_policy` a person can tell a fresh install from a decision by, and a
     * widened `writePolicy` would have made one press claim the other's moment.
     */
    it('⚠️ setting the default does not throw the spawning switch, and vice versa', () => {
      store.setSpawningEnabled(false)
      store.setDefaultApprovalMode('auto')
      expect(store.spawnPolicy()).toEqual({ spawningEnabled: false })
      expect(store.defaultApprovalMode()).toBe('auto')
      store.setSpawningEnabled(true)
      expect(store.defaultApprovalMode()).toBe('auto')
      expect(store.spawnPolicy()).toEqual({ spawningEnabled: true })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the wire — a person's door, read back rather than echoed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the door a person presses', () => {
    it('⚑ the host answers what the DATABASE now says, and the roster carries it', async () => {
      expect(await ask({ kind: 'setDefaultApprovalMode', mode: 'auto' })).toEqual({
        defaultApprovalMode: 'auto',
      })
      expect(store.defaultApprovalMode()).toBe('auto')
      const roster = (await ask({ kind: 'agentIdentities' })) as {
        defaultApprovalMode: string
        spawningEnabled: boolean
      }
      expect(roster.defaultApprovalMode).toBe('auto')
      // ⚑ **Both app-wide values on one read**, which is what makes the front door's *nobody has
      // answered yet* window the same window its provider resolution already has.
      expect(roster.spawningEnabled).toBe(true)
      expect(await ask({ kind: 'setDefaultApprovalMode', mode: 'ask' })).toEqual({
        defaultApprovalMode: 'ask',
      })
    })

    /**
     * 🔴 **Read back and not echoed, measured where the two answers DIVERGE.** ⛔ With the row gone
     * the write lands nowhere and the fold answers `ask` — so a door that replied with what was
     * ASKED FOR would say `auto` over a database that will hand the next launch an `ask`, which is
     * the dangerous direction of the lie.
     */
    it('🔴 a write that could not land answers ask, not what was asked for', async () => {
      db.prepare(`DELETE FROM app_policy`).run()
      expect(await ask({ kind: 'setDefaultApprovalMode', mode: 'auto' })).toEqual({
        defaultApprovalMode: 'ask',
      })
      // ⛔ **The control**: with the row back, the same call answers the other thing — so the
      // assertion above is about the read-back and not about the verb always saying `ask`.
      db.prepare(
        `INSERT INTO app_policy (id, spawning_enabled, updated_at) VALUES ('policy', 1, 1)`,
      ).run()
      expect(await ask({ kind: 'setDefaultApprovalMode', mode: 'auto' })).toEqual({
        defaultApprovalMode: 'auto',
      })
    })

    /** ⛔ It changes what agents are allowed to do, one launch later — so a person must be asking. */
    it('⛔ refused when nobody is behind the channel, and allowed on the window in the same state', async () => {
      await expect(
        ask({ kind: 'setDefaultApprovalMode', mode: 'auto' }, new NobodyThere('mcp:someone')),
      ).rejects.toThrow(noPersonBehindIt('setDefaultApprovalMode'))
      // ⚑ **The pair, at the same moment, with the same payload** — without it the refusal above is
      // equally satisfied by a verb that is broken for everybody.
      expect(store.defaultApprovalMode()).toBe('ask')
      await expect(ask({ kind: 'setDefaultApprovalMode', mode: 'auto' })).resolves.toEqual({
        defaultApprovalMode: 'auto',
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · …and measured, in one host, on one store, at one instant
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · what a spawn actually launches with', () => {
    /**
     * 🔴 **The measurement `HO-036` §1.1 asked for.** ⛔ The default is `auto`, an agent spawns a
     * child through the real rails, and the child launches in `ask`. ⚑ **The parent is `ask` too,
     * so what this measures is the DEFAULT not being read** — the inheritance question is `499`'s
     * and is deliberately not asked here.
     */
    it('🔴 with the default set to auto, a spawned conversation still launches in ask', async () => {
      // ⚑ **An identity exists only once a person has run a conversation as it** (341 criterion 12),
      // and that is true of BroBot too — a grant written before its row exists answers `false`.
      await bringIdentityIntoBeing(DEFAULT_PROFILE_ID)
      await bringIdentityIntoBeing(PROJECT_MANAGER_PROFILE_ID)
      await ask({ kind: 'setDefaultApprovalMode', mode: 'auto' })
      expect(store.defaultApprovalMode()).toBe('auto')

      const parent = await personOpens({ approvalMode: 'ask' })
      const child = await askToSpawn(parent, PROJECT_MANAGER_PROFILE_ID)

      expect(modeOf(parent)).toBe('ask')
      expect(modeOf(child)).toBe('ask')
      // ⛔ **And the PROVIDER was told the same thing**, so this is a fact about the launch and not
      // only about the row the app wrote beside it — two derivations, as the double's own note says.
      expect(launched.at(-1)).toBe('ask')
      expect(new Set(launched)).toEqual(new Set(['ask']))
    })

    /**
     * 🔴 **The host is DEAF to it, which is the property that makes the above structural.** ⛔ A
     * `createSession` that omits the mode entirely — the shape a spawn would take if anything ever
     * made `AdmittedSpawn.approvalMode` optional — resolves to `ask` while the stored default says
     * `auto`. ⚠️ **This is the cell that would go red** if a later dispatch moved the resolution
     * into `startSessionInProfile`.
     */
    it('🔴 the host resolves an OMITTED mode to ask even while the stored default is auto', async () => {
      await ask({ kind: 'setDefaultApprovalMode', mode: 'auto' })
      const omitted = await personOpens()
      expect(modeOf(omitted)).toBe('ask')
      // ⛔ **The divergent pair, at the same instant, on the same host and the same store**: the
      // renderer's resolved value DOES reach a launch, so the cell above is about who resolves it
      // rather than about the host being unable to launch in `auto` at all.
      const explicit = await personOpens({ approvalMode: 'auto' })
      expect(modeOf(explicit)).toBe('auto')
      expect(launched.at(-1)).toBe('auto')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · what a person reads, and the bytes it shares
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the words', () => {
    /** ⚠️ **Three states, and the third is not `ask`** — `086`'s rule on this control. */
    it('⚠️ nobody-has-answered is its own state, with nothing to promise', () => {
      expect(launchApprovalView(null)).toEqual({
        mode: null,
        // ⚑ **579 · the label is on every arm, the unread one included** (`EXT-010` §2.2): *what
        // this governs* is true before the row has been read, and the one frame that dropped it
        // would be the frame where a person most needs to know the scope of what they are seeing.
        governs: LAUNCH_APPROVAL_GOVERNS,
        heading: LAUNCH_APPROVAL_UNREAD,
        press: null,
        next: null,
      })
      // ⛔ The two answered states name the OTHER mode, so the sentence and the press read one key.
      expect(launchApprovalView('ask').next).toBe('auto')
      expect(launchApprovalView('auto').next).toBe('ask')
      // ⚑ …and no two of the three say the same thing.
      const headings = [null, 'ask', 'auto'].map(
        (mode) => launchApprovalView(mode as 'ask' | 'auto' | null).heading,
      )
      expect(new Set(headings).size).toBe(3)
    })

    /**
     * 🔴 **The press says what the press does, before the press** (`482`'s register) — and the
     * dangerous direction says what it is rather than gesturing at it.
     */
    it('🔴 the sentence on the button names the act, and the yolo direction names the consequence', () => {
      expect(launchApprovalView('ask').press).toContain('stop being asked')
      expect(launchApprovalView('ask').press).toContain('unattended')
      expect(launchApprovalView('auto').press).toContain('asked again')
      // The copy states the selected mode without second-guessing the person’s deliberate
      // choice.
      for (const mode of ['ask', 'auto'] as const) {
        const says = `${launchApprovalView(mode).heading} ${launchApprovalView(mode).press ?? ''}`
        for (const word of ['unsafe', 'dangerous', 'are you sure', 'warning']) {
          expect(says.toLowerCase(), word).not.toContain(word)
        }
      }
    })

    /**
     * ⛔ **The bound is said ONCE, beside the control rather than on either option** (`482`), and it
     * names the two things a person most needs: that it is not one conversation, and where a single
     * conversation's own mode changes instead.
     */
    it('⛔ the bound says it is every conversation, and points at the per-conversation door', () => {
      expect(LAUNCH_APPROVAL_BOUND).toContain('every conversation you start')
      expect(LAUNCH_APPROVAL_BOUND).toContain('until you change it back')
      expect(LAUNCH_APPROVAL_BOUND).toContain('keeps the mode it began in')
      // ⚑ **The tab's own label, read off `DRAWER_TABS` and never typed** — `CHANGEABLE_LIVE_IN`'s
      // rule, which is what makes renaming the tab rename this sentence.
      expect(LAUNCH_APPROVAL_BOUND).toContain(CHANGEABLE_LIVE_IN)
      expect(CHANGEABLE_LIVE_IN).toContain('Agent')
    })
  })
})
