import { join } from 'node:path'

/**
 * ⛔ **Where a live probe is allowed to write** (196 H4).
 *
 * Every path a probe writes to belongs to THIS invocation: `scripts/lib/smoke-globalsetup.mjs`
 * takes one run id and one lock before any probe file loads, and hands the directories down. A
 * probe that reached for `~/brobot2-scratch/claude-smoke` and `rm -rf`'d it — which is what four of
 * them did until 196 — was deleting a concurrent run's live tree and its evidence in one call.
 *
 * ⚠️ **It throws rather than falling back to a fixed path.** A default here would be the defect
 * again, arrived at by a different route, and the only way to reach this function without the run
 * is to have started vitest without the smoke config — which is a mistake worth being told about.
 */
function root(kind: 'scratch' | 'evidence'): string {
  const from = kind === 'scratch' ? 'BROBOT_PROBE_SCRATCH' : 'BROBOT_PROBE_EVIDENCE'
  const value = process.env[from]
  if (!value) {
    throw new Error(
      `${from} is unset: this probe must run under vitest.smoke.config.ts, whose globalSetup ` +
        `takes the run id and the lock (196 H4). Use \`pnpm run probe:…\` or \`pnpm run smoke:…\`.`,
    )
  }
  return value
}

/** A working directory for this probe, inside this run. Never shared, never wiped by anyone else. */
export function runScratch(name: string): string {
  return join(root('scratch'), name)
}

/** A log or artefact path for this probe, inside this run's evidence directory. */
export function runEvidence(name: string): string {
  return join(root('evidence'), name)
}
