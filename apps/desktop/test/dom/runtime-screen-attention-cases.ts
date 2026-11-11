import { expect, it, vi } from 'vitest'
import { nextTick, type Component } from 'vue'
import { AttentionSignals, ATTENTION_SIGNAL_INTERVAL_MS } from '../../src/main/attention-signals'
import { isAttentionSignal, type AttentionSignal } from '../../src/shared/attention-signals'
import type { WorkIncident } from '../../src/shared/work-incidents'
import type { PersonsQuestion, RoutedRequest } from '../../src/shared/question-contracts'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import { chainReading, escalationChain, NOTHING_NAMED_THE_WORK } from '../../src/shared/questions'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { runtime, walk } from './runtime-screen-fixture'
import { mount } from './harness'

export function registerRootAttentionCases(RuntimeScreen: Component) {
  function deferredAttentionRead<T>() {
    let complete: (value: T) => void = () => {
      throw new Error('Deferred not initialized.')
    }
    const promise = new Promise<T>((resolve) => {
      complete = resolve
    })
    return { promise, resolve: (value: T) => complete(value) }
  }

  function todoQuestion(id: string): PersonsQuestion {
    const request: RoutedRequest = {
      requestId: id,
      askedBy: 'fictional-requester',
      parent: null,
      went: { is: 'the-person-the-asker-named', to: 'a-person' },
      at: 1,
      state: 'open',
      endedAt: null,
      escalatedAt: null,
    }
    const chain = escalationChain(request, () => null)
    return {
      request,
      chain,
      reading: chainReading(chain, () => 'A fictional agent'),
      sentence: 'An agent asks for a fictional action.',
      aPersonsSince: 1,
      work: [],
      about: NOTHING_NAMED_THE_WORK,
      raisedBy: 'the-provider',
      offered: null,
      asked: null,
      action: { text: 'Do a fictional action.', files: [] },
    }
  }

  function incident(id: string): WorkIncident {
    return {
      piece: id,
      label: 'W1',
      title: 'Fictional work',
      holder: 'fictional-holder',
      holderName: 'An agent',
      giver: null,
      giverName: null,
      kind: 'stopped',
      since: 1,
    }
  }

  function nativeAttention(platform = 'darwin') {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let now = 0
    const effects = {
      platform,
      isFocused: vi.fn(() => false),
      badge: vi.fn(),
      bounce: vi.fn(() => 7),
      cancelBounce: vi.fn(),
      flash: vi.fn(),
      overlay: vi.fn(),
    }
    const native = new AttentionSignals(effects, () => now)
    const packets: AttentionSignal[] = []
    window.api = {
      ...window.api,
      attentionSignals: async (packet: AttentionSignal) => {
        if (!isAttentionSignal(packet)) throw new Error('Invalid attention signal.')
        packets.push(packet)
        native.update(packet)
      },
    }
    return {
      effects,
      native,
      packets,
      advance: () => {
        now += ATTENTION_SIGNAL_INTERVAL_MS
      },
      summons: () =>
        platform === 'darwin'
          ? effects.bounce.mock.calls.length
          : effects.flash.mock.calls.filter(([on]) => on === true).length,
    }
  }

  async function nextAttentionPoll() {
    await vi.advanceTimersByTimeAsync(5_000)
    await nextTick()
  }

  async function badgeAt(native: ReturnType<typeof nativeAttention>, count: number) {
    await expect.poll(() => native.packets.at(-1)?.count, { timeout: 750 }).toBe(count)
  }

  it.each(['darwin', 'win32'])(
    'real screen packets cannot replay a summons on %s',
    async (platform) => {
      const native = nativeAttention(platform)
      runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('old')] })
      mount(RuntimeScreen, {})
      await badgeAt(native, 1)
      expect(native.summons()).toBe(0)
      runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('new')] })
      native.advance()
      await nextAttentionPoll()
      await expect.poll(native.summons, { timeout: 750 }).toBe(1)
      const packet = native.packets.at(-1)
      if (packet === undefined) throw new Error('The screen did not publish an arrival.')
      for (let repeat = 0; repeat < 3; repeat++) {
        native.advance()
        await window.api.attentionSignals(packet)
      }
      expect(native.summons()).toBe(1)
    },
  )

  it.each(['todos', 'incidents'] as const)(
    'launch and reload baseline existing %s from the real queue silently',
    async (kind) => {
      const native = nativeAttention()
      const oldQuestions = { ...walk(), rows: kind === 'todos' ? [todoQuestion('old')] : [] }
      const oldIncidents = { ...walk(), rows: kind === 'incidents' ? [incident('old')] : [] }
      for (let life = 0; life < 2; life++) {
        const questions =
          deferredAttentionRead<Awaited<ReturnType<RuntimeBridge['questionsForAPerson']>>>()
        const incidents =
          deferredAttentionRead<Awaited<ReturnType<RuntimeBridge['workIncidentsForAPerson']>>>()
        runtime.questionsForAPerson
          .mockResolvedValue(oldQuestions)
          .mockReturnValueOnce(questions.promise)
        runtime.workIncidentsForAPerson
          .mockResolvedValue(oldIncidents)
          .mockReturnValueOnce(incidents.promise)
        const screen = mount(RuntimeScreen, {})
        await badgeAt(native, 0)
        // These are the real queue's initial flags; neither means a successful read happened.
        expect(usePersonsQueue().workWaits.value.todos.unread).toBe(false)
        expect(usePersonsQueue().workWaits.value.incidents.unread).toBe(false)
        questions.resolve(oldQuestions)
        incidents.resolve(oldIncidents)
        await badgeAt(native, 1)
        expect(native.summons()).toBe(life)
        if (kind === 'todos') {
          runtime.questionsForAPerson.mockResolvedValue({
            ...walk(),
            rows: [todoQuestion('old'), todoQuestion('new')],
          })
        } else {
          runtime.workIncidentsForAPerson.mockResolvedValue({
            ...walk(),
            rows: [incident('old'), incident('new')],
          })
        }
        native.advance()
        await nextAttentionPoll()
        await badgeAt(native, 2)
        expect(native.summons()).toBe(life + 1)
        screen.unmount()
        native.native.reloaded()
      }
    },
  )

  it('two consecutive same-count replacements reach native through the real screen, while unchanged reads stay quiet', async () => {
    const native = nativeAttention()
    runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('a')] })
    mount(RuntimeScreen, {})
    await badgeAt(native, 1)
    const baseline = native.packets.at(-1)?.arrival ?? -1
    for (const id of ['b', 'c']) {
      native.advance()
      runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident(id)] })
      await nextAttentionPoll()
    }
    await expect.poll(native.summons, { timeout: 750 }).toBe(2)
    const arrivals = native.packets.filter((packet) => packet.arrival > baseline)
    expect(arrivals).toHaveLength(2)
    expect(arrivals[0]?.arrival).toBeLessThan(arrivals[1]?.arrival ?? -1)
    const calls = native.packets.length
    await nextAttentionPoll()
    expect(native.packets).toHaveLength(calls)
    expect(native.summons()).toBe(2)
  })

  it('a focused same-count replacement cannot hide the next unfocused arrival', async () => {
    const native = nativeAttention()
    runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('a')] })
    mount(RuntimeScreen, {})
    await badgeAt(native, 1)
    native.effects.isFocused.mockReturnValue(true)
    runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('b')] })
    await nextAttentionPoll()
    expect(native.summons()).toBe(0)
    native.effects.isFocused.mockReturnValue(false)
    runtime.workIncidentsForAPerson.mockResolvedValue({ ...walk(), rows: [incident('c')] })
    await nextAttentionPoll()
    await expect.poll(native.summons, { timeout: 750 }).toBe(1)
  })
}
