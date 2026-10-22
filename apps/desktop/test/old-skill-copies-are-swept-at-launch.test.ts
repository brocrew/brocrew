import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareBuiltInSkills, readBuiltInSkills } from '../src/main/skills/prepare-built-in-skills'
import { createLaunchRegistry } from '../src/main/runtime/launch-registry'
import { sweepSkillViews } from '../src/main/skills/sweep-skill-views'

const resources = resolve(import.meta.dirname, '../resources/built-in-skills')
const bundle = readBuiltInSkills(resources)
let root: string, home: string
const children: ChildProcess[] = []
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-maple-skills-'))
  home = join(root, 'homes', 'maple-writer', 'provider')
  mkdirSync(home, { recursive: true, mode: 0o700 })
})
afterEach(async () => {
  await sweepSkillViews(root, home, '')
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit')
      child.kill()
      await stopped
    }
  }
  rmSync(root, { recursive: true, force: true })
})
const copies = () =>
  readdirSync(home).filter((name) => /^brobot-skills-[a-f0-9]{64}-[A-Za-z0-9]{6}$/.test(name))
function legacy(suffix: string, provider = 'codex'): string {
  const folder = join(home, `brobot-skills-${'a'.repeat(64)}-${suffix}`)
  const skill = join(
    folder,
    provider === 'codex' ? 'codex/skills' : 'claude-plugin/skills',
    'maple-check',
  )
  mkdirSync(skill, { recursive: true, mode: 0o700 })
  writeFileSync(join(skill, 'SKILL.md'), 'A fictional maple check.', { mode: 0o400 })
  return folder
}
async function launch(
  provider: 'claude' | 'codex' = 'codex',
  inUseUntil?: Promise<void>,
  isCurrent = () => true,
) {
  const prepared = await prepareBuiltInSkills({
    provider,
    providerHome: home,
    managedRoot: root,
    shipped: () => bundle,
    canCreateAgents: true,
    isCoordinator: false,
    isCurrent,
    ...(inUseUntil ? { inUseUntil } : {}),
  })
  // Cleanup is background work now. These tests assert its eventual safety and retention rules.
  await sweepSkillViews(root, home, viewRoot(prepared.context.root, provider))
  return prepared
}
const viewRoot = (discovery: string, provider: 'claude' | 'codex') =>
  provider === 'claude' ? dirname(discovery) : dirname(dirname(discovery))
const readable = (prepared: Awaited<ReturnType<typeof launch>>) =>
  prepared.context.skills.every((skill) => readFileSync(skill.path, 'utf8').includes('---'))

describe.each(['claude', 'codex'] as const)('%s launches sweep old skill copies', (provider) => {
  it('removes legacy and incomplete copies while keeping the current copy and unrelated entries', async () => {
    const old = legacy('Maple1', provider)
    const unfinished = join(home, `brobot-skills-${'b'.repeat(64)}-Maple2`)
    mkdirSync(unfinished)
    const unrelated = join(home, 'person-notes')
    mkdirSync(unrelated)
    writeFileSync(join(unrelated, 'note.txt'), 'Keep my fictional note.')
    writeFileSync(join(home, 'brobot-skills-not-generated'), 'Keep this too.')
    const prepared = await launch(provider)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(unfinished)).toBe(false)
    expect(copies()).toEqual([basename(viewRoot(prepared.context.root, provider))])
    expect(readable(prepared)).toBe(true)
    expect(readFileSync(join(unrelated, 'note.txt'), 'utf8')).toBe('Keep my fictional note.')
    expect(readFileSync(join(home, 'brobot-skills-not-generated'), 'utf8')).toBe('Keep this too.')
  })

  it('keeps concurrent conversations until confirmed termination, even after cancellation or a grant change', async () => {
    for (const name of ['Pine01', 'Pine02', 'Pine03']) legacy(name, provider)
    const registry = createLaunchRegistry()
    const first = registry.open('fictional maple session', 'maple-one')
    let current = true
    const [one, two] = await Promise.all([
      launch(provider, first.settled, () => current),
      launch(provider),
    ])
    expect(copies()).toHaveLength(2)
    current = false // the launch freshness check is deliberately not its lifetime
    registry.cancel(first)
    let stopped!: () => void
    const termination = new Promise<void>((done) => {
      stopped = done
    })
    registry.finish(first, termination)
    await launch(provider)
    expect(readable(one)).toBe(true)
    expect(readable(two)).toBe(true)
    expect(copies()).toHaveLength(3)
    stopped()
    await first.settled
    await launch(provider)
    expect(existsSync(one.context.root)).toBe(false)
    expect(readable(two)).toBe(true)
    expect(copies()).toHaveLength(3)
  })
})

