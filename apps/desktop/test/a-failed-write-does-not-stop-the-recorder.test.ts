import { RECEIPTS_LEVEL_SOURCE } from '../src/main/runtime/schedule-evidence'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import type { GiveOutcome, RuntimeHost } from '../src/main/runtime/runtime-host'
import { aGiverAndHelper, type AServiceWorld } from './helpers/a-service-world'
import { callOn } from './helpers/call-tool'
import { aJobMade } from './lib/scheduling-calls-fixture'

const accepted = (given: GiveOutcome) => {
  if (!given.ok) throw new Error(given.refusal.reason)
  return given
}

describe('a failed write is one failed operation', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string
  const busy = () => Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
  beforeEach(async () => {
    ;({ world, host, giver } = await aGiverAndHelper())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('retries the record without sending a brief twice, and all acknowledged ids can be read', async () => {
    const original = world.store.recordGive.bind(world.store)
    const write = vi
      .spyOn(world.store, 'recordGive')
      .mockImplementationOnce(() => {
        throw busy()
      })
      .mockImplementation(original)
    const file = join(world.folder, 'brief.md')
    writeFileSync(file, 'A fictional input.')
    const given = accepted(await world.gives(host, giver, 'helper', { inputs: [file] }))
    expect(write).toHaveBeenCalledTimes(2)
    expect(world.store.workById(given.piece)?.owner).toBe(given.owner)
    expect(world.db.prepare('SELECT count(*) AS n FROM work_resource').get()).toEqual({ n: 1 })
    expect(world.sent.filter((one) => one.as === 'helper')).toHaveLength(1)
  })

  it('does not acknowledge an uncommitted give or its inputs, and a later give works', async () => {
    const before = world.store.piecesGivenBy(giver).length
    const write = vi.spyOn(world.store, 'recordGive').mockImplementation(() => {
      throw busy()
    })
    const file = join(world.folder, 'brief.md')
    writeFileSync(file, 'A fictional input.')
    await expect(world.gives(host, giver, 'helper', { inputs: [file] })).rejects.toThrow(
      /could not save/,
    )
    expect(world.store.piecesGivenBy(giver)).toHaveLength(before)
    expect(world.db.prepare('SELECT count(*) AS n FROM work_resource').get()).toEqual({ n: 0 })
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/session=.*table=work,work_resource,events code=SQLITE_BUSY/),
    )
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.filter(([line]) => String(line).includes('table=work,work_resource,events'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toHaveLength(1)
    write.mockRestore()
    const next = accepted(await world.gives(host, giver, 'helper'))
    expect(world.store.workById(next.piece)).not.toBeNull()
  })

  it('a failed hand-back leaves its piece open and returns no resource ids', async () => {
    const given = accepted(await world.gives(host, giver, 'helper'))
    const append = world.store.append.bind(world.store)
    const write = vi.spyOn(world.store, 'append').mockImplementation((id, ordinal, event, at) => {
      if (event.type === 'work_replied') throw busy()
      append(id, ordinal, event, at)
    })
    const file = join(world.folder, 'result.md')
    writeFileSync(file, 'A fictional result.')
    const tools = agentToolsFor(host, given.owner)
    await expect(
      callOn(tools, 'reply_to_parent', {
        piece: given.label,
        outcome: 'done',
        summary: 'Finished.',
        resource_paths: [file],
      }),
    ).rejects.toThrow(/could not save/)
    expect(
      world.store.piecesOwnedBy(given.owner).find((one) => one.piece === given.piece)?.state,
    ).not.toBe('answered')
    expect(world.db.prepare('SELECT count(*) AS n FROM work_resource').get()).toEqual({ n: 0 })
    write.mockRestore()
    const reply = await callOn(tools, 'reply_to_parent', {
      piece: given.label,
      outcome: 'done',
      summary: 'Finished.',
      resource_paths: [file],
    })
    expect(reply.outcome).not.toBe('refused')
    expect(world.ledger(given.owner).some((one) => one.type === 'work_replied')).toBe(true)
  })

  it('does not acknowledge an action whose attached resource record failed', async () => {
    const given = accepted(await world.gives(host, giver, 'helper'))
    const file = join(world.folder, 'action.md')
    writeFileSync(file, 'A fictional action input.')
    const write = vi.spyOn(world.store, 'addResource').mockImplementation(() => {
      throw busy()
    })
    const tools = agentToolsFor(host, given.owner)
    const ask = () =>
      callOn(tools, 'request_action', {
        piece: given.label,
        action: 'Check this fictional file.',
        resources: [file],
      })
    await expect(ask()).rejects.toThrow(/could not save/)
    expect(world.db.prepare('SELECT count(*) AS n FROM work_resource').get()).toEqual({ n: 0 })
    expect(world.ledger(given.owner).some((one) => one.type === 'question_asked')).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('table=work_resource code=SQLITE_BUSY'),
    )
    write.mockRestore()
    expect((await ask()).outcome).not.toBe('refused')
    expect(world.db.prepare('SELECT count(*) AS n FROM work_resource').get()).toEqual({ n: 1 })
  })

  it('a failed question is not delivered, then the next question is answerable', async () => {
    const given = accepted(await world.gives(host, giver, 'helper'))
    const appendMany = world.store.appendMany.bind(world.store)
    const refused = new Set<string>()
    const write = vi.spyOn(world.store, 'appendMany').mockImplementation((id, entries) => {
      const routed = entries.flatMap(({ event }) =>
        event.type === 'request_routed' ? [event] : [],
      )
      if (routed.length > 0) {
        routed
          .filter(({ requestId }) => requestId.startsWith('req_'))
          .forEach(({ requestId }) => refused.add(requestId))
        throw busy()
      }
      appendMany(id, entries)
    })
    const question = () =>
      host.raiseAQuestion(
        {
          piece: given.piece,
          question: 'Which room?',
          options: [],
          who: 'the-parent',
          agent: null,
        },
        { ownerId: agentCallerId(given.owner) },
      )
    await expect(question()).rejects.toThrow(/could not save/)
    // The provider's own permission card (not a `req_` id) may be routed to the giver meanwhile;
    // only the failed Ask's ID must have no opening, route or delivery, and every rolled-back
    // attempt carries that one ID.
    expect(refused.size).toBe(1)
    const [failed = ''] = refused
    expect(failed).not.toBe('')
    expect(world.store.questionsRoutedTo(giver).map(({ requestId }) => requestId)).not.toContain(
      failed,
    )
    expect(JSON.stringify(world.ledger(given.owner))).not.toContain(failed)
    expect(world.sent.some(({ words }) => words.includes('Which room?'))).toBe(false)
    write.mockRestore()
    const asked = await question()
    expect(asked.ok).toBe(true)
    if (!asked.ok) return
    const answer = await host.answerQuestion(
      {
        questionId: asked.question,
        answers: [{ part: 'answer', answer: ['Blue'] }],
      },
      { ownerId: agentCallerId(giver) },
    )
    expect(answer.ok).toBe(true)
  })

  it('a failed answer leaves the question answerable instead of remembering an unsaved decision', async () => {
    const given = accepted(await world.gives(host, giver, 'helper'))
    const asked = await host.raiseAQuestion(
      {
        piece: given.piece,
        question: 'Which room?',
        options: [],
        who: 'the-parent',
        agent: null,
      },
      { ownerId: agentCallerId(given.owner) },
    )
    if (!asked.ok) throw new Error('the question was refused')
    const append = world.store.append.bind(world.store)
    const write = vi.spyOn(world.store, 'append').mockImplementation((id, ordinal, event, at) => {
      if (event.type === 'user_decision') throw busy()
      append(id, ordinal, event, at)
    })
    const answer = () =>
      host.answerQuestion(
        {
          questionId: asked.question,
          answers: [{ part: 'answer', answer: ['Blue'] }],
        },
        { ownerId: agentCallerId(giver) },
      )
    await expect(answer()).rejects.toThrow(/could not save/)
    expect(
      world.store.questionsRoutedTo(giver).find((one) => one.requestId === asked.question)?.state,
    ).toBe('open')
    write.mockRestore()
    expect((await answer()).ok).toBe(true)
  })

  it('records the planned schedule after its preceding generated row failed', async () => {
    const handle = world.handles.find((one) => one.as === 'giver')!.handle
    const append = world.store.append.bind(world.store)
    let failed = 0
    const write = vi.spyOn(world.store, 'append').mockImplementation((...args) => {
      if (args[2].type === 'scheduled_work' && args[2].source === RECEIPTS_LEVEL_SOURCE) {
        failed++
        throw new Error('fictional schedule write failure')
      }
      return append(...args)
    })
    handle.simulateScheduledWork(
      aJobMade(
        { id: 'abcd1234', schedule: '* * * * *', recurring: true },
        'fictional-create',
        world.clock,
      ),
    )
    await vi.waitFor(() => expect(failed).toBeGreaterThan(0))
    write.mockRestore()
    handle.simulateScheduledWork({ jobs: undefined })
    await vi.waitFor(() =>
      expect(
        world
          .ledger(giver)
          .some(
            (one) =>
              one.type === 'scheduled_work' &&
              one.source === RECEIPTS_LEVEL_SOURCE &&
              one.jobs?.some((job) => job.id === 'abcd1234'),
          ),
      ).toBe(true),
    )
  })

  it('tries the next model report after the preceding report could not be saved', async () => {
    const given = accepted(await world.gives(host, giver, 'helper'))
    const handle = world.handles.find((one) => one.as === 'helper')!.handle
    Object.defineProperty(handle, 'agentInfo', {
      configurable: true,
      value: { model: 'fictional-reported-model' },
    })
    const saved = world.store.setReportedModel.bind(world.store)
    const write = vi
      .spyOn(world.store, 'setReportedModel')
      .mockImplementationOnce(() => {
        throw new Error('fictional disk full')
      })
      .mockImplementation(saved)
    handle.simulateActivity()
    await vi.waitFor(() => expect(write.mock.calls.length).toBeGreaterThanOrEqual(1))
    handle.simulateActivity()
    await vi.waitFor(() =>
      expect(world.store.whatItRunsOn(given.owner)?.reportedModel).toBe('fictional-reported-model'),
    )
    expect(write).toHaveBeenCalledTimes(2)
  })
})
