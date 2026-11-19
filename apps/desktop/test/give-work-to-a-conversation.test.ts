import { answerOn } from './helpers/call-tool'
import { aServiceWorld } from './helpers/a-service-world'
import {
  closeHostFixture,
  fixtureProviderConfig,
  neutralHostDeps,
  syntheticProviderHome,
  waitFor,
} from './lib/host-fixture'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, ResumeError } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type CallerIdentity,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class PersonSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('give_work goes to the conversation the giver names', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let counter: number
  let clock: number
  let beforeProviderStart: (() => void) | null
  let providerSessionFileMissing: boolean
  const window = new PersonSink('webContents:1')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brocrew-give-to-'))
    work = mkdtempSync(join(tmpdir(), 'brocrew-give-to-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 3_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    beforeProviderStart = null
    providerSessionFileMissing = false
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider, { sessions })
        const start = runtime.start.bind(runtime)
        vi.spyOn(runtime, 'start').mockImplementation(async (options) => {
          beforeProviderStart?.()
          return start(options)
        })
        const resume = runtime.resume.bind(runtime)
        vi.spyOn(runtime, 'resume').mockImplementation(async (ref, options) => {
          if (providerSessionFileMissing) {
            throw new ResumeError(ref, 'the fictional session file is gone', {
              noSuchSession: true,
            })
          }
          return resume(ref, options)
        })
        return runtime
      },
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: fixtureProviderConfig,
    })
  })

  afterEach(() => closeHostFixture(host, db, userData, work))

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> =>
    (await host.createSession({ provider: 'claude', profileId, cwd: work, approvalMode }, window))
      .sessionId
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })
  const task = (title: string) => ({
    profile: 'pm',
    title,
    brief: `${title}, in a sentence`,
    definition_of_done: `${title} is done.`,
  })
  const anAgentCalledPm = async (): Promise<void> => {
    const id = await personOpens('pm')
    await host.close(id, window)
  }

  it('starts a new conversation titled after the job, and its title reads back at once', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const given = await host.giveWork(
      { ...task('Book the hotel'), to: 'new', conversation_title: 'Lisbon trip, March' },
      speakingAs(lead),
    )
    expect(given.ok).toBe(true)
    if (!given.ok) return
    expect(given.runsOn.how).toBe('started')
    expect(store.conversationTitle(given.owner)).toMatchObject({
      title: 'Lisbon trip, March',
      author: { kind: 'agent', conversation: lead },
    })
    await waitFor(
      () => store.events(given.owner).some((row) => row.event.type === 'user_turn'),
      'the first brief to reach the provider',
    )
    const turn = store.events(given.owner).find((row) => row.event.type === 'user_turn')?.event
    if (turn?.type !== 'user_turn') throw new Error('the provider did not receive the brief')
    const text = turn.sent ?? turn.text
    const sender = host.whatToCallTheConversation(lead)
    expect(text).toContain(`From ${sender} (conversation ${host.addressOf(lead)} ·`)
    expect(text).toContain(
      `task ${given.label} · Book the hotel for you in your conversation ${given.label} · Lisbon trip, March.`,
    )
    expect(text).toContain(`Your reply here doesn't reach ${sender}: answer with answer_question`)
    expect(text).not.toContain('A note expects no answer.')
  })

  it('names the conversation in an Ask receipt without its answered task state', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead', 'auto')
    const given = await host.giveWork(
      { ...task('Book the room'), to: 'new', conversation_title: 'Room booking' },
      speakingAs(lead),
    )
    if (!given.ok) throw new Error(given.refusal.reason)
    await waitFor(() => {
      const status = store
        .events(given.owner)
        .reverse()
        .find((row) => row.event.type === 'status')?.event
      return status?.type === 'status' && status.state === 'idle'
    }, 'the brief’s turn to finish')
    const replied = await answerOn(agentToolsFor(host, given.owner), 'reply_to_parent', {
      piece: given.label,
      outcome: 'done',
      summary: 'The room is booked.',
    })
    expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })

    const tools = agentToolsFor(host, lead)
    const asked = await answerOn(tools, 'ask_question', {
      who_answers: 'an-agent',
      agent: given.label,
      question: 'Which entrance serves the room?',
    })
    const id = asked.structured?.question
    expect(asked.structured, asked.text).toMatchObject({
      outcome: 'ok',
      agent: given.owner,
      question: expect.any(String),
      receipt: { recipient: { id: given.owner, state: { kind: 'started' } } },
    })
    expect(asked.text).toBe(
      `Question ${id} sent to conversation ${given.label} · Room booking. The answer arrives as a message.`,
    )
    const listed = await answerOn(tools, 'list_tasks', { piece: given.label })
    expect(listed.structured, listed.text).toMatchObject({ outcome: 'done', state: 'answered' })
  })

  it('says when a question will wait for its recipient and when it is recorded for the person', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const given = await host.giveWork(
      { ...task('Book the room'), to: 'new', conversation_title: 'Room booking' },
      speakingAs(lead),
    )
    if (!given.ok) throw new Error(given.refusal.reason)
    await waitFor(
      () => store.events(given.owner).some((row) => row.event.type === 'permission_request'),
      'the recipient to be busy',
    )
    const tools = agentToolsFor(host, lead)
    const queued = await answerOn(tools, 'ask_question', {
      who_answers: 'an-agent',
      agent: given.label,
      question: 'Which entrance serves the room?',
    })
    expect(queued.structured, queued.text).toMatchObject({
      outcome: 'ok',
      question: expect.any(String),
      receipt: { recipient: { id: given.owner, state: { kind: 'queued' } } },
    })
    expect(queued.text).toBe(
      `Question ${queued.structured?.question} queued for conversation ${given.label} · Room booking. The answer arrives as a message.`,
    )
    const person = await answerOn(tools, 'ask_question', {
      who_answers: 'a-person',
      question: 'Which time works for you?',
    })
    expect(person.structured, person.text).toMatchObject({
      outcome: 'ok',
      went_to: 'a-person',
      question: expect.any(String),
    })
    expect(person.text).toBe(
      `Question ${person.structured?.question} recorded for the person. The answer arrives as a message.`,
    )
  })

  it('continues the conversation an address names, by its first or a later task label', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const first = await host.giveWork(
      { ...task('Book the hotel'), to: 'new', conversation_title: 'Lisbon trip' },
      speakingAs(lead),
    )
    if (!first.ok) throw new Error(first.refusal.reason)
    const second = await host.giveWork(
      { ...task('Book the flights'), to: first.label },
      speakingAs(lead),
    )
    if (!second.ok) throw new Error(second.refusal.reason)
    const third = await host.giveWork(
      { ...task('Book a museum'), to: second.label },
      speakingAs(lead),
    )
    if (!third.ok) throw new Error(third.refusal.reason)
    expect(second.owner).toBe(first.owner)
    expect(third.owner).toBe(first.owner)
    expect(second.runsOn.how).not.toBe('started')
    expect(store.workById(second.piece)?.owner).toBe(first.owner)
  })

  it('names the actual task, destination, parent and queue in successful tool receipts', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const give = agentToolsFor(host, lead).tools.find((tool) => tool.name === 'give_work')!
    const first = await give.call({
      ...task('Book the hotel'),
      to: 'new',
      conversation_title: 'Lisbon trip',
    })
    const piece = first.structured?.piece
    if (typeof piece !== 'string') throw new Error('the give did not record a task')
    const row = store.workById(piece)
    if (row === null) throw new Error('the task is missing')
    const owner = row.owner
    const address = store.firstTaskOf(owner)?.label
    expect(address).toEqual(expect.any(String))
    const parent = store.rootOf(lead)?.label
    expect(first.structured).toMatchObject({
      outcome: 'ok',
      receipt: {
        recorded: { kind: 'task', id: piece, taskLabel: address },
        recipient: { id: owner, address, title: 'Lisbon trip', state: { kind: 'started' } },
      },
    })
    expect(first.text).toContain(
      `New task ${address} in a new conversation ${address} · Lisbon trip, under your ${parent}. It started on Claude`,
    )
    await waitFor(
      () => store.events(owner).some((one) => one.event.type === 'permission_request'),
      'the first task to keep the recipient busy',
    )
    const second = await give.call({ ...task('Book the flights'), to: address })
    const next = second.structured?.piece
    if (typeof next !== 'string') throw new Error('the second give did not record a task')
    const pending = store.messagesWaitingIn(owner).find((one) => one.piece === next)
    expect(pending?.label).toEqual(expect.any(String))
    expect(second.structured).toMatchObject({
      outcome: 'ok',
      receipt: {
        recorded: { kind: 'task', id: next, taskLabel: pending?.label },
        recipient: {
          id: owner,
          address,
          title: 'Lisbon trip',
          state: { kind: 'queued', behind: 0 },
        },
      },
    })
    expect(second.text).toContain(
      `New task ${pending?.label} in conversation ${address} · Lisbon trip (last active just now), under your ${parent}.`,
    )
    expect(second.text).toContain('Context: no current reading.')
  })

  it('delivers messages and questions while archived and restores only after a committed give', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead', 'auto')
    const first = await host.giveWork(
      { ...task('Book the hotel'), to: 'new', conversation_title: 'Lisbon trip' },
      speakingAs(lead),
    )
    if (!first.ok) throw new Error(first.refusal.reason)
    const to = first.owner
    const tools = agentToolsFor(host, lead).tools
    const give = tools.find((tool) => tool.name === 'give_work')!
    const message = tools.find((tool) => tool.name === 'message_agent')!
    const ask = tools.find((tool) => tool.name === 'ask_question')!
    expect(await host.archiveConversation(to)).toMatchObject({ done: true })
    const archivedAt = host.whenItWasArchived(to)
    expect(archivedAt).toEqual(expect.any(Number))

    const waitForEcho = (words: string) =>
      waitFor(
        () =>
          store
            .events(to)
            .some(
              (row) => row.event.type === 'assistant_message' && row.event.text.includes(words),
            ),
        `the provider to receive ${words}`,
      )
    const said = await message.call({ agent: first.label, text: 'Check whether the hotel is open' })
    expect(said.structured).toMatchObject({ outcome: 'ok', receipt: { recipient: { id: to } } })
    await waitForEcho('Check whether the hotel is open')
    expect(host.whenItWasArchived(to)).toBe(archivedAt)

    const asked = await ask.call({
      who_answers: 'an-agent',
      agent: first.label,
      question: 'What are the hotel opening hours?',
    })
    expect(asked.structured).toMatchObject({ outcome: 'ok', receipt: { recipient: { id: to } } })
    const question = asked.structured?.question
    if (typeof question !== 'string') throw new Error('the question has no id')
    await waitForEcho(`asks you ${question} in your conversation ${first.label} · Lisbon trip.`)
    await waitForEcho('Part id "answer": answer in your own words.')
    await waitForEcho('What are the hotel opening hours?')
    expect(host.whenItWasArchived(to)).toBe(archivedAt)

    host.claimSession(to, window)
    await host.close(to, window)
    providerSessionFileMissing = true
    db.exec(`
      CREATE TEMP TRIGGER reject_archived_task BEFORE INSERT ON events
      WHEN NEW.type = 'work_given'
      BEGIN SELECT RAISE(ABORT, 'fixture refused the archived task'); END
    `)
    const input = { ...task('Book the flights'), to: first.label }
    const refused = await give.call(input)
    expect(refused.structured).toMatchObject({ outcome: 'refused' })
    expect(refused.structured).not.toHaveProperty('receipt')
    expect(host.whenItWasArchived(to)).toBe(archivedAt)
    db.exec('DROP TRIGGER reject_archived_task')

    const recorded = await give.call(input)
    const piece = recorded.structured?.piece
    if (typeof piece !== 'string') throw new Error('the give did not record a task')
    expect(store.workById(piece)?.owner).toBe(to)
    expect(recorded.structured).toMatchObject({
      outcome: 'ok',
      receipt: {
        recorded: { kind: 'task', id: piece },
        recipient: {
          id: to,
          state: { kind: 'cannot-run', cause: { code: 'provider-file-missing' } },
        },
      },
    })
    expect(host.whenItWasArchived(to)).toBeNull()
    expect(store.replacements()).toEqual([])
  })

  it('rolls back the queued brief when a busy conversation cannot record its task', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const first = await host.giveWork(
      { ...task('Book the hotel'), to: 'new', conversation_title: 'Lisbon trip' },
      speakingAs(lead),
    )
    if (!first.ok) throw new Error(first.refusal.reason)
    await waitFor(
      () => store.events(first.owner).some((row) => row.event.type === 'permission_request'),
      'the first task to keep the recipient busy',
    )
    const before = store.messagesWaitingIn(first.owner)
    db.exec(`
      CREATE TEMP TRIGGER reject_queued_task BEFORE INSERT ON events
      WHEN NEW.type = 'work_given'
      BEGIN SELECT RAISE(ABORT, 'fixture refused the queued task'); END
    `)

    await expect(
      host.giveWork({ ...task('Book the flights'), to: first.label }, speakingAs(lead)),
    ).rejects.toThrow('fixture refused the queued task')

    expect(store.messagesWaitingIn(first.owner)).toEqual(before)
    expect(store.piecesOwnedBy(first.owner).map((one) => one.piece)).toEqual([first.piece])
  })

  it('two gives to "new" start two conversations of the same agent', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const one = await host.giveWork(
      { ...task('Read the contract'), to: 'new', conversation_title: 'DEV-1' },
      speakingAs(lead),
    )
    const two = await host.giveWork(
      { ...task('Read the invoice'), to: 'new', conversation_title: 'DEV-2' },
      speakingAs(lead),
    )
    if (!one.ok || !two.ok) throw new Error('both gives should be admitted')
    expect(one.owner).not.toBe(two.owner)
    expect(store.conversationTitle(one.owner)?.title).toBe('DEV-1')
    expect(store.conversationTitle(two.owner)?.title).toBe('DEV-2')
  })

  it('a give that names no conversation records nothing and lists the recent ones', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const first = await host.giveWork(
      { ...task('Book the hotel'), to: 'new', conversation_title: 'Lisbon trip' },
      speakingAs(lead),
    )
    if (!first.ok) throw new Error(first.refusal.reason)
    const before = store.recorded().length
    const refused = await host.giveWork(task('Book the flights'), speakingAs(lead))
    expect(refused).toMatchObject({ ok: false, refusal: { rail: 'name-the-conversation' } })
    if (refused.ok) return
    expect(refused.refusal.reason).toMatch(/^Not sent: /)
    expect(refused.refusal.reason).toContain(first.label)
    expect(refused.refusal.reason).toContain('Lisbon trip')
    expect(refused.refusal.reason).not.toContain('Book the hotel')
    expect(store.recorded()).toHaveLength(before)
  })

  it('keeps a completion condition of 2,000 characters inline', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const condition = 'a'.repeat(2_000)
    const given = await host.giveWork(
      {
        ...task('Read the report'),
        to: 'new',
        conversation_title: 'Report check',
        definition_of_done: condition,
      },
      speakingAs(lead),
    )
    if (!given.ok) throw new Error(given.refusal.reason)
    expect(store.resourcesOf(given.piece)).toEqual([])
    expect(store.events(given.owner).map((row) => row.event)).toContainEqual(
      expect.objectContaining({ type: 'work_given', definitionOfDone: condition }),
    )
  })

  it('keeps the complete brief and completion condition as readable task inputs', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const brief = `${'a'.repeat(1_999)}🚲 complete brief`
    const condition = `${' '.repeat(2_000)}${'b'.repeat(2_000)} complete condition`
    const give = agentToolsFor(host, lead).tools.find((tool) => tool.name === 'give_work')!
    const result = await give.call({
      ...task('Read the report'),
      to: 'new',
      conversation_title: 'Report check',
      brief,
      definition_of_done: condition,
    })
    expect(result.structured).toMatchObject({ outcome: 'ok' })
    const piece = result.structured?.piece
    if (typeof piece !== 'string') throw new Error('the give did not record a task')
    expect(store.workById(piece)?.brief).toBe('a'.repeat(1_999))
    const files = store.resourcesOf(piece)
    expect(files.map((file) => file.role)).toEqual(['input', 'input'])
    const originals = new Map([
      ['brief.txt', brief],
      ['definition-of-done.txt', condition],
    ])
    for (const file of files) {
      const read = host.readResource(file.resource)
      if (!read.ok || read.content.as !== 'file') throw new Error('the attachment cannot be read')
      expect(readFileSync(read.content.path, 'utf8')).toBe(originals.get(file.name))
      expect(result.text).toContain(`the full text is attached as ${file.name} (${file.resource})`)
    }
  })

  it('a refused give to "new" leaves no titled conversation behind', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const before = store.recorded().length
    const refused = await host.giveWork(
      { ...task('Book the hotel'), to: 'new', conversation_title: 'one\ntwo' },
      speakingAs(lead),
    )
    expect(refused).toMatchObject({ ok: false, refusal: { rail: 'conversation-title-needed' } })
    expect(store.recorded()).toHaveLength(before)
  })

  it('rolls back the job title when the first task fails to save', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead')
    const before = new Set(store.recorded().map((one) => one.sessionId))
    const opening = `sess_${counter + 1}`
    const start = vi.fn()
    beforeProviderStart = start
    db.exec(`
      CREATE TEMP TRIGGER reject_first_task_after_title BEFORE INSERT ON events
      WHEN NEW.type = 'work_given' AND EXISTS (
        SELECT 1 FROM events
        WHERE session_id = NEW.session_id AND generation = NEW.generation AND type = 'titled'
      )
      BEGIN SELECT RAISE(ABORT, 'fixture refused the task after the title'); END
    `)

    await expect(
      host.giveWork(
        { ...task('Book the hotel'), to: 'new', conversation_title: 'Lisbon trip' },
        speakingAs(lead),
      ),
    ).rejects.toThrow('fixture refused the task after the title')

    const give = agentToolsFor(host, lead).tools.find((tool) => tool.name === 'give_work')!
    const refused = await give.call({
      ...task('Book the hotel'),
      to: 'new',
      conversation_title: 'Lisbon trip',
    })
    expect(refused.structured).toMatchObject({
      outcome: 'refused',
      reason: 'Not sent: This conversation could not save the change.',
    })
    expect(refused.text).toContain('Not sent: This conversation could not save the change.')
    expect(refused.structured).not.toHaveProperty('receipt')

    expect(start).not.toHaveBeenCalled()
    expect(store.recorded().filter((one) => !before.has(one.sessionId))).toEqual([])
    expect(store.conversationTitle(opening)).toBeNull()
    expect(store.piecesGivenBy(lead)).toEqual([])
    expect(store.events(opening).map((row) => row.event.type)).not.toContain('work_given')
  })

  it('keeps a valid give when its first launch fails and starts that same conversation later', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead', 'auto')
    const tools = agentToolsFor(host, lead).tools
    const give = tools.find((tool) => tool.name === 'give_work')!
    const message = tools.find((tool) => tool.name === 'message_agent')!
    const before = store.recorded().length
    const opening = `sess_${counter + 1}`
    const seenAtStart = vi.fn(() => ({
      owner: store.piecesGivenBy(lead)[0]?.owner,
      title: store.conversationTitle(opening)?.title,
    }))
    beforeProviderStart = () => {
      seenAtStart()
      throw new Error('fixture provider could not start')
    }

    const failure = await give
      .call({ ...task('Book the hotel'), to: 'new', conversation_title: 'Lisbon trip' })
      .then(
        (receipt) => ({ receipt }),
        (error: unknown) => ({ error }),
      )
    expect(seenAtStart.mock.results[0]?.value).toEqual({ owner: opening, title: 'Lisbon trip' })
    const [recorded] = store.piecesGivenBy(lead)
    if (recorded === undefined) throw new Error('the valid give was lost')
    expect(recorded.owner).toBe(opening)
    expect(store.messagesWaitingIn(opening)).toContainEqual(
      expect.objectContaining({ piece: recorded.piece, text: 'Book the hotel, in a sentence' }),
    )
    expect(store.recorded()).toHaveLength(before + 1)
    expect(store.recordedOne(opening)?.neverStarted).toBe(true)
    if ('error' in failure) throw failure.error
    expect(failure.receipt.structured).toMatchObject({
      outcome: 'ok',
      receipt: {
        recorded: { kind: 'task', id: recorded.piece, taskLabel: recorded.label },
        recipient: {
          id: opening,
          address: recorded.label,
          title: 'Lisbon trip',
          state: { kind: 'cannot-run', cause: { code: 'could-not-start' } },
        },
      },
    })
    expect(failure.receipt.text).toContain(
      `Task ${recorded.label} is recorded in conversation ${recorded.label} · Lisbon trip, but it could not start`,
    )

    const retry = vi.fn()
    beforeProviderStart = retry
    const sent = await message.call({
      agent: recorded.label,
      text: 'Please continue the same job.',
    })
    expect(sent.structured).toMatchObject({ outcome: 'ok' })
    expect(retry).toHaveBeenCalledOnce()
    expect(store.recorded()).toHaveLength(before + 1)
    expect(store.recordedOne(opening)?.neverStarted).toBe(false)
    await vi.waitFor(() => {
      const events = store.events(opening).map((row) => row.event)
      const turns = events.filter((event) => event.type === 'user_turn')
      expect(turns.some((turn) => turn.text.includes('Book the hotel, in a sentence'))).toBe(true)
      expect(turns.some((turn) => turn.text.includes('Please continue the same job.'))).toBe(true)
      expect(events.filter((event) => event.type === 'work_given')).toHaveLength(1)
      expect(events.some((event) => event.type === 'replaced_by')).toBe(false)
    })
  })

  it('keeps an unconfirmed brief on its original task while a later new give delivers after restart', async () => {
    const world = aServiceWorld()
    const hosts: RuntimeHost[] = []
    try {
      world.anAgent('pm', 'normal')
      const firstHost = world.aHost()
      hosts.push(firstHost)
      const lead = await world.aPersonOpens(firstHost, 'lead')
      const give = (at: RuntimeHost, title: string) =>
        answerOn(agentToolsFor(at, lead), 'give_work', {
          ...task(title),
          to: 'new',
          conversation_title: title,
        })

      const firstTitle = 'Check the opening hours'
      const nextTitle = 'Book the hotel'
      world.sendReturnsError = true
      const first = await give(firstHost, firstTitle)
      const { agent: owner, piece, label } = first.structured ?? {}
      if (typeof owner !== 'string' || typeof piece !== 'string' || typeof label !== 'string') {
        throw new Error('the first give lost its recorded identity')
      }
      expect(first.structured).toMatchObject({
        outcome: 'ok',
        delivery: 'held',
        receipt: { recorded: { kind: 'task', id: piece, taskLabel: label } },
      })
      const held = world.store.messagesWaitingIn(owner).find((message) => message.piece === piece)
      if (held === undefined) throw new Error('the first brief was lost')
      const expectFirstBriefKept = () => {
        expect(world.store.workById(piece)).toMatchObject({ owner, label, givenBy: lead })
        expect(world.store.messagesWaitingIn(owner)).toContainEqual(
          expect.objectContaining({
            messageId: held.messageId,
            piece,
            label,
            text: task(firstTitle).brief,
          }),
        )
        expect(
          world.ledger(owner).filter(
            (event) => event.type === 'message_unqueued' && event.messageId === held.messageId,
          ),
        ).toEqual([])
      }
      const inputs = () =>
        world.sent.filter((entry) => entry.as === 'pm').map((entry) => entry.words)
      const firstInput = expect.stringContaining(task(firstTitle).brief)
      expect(inputs()).toEqual([firstInput])
      expectFirstBriefKept()

      await firstHost.closeAll()
      world.sendReturnsError = false
      const nextHost = world.aHost()
      hosts.push(nextHost)
      await nextHost.reopenForAPerson(lead, world.window, null)
      expect(inputs()).toEqual([firstInput])
      expectFirstBriefKept()

      const later = await give(nextHost, nextTitle)
      const { agent: nextOwner, piece: nextPiece } = later.structured ?? {}
      if (typeof nextOwner !== 'string' || typeof nextPiece !== 'string') {
        throw new Error('the later give did not record work')
      }
      expect(nextOwner).not.toBe(owner)
      expect(nextPiece).not.toBe(piece)
      expect(later.structured).toMatchObject({ outcome: 'ok', delivery: 'sent' })
      expect(inputs()).toEqual([firstInput, expect.stringContaining(task(nextTitle).brief)])
      expectFirstBriefKept()
    } finally {
      await closeHostFixture(hosts, world.db, world.folder)
    }
  })

  it('keeps sends on the addressed conversation when its provider session file is gone', async () => {
    await anAgentCalledPm()
    const lead = await personOpens('lead', 'auto')
    const first = await host.giveWork(
      { ...task('Book the hotel'), to: 'new', conversation_title: 'Lisbon trip' },
      speakingAs(lead),
    )
    if (!first.ok) throw new Error(first.refusal.reason)
    await vi.waitFor(() => {
      expect(store.resumable().some((row) => row.sessionId === first.owner)).toBe(true)
    })
    host.claimSession(first.owner, window)
    await host.close(first.owner, window)
    providerSessionFileMissing = true
    const before = store.recorded().length
    const recipient = {
      id: first.owner,
      address: first.label,
      title: 'Lisbon trip',
      state: { kind: 'cannot-run', cause: { code: 'provider-file-missing' } },
    }
    const tools = agentToolsFor(host, lead).tools
    const give = tools.find((tool) => tool.name === 'give_work')!
    const result = await give.call({ ...task('Book the flights'), to: first.label })
    const recorded = store.piecesGivenBy(lead).find((piece) => piece.piece !== first.piece)
    if (recorded === undefined) throw new Error('the valid give was lost')
    expect(result.structured).toMatchObject({
      outcome: 'ok',
      receipt: {
        recorded: { kind: 'task', id: recorded.piece, taskLabel: recorded.label },
        recipient,
      },
    })
    expect(result.text).toContain('Its record is still readable with read_transcript.')
    expect(store.recorded()).toHaveLength(before)
    expect(host.tookItsPlace(first.owner)).toBeNull()
    expect(store.events(first.owner).some((row) => row.event.type === 'replaced_by')).toBe(false)
    expect(store.messagesWaitingIn(first.owner)).toContainEqual(
      expect.objectContaining({ piece: recorded.piece, text: 'Book the flights, in a sentence' }),
    )

    const ask = tools.find((tool) => tool.name === 'ask_question')!
    const asked = await ask.call({
      who_answers: 'an-agent',
      agent: first.label,
      question: 'Which hotel was available?',
    })
    const requestId = asked.structured?.question
    if (typeof requestId !== 'string') throw new Error('the question was not recorded')
    expect(asked.structured).toMatchObject({
      outcome: 'ok',
      receipt: {
        recorded: { kind: 'question', id: requestId, taskLabel: null },
        recipient,
      },
    })
    expect(asked.text).toContain(`To get an answer, withdraw ${requestId}`)
    expect(store.routedRequestsOf(lead)).toContainEqual(
      expect.objectContaining({ requestId, state: 'open' }),
    )
    expect(store.messagesWaitingIn(first.owner)).toContainEqual(
      expect.objectContaining({ asks: { asker: lead, requestId }, kind: 'question' }),
    )

    const text = 'The hotel last quoted a Friday rate.'
    const message = tools.find((tool) => tool.name === 'message_agent')!
    const messaged = await message.call({ agent: first.label, text })
    const pending = store.messagesWaitingIn(first.owner).find((one) => one.text === text)
    if (pending === undefined) throw new Error('the message was not recorded')
    expect(messaged.structured).toMatchObject({
      outcome: 'ok',
      receipt: { recorded: { kind: 'message', id: pending.messageId, taskLabel: null }, recipient },
    })
    expect(messaged.text).toContain('Its record is still readable with read_transcript.')
    expect(store.recorded()).toHaveLength(before)
    expect(host.tookItsPlace(first.owner)).toBeNull()
  })
})
