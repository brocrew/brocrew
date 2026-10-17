import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeChangeMessage,
  type RuntimeChangeSubject,
} from '../src/shared/runtime-ipc'
import { oneReadAtATime } from '../src/renderer/src/lib/one-read-at-a-time'
import { whenTheWorldMoves } from '../src/renderer/src/lib/the-world-moved'

/**
 * # 🔴 678 §4 · Reads per act — `672`'s burst harness, landed as a pin on COUNTS (rule 39)
 *
 * ⚑ **`672` built `zz-672-burst` to measure how many change announcements one realistic act makes**,
 * and priced the Team page's forest from it; `678` priced every other reader the same way and
 * coalesced the two that were material. ⛔ **This lands the COUNTING half and never the wall-clock
 * grid** (standing rule 22): what it pins is a number of announcements and a number of reads, which
 * the code decides, and not a number of milliseconds, which the machine does.
 *
 * | | ⚑ what is pinned | through |
 * |---|---|---|
 * | §1 | how many announcements, of which subject, one act makes | the REAL host, on the fake runtime, through the real agent tools |
 * | §2 | how many reads each coalesced reader makes for §1's acts, and the last change read | the REAL router (`whenTheWorldMoves`) and the REAL wrapper (`oneReadAtATime`) |
 *
 * ⚠️ **What it does not say**: how far apart a real provider spreads one act's announcements (`672`
 * F5, unmeasured) — §2 delivers each act's announcements in one breath, which is the case the wrapper
 * bounds. ⚠️ **And what a read COSTS** is `678`'s response (§4), a machine number, not an assertion.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  // ⚑ the events themselves are not what this file counts — the announcements are
  send(): void {}
  sendLiveness(): void {}
}

/** ⚑ The toolset each conversation is handed — how the harness calls the agent tools as an agent would. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: { cwd: string; tools: AgentToolset }[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push({ cwd: options.cwd, tools: options.agentTools })
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push({ cwd: ref.cwd, tools: options.agentTools })
    return handle
  }
}

type Tally = Partial<Record<RuntimeChangeSubject, number>>

/**
 * ⚑ **The acts, and what `672` measured each one announces** — the ONE table §1 asserts against the
 * host and §2 feeds to the renderer, so the two halves cannot drift apart (`678`'s scout: *"B1 is only
 * as good as its fixture"*).
 */
