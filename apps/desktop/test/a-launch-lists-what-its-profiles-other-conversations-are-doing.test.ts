import { callOn } from './helpers/call-tool'
import {
  fixtureProviderConfig,
  neutralHostDeps,
  syntheticProviderHome,
  fixtureDatabase,
  ObservedProviderLaunches,
} from './lib/host-fixture'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime/testing'
import type { AgentToolset } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime/testing'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  profileBundleSpans,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import {
  composeSystemHint,
  INSTRUCTION_TOTAL_CAP,
  readSessionInstructions,
} from '../src/main/runtime/instructions'
import { BUNDLE_LEAF, publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { A_PERSON_SENT_IT } from '../src/main/runtime/turn-origin'
import { GO_AHEAD_MESSAGE } from '../src/renderer/src/lib/plan-mode'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { readSavedMethods } from '../src/main/saved-methods'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

// Use a real Host, SQLite store and instruction reader with fictional providers.
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

/** ⚑ The heading of the list, as `thisConversationSpans` writes it. */
const LIST_HEADING = '- Other conversations of this profile, newest first (list_agents shows more):'

/** ⚑ The header the reader puts above this conversation's own text — see `composeSystemHint`. */
const THIS_CONVERSATION_HEADER = 'Composed by BroCrew for this conversation at this launch:'

/** A context with every field at its least interesting value, so a test moves exactly one thing. */
function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'ali',
    cwd: '/tmp/work',
    startedBy: null,
    root: null,
    ...over,
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

// ─────────────────────────────────────────────────────────────────────────────
describe('§2 · the identity index lists one profile’s conversations', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let ordinals: Map<string, number>

  /** One `turn` row, which moves the conversation's `updated_at` to `at`. */
  const touch = (sessionId: string, at: number): void => {
    const next = ordinals.get(sessionId) ?? 0
    ordinals.set(sessionId, next + 1)
    store.append(sessionId, next, { type: 'turn', state: 'completed' }, at)
  }

  const made = (id: string, profileId: string, parentSessionId?: string): void =>
    store.create({
      id,
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-d024-index-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db, () => 5_000)
    ordinals = new Map()
    made('sess_pm', 'pm')
    made('sess_a', 'ali')
    made('sess_b', 'ali', 'sess_a')
    made('sess_c', 'ali', 'sess_pm')
    made('sess_other', 'builder')
    // ⚑ Swept out of a home, held by no agent: a row with no identity at all.
    store.adopt({
      id: 'sess_swept',
      provider: 'claude',
      sessionId: 'ext_1',
      cwd: dir,
      profileId: null,
      createdAt: 5_000,
      updatedAt: 5_000,
    })
    touch('sess_a', 300)
    touch('sess_c', 200)
    touch('sess_b', 100)
    touch('sess_swept', 900)
    touch('sess_other', 800)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const ids = (profile: string): string[] =>
    store.conversationsOf(profile).map((one) => one.conversation)

  it('lists one profile’s conversations, newest activity first, each with who started it', () => {
    // ⚑ **F009 · and when each was created and last moved**, off the same row — what an agent's
    // record says of each.
    expect(store.conversationsOf('ali')).toEqual([
      { conversation: 'sess_a', parent: null, startedAt: 5_000, lastActiveAt: 300 },
      { conversation: 'sess_c', parent: 'sess_pm', startedAt: 5_000, lastActiveAt: 200 },
      { conversation: 'sess_b', parent: 'sess_a', startedAt: 5_000, lastActiveAt: 100 },
    ])
    // ⚑ The profile boundary and the unplaced row, each paired with its inclusion in the same read:
    // the other identity's row is absent here and present under its own, and so is the manager's.
    expect(ids('ali')).not.toContain('sess_pm')
    expect(ids('ali')).not.toContain('sess_other')
    expect(ids('ali')).not.toContain('sess_swept')
    expect(store.conversationsOf('builder')).toEqual([
      { conversation: 'sess_other', parent: null, startedAt: 5_000, lastActiveAt: 800 },
    ])
    expect(ids('pm')).toEqual(['sess_pm'])
    // The unplaced row has activity, newer than all of ali's: it is left out for want of an identity.
    expect(
      (
        db
          .prepare('SELECT updated_at AS at FROM provider_session WHERE id = ?')
          .get('sess_swept') as {
          at: number
        }
      ).at,
    ).toBe(900)
  })

  it('moves a conversation to the front when a row is appended to it, and breaks a tie by id, newest first', () => {
    expect(ids('ali')).toEqual(['sess_a', 'sess_c', 'sess_b'])
    touch('sess_b', 400)
    // ⚑ The row appended to moves; the rows not appended to keep their places.
    expect(ids('ali')).toEqual(['sess_b', 'sess_a', 'sess_c'])
    touch('sess_a', 500)
    touch('sess_c', 500)
    expect(ids('ali')).toEqual(['sess_c', 'sess_a', 'sess_b'])
  })

  it('answers an empty list for a profile with no conversation', () => {
    expect(store.conversationsOf('nobody')).toEqual([])
    // ⚑ The control: the same read answers a list for a profile that has some.
    expect(store.conversationsOf('ali')).toHaveLength(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 + §4 · what a launch is told, and where it rides
// ─────────────────────────────────────────────────────────────────────────────

/** One provider launch the host made: the handle it was given, and which kind it was. */
interface Launch {
  readonly kind: 'start' | 'resume'
  readonly handle: FakeSessionHandle
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

describe('§3 · launch instructions and changing turn facts', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let launches: Launch[]
  let issued: FakeProviderSessions
  let seen: InstructionContext[]
  let counter: number
  let clock: number
  let window: Sink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new ObservedProviderLaunches(provider, issued, (kind, options, handle) => {
          launches.push({ kind, handle })
          if (options.agentTools) handed.push(options.agentTools)
        }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readSavedMethodsFor: (profile, at) =>
        readSavedMethods(join(userData, 'runbooks', profile), at),
      readProviderConfig: fixtureProviderConfig,
      // ⚑ **A copy of `main/index.ts`'s call**: the profile's text alone is published, this
      // conversation's own text rides the launch, and the reader says which channel keeps it.
      readInstructions: (provider, cwd, providerHome, ctx) => {
        seen.push(ctx)
        const composed = profileBundleSpans(ctx)
        const bundle = publishProfileBundle(provider, providerHome, composed.text)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          bundleComposed: composed,
          thisConversation: thisConversationSpans(ctx, undefined, provider),
        })
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: null,
          context: ctx,
        }
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d024-launch-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d024-launch-root-'))
    db = fixtureDatabase(userData)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    launches = []
    seen = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ── helpers ────────────────────────────────────────────────────────────────

  /** A person opens a conversation. `ask` by default, so a brief it is given parks on a card. */
  const personOpens = async (
    profileId: string,
    over: { provider?: Provider; approvalMode?: 'ask' | 'auto' } = {},
  ): Promise<{ id: string; tools: AgentToolset }> => {
    const { sessionId } = await host.createSession(
      {
        provider: over.provider ?? 'claude',
        profileId,
        approvalMode: over.approvalMode ?? 'ask',
        cwd: root,
      },
      window,
    )
    const tools = handed.at(-1)
    if (tools === undefined) throw new Error('no toolset was handed to that launch')
    return { id: sessionId, tools }
  }

  const ledger = (sessionId: string) => store.events(sessionId).map((entry) => entry.event)

  const cards = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  /** What the PROVIDER was handed, turn by turn — the double's echo of the exact string it got. */
  const providerHeard = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'assistant_message' ? [event.text.replace(/^echo: /, '')] : [],
    )

  /** What a Claude launch was told in its system prompt, or `undefined` when it sent none. */
  const toldAt = (launch: number): string | undefined => launches.at(launch)?.handle.systemHint

  const lastContext = (): InstructionContext => {
    const ctx = seen.at(-1)
    if (ctx === undefined) throw new Error('the reader was never called')
    return ctx
  }

  const sectionOf = (ctx: InstructionContext, provider: Provider): string =>
    thisConversationSpans(ctx, undefined, provider).text
  /** The quit a person's ⌘Q is, and the next launch over the same ledger. */
  const quitAndRelaunch = async (beforeLoad?: () => void): Promise<void> => {
    for (const built of hosts) await built.closeAll()
    beforeLoad?.()
    db.close()
    db = fixtureDatabase(userData)
    store = createSessionStore(db, tick)
    host = buildHost()
    seen = []
  }

  /**
   * ⚑ **BroBot gives `ali` a new piece, and Ada gives it another** — so one profile holds two
   * conversations of two givers, each parked on its card. The second is waited for after the first,
   * so the clock order is the launch order. Returns what each launch read and was told.
   * `afterTheFirst` runs once the first is up and the second is not yet asked for.
   */
  const twoAlisOfTwoGivers = async (afterTheFirst: () => void = () => {}) => {
    const bro = await personOpens(DEFAULT_PROFILE_ID)
    await callOn(bro.tools, 'create_agent', { profile_slug: 'ali' })
    const first = await callOn(bro.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'ali',
      to: 'new',
      conversation_title: 'Check the fixes',
      title: 'Check the fixes',
      brief: 'check the fixes',
    })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    expect(first.started).toBe(true)
    const ali1 = first.agent as string
    await waitFor(() => cards(ali1).length > 0, 'the first brief to park on its card')
    afterTheFirst()

    const ada = await personOpens('ada')
    const second = await callOn(ada.tools, 'give_work', {
      to: 'new',
      conversation_title: 'List the hotels',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'ali',
      title: 'List the hotels',
      brief: 'list the hotels',
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    expect(second.started).toBe(true)
    const ali2 = second.agent as string
    expect(ali2).not.toBe(ali1)
    const atAli2 = lastContext()
    const toldAli2 = toldAt(-1)
    await waitFor(() => cards(ali2).length > 0, 'the second brief to park on its card')
    return { atAli2, toldAli2 }
  }

  // ── the tests ──────────────────────────────────────────────────────────────

  it('keeps the Claude prompt byte-identical as peer activity and saved methods change across reopen', async () => {
    const peer = await personOpens('ali', { approvalMode: 'auto' })
    await host.send(peer.id, 'Fictional peer title', window)
    await waitFor(() => providerHeard(peer.id).length === 1, 'the peer opening to be recorded')
    const target = await personOpens('ali', { approvalMode: 'auto' })
    const creation = toldAt(-1)
    await host.send(target.id, 'warm up', window)
    await waitFor(() => providerHeard(target.id).length === 1, 'the launch to be recorded')

    const folder = join(userData, 'runbooks', 'ali')
    mkdirSync(folder, { recursive: true })
    const index = join(folder, 'index.md')
    const firstMethod = '- Rotate the fictional logs | weekly | verified 2030-01-01 | rotate.md'
    writeFileSync(join(folder, 'rotate.md'), '# A fictional method\n')
    writeFileSync(index, `${firstMethod}\n`)

    await quitAndRelaunch()
    await host.resumeSession(target.id, window)
    const initial = toldAt(-1)
    expect(initial).toContain('## This conversation')
    expect(initial).toBe(creation)
    expect(initial).toContain(LIST_HEADING)
    expect(initial).not.toContain(' — last active ')
    expect(initial).not.toContain('## Saved methods')
    await host.send(target.id, 'before the minute boundary', window)
    await waitFor(() => providerHeard(target.id).length === 2, 'the first compared turn')
    const firstTurn = providerHeard(target.id)[1] ?? ''
    const activityLine = (turn: string) =>
      turn.split('\n').find((line) => /^ {2}- conversation .+ — last active /.test(line))
    expect(providerHeard(target.id)[0]).not.toContain(LIST_HEADING)
    expect(firstTurn).toContain('This app adds what follows')
    expect(firstTurn).not.toContain(LIST_HEADING)
    expect(firstTurn).toContain('Rotate the fictional logs')

    const lastActivity = () =>
      store.conversationsOf('ali').find((row) => row.conversation === peer.id)?.lastActiveAt ?? 0
    const earlier = lastActivity()
    clock += 120_000
    await host.resumeSession(peer.id, window)
    await host.send(peer.id, 'change peer activity', window)
    await waitFor(() => providerHeard(peer.id).length === 2, 'the peer activity to be recorded')
    expect(lastActivity() - earlier).toBeGreaterThanOrEqual(60_000)
    writeFileSync(join(folder, 'backup.md'), '# Another fictional method\n')
    writeFileSync(
      index,
      `${firstMethod}\n- Check the fictional backup | weekly | verified 2030-01-01 | backup.md\n`,
    )

    await quitAndRelaunch()
    await host.resumeSession(target.id, window)
    expect(toldAt(-1)).toBe(initial)
    await host.send(target.id, 'after the minute boundary', window)
    await waitFor(() => providerHeard(target.id).length === 3, 'the reopened turn')
    const nextTurn = providerHeard(target.id)[2] ?? ''
    expect(nextTurn).toContain('This app adds what follows')
    expect(nextTurn).not.toContain(LIST_HEADING)
    expect(nextTurn).toContain('Check the fictional backup')

    const added = await personOpens('ali', { approvalMode: 'auto' })
    const addedName = host.nameByItsWork(added.id)
    await host.send(target.id, 'after adding a peer', window)
    await waitFor(() => providerHeard(target.id).length === 4, 'the new roster')
    const roster = providerHeard(target.id)[3] ?? ''
    expect(roster).toContain(LIST_HEADING)
    expect(activityLine(roster)).toContain(addedName)
  })

  it.each(['claude', 'codex'] as const)(
    'keeps the %s conversation start through rule and note changes until a compaction relaunch',
    async (provider) => {
      const peer = await personOpens('ali', { provider, approvalMode: 'auto' })
      const target = await personOpens('ali', { provider, approvalMode: 'auto' })
      const initial = ledger(target.id).find((event) => event.type === 'launched')
      expect(initial?.type).toBe('launched')
      if (
        initial?.type !== 'launched' ||
        initial.promptStart === undefined ||
        'from' in initial.promptStart
      )
        throw new Error('missing creation prompt')
      const firstStart = initial.promptStart.systemHint ?? initial.promptStart.firstTurnLead
      expect(firstStart).toContain(LIST_HEADING)
      expect(firstStart).not.toContain(' — last active ')
      await host.send(target.id, 'first message', window)
      await waitFor(() => providerHeard(target.id).length === 1, 'the first message')

      const rules = 'Keep the fictional ledger sorted.\nRecord corrections.'
      const notes = 'The notes now name the violet ledger.\nUse its latest page.'
      const writtenAt = Date.UTC(2030, 0, 1, 0, 30)
      clock = writtenAt
      expect(host.instructAgent('ali', rules, undefined, window)).not.toBeNull()
      expect(
        host.saveOwnNotes('ali', { expectedVersion: 0, text: notes, why: 'Fixture note.' }, window),
      ).not.toBeNull()
      await quitAndRelaunch()
      await host.resumeSession(peer.id, window)
      await host.send(peer.id, 'later peer activity', window)
      await waitFor(() => providerHeard(peer.id).length === 1, 'later peer activity')
      await host.resumeSession(target.id, window)
      const reopened = ledger(target.id)
        .filter((event) => event.type === 'launched')
        .at(-1)
      expect(reopened?.promptStart).toEqual({ from: expect.any(Number) })
      if (provider === 'claude') expect(toldAt(-1)).toBe(firstStart)
      await host.send(target.id, 'after app restart', window)
      await waitFor(() => providerHeard(target.id).length === 2, 'new instructions in the footer')
      const after = providerHeard(target.id)[1]
      expect(after).toContain(rules)
      expect(after).toContain(notes)
      expect(after).toMatch(/changed at 2030-01-01T00:30:00[.][0-9]+Z/)
      expect(after?.indexOf(rules)).toBeGreaterThan(
        after?.indexOf('This app adds what follows') ?? 0,
      )
      expect(after?.indexOf(notes)).toBeGreaterThan(
        after?.indexOf('This app adds what follows') ?? 0,
      )

      await host.send(target.id, 'the unchanged next turn', window)
      await waitFor(() => providerHeard(target.id).length === 3, 'the accepted unchanged turn')
      expect(providerHeard(target.id)[2]).not.toContain(rules)
      expect(providerHeard(target.id)[2]).not.toContain(notes)

      launches.at(-1)?.handle.simulateCompaction(provider === 'claude' ? { after: 123 } : {})
      await waitFor(
        () => ledger(target.id).some((event) => event.type === 'compaction'),
        'the compaction mark',
      )
      await quitAndRelaunch()
      await host.resumeSession(target.id, window)
      const rebuilt = ledger(target.id)
        .filter((event) => event.type === 'launched')
        .at(-1)?.promptStart
      expect(rebuilt).not.toHaveProperty('from')
      const nextStart =
        rebuilt && !('from' in rebuilt) ? (rebuilt.systemHint ?? rebuilt.firstTurnLead) : undefined
      expect(nextStart).not.toBe(firstStart)
      expect(nextStart).toContain('violet ledger')
      if (provider === 'claude') expect(nextStart).toContain(rules)
    },
  )

  it.each(['claude', 'codex'] as const)(
    'replays at 59 minutes and refreshes at 61 minutes after a %s provider turn',
    async (provider) => {
      const target = await personOpens('ali', { provider, approvalMode: 'auto' })
      await host.send(target.id, 'finish after provider work', window)
      await waitFor(
        () => store.newestOfType?.(target.id, 'turn')?.event.type === 'turn',
        'the recorded provider ending',
      )
      const end = store.newestOfType?.(target.id, 'turn')
      if (end?.event.type !== 'turn' || end.event.state !== 'completed') {
        throw new Error('the provider did not record a completed turn')
      }
      const getStart = () =>
        ledger(target.id)
          .filter((event) => event.type === 'launched')
          .at(-1)?.promptStart
      const original = getStart()
      const notes = 'Include the latest fictional report.'
      expect(
        host.saveOwnNotes('ali', { expectedVersion: 0, text: notes, why: 'Fixture.' }, window),
      ).not.toBeNull()

      await quitAndRelaunch()
      clock = end.at + 59 * 60_000
      await host.resumeSession(target.id, window)
      expect(getStart()).toEqual({ from: expect.any(Number) })

      await quitAndRelaunch()
      clock = end.at + 61 * 60_000
      await host.resumeSession(target.id, window)
      const refreshed = getStart()
      expect(refreshed).not.toEqual(original)
      expect(refreshed).not.toHaveProperty('from')
      if (refreshed === undefined || 'from' in refreshed) throw new Error('no refreshed prompt')
      expect(refreshed.systemHint ?? refreshed.firstTurnLead).toContain(notes)
      await host.send(target.id, 'continue after the rebuild', window)
      await waitFor(() => providerHeard(target.id).length === 2, 'the first rebuilt turn')
      expect(providerHeard(target.id)[1]).not.toContain('Your own notes (changed at')
    },
  )

  it('writes the profile’s file as the same bytes for every conversation of it, carrying nothing of this one', async () => {
    const leaf = join(userData, 'provider-homes', 'ali', 'claude', BUNDLE_LEAF.claude)
    let afterAli1 = ''
    const { atAli2, toldAli2 } = await twoAlisOfTwoGivers(() => {
      afterAli1 = readFileSync(leaf, 'utf8')
    })
    // Alone in its profile, started by BroBot; then beside another, started by Ada: the same bytes.
    const afterAli2 = readFileSync(leaf, 'utf8')
    // ⚑ Presence first: the leaf is the profile's own file, so what it lacks below is a reading.
    expect(afterAli1).toContain('# Your instructions')
    expect(afterAli2).toBe(afterAli1)
    for (const file of [afterAli1, afterAli2]) {
      expect(file).not.toContain('as they stood when this one launched')
      expect(file).not.toContain('This conversation was started by')
      expect(file).not.toContain('## This conversation')
    }

    // The paired positive: the same facts went with the launch, in the words it was handed.
    expect(atAli2.startedBy).not.toBeNull()
    expect(toldAli2).toContain(LIST_HEADING)
    expect(toldAli2).not.toContain(' — last active ')
    expect(toldAli2).toContain(`This conversation was started by ${atAli2.startedBy ?? ''}.`)
    expect(toldAli2).toContain('## This conversation')
  })

  // ── §4 · where it rides ────────────────────────────────────────────────────

  describe('§4 · where the conversation’s own text rides', () => {
    /** The lead a Codex life owes, as the reader composes it for a launch's context. */
    const leadFor = (ctx: InstructionContext, provider: Provider = 'codex'): string =>
      composeSystemHint([], { text: sectionOf(ctx, provider) }) ?? ''

    const codexOpens = (profileId = 'ali') =>
      personOpens(profileId, { provider: 'codex', approvalMode: 'auto' })

    /** The double a conversation was just launched on. */
    const handleJustLaunched = (): FakeSessionHandle => {
      const handle = launches.at(-1)?.handle
      if (handle === undefined) throw new Error('no launch')
      return handle
    }

    const idle = (handle: FakeSessionHandle): Promise<void> =>
      waitFor(() => handle.status() === 'idle', 'the turn to end')

    it('on Codex it rides the first message of a life, once — and on Claude it rides the system prompt and no message', async () => {
      const codex = await codexOpens()
      const codexHandle = handleJustLaunched()
      const lead = leadFor(lastContext())
      expect(lead.startsWith(`${THIS_CONVERSATION_HEADER}\n\n`)).toBe(true)
      // The start carried no system hint: the provider reads its own files.
      expect(codexHandle.systemHint).toBeUndefined()
      await host.send(codex.id, 'hello', window)
      await waitFor(() => providerHeard(codex.id).length === 1, 'Codex to hear the first message')
      await idle(codexHandle)
      await host.send(codex.id, 'again', window)
      await waitFor(() => providerHeard(codex.id).length === 2, 'Codex to hear the second message')
      const heard = providerHeard(codex.id)
      expect(heard[0]?.startsWith(`${lead}\n\n`)).toBe(true)
      // The person's frame follows it, and the words come last.
      expect(heard[0]?.slice(lead.length + 2).startsWith(A_PERSON_SENT_IT)).toBe(true)
      expect(withoutWhatThisAppAdds(heard[0] ?? '').endsWith('\n\nhello')).toBe(true)
      // …and once: the second message carries none of it.
      expect(heard[1]).not.toContain(THIS_CONVERSATION_HEADER)
      expect(heard[1]?.startsWith(A_PERSON_SENT_IT)).toBe(true)
      // The ledger never carries the lead: the person's words are what they typed.
      const turns = ledger(codex.id).flatMap((event) =>
        event.type === 'user_turn' ? [event.text] : [],
      )
      expect(turns).toEqual(['hello', 'again'])

      // The control, one fact over: the same on Claude, where it is the system prompt's last block
      // and no message carries it.
      const claude = await personOpens('ali', { provider: 'claude', approvalMode: 'auto' })
      const block = leadFor(lastContext(), 'claude')
      const hint = launches.at(-1)?.handle.systemHint
      expect(hint?.endsWith(block)).toBe(true)
      await host.send(claude.id, 'hello', window)
      await waitFor(() => providerHeard(claude.id).length === 1, 'Claude to hear it')
      expect(providerHeard(claude.id)[0]).not.toContain(THIS_CONVERSATION_HEADER)
      expect(providerHeard(claude.id)[0]?.startsWith(A_PERSON_SENT_IT)).toBe(true)
    })

    /**
     * ⚠️ **Why this arm hands a Codex life a `/` list.** A real Codex publishes `$` skills and never a
     * `/` list, so no `/` word is a command there and R42 never sends one bare (`a-command-goes-as-typed`
     * §5, which pins that half); and a Codex `/compact` goes to the compaction door, which carries no
     * words at all. What `handToProvider` decides first — *a command goes as typed, before anything is
     * put in front of it* — is the host's ordering and has no provider in it, so it is measured on the
     * one double that can reach it: a Codex life whose list names `usage`, as the Fake's default does.
     * ⚑ The control is the real shape: with Codex's own `$` list the same `/usage` is a message, and
     * it carries the lead.
     */
    it('sends a published `/` command as a life’s first send exactly as typed, and leaves the text owed to the next message', async () => {
      const codex = await codexOpens()
      const handle = handleJustLaunched()
      const lead = leadFor(lastContext())
      // The Fake's default list: `compact` and `usage`, under the prefix `/`.
      handle.simulateProviderCommands()
      await waitFor(
        () => ledger(codex.id).some((event) => event.type === 'provider_commands'),
        'the list to be recorded',
      )
      await host.send(codex.id, '/usage', window)
      await waitFor(() => providerHeard(codex.id).length === 1, 'the provider to hear the command')
      await idle(handle)
      // Bare: no lead, no frame — and the life still owes the lead.
      expect(providerHeard(codex.id)[0]).toBe('/usage')
      await host.send(codex.id, 'then words', window)
      await waitFor(() => providerHeard(codex.id).length === 2, 'the provider to hear the next one')
      const heard = providerHeard(codex.id)
      // The next ordinary message carries the lead, so it was owed and not lost.
      expect(heard[1]?.startsWith(`${lead}\n\n`)).toBe(true)
      expect(heard[1]?.slice(lead.length + 2).startsWith(A_PERSON_SENT_IT)).toBe(true)
      expect(withoutWhatThisAppAdds(heard[1] ?? '').endsWith('\n\nthen words')).toBe(true)

      // The control, one fact over: Codex's own `$` list. The same `/usage` is no command there, so
      // it is a message — framed, and the first of its life, so it carries the lead.
      const real = await codexOpens()
      const realHandle = handleJustLaunched()
      const realLead = leadFor(lastContext())
      realHandle.simulateProviderCommands(
        { commands: [{ name: 'usage' }] },
        'fake/thread/start',
        '$',
      )
      await waitFor(
        () => ledger(real.id).some((event) => event.type === 'provider_commands'),
        'the `$` list to be recorded',
      )
      await host.send(real.id, '/usage', window)
      await waitFor(() => providerHeard(real.id).length === 1, 'the provider to hear it')
      const framed = providerHeard(real.id)[0]
      expect(framed).not.toBe('/usage')
      expect(framed?.startsWith(`${realLead}\n\n`)).toBe(true)
      expect(withoutWhatThisAppAdds(framed ?? '').endsWith('\n\n/usage')).toBe(true)
    })

    it('keeps the original Codex lead and reports a new peer in the footer after restart', async () => {
      const c1 = await codexOpens()
      const firstLife = handleJustLaunched()
      const firstLead = leadFor(lastContext())
      await host.send(c1.id, 'one', window)
      await waitFor(() => providerHeard(c1.id).length === 1, 'the first life to hear it')
      await idle(firstLife)
      const c2 = await codexOpens()
      expect(c2.id).not.toBe(c1.id)

      await quitAndRelaunch()
      await host.resumeSession(c1.id, window)
      // The resume's start options carry no system hint either.
      expect(launches.at(-1)?.kind).toBe('resume')
      expect(launches.at(-1)?.handle.systemHint).toBeUndefined()
      await host.send(c1.id, 'two', window)
      await waitFor(() => providerHeard(c1.id).length === 2, 'the resumed life to hear it')
      const heard = providerHeard(c1.id)
      expect(heard[0]?.startsWith(`${firstLead}\n\n`)).toBe(true)
      expect(heard[1]?.startsWith(A_PERSON_SENT_IT)).toBe(true)
      expect(heard[1]).toContain(LIST_HEADING)
      expect(heard[1]).not.toContain('## The brobot tools')
      expect(heard[1]).not.toContain('## What you may do')
      expect(heard[1]).not.toContain(firstLead)
    })

    it('sends a go-ahead as a life’s first send bare, and leaves the text owed', async () => {
      const { sessionId } = await host.createSession(
        { provider: 'codex', profileId: 'ali', planMode: true, approvalMode: 'auto', cwd: root },
        window,
      )
      const handle = handleJustLaunched()
      const lead = leadFor(lastContext())
      await host.endPlanMode(sessionId, window, GO_AHEAD_MESSAGE)
      await waitFor(() => providerHeard(sessionId).length === 1, 'Codex to hear the go-ahead')
      await idle(handle)
      expect(providerHeard(sessionId)[0]).toBe(GO_AHEAD_MESSAGE)
      await host.send(sessionId, 'next', window)
      await waitFor(() => providerHeard(sessionId).length === 2, 'Codex to hear the next message')
      // The typed message after it carries the lead: it was owed, not spent.
      expect(providerHeard(sessionId)[1]?.startsWith(`${lead}\n\n`)).toBe(true)
      expect(withoutWhatThisAppAdds(providerHeard(sessionId)[1] ?? '').endsWith('\n\nnext')).toBe(
        true,
      )
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §5 · what the reader does with the conversation's own text
// ─────────────────────────────────────────────────────────────────────────────

describe('§5 · the reader', () => {
  let root: string
  let home: string
  let cwd: string
  let providerHome: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-d024-reader-'))
    home = join(root, 'home')
    cwd = join(root, 'work', 'repo', 'child')
    providerHome = join(root, 'provider-homes', 'ali', 'codex')
    for (const dir of [home, cwd, providerHome]) mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const write = (path: string, text: string): void => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }

  it('says on Codex what this app sends it, and says nothing is appended only when nothing is', () => {
    const thisConversation = thisConversationSpans(context())
    const sends = readSessionInstructions({
      provider: 'codex',
      cwd,
      providerHome,
      home,
      thisConversation,
    })
    expect(sends.instructions.note).toContain(
      // ⚑ D-039: Codex's lead also carries how to use the tools, so the note says both.
      'BroCrew sends this provider how to use its tools and what is true of this conversation in front of a message: the whole of it the first time, and again after the conversation is compacted; otherwise only what changed',
    )
    expect(sends.instructions.note).not.toContain('BroCrew appends nothing for this provider')
    // Never a system hint: a plan-mode switch drops developer text, and a resume's is never read.
    expect(sends.systemHint).toBeNull()
    expect(sends.instructions.injected).toEqual([])
    expect(sends.firstTurnLead).toBe(sends.instructions.composed)
    expect(sends.firstTurnLead?.startsWith(`${THIS_CONVERSATION_HEADER}\n\n`)).toBe(true)
    expect(sends.firstTurnLead?.endsWith(thisConversation.text)).toBe(true)
    // No file was injected, so no preamble of overrides precedes it.
    expect(sends.firstTurnLead).not.toContain('OVERRIDE')

    // The control: a reading that composed none keeps the other sentence, and owes nothing.
    const sendsNothing = readSessionInstructions({ provider: 'codex', cwd, providerHome, home })
    expect(sendsNothing.instructions.note).toContain('BroCrew appends nothing for this provider')
    expect(sendsNothing.instructions.note).not.toContain('BroBot sends this provider only')
    expect(sendsNothing.firstTurnLead).toBeNull()
    expect(sendsNothing.systemHint).toBeNull()
  })

  describe('the byte budget', () => {
    const claudeHome = (): string => join(root, 'provider-homes', 'ali', 'claude')

    /** Six files of 65,487 bytes: three fit alone (`instructions.test.ts`'s fixture that discriminates). */
    const fillToTheByte = (): void => {
      for (const dir of [join(root, 'work'), join(root, 'work', 'repo'), cwd]) {
        write(join(dir, 'CLAUDE.md'), 'z'.repeat(65_487))
        write(join(dir, '.claude', 'CLAUDE.md'), 'z'.repeat(65_487))
      }
    }

    it('reserves this conversation’s block from the budget, never drops it, and the files share what is left', () => {
      mkdirSync(claudeHome(), { recursive: true })
      fillToTheByte()
      const read = (thisConversation?: { text: string; spans: [] }) =>
        readSessionInstructions({
          provider: 'claude',
          cwd,
          providerHome: claudeHome(),
          home,
          ...(thisConversation === undefined ? {} : { thisConversation }),
        })

      // The control: the same chain with no block injects three — the existing arithmetic.
      const alone = read()
      expect(alone.instructions.injected).toHaveLength(3)
      expect(alone.instructions.refused.filter((one) => one.reason === 'over-budget')).toHaveLength(
        3,
      )
      const room = INSTRUCTION_TOTAL_CAP - Buffer.byteLength(alone.systemHint ?? '', 'utf8')
      expect(room).toBeGreaterThan(0)

      // A block that costs `room + 300` bytes: three files and the block would be over the cap by a
      // few hundred bytes, and two files and the block fit.
      const bare = Buffer.byteLength(composeSystemHint([], { text: '' }) ?? '', 'utf8')
      const text = 'b'.repeat(room + 300 - 2 - bare)
      const withIt = { text, spans: [] as [] }
      expect(
        Buffer.byteLength(composeSystemHint(alone.instructions.injected, withIt) ?? '', 'utf8'),
        'the premise: without a reservation the three files and the block overflow',
      ).toBeGreaterThan(INSTRUCTION_TOTAL_CAP)

      const reserved = read(withIt)
      expect(Buffer.byteLength(reserved.systemHint ?? '', 'utf8')).toBeLessThanOrEqual(
        INSTRUCTION_TOTAL_CAP,
      )
      // The block is sent whole, and last.
      expect(reserved.systemHint?.endsWith(text)).toBe(true)
      expect(reserved.systemHint).toContain(THIS_CONVERSATION_HEADER)
      // The files shared what was left: two went, and the rest are rows saying why.
      expect(reserved.instructions.injected).toHaveLength(2)
      const dropped = reserved.instructions.refused.filter((one) => one.reason === 'over-budget')
      expect(dropped).toHaveLength(4)
      expect(reserved.instructions.injected.map((one) => one.path)).not.toContain(dropped[0]?.path)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §6 · the composition root
// ─────────────────────────────────────────────────────────────────────────────

/** Comments stripped first — a docblock quoting a call is not a call. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Everything inside the parentheses of each call of `name(` in `source`, balanced. */
function argumentsOfEach(source: string, name: string): string[] {
  const found: string[] = []
  let from = 0
  for (;;) {
    const at = source.indexOf(`${name}(`, from)
    if (at < 0) return found
    let depth = 0
    let end = at + name.length
    for (; end < source.length; end++) {
      const char = source[end]
      if (char === '(') depth += 1
      if (char === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    found.push(source.slice(at + name.length + 1, end))
    from = end
  }
}

const squashed = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * ⚑ **The two lines of `main/index.ts` this section is about**, as one predicate: the reader is
 * handed this conversation's text, composed once, and the profile's file is published from the
 * profile's text alone.
 */
function handsTheReaderThisConversationAndPublishesOnlyTheProfiles(source: string): boolean {
  const stripped = code(source)
  const readerCalls = argumentsOfEach(stripped, 'readSessionInstructions')
  const publishCalls = argumentsOfEach(stripped, 'publishProfileBundle')
  return (
    readerCalls.length === 1 &&
    /thisConversation:\s*thisConversationSpans\(\s*context,\s*toolsToldInTextFor\(provider\),\s*provider,?\s*\)/.test(
      readerCalls[0] ?? '',
    ) &&
    stripped.split('thisConversationSpans(').length - 1 === 1 &&
    publishCalls.length === 1 &&
    squashed(publishCalls[0] ?? '') === 'provider, providerHome, composed.text' &&
    !publishCalls.some((call) => call.includes('thisConversationSpans'))
  )
}

describe('§6 · the composition root hands the reader this conversation’s text and publishes only the profile’s', () => {
  const source = readFileSync(join(SRC, 'main/runtime-host-composition.ts'), 'utf8')

  it('hands the reader this conversation’s text and publishes the profile’s alone', () => {
    // ⚑ Presence first: the calls are found, so the predicate below reads them.
    const stripped = code(source)
    expect(argumentsOfEach(stripped, 'readSessionInstructions')).toHaveLength(1)
    expect(argumentsOfEach(stripped, 'publishProfileBundle')).toHaveLength(1)
    expect(stripped).toMatch(
      /thisConversation:\s*thisConversationSpans\(\s*context,\s*toolsToldInTextFor\(provider\),\s*provider,?\s*\)/,
    )
    expect(stripped.split('thisConversationSpans(').length - 1).toBe(1)
    expect(squashed(argumentsOfEach(stripped, 'publishProfileBundle')[0] ?? '')).toBe(
      'provider, providerHome, composed.text',
    )
    expect(handsTheReaderThisConversationAndPublishesOnlyTheProfiles(source)).toBe(true)
  })

  it('a planted copy that publishes this conversation’s text into the file, or hands it to nobody, fails the same predicate', () => {
    const publishesBoth = source.replace(
      'publishProfileBundle(provider, providerHome, composed.text)',
      'publishProfileBundle(provider, providerHome, composed.text + thisConversationSpans(context).text)',
    )
    expect(publishesBoth).not.toBe(source)
    expect(handsTheReaderThisConversationAndPublishesOnlyTheProfiles(publishesBoth)).toBe(false)

    const hasNone = source.replace(
      '        thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider), provider),\n',
      '',
    )
    expect(hasNone).not.toBe(source)
    expect(handsTheReaderThisConversationAndPublishesOnlyTheProfiles(hasNone)).toBe(false)

    // The control for the control: the untouched source still passes.
    expect(handsTheReaderThisConversationAndPublishesOnlyTheProfiles(source)).toBe(true)
  })
})
