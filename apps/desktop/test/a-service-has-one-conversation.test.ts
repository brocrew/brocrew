import { readFileSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionStore } from '../src/main/db/session-store'
import { profileExecutionFile, writeProfileExecution } from '../src/main/profile-execution-file'
import { THE_APP_ITSELF, type RuntimeHost } from '../src/main/runtime/runtime-host'
import { SessionUnavailable } from '../src/main/runtime/session-unavailable'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

/**
 * A service has one conversation: recorded at its first give, nothing launched, with no parent
 * and no root; kept in `profile-execution.json` as that service's; never replaced by another; and
 * deleted only by a person, only while nobody has given it work. Reached through the host alone:
 * services are switched off in the app.
 */

describe('a service’s one conversation', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  /**
   * A caller, opened by a person, gives `profile` its first piece: the service's birth. With
   * `itsStartFails`, the launch that piece makes fails, so the conversation is never launched.
   */
  const theFirstGive = async (
    host: RuntimeHost,
    profile = 'browser-driver',
    itsStartFails = false,
  ): Promise<{ caller: string; service: string }> => {
    const caller = await world.aPersonOpens(host, 'caller')
    world.startsFail = itsStartFails
    const given = await world.gives(host, caller, profile)
    if (!given.ok) throw new Error(`refused: ${given.refusal.reason}`)
    if (itsStartFails) {
      await vi.waitFor(() => {
        expect(
          world
            .ledger(given.owner)
            .some((row) => row.type === 'message_unqueued' && row.reason === 'abandoned'),
        ).toBe(true)
      })
      world.startsFail = false
    }
    return { caller, service: given.owner }
  }

  describe('its birth', () => {
    it('is recorded at its first give, by no conversation, owning no root, nothing launched', async () => {
      const svc = world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const { caller, service } = await theFirstGive(host)
      expect(service).not.toBe(caller)
      expect(world.store.parentOf(service)).toBeNull()
      expect(world.store.rootOf(service)).toBeNull()
      expect(world.store.identityOf(service)).toEqual({ profileSlug: 'browser-driver' })
      expect(world.kept(svc.id)).toEqual({
        kind: 'service',
        identityCreatedAt: svc.createdAt,
        serviceConversation: service,
      })
      expect(host.profileKindOf('browser-driver')).toBe('service')
      // Only the caller ran; nothing was launched as the service.
      expect(world.startedAs).toEqual(['caller'])
      expect(world.store.recordedOne(service)?.neverStarted).toBe(true)
      // The control: the caller, which a person opened, owns its root.
      expect(world.store.rootOf(caller)).not.toBeNull()
    })

    it('happens once: a later give queues on the same conversation', async () => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const { caller, service } = await theFirstGive(host)
      const before = world.conversationsRecorded()
      const again = await world.gives(host, caller, 'browser-driver')
      expect(again).toMatchObject({ ok: true, owner: service })
      expect(world.conversationsRecorded()).toBe(before)
    })

    it('happens once when two gives arrive at the same moment', async () => {
      const svc = world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const caller = await world.aPersonOpens(host, 'caller')
      const before = world.conversationsRecorded()
      const [one, two] = await Promise.all([
        world.gives(host, caller, 'browser-driver', { title: 'One' }),
        world.gives(host, caller, 'browser-driver', { title: 'Two' }),
      ])
      if (!one.ok || !two.ok) throw new Error('a give was refused')
      expect(one.owner).toBe(two.owner)
      expect(world.conversationsRecorded()).toBe(before + 1)
      expect(world.kept(svc.id)?.serviceConversation).toBe(one.owner)
    })

    it('is not recorded where its reservation can’t be kept, and nothing is given', async () => {
      const svc = world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const caller = await world.aPersonOpens(host, 'caller')
      const before = world.conversationsRecorded()
      world.writesFail = 'all'
      await expect(world.gives(host, caller, 'browser-driver')).rejects.toThrow()
      expect(world.conversationsRecorded()).toBe(before)
      expect(world.kept(svc.id)).toEqual({ kind: 'service', identityCreatedAt: svc.createdAt })
      expect(world.store.piecesGivenBy(caller)).toEqual([])
    })

    it('whose row can’t be written lets its reservation go, so a later give records it', async () => {
      const svc = world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      let refuseTheRow = true
      const failing = new Proxy(world.store, {
        get(target, key, receiver) {
          if (key === 'create') {
            return (record: Parameters<SessionStore['create']>[0]) => {
              if (refuseTheRow && record.service === true) {
                throw new Error('database disk image is malformed')
              }
              target.create(record)
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
      await expect(world.gives(host, caller, 'browser-driver')).rejects.toThrow()
      expect(world.kept(svc.id)).toEqual({ kind: 'service', identityCreatedAt: svc.createdAt })

      refuseTheRow = false
      const given = await world.gives(host, caller, 'browser-driver')
      if (!given.ok) throw new Error('refused')
      expect(world.kept(svc.id)?.serviceConversation).toBe(given.owner)
    })

    it('cut off after its row and before it is kept as the service’s is kept so at the next start', async () => {
      const svc = world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      world.writesFail = 'serviceConversation'
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { service } = await theFirstGive(world.aHost())
      expect(world.kept(svc.id)).toEqual({
        kind: 'service',
        identityCreatedAt: svc.createdAt,
        reserved: service,
      })
      warned.mockRestore()

      world.writesFail = 'none'
      const before = world.conversationsRecorded()
      const next = world.aHost()
      expect(world.kept(svc.id)).toEqual({
        kind: 'service',
        identityCreatedAt: svc.createdAt,
        serviceConversation: service,
      })
      expect(next.profileKindOf('browser-driver')).toBe('service')
      expect(world.conversationsRecorded()).toBe(before)
    })
  })

  describe('when it can never be reopened', () => {
    it('is refused, and no other conversation is started in its place', async () => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { service } = await theFirstGive(host, 'browser-driver', true)
      const before = world.conversationsRecorded()

      const refused = await host.reopenForAPerson(service, world.window, null).then(
        () => null,
        (error: unknown) => error,
      )
      expect(refused).toBeInstanceOf(SessionUnavailable)
      expect((refused as SessionUnavailable).unavailable).toBe('cannot-be-reopened')
      expect((refused as SessionUnavailable).context.refusal).toBe(
        'it is a service’s one conversation, so no other is started in its place',
      )
      expect(world.conversationsRecorded()).toBe(before)
      expect(world.ledger(service).some((row) => row.type === 'replaced_by')).toBe(false)
      // Its own first launch, which failed, and nothing in its place.
      expect(world.startedAs).toEqual(['caller', 'browser-driver'])
      warned.mockRestore()

      // The control: a person's conversation its provider never named is replaced.
      world.store.create({
        id: 'sess_persons_row',
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'ask',
        profileId: 'caller',
      })
      const replaced = await host.reopenForAPerson('sess_persons_row', world.window, null)
      expect(replaced.sessionId).not.toBe('sess_persons_row')
    })

    it('is refused even where which agents are services can’t be read', async () => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { service } = await theFirstGive(world.aHost(), 'browser-driver', true)
      writeFileSync(profileExecutionFile(world.folder), 'not json')
      const host = world.aHost()
      const before = world.conversationsRecorded()
      await expect(host.reopenForAPerson(service, world.window, null)).rejects.toBeInstanceOf(
        SessionUnavailable,
      )
      expect(world.conversationsRecorded()).toBe(before)
      warned.mockRestore()
    })

    it('is never offered a message or a setting that would start another in its place', async () => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { service } = await theFirstGive(host, 'browser-driver', true)
      warned.mockRestore()
      world.store.create({
        id: 'sess_persons_row',
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'ask',
        profileId: 'caller',
      })
      const view = await host.look(service, world.window, false)
      expect(view.cannotTakeAMessage).not.toBeNull()
      expect(view.settingsFixed).toBe(true)
      await expect(host.setApprovalMode(service, 'auto', world.window)).rejects.toThrow(
        'no message continues this conversation, so a setting changed here would not reach it',
      )
      // The control: a person's is continued by a message, which starts one in its place.
      const persons = await host.look('sess_persons_row', world.window, false)
      expect(persons.cannotTakeAMessage).toBeNull()
      await expect(host.setApprovalMode('sess_persons_row', 'auto', world.window)).rejects.toThrow(
        'its next message starts a new conversation in its place',
      )
    })
  })

  describe('its delete', () => {
    /**
     * A service whose conversation was recorded and given nothing: a give cut off between the
     * conversation's row and its piece.
     */
    const aServiceGivenNothing = (): { id: string; createdAt: number; conversation: string } => {
      const svc = world.anAgent('browser-driver')
      world.store.create({
        id: 'sess_service',
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'ask',
        profileId: 'browser-driver',
        service: true,
      })
      writeProfileExecution(profileExecutionFile(world.folder), {
        profiles: {
          [svc.id]: {
            kind: 'service',
            identityCreatedAt: svc.createdAt,
            serviceConversation: 'sess_service',
          },
        },
      })
      return { ...svc, conversation: 'sess_service' }
    }

    it('takes a service’s conversation nobody gave work, and its next give records a new one', async () => {
      const svc = aServiceGivenNothing()
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      expect(host.deleteVerdict(svc.conversation)).toMatchObject({ ok: true })
      const done = await host.deleteConversation(svc.conversation, ['records'])
      expect(done).toMatchObject({ done: true, recordsKept: null })
      expect(world.store.recordedOne(svc.conversation)).toBeNull()
      expect(world.kept(svc.id)).toEqual({ kind: 'service', identityCreatedAt: svc.createdAt })

      const { service } = await theFirstGive(host)
      expect(service).not.toBe(svc.conversation)
      expect(world.kept(svc.id)?.serviceConversation).toBe(service)
    })

    it('deletes nothing when it can’t first note that the conversation is going', async () => {
      const svc = aServiceGivenNothing()
      const host = world.aHost()
      world.writesFail = 'removing'
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const done = await host.deleteConversation(svc.conversation, ['records'])
      expect(done).toEqual({
        done: false,
        refusal: 'Not deleted: the services list could not be saved.',
      })
      expect(world.store.recordedOne(svc.conversation)).not.toBeNull()
      expect(world.kept(svc.id)).toEqual({
        kind: 'service',
        identityCreatedAt: svc.createdAt,
        serviceConversation: svc.conversation,
      })
      warned.mockRestore()
    })

    it('cut off after its records went is settled at the next start: the service has none', async () => {
      const svc = aServiceGivenNothing()
      await world.aHost().deleteConversation(svc.conversation, ['records'])
      expect(world.store.recordedOne(svc.conversation)).toBeNull()
      // A crash between the note that it is going and the one that it is gone leaves the first.
      writeProfileExecution(profileExecutionFile(world.folder), {
        profiles: {
          [svc.id]: {
            kind: 'service',
            identityCreatedAt: svc.createdAt,
            serviceConversation: svc.conversation,
            removing: svc.conversation,
          },
        },
      })
      world.aHost()
      expect(world.kept(svc.id)).toEqual({ kind: 'service', identityCreatedAt: svc.createdAt })
    })

    it('cut off before its records went is settled at the next start: the conversation stays the service’s', () => {
      const svc = aServiceGivenNothing()
      writeProfileExecution(profileExecutionFile(world.folder), {
        profiles: {
          [svc.id]: {
            kind: 'service',
            identityCreatedAt: svc.createdAt,
            serviceConversation: svc.conversation,
            removing: svc.conversation,
          },
        },
      })
      const next = world.aHost()
      expect(world.kept(svc.id)).toEqual({
        kind: 'service',
        identityCreatedAt: svc.createdAt,
        serviceConversation: svc.conversation,
      })
      expect(next.profileKindOf('browser-driver')).toBe('service')
    })

    it('deletes nothing of a service whose kept entry is unsettled', async () => {
      const svc = world.anAgent('browser-driver')
      for (const id of ['sess_made', 'sess_reserved']) {
        world.store.create({
          id,
          provider: 'claude',
          cwd: world.folder,
          approvalMode: 'ask',
          profileId: 'browser-driver',
          service: true,
        })
      }
      writeProfileExecution(profileExecutionFile(world.folder), {
        profiles: {
          [svc.id]: {
            kind: 'service',
            identityCreatedAt: svc.createdAt,
            serviceConversation: 'sess_made',
            reserved: 'sess_reserved',
          },
        },
      })
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const host = world.aHost()
      expect(await host.deleteConversation('sess_made', ['records'])).toMatchObject({
        done: false,
      })
      expect(world.store.recordedOne('sess_made')).not.toBeNull()
      warned.mockRestore()
    })

    it('refuses a service given work, and the caller that gave it, and neither tree takes in the other', async () => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const host = world.aHost()
      const { caller, service } = await theFirstGive(host)
      await host.close(caller, THE_APP_ITSELF)
      expect(world.store.conversationTree(caller)).not.toContain(service)
      expect(world.store.conversationTree(service)).not.toContain(caller)
      expect(host.deleteVerdict(service)).toMatchObject({
        ok: false,
        refusal: expect.stringContaining('gave work to'),
      })
      expect(host.deleteVerdict(caller)).toMatchObject({
        ok: false,
        refusal: expect.stringContaining('holds work that'),
      })
    })

    it('refuses a conversation that may be a service’s where which agents are services can’t be read', async () => {
      const svc = aServiceGivenNothing()
      writeFileSync(profileExecutionFile(world.folder), 'not json')
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const host = world.aHost()
      expect(await host.deleteConversation(svc.conversation, ['records'])).toEqual({
        done: false,
        refusal:
          'This may be a service’s conversation, and which agents are services can’t be read, so ' +
          'nothing was deleted.',
      })
      expect(world.store.recordedOne(svc.conversation)).not.toBeNull()
      expect(readFileSync(profileExecutionFile(world.folder), 'utf8')).toBe('not json')
      warned.mockRestore()
    })
  })
})