const ACTS = {
  // ⚑ **D-016 · `spawn_agent` is gone, and a give is what starts a conversation**: `672`'s *spawn 3*
  // and *give 3 tasks* are ONE act now — three gives, each starting its worker's conversation with
  // the brief as its first turn — and the pin is what that act announces (re-measured at D-016).
  // Each give and its stall announce work; the serial giver notice then queues and sends,
  // announcing both queue changes. Three pieces therefore produce twelve work announcements.
  'give 3': { conversations: 3, agents: 3, work: 12 },
  '3 replies': { work: 3 },
  // ⚑ **D-017** — it was *end 3*, the parent's `end_agent` on each child, and nothing ends a
  // conversation any more: the act is the STOP, the app's own close — the teardown `end_agent`
  // escalated to.
  'stop 3': { conversations: 6 },
} as const satisfies Record<string, Tally>
type Act = keyof typeof ACTS

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the host — announcements per act
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · announcements per act, through the real host', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: { cwd: string; tools: AgentToolset }[]
  let heard: { act: string; what: RuntimeChangeSubject }[]
  let act: string
  let counter: number
  let clock: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-678-acts-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-678-acts-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    const tick = (): number => clock++
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    heard = []
    act = 'setup'
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
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
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      announce: (message: RuntimeChangeMessage) => {
        heard.push({ act, what: message.what })
      },
    })
  })

  afterEach(async () => {
    act = 'teardown'
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const tally = (label: string): Tally => {
    const out: Tally = {}
    for (const one of heard) if (one.act === label) out[one.what] = (out[one.what] ?? 0) + 1
    return out
  }

  /**
   * ⚑ **Bounded by the THING, never by a clock** (`wait-on-the-thing-not-on-its-text`): wait for the
   * act's own count, then drain a few turns of the loop and require that nothing more arrived — so a
   * late extra announcement is a failure, not a stray in the next act's bucket.
   */
  const settled = async (label: Act): Promise<Tally> => {
    await vi.waitFor(
      () =>
        expect(tally(label), JSON.stringify({ label, counts: tally(label) })).toEqual(ACTS[label]),
      { timeout: 10_000 },
    )
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve))
    return tally(label)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  it('🔴 give 3, 3 replies, stop 3 — each announces what `672` measured, and no more', async () => {
    // ⚑ a project manager that gives three workers a piece each — `672`'s own preparation, with
    // two changes: ⚠️ **three identities, not one.** A give reaches the ONE conversation its giver
    // has with an agent (D-016), so three children are three agents, as a person would staff it.
    // ⚑ **And no grant is set**: since D-014 every agent may give work to any agent, with no fan-out cap.
    const WORKERS = ['worker-a', 'worker-b', 'worker-c']
    const window = new Sink('webContents:1')
    for (const profileId of WORKERS) {
      const seeded = await host.createSession(
        { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
        window,
      )
      await host.close(seeded.sessionId, window)
    }
    await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: root },
      window,
    )
    const pmTools = handed.at(-1)?.tools
    if (pmTools === undefined) throw new Error('no pm toolset')

    const children: string[] = []
    const childTools = new Map<string, AgentToolset>()
    const pieces = new Map<string, string>()

    act = 'give 3'
    for (let i = 0; i < 3; i += 1) {
      const before = handed.length
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: WORKERS[i],
        title: `slice ${String(i)}`,
        brief: 'do it',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.started).toBe(true)
      const child = given.agent as string
      children.push(child)
      pieces.set(child, given.label as string)
      // ⚑ a give starts its conversation in the giver's own folder, so the toolset is the one the
      // start handed over — the newest since this give began
      const mine = handed.slice(before).at(-1)
      if (mine === undefined) throw new Error('no child toolset')
      childTools.set(child, mine.tools)
    }
    expect(await settled('give 3')).toEqual(ACTS['give 3'])

    act = '3 replies'
    for (const child of children) {
      const piece = pieces.get(child)
      if (piece === undefined) throw new Error(`no piece given to ${child}`)
      expect(store.openPiecesOf(child).map((one) => one.label)).toEqual([piece])
      const replied = await callOn(childTools.get(child)!, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'finished',
      })
      expect(replied.outcome ?? replied.ok, JSON.stringify(replied)).toBeTruthy()
    }
    expect(await settled('3 replies')).toEqual(ACTS['3 replies'])

    act = 'stop 3'
    for (const child of children) {
      await host.close(child, THE_APP_ITSELF)
      expect(host.sessionIds).not.toContain(child)
    }
    expect(await settled('stop 3')).toEqual(ACTS['stop 3'])
  }, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the renderer — reads per act, through the real router and the real wrapper
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ A read the test answers when it chooses — so a burst lands while the first read is in the air. */
function aSlowRead() {
  const pending: (() => void)[] = []
  let started = 0
  const read = (): Promise<void> => {
    started += 1
    return new Promise<void>((resolve) => pending.push(resolve))
  }
  const finishAll = async (): Promise<void> => {
    // answer each read as it starts, until none is left — an owed read starts only after one ends
    for (let round = 0; round < 20; round++) {
      const next = pending.shift()
      if (next === undefined) {
        await Promise.resolve()
        if (pending.length === 0) return
        continue
      }
      next()
      for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    }
  }
  return { read, reads: () => started, finishAll }
}

/**
 * ⚑ **Which reader each subject fires, as `RuntimeScreen`'s arms fire them** — pinned against the
 * screen's source below, so this table cannot quietly differ from the component nothing mounts.
 *
 * ⚑ **D-016 deleted the room** (the project workspace and its reader `readTheRoom`), so the
 * `conversations` arm fires two coalesced readers where it fired three.
 */
const ARMS: Record<RuntimeChangeSubject, readonly ('workspace' | 'forest')[]> = {
  conversations: ['workspace', 'forest'],
  work: ['forest'],
  agents: [],
}

