import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILD_IS_DEV, BUILD_IS_UNRECORDED } from '@brobot2/shared'
import { describeBuild, readGitFacts } from '../src/main/build-stamp'
import { buildIdentity } from '../src/main/build-identity'
import config, { stampReachedTheBundle } from '../electron.vite.config'

/**
 * 🔴 **WHICH BUILD IS RUNNING** (331).
 *
 * The app must identify the build actually running. `package.json`’s unchanged `v0.0.0`
 * cannot distinguish a newly shipped build from an older one, so the person needs a build
 * stamp without inspecting a bundle.
 *
 * ⚑ **Four things have to hold and each is tested here rather than assumed:**
 *  1. A production build names its commit, and says when the tree it was built from was dirty.
 *  2. ⛔ A DEV window never names a commit — it is rebuilt as you save, so any sha it showed would
 *     be stale within the minute, and a stale sha is worse than no sha.
 *  3. ⛔ *"I could not find out"* is a WORD, never an empty string and never a crash — and never
 *     the same value as *"the tree is clean"* (`326`'s lesson, applied to `git` instead of `lsof`).
 *  4. The stamp actually reaches the bundle, because a `define` that stops being applied fails
 *     silently and restores the whole defect.
 */

/** A `git` stand-in: answers per subcommand, so a test can make one call fail and not the other. */
function fakeGit(answers: { revParse?: string | Error; status?: string | Error }) {
  const calls: string[][] = []
  const exec = ((_file: string, args: string[]) => {
    calls.push(args)
    const answer = args[0] === 'rev-parse' ? answers.revParse : answers.status
    if (answer instanceof Error) throw answer
    return answer ?? ''
  }) as unknown as typeof execFileSync
  return { exec, calls }
}

const SHA = 'e76e7c6a1b2c3d4e5f60718293a4b5c6d7e8f900'

describe('describeBuild — what a build says it is', () => {
  it('names the commit it was built from, short on the chip and whole underneath', () => {
    const stamp = describeBuild('build', () => ({ commit: SHA, dirty: false }))
    expect(stamp).toEqual({ id: 'e76e7c6', commit: SHA, dirty: false })
  })

  it('says the tree was dirty WITHOUT changing the sha it names', () => {
    const clean = describeBuild('build', () => ({ commit: SHA, dirty: false }))
    const dirty = describeBuild('build', () => ({ commit: SHA, dirty: true }))
    // ⛔ **The sha is the same string in both.** The dirtiness is a field of its own, so the chip
    // and its tooltip read one fact from one place; a `-dirty` suffix smuggled into `id` would be a
    // second copy for the renderer to re-derive and get wrong.
    expect(dirty.id).toBe(clean.id)
    expect(dirty.commit).toBe(clean.commit)
    expect(dirty.dirty).toBe(true)
    expect(clean.dirty).toBe(false)
  })

  it('⛔ never asks git in dev, and answers with a word that cannot go stale', () => {
    let asked = 0
    const stamp = describeBuild('serve', () => {
      asked += 1
      return { commit: SHA, dirty: false }
    })
    expect(stamp).toEqual({ id: 'dev', commit: '', dirty: false })
    // Assert the read count: `electron-vite dev` rebuilds main on save and hot-replaces the
    // renderer, so a startup SHA soon becomes stale. Returning `dev` after reading a SHA
    // looks identical but leaves a path for the stale value to leak; development mode must
    // not read it.
    expect(asked).toBe(0)
  })

  it('says "unknown" — not "" and not a crash — when nothing could tell it', () => {
    expect(describeBuild('build', () => null)).toEqual({ id: 'unknown', commit: '', dirty: false })
  })

  /**
   * ⛔ **The one join a compiler cannot make.** `build-stamp.ts` is loaded by
   * `electron.vite.config.ts` before any bundler exists, by a loader that cannot resolve
   * `@brobot2/shared`'s extensionless TypeScript — so it spells these two words itself while the
   * renderer's tooltip branches on the shared constants. Two copies in two packages, and a rename
   * in either would fail nothing: the chip would keep rendering and the hover would quietly explain
   * the wrong build. This assertion is the only thing holding them together.
   */
  it('spells the same two words the renderer branches on', () => {
    expect(describeBuild('serve').id).toBe(BUILD_IS_DEV)
    expect(describeBuild('build', () => null).id).toBe(BUILD_IS_UNRECORDED)
  })

  /**
   * ⚠️ **And the RENDERER spells it a third time**, for a second, measured reason: `@brobot2/shared`
   * reaches `AppTitleBar.vue` as `import type` only, and making it a value import drags `zod` into
   * the renderer bundle — **1,351,038 bytes against 1,215,826, +135 kB for a three-letter string**
   * (one build each, same commit, one variable). ⛔ So three files spell `dev` and this is the only
   * thing that would notice if one of them stopped agreeing.
   */
  it('and the renderer branches on that same word', () => {
    // ⚑ **`AppTitleBar.vue` since 389 §2** — the chip and its two `computed`s moved out of
    // `RuntimeScreen` so the bar could be mounted by a test. The literal and the reason for it are
    // unchanged; only the file that spells it moved.
    const screen = readFileSync(
      join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'AppTitleBar.vue'),
      'utf8',
    )
    expect(screen).toContain(`read.build.id === '${BUILD_IS_DEV}'`)
    // ⛔ Paired, so this cannot pass by the file simply not branching at all.
    expect(screen).toMatch(/if \(read\.build\.id === '[a-z]+'\) \{/)
  })
})

