import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeProjectDirName } from '@brobot2/runtime'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { F093World, waitFor } from './lib/f093-host'

/**
 * Archiving and deleting a conversation, read off the real host and store.
 *
 * Archive keeps everything, stops what runs and takes the conversation and its helpers out of the
 * rail and Team; All conversations still lists it, marked, and restoring brings it back. Something
 * given to it brings it back too. Delete removes only the parts a person ticks, from a list read
 * first: a helper only with the conversation that gave it work, never one another conversation
 * also used.
 */

let world: F093World
let host: RuntimeHost

beforeEach(() => {
  world = new F093World()
  host = world.buildHost(false)
})

afterEach(async () => {
  await world.dispose()
})

const listed = (): string[] => [
  ...host.resumableSessions().map(({ sessionId }) => sessionId),
  ...host.unresumableSessions().map(({ sessionId }) => sessionId),
]

const forest = (): string[] =>
  host
    .theWholeForest()
    .nodes.rows.flatMap((row) => (row.node === 'a-conversation' ? [row.conversation] : []))

/** A helper row below `parent`, as a give makes one, in the same agent's folder. */
function aHelperOf(parent: string, id: string): string {
  world.store.create({
    id,
    provider: 'claude',
    cwd: world.project,
    approvalMode: 'auto',
    profileId: 'pm',
    parentSessionId: parent,
  })
  return id
}

describe('archiving a conversation', () => {
  it('stops it, keeps it, and takes it and its helpers out of the rail and Team', async () => {
    const root = await world.open(host, 'claude', 'pm')
    const helper = aHelperOf(root, 'helper_1')
    expect(listed()).toEqual(expect.arrayContaining([root, helper]))
    expect(forest()).toEqual(expect.arrayContaining([root, helper]))

    expect(await host.archiveConversation(root)).toEqual({
      done: true,
      conversations: [root, helper],
    })
    expect(listed()).not.toContain(root)
    expect(listed()).not.toContain(helper)
    expect(forest()).not.toContain(root)
    expect(forest()).not.toContain(helper)
    // Kept: its records are all there, and All conversations lists it, marked.
    expect(world.store.recordedOne(root)).not.toBeNull()
    const library = await host.listLibrary()
    expect(library.entries.find((entry) => entry.recordId === root)?.archivedAt).toEqual(
      expect.any(Number),
    )
    // The library's Archived filter is answered by the host, over every row it holds.
    const recordIds = async (archived: 'only' | 'left-out') =>
      (await host.listLibrary({ filters: { archived } })).entries.map((entry) => entry.recordId)
    expect(await recordIds('only')).toEqual(expect.arrayContaining([root, helper]))
    expect(await recordIds('left-out')).not.toContain(root)
    expect(await recordIds('left-out')).not.toContain(helper)

    expect(host.restoreConversation(root)).toEqual({ done: true, conversations: [root, helper] })
    expect(listed()).toEqual(expect.arrayContaining([root, helper]))
    const after = await host.listLibrary()
    expect(after.entries.find((entry) => entry.recordId === root)?.archivedAt).toBeUndefined()
    expect(await recordIds('only')).toEqual([])
    expect(await recordIds('left-out')).toEqual(expect.arrayContaining([root, helper]))
  })

  it('comes back when a person sends it something', async () => {
    const root = await world.open(host, 'claude', 'pm')
    await host.archiveConversation(root)
    expect(listed()).not.toContain(root)
    await host.send(root, 'one more thing', world.window)
    await waitFor(() => listed().includes(root), 'the conversation to come back')
    // …and its transcript says so, never silently.
    await waitFor(
      () => world.ledger(root).some((event) => event.type === 'reopened'),
      'the reopened row',
    )
    expect(world.ledger(root)).toContainEqual({
      type: 'reopened',
      broughtBack: 'Brought back from the archive: you wrote to it.',
    })
  })

  it('stays archived when a message’s start was waiting on its stop, and the message says why', async () => {
    const root = await world.open(host, 'claude', 'pm')
    const { handle } = world.end.newest()
    let letItClose = (): void => {}
    const held = new Promise<void>((resolve) => (letItClose = resolve))
    const close = handle.close.bind(handle)
    Object.defineProperty(handle, 'close', {
      value: async (): Promise<void> => {
        await held
        await close()
      },
      configurable: true,
    })
    const closing = host.close(root, world.window)
    // On its way out: the message's start waits for the stop, then the archive begins.
    const sent = host.send(root, 'one more thing', world.window)
    const archiving = host.archiveConversation(root)
    letItClose()
    await closing

    expect(await archiving).toEqual({ done: true, conversations: [root] })
    await expect(sent).rejects.toThrow(
      'This conversation is being archived, so it was not started.',
    )
    expect(listed()).not.toContain(root)
    expect(world.launchesOf(root)).toHaveLength(1)
    expect(world.ledger(root).some((event) => event.type === 'reopened')).toBe(false)
  })

  it('refuses one that does not exist, and restoring one that is not archived', async () => {
    expect(await host.archiveConversation('nobody')).toMatchObject({ done: false })
    const root = await world.open(host, 'claude', 'pm')
    expect(host.restoreConversation(root)).toEqual({
      done: false,
      refusal: 'Neither this conversation nor any below it is archived.',
    })
  })
})

