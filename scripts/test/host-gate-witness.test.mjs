import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { witnessGate } from '../lib/host-gate-witness.mjs'
import { GATE_SOCKET, smokeTmpRoot } from '../lib/smoke-run.mjs'

/**
 * Tests the host-gate witness against the failures it exists to catch. Those are silent: the gate
 * fails open, so an app whose gate never bound looks like one whose gate holds the directory.
 * So the tests here are the negative ones, each a state a live smoke has been in: no socket at
 * all, a path over `sun_path`, and a name whose listener is gone (the normal state of every POSIX
 * launch after the first, per `one-host-gate.ts`).
 *
 * A real listener, not a mock: the claim is about a UNIX socket and a token on the wire, and a
 * stubbed `connect` would assert nothing about the kernel behaviour the mechanism rests on.
 */
const dirs = []

/**
 * Under `/tmp` and short, because a socket path over the limit cannot be bound to test with.
 * A base of this file's own: `smoke-run.test.mjs` runs in a parallel fork and removes what its
 * `afterEach` is given, so a shared base let its teardown delete the directory this file holds a
 * live listener in.
 */
const BASE = 'b2t-wit'

function scratch() {
  const dir = mkdtempSync(join(smokeTmpRoot(BASE), 'w'))
  dirs.push(dir)
  return dir
}

function serve(dir, token) {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.end(token)
      socket.on('error', () => {})
    })
    server.listen(join(dir, GATE_SOCKET), () => resolve(server))
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// These tests bind Unix-domain socket files; Windows uses a named pipe instead.
describe.skipIf(process.platform === 'win32')('242 · witnessing the one-host gate', () => {
  it('⛔ returns the token a live gate answers with', async () => {
    const dir = scratch()
    const server = await serve(dir, 'a0740937-ee41-4744-8709-3069875e0e63')
    try {
      const seen = await witnessGate(dir)
      expect(seen.token).toBe('a0740937-ee41-4744-8709-3069875e0e63')
      expect(seen.socket).toBe(join(dir, GATE_SOCKET))
    } finally {
      server.close()
    }
  })

  it('🔴 fails when nothing bound — the state every smoke ran in from 236 to 242', async () => {
    const dir = scratch()
    await expect(witnessGate(dir, { waitMs: 300 })).rejects.toThrow(
      /no gate socket at .*double-launch backstop switched off/s,
    )
  })

  it('🔴 fails on a STALE name, which a plain existsSync would have called success', async () => {
    const dir = scratch()
    // Built the way the gate builds it: bind a private name, hard-link it to the public one. That is
    // what makes this reproducible: Node's `server.close()` unlinks the name it bound, so an ordinary
    // close leaves nothing behind; only the link, which no `close` knows about, leaves the artefact.
    // This is the shape `one-host-gate.ts` calls "the normal state of every launch after the first".
    const mine = join(dir, '.oh-test')
    const server = await new Promise((resolve) => {
      const made = createServer((socket) => socket.end('a0740937-ee41-4744-8709-3069875e0e63'))
      made.listen(mine, () => resolve(made))
    })
    linkSync(mine, join(dir, GATE_SOCKET))
    await new Promise((resolve) => server.close(resolve))

    await expect(witnessGate(dir, { waitMs: 500 })).rejects.toThrow(
      /exists but nothing answers on it/,
    )
  })

  it('⛔ fails when something else owns the name and does not speak our token', async () => {
    const dir = scratch()
    const server = await serve(dir, 'hello')
    try {
      await expect(witnessGate(dir)).rejects.toThrow(/which is not the UUID/)
    } finally {
      server.close()
    }
  })

  it('🔴 says the gate was never ABLE to run when the path is over sun_path', async () => {
    // A different sentence from "it did not answer", deliberately: the same `ENOENT` means "the app
    // never ran" and "no name of this length can exist", and only one is a product failure.
    const dir = join(smokeTmpRoot(BASE), 'x'.repeat(120))
    await expect(witnessGate(dir)).rejects.toThrow(/was never able\s+to run/)
  })

  it('⛔ a regular FILE at the name is not a gate', async () => {
    const dir = scratch()
    writeFileSync(join(dir, GATE_SOCKET), 'not a socket')
    // A short deadline, because the witness retries the answer until `waitMs`: a relaunch onto a
    // reused `userData` meets the previous app's stale path while the new one re-claims it, so the
    // cases that never get an answer take the whole budget by design.
    await expect(witnessGate(dir, { waitMs: 500 })).rejects.toThrow(
      /exists but nothing answers on it/,
    )
  })
})
