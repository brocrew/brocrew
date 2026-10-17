import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { whenTheWorldMoves } from '../src/renderer/src/lib/the-world-moved'
import {
  DEFAULT_PROFILE_ID,
  RUNTIME_CHANGE_SUBJECTS,
  type RuntimeChangeMessage,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const src = join(here, '../src')

/**
 * # 🔴 534 · a conversation that is born while he is looking at the rail
 *
 * ## ⛔ The report, and what it actually was
 *
 * BroBot created a project, spawned a **project manager** into it and handed it the work. The whole
 * tier ran. ⚠️ **The rail's conversation list stayed at one row for three minutes**, and the
 * conversation only appeared once he navigated into the project and pressed it there.
 *
 * 🔴 **Every list in that rail is a PULL whose only triggers are acts the WINDOW performed.**
 * `SideRail.refreshClosed` runs `onMounted` and on a hand-maintained roster of local gestures;
 * `AgentStore.load` runs at mount, on an approved proposal and on a launch this window made. ⛔ **A
 * spawn is the one lifecycle moment no window performs** — the session is reserved under no owner,
 * its sink is `NO_SURFACE` and its ledger rows go to a discard — so there was nothing to react to.
 *
 * ⚑ **HO-013 §3 is the shape**: *"a rule that must be remembered each time is a rule that will
 * eventually be forgotten."* The roster IS that rule.
 *
 * ## ⚠️ What this file measures, and what it deliberately does not
 *
 * ⛔ **The POPULATIONS**: which conversations this app knows about and what each is doing, and which
 * identities exist. ⚑ Not every field of every row — a capability a person narrows on a sheet is a
 * change that window made, at a door `requireAPerson` keeps to a window, and `AgentStore` already
 * patches it from the database's own answer. §5's projection says exactly this in code.
 */

/** A `FakeRuntime` per launch over one shared ledger of provider sessions. */
function sharedRuntime(provider: Provider, sessions: FakeProviderSessions): FakeRuntime {
  return new FakeRuntime(provider, { sessions })
}

class WindowSink implements RuntimeEventSink {
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
 * ⛔ **What the rail's two conversation sections and its Agents section actually draw**, as one
 * comparable string — see the file docblock for why it is the populations and not the rows.
 */
type ThreeAnswers = { conversations: string[]; identities: string[] }

const withoutComments = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

describe('534 · a conversation that is born while he is looking at the rail', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  /** Every announcement this host made, in order. */
  let said: RuntimeChangeMessage[]
  /** What the host answered at the INSTANT of each announcement — §2's whole subject. */
  let answeredWhenSaid: ThreeAnswers[]
  /** ⛔ §5's planted fault: while this is true, the dep drops what it is handed. */
  let swallowing: boolean

  const answers = (): ThreeAnswers => ({
    conversations: [...host.resumableSessions(), ...host.unresumableSessions()]
      .map((row) => `${row.sessionId}:${row.status}:${row.running}`)
      .sort(),
    identities: host
      .agentIdentities()
      .identities.map((identity) => identity.slug)
      .sort(),
  })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-534-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    ledger = createSessionStore(db)
    sessions = new FakeProviderSessions()
    counter = 0
    said = []
    answeredWhenSaid = []
    swallowing = false
    host = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => sharedRuntime(provider, sessions),
      prepareProviderHome: (provider: Provider, profileId: string) => {
        const home = join(userData, 'provider-homes', profileId, provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider, profileId: string) =>
        join(userData, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      announce: (change) => {
        if (swallowing) return
        said.push(change)
        // 🔴 **The host's own answer, read INSIDE the announcement.** This is what makes §2 an
        // assertion about ORDER rather than about arrival: an announcement fired before its write
        // records the world without it.
        answeredWhenSaid.push(answers())
      },
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const spawned = async (profileId = DEFAULT_PROFILE_ID): Promise<string> => {
    // ⛔ **`null` is the whole point**: an agent's spawn passes no sink, so the slot is reserved
    // under no owner and this window is told nothing — see `NO_SURFACE`.
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask', profileId },
      null,
    )
    return sessionId
  }

  const personOpens = async (
    sink: RuntimeEventSink,
    profileId = DEFAULT_PROFILE_ID,
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask', profileId },
      sink,
    )
    return sessionId
  }

  const subjectsSaid = (): string[] => said.map((change) => change.what)

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the property: a conversation born with nobody watching reaches the list a rail draws
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a conversation nobody asked for arrives without a navigation', () => {
    it('🔴 an agent spawning a conversation makes this app say so, and the row is already there', async () => {
      // ⚑ The window is up and has looked once, which is `SideRail.refreshClosed`'s `onMounted`.
      const before = answers()
      expect(before.conversations, 'a fresh install has run nothing').toEqual([])

      const child = await spawned()

      // ⛔ **The announcement**, which is the only thing that can reach a window here: no sink was
      // supplied, so nothing on `runtime:event` was sent for this conversation at all.
      expect(subjectsSaid()).toContain('conversations')
      // 🔴 **And the row is on the list at the instant it was said** — see {@link answeredWhenSaid}.
      const atThatMoment = answeredWhenSaid[subjectsSaid().indexOf('conversations')]
      expect(atThatMoment?.conversations.some((row) => row.startsWith(`${child}:`))).toBe(true)
    })

    it('⚑ …and it reads `unwatched`, which is the section the rail already has', async () => {
      const child = await spawned()
      const row = [...host.resumableSessions(), ...host.unresumableSessions()].find(
        (one) => one.sessionId === child,
      )
      // ⛔ **The word, not a word near it.** `Not open in this window` is drawn from
      // `running !== 'not-running'` and `closed-threads.ts` splits on this exact value — `534` §2 is
      // explicit that the vocabulary is right and only arrival is wrong.
      expect(row?.running).toBe('unwatched')
    })

    it('⛔ a host wired without the dep spawns exactly the same conversation', async () => {
      // ⚠️ **Absence is a real answer** — every test host in this repo has no window. This is the
      // control for the whole file: the announcement is an addition, not a precondition.
      const quiet = new RuntimeHost({
        store: ledger,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => sharedRuntime(provider, sessions),
        prepareProviderHome: (provider: Provider, profileId: string) => {
          const home = join(userData, 'provider-homes', profileId, provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider, profileId: string) =>
          join(userData, 'provider-homes', profileId, provider),
        resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
        newSessionId: () => `quiet_${++counter}`,
        closeDrainTimeoutMs: 40,
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
      try {
        const { sessionId } = await quiet.createSession(
          { provider: 'claude', cwd: userData, approvalMode: 'ask' },
          null,
        )
        expect(quiet.resumableSessions().some((row) => row.sessionId === sessionId)).toBe(true)
        expect(said, 'the quiet host announced through the loud one').toEqual([])
      } finally {
        await quiet.closeAll()
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the order is the contract
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · an announcement lands after the write it is about', () => {
    it('🔴 what the host answers at the instant it speaks is what it answers when the act returns', async () => {
      const child = await spawned()
      const settled = answers()
      const spoke = answeredWhenSaid.at(-1)
      expect(spoke).toEqual(settled)

      // ⛔ **The pair that makes it a measurement** (`a-positive-assertion-must-differ-from-the-default`).
      // An announcement fired BEFORE the write would have recorded the world without this row, and
      // that world is a different value — so the equality above is not satisfied by anything.
      const beforeTheAct = { conversations: [] as string[], identities: [] as string[] }
      expect(spoke).not.toEqual(beforeTheAct)
      expect(spoke?.conversations.some((row) => row.startsWith(`${child}:`))).toBe(true)
    })

    it('🔴 an ENDING is announced after the slot is gone, so the row never reads `unwatched` once it is over', async () => {
      const child = await spawned()
      said = []
      answeredWhenSaid = []
      await host.close(child, THE_APP_ITSELF)

      // ⚠️ **Two announcements: the slot goes `closing` and then it is deleted.** The rail may learn
      // twice; what it may never learn is a RUNNING word for a conversation that is on its way out.
      expect(subjectsSaid().length).toBeGreaterThanOrEqual(1)
      const last = answeredWhenSaid.at(-1)
      expect(last?.conversations).toContain(`${child}:ended:not-running`)
      // 🔴 **And not one announcement in this act described it as running.** This is the half
      // `151`'s retired watch could not hold: it fired on the ENDING EVENT, ahead of the teardown,
      // so the re-read it provoked could take `unwatched` for a conversation that was already over
      // and leave it under *Not open in this window* with nothing left to correct it.
      const running = answeredWhenSaid.flatMap((snap) =>
        snap.conversations.filter(
          (row) =>
            row.startsWith(`${child}:`) &&
            (row.endsWith(':unwatched') || row.endsWith(':in-a-window')),
        ),
      )
      expect(running).toEqual([])
      // ⚑ **The pair, so the emptiness above is a measurement**: that is exactly the string the
      // same row produced one act earlier, while it really was running.
      expect(answers().conversations).not.toContain(`${child}:idle:unwatched`)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · everything that moves the answer says so — and the things that do not, do not
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · ownership, and the refusals beside it', () => {
    it('🔴 a claim and a hand-back each announce, and the word moves both ways', async () => {
      const child = await spawned()
      const window1 = new WindowSink('webContents:1')

      said = []
      host.claimSession(child, window1)
      expect(subjectsSaid()).toEqual(['conversations'])
      expect(answeredWhenSaid.at(-1)?.conversations).toContain(`${child}:idle:in-a-window`)

      said = []
      answeredWhenSaid = []
      host.releaseSession(child, window1)
      expect(subjectsSaid()).toEqual(['conversations'])
      expect(answeredWhenSaid.at(-1)?.conversations).toContain(`${child}:idle:unwatched`)
    })

    it('⛔ an ATTACH announces nothing, because an attach moves no owner', async () => {
      const window1 = new WindowSink('webContents:1')
      const mine = await personOpens(window1)
      said = []
      // ⚑ **The reconciliation a window runs on every store connect** — it re-attaches what it
      // already owns, and `runningStateOf` reads `slot.ownerId`, which does not move.
      const attached = host.attachOpenSessions(window1)
      expect(
        attached.map((one) => one.sessionId),
        'the attach did not happen, so the negative below measures nothing',
      ).toEqual([mine])
      expect(said).toEqual([])
    })

    it('⛔ closing a conversation this host is not running announces nothing', async () => {
      await spawned()
      said = []
      await host.close('sess_nobody_has_ever_heard_of', THE_APP_ITSELF)
      expect(said).toEqual([])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the sibling, two hundred pixels down the same rail
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · an identity an agent creates', () => {
    it('🔴 `create_agent`, through the agent door, announces `agents` with the row already written', async () => {
      const window1 = new WindowSink('webContents:1')
      const brobot = await personOpens(window1)
      said = []
      answeredWhenSaid = []

      const made = host.createAgentFor(
        brobot,
        { slug: 'archivist', displayName: null, provider: null },
        { ownerId: `agent:${brobot}` },
        // ⚑ **618 · *no rules* said explicitly** — the parameter is required, so no call site can
        // fall through to a default nobody chose (`a-default-no-call-site-reaches`).
        null,
        // ⚑ **D-042 · R2 · *no default model* said explicitly, the same idiom** — `create_agent`
        // named no model or effort, so the new identity's conversations start on R1's later steps.
        null,
      )
      expect(
        made,
        'the identity was not created, so nothing below measures anything',
      ).toMatchObject({ ok: true })
      expect(subjectsSaid()).toEqual(['agents'])
      expect(answeredWhenSaid.at(-1)?.identities).toContain('archivist')
    })

    it('⛔ a refused creation announces nothing, at either door', async () => {
      const window1 = new WindowSink('webContents:1')
      const brobot = await personOpens(window1)
      host.createAgent({ slug: 'archivist', displayName: null, provider: null })
      said = []

      // The agent's door, refused on the name.
      const again = host.createAgentFor(
        brobot,
        { slug: 'archivist', displayName: null, provider: null },
        { ownerId: `agent:${brobot}` },
        // ⚑ **618 · *no rules* said explicitly** — the parameter is required, so no call site can
        // fall through to a default nobody chose (`a-default-no-call-site-reaches`).
        null,
        // ⚑ **D-042 · R2 · *no default model* said explicitly, the same idiom** — `create_agent`
        // named no model or effort, so the new identity's conversations start on R1's later steps.
        null,
      )
      expect(again).toMatchObject({ ok: false, rail: 'agent-name-taken' })
      // The person's door, refused on the same name — which throws rather than answering.
      expect(() =>
        host.createAgent({ slug: 'archivist', displayName: null, provider: null }),
      ).toThrow()

      expect(said, 'a refusal wrote no row, so there was nothing to announce').toEqual([])
    })

    it('⚑ a launch under a profile name nobody has used announces both subjects', async () => {
      // ⛔ **One write, two populations.** `store.create` writes the session row and, through
      // `ensureIdentityRow`'s `INSERT OR IGNORE`, the identity row — which is why `RuntimeScreen`
      // called `refreshAgents()` beside its resumable refresh from `355` until this dispatch moved
      // the rule beside the write.
      said = []
      answeredWhenSaid = []
      await spawned('freeze-clock-builder')
      expect(subjectsSaid()).toEqual(['conversations', 'agents'])
      expect(answeredWhenSaid.at(-1)?.identities).toContain('freeze-clock-builder')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the rail on the rule: if the answer moved, the app said so
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · every act that moves a population announces it', () => {
    /**
     * ⛔ **Measured, not grepped.** The category is *the answer to one of the three reads moved*,
     * and this asks it of the answers themselves — so a writer added tomorrow in a method nobody
     * listed is caught by what it DOES rather than by how it is spelled (standing rule 20).
     */
    const around = async (
      act: () => unknown | Promise<unknown>,
    ): Promise<{ moved: boolean; announced: boolean }> => {
      const before = answers()
      said = []
      await act()
      const after = answers()
      return {
        moved: JSON.stringify(before) !== JSON.stringify(after),
        announced: said.length > 0,
      }
    }

    it('🔴 nine acts, and every one that moved a population announced it', async () => {
      const window1 = new WindowSink('webContents:1')
      let mine = ''
      let child = ''

      const script: [string, () => unknown | Promise<unknown>][] = [
        ['a person opens one', async () => (mine = await personOpens(window1))],
        ['an agent spawns one', async () => (child = await spawned('freeze-clock-builder'))],
        ['a window claims the spawned one', () => host.claimSession(child, window1)],
        ['the window hands it back', () => host.releaseSession(child, window1)],
        ['the window re-attaches what it owns', () => host.attachOpenSessions(window1)],
        [
          'an agent creates an identity',
          () =>
            host.createAgentFor(
              mine,
              { slug: 'archivist', displayName: null, provider: null },
              { ownerId: `agent:${mine}` },
              null,
              // ⚑ D-042 · R2: no default model named (the 5th parameter is required).
              null,
            ),
        ],
        [
          'an agent asks for a name that is taken',
          () =>
            host.createAgentFor(
              mine,
              { slug: 'archivist', displayName: null, provider: null },
              { ownerId: `agent:${mine}` },
              null,
              // ⚑ D-042 · R2: no default model named (the 5th parameter is required).
              null,
            ),
        ],
        [
          'a person creates an identity',
          () => host.createAgent({ slug: 'auditor', displayName: null, provider: null }),
        ],
        ['the spawned conversation ends', () => host.close(child, THE_APP_ITSELF)],
      ]

      const gaps: string[] = []
      let everMoved = 0
      for (const [what, act] of script) {
        const { moved, announced } = await around(act)
        if (moved) everMoved++
        if (moved && !announced) gaps.push(what)
      }
      // ⚠️ **The premise, asserted**: a script in which nothing moved would pass vacuously.
      expect(everMoved, 'no act in this script moved a population').toBeGreaterThanOrEqual(6)
      expect(gaps).toEqual([])
    })

    it('⛔ the rail can FAIL — two planted silences, and it names both', async () => {
      // 🔴 **Plant TWO, not one** (standing rule 12). One silence could be found by an instrument
      // that reported the first difference it met and stopped.
      const window1 = new WindowSink('webContents:1')
      let child = ''
      const gaps: string[] = []

      const script: [string, boolean, () => unknown | Promise<unknown>][] = [
        ['a person opens one', false, async () => void (await personOpens(window1))],
        // ⛔ **Planted #1** — the act that `534` is about.
        ['an agent spawns one', true, async () => (child = await spawned())],
        ['a window claims it', false, () => host.claimSession(child, window1)],
        // ⛔ **Planted #2** — the act `151`'s retired watch used to cover.
        ['the window hands it back', true, () => host.releaseSession(child, window1)],
      ]

      for (const [what, planted, act] of script) {
        swallowing = planted
        const { moved, announced } = await (async (): Promise<{
          moved: boolean
          announced: boolean
        }> => {
          const before = answers()
          said = []
          await act()
          const after = answers()
          return {
            moved: JSON.stringify(before) !== JSON.stringify(after),
            announced: said.length > 0,
          }
        })()
        swallowing = false
        if (moved && !announced) gaps.push(what)
      }
      expect(gaps).toEqual(['an agent spawns one', 'the window hands it back'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the window's half — the rule, driven directly
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · what the window does with an announcement', () => {
    const driven = (): {
      fire: (what: string) => void
      read: string[]
      stop: () => void
      subscribers: number
      closing: { now: boolean }
    } => {
      const read: string[] = []
      const closing = { now: false }
      let listener: ((message: RuntimeChangeMessage) => void) | null = null
      let subscribers = 0
      const stop = whenTheWorldMoves(
        (fn) => {
          listener = fn
          subscribers++
          return () => {
            listener = null
            subscribers--
          }
        },
        {
          conversations: () => read.push('conversations'),
          agents: () => read.push('agents'),
          // ⚑ **638 · the third arm.** ⛔ The rig has to carry every member or the Record does not
          // compile — which is rule 3 of `the-world-moved.ts` doing its job on this file too.
          work: () => read.push('work'),
        },
        () => closing.now,
      )
      return {
        fire: (what) => listener?.({ what } as RuntimeChangeMessage),
        read,
        stop,
        get subscribers() {
          return subscribers
        },
        closing,
      }
    }

    it('🔴 each subject re-reads its own population and nothing else', () => {
      const rig = driven()
      rig.fire('conversations')
      expect(rig.read).toEqual(['conversations'])
      rig.fire('agents')
      expect(rig.read).toEqual(['conversations', 'agents'])
      // ⚑ **638 · and the third**, so *each subject re-reads its own population and nothing else*
      // is a claim about the whole vocabulary rather than about the two it had when it was written.
      rig.fire('work')
      expect(rig.read).toEqual(['conversations', 'agents', 'work'])
    })

    it('⛔ a subject this window does not know is dropped, and the next one still lands', () => {
      const rig = driven()
      expect(() => rig.fire('projects')).not.toThrow()
      expect(rig.read).toEqual([])
      rig.fire('conversations')
      expect(rig.read).toEqual(['conversations'])
    })

    it('⛔ nothing is asked while the app is closing — 272 finding 1, with a wider aperture', () => {
      const rig = driven()
      rig.closing.now = true
      rig.fire('conversations')
      rig.fire('agents')
      expect(rig.read).toEqual([])
      // ⚑ The pair: it is the CLOSING that silences it, not the rig.
      rig.closing.now = false
      rig.fire('conversations')
      expect(rig.read).toEqual(['conversations'])
    })

    it('⛔ letting go really unsubscribes', () => {
      const rig = driven()
      expect(rig.subscribers).toBe(1)
      rig.stop()
      expect(rig.subscribers).toBe(0)
      rig.fire('conversations')
      expect(rig.read).toEqual([])
    })

    it('⚑ every subject on the wire has a reader here', () => {
      // ⛔ **The TYPE enforces this at the one call site** (`Record<RuntimeChangeSubject, …>`), and
      // this is the value-level pair, because a vocabulary is only closed if something walks it.
      const rig = driven()
      for (const what of RUNTIME_CHANGE_SUBJECTS) rig.fire(what)
      expect(rig.read.sort()).toEqual([...RUNTIME_CHANGE_SUBJECTS].sort())
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · one sender, one subscriber, and the neighbour that is deliberately not on this channel
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the channel has one of each', () => {
    const filesUnder = (root: string, suffixes: string[]): string[] => {
      const out: string[] = []
      const walk = (at: string): void => {
        for (const entry of readdirSync(at)) {
          const full = join(at, entry)
          if (statSync(full).isDirectory()) walk(full)
          else if (suffixes.some((suffix) => entry.endsWith(suffix))) out.push(full)
        }
      }
      walk(root)
      return out
    }

    it('🔴 the dep is reached through exactly one method, so no site can announce around it', () => {
      const code = withoutComments(readFileSync(join(src, 'main/runtime/runtime-host.ts'), 'utf8'))
      // ⛔ **One reader of the dep** — {@link RuntimeHost.theWorldMoved}, which is where the throw is
      // swallowed and where the category is written down.
      expect(code.match(/this\.deps\.announce/g) ?? []).toHaveLength(1)
      expect(code).toContain('private theWorldMoved(')
      // ⚑ …and it is genuinely used, which a count of one reader does not say.
      expect((code.match(/this\.theWorldMoved\(/g) ?? []).length).toBeGreaterThanOrEqual(8)
    })

    it('🔴 exactly one file in main sends on the channel, and one module in the renderer listens', () => {
      const senders = filesUnder(join(src, 'main'), ['.ts'])
        .filter((file) =>
          withoutComments(readFileSync(file, 'utf8')).includes('RUNTIME_CHANGED_CHANNEL'),
        )
        .map((file) => relative(src, file).replaceAll('\\', '/'))
      expect(senders).toEqual(['main/index.ts'])

      // ⚑ **B2 · the updates bridge has an `onChanged` of its own** (`window.api.updates`, another
      // channel), heard by `useUpdates.ts`; so does the themes bridge (`window.api.themes`), heard
      // only by `lib/window-theme.ts`, which passes each change on to the rest of the window. Each is
      // named here, so a SECOND listener on any of the three is red.
      const listeners = filesUnder(join(src, 'renderer'), ['.ts', '.vue'])
        .filter((file) => withoutComments(readFileSync(file, 'utf8')).includes('.onChanged('))
        .map((file) => relative(src, file).replaceAll('\\', '/'))
        .sort()
      expect(listeners).toEqual([
        'renderer/src/components/RuntimeScreen.vue',
        'renderer/src/composables/useUpdates.ts',
        'renderer/src/lib/window-theme.ts',
      ])
      const updatesListener = withoutComments(
        readFileSync(join(src, 'renderer/src/composables/useUpdates.ts'), 'utf8'),
      )
      expect(updatesListener).not.toContain('runtime')

      // ⛔ **And that one call site goes through the rule** rather than wiring readers itself.
      const screen = withoutComments(
        readFileSync(join(src, 'renderer/src/components/RuntimeScreen.vue'), 'utf8'),
      )
      expect(screen).toContain('whenTheWorldMoves(')
    })

    it('⛔ the two censuses above can fail — TWO planted senders and TWO planted listeners', () => {
      // 🔴 **Rule 12: plant TWO.** A census that reported the first extra it found would pass this
      // with one, and the defect it exists to catch is a SECOND writer nobody listed.
      const planted = [
        `contents.send(RUNTIME_CHANGED_CHANNEL, change)`,
        `other.send(RUNTIME_CHANGED_CHANNEL, change)`,
      ]
      expect(planted.filter((line) => line.includes('RUNTIME_CHANGED_CHANNEL'))).toHaveLength(2)
      const plantedListeners = [`window.api.runtime.onChanged(listener)`, `bridge.onChanged(other)`]
      expect(plantedListeners.filter((line) => line.includes('.onChanged('))).toHaveLength(2)
      // ⚑ **And the stripper is what makes those counts a claim about CODE**: a docblock naming the
      // channel must not be able to satisfy either census.
      const quoted = '/** `RUNTIME_CHANGED_CHANNEL` and `.onChanged(` are named here. */'
      expect(quoted).toContain('RUNTIME_CHANGED_CHANNEL')
      expect(withoutComments(quoted)).not.toContain('RUNTIME_CHANGED_CHANNEL')
      expect(withoutComments(quoted)).not.toContain('.onChanged(')
    })
  })
})
