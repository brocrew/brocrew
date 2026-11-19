import { afterEach, expect, it } from 'vitest'
import { WorkSearchEngine } from '../src/main/db/work-search-engine'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { answerOn, callOn } from './helpers/call-tool'
import { newConversationGive } from './lib/give-fixture'

let world: AServiceWorld | undefined
afterEach(async () => {
  await world?.cleanUp()
})

it('keeps its address and title across reads with work from two callers', async () => {
  world = aServiceWorld()
  world.anAgent('browser-driver')
  for (const caller of ['caller', 'other-caller']) world.anAgent(caller, 'nothing kept')
  const host = world.aHost()
  const first = await world.aPersonOpens(host, 'caller')
  const second = await world.aPersonOpens(host, 'other-caller')
  const serviceName = 'Browser Driver'
  expect(world.store.setAgentDisplayName('browser-driver', serviceName)).toBe(true)
  const firstTools = agentToolsFor(host, first)
  const secondTools = agentToolsFor(host, second)
  const give = (title: string) => ({
    profile: 'browser-driver',
    title,
    brief: `Complete ${title}.`,
    definition_of_done: 'Record the result.',
  })
  const one = await callOn(firstTools, 'give_work', give('First caller job'))
  const two = await callOn(secondTools, 'give_work', give('Second caller job'))
  const service = one.agent as string
  const recipient = { id: service, address: service, title: serviceName }
  const line = `conversation ${service} · ${serviceName}`
  expect(one).toMatchObject({ outcome: 'ok', receipt: { recipient } })
  expect(two).toMatchObject({ outcome: 'ok', agent: service, receipt: { recipient } })
  expect(world.store.firstTaskOf(service)?.label).toBe(one.label)
  expect(world.store.latestTaskTitle(service)).toBe('Second caller job')
  expect(host.addressOf(service)).toBe(service)
  expect(host.nameByItsWork(service)).toBe(line)
  expect(
    await executeRuntimeCommand(host, world.window, {
      kind: 'readConversationIdentity',
      sessionId: service,
    }),
  ).toEqual({ conversation: service, address: service, title: serviceName, author: null })

  const directory = await answerOn(firstTools, 'list_agents', { profile: 'browser-driver' })
  const status = await answerOn(secondTools, 'get_agent_status', { agent: service })
  const transcript = await answerOn(secondTools, 'read_transcript', { agent: service })
  const tasks = await answerOn(firstTools, 'list_tasks', { conversation: service })
  expect(directory.text).toContain(line)
  expect(status.text.startsWith(line)).toBe(true)
  expect(transcript.text).toContain(line)
  expect(tasks.text.startsWith(line)).toBe(true)
  expect(tasks.structured).toMatchObject({
    outcome: 'ok',
    tasks: expect.arrayContaining([
      expect.objectContaining({ label: one.label, title: 'First caller job' }),
      expect.objectContaining({ label: two.label, title: 'Second caller job' }),
    ]),
  })

  world.anAgent('normal-reader', 'nothing kept')
  const ordinary = await callOn(
    firstTools,
    'give_work',
    newConversationGive('normal-reader', 'Ordinary job', 'Complete the ordinary job.'),
  )
  const ordinaryAddress = ordinary.label as string
  const ordinaryLine = `conversation ${ordinaryAddress} · Ordinary job`
  expect(ordinary.outcome).toBe('ok')
  expect(host.addressOf(ordinary.agent as string)).toBe(ordinaryAddress)
  expect(host.nameByItsWork(ordinary.agent as string)).toBe(ordinaryLine)

  const search = new WorkSearchEngine(world.db.name)
  try {
    expect(search.read(first, { profile: 'browser-driver' })).toMatchObject({
      ok: true,
      page: {
        hits: [{ conversation: service, address: service, title: serviceName, line }],
      },
    })
    expect(search.read(first, { profile: 'normal-reader' })).toMatchObject({
      ok: true,
      page: {
        hits: [{ conversation: ordinary.agent, address: ordinaryAddress, line: ordinaryLine }],
      },
    })
  } finally {
    search.close()
  }

  await host.closeAll()
  world.store.append(
    service,
    world.store.nextOrdinal(service),
    { type: 'user_turn', text: 'serviceidentityquartz' },
    world.clock,
  )
  const past = world.store.searchPastWork(first, 'serviceidentityquartz', 'browser-driver')
  expect(past).toMatchObject({
    ok: true,
    hits: [{ conversation: service, line }],
  })
})
