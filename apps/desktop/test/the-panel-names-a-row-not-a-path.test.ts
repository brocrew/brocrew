import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **356 · the renderer names a ROW, and the host looks the string up.**
 *
 * ⛔ **The doors that read a file's TEXT refuse a renderer-supplied path by construction** —
 * `workflow-output.ts` (*"The renderer never supplies a path"*), `child-work.ts` (which will not even
 * let the absolute path travel BACK). (`asset-protocol.ts` was a third until `726` · R92 made it
 * serve any image file a URL names.) 356 §1 puts two buttons on a panel full of paths, and the only
 * way to do that without inverting both rulings is for the wire to carry a target — a row of the
 * session's own record — and for main to resolve it.
 *
 * ⚑ **So what is measured here is the resolution**, not the reading: that each target lands on the
 * string the host holds for THAT session, that a target naming nothing answers `no-path` rather than
 * revealing something nearby, and that the path handed to the OS is the one the row named.
 *
 * ⚠️ **And the layer labels** (§3, from 357), because they are computed on the same journey: the
 * provider hands over bare strings, and the session's own home and cwd decide which layer each one
 * is in. A fixture whose two files land in ONE layer would be answered identically by every
 * plausible implementation — so the fixture below straddles both.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true

  constructor(readonly ownerId = 'owner:1') {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  // ⚠️ Liveness is not what this file measures; the sink still has to satisfy the interface.
  sendLiveness(): void {}
}

/** A runtime whose handle reports an instruction list, the way Codex's handshake does. */
class Reporting extends FakeRuntime {
  sources: string[] | undefined = undefined

  private wire<T extends SessionHandle>(handle: T): T {
    Object.defineProperty(handle, 'instructionSources', {
      get: () => this.sources,
      configurable: true,
    })
    return handle
  }

  override async start(
    ...args: Parameters<FakeRuntime['start']>
  ): ReturnType<FakeRuntime['start']> {
    return this.wire(await super.start(...args))
  }
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('356 · a row, resolved by the host that launched the session', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let sink: RecordingSink
  let runtime: Reporting
  let cwd: string
  let home: string
  const revealed: string[] = []

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-356-'))
    cwd = join(userData, 'work', 'checkout')
    home = join(userData, 'provider-homes', 'codex')
    mkdirSync(cwd, { recursive: true })
    mkdirSync(home, { recursive: true })
    revealed.length = 0
    runtime = new Reporting('codex')
    let counter = 0
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: () => home,
      providerHomePath: () => home,
      resolveCwd: (_sessionId, requested) => requested ?? cwd,
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, providerHome) => ({
        home: providerHome,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [
          {
            name: 'auth.json',
            path: join(providerHome, 'auth.json'),
            exists: true,
            note: 'the credential',
          },
          {
            name: 'config.toml',
            path: join(providerHome, 'config.toml'),
            exists: false,
            note: 'preferences',
          },
        ],
      }),
      revealPath: (path) => revealed.push(path),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const start = () => host.createSession({ provider: 'codex', cwd }, sink)

  /* ------------------------------------------------------------------ §3 · the layer label */

  it('⛔ labels each reported file by the layer this SESSION puts it in', async () => {
    // ⚑ The fixture straddles both layers on purpose: one file in the home, one on the cwd chain,
    // and one in neither. A pair that both landed in one layer would be answered the same way by
    // "is it in the home", "is it on the chain" and "is it neither" — and would measure none of them.
    runtime.sources = [
      join(home, 'AGENTS.md'),
      join(cwd, 'AGENTS.md'),
      join(userData, 'elsewhere', 'AGENTS.md'),
    ]

    const created = await start()

    expect(created.instructions.provider.map((one) => one.scope)).toEqual([
      'profile',
      'project',
      'unknown',
    ])
    // …and the provider's own ORDER survives, because the order is its claim and not ours.
    expect(created.instructions.provider.map((one) => one.path)).toEqual(runtime.sources)
  })

  it('⚑ …and a provider that reports nothing leaves the list empty rather than inventing a layer', async () => {
    const created = await start()

    expect(created.instructions.provider).toEqual([])
  })

