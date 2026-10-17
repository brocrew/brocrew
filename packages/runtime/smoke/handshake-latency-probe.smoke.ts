import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  describeScan,
  pathsNaming,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import {
  CodexRuntime,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type SessionHandle,
  type SessionRef,
} from '../src/index'
import { runEvidence, runScratch } from './run-paths'
import { bundledCodexTransportFactory } from './bundled-codex'

/**
 * **How long does a Codex launch actually take?** (102)
 *
 * `AgentRuntime.start`/`resume` await an RPC handshake with no deadline, while the sibling
 * `listModels` is bounded at 15 s — and 100 measured the consequence: a slot wedged in `starting`
 * with no way out but quitting the app. 102 puts a bound on it, and a bound picked from nothing is
 * a guess wearing a number. This is the measurement it is picked from.
 *
 * **No turn and no tokens** — `thread/start` and `thread/resume` are handshakes; nothing is sent.
 * Run: `pnpm run probe:handshake`. Excluded from `pnpm run ci`.
 *
 * ⚠️ **It never writes to `~/.codex`.** The home is a throwaway under `tmpdir()`, provisioned the
 * way the app provisions one, and the run fails if anything it owns turns up in the personal tree
 * (176 — replacing a before/after hash of `~/.codex/{auth.json,config.toml}`, which is the control
 * `174` found failing on other people's writes across three other instruments).
 */

const LOG = runEvidence('handshake-latency.log')
/** Enough runs to see a spread rather than one number; each is a real spawn. */
const RUNS = 5

/**
 * ⛔ **The bound this probe was written to argue, and never asserted until 176.**
 *
 * `174` found the shape: the file measured the latency and then asserted only that *every start
 * answered*. A regression from today's 928 ms cold start to fourteen seconds would have been printed
 * in full and reported green — which is exactly the wedge `100` measured and `102` exists to prevent.
 *
 * ⚑ **The bounds are anchored to the app, not to today's numbers.** `DEFAULT_LAUNCH_TIMEOUT_MS` in
 * `apps/desktop/src/main/runtime/runtime-host.ts` is **15 s**: past it the user gets a failed launch
 * instead of a session. A probe that only reddened AT 15 s would tell us nothing the user had not
 * already been told, so cold is bounded at a third of it and warm at an eighth.
 *
 * | | 174 | 176 | bound | headroom |
 * |---|---|---|---|---|
 * | cold start | 928 ms | 975 ms | **5 s** | 5× |
 * | warm start, median | 83 ms | 341 ms | **2 s** | 6× |
 * | resume, median | 130 ms | 246 ms | **2 s** | 8× |
 *
 * ⚠️ **Two runs two days apart, and the warm median moved 4×.** That is the argument for the
 * headroom rather than against the bound: the machine's load is the dominant term at this scale, so
 * a ceiling drawn near today's number would be a ceiling that fails on a busy afternoon. What it is
 * drawn near instead is the point at which a person notices.
 *
 * ⚠️ **Generous on purpose.** The point is to catch a 15× regression before the app's own timeout
 * does, not to go red because the machine was busy. The MEDIAN is bounded rather than the max for
 * the same reason: one slow spawn in five is a machine, and three are a defect.
 */
const COLD_START_BOUND_MS = 5_000
const WARM_START_BOUND_MS = 2_000
const RESUME_BOUND_MS = 2_000

/** The middle sample, in ms — what the bounds above are stated against. */
function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY
}

function say(line: string): void {
  console.log(line)
  appendFileSync(LOG, `${line}\n`)
}

/** min / median / max, in ms — the three numbers a bound is argued from. */
function spread(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  return `n=${sorted.length} min=${sorted[0]}ms median=${median}ms max=${sorted[sorted.length - 1]}ms`
}