describe('readGitFacts — three answers, never two', () => {
  it('⛔ reads an EMPTY `git status` as clean, not as a failure', () => {
    // 🔴 This is the whole `326` finding in a second instrument. `git status --porcelain` exits 0
    // and prints nothing when the tree is clean, so "nothing changed" arrives looking exactly like
    // "the command produced no output" — and a reader that treated silence as an error would have
    // marked every honest build `unknown`.
    const { exec, calls } = fakeGit({ revParse: `${SHA}\n`, status: '' })
    expect(readGitFacts(exec)).toEqual({ commit: SHA, dirty: false })
    // ⚠️ **The whole argument list, not just the subcommand.** `--untracked-files=no` is a
    // JUDGEMENT (see `readGitFacts`): untracked files are permanently present in this tree, so
    // counting them would mark every build dirty and the mark would stop meaning anything within a
    // day. Dropping that flag changes what the chip claims and changes nothing a subcommand-only
    // assertion can see.
    expect(calls).toEqual([
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain', '--untracked-files=no'],
    ])
  })

  it('reads a non-empty `git status` as dirty', () => {
    const { exec } = fakeGit({
      revParse: `${SHA}\n`,
      status: ' M apps/desktop/src/main/index.ts\n',
    })
    expect(readGitFacts(exec)).toEqual({ commit: SHA, dirty: true })
  })

  it('answers null — "I could not find out" — when either call throws', () => {
    const noRepo = fakeGit({ revParse: new Error('not a git repository') })
    expect(readGitFacts(noRepo.exec)).toBe(null)
    // ⚠️ **The second call too**, and it has its own test because it is the one that is easy to
    // lose: a `status` that failed after a `rev-parse` that worked would otherwise leave a commit
    // in hand and tempt a `dirty: false` default — which is the reading that says "clean" about a
    // tree nobody looked at.
    const noStatus = fakeGit({ revParse: `${SHA}\n`, status: new Error('index.lock exists') })
    expect(readGitFacts(noStatus.exec)).toBe(null)
    expect(noStatus.calls.map(([sub]) => sub)).toEqual(['rev-parse', 'status'])
  })

  it('answers null when `rev-parse` printed something that is not a sha', () => {
    // A shallow or freshly-`git init`-ed tree, or a `git` that wrote a warning where the answer
    // goes. Naming that as a commit would put a word on the chip that looks like an identity.
    for (const notASha of ['', 'HEAD\n', 'e76e7c6\n', `${SHA.toUpperCase()}\n`]) {
      expect(readGitFacts(fakeGit({ revParse: notASha }).exec)).toBe(null)
    }
  })

  /**
   * ⚑ **The real `git`, on this repository** — because everything above is a stand-in, and a
   * stand-in only proves the classification, never that the two commands are the right ones or
   * that their real output has the shape it is parsed with.
   *
   * ⚠️ **Three-valued, like the thing it tests.** If this environment has no usable `git`, the
   * test's PREMISE is absent rather than its claim being false, and it says so instead of going
   * red — a check that fails because the host is missing a tool reports the machine, which is the
   * defect class this whole file exists to end.
   */
  it('agrees with git itself about the commit this tree is on', () => {
    let truth: string
    try {
      truth = execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        timeout: 30_000,
      }).trim()
    } catch {
      expect(readGitFacts()).toBe(null)
      return
    }
    const facts = readGitFacts()
    expect(facts).not.toBe(null)
    expect(facts?.commit).toBe(truth)
    expect(describeBuild('build').id).toBe(truth.slice(0, 7))
  })
})

