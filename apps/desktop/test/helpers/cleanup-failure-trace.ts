import { rmSync } from 'node:fs'
import type { TestContext } from 'vitest'

function cleanupFailureTrace(context: TestContext) {
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

export async function cleanupAndReportFailures(
  context: TestContext,
  hosts: readonly { closeAll(): Promise<void> }[],
  db: { close(): void },
  directories: readonly string[],
): Promise<void> {
  const trace = cleanupFailureTrace(context)
  trace('hook-entry')
  for (const [index, built] of hosts.entries()) {
    trace('host-close-entry', index)
    try {
      await built.closeAll()
    } finally {
      trace('host-close-settled', index)
    }
  }
  trace('db-close-entry')
  db.close()
  trace('db-close-return')
  for (const [index, dir] of directories.entries()) {
    trace('rm-entry', index)
    rmSync(dir, { recursive: true, force: true })
    trace('rm-return', index)
  }
  trace('hook-return')
}
