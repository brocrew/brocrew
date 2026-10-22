/**
 * WHICH COMMIT IS THIS BUILD (331) — the RUNTIME half.
 *
 * ⚑ Reads what {@link ./build-stamp} baked into this bundle at build time. Three constants, three
 * `define`s, and no I/O: there is no file to find, no repository to be missing and nothing to
 * parse.
 *
 * ⛔ **This function may never throw, and that is a REQUIREMENT rather than a nicety.** Its answer
 * goes into the same `AppInfo` as the schema count, and the chip renders all of it behind one
 * `v-if` — so a build stamp that could fail would take the database schema number down with it.
 * `RuntimeScreen.vue`'s comment above that span is about exactly this failure shape (039): the app
 * has already been shipped once with a read that blanked its neighbour. Every path below returns a
 * string.
 *
 * ⚠️ **`typeof` is what makes the fallbacks reachable.** In a real build Vite has replaced these
 * identifiers with literals before this file is JavaScript. In vitest nothing replaces them, so
 * they are ordinary undeclared globals — which `typeof` may read and a bare reference may not.
 * That is also how the tests drive both paths: setting `globalThis.__BUILD_ID__` is
 * indistinguishable, here, from Vite having stamped one.
 */
import { BUILD_IS_UNRECORDED } from '@brobot2/shared'
import type { BuildBranch, BuildStamp } from './build-stamp'

declare const __BUILD_ID__: string | undefined
declare const __BUILD_COMMIT__: string | undefined
declare const __BUILD_DIRTY__: boolean | undefined

/**
 * ⚠️ **The word a build with no stamp shows.** Not `''` and not `v0.0.0`: an empty chip reads as a
 * rendering bug and a fixed number reads as an answer. `unknown` is the only one of the three that
 * is true, and it is what an unstamped bundle — a `vite build` run outside a checkout, a future
 * entry point that forgets the `define` — will say on screen instead of pretending.
 */
const NO_STAMP = BUILD_IS_UNRECORDED

export function buildIdentity(): BuildStamp {
  const id = typeof __BUILD_ID__ === 'string' && __BUILD_ID__.length > 0 ? __BUILD_ID__ : NO_STAMP
  return {
    id,
    // ⛔ Tied to `id`, not read independently. A commit without the short sha that names it would
    // let the chip and its tooltip disagree about the same build.
    commit: id === NO_STAMP || typeof __BUILD_COMMIT__ !== 'string' ? '' : __BUILD_COMMIT__,
    dirty: typeof __BUILD_DIRTY__ === 'boolean' ? __BUILD_DIRTY__ : false,
  }
}

/**
 * The version a person reads in About, the updates menu and the title bar. A release says the
 * number it was packaged with. A source build's `package.json` holds a placeholder (`0.0.0`), so
 * it says `dev` and the commit it was built from instead, or only `dev` when no commit describes it.
 */
export function shownVersion(
  appVersion: string,
  packaged: boolean,
  build: BuildStamp = buildIdentity(),
): string {
  if (packaged) return appVersion
  if (build.commit === '') return 'dev'
  return `dev ${build.id}${build.dirty ? '-dirty' : ''}`
}

declare const __BUILD_BRANCHES__: unknown

/** One branch as the stamp wrote it — checked here, so a malformed stamp reads as *"not known"*. */
function isBuildBranch(value: unknown): value is BuildBranch {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>
  if (typeof one.name !== 'string' || typeof one.tip !== 'string') return false
  if (one.held === true) return true
  if (one.held === 'older') {
    return typeof one.holdsUpTo === 'string' && typeof one.behind === 'number'
  }
  if (one.held !== false) return false
  const names = one.conflictsWith
  const conflictsWith =
    names === null || (Array.isArray(names) && names.every((name) => typeof name === 'string'))
  return (
    conflictsWith &&
    (one.conflictsWithBuild === null || typeof one.conflictsWithBuild === 'boolean')
  )
}

/**
 * ⚑ **F077 · the branches a combined build holds and leaves out**, as `build-stamp.ts`'s
 * `readBuildBranches` baked them in — `null` for a build that is not a combination, or that recorded
 * nothing. No I/O, never throws.
 */
export function buildBranches(): readonly BuildBranch[] | null {
  const said = typeof __BUILD_BRANCHES__ === 'undefined' ? null : __BUILD_BRANCHES__
  return Array.isArray(said) && said.every(isBuildBranch) ? said : null
}