describe('buildIdentity — what the running app reads', () => {
  const globals = globalThis as Record<string, unknown>
  afterEach(() => {
    delete globals.__BUILD_ID__
    delete globals.__BUILD_COMMIT__
    delete globals.__BUILD_DIRTY__
  })

  it('⛔ returns the honest word, and does not throw, when nothing stamped it', () => {
    // In a real build Vite has replaced these identifiers before this file is JavaScript; here
    // nothing has, which is exactly the "the define stopped being applied" case. The requirement is
    // that it degrades to a word: `readAppInfo` parses this into the same payload as the schema
    // count, and a throw here would take the schema number off the chip beside it (039).
    expect(() => buildIdentity()).not.toThrow()
    expect(buildIdentity()).toEqual({ id: 'unknown', commit: '', dirty: false })
  })

  it('reads a stamp when there is one — all three fields, none of them the default', () => {
    globals.__BUILD_ID__ = 'e76e7c6'
    globals.__BUILD_COMMIT__ = SHA
    globals.__BUILD_DIRTY__ = true
    expect(buildIdentity()).toEqual({ id: 'e76e7c6', commit: SHA, dirty: true })
  })

  it('treats an empty stamp as no stamp, and drops a commit it cannot name', () => {
    globals.__BUILD_ID__ = ''
    globals.__BUILD_COMMIT__ = SHA
    // An empty chip reads as a rendering bug; the word reads as an answer. And a full sha with no
    // short one to show beside it would let the chip and its tooltip describe different builds.
    expect(buildIdentity()).toEqual({ id: 'unknown', commit: '', dirty: false })
  })

  it('survives a half-stamp: an id with no commit and no dirty flag', () => {
    globals.__BUILD_ID__ = 'e76e7c6'
    expect(buildIdentity()).toEqual({ id: 'e76e7c6', commit: '', dirty: false })
  })
})

describe('the stamp is wired into the build', () => {
  const forCommand = (command: 'build' | 'serve') => {
    const resolved = (config as (env: { command: string; mode: string }) => Record<string, never>)({
      command,
      mode: command === 'build' ? 'production' : 'development',
    }) as unknown as {
      main: { define: Record<string, string>; plugins: { name: string }[] }
      preload: Record<string, unknown>
      renderer: Record<string, unknown>
    }
    return resolved
  }

  it('stamps the real commit into the main bundle on a production build', () => {
    const main = forCommand('build').main
    expect(main.define.__BUILD_COMMIT__).toMatch(/^"(|[0-9a-f]{40})"$/)
    expect(main.define.__BUILD_ID__).toMatch(/^"([0-9a-f]{7}|unknown)"$/)
    expect(main.define.__BUILD_DIRTY__).toMatch(/^(true|false)$/)
    expect(main.plugins.map((plugin) => plugin.name)).toContain('brobot2:build-stamp-landed')
  })

  it('⛔ stamps the word `dev` — never a sha — when the command is `serve`', () => {
    // The pin for the trap in §1.3 of the brief. `electron-vite dev` gets `command: "serve"`, and
    // this is the one line that would go red if a refactor let the git read run in dev.
    expect(forCommand('serve').main.define.__BUILD_ID__).toBe('"dev"')
    expect(forCommand('serve').main.define.__BUILD_COMMIT__).toBe('""')
  })

  it('puts the stamp in main ONLY — the renderer is told over `app:info`', () => {
    const resolved = forCommand('build')
    expect(resolved.main.define).toBeDefined()
    expect(resolved.preload.define).toBeUndefined()
    expect(resolved.renderer.define).toBeUndefined()
  })
})

