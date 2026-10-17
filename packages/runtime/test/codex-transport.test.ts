import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type SpawnCodexOptions,
} from '../src/codex/codex-transport'
import { readTable, type TableReading } from '../src/codex/windows-tree'
import { buildChildEnv } from '../src/internal/child-env'

/**
 * Direct unit tests for the hardened {@link SpawnCodexTransport} (012, fixing
 * 007 P1-5). These spawn a real `node` child (always present at
 * `process.execPath`) scripted to reproduce each defect: stderr backpressure,
 * spawn error, exit races, split/partial framing, and a surviving descendant.
 * The transport class previously had NO direct tests.
 */

const NODE = process.execPath

// Emits notifications framed adversarially: two-per-chunk, split across chunks,
// non-JSON noise interleaved, then a response to request id 1. Stays alive.
const FRAMING = `
const chunks = [
  '{"method":"a","params":1}\\n{"method":"b","params":2}\\n',
  '{"method":"c","par',
  'ams":3}\\n',
  'not-json-noise-line\\n',
  '{"id":1,"result":{"ok":true}}\\n',
];
let i = 0;
const tick = () => { if (i < chunks.length) { process.stdout.write(chunks[i++]); setTimeout(tick, 5); } };
tick();
setInterval(() => {}, 100000);
`

// Writes 10 MiB to stderr SYNCHRONOUSLY (blocks the child if the pipe is never
// drained) BEFORE the JSON response — the classic P1-5 deadlock.
const STDERR_PRESSURE = `
const fs = require('fs');
const big = Buffer.alloc(256 * 1024, 120);
for (let i = 0; i < 40; i++) fs.writeSync(2, big);
fs.writeSync(1, '{"id":1,"result":{"ok":true}}\\n');
setInterval(() => {}, 100000);
`

// Spawns a (non-detached) grandchild in the child's own group, reports its pid,
// then stays alive so teardown must reach the whole group.
const DESCENDANT = `
const { spawn } = require('child_process');
const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 100000)'], { stdio: 'ignore' });
process.stdout.write(JSON.stringify({ method: 'grandchild', params: { pid: g.pid } }) + '\\n');
setInterval(() => {}, 100000);
`

// Spawns a grandchild in the leader's group, reports its pid, then the LEADER EXITS
// UNEXPECTEDLY — the grandchild survives and must be reaped by the terminal transition (031).
const CRASH_DESCENDANT = `
const { spawn } = require('child_process');
const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 100000)'], { stdio: 'ignore' });
process.stdout.write(JSON.stringify({ method: 'grandchild', params: { pid: g.pid } }) + '\\n');
setTimeout(() => process.exit(0), 100);
`

const STAY_ALIVE = 'setInterval(() => {}, 100000)'

// Echoes the child's own view of the provider-home + auth env as a notification,
// then stays alive — proves what the parent forwarded (021).
const ENV_ECHO = `
process.stdout.write(JSON.stringify({ method: 'env', params: {
  codexHome: process.env.CODEX_HOME ?? null,
  sqlite: process.env.CODEX_SQLITE_HOME ?? null,
  openaiKey: process.env.OPENAI_API_KEY ?? null,
  githubToken: process.env.GITHUB_TOKEN ?? null,
  awsSecret: process.env.AWS_SECRET_ACCESS_KEY ?? null,
  path: process.env.PATH ? 'present' : 'absent',
} }) + '\\n');
setInterval(() => {}, 100000);
`

/**
 * Fast teardown, plus **the ambient environment asked for out loud** (063, from 061 finding 4).
 *
 * `env` is required on the constructor now, and `process.env` here is not boilerplate — these
 * scripts run under `process.execPath` and read `process.env.PATH`, so they genuinely want what the
 * test runner has. The point of the change is that they now have to SAY so: the call site is where a
 * reviewer can see that a spawn inherits, instead of it being what happens when nobody writes
 * anything. One test below deliberately passes a sanitized env instead, and the contrast is the
 * assertion.
 */
const fast = {
  exitGraceMs: 300,
  killGraceMs: 300,
  stderrTailBytes: 2048,
  env: process.env,
}

/** Register unconditional teardown so a failed assertion can't orphan a detached child. */
function track(t: SpawnCodexTransport): SpawnCodexTransport {
  onTestFinished(async () => {
    await t.close() // memoized: a no-op if the test already closed it
  })
  return t
}

