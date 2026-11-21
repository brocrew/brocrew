import { afterEach, expect, it } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { MAX_TURN_PARTS } from '../src/shared/runtime-ipc'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { answerOn } from './helpers/call-tool'
import { recordFailedQuestionTurn } from './lib/question-wake'

let world: AServiceWorld | undefined
afterEach(async () => {
  await world?.cleanUp()
})

it('reads each giver’s recorded error and the current provider and model, live and stopped', async () => {
  const w = (world = aServiceWorld())
  w.anAgent('giver', 'normal')
  w.anAgent('other-giver', 'normal')
  w.anAgent('holder', 'normal')
  const host = w.aHost()
  const giver = await w.aPersonOpens(host, 'giver')
  const other = await w.aPersonOpens(host, 'other-giver')
  const holder = await w.aPersonOpens(host, 'holder')
  const handle = w.handles.find(({ as }) => as === 'holder')!.handle
  await handle.setModel('fictional-selected')
  w.store.setModel(holder, 'fictional-selected')
  w.store.setReportedModel(holder, 'fictional-reported', null)

  const give = (givenBy: string, piece: string) => {
    const root = w.store.rootOf(givenBy)!
    const number = w.store.numberUnder(root.piece)
    const parent = root.piece
    const label = `${root.label}.${String(number)}`
    const title = `Record ${piece}`
    const brief = 'Read the next chapter.'
    w.store.recordGive(
      { piece, parent, number, owner: holder, givenBy, title, brief, folder: null, inputs: [] },
      w.store.nextOrdinal(holder),
      { type: 'work_given', piece, label, parent, givenBy, title, brief },
      w.clock++,
    )
    return label
  }
  const append = (event: TranscriptEvent) => {
    const ordinal = w.store.nextOrdinal(holder)
    w.store.append(holder, ordinal, event, w.clock++)
    return ordinal
  }
  const fail = (piece: string, message: string) => {
    append({ type: 'user_turn', text: 'Do the work.', drives: piece })
    const providerFailure = { message }
    const turnOrdinal = append({ type: 'turn', state: 'failed', providerFailure })
    return { piece, failure: { turnOrdinal, ...providerFailure } }
  }

  const firstLabel = give(giver, 'work_first')
  const secondLabel = give(other, 'work_second')
  give(giver, 'work_later')
  give(other, 'work_unrelated')
  const first = fail('work_first', 'First provider error.')
  const second = fail('work_second', 'Second provider error.')
  const later = fail('work_later', 'Later provider error.')
  append({ type: 'user_turn', text: 'Do unrelated work.', drives: 'work_unrelated' })
  append({ type: 'turn', state: 'completed' })

  const read = (me: string, agent: string) =>
    answerOn(agentToolsFor(host, me), 'get_agent_status', { agent })
  const check = async () => {
    const one = await read(giver, firstLabel)
    const two = await read(other, secondLabel)
    for (const [answer, newest, mine, elsewhere] of [
      [one, later, [first, later], [first, second]],
      [two, second, [second], [first, later]],
    ] as const) {
      expect(answer.structured).toMatchObject({
        outcome: 'ok',
        agent: {
          agent: holder,
          provider: 'claude',
          runsOn: {
            selected: { model: 'fictional-selected' },
            reported: { model: expect.any(String) },
          },
        },
        provider_turn_failures: expect.arrayContaining([...mine]),
      })
      const structured = answer.structured as { provider_turn_failures: unknown[] }
      expect(structured.provider_turn_failures).toHaveLength(mine.length)
      expect(answer.text).toContain(newest.failure.message)
      expect(answer.text).toContain(`Recorded failed turn ${String(newest.failure.turnOrdinal)}.`)
      for (const hidden of elsewhere) expect(answer.text).not.toContain(hidden.failure.message)
    }
    const listed = await answerOn(agentToolsFor(host, giver), 'list_agents', { archived: false })
    expect(listed.structured).toMatchObject({
      outcome: 'ok',
      agents: expect.arrayContaining([expect.objectContaining({ agent: holder })]),
    })
    expect(listed.structured).not.toHaveProperty('provider_turn_failures')
    for (const hidden of [first, second, later])
      expect(listed.text).not.toContain(hidden.failure.message)
  }
  await check()
  await host.close(holder, w.window)
  await check()
})

