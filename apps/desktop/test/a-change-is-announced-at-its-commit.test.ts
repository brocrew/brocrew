import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { SessionBundle } from '../src/main/archive/export-session'
import { CLAUDE_JSONL } from '../src/main/archive/native-file'
import { resourcesRoot } from '../src/main/resources/resources'
import type { RuntimeChangeMessage, RuntimeStatesMessage } from '../src/shared/runtime-ipc'

const removal = vi.hoisted(() => ({ held: null as Promise<void> | null, started: 0 }))

vi.mock('../src/main/conversation-files', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/conversation-files')>()
  return {
    ...real,
    removeFromHome: async (...args: Parameters<typeof real.removeFromHome>) => {
      removal.started++
      if (removal.held !== null) await removal.held
      return real.removeFromHome(...args)
    },
  }
})

/** Every window learns of a committed change: the stopped conversations a move touches, every
 * import, and a deletion as soon as its records are gone. */
describe('a committed change is announced at its commit', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let announced: RuntimeChangeMessage['what'][]
  let states: RuntimeStatesMessage[]

  const loopTurns = async (n = 3) => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  const said = (conversation: string) =>
    states.flatMap((message) => message.moved).filter((one) => one.conversation === conversation)

  beforeEach(() => {
    announced = []
    states = []
    removal.held = null
    removal.started = 0
    world = aServiceWorld()
    world.anAgent('source', 'normal')
    world.anAgent('target', 'normal')
    host = world.aHost({
      servicesOn: false,
      announce: (message) => announced.push(message.what),
      statesMoved: (message) => states.push(message),
    })
  })
  afterEach(async () => world.cleanUp())

  it('a move between two stopped conversations tells the windows what each is doing now', async () => {
    const source = await world.aPersonOpens(host, 'source')
    const target = await world.aPersonOpens(host, 'target')
    await host.send(source, 'Please check the fictional release notes.', world.window)
    const asked = await host.raiseAQuestion(
      {
        piece: null,
        question: 'The target owns this subject.',
        options: [],
        who: 'a-person',
        agent: null,
        moveTo: target,
      },
      { ownerId: agentCallerId(source) },
    )
    if (!asked.ok) throw new Error(asked.refusal.reason)
    await host.close(source, world.window)
    await host.close(target, world.window)
    await loopTurns()
    const sourceBefore = said(source).length
    states = []

    const ack = await host.decideMoveRequest(
      { sessionId: source, requestId: asked.question, decision: 'move' },
      world.window,
    )
    expect(ack.outcome).toBe('moved')
    await loopTurns()

    expect(sourceBefore).toBeGreaterThan(0)
    expect(said(source)).toHaveLength(1)
    expect(said(source)[0]?.state.is).not.toBe('needs-you')
  })

  it('an imported conversation is announced to every window, once', async () => {
    const bundle: SessionBundle = {
      bundleVersion: 2,
      meta: {
        sessionId: 'exported-elsewhere',
        provider: 'claude',
        ref: { provider: 'claude', sessionId: 'thread-9', cwd: '/tmp/there', rotation: 0 },
        cwd: '/tmp/there',
        profileId: 'default',
        status: 'ended',
        adoptedAt: null,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
      },
      raw: { format: CLAUDE_JSONL, frames: ['{"line":1}'] },
      ledger: [
        { ordinal: 0, at: 1_700_000_000_000, event: { type: 'assistant_message', text: 'hi' } },
      ],
    }
    await loopTurns()
    announced = []
    host.importBundle(bundle)
    await loopTurns()
    expect(announced.filter((what) => what === 'conversations')).toHaveLength(1)
  })

  it('a deletion is announced once its records are gone, before its kept files are removed', async () => {
    const root = await world.aPersonOpens(host, 'source')
    const piece = world.store.rootOf(root)!.piece
    const resources = join(resourcesRoot(world.folder), 'f'.repeat(64))
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'notes.md'), '# Fictional notes\n')
    world.store.addResource(
      {
        piece,
        role: 'made',
        title: 'Fictional notes',
        summary: null,
        name: 'notes.md',
        sha256: 'f'.repeat(64),
        bytes: 18,
        addedBy: null,
      },
      world.clock++,
    )
    await host.close(root, world.window)
    await loopTurns()
    announced = []
    let release!: () => void
    removal.held = new Promise<void>((resolve) => (release = resolve))

    const deleting = host.deleteConversation(root, ['records'])
    await vi.waitFor(() => expect(removal.started).toBeGreaterThan(0))
    await loopTurns()
    const beforeRemoval = [...announced]
    release()
    expect(await deleting).toMatchObject({ done: true })
    await loopTurns()

    expect(beforeRemoval).toContain('conversations')
    expect(beforeRemoval).toContain('work')
    expect(announced.filter((what) => what === 'conversations')).toHaveLength(1)
  })
})
