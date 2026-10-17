import { parentPort, workerData } from 'node:worker_threads'
import { WindowReadEngine } from '../../src/main/db/window-read-engine'
import { windowReadQuery } from '../../src/main/db/window-read-protocol'

const engine = new WindowReadEngine((workerData as { file: string }).file)
const port = parentPort
port?.postMessage({ type: 'ready' })
port?.on('message', (input: { type: string; id: number; query: unknown }) => {
  if (input.type === 'close') {
    engine.close()
    port.close()
    return
  }
  const began = performance.now()
  try {
    const result = engine.read(windowReadQuery.parse(input.query))
    // Keep the pinned reply for 200 ms so both policies see the same service bound.
    setTimeout(
      () => port.postMessage({ type: 'read', id: input.id, result }),
      Math.max(0, 200 - (performance.now() - began)),
    )
  } catch {
    port.postMessage({ type: 'failed', id: input.id })
  }
})