it('keeps a copy owned by a separate live process and sweeps it only after that process exits', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  children.push(child)
  await once(child, 'spawn')
  const old = legacy('Cedar1')
  writeFileSync(
    join(old, '.brobot-skills-owner.json'),
    JSON.stringify({ host: hostname(), pid: child.pid }),
  )
  await launch()
  expect(existsSync(old)).toBe(true)
  const stopped = once(child, 'exit')
  child.kill()
  await stopped
  await launch()
  expect(existsSync(old)).toBe(false)
})

it('keeps uncertain ownership rather than treating malformed or foreign owners as dead', async () => {
  const malformed = legacy('Cedar2')
  writeFileSync(join(malformed, '.brobot-skills-owner.json'), '{incomplete')
  const foreign = legacy('Cedar3')
  writeFileSync(
    join(foreign, '.brobot-skills-owner.json'),
    JSON.stringify({ host: 'fictional-other-host', pid: 42 }),
  )
  await launch()
  expect(existsSync(malformed)).toBe(true)
  expect(existsSync(foreign)).toBe(true)
})

it('never traverses root or nested links or removes hard-linked and unexpected objects', async () => {
  const outside = join(root, 'fictional-outside')
  mkdirSync(outside)
  const sentinel = join(outside, 'SKILL.md')
  writeFileSync(sentinel, 'Outside must remain untouched.')
  const linkedRoot = join(home, `brobot-skills-${'c'.repeat(64)}-Cedar4`)
  symlinkSync(outside, linkedRoot, 'dir')
  const nested = legacy('Cedar5')
  const skill = join(nested, 'codex/skills/maple-check')
  rmSync(skill, { recursive: true })
  symlinkSync(outside, skill, 'dir')
  const fileLink = legacy('Cedar6')
  rmSync(join(fileLink, 'codex/skills/maple-check/SKILL.md'))
  symlinkSync(sentinel, join(fileLink, 'codex/skills/maple-check/SKILL.md'))
  const hardLinked = legacy('Birch1')
  const hardLinkedFile = join(hardLinked, 'codex/skills/maple-check/SKILL.md')
  rmSync(hardLinkedFile)
  linkSync(sentinel, hardLinkedFile)
  const unknown = legacy('Cedar7')
  writeFileSync(join(unknown, 'unrelated.txt'), 'Unrecognized contents stay.')
  const matchingFile = join(home, `brobot-skills-${'d'.repeat(64)}-Cedar8`)
  writeFileSync(matchingFile, 'Not a directory.')
  await launch()
  expect(readFileSync(sentinel, 'utf8')).toBe('Outside must remain untouched.')
  for (const folder of [linkedRoot, nested, fileLink, hardLinked, unknown, matchingFile])
    expect(existsSync(folder)).toBe(true)
  expect(readFileSync(join(unknown, 'unrelated.txt'), 'utf8')).toBe('Unrecognized contents stay.')
})

it('does not adopt a different directory that replaces a released view at the same name', async () => {
  let stopped!: () => void
  const lifetime = new Promise<void>((done) => {
    stopped = done
  })
  const first = await launch('codex', lifetime)
  const folder = viewRoot(first.context.root, 'codex')
  stopped()
  await lifetime
  // Retain the old inode at another path so the filesystem cannot recycle it for the replacement.
  const moved = join(root, 'fictional-kept-original')
  renameSync(folder, moved)
  mkdirSync(join(folder, 'codex/skills/maple-check'), { recursive: true })
  const replacement = join(folder, 'codex/skills/maple-check/SKILL.md')
  writeFileSync(replacement, 'A replacement that was never leased.')
  await launch()
  expect(readFileSync(replacement, 'utf8')).toBe('A replacement that was never leased.')
  expect(existsSync(moved)).toBe(true)
})

it('does not follow a published view replaced before the background sweep runs', async () => {
  const old = legacy('Birch2')
  const outside = join(root, 'fictional-unrelated-home')
  mkdirSync(outside)
  const sentinel = join(outside, 'keep.txt')
  writeFileSync(sentinel, 'The sweep must never enter here.')
  const prepared = await prepareBuiltInSkills({
    provider: 'codex',
    providerHome: home,
    managedRoot: root,
    shipped: () => bundle,
    canCreateAgents: true,
    isCoordinator: false,
    isCurrent: () => true,
  })
  const created = viewRoot(prepared.context.root, 'codex')
  renameSync(created, join(root, 'fictional-displaced-new-view'))
  symlinkSync(outside, created, 'dir')
  await sweepSkillViews(root, home, created)
  expect(existsSync(old)).toBe(false)
  expect(existsSync(created)).toBe(true)
  expect(readFileSync(sentinel, 'utf8')).toBe('The sweep must never enter here.')
})
