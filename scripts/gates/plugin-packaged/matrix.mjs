// A diagnostic ladder, never an implicit retry of the real journey.
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { HIDDEN_LAUNCH_ARG } from '../../lib/hidden-launch.mjs'
import { bounded } from './processes.mjs'
import { safeFailure, safeAppStderr } from './diagnostics.mjs'
import { safePageState } from './page-state.mjs'

export const variants = ['V0', 'V1', 'V2', 'V2F', 'V3', 'V4']
const sandboxVariants = ['V3', 'V4']
export function safeVariant(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') ===
      (['V0', 'V1'].includes(value.variant)
        ? 'devtools,drew,exit,started,stderrCategory,variant'
        : 'devtools,drew,exit,stderrCategory,variant') &&
    variants.includes(value.variant) &&
    (!['V0', 'V1'].includes(value.variant) ||
      (typeof value.started === 'boolean' && value.drew === false && value.devtools === false)) &&
    typeof value.drew === 'boolean' &&
    typeof value.devtools === 'boolean' &&
    safeAppStderr({ category: value.stderrCategory }) &&
    (value.exit === null ||
      (Number.isInteger(value.exit) && value.exit >= 0 && value.exit <= 255) ||
      (typeof value.exit === 'string' &&
        safeFailure({
          phase: 'gui-probe',
          errorClass: 'signal',
          exitCode: null,
          signal: value.exit,
        })))
  )
}
export function safeMatrix(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, record]) => variants.includes(key) && record?.variant === key && safeVariant(record),
    )
  )
}
export function safeMatrixDrains(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, drained]) => variants.includes(key) && typeof drained === 'boolean',
    )
  )
}
export function safeSelection(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') ===
      'droppedFences,fixtureEnvironment,rule,sandbox,variant' &&
    value.variant === 'V2F' &&
    value.rule === 'fixture-variant-must-draw' &&
    value.fixtureEnvironment === true &&
    value.sandbox === sandboxVariants.includes(value.variant) &&
    value.droppedFences !== null &&
    typeof value.droppedFences === 'object' &&
    Object.keys(value.droppedFences).sort().join(',') === 'keychainDataDeny,loopbackOutbound' &&
    value.droppedFences.loopbackOutbound === !value.sandbox &&
    value.droppedFences.keychainDataDeny === !value.sandbox
  )
}
export function firstDrawing(records) {
  if (!safeMatrix(records) || variants.some((variant) => !records[variant]))
    throw new Error('Incomplete probe matrix')
  const variant = ['V2F'].find((key) => records[key].drew)
  if (!variant) throw new Error('No drawing launch variant')
  return {
    variant,
    rule: 'fixture-variant-must-draw',
    sandbox: sandboxVariants.includes(variant),
    fixtureEnvironment: true,
    droppedFences: { loopbackOutbound: variant === 'V2F', keychainDataDeny: variant === 'V2F' },
  }
}
export function safeMatrixReceipt(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some(
      (key) =>
        !['matrixDrains', 'probeMatrix', 'launchSelection', 'matrixPageStates'].includes(key),
    ) ||
    (value.matrixPageStates !== undefined && !safeMatrixPageStates(value.matrixPageStates)) ||
    !safeMatrix(value.probeMatrix) ||
    !safeMatrixDrains(value.matrixDrains) ||
    Object.keys(value.probeMatrix).sort().join(',') !==
      Object.keys(value.matrixDrains).sort().join(',')
  )
    return false
  if (value.launchSelection === undefined) return true
  try {
    const selected = firstDrawing(value.probeMatrix)
    return (
      safeSelection(value.launchSelection) &&
      value.launchSelection.variant === selected.variant &&
      variants.every((variant) => value.matrixDrains[variant] === true)
    )
  } catch {
    return false
  }
}
export function safeMatrixPageStates(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([variant, state]) => variants.includes(variant) && safePageState(state),
    )
  )
}
export function requireSelection(receipt) {
  if (!safeMatrixReceipt(receipt) || !receipt.launchSelection)
    throw new Error('Missing measured launch selection')
  return receipt.launchSelection
}
export function launchVariant(
  variant,
  { root, executable, workspace, global, port, baseline, fixture },
) {
  if (!variants.includes(variant)) throw new Error('Invalid probe variant')
  const level = variants.indexOf(variant)
  // The normal Mac smoke check's first launch already supplies a fresh user-data-dir and hidden.
  const args = [`--user-data-dir=${workspace}`, HIDDEN_LAUNCH_ARG]
  if (level >= 2)
    args.push(
      '--use-mock-keychain',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--plugin-global-root=${global}`,
    )
  const env =
    level === 0
      ? { ...baseline }
      : !['V2F', 'V4'].includes(variant)
        ? {
            ...baseline,
            HOME: path.join(root, 'home'),
            USERPROFILE: path.join(root, 'home'),
            CFFIXED_USER_HOME: path.join(root, 'home'),
          }
        : fixture
  return sandboxVariants.includes(variant)
    ? {
        program: '/usr/bin/sandbox-exec',
        args: ['-f', path.join(root, 'sandbox.sb'), executable, ...args],
        env,
      }
    : { program: executable, args, env }
}
/** IO owns the child and its independent drain even when measurement rejects or times out. */
export async function probeVariants(io) {
  io.guard()
  const records = {},
    drains = {}
  for (const variant of variants) {
    io.guard()
    const record = { variant, drew: false, devtools: false, exit: null, stderrCategory: 'other' }
    if (['V0', 'V1'].includes(variant)) record.started = false
    const abort = new AbortController()
    let run,
      failed = false
    try {
      await bounded(
        (async () => {
          const prepared = await io.beforeLaunch?.(variant)
          if (abort.signal.aborted) throw new Error('Probe launch deadline')
          run = io.launch(variant, prepared)
          await Promise.race([
            io.measure(run, variant, record, abort.signal),
            run.exit.then(() => {}),
            ...(io.cancelled ? [io.cancelled] : []),
          ])
        })(),
        io.limit ?? 60_000,
      )
    } catch {
      failed = true
      // Failures are measured, not reasons to skip the remaining variants.
    } finally {
      abort.abort()
    }
    if (failed && run && io.failed)
      await bounded(
        Promise.resolve().then(() => io.failed(run, variant)),
        5500,
      ).catch(() => {})
    if (run) {
      // Capture natural exit before our drain sends TERM/KILL.
      record.exit = run.child.signalCode ?? run.child.exitCode ?? null
    }
    const drained = await io.drain(run)
    if (run) record.stderrCategory = run.stderrClass().category
    drains[variant] = drained === true
    if (!safeVariant(record)) throw new Error('Unsafe probe result')
    records[variant] = { ...record }
    io.record(records, drains)
    // Another variant must not inherit a previous launch whose bounded drain failed.
    if (!drains[variant]) throw new Error('Probe variant did not drain')
  }
  return { records, drains, selection: firstDrawing(records) }
}
export async function pollDraw(work, signal) {
  while (!signal.aborted) {
    if (await work()) return
    await delay(100, undefined, { signal })
  }
}
/** Baselines have no CDP; only twenty seconds of actual survival counts as started. */
export async function baselineSurvived(run, signal) {
  if (signal.aborted) return false
  let timer, aborted
  try {
    const waiting = new Promise((resolve) => {
      aborted = () => resolve(false)
      signal.addEventListener('abort', aborted, { once: true })
      timer = setTimeout(
        () =>
          resolve(!signal.aborted && run.child.exitCode === null && run.child.signalCode === null),
        20_000,
      )
    })
    return await Promise.race([waiting, run.exit.then(() => false)])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', aborted)
  }
}
