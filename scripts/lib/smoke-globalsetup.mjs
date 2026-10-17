import { homedir } from 'node:os'
import { join } from 'node:path'
import { beginSmokeRun, smokeTmpRoot } from './smoke-run.mjs'

/**
 * Give every live Vitest invocation one run id, isolated scratch paths and one lock.
 * `runScratch` places requested directories inside this run; probes using no scratch still
 * receive the lock. Single-fork execution serialises files within a run but cannot prevent
 * two independent invocations from interleaving against the same provider homes.
 */
export default function setup() {
  const run = beginSmokeRun({
    // ⛔ 242 §1 — the same short root the three live smokes moved to. A probe that launches an app
    // under its own evidence gets a gate that can bind; one that does not loses nothing by it.
    evidenceRoot: smokeTmpRoot('brobot2-probe-runs'),
    scratchRoot: join(homedir(), 'brobot2-scratch', 'probes'),
    keep: 10,
  })
  process.env.BROBOT_PROBE_RUN_ID = run.runId
  process.env.BROBOT_PROBE_EVIDENCE = run.evidence
  process.env.BROBOT_PROBE_SCRATCH = run.scratch
  console.log(`probe run ${run.runId} · evidence ${run.evidence} · scratch ${run.scratch}`)
  return () => {
    run.release()
  }
}