it('reads a taskless failure for the question’s successor and stops saying it when the episode is unread or stale', async () => {
  const w = (world = aServiceWorld())
  for (const profile of ['asker', 'observer', 'answerer']) w.anAgent(profile, 'normal')
  let host = w.aHost()
  const asker = await w.aPersonOpens(host, 'asker')
  const observer = await w.aPersonOpens(host, 'observer')
  await host.closeAll()
  const holder = 'sess_taskless_answerer'
  w.store.create({
    id: holder,
    provider: 'claude',
    cwd: w.folder,
    approvalMode: 'ask',
    profileId: 'answerer',
    parentSessionId: asker,
  })
  const append = (conversation: string, event: TranscriptEvent) => {
    const ordinal = w.store.nextOrdinal(conversation)
    w.store.append(conversation, ordinal, event, w.clock++)
    return ordinal
  }
  const message = 'The recorded provider rejected the request.'
  const { terminal, turnOrdinal } = recordFailedQuestionTurn(append, {
    asker,
    holder,
    requestId: 'req_read_failure',
    prompt: 'Which chapter should we keep?',
    message,
  })
  const successor = w.seedHistoricalSuccessor(asker, 'sess_successor_asker')
  host = w.aHost()

  const read = (me: string) =>
    answerOn(agentToolsFor(host, me), 'get_agent_status', { agent: holder })
  const readWithoutRecordedCause = async (me: string) => {
    const answer = await read(me)
    expect(answer.structured).toMatchObject({ outcome: 'ok', agent: { agent: holder } })
    expect(answer.structured).not.toHaveProperty('provider_question_failure')
    expect(answer.text).not.toContain(message)
    return answer.text
  }
  expect(w.store.rootOf(holder)).toBeNull()
  expect(await read(successor)).toMatchObject({
    structured: {
      outcome: 'ok',
      agent: { agent: holder },
      provider_question_failure: { message, turnOrdinal },
    },
    text: expect.stringContaining(message),
  })
  expect(await readWithoutRecordedCause(observer)).not.toContain('Cause unknown.')

  const writeTerminal = w.db.prepare(
    'UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?',
  )
  writeTerminal.run(
    JSON.stringify({ ...terminal, providerFailure: { message: null } }),
    holder,
    turnOrdinal,
  )
  expect(w.store.providerFailureEpisode(holder)).toBe('unknown')
  expect(await readWithoutRecordedCause(successor)).toContain(
    'Cause unknown. No recent turn ending could be checked.',
  )
  append(holder, { type: 'user_turn', text: 'Retry once.' })
  append(holder, { type: 'turn', state: 'interrupted' })
  expect(await readWithoutRecordedCause(successor)).toContain(
    'Cause unknown. Checked 1 recent turn ending.',
  )
  writeTerminal.run(JSON.stringify(terminal), holder, turnOrdinal)
  expect((await read(successor)).structured).toHaveProperty('provider_question_failure', {
    message,
    turnOrdinal,
  })

  append(holder, { type: 'user_turn', text: 'Do an ordinary recovery check.' })
  append(holder, { type: 'turn', state: 'completed' })
  expect(w.store.providerFailureEpisode(holder)).toBe('none')
  expect(await readWithoutRecordedCause(successor)).not.toContain('Cause unknown.')
})

it('describes only the evidence examined within the closed-turn and part limits', async () => {
  const w = (world = aServiceWorld())
  w.anAgent('reader', 'normal')
  w.anAgent('holder', 'normal')
  const host = w.aHost()
  const reader = await w.aPersonOpens(host, 'reader')
  const holder = await w.aPersonOpens(host, 'holder')
  const append = (event: TranscriptEvent) =>
    w.store.append(holder, w.store.nextOrdinal(holder), event, w.clock++)
  const status = async () =>
    (await answerOn(agentToolsFor(host, reader), 'get_agent_status', { agent: holder })).text
  const interruptedTurn = () => {
    append({ type: 'user_turn', text: 'Try again.' })
    append({ type: 'turn', state: 'interrupted' })
  }

  expect(await status()).not.toContain('Cause unknown.')
  for (let turn = 0; turn < 7; turn++) interruptedTurn()
  expect(await status()).not.toContain('Cause unknown.')
  interruptedTurn()
  expect(await status()).toContain('Cause unknown. Checked 8 recent turn endings.')

  append({ type: 'user_turn', text: 'Try with a long turn.' })
  for (let part = 0; part < MAX_TURN_PARTS; part++)
    append({ type: 'work_interrupted', by: 'a-person' })
  append({ type: 'turn', state: 'interrupted' })
  expect(await status()).toContain(
    'Cause unknown. No recent turn ending could be checked. A turn exceeded the 64-part limit.',
  )
})
