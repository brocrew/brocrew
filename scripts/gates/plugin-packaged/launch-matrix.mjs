// Native entry point: the diagnostic launches are hosted-only, including the inherited-env baseline.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { attach } from '../../lib/update-rehearsal-app.mjs'
import { HIDDEN_LAUNCH_ARG } from '../../lib/hidden-launch.mjs'
import { requireCI, ownedRoot } from './contract.mjs'
import { fixtureAppEnvironment, privateFolder } from './prepare.mjs'
import {
  launchVariant,
  probeVariants,
  pollDraw,
  safeMatrixReceipt,
  baselineSurvived,
} from './matrix.mjs'
import { observeApp, waitDevtools } from './probe.mjs'
import { bounded, stopApp, cancellation } from './processes.mjs'
import { registerChild, bestEffortDrain } from './runner-processes.mjs'
import { integrityCheckpoint } from './integrity.mjs'
import { readOwned, stageRelease, draws } from './journey.mjs'
import { printFailure, failureFor } from './diagnostics.mjs'
import { pageStateSnapshot } from './page-state.mjs'
import { environmentKeyDiff } from './environment.mjs'

async function unusedPort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
export async function launchMatrix(root) {
  requireCI()
  ownedRoot(root)
  const plan = JSON.parse(readOwned(path.join(root, 'plan.json')))
  const abort = cancellation()
  const cancelled = new Promise((_, reject) =>
    abort.signal.addEventListener('abort', () => reject(new Error('Gate cancelled')), {
      once: true,
    }),
  )
  // The rejection is also observed when no variant is currently waiting.
  cancelled.catch(() => {})
  const receipt = { probeMatrix: {}, matrixDrains: {} }
  const save = () => {
    if (!safeMatrixReceipt(receipt)) throw new Error('Unsafe matrix receipt')
    const temporary = path.join(root, 'probe-matrix.next')
    fs.writeFileSync(temporary, JSON.stringify(receipt), { mode: 0o600 })
    fs.renameSync(temporary, path.join(root, 'probe-matrix.json'))
  }
  stageRelease(root, plan.appData)
  try {
    const result = await probeVariants({
      guard() {
        requireCI()
        if (abort.signal.aborted) throw new Error('Gate cancelled')
      },
      cancelled,
      async beforeLaunch(variant) {
        await integrityCheckpoint(root, plan.app, 'beforeLaunch', plan.bundleStamp)
        return {
          workspace: privateFolder(path.join(root, 'matrix-' + variant)),
          global: privateFolder(path.join(root, 'matrix-global-' + variant)),
          port: await unusedPort(),
        }
      },
      launch(variant, { workspace, global, port }) {
        const executable = path.join(plan.app, 'Contents/MacOS/BroCrew')
        const spec = launchVariant(variant, {
          root,
          executable,
          workspace,
          global,
          port,
          baseline: process.env,
          fixture: fixtureAppEnvironment(root, plan.app),
        })
        if (variant === 'V2') {
          // Local private receipt only: never merged into summary.json or stdout.
          fs.writeFileSync(
            path.join(root, 'environment-key-names.json'),
            JSON.stringify(environmentKeyDiff(spec.env, fixtureAppEnvironment(root, plan.app))),
            { mode: 0o600, flag: 'wx' },
          )
        }
        const launchedAt = Date.now()
        const args = spec.args
          .filter((arg) => arg !== HIDDEN_LAUNCH_ARG)
          .concat([HIDDEN_LAUNCH_ARG])
        const child = spawn(spec.program, args, {
          env: spec.env,
          stdio: ['ignore', 'ignore', 'pipe'],
          detached: true,
        })
        return { ...observeApp(child), executable, launchedAt, port, workspace, stopped: false }
      },
      async measure(run, variant, record, signal) {
        const error = await run.started
        if (error) throw error
        await registerChild(root, run.child)
        if (['V0', 'V1'].includes(variant)) {
          // No draw claim: these two variants only measure survival, never database creation.
          record.started = await baselineSurvived(run, signal)
          return
        }
        await waitDevtools(run.port, false, signal)
        record.devtools = true
        await waitDevtools(run.port, true, signal)
        run.cdp = await bounded(attach(run.port, { wait: 15_000 }), 16_000)
        if (signal.aborted) {
          run.cdp.close()
          return
        }
        await pollDraw(async () => {
          const drew = await draws(run)
          record.drew = !signal.aborted && drew
          return record.drew
        }, signal)
      },
      async drain(run) {
        const cleanup = await bestEffortDrain(
          root,
          async () => {
            if (run) {
              await stopApp(run, 500)
              await bounded(run.closed, 500)
            }
          },
          { report: printFailure },
        )
        return cleanup.drained
      },
      async failed(run, variant) {
        if (run.child.exitCode !== null || run.child.signalCode !== null) return
        const pageState = await pageStateSnapshot(run.port)
        receipt.matrixPageStates ??= {}
        receipt.matrixPageStates[variant] = pageState
      },
      record(records, drains) {
        receipt.probeMatrix = { ...records }
        receipt.matrixDrains = { ...drains }
        save()
        const record = Object.values(records).at(-1)
        console.log('gate-variant ' + JSON.stringify(record))
      },
    })
    receipt.launchSelection = result.selection
    save()
    console.log('gate-launch-selection ' + JSON.stringify(result.selection))
    return receipt
  } finally {
    abort.close()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  launchMatrix(process.argv[2]).catch((error) => {
    printFailure(failureFor('probe-matrix', error))
    process.exitCode = 1
  })
}
