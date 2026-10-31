import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
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
import { derivePieces } from '../src/shared/tasks'
import type { PersistedEventInfo } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # 🔴 W4.189 · A — a give's folder becomes a visible, work-linked grant on the helper's existing
 * # conversation
 *
 * An agent allowed to give work may grant the piece’s folder to a helper’s existing
 * conversation. The visible grant ends with the piece; the working folder stays fixed. The
 * folder enters provider scope through `SessionHandle.setWorkFolders` on the turn carrying
 * the brief and leaves on the first turn after the piece ends.
 *
 * ⛔ Real host, real SQLite ledger, real migrations; the provider is the double, whose handle adopts
 * the work folders at a turn boundary as both real adapters do. Scratch folders only.
 */
describe('W4.189 · a give’s folder, as a grant on the conversation it has', () => {
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
      protectedPlaceOf: (folder) => aProtectedPlace(folder, places),
    })
  }

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'brobot2-w4189-'))
    userData = join(scratch, 'userData')
    workspace = join(scratch, 'workspace')
    repoA = join(scratch, 'repo-a')
    repoB = join(scratch, 'repo-b')
    for (const folder of [userData, workspace, repoA, repoB, join(scratch, 'home', '.codex')]) {
      mkdirSync(folder, { recursive: true })
    }
    places = {
      home: join(scratch, 'home'),
      providerConfigHomes: {
        claude: [join(scratch, 'home', '.claude')],
        codex: [join(scratch, 'home', '.codex')],
      },
      providerHomesRoot: join(userData, 'provider-homes'),
      appData: { folder: userData, workspace: join(userData, 'brobot-workspace') },
      otherWorkspaces: [],
    }
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
  /** ⚑ Where a folder really is — what the provider is handed (`/var` is a link on macOS). */
  const real = (path: string): string => realpathSync.native(path)

  const waitFor = async (what: string, done: () => boolean): Promise<void> => {
    const until = Date.now() + 4_000
    while (Date.now() < until) {
      if (done()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ A giver in a person's window, a `pm` agent in existence, unattended so turns end alone. */
  async function aGiver(approvalMode: 'auto' | 'ask' = 'auto'): Promise<string> {
    const pm = await host.createSession(
      { provider: 'codex', profileId: 'pm', cwd: workspace, approvalMode },
      window,
    )
    await host.close(pm.sessionId, window)
    const { sessionId } = await host.createSession(
      { provider: 'codex', profileId: DEFAULT_PROFILE_ID, cwd: workspace, approvalMode },
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
  const handleOf = (owner: string): FakeSessionHandle => {
    const ref = store.find(owner)?.ref.sessionId
    const found = handles.filter((one) => one.ref?.sessionId === ref).at(-1)
    if (found === undefined) throw new Error(`no handle for ${owner}`)
    return found
  }

  /** ⚑ A conversation's own call of one of this app's tools, as its model makes it. */
  const callAs = async (sessionId: string, name: string, args: Record<string, unknown>) => {
    const found = agentToolsFor(host, sessionId).tools.find((one) => one.name === name)
    if (found === undefined) throw new Error(`no ${name} tool`)
    return found.call(args)
  }

  /**
   * A first give (which starts the helper), its first turn ended, and the piece answered — ⚑ a turn
   * that ends with its piece open stalls it, and a give to a stalled conversation is refused.
   */
  async function aHelperAtWork(giver: string): Promise<string> {
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
    await waitFor('the first turn to end', () => turnsEnded(first.owner) >= 1)
    const replied = await callAs(first.owner, 'reply_to_parent', {
      piece: first.label,
      outcome: 'done',
      summary: 'done',
    })
    expect((replied.structured as { outcome?: string }).outcome).toBe('ok')
    return first.owner
  }

  it('🔴 a first give’s folder is the new conversation’s working folder, granted nothing', async () => {
    const giver = await aGiver()
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
    expect(first.givenFolder).toEqual({ folder: repoA, use: 'working-folder' })
    expect(store.find(first.owner)?.cwd).toBe(repoA)
    await waitFor('the first turn', () => turnsEnded(first.owner) >= 1)
    expect(handleOf(first.owner).workFolders.effective).toEqual([])
    // ⛔ The piece line names no grant: the folder IS where it works.
    expect(sentOf(first.owner).join('\n')).not.toMatch(/may also work in/)
  })

  it('🔴 a give to the conversation it has grants that piece’s folder, from the turn that carries the brief', async () => {
    const giver = await aGiver()
    const helper = await aHelperAtWork(giver)
    host.claimSession(helper, window)
    const second = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'the second piece',
        brief: 'work in B',
        folder: repoB,
      },
      speakingAs(giver),
    )
    if (!second.ok) throw new Error(`refused: ${second.refusal.rail}`)
    expect(second.owner).toBe(helper)
    expect(second.givenFolder).toEqual({ folder: repoB, use: 'grant' })
    // ⚑ Its working folder has not moved.
    expect(store.find(helper)?.cwd).toBe(repoA)
    await waitFor('the second turn', () => turnsEnded(helper) >= 2)
    expect(handleOf(helper).workFolders.effective).toEqual([real(repoB)])
    // ⚑ The helper is told, on the piece's own line.
    expect(sentOf(helper).at(-1)).toContain(
      `While it is open you may also work in ${repoB}: your working folder is unchanged, so write paths there in full.`,
    )
    // ⚑ The give is recorded with its folder, on both sides.
    const given = store
      .events(helper)
      .flatMap((entry) => (entry.event.type === 'work_given' ? [entry.event] : []))
      .at(-1)
    expect(given?.type === 'work_given' && given.givenFolder).toEqual({
      folder: repoB,
      use: 'grant',
    })
    const sent = store
      .events(giver)
      .flatMap((entry) => (entry.event.type === 'work_sent' ? [entry.event] : []))
      .at(-1)
    expect(sent?.type === 'work_sent' && sent.givenFolder).toEqual({ folder: repoB, use: 'grant' })
    // ⚑ …and the window sees it, applied.
    await waitFor('the grant shown', () => window.latest(helper)?.workFolders !== undefined)
    expect(window.latest(helper)?.workFolders).toEqual([
      { folder: repoB, piece: second.piece, label: second.label, givenBy: giver, state: 'applied' },
    ])
  })

  it('🔴 several pieces: the union — and a piece that ends takes its folder back at the next turn', async () => {
    // ⚑ The helper asks first, so its turn parks on a card and both gives are held behind it.
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
    if (!first.ok) throw new Error('refused')
    const helper = first.owner
    const cards = (): string[] =>
      store
        .events(helper)
        .flatMap((entry) => (entry.event.type === 'permission_request' ? [entry.event.id] : []))
    await waitFor('the first turn to park', () => cards().length === 1)
    host.claimSession(helper, window)
    const repoC = join(scratch, 'repo-c')
    mkdirSync(repoC)
    const two = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
        folder: repoB,
      },
      speakingAs(giver),
    )
    const three = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'C',
        brief: 'C',
        folder: repoC,
      },
      speakingAs(giver),
    )
    if (!two.ok || !three.ok) throw new Error('refused')
    // ⚑ The card answered: both held briefs go as one turn, with both folders.
    await host.respondPermission(helper, cards()[0]!, { outcome: 'cancel' }, window)
    await waitFor('the briefs’ turn', () => cards().length === 2)
    expect([...handleOf(helper).workFolders.effective].sort()).toEqual(
      [real(repoB), real(repoC)].sort(),
    )
    // ⚑ B is taken back; the next turn — any turn — drops its folder.
    const taken = await host.takeBackPiece({ piece: two.label }, speakingAs(giver))
    expect(taken.ok, JSON.stringify(taken)).toBe(true)
    await host.respondPermission(helper, cards()[1]!, { outcome: 'cancel' }, window)
    await host.queueMessage(helper, 'a note', speakingAs(giver))
    await waitFor('the note’s turn', () => cards().length === 3)
    expect(handleOf(helper).workFolders.effective).toEqual([real(repoC)])
  })

  it('🔴 a busy conversation: the grant waits with its brief, queued — never widening the turn running', async () => {
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
    if (!first.ok) throw new Error('refused')
    const helper = first.owner
    host.claimSession(helper, window)
    const cards = (): string[] =>
      store
        .events(helper)
        .flatMap((entry) => (entry.event.type === 'permission_request' ? [entry.event.id] : []))
    await waitFor('the first turn to park on its card', () => cards().length === 1)
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
    if (!second.ok) throw new Error('refused')
    expect(second.delivery).toBe('held')
    // ⛔ Not widened mid-turn: the running turn keeps what it was started with.
    expect(handleOf(helper).workFolders.effective).toEqual([])
    expect(handleOf(helper).workFolders.requested).toEqual([])
    await waitFor(
      'the grant shown, queued',
      () => window.latest(helper)?.workFolders?.[0]?.state === 'queued',
    )
    // ⚑ The card answered: the turn ends, the held brief goes, and its folder with it.
    await host.respondPermission(helper, cards()[0]!, { outcome: 'cancel' }, window)
    await waitFor('the brief’s turn', () => sentOf(helper).some((one) => one.includes('work in B')))
    expect(handleOf(helper).workFolders.effective).toEqual([real(repoB)])
    await waitFor(
      'the grant applied',
      () => window.latest(helper)?.workFolders?.[0]?.state === 'applied',
    )
  })

  it('🔴 a reopen carries the open grants: a new process is told them at its launch', async () => {
    const giver = await aGiver()
    const helper = await aHelperAtWork(giver)
    const second = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
        folder: repoB,
      },
      speakingAs(giver),
    )
    if (!second.ok) throw new Error('refused')
    await waitFor('B’s turn', () => turnsEnded(helper) >= 2)
    host.claimSession(helper, window)
    await host.close(helper, window)
    const before = handles.length
    await host.resumeSession(helper, window)
    expect(handles.length).toBeGreaterThan(before)
    expect(handles.at(-1)?.workFolders.effective).toEqual([real(repoB)])
  })

  it('⛔ an older give’s folder is never read as a grant', async () => {
    const giver = await aGiver()
    const helper = await aHelperAtWork(giver)
    // ⚑ A give as a build before this one recorded it: the folder raw, no `givenFolder`.
    const second = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
      },
      speakingAs(giver),
    )
    if (!second.ok) throw new Error('refused')
    expect(second.givenFolder).toBeNull()
    await waitFor('B’s turn', () => turnsEnded(helper) >= 2)
    expect(handleOf(helper).workFolders.effective).toEqual([])
    expect(store.workById(second.piece)?.folder ?? null).toBeNull()
  })

  it('⛔ a send the provider refuses applies nothing, and says nothing was applied', async () => {
    const giver = await aGiver()
    const helper = await aHelperAtWork(giver)
    host.claimSession(helper, window)
    const handle = handleOf(helper)
    Object.defineProperty(handle, 'send', {
      value: () => Promise.reject(new Error('the provider refused the turn')),
      configurable: true,
    })
    await host
      .giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'B',
          brief: 'B',
          folder: repoB,
        },
        speakingAs(giver),
      )
      .catch(() => null)
    expect(handle.workFolders.effective).toEqual([])
    expect(
      window.latest(helper)?.workFolders?.every((one) => one.state !== 'applied') ?? true,
    ).toBe(true)
  })

  it('🔴 D · a folder at a named place is used, and said — to the giver and on the record', async () => {
    const giver = await aGiver()
    const helper = await aHelperAtWork(giver)
    const codex = join(scratch, 'home', '.codex')
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'C',
        brief: 'C',
        folder: codex,
      },
      speakingAs(giver),
    )
    if (!given.ok) throw new Error(`refused: ${given.refusal.rail}`)
    expect(given.givenFolder).toEqual({
      folder: codex,
      use: 'grant',
      notice: { kind: 'codex-config-home', place: codex, stands: 'is' },
    })
    await waitFor('its turn', () => turnsEnded(helper) >= 2)
    expect(handleOf(helper).workFolders.effective).toEqual([real(codex)])
  })

  it('⛔ a folder that cannot be used is granted nothing — and the give goes all the same (R92)', async () => {
    const giver = await aGiver()
    const helper = await aHelperAtWork(giver)
    const missing = join(scratch, 'not-here')
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
        folder: missing,
      },
      speakingAs(giver),
    )
    if (!given.ok) throw new Error(`refused: ${given.refusal.rail}`)
    expect(given.owner).toBe(helper)
    expect(given.givenFolder).toBeNull()
    expect(given.folderNotGranted).toContain(missing)
    await waitFor('its turn', () => turnsEnded(helper) >= 2)
    expect(handleOf(helper).workFolders.effective).toEqual([])
  })

  it('🔴 a piece ended by its reply takes its folder back at the next turn', async () => {
    const giver = await aGiver()
    const helper = await aHelperAtWork(giver)
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'B',
        brief: 'B',
        folder: repoB,
      },
      speakingAs(giver),
    )
    if (!given.ok) throw new Error('refused')
    await waitFor('B’s turn', () => turnsEnded(helper) >= 2)
    expect(handleOf(helper).workFolders.effective).toEqual([real(repoB)])
    await callAs(helper, 'reply_to_parent', {
      piece: given.label,
      outcome: 'done',
      summary: 'done',
    })
    await host.queueMessage(helper, 'a note', speakingAs(giver))
    await waitFor('the note’s turn', () => turnsEnded(helper) >= 3)
    expect(handleOf(helper).workFolders.effective).toEqual([])
  })

  it('⛔ every handover to a provider sets the folders first — no send path can skip it', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8')
    const method = /\n {2}(?:private |public )?(?:async )?\w+\(/g
    const shared = [
      '  private sendTheAppsWords(session: HostedSession, text: string): Promise<void> {',
      '    return session.handle.send(text, this.stampFor(null, []))',
      '  }',
    ].join('\n')
    const withoutFolders = (code: string): number[] => {
      expect(code.split(shared)).toHaveLength(2)
      expect(code.match(/await this\.sendTheAppsWords\(/g)).toHaveLength(2)
      // Follow the exact shared send back to both callers, where their folders are set.
      const expanded = code
        .replace(shared, '')
        .replaceAll('this.sendTheAppsWords(', 'session.handle.send(')
      const sends = [...expanded.matchAll(/^(?!\s*(?:\/\/|\*)).*session\.handle\.send\(/gm)]
      expect(sends.length).toBeGreaterThanOrEqual(4)
      const methods = [...expanded.matchAll(method)].map((one) => one.index ?? 0)
      const sendsAt = sends.map((one) => one.index ?? 0)
      return sendsAt.filter((at) => {
        const start = Math.max(
          methods.filter((one) => one < at).at(-1) ?? 0,
          sendsAt.filter((one) => one < at).at(-1) ?? 0,
        )
        return !expanded.slice(start, at).includes('setWorkFolders(')
      })
    }
    expect(withoutFolders(source)).toEqual([])
    for (const name of ['endPlanMode', 'carryOnAfterARepair']) {
      const methods = [...source.matchAll(method)]
      const at = methods.findIndex((one) => one[0].endsWith(`${name}(`))
      expect(at).toBeGreaterThanOrEqual(0)
      const start = methods[at]!.index ?? 0
      const end = methods[at + 1]?.index ?? source.length
      const body = source.slice(start, end)
      const folders = 'session.handle.setWorkFolders(this.theWorkFoldersFor(session, []))'
      expect(body.split(folders)).toHaveLength(2)
      const planted = source.slice(0, start) + body.replace(folders, '') + source.slice(end)
      expect(withoutFolders(planted), `${name} without its folder setup`).toHaveLength(1)
    }
  })
})

