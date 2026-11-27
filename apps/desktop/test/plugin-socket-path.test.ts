import { afterEach, describe, expect, it } from 'vitest'
import { createConnection, createServer } from 'node:net'
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ensureSocketFolder,
  pluginSocketPath,
  pluginSocketsPlaceable,
  SOCKET_PATH_BYTES,
} from '../src/main/plugins/socket-path'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import type { OwnerRecord } from '../src/main/plugins/supervisor/protocol'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp('/tmp/fictional-socket-'))
  roots.push(root)
  return root
}
const cache = '/var/folders/zz/fictional0000gn/C'
/** A fictional root whose owner socket path is exactly this many bytes. */
const rootFor = (bytes: number) =>
  '/Users/' + 'r'.repeat(bytes - '/Users/'.length - '/supervisor/owner.sock'.length)

describe('where the plugin service sockets live', () => {
  it('keeps the path under the root whenever it fits, as earlier versions expect', () => {
    for (const bytes of [40, 85, SOCKET_PATH_BYTES]) {
      const root = rootFor(bytes)
      for (const platform of ['darwin', 'linux'] as const) {
        expect(pluginSocketPath(root, 'supervisor', 'owner.sock', platform, () => cache)).toBe(
          join(root, 'supervisor', 'owner.sock'),
        )
      }
    }
  })
  it('moves a socket that would not fit to a short folder for that root in the user cache', () => {
    const root = rootFor(SOCKET_PATH_BYTES + 1)
    const owner = pluginSocketPath(root, 'supervisor', 'owner.sock', 'darwin', () => cache)
    const person = pluginSocketPath(root, 'person-control', 'person.sock', 'darwin', () => cache)
    expect(owner).toMatch(/^\/var\/folders\/zz\/fictional0000gn\/C\/brocrew-plugins-[0-9a-f]{16}\//)
    expect(person).toBe(join(owner, '..', 'person.sock'))
    const deep = rootFor(400)
    const far = pluginSocketPath(deep, 'supervisor', 'owner.sock', 'darwin', () => cache)
    expect(Buffer.byteLength(far)).toBeLessThanOrEqual(SOCKET_PATH_BYTES)
    expect(far).not.toBe(owner)
    expect(pluginSocketPath(deep, 'supervisor', 'owner.sock', 'darwin', () => cache)).toBe(far)
  })
  it('keeps the path under the root when the temp folder is not macOS’s own', () => {
    const long = rootFor(SOCKET_PATH_BYTES + 1)
    expect(pluginSocketPath(long, 'supervisor', 'owner.sock', 'darwin', () => undefined)).toBe(
      join(long, 'supervisor', 'owner.sock'),
    )
  })
  it('can place the sockets of any root on macOS, and of roots that fit elsewhere', () => {
    const long = rootFor(SOCKET_PATH_BYTES + 1)
    expect(pluginSocketsPlaceable(long, 'darwin', () => cache)).toBe(true)
    expect(pluginSocketsPlaceable(long, 'darwin', () => undefined)).toBe(false)
    expect(pluginSocketsPlaceable(long, 'linux', () => cache)).toBe(false)
    expect(pluginSocketsPlaceable(rootFor(SOCKET_PATH_BYTES - 5), 'linux')).toBe(true)
  })
  it('moves each socket on its own: the person socket can move while the owner socket stays', () => {
    const root = rootFor(SOCKET_PATH_BYTES - 2)
    expect(pluginSocketPath(root, 'supervisor', 'owner.sock', 'darwin', () => cache)).toBe(
      join(root, 'supervisor', 'owner.sock'),
    )
    expect(pluginSocketPath(root, 'person-control', 'person.sock', 'darwin', () => cache)).toMatch(
      /\/brocrew-plugins-[0-9a-f]{16}\/person\.sock$/,
    )
  })
})

describe.skipIf(process.platform === 'win32')('the short socket folder', () => {
  it('is created with access for this user only', async () => {
    const parent = await temporary()
    const socket = join(parent, 'brocrew-plugins-0123456789abcdef', 'owner.sock')
    ensureSocketFolder('/fictional/root', socket)
    const stat = await lstat(join(parent, 'brocrew-plugins-0123456789abcdef'))
    expect(stat.isDirectory()).toBe(true)
    expect(stat.mode & 0o777).toBe(0o700)
    ensureSocketFolder('/fictional/root', socket)
  })
  it('is not used when the socket stays under the root', async () => {
    const root = await temporary()
    ensureSocketFolder(root, join(root, 'supervisor', 'owner.sock'))
    await expect(lstat(join(root, 'supervisor'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe.skipIf(process.platform === 'win32')('an older service already running', () => {
  it('is reached at the path it listens on, under the root', async () => {
    const parent = await temporary()
    const workspace = join(parent, 'workspace')
    await mkdir(workspace, { mode: 0o700 })
    const root = join(parent, 'plugins')
    await mkdir(join(root, 'supervisor'), { recursive: true, mode: 0o700 })
    const older = createServer((socket) => socket.end('older service'))
    await new Promise<void>((resolve) =>
      older.listen(join(root, 'supervisor', 'owner.sock'), resolve),
    )
    try {
      const storage = new SupervisorStorage(root, [workspace], false)
      const endpoint = storage.endpoint({ epoch: crypto.randomUUID() } as OwnerRecord)
      storage.close()
      expect(endpoint).toBe(join(root, 'supervisor', 'owner.sock'))
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = createConnection(endpoint)
        let text = ''
        socket.on('data', (chunk) => (text += chunk))
        socket.on('end', () => resolve(text))
        socket.on('error', reject)
      })
      expect(reply).toBe('older service')
    } finally {
      await new Promise((resolve) => older.close(resolve))
    }
  })
})
