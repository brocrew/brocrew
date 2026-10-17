import { mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { WORKER_OUTPUT_DIRNAME, WORKER_OUTPUT_FAILURE } from '../src/main/worker-piece-folder'

describe('parallel workers keep a folder for each piece', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
    world.anAgent('document-reader', 'normal')
  })
  afterEach(async () => {
    await world.cleanUp()
  })
  const setup = async () => {
    const host = world.aHost()
    const { sessionId: caller } = await host.createSession(
      { provider: 'claude', cwd: world.folder, profileId: 'review-lead', approvalMode: 'auto' },
      world.window,
    )
    return { host, caller }
  }
  it('starts a fresh worker in the recorded default folder while preserving the caller’s brief', async () => {
    const { host, caller } = await setup()
    const given = await world.gives(host, caller, 'document-reader', {
      parallel: true,
      brief: 'Check a fictional draft.',
    })
    expect(given.ok).toBe(true)
    if (!given.ok || given.givenFolder === null) throw new Error('folder was not given')
    expect(given.givenFolder).toMatchObject({ use: 'working-folder', output: true })
    expect(given.startedIn).toBe(given.givenFolder.folder)
    expect(world.store.find(given.owner)?.cwd).toBe(given.givenFolder.folder)
    expect(readFileSync(join(given.givenFolder.folder, '.brocrew-piece'), 'utf8')).toBe(
      `${given.piece}\n`,
    )
    expect(world.store.workById(given.piece)?.brief).toBe('Check a fictional draft.')
    expect(world.sent.find((one) => one.as === 'document-reader')?.words).toContain(
      `Put this piece's output in ${given.givenFolder.folder}.`,
    )
  })
  it('creates a new piece folder on reuse, grants it, and keeps the native cwd and earlier output', async () => {
    const { host, caller } = await setup()
    const first = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(first.ok).toBe(true)
    if (!first.ok || first.givenFolder === null) throw new Error('setup refused')
    writeFileSync(join(first.givenFolder.folder, 'draft.md'), 'Fictional first result')
    const reply = await host.replyToParent(
      {
        piece: first.piece,
        outcome: 'done',
        summary: 'Checked.',
        resourcePaths: [],
        needsUserAction: false,
      },
      { ownerId: agentCallerId(first.owner) },
    )
    expect(reply.ok).toBe(true)
    await vi.waitFor(() => {
      expect(world.handleOf('document-reader').status()).toBe('idle')
    })
    const next = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(next).toMatchObject({ ok: true, owner: first.owner })
    if (!next.ok || next.givenFolder === null) throw new Error('reuse refused')
    expect(next.givenFolder).toMatchObject({ use: 'grant', output: true })
    expect(next.givenFolder.folder).not.toBe(first.givenFolder.folder)
    expect(world.store.find(next.owner)?.cwd).toBe(first.givenFolder.folder)
    expect(world.handleOf('document-reader').workFolders.effective).toEqual([
      realpathSync(next.givenFolder.folder),
    ])
    expect(readFileSync(join(first.givenFolder.folder, 'draft.md'), 'utf8')).toBe(
      'Fictional first result',
    )
    const row = world.store.piecesOwnedBy(next.owner).find((one) => one.piece === next.piece)
    expect(row?.givenFolder).toEqual(next.givenFolder)
  })
  it('restores the recorded output hint and grant after a restart, then ends only that piece’s grant', async () => {
    const { host, caller } = await setup()
    const first = await world.gives(host, caller, 'document-reader', { parallel: true })
    if (!first.ok) throw new Error('setup refused')
    expect(
      await host.replyToParent(
        {
          piece: first.piece,
          outcome: 'done',
          summary: 'Checked.',
          resourcePaths: [],
          needsUserAction: false,
        },
        { ownerId: agentCallerId(first.owner) },
      ),
    ).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(world.handleOf('document-reader').status()).toBe('idle'))
    const given = await world.gives(host, caller, 'document-reader', { parallel: true })
    if (!given.ok || given.givenFolder === null) throw new Error('reuse refused')
    const folder = given.givenFolder.folder
    writeFileSync(join(folder, 'draft.md'), 'Fictional kept result')
    await host.closeAll()
    const next = world.aHost()
    await next.reopenForAPerson(caller, world.window, null)
    const change = (brief: string | null, close: boolean) =>
      next.updateWork(
        {
          piece: given.piece,
          title: null,
          status: null,
          on: null,
          brief,
          close,
          resources: [],
        },
        { ownerId: agentCallerId(caller) },
      )
    expect(await change('Check the revised fictional draft.', false)).toMatchObject({ ok: true })
    await vi.waitFor(() =>
      expect(world.sent.at(-1)?.words).toContain(`Put this piece's output in ${folder}.`),
    )
    expect(world.handleOf('document-reader').workFolders.effective).toEqual([realpathSync(folder)])
    expect(await change(null, true)).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(world.handleOf('document-reader').status()).toBe('idle'))
    next.claimSession(given.owner, world.window)
    await next.send(given.owner, 'A fictional follow-up after the piece ended.', world.window)
    expect(world.handleOf('document-reader').workFolders.effective).toEqual([])
    expect(readFileSync(join(folder, 'draft.md'), 'utf8')).toBe('Fictional kept result')
  })

  it('explicit folders keep their existing meaning and ordinary gives make no default output folder', async () => {
    const { host, caller } = await setup()
    const explicit = join(world.folder, 'fictional-project')
    mkdirSync(explicit)
    const given = await world.gives(host, caller, 'document-reader', {
      parallel: true,
      folder: explicit,
    })
    expect(given).toMatchObject({
      ok: true,
      startedIn: explicit,
      givenFolder: { folder: explicit, use: 'working-folder' },
    })
    if (!given.ok) throw new Error('give refused')
    expect(given.givenFolder?.output).toBeUndefined()
    expect(readdirSync(world.folder)).not.toContain(WORKER_OUTPUT_DIRNAME)
    const ordinary = await world.gives(host, caller, 'document-reader')
    expect(ordinary).toMatchObject({ ok: true, owner: given.owner, givenFolder: null })
    expect(readdirSync(world.folder)).not.toContain(WORKER_OUTPUT_DIRNAME)
  })
  it('an unusable app-owned root creates no worker, identity copy, brief or request row', async () => {
    const { host, caller } = await setup()
    const root = join(world.folder, WORKER_OUTPUT_DIRNAME)
    mkdirSync(root)
    writeFileSync(join(root, 'someone-elses-file.md'), 'Fictional content')
    const before = world.conversationsRecorded()
    await expect(world.gives(host, caller, 'document-reader', { parallel: true })).rejects.toThrow(
      WORKER_OUTPUT_FAILURE,
    )
    expect(world.conversationsRecorded()).toBe(before)
    expect(world.store.workersBorn()).toEqual([])
    expect(world.sent).toEqual([])
    expect(readdirSync(root)).toEqual(['someone-elses-file.md'])
  })
})
