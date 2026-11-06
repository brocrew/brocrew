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
