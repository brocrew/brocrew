import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

describe.skipIf(process.platform === 'win32')('person-control socket after a crash', () => {
  async function setup() {
    const f = await fixture()
    const folder = join(f.root, 'person-control')
    await mkdir(folder, { mode: 0o700 })
    return {
      path: join(folder, 'person.sock'),
      start: () =>
        servePersonPluginControl({
          root: f.root,
          key: 'a'.repeat(64),
          controller: f.controller,
          read: async () => null,
        }),
    }
  }
  it('starts over the socket left by a process that exited without closing it', async () => {
    const f = await setup()
    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('node:net').createServer().listen(process.argv[1], () => process.exit(0))",
        f.path,
      ],
      { stdio: 'pipe' },
    )
    const exited = once(child, 'exit')
    closers.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await exited
      }
    })
    expect(await exited).toEqual([0, null])
    expect((await lstat(f.path)).isSocket()).toBe(true)
    const server = await f.start()
    closers.push(() => server.close())
    expect(server.path).toBe(f.path)
    expect((await lstat(f.path)).isSocket()).toBe(true)
  })
  it('refuses to replace a live listener at the fixed path', async () => {
    const f = await setup()
    const incumbent = createServer((socket) => socket.end())
    await new Promise<void>((resolve, reject) => {
      incumbent.once('error', reject)
      incumbent.listen(f.path, resolve)
    })
    closers.push(() => new Promise<void>((resolve) => incumbent.close(() => resolve())))
    const held = await lstat(f.path, { bigint: true })
    await expect(f.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(incumbent.listening).toBe(true)
    expect((await lstat(f.path, { bigint: true })).ino).toBe(held.ino)
  })
})
