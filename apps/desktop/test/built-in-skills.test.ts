import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_SKILL_NAMES,
  permittedInstalledSkillReminders,
} from '../src/shared/built-in-skills'
import {
  builtInSkillReminders,
  creationAllowedSkills,
  verifyBuiltInSkills,
} from '../src/main/skills/built-in-catalogue'
import {
  builtInSkillView,
  installNewSkillView,
  type NewSkillViewStorage,
} from '../src/main/skills/skill-view'

const resources = resolve(import.meta.dirname, '../resources/built-in-skills')
const manifest: unknown = JSON.parse(readFileSync(resolve(resources, 'manifest.json'), 'utf8'))
const bodies = new Map(
  BUILT_IN_SKILL_NAMES.map((name) => [
    name,
    readFileSync(resolve(resources, name, 'SKILL.md'), 'utf8'),
  ]),
)
const verified = () => verifyBuiltInSkills(manifest, bodies)

function fictionalStorage() {
  const directories = new Set<string>()
  const files = new Map<string, string>()
  const completed = new Set<string>()
  let reserved = 0
  const storage: NewSkillViewStorage = {
    async reserve() {
      const root = `/fictional/view-${++reserved}`
      directories.add(root)
      return root
    },
    async createDirectory(root, path) {
      const at = `${root}/${path}`
      if (directories.has(at) || files.has(at)) throw new Error('conflict')
      directories.add(at)
    },
    async createFile(root, path, text) {
      const at = `${root}/${path}`
      if (files.has(at) || directories.has(at)) throw new Error('conflict')
      files.set(at, text)
    },
    async readFile(root, path, maximumBytes) {
      const text = files.get(`${root}/${path}`)
      if (text === undefined || Buffer.byteLength(text) > maximumBytes) throw new Error('missing')
      return text
    },
    async complete(root) {
      completed.add(root)
    },
  }
  return { storage, directories, files, completed, reserved: () => reserved }
}

describe('the shipped instruction-only catalogue', () => {
  it('has eight exact bodies, names and descriptions', () => {
    const bundle = verified()
    expect(bundle.catalogue.skills.map((item) => item.name)).toEqual([...BUILT_IN_SKILL_NAMES])
    expect(bundle.bodies.size).toBe(8)
    expect(bundle.digest).toMatch(/^[a-f0-9]{64}$/)
  })
  it('retains both exact reminder blocks and final LF', () => {
    const blocks = [
      ...readFileSync(resolve(resources, 'turn-line.md'), 'utf8').matchAll(
        /```text\n([\s\S]*?)```/g,
      ),
    ]
    expect(builtInSkillReminders('codex', verified().catalogue.skills)).toBe(blocks[0]?.[1])
    expect(builtInSkillReminders('claude', verified().catalogue.skills)).toBe(blocks[1]?.[1])
  })
  it('omits build-a-team when creation is denied and restores it when allowed', () => {
    const catalogue = verified().catalogue
    expect(creationAllowedSkills(catalogue, false).map((item) => item.name)).toEqual(
      BUILT_IN_SKILL_NAMES.filter((name) => name !== 'build-a-team' && name !== 'add-a-capability'),
    )
    expect(creationAllowedSkills(catalogue, true)).toEqual(catalogue.skills)
    expect(creationAllowedSkills(catalogue, false, true).map((item) => item.name)).toEqual(
      BUILT_IN_SKILL_NAMES.filter((name) => name !== 'build-a-team'),
    )
  })
  it.each(['claude', 'codex'] as const)(
    'filters %s reminders after a grant change without offering uninstalled skills',
    (provider) => {
      const all = builtInSkillReminders(provider, verified().catalogue.skills)
      expect(permittedInstalledSkillReminders(all, true, false)).toBe(all)
      expect(permittedInstalledSkillReminders(all, false, false)).toBe(
        builtInSkillReminders(provider, creationAllowedSkills(verified().catalogue, false)),
      )
      expect(permittedInstalledSkillReminders(all, false, true)).toBe(
        builtInSkillReminders(provider, creationAllowedSkills(verified().catalogue, false, true)),
      )
      const installed = builtInSkillReminders(
        provider,
        creationAllowedSkills(verified().catalogue, false),
      )
      expect(permittedInstalledSkillReminders(installed, true, true)).toBe(installed)
    },
  )
  it('takes a later version label, so a running build still reads texts a newer commit wrote', () => {
    for (const version of ['v12', 'v9.1'])
      expect(
        verifyBuiltInSkills({ ...(manifest as object), version }, bodies).catalogue.version,
      ).toBe(version)
  })
  it('refuses another format, and a version label of another shape', () => {
    expect(() =>
      verifyBuiltInSkills({ ...(manifest as object), formatVersion: 2 }, bodies),
    ).toThrow()
    for (const version of ['6', 'v', 'v6.', 'V6', 'v6-beta', 6])
      expect(() => verifyBuiltInSkills({ ...(manifest as object), version }, bodies)).toThrow()
  })
  it('refuses changed body bytes and surplus bodies', () => {
    const changed = new Map(bodies)
    changed.set('delegate', bodies.get('delegate')! + 'changed')
    expect(() => verifyBuiltInSkills(manifest, changed)).toThrow('body')
    expect(() => verifyBuiltInSkills(manifest, new Map([...bodies, ['unknown', 'body']]))).toThrow(
      'files',
    )
  })
})

