import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { connectPersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { localEndpoint } from '../src/main/plugins/local-endpoint'

// A refused plugin connection keeps its typed code and carries the real reason as its cause.
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const one of cleanup.splice(0).reverse()) await one()
})
async function folder() {
  const root = await mkdtemp(join(tmpdir(), 'fictional-channel-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  return root
}

it('a failed connect names the endpoint and keeps the socket error as its cause', async () => {
  const path = join(await folder(), 'person.sock')
  const error = await connectPersonPluginControl({
    path,
    key: 'a'.repeat(64),
    handle: async () => null,
  }).catch((one: unknown) => one)
  expect(error).toMatchObject({ code: 'unavailable', message: 'Plugin unavailable. Try again.' })
  const text = inspect(error, { depth: 8 })
  expect(text).toContain('could not connect to the plugin service at')
  expect(text).toMatch(/ENOENT|ECONNREFUSED/)
})

it('a call on a channel the service closes is refused with that close as its cause', async () => {
  const path = join(await folder(), 'person.sock')
  const endpoint = localEndpoint(path, 'person', 'b'.repeat(64))
  const server: Server = createServer((socket) => {
    socket.once('data', () => socket.destroy())
  })
  await new Promise<void>((resolve) => server.listen(endpoint, resolve))
  cleanup.push(() => new Promise((resolve) => server.close(resolve)))
  const channel = await connectPersonPluginControl({
    path,
    key: 'b'.repeat(64),
    handle: async () => null,
  })
  const error = await channel.call({ kind: 'features' }).catch((one: unknown) => one)
  expect(error).toMatchObject({ code: 'unavailable' })
  expect(inspect(error, { depth: 8 })).toContain('the other side closed the plugin channel')
  // A later call on the closed channel carries the same reason.
  const later = await channel.call({ kind: 'features' }).catch((one: unknown) => one)
  expect(inspect(later, { depth: 8 })).toContain('the other side closed the plugin channel')
})
