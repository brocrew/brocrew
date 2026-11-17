import { renameSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { join } from 'node:path'

/**
 * A proxy in front of the plugin service's socket. Each reply can be lost (the connection is
 * closed), held back (never sent), or sent after this whole process stalled for `stall` ms.
 * `beforeChallenge` runs before the service's challenge is passed on.
 */
export async function interpose(root: string) {
  const path = join(root, 'supervisor/owner.sock'),
    aside = join(root, 'supervisor/owner-aside.sock')
  renameSync(path, aside)
  const requests: string[] = [],
    replies: string[] = [],
    plan: { lose: number; hold: number; stall: number; beforeChallenge?: () => void } = {
      lose: 0,
      hold: 0,
      stall: 0,
    },
    count = { settled: 0 }
  const server = createServer((client) => {
    const owner = createConnection(aside)
    let challenged = false,
      replied = false
    client.on('error', () => owner.destroy())
    // The client closes only after it has acted on the reply it read.
    client.on('close', () => {
      owner.destroy()
      if (replied) count.settled++
    })
    owner.on('error', () => client.destroy())
    client.on('data', (chunk: Buffer) => {
      requests.push(chunk.toString())
      owner.write(chunk)
    })
    owner.on('data', (chunk: Buffer) => {
      if (!challenged) {
        challenged = true
        plan.beforeChallenge?.()
        client.write(chunk)
        return
      }
      if (plan.lose > 0) {
        plan.lose--
        client.destroy()
      } else if (plan.hold > 0) plan.hold--
      else {
        if (plan.stall > 0) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, plan.stall)
          plan.stall = 0
        }
        replies.push(chunk.toString())
        replied = true
        client.end(chunk)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  return {
    aside,
    requests,
    replies,
    plan,
    count,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      renameSync(aside, path)
    },
  }
}
