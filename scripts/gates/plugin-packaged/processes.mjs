import fs from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

export async function bounded(work, milliseconds) {
  let timer
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned process deadline')), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
/** A deadline is never an exit witness. In particular, await the exit event after SIGKILL. */
export async function stopApp(run, milliseconds = 20_000) {
  if (run.stopped) return
  run.cdp?.close()
  run.child.kill('SIGTERM')
  try {
    await bounded(run.exit, milliseconds)
  } catch {
    run.child.kill('SIGKILL')
    await bounded(run.exit, milliseconds)
  }
  run.stopped = true
}
/** Drain the adapter's observed targets; this is not proof that every descendant was found. */
export async function drainOwned(adapter, { grace = 5_000, deadline = 20_000 } = {}) {
  const until = performance.now() + deadline
  const politeUntil = performance.now() + grace
  const seen = new Map()
  do {
    const rows = await adapter.list()
    for (const row of rows) {
      if (performance.now() >= until) throw new Error('Owned process deadline')
      if (!Number.isSafeInteger(row.pid) || row.pid < 2 || !row.birth)
        throw new Error('Invalid process identity')
      seen.set(`${row.pid}:${row.birth}`, row)
      await adapter.signal(row, performance.now() < politeUntil ? 'SIGTERM' : 'SIGKILL')
    }
    if (!rows.length) {
      // No admitted launcher remains. Recheck after settling to close an in-progress fork/exit.
      await delay(20)
      if (!(await adapter.list()).length) return { exited: true, processes: seen.size }
    }
    await delay(10)
  } while (performance.now() < until)
  throw new Error('Owned processes did not exit; scratch roots retained')
}
export function requireDrained(receipt, current) {
  if (
    receipt?.exited !== true ||
    !Number.isSafeInteger(receipt.processes) ||
    receipt.processes < 0 ||
    !Array.isArray(current) ||
    current.length
  )
    throw new Error('Child exit witnesses missing; scratch roots retained')
}
export function writeDrainReceipt(file, value) {
  requireDrained(value, [])
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  )
  try {
    fs.writeFileSync(fd, JSON.stringify(value))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
/** This owner is outside the journey. Child failure, timeout and cancellation all drain first. */
export async function withIndependentDrain(work, adapter, onDrained, options) {
  try {
    return await work()
  } finally {
    await adapter.stopLaunchers?.()
    await onDrained(await drainOwned(adapter, options))
  }
}

/** Remains in the independent owner, never in the journey being stopped. */
export function cancellation(source = process) {
  const controller = new AbortController()
  const stop = () => controller.abort()
  source.on('SIGTERM', stop)
  source.on('SIGINT', stop)
  return {
    signal: controller.signal,
    close() {
      source.off('SIGTERM', stop)
      source.off('SIGINT', stop)
    },
  }
}
