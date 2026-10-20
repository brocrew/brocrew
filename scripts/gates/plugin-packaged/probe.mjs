// Inert IO controls exercise these waits without starting an app or inspecting a live port.
import { setTimeout as delay } from 'node:timers/promises'
import { bounded } from './processes.mjs'
import { failureError, stepFailure, appStderrClassifier } from './diagnostics.mjs'

export function observeApp(child) {
  const stderr = appStderrClassifier()
  child.stderr?.on('data', (bytes) => stderr.write(bytes))
  const closed = new Promise((resolve) => child.once('close', resolve))
  const started = new Promise((resolve) => {
    child.once('spawn', () => resolve(undefined))
    child.once('error', (error) => {
      resolve(error)
    })
  })
  const exit = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
    child.once('error', (error) => resolve({ error }))
  })
  return { child, started, exit, closed, stderrClass: () => stderr.result }
}
export async function probeStep(step, work, run, milliseconds = 20_000) {
  const abort = new AbortController()
  try {
    const lost = run?.exit.then((result) => {
      const failedStep =
        step === 'fake-browser-start' ? step : result.error ? 'app-spawn' : 'app-exit-early'
      throw failureError('gui-probe', {
        failure: stepFailure(
          'gui-probe',
          failedStep,
          result.error ?? result,
          result.error ? 'spawn' : 'child-exit',
        ),
      })
    })
    return await bounded(
      Promise.race([Promise.resolve().then(() => work(abort.signal)), ...(lost ? [lost] : [])]),
      milliseconds,
    )
  } catch (error) {
    if (error.failure) throw error
    throw failureError('gui-probe', {
      failure: stepFailure(
        'gui-probe',
        step,
        error,
        error.message === 'Owned process deadline'
          ? 'timeout'
          : step === 'app-spawn'
            ? 'spawn'
            : 'assertion',
      ),
    })
  } finally {
    abort.abort()
  }
}
// Every fetch and delay is cancelled when the step ends, including early app exit.
export async function waitDevtools(port, window, signal, request = fetch) {
  while (!signal.aborted) {
    try {
      const response = await request(
        `http://127.0.0.1:${port}/json/${window ? 'list' : 'version'}`,
        { signal },
      )
      if (response.ok) {
        const value = await response.json()
        if (
          window
            ? Array.isArray(value) &&
              value.some((page) => page.type === 'page' && page.webSocketDebuggerUrl)
            : typeof value.webSocketDebuggerUrl === 'string'
        )
          return
      }
    } catch {
      // An unavailable local endpoint is retried only until this step's deadline.
    }
    await delay(100, undefined, { signal })
  }
}