describe.each(['claude', 'codex'] as const)('the %s launch view', (provider) => {
  it('rejects an earlier body changed during a later write, before publishing the view', async () => {
    const bundle = verified(),
      view = builtInSkillView(provider, bundle, bundle.catalogue.skills)
    const fake = fictionalStorage()
    const original = fake.storage.createFile
    let first: string | undefined,
      writes = 0,
      published = false
    fake.storage.createFile = async (root, path, text) => {
      await original(root, path, text)
      if (path.endsWith('/SKILL.md') && first === undefined) first = `${root}/${path}`
      if (++writes > 2 && first !== undefined) {
        const current = fake.files.get(first)!
        fake.files.set(first, `X${current.slice(1)}`)
      }
    }
    await expect(
      installNewSkillView(fake.storage, view).then(() => {
        published = true
      }),
    ).rejects.toThrow('completed')
    expect(published).toBe(false)
    expect(fake.files.get(first!)?.startsWith('X')).toBe(true)
  })
  it('contains only the selected body files and the Claude plugin manifest', () => {
    const bundle = verified()
    const selected = creationAllowedSkills(bundle.catalogue, false)
    const view = builtInSkillView(provider, bundle, selected)
    expect(view.files.size).toBe(provider === 'claude' ? 7 : 6)
    expect([...view.files.keys()].some((path) => path.includes('build-a-team'))).toBe(false)
    expect(
      view.files.get(
        `${provider === 'claude' ? 'claude-plugin/skills' : 'codex/skills'}/delegate/SKILL.md`,
      ),
    ).toBe(bodies.get('delegate'))
  })
  it('publishes only after complete exclusive installation, keeping prior views', async () => {
    const bundle = verified(),
      view = builtInSkillView(provider, bundle, bundle.catalogue.skills)
    const fake = fictionalStorage()
    const first = await installNewSkillView(fake.storage, view)
    const old = [...fake.files]
    const next = await installNewSkillView(fake.storage, view)
    expect(first.root).not.toBe(next.root)
    expect(fake.completed).toEqual(new Set([first.root, next.root]))
    for (const [path, text] of old) expect(fake.files.get(path)).toBe(text)
    expect(first.discoveryPath).toBe(join(first.root, view.discoveryRoot))
  })
  it('does not overwrite a personal file carrying copied marker text', async () => {
    const bundle = verified(),
      view = builtInSkillView(provider, bundle, bundle.catalogue.skills)
    const fake = fictionalStorage(),
      create = fake.storage.createFile
    const marker = 'BroBot-owned-looking personal bytes'
    let personalPath = ''
    fake.storage.createFile = async (root, path, text) => {
      personalPath = `${root}/${path}`
      fake.files.set(personalPath, marker)
      await create(root, path, text)
    }
    await expect(installNewSkillView(fake.storage, view)).rejects.toThrow('conflict')
    expect(fake.files.get(personalPath)).toBe(marker)
    expect(fake.completed.size).toBe(0)
  })
  it('refuses changed read-back before publishing', async () => {
    const bundle = verified(),
      fake = fictionalStorage()
    fake.storage.readFile = async () => 'different'
    await expect(
      installNewSkillView(
        fake.storage,
        builtInSkillView(provider, bundle, bundle.catalogue.skills),
      ),
    ).rejects.toThrow('match')
    expect(fake.completed.size).toBe(0)
  })
  it('rejects traversal or added executable resources before reserving a view', async () => {
    const bundle = verified(),
      fake = fictionalStorage(),
      view = builtInSkillView(provider, bundle, bundle.catalogue.skills)
    const files = new Map(view.files)
    files.set('claude-plugin/../../personal', 'bad')
    await expect(installNewSkillView(fake.storage, { ...view, files })).rejects.toThrow('files')
    expect(fake.reserved()).toBe(0)
  })

  it('registers nothing after cancellation or stale publication', async () => {
    const bundle = verified(),
      fake = fictionalStorage()
    const view = builtInSkillView(provider, bundle, bundle.catalogue.skills)
    await expect(installNewSkillView(fake.storage, view, () => false)).rejects.toThrow('current')
    expect(fake.reserved()).toBe(0)
    let current = true
    fake.storage.complete = async () => {
      current = false
    }
    await expect(installNewSkillView(fake.storage, view, () => current)).rejects.toThrow('current')
    expect(fake.completed.size).toBe(0)
  })
})
