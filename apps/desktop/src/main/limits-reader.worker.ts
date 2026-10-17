import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { LimitsReadEngine } from './db/limits-read-engine'
import { limitsReadInput, LimitsReadUnavailable } from './db/limits-read-protocol'

const options = z.object({ file: z.string().min(1) }).strict()
const message = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('read'),
      id: z.number().int().positive().safe(),
      input: limitsReadInput,
    })
    .strict(),
  z.object({ type: z.literal('close') }).strict(),
])

if (parentPort !== null) {
  const port = parentPort
  let engine: LimitsReadEngine | undefined
  try {
    engine = new LimitsReadEngine(options.parse(workerData).file)
    port.postMessage({ type: 'ready' })
  } catch {
    port.postMessage({ type: 'unavailable' })
    port.close()
  }
  if (engine !== undefined) {
    const reader = engine
    port.on('message', (incoming: unknown) => {
      const parsed = message.safeParse(incoming)
      if (!parsed.success) {
        reader.close()
        port.postMessage({ type: 'unavailable' })
        port.close()
        return
      }
      const request = parsed.data
      if (request.type === 'close') {
        reader.close()
        port.close()
        return
      }
      try {
        const read = reader.read(request.input)
        port.postMessage({ type: 'read', id: request.id, read })
      } catch (error) {
        port.postMessage({
          type: 'failed',
          id: request.id,
          why: error instanceof LimitsReadUnavailable ? error.why : 'failed',
        })
      }
    })
  }
}
