import { createHash } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Keep selected permission-matrix evidence beyond the temporary run directory.
 * `keepMatrixRecord` copies only regular top-level files matching `MATRIX_RECORD_INCLUDE`;
 * never directories or symlinks. This excludes userData, provider homes and credentials.
 * `MATRIX_RECORD_ROOT` is not pruned.
 *
 * `matrixRunExitCode` returns 0 only for a selected PASS, 1 for any FAIL, and
 * `MATRIX_NOT_MEASURED_EXIT` for NOT PERFORMED, NOT ASSERTED or absent results, including deadlines.
 */

/** ⚑ Outside `/tmp`, and outside every root `beginSmokeRun` prunes. */
export const MATRIX_RECORD_ROOT = join(homedir(), 'brobot2-scratch', 'permission-matrix-records')

/**
 * ⚑ **Every file the record may take — top-level names of the evidence root, nothing else.**
 * ⛔ Anchored at both ends, no `/`, no pattern that can match a directory's contents.
 */
export const MATRIX_RECORD_INCLUDE = Object.freeze([
  /^permission-matrix\.json$/,
  /^criterion-17-undisplayable\.json$/,
  /^criterion-20-three-surfaces\.json$/,
  /^smoke\.log$/,
  /^app-\d+-[a-z-]+\.log$/,
  /^[a-z0-9-]+\.png$/,
  /^stall-[a-z0-9-]+\.txt$/,
])

/** ⚑ A selected step-82 run that FAILED nothing but measured nothing either. `1` stays FAIL's. */
export const MATRIX_NOT_MEASURED_EXIT = 3

/**
 * ⚑ **The exit status of a SELECTED step-82 run.** `failed` is the run's FAIL count; `verdict` is
 * step 82's own (`null` when it never recorded one — a deadline that fired before the step began);
 * `measuredFailures` is how many product failures the matrix WROTE DOWN before anything ended it.
 * ⛔ FAIL outranks everything: a product failure measured before a deadline is still a failure.
 */
export function matrixRunExitCode({ failed, verdict, measuredFailures = 0 }) {
  if (failed > 0 || measuredFailures > 0) return 1
  return verdict === 'PASS' ? 0 : MATRIX_NOT_MEASURED_EXIT
}

/**
 * ⚑ **How many units `permission-matrix.json` records as a PRODUCT failure** — rows and retakes,
 * classified by the step itself. A record that does not exist (the step never began) counts none;
 * one that cannot be read throws, because a count the finisher could not take is not zero.
 */
export function productFailuresRecordedIn(path) {
  if (!existsSync(path)) return 0
  const record = JSON.parse(readFileSync(path, 'utf8'))
  return [...(record.results ?? []), ...(record.retakes ?? [])].filter(
    (unit) => unit?.classification === 'product-failure',
  ).length
}

/** The names in `evidence` the record takes: top-level regular files an include pattern matches. */
export function recordFilesIn(evidence) {
  return readdirSync(evidence, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => MATRIX_RECORD_INCLUDE.some((pattern) => pattern.test(name)))
    .sort()
}

/**
 * 🔴 **Copy the run's record out of `/tmp`, and write what was kept beside it.**
 *
 * ⚑ `manifest` is whatever the caller wants on record with the files — the price, the exit status,
 * the reason the run ended. ⛔ Each file is re-checked with `lstat` at copy time, so a name that
 * became a symlink after the listing is refused rather than followed; `COPYFILE_EXCL` refuses to
 * overwrite a record already kept.
 */
export function keepMatrixRecord({ evidence, runId, root = MATRIX_RECORD_ROOT, manifest = {} }) {
  const destination = join(root, runId)
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const files = []
  for (const name of recordFilesIn(evidence)) {
    const from = join(evidence, name)
    if (!lstatSync(from).isFile()) continue
    copyFileSync(from, join(destination, name), constants.COPYFILE_EXCL)
    const bytes = readFileSync(join(destination, name))
    files.push({
      name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  writeFileSync(
    join(destination, 'kept.json'),
    `${JSON.stringify({ runId, keptAt: new Date().toISOString(), from: evidence, files, ...manifest }, null, 2)}\n`,
  )
  return { destination, files }
}
