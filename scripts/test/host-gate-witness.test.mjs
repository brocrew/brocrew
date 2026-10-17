import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { witnessGate } from '../lib/host-gate-witness.mjs'
import { GATE_SOCKET, smokeTmpRoot } from '../lib/smoke-run.mjs'

/**
 * ⛔ **The instrument 242 §1 was asked for, tested against the thing it is meant to catch.**
 *
 * 🔴 **The failure it exists for is a SILENT one**: `236` §3's gate fails open, so an app whose gate
 * never bound looks exactly like an app whose gate is holding the directory — same window, same
 * database, same 96/98. ⚠️ **So the only tests worth writing here are the negative ones**, and each
 * of them is a state a live smoke has actually been in: no socket at all (every run from 236 to
 * 242), a path over `sun_path` (the same runs, one layer down), and a name whose listener is gone
 * (every POSIX launch after the first, which is the case `one-host-gate.ts` says is *"the normal
 * state"*).
 *
 * ⚑ **A real listener, not a mock.** The claim is about a UNIX socket and a token on the wire; a
 * stubbed `connect` would assert the shape of this file's own code and nothing about the kernel
 * behaviour the whole mechanism rests on.
 */
const dirs = []

/**
 * ⚠️ Under `/tmp` and short, because a socket path over the limit cannot be bound to test with.
 *
 * ⛔ **A base of this FILE's own** (242, adversarial pass): `smoke-run.test.mjs` runs in a parallel
 * fork and removes what its own `afterEach` is given, so sharing a base meant one file's teardown
 * could delete the directory this one is holding a live listener in.
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
    // ⚑ **Built the way the gate builds it** — bind a private name, hard-link it to the public one —
    // and that detail is what makes this reproducible at all. Node's `server.close()` UNLINKS the
    // name it bound, so a socket closed the ordinary way leaves nothing behind; what leaves the
    // artefact is the link, which no `close` knows about. ⛔ **That is precisely the shape
    // `one-host-gate.ts` calls "the normal state of every launch after the first".**
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
    // ⚠️ **A different sentence from "it did not answer", deliberately.** 241 §3 spent a dispatch on
    // exactly this confusion: the same `ENOENT` means "the app never ran" and "no name of this
    // length can exist", and only one of them is a product failure.
    const dir = join(smokeTmpRoot(BASE), 'x'.repeat(120))
    await expect(witnessGate(dir)).rejects.toThrow(/was never able\s+to run/)
  })

  it('⛔ a regular FILE at the name is not a gate', async () => {
    const dir = scratch()
    writeFileSync(join(dir, GATE_SOCKET), 'not a socket')
    // ⚠️ **A short deadline, because the witness RETRIES the answer** (242, adversarial pass). It
    // keeps asking until `waitMs` for the reason its own comment gives — a relaunch onto a reused
    // `userData` meets the previous app's stale path while the new one is still re-claiming it — so
    // the cases that never get an answer take the whole budget by design.
    await expect(witnessGate(dir, { waitMs: 500 })).rejects.toThrow(
      /exists but nothing answers on it/,
    )
  })
})
