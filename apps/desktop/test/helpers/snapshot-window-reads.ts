import type { AppDatabase } from '../../src/main/db/connection'
import { WindowReadEngine } from '../../src/main/db/window-read-engine'
import { windowWriterSampler } from '../../src/main/db/window-writer-stamp'
import type { RuntimeHostDeps } from '../../src/main/runtime/runtime-host'

/** Canonical snapshot reads for host fixtures; real-thread behavior is tested separately. */
export function snapshotWindowReads(
  file: string,
  writer: AppDatabase,
): Pick<RuntimeHostDeps, 'windowReader' | 'windowWriterStamp'> {
  const engine = new WindowReadEngine(file)
  return {
    windowReader: {
      read: async (query) => engine.read(query),
      close: async () => engine.close(),
    },
    windowWriterStamp: windowWriterSampler(writer, () => true),
  }
}