function makeTransport(script: string): SpawnCodexTransport {
  return track(new SpawnCodexTransport(NODE, ['-e', script], fast))
}

/**
 * The `pid` Node itself still holds, reached around the getter (074).
 *
 * Reaching past a private field is normally a smell; here it is the point. The defect was a comment
 * asserting a fact about Node that was false, and the only way to keep a fix honest is to keep
 * asserting the premise it corrects — so this reads the raw child, not the disclosure built from it.
 */
function rawChildPid(transport: SpawnCodexTransport): number | undefined {
  return (transport as unknown as { child: { pid?: number } }).child.pid
}

/** Consume incoming() in the background; returns the sink + a completion promise. */
function drain(t: SpawnCodexTransport): { items: CodexIncoming[]; done: Promise<void> } {
  const items: CodexIncoming[] = []
  const done = (async () => {
    for await (const m of t.incoming()) items.push(m)
  })()
  return { items, done }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntil(pred: () => boolean, label = 'condition', ms = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('SpawnCodexTransport — robust framing', () => {
  it('handles split / partial / multiple-per-chunk lines and ignores non-JSON', async () => {
    const t = makeTransport(FRAMING)
    const { items, done } = drain(t)
    const res = await t.request('ping', {}) // id 1 → the scripted response
    expect(res).toEqual({ ok: true })
    // The answer's size, counted as its line arrived; nothing for a method never asked.
    expect(t.responseBytes('ping')).toBe(Buffer.byteLength('{"id":1,"result":{"ok":true}}'))
    expect(t.responseBytes('thread/resume')).toBeUndefined()
    await waitUntil(
      () => items.filter((m) => m.kind === 'notification').length >= 3,
      '3 notifications',
    )
    expect(
      items.filter((m) => m.kind === 'notification').map((m) => (m as { method: string }).method),
    ).toEqual(['a', 'b', 'c'])
    await t.close()
    await done
  }, 15000)
})

describe('SpawnCodexTransport — stderr never backpressures the response path', () => {
  it('resolves the request despite 10 MiB of stderr written before the response', async () => {
    const t = makeTransport(STDERR_PRESSURE)
    const { done } = drain(t)
    const res = await t.request('ping', {}) // hangs forever pre-fix (stderr not drained)
    expect(res).toEqual({ ok: true })
    await t.close()
    await done
  }, 15000)
})

describe('SpawnCodexTransport — one terminal transition (no un-settled request, incoming closes)', () => {
  it('spawn error rejects pending requests and closes incoming()', async () => {
    const t = track(new SpawnCodexTransport('brobot-nonexistent-binary-xyz', [], fast))
    const reqP = t.request('ping', {})
    await expect(reqP).rejects.toThrow()
    const items: CodexIncoming[] = []
    for await (const m of t.incoming()) items.push(m) // must COMPLETE, not hang
    expect(items).toEqual([])
    await t.close()
  }, 15000)

  it('stops reporting a PID once the child is gone (074, from 069 §2.2)', async () => {
    const t = makeTransport(STAY_ALIVE)
    const alive = t.pid
    expect(typeof alive).toBe('number')

    await t.close()

    // ⚠️ **The non-vacuity line, and the whole reason this fix exists.** The comment above the
    // getter used to claim Node clears `pid` after exit, so a dead child "cannot keep reporting a
    // stale number". It does not clear it — measured on v20/v22/v24 and on the v24.18 that Electron
    // 43 runs the main process on — and this asserts the false premise directly. If Node ever DID
    // start clearing it, this line fails and the comment gets corrected again rather than the fix
    // quietly becoming untested.
    expect(rawChildPid(t), 'Node still holds the pid of an exited child').toBe(alive)
    // What the header is built from, which is the fact that had to change.
    expect(t.pid).toBeUndefined()
  }, 15000)

  it('reports no PID for a spawn that never produced a process (074)', async () => {
    const t = track(new SpawnCodexTransport('brobot-nonexistent-binary-xyz', [], fast))
    await expect(t.request('ping', {})).rejects.toThrow()
    expect(t.pid).toBeUndefined()
    await t.close()
  }, 15000)

  it('a request made after the child exits rejects (never hangs)', async () => {
    const t = makeTransport('process.exit(0)')
    // incoming() completes once the child exits and the transport terminates.
    for await (const _m of t.incoming()) void _m
    await expect(t.request('ping', {})).rejects.toThrow()
    await t.close()
  }, 15000)

  it('close() rejects pending requests and returns within the bounded window', async () => {
    const t = makeTransport(STAY_ALIVE)
    const reqP = t.request('never-answered', {})
    const closeP = t.close()
    await expect(reqP).rejects.toThrow()
    await closeP // resolves within exitGrace+killGrace even though the child ignores stdin
  }, 15000)

  it('write after close throws (never a silent never-settle)', async () => {
    const t = makeTransport(STAY_ALIVE)
    await t.close()
    expect(() => t.notify('x', {})).toThrow()
    expect(() => t.respond(1, {})).toThrow()
    expect(() => t.respondError(1, -1, 'x')).toThrow()
    await expect(t.request('x', {})).rejects.toThrow()
  }, 15000)
})

describe('SpawnCodexTransport — forwards the sanitized allow-list child env (021 / 026)', () => {
  it('spawns the child with CODEX_HOME pinned, PATH kept, and every ambient secret dropped', async () => {
    // End-to-end hostile-ambient (026): the exact env the adapter builds — CODEX_HOME/
    // SQLITE pinned, but the ambient OPENAI_API_KEY / GITHUB_TOKEN / AWS_SECRET_ACCESS_KEY
    // dropped by the allow-list — must be what the child actually sees.
    const env = buildChildEnv(
      { CODEX_HOME: '/profile/codex', CODEX_SQLITE_HOME: '/profile/codex' },
      {
        ...process.env,
        OPENAI_API_KEY: 'sk-should-not-leak',
        GITHUB_TOKEN: 'ghp-should-not-leak',
        AWS_SECRET_ACCESS_KEY: 'aws-should-not-leak',
      },
    )
    const t = track(new SpawnCodexTransport(NODE, ['-e', ENV_ECHO], { ...fast, env }))
    let seen:
      | {
          codexHome: unknown
          sqlite: unknown
          openaiKey: unknown
          githubToken: unknown
          awsSecret: unknown
          path: unknown
        }
      | undefined
    for await (const m of t.incoming()) {
      if (m.kind === 'notification' && m.method === 'env') {
        seen = m.params as typeof seen
        break
      }
    }
    expect(seen?.codexHome).toBe('/profile/codex')
    expect(seen?.sqlite).toBe('/profile/codex')
    expect(seen?.openaiKey).toBeNull() // allow-list dropped it before spawn
    expect(seen?.githubToken).toBeNull() // an unrelated ambient secret — also dropped
    expect(seen?.awsSecret).toBeNull()
    expect(seen?.path).toBe('present') // essentials kept so the child can run
    await t.close()
  }, 15000)
})

describe('SpawnCodexTransport — owns the process tree', () => {
  it('close() kills the process group so a descendant does not survive', async () => {
    const t = makeTransport(DESCENDANT)
    let gpid = 0
    for await (const m of t.incoming()) {
      if (m.kind === 'notification' && m.method === 'grandchild') {
        gpid = (m.params as { pid: number }).pid
        break
      }
    }
    expect(gpid).toBeGreaterThan(0)
    expect(isAlive(gpid)).toBe(true)
    await t.close()
    await waitUntil(() => !isAlive(gpid), 'grandchild reaped', 3000)
    expect(isAlive(gpid)).toBe(false)
  }, 15000)

  it('reaps the group on an UNEXPECTED leader exit (crash path), not only explicit close() (031 P1-E)', async () => {
    const t = track(new SpawnCodexTransport(NODE, ['-e', CRASH_DESCENDANT], fast))
    let gpid = 0
    for await (const m of t.incoming()) {
      if (m.kind === 'notification' && m.method === 'grandchild') {
        gpid = (m.params as { pid: number }).pid
        break
      }
    }
    expect(gpid).toBeGreaterThan(0)
    expect(isAlive(gpid)).toBe(true)
    // The leader exits on its own — NO explicit close() here. The transport's terminal
    // transition (onExit → terminate → reapGroup) must reap the group within the bounded
    // window. Pre-fix: the group kill only ran on close(), so the descendant is orphaned.
    await waitUntil(() => !isAlive(gpid), 'grandchild reaped after unexpected leader exit', 5000)
    expect(isAlive(gpid)).toBe(false)
  }, 15000)

  it('an unexpected exit then a later close() is idempotent (one bounded teardown, no throw)', async () => {
    const t = makeTransport('process.exit(0)') // leader exits immediately → terminate + reapGroup
    for await (const _m of t.incoming()) void _m // drain until the transport terminates
    await expect(t.close()).resolves.toBeUndefined() // close after crash: awaits the SAME reap, no double-kill/throw
  }, 15000)
})

describe('the spawn transport exposes its child PID (076)', () => {
  it('reports the real spawned PID through the sanctioned accessor', async () => {
    // The PID must be one we can PROVE owns this session — read from the child we spawned, never
    // matched by `pgrep` (several app-servers can be running) and never a private-field reach.
    const transport = makeTransport('setTimeout(() => {}, 10_000)')
    expect(typeof transport.pid).toBe('number')
    expect(transport.pid).toBeGreaterThan(0)
    await transport.close()
  })
})

/**
 * 🔒 **The raw transport cannot inherit ambient credentials by omission** (063, from 061 finding 4).
 *
 * The safe boundary used to live one level up. `createSpawnTransportFactory` sanitizes the child
 * environment and pins the profile home, but the class it wraps took `env` as an OPTIONAL field, and
 * omitting it handed the `app-server` — and every tool Codex launches beneath it — the desktop app's
 * entire `process.env`. A consumer who reasonably imported the transport got the unsafe spawn by
 * writing nothing at all, which is the wrong way round: the dangerous choice should cost more
 * keystrokes than the safe one, not fewer.
 *
 * Two halves, and they close different doors. Requiring `env` is the enforcement — it binds every
 * caller including the relative imports inside this package, which no export list can reach.
 * Withdrawing the class from `src/index.ts` is the smaller half: it stops the package ADVERTISING a
 * lower-level way to do what the factory already does safely.
 */
describe('the transport spawn environment is required, not defaulted (063)', () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), 'utf8')

  it('declares env as required and passes it unconditionally', () => {
    const src = read('../src/codex/codex-transport.ts')
    // Required in the type is what a compiler can enforce at every call site.
    expect(src).toMatch(/^\s*env: NodeJS\.ProcessEnv$/m)
    expect(src, 'an optional env is the defect itself').not.toMatch(/env\?: NodeJS\.ProcessEnv/)
    // …and there is no branch left that could fall back to the ambient environment. The old line was
    // `...(options.env ? { env: options.env } : {})` — a spread that spawns with inherited env when
    // the field is absent, which is precisely what "absent" must no longer be able to mean.
    expect(src).toMatch(/^\s*env: options\.env,$/m)
    expect(src).not.toMatch(/\.\.\.\(options\.env/)
  })

  it('is not advertised as public API — the sanitizing factory is', () => {
    const index = read('../src/index.ts')
    expect(index, 'the raw spawning class is internal now').not.toMatch(
      /^\s*SpawnCodexTransport,$/m,
    )
    // The supported route out of the package, and the interface a consumer needs to supply their
    // own, both stay: withdrawing the class is about which path is the ordinary one.
    expect(index).toMatch(/createSpawnTransportFactory/)
    expect(index).toMatch(/export type \{ CodexTransport, CodexIncoming \}/)
  })

  it('inheritance is still possible — but only by asking for it out loud', async () => {
    // The mirror of the sanitize test above, and the point of the whole change. A caller that
    // genuinely wants the ambient environment can still have it; what they cannot do is get it by
    // saying nothing. The secret below reaches the child because this call site ASKED, and that is
    // the difference a reviewer can see.
    const t = track(
      new SpawnCodexTransport(NODE, ['-e', ENV_ECHO], {
        ...fast,
        env: { ...process.env, OPENAI_API_KEY: 'sk-inherited-on-purpose' },
      }),
    )
    let seen: { openaiKey: unknown; path: unknown } | undefined
    for await (const m of t.incoming()) {
      if (m.kind === 'notification' && m.method === 'env') {
        seen = m.params as typeof seen
        break
      }
    }
    expect(seen?.openaiKey).toBe('sk-inherited-on-purpose')
    expect(seen?.path).toBe('present')
    await t.close()
  }, 15000)
})

