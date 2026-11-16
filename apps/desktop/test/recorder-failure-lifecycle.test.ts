import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { aHostOverScriptedCodex, Window } from './lib/scripted-codex-host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THE_APP_ITSELF } from './helpers/giver-notice-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

const gate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('a recorder failure leaves the provider lifecycle intact', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string
  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent('helper', 'normal')
    host = world.aHost({ servicesOn: false })
    giver = (
      await host.createSession(
        { provider: 'claude', profileId: 'giver', cwd: world.folder, approvalMode: 'auto' },
        world.window,
      )
    ).sessionId
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('retains a failed new launch until its registered provider is closed', async () => {
    const closing = gate()
    const registry = (host as unknown as { launches: { readonly size: number } }).launches
    const before = registry.size
    let closeAsked = false
    const write = vi.spyOn(world.store, 'create').mockImplementation(() => {
      const handle = world.handles.at(-1)!.handle
      const close = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        closeAsked = true
        await closing.promise
        close()
      })
      throw new Error('fictional registration write failure')
    })
    let settled = false
    const creating = host.createSession(
      { provider: 'claude', profileId: 'helper', cwd: world.folder },
      world.window,
    )
    const checked = expect(creating).rejects.toThrow(/could not save/)
    void creating.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    try {
      await vi.waitFor(() => expect(closeAsked).toBe(true))
      expect(settled).toBe(false)
      expect(registry.size).toBe(before + 1)
    } finally {
      closing.release()
    }
    await checked
    expect(registry.size).toBe(before)
    write.mockRestore()
    await expect(
      host.createSession(
        { provider: 'claude', profileId: 'helper', cwd: world.folder },
        world.window,
      ),
    ).resolves.toBeDefined()
  })

  it('handles a failed detached unanswered-stop record and attempts the next write', async () => {
    const root = join(world.folder, 'scripted-stop')
    mkdirSync(root)
    const rig = aHostOverScriptedCodex(root, { interruptWaitMs: 40 })
    const window = new Window('webContents:scripted-stop')
    try {
      const { sessionId: id } = await rig.host.createSession(
        { provider: 'codex', cwd: root },
        window,
      )
      await rig.host.send(id, 'A fictional held turn.', window)
      const server = rig.servers.at(-1)!
      await vi.waitFor(() => expect(server.sent('turn/start')).toHaveLength(1))
      await new Promise((resolve) => setTimeout(resolve, 20))
      server.interruptAnswer = 'never'
      const append = rig.store.append.bind(rig.store)
      const write = vi.spyOn(rig.store, 'append').mockImplementation((...args) => {
        if (args[2].type === 'stop_unanswered') throw new Error('fictional full disk')
        return append(...args)
      })
      await rig.host.interrupt(id, window)
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(rig.store.events(id).some((one) => one.event.type === 'stop_unanswered')).toBe(false)
      expect(
        window.messages.some(
          (one) =>
            one.event.type === 'error' &&
            one.event.message.includes('could not save') &&
            one.event.fatal === false,
        ),
      ).toBe(true)
      expect(
        vi
          .mocked(console.warn)
          .mock.calls.filter(([line]) => String(line).includes('runtime write failed:')),
      ).toHaveLength(1)
      write.mockRestore()
      rig.host.noteUserCommand(id, 'closed', window)
      expect(rig.store.events(id).some((one) => one.event.type === 'user_command')).toBe(true)
    } finally {
      await rig.host.closeAll()
      rig.db.close()
    }
  })

  it.each(['provider row', 'reopen event'] as const)(
    'owns the provider until cleanup when the registered %s cannot be saved',
    async (where) => {
      await host.close(giver, world.window)
      const closing = gate()
      let closeAsked = false
      const fail = () => {
        const resumed = world.handles.at(-1)!.handle
        const close = resumed.close.bind(resumed)
        vi.spyOn(resumed, 'close').mockImplementation(async () => {
          closeAsked = true
          await closing.promise
          close()
        })
        throw new Error('fictional full disk')
      }
      const append = world.store.append.bind(world.store)
      const write =
        where === 'provider row'
          ? vi.spyOn(world.store, 'reopened').mockImplementation(fail)
          : vi.spyOn(world.store, 'append').mockImplementation((...args) => {
              if (args[2].type === 'reopened') fail()
              return append(...args)
            })
      let settled = false
      const reopening = host.resumeSession(giver, world.window)
      const checked = expect(reopening).rejects.toThrow(/could not save/)
      void reopening.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await vi.waitFor(() => expect(closeAsked).toBe(true))
      expect(settled).toBe(false)
      closing.release()
      await checked
      write.mockRestore()
      await expect(host.resumeSession(giver, world.window)).resolves.toBeDefined()
    },
  )

  it.each([false, true])(
    'delivers the ending and flushes held words after an auxiliary write fails (primary fails: %s)',
    async (primaryFails) => {
      const turn = gate()
      world.turnsWait = turn.promise
      await host.send(giver, 'First fictional turn.', world.window)
      await host.queueMessage(giver, 'Held fictional words.', world.window)
      const handle = world.handles.find((one) => one.as === 'giver')!.handle
      Object.defineProperty(handle, 'agentInfo', {
        configurable: true,
        value: { model: 'fictional-new-model' },
      })
      vi.spyOn(world.store, 'setReportedModel').mockImplementation(() => {
        throw new Error('fictional auxiliary failure')
      })
      const append = world.store.append.bind(world.store)
      if (primaryFails)
        vi.spyOn(world.store, 'append').mockImplementation((...args) => {
          if (args[2].type === 'status' && args[2].state === 'idle') {
            throw new Error('fictional primary failure')
          }
          return append(...args)
        })
      const from = world.window.messages.length
      world.turnsWait = null
      turn.release()
      await vi.waitFor(() =>
        expect(
          world.sent.filter((one) => one.words.includes('Held fictional words.')),
        ).toHaveLength(1),
      )
      const messages = world.window.messages.slice(from).filter((one) => one.sessionId === giver)
      const ending = messages.findIndex(
        (one) => one.event.type === 'status' && one.event.state === 'idle',
      )
      expect(ending).toBeGreaterThanOrEqual(0)
      const failures = messages.filter(
        (one) => one.event.type === 'error' && one.event.message.includes('could not save'),
      )
      expect(failures.length).toBeGreaterThan(0)
      expect(messages[ending + 1]?.event.type).toBe('error')
      expect(
        messages.every((one, index) => index === 0 || messages[index - 1]!.ordinal < one.ordinal),
      ).toBe(true)
      if (!primaryFails)
        expect(
          world.ledger(giver).some((one) => one.type === 'status' && one.state === 'idle'),
        ).toBe(true)
    },
  )

  it.each(['ledger', 'hold'] as const)(
    'contains failed %s continuations after startup repair',
    async (path) => {
      const internals = host as unknown as {
        startupRepairs: Set<string>
        settleBeforeUse(id: string): Promise<void>
        writeIntoItsLedger(
          id: string,
          row: { type: 'question_withdrawn'; requestId: string },
          landed: () => void,
        ): void
        holdUntilItStarts(
          id: string,
          text: string,
          facts: Record<string, never>,
          kind: 'notice',
          kept: (where: string) => void,
        ): void
      }
      const repairing = gate()
      internals.startupRepairs.add(giver)
      vi.spyOn(internals, 'settleBeforeUse').mockImplementation(async () => {
        await repairing.promise
        internals.startupRepairs.delete(giver)
      })
      const append = world.store.append.bind(world.store)
      const write = vi.spyOn(world.store, 'append').mockImplementation((...args) => {
        if (args[2].type === (path === 'ledger' ? 'question_withdrawn' : 'message_queued')) {
          throw new Error('fictional write after startup repair')
        }
        return append(...args)
      })
      const completed = vi.fn()
      if (path === 'ledger') {
        internals.writeIntoItsLedger(
          giver,
          { type: 'question_withdrawn', requestId: 'startup-question' },
          completed,
        )
      } else
        internals.holdUntilItStarts(giver, 'Fictional deferred notice.', {}, 'notice', completed)
      expect(completed).not.toHaveBeenCalled()
      repairing.release()
      await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(completed.mock.calls).toEqual(path === 'hold' ? [['nowhere']] : [])
      expect(vi.mocked(console.warn).mock.calls).toHaveLength(1)
      expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain('runtime write failed:')
      expect(
        world
          .ledger(giver)
          .some(
            (one) =>
              one.type === 'question_withdrawn' ||
              (one.type === 'message_queued' && one.text === 'Fictional deferred notice.'),
          ),
      ).toBe(false)
      write.mockRestore()
      host.noteUserCommand(giver, 'closed', world.window)
      expect(world.ledger(giver).some((one) => one.type === 'user_command')).toBe(true)
    },
  )

  it.each([false, true])(
    'a deferred write reports completion only after a commit (fails: %s)',
    async (fails) => {
      const starting = gate()
      world.startsWait = starting.promise
      const internals = host as unknown as {
        slots: Map<string, { session: unknown }>
        writeIntoItsLedger(
          id: string,
          row: { type: 'question_withdrawn'; requestId: string },
          landed: () => void,
        ): void
      }
      const giving = world.gives(host, giver, 'helper')
      await vi.waitFor(() => expect(internals.slots.size).toBe(2))
      const id = [...internals.slots.keys()].find((one) => one !== giver)!
      const append = world.store.append.bind(world.store)
      if (fails)
        vi.spyOn(world.store, 'append').mockImplementation((...args) => {
          if (args[2].type === 'question_withdrawn') throw new Error('fictional deferred failure')
          return append(...args)
        })
      const landed = vi.fn()
      internals.writeIntoItsLedger(
        id,
        { type: 'question_withdrawn', requestId: 'fictional-question' },
        landed,
      )
      expect(landed).not.toHaveBeenCalled()
      world.startsWait = null
      starting.release()
      expect((await giving).ok).toBe(true)
      await vi.waitFor(() => expect(fails ? console.warn : landed).toHaveBeenCalled())
      expect(landed).toHaveBeenCalledTimes(fails ? 0 : 1)
      expect(world.ledger(id).some((one) => one.type === 'question_withdrawn')).toBe(!fails)
      await host.close(id, THE_APP_ITSELF)
    },
  )
})
