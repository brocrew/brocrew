import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { providerKnowledge } from '../src/main/providers'
import { SharedSkillDiscovery } from '../src/main/skills/shared-discovery'
import { sweepSkillViews } from '../src/main/skills/sweep-skill-views'

let root: string
let discovery: SharedSkillDiscovery | undefined
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-fern-formats-'))
})
afterEach(() => {
  discovery?.close()
  discovery = undefined
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('keeps native shared manifest bytes and exact installed tree vocabulary with their adapters', () => {
  const claude = providerKnowledge.claude.skills
  const codex = providerKnowledge.codex.skills
  expect([...claude.sharedFiles!()]).toEqual([
    ['.claude-plugin/plugin.json', '{"name":"shared-skills","version":"1.0.0","skills":["./"]}\n'],
  ])
  expect([...codex.sharedFiles!()]).toEqual([])
  for (const name of ['fern', 'fern-2', 'f'.repeat(64)]) {
    for (const [policy, prefix] of [
      [claude, 'claude-plugin'],
      [codex, 'codex'],
    ] as const) {
      expect(policy.installedEntry!(prefix)).toBe('directory')
      expect(policy.installedEntry!(`${prefix}/skills`)).toBe('directory')
      expect(policy.installedEntry!(`${prefix}/skills/${name}`)).toBe('directory')
      expect(policy.installedEntry!(`${prefix}/skills/${name}/SKILL.md`)).toBe('file')
    }
  }
  expect(claude.installedEntry!('claude-plugin/.claude-plugin')).toBe('directory')
  expect(claude.installedEntry!('claude-plugin/.claude-plugin/plugin.json')).toBe('file')
  for (const policy of [claude, codex]) {
    for (const path of [
      'other',
      '../outside',
      'codex/skills/Upper',
      'claude-plugin/skills/fern/extra',
      'codex/skills/' + 'f'.repeat(65),
    ]) {
      expect(policy.installedEntry!(path)).toBeNull()
    }
  }
})

it('writes the shared metadata supplied by a bound skill policy without native path guesses', async () => {
  mkdirSync(join(root, 'skills'))
  mkdirSync(join(root, 'skills-off'))
  const supplied = new Map([['fern-format/metadata.txt', 'Fictional fern metadata.\n']])
  const policy = providerKnowledge.claude.skills
  const files = vi.spyOn(policy, 'sharedFiles').mockImplementation(function (this: typeof policy) {
    expect(this).toBe(policy)
    return supplied
  })
  discovery = new SharedSkillDiscovery(root, Promise.resolve(), () => {
    throw new Error('No shipped catalogue read while preparing metadata')
  })
  const first = await discovery.root()
  expect(readFileSync(join(first, 'fern-format/metadata.txt'), 'utf8')).toBe(
    supplied.get('fern-format/metadata.txt'),
  )
  expect(existsSync(join(first, '.claude-plugin'))).toBe(false)
  expect(await discovery.root()).toBe(first)
  expect(files).toHaveBeenCalledOnce()
})

it('cleans an old view through its adapter format and keeps an unrecognized file', async () => {
  const home = join(root, 'homes', 'fern', 'provider')
  mkdirSync(home, { recursive: true })
  const old = join(home, `brobot-skills-${'a'.repeat(64)}-000001`)
  const kept = join(home, `brobot-skills-${'a'.repeat(64)}-000002`)
  for (const view of [old, kept]) {
    mkdirSync(join(view, 'fern-format'), { recursive: true })
    writeFileSync(join(view, 'fern-format/metadata.txt'), 'Fictional fern metadata.')
  }
  writeFileSync(join(kept, 'unrecognized.txt'), 'Keep this file.')
  const policy = providerKnowledge.claude.skills
  const classify = vi.spyOn(policy, 'installedEntry').mockImplementation(function (
    this: typeof policy,
    path,
  ) {
    expect(this).toBe(policy)
    return path === 'fern-format'
      ? 'directory'
      : path === 'fern-format/metadata.txt'
        ? 'file'
        : null
  })
  await sweepSkillViews(root, home, '')
  expect(existsSync(old)).toBe(false)
  expect(readFileSync(join(kept, 'unrecognized.txt'), 'utf8')).toBe('Keep this file.')
  expect(readFileSync(join(kept, 'fern-format/metadata.txt'), 'utf8')).toBe(
    'Fictional fern metadata.',
  )
  expect(classify).toHaveBeenCalled()
})
