/**
 * Require the running Node version to satisfy `package.json`'s engine declaration and
 * require `.nvmrc` to select an accepted version. Read both declarations instead of keeping
 * another version constant here. Package-manager defaults do not enforce `engines`.
 *
 * Runtime differences affect real cleanup: Node's recursive removal implementation and
 * failure residues differ between releases. Checks run on an undeclared runtime would
 * measure different behaviour and could print a different survivor report.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The `>=X.Y.Z` this repo declares, as three numbers.
 *
 * ⛔ **Exactly one range shape, and anything else is a refusal rather than a guess.** A check that
 * cannot read its own declaration must not answer *"fine"* — that is a gate that passes because it
 * failed, which is `325`'s `holdersOf` defect in a different file.
 */
export function declaredMinimum(range) {
  const match = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range.trim())
  if (match === null) {
    throw new Error(
      `engines.node is "${range}", which this check cannot read. It understands ">=X.Y.Z" and ` +
        `nothing else, and it refuses rather than assuming a range it has not been taught (387).`,
    )
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** `a` is at least `b`, comparing major, then minor, then patch. */
export function atLeast(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return true
}

/** `24`, `v24`, `24.0.2`, `lts/*` → the leading major, or `null` when there is not one. */
export function nvmrcMajor(text) {
  const match = /^v?(\d+)/.exec(text.trim())
  return match === null ? null : Number(match[1])
}

/**
 * The whole verdict, as text or `null`. Exported so the test can read the sentence rather than a
 * process exit code.
 */
export function engineProblem({
  running = process.versions.node,
  manifest = readFileSync(join(ROOT, 'package.json'), 'utf8'),
  nvmrc = readFileSync(join(ROOT, '.nvmrc'), 'utf8'),
} = {}) {
  const range = JSON.parse(manifest).engines?.node
  if (typeof range !== 'string') {
    throw new Error(
      'package.json declares no engines.node, so there is nothing to enforce and this check cannot ' +
        'be the thing that decides what the runtime should be (387).',
    )
  }
  const minimum = declaredMinimum(range)
  const pinned = nvmrcMajor(nvmrc)
  if (pinned === null || pinned < minimum[0]) {
    return (
      `.nvmrc says "${nvmrc.trim()}" and package.json requires node ${range}. ⛔ The two ` +
      `declarations disagree, so the remedy this check would print is not one. Fix them together.`
    )
  }
  const version = running.split('.').map(Number)
  if (version.length !== 3 || version.some((part) => !Number.isInteger(part))) {
    throw new Error(`could not read the running node version: ${running} (387)`)
  }
  if (atLeast(version, minimum)) return null
  return (
    `⛔ node ${running} — this repo requires ${range} (package.json engines.node) and pins ${pinned} ` +
    `in .nvmrc.\n` +
    `   Nothing below that is being refused to be tidy: fs.rmSync is the JS rimraf on 20 and 22 and ` +
    `a C++ binding on 24, and the three *:check gates remove a live app's user-data directory ` +
    `through it. On the older one a failed removal empties nothing, so the survivor list a person ` +
    `reads describes a different function (387).\n` +
    `   Remedy: \`nvm use\` in this directory, or \`nvm install ${pinned}\` if it is not installed yet.`
  )
}

// ⚠️ Only when this file IS the command. Importing it from the test must not exit the runner.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problem = engineProblem()
  if (problem !== null) {
    process.stderr.write(`${problem}\n`)
    process.exit(1)
  }
}