describe('deleting a conversation', () => {
  /** A transcript and a memory note of `sessionId` in the pm agent's Claude folder. */
  function itsFiles(sessionId: string): { transcript: string; note: string; other: string } {
    const home = world.homeOf('claude', 'pm')
    const projects = join(home, 'projects', claudeProjectDirName(world.project))
    mkdirSync(join(projects, sessionId, 'tool-results'), { recursive: true })
    const transcript = join(projects, `${sessionId}.jsonl`)
    writeFileSync(
      transcript,
      `{"cwd":${JSON.stringify(world.project)},"sessionId":"${sessionId}"}\n`,
    )
    writeFileSync(join(projects, sessionId, 'tool-results', 'out.txt'), 'searched')
    const memory = join(home, 'memory')
    mkdirSync(memory, { recursive: true })
    const note = join(memory, 'its-note.md')
    writeFileSync(
      note,
      `---\nname: its-note\ndescription: what it learned\nmetadata:\n  originSessionId: ${sessionId}\n---\nbody\n`,
    )
    const other = join(memory, 'another.md')
    writeFileSync(other, '---\nname: another\nmetadata:\n  originSessionId: someone-else\n---\n')
    return { transcript, note, other }
  }

  it('lists what it would remove, and removes only what is ticked', async () => {
    const root = await world.open(host, 'claude', 'pm')
    const helper = aHelperOf(root, 'helper_1')
    await host.archiveConversation(root)
    const providerId = world.store.recordedOne(root)?.providerSessionId ?? ''
    expect(providerId).not.toBe('')
    const files = itsFiles(providerId)

    const verdict = host.deleteVerdict(root)
    if (!verdict.ok) throw new Error(verdict.refusal)
    expect(verdict.helpers.map(({ conversation }) => conversation)).toEqual([helper])
    const ids = verdict.parts.map(({ id }) => id)
    expect(ids).toEqual(['records', `files:${root}`, `note:${files.note}`])
    expect(verdict.parts[1]?.paths).toEqual(
      expect.arrayContaining([files.transcript, join(files.transcript.replace(/\.jsonl$/, ''))]),
    )
    expect(verdict.cannot.join(' ')).toContain('recovery copies')

    // The note left unticked stays; everything ticked goes.
    const done = await host.deleteConversation(root, ['records', `files:${root}`])
    expect(done).toEqual({
      done: true,
      removed: [`files:${root}`, 'records'],
      left: [],
      recordsKept: null,
    })
    expect(world.store.recordedOne(root)).toBeNull()
    expect(world.store.recordedOne(helper)).toBeNull()
    const library = await host.listLibrary()
    expect(library.entries.some((entry) => entry.recordId === root)).toBe(false)
    expect(existsSync(files.transcript)).toBe(false)
    expect(existsSync(files.note)).toBe(true)
    expect(readFileSync(files.other, 'utf8')).toContain('someone-else')
  })

  it('refuses a helper on its own, and a tree another conversation used', async () => {
    const root = await world.open(host, 'claude', 'pm')
    const helper = aHelperOf(root, 'helper_1')
    expect(host.deleteVerdict(helper)).toMatchObject({
      ok: false,
      refusal: expect.stringContaining('so it is deleted only with'),
    })
    const outside = await world.open(host, 'claude', 'pm')
    world.store.append(
      helper,
      0,
      { type: 'user_turn', text: 'hi', relayedFrom: outside },
      Date.now(),
    )
    expect(host.deleteVerdict(root)).toMatchObject({
      ok: false,
      refusal: expect.stringContaining('wrote to its helper'),
    })
  })

  it('ends the questions others asked it, in their own ledgers', async () => {
    const root = await world.open(host, 'claude', 'pm')
    const asker = await world.open(host, 'claude', 'pm')
    await host.close(asker, world.window)
    const at = Date.now()
    const next = world.store.events(asker).length
    world.store.append(
      asker,
      next,
      {
        type: 'question_asked',
        requestId: 'req_1',
        prompt: 'Which one?',
        questions: [{ id: 'answer', prompt: 'Which one?', options: [] }],
      },
      at,
    )
    world.store.append(
      asker,
      next + 1,
      { type: 'request_routed', requestId: 'req_1', to: 'an-agent', parent: root },
      at,
    )
    const verdict = host.deleteVerdict(root)
    if (!verdict.ok) throw new Error(verdict.refusal)
    expect(verdict.ends.filter((line) => line.endsWith('ends unanswered.'))).toHaveLength(1)
    expect(verdict.ends.join(' ')).toContain('stopped first if the records or its transcript')

    await host.deleteConversation(root, ['records'])
    expect(world.ledger(asker)).toContainEqual({
      type: 'question_recipient_ended',
      requestId: 'req_1',
      recipient: root,
    })
  })

  it('refuses a list that changed since it was read, and an empty one', async () => {
    const root = await world.open(host, 'claude', 'pm')
    expect(await host.deleteConversation(root, ['note:/nowhere.md'])).toMatchObject({
      done: false,
      refusal: expect.stringContaining('read it again'),
    })
    expect(await host.deleteConversation(root, [])).toMatchObject({ done: false })
    expect(world.store.recordedOne(root)).not.toBeNull()
  })
})
