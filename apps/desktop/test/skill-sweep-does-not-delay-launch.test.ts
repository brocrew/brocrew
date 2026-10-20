import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { prepareBuiltInSkills, readBuiltInSkills } from '../src/main/skills/prepare-built-in-skills'
import { sweepSkillViews } from '../src/main/skills/sweep-skill-views'

// Pause only the cleanup's event-loop yields, leaving real installation I/O and launches running.
const scheduling = vi.hoisted(() => ({ wait: undefined as (() => Promise<void>) | undefined }))
vi.mock('node:timers/promises', async (original) => {
  const actual = await original<typeof import('node:timers/promises')>()
  return {
    ...actual,
    setImmediate: async () => {
      await scheduling.wait?.()
      await actual.setImmediate()
    },
  }
})

const bundle = readBuiltInSkills(resolve(import.meta.dirname, '../resources/built-in-skills'))
let root: string, home: string
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-cedar-sweep-'))
  home = join(root, 'homes', 'cedar-writer', 'provider')
  mkdirSync(home, { recursive: true, mode: 0o700 })
})
afterEach(async () => {
  scheduling.wait = undefined
  vi.restoreAllMocks()
  await sweepSkillViews(root, home, '')
  rmSync(root, { recursive: true, force: true })
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function legacy(index: number, skills = 1) {
  const folder = join(home, `brobot-skills-${'a'.repeat(64)}-${index.toString().padStart(6, '0')}`)
  for (let skill = 0; skill < skills; skill++) {
    const directory = join(folder, 'codex', 'skills', `cedar-${skill}`)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(join(directory, 'SKILL.md'), 'A fictional cedar skill.', { mode: 0o400 })
  }
  return folder
}
function launch(provider: 'claude' | 'codex' = 'codex') {
  return prepareBuiltInSkills({
    provider,
    providerHome: home,
    managedRoot: root,
    shipped: () => bundle,
    canCreateAgents: true,
    isCoordinator: false,
    isCurrent: () => true,
  })
}
const readable = (view: Awaited<ReturnType<typeof launch>>) =>
  view.context.skills.every((skill) => readFileSync(skill.path, 'utf8').includes('---'))

it.each(['claude', 'codex'] as const)(
  'starts a %s launch with 1,786 old copies while the sweep is paused',
  async (provider) => {
    const old = Array.from({ length: 1786 }, (_, index) => legacy(index))
    const paused = deferred()
    scheduling.wait = () => paused.promise
    try {
      const prepared = await launch(provider)
      // This promise cannot settle until the test releases cleanup. Publication is independent.
      const cleaning = sweepSkillViews(root, home, '')
      let cleaned = false
      void cleaning.then(() => {
        cleaned = true
      })
      expect(cleaned).toBe(false)
      expect(readable(prepared)).toBe(true)
      expect(old.every((path) => existsSync(path))).toBe(true)
      scheduling.wait = undefined
      paused.resolve()
      await cleaning
      expect(old.some((path) => existsSync(path))).toBe(false)
      expect(readable(prepared)).toBe(true)
    } finally {
      scheduling.wait = undefined
      paused.resolve()
    }
  },
)

it('yields within a large copy, releases the home lock, and shares one flight with another launch', async () => {
  const old = legacy(0, 80)
  // Simulate expensive steps without a wall-clock assertion affected by machine contention.
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 20))
  const paused = deferred(),
    reached = deferred()
  let yields = 0
  scheduling.wait = async () => {
    if (++yields === 3) {
      // scheduling, candidate, then the first slice within that candidate
      reached.resolve()
      await paused.promise
    }
  }
  const cleaning = sweepSkillViews(root, home, '')
  try {
    await reached.promise
    expect(existsSync(old)).toBe(true)
    expect(existsSync(`${home}.lock`)).toBe(false)
    const first = await launch()
    expect(sweepSkillViews(root, join(home, '.'), first.context.root)).toBe(cleaning)
    const second = await launch('claude')
    expect(readable(first)).toBe(true)
    expect(readable(second)).toBe(true)
    expect(sweepSkillViews(root, home, '')).toBe(cleaning)
    paused.resolve()
    await cleaning
    expect(yields).toBeGreaterThan(80) // the time budget stopped each batch inside this copy
    expect(existsSync(old)).toBe(false)
    expect(readable(first)).toBe(true)
    expect(readable(second)).toBe(true)
    // Completion clears the flight so a later launch can retry cleanup.
    const later = sweepSkillViews(root, home, '')
    expect(later).not.toBe(cleaning)
    await later
  } finally {
    paused.resolve()
  }
})

it('rechecks the old view identity after yielding instead of following a replacement', async () => {
  const old = legacy(0, 12)
  const outside = join(root, 'fictional-outside')
  mkdirSync(outside)
  const sentinel = join(outside, 'SKILL.md')
  writeFileSync(sentinel, 'Keep the outside file.')
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 20))
  const paused = deferred(),
    reached = deferred()
  let yields = 0
  scheduling.wait = async () => {
    if (++yields === 3) {
      reached.resolve()
      await paused.promise
    }
  }
  const cleaning = sweepSkillViews(root, home, '')
  try {
    await reached.promise
    const prepared = await launch()
    const moved = join(root, 'fictional-moved-copy')
    renameSync(old, moved)
    symlinkSync(outside, old, 'dir')
    paused.resolve()
    await cleaning
    expect(readFileSync(sentinel, 'utf8')).toBe('Keep the outside file.')
    expect(readFileSync(join(moved, 'codex/skills/cedar-0/SKILL.md'), 'utf8')).toContain('cedar')
    expect(existsSync(old)).toBe(true)
    expect(readable(prepared)).toBe(true)
  } finally {
    paused.resolve()
  }
})

it('contains a background setup failure and allows a later sweep to retry', async () => {
  const missing = join(root, 'missing-home')
  const failed = sweepSkillViews(root, missing, '')
  await expect(failed).resolves.toBeUndefined()
  mkdirSync(missing)
  const old = join(missing, `brobot-skills-${'b'.repeat(64)}-Cedar1`)
  mkdirSync(old)
  const retry = sweepSkillViews(root, missing, '')
  expect(retry).not.toBe(failed)
  await retry
  expect(existsSync(old)).toBe(false)
})
