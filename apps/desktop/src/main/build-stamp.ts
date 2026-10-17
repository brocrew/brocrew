/**
 * WHICH COMMIT IS THIS BUILD (331) — the BUILD-time half.
 *
 * This runs once in `electron.vite.config.ts` and bakes its answer into the main bundle as a `define`. A runtime git read would describe the checkout on the person's machine rather than the packaged build.
 *
 * ⚠️ **And the answer lands in `out/`, which is git-ignored.** A stamp written into a tracked file
 * would change that file on every build, and `mutations:check` hashes censused files while
 * `format:check` reads the whole tree — so a clean checkout would go red the moment anybody built.
 * `define` is the only place a per-build value can go that leaves the tree untouched.
 *
 * ⚑ **The runtime half is {@link ../main/build-identity} — it reads what this wrote.**
 *
 * ⛔ **The two words below are spelled here rather than imported from `@brobot2/shared`, and that
 * is forced.** This module is loaded by `electron.vite.config.ts` BEFORE any bundler exists, by a
 * loader that cannot resolve a workspace package's extensionless TypeScript — measured:
 * `ERR_MODULE_NOT_FOUND: Cannot find module '…/packages/shared/src/contracts' imported from
 * …/packages/shared/src/index.ts`. ⚑ So the shared constants own the RUNTIME side
 * (`build-identity.ts`, `RuntimeScreen.vue`) and `build-identity.test.ts` holds these two literals
 * against `BUILD_IS_DEV` / `BUILD_IS_UNRECORDED` — a test, because a compiler cannot.
 */
import { execFileSync } from 'node:child_process'

/**
 * How long a `git` call may take before we would rather say *"I do not know"* than block a build.
 *
 * ⚠️ **Generous on purpose, and the generosity is the point.** `git status` on this repository is
 * 10-30 ms at load ~10; `326` measured a single `lsof` on this same machine at 21 SECONDS at load
 * 144. A bound a busy machine can cross turns a clean build into `unknown` — which is this
 * dispatch's own defect, reintroduced by its own instrument. A build that waits half a minute for
 * `git` and then says so is still bounded.
 */
const GIT_TIMEOUT_MS = 30_000

/** Enough of a sha to name a commit on a chip, and to paste into a message. */
const SHORT_SHA = 7

/**
 * What the app says about its own build.
 *
 * ⛔ **`dirty` is a FIELD, not something to recover from `id`.** The chip needs both the sha and
 * whether the tree was clean, and the producer knows both; making the renderer test
 * `id.endsWith('-dirty')` would be a second derivation of one fact, free to drift from the first.
 */
export type BuildStamp = {
  /** What the chip shows: a short sha, or the honest word `dev` / `unknown`. */
  id: string
  /** The full sha, or `''` when no commit describes this build. Never `undefined`. */
  commit: string
  /** ⚠️ TRUE when tracked files were modified at build time — the sha does not describe what runs. */
  dirty: boolean
}

/** What `git` was able to tell us, or `null` for *"I could not ask"* — three answers, never two. */
export type GitFacts = { commit: string; dirty: boolean } | null

/**
 * ⛔ **`git status --porcelain` exits 0 whether or not anything changed**, so empty output is a real
 * answer — *the tree is clean* — and NOT a failure. Only a throw means we could not find out. That
 * distinction is the whole of `326`'s lesson: an instrument whose *"nothing"* and whose *"I could
 * not look"* arrive as the same value reports the machine instead of the subject.
 *
 * ⚠️ `--untracked-files=no` on purpose. Untracked files are permanently present in this repo
 * (`out/`, scratch, editor droppings), so counting them would mark every build dirty and the mark
 * would stop meaning anything within a day. What is left is the thing that actually differs from
 * the named commit: modified or staged tracked files. A brand-new file only reaches the build when
 * a tracked file imports it — and that import makes the tracked file modified, so it is seen.
 */
export function readGitFacts(exec = execFileSync): GitFacts {
  const git = (args: string[]): string =>
    String(
      exec('git', args, {
        // ⚠️ **The inherited cwd, deliberately, and not `__dirname`.** `git` answers about the
        // repository containing the working directory, and every path that reaches this file —
        // `electron-vite build` under `apps/desktop`, a test under the repo root — is inside this
        // checkout. `__dirname` would have been the careful-looking choice and is not available at
        // all under vitest's ESM, which would have made the one module that must never throw
        // unloadable by the tests that prove it never throws.
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GIT_TIMEOUT_MS,
      }),
    )
  try {
    const commit = git(['rev-parse', 'HEAD']).trim()
    // A sha is 40 hex characters. Anything else — an empty repository, a `git` that printed a
    // warning where we expected an answer — is not a commit, and saying so beats naming it.
    if (!/^[0-9a-f]{40}$/.test(commit)) return null
    return {
      commit,
      dirty: git(['status', '--porcelain', '--untracked-files=no']).trim().length > 0,
    }
  } catch {
    // No repository, no `git` on PATH, a timeout, a corrupt index. All of them mean the same thing
    // to a reader — nobody recorded which commit this is — and `describeBuild` turns that into a
    // word rather than an empty string or a crash.
    return null
  }
}

/**
 * The stamp for one build.
 *
 * `serve` returns `dev` without reading git. The dev server rebuilds on save and hot-replaces the renderer, so a commit captured at startup would soon be stale.
 */
