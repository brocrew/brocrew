import { afterEach, expect, it } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { answerOn } from './helpers/call-tool'

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
  give(other, 'work_unrelated')
  const first = fail('work_first', 'First provider error.')
  const second = fail('work_second', 'Second provider error.')
  append({ type: 'user_turn', text: 'Do unrelated work.', drives: 'work_unrelated' })
  append({ type: 'turn', state: 'completed' })

  const read = (me: string, agent: string) =>
    answerOn(agentToolsFor(host, me), 'get_agent_status', { agent })
  const check = async () => {
    const one = await read(giver, firstLabel)
    const two = await read(other, secondLabel)
    for (const [answer, mine, elsewhere] of [
      [one, first, second],
      [two, second, first],
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
        provider_turn_failures: [mine],
      })
      expect(answer.text).toContain(mine.failure.message)
      expect(answer.text).not.toContain(elsewhere.failure.message)
    }
    const listed = await answerOn(agentToolsFor(host, giver), 'list_agents', { archived: false })
    expect(listed.structured).toMatchObject({
      outcome: 'ok',
      agents: expect.arrayContaining([expect.objectContaining({ agent: holder })]),
    })
    expect(listed.structured).not.toHaveProperty('provider_turn_failures')
    expect(listed.text).not.toContain(first.failure.message)
  }
  await check()
  host.claimSession(holder, w.window)
  await host.close(holder, w.window)
  await check()
})
