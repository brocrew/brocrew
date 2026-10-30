import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, symlink, mkdir, writeFile } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as discoveryModule from '../src/main/skills/shared-discovery'
import { SharedSkillDiscovery } from '../src/main/skills/shared-discovery'
import { SharedSkillLibrary } from '../src/main/skills/shared-library'
import { readBuiltInSkills } from '../src/main/skills/prepare-built-in-skills'
import { creationAllowedSkills } from '../src/main/skills/built-in-catalogue'
import { writeAtomically } from '../src/main/recovery/files'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import type { RuntimeHost, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { SkillsRequest } from '../src/shared/skills-window'

// Pass through the real filesystem while making its open boundary observable in this suite.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

interface Access {
  profileId: string
  canCreateAgents: boolean
  isCoordinator: boolean
}
interface Entry {
  folder: string
  name: string
  description: string
  builtIn: boolean
  enabled: boolean
  given: boolean
}
interface Reading {
  operation: 'profile-list'
  profileId: string
  skills: Entry[]
  nextOffset: number | null
  readAt: number
}
let root: string
let service: SharedSkillDiscovery
let known: Map<string, Access>
const shipped = () =>
  readBuiltInSkills(resolve(import.meta.dirname, '../resources/built-in-skills'))
const body = (name = 'recipe-check', description = 'Check a fictional recipe.') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nFICTIONAL-PRIVATE-SKILL-BODY\n`

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fictional-profile-skills-'))
  await new SharedSkillLibrary(root).convert(async () => [])
  known = new Map([
    ['quill', { profileId: 'quill', canCreateAgents: false, isCoordinator: false }],
    ['wren', { profileId: 'wren', canCreateAgents: true, isCoordinator: false }],
    ['brobot', { profileId: 'brobot', canCreateAgents: false, isCoordinator: true }],
  ])
  // The private main-owned resolver is separate from the window request.
  service = Reflect.construct(SharedSkillDiscovery, [
    root,
    Promise.resolve(),
    shipped,
    undefined,
    (profile: string) => known.get(profile) ?? null,
  ]) as SharedSkillDiscovery
})
afterEach(async () => {
  service.close()
  await rm(root, { recursive: true, force: true })
})

async function inventory(profileId = 'quill', offset?: number): Promise<Reading> {
  const reply = await service.window({
    operation: 'profile-list',
    profileId,
    ...(offset === undefined ? {} : { offset }),
  } as unknown as SkillsRequest)
  expect(reply.operation, 'the live Skills service needs a profile metadata reading').toBe(
    'profile-list',
  )
  return reply as unknown as Reading
}

function sink(person: boolean): RuntimeEventSink {
  return {
    ownerId: person ? 'webContents:fictional' : 'agent:fictional',
    alive: true,
    aPersonIsBehindIt: person,
    send: () => {},
    sendLiveness: () => {},
  }
}

describe('the profile Skills inventory uses the real delivery policy', () => {
  it('derives a known folded profile and its creation grant without inventing an identity', () => {
    const readAccess = Reflect.get(discoveryModule, 'profileSkillAccess') as
      | undefined
      | ((
          store: { capabilitiesOf(profile: string): { canCreateAgents: string } | null },
          profile: string,
        ) => Access | null)
    expect(readAccess, 'profile Skills access must come from the main-owned store').toBeTypeOf(
      'function',
    )
    const capabilitiesOf = vi.fn((profile: string) =>
      profile === 'quill' || profile === 'brobot' ? { canCreateAgents: 'none' } : null,
    )
    expect(readAccess!({ capabilitiesOf }, 'QuIll')).toEqual({
      profileId: 'quill',
      canCreateAgents: false,
      isCoordinator: false,
    })
    expect(readAccess!({ capabilitiesOf }, 'brobot')).toEqual({
      profileId: 'brobot',
      canCreateAgents: false,
      isCoordinator: true,
    })
    expect(readAccess!({ capabilitiesOf }, 'missing-agent')).toBeNull()
    expect(capabilitiesOf.mock.calls).toEqual([['quill'], ['brobot'], ['missing-agent']])
  })

  it('reads both real creation reach values from the main store', () => {
    const readAccess = Reflect.get(discoveryModule, 'profileSkillAccess') as
      | undefined
      | ((
          store: { capabilitiesOf(profile: string): { canCreateAgents: string } | null },
          profile: string,
        ) => Access | null)
    expect(readAccess).toBeTypeOf('function')
    for (const reach of ['none', 'any'] as const) {
      const capabilitiesOf = vi.fn(() => ({ canCreateAgents: reach }))
      expect(readAccess!({ capabilitiesOf }, 'QuIll')).toEqual({
        profileId: 'quill',
        canCreateAgents: reach === 'any',
        isCoordinator: false,
      })
      expect(capabilitiesOf).toHaveBeenCalledExactlyOnceWith('quill')
    }
  })

  it('opens a shared header once, and leaves out only a skill linked outside the library', async () => {
    // Exercise the real Windows final-file flush on every OS, then measure inventory only.
    const target = join(root, 'skills/recipe-check/SKILL.md')
    await mkdir(join(root, 'skills/recipe-check'))
    await writeAtomically(target, body(), undefined, 'win32')
    const open = vi.spyOn(fsPromises, 'open')
    try {
      open.mockClear()
      const answer = await inventory()
      expect(answer.skills.some((one) => one.folder === 'recipe-check')).toBe(true)
      expect(open.mock.calls.filter(([path]) => String(path) === target)).toHaveLength(1)
      await mkdir(join(root, 'outside'))
      await writeFile(join(root, 'outside/private.md'), body('outside-private', 'PRIVATE OUTSIDE'))
      await mkdir(join(root, 'skills/plum-notes'))
      await writeFile(join(root, 'skills/plum-notes/SKILL.md'), body('plum-notes'))
      await rm(target)
      await symlink(join(root, 'outside/private.md'), target)
      const linked = await inventory()
      expect(linked.skills.some((one) => one.folder === 'recipe-check')).toBe(false)
      expect(linked.skills.some((one) => one.folder === 'plum-notes')).toBe(true)
      expect(JSON.stringify(linked)).not.toContain('PRIVATE OUTSIDE')
      await rm(target)
      await symlink(join(root, 'outside/missing.md'), target)
      expect((await inventory()).skills.some((one) => one.folder === 'plum-notes')).toBe(true)
      await symlink(join(root, 'outside'), join(root, 'skills/linked-folder'), 'dir')
      expect((await inventory()).skills.some((one) => one.folder === 'plum-notes')).toBe(true)
    } finally {
      open.mockRestore()
    }
  })

  it.each(['quill', 'wren', 'brobot'])(
    'offers the same built-ins as the launch selector for %s',
    async (profileId) => {
      const answer = await inventory(profileId)
      const access = known.get(profileId)!
      const selected = creationAllowedSkills(
        shipped().catalogue,
        access.canCreateAgents,
        access.isCoordinator,
      ).map((one) => one.name)
      expect(answer.profileId).toBe(profileId)
      expect(
        answer.skills.filter((one) => one.builtIn && one.given).map((one) => one.name),
      ).toEqual(selected)
      expect(answer.skills.filter((one) => one.builtIn).every((one) => one.enabled)).toBe(true)
      const team = answer.skills.find((one) => one.builtIn && one.name === 'build-a-team')!
      const capability = answer.skills.find(
        (one) => one.builtIn && one.name === 'add-a-capability',
      )!
      expect(team.given).toBe(access.canCreateAgents)
      expect(capability.given).toBe(access.canCreateAgents || access.isCoordinator)
    },
  )

  it('keeps shared global off separate from a built-in grant, even with the same native name', async () => {
    await service.library.save('shared-helper/SKILL.md', body('build-a-team'))
    await service.library.save('recipe-check/SKILL.md', body())
    await service.library.setEnabled('recipe-check', false)
    const answer = await inventory()
    expect(
      answer.skills.find((one) => !one.builtIn && one.folder === 'shared-helper'),
    ).toMatchObject({ name: 'build-a-team', enabled: true, given: true })
    expect(
      answer.skills.find((one) => !one.builtIn && one.folder === 'recipe-check'),
    ).toMatchObject({ enabled: false, given: false })
    expect(answer.skills.find((one) => one.builtIn && one.name === 'build-a-team')).toMatchObject({
      enabled: true,
      given: false,
    })
  })

  it('returns metadata only, without invoking the full-body list, conversion, launch preparation or a write', async () => {
    await service.library.save('recipe-check/SKILL.md', body())
    const original = await readFile(join(root, 'skills/recipe-check/SKILL.md'), 'utf8')
    const list = vi
      .spyOn(service, 'list')
      .mockRejectedValue(new Error('metadata must not read full skill bodies'))
    const convert = vi.spyOn(service.library, 'convert')
    const save = vi.spyOn(service.library, 'save')
    const toggle = vi.spyOn(service.library, 'setEnabled')
    const prepare = vi.spyOn(service, 'prepareLaunch')
    const answer = await inventory()
    expect(answer.readAt).toEqual(expect.any(Number))
    expect(answer.skills.find((one) => one.folder === 'recipe-check')).toMatchObject({
      name: 'recipe-check',
      description: 'Check a fictional recipe.',
    })
    for (const one of answer.skills) {
      expect(one).not.toHaveProperty('body')
      expect(one).not.toHaveProperty('path')
    }
    expect(JSON.stringify(answer)).not.toContain('FICTIONAL-PRIVATE-SKILL-BODY')
    expect(JSON.stringify(answer)).not.toContain(root)
    expect(list).not.toHaveBeenCalled()
    expect(convert).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(toggle).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(await readFile(join(root, 'skills/recipe-check/SKILL.md'), 'utf8')).toBe(original)
  })

  it('reads bounded frontmatter from a large body and returns a bounded one-line description', async () => {
    await service.library.save(
      'recipe-check/SKILL.md',
      body('recipe-check', 'x'.repeat(900)) + 'y'.repeat(2 * 1024 * 1024),
    )
    const answer = await inventory()
    const one = answer.skills.find((one) => !one.builtIn && one.folder === 'recipe-check')!
    expect(one.name).toBe('recipe-check')
    expect(one.description.length).toBeGreaterThan(0)
    expect(one.description.length).toBeLessThanOrEqual(500)
    expect(one.description).not.toMatch(/[\r\n]/)
    expect(JSON.stringify(one)).not.toContain('yyy')
  })

  it('pages a large inventory without dropping entries or reading hidden bodies', async () => {
    for (let n = 0; n < 60; n++)
      await service.library.save(
        `recipe-${String(n).padStart(2, '0')}/SKILL.md`,
        body(`recipe-${n}`),
      )
    const first = await inventory()
    expect(first.skills).toHaveLength(50)
    expect(first.nextOffset).toBe(50)
    const second = await inventory('quill', first.nextOffset!)
    expect(second.skills).toHaveLength(18)
    expect(second.nextOffset).toBeNull()
    expect(
      new Set([...first.skills, ...second.skills].map((one) => `${one.builtIn}/${one.folder}`))
        .size,
    ).toBe(68)
  })

  it('does not report a missing source directory as an empty successful inventory', async () => {
    await rm(join(root, 'skills'), { recursive: true })
    await expect(
      service.window({ operation: 'profile-list', profileId: 'quill' } as unknown as SkillsRequest),
    ).rejects.toThrow()
  })

  it('ignores an empty folder beside a readable shared skill', async () => {
    await service.library.save('recipe-check/SKILL.md', body())
    await mkdir(join(root, 'skills/unfinished'))
    const answer = await service
      .window({ operation: 'profile-list', profileId: 'quill' } as unknown as SkillsRequest)
      .then(
        (reply) => ({ reply, error: null }),
        (error: unknown) => ({ reply: null, error }),
      )
    expect(answer.error, 'a folder without SKILL.md is not a broken skill').toBeNull()
    expect(answer.reply).toMatchObject({
      operation: 'profile-list',
      skills: expect.arrayContaining([expect.objectContaining({ folder: 'recipe-check' })]),
    })
    expect(
      (answer.reply as unknown as Reading).skills.some((one) => one.folder === 'unfinished'),
    ).toBe(false)
  })

  it('accepts only profile and bounded paging fields, and keeps the operation person-only', async () => {
    const valid = { operation: 'profile-list', profileId: 'quill' }
    expect(SkillsRequest.safeParse(valid).success).toBe(true)
    expect(runtimeCommandSchema.safeParse({ kind: 'skills', request: valid }).success).toBe(true)
    for (const extra of [
      { canCreateAgents: true },
      { isCoordinator: true },
      { body: 'forged' },
      { offset: -1 },
      { offset: Number.MAX_SAFE_INTEGER },
    ])
      expect(SkillsRequest.safeParse({ ...valid, ...extra }).success).toBe(false)
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'skills',
        request: { ...valid, canCreateAgents: true },
      }).success,
    ).toBe(false)
    const run = vi.fn(service.window)
    const host = { closing: false, skillsForAPerson: run } as unknown as RuntimeHost
    await expect(
      executeRuntimeCommand(host, sink(false), { kind: 'skills', request: valid }),
    ).rejects.toThrow('unless a person is asking')
    expect(run).not.toHaveBeenCalled()
    await expect(
      executeRuntimeCommand(host, sink(true), { kind: 'skills', request: valid }),
    ).resolves.toMatchObject({ operation: 'profile-list', profileId: 'quill' })
  })

  it('refuses an unknown profile without publishing defaults or touching skill sources', async () => {
    const list = vi.spyOn(service, 'list')
    expect(
      await service.window({
        operation: 'profile-list',
        profileId: 'missing-agent',
      } as unknown as SkillsRequest),
    ).toEqual({ operation: 'refused', reason: 'identity' })
    expect(list).not.toHaveBeenCalled()
    expect(known.has('missing-agent')).toBe(false)
  })

  it('wires the real main-owned profile resolver and removes the launch all-shipped bypass', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/main/index.ts'), 'utf8')
    expect(source).not.toMatch(/\ballShipped:\s*true\b/)
    expect(source).toMatch(/profileSkillAccess\(\s*store,\s*profileId,?\s*\)/)
  })
})
