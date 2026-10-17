import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { WindowReadEngine } from './db/window-read-engine'
import { windowReadQuery } from './db/window-read-protocol'

const options = z.object({ file: z.string().min(1) }).strict()
const request = z.discriminatedUnion('type', [
  z.object({ type: z.literal('close') }).strict(),
  z
    .object({
      type: z.literal('read'),
      id: z.number().int().positive().safe(),
      query: windowReadQuery,
      cancellation: z
        .instanceof(SharedArrayBuffer)
        .refine((buffer) => buffer.byteLength === Int32Array.BYTES_PER_ELEMENT)
        .optional(),
    })
    .strict(),
])

if (parentPort !== null) {
  const port = parentPort
  let engine: WindowReadEngine | undefined
  try {
    engine = new WindowReadEngine(options.parse(workerData).file)
    port.postMessage({ type: 'ready' })
  } catch {
    port.postMessage({ type: 'unavailable' })
    port.close()
  }
  if (engine !== undefined) {
    const reader = engine
    port.on('message', (incoming: unknown) => {
      const parsed = request.safeParse(incoming)
      if (!parsed.success || parsed.data.type === 'close') {
        reader.close()
        port.close()
        return
      }
      const { id, query, cancellation } = parsed.data
      const flag = cancellation === undefined ? undefined : new Int32Array(cancellation)
      try {
        port.postMessage({
          type: 'read',
          id,
          result: reader.read(query, () => flag !== undefined && Atomics.load(flag, 0) !== 0),
        })
      } catch {
        port.postMessage({ type: 'failed', id })
      }
    })
  }
}
