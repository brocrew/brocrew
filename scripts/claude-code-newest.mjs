#!/usr/bin/env node
// What the daily Claude Code run decides about the newest version BroBot was tested with.
//
// Claude Code's installer updates itself almost daily, so the newest version tested falls behind
// unless something moves it. Each day CI runs BroBot's runtime against the newest published Claude
// Code (`.github/workflows/claude-code.yml`, its `published` arm); this script says what that run
// means for `apps/desktop/src/main/providers/claude/claude-code-tested.json`:
//   - the run passed on a version newer than `newest`: raise `newest` to it;
//   - `newest` already names it, or a newer one: nothing to do;
//   - the run failed: say so, loudly — a version people are updating to does not work here.
//
// usage:
//   node scripts/claude-code-newest.mjs newer --published 2.1.292
//     says whether it is newer than the newest version tested, as `newer=true|false` in $GITHUB_OUTPUT;
//   node scripts/claude-code-newest.mjs decide --published 2.1.292 --passed true|false [--dry-run]
// It prints one line saying what it decided, writes `decision=` (and `version=` when it raises) to
// $GITHUB_OUTPUT when set, rewrites the JSON when it raises (never in a dry run), and exits 1 when
// the run failed. Both commands put their line in the run's summary ($GITHUB_STEP_SUMMARY) when set.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const TESTED_FILE = join(
  here,
  '..',
  'apps',
  'desktop',
  'src',
  'main',
  'providers',
  'claude',
  'claude-code-tested.json',
)

/** `-1`, `0` or `1` as `a` is older than, the same as or newer than `b` — numbers, part by part. */
export function versionOrder(a, b) {
  const parts = (version) => version.split(/[.+-]/, 3).map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i += 1) {
    const step = (x[i] ?? 0) - (y[i] ?? 0)
    if (step !== 0) return Math.sign(step)
  }
  return 0
}

/**
 * What one run against the newest published Claude Code means.
 * @param {{ oldest: string, newest: string }} tested
 * @param {string} published — the version the run installed
 * @param {boolean} passed — whether the runtime's probe passed on every system
 * @returns {{ decision: 'raise' | 'nothing' | 'failed', said: string, tested?: { oldest: string, newest: string } }}
 */
export function whatTheRunMeans(tested, published, passed) {
  if (!/^\d+\.\d+\.\d+$/.test(published)) {
    return {
      decision: 'failed',
      said: `The published Claude Code version could not be read (${published}).`,
    }
  }
  if (!passed) {
    return {
      decision: 'failed',
      said:
        `BroBot's runtime did not pass on Claude Code ${published}, the newest published. ` +
        `The newest version tested stays ${tested.newest}; look at this run before people update to it.`,
    }
  }
  if (versionOrder(published, tested.newest) <= 0) {
    return {
      decision: 'nothing',
      said: `Claude Code ${published} passed; the newest version tested is already ${tested.newest}.`,
    }
  }
  return {
    decision: 'raise',
    said: `Claude Code ${published} passed on every system; the newest version tested goes from ${tested.newest} to ${published}.`,
    tested: { oldest: tested.oldest, newest: published },
  }
}

/** Whether a published version is newer than the newest one tested. */
export function isNewer(tested, published) {
  return /^\d+\.\d+\.\d+$/.test(published) && versionOrder(published, tested.newest) > 0
}

function argument(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** Prints a line, and puts it in the run's summary when there is one. */
function say(line) {
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
}

function main() {
  const command = process.argv[2]
  const tested = JSON.parse(readFileSync(TESTED_FILE, 'utf8'))
  const published = argument('published') ?? ''
  if (command === 'newer') {
    const newer = isNewer(tested, published)
    say(
      newer
        ? `Claude Code ${published} is newer than the newest version tested, ${tested.newest}: it is run today.`
        : `Claude Code ${published} is not newer than the newest version tested, ${tested.newest}: nothing to run today.`,
    )
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `newer=${String(newer)}\n`)
    return
  }
  if (command !== 'decide') {
    console.error(
      'usage: node scripts/claude-code-newest.mjs newer --published <version>\n' +
        '       node scripts/claude-code-newest.mjs decide --published <version> --passed true|false [--dry-run]',
    )
    process.exit(2)
  }
  const dryRun = process.argv.includes('--dry-run')
  const meant = whatTheRunMeans(tested, published, argument('passed') === 'true')
  say(meant.said)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `decision=${meant.decision}\n${meant.tested === undefined ? '' : `version=${meant.tested.newest}\n`}`,
    )
  }
  if (meant.decision === 'raise' && meant.tested !== undefined) {
    if (dryRun) console.log(`Dry run: ${TESTED_FILE} is left as it is.`)
    else writeFileSync(TESTED_FILE, `${JSON.stringify(meant.tested, null, 2)}\n`)
  }
  if (meant.decision === 'failed') process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
