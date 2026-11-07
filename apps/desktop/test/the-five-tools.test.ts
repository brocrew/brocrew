import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
  type ResumeOptions,
  type StartOptions,
  whatTheChildWouldLack,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { CAPABILITY_FIELDS } from '../src/shared/capabilities'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  SPAWN_RAILS,
  describeRail,
  permanenceOf,
  retryableOf,
} from '../src/main/runtime/spawn-rails'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import {
  REPLY_ADDRESSING_KEYS,
  TOOL_NAMES,
  TOOL_REFUSALS,
  agentCallerId,
  agentToolsFor,
  refuseTool,
  sessionSpeakingAs,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

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

function watchingRuntime(
  starts: StartOptions[],
  resumes: ResumeOptions[],
  options: ConstructorParameters<typeof FakeRuntime>[1],
): FakeRuntime {
  const runtime = new FakeRuntime('claude', options)
  const start = runtime.start.bind(runtime)
  const resume = runtime.resume.bind(runtime)
  runtime.start = async (opts) => {
    starts.push(opts)
    return start(opts)
  }
  runtime.resume = async (ref, opts) => {
    resumes.push(opts)
    return resume(ref, opts)
  }
  return runtime
}

describe('347 · the five tools', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let starts: StartOptions[]
  let resumes: ResumeOptions[]
  let sessions: FakeProviderSessions
  let gate: FakeLaunchGate | null
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-tools-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-tools-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 2_000_000
    store = createSessionStore(db, tick)
    counter = 0
    starts = []
    resumes = []
    sessions = new FakeProviderSessions()
    gate = null
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: () =>
        watchingRuntime(starts, resumes, { sessions, ...(gate === null ? {} : { gate }) }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
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
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    options: { approvalMode?: 'ask' | 'auto' } = {},
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      {
        provider: 'claude',
        profileId,
        cwd: work,
        approvalMode: options.approvalMode ?? 'ask',
      },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const narrowedToNone = (profileId: string): void => {
    expect(store.setCapabilities(profileId, { canMessage: 'none' })).toBe(true)
  }

  const eventKinds = (sessionId: string): string[] =>
    store.events(sessionId).map((one) => one.event.type)

  const until = async (check: () => boolean): Promise<void> => {
    for (let n = 0; n < 200; n += 1) {
      if (check()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('the launch never reached the gate')
  }

  const whileALaunchIsHeld = async (
    inFlight: Promise<unknown>,
    ask: () => Promise<Record<string, unknown>>,
    check: (answer: Record<string, unknown> | null) => void,
  ): Promise<Record<string, unknown>> => {
    const heldBefore = gate?.held ?? 0
    let answered: Record<string, unknown> | null = null
    const asked = ask().then((answer) => {
      answered = answer
      return answer
    })
    try {
      await until(() => answered !== null || (gate?.held ?? 0) > heldBefore)
      check(answered)
    } finally {
      gate?.release()
      gate = null
      await Promise.allSettled([inFlight, asked])
    }
    return asked
  }

  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    const call = async (name: ToolName, args: Record<string, unknown>) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return answered.structured as Record<string, unknown>
    }
    return { set, call }
  }

  const give = (
    from: string,
    profile: string,
    title = 'A piece',
    more: Record<string, unknown> = {},
  ) =>
    toolsOf(from).call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: `${title}.`,
      ...more,
    })

  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  describe('§1 · an agent creates another agent and talks to it', () => {
    it('⚑ give_work starts a real session, its brief is the first turn, and message_agent reaches it', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const { call } = toolsOf(parent)

      const given = await give(parent, 'worker', 'Do the thing')
      expect(given.outcome).toBe('ok')
      expect(given.started).toBe(true)
      const child = given.agent as string
      expect(host.sessionIds).toContain(child)

      const briefs = store
        .events(child)
        .flatMap((row) => (row.event.type === 'user_turn' ? [row.event] : []))
      expect(briefs).toHaveLength(1)
      expect(briefs[0]).toMatchObject({ piece: given.piece, label: given.label })

      const said = await call('message_agent', {
        agent: child,
        text: 'please begin',
        kind: 'follow-up',
        piece: given.label,
      })
      expect(said.outcome).toBe('ok')
      expect(said.delivery).toBe('queued')
      expect(eventKinds(child)).toContain('message_queued')
    })

    it('🔴 the give is recorded: the conversation’s parent, and the piece it holds', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const given = await give(parent, 'worker', 'The recorded title')
      const child = given.agent as string

      expect(store.parentOf(child)).toBe(parent)
      const root = store.rootOf(parent)
      expect(given.label).toBe(`${String(root?.label)}.1`)
      expect(store.workById(given.piece as string)).toMatchObject({
        parent: root?.piece,
        label: given.label,
        owner: child,
        givenBy: parent,
        title: 'The recorded title',
        brief: 'The recorded title.',
      })
      expect(store.workById(given.piece as string)!.createdAt).toBeGreaterThan(
        store.find(child)!.createdAt,
      )
    })

    it('⛔ list_agents shows the caller and its children, and a stranger sees neither', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const child = (await give(parent, 'worker')).agent as string

      const mine = (await toolsOf(parent).call('list_agents', {})).agents as { agent: string }[]
      const ids = mine.map((one) => one.agent)
      expect(ids).toContain(parent)
      expect(ids).toContain(child)

      const stranger = await personOpens('nosy')
      narrowedToNone('nosy')
      const theirs = (await toolsOf(stranger).call('list_agents', {})).agents as { agent: string }[]
      expect(theirs.map((one) => one.agent)).toEqual([stranger])
    })

    it('⚠️ get_agent_status reports the child, and refuses a session the caller may not reach', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const child = (await give(parent, 'worker')).agent as string

      const status = await toolsOf(parent).call('get_agent_status', { agent: child })
      expect(status.outcome).toBe('ok')
      const card = status.agent as Record<string, unknown>
      expect(card.agent).toBe(child)
      expect(card.whose).toEqual({
        is: 'an-identity-this-app-holds',
        profile: 'worker',
        name: 'Ada',
      })
      expect(card.parent).toBe(parent)
      expect(card.state).toBe('needs you')

      const stranger = await personOpens('nosy')
      narrowedToNone('nosy')
      const refused = await toolsOf(stranger).call('get_agent_status', { agent: child })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('may-not-message')
      const toldByTheMessageDoor = await toolsOf(stranger).call('message_agent', {
        kind: 'note',
        agent: child,
        text: 'hello',
      })
      expect(toldByTheMessageDoor.rail).toBe(refused.rail)

      const ghost = await toolsOf(stranger).call('get_agent_status', { agent: 'sess_never' })
      expect(ghost.outcome).toBe('refused')
      expect(ghost.rail).toBe('no-such-agent')
      expect(ghost.reason).not.toBe(refused.reason)
    })
  })

  describe('§2 · the tools add no rail', () => {
    it('🔴 a give deeper than a person allowed is refused by the RAIL, with the rail`s own words', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      expect(store.setCapabilities('pm', { maxDepth: 0 })).toBe(true)
      const refused = await give(parent, 'worker')
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('too-deep')
      expect(refused.permanence).toBe(permanenceOf('too-deep'))
      expect(refused.retryable).toBe(retryableOf('too-deep'))
      expect(host.sessionIds).toHaveLength(1)
    })

    it('⚠️ an unknown profile is refused, and a caller too deep to give is told its depth first', async () => {
      const parent = await personOpens('pm')
      const refused = await give(parent, 'ghost')
      expect(refused.rail).toBe('no-such-profile')
      const blind = await personOpens('other')
      expect(store.setCapabilities('other', { maxDepth: 0 })).toBe(true)
      const blindly = await give(blind, 'ghost')
      expect(blindly.rail).toBe('too-deep')
    })

    it('🔴 a caller cannot name somebody else`s session or piece as the parent of its give', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const victim = await personOpens('victim')
      const refused = await give(parent, 'worker', 'x', {
        parent: victim,
        parentSessionId: victim,
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('malformed-request')

      const redirected = await give(parent, 'worker', 'x', { piece: store.rootOf(victim)?.label })
      expect(redirected).toMatchObject({
        outcome: 'refused',
        rail: 'no-piece-you-hold-by-that-name',
      })

      const ok = await give(parent, 'worker', 'x')
      expect(ok.outcome).toBe('ok')
      expect(store.parentOf(ok.agent as string)).toBe(parent)
      expect(store.workById(ok.piece as string)?.parent).toBe(store.rootOf(parent)?.piece)
    })

    it('⛔ an undocumented key is REFUSED rather than stripped (303 B)', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const refused = await give(parent, 'worker', 'x', {
        priority: 'urgent',
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('malformed-request')
      expect(host.sessionIds).toHaveLength(1)
    })

    it('🔴 a give may never start a conversation WIDER than its giver, and an `auto` giver hands it down (499)', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', { approvalMode: 'ask' })
      const refused = await give(parent, 'worker', 'x', { approval_mode: 'auto' })
      expect(refused.rail).toBe('malformed-request')

      const boss = await personOpens('boss', { approvalMode: 'auto' })
      await bringIdentityIntoBeing('worker2')
      const inherited = await give(boss, 'worker2')
      expect(inherited.outcome).toBe('ok')
      expect(store.find(inherited.agent as string)?.approvalMode).toBe('auto')

      await bringIdentityIntoBeing('worker3')
      expect(store.setAgentProvider('worker3', 'codex')).toBe(true)
      const startsBefore = starts.length
      const onCodex = await give(boss, 'worker3')
      expect(onCodex).toMatchObject({ outcome: 'ok', started: true, delivery: 'sent' })
      expect(host.sessionIds).toContain(onCodex.agent)
      expect(store.find(onCodex.agent as string)).toMatchObject({
        approvalMode: 'auto',
        provider: 'codex',
      })
      expect(starts.slice(startsBefore).map((one) => one.approvalMode)).toEqual(['auto'])
      const allowed = await give(parent, 'worker3')
      expect(allowed.outcome).toBe('ok')
      expect(store.find(allowed.agent as string)?.approvalMode).toBe('ask')
      expect(
        whatTheChildWouldLack(
          { provider: 'codex', approvalMode: 'auto' },
          { provider: 'claude', approvalMode: 'ask' },
        ),
      ).toEqual(['the-card-before-an-act'])
    })

    it('⚠️ a permanent refusal answers the same way however many times it is retried', async () => {
      const parent = await personOpens('pm')
      const rails: unknown[] = []
      for (let attempt = 0; attempt < 5; attempt += 1) {
        rails.push((await give(parent, 'ghost')).rail)
      }
      expect(permanenceOf('no-such-profile')).toBe('permanent')
      expect(rails).toEqual(Array.from({ length: 5 }, () => 'no-such-profile'))
      expect(host.sessionIds).toHaveLength(1)
    })

    it('⛔ a refusal is a SUCCESSFUL call: no tool throws, on any path', async () => {
      const parent = await personOpens('pm')
      const { set } = toolsOf(parent)
      for (const tool of set.tools) {
        await expect(tool.call({ nonsense: true })).resolves.toBeDefined()
        await expect(tool.call({})).resolves.toBeDefined()
      }
    })

    it('🔴 message_agent to a stranger refuses instead of throwing the host`s sentence', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const child = (await give(parent, 'worker')).agent as string
      const stranger = await personOpens('nosy')
      narrowedToNone('nosy')
      const refused = await toolsOf(stranger).call('message_agent', {
        kind: 'note',
        agent: child,
        text: 'hello',
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('may-not-message')
      expect(eventKinds(child).filter((kind) => kind === 'user_turn')).toHaveLength(1)
      expect(eventKinds(child)).not.toContain('message_queued')
    })

    it('⛔ 424 · a self-message is refused BY NAME and is not retryable — `422`’s finding, closed', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const { call } = toolsOf(parent)

      const listed = (await call('list_agents', {})).agents as { agent: string }[]
      expect(listed.map((one) => one.agent)).toContain(parent)
      const sameCall = { agent: parent, text: 'keep this for me', kind: 'note' }
      const refused = await call('message_agent', sameCall)
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'that-agent-is-you',
        permanence: 'permanent',
        retryable: false,
      })
      expect(String(refused.reason)).not.toContain('not in a state')

      expect(await call('message_agent', sameCall)).toMatchObject({
        outcome: 'refused',
        rail: 'that-agent-is-you',
        permanence: 'permanent',
        retryable: false,
      })

      const child = (await give(parent, 'worker', 'Receive the same words')).agent as string
      expect(await call('message_agent', { ...sameCall, agent: child })).toMatchObject({
        outcome: 'ok',
        agent: child,
      })
    })
  })

  describe('§3 · two gives in one tick', () => {
    const briefsIn = (sessionId: string): string[] =>
      store
        .events(sessionId)
        .flatMap((row) =>
          (row.event.type === 'user_turn' || row.event.type === 'message_queued') &&
          typeof row.event.piece === 'string'
            ? [row.event.piece]
            : [],
        )

    it('🔴 ONE giver giving one identity twice in the same tick: ONE conversation, and both pieces reach it', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const before = host.sessionIds.length

      const [first, second] = await Promise.all([
        give(parent, 'worker', 'Piece a'),
        give(parent, 'worker', 'Piece b'),
      ])
      expect([first.outcome, second.outcome]).toEqual(['ok', 'ok'])
      expect(second.agent).toBe(first.agent)
      expect([first.started, second.started].sort()).toEqual([false, true])
      expect(host.sessionIds).toHaveLength(before + 1)
      expect(first.label).not.toBe(second.label)
      const child = first.agent as string
      expect(
        store
          .piecesOwnedBy(child)
          .map((one) => one.piece)
          .sort(),
      ).toEqual([first.piece, second.piece].sort())
      expect(briefsIn(child).sort()).toEqual([first.piece, second.piece].sort())
    })

    it('⚑ 428 · …and TWO givers giving one identity in the same tick each get their OWN conversation', async () => {
      await bringIdentityIntoBeing('worker')
      const a = await personOpens('pm-a')
      const b = await personOpens('pm-b')

      const [first, second] = await Promise.all([
        give(a, 'worker', 'For a'),
        give(b, 'worker', 'For b'),
      ])
      expect([first.outcome, second.outcome]).toEqual(['ok', 'ok'])
      expect(first.agent).not.toBe(second.agent)
      expect([first.started, second.started]).toEqual([true, true])
      expect(host.sessionIds).toContain(first.agent)
      expect(host.sessionIds).toContain(second.agent)
      const again = await give(a, 'worker', 'A second for a')
      expect(again).toMatchObject({ outcome: 'ok', agent: first.agent, started: false })
      expect(again.delivery).toBe('held')
    })

    it('🔴 a launch still IN FLIGHT is found by the lookup, before it has registered', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')

      gate = new FakeLaunchGate()
      const inFlight = give(parent, 'worker', 'The first, parked inside start')
      await until(() => (gate?.held ?? 0) > 0)

      let answered: Record<string, unknown> | null = null
      const racing = give(parent, 'worker', 'Racing a launch that has not landed').then(
        (answer) => {
          answered = answer
          return answer
        },
      )
      try {
        await letItSettle()
        expect(gate?.held).toBe(1)
        expect(answered).toBeNull()
      } finally {
        gate?.release()
        gate = null
      }
      const [first, second] = await Promise.all([inFlight, racing])
      expect(second).toMatchObject({ outcome: 'ok', agent: first.agent, started: false })
      expect(first.started).toBe(true)
    })

    it('⛔ …and an unnamed launch in flight already names the seeded profile, and is not the giver’s', async () => {
      await bringIdentityIntoBeing(DEFAULT_PROFILE_ID)
      const parent = await personOpens('pm')

      gate = new FakeLaunchGate()
      const byAPerson = host.createSession({ provider: 'claude', cwd: work }, window)
      await until(() => (gate?.held ?? 0) > 0)

      const starting = host
        .agentsVisibleTo({ ownerId: window.ownerId }, null)
        .agents.filter((one) => one.state.is === 'active')
      expect(starting).toHaveLength(1)
      expect(starting[0]?.whose).toEqual({
        is: 'an-identity-this-app-holds',
        profile: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_LABEL,
      })

      const admitted = await whileALaunchIsHeld(
        byAPerson,
        () => give(parent, DEFAULT_PROFILE_ID, 'Racing an unnamed launch'),
        (answer) => {
          expect(answer).toBeNull()
        },
      )
      expect(admitted).toMatchObject({ outcome: 'ok', started: true })
      const theirs = (await byAPerson).sessionId
      expect(admitted.agent).not.toBe(theirs)

      const again = await give(parent, DEFAULT_PROFILE_ID, 'A second of my own')
      expect(again).toMatchObject({ outcome: 'ok', agent: admitted.agent, started: false })
      expect(host.sessionIds).toContain(theirs)
    })

    it('⚠️ a REOPEN in flight is found by the lookup as well — and it remembers whose child it was', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const given = await give(parent, 'worker', 'One to stop and reopen')
      expect(given.outcome).toBe('ok')
      const recorded = given.agent as string
      expect(
        await toolsOf(recorded).call('reply_to_parent', {
          piece: given.piece,
          outcome: 'done',
          summary: 'Done.',
        }),
      ).toMatchObject({ outcome: 'ok' })
      await host.close(recorded, THE_APP_ITSELF)
      expect(host.sessionIds).not.toContain(recorded)

      gate = new FakeLaunchGate()
      const reopening = host.resumeSession(recorded, new RecordingSink('webContents:3'))
      await until(() => (gate?.held ?? 0) > 0)

      let answered: Record<string, unknown> | null = null
      const racing = give(parent, 'worker', 'Racing a reopen').then((answer) => {
        answered = answer
        return answer
      })
      try {
        await letItSettle()
        expect(gate?.held).toBe(1)
      } finally {
        gate?.release()
        gate = null
      }
      await reopening
      const second = await racing
      expect(answered).not.toBeNull()
      expect(second).toMatchObject({ outcome: 'ok', agent: recorded, started: false })
      expect(host.sessionIds.filter((id) => id !== parent)).toEqual([recorded])
    })

    it('⚠️ …and the same pair for two DIFFERENT identities are both started', async () => {
      await bringIdentityIntoBeing('one')
      await bringIdentityIntoBeing('two')
      const a = await personOpens('pm-a')
      const b = await personOpens('pm-b')
      const [first, second] = await Promise.all([give(a, 'one', 'a'), give(b, 'two', 'b')])
      expect([first.outcome, second.outcome]).toEqual(['ok', 'ok'])
      expect([first.started, second.started]).toEqual([true, true])
    })
  })

  describe('§3.1 · 428 · the four cases 426 pinned, brought to the key', () => {
    const recordedSessions = (): number =>
      (db.prepare('SELECT count(*) AS n FROM provider_session').get() as { n: number }).n

    it('⚑ 428 · two givers each get their own conversation of one identity', async () => {
      await bringIdentityIntoBeing('worker')
      await bringIdentityIntoBeing('other-worker')
      const here = await personOpens('pm-a')
      const there = await personOpens('pm-b')

      const first = await give(here, 'worker', 'Work for the first giver')
      expect(first.outcome).toBe('ok')
      const child = first.agent as string

      const alsoThere = await give(there, 'worker', 'Same identity for the second giver')
      expect(alsoThere).toMatchObject({ outcome: 'ok', started: true })
      const sibling = alsoThere.agent as string
      expect(host.sessionIds).toContain(child)
      expect(host.sessionIds).toContain(sibling)

      expect(
        await toolsOf(there).call('message_agent', {
          agent: child,
          text: 'can we coordinate?',
          kind: 'follow-up',
          piece: alsoThere.label,
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'not-a-piece-you-gave' })

      const again = await give(there, 'worker', 'A second one over there')
      expect(again).toMatchObject({ outcome: 'ok', agent: sibling, started: false })
      expect(
        await toolsOf(there).call('message_agent', {
          agent: sibling,
          text: 'carry on',
          kind: 'follow-up',
          piece: alsoThere.label,
        }),
      ).toMatchObject({ outcome: 'ok' })

      const oneFactOver = await give(there, 'other-worker', 'Different identity, same two givers')
      expect(oneFactOver).toMatchObject({ outcome: 'ok', started: true })
      expect(host.sessionIds).toContain(child)
    })

    it('⚑ one giver’s second give of one identity reaches the conversation it has — not a different identity, and not a person’s', async () => {
      await bringIdentityIntoBeing('worker')
      await bringIdentityIntoBeing('other-worker')
      const parent = await personOpens('pm')
      const call = toolsOf(parent).call

      const first = await give(parent, 'worker', 'First')
      expect(first.outcome).toBe('ok')
      const child = first.agent as string
      const second = await give(parent, 'worker', 'Second')
      expect(second).toMatchObject({ outcome: 'ok', agent: child, started: false })
      expect(await call('get_agent_status', { agent: child })).toMatchObject({ outcome: 'ok' })
      expect(
        await call('message_agent', {
          agent: child,
          text: 'continue the first piece',
          kind: 'follow-up',
          piece: first.label,
        }),
      ).toMatchObject({ outcome: 'ok' })

      const oneFactOver = await give(parent, 'other-worker', 'Different identity')
      expect(oneFactOver).toMatchObject({ outcome: 'ok', started: true })
      expect(oneFactOver.agent).not.toBe(child)

      const human = await personOpens('worker')
      expect(human).not.toBe(child)
      expect(host.sessionIds).toContain(child)
      expect(host.sessionIds).toContain(human)
    })

    it('🔴 a same-giver reservation is FOUND; two givers’ reservations are each their own', async () => {
      await bringIdentityIntoBeing('worker')
      const here = await personOpens('pm-a')
      const there = await personOpens('pm-b')
      const third = await personOpens('pm-c')

      const heldPair = async (a: string, b: string, expected: 'one start' | 'two starts') => {
        gate = new FakeLaunchGate()
        const before = recordedSessions()
        let secondAnswer: Record<string, unknown> | null = null
        const first = give(a, 'worker', 'First')
        const second = give(b, 'worker', 'Second').then((answer) => {
          secondAnswer = answer
          return answer
        })
        try {
          await until(() => (gate?.held ?? 0) > 0)
          await letItSettle()
          expect(recordedSessions()).toBe(before)
          expect(secondAnswer).toBeNull()
          expect(gate?.held).toBe(expected === 'one start' ? 1 : 2)
        } finally {
          gate?.release()
          gate = null
          await Promise.allSettled([first, second])
        }
        return Promise.all([first, second])
      }

      const sameGiver = await heldPair(here, here, 'one start')
      expect(sameGiver.map((one) => one.outcome)).toEqual(['ok', 'ok'])
      expect(sameGiver[1]?.agent).toBe(sameGiver[0]?.agent)

      const twoGivers = await heldPair(there, third, 'two starts')
      expect(twoGivers.map((one) => one.outcome)).toEqual(['ok', 'ok'])
      expect(twoGivers[1]?.agent).not.toBe(twoGivers[0]?.agent)
    })

    it('🔴 428 · a person’s conversation of that identity is never the one a give reaches', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const call = toolsOf(parent).call
      const personHeld = await personOpens('worker')

      const given = await give(parent, 'worker', 'While a person is talking to this identity')
      expect(given).toMatchObject({ outcome: 'ok', started: true })
      const child = given.agent as string
      expect(host.sessionIds).toContain(personHeld)
      expect(host.sessionIds).toContain(child)
      expect(
        await call('message_agent', {
          agent: personHeld,
          text: 'take this',
          kind: 'follow-up',
          piece: given.label,
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'not-a-piece-you-gave' })

      const again = await give(parent, 'worker', 'Again')
      expect(again).toMatchObject({ outcome: 'ok', agent: child, started: false })
      expect(again.agent).not.toBe(personHeld)
      expect(await call('get_agent_status', { agent: child })).toMatchObject({ outcome: 'ok' })
      expect(
        await call('message_agent', {
          agent: child,
          text: 'carry on',
          kind: 'follow-up',
          piece: given.label,
        }),
      ).toMatchObject({ outcome: 'ok' })
    })
  })

  describe('§4 · a resumed agent does not silently lose its tools', () => {
    it.each(['pm', DEFAULT_PROFILE_ID])(
      'the eligible toolset reaches start and resume for %s',
      async (profile) => {
        const id = await personOpens(profile)
        const expected = TOOL_NAMES.filter(
          (name) => name !== 'write_agent_rules' || profile === DEFAULT_PROFILE_ID,
        )
        const started = starts.at(-1)
        expect(started?.agentTools?.server).toBe('brobot')
        expect(started?.agentTools?.tools.map((one) => one.name)).toEqual(expected)

        await host.close(id, window)
        resumes.length = 0
        await host.resumeSession(id, new RecordingSink('webContents:2'))
        const resumed = resumes.at(-1)
        expect(resumed?.agentTools?.tools.map((one) => one.name)).toEqual(expected)
      },
    )
  })

  describe('§5 · what is published, and what is not', () => {
    it('⛔ the inventory is exactly the published list, and criterion 6 is measured against it', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const offered = starts.at(-1)!.agentTools!.tools.map((one) => one.name)
      expect(offered).toEqual([...TOOL_NAMES])
      expect(offered).toHaveLength(33)
    })

    it('⚠️ no published tool queues work for an agent to pick up later', async () => {
      const SUBJECT: Record<
        ToolName,
        | 'the agent'
        | 'an agent, by its profile'
        | 'a resource'
        | 'a piece it was given'
        | 'a piece it gave'
        | 'a piece it holds or gave'
        | 'a piece it or its profile holds or gave'
        | 'a question it was sent'
        | 'a question it was asked'
        | 'a question it asked'
        | 'an agent that does not exist yet'
        | 'nothing at all'
        | 'a theme'
        | 'a server to register'
      > = {
        list_themes: 'a theme',
        save_theme: 'a theme',
        set_theme: 'a theme',
        list_agents: 'nothing at all',
        get_agent_status: 'the agent',
        give_work: 'an agent, by its profile',
        message_agent: 'the agent',
        read_document: 'a resource',
        reply_to_parent: 'a piece it was given',
        list_tasks: 'a piece it or its profile holds or gave',
        answer_question: 'a question it was sent',
        interrupt_agent: 'the agent',
        list_questions: 'nothing at all',
        create_agent: 'an agent that does not exist yet',
        withdraw_task: 'a piece it gave',
        ask_question: 'a piece it was given',
        pass_question_up: 'a question it was asked',
        list_profiles: 'an agent, by its profile',
        propose_agent_rules: 'the agent',
        read_agent_rules: 'the agent',
        read_own_notes: 'the agent',
        write_own_notes: 'nothing at all',
        write_agent_rules: 'the agent',
        withdraw_question: 'a question it asked',
        read_transcript: 'the agent',
        update_work: 'a piece it holds or gave',
        take_on_work: 'nothing at all',
        find_files: 'nothing at all',
        search_work: 'nothing at all',
        search_past_work: 'nothing at all',
        restore_agent: 'the agent',
        request_mcp_server: 'a server to register',
        request_action: 'a piece it was given',
      }
      await personOpens(DEFAULT_PROFILE_ID)
      const offered = starts.at(-1)!.agentTools!
      for (const tool of offered.tools) {
        const shape = Object.keys(tool.input)
        const names = SUBJECT[tool.name as ToolName]
        if (names === 'a theme') {
          expect(shape, tool.name).toContain(tool.name === 'save_theme' ? 'theme' : 'id')
          for (const aimed of REPLY_ADDRESSING_KEYS)
            expect(shape, `${tool.name} advertises ${aimed}`).not.toContain(aimed)
        }
        if (names === 'the agent') expect(shape, tool.name).toContain('agent')
        if (names === 'an agent, by its profile') {
          expect(shape, tool.name).toContain('profile')
          expect(shape, tool.name).not.toContain('agent')
        }
        if (names === 'a resource') expect(shape, tool.name).toEqual(['resource'])
        if (names === 'a server to register') {
          expect(shape, tool.name).toContain('url')
          expect(shape, tool.name).not.toContain('agent')
        }
        if (names === 'a piece it gave') expect(shape, tool.name).toEqual(['piece'])
        if (names === 'a piece it holds or gave') expect(shape, tool.name).toContain('piece')
        if (names === 'a piece it or its profile holds or gave') {
          expect(shape, tool.name).toContain('piece')
        }
        if (names === 'a question it was asked') {
          expect(shape, tool.name).toContain('question')
          for (const aimed of REPLY_ADDRESSING_KEYS) {
            expect(shape, `${tool.name} advertises ${aimed}`).not.toContain(aimed)
          }
        }
        if (names === 'a piece it was given') {
          expect(shape, tool.name).toContain('piece')
          for (const aimed of REPLY_ADDRESSING_KEYS) {
            if (tool.name === 'ask_question' && aimed === 'agent') {
              expect(shape, 'ask_question names the agent for an-agent').toContain('agent')
              continue
            }
            expect(shape, `${tool.name} advertises ${aimed}`).not.toContain(aimed)
          }
        }
        if (names === 'an agent that does not exist yet') {
          expect(shape, tool.name).toEqual([
            'profile_slug',
            'provider',
            'rules',
            'model',
            'effort',
            'kind',
          ])
          expect(shape, tool.name).not.toContain('agent')
          expect(shape, tool.name).not.toContain('display_name')
          expect(shape, tool.name).not.toContain('role')
        }
        if (names === 'a question it was sent') {
          expect(shape, tool.name).toEqual([
            'question',
            'asked_by',
            'answers',
            'cannot_answer',
            'interrupt',
          ])
          for (const aimed of REPLY_ADDRESSING_KEYS) {
            expect(shape, `${tool.name} advertises ${aimed}`).not.toContain(aimed)
          }
        }
      }
      expect(
        Object.keys(offered.tools.find((one) => one.name === 'list_tasks')?.input ?? {}),
      ).toEqual(['piece', 'made', 'state', 'limit'])
      const words = ['dispatch', 'assign', 'delegate', 'hand_off', 'handoff', 'enqueue', 'task']
      const CARRIES_THE_WORK = [
        'text',
        'work',
        'prompt',
        'instructions',
        'message',
        'summary',
        'purpose',
        'body',
        'brief',
      ]
      for (const word of words) {
        const carrying = TOOL_NAMES.filter((name) => name.includes(word))
        for (const name of carrying) {
          const shape = Object.keys(
            offered.tools.find((one) => one.name === name)?.input ?? { text: 1 },
          )
          for (const carrier of CARRIES_THE_WORK) {
            expect(shape, `${name} advertises ${carrier}, which is how work travels`).not.toContain(
              carrier,
            )
          }
        }
      }
      expect(TOOL_NAMES.filter((name) => words.some((word) => name.includes(word)))).toEqual([
        'list_tasks',
        'withdraw_task',
      ])
      for (const [name, carrier] of [
        ['message_agent', 'text'],
        ['give_work', 'brief'],
        ['reply_to_parent', 'summary'],
      ] as const) {
        expect(
          Object.keys(offered.tools.find((one) => one.name === name)?.input ?? {}),
          name,
        ).toContain(carrier)
        expect(CARRIES_THE_WORK).toContain(carrier)
      }
    })

    it('🔴 no two refusals answer with the same sentence', () => {
      const sentences = TOOL_REFUSALS.map((rail) => refuseTool(rail).reason)
      expect(new Set(sentences).size).toBe(TOOL_REFUSALS.length)
      const railSentences = SPAWN_RAILS.map((rail) => describeRail(rail))
      expect(new Set([...sentences, ...railSentences]).size).toBe(
        sentences.length + railSentences.length,
      )
      expect(railSentences.every((one) => one.includes(' '))).toBe(true)
    })

    it('⚠️ every refusal is a real sentence, and retryable is DERIVED from permanence', () => {
      for (const rail of TOOL_REFUSALS) {
        const payload = refuseTool(rail)
        expect(payload.reason.length).toBeGreaterThan(40)
        expect(payload.reason.endsWith('.')).toBe(true)
        expect(payload.retryable).toBe(payload.permanence === 'while-this-holds')
      }
      expect(refuseTool('malformed-request').retryable).toBe(false)
      expect(refuseTool('no-such-agent').retryable).toBe(false)
      expect(refuseTool('agent-could-not-start-just-now').retryable).toBe(true)
    })

    it('🔴 an agent may name its own session as a PARENT, and may not command it', async () => {
      const alone = await personOpens('solo')
      const itself = { ownerId: agentCallerId(alone) }
      await expect(host.send(alone, 'talking to myself', itself)).rejects.toThrow()
      await expect(host.queueMessage(alone, 'and again', itself)).rejects.toThrow()
      await expect(host.send(alone, 'from the window', window)).resolves.toBeUndefined()
    })

    it('⛔ an agent caller can never present itself as a window', () => {
      const windowIds = [0, 1, 2, 99].map((id) => sinkOwnerId({ id }))
      const agentIds = ['sess_1', 'webContents:1', 'agent:sess_2', ''].map(agentCallerId)
      for (const agent of agentIds) expect(windowIds).not.toContain(agent)
      expect(sessionSpeakingAs({ ownerId: agentCallerId('sess_9') })).toBe('sess_9')
      expect(sessionSpeakingAs({ ownerId: sinkOwnerId({ id: 1 }) })).toBeNull()
    })
  })

  describe('§6 · the tool layer holds no policy', () => {
    const codeOf = (relative: string): string =>
      readFileSync(join(srcRoot, relative), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')

    it('🔴 `agent-tools.ts` names no capability, no bound and no depth', () => {
      const code = codeOf('main/runtime/agent-tools.ts')
      for (const forbidden of [
        ...CAPABILITY_FIELDS.map((field) => field.key),
        ...CAPABILITY_FIELDS.map((field) => field.column),
        'spawningEnabled',
        'depthOf',
        'capabilitiesOf',
        'mayControl',
        'mayClaim',
        'admitGive',
        'agentIdentities',
        'setCapabilities',
      ]) {
        expect(code).not.toContain(forbidden)
      }
      expect(CAPABILITY_FIELDS.length).toBeGreaterThanOrEqual(4)
      expect(CAPABILITY_FIELDS.map((field) => field.key)).toContain('canMessage')
      expect(code).toContain('host.giveWork')
      expect(code).toContain('host.queueMessage')
      expect(code).toContain('host.interruptAgent')
    })

    it('🔴 the live rig re-reads the parent transcript rather than caching it', () => {
      const rig = readFileSync(join(here, '../smoke/an-agent-spawns-an-agent.smoke.ts'), 'utf8')
      expect(rig).toContain('const parentToolCalls = (): string[] =>')
      expect(rig).toContain("await until('message_agent in the parent transcript'")
      expect(rig).toContain('claudeKeychainTokenProvider')
    })

    it('🔴 348 · the Codex rigs still ask the questions they were written to ask', () => {
      const rig = readFileSync(
        join(here, '../smoke/a-codex-agent-spawns-an-agent.smoke.ts'),
        'utf8',
      )
      expect(rig).toContain(
        "expect(parentToolCalls().some((name) => name === 'brobot__give_work')).toBe(true)",
      )
      expect(rig).toContain("await until('message_agent in the parent transcript'")
      expect(rig).toContain('provisionCodexAuth')

      const probe = readFileSync(
        join(here, '../../../packages/runtime/smoke/codex-dynamic-tools-probe.smoke.ts'),
        'utf8',
      )
      expect(probe).toContain("expect(namesIn(control.bodies[0]), 'C · no dynamicTools sent")
      expect(probe).toContain("'D · after a cold resume by another process'")
    })

    it('⛔ the tools never hand a claiming sink to anything (340`s census, answered)', () => {
      const code = codeOf('main/runtime/agent-tools.ts')
      expect(code).not.toContain('RuntimeEventSink')
      expect(code).not.toContain('claimSession')
      expect(code).not.toContain('sendLiveness')
    })

    it('⛔ the tool layer still holds no policy about the name it hands back', () => {
      const code = codeOf('main/runtime/agent-tools.ts')
      const importing = "import { randomUUID } from 'node:crypto'"
      const minting = 'const messageAct = `message_act_${randomUUID()}`'
      expect(code).toContain(importing)
      expect(code).toContain(minting)
      const withoutAct = (one: string): string => one.replace(importing, '').replace(minting, '')
      expect(withoutAct(code)).not.toContain('randomUUID')
      expect(withoutAct(`${code}\nconst another = randomUUID()`)).toContain('randomUUID')
      expect(withoutAct(code.replace(minting, `${minting}\n${minting}`))).toContain('randomUUID')
      expect(code).not.toContain('msg_')
      expect(code).toContain('piece: given.piece')
    })
  })

  describe('§7 · 354 · the message has a name, and a second has its own', () => {
    let itsPiece = ''

    const aBusyChild = async (parent: string): Promise<string> => {
      const first = await give(parent, 'worker', 'Be busy')
      const child = first.agent as string
      itsPiece = String(first.label)
      expect(first.delivery).toBe('sent')
      expect(first.message).toBeUndefined()
      await until(() => eventKinds(child).includes('permission_request'))
      return child
    }

    it('🔴 D-010 · a held message is named, and a second is HELD under a name of its own', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const { call } = toolsOf(parent)
      const child = await aBusyChild(parent)
      const heldIds = (): string[] =>
        store
          .events(child)
          .flatMap((row) =>
            row.event.type === 'message_queued' && row.event.messageId !== undefined
              ? [row.event.messageId]
              : [],
          )

      const held = await call('message_agent', {
        agent: child,
        text: 'and then this',
        kind: 'follow-up',
        piece: itsPiece,
      })
      expect(held.outcome).toBe('ok')
      expect(held.delivery).toBe('queued')
      expect(held).not.toHaveProperty('message')

      const second = await call('message_agent', {
        agent: child,
        text: 'and a third',
        kind: 'note',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      expect(second.delivery).toBe('queued')
      expect(second).not.toHaveProperty('message')
      const [first, next] = heldIds()
      expect(heldIds()).toHaveLength(2)
      expect(first).toMatch(/^msg_/)
      expect(next).toMatch(/^msg_/)
      expect(next).not.toBe(first)
    })
  })
})