export function describeBuild(
  command: 'build' | 'serve',
  read: () => GitFacts = readGitFacts,
): BuildStamp {
  if (command === 'serve') return { id: 'dev', commit: '', dirty: false }
  const facts = read()
  if (facts === null) return { id: 'unknown', commit: '', dirty: false }
  return { id: facts.commit.slice(0, SHORT_SHA), commit: facts.commit, dirty: facts.dirty }
}

/**
 * # F077 · which of its branches a combined build holds
 *
 * The combined build merges `dev`, `prompts` and `ui` into `develop`. A conflicting branch can be omitted, so the commit alone does not say which inputs are present.
 *
 * ⚑ **Read from the repository at build time, never from the follower**: each branch's tip, whether
 * it is in this build's history (`merge-base --is-ancestor`), and — for one that is not — which of
 * the branches held it conflicts with (`merge-tree`, which merges in memory and touches no working
 * tree). ⚠️ What the follower meant by leaving it out is not knowable here; a branch that merges
 * cleanly yet is missing says so without a reason.
 *
 * ⛔ **Only for a build of {@link COMBINED_BRANCH}**: any other build (a lane's own branch, a
 * packaged release) is not a combination, and naming branches it never meant to hold would be a
 * false alarm. ⛔ Never fails a build: anything git will not answer is `null`, *"not known"*.
 */
export const COMBINED_BRANCH = 'develop'
/** The branches the follower combines, in the order it merges them. */
export const COMBINED_FROM = ['dev', 'prompts', 'ui'] as const

/**
 * One branch of a combined build: held at its tip; held at an older commit of it (it moved after it
 * was merged in); or left out, and why if that can be told.
 */
export type BuildBranch =
  | { readonly name: string; readonly tip: string; readonly held: true }
  | {
      readonly name: string
      readonly tip: string
      readonly held: 'older'
      /** The newest commit of it this build holds. */
      readonly holdsUpTo: string
      /** How many of its commits are newer than that. */
      readonly behind: number
    }
  | {
      readonly name: string
      readonly tip: string
      readonly held: false
      /** The held branches its tip conflicts with; `[]` when none does; `null` when not known. */
      readonly conflictsWith: readonly string[] | null
      /** Whether its tip conflicts with this build as a whole; `null` when not known. */
      readonly conflictsWithBuild: boolean | null
    }

type Exec = typeof execFileSync

/** `true`/`false` for a git command whose exit 0/1 is the answer; anything else throws. */
function yesOrNo(exec: Exec, args: string[]): boolean {
  try {
    exec('git', args, { stdio: 'ignore', timeout: GIT_TIMEOUT_MS })
    return true
  } catch (error) {
    if ((error as { status?: unknown }).status === 1) return false
    throw error
  }
}

/** Whether two commits merge cleanly — in memory; `null` when git would not say. */
function conflicts(exec: Exec, one: string, other: string): boolean | null {
  try {
    return !yesOrNo(exec, [
      'merge-tree',
      '--write-tree',
      '--no-messages',
      '--name-only',
      one,
      other,
    ])
  } catch {
    return null
  }
}

/**
 * The branches a build of {@link COMBINED_BRANCH} holds and leaves out — `null` for any other build,
 * or when git could not be asked.
 */
export function readBuildBranches(exec: Exec = execFileSync): readonly BuildBranch[] | null {
  const git = (args: string[]): string =>
    String(
      exec('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GIT_TIMEOUT_MS,
      }),
    ).trim()
  try {
    if (git(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== COMBINED_BRANCH) return null
    const tips: { name: string; tip: string }[] = []
    for (const name of COMBINED_FROM) {
      let tip: string
      try {
        tip = git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
      } catch {
        continue // no such branch here: nothing to hold or leave out
      }
      if (/^[0-9a-f]{40}$/.test(tip)) tips.push({ name, tip })
    }
    const held = new Set(
      tips
        .filter((one) => yesOrNo(exec, ['merge-base', '--is-ancestor', one.tip, 'HEAD']))
        .map((one) => one.name),
    )
    return tips.map(({ name, tip }): BuildBranch => {
      const short = tip.slice(0, SHORT_SHA)
      if (held.has(name)) return { name, tip: short, held: true }
      const others = tips.filter((one) => held.has(one.name))
      // ⚑ Merged in at an older tip: the newest commit it shares with this build is its own, on no
      // other held branch — so some of its commits are here, and the newer ones are not.
      const shared = git(['merge-base', 'HEAD', tip])
      if (
        /^[0-9a-f]{40}$/.test(shared) &&
        !others.some((one) => yesOrNo(exec, ['merge-base', '--is-ancestor', shared, one.tip]))
      ) {
        const behind = Number(git(['rev-list', '--count', `HEAD..${tip}`]))
        if (Number.isInteger(behind)) {
          return { name, tip: short, held: 'older', holdsUpTo: shared.slice(0, SHORT_SHA), behind }
        }
      }
      const against = others.map((one) => ({ ...one, clash: conflicts(exec, one.tip, tip) }))
      return {
        name,
        tip: short,
        held: false,
        conflictsWith: against.some((one) => one.clash === null)
          ? null
          : against.filter((one) => one.clash === true).map((one) => one.name),
        conflictsWithBuild: conflicts(exec, 'HEAD', tip),
      }
    })
  } catch {
    return null
  }
}
