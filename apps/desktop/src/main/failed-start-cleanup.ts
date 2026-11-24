import { inspect } from 'node:util'
import type { RuntimeHost } from './runtime/runtime-host'

export async function closeStartedHostAfterFailedStart(
  host: Pick<RuntimeHost, 'stopSweeping' | 'closeAll' | 'drainArchiveWork'>,
  sayAtOnce: (line: string) => void,
): Promise<void> {
  for (const [what, step] of [
    ['stop its archive work', () => host.stopSweeping()],
    ['close its conversations', () => host.closeAll()],
    ['drain its archive work', () => host.drainArchiveWork()],
  ] as const) {
    try {
      await step()
    } catch (error) {
      sayAtOnce(`BroCrew failed to ${what} after its failed start: ${inspect(error)}`)
    }
  }
}
