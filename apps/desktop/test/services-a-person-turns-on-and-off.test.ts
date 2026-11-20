import { DEFAULT_CONVERSATION_PROVIDER } from '@brobot2/shared'
import type { SessionStore } from '../src/main/db/session-store'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { composeProfileBundle } from '../src/main/runtime/factory-text'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { GiveOutcome, RuntimeHost } from '../src/main/runtime/runtime-host'
import { createAgentStore } from '../src/renderer/src/lib/agent-store'
import { theMessagesOf, type AgentIdentity, type RuntimeBridge } from '../src/shared/runtime-ipc'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

type Given = Extract<GiveOutcome, { ok: true }>

describe('Service lifecycle', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    world.turnsWait = null
    await world.cleanUp()
  })

  const accepted = (outcome: GiveOutcome): Given => {
    if (!outcome.ok) throw new Error(`refused (${outcome.refusal.rail}): ${outcome.refusal.reason}`)
    return outcome
  }
  const call = async (
    host: RuntimeHost,
    conversation: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = agentToolsFor(host, conversation).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }
  const stateOf = (service: string, piece: string): string | undefined =>
    world.store.piecesOwnedBy(service).find((one) => one.piece === piece)?.state
  const rows = (conversation: string, type: TranscriptEvent['type']): TranscriptEvent[] =>
    world.ledger(conversation).filter((row) => row.type === type)
  const aGate = (): { readonly held: Promise<void>; readonly release: () => void } => {
    let release = (): void => {}
    const held = new Promise<void>((done) => {
      release = done
    })
    return { held, release }
  }
  describe('the window’s doors', () => {
    it('makes a service through the window with the old switch saved as off', async () => {
      const host = world.aHost({ retiredServicesOff: true })
      const made = (await executeRuntimeCommand(host, world.window, {
        kind: 'createAgent',
        slug: 'browser-driver',
        displayName: null,
        provider: 'claude',
        asAService: true,
      })) as AgentIdentity
      expect(world.kept(made.id)).toMatchObject({ kind: 'service' })
      expect(host.agentIdentities().services).toEqual(['browser-driver'])
    })

    it('puts the Service choice on the wire from the window’s store', async () => {
      const created: unknown[] = []
      const bridge = {
        createAgent: async (input: unknown) => {
          structuredClone(input)
          created.push(input)
          return { slug: (input as { slug: string }).slug }
        },
        agentIdentities: async () => {
          throw new Error('not read here')
        },
      } as unknown as RuntimeBridge
      await createAgentStore(bridge).create({
        slug: 'fetcher',
        displayName: null,
        provider: 'claude',
        asAService: true,
      })
      expect(created).toEqual([
        { slug: 'fetcher', displayName: null, provider: 'claude', asAService: true },
      ])
    })
  })

  describe('making a service', () => {
    it('makes a service at both doors and lists it as a service', async () => {
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const caller = await world.aPersonOpens(host, 'caller')
      const byAPerson = host.createAgent({
        slug: 'browser-driver',
        displayName: null,
        provider: 'claude',
        asAService: true,
      })
      expect(world.kept(byAPerson.id)).toMatchObject({ kind: 'service' })
      const personConversation = world.kept(byAPerson.id)?.serviceConversation
      expect(personConversation).toBeTypeOf('string')
      expect(world.store.recordedOne(personConversation!)?.provider).toBe('claude')
      expect(world.store.parentOf(personConversation!)).toBeNull()
      expect(world.store.rootOf(personConversation!)).toBeNull()
      expect(world.store.piecesOwnedBy(personConversation!)).toEqual([])
      expect(host.agentCard(personConversation!, world.window, null)?.agent).toBe(
        personConversation,
      )
      const made = await call(host, caller, 'create_agent', {
        profile_slug: 'fetcher',
        kind: 'service',
        model: 'fake-claude-a',
        effort: 'high',
      })
      expect(made.structured).toMatchObject({ outcome: 'ok' })
      const fetcher = world.store.agentIdentities().find((one) => one.slug === 'fetcher')
      if (fetcher === undefined) throw new Error('fetcher was not made')
      expect(world.kept(fetcher.id)).toMatchObject({ kind: 'service' })
      const toolConversation = world.kept(fetcher.id)?.serviceConversation
      expect(toolConversation).toBeTypeOf('string')
      expect(made.structured['conversation']).toBe(toolConversation)
      expect(world.store.recordedOne(toolConversation!)?.provider).toBe('claude')
      expect(world.store.findLive(toolConversation!)).toMatchObject({
        model: 'fake-claude-a',
        reasoningEffort: 'high',
      })
      expect(made.text).toContain(toolConversation!)
      expect(world.store.parentOf(toolConversation!)).toBeNull()
      expect(world.store.rootOf(toolConversation!)).toBeNull()
      expect(world.startedAs).toEqual(['caller'])
      const before = world.conversationsRecorded()
      const given = accepted(await world.gives(host, caller, 'fetcher'))
      expect(given.owner).toBe(toolConversation)
      expect(world.conversationsRecorded()).toBe(before)
      // A normal agent made beside them is not one.
      const normal = await call(host, caller, 'create_agent', { profile_slug: 'writer' })
      expect(normal.structured).toMatchObject({ outcome: 'ok' })
      expect(normal.structured).not.toHaveProperty('conversation')
      expect(normal.text).toContain('It is not running and has been sent nothing.')
      expect(host.agentIdentities().services).toEqual(['browser-driver', 'fetcher'])
      const listed = await call(host, caller, 'list_profiles', {})
      const profiles = listed.structured['profiles'] as { profile: string; kind?: string }[]
      expect(profiles.find((one) => one.profile === 'fetcher')?.kind).toBe('service')
      expect(profiles.find((one) => one.profile === 'writer')?.kind).toBeUndefined()
      expect(listed.text).toContain('fetcher')
      expect(listed.text).toContain(' · a service')
    })
  })

  describe('recording the service before any request', () => {
    it.each(['address', 'profile'] as const)(
      'answers an Ask by %s before its first Give',
      async (by) => {
        world.anAgent('caller', 'nothing kept')
        world.store.setDefaultApprovalMode('auto')
        const host = world.aHost()
        const caller = await world.aPersonOpens(host, 'caller')
        const created = host.createAgent({
          slug: 'fetcher',
          displayName: null,
          provider: 'claude',
          asAService: true,
        })
        const service = world.kept(created.id)?.serviceConversation
        if (service === undefined) throw new Error('the service has no conversation')
        const before = world.conversationsRecorded()
        const asked = await call(host, caller, 'ask_question', {
          who_answers: 'an-agent',
          agent: by === 'address' ? service : 'fetcher',
          question: 'which floor?',
        })
        expect(asked.structured).toMatchObject({ outcome: 'ok', agent: service })
        expect(world.store.routedRequestsOf(caller)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ requestId: asked.structured.question, parent: service }),
          ]),
        )
        await vi.waitFor(() =>
          expect(
            world.sent.some((turn) => turn.as === 'fetcher' && turn.words.includes('which floor?')),
          ).toBe(true),
        )
        const answered = await call(host, service, 'answer_question', {
          question: asked.structured.question,
          asked_by: caller,
          answers: [{ part: 'answer', answer: ['the third'] }],
          interrupt: false,
        })
        expect(answered.structured).toMatchObject({ outcome: 'ok' })
        expect(world.store.routedRequestsOf(caller)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ requestId: asked.structured.question, state: 'answered' }),
          ]),
        )
        expect(world.conversationsRecorded()).toBe(before)
        expect(world.store.piecesOwnedBy(service)).toEqual([])
        expect(world.store.parentOf(service)).toBeNull()
        expect(world.store.rootOf(service)).toBeNull()
        expect(world.startedAs).toEqual(['caller', 'fetcher'])
        expect(host.questionDestination('caller')).toBeNull()
        expect(host.messageDestination('fetcher')).toBeNull()
      },
    )

    it.each(['writeOwnInstructions', 'setModelChoice'] as const)(
      'keeps a failed %s setup unaddressable and lets creation retry',
      async (method) => {
        world.anAgent('caller', 'nothing kept')
        let fails = true
        const store = new Proxy(world.store, {
          get(target, key) {
            if (key === method && fails)
              return () => {
                throw new Error('setup write failed')
              }
            const value: unknown = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        const host = world.aHost({ store })
        const caller = await world.aPersonOpens(host, 'caller')
        const before = world.conversationsRecorded()
        const args = {
          profile_slug: 'fetcher',
          kind: 'service',
          rules: 'Use the existing queue.',
          model: 'fake-claude-a',
          effort: 'high',
        }
        await expect(call(host, caller, 'create_agent', args)).rejects.toThrow('setup write failed')
        expect(host.questionDestination('fetcher')).toBeNull()
        expect(world.store.agentIdentities().some((one) => one.slug === 'fetcher')).toBe(false)
        expect(world.conversationsRecorded()).toBe(before)
        expect(world.startedAs).toEqual(['caller'])
        fails = false
        const retry = await call(host, caller, 'create_agent', args)
        expect(retry.structured).toMatchObject({ outcome: 'ok', conversation: expect.any(String) })
        expect(world.conversationsRecorded()).toBe(before + 1)
        expect(world.store.ownInstructionsOf('fetcher').versions).toHaveLength(1)
        expect(world.store.modelChoiceOf('fetcher')).toMatchObject({
          model: 'fake-claude-a',
          effort: 'high',
        })
      },
    )

    it('keeps its saved settings when defaults change before its first Ask', async () => {
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const caller = await world.aPersonOpens(host, 'caller')
      const made = await call(host, caller, 'create_agent', {
        profile_slug: 'fetcher',
        kind: 'service',
        model: 'fake-claude-a',
        effort: 'high',
      })
      const service = String(made.structured.conversation)
      expect(
        world.store.setModelChoice('fetcher', {
          provider: 'claude',
          model: 'fake-claude-b',
          effort: null,
        }),
      ).toBe(true)
      host.setDefaultApprovalMode('auto')
      const asked = await call(host, caller, 'ask_question', {
        who_answers: 'an-agent',
        agent: 'fetcher',
        question: 'which floor?',
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok', agent: service })
      await vi.waitFor(() =>
        expect(world.sent).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ as: 'fetcher', model: 'fake-claude-a', effort: 'high' }),
          ]),
        ),
      )
      expect(world.store.findLive(service)).toMatchObject({
        model: 'fake-claude-a',
        reasoningEffort: 'high',
        approvalMode: 'ask',
      })
      const status = await call(host, caller, 'get_agent_status', { agent: service })
      expect(status.structured.agent).toMatchObject({
        provider: 'claude',
        runsOn: { selected: { model: 'fake-claude-a', effort: 'high' } },
      })
    })

    it('records the existing launch fallback when a person leaves its provider unset', () => {
      const host = world.aHost()
      const created = host.createAgent({
        slug: 'fetcher',
        displayName: null,
        provider: null,
        asAService: true,
      })
      const conversation = world.kept(created.id)?.serviceConversation
      expect(conversation).toBeTypeOf('string')
      expect(world.store.recordedOne(conversation!)?.provider).toBe(DEFAULT_CONVERSATION_PROVIDER)
      expect(host.agentCard(conversation!, world.window, null)?.provider).toBe(
        DEFAULT_CONVERSATION_PROVIDER,
      )
      expect(world.startedAs).toEqual([])
    })

    it('removes the new identity if its conversation reservation cannot be kept', () => {
      const host = world.aHost()
      world.writesFail = 'reserved'
      expect(() =>
        host.createAgent({
          slug: 'fetcher',
          displayName: null,
          provider: 'claude',
          asAService: true,
        }),
      ).toThrow('the disk is full')
      expect(world.store.agentIdentities().some((one) => one.slug === 'fetcher')).toBe(false)
      expect(world.conversationsRecorded()).toBe(0)
      expect(world.startedAs).toEqual([])
    })

    it('removes the identity after its service conversation row fails to record', () => {
      const store = new Proxy(world.store, {
        get(target, key) {
          if (key === 'create') {
            return (record: Parameters<SessionStore['create']>[0]) => {
              if (record.service === true) throw new Error('service row failed')
              return target.create(record)
            }
          }
          const value: unknown = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const host = world.aHost({ store })
      expect(() =>
        host.createAgent({
          slug: 'fetcher',
          displayName: null,
          provider: 'claude',
          asAService: true,
        }),
      ).toThrow('service row failed')
      expect(world.store.agentIdentities().some((one) => one.slug === 'fetcher')).toBe(false)
      expect(world.conversationsRecorded()).toBe(0)
      expect(world.startedAs).toEqual([])
    })

    it('recovers the same recorded conversation after the final binding write fails', async () => {
      const host = world.aHost()
      world.writesFail = 'serviceConversation'
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const created = host.createAgent({
        slug: 'fetcher',
        displayName: null,
        provider: 'claude',
        asAService: true,
      })
      const conversation = world.store
        .servicesBorn()
        .find((one) => one.identity === created.id)?.conversation
      expect(conversation).toBeTypeOf('string')
      expect(world.kept(created.id)?.reserved).toBe(conversation)
      world.writesFail = 'none'
      await host.closeAll()
      const next = world.aHost()
      expect(world.kept(created.id)?.serviceConversation).toBe(conversation)
      expect(next.profileKindOf('fetcher')).toBe('service')
      expect(world.conversationsRecorded()).toBe(1)
      expect(world.startedAs).toEqual([])
      warning.mockRestore()
    })
  })

  /** A service on `caller`'s piece, its turn held working, and `other`'s piece queued behind it. */
  const aServiceWithWorkQueued = async (): Promise<{
    host: RuntimeHost
    caller: string
    other: string
    service: string
    one: Given
    two: Given
    releaseTheTurn: () => void
  }> => {
    world.anAgent('browser-driver')
    world.anAgent('caller', 'nothing kept')
    world.anAgent('other-caller', 'nothing kept')
    world.store.setDefaultApprovalMode('auto')
    const host = world.aHost()
    const caller = await world.aPersonOpens(host, 'caller')
    const other = await world.aPersonOpens(host, 'other-caller')
    const turn = aGate()
    world.turnsWait = turn.held
    const one = accepted(await world.gives(host, caller, 'browser-driver', { title: 'One' }))
    const two = accepted(await world.gives(host, other, 'browser-driver', { title: 'Two' }))
    const service = one.owner
    await vi.waitFor(() => {
      expect(rows(service, 'user_turn')).toHaveLength(1)
    })
    return {
      host,
      caller,
      other,
      service,
      one,
      two,
      releaseTheTurn: () => {
        world.turnsWait = null
        turn.release()
      },
    }
  }

  describe('Queued work and delivery', () => {
    it('refuses a Give before recording work when the service queue is not owned', async () => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost({ owned: false })
      const caller = await world.aPersonOpens(host, 'caller')
      const recorded = world.conversationsRecorded()
      const started = [...world.startedAs]
      const said = await call(host, caller, 'give_work', {
        profile: 'browser-driver',
        title: 'A piece',
        brief: 'a piece',
        definition_of_done: 'The requested result and its checks are recorded.',
      })
      expect(said.structured, said.text).toMatchObject({
        outcome: 'refused',
        rail: 'service-queue-not-owned',
        reason:
          'Not sent: this app may be open twice. Ask the person with request_action to close any other BroCrew instance using this workspace and reopen this one, or give the work to another agent.',
      })
      expect(said.structured).not.toHaveProperty('receipt')
      expect(said.text.match(/Not sent:/gu)).toHaveLength(1)
      expect(world.store.piecesGivenBy(caller)).toEqual([])
      expect(world.conversationsRecorded()).toBe(recorded)
      expect(world.startedAs).toEqual(started)
    })

    it('hands the next piece over after the current one is withdrawn', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceWithWorkQueued()
      expect(stateOf(service, two.piece)).toBe('waiting')
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
      expect(world.stopsAsked).toEqual([])
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(
          rows(service, 'user_turn').filter(
            (turn) => turn.type === 'user_turn' && turn.piece === two.piece,
          ),
        ).toHaveLength(1)
      })
    })

    it('names a service by its agent in a question it asks its caller, never by the piece', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceWithWorkQueued()
      const asked = await call(host, service, 'ask_question', {
        piece: one.label,
        question: 'which floor?',
        who_answers: 'the-parent',
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok' })
      const told = (): string | undefined =>
        world
          .ledger(caller)
          .flatMap((row) =>
            row.type === 'user_turn' || row.type === 'message_queued' ? [row.text] : [],
          )
          .find((text) => text.includes('which floor?'))
      await vi.waitFor(() => {
        expect(told()).toBeDefined()
      })
      expect(told()).toContain(
        `${host.whatToCallTheConversation(service)} (conversation ${service} · Ada) asks you ${asked.structured?.question}`,
      )
      expect(told()).toContain(`Use asked_by ${service} with this question id.`)
      expect(told()).toContain(`About task ${one.label} · One.`)
      expect(told()).not.toContain(`the owner of ${one.label}`)
      // Its caller waits on it by its agent's name too, never by the caller's own piece it holds.
      const waits = host
        .whatEachConversationIsWaitingOn()
        .conversations.find((row) => row.conversation === caller)
      expect(waits?.waitingOnTheWorkOf).toEqual([host.whatToCallTheConversation(service)])
      releaseTheTurn()
    })

    it('lets a caller stop the active service turn while its piece is queued', async () => {
      const { host, other, service, releaseTheTurn } = await aServiceWithWorkQueued()
      const stopped = await call(host, other, 'interrupt_agent', {
        agent: service,
        reason: 'not needed now',
      })
      expect(stopped.structured).toMatchObject({ outcome: 'ok', asked: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      releaseTheTurn()
    })

    /** The service stopped on `caller`'s piece, after a restart. */
    const aStoppedService = async (
      deferred = false,
    ): Promise<{
      after: RuntimeHost
      caller: string
      service: string
      one: Given
      two: Given
    }> => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceWithWorkQueued()
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
      await host.closeAll()
      const after = world.aHost({ retiredServicesOff: true, deferStartupUntilListPaint: deferred })
      if (deferred) after.firstListPainted()
      await after.resumeSession(caller, world.window)
      return { after, caller, service, one, two }
    }
    const wentIn = (service: string, text: string): boolean =>
      rows(service, 'user_turn').some(
        (turn) => turn.type === 'user_turn' && turn.text.includes(text),
      )
    it('delivers a follow-up to a stopped service with the old switch saved as off', async () => {
      const { after, caller, service, one } = await aStoppedService()
      const text = 'the room on the third floor'
      const sent = await call(after, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text,
      })
      expect(sent.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        const turn = rows(service, 'user_turn').find(
          (row) => row.type === 'user_turn' && row.text.includes(text),
        )
        expect(turn).toMatchObject({ relayedFrom: caller })
      })
    })

    /** An MCP server a person approved, granted to `agents`, as the approval's producer reads it. */
    const anApprovedServer = (agents: readonly string[]): unknown => {
      const row = world.store.registerExternalMcpServer({
        name: 'fictional-notes',
        url: 'http://127.0.0.1:9/fictional-notes',
        reach: 'restricted',
      })
      if (row === null) throw new Error('the fictional server could not be registered')
      world.store.grantExternalMcpServer('fictional-notes', agents)
      return row
    }
    /** This app telling `service` a person approved its request, as the decision's door does. */
    const itWasApproved = (host: RuntimeHost, service: string, row: unknown): boolean =>
      (
        host as unknown as {
          tellTheAskerItWasApproved(
            waiting: unknown,
            row: unknown,
            offered: readonly string[],
            granted: readonly string[] | null,
          ): boolean
        }
      ).tellTheAskerItWasApproved(
        { requested: { requestId: 'req_fictional' }, conversation: service },
        row,
        ['read_notes'],
        null,
      )
    const toldOfTheRequest = (service: string): boolean =>
      rows(service, 'user_turn').some(
        (turn) => turn.type === 'user_turn' && turn.text.includes('req_fictional'),
      )

    it('reopens a running service on the current sign-in with no window', async () => {
      world.signInsChecked = true
      const { host, caller, service, one, releaseTheTurn } = await aServiceWithWorkQueued()
      // Its sign-in reads as moved on from here, mid-turn, until this app reopens it.
      world.signInMovedFor = 'browser-driver'
      const sent = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(sent.structured).toMatchObject({ outcome: 'ok' })
      const lives = world.handles.length
      releaseTheTurn()
      // This app reopens it on the current sign-in, and what was held goes in.
      await vi.waitFor(() => {
        expect(wentIn(service, 'the room on the third floor')).toBe(true)
      })
      expect(world.handles.length).toBeGreaterThan(lives)
    })

    it('reopens a running service for an MCP server a person approved for it with no window', async () => {
      const { host, service, releaseTheTurn } = await aServiceWithWorkQueued()
      const lives = world.handles.length
      expect(itWasApproved(host, service, anApprovedServer(['browser-driver']))).toBe(true)
      // The reopen waits for its turn, then this app stops and starts it with the new tools.
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(toldOfTheRequest(service)).toBe(true)
      })
      expect(world.handles.length).toBeGreaterThan(lives)
    })

    it('delivers a take-back notice and advances the next piece after restart', async () => {
      const { after, caller, service, one, two } = await aStoppedService()
      expect(stateOf(service, two.piece)).toBe('waiting')
      const before = rows(service, 'user_turn').length
      const taken = await call(after, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      await vi.waitFor(() => {
        const delivered = rows(service, 'user_turn')
          .slice(before)
          .flatMap((row) => (row.type === 'user_turn' ? theMessagesOf(row) : []))
        const notice = delivered.findIndex(
          (message) =>
            message.appNotice === 'a-piece-taken-back' &&
            message.drives === one.piece &&
            message.text.includes(`took back ${one.label}`),
        )
        const handover = delivered.findIndex((message) => message.piece === two.piece)
        expect(notice).toBeGreaterThanOrEqual(0)
        expect(handover).toBeGreaterThan(notice)
      })
    })

    it('hands the next piece over when the take-back notice cannot start the service', async () => {
      const { after, caller, service, one, two } = await aStoppedService()
      expect(stateOf(service, two.piece)).toBe('waiting')
      world.failNextResumeFor = 'browser-driver'

      const taken = await call(after, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({
        outcome: 'ok',
        state: 'withdrawn',
        delivery: 'not-delivered',
      })
      expect(world.failNextResumeFor).toBeNull()
      await vi.waitFor(() => {
        expect(
          world.store.piecesOwnedBy(service).find((row) => row.piece === two.piece),
        ).toMatchObject({ briefHandedOver: true })
      })
    })

    it('delivers a caller’s answer to its stopped service after restart', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceWithWorkQueued()
      const asked = await call(host, service, 'ask_question', {
        piece: one.label,
        question: 'which floor?',
        who_answers: 'the-parent',
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok' })
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
      await host.closeAll()
      const after = world.aHost({ retiredServicesOff: true })
      await after.resumeSession(caller, world.window)
      const answered = await call(after, caller, 'answer_question', {
        question: String(asked.structured['question']),
        answers: [{ part: 'answer', answer: ['the third'] }],
      })
      expect(answered.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(wentIn(service, 'the third')).toBe(true)
      })
    })

    it('opens a stopped service when a person answers its question card', async () => {
      const { host, service, one, releaseTheTurn } = await aServiceWithWorkQueued()
      const asked = await call(host, service, 'ask_question', {
        piece: one.label,
        question: 'Which floor should the work cover?',
        who_answers: 'a-person',
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok', question: expect.any(String) })
      const question = String(asked.structured?.question)
      releaseTheTurn()
      await host.closeAll()
      const after = world.aHost({ retiredServicesOff: true })
      expect(after.sessionIds).not.toContain(service)

      await expect(
        after.respondUserInput(
          service,
          question,
          { kind: 'answer', answers: { answer: 'the third floor' } },
          world.window,
        ),
      ).resolves.toEqual({ outcome: 'taken' })
      await vi.waitFor(() => {
        expect(after.sessionIds).toContain(service)
        expect(
          world
            .ledger(service)
            .flatMap((event) => (event.type === 'user_turn' ? theMessagesOf(event) : []))
            .filter((part) => part.answeredQuestion?.requestId === question),
        ).toEqual([
          expect.objectContaining({
            appNotice: 'an-answer-to-a-question',
            text: expect.stringContaining('the third floor'),
          }),
        ])
      })
      expect(after.agentIdentities()).not.toHaveProperty('servicesOn')
      expect(
        world
          .ledger(service)
          .filter((event) => event.type === 'user_decision' && event.requestId === question),
      ).toHaveLength(1)
    })

    it.each([false, true])(
      'delivers a new brief to a stopped service after restart (deferred %s)',
      async (deferred) => {
        const { after, caller, service, one } = await aStoppedService(deferred)
        const brief = 'Look at the second floor instead.'
        const updated = await call(after, caller, 'update_work', { piece: one.label, brief })
        expect(updated.structured).toMatchObject({ outcome: 'ok' })
        await vi.waitFor(() => {
          expect(wentIn(service, brief)).toBe(true)
        })
        const turn = rows(service, 'user_turn').find(
          (row) => row.type === 'user_turn' && row.text.includes(brief),
        )
        expect(turn).toMatchObject({ piece: one.piece })
      },
    )
  })

  describe('what is shown of a service', () => {
    it('names it by its conversation id and agent name while it holds callers’ tasks', async () => {
      const { host, service, one, two, releaseTheTurn } = await aServiceWithWorkQueued()
      const named = host.nameByItsWork(service)
      expect(named).toBe(`conversation ${service} · ${host.whatToCallTheConversation(service)}`)
      expect(named).not.toContain(one.label)
      expect(named).not.toContain(two.label)
      expect(host.addressOf(service)).toBe(service)
      releaseTheTurn()
    })

    it('marks the piece a person may take back', async () => {
      const { host, caller, one, releaseTheTurn } = await aServiceWithWorkQueued()
      const marked = (): boolean | undefined =>
        host.whoCalledWhom(caller).workGivenOut.rows.find((edge) => edge.piece === one.piece)
          ?.aPersonMayTakeItBack
      expect(marked()).toBe(true)
      releaseTheTurn()
    })

    it('gives the service text to a service and no other agent', async () => {
      world.anAgent('browser-driver')
      world.anAgent('writer', 'nothing kept')
      const host = world.aHost()
      const reader = host as unknown as {
        instructionContext(
          profileId: string | null,
          cwd: string,
          parentSessionId: string | null,
          conversation: string | null,
        ): Parameters<typeof composeProfileBundle>[0]
      }
      const service = reader.instructionContext('browser-driver', world.folder, null, null)
      const writer = reader.instructionContext('writer', world.folder, null, null)
      expect(composeProfileBundle(service)).toContain(
        'You serve many callers through one conversation',
      )
      expect(composeProfileBundle(writer)).not.toContain('You serve many callers')
    })
  })
})
