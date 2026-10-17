import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, provisionCodexAuth } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import {
  HOME_FOLDER,
  deriveProviderHome,
  listProfileIds,
  prepareProviderHome,
} from '../src/main/runtime/provider-homes'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { brobotWorkspace } from '../src/main/runtime/workspace'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID, type CwdVerdict } from '../src/shared/runtime-ipc'

/**
 * ⛔ **A launch that is refused must leave nothing behind** (203, from 195 H4).
 *
 * `startSession` ran `prepareProviderHome` and then `resolveCwd`. The first makes
 * `<userData>/provider-homes/default/<profile>/<provider>` at `0700` and, for Codex, copies the
 * personal `~/.codex/auth.json` into it; the second throws for a folder that does not exist. Nothing
 * rolls that back — `provider-homes.ts` says so in its own words: *"a gesture that FAILS still
 * poisons the set: the directory is made before the transport is built, and nothing rolls it
 * back."* So `+ New profile…`, a name, a mistyped folder and Send left a credential-bearing home on
 * disk, a profile permanently in the launcher's menu, and no conversation — while the page promised
 * *"It is created when the conversation starts, not now."*
 *
 * ⚠️ **Everything here runs the REAL provisioning and the REAL cwd rule.** Only the credential
 * SOURCE is a fixture, so that "no credential was copied" is a statement about a file that would
 * otherwise really be there. A test with `prepareProviderHome` stubbed to a path function — which is
 * what every existing host test does, and why none of them caught this — could not tell the two
 * orderings apart.
 */

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