describe('stampReachedTheBundle — the guard on the silent failure', () => {
  const chunk = (code: string) => ({ 'index.js': { type: 'chunk' as const, code } })

  it('passes when the stamped literal is in an emitted chunk', () => {
    const guard = stampReachedTheBundle('e76e7c6')
    expect(() =>
      guard.writeBundle({}, chunk('const id = "e76e7c6";\nexport { id };')),
    ).not.toThrow()
  })

  it('⛔ throws when `define` did not reach the bundle', () => {
    // The failure this exists for is silent: `buildIdentity()` falls back to `unknown`, the chip
    // still renders, every test still passes, and the app stops being able to say what it is.
    const guard = stampReachedTheBundle('e76e7c6')
    expect(() => guard.writeBundle({}, chunk('const id = __BUILD_ID__;'))).toThrow(/build stamp/)
    // ⚑ And an asset is not a chunk — a stamp that only appeared in a copied migration file would
    // not be in the code that runs.
    expect(() =>
      guard.writeBundle({}, { 'x.sql': { type: 'asset' as never, code: '"e76e7c6"' } }),
    ).toThrow(/build stamp/)
  })

  it('is the wire the app actually reads — `readAppInfo` puts it in the payload', () => {
    // ⚠️ Nothing else covers this join. `readAppInfo` boots Electron on import, so no test calls
    // it; without this pin the producer could stop sending `build` and the only thing that would
    // notice is `appInfoSchema.parse` throwing in a running app — which renders as a startup error
    // beside an empty chip, at the exact moment somebody is trying to find out what they are
    // running.
    const main = readFileSync(join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
    // ⚑ F077 · the branches a combined build holds ride the same field.
    expect(main).toMatch(
      /appInfoSchema\.parse\(\{[\s\S]*?\n {4}build: \{ \.\.\.buildIdentity\(\), branches: buildBranches\(\) \},/,
    )
    expect(main).toMatch(/import \{ buildBranches, buildIdentity \} from '\.\/build-identity'/)
  })

  it('is the guard the real build actually runs', () => {
    // ⚠️ 325's lesson: a guard tested only through its own export can be dead code in the product.
    // This reads the config source and pins that the plugin is installed beside `copyMigrations`,
    // so the two tests above are about a plugin that is on the path a build walks.
    const source = readFileSync(join(__dirname, '..', 'electron.vite.config.ts'), 'utf8')
    expect(source).toMatch(/stampReachedTheBundle\(build\.id\)/)
  })
})

/**
 * ⚠️ **Source pins, and what changed under them** (389 §2). This paragraph used to read *"Nothing in
 * this repository mounts `RuntimeScreen` — it is the whole app — so there is no render test that can
 * read this chip."* ⛔ **That stopped being true when `389` moved the bar into `AppTitleBar.vue`**,
 * which a test CAN mount: `dom/one-bar-one-shelf.dom.test.ts` reads this chip in a real engine, at
 * three widths, and measures that it truncates rather than pushing the window title off centre.
 *
 * ⚑ **These pins stay, and they are still the instrument for the half a mount cannot see**: what the
 * chip SAYS was measured against the running app in all three states and is quoted in `331`'s
 * response, and a `computed` is only checkable against that measurement as source. The pins keep the
 * wiring from drifting away from it between now and the next time somebody looks.
 */
describe('the titlebar chip', () => {
  const screen = readFileSync(
    join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'AppTitleBar.vue'),
    'utf8',
  )

  it('shows the build where the app version used to be', () => {
    // The positive: one interpolation, and it is the composed line.
    expect(screen).toMatch(/data-cy="build-line"/)
    expect(screen).toMatch(/\{\{ buildLine \}\}/)
    // ⛔ The negative it is paired with — `v{{ info.version }}` was the whole defect, and it is
    // gone from the template. It survives in `buildTitle`, which the line below proves, so this is
    // "moved", not "deleted".
    expect(screen).not.toMatch(/v\{\{ info\.version \}\}/)
    expect(screen).toMatch(/const name = `\$\{read\.name\} v\$\{read\.version\}`/)
  })

  it('composes the line from the fields, and reads `dirty` rather than re-deriving it', () => {
    expect(screen).toMatch(/const uncommitted = read\.build\.dirty \? ' · uncommitted' : ''/)
    expect(screen).toMatch(
      /return `\$\{read\.build\.id\}\$\{uncommitted\} · schema \$\{read\.db\.migrationsApplied\}\$\{branchWords\.value\}`/,
    )
    // ⛔ Never recovered from the text of the id. See `describeBuild`'s "same sha" test above for
    // the other half of this rule. ⚠️ This reads the file as TEXT, comments included — it caught
    // its own docblock naming the pattern before this line was written, which is the honest
    // description of what it can and cannot tell apart.
    expect(screen).not.toMatch(/endsWith\('-dirty'\)/)
  })

  it('keeps what other things read off this element', () => {
    // `packaged-smoke` waits for `/schema \d+/` inside `[data-cy=app-info]` to prove the packaged
    // app opened its database, and `ui-live-smoke` takes the same element's region. Both would
    // have gone quiet, not red, if this chip had been rebuilt around them.
    expect(screen).toMatch(/<div class="sync-state" data-cy="app-info">/)
    expect(screen).toMatch(/· schema \$\{read\.db\.migrationsApplied\}/)
  })

  it('marks a dirty build with a word AND a colour, and lets a person copy the sha', () => {
    // ⚑ F077 · a build that left a branch out wears the same amber, beside its words.
    expect(screen).toMatch(
      /:class="\{ 'build-dirty': props\.info\.build\.dirty \|\| branchWords !== '' \}"/,
    )
    // The waiting colour; under a theme's title-bar ink, the waiting colour worked out from it.
    expect(screen).toMatch(
      /\.sync-detail\.build-dirty \{\n {2}color: var\(--titlebar-waiting, var\(--waiting\)\);/,
    )
    // ⚑ Amber is a declared token; 104/105 found `var(--warning, …)` fallbacks doing all the work
    // for a token defined in no stylesheet in this repo.
    expect(
      readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'tokens.css'), 'utf8'),
    ).toMatch(/--waiting: #/)
    // The titlebar is `user-select: none`; the chip opts back in so the sha can be dragged over.
    expect(screen).toMatch(/\.sync-detail \{[^}]*user-select: text;/)
  })
})
