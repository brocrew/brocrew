import { createServer, type Socket } from 'node:net'
import { chmod } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pack, unpack, OWNER_LIMITS } from '../src/main/plugins/supervisor/protocol'
import { localEndpoint, isSocketFile } from '../src/main/plugins/local-endpoint'
import { deferred } from './plugin-lifecycle-fixtures'
import type { PluginCard } from '../src/shared/plugin-settings'

/** Protocol-only peer. Real owner mutation authority is exercised in the owner pair. */
export async function preparedPeer(root: string, digest: string, installed = false) {
  const key = randomBytes(32).toString('hex'),
    path = localEndpoint(join(root, 'client-peer.sock'), 'person', key)
  const sockets = new Set<Socket>(),
    calls: Array<Record<string, unknown>> = []
  let nextFeatureGate:
    | { entered: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> }
    | undefined
  let nextCommitRefusal: string | undefined
  let source = digest,
    offered = digest,
    features = ['contributions-v1', 'authors-v1', 'prepared-mutations-v1']
  let card: PluginCard = {
    id: 'chrome',
    name: 'Fictional browser',
    installed,
    state: installed ? 'Running' : 'Available',
    ...(installed ? { installedVersion: '1.0.1', updateVersion: '1.0.2' } : {}),
  }
  function reply(input: Record<string, unknown>) {
    calls.push(input)
    switch (input.kind) {
      case 'attach':
        return { personProtocol: 2 }
      case 'features':
        return { features }
      case 'configure-ledger':
        return { format: 2, maxRevision: Number.MAX_SAFE_INTEGER }
      case 'list':
      case 'list-v2':
        return [card]
      case 'mutation-policy':
      case 'mutation-status':
        if (input.catalogueDigest !== source) throw new Error('source-mismatch')
        return { format: 1, catalogueDigest: source }
      case 'prepare-mutation':
        return { preparation: randomUUID() }
      case 'install-prepared':
      case 'update-prepared':
        if (nextCommitRefusal) {
          const code = nextCommitRefusal
          nextCommitRefusal = undefined
          throw new Error(code)
        }
        card = { ...card, installed: true, state: 'Running', installedVersion: '1.0.2' }
        return true
      case 'install':
      case 'update':
        return true
      case 'uninstall':
        card = { ...card, installed: false, state: 'Available' }
        return true
      case 'refresh':
        if (input.catalogueDigest !== offered) throw new Error('source-mismatch')
        source = offered
        return true
      case 'detach':
        return true
      default:
        throw new Error('incompatible')
    }
  }
  const server = createServer((socket) => {
    sockets.add(socket)
    const challenge = randomBytes(32).toString('hex')
    let input = '',
      received = 0,
      sent = 0
    socket.setEncoding('utf8')
    socket.write(challenge + '\n')
    socket.on('error', () => socket.destroy())
    socket.on('close', () => sockets.delete(socket))
    socket.on('data', (data) => {
      input += String(data)
      if (Buffer.byteLength(input) > OWNER_LIMITS.packet * 4) return socket.destroy()
      let end: number
      while ((end = input.indexOf('\n')) !== -1) {
        const line = input.slice(0, end + 1)
        input = input.slice(end + 1)
        try {
          const frame = unpack(key, 'request', line) as {
            challenge: string
            sequence: number
            packet: { kind: string; id: string; value: Record<string, unknown> }
          }
          if (
            frame.challenge !== challenge ||
            frame.sequence !== ++received ||
            frame.packet.kind !== 'call'
          )
            throw new Error('invalid frame')
          const gate = frame.packet.value.kind === 'features' ? nextFeatureGate : undefined
          if (gate) nextFeatureGate = undefined
          let ok = true,
            value: unknown
          try {
            value = reply(frame.packet.value)
          } catch (error) {
            ok = false
            value = { pluginRefusal: (error as Error).message }
          }
          void Promise.resolve()
            .then(async () => {
              if (gate) {
                gate.entered.resolve()
                await gate.release.promise
              }
              if (!socket.destroyed)
                socket.write(
                  pack(key, 'response', {
                    challenge,
                    sequence: ++sent,
                    packet: { kind: 'reply', id: frame.packet.id, ok, value },
                  }),
                )
            })
            .catch(() => socket.destroy())
        } catch {
          socket.destroy()
        }
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  if (isSocketFile()) await chmod(path, 0o600)
  return {
    key,
    path,
    calls,
    pauseFeatures() {
      const gate = { entered: deferred<void>(), release: deferred<void>() }
      nextFeatureGate = gate
      return gate
    },
    refuseNextCommit() {
      nextCommitRefusal = 'policy-refused'
    },
    changeSource(value: string) {
      source = value
    },
    offer(value: string) {
      offered = value
    },
    setFeatures(value: string[]) {
      features = value
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
