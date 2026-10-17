import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectDirName } from '@brobot2/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { profileExecutionFile } from '../src/main/profile-execution-file'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('worker pools follow whole-tree lifecycle decisions', () => {
  let world: AServiceWorld
  let identity: string
  beforeEach(() => {
    world = aServiceWorld()
    identity = world.anAgent('document-reader', 'normal').id
  })
  afterEach(async () => {
    await world.cleanUp()
  })
  async function setup() {
    const host = world.aHost()
    const giver = (
      await host.createSession(
        { provider: 'claude', profileId: 'review-lead', cwd: world.folder, approvalMode: 'auto' },
        world.window,
      )
    ).sessionId
    const given = await world.gives(host, giver, 'document-reader', { parallel: true })
    expect(given.ok).toBe(true)
    if (!given.ok) throw new Error('setup refused')
    expect(
      await host.replyToParent(
        {
          piece: given.piece,
          outcome: 'done',
          summary: 'Draft checked.',
          resourcePaths: [],
          needsUserAction: false,
        },
        { ownerId: agentCallerId(given.owner) },
      ),
    ).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(world.handleOf('document-reader').status()).toBe('idle'))
    return { host, giver, worker: given.owner }
  }

  it('deletes a complete giver pool and its replacement workers, preserving another giver pool across restart', async () => {
    const { host, giver, worker } = await setup()
    const other = await world.aPersonOpens(host, 'review-lead')
    expect(await world.gives(host, other, 'document-reader', { parallel: true })).toMatchObject({
      ok: true,
    })
    world.store.create({
      id: 'replacement-reader',
      provider: 'claude',
      profileId: 'document-reader',
      cwd: world.folder,
      approvalMode: 'auto',
      parentSessionId: giver,
    })
    world.store.append(
      worker,
      world.store.nextOrdinal(worker),
      { type: 'replaced_by', sessionId: 'replacement-reader' },
      world.clock++,
    )
    const survivor = world.kept(identity)?.workerPools?.find((one) => one.giver === other)
    expect(host.deleteVerdict(worker)).toMatchObject({ ok: false })
    expect(await host.deleteConversation(giver, ['records'])).toMatchObject({
      done: true,
      removed: ['records'],
      recordsKept: null,
    })
    expect(world.store.recordedOne(giver)).toBeNull()
    expect(world.store.recordedOne(worker)).toBeNull()
    expect(world.store.recordedOne('replacement-reader')).toBeNull()
    expect(world.kept(identity)?.workerPools).toEqual([survivor])
    await host.closeAll()
    world.aHost()
    expect(world.kept(identity)?.workerPools).toEqual([survivor])
    expect(world.store.workersBorn()).toHaveLength(1)
  })

  it('a failed intent write deletes no records and calls no SQLite delete', async () => {
    const { host, giver, worker } = await setup()
    const before = world.kept(identity)
    const deleting = vi.spyOn(world.store, 'deleteTheTree')
    world.writesFail = 'workerPools'
    expect(await host.deleteConversation(giver, ['records'])).toEqual({
      done: false,
      refusal: 'Nothing was deleted: this app could not record which workers it was removing.',
    })
    expect(deleting).not.toHaveBeenCalled()
    expect(world.store.recordedOne(giver)).not.toBeNull()
    expect(world.store.recordedOne(worker)).not.toBeNull()
    expect(world.kept(identity)).toEqual(before)
    world.writesFail = 'none'
  })

  it('a SQLite delete failure clears only its removal intent and remains retryable after restart', async () => {
    const { host, giver, worker } = await setup()
    const before = world.kept(identity)
    const deleting = vi.spyOn(world.store, 'deleteTheTree').mockImplementation(() => {
      expect(world.kept(identity)?.workerPools?.[0]?.removing).toBe(true)
      throw new Error('fictional SQLite fault')
    })
    expect(await host.deleteConversation(giver, ['records'])).toMatchObject({
      done: true,
      removed: [],
      recordsKept: expect.stringContaining('couldn’t delete its records'),
    })
    expect(world.store.recordedOne(worker)).not.toBeNull()
    expect(world.kept(identity)).toEqual(before)
    deleting.mockRestore()
    await host.closeAll()
    const next = world.aHost()
    expect(world.kept(identity)).toEqual(before)
    expect(await next.deleteConversation(giver, ['records'])).toMatchObject({
      done: true,
      recordsKept: null,
    })
    expect(world.kept(identity)?.workerPools).toEqual([])
  })

  it('a committed delete whose cleanup write failed is settled from the durable intent on restart', async () => {
    const { host, giver } = await setup()
    const real = world.store.deleteTheTree.bind(world.store)
    vi.spyOn(world.store, 'deleteTheTree').mockImplementation((ids) => {
      expect(world.kept(identity)?.workerPools?.[0]?.removing).toBe(true)
      const result = real(ids)
      world.writesFail = 'all'
      return result
    })
    expect(await host.deleteConversation(giver, ['records'])).toMatchObject({
      done: true,
      recordsKept: null,
    })
    expect(world.kept(identity)?.workerPools?.[0]?.removing).toBe(true)
    await host.closeAll()
    world.writesFail = 'none'
    world.aHost()
    expect(world.kept(identity)?.workerPools).toEqual([])
    expect(world.store.workersBorn()).toEqual([])
  })

  it('refuses a pool crossing giver replacement roots before a stop, write or delete', async () => {
    const { host, giver, worker } = await setup()
    const successor = await world.aPersonOpens(host, 'review-lead')
    world.store.append(
      giver,
      world.store.nextOrdinal(giver),
      { type: 'replaced_by', sessionId: successor },
      world.clock++,
    )
    const file = readFileSync(profileExecutionFile(world.folder))
    const stops = world.stopsAsked.slice()
    const deleting = vi.spyOn(world.store, 'deleteTheTree')
    for (const root of [giver, successor]) {
      expect(host.deleteVerdict(root)).toMatchObject({ ok: true })
      expect(await host.deleteConversation(root, ['records'])).toEqual({
        done: false,
        refusal: 'This conversation shares workers with another conversation. Archive it instead.',
      })
    }
    expect(world.stopsAsked).toEqual(stops)
    expect(deleting).not.toHaveBeenCalled()
    expect(readFileSync(profileExecutionFile(world.folder))).toEqual(file)
    expect(world.store.recordedOne(worker)).not.toBeNull()
  })

  it('allows files-only deletion in a shared pool tree while records deletion remains refused', async () => {
    const { host, giver, worker } = await setup()
    await host.send(giver, 'A fictional lead turn.', world.window)
    await vi.waitFor(() => expect(world.handleOf('review-lead').status()).toBe('idle'))
    const providerId = world.store.recordedOne(giver)?.providerSessionId
    expect(providerId).toEqual(expect.any(String))
    if (!providerId) throw new Error('fake lead has no provider id')
    const projects = join(
      world.folder,
      'provider-homes',
      'claude',
      'projects',
      claudeProjectDirName(world.folder),
    )
    mkdirSync(projects, { recursive: true })
    const transcript = join(projects, `${providerId}.jsonl`)
    writeFileSync(transcript, '{"fictional":true}\n')
    const successor = await world.aPersonOpens(host, 'review-lead')
    world.store.append(
      giver,
      world.store.nextOrdinal(giver),
      { type: 'replaced_by', sessionId: successor },
      world.clock++,
    )
    const before = world.kept(identity)
    const verdict = host.deleteVerdict(giver)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error(verdict.refusal)
    expect(verdict.parts.find((one) => one.id === `files:${giver}`)?.paths).toContain(transcript)
    expect(await host.deleteConversation(giver, [`files:${giver}`])).toMatchObject({
      done: true,
      removed: [`files:${giver}`],
      recordsKept: null,
    })
    expect(existsSync(transcript)).toBe(false)
    expect(world.store.recordedOne(giver)).not.toBeNull()
    expect(world.store.recordedOne(worker)).not.toBeNull()
    expect(world.kept(identity)).toEqual(before)
    expect(await host.deleteConversation(giver, ['records'])).toEqual({
      done: false,
      refusal: 'This conversation shares workers with another conversation. Archive it instead.',
    })
    expect(world.kept(identity)).toEqual(before)
  })

  it('keeps a pool when archived and restores its primary without renumbering', async () => {
    const { host, giver, worker } = await setup()
    const before = world.kept(identity)
    expect(await host.archiveConversation(giver)).toMatchObject({ done: true })
    expect(world.kept(identity)).toEqual(before)
    expect(host.restoreConversation(giver)).toMatchObject({ done: true })
    await host.reopenForAPerson(giver, world.window, null)
    expect(await world.gives(host, giver, 'document-reader')).toMatchObject({
      ok: true,
      owner: worker,
    })
    expect(world.store.workersBorn().map((one) => one.number)).toEqual([1])
  })

  it('refuses a giver delete while its unrecorded worker start is live, before a stop or write', async () => {
    const host = world.aHost()
    const giver = (
      await host.createSession(
        { provider: 'claude', profileId: 'review-lead', cwd: world.folder, approvalMode: 'auto' },
        world.window,
      )
    ).sessionId
    let release = () => {}
    world.startsWait = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = world.gives(host, giver, 'document-reader', { parallel: true })
    void pending.catch(() => {})
    try {
      const before = readFileSync(profileExecutionFile(world.folder))
      const stops = world.stopsAsked.slice()
      expect(world.store.workersBorn()).toEqual([])
      expect(await host.deleteConversation(giver, ['records'])).toEqual({
        done: false,
        refusal: 'Nothing was deleted: this app could not record which workers it was removing.',
      })
      expect(world.stopsAsked).toEqual(stops)
      expect(world.store.recordedOne(giver)).not.toBeNull()
      expect(readFileSync(profileExecutionFile(world.folder))).toEqual(before)
      release()
      expect(await pending).toMatchObject({ ok: true })
    } finally {
      release()
      world.startsWait = null
      await Promise.allSettled([pending])
    }
  })

  it('does not infer a completed removal from missing records without an intent', async () => {
    const { host, giver } = await setup()
    const before = world.kept(identity)
    await host.closeAll()
    world.store.deleteTheTree(world.store.conversationTree(giver))
    const next = world.aHost()
    const other = await world.aPersonOpens(next, 'review-lead')
    expect(world.kept(identity)).toEqual(before)
    for (const parallel of [false, true])
      expect(await world.gives(next, other, 'document-reader', { parallel })).toMatchObject({
        ok: false,
        refusal: { rail: 'worker-binding-is-unknown' },
      })
    expect(world.store.workersBorn()).toEqual([])
  })
})