describe('§2 · reads per act, through `whenTheWorldMoves` and `oneReadAtATime`', () => {
  it('⚑ the arms really fire those readers — the screen’s own source, sliced per arm', () => {
    const screen = readFileSync(
      join(here, '../src/renderer/src/components/RuntimeScreen.vue'),
      'utf8',
    ).replace(/^\s*\/\/.*$/gm, '')
    const from = screen.indexOf('stopListening = whenTheWorldMoves(')
    expect(from, 'the screen no longer subscribes through whenTheWorldMoves').toBeGreaterThan(0)
    /**
     * ⚠️ **Each arm is sliced to the NEXT one, and every bound is asserted to exist** (`678`'s review):
     * the first cut looked for `agents: () => {`, the arm is `agents: () => refreshAgents(),`, the
     * index was -1 and the slice ran to the end of the file — where onMounted and the ticks call the
     * same readers, so deleting a call from the ARM left this green.
     */
    const at = (needle: string, after: number): number => {
      const found = screen.indexOf(needle, after)
      expect(found, `${needle} is not where the arms are`).toBeGreaterThan(after)
      return found
    }
    const conversationsAt = at('    conversations: () => {', from)
    const workAt = at('    work: () => {', conversationsAt)
    const agentsAt = at('    agents: ', workAt)
    const endAt = at('\n  })', agentsAt)
    const arms: Record<RuntimeChangeSubject, string> = {
      conversations: screen.slice(conversationsAt, workAt),
      work: screen.slice(workAt, agentsAt),
      agents: screen.slice(agentsAt, endAt),
    }
    // ⚑ **Derived from ARMS**, both ways: every reader the table lists is called in that arm, and
    // every reader it does not list is not — so the table §2 feeds cannot drift from the screen.
    const CALLS = {
      workspace: 'readTheWorkspace()',
      forest: 'readWhoIsWorking()',
    } as const
    for (const subject of Object.keys(arms) as RuntimeChangeSubject[]) {
      for (const [reader, call] of Object.entries(CALLS) as [keyof typeof CALLS, string][]) {
        const listed = ARMS[subject].includes(reader)
        expect(arms[subject].includes(`void ${call}`), `${subject} · ${reader}`).toBe(listed)
      }
    }
  })

  for (const [name, burst] of Object.entries(ACTS) as [Act, Tally][]) {
    it(`🔴 ${name}: each coalesced reader reads at most twice — and the control, unwrapped, reads every time`, async () => {
      const readers = { workspace: aSlowRead(), forest: aSlowRead() }
      const wrapped = {
        workspace: oneReadAtATime(readers.workspace.read),
        forest: oneReadAtATime(readers.forest.read),
      }
      // ⛔ the planted control: the same reader, NOT wrapped — what every reader did before
      const bare = aSlowRead()
      let deliver: (message: RuntimeChangeMessage) => void = () => {}
      const stop = whenTheWorldMoves(
        (listener) => {
          deliver = listener
          return () => {}
        },
        {
          conversations: () => {
            for (const one of ARMS.conversations) void wrapped[one]()
            void bare.read()
          },
          work: () => {
            for (const one of ARMS.work) void wrapped[one]()
          },
          agents: () => {},
        },
        () => false,
      )
      // ⚑ the act, in one breath — the case the wrapper bounds
      const fired: Record<'workspace' | 'forest', number> = {
        workspace: 0,
        forest: 0,
      }
      for (const [what, count] of Object.entries(burst) as [RuntimeChangeSubject, number][]) {
        for (let i = 0; i < count; i++) {
          deliver({ what } as RuntimeChangeMessage)
          for (const one of ARMS[what]) fired[one] += 1
        }
      }
      await Promise.all(Object.values(readers).map((one) => one.finishAll()))
      await bare.finishAll()
      stop()
      for (const one of ['workspace', 'forest'] as const) {
        // ⚑ at most one in the air and one owed — and at least one whenever the act fired it, so the
        // last change is always read
        expect(readers[one].reads(), `${name} · ${one}`).toBe(Math.min(fired[one], 2))
      }
      // ⛔ the control reads once per `conversations` announcement — the burst the wrapper removes
      expect(bare.reads(), `${name} · unwrapped`).toBe(burst.conversations ?? 0)
    })
  }
})
