import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { skillDigest } from '../src/main/skills/built-in-catalogue'
import {
  BUILT_IN_SKILLS_FAILURE,
  keptShippedSkills,
  prepareBuiltInSkills,
  readBuiltInSkills,
} from '../src/main/skills/prepare-built-in-skills'

/**
 * A build run from its source reads the shipped skills from a folder a newer commit can rewrite
 * while it runs. It keeps the copy it read first, so a later launch prepares what it started with.
 */

const shipped = resolve(import.meta.dirname, '../resources/built-in-skills')
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
const scratch = (name: string): string => {
  const folder = mkdtempSync(join(realpathSync(tmpdir()), `${name}-`))
  folders.push(folder)
  return folder
}
/** The shipped folder copied, as a build's source tree holds it. */
const aShippedFolder = (): string => {
  const folder = scratch('shipped-skills')
  cpSync(shipped, folder, { recursive: true })
  return folder
}
/** A newer commit's rewrite: another label, and an edited skill body its manifest names. */
function rewrite(folder: string): void {
  const body = join(folder, 'delegate', 'SKILL.md')
  const newer = `${readFileSync(body, 'utf8')}\nA fictional newer line.\n`
  writeFileSync(body, newer)
  const path = join(folder, 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    skills: { name: string; sha256: string; bytes: number }[]
  }
  const delegate = manifest.skills.find((one) => one.name === 'delegate')!
  delegate.sha256 = skillDigest(newer)
  delegate.bytes = Buffer.byteLength(newer, 'utf8')
  writeFileSync(path, JSON.stringify({ ...manifest, version: 'v99' }))
}

describe('the shipped skills, kept for the run', () => {
  /** Launches in a scratch provider home, preparing from the given copy. */
  function launches(kept: () => ReturnType<typeof readBuiltInSkills>) {
    const root = scratch('managed')
    const home = join(root, 'homes', 'writer', 'codex')
    mkdirSync(home, { recursive: true, mode: 0o700 })
    return () =>
      prepareBuiltInSkills({
        provider: 'codex',
        providerHome: home,
        managedRoot: root,
        shipped: kept,
        canCreateAgents: true,
        isCoordinator: false,
        isCurrent: () => true,
      })
  }
  const delegateIn = (prepared: Awaited<ReturnType<ReturnType<typeof launches>>>) =>
    readFileSync(prepared.context.skills.find((one) => one.name === 'delegate')!.path, 'utf8')
  const shippedDelegate = () => readFileSync(join(shipped, 'delegate', 'SKILL.md'), 'utf8')

  it('a rewrite on disk after the first launch changes nothing a later launch prepares', async () => {
    const folder = aShippedFolder()
    const launch = launches(keptShippedSkills(folder))
    const first = await launch()
    rewrite(folder)
    const later = await launch()
    expect(later.version).toBe(first.version)
    expect(later.reminder).toBe(first.reminder)
    expect(delegateIn(later)).toBe(delegateIn(first))
    expect(delegateIn(later)).toBe(shippedDelegate())
    // The control: the rewrite is real, and a fresh read takes it.
    const fresh = readBuiltInSkills(folder)
    expect(fresh.catalogue.version).toBe('v99')
    expect(fresh.bodies.get('delegate')).not.toBe(delegateIn(later))
  })

  it('a rewrite after the run starts and before its first launch changes nothing either', async () => {
    const folder = aShippedFolder()
    const launch = launches(keptShippedSkills(folder))
    rewrite(folder)
    const first = await launch()
    expect(first.version).not.toBe('v99')
    expect(delegateIn(first)).toBe(shippedDelegate())
  })

  it('a failed read stays failed for the run, and the next run reads the files again', () => {
    const folder = aShippedFolder()
    const manifest = join(folder, 'manifest.json')
    const good = readFileSync(manifest, 'utf8')
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(good), formatVersion: 'invalid' }))
    const run = keptShippedSkills(folder)
    expect(() => run()).toThrow()
    writeFileSync(manifest, good)
    expect(() => run()).toThrow()
    expect(keptShippedSkills(folder)().catalogue.version).toBe(
      readBuiltInSkills(shipped).catalogue.version,
    )
  })

  it('a launch after a failed read refuses in the existing words, and reads nothing', async () => {
    const folder = aShippedFolder()
    const manifest = join(folder, 'manifest.json')
    const good = readFileSync(manifest, 'utf8')
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(good), formatVersion: 'invalid' }))
    const launch = launches(keptShippedSkills(folder))
    writeFileSync(manifest, good)
    await expect(launch()).rejects.toThrow(BUILT_IN_SKILLS_FAILURE)
  })
})