describe('W4.189 · the fold: which gives grant, and when their brief went out', () => {
  const given = (extra: Record<string, unknown>) => ({
    ordinal: 1,
    at: 10,
    event: {
      type: 'work_given' as const,
      piece: 'work_b',
      label: 'W1.2',
      parent: 'work_root',
      givenBy: 'sess_giver',
      title: 'B',
      brief: 'B',
      ...extra,
    },
  })
  const grant = { folder: '/scratch/b', use: 'grant' as const }

  it('⛔ an older give, recorded before grants, carries no grant', () => {
    const [row] = derivePieces('sess_helper', [given({})])
    expect(row?.givenFolder).toBeUndefined()
  })

  it('🔴 a brief that went straight out was handed over; a held one only once it is sent', () => {
    expect(derivePieces('sess_helper', [given({ givenFolder: grant })])[0]?.briefHandedOver).toBe(
      true,
    )
    const held = given({ givenFolder: grant, messageId: 'msg_1' })
    expect(derivePieces('sess_helper', [held])[0]?.briefHandedOver).toBeUndefined()
    const sent = {
      ordinal: 2,
      at: 11,
      event: { type: 'message_unqueued', messageId: 'msg_1', reason: 'sent' },
    } as PersistedEventInfo
    expect(derivePieces('sess_helper', [held, sent])[0]?.briefHandedOver).toBe(true)
  })

  it('⛔ a brief abandoned at a quit is never handed over — its piece stays open, and grants nothing', () => {
    const held = given({ givenFolder: grant, messageId: 'msg_1' })
    const abandoned = {
      ordinal: 2,
      at: 11,
      event: { type: 'message_unqueued', messageId: 'msg_1', reason: 'abandoned' },
    } as PersistedEventInfo
    const [row] = derivePieces('sess_helper', [held, abandoned])
    expect(row?.state).toBe('stalled')
    expect(row?.briefHandedOver).toBeUndefined()
  })
})