/**
 * 180 §3 — what a user is told when the child dies during its own startup.
 *
 * ⛔ **`failed to initialize sqlite state runtime` reached the launcher verbatim**, wrapped in
 * `codex app-server exited (stderr tail: …)`, as the entire response to a first message. Both
 * directions are asserted here, and the second is the one that keeps this honest: recognising one
 * failure must not turn every other one into a guess.
 */
describe('the app says the one startup failure it can recognise (180)', () => {
  /** The real stderr, verbatim from a losing app-server in 180's reproduction. */
  const SQLITE_DEATH = String.raw`
const fs = require('fs');
fs.writeSync(2, 'Error: failed to initialize sqlite state runtime under /tmp/profile/codex: failed to initialize state runtime at /tmp/profile/codex\n');
process.exit(1);
`

  const OTHER_DEATH = String.raw`
const fs = require('fs');
fs.writeSync(2, 'thread panicked at library/std/src/mystery.rs\n');
process.exit(3);
`

  /**
   * ⛔ **The home has a SPACE in it, deliberately.** On macOS `app.getPath('userData')` is
   * `~/Library/Application Support/<app>`, so every real provider home carries one — and the first
   * version of this message scraped the path out of the child's stderr with `\S+`, which would have
   * shown a user `/Users/…/Library/Application` and stopped. The path in the message is the one the
   * transport itself pinned, and this fixture is what says so.
   */
  const REAL_SHAPED_HOME =
    '/Users/x/Library/Application Support/brobot2/provider-homes/default/default/codex'

  it('names the database and the retry — and does not forward the Rust line', async () => {
    const t = track(
      new SpawnCodexTransport(NODE, ['-e', SQLITE_DEATH], {
        ...fast,
        env: { ...process.env, CODEX_SQLITE_HOME: REAL_SHAPED_HOME },
      }),
    )
    const error = await t.request('initialize', {}).then(
      () => null,
      (e: Error) => e,
    )
    expect(error?.message).toContain(`Codex could not open its own database in ${REAL_SHAPED_HOME}`)
    expect(error?.message).toContain('try again')
    // ⚠️ The negative half of THIS assertion: the sentence replaces the forward, it does not decorate
    // it. A message carrying both would be the old defect with a preamble.
    expect(error?.message).not.toContain('sqlite state runtime')
    expect(error?.message).not.toContain('stderr tail')
  }, 15000)

  it('forwards every other death exactly as it always did', async () => {
    const t = makeTransport(OTHER_DEATH)
    const error = await t.request('initialize', {}).then(
      () => null,
      (e: Error) => e,
    )
    expect(error?.message).toContain('codex app-server exited')
    expect(error?.message).toContain('stderr tail: thread panicked')
    expect(error?.message).not.toContain('could not open its own database')
  }, 15000)
})