it('codex handshake latency — live probe', async () => {
  writeFileSync(LOG, '')
  const scratch = runScratch('handshake-probe')
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-probe-homes')
  const homeName = `codex-${process.pid}-${RUNS}`
  const providerHome = join(managedRoot, homeName)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)
  expect(codexAuthHealth(providerHome).ok, 'the throwaway home has a usable credential').toBe(true)

  const runtime = new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth)

  // ── start ──────────────────────────────────────────────────────────────────────────────────
  // The first run pays whatever a cold binary costs (page-in, first spawn) and is reported
  // separately: a bound argued from warm numbers alone would be a bound that fails on the one
  // launch a person makes right after opening the app.
  const starts: number[] = []
  let ref: SessionRef | null = null
  for (let run = 0; run < RUNS; run++) {
    const began = Date.now()
    const handle: SessionHandle = await runtime.start({ cwd: scratch, providerHome })
    const took = Date.now() - began
    starts.push(took)
    say(`start #${run + 1}: ${took}ms${run === 0 ? ' (cold)' : ''}`)
    ref ??= handle.ref
    await handle.close()
  }
  say(`start: ${spread(starts)} · cold=${starts[0]}ms`)

  // Create one real one-word turn before resume. A thread without turns is not resumable:
  // five measured attempts returned `no rollout found for thread id …` in 65–70ms. A rollout
  // must exist to load. Codex uses the signed-in plan, and the provider chooses the model
  // under the smoke policy.
  if (ref !== null) {
    const handle = await runtime.start({ cwd: scratch, providerHome })
    const seen: string[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) seen.push(event.type)
    })()
    await handle.send('Reply with the single word: ok')
    const until = Date.now() + 120_000
    while (!seen.includes('turn') && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    ref = handle.ref ?? ref
    say(`seeded a resumable thread: turn recorded=${seen.includes('turn')}`)
    await handle.close()
    await consumer
  }

  // ── resume ─────────────────────────────────────────────────────────────────────────────────
  // The slower of the two in principle — the server has a rollout to load — so it is the one the
  // bound has to cover. One turn's worth of rollout is stated rather than glossed: it is the FLOOR
  // of a resume, not a worst case.
  const resumes: number[] = []
  if (ref === null) {
    say('resume: SKIPPED — start returned no ref')
  } else {
    for (let run = 0; run < RUNS; run++) {
      const began = Date.now()
      try {
        const handle = await runtime.resume(ref, { providerHome })
        const took = Date.now() - began
        resumes.push(took)
        say(`resume #${run + 1}: ${took}ms`)
        await handle.close()
      } catch (error) {
        say(`resume #${run + 1}: FAILED after ${Date.now() - began}ms — ${String(error)}`)
      }
    }
    say(resumes.length > 0 ? `resume: ${spread(resumes)}` : 'resume: no successful runs')
  }

  // ---- 🔒 isolation, keyed to what this run owns (176) ----
  //
  // ⚑ The thread this run created is the marker: Codex records a rollout under
  // `<CODEX_HOME>/sessions/…/rollout-*-<thread id>.jsonl`, so a leak has this id in its NAME. The
  // positive half is free — a rollout the resume above could not have loaded would have failed
  // already — and the negative half now covers the whole personal tree rather than two files.
  const markers: Marker[] = [
    { label: 'our provider home', value: homeName },
    ...(ref === null ? [] : [{ label: 'our thread id', value: ref.sessionId }]),
  ]
  // ⛔ **`.length` on a scan object is `undefined`, and `undefined > 0` is FALSE** (202) — so the
  // positive half below could not pass either, on a declaration that said `Hit[]`.
  const rollouts = pathsNaming(providerHome, markers).hits
  const leaked = describeScan(pathsNaming(join(homedir(), '.codex'), markers))
  say(`this run rollout(s) in the isolated home: ${rollouts.length}`)
  say(`anything of ours in ~/.codex: ${leaked}`)
  rmSync(providerHome, { recursive: true, force: true })

  // The probe's own claim: every launch answered. A probe that measured nothing must be red.
  expect(starts.length, 'every start answered').toBe(RUNS)

  // ⛔ 176 §3 — the numbers this file exists to argue from, BOUNDED. See the constants for why
  // these figures and not others: they are a fraction of the app's own launch timeout, and they sit
  // 5-24× above what the machine does today.
  expect(
    starts[0] ?? Number.POSITIVE_INFINITY,
    'a cold start is well inside the launch timeout',
  ).toBeLessThan(COLD_START_BOUND_MS)
  expect(
    median(starts.slice(1)),
    'and a warm start is an order of magnitude quicker again',
  ).toBeLessThan(WARM_START_BOUND_MS)
  expect(resumes.length, 'resume was measured at all — an unmeasured bound is not a bound').toBe(
    RUNS,
  )
  expect(
    median(resumes),
    'resume, the slower of the two in principle, is inside the same bound',
  ).toBeLessThan(RESUME_BOUND_MS)

  // 🔒 The isolation claim, positive half first — a scan that can find nothing proves nothing.
  expect(markers, 'the thread id this run created is what the scan is keyed on').toHaveLength(2)
  expect(rollouts.length, 'the isolated home holds this run own rollout').toBeGreaterThan(0)
  expect(leaked, 'and nothing of ours is in the personal home').toBe('none')
}, 600_000)
