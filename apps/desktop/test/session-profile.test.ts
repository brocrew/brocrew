import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, claudeAutoMemoryDir, claudeAutoMemoryIndex } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { composeSystemHint, readSessionInstructions } from '../src/main/runtime/instructions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import {
  DEFAULT_PROFILE_ID,
  HOME_FOLDER,
  deriveProviderHome,
  prepareProviderHome,
} from '../src/main/runtime/provider-homes'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

/**
 * A profile is the shared-vs-isolated memory boundary: it picks the provider home, and the home
 * is where the provider keeps what it remembers. So the assertions here are about **paths** —
 * same profile, same directory; different profile, different directory — and about resume
 * landing in the home the session actually ran in, because resuming into the wrong one finds no
 * conversation at all (the 086 failure mode, from the other direction).
 *
 * The real path derivation runs; only the credential seams are injected, so this never reads the
 * machine Keychain or the personal `~/.codex`.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

describe('session profile', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  /** Shared across hosts: a relaunched app is a new host, but the provider's state outlives it. */
  let runtimes: Map<string, FakeRuntime>
  /** Every home this run provisioned, in order — the assertions read these. */
  let homes: string[]

  async function realHome(provider: Provider, profileId: string): Promise<string> {
    const home = await prepareProviderHome(
      dir,
      { profileId, provider },
      // Nothing is written and no credential is read: the path is what is under test.
      {
        provisionHome: () => {},
        provisionCodexAuth: () => {},
        claudeAuthHealth: () => ({ ok: true }),
      },
    )
    homes.push(home)
    return home
  }

  // ⚠️ **`providerHomePath` is the PATH and stays SYNCHRONOUS** (243). `prepareProviderHome`
  // became promise-returning when the provisioning lock's wait stopped blocking the thread;
  // this seam is `deriveProviderHome` on its own — pure, no lock, no mkdir — which is what the
  // composition root has always wired it to and what its own doc in `runtime-host.ts` requires.
  function homePath(provider: Provider, profileId: string): string {
    const home = deriveProviderHome(dir, { profileId, provider })
    homes.push(home)
    return home
  }

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => {
        const existing = runtimes.get(provider)
        if (existing) return existing
        const fresh = new FakeRuntime(provider)
        runtimes.set(provider, fresh)
        return fresh
      },
      prepareProviderHome: realHome,
      providerHomePath: homePath,
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-profile-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    runtimes = new Map()
    homes = []
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('shares one home between sessions in the same profile, and separates different ones', async () => {
    const host = buildHost()
    const first = await host.createSession({ provider: 'codex', profileId: 'work' }, new NullSink())
    const second = await host.createSession(
      { provider: 'codex', profileId: 'work' },
      new NullSink(),
    )
    const other = await host.createSession(
      { provider: 'codex', profileId: 'client' },
      new NullSink(),
    )

    // Same profile ⇒ the same directory ⇒ the provider remembers across the two sessions.
    expect(second.providerHome).toBe(first.providerHome)
    // A different profile ⇒ a different directory ⇒ it shares nothing with them.
    expect(other.providerHome).not.toBe(first.providerHome)
    expect(first.providerHome).toBe(join(dir, 'provider-homes', 'default', 'work', 'codex'))
    expect(other.providerHome).toBe(join(dir, 'provider-homes', 'default', 'client', 'codex'))
    await host.closeAll()
  })

  it('keeps a session that asked for no profile exactly where it used to live', async () => {
    // An omitted profile resolves to {@link DEFAULT_PROFILE_ID}, and both assertion halves
    // derive from that constant. Legacy rows can still use `default/default`; their location
    // does not define the fresh-install default.
    const host = buildHost()
    const created = await host.createSession({ provider: 'claude' }, new NullSink())

    expect(created.profileId).toBe(DEFAULT_PROFILE_ID)
    expect(created.providerHome).toBe(
      join(dir, 'provider-homes', HOME_FOLDER, DEFAULT_PROFILE_ID, 'claude'),
    )
    await host.closeAll()
  })

  it('records the profile, and hands it back with the session', async () => {
    const host = buildHost()
    const created = await host.createSession(
      { provider: 'codex', profileId: 'work' },
      new NullSink(),
    )

    const row = db
      .prepare('SELECT profile_id FROM provider_session WHERE id = ?')
      .get(created.sessionId)
    expect(row).toEqual({ profile_id: 'work' })
    expect(store.find(created.sessionId)?.profileId).toBe('work')
    await host.closeAll()
  })

  it('resumes into the home the session ran in, not the default one', async () => {
    // The whole reason the column exists. A resume that provisioned `default` would hand the
    // provider a home with no trace of the conversation, and the session would come back as
    // "not found" — a failure that looks like data loss rather than a wrong path.
    const first = buildHost()
    const sink = new NullSink()
    const created = await first.createSession({ provider: 'codex', profileId: 'work' }, sink)
    await first.close(created.sessionId, sink)
    homes.length = 0

    const relaunched = buildHost()
    const resumed = await relaunched.resumeSession(created.sessionId, new NullSink())

    expect(resumed.profileId).toBe('work')
    expect(homes).toEqual([join(dir, 'provider-homes', 'default', 'work', 'codex')])
    expect(resumed.providerHome).toBe(created.providerHome)
    await relaunched.closeAll()
  })

  it('resumes a row recorded before profiles existed as the default one', async () => {
    const first = buildHost()
    const sink = new NullSink()
    const created = await first.createSession({ provider: 'codex' }, sink)
    await first.close(created.sessionId, sink)
    // Exactly what migration 0003 leaves behind for rows that predate it.
    db.prepare('UPDATE provider_session SET profile_id = NULL WHERE id = ?').run(created.sessionId)
    homes.length = 0

    const relaunched = buildHost()
    const resumed = await relaunched.resumeSession(created.sessionId, new NullSink())

    // The seeded profile is not a guess here — it is where that session really ran.
    expect(resumed.profileId).toBe(DEFAULT_PROFILE_ID)
    expect(homes).toEqual([join(dir, 'provider-homes', HOME_FOLDER, DEFAULT_PROFILE_ID, 'codex')])
    await relaunched.closeAll()
  })

  it('refuses a profile that would walk out of the managed root, or will not fit one', () => {
    // Rejected at the boundary, before anything is provisioned — the SAME rule the path
    // derivation and the launcher check, so the three cannot drift apart. The length bound is
    // part of it: a 300-character id passes any alphabet check and then fails inside `mkdir`
    // with ENAMETOOLONG, naming a path instead of the field that caused it.
    for (const profileId of ['../escape', 'a/b', '', '.', './x', 'has space', 'x'.repeat(65)]) {
      const parsed = runtimeCommandSchema.safeParse({
        kind: 'createSession',
        provider: 'codex',
        profileId,
      })
      expect(parsed.success, profileId).toBe(false)
    }

    for (const profileId of ['default', 'work', 'client-2', 'a.b_c', 'x'.repeat(64)]) {
      const parsed = runtimeCommandSchema.safeParse({
        kind: 'createSession',
        provider: 'codex',
        profileId,
      })
      expect(parsed.success, profileId).toBe(true)
    }
  })

  it('applies the same rule when the path is derived, not only at the boundary', () => {
    // Belt and braces on purpose: the boundary is the only door today, but a future caller
    // that reaches the host directly must not be able to spell its way out of the root.
    const host = buildHost()
    return expect(
      host.createSession({ provider: 'codex', profileId: '../escape' }, new NullSink()),
    ).rejects.toThrow('invalid profileId')
  })

  /**
   * 🔴 **What a profile OWNS, asserted rather than described** (167 §3, criteria 5–7).
   *
   * Three things are per-profile now, and they arrived one dispatch at a time: the provider home
   * (021), `<providerHome>/CLAUDE.md` (158), and `<providerHome>/memory/` (166). The PM proved the
   * isolation live by driving three sessions through the IPC bridge; this is the same proof as a
   * test, so it cannot regress the day a fourth thing joins the list.
   *
   * ⚠️ **The REAL reader runs.** `readSessionInstructions` is the composition root's own function,
   * with real files on a real disk — a stub that recorded which `providerHome` it was handed would
   * assert the argument and not the outcome, and the outcome is what a session is launched with.
   */
  describe('memory and instructions follow the profile, not the machine (167)', () => {
    /** Lay down a profile's own two files, and hand back where its memory index is. */
    function furnish(profileId: string, note: string): { home: string; memoryIndex: string } {
      const home = join(dir, 'provider-homes', HOME_FOLDER, profileId, 'claude')
      mkdirSync(claudeAutoMemoryDir(home), { recursive: true })
      writeFileSync(join(home, 'CLAUDE.md'), `# ${profileId}\n\nInstructions: ${note}\n`)
      writeFileSync(claudeAutoMemoryIndex(home), `# Memory Index\n\n- ${note}\n`)
      return { home, memoryIndex: claudeAutoMemoryIndex(home) }
    }

    /**
     * A host whose `readInstructions` is the real one.
     *
     * `home` is pinned to the temp root so the project chain is bounded by the fixture rather than
     * by whatever is in the machine's own home directory — the walk stops at home-or-above, and a
     * test that read the developer's `~/CLAUDE.md` would pass or fail by accident.
     */
    function hostWithInstructions() {
      return buildHost({
        readInstructions: (provider, cwd, providerHome) => {
          const read = readSessionInstructions({ provider, cwd, providerHome, home: dir })
          return {
            instructions: read.instructions,
            systemHint: composeSystemHint(read.instructions.injected),
            memoryLoaded: read.memoryLoaded,
          }
        },
      })
    }

    it('⛔ gives a session the memory and the CLAUDE.md of the profile it was started in', async () => {
      const alpha = furnish('alpha', 'BROBOT-167-ALPHA')
      furnish('beta', 'BROBOT-167-BETA')
      const host = hostWithInstructions()

      const created = await host.createSession(
        { provider: 'claude', profileId: 'alpha' },
        new NullSink(),
      )

      expect(created.providerHome).toBe(alpha.home)
      // 158 — the profile's own instructions, appended to the prompt as text.
      const profileMemory = created.instructions.injected.find(
        (item) => item.kind === 'profile-memory',
      )
      expect(profileMemory?.path).toBe(join(alpha.home, 'CLAUDE.md'))
      expect(profileMemory?.text).toContain('BROBOT-167-ALPHA')
      // 166 — the memory the agent writes for itself, read for display and NOT appended.
      expect(created.instructions.agentMemory[0]?.path).toBe(alpha.memoryIndex)
      expect(created.instructions.agentMemory[0]?.text).toContain('BROBOT-167-ALPHA')

      // ⛔ **The negative that is the whole ticket**: the other profile's home is right there on the
      // same disk, one directory across, and nothing of it reaches this session — not through the
      // system hint the model actually receives, and not through the list the drawer shows.
      const everything = JSON.stringify(created.instructions)
      expect(everything).not.toContain('BROBOT-167-BETA')
      expect(everything).not.toContain(join(dir, 'provider-homes', HOME_FOLDER, 'beta'))
      await host.closeAll()
    })

    it('…and a session in the DEFAULT profile gets BroBot’s, not the other one’s', async () => {
      // The paired positive. Without it the negative above passes on a reader that returns nothing
      // for every profile — which is exactly what a broken path would look like.
      const brobot = furnish(DEFAULT_PROFILE_ID, 'BROBOT-167-DEFAULT')
      furnish('alpha', 'BROBOT-167-ALPHA')
      const host = hostWithInstructions()

      const created = await host.createSession({ provider: 'claude' }, new NullSink())

      expect(created.profileId).toBe(DEFAULT_PROFILE_ID)
      expect(created.providerHome).toBe(brobot.home)
      expect(created.instructions.agentMemory[0]?.text).toContain('BROBOT-167-DEFAULT')
      expect(JSON.stringify(created.instructions)).not.toContain('BROBOT-167-ALPHA')
      await host.closeAll()
    })

    it('⛔ reopens with the RECORDED profile’s memory and CLAUDE.md, never today’s selection', async () => {
      // 149's failure mode, one axis over: a reopen that adopts the wrong thing strands the
      // conversation. Here the wrong thing would be an identity — the agent would come back
      // remembering somebody else's work, which is worse than coming back empty.
      const alpha = furnish('alpha', 'BROBOT-167-ALPHA')
      furnish(DEFAULT_PROFILE_ID, 'BROBOT-167-DEFAULT')
      const first = hostWithInstructions()
      const sink = new NullSink()
      const created = await first.createSession({ provider: 'claude', profileId: 'alpha' }, sink)
      await first.close(created.sessionId, sink)
      await first.closeAll()

      const relaunched = hostWithInstructions()
      const resumed = await relaunched.resumeSession(created.sessionId, new NullSink())

      expect(resumed.profileId).toBe('alpha')
      expect(resumed.providerHome).toBe(alpha.home)
      expect(resumed.instructions.agentMemory[0]?.path).toBe(alpha.memoryIndex)
      expect(resumed.instructions.agentMemory[0]?.text).toContain('BROBOT-167-ALPHA')
      expect(
        resumed.instructions.injected.find((item) => item.kind === 'profile-memory')?.text,
      ).toContain('BROBOT-167-ALPHA')
      expect(JSON.stringify(resumed.instructions)).not.toContain('BROBOT-167-DEFAULT')
      await relaunched.closeAll()
    })

    it('picks up an edit made between the two launches — a profile is edited, not snapshotted', async () => {
      // 158 §2's live-profile semantic, which is what makes the assertion above a statement about
      // the FILES rather than about a value copied at creation. If the hint were replayed from the
      // row, this would come back with the old text and the test above would still pass.
      const alpha = furnish('alpha', 'BROBOT-167-ALPHA')
      const first = hostWithInstructions()
      const sink = new NullSink()
      const created = await first.createSession({ provider: 'claude', profileId: 'alpha' }, sink)
      await first.close(created.sessionId, sink)
      await first.closeAll()

      writeFileSync(alpha.memoryIndex, '# Memory Index\n\n- BROBOT-167-EDITED\n')
      const relaunched = hostWithInstructions()
      const resumed = await relaunched.resumeSession(created.sessionId, new NullSink())

      expect(resumed.instructions.agentMemory[0]?.text).toContain('BROBOT-167-EDITED')
      await relaunched.closeAll()
    })

    it('the memory directories of two profiles are two directories, with nothing above them shared', () => {
      // The path rule on its own, because the two assertions above go through a host and a reader
      // and would both still pass if `claudeAutoMemoryDir` started ignoring its argument.
      const alpha = join(dir, 'provider-homes', HOME_FOLDER, 'alpha', 'claude')
      const beta = join(dir, 'provider-homes', HOME_FOLDER, 'beta', 'claude')

      expect(claudeAutoMemoryDir(alpha)).not.toBe(claudeAutoMemoryDir(beta))
      expect(claudeAutoMemoryDir(alpha).startsWith(alpha)).toBe(true)
      expect(claudeAutoMemoryDir(beta).startsWith(beta)).toBe(true)
      // ⚠️ Neither is inside the other, which `startsWith` alone would not catch for a pair of
      // profiles named `dev` and `dev-2`.
      expect(claudeAutoMemoryDir(alpha).startsWith(beta)).toBe(false)
      expect(claudeAutoMemoryDir(beta).startsWith(alpha)).toBe(false)
    })
  })
})