/**
 * ⛔ **The exit fact Codex already had, and never handed to anyone** (233, from 229 H1).
 *
 * 233 was dispatched against the Claude adapter and told to VERIFY rather than assume that Codex
 * was different. It is not — it is the same class, with one honest difference: before it gives up,
 * this transport actually delivers SIGTERM and then SIGKILL to the child's whole process group,
 * which the Claude adapter never does itself.
 *
 * The line that decided it was `doReapGroup`'s last: `await this.awaitExit(this.opts.killGraceMs)`,
 * whose own comment says *"return once the final grace elapses regardless"*. `awaitExit` returns
 * `Promise<boolean>` — **true if the child really exited, false if the timer won** — and all three
 * call sites in `doReapGroup` discarded it. So the fact was computed three times per teardown and
 * dropped, while `close()` resolved at `exitGrace + killGrace + killGrace` whether or not anything
 * had died. `exited` is that fact, published; nothing about the teardown changed **in 233**.
 *
 * ⚠️ **240 changed the teardown, and this sentence is kept current on purpose.** Two of those three
 * graces are now `awaitGroupQuiet`, which watches the process GROUP rather than the leader; the
 * first is still `awaitExit`, because it follows `stdin.end()` and that is addressed to the leader.
 * `exited` itself is untouched — see the block at the end of this file.
 */
