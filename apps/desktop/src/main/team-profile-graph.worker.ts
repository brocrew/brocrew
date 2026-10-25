import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { TeamProfileGraphEngine } from './db/team-profile-graph-engine'
import {
  teamProfileGraphRequest,
  graphReadContext,
  TEAM_PROFILE_GRAPH_BOUNDS as B,
} from '../shared/team-profile-graph'
const options = z.strictObject({ file: z.string().min(1), executionFile: z.string().min(1) })
const incoming = z.strictObject({
  type: z.literal('read'),
  id: z.number().int().positive().safe(),
  request: teamProfileGraphRequest,
  context: graphReadContext,
  cancellation: z.instanceof(SharedArrayBuffer).refine((b) => b.byteLength === 4),
})
if (parentPort !== null) {
  const port = parentPort
  try {
    const { file, executionFile } = options.parse(workerData)
    const engine = new TeamProfileGraphEngine(file, executionFile)
    let expiry: ReturnType<typeof setTimeout> | undefined
    const close = () => {
      if (expiry) clearTimeout(expiry)
      engine.close()
      port.close()
    }
    port.postMessage({ type: 'ready' })
    port.on('message', (message: unknown) => {
      const parsed = incoming.safeParse(message)
      if (!parsed.success) {
        close()
        return
      }
      const { id, request, context, cancellation } = parsed.data,
        flag = new Int32Array(cancellation)
      const result = engine.read(request, context, () => Atomics.load(flag, 0) !== 0)
      if (request.operation === 'snapshot' && expiry) {
        clearTimeout(expiry)
        expiry = undefined
      }
      if (result.type === 'snapshot')
        expiry = setTimeout(
          () => {
            port.postMessage({ type: 'expired' })
            close()
          },
          Math.min(B.ttlMs, engine.expiresIn()),
        )
      port.postMessage({ type: 'read', id, result })
      if (result.type === 'released') close()
    })
    port.on('close', close)
  } catch {
    port.close()
  }
}
