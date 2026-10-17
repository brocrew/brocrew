import type { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AppTitleBar from '../src/renderer/src/components/AppTitleBar.vue'
import { buildBranches } from '../src/main/build-identity'
import { readBuildBranches, type BuildBranch } from '../src/main/build-stamp'

/**
 * # F077 · the build chip says which of dev, prompts and ui a develop build holds (`40826342`)
 *
 * ⚑ From 21:00 to 22:17 on 2026-10-02 the window ran a `develop` build without `ui`, and its chip
 * said only *"1a3ce23 · schema 7"*. Now a build of `develop` reads, at build time, each branch's tip,
 * whether it is in the build's history, and — for one that is not — whether it was merged at an
 * older tip (*"ui 3 behind"*) or left out, and which held branch it conflicts with.
 *
 * | § | subject | the paired control |
 * |---|---|---|
 * | 1 | `readBuildBranches` over a `git` stand-in | a build of another branch reads `null` and asks git nothing more |
 * | 2 | `buildBranches` — what the running app reads back | a malformed stamp is *"not known"*, never a half-read |
 * | 3 | the chip and its hover, rendered | a build that holds all three reads exactly as before |
 *
 * ⚠️ `build-identity.test.ts`' `fakeGit` answers two subcommands; this one answers every call
 * `readBuildBranches` makes, and an exit status is thrown the way `execFileSync` throws it
 * (`error.status`), because exit 1 is an ANSWER (*no*) and any other status is *"git would not say"*.
 */

/* ================================================================ §1 · build time */

const DEV = 'd0'.repeat(20)
const PROMPTS = 'b0'.repeat(20)
const UI = 'c0'.repeat(20)
/** A commit `ui` shares with the build that is also on `dev` — the merge base of a left-out branch. */
const BASE = 'a0'.repeat(20)
/** `ui`'s own older commit, the newest of it the build holds — on no other held branch. */
const UI_OLD = 'e0'.repeat(20)

const TIPS: Readonly<Record<string, string>> = { dev: DEV, prompts: PROMPTS, ui: UI }
const NAME_OF: Readonly<Record<string, string>> = { [DEV]: 'dev', [PROMPTS]: 'prompts', [UI]: 'ui' }

type Answer = string | { readonly status: number }

/** What a repository answers. Everything a test does not say is the ordinary answer. */
interface Repo {
  /** What `symbolic-ref --short HEAD` prints; a number is the exit status it fails with. */
  readonly head?: string | number
  readonly missing?: readonly string[]
  /** The branches whose tip is in the build's history. */
  readonly held?: readonly string[]
  /** `merge-base HEAD <tip>` for each branch not held. */
  readonly shared?: Readonly<Record<string, string>>
  /** Whether a shared commit is in a held branch's history. */
  readonly sharedIsOn?: (commit: string, tip: string) => boolean
  /** Whether merging two commits conflicts; `'refused'` is git failing to say. */
  readonly clash?: (one: string, other: string) => boolean | 'refused'
  readonly behind?: string
  /** The exit status `merge-base --is-ancestor <tip> HEAD` fails with for a tip not held. */
  readonly notHeldStatus?: number
}

function fakeGit(repo: Repo) {
  const calls: string[][] = []
  const route = (args: readonly string[]): Answer => {
    if (args[0] === 'symbolic-ref') {
      const head = repo.head ?? 'develop'
      return typeof head === 'number' ? { status: head } : `${head}\n`
    }
    if (args[0] === 'rev-parse') {
      const name = (args.at(-1) ?? '').replace('refs/heads/', '')
      return (repo.missing ?? []).includes(name) ? { status: 1 } : `${TIPS[name]}\n`
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      const [commit, of] = [args[2] ?? '', args[3] ?? '']
      if (of === 'HEAD') {
        return (repo.held ?? ['dev', 'prompts', 'ui']).includes(NAME_OF[commit] ?? '')
          ? ''
          : { status: repo.notHeldStatus ?? 1 }
      }
      return (repo.sharedIsOn ?? (() => false))(commit, of) ? '' : { status: 1 }
    }
    if (args[0] === 'merge-base') return `${repo.shared?.[NAME_OF[args[2] ?? ''] ?? ''] ?? ''}\n`
    if (args[0] === 'rev-list') return `${repo.behind ?? '0'}\n`
    if (args[0] === 'merge-tree') {
      const said = (repo.clash ?? (() => false))(args.at(-2) ?? '', args.at(-1) ?? '')
      return said === 'refused' ? { status: 128 } : said ? { status: 1 } : ''
    }
    throw new Error(`git ${args.join(' ')} is not something readBuildBranches asks`)
  }
  const exec = ((_file: string, args: string[]) => {
    calls.push(args)
    const answer = route(args)
    if (typeof answer !== 'string') {
      throw Object.assign(new Error(`git exited ${answer.status}`), { status: answer.status })
    }
    return answer
  }) as unknown as typeof execFileSync
  return { exec, calls }
}

const short = (sha: string): string => sha.slice(0, 7)
const asked = (calls: readonly string[][], sub: string): number =>
  calls.filter((args) => args[0] === sub).length

describe('§1 · 40826342 · readBuildBranches — what a build of develop holds', () => {
  it('⛔ a build of any other branch is not a combination: null, and git is asked nothing more', () => {
    const { exec, calls } = fakeGit({ head: 'ui' })
    expect(readBuildBranches(exec)).toBeNull()
    expect(calls).toHaveLength(1)
    // ⚑ A detached HEAD (`symbolic-ref --quiet` exits 1) is not develop either.
    expect(readBuildBranches(fakeGit({ head: 1 }).exec)).toBeNull()
  })

  it('🔴 all three at their tips: each held, named by its short sha, and nothing merged in memory', () => {
    const { exec, calls } = fakeGit({})
    expect(readBuildBranches(exec)).toEqual([
      { name: 'dev', tip: short(DEV), held: true },
      { name: 'prompts', tip: short(PROMPTS), held: true },
      { name: 'ui', tip: short(UI), held: true },
    ])
    expect(asked(calls, 'merge-tree')).toBe(0)
  })

  it('🔴 a branch left out names the held branch it conflicts with, and whether it conflicts with the build', () => {
    const { exec } = fakeGit({
      held: ['dev', 'prompts'],
      shared: { ui: BASE },
      sharedIsOn: (commit, tip) => commit === BASE && tip === DEV,
      clash: (one, other) => other === UI && (one === DEV || one === 'HEAD'),
    })
    const read = readBuildBranches(exec)
    expect(read?.slice(0, 2).map((one) => one.held)).toEqual([true, true])
    expect(read?.[2]).toEqual({
      name: 'ui',
      tip: short(UI),
      held: false,
      conflictsWith: ['dev'],
      conflictsWithBuild: true,
    })
  })

  it('🔴 a branch merged at an older tip is "behind", not left out — its newest shared commit is its own', () => {
    const { exec, calls } = fakeGit({
      held: ['dev', 'prompts'],
      shared: { ui: UI_OLD },
      sharedIsOn: () => false,
      behind: '3',
    })
    expect(readBuildBranches(exec)?.[2]).toEqual({
      name: 'ui',
      tip: short(UI),
      held: 'older',
      holdsUpTo: short(UI_OLD),
      behind: 3,
    })
    expect(calls).toContainEqual(['rev-list', '--count', `HEAD..${UI}`])
    // ⚑ Nothing to merge in memory for a branch the build partly holds.
    expect(asked(calls, 'merge-tree')).toBe(0)
  })

  it('⚑ left out but clean against everything: no conflict named, and the build says so', () => {
    const { exec } = fakeGit({
      held: ['dev', 'prompts'],
      shared: { ui: BASE },
      sharedIsOn: (commit, tip) => commit === BASE && tip === DEV,
    })
    expect(readBuildBranches(exec)?.[2]).toMatchObject({
      held: false,
      conflictsWith: [],
      conflictsWithBuild: false,
    })
  })

  it('⛔ a merge git would not do is "not known" (null), never "clean"', () => {
    const { exec } = fakeGit({
      held: ['dev', 'prompts'],
      shared: { ui: BASE },
      sharedIsOn: (commit, tip) => commit === BASE && tip === DEV,
      clash: (one) => (one === PROMPTS ? 'refused' : false),
    })
    expect(readBuildBranches(exec)?.[2]).toMatchObject({
      held: false,
      conflictsWith: null,
      conflictsWithBuild: false,
    })
  })

  it('⚑ a branch this repository does not have is neither held nor left out', () => {
    const { exec } = fakeGit({ missing: ['prompts'] })
    expect(readBuildBranches(exec)?.map((one) => one.name)).toEqual(['dev', 'ui'])
  })

  it('🔴 exit 1 from --is-ancestor is "no"; any other failure makes the whole fact not known', () => {
    const refused = fakeGit({ held: ['dev', 'prompts'], notHeldStatus: 128 })
    expect(readBuildBranches(refused.exec)).toBeNull()
    // ⚑ The control: the same repository answering "no" reads a branch not held.
    const no = fakeGit({
      held: ['dev', 'prompts'],
      shared: { ui: BASE },
      sharedIsOn: (commit, tip) => commit === BASE && tip === DEV,
    })
    expect(readBuildBranches(no.exec)?.[2]?.held).toBe(false)
  })
})

/* ================================================================ §2 · run time */

describe('§2 · 40826342 · buildBranches — what the running app reads back from the stamp', () => {
  const globals = globalThis as Record<string, unknown>
  afterEach(() => {
    delete globals.__BUILD_BRANCHES__
  })

  const STAMPED: readonly BuildBranch[] = [
    { name: 'dev', tip: 'd0d0d0d', held: true },
    { name: 'prompts', tip: 'b0b0b0b', held: 'older', holdsUpTo: 'e0e0e0e', behind: 2 },
    { name: 'ui', tip: 'c0c0c0c', held: false, conflictsWith: ['dev'], conflictsWithBuild: null },
  ]

  it('🔴 a stamp of every shape is read back as it was written', () => {
    globals.__BUILD_BRANCHES__ = STAMPED
    expect(buildBranches()).toEqual(STAMPED)
  })

  it('⚑ no stamp — a build of another branch, or nothing recorded — is null, and does not throw', () => {
    expect(() => buildBranches()).not.toThrow()
    expect(buildBranches()).toBeNull()
    globals.__BUILD_BRANCHES__ = null
    expect(buildBranches()).toBeNull()
  })

  it('⛔ one malformed branch makes the whole stamp "not known", never a half-read', () => {
    const malformed: unknown[] = [
      { name: 'ui', tip: 'c0c0c0c', held: 'older', holdsUpTo: 'e0e0e0e' },
      {
        name: 'ui',
        tip: 'c0c0c0c',
        held: false,
        conflictsWith: ['dev', 3],
        conflictsWithBuild: null,
      },
      { name: 'ui', tip: 'c0c0c0c', held: false, conflictsWith: [], conflictsWithBuild: 'yes' },
      { name: 'ui', tip: 'c0c0c0c', held: 'maybe' },
      { name: 'ui', held: true },
    ]
    for (const bad of malformed) {
      globals.__BUILD_BRANCHES__ = [STAMPED[0], bad]
      expect(buildBranches(), JSON.stringify(bad)).toBeNull()
    }
    globals.__BUILD_BRANCHES__ = { dev: 'd0d0d0d' }
    expect(buildBranches()).toBeNull()
  })
})

/* ================================================================ §3 · the chip */

const INFO = {
  name: 'BroBot',
  version: '0.0.0',
  step: 'Step 0',
  windowTitle: 'BroBot',
  build: { id: 'e76e7c6', commit: 'e76e7c6'.padEnd(40, '0'), dirty: false },
  db: { migrationsApplied: 7, providerSessionCount: 0 },
}

const decode = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** The chip as the server renders it: its line, its hover and whether it wears the amber class. */
async function chip(
  branches: readonly BuildBranch[] | null,
): Promise<{ line: string; title: string; amber: boolean }> {
  const info = { ...INFO, build: { ...INFO.build, branches } }
  const html = await renderToString(
    createSSRApp({ render: () => h(AppTitleBar as never, { info, error: null }) }),
  )
  const span = /<span\b([^>]*)data-cy="build-line"([^>]*)>([\s\S]*?)<\/span>/.exec(html)
  expect(span, 'the chip is not in the markup').not.toBeNull()
  const attributes = `${span![1]} ${span![2]}`
  return {
    line: decode(span![3]!).trim(),
    title: decode(/\btitle="([^"]*)"/.exec(attributes)?.[1] ?? ''),
    amber: /\bbuild-dirty\b/.test(attributes),
  }
}

