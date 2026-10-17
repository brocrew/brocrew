import { writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { composeProfileBundle } from '../src/main/runtime/factory-text'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import {
  PROFILE_EXECUTION_VERSION,
  profileExecutionFile,
  readProfileExecution,
} from '../src/main/profile-execution-file'
import type { GiveOutcome, RuntimeHost } from '../src/main/runtime/runtime-host'
import { createAgentStore } from '../src/renderer/src/lib/agent-store'
import type { AgentIdentity, RuntimeBridge, TranscriptEvent } from '../src/shared/runtime-ipc'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

type Given = Extract<GiveOutcome, { ok: true }>

/**
 * Services run only while a person has turned them on in the workspace. Off by default; off holds
 * back new work for services and stops nothing that exists.
 */
describe('services a person turns on and off', () => {
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
  const switchedOn = (): boolean =>
    (() => {
      const read = readProfileExecution(profileExecutionFile(world.folder))
      return !read.readable || read.kept.servicesOff !== true
    })()

  describe('the switch', () => {
    it('is on until a person turns it off, and is kept in the services list', () => {
      const host = world.aHost()
      expect(host.agentIdentities().servicesOn).toBe(true)
      expect(switchedOn()).toBe(true)
      expect(host.setServicesOn(false)).toEqual({ servicesOn: false })
      expect(switchedOn()).toBe(false)
      expect(host.agentIdentities().servicesOn).toBeUndefined()
      expect(host.setServicesOn(true)).toEqual({ servicesOn: true })
      expect(switchedOn()).toBe(true)
      expect(host.agentIdentities().servicesOn).toBe(true)
    })

    it('is on where the services list can’t be read, and the launch logs why', () => {
      writeFileSync(profileExecutionFile(world.folder), 'not a list')
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const host = world.aHost()
      expect(host.agentIdentities().servicesOn).toBe(true)
      expect(warned).toHaveBeenCalledWith(
        expect.stringContaining('runtime host could not read how its profiles run their work'),
      )
      warned.mockRestore()
    })

    it('is changed only by the one app running on the data', () => {
      const host = world.aHost({ owned: false, servicesOn: false })
      expect(() => host.setServicesOn(true)).toThrow('Not changed: the app may be open twice.')
      expect(switchedOn()).toBe(false)
    })

    it('reads a switch written false as on, as a missing one', () => {
      const file = profileExecutionFile(world.folder)
      writeFileSync(
        file,
        JSON.stringify({ version: PROFILE_EXECUTION_VERSION, servicesOff: false, profiles: {} }),
      )
      expect(readProfileExecution(file)).toEqual({ readable: true, kept: { profiles: {} } })
    })
  })

  describe('the window’s doors', () => {
    it('turns services on and makes a service through the window’s commands', async () => {
      const host = world.aHost({ servicesOn: false })
      expect(
        await executeRuntimeCommand(host, world.window, { kind: 'setServicesOn', on: true }),
      ).toEqual({ servicesOn: true })
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
    it('is refused at both doors while services are off, and makes nothing', async () => {
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost({ servicesOn: false })
      const caller = await world.aPersonOpens(host, 'caller')
      expect(() =>
        host.createAgent({
          slug: 'browser-driver',
          displayName: null,
          provider: 'claude',
          asAService: true,
        }),
      ).toThrow('Not created: services are off.')
      const made = await call(host, caller, 'create_agent', {
        profile_slug: 'fetcher',
        kind: 'service',
      })
      expect(made.structured).toMatchObject({
        outcome: 'refused',
        rail: 'services-are-off-so-none-is-made',
      })
      expect(made.text).toContain('Not created: services are off. A person turns them on in Team.')
      const slugs = world.store.agentIdentities().map((one) => one.slug)
      expect(slugs).not.toContain('browser-driver')
      expect(slugs).not.toContain('fetcher')
    })

    it('makes a service at both doors while services are on, and says it is one', async () => {
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost({ servicesOn: true })
      const caller = await world.aPersonOpens(host, 'caller')
      const byAPerson = host.createAgent({
        slug: 'browser-driver',
        displayName: null,
        provider: 'claude',
        asAService: true,
      })
      expect(world.kept(byAPerson.id)).toMatchObject({ kind: 'service' })
      const made = await call(host, caller, 'create_agent', {
        profile_slug: 'fetcher',
        kind: 'service',
      })
      expect(made.structured).toMatchObject({ outcome: 'ok' })
      const fetcher = world.store.agentIdentities().find((one) => one.slug === 'fetcher')
      if (fetcher === undefined) throw new Error('fetcher was not made')
      expect(world.kept(fetcher.id)).toMatchObject({ kind: 'service' })
      // A normal agent made beside them is not one.
      const normal = await call(host, caller, 'create_agent', { profile_slug: 'writer' })
      expect(normal.structured).toMatchObject({ outcome: 'ok' })
      expect(host.agentIdentities().services).toEqual(['browser-driver', 'fetcher'])
      const listed = await call(host, caller, 'list_profiles', {})
      const profiles = listed.structured['profiles'] as { profile: string; kind?: string }[]
      expect(profiles.find((one) => one.profile === 'fetcher')?.kind).toBe('service')
      expect(profiles.find((one) => one.profile === 'writer')?.kind).toBeUndefined()
      expect(listed.text).toContain('fetcher')
      expect(listed.text).toContain(' · a service')
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
    const host = world.aHost({ servicesOn: true })
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

  describe('turning services off with work queued', () => {
    it('stops nothing, hands nothing more over, and the next piece goes once they are on again', async () => {
      const { host, caller, other, service, one, two, releaseTheTurn } =
        await aServiceWithWorkQueued()
      host.setServicesOn(false)
      // The turn running finishes; nothing was asked to stop.
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
      expect(world.stopsAsked).toEqual([])
      // The caller takes its piece back: the service's own rules still hold.
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok' })
      await new Promise((settled) => setTimeout(settled, 100))
      // Its notice of the take-back goes in, as at any service; the next piece's brief does not.
      expect(stateOf(service, two.piece)).toBe('waiting')
      expect(
        rows(service, 'user_turn').some(
          (turn) => turn.type === 'user_turn' && turn.piece === two.piece,
        ),
      ).toBe(false)
      // Its caller reads why it waits.
      const board = await call(host, other, 'list_tasks', {})
      expect(board.text).toContain('queued; it waits until services are on')
      // A new give to the service is refused while off.
      const refused = await world.gives(host, caller, 'browser-driver', { title: 'Three' })
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.refusal.rail).toBe('services-are-off')
      // On again: the next piece is handed over.
      host.setServicesOn(true)
      await vi.waitFor(() => {
        expect(stateOf(service, two.piece)).not.toBe('waiting')
      })
    })

    const handedOver = (service: string, piece: string): boolean =>
      rows(service, 'user_turn').some((turn) => turn.type === 'user_turn' && turn.piece === piece)

    it('hands nothing over when services go off in the tick they came on', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceWithWorkQueued()
      host.setServicesOn(false)
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await new Promise((settled) => setTimeout(settled, 100))
      // On asks the dispatcher to look, in a microtask; off comes before it looks.
      host.setServicesOn(true)
      host.setServicesOn(false)
      await new Promise((settled) => setTimeout(settled, 150))
      expect(stateOf(service, two.piece)).toBe('waiting')
      expect(handedOver(service, two.piece)).toBe(false)
      // Its brief was not even placed: no row holds it for the service.
      expect(
        rows(service, 'message_queued').some(
          (row) => row.type === 'message_queued' && row.piece === two.piece,
        ),
      ).toBe(false)
    })

    it('holds a next brief whose handover was under way when services went off, and sends it once they are on', async () => {
      world.signInsChecked = true
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      world.store.setDefaultApprovalMode('auto')
      const host = world.aHost({ servicesOn: true })
      const caller = await world.aPersonOpens(host, 'caller')
      const signIn = aGate()
      world.signInWait = signIn.held
      const giving = world.gives(host, caller, 'browser-driver', { title: 'One' })
      await new Promise((settled) => setTimeout(settled, 100))
      host.setServicesOn(false)
      world.signInWait = null
      signIn.release()
      const one = accepted(await giving)
      await new Promise((settled) => setTimeout(settled, 150))
      expect(handedOver(one.owner, one.piece)).toBe(false)
      expect(stateOf(one.owner, one.piece)).toBe('waiting')
      host.setServicesOn(true)
      await vi.waitFor(() => {
        expect(handedOver(one.owner, one.piece)).toBe(true)
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
      expect(told()).toContain(`${host.whatToCallTheConversation(service)} (a service)`)
      expect(told()).not.toContain(`the owner of ${one.label}`)
      // Its caller waits on it by its agent's name too, never by the caller's own piece it holds.
      const waits = host
        .whatEachConversationIsWaitingOn()
        .conversations.find((row) => row.conversation === caller)
      expect(waits?.waitingOnTheWorkOf).toEqual([host.whatToCallTheConversation(service)])
      releaseTheTurn()
    })

    it('keeps a caller’s reach to the service bound to its own piece while off', async () => {
      const { host, other, service, releaseTheTurn } = await aServiceWithWorkQueued()
      host.setServicesOn(false)
      const stopped = await call(host, other, 'interrupt_agent', {
        agent: service,
        reason: 'not needed now',
      })
      expect(stopped.structured).toMatchObject({
        outcome: 'refused',
        rail: 'that-service-is-on-another-callers-piece',
      })
      expect(world.stopsAsked).toEqual([])
      releaseTheTurn()
    })

    /** The service stopped on `caller`'s piece, in a new run with services off. */
    const aStoppedServiceWhileOff = async (): Promise<{
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
      const after = world.aHost({ servicesOn: false })
      await after.resumeSession(caller, world.window)
      return { after, caller, service, one, two }
    }
    const wentIn = (service: string, text: string): boolean =>
      rows(service, 'user_turn').some(
        (turn) => turn.type === 'user_turn' && turn.text.includes(text),
      )
    const sendsWhileOff = async (
      after: RuntimeHost,
      caller: string,
      service: string,
      one: Given,
    ): Promise<void> => {
      const sent = await call(after, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(sent.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      expect(sent.text).toContain('It waits until services are on.')
      await new Promise((settled) => setTimeout(settled, 100))
      expect(wentIn(service, 'the room on the third floor')).toBe(false)
      const held = rows(service, 'message_queued').find(
        (row) => row.type === 'message_queued' && row.text === 'the room on the third floor',
      )
      expect(held).toMatchObject({ relayedFrom: caller, says: 'follow-up', about: one.piece })
    }

    it('keeps a caller’s words to a stopped service for its next start, which turning services on makes', async () => {
      const { after, caller, service, one } = await aStoppedServiceWhileOff()
      await sendsWhileOff(after, caller, service, one)
      expect(after.agentIdentities().servicesOn).toBeUndefined()
      after.setServicesOn(true)
      await vi.waitFor(() => {
        expect(wentIn(service, 'the room on the third floor')).toBe(true)
      })
      const turn = rows(service, 'user_turn').find(
        (row) => row.type === 'user_turn' && row.text.includes('the room on the third floor'),
      )
      expect(turn).toMatchObject({ relayedFrom: caller })
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

    it('reopens a running service on the current sign-in while off, with no window', async () => {
      world.signInsChecked = true
      const { host, caller, service, one, releaseTheTurn } = await aServiceWithWorkQueued()
      host.setServicesOn(false)
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
      expect(host.agentIdentities().servicesOn).toBeUndefined()
    })

    it('reopens a running service for an MCP server a person approved for it while off, with no window', async () => {
      const { host, service, releaseTheTurn } = await aServiceWithWorkQueued()
      host.setServicesOn(false)
      const lives = world.handles.length
      expect(itWasApproved(host, service, anApprovedServer(['browser-driver']))).toBe(true)
      // The reopen waits for its turn, then this app stops and starts it with the new tools.
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(toldOfTheRequest(service)).toBe(true)
      })
      expect(world.handles.length).toBeGreaterThan(lives)
      expect(host.agentIdentities().servicesOn).toBeUndefined()
    })

    it('starts no stopped service while off for an approval, one that does not reach it, or a refusal', async () => {
      world.anAgent('writer', 'nothing kept')
      const { after, service } = await aStoppedServiceWhileOff()
      const approval = anApprovedServer(['writer'])
      // Approved for another agent: this one is only told.
      expect(itWasApproved(after, service, approval)).toBe(true)
      // Refused: told the same way.
      ;(
        after as unknown as { tellTheAsker(conversation: string, text: string): boolean }
      ).tellTheAsker(service, 'Your MCP server request req_fictional was refused.')
      await new Promise((settled) => setTimeout(settled, 150))
      expect(toldOfTheRequest(service)).toBe(false)
      // On: the words go in at its next start.
      after.setServicesOn(true)
      await vi.waitFor(() => {
        expect(toldOfTheRequest(service)).toBe(true)
      })
    })

    it('starts no stopped service while off when a person approves a server for it: there is no reopen', async () => {
      const { after, service } = await aStoppedServiceWhileOff()
      expect(itWasApproved(after, service, anApprovedServer(['browser-driver']))).toBe(true)
      await new Promise((settled) => setTimeout(settled, 150))
      expect(toldOfTheRequest(service)).toBe(false)
    })

    it('lets a person open a stopped service while off, and what waited for its start goes in', async () => {
      const { after, caller, service, one } = await aStoppedServiceWhileOff()
      await sendsWhileOff(after, caller, service, one)
      await after.resumeSession(service, world.window)
      await vi.waitFor(() => {
        expect(wentIn(service, 'the room on the third floor')).toBe(true)
      })
      expect(after.agentIdentities().servicesOn).toBeUndefined()
    })

    it('keeps the notice of a take-back for a stopped service while off, and its caller reads why', async () => {
      const { after, caller, service, one, two } = await aStoppedServiceWhileOff()
      const taken = await call(after, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', delivery: 'held' })
      expect(taken.text).toContain('is not told yet: it is held. It waits until services are on.')
      const notice = rows(service, 'message_queued').find(
        (row) => row.type === 'message_queued' && row.appNotice === 'a-piece-taken-back',
      )
      if (notice?.type !== 'message_queued') throw new Error('the take-back was not kept')
      await new Promise((settled) => setTimeout(settled, 100))
      expect(wentIn(service, notice.text)).toBe(false)
      after.setServicesOn(true)
      await vi.waitFor(() => {
        expect(wentIn(service, notice.text)).toBe(true)
      })
      await vi.waitFor(() => {
        expect(stateOf(service, two.piece)).not.toBe('waiting')
      })
    })

    it('keeps a caller’s answer to a stopped service’s question while off, and starts nothing', async () => {
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
      const after = world.aHost({ servicesOn: false })
      await after.resumeSession(caller, world.window)
      const answered = await call(after, caller, 'answer_question', {
        question: String(asked.structured['question']),
        answers: [{ part: 'answer', answer: ['the third'] }],
      })
      expect(answered.structured).toMatchObject({ outcome: 'ok' })
      expect(answered.text).toContain(
        'It could not be started now — Services are off, so a service’s conversation is not started.',
      )
      await new Promise((settled) => setTimeout(settled, 100))
      expect(wentIn(service, 'the third')).toBe(false)
      after.setServicesOn(true)
      await vi.waitFor(() => {
        expect(wentIn(service, 'the third')).toBe(true)
      })
    })

    it('keeps a new brief for a stopped service while off, and it goes in once they are on', async () => {
      const { after, caller, service, one } = await aStoppedServiceWhileOff()
      const brief = 'Look at the second floor instead.'
      const updated = await call(after, caller, 'update_work', { piece: one.label, brief })
      expect(updated.text).toContain('the new brief is held. It waits until services are on.')
      await new Promise((settled) => setTimeout(settled, 100))
      expect(wentIn(service, brief)).toBe(false)
      after.setServicesOn(true)
      await vi.waitFor(() => {
        expect(wentIn(service, brief)).toBe(true)
      })
      const turn = rows(service, 'user_turn').find(
        (row) => row.type === 'user_turn' && row.text.includes(brief),
      )
      expect(turn).toMatchObject({ piece: one.piece })
    })
  })

  describe('what is shown of a service', () => {
    it('names it by its agent and what it is, never by a piece it holds', async () => {
      const { host, service, one, two, releaseTheTurn } = await aServiceWithWorkQueued()
      const named = host.nameByItsWork(service)
      expect(named).toBe(`${host.whatToCallTheConversation(service)} (a service)`)
      expect(named).not.toContain(one.label)
      expect(named).not.toContain(two.label)
      expect(host.addressOf(service)).toBe(service)
      releaseTheTurn()
    })

    it('marks the piece a person may take back, only while services are on', async () => {
      const { host, caller, one, releaseTheTurn } = await aServiceWithWorkQueued()
      const marked = (): boolean | undefined =>
        host.whoCalledWhom(caller).workGivenOut.rows.find((edge) => edge.piece === one.piece)
          ?.aPersonMayTakeItBack
      expect(marked()).toBe(true)
      host.setServicesOn(false)
      expect(marked()).toBeUndefined()
      releaseTheTurn()
    })

    it('gives a service the service text after the core, while services are on, and no other agent', async () => {
      world.anAgent('browser-driver')
      world.anAgent('writer', 'nothing kept')
      const host = world.aHost({ servicesOn: true })
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
      host.setServicesOn(false)
      const off = reader.instructionContext('browser-driver', world.folder, null, null)
      expect(composeProfileBundle(off)).not.toContain('You serve many callers')
    })
  })
})
