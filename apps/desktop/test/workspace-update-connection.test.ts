import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createServer } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import {
  hostGatePath,
  publishWorkspacePresence,
  readWorkspaceForUpdate,
  requestWorkspaceUpdate,
  whoIsOn,
} from '../src/main/one-host-gate'
import type { UpdateWorkspace } from '../src/main/update-workspaces'

const GATE = new URL('../src/main/one-host-gate.ts', import.meta.url).href

const folders: string[] = []
const closers: (() => Promise<void>)[] = []
const releases: (() => void)[] = []
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  for (const close of closers.splice(0)) await close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wu-')))
  folders.push(root)
  const folder = join(root, `workspace-${'x'.repeat(110)}`)
  mkdirSync(folder)
  const outside = { folder: relative(process.cwd(), join(root, 'g')) }
  const peer: UpdateWorkspace = {
    folder,
    pid: 42,
    name: 'Bakery',
    executable: '/BroCrew',
    startedAt: 1,
    ready: true,
    owner: null,
  }
  return { peer, outside }
}

it('uses the existing presence endpoint for metadata and acknowledges only completed preparation', async () => {
  const { peer, outside } = fixture()
  let received = false
  let release!: () => void
  const saved = new Promise<void>((resolve) => {
    release = resolve
  })
  releases.push(release)
  closers.push(
    await publishWorkspacePresence(peer.folder, process.platform, outside, {
      details: () => peer,
      receive: async () => {
        received = true
        await saved
      },
    }),
  )
  expect(await whoIsOn(peer.folder, process.platform, outside)).toBe('open')
  expect(await readWorkspaceForUpdate(peer.folder, process.platform, outside)).toMatchObject(peer)
  let acknowledged = false
  const pending = requestWorkspaceUpdate(
    peer,
    { kind: 'prepare', owner: peer },
    process.platform,
    outside,
  ).then(() => {
    acknowledged = true
  })
  await vi.waitFor(() => expect(received).toBe(true))
  expect(acknowledged).toBe(false)
  release()
  await pending
  expect(acknowledged).toBe(true)
})

it('a legacy live presence reply is not treated as a closed workspace', async () => {
  const { peer, outside } = fixture()
  closers.push(await publishWorkspacePresence(peer.folder, process.platform, outside))
  await expect(readWorkspaceForUpdate(peer.folder, process.platform, outside)).rejects.toThrow(
    'could not prepare',
  )
  expect(await whoIsOn(peer.folder, process.platform, outside)).toBe('open')
})

it('socket EOF without a completion reply is an error, not preparation success', async () => {
  const { peer, outside } = fixture()
  const path = hostGatePath(peer.folder, process.platform, outside)
  if (process.platform !== 'win32') mkdirSync(dirname(path), { recursive: true })
  const server = createServer((socket) => {
    socket.write(`${JSON.stringify({ ...peer, updateProtocol: 1 })}\n`)
    socket.once('data', () => socket.end())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, resolve)
  })
  closers.push(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  await expect(
    requestWorkspaceUpdate(peer, { kind: 'prepare', owner: peer }, process.platform, outside),
  ).rejects.toThrow('closed before acknowledging')
})

/** Blocks this thread, as a busy main process is blocked, without spending the CPU. */
function freeze(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * A workspace in its own process, so it keeps running while this one is frozen. It says who it is
 * `answerAfterMs` after each connection.
 */
async function workspaceElsewhere(
  peer: UpdateWorkspace,
  outside: { folder: string },
  answerAfterMs = 0,
) {
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      `const { publishWorkspacePresence } = await import(${JSON.stringify(GATE)})
const [peer, outside, answerAfterMs] = process.argv.slice(1).map((value) => JSON.parse(value))
await publishWorkspacePresence(peer.folder, process.platform, outside, {
  details: () => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, answerAfterMs)
    return { ...peer, pid: process.pid }
  },
  receive: async () => void process.stdout.write('received\\n'),
})
process.stdout.write('listening\\n')
process.stdin.resume()`,
      JSON.stringify(peer),
      JSON.stringify(outside),
      JSON.stringify(answerAfterMs),
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )
  closers.push(async () => {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
  })
  let said = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => (said += chunk))
  await vi.waitFor(() => expect(said).toContain('listening'), { timeout: 15_000 })
  return { ...peer, pid: child.pid!, said: () => said }
}

it('a 2 s freeze of the updating workspace during the handshake does not fail the update', async () => {
  const { peer, outside } = fixture()
  const elsewhere = await workspaceElsewhere(peer, outside)
  const pending = requestWorkspaceUpdate(
    elsewhere,
    { kind: 'prepare', owner: peer },
    process.platform,
    outside,
  )
  freeze(2_000)
  await expect(pending).resolves.toBeUndefined()
  await vi.waitFor(() => expect(elsewhere.said()).toContain('received'))
}, 30_000)

it('a freeze just before the deadline does not fail a reply that arrived during it', async () => {
  const { peer, outside } = fixture()
  const elsewhere = await workspaceElsewhere(peer, outside, 1_480)
  const pending = requestWorkspaceUpdate(
    elsewhere,
    { kind: 'prepare', owner: peer },
    process.platform,
    outside,
  )
  await new Promise((resolve) => setTimeout(resolve, 1_460))
  freeze(1_000)
  await expect(pending).resolves.toBeUndefined()
  await vi.waitFor(() => expect(elsewhere.said()).toContain('received'))
}, 30_000)

it('a workspace that accepts the connection but never answers is named', async () => {
  const { peer, outside } = fixture()
  const path = hostGatePath(peer.folder, process.platform, outside)
  if (process.platform !== 'win32') mkdirSync(dirname(path), { recursive: true })
  const server = createServer(() => {})
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, resolve)
  })
  closers.push(() => new Promise((resolve) => server.close(() => resolve())))
  await expect(
    requestWorkspaceUpdate(peer, { kind: 'prepare', owner: peer }, process.platform, outside),
  ).rejects.toThrow(`The workspace Bakery (${peer.folder}) did not answer`)
})
