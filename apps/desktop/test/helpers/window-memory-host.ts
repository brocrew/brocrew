import type { Worker } from 'node:worker_threads'
import { vi } from 'vitest'
import type { AppDatabase } from '../../src/main/db/connection'
import type { SessionStore } from '../../src/main/db/session-store'
import { WindowWorkerReader } from '../../src/main/db/window-worker-reader'
import { windowWriterSampler } from '../../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../../src/main/db/fresh-limits-snapshot'
import { aLibraryHost } from './files-library-fixture'

export function windowMemoryHost(
  directory: string,
  db: AppDatabase,
  store: SessionStore,
  worker: Worker,
) {
  const onMain = vi.fn(() => {
    throw new Error('history fold on main')
  })
  const host = aLibraryHost(directory, {
    store: {
      ...store,
      routedRequestsOf: onMain,
      questionsAPersonMustAnswer: onMain,
      decisionsAwaitingAPerson: onMain,
    },
    windowReader: new WindowWorkerReader(worker),
    afterFirstWindowLoad: new Promise<void>(() => {}),
    windowWriterStamp: windowWriterSampler(db, () => true),
    limitsWriterStamp: limitsWriterSampler(db, () => true),
  })
  return { host, onMain }
}