describe('233 · exited is the process, not the teardown bound', () => {
  /**
   * ⚠️ **The child is killed from OUTSIDE, and `close()` is never called** — which is the only shape
   * that tells the fact apart from the bound it is named after.
   *
   * The obvious version of this test (`await t.close()`, then assert `exited`) proves nothing: with
   * `STAY_ALIVE` the child dies *because* `close()` reaped it, so a promise wired to the end of
   * `doReapGroup` — which resolves "regardless" — would pass it too. That is exactly the defect
   * under test, and the test would have certified it. Found by this dispatch's own adversarial pass.
   */
  it('⛔ settles on the process, not on the teardown that would have reaped it', async () => {
    const t = makeTransport(STAY_ALIVE)
    const { done } = drain(t)
    const pid = rawChildPid(t)
    expect(pid, 'the child really spawned').toBeGreaterThan(0)

    let exited = false
    void t.exited.then(() => (exited = true))
    await new Promise((resolve) => setTimeout(resolve, 50))
    // ⚑ The anti-vacuity half: a promise that had already resolved would pass the rest for free.
    expect(isAlive(pid as number)).toBe(true)
    expect(exited, 'a live child must not be reported as an exit').toBe(false)

    // 🔴 **No `close()`.** Nothing in this transport's teardown runs; the kernel delivers the exit.
    process.kill(pid as number, 'SIGKILL')

    await t.exited
    expect(exited).toBe(true)
    expect(isAlive(pid as number)).toBe(false)
    await t.close()
    await done
  })

  it('⚑ settles when no process ever ran, rather than hanging a quit forever', async () => {
    // `onSpawnError` marks it: a spawn that failed leaves nothing running, and "nothing to wait
    // for" is the honest answer. A never-settling promise here would refuse the session id for the
    // rest of the app run over a child that never existed.
    const t = track(
      new SpawnCodexTransport('/definitely/not/a/binary/anywhere', ['app-server'], fast),
    )
    const { done } = drain(t)
    await expect(t.exited).resolves.toBeUndefined()
    await t.close()
    await done
  })
})

