import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  profileExecutionFile,
  readProfileExecution,
  writeProfileExecution,
} from '../src/main/profile-execution-file'
import {
  DEFAULT_CAPABILITIES,
  skipTheLedger,
  type RowsUnread,
  type SessionStore,
} from '../src/main/db/session-store'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { admitGive, type GiveFacts, type ServiceAtAGive } from '../src/main/runtime/spawn-rails'
import {
  MAX_WAITS_WALKED,
  THE_APP_ITSELF,
  type GiveOutcome,
  type RuntimeHost,
} from '../src/main/runtime/runtime-host'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

/**
 * Work given to a service queues on its one conversation: owned by it, given by its caller, in the
 * order it was given, and never handed over here — a service's pieces wait their turn, and nothing
 * yet takes them. Reached through the host alone: services are switched off in the app.
 */

describe('a service queues the work it is given', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  const accepted = (outcome: GiveOutcome): Extract<GiveOutcome, { ok: true }> => {
    if (!outcome.ok) throw new Error(`refused (${outcome.refusal.rail}): ${outcome.refusal.reason}`)
    return outcome
  }
  const refusedAs = (outcome: GiveOutcome): string => {
    if (outcome.ok) throw new Error(`given, to ${outcome.owner}`)
    return outcome.refusal.rail
  }
  /** Agents for a service and two callers, and a host. */
  const aServiceAndTwoCallers = async (
    opts: { servicesOn?: boolean } = {},
  ): Promise<{ host: RuntimeHost; first: string; second: string }> => {
    world.anAgent('browser-driver')
    world.anAgent('caller', 'nothing kept')
    world.anAgent('other-caller', 'nothing kept')
    const host = world.aHost(opts)
    return {
      host,
      first: await world.aPersonOpens(host, 'caller'),
      second: await world.aPersonOpens(host, 'other-caller'),
    }
  }

  /** Until `piece` at `service` has been handed over: open, and no longer waiting. */
  const handedOver = async (service: string, piece: string): Promise<void> => {
    await vi.waitFor(() => {
      const row = world.store.piecesOwnedBy(service).find((one) => one.piece === piece)
      expect(row?.state).not.toBe('waiting')
    })
  }
  /**
   * `caller` gives the service a piece and the service starts on it, so every piece given after it
   * queues behind it: its turn waits on a person's approval, and it stays on that piece.
   */
  const aServiceAtWork = async (
    host: RuntimeHost,
    caller: string,
  ): Promise<Extract<GiveOutcome, { ok: true }>> => {
    const busy = accepted(await world.gives(host, caller, 'browser-driver', { title: 'Busy' }))
    await handedOver(busy.owner, busy.piece)
    await vi.waitFor(() => {
      expect(world.ledger(busy.owner).some((row) => row.type === 'permission_request')).toBe(true)
    })
    return busy
  }

  describe('a give to a service', () => {
    it('is queued on its one conversation, given by its caller: the oldest is handed over, the rest wait their turn', async () => {
      const { host, first, second } = await aServiceAndTwoCallers()
      const one = accepted(await world.gives(host, first, 'browser-driver', { title: 'One' }))
      const two = accepted(await world.gives(host, second, 'browser-driver', { title: 'Two' }))
      const three = accepted(await world.gives(host, first, 'browser-driver', { title: 'Three' }))
      expect(two.owner).toBe(one.owner)
      expect(three.owner).toBe(one.owner)
      expect([one.queuedBehind, two.queuedBehind, three.queuedBehind]).toEqual([0, 1, 2])
      expect([one.delivery, two.delivery, three.delivery]).toEqual(['held', 'held', 'held'])
      // Each hangs under its own caller's work, labelled there.
      expect(one.label).toMatch(/^W1\.\d+$/)
      expect(two.label).toMatch(/^W2\.\d+$/)

      const service = one.owner
      await handedOver(service, one.piece)
      const pieces = world.store.piecesOwnedBy(service)
      expect(pieces.map((piece) => [piece.title, piece.state, piece.giver])).toEqual([
        ['One', 'working', first],
        ['Two', 'waiting', second],
        ['Three', 'waiting', first],
      ])
      // Only the oldest's brief was held for it, and only the service was started for it.
      const held = world
        .ledger(service)
        .flatMap((row) => (row.type === 'message_queued' ? [row.piece] : []))
      expect(held).toEqual([one.piece])
      expect(world.startedAs).toEqual(['caller', 'other-caller', 'browser-driver'])
    })

    it('says on each caller’s board how many pieces are ahead of its own', async () => {
      const { host, first, second } = await aServiceAndTwoCallers()
      accepted(await world.gives(host, first, 'browser-driver', { title: 'One' }))
      accepted(await world.gives(host, second, 'browser-driver', { title: 'Two' }))
      accepted(await world.gives(host, first, 'browser-driver', { title: 'Three' }))
      const board = host.pieceBoard(first)
      expect(board.gave.map((row) => [row.title, row.queuedBehind])).toEqual([
        ['One', 0],
        ['Three', 2],
      ])
      expect(host.pieceBoard(second).gave.map((row) => row.queuedBehind)).toEqual([1])
    })

    it('records the folder it names for the piece, granted when its turn comes', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      const given = accepted(
        await world.gives(host, first, 'browser-driver', { folder: world.folder }),
      )
      expect(given.givenFolder).toMatchObject({ folder: world.folder, use: 'grant' })
      expect(given.grantReach).toBeNull()
    })

    it('outlives a restart queued: only the piece being worked on stalls', async () => {
      const { host, first, second } = await aServiceAndTwoCallers()
      const one = accepted(await world.gives(host, first, 'browser-driver'))
      const two = accepted(await world.gives(host, second, 'browser-driver'))
      await handedOver(one.owner, one.piece)
      // The control: a person's conversation holding a held brief is swept.
      world.anAgent('worker', 'nothing kept')
      world.store.create({
        id: 'sess_worker',
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'ask',
        profileId: 'worker',
        parentSessionId: first,
      })
      const root = world.store.rootOf(first)
      if (root === null) throw new Error('the caller owns no root')
      world.store.recordGive(
        {
          piece: 'work_for_the_worker',
          parent: root.piece,
          number: 99,
          owner: 'sess_worker',
          givenBy: first,
          title: 'Sweep me',
          brief: 'a held brief',
          folder: null,
          inputs: [],
        },
        world.store.nextOrdinal('sess_worker'),
        {
          type: 'work_given',
          piece: 'work_for_the_worker',
          label: `${root.label}.99`,
          parent: root.piece,
          givenBy: first,
          title: 'Sweep me',
          brief: 'a held brief',
          messageId: 'msg_held',
        },
        world.clock++,
      )
      await host.closeAll()

      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      world.aHost()
      info.mockRestore()
      const restarted = world
        .ledger(one.owner)
        .flatMap((row) => (row.type === 'work_restarted' ? [...(row.pieces ?? [])] : []))
      expect(restarted).not.toContain(two.piece)
      expect(world.store.piecesOwnedBy(one.owner).map((piece) => piece.state)).toEqual([
        'stalled',
        'waiting',
      ])
      expect(world.ledger('sess_worker').some((row) => row.type === 'work_restarted')).toBe(true)
    })
  })

  describe('a give it refuses', () => {
    it('while services are switched off', async () => {
      const { host, first } = await aServiceAndTwoCallers({ servicesOn: false })
      expect(refusedAs(await world.gives(host, first, 'browser-driver'))).toBe('services-are-off')
      expect(world.conversationsRecorded()).toBe(2)
    })

    it('where this app can’t tell it is the only one on its data', async () => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost({ owned: false })
      const caller = await world.aPersonOpens(host, 'caller')
      expect(refusedAs(await world.gives(host, caller, 'browser-driver'))).toBe('services-are-off')
    })

    it('where its kind can’t be told and the database holds a service’s conversation for it', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      accepted(await world.gives(host, first, 'browser-driver'))
      await host.closeAll()
      writeFileSync(profileExecutionFile(world.folder), 'not json')
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const next = world.aHost()
      const caller = await world.aPersonOpens(next, 'caller')
      expect(refusedAs(await world.gives(next, caller, 'browser-driver'))).toBe(
        'its-kind-is-unknown',
      )
      warned.mockRestore()
    })

    it('…while an agent with no service’s conversation is given work as today', async () => {
      world.anAgent('browser-driver', 'nothing kept')
      world.anAgent('caller', 'nothing kept')
      writeFileSync(profileExecutionFile(world.folder), 'not json')
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const host = world.aHost()
      const caller = await world.aPersonOpens(host, 'caller')
      const given = accepted(await world.gives(host, caller, 'browser-driver'))
      expect(world.store.parentOf(given.owner)).toBe(caller)
      expect(given.queuedBehind).toBeUndefined()
      warned.mockRestore()
    })

    it('that would close a wait: the service already waits on the caller through work it gave', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      const { owner: service } = accepted(await world.gives(host, first, 'browser-driver'))
      // The service gave a piece to a helper, which gave one to the caller.
      world.anAgent('helper', 'nothing kept')
      world.store.create({
        id: 'sess_helper',
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'ask',
        profileId: 'helper',
        parentSessionId: first,
      })
      const servicePiece = world.store.piecesOwnedBy(service)[0]
      if (servicePiece === undefined) throw new Error('the service holds nothing')
      const aGive = (from: string, to: string, under: string, label: string, id: string): void =>
        world.store.recordGive(
          {
            piece: id,
            parent: under,
            number: 50,
            owner: to,
            givenBy: from,
            title: 'Wait',
            brief: 'wait',
            folder: null,
            inputs: [],
          },
          world.store.nextOrdinal(to),
          {
            type: 'work_given',
            piece: id,
            label,
            parent: under,
            givenBy: from,
            title: 'Wait',
            brief: 'wait',
          },
          world.clock++,
        )
      aGive(
        service,
        'sess_helper',
        servicePiece.piece,
        `${servicePiece.label}.50`,
        'work_to_helper',
      )
      const toHelper = world.store.piecesOwnedBy('sess_helper')[0]
      if (toHelper === undefined) throw new Error('the helper holds nothing')
      // Not a wait on the caller yet: the helper gave the caller nothing.
      expect(accepted(await world.gives(host, first, 'browser-driver')).owner).toBe(service)
      await host.closeAll()

      const root = world.store.rootOf(first)
      if (root === null) throw new Error('the caller owns no root')
      // The caller now holds a piece the helper gave it: the service waits on the caller.
      world.store.recordGive(
        {
          piece: 'work_to_caller',
          parent: toHelper.piece,
          number: 51,
          owner: first,
          givenBy: 'sess_helper',
          title: 'Wait',
          brief: 'wait',
          folder: null,
          inputs: [],
        },
        world.store.nextOrdinal(first),
        {
          type: 'work_given',
          piece: 'work_to_caller',
          label: `${toHelper.label}.51`,
          parent: toHelper.piece,
          givenBy: 'sess_helper',
          title: 'Wait',
          brief: 'wait',
        },
        world.clock++,
      )
      const next = world.aHost()
      const caller = await next.resumeSession(first, world.window, null)
      expect(
        refusedAs(
          await next.giveWork(
            {
              profile: 'browser-driver',
              title: 'Late',
              brief: 'late',
              piece: root.label,
              definition_of_done: 'The requested result and its checks are recorded.',
            },
            { ownerId: agentCallerId(caller.sessionId) },
          ),
        ),
      ).toBe('it-would-wait-on-itself')
    })

    it('that would close a wait through a conversation that took another’s place', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      const { owner: service } = accepted(await world.gives(host, first, 'browser-driver'))
      const servicePiece = world.store.piecesOwnedBy(service)[0]
      if (servicePiece === undefined) throw new Error('the service holds nothing')
      await host.closeAll()
      // The service gave work to a helper, which gave the caller work, and could never be reopened:
      // another conversation took its place, and stands for what it gave.
      world.anAgent('helper', 'nothing kept')
      for (const id of ['sess_old_helper', 'sess_new_helper']) {
        world.store.create({
          id,
          provider: 'claude',
          cwd: world.folder,
          approvalMode: 'ask',
          profileId: 'helper',
          parentSessionId: first,
        })
      }
      const record = (from: string, to: string, parent: string, label: string, id: string) =>
        world.store.recordGive(
          {
            piece: id,
            parent,
            number: 60,
            owner: to,
            givenBy: from,
            title: 'Wait',
            brief: 'wait',
            folder: null,
            inputs: [],
          },
          world.store.nextOrdinal(to),
          {
            type: 'work_given',
            piece: id,
            label,
            parent,
            givenBy: from,
            title: 'Wait',
            brief: 'wait',
          },
          world.clock++,
        )
      record(service, 'sess_old_helper', servicePiece.piece, `${servicePiece.label}.60`, 'work_a')
      record('sess_old_helper', first, 'work_a', `${servicePiece.label}.60.1`, 'work_b')
      world.store.append(
        'sess_old_helper',
        world.store.nextOrdinal('sess_old_helper'),
        { type: 'replaced_by', sessionId: 'sess_new_helper' },
        world.clock++,
      )
      const next = world.aHost()
      const caller = await next.resumeSession(first, world.window, null)
      const root = world.store.rootOf(first)
      if (root === null) throw new Error('the caller owns no root')
      expect(
        refusedAs(
          await next.giveWork(
            {
              profile: 'browser-driver',
              title: 'Late',
              brief: 'late',
              piece: root.label,
              definition_of_done: 'The requested result and its checks are recorded.',
            },
            { ownerId: agentCallerId(caller.sessionId) },
          ),
        ),
      ).toBe('it-would-wait-on-itself')
    })

    describe('where the service’s open work reaches more conversations than the check reads', () => {
      /**
       * The service gives `helpers` conversations an open piece each; with `closing`, the first of
       * them gives the caller one, so the service waits on it. The walk reads the service first,
       * then the helpers from the newest, so the first is read last. With `torn`, a status line in
       * the first helper's ledger can't be read: the walk reads it with the service, before its
       * budget is spent.
       */
      const aServiceThatGaveTo = async (
        helpers: number,
        closing: boolean,
        torn = false,
      ): Promise<{ host: RuntimeHost; caller: string; root: string }> => {
        const { host, first } = await aServiceAndTwoCallers()
        const { owner: service } = accepted(await world.gives(host, first, 'browser-driver'))
        const held = world.store.piecesOwnedBy(service)[0]
        if (held === undefined) throw new Error('the service holds nothing')
        await host.closeAll()
        world.anAgent('helper', 'nothing kept')
        const aGive = (from: string, to: string, parent: string, label: string, id: string): void =>
          world.store.recordGive(
            {
              piece: id,
              parent,
              number: 1000 + Number(id.split('_').at(-1)),
              owner: to,
              givenBy: from,
              title: 'Wait',
              brief: 'wait',
              folder: null,
              inputs: [],
            },
            world.store.nextOrdinal(to),
            {
              type: 'work_given',
              piece: id,
              label,
              parent,
              givenBy: from,
              title: 'Wait',
              brief: 'wait',
            },
            world.clock++,
          )
        for (let at = 0; at < helpers; at += 1) {
          const helper = `sess_helper_${String(at)}`
          world.store.create({
            id: helper,
            provider: 'claude',
            cwd: world.folder,
            approvalMode: 'ask',
            profileId: 'helper',
            parentSessionId: first,
          })
          aGive(
            service,
            helper,
            held.piece,
            `${held.label}.${String(1000 + at)}`,
            `work_h_${String(at)}`,
          )
        }
        if (closing) {
          aGive('sess_helper_0', first, 'work_h_0', `${held.label}.1000.1`, 'work_c_9999')
        }
        if (torn) {
          world.store.append(
            'sess_helper_0',
            world.store.nextOrdinal('sess_helper_0'),
            { type: 'work_status_set', piece: 'work_h_0', line: 'halfway', by: 'sess_helper_0' },
            world.clock++,
          )
          world.db
            .prepare(`UPDATE events SET payload = '{not json' WHERE session_id = ? AND type = ?`)
            .run('sess_helper_0', 'work_status_set')
        }
        const next = world.aHost()
        const caller = await next.resumeSession(first, world.window, null)
        const root = world.store.rootOf(first)
        if (root === null) throw new Error('the caller owns no root')
        return { host: next, caller: caller.sessionId, root: root.label }
      }
      const giveFrom = async (at: { host: RuntimeHost; caller: string; root: string }) =>
        at.host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'browser-driver',
            title: 'Late',
            brief: 'late',
            piece: at.root,
          },
          { ownerId: agentCallerId(at.caller) },
        )

      it('refuses a give that closes a wait past what the check reads', async () => {
        const at = await aServiceThatGaveTo(MAX_WAITS_WALKED, true)
        expect(refusedAs(await giveFrom(at))).toBe('its-waits-cannot-all-be-checked')
      })

      it('refuses a give past what the check reads even where no wait would close', async () => {
        const at = await aServiceThatGaveTo(MAX_WAITS_WALKED, false)
        expect(refusedAs(await giveFrom(at))).toBe('its-waits-cannot-all-be-checked')
      })

      it('refuses a give past what the check reads as unreadable where a row it read can’t be read', async () => {
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
          const at = await aServiceThatGaveTo(MAX_WAITS_WALKED, false, true)
          expect(refusedAs(await giveFrom(at))).toBe('its-record-cannot-be-read')
        } finally {
          warned.mockRestore()
        }
      })

      it('gives where the check reads every conversation, at exactly its limit', async () => {
        // The service and its helpers: exactly the conversations the check may read.
        const at = await aServiceThatGaveTo(MAX_WAITS_WALKED - 1, false)
        expect(accepted(await giveFrom(at)).queuedBehind).toBe(1)
      })
    })

    describe('where a row of the work the service gave can’t be read', () => {
      /**
       * The service gave a helper an open piece and, with `closing`, the helper gave the caller one,
       * so the service waits on the caller. `hidden` hides the service's give to the helper: its row
       * torn, or the helper's whole ledger skipped, as the store skips one whose fold throws. With
       * `another-row`, the service also gave a second helper a piece whose row is torn. With
       * `an-ended-piece`, the service closed the helper's piece after a status line, which
       * `an-ended-row` tears.
       */
      const aGiveAfterTheServiceGaveAHelper = async (
        closing: boolean,
        hidden:
          'nothing' | 'its-row' | 'its-ledger' | 'another-row' | 'an-ended-piece' | 'an-ended-row',
      ): Promise<GiveOutcome> => {
        const { host, first } = await aServiceAndTwoCallers()
        const { owner: service } = accepted(await world.gives(host, first, 'browser-driver'))
        const held = world.store.piecesOwnedBy(service)[0]
        if (held === undefined) throw new Error('the service holds nothing')
        await host.closeAll()
        world.anAgent('helper', 'nothing kept')
        for (const id of ['sess_helper', 'sess_other_helper']) {
          world.store.create({
            id,
            provider: 'claude',
            cwd: world.folder,
            approvalMode: 'ask',
            profileId: 'helper',
            parentSessionId: first,
          })
        }
        const aGive = (from: string, to: string, parent: string, label: string, id: string) => {
          const number = Number(label.split('.').at(-1))
          world.store.recordGive(
            {
              piece: id,
              parent,
              number,
              owner: to,
              givenBy: from,
              title: 'Wait',
              brief: 'wait',
              folder: null,
              inputs: [],
            },
            world.store.nextOrdinal(to),
            {
              type: 'work_given',
              piece: id,
              label,
              parent,
              givenBy: from,
              title: 'Wait',
              brief: 'wait',
            },
            world.clock++,
          )
        }
        const tear = (ledger: string, type = 'work_given'): void => {
          world.db
            .prepare(`UPDATE events SET payload = '{not json' WHERE session_id = ? AND type = ?`)
            .run(ledger, type)
        }
        aGive(service, 'sess_helper', held.piece, `${held.label}.70`, 'work_to_helper')
        if (hidden === 'its-row') tear('sess_helper')
        if (hidden === 'an-ended-piece' || hidden === 'an-ended-row') {
          const events: TranscriptEvent[] = [
            {
              type: 'work_status_set',
              piece: 'work_to_helper',
              line: 'halfway',
              by: 'sess_helper',
            },
            { type: 'work_closed', piece: 'work_to_helper', by: service },
          ]
          for (const event of events) {
            world.store.append(
              'sess_helper',
              world.store.nextOrdinal('sess_helper'),
              event,
              world.clock++,
            )
          }
          if (hidden === 'an-ended-row') tear('sess_helper', 'work_status_set')
        }
        if (hidden === 'another-row') {
          aGive(service, 'sess_other_helper', held.piece, `${held.label}.71`, 'work_to_other')
          tear('sess_other_helper')
        }
        if (closing)
          aGive('sess_helper', first, 'work_to_helper', `${held.label}.70.1`, 'work_to_caller')
        const skipsTheHelper = new Proxy(world.store, {
          get(target, key, receiver) {
            if (key === 'piecesGivenBy') {
              return (giver: string, unread?: RowsUnread) => {
                const pieces = target.piecesGivenBy(giver, unread)
                if (!pieces.some((piece) => piece.owner === 'sess_helper')) return pieces
                skipTheLedger('sess_helper', new Error('its fold threw'), unread?.in('sess_helper'))
                return pieces.filter((piece) => piece.owner !== 'sess_helper')
              }
            }
            const value: unknown = Reflect.get(target, key, receiver)
            return typeof value === 'function'
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value
          },
        })
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
          const next = world.aHost(hidden === 'its-ledger' ? { store: skipsTheHelper } : {})
          const caller = await next.resumeSession(first, world.window, null)
          const root = world.store.rootOf(first)
          if (root === null) throw new Error('the caller owns no root')
          return await next.giveWork(
            {
              definition_of_done: 'The requested result and its checks are recorded.',
              profile: 'browser-driver',
              title: 'Late',
              brief: 'late',
              piece: root.label,
            },
            { ownerId: agentCallerId(caller.sessionId) },
          )
        } finally {
          warned.mockRestore()
        }
      }

      it('refuses a give where a row of the work it gave can’t be read: that row may close a wait', async () => {
        expect(refusedAs(await aGiveAfterTheServiceGaveAHelper(true, 'its-row'))).toBe(
          'its-record-cannot-be-read',
        )
      })

      it('refuses a give where a ledger of the work it gave is skipped whole', async () => {
        expect(refusedAs(await aGiveAfterTheServiceGaveAHelper(true, 'its-ledger'))).toBe(
          'its-record-cannot-be-read',
        )
      })

      it('…while the same wait, read whole, is refused as one', async () => {
        expect(refusedAs(await aGiveAfterTheServiceGaveAHelper(true, 'nothing'))).toBe(
          'it-would-wait-on-itself',
        )
      })

      it('refuses a wait it found as one, though another row can’t be read', async () => {
        expect(refusedAs(await aGiveAfterTheServiceGaveAHelper(true, 'another-row'))).toBe(
          'it-would-wait-on-itself',
        )
      })

      it('gives where every row is read and no wait would close', async () => {
        expect(accepted(await aGiveAfterTheServiceGaveAHelper(false, 'nothing')).queuedBehind).toBe(
          1,
        )
      })

      it('refuses a give where a row of work that has ended can’t be read, and says it can’t be read', async () => {
        const refused = await aGiveAfterTheServiceGaveAHelper(false, 'an-ended-row')
        expect(refusedAs(refused)).toBe('its-record-cannot-be-read')
        expect(refused.ok ? '' : refused.refusal.reason).toBe(
          'Not given: part of this app’s record of what “browser-driver” gave can’t be read. ' +
            'Give the work to another agent.',
        )
      })

      it('…and gives where that work, ended, is read whole', async () => {
        expect(
          accepted(await aGiveAfterTheServiceGaveAHelper(false, 'an-ended-piece')).queuedBehind,
        ).toBe(1)
      })
    })

    it('when its first give would record its conversation while agents may not start any', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      world.store.setSpawningEnabled(false)
      expect(refusedAs(await world.gives(host, first, 'browser-driver'))).toBe('spawning-disabled')
    })

    it('when its agent has no provider to record its conversation on', async () => {
      const svc = world.store.createAgentIdentity(
        { slug: 'browser-driver', displayName: null, provider: null },
        { by: 'a-person' },
      )
      if (svc === null) throw new Error('exists')
      writeProfileExecution(profileExecutionFile(world.folder), {
        profiles: { [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt } },
      })
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const caller = await world.aPersonOpens(host, 'caller')
      const refused = await world.gives(host, caller, 'browser-driver')
      expect(refusedAs(refused)).toBe('its-provider-is-not-chosen')
      expect(refused.ok ? '' : refused.refusal.reason).toBe(
        'Ask a person to choose a provider for “browser-driver” on its sheet, or give the work to ' +
          'another agent: it has no provider saved and no conversation yet, so nothing was given.',
      )
    })
  })

  describe('a queued piece changed by its caller', () => {
    const change = (
      host: RuntimeHost,
      caller: string,
      piece: string,
      what: { brief?: string; close?: boolean; resources?: readonly string[] },
    ) =>
      host.updateWork(
        {
          piece,
          title: null,
          status: null,
          on: null,
          brief: what.brief ?? null,
          close: what.close ?? false,
          resources: what.resources ?? [],
        },
        { ownerId: agentCallerId(caller) },
      )

    it('takes a new brief in its ledger alone: it goes with the give, nothing is sent', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      await aServiceAtWork(host, first)
      const one = accepted(await world.gives(host, first, 'browser-driver'))
      const changed = await change(host, first, one.label, { brief: 'book it for Wednesday' })
      expect(changed).toMatchObject({ ok: true, rebriefed: true, delivery: 'with-its-give' })
      const itsRows = world
        .ledger(one.owner)
        .filter((row) => 'piece' in row && row.piece === one.piece)
        .map((row) => row.type)
      expect(itsRows).toEqual(['work_given', 'work_rebriefed'])
      expect(world.store.piecesOwnedBy(one.owner)[1]?.state).toBe('waiting')
      expect(world.startedAs).toEqual(['caller', 'other-caller', 'browser-driver'])
    })

    it('is closed without a word to the service, and the pieces behind it move up', async () => {
      const { host, first, second } = await aServiceAndTwoCallers()
      await aServiceAtWork(host, first)
      const one = accepted(await world.gives(host, first, 'browser-driver'))
      accepted(await world.gives(host, second, 'browser-driver'))
      const closed = await change(host, first, one.label, { close: true })
      expect(closed).toMatchObject({
        ok: true,
        delivery: 'not-delivered',
        whyNotTold: 'The piece was queued and had not reached it, so nothing was sent.',
      })
      expect(world.store.piecesOwnedBy(one.owner).map((piece) => piece.state)).toEqual([
        'working',
        'closed',
        'waiting',
      ])
      expect(host.pieceBoard(second).gave.map((row) => row.queuedBehind)).toEqual([1])
      expect(world.startedAs).toEqual(['caller', 'other-caller', 'browser-driver'])
    })

    it('keeps the files its caller adds, for its turn, without a word to the service', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      await aServiceAtWork(host, first)
      const one = accepted(await world.gives(host, first, 'browser-driver'))
      const notes = join(world.folder, 'notes.md')
      writeFileSync(notes, '# the room\nthe big one\n')
      const added = await change(host, first, one.label, { resources: [notes] })
      expect(added).toMatchObject({
        ok: true,
        delivery: 'not-delivered',
        whyNotTold: 'The piece was queued and had not reached it, so nothing was sent.',
      })
      expect(world.store.resourcesOf(one.piece).map((file) => [file.name, file.role])).toEqual([
        ['notes.md', 'input'],
      ])
      expect(world.startedAs).toEqual(['caller', 'other-caller', 'browser-driver'])
    })
  })

  describe('the rails, as a give to a service meets them', () => {
    /** Facts in which `profile` is a service as `service` says, and nothing else stands in the way. */
    const facts = (service: ServiceAtAGive): GiveFacts => ({
      giver: () => ({
        sessionId: 'sess_caller',
        profileId: 'caller',
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'ask',
      }),
      held: () => [{ piece: 'work_root', label: 'W1', root: true, received: true }],
      drivenByTheTurn: () => null,
      mayGiveWork: () => null,
      depthOf: () => 0,
      capabilitiesOf: () => DEFAULT_CAPABILITIES,
      helperAs: () => null,
      serviceAt: () => service,
      spawningEnabled: () => true,
      mayCreateAgents: () => null,
      itsProvider: () => ({ provider: 'claude', from: 'saved' }),
      theNamedModelsProvider: () => null,
      modelChoiceOf: () => null,
      checkFolder: (path) => ({ ok: true, path }),
    })
    const admitted = (service: ServiceAtAGive): string => {
      const admission = admitGive(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'browser-driver',
          title: 'A piece',
          brief: 'a piece',
        },
        { ownerId: agentCallerId('sess_caller') },
        facts(service),
      )
      return admission.ok ? admission.goes.to : admission.refusal.rail
    }
    const aService = {
      is: 'service',
      conversation: 'sess_service',
      isTheGiver: false,
      waitsOnTheGiver: 'no',
      provider: null,
    } as const

    it('a service goes to its one conversation, recorded first when it has none', () => {
      expect(admitted(aService)).toBe('a-service')
      expect(admitted({ ...aService, conversation: null, provider: 'claude' })).toBe('a-service')
    })

    it('refuses the service’s own conversation giving to it', () => {
      expect(admitted({ ...aService, isTheGiver: true })).toBe('that-is-this-conversation')
    })

    it('refuses a give the service already waits on', () => {
      expect(admitted({ ...aService, waitsOnTheGiver: 'yes' })).toBe('it-would-wait-on-itself')
    })

    it('refuses a give whose waits can’t all be checked', () => {
      expect(admitted({ ...aService, waitsOnTheGiver: 'unknown' })).toBe(
        'its-waits-cannot-all-be-checked',
      )
    })

    it('refuses a give whose waits can’t be read', () => {
      expect(admitted({ ...aService, waitsOnTheGiver: 'unread' })).toBe('its-record-cannot-be-read')
    })

    it('refuses while services are off, and where the kind can’t be told', () => {
      expect(admitted({ is: 'off' })).toBe('services-are-off')
      expect(admitted({ is: 'unknown' })).toBe('its-kind-is-unknown')
    })

    it('leaves an agent that is not a service to the lookup, as today', () => {
      expect(admitted({ is: 'normal' })).toBe('a-new-conversation')
    })
  })

  describe('a start that would make a second conversation under a service', () => {
    it('is refused at a person’s launcher', async () => {
      world.anAgent('browser-driver')
      const host = world.aHost()
      await expect(world.aPersonOpens(host, 'browser-driver')).rejects.toThrow(
        'Not started: it’s a service.',
      )
      expect(world.conversationsRecorded()).toBe(0)
      expect(world.startedAs).toEqual([])
    })

    it('is refused for an agent whose kind can’t be told and a service’s conversation is in the database', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      accepted(await world.gives(host, first, 'browser-driver'))
      await host.closeAll()
      writeFileSync(profileExecutionFile(world.folder), 'not json')
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const next = world.aHost()
      await expect(world.aPersonOpens(next, 'browser-driver')).rejects.toThrow(
        'Not started: it’s a service.',
      )
      // The control: another agent starts as today.
      await expect(world.aPersonOpens(next, 'caller')).resolves.toMatch(/^sess_/)
      warned.mockRestore()
    })
  })

  describe('a queued piece taken back', () => {
    it('by its caller ends without a word to the service, and the pieces behind it move up', async () => {
      const { host, first, second } = await aServiceAndTwoCallers()
      await aServiceAtWork(host, first)
      const one = accepted(await world.gives(host, first, 'browser-driver', { title: 'One' }))
      accepted(await world.gives(host, second, 'browser-driver', { title: 'Two' }))
      const before = world.ledger(one.owner).length

      const taken = await host.takeBackPiece(
        { piece: one.label },
        { ownerId: agentCallerId(first) },
      )
      expect(taken).toMatchObject({
        ok: true,
        label: one.label,
        owner: one.owner,
        tookBackTheMessage: false,
        delivery: 'not-delivered',
        whyNotTold: 'The piece was queued and had not reached it, so nothing was sent.',
      })
      expect(
        world
          .ledger(one.owner)
          .slice(before)
          .map((row) => row.type),
      ).toEqual(['work_taken_back'])
      expect(world.store.piecesOwnedBy(one.owner).map((piece) => piece.state)).toEqual([
        'working',
        'withdrawn',
        'waiting',
      ])
      expect(host.pieceBoard(second).gave.map((row) => row.queuedBehind)).toEqual([1])
      expect(world.startedAs).toEqual(['caller', 'other-caller', 'browser-driver'])
    })

    it('by another caller is refused: it is not a piece it gave', async () => {
      const { host, first, second } = await aServiceAndTwoCallers()
      const one = accepted(await world.gives(host, first, 'browser-driver'))
      expect(
        await host.takeBackPiece({ piece: one.label }, { ownerId: agentCallerId(second) }),
      ).toEqual({ ok: false, refused: { rail: 'not-a-piece-you-gave' } })
      expect(await host.takeBackPiece({ piece: one.label }, THE_APP_ITSELF)).toEqual({
        ok: false,
        refused: { rail: 'not-a-piece-you-gave' },
      })
    })
  })

  describe('what the tools say of a queued piece', () => {
    const call = async (
      host: RuntimeHost,
      caller: string,
      name: ToolName,
      args: Record<string, unknown>,
    ): Promise<{ structured: Record<string, unknown>; text: string }> => {
      const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const result = await tool.call(args)
      return { structured: result.structured as Record<string, unknown>, text: result.text }
    }
    const NOT_TOLD =
      'could not be told. The piece was queued and had not reached it, so nothing was sent.'

    it('give_work says its place in line, and the folder it may work in once its turn comes', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      const given = await call(host, first, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'browser-driver',
        title: 'Book the room',
        brief: 'book the meeting room for Tuesday',
        folder: world.folder,
      })
      expect(given.structured).toMatchObject({ outcome: 'ok', queued_behind: 0 })
      const label = String(given.structured.label)
      expect(given.text).toContain(' Queued; next in line.')
      expect(given.text).toContain(
        ` It may also work in ${world.folder} while ${label} is open, once its turn comes.`,
      )
      const behind = await call(host, first, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'browser-driver',
        title: 'Order lunch',
        brief: 'order lunch for six',
      })
      expect(behind.structured).toMatchObject({ outcome: 'ok', queued_behind: 1 })
      expect(behind.text).toContain(' Queued behind 1.')
      expect(behind.text).not.toContain('once its turn comes')
    })

    it('update_work and withdraw_task say the service was not told, and why', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      await aServiceAtWork(host, first)
      const one = accepted(await world.gives(host, first, 'browser-driver', { title: 'One' }))
      const two = accepted(await world.gives(host, first, 'browser-driver', { title: 'Two' }))
      const three = accepted(await world.gives(host, first, 'browser-driver', { title: 'Three' }))
      const name = host.whatToCallTheConversation(one.owner)
      const notes = join(world.folder, 'notes.md')
      writeFileSync(notes, '# the room\nthe big one\n')

      const added = await call(host, first, 'update_work', { piece: one.label, resources: [notes] })
      const closed = await call(host, first, 'update_work', { piece: two.label, close: true })
      const taken = await call(host, first, 'withdraw_task', { piece: three.label })
      for (const answered of [added, closed, taken]) {
        expect(answered.structured).toMatchObject({
          outcome: 'ok',
          delivery: 'not-delivered',
          whyNotTold: 'The piece was queued and had not reached it, so nothing was sent.',
        })
        expect(answered.text).toContain(`${name} ${NOT_TOLD}`)
      }
      expect(world.startedAs).toEqual(['caller', 'other-caller', 'browser-driver'])
    })
  })

  describe('races, restarts and failed writes', () => {
    /**
     * Two agents whose running conversations the services list names as theirs: a person opened
     * them before they were services, a second host reads the list and runs them again.
     */
    const twoRunningServices = async (): Promise<{
      host: RuntimeHost
      one: string
      two: string
    }> => {
      const first = world.anAgent('svc-one', 'nothing kept')
      const second = world.anAgent('svc-two', 'nothing kept')
      const before = world.aHost()
      const one = await world.aPersonOpens(before, 'svc-one')
      const two = await world.aPersonOpens(before, 'svc-two')
      await before.closeAll()
      writeProfileExecution(profileExecutionFile(world.folder), {
        profiles: {
          [first.id]: {
            kind: 'service',
            identityCreatedAt: first.createdAt,
            serviceConversation: one,
          },
          [second.id]: {
            kind: 'service',
            identityCreatedAt: second.createdAt,
            serviceConversation: two,
          },
        },
      })
      const host = world.aHost()
      await host.resumeSession(one, world.window, null)
      await host.resumeSession(two, world.window, null)
      return { host, one, two }
    }

    it('refuses a service giving work to itself, end to end', async () => {
      const { host, one } = await twoRunningServices()
      expect(refusedAs(await world.gives(host, one, 'svc-one'))).toBe('that-is-this-conversation')
    })

    it('two services giving each other work at the same moment: one is given, the other closes no wait', async () => {
      const { host, one, two } = await twoRunningServices()
      const [toTwo, toOne] = await Promise.all([
        world.gives(host, one, 'svc-two', { title: 'To two' }),
        world.gives(host, two, 'svc-one', { title: 'To one' }),
      ])
      const outcomes = [toTwo, toOne].map((outcome) =>
        outcome.ok ? 'given' : outcome.refusal.rail,
      )
      expect(outcomes.sort()).toEqual(['given', 'it-would-wait-on-itself'])
    })

    it('keeps its place in the queue across a restart, read off the order the pieces were given', async () => {
      const { host, first, second } = await aServiceAndTwoCallers()
      accepted(await world.gives(host, first, 'browser-driver', { title: 'One' }))
      accepted(await world.gives(host, second, 'browser-driver', { title: 'Two' }))
      accepted(await world.gives(host, first, 'browser-driver', { title: 'Three' }))
      await host.closeAll()
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const next = world.aHost()
      info.mockRestore()
      expect(next.pieceBoard(first).gave.map((row) => [row.title, row.queuedBehind])).toEqual([
        ['One', 0],
        ['Three', 2],
      ])
      expect(next.pieceBoard(second).gave.map((row) => row.queuedBehind)).toEqual([1])
    })

    it('outlives a restart queued even where the services list can’t be read', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      const busy = await aServiceAtWork(host, first)
      const given = accepted(await world.gives(host, first, 'browser-driver'))
      await host.closeAll()
      writeFileSync(profileExecutionFile(world.folder), 'not json')
      const quiet = [
        vi.spyOn(console, 'info').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
      ]
      const next = world.aHost()
      for (const spy of quiet) spy.mockRestore()
      const restarted = world
        .ledger(given.owner)
        .flatMap((row) => (row.type === 'work_restarted' ? [...(row.pieces ?? [])] : []))
      expect(restarted).not.toContain(given.piece)
      expect(world.store.piecesOwnedBy(busy.owner).map((piece) => piece.state)).toEqual([
        'stalled',
        'waiting',
      ])
      expect(next.pieceBoard(first).gave.map((row) => row.queuedBehind)).toEqual([undefined, 1])
    })

    it('a give whose piece can’t be written leaves the one conversation recorded, and nothing given', async () => {
      const svc = world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      let refuseThePiece = true
      const failing = new Proxy(world.store, {
        get(target, key, receiver) {
          if (key === 'recordGive') {
            return (...args: Parameters<SessionStore['recordGive']>) => {
              if (refuseThePiece) throw new Error('database disk image is malformed')
              target.recordGive(...args)
            }
          }
          const value: unknown = Reflect.get(target, key, receiver)
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value
        },
      })
      const host = world.aHost({ store: failing })
      const caller = await world.aPersonOpens(host, 'caller')
      const before = world.conversationsRecorded()
      await expect(world.gives(host, caller, 'browser-driver')).rejects.toThrow()
      const service = world.kept(svc.id)?.serviceConversation
      expect(service).toBeDefined()
      expect(world.conversationsRecorded()).toBe(before + 1)
      expect(world.store.piecesOwnedBy(service ?? '')).toEqual([])
      expect(world.store.piecesGivenBy(caller)).toEqual([])

      refuseThePiece = false
      const given = accepted(await world.gives(host, caller, 'browser-driver'))
      expect(given.owner).toBe(service)
      expect(given.queuedBehind).toBe(0)
      await handedOver(given.owner, given.piece)
      expect(world.conversationsRecorded()).toBe(before + 1)
      expect(world.startedAs).toEqual(['caller', 'browser-driver'])
    })

    it('keeps the model and effort a give asked for, for its turn', async () => {
      const { host, first } = await aServiceAndTwoCallers()
      const given = accepted(
        await world.gives(host, first, 'browser-driver', {
          model: 'fake-claude-a',
          effort: 'high',
        }),
      )
      const row = world
        .ledger(given.owner)
        .find((event) => event.type === 'work_given' && event.piece === given.piece)
      expect(row).toMatchObject({ asked: { model: 'fake-claude-a', effort: 'high' } })
      // The answer says the pair kept for its turn, not what the service's row last ran on.
      expect(given.runsOn).toMatchObject({ model: 'fake-claude-a', effort: 'high' })
      // …and a give that asks for none keeps none.
      const plain = accepted(await world.gives(host, first, 'browser-driver'))
      const plainRow = world
        .ledger(plain.owner)
        .find((event) => event.type === 'work_given' && event.piece === plain.piece)
      expect(plainRow).not.toHaveProperty('asked')
    })

    it('an agent whose entry can’t be settled is given work as today, unless the database holds its service’s conversation', async () => {
      // An entry naming a conversation the database never recorded: it can't be settled.
      const lost = world.anAgent('lost-service', 'nothing kept')
      const born = world.anAgent('born-service', 'nothing kept')
      world.anAgent('caller', 'nothing kept')
      world.store.create({
        id: 'sess_born_unnamed',
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'ask',
        profileId: 'born-service',
        service: true,
      })
      writeProfileExecution(profileExecutionFile(world.folder), {
        profiles: {
          [lost.id]: {
            kind: 'service',
            identityCreatedAt: lost.createdAt,
            serviceConversation: 'sess_never_recorded',
          },
          [born.id]: {
            kind: 'service',
            identityCreatedAt: born.createdAt,
            serviceConversation: 'sess_other',
          },
        },
      })
      const host = world.aHost()
      expect(host.profileKindOf('lost-service')).toBe('unknown')
      const caller = await world.aPersonOpens(host, 'caller')
      const ordinary = accepted(await world.gives(host, caller, 'lost-service'))
      expect(world.store.parentOf(ordinary.owner)).toBe(caller)
      expect(refusedAs(await world.gives(host, caller, 'born-service'))).toBe('its-kind-is-unknown')
    })

    it('a note to a service reaches its ledger only from the caller of the piece it is on', async () => {
      const { host, first, second } = await aServiceAndTwoCallers()
      const { owner: service } = await aServiceAtWork(host, first)
      accepted(await world.gives(host, second, 'browser-driver', { title: 'Queued' }))
      // A grant to reach what it did not start never reaches a service.
      expect(world.store.setCapabilities('other-caller', { canMessage: 'any' } as never)).toBe(true)
      const before = world.ledger(service).length
      await expect(
        host.queueMessage(service, 'a note', { ownerId: agentCallerId(second) }),
      ).rejects.toThrow()
      expect(world.ledger(service).length).toBe(before)
      await expect(
        host.queueMessage(service, 'a note', { ownerId: agentCallerId(first) }),
      ).resolves.toMatchObject({ outcome: 'queued' })
      expect(world.startedAs).toEqual(['caller', 'other-caller', 'browser-driver'])
    })
  })

  it('a service is never given work in the services list’s file without its one conversation in it', async () => {
    const svc = world.anAgent('browser-driver')
    world.anAgent('caller', 'nothing kept')
    const host = world.aHost()
    const caller = await world.aPersonOpens(host, 'caller')
    const given = accepted(await world.gives(host, caller, 'browser-driver'))
    const read = readProfileExecution(profileExecutionFile(world.folder))
    expect(read.readable && read.kept.profiles[svc.id]?.serviceConversation).toBe(given.owner)
  })
})
