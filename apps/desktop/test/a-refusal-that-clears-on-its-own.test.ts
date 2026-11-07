import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, TURN_REFUSED, TurnInProgress } from '@brobot2/runtime'
import type { AgentToolAnswer } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import {
  agentToolsFor,
  refuseTool,
  type AgentToolHost,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { SessionStillStarting } from '../src/main/runtime/session-unavailable'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const THE_FOLD = 'agent-cannot-take-a-message'
const THE_FOLDS_SENTENCE =
  'that agent is not in a state where it can be given anything to do, so the message was not queued. Coming back will not change that on its own — a person has to put that conversation right.'

const THE_ROW_BOUND = 200

class HeldSendRuntime extends FakeRuntime {
  static held: Promise<void> | null = null
  static unattended = false
  static readonly sent: string[] = []
  constructor(sessions: FakeProviderSessions) {
    super('claude', { sessions })
  }
  private holdSends<H extends { send: (text: string, ...rest: never[]) => Promise<void> }>(
    handle: H,
  ): H {
    const send = handle.send.bind(handle)
    const unattended = HeldSendRuntime.unattended
    const setApprovalMode = (
      handle as unknown as { setApprovalMode?: (m: string) => Promise<void> }
    ).setApprovalMode
    return Object.assign(handle, {
      ...(unattended && setApprovalMode !== undefined
        ? { setApprovalMode: async (): Promise<void> => {} }
        : {}),
      send: async (text: string, ...rest: never[]): Promise<void> => {
        if (HeldSendRuntime.held !== null) await HeldSendRuntime.held
        HeldSendRuntime.sent.push(text)
        await send(text, ...rest)
      },
    })
  }
  override async start(...args: Parameters<FakeRuntime['start']>) {
    const mode = HeldSendRuntime.unattended ? { approvalMode: 'auto' as const } : {}
    return this.holdSends(await super.start({ ...args[0], ...mode }))
  }
  override async resume(...args: Parameters<FakeRuntime['resume']>) {
    const mode = HeldSendRuntime.unattended ? { approvalMode: 'auto' as const } : {}
    return this.holdSends(await super.resume(args[0], { ...args[1], ...mode }))
  }
}

describe('650 · a refusal that clears on its own', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let hold: { gate: Promise<void>; release: () => void; fail: () => void } | null

  const armTheHold = (): void => {
    let release = (): void => {}
    let fail = (): void => {}
    const gate = new Promise<void>((resolve, reject) => {
      release = resolve
      fail = () => reject(new Error('650 · the provider home could not be prepared'))
    })
    gate.catch(() => undefined)
    hold = { gate, release: () => release(), fail: () => fail() }
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-650-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-650-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 4_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    sessions = new FakeProviderSessions()
    hold = null
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: () => new HeldSendRuntime(sessions),
      prepareProviderHome: async (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        if (hold !== null) await hold.gate
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    hold?.release()
    hold = null
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, approvalMode: 'ask' | 'auto' = 'auto') =>
    (await host.createSession({ provider: 'claude', profileId, approvalMode, cwd: work }, window))
      .sessionId

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const toolsOf = (sessionId: string, over: AgentToolHost = host) => {
    const set = agentToolsFor(over, sessionId)
    return async (name: ToolName, args: Record<string, unknown>): Promise<AgentToolAnswer> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return tool.call(args)
    }
  }
  const payload = (answer: AgentToolAnswer): Record<string, unknown> =>
    answer.structured as Record<string, unknown>

  const stillPending = async (answer: Promise<AgentToolAnswer>): Promise<unknown> =>
    Promise.race([
      answer.then(payload),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('still pending'), 100)
      }),
    ])

  const until = async (check: () => boolean | Promise<boolean>, what: string): Promise<void> => {
    for (let n = 0; n < 400; n += 1) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const cardsOf = async (
    call: ReturnType<typeof toolsOf>,
  ): Promise<{ agent: string; state: string }[]> =>
    (payload(await call('list_agents', {})) as { agents: { agent: string; state: string }[] })
      .agents

  const eventsOf = (sessionId: string): { type: string; [key: string]: unknown }[] =>
    store.events(sessionId).map((one) => one.event as { type: string; [key: string]: unknown })

  const labelsIn = (sessionId: string): string[] =>
    eventsOf(sessionId)
      .filter((event) => event.type === 'work_given')
      .map((event) => event.label as string)

  const aParentWithASibling = async (): Promise<{
    parent: string
    call: ReturnType<typeof toolsOf>
    sibling: string
  }> => {
    await bringIdentityIntoBeing('worker')
    await bringIdentityIntoBeing('sibling')
    const parent = await personOpens(DEFAULT_PROFILE_ID)
    const call = toolsOf(parent)
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'sibling',
        title: 'the control',
        brief: 'the control',
      }),
    )
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { parent, call, sibling: given.agent as string }
  }

  const aSpawnInFlight = async (
    call: ReturnType<typeof toolsOf>,
  ): Promise<{ id: string; spawning: Promise<AgentToolAnswer> }> => {
    armTheHold()
    const before = new Set((await cardsOf(call)).map((card) => card.agent))
    const spawning = call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the subject',
      brief: 'the subject',
    })
    spawning.catch(() => undefined)
    let id = ''
    await until(async () => {
      const fresh = (await cardsOf(call)).find(
        (card) => !before.has(card.agent) && card.state === 'active',
      )
      id = fresh?.agent ?? ''
      return fresh !== undefined
    }, 'the held spawn to be listed as active')
    return { id, spawning }
  }

  it('§1 a launch in flight is not refused: the message waits for it and is delivered once it lands', async () => {
    const { call, sibling } = await aParentWithASibling()
    const { id, spawning } = await aSpawnInFlight(call)
    const words = { agent: id, text: 'please start on this', kind: 'note' }

    const waiting = call('message_agent', words)
    expect(await stillPending(waiting)).toBe('still pending')
    expect(eventsOf(id).filter((event) => event.type !== 'status')).toEqual([])

    expect(payload(await call('message_agent', { ...words, agent: sibling }))).toMatchObject({
      outcome: 'ok',
    })

    hold?.release()
    hold = null
    expect(payload(await spawning)).toMatchObject({ outcome: 'ok', agent: id })
    const delivered = payload(await waiting)
    expect(delivered).toMatchObject({ outcome: 'ok', delivery: 'sent', agent: id })
    expect([...labelsIn(sibling), ...labelsIn(id)]).toEqual(['W3.1', 'W3.2'])
    expect(delivered.rail).toBeUndefined()

    const sentence = refuseTool('that-conversation-has-not-started').reason
    expect(sentence).toContain('nothing was done to it')
    expect(sentence).toContain('on its own')
    expect(sentence).toContain('make the same call again')
    expect(sentence).not.toMatch(/\ba person\b/i)
    expect(`refused (that-conversation-has-not-started): ${sentence}`.length).toBeLessThanOrEqual(
      THE_ROW_BOUND,
    )
    expect(sentence).not.toBe(THE_FOLDS_SENTENCE)
  })

  it('§1.1 a caller narrowed to message nobody is refused by its own wall, not told to retry a launch', async () => {
    const { call } = await aParentWithASibling()
    const { id, spawning } = await aSpawnInFlight(call)
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' })).toBe(true)
    expect(
      payload(await call('message_agent', { agent: id, text: 'hello', kind: 'note' })),
    ).toMatchObject({ outcome: 'refused', rail: 'may-not-message' })
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'any' })).toBe(true)
    const waiting = call('message_agent', { agent: id, text: 'hello', kind: 'note' })
    expect(await stillPending(waiting)).toBe('still pending')
    hold?.release()
    hold = null
    await Promise.allSettled([spawning])
    expect(payload(await waiting)).toMatchObject({ outcome: 'ok', agent: id })
  })

  it('§2 a launch that fails clears the wait too, and the waiting call and the retry meet no-such-agent at both doors', async () => {
    const { call, sibling } = await aParentWithASibling()
    const { id, spawning } = await aSpawnInFlight(call)
    const words = { agent: id, text: 'please start on this', kind: 'note' }
    const waiting = call('message_agent', words)
    expect(await stillPending(waiting)).toBe('still pending')

    hold?.fail()
    hold = null
    await Promise.allSettled([spawning])
    expect(payload(await waiting)).toMatchObject({
      outcome: 'refused',
      rail: 'no-such-agent',
      permanence: 'permanent',
    })
    await until(
      async () => !(await cardsOf(call)).some((card) => card.agent === id),
      'the failed launch to be abandoned',
    )

    expect(payload(await call('message_agent', words))).toMatchObject({
      outcome: 'refused',
      rail: 'no-such-agent',
      permanence: 'permanent',
    })
    expect(
      payload(await call('interrupt_agent', { agent: id, reason: 'stop that' })),
    ).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
    expect(payload(await call('message_agent', { ...words, agent: sibling }))).toMatchObject({
      outcome: 'ok',
    })
  })

  it('§3 a reopen in flight is the shared word at interrupt, a message waits for it, and a Close is a stop', async () => {
    const { call } = await aParentWithASibling()
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      }),
    )
    const child = given.agent as string
    const piece = given.piece as string
    await host.close(child, THE_APP_ITSELF)
    await until(() => !host.sessionIds.includes(child), 'the child to stop')

    armTheHold()
    const reopening = host.resumeSession(child, window)
    reopening.catch(() => undefined)
    await until(
      async () => (await cardsOf(call)).some((c) => c.agent === child && c.state === 'active'),
      'the reopen to be listed as active',
    )

    const messaged = call('message_agent', {
      agent: child,
      text: 'are you back',
      kind: 'follow-up',
      piece,
    })
    expect(await stillPending(messaged)).toBe('still pending')
    const interrupted = payload(await call('interrupt_agent', { agent: child, reason: 'wait' }))
    expect(interrupted).toMatchObject({
      outcome: 'refused',
      rail: 'that-conversation-has-not-started',
      permanence: 'while-this-holds',
      remedy: 'make-the-same-call-when-this-settles',
    })

    const closing = host.close(child, window)
    closing.catch(() => undefined)
    const interruptedWhileClosing = payload(
      await call('interrupt_agent', { agent: child, reason: 'wait' }),
    )
    const messagedWhileClosing = call('message_agent', {
      agent: child,
      text: 'are you back',
      kind: 'follow-up',
      piece,
    })
    expect(await stillPending(messagedWhileClosing)).toBe('still pending')
    expect(interruptedWhileClosing).toMatchObject({ outcome: 'ok', agent: child, asked: false })
    expect(interruptedWhileClosing.rail).toBeUndefined()

    hold?.release()
    hold = null
    await Promise.allSettled([reopening, closing])
    expect(payload(await messaged)).toMatchObject({ outcome: 'ok', agent: child })
    expect(payload(await messagedWhileClosing)).toMatchObject({ outcome: 'ok', agent: child })
  })

  const aCallerAndAParkingReceiver = async (): Promise<{
    call: ReturnType<typeof toolsOf>
    receiver: string
    piece: string
  }> => {
    await bringIdentityIntoBeing('worker')
    const call = toolsOf(await personOpens(DEFAULT_PROFILE_ID))
    const { agent, piece } = await aParkingChildOf(call, 'worker')
    return { call, receiver: agent, piece }
  }

  const stateOf = async (
    call: ReturnType<typeof toolsOf>,
    agent: string,
  ): Promise<string | undefined> =>
    (await cardsOf(call)).find((card) => card.agent === agent)?.state

  const aParkingChildOf = async (
    call: ReturnType<typeof toolsOf>,
    profile: string,
  ): Promise<{ agent: string; piece: string }> => {
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: 'a receiver that parks',
        brief: 'a receiver that parks',
      }),
    )
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const agent = given.agent as string
    await until(
      () => eventsOf(agent).some((event) => event.type === 'turn'),
      'the brief to run and end',
    )
    await until(async () => (await stateOf(call, agent)) === 'idle', 'the receiver to be idle')
    await host.setApprovalMode(agent, 'ask', THE_APP_ITSELF)
    return { agent, piece: given.piece as string }
  }

  it('§4 two calls in one tick to one idle agent: one goes, and the other is HELD rather than refused', async () => {
    const { call, receiver, piece } = await aCallerAndAParkingReceiver()
    const numbered = vi.spyOn(store, 'numberUnder')

    const asked = { agent: receiver, text: 'what are you on', kind: 'follow-up', piece }
    const told = { agent: receiver, text: 'then do this', kind: 'note' }
    const answers = (
      await Promise.all([call('message_agent', asked), call('message_agent', told)])
    ).map(payload)

    expect(answers.map((one) => one.outcome)).toEqual(['ok', 'ok'])
    expect(answers.map((one) => one.delivery).sort()).toEqual(['queued', 'sent'])
    expect(answers.map((one) => one.rail)).not.toContain('agent-started-a-turn-first')
    expect(eventsOf(receiver).filter((event) => event.type === 'message_queued')).toHaveLength(1)
    expect(labelsIn(receiver)).toEqual(['W2.1'])
    expect(numbered).not.toHaveBeenCalled()
  })

  it('§4 · control: the same two calls one AFTER the other are sent and then held, and nothing is refused', async () => {
    const { call, receiver, piece } = await aCallerAndAParkingReceiver()
    const first = payload(
      await call('message_agent', {
        agent: receiver,
        text: 'what are you on',
        kind: 'follow-up',
        piece,
      }),
    )
    const second = payload(
      await call('message_agent', { agent: receiver, text: 'then do this', kind: 'note' }),
    )
    expect([first.delivery, second.delivery]).toEqual(['sent', 'queued'])
  })

  it('§5 the same bytes classify differently by type and field alone', async () => {
    await bringIdentityIntoBeing('worker')
    const caller = await personOpens(DEFAULT_PROFILE_ID)
    const target = await personOpens('worker')
    const starting = `session is still starting: ${target}`
    const plants: readonly (readonly [string, Error, string])[] = [
      [
        'a launch in flight',
        new SessionStillStarting(starting, false),
        'that-conversation-has-not-started',
      ],
      ['the same text, untyped', new Error(starting), THE_FOLD],
      ['a reservation being closed', new SessionStillStarting(starting, true), THE_FOLD],
      ['a turn already held', new TurnInProgress(), THE_FOLD],
      ['the same text, untyped', new Error(TURN_REFUSED), THE_FOLD],
    ]
    for (const [what, thrown, rail] of plants) {
      const over = new Proxy(host, {
        get(target, key, receiver) {
          if (key === 'queueMessage') return () => Promise.reject(thrown)
          const value: unknown = Reflect.get(target, key, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }) as unknown as AgentToolHost
      const answered = payload(
        await toolsOf(caller, over)('message_agent', {
          agent: target,
          text: 'hi',
          kind: 'note',
        }),
      )
      expect([what, answered.rail]).toEqual([what, rail])
      expect((answered.detail as { said: string }).said, what).toBe(thrown.message)
    }
    expect(String(new SessionStillStarting(starting, false))).toBe(`Error: ${starting}`)
    expect(String(new TurnInProgress())).toBe(`Error: ${TURN_REFUSED}`)
  })

  it('§6 idle branch: a piece that cannot be written down after its brief went out is not reported as unsent', async () => {
    await bringIdentityIntoBeing('worker')
    await bringIdentityIntoBeing('sibling')
    const call = toolsOf(await personOpens(DEFAULT_PROFILE_ID))
    const failing = vi.spyOn(store, 'recordGive').mockImplementation(() => {
      throw new Error('SQLITE_FULL: database or disk is full')
    })
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const answered = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'build the thing',
      }),
    )
    expect(answered).toMatchObject({ outcome: 'ok', delivery: 'sent' })
    const worker = answered.agent as string
    const turns = eventsOf(worker).filter((event) => event.type === 'user_turn')
    expect(JSON.stringify(turns)).toContain('build the thing')
    expect(labelsIn(worker)).toEqual([])
    expect(warned.mock.calls.flat().join(' ')).toContain('no piece was written')

    failing.mockRestore()
    const control = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'sibling',
        title: 'x',
        brief: 'build it',
      }),
    )
    expect(control).toMatchObject({ outcome: 'ok', delivery: 'sent' })
    expect(labelsIn(control.agent as string)).toEqual(['W3.2'])
  })

  it('§7 held branch: a brief the mailbox will flush is not reported as unqueued', async () => {
    await bringIdentityIntoBeing('sibling')
    const { call, receiver: control, piece } = await aCallerAndAParkingReceiver()
    const worker = await aParkingChildOf(call, 'sibling')
    for (const [id, named] of [
      [control, piece],
      [worker.agent, worker.piece],
    ] as const) {
      expect(
        payload(
          await call('message_agent', {
            agent: id,
            text: 'what are you on',
            kind: 'follow-up',
            piece: named,
          }),
        ),
      ).toMatchObject({ outcome: 'ok', delivery: 'sent' })
      await until(async () => {
        const state = await stateOf(call, id)
        return state !== undefined && state !== 'idle'
      }, 'the receiver to be busy with the follow-up')
    }
    expect(
      payload(
        await call('give_work', {
          profile: 'worker',
          title: 'x',
          brief: 'and then this',
          definition_of_done: 'The requested result and its checks are recorded.',
        }),
      ),
    ).toMatchObject({ outcome: 'ok', delivery: 'held', agent: control })
    expect(labelsIn(control)).toEqual(['W3.1', 'W3.3'])

    vi.spyOn(store, 'recordGive').mockImplementation(() => {
      throw new Error('SQLITE_READONLY: attempt to write a readonly database')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const answered = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'sibling',
        title: 'x',
        brief: 'and then this',
      }),
    )
    expect(answered).toMatchObject({ outcome: 'ok', delivery: 'held', agent: worker.agent })
    expect(eventsOf(worker.agent).filter((event) => event.type === 'message_queued')).toHaveLength(
      1,
    )
    expect(labelsIn(worker.agent)).toEqual(['W3.2'])
  })

  it('a note to an agent whose provider is slow to prepare its turn is held and delivered, never refused', async () => {
    HeldSendRuntime.unattended = true
    const { call, sibling } = await aParentWithASibling()
    let lastSeen: unknown
    await until(async () => {
      lastSeen = (await cardsOf(call)).find((card) => card.agent === sibling)?.state
      return lastSeen !== undefined && lastSeen !== 'active'
    }, 'the sibling to finish its first turn').catch((error: unknown) => {
      throw new Error(`${String(error)}; its card last read ${JSON.stringify(lastSeen)}`)
    })
    let release = (): void => {}
    HeldSendRuntime.held = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      const noting = call('message_agent', {
        agent: sibling,
        text: 'a note while its provider prepares',
        kind: 'note',
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      const settled = await Promise.race([
        noting.then((answer) => payload(answer)),
        new Promise((resolve) => setTimeout(() => resolve('still pending'), 0)),
      ])
      if (settled !== 'still pending')
        expect((settled as Record<string, unknown>).outcome).not.toBe('refused')
      expect(
        HeldSendRuntime.sent.some((text) => text.includes('a note while its provider prepares')),
      ).toBe(false)
      release()
      expect(payload(await noting).outcome).not.toBe('refused')
      await until(
        () =>
          HeldSendRuntime.sent.some((text) => text.includes('a note while its provider prepares')),
        'the note to reach the provider',
      )
    } finally {
      release()
      HeldSendRuntime.held = null
      HeldSendRuntime.unattended = false
    }
  })
})
