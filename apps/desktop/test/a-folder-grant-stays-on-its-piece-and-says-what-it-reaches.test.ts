import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { userProviderHomePath } from '../src/main/adopt/user-homes'
import { aProtectedPlace, type ThePlaces } from '../src/main/protected-places'
import {
  RuntimeHost,
  type CallerIdentity,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type SessionLiveness,
  type SessionLivenessMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import type { ProtectedPlaceNotice } from '../src/shared/work-folders'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # A give's folder, granted on the helper's existing conversation: who holds it, when it ends,
 * # where a spelled folder lands, and what the giver is told
 *
 * The grant tests beside this one give to a single helper, with absolute folders, and end a piece
 * only by its reply or a take-back of a brief already handed over. These sections pin the rest:
 *
 *  - §1 ⛔ a grant rides only the conversation its piece was given to — never another helper of the
 *    same giver. No existing test starts a second helper, so reading every conversation's open
 *    pieces would pass them all.
 *  - §2 🔴 a piece its giver closes takes its folder back at the next turn, and a held brief taken
 *    back before it went grants nothing and leaves the window. Only a reply and a take-back of a
 *    delivered brief are tested today; a filter that kept closed or withdrawn pieces passes them.
 *  - §3 🔴 the giver's receipt says what the grant changes for that conversation: nothing for one
 *    that runs without asking, writes for Codex asking first, reads for Claude asking first. The
 *    only assertion today is a `null` reach for a give with no grant.
 *  - §4 🔴 a relative folder is read from the giver's folder, for a start and a grant alike; `..`
 *    may leave it; `~` is the home folder; a blank folder grants nothing. Every existing give names
 *    an absolute folder.
 *  - §5 ⛔ a places check that throws is said as `could-not-check`, and the give still goes with its
 *    grant. No test hands the host a check that throws.
 *
 * Real host, real SQLite ledger, real migrations; the provider is the double, whose handle adopts
 * its work folders at a turn boundary as both real adapters do. Scratch folders only; the one test
 * that needs `~` points HOME at a scratch folder and refuses to run if it resolves anywhere else.
 */
describe('a give’s folder as a grant: its holder, its end, its spelling and its words', () => {
  class Window implements RuntimeEventSink {
    readonly aPersonIsBehindIt = true
    readonly messages: RuntimeEventMessage[] = []
    readonly liveness: SessionLivenessMessage[] = []
    alive = true
    constructor(readonly ownerId: string) {}
    send(message: RuntimeEventMessage): void {
      this.messages.push(message)
    }
    sendLiveness(message: SessionLivenessMessage): void {
      this.liveness.push(message)
    }
    latest(sessionId: string): SessionLiveness | undefined {
      return this.liveness.filter((one) => one.sessionId === sessionId).at(-1)?.liveness
    }
  }

  let scratch: string
  let userData: string
  let workspace: string
  let repoA: string
  let repoB: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let window: Window
  let counter: number
  let places: ThePlaces
  /** What the host asks of a give's folder; a test may swap it for one that throws. */
  let placeOf: (folder: string) => ProtectedPlaceNotice | null

  const build = (): RuntimeHost => {
    const sessions = new FakeProviderSessions()
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, sessions, anOpenGate()),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      protectedPlaceOf: (folder) => placeOf(folder),
    })
  }

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'brobot2-grant-holder-'))
    userData = join(scratch, 'userData')
    workspace = join(scratch, 'workspace')
    repoA = join(scratch, 'repo-a')
    repoB = join(scratch, 'repo-b')
    for (const folder of [userData, workspace, repoA, repoB, join(scratch, 'home', '.codex')]) {
      mkdirSync(folder, { recursive: true })
    }
    places = {
      home: join(scratch, 'home'),
      claudeConfigHomes: [join(scratch, 'home', '.claude')],
      codexConfigHomes: [join(scratch, 'home', '.codex')],
      providerHomesRoot: join(userData, 'provider-homes'),
      appData: { folder: userData, workspace: join(userData, 'brobot-workspace') },
      otherWorkspaces: [],
    }
    placeOf = (folder) => aProtectedPlace(folder, places)
    const here = dirname(fileURLToPath(import.meta.url))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(here, '../src/main/db/migrations'))
    store = createSessionStore(db)
    handles = []
    counter = 0
    host = build()
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })
  /** Where a folder really is — what the provider is handed (`/var` is a link on macOS). */
  const real = (path: string): string => realpathSync.native(path)

  const waitFor = async (what: string, done: () => boolean): Promise<void> => {
    const until = Date.now() + 4_000
    while (Date.now() < until) {
      if (done()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * A giver in a person's window, with each helper agent in existence first, on one provider and
   * one approval mode. `auto` turns end alone; `ask` turns park on a card.
   */
  async function aGiver(
    approvalMode: 'auto' | 'ask' = 'auto',
    provider: Provider = 'codex',
    helpers: readonly string[] = ['pm'],
  ): Promise<string> {
    for (const profileId of helpers) {
      const made = await host.createSession(
        { provider, profileId, cwd: workspace, approvalMode },
        window,
      )
      await host.close(made.sessionId, window)
    }
    const { sessionId } = await host.createSession(
      { provider, profileId: DEFAULT_PROFILE_ID, cwd: workspace, approvalMode },
      window,
    )
    return sessionId
  }

  const turnsOf = (id: string): TranscriptEvent[] =>
    store.events(id).flatMap((entry) => (entry.event.type === 'user_turn' ? [entry.event] : []))
  const turnsEnded = (id: string): number =>
    store.events(id).filter((entry) => entry.event.type === 'turn').length
  const sentOf = (id: string): string[] =>
    turnsOf(id).map((event) => (event.type === 'user_turn' ? (event.sent ?? event.text) : ''))
  /** Every turn handed to it so far has ended. */
  const allTurnsEnded = (id: string): boolean => turnsEnded(id) >= turnsOf(id).length
  const handleOf = (owner: string): FakeSessionHandle => {
    const ref = store.find(owner)?.ref.sessionId
    const found = handles.filter((one) => one.ref?.sessionId === ref).at(-1)
    if (found === undefined) throw new Error(`no handle for ${owner}`)
    return found
  }
  const cardsOf = (id: string): string[] =>
    store
      .events(id)
      .flatMap((entry) => (entry.event.type === 'permission_request' ? [entry.event.id] : []))

  /** A conversation's own call of one of this app's tools, as its model makes it. */
  const callAs = async (sessionId: string, name: string, args: Record<string, unknown>) => {
    const found = agentToolsFor(host, sessionId).tools.find((one) => one.name === name)
    if (found === undefined) throw new Error(`no ${name} tool`)
    return found.call(args)
  }

  const answered = async (owner: string, label: string): Promise<void> => {
    const replied = await callAs(owner, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'done',
    })
    expect((replied.structured as { outcome?: string }).outcome).toBe('ok')
  }

  /**
   * A first give (which starts the helper), its first turn ended, and the piece answered — a turn
   * that ends with its piece open stalls it, and a give to a stalled conversation is refused.
   */
  async function aHelperAtWork(giver: string, profile = 'pm'): Promise<string> {
    const first = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: 'the first piece',
        brief: 'start here',
        folder: repoA,
      },
      speakingAs(giver),
    )
    if (!first.ok) throw new Error(`refused: ${first.refusal.rail}`)
    await waitFor('the first turn to end', () => turnsEnded(first.owner) >= 1)
    await answered(first.owner, first.label)
    return first.owner
  }

  type GiveAnswer = { outcome?: string; label?: string; folder?: unknown }

  // ───────────────────────────── §1 · a grant rides its own conversation ─────────────────────────────

  describe('§1 · a grant rides only the conversation its piece was given to', () => {
    it('⛔ another helper of the same giver gets nothing at its next turn — ⚑ while the helper given the piece has it', async () => {
      const giver = await aGiver('auto', 'codex', ['pm', 'dev'])
      const pm = await aHelperAtWork(giver, 'pm')
      const dev = await aHelperAtWork(giver, 'dev')
      expect(dev).not.toBe(pm)
      host.claimSession(pm, window)
      host.claimSession(dev, window)
      const given = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'B',
          brief: 'work in B',
          folder: repoB,
        },
        speakingAs(giver),
      )
      if (!given.ok) throw new Error(`refused: ${given.refusal.rail}`)
      expect(given.owner).toBe(pm)
      expect(given.givenFolder).toEqual({ folder: repoB, use: 'grant' })
      await waitFor('B’s turn', () => turnsEnded(pm) >= 2)
      // ⚑ The helper given the piece has the folder, and its window shows it applied.
      expect(handleOf(pm).workFolders.effective).toEqual([real(repoB)])
      await waitFor(
        'the grant shown on its holder',
        () => window.latest(pm)?.workFolders?.[0]?.state === 'applied',
      )
      // ⛔ The other helper's next turn carries nothing, and its window names no grant.
      const before = turnsEnded(dev)
      await host.queueMessage(dev, 'a note', speakingAs(giver))
      await waitFor('the other helper’s turn', () => turnsEnded(dev) > before)
      expect(sentOf(dev).at(-1)).toContain('a note')
      expect(handleOf(dev).workFolders.effective).toEqual([])
      expect(handleOf(dev).workFolders.requested).toEqual([])
      expect(window.latest(dev)).toBeDefined()
      expect(window.latest(dev)?.workFolders).toBeUndefined()
    })
  })

  // ───────────────────────────── §2 · a close, and a held brief taken back ─────────────────────────────

  describe('§2 · a piece that ends by a close or before its brief went grants nothing after', () => {
    it('🔴 a piece its giver closes takes its folder back at the next turn — ⚑ applied until then', async () => {
      const giver = await aGiver()
      const helper = await aHelperAtWork(giver)
      host.claimSession(helper, window)
      const given = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'B',
          brief: 'work in B',
          folder: repoB,
        },
        speakingAs(giver),
      )
      if (!given.ok) throw new Error(`refused: ${given.refusal.rail}`)
      await waitFor('B’s turn', () => turnsEnded(helper) >= 2)
      // ⚑ The grant is in force while the piece is open.
      expect(handleOf(helper).workFolders.effective).toEqual([real(repoB)])
      await waitFor(
        'the grant shown applied',
        () => window.latest(helper)?.workFolders?.[0]?.state === 'applied',
      )
      const closed = await callAs(giver, 'update_work', { piece: given.label, close: true })
      expect((closed.structured as { outcome?: string }).outcome, closed.text).toBe('ok')
      // ⛔ The next turn — the close's own notice, then a note — carries no folder.
      await host.queueMessage(helper, 'a note', speakingAs(giver))
      await waitFor(
        'the note’s turn',
        () => sentOf(helper).some((one) => one.includes('a note')) && allTurnsEnded(helper),
      )
      expect(handleOf(helper).workFolders.effective).toEqual([])
      await waitFor(
        'the grant gone from the window',
        () => window.latest(helper)?.workFolders === undefined,
      )
    })

    it('⛔ a held brief taken back before it went grants nothing and leaves the window — ⚑ shown queued until then', async () => {
      const giver = await aGiver('ask')
      const first = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'the first piece',
          brief: 'start here',
          folder: repoA,
        },
        speakingAs(giver),
      )
      if (!first.ok) throw new Error(`refused: ${first.refusal.rail}`)
      const helper = first.owner
      host.claimSession(helper, window)
      await waitFor('the first turn to park on its card', () => cardsOf(helper).length === 1)
      const second = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'B',
          brief: 'work in B',
          folder: repoB,
        },
        speakingAs(giver),
      )
      if (!second.ok) throw new Error(`refused: ${second.refusal.rail}`)
      expect(second.delivery).toBe('held')
      // ⚑ Held with its brief, the grant is shown queued.
      await waitFor(
        'the grant shown queued',
        () => window.latest(helper)?.workFolders?.[0]?.state === 'queued',
      )
      const taken = await host.takeBackPiece({ piece: second.label }, speakingAs(giver))
      expect(taken.ok, JSON.stringify(taken)).toBe(true)
      // ⛔ Taken back, it is no longer shown at all.
      await waitFor(
        'the grant gone from the window',
        () => window.latest(helper)?.workFolders === undefined,
      )
      // ⛔ The card answered, the next turn goes — and neither the brief nor its folder is in it.
      await host.respondPermission(helper, cardsOf(helper)[0]!, { outcome: 'cancel' }, window)
      await waitFor('the next turn', () => cardsOf(helper).length === 2)
      expect(sentOf(helper).some((one) => one.includes('work in B'))).toBe(false)
      expect(handleOf(helper).workFolders.effective).toEqual([])
      expect(handleOf(helper).workFolders.requested).toEqual([])
      expect(window.latest(helper)?.workFolders).toBeUndefined()
    })
  })

  // ───────────────────────────── §3 · the receipt says what the grant reaches ─────────────────────────────

  describe('§3 · the giver is told what the grant changes for that conversation', () => {
    const RUNS_WITHOUT_ASKING = 'It runs without asking, so it could already reach'
    const MAY_WRITE = 'without asking while'
    const STILL_ASKS = 'still asks before changing anything'

    it('🔴 a helper that runs without asking: nothing new — ⛔ no write or read sentence', async () => {
      const giver = await aGiver()
      await aHelperAtWork(giver)
      const given = await callAs(giver, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
        folder: repoB,
      })
      const data = given.structured as GiveAnswer
      expect(data.outcome, given.text).toBe('ok')
      expect(data.folder).toEqual({ folder: repoB, use: 'grant' })
      expect(given.text).toContain(
        `${RUNS_WITHOUT_ASKING} ${repoB}; the folder is shown as granted while ${data.label ?? '?'} is open.`,
      )
      expect(given.text).not.toContain(MAY_WRITE)
      expect(given.text).not.toContain(STILL_ASKS)
    })

    it('🔴 Codex asking first may now write there without asking — ⛔ never told it still asks', async () => {
      const giver = await aGiver('ask', 'codex')
      const first = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'the first piece',
          brief: 'start here',
          folder: repoA,
        },
        speakingAs(giver),
      )
      if (!first.ok) throw new Error(`refused: ${first.refusal.rail}`)
      await waitFor('the first turn to park on its card', () => cardsOf(first.owner).length === 1)
      const given = await callAs(giver, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
        folder: repoB,
      })
      const data = given.structured as GiveAnswer
      expect(data.outcome, given.text).toBe('ok')
      expect(data.folder).toEqual({ folder: repoB, use: 'grant' })
      expect(given.text).toContain(
        `It may also write in ${repoB} without asking while ${data.label ?? '?'} is open; its own working folder is unchanged.`,
      )
      expect(given.text).not.toContain(STILL_ASKS)
      expect(given.text).not.toContain(RUNS_WITHOUT_ASKING)
    })

    it('🔴 Claude asking first reads there without asking and still asks before changing anything — ⛔ never told it may write', async () => {
      const giver = await aGiver('ask', 'claude')
      const first = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'the first piece',
          brief: 'start here',
          folder: repoA,
        },
        speakingAs(giver),
      )
      if (!first.ok) throw new Error(`refused: ${first.refusal.rail}`)
      expect(store.find(first.owner)?.provider).toBe('claude')
      await waitFor('the first turn to park on its card', () => cardsOf(first.owner).length === 1)
      const given = await callAs(giver, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
        folder: repoB,
      })
      const data = given.structured as GiveAnswer
      expect(data.outcome, given.text).toBe('ok')
      expect(data.folder).toEqual({ folder: repoB, use: 'grant' })
      expect(given.text).toContain(
        `It may also work in ${repoB} while ${data.label ?? '?'} is open: it reads there without asking, and ${STILL_ASKS}; its own working folder is unchanged.`,
      )
      expect(given.text).not.toContain(MAY_WRITE)
      expect(given.text).not.toContain(RUNS_WITHOUT_ASKING)
    })
  })

  // ───────────────────────────── §4 · where a spelled folder lands ─────────────────────────────

  describe('§4 · a relative, `..`, `~` or blank folder', () => {
    it('🔴 a relative folder is read from the giver’s folder, for a start and a grant alike; `..` may leave it — ⛔ a blank one grants nothing', async () => {
      const startIn = join(workspace, 'a-relative-start')
      const grantIn = join(workspace, 'a-relative-grant')
      mkdirSync(startIn)
      mkdirSync(grantIn)
      const giver = await aGiver()
      // ⚑ The start: its working folder is the giver's folder joined with the name.
      const first = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'the first piece',
          brief: 'start here',
          folder: 'a-relative-start',
        },
        speakingAs(giver),
      )
      if (!first.ok) throw new Error(`refused: ${first.refusal.rail}`)
      expect(first.givenFolder).toEqual({ folder: startIn, use: 'working-folder' })
      expect(store.find(first.owner)?.cwd).toBe(startIn)
      const helper = first.owner
      await waitFor('the first turn', () => turnsEnded(helper) >= 1)
      await answered(helper, first.label)

      /** One give with `folder` to the helper, its turn, what that turn carried, then its reply. */
      const aGiveWith = async (folder: string, turn: number) => {
        const given = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'pm',
            title: `in ${folder}`,
            brief: `work in ${folder}`,
            folder,
          },
          speakingAs(giver),
        )
        if (!given.ok) throw new Error(`refused: ${given.refusal.rail}`)
        expect(given.owner).toBe(helper)
        await waitFor(`the turn for “${folder}”`, () => turnsEnded(helper) >= turn)
        const carried = [...handleOf(helper).workFolders.effective]
        await answered(helper, given.label)
        return { given, carried }
      }

      // ⚑ A grant: from the GIVER's folder, not the helper's (which is the start folder now).
      const relative = await aGiveWith('a-relative-grant', 2)
      expect(relative.given.givenFolder).toEqual({ folder: grantIn, use: 'grant' })
      expect(relative.given.folderNotGranted).toBeNull()
      expect(relative.carried).toEqual([real(grantIn)])

      // ⚑ `..` leaves the giver's folder, and that is allowed.
      const up = await aGiveWith('../repo-b', 3)
      expect(up.given.givenFolder).toEqual({ folder: repoB, use: 'grant' })
      expect(up.given.folderNotGranted).toBeNull()
      expect(up.carried).toEqual([real(repoB)])

      // ⛔ Blank is no folder: no grant, nothing refused, nothing carried.
      const blank = await aGiveWith('   ', 4)
      expect(blank.given.givenFolder).toBeNull()
      expect(blank.given.folderNotGranted).toBeNull()
      expect(blank.given.grantReach).toBeNull()
      expect(blank.carried).toEqual([])
    })

    const ENV_KEYS = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'] as const

    describe.sequential('`~`, with HOME pointed at a scratch folder', () => {
      /** The throwaway home folder `~` stands for here. */
      let theirs: string
      let saved: Record<(typeof ENV_KEYS)[number], string | undefined>

      beforeEach(() => {
        theirs = mkdtempSync(join(tmpdir(), 'brobot2-their-home-'))
        saved = {
          HOME: process.env['HOME'],
          USERPROFILE: process.env['USERPROFILE'],
          CODEX_HOME: process.env['CODEX_HOME'],
          CLAUDE_CONFIG_DIR: process.env['CLAUDE_CONFIG_DIR'],
        }
        process.env['HOME'] = theirs
        process.env['USERPROFILE'] = theirs
        process.env['CODEX_HOME'] = join(theirs, '.codex')
        process.env['CLAUDE_CONFIG_DIR'] = join(theirs, '.claude')
      })

      afterEach(() => {
        for (const key of ENV_KEYS) {
          const value = saved[key]
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        rmSync(theirs, { recursive: true, force: true })
      })

      /**
       * ⛔ SAFETY — the person's Codex folder, only when it is the throwaway one. Throws before
       * anything is written or read when it resolves anywhere else.
       */
      const theirCodex = (): string => {
        const home = userProviderHomePath('codex')
        if (!home.startsWith(`${theirs}${sep}`) || homedir() !== theirs) {
          throw new Error(`refusing to run: the codex home resolves to ${home}, outside ${theirs}`)
        }
        return home
      }

      it('🔴 `~/x` is read from the home folder — ⛔ never from the giver’s folder', async () => {
        theirCodex()
        const x = join(theirs, 'x')
        mkdirSync(x)
        const giver = await aGiver()
        const helper = await aHelperAtWork(giver)
        const given = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'pm',
            title: 'X',
            brief: 'work in x',
            folder: '~/x',
          },
          speakingAs(giver),
        )
        if (!given.ok) throw new Error(`refused: ${given.refusal.rail}`)
        expect(given.owner).toBe(helper)
        expect(given.givenFolder).toEqual({ folder: x, use: 'grant' })
        expect(given.folderNotGranted).toBeNull()
        await waitFor('X’s turn', () => turnsEnded(helper) >= 2)
        expect(handleOf(helper).workFolders.effective).toEqual([real(x)])
      })
    })
  })

  // ───────────────────────────── §5 · a places check that throws ─────────────────────────────

  describe('§5 · a places check that cannot be answered is said, never a refusal', () => {
    it('⛔ the check throws: the give goes, the folder is granted, and the receipt says it could not be checked', async () => {
      const giver = await aGiver()
      const helper = await aHelperAtWork(giver)
      // ⚑ The control: answered normally, this folder meets none of the places.
      expect(aProtectedPlace(repoB, places)).toBeNull()
      placeOf = () => {
        throw new Error('the places could not be read')
      }
      const given = await callAs(giver, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
        folder: repoB,
      })
      const data = given.structured as GiveAnswer
      expect(data.outcome, given.text).toBe('ok')
      expect(data.folder).toEqual({
        folder: repoB,
        use: 'grant',
        notice: { kind: 'could-not-check' },
      })
      expect(given.text).toContain(`Whether ${repoB} is or holds one of the places this app names`)
      expect(given.text).toContain('could not be checked')
      expect(given.text).toContain('It was used all the same.')
      // ⚑ …and the grant is in force all the same.
      await waitFor('B’s turn', () => turnsEnded(helper) >= 2)
      expect(handleOf(helper).workFolders.effective).toEqual([real(repoB)])
    })
  })
})