  /* ---------------------------------------------------------------------- §2 · the read */

  it('⛔ reads the row the renderer named, off the list the PROVIDER gave this session', async () => {
    const file = join(cwd, 'AGENTS.md')
    writeFileSync(file, '# Project instructions\n\nBe brief.\n')
    runtime.sources = [join(home, 'AGENTS.md'), file]

    const created = await start()
    const read = host.readInstructionSource(created.sessionId, 1)

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.text).toContain('Be brief.')
  })

  it('⛔ …and a session the host does not hold reads nothing at all', () => {
    // ⚠️ **A refusal rather than a throw.** The provider list is read off the live handle every time
    // it is disclosed, so a panel with rows on it has a handle behind it — reaching here without one
    // means the screen and the host disagree, which the viewer should say.
    expect(host.readInstructionSource('sess_nobody', 0)).toEqual({ ok: false, reason: 'no-source' })
  })

  /* -------------------------------------------------------------------- §1 · the reveal */

  it('⛔ each target resolves to the string this host holds for this session', async () => {
    writeFileSync(join(home, 'auth.json'), '{}')
    const file = join(cwd, 'AGENTS.md')
    writeFileSync(file, 'x')
    runtime.sources = [file]

    const created = await start()

    expect(host.revealPath(created.sessionId, { of: 'cwd' })).toEqual({ ok: true, path: cwd })
    expect(host.revealPath(created.sessionId, { of: 'home' })).toEqual({ ok: true, path: home })
    expect(host.revealPath(created.sessionId, { of: 'config-file', name: 'auth.json' })).toEqual({
      ok: true,
      path: join(home, 'auth.json'),
    })
    expect(host.revealPath(created.sessionId, { of: 'instruction-source', index: 0 })).toEqual({
      ok: true,
      path: file,
    })
    // ⛔ **And the OS was handed exactly those four strings** — the reveal is a side effect, so a
    // method that resolved correctly and then revealed something else would pass every line above.
    expect(revealed).toEqual([cwd, home, join(home, 'auth.json'), file])
  })

  it('⛔ a target naming nothing this session holds is `no-path`, and nothing is revealed', async () => {
    runtime.sources = [join(cwd, 'AGENTS.md')]
    const created = await start()

    expect(host.revealPath(created.sessionId, { of: 'config-file', name: 'nothing.json' })).toEqual(
      {
        ok: false,
        reason: 'no-path',
      },
    )
    expect(host.revealPath(created.sessionId, { of: 'instruction-source', index: 7 })).toEqual({
      ok: false,
      reason: 'no-path',
    })
    expect(host.revealPath('sess_nobody', { of: 'cwd' })).toEqual({ ok: false, reason: 'no-path' })
    expect(revealed).toEqual([])
  })

  it('⚠️ a file the session named and something has since removed is `gone`, not revealed', async () => {
    // `config.toml` is reported by this fixture's config as `exists: false`, so the host holds a
    // path with nothing at it — the ordinary state of a file deleted after the session read it. A
    // Finder window opened on nothing would leave the panel with no way to say so.
    runtime.sources = []
    const created = await start()

    expect(host.revealPath(created.sessionId, { of: 'config-file', name: 'config.toml' })).toEqual({
      ok: false,
      reason: 'gone',
    })
    expect(revealed).toEqual([])
  })

  it('⚑ a host wired with no way to reveal still answers, and reveals nothing', async () => {
    // ⛔ The dep is optional for `openExternal`'s reason — a test host opens nothing — and the
    // absence must not turn a button press into an exception in the main process.
    const blind = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: () => home,
      providerHomePath: () => home,
      resolveCwd: (_sessionId, requested) => requested ?? cwd,
      newSessionId: () => 'sess_blind',
      readProviderConfig: (_provider, providerHome) => ({
        home: providerHome,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
    })
    const created = await blind.createSession({ provider: 'codex', cwd }, sink)

    expect(blind.revealPath(created.sessionId, { of: 'cwd' })).toEqual({ ok: true, path: cwd })
    expect(revealed).toEqual([])
    await blind.closeAll()
  })
})