describe('203 · a refused launch provisions nothing (195 H4)', () => {
  let userData: string
  let work: string
  let personalAuth: string
  let runtimes: Map<Provider, FakeRuntime>

  /** The real provisioning, with only the credential SOURCE swapped for a fixture. */
  async function realHome(provider: Provider, profileId: string): Promise<string> {
    return await prepareProviderHome(
      userData,
      { profileId, provider },
      {
        provisionCodexAuth: (home) => provisionCodexAuth(home, { sourceAuthPath: personalAuth }),
        claudeAuthHealth: () => ({ ok: true }),
      },
    )
  }

  function buildHost(): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => {
        const known = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, known)
        return known
      },
      prepareProviderHome: realHome,
      // ⚠️ **The PATH, and it stays synchronous** (243) — `prepareProviderHome` became
      // promise-returning with the lock; this seam is `deriveProviderHome` on its own, which is also
      // what the composition root wires and what makes the refusal below meaningful: reading a path
      // must not be able to create the home the test asserts was never made.
      providerHomePath: (provider, profileId) =>
        deriveProviderHome(userData, { profileId, provider }),
      // The real rule, not a path function: it is the thing that refuses.
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      listProfiles: () => listProfileIds(userData),
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'x',
        authNote: null,
        files: [],
      }),
    })
  }

  /** Through the WIRE, because that is the gesture: schema, dispatch, host. */
  const launch = (host: RuntimeHost, profileId: string, cwd: string): Promise<unknown> =>
    executeRuntimeCommand(host, new NullSink(), {
      kind: 'createSession',
      provider: 'codex',
      profileId,
      cwd,
    })

  const homeOf = (profileId: string): string =>
    join(userData, 'provider-homes', HOME_FOLDER, profileId, 'codex')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-refused-launch-'))
    work = join(userData, '..', 'nowhere')
    work = mkdtempSync(join(tmpdir(), 'brobot2-refused-work-'))
    personalAuth = join(work, 'personal-auth.json')
    writeFileSync(personalAuth, '{"OPENAI_API_KEY":"sk-not-a-real-key"}', { mode: 0o600 })
    runtimes = new Map()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  it('⛔ leaves no home and no credential when the folder does not exist', async () => {
    const host = buildHost()
    const missing = join(work, 'typo')
    expect(existsSync(missing), 'the fixture folder must really be missing').toBe(false)

    await expect(launch(host, 'painter', missing)).rejects.toThrow(/does not exist/)

    // Nothing on disk: not the home, not its parents, and — the one that matters — not the copy of
    // the user's Codex credential that `prepareProviderHome` makes for every Codex launch.
    expect(existsSync(homeOf('painter'))).toBe(false)
    expect(existsSync(join(homeOf('painter'), 'auth.json'))).toBe(false)
    expect(existsSync(join(userData, 'provider-homes'))).toBe(false)
    // …and the profile did not come into existence, which is the durable half: `listProfileIds`
    // reads the directories, so a poisoned set is one the launcher's menu offers forever.
    expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID])
  })

  it('…and the SAME launch with a folder that exists provisions exactly one home, with the credential', async () => {
    // The pairing. Without it, a host that refused every launch would pass the test above.
    const host = buildHost()
    const created = await launch(host, 'painter', work)
    expect((created as { cwd: string }).cwd).toBe(work)

    expect(existsSync(homeOf('painter'))).toBe(true)
    expect(existsSync(join(homeOf('painter'), 'auth.json'))).toBe(true)
    expect(listProfileIds(userData).sort()).toEqual([DEFAULT_PROFILE_ID, 'painter'])
    // Exactly one, not one per attempt: `provider-homes/default` holds this profile and nothing
    // a refused attempt left beside it.
    expect(readdirSync(join(userData, 'provider-homes', HOME_FOLDER))).toEqual(['painter'])
    await host.closeAll()
  })

  it('a launch that fails for a reason of its OWN still leaves the home — the order fixes one thing', async () => {
    // ⚠️ **The limit, stated rather than implied.** 203 reorders two steps; it does not add a
    // rollback. A provider that refuses AFTER the home is provisioned still leaves it, exactly as
    // before — `provider-homes.ts`'s "nothing rolls it back" is still true of everything downstream
    // of the swap. Asserting it here is what stops the response doc claiming more than was done.
    const host = buildHost()
    runtimes.set(
      'codex',
      Object.assign(new FakeRuntime('codex'), {
        start: () => Promise.reject(new Error('the provider refused')),
      }) as unknown as FakeRuntime,
    )

    await expect(launch(host, 'painter', work)).rejects.toThrow(/the provider refused/)
    expect(existsSync(homeOf('painter')), 'the home a failed SPAWN leaves is out of scope').toBe(
      true,
    )
  })

  describe('the launcher can ask the question before the press (203)', () => {
    const check = (host: RuntimeHost, path: string): Promise<CwdVerdict> =>
      executeRuntimeCommand(host, new NullSink(), { kind: 'checkCwd', path }) as Promise<CwdVerdict>

    it('⛔ answers exactly what the launch answers, over the same corpus', async () => {
      // The anti-drift pairing, and the reason `checkCwd` calls `resolveCwd` rather than sharing a
      // function with it: this asserts the two agree on every case, so a launcher that lights Send
      // over a folder the launch refuses is a failing test rather than a report.
      const host = buildHost()
      // ⚑ `726` · R92 removed the app-data refusal, so the corpus lost its
      // `<userData>/provider-homes` case: it is accepted now, by both.
      const corpus = [
        work,
        join(work, 'typo'),
        personalAuth, // a file, not a directory
      ]

      for (const path of corpus) {
        const verdict = await check(host, path)
        const launched = await launch(host, DEFAULT_PROFILE_ID, path).then(
          () => true,
          () => false,
        )
        expect(verdict.ok, `checkCwd and the launch disagreed about ${path}`).toBe(launched)
        if (!verdict.ok) {
          // The sentence is the rule's own, verbatim — 076 §3's promise, kept for the typed half.
          expect(verdict.reason).toMatch(/does not exist|not a directory/)
        }
      }
      await host.closeAll()
    })

    it('⚠️ a blank folder is ok and provisions nothing — a keystroke must not make a directory', async () => {
      // `resolveCwd`'s blank branch calls `ensureWorkspace`, which CREATES it. `checkCwd`
      // short-circuits above that for exactly this reason: the box is blank for most of its life,
      // and every check of it would otherwise be a write.
      const host = buildHost()
      const verdict = await check(host, '   ')
      expect(verdict).toEqual({ ok: true, path: '' })
      expect(existsSync(brobotWorkspace(userData))).toBe(false)
    })
  })
})