const HELD = (name: string, tip: string): BuildBranch => ({ name, tip, held: true })

describe('§3 · 40826342 · the chip and its hover', () => {
  it('⚑ a build that records no branches reads exactly as before', async () => {
    const said = await chip(null)
    expect(said.line).toBe('e76e7c6 · schema 7')
    expect(said.amber).toBe(false)
    expect(said.title).not.toContain('Holds')
    expect(said.title).not.toContain('Left out')
  })

  it('🔴 all three held: the chip is unchanged and the hover names each one’s sha', async () => {
    const said = await chip([
      HELD('dev', 'd0d0d0d'),
      HELD('prompts', 'b0b0b0b'),
      HELD('ui', 'c0c0c0c'),
    ])
    expect(said.line).toBe('e76e7c6 · schema 7')
    expect(said.amber).toBe(false)
    expect(said.title.endsWith('\nHolds dev d0d0d0d, prompts b0b0b0b, ui c0c0c0c.')).toBe(true)
  })

  it('🔴 a branch left out: amber, "· without ui" on the chip, and why on the hover', async () => {
    const said = await chip([
      HELD('dev', 'd0d0d0d'),
      HELD('prompts', 'b0b0b0b'),
      { name: 'ui', tip: 'c0c0c0c', held: false, conflictsWith: ['dev'], conflictsWithBuild: true },
    ])
    expect(said.line).toBe('e76e7c6 · schema 7 · without ui')
    expect(said.amber).toBe(true)
    expect(said.title).toContain('\nHolds dev d0d0d0d, prompts b0b0b0b.')
    expect(said.title).toContain('\nLeft out: ui c0c0c0c — it conflicts with dev.')
  })

  it('⚑ two left out are one "without", and two conflicts are said with "and"', async () => {
    const said = await chip([
      HELD('dev', 'd0d0d0d'),
      {
        name: 'prompts',
        tip: 'b0b0b0b',
        held: false,
        conflictsWith: ['dev'],
        conflictsWithBuild: true,
      },
      {
        name: 'ui',
        tip: 'c0c0c0c',
        held: false,
        conflictsWith: ['dev', 'prompts'],
        conflictsWithBuild: true,
      },
    ])
    expect(said.line).toBe('e76e7c6 · schema 7 · without prompts and ui')
    expect(said.title).toContain('\nLeft out: ui c0c0c0c — it conflicts with dev and prompts.')
  })

  it('🔴 a branch held at an older commit: amber, "· ui 3 behind", and how far on the hover', async () => {
    const said = await chip([
      HELD('dev', 'd0d0d0d'),
      HELD('prompts', 'b0b0b0b'),
      { name: 'ui', tip: 'c0c0c0c', held: 'older', holdsUpTo: 'e0e0e0e', behind: 3 },
    ])
    expect(said.line).toBe('e76e7c6 · schema 7 · ui 3 behind')
    expect(said.line).not.toContain('without')
    expect(said.amber).toBe(true)
    expect(said.title).toContain(
      '\nui: holds it up to e0e0e0e; 3 newer commits, up to c0c0c0c, aren’t in this build.',
    )
    const one = await chip([
      { name: 'ui', tip: 'c0c0c0c', held: 'older', holdsUpTo: 'e0e0e0e', behind: 1 },
    ])
    expect(one.title).toContain(
      '\nui: holds it up to e0e0e0e; 1 newer commit, up to c0c0c0c, isn’t in this build.',
    )
  })

  it('⚑ why a branch is out, as far as the build could tell', async () => {
    const why = async (
      conflictsWith: readonly string[] | null,
      conflictsWithBuild: boolean | null,
    ): Promise<string> =>
      (await chip([{ name: 'ui', tip: 'c0c0c0c', held: false, conflictsWith, conflictsWithBuild }]))
        .title
    expect(await why([], true)).toContain('Left out: ui c0c0c0c — it conflicts with this build.')
    expect(await why([], false)).toContain(
      'Left out: ui c0c0c0c — it merges cleanly, so why isn’t known.',
    )
    // ⛔ "merges cleanly" only when every held branch was asked: one git would not merge is not known.
    expect(await why(null, false)).toContain('Left out: ui c0c0c0c — why isn’t known.')
    expect(await why(null, null)).toContain('Left out: ui c0c0c0c — why isn’t known.')
  })
})
