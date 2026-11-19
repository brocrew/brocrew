import { mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { WORKER_OUTPUT_DIRNAME } from '../src/main/worker-piece-folder'

describe('folders passed with work', () => {
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
  /** The worker replies done on its piece, and its provider turn drains. */
  const finishes = async (host: RuntimeHost, piece: string, owner: string) => {
    expect(
      await host.replyToParent(
        { piece, outcome: 'done', summary: 'Checked.', resourcePaths: [], needsUserAction: false },
        { ownerId: agentCallerId(owner) },
      ),
    ).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(world.handleOf('document-reader').status()).toBe('idle'))
  }
  it('restores the recorded output hint and grant after a restart, then ends only that piece’s grant', async () => {
    const { host, caller } = await setup()
    const first = await world.gives(host, caller, 'document-reader')
    if (!first.ok) throw new Error('setup refused')
    await finishes(host, first.piece, first.owner)
    const folder = join(world.folder, 'kept-result')
    mkdirSync(folder)
    const given = await world.gives(host, caller, 'document-reader', { to: first.owner, folder })
    if (!given.ok || given.givenFolder === null) throw new Error('give refused')
    writeFileSync(join(folder, 'draft.md'), 'Fictional kept result')
    await host.closeAll()
    world.db
      .prepare(
        `UPDATE events SET payload = json_set(payload, '$.givenFolder.output', json('true'))
         WHERE session_id = ? AND type = 'work_given' AND json_extract(payload, '$.piece') = ?`,
      )
      .run(given.owner, given.piece)
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
    const ordinary = await world.gives(host, caller, 'document-reader', { to: given.owner })
    expect(ordinary).toMatchObject({ ok: true, owner: given.owner, givenFolder: null })
    expect(readdirSync(world.folder)).not.toContain(WORKER_OUTPUT_DIRNAME)
  })
})