/**
 * 240 §1 · ⛔ **`close()` resolving must mean the process GROUP is empty, not that the leader died.**
 *
 * ## What was measured before a line was changed
 *
 * `pnpm run probe:orphan-descendant` drives this class over a real leader that spawns a real
 * descendant and then exits on stdin EOF — the tree 202's own source named and did not build. On
 * `20110e0`:
 *
 * | descendant | `exited` | `close()` | signals it saw | alive when `close()` resolved |
 * |---|---|---|---|---|
 * | none | 31 ms | 32 ms | — | — |
 * | in the group, stubborn | 1 ms | 2 ms | ⛔ **none** | ⛔ **yes** |
 * | in the group, cooperative | 2 ms | 2 ms | ⛔ **none** | ⛔ **yes** |
 * | escaped (`setsid`) | 2 ms | 2 ms | none | yes, and still at +1 s |
 *
 * ⚑ **`signals` empty in the COOPERATIVE row is the finding in one cell.** That descendant exits on
 * SIGTERM; it never got the chance, because `doReapGroup`'s graces raced `exited`, which is already
 * settled once the leader is gone. SIGTERM and SIGKILL left ~1 ms apart, and `close()` returned over
 * a live process — under a host whose {@link Launch.settled} says *"this launch is over AND
 * everything it created is confirmed down"*.
 *
 * ## Why these tests could not have been written as unit tests over a fake
 *
 * ⛔ **The whole question is a kernel question.** A fake transport has no process group, and the
 * defect is invisible to anything that does not ask `kill(-pid, 0)`. So these spawn the same two
 * fixtures the probe does — `codex-leader.mjs` / `codex-descendant.mjs` — through the production
 * class, and read the answer off the OS.
 */
