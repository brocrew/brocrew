import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { aServiceWorld, acceptedGive, type AServiceWorld } from './helpers/a-service-world'

/**
 * Card 197, batch 1: work that meets a conversation still starting waits for that start, however
 * long a slow PC takes, instead of a clock of its own refusing or skipping ahead. The start is held
 * in its resume while fake time runs well past the bound each wait used to keep. The call is made
 * under fake time, so an old-style bound would fire; the start's own launch clock was armed before,
 * as a real timer, so it cannot.
 */
describe('a conversation starting slowly is waited for, not refused', () => {
  let world: AServiceWorld
  let letItStart: () => void
  beforeEach(() => {
    world = aServiceWorld()
    letItStart = () => undefined
  })
  afterEach(async () => {
    world.resumesWait = null
    letItStart()
    await world.cleanUp()
  })

  /**
   * Makes the call under fake time, so any clock it arms is fake, runs `ms` of that time, then
   * real time again. Returns the call's promise and whether it was still waiting.
   */
  const callUnderFakeTime = async <T>(
    ms: number,
    call: () => Promise<T>,
  ): Promise<{ readonly done: Promise<T>; readonly waiting: boolean }> => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let settled = false
    try {
      const done = call()
      void done.then(
        () => (settled = true),
        () => (settled = true),
      )
      await vi.advanceTimersByTimeAsync(ms)
      return { done, waiting: !settled }
    } finally {
      vi.useRealTimers()
    }
  }
  const held = () => new Promise<void>((resolve) => (letItStart = resolve))

  it('a give to a service that is starting waits for the start, then goes into it', async () => {
    world.anAgent('browser-driver')
    world.anAgent('caller', 'nothing kept')
    const setUp = held()
    const host = world.aHost({
      beforePreparingHome: (profile) => (profile === 'browser-driver' ? setUp : undefined),
    })
    const caller = await world.aPersonOpens(host, 'caller')
    const one = acceptedGive(await world.gives(host, caller, 'browser-driver', { title: 'One' }))
    // Past the 3 × 15 s the admission used to wait before going ahead without the service.
    const giving = await callUnderFakeTime(50_000, () =>
      world.gives(host, caller, 'browser-driver', { title: 'Two' }),
    )
    expect(giving.waiting, 'still waiting for the start').toBe(true)
    letItStart()
    expect(acceptedGive(await giving.done).owner).toBe(one.owner)
  })

  it("a person's answer to a question waits for its asker's start, then is taken", async () => {
    world.anAgent('boss', 'nothing kept')
    const host = world.aHost()
    const boss = await world.aPersonOpens(host, 'boss')
    const ask = agentToolsFor(host, boss).tools.find((tool) => tool.name === 'ask_question')!
    const asked = await ask.call({ question: 'which floor?', who_answers: 'a-person' })
    const question = String((asked.structured as Record<string, unknown>)['question'])
    await host.look(boss, world.window, true)
    await host.close(boss, world.window)
    world.resumesWait = held()
    const resumed = world.resumesAsked
    const starting = host.send(boss, 'Carry on.', world.window).catch(() => undefined)
    await vi.waitFor(() => {
      expect(world.resumesAsked).toBeGreaterThan(resumed)
    })
    const answer = { kind: 'answer' as const, answers: { answer: ['the third'] } }
    // Past the 15 s the decision used to give the asker's start before it threw.
    const answering = await callUnderFakeTime(20_000, () =>
      host.respondUserInput(boss, question, answer, world.window),
    )
    void answering.done.catch(() => undefined)
    expect(answering.waiting, 'still waiting for the start').toBe(true)
    world.resumesWait = null
    letItStart()
    await starting
    await expect(answering.done).resolves.toMatchObject({ outcome: 'taken' })
  })
})
