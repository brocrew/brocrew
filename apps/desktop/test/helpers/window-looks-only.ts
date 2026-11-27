import type { WindowReadEngine } from '../../src/main/db/window-read-engine'
import type { WindowReadQuery, WindowStoreReader } from '../../src/main/db/window-read-protocol'

/**
 * The work reconciler reads its folds on the same worker as the window looks. A case that counts
 * window looks hands its reader through this, so the reconciler's queries go straight to the
 * engine and are not counted.
 */
export function windowLooksOnly(
  reader: WindowStoreReader,
  engine: WindowReadEngine,
): WindowStoreReader {
  return {
    read: (query: WindowReadQuery, signal?: AbortSignal) =>
      query.kind.startsWith('reconciliation-')
        ? Promise.resolve(engine.read(query))
        : reader.read(query, signal),
    close: () => reader.close(),
  }
}
