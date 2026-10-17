#!/usr/bin/env node
/**
 * Run the DOM project in sequential groups, each with a fresh browser.
 *
 *   node scripts/test-dom-in-groups.mjs [VITEST ARG ...]
 *
 * `BROBOT_DOM_GROUPS` overrides the default 16. Each invocation uses `--shard=i/N` and exits
 * with its browser. Removing test iframes does not release the renderer's shared-memory
 * allocations; on Linux, `--disable-dev-shm-usage` puts them in deleted `/tmp` files that
 * `du` cannot show. Ending the renderer between groups prevents a whole-suite accumulation.
 * The default group size was measured within the CI runner's disk and memory limits.
 */

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const DEFAULT_GROUPS = 16

/** How many groups to run: `BROBOT_DOM_GROUPS` when it is a whole number above zero, else the default. */
export function groupCount(env = process.env) {
  const asked = env.BROBOT_DOM_GROUPS
  if (asked === undefined || asked === '') return DEFAULT_GROUPS
  if (!/^[1-9]\d*$/.test(asked)) {
    throw new Error(
      `BROBOT_DOM_GROUPS must be a whole number above zero, not ${JSON.stringify(asked)}`,
    )
  }
  return Number(asked)
}

/** The Vitest arguments for each group, in the order they run. */
export function groupArgs(count, extra = []) {
  return Array.from({ length: count }, (_, at) => [
    'run',
    '--project',
    'dom',
    `--shard=${String(at + 1)}/${String(count)}`,
    ...extra,
  ])
}

function main() {
  const count = groupCount()
  const failed = []
  for (const [at, args] of groupArgs(count, process.argv.slice(2)).entries()) {
    console.log(`DOM group ${String(at + 1)} of ${String(count)}`)
    const run = spawnSync('vitest', args, { stdio: 'inherit' })
    if (run.status !== 0) failed.push(at + 1)
  }
  if (failed.length > 0) {
    console.error(`DOM groups failed: ${failed.join(', ')} of ${String(count)}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
