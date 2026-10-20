import { afterEach, expect, it, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  CodexRuntime,
  type CodexIncoming,
  type CodexTransport,
  type SessionHandle,
} from '../../../packages/runtime/src/index'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  completedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
} from '../../../packages/runtime/test/fixtures/codex-protocol'
import { nodeFs } from '../src/main/recovery/files'
import { SharedSkillLibrary } from '../src/main/skills/shared-library'

class CatalogueTransport implements CodexTransport {
  readonly queue = new AsyncQueue<CodexIncoming>()
  readonly methods: string[] = []
  readonly offers: string[][] = []
  roots: string[] = []
  turns = 0
  constructor(
    readonly home: string,
    readonly cwd: string,
  ) {}
  async request(method: string, params: unknown): Promise<unknown> {
    this.methods.push(method)
    if (method === 'initialize')
      return {
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION}`,
        codexHome: this.home,
        platformFamily: 'unix',
        platformOs: 'macos',
      }
    if (method === 'skills/extraRoots/set')
      this.roots = (params as { extraRoots: string[] }).extraRoots
    if (method === 'skills/list') {
      const skills = []
      // Native skills live under skills, plus only the explicitly registered extra roots.
      for (const root of [join(this.home, 'skills'), ...this.roots]) {
        for (const name of await readdir(root).catch(() => [])) {
          const path = join(root, name, 'SKILL.md')
          if ((await lstat(path).catch(() => null))?.isFile())
            skills.push({ name, path, description: 'A fictional recipe.', enabled: true })
        }
      }
      this.offers.push(skills.map((one) => one.path))
      return { data: [{ cwd: this.cwd, errors: [], skills }] }
    }
    if (method === 'thread/start' || method === 'thread/resume')
      return threadStartResponse('th_1', this.cwd)
    if (method === 'turn/start') return turnStartResponse(`tn_${++this.turns}`)
    return {}
  }
  finish(): void {
    this.queue.push({
      kind: 'notification',
      method: 'turn/completed',
      params: turnCompletedNotification('th_1', completedTurn(`tn_${this.turns}`)),
    })
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
}
let root: string | undefined
let handle: SessionHandle | undefined
afterEach(async () => {
  await handle?.close()
  handle = undefined
  vi.restoreAllMocks()
  if (root) await rm(root, { recursive: true, force: true })
})
it.each(['start', 'resume'] as const)(
  'starts the %s turn after a failed hide and retries before the next turn',
  async (opening) => {
    root = await mkdtemp(join(tmpdir(), 'fictional-retained-turn-'))
    const data = root
    const home = join(data, 'provider-homes/default/cora/codex')
    const original = join(home, 'skills/recipe-check')
    await mkdir(original, { recursive: true })
    await writeFile(
      join(original, 'SKILL.md'),
      '---\nname: recipe-check\ndescription: A fictional recipe.\n---\n\nCheck flour.\n',
    )
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let failRename = false
    let renameAttempts = 0
    const fs = {
      ...nodeFs,
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        if (
          (await nodeFs.lstat(args[0]).catch(() => null))?.isDirectory() &&
          (args[0] === join(data, 'skills') || args[0].startsWith(join(data, 'skills') + sep))
        )
          throw Object.assign(new Error('fictional directory'), { code: 'EISDIR' })
        return nodeFs.open(...args)
      },
      rename: async (from: string, to: string) => {
        if (to.startsWith(join(home, 'skills-retained') + sep)) {
          renameAttempts++
          if (failRename) throw new Error('fictional rename failure')
        }
        await nodeFs.rename(from, to)
      },
    }
    const library = new SharedSkillLibrary(data, fs, Date.now, 'win32', 'first-app')
    await library.convert(async () => [])
    const transport = new CatalogueTransport(home, data)
    const runtime = new CodexRuntime(() => transport)
    const context = {
      providerHome: home,
      sharedSkillsRoot: library.active,
      builtInSkills: { root: join(home, 'built-ins'), skills: [] },
      beforeSkillDiscovery: () => library.beforeOffer(),
    }
    handle =
      opening === 'start'
        ? await runtime.start({ ...context, cwd: data })
        : await runtime.resume(
            { provider: 'codex', sessionId: 'th_1', cwd: data, rotation: 0 },
            context,
          )
    expect(transport.offers.at(-1)).toContain(join(original, 'SKILL.md'))
    await library.setEnabled('recipe-check', false)
    failRename = true
    const before = transport.methods.length
    await handle.send('Check the fictional recipe.')
    await vi.waitFor(() => expect(transport.turns).toBe(1))
    expect(transport.methods.slice(before)).toContain('skills/list')
    expect(transport.methods.slice(before)).toContain('turn/start')
    expect(transport.offers.at(-1)).toContain(join(original, 'SKILL.md'))
    expect(renameAttempts).toBe(1)
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
      'Could not hide a turned-off skill; trying again next turn.',
    )
    await expect(lstat(original)).resolves.toBeDefined()
    expect(await readdir(join(home, 'skills-retained'))).toEqual([])
    transport.finish()
    await vi.waitFor(() => expect(handle!.status()).toBe('idle'))
    failRename = false
    for (let n = 2; n <= 4; n++) {
      await handle.send('Check the fictional recipe.')
      await vi.waitFor(() => expect(transport.turns).toBe(n))
      expect(renameAttempts).toBe(2)
      expect(diagnostic).toHaveBeenCalledTimes(1)
      await expect(lstat(original)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(transport.offers.at(-1)).toEqual([])
      expect(transport.roots).toEqual([context.builtInSkills.root, library.active])
      const [id] = await readdir(join(home, 'skills-retained'))
      await expect(lstat(join(home, 'skills-retained', id!, 'SKILL.md'))).resolves.toBeDefined()
      transport.finish()
      await vi.waitFor(() => expect(handle!.status()).toBe('idle'))
    }
    expect(transport.methods).not.toContain('skills/config/write')
  },
)
