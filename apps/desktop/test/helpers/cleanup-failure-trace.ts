import type { TestContext } from 'vitest'

export function cleanupFailureTrace(context: TestContext) {
  const started = performance.now()
  const stages: { stage: string; index?: number; elapsedMs: number }[] = []
  context.onTestFailed(({ task }) => {
    // A hook timeout leaves afterEach running even when its async body never returns.
    if (task.result?.hooks?.afterEach !== 'run') return
    process.stdout.write(
      'CLEANUP_FAILED ' +
        JSON.stringify({ test: task.name, id: task.id, retry: task.result.retryCount, stages }) +
        '\n',
    )
  })
  return (stage: string, index?: number) =>
    stages.push({ stage, index, elapsedMs: performance.now() - started })
}