describe('240 · the teardown waits for the group, not for the leader', () => {
  const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
  const LEADER = join(FIXTURES, 'codex-leader.mjs')

  /** A scratch directory for one tree, removed however the test ends. */
  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'brobot-240-'))
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
    return dir
  }

  /**
   * Spawn a leader through the production transport and wait until its descendant exists.
   *
   * ⚠️ **`killGraceMs` must exceed the descendant's own 300 ms shutdown**, or the test would be
   * asserting that our bound is longer than their cleanup rather than that a grace exists at all.
   */
  async function tree(
    placement: 'in-group' | 'escaped' | 'launcher' | 'none',
    mode: 'stubborn' | 'slow-clean' | 'cooperative',
    leader: 'leaves' | 'stays' = 'leaves',
    options: Pick<SpawnCodexOptions, 'processTable'> = {},
  ): Promise<{ t: SpawnCodexTransport; log: string; descendant: number | undefined }> {
    const log = join(scratch(), 'signals')
    const t = track(
      new SpawnCodexTransport(NODE, [LEADER, log, placement, mode, leader], {
        env: process.env,
        exitGraceMs: 300,
        killGraceMs: 2000,
        ...options,
      }),
    )
    drain(t)
    // ⛔ **The clock must not contain node's startup.** The healthy-path row asserts a teardown
    // shorter than 300 ms, and a leader that has not booted yet would spend its whole `exitGraceMs`
    // there — a control that fails on a loaded machine and says nothing about the code.
    await waitUntil(() => existsSync(`${log}.leader`), 'the leader to announce itself', 10_000)
    if (placement === 'none') return { t, log, descendant: undefined }
    await waitUntil(() => existsSync(`${log}.pid`), 'the descendant to announce its pid', 10_000)
    const descendant = Number(readFileSync(`${log}.pid`, 'utf8').trim())
    expect(descendant, 'the fixture must report a real pid').toBeGreaterThan(0)
    expect(isAlive(descendant), 'the descendant must be running before the teardown').toBe(true)
    return { t, log, descendant }
  }

  function signalsIn(log: string): string[] {
    return existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter((line) => line.length > 0)
      : []
  }

  /**
   * 🔴 **THE DEFECT, as a marker file.**
   *
   * ⛔ **`.cleaned` cannot be written by a process that was SIGKILLed one millisecond after its
   * SIGTERM** — the fixture spends 300 ms shutting down before it writes. So its presence is not a
   * timing coincidence that a fast machine could produce; it is proof that a grace existed. Measured
   * absent on `20110e0` and present here.
   */
  it('⛔ gives an in-group descendant a real interval between SIGTERM and SIGKILL', async (ctx) => {
    ctx.skip(process.platform === 'win32', 'Windows sends no SIGTERM; its stop is the end of stdin')
    const { t, log, descendant } = await tree('in-group', 'slow-clean')

    await t.close()

    // ⚑ Read at the instant `close()` resolved — the moment the host treats the launch as settled.
    expect(isAlive(descendant!), 'a descendant was still running when close() resolved').toBe(false)
    expect(
      existsSync(`${log}.cleaned`),
      'the descendant never got to finish its own shutdown',
    ).toBe(true)
    expect(
      signalsIn(log),
      'the descendant must actually have processed the group SIGTERM',
    ).toContain('SIGTERM')
  }, 20_000)

  /**
   * ⚑ The same fact for a descendant that will never leave on its own: the bound still holds, and
   * it is the SIGKILL that ends it — but `close()` does not resolve until it has.
   */
  it('⛔ does not resolve close() while a stubborn descendant is still in the group', async () => {
    // On Windows a Node leader's own children end with it; a detached one outlives it, as a
    // command the app-server started does.
    const { t, descendant } = await tree(
      process.platform === 'win32' ? 'escaped' : 'in-group',
      'stubborn',
    )

    const started = Date.now()
    await t.close()
    const elapsed = Date.now() - started

    expect(isAlive(descendant!), 'a stubborn descendant survived close()').toBe(false)
    // It ignores SIGTERM, so the full kill grace has to elapse before SIGKILL — and no more than
    // the documented `exitGrace + killGrace + killGrace` in total.
    expect(elapsed, 'the kill grace was not actually spent').toBeGreaterThanOrEqual(1500)
    expect(elapsed, 'teardown exceeded its own documented bound').toBeLessThan(300 + 2000 + 2000)
  }, 20_000)

  it('⛔ on Windows, a leader that ignores the end of its stdin is ended with what it started', async (ctx) => {
    ctx.skip(process.platform !== 'win32', 'the tree teardown is Windows’ own')
    const { t, log, descendant } = await tree('escaped', 'stubborn', 'stays')
    const leader = Number(readFileSync(`${log}.leader`, 'utf8').trim())
    expect(isAlive(leader), 'the leader must be running before the teardown').toBe(true)

    await t.close()

    expect(isAlive(leader), 'the leader was still running when close() resolved').toBe(false)
    expect(isAlive(descendant!), 'its descendant was still running when close() resolved').toBe(
      false,
    )
  }, 30_000)

  /** The process table, read as the transport reads it, counting the readings that came back. */
  function countedTable(): {
    processTable: (ms: number) => Promise<TableReading | null>
    readings: () => number
    goSlow: () => void
  } {
    let readings = 0
    let slow = false
    return {
      processTable: async (ms) => {
        if (slow) {
          await new Promise((resolve) => setTimeout(resolve, ms))
          return null
        }
        const reading = await readTable(ms)
        if (reading !== null) readings += 1
        return reading
      },
      readings: () => readings,
      goSlow: () => {
        slow = true
      },
    }
  }

  it('🔴 on Windows, a program a launcher left running is ended after the launcher has exited', async (ctx) => {
    ctx.skip(process.platform !== 'win32', 'the tree teardown is Windows’ own')
    const table = countedTable()
    const { t, log, descendant } = await tree('launcher', 'stubborn', 'leaves', table)
    // A reading while the launcher runs, taken when the leader says it started an item.
    await waitUntil(() => table.readings() > 0, 'a reading of the table', 20_000)
    const launcher = Number(readFileSync(`${log}.launcher`, 'utf8').trim())
    writeFileSync(`${log}.launcher-may-go`, '')
    await waitUntil(() => !isAlive(launcher), 'the launcher to exit', 10_000)

    await t.close()

    expect(isAlive(descendant!), 'the program the launcher left survived close()').toBe(false)
  }, 60_000)

  it('🔴 on Windows, a table that does not answer at the stop still ends what was found before, within the budget', async (ctx) => {
    ctx.skip(process.platform !== 'win32', 'the tree teardown is Windows’ own')
    const table = countedTable()
    const { t, descendant } = await tree('escaped', 'stubborn', 'leaves', table)
    await waitUntil(() => table.readings() > 0, 'a reading of the table', 20_000)
    table.goSlow()

    const started = Date.now()
    await t.close()
    const elapsed = Date.now() - started

    expect(isAlive(descendant!), 'a descendant found before survived close()').toBe(false)
    // The host waits 5 s for a closing conversation; the default stop budget is 4.5 s.
    expect(elapsed, 'the stop ran past the host’s wait').toBeLessThan(5000)
  }, 60_000)

  /**
   * ⚠️ **§5's requirement, as a test rather than as a promise.** The healthy path is a leader with
   * no descendant: the group is empty the instant it exits, {@link groupIsQuiet} answers on its
   * first synchronous call, and no timer is ever armed. A regression that waited unconditionally
   * would add `killGraceMs` (2 s here) to every quit and would fail this line.
   */
  it('⚑ costs the healthy path nothing — an empty group is quiet on the first check', async (ctx) => {
    ctx.skip(
      process.platform === 'win32',
      'on Windows every close reads the process table once, to find what the app-server left running',
    )
    const { t } = await tree('none', 'stubborn')

    const started = Date.now()
    await t.close()
    const elapsed = Date.now() - started

    expect(elapsed, 'teardown started waiting on a group that was already empty').toBeLessThan(300)
  }, 20_000)

  /**
   * ⚑ **A spawn that never produced a process has no group either.**
   *
   * `groupIsQuiet` answers `true` for an undefined pid, and this is what that line is worth: without
   * it a failed spawn would spend both graces polling for a group that was never created — four
   * seconds added to a quit, over a child that never existed. 233 made the same point about
   * `exited`; this is the teardown's half of it.
   */
  it('⚑ does not wait for the group of a process that never started', async () => {
    const t = track(
      new SpawnCodexTransport('/definitely/not/a/binary/anywhere', ['app-server'], {
        env: process.env,
        exitGraceMs: 300,
        killGraceMs: 2000,
      }),
    )
    drain(t)

    const started = Date.now()
    await t.close()

    expect(Date.now() - started, 'a failed spawn waited for a group nobody made').toBeLessThan(300)
  }, 20_000)

  /**
   * ⛔ **The honest limit, pinned so nobody has to rediscover it** (074).
   *
   * A descendant that called `setsid` is in its own session and its own process group. `kill(-pid,
   * …)` cannot reach it, `kill(-pid, 0)` cannot see it, and so `close()` resolves reporting a quiet
   * group while it runs. ⚠️ **This test asserts the GAP**, because the alternative is a contract
   * that claims to have closed it. If a future dispatch teaches the transport to track descendants
   * by some other means, this is the test that should fail and be rewritten.
   */
  it('⚠️ cannot see — and does not claim — a descendant that left the group (setsid)', async (ctx) => {
    ctx.skip(
      process.platform === 'win32',
      'on Windows a detached descendant is still found by its parent, and ended',
    )
    const { t, log, descendant } = await tree('escaped', 'stubborn')
    onTestFinished(() => {
      try {
        process.kill(descendant!, 'SIGKILL')
      } catch {
        // already gone
      }
    })

    await t.close()

    expect(
      isAlive(descendant!),
      'an escaped descendant is out of reach — that is the finding',
    ).toBe(true)
    expect(signalsIn(log), 'nothing addressed to the leader group can reach it').toEqual([])
  }, 20_000)
})
