import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  DEFAULT_PROFILE_ID,
  createProviderAuthOps,
  deriveProviderHome,
  prepareProviderHome,
} from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

/**
 * # ⛔ A conversation of ANY profile lives in the one home folder (D-016a, commit 2)
 *
 * Until D-016 the folder between `provider-homes/` and the profile was a project's slug, looked up
 * per session and per identity. It is now one folder, {@link HOME_FOLDER} (`'default'`), and no
 * caller passes a segment any more. So the path of a home is a function of two things — the profile
 * and the provider — and there are three places that must agree on it without sharing a variable:
 *
 *  1. **the credential key** a sign-in, a re-copy and a check are admitted under
 *     (`ProviderAuthOps.credentialHome`), which is a NAME and must be the directory the gesture
 *     writes;
 *  2. **the home an ENDED conversation is read from** (`RuntimeHost.providerHomeFor`), which the
 *     Info panel's Open and Finder both use, and which must be the profile's the row records; and
 *  3. **the two seams and the profile list `main/index.ts` wires**, which is the one file that binds
 *     Electron and so cannot be mounted here.
 *
 * The expected paths are literals rather than values read from `HOME_FOLDER`, so renaming the
 * constant cannot silently change the oracle. Provider homes use `default`, and resume must
 * find a conversation where it originally ran.
 *
 * ⚠️ **The third is a source census and is named as one** (`one-way-to-stage.test.ts`'s shape). It
 * proves the seams are written as they must be, not that they work; the first two are what prove
 * the behaviour, and the last one proves the census can see a defect.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const MAIN = join(here, '../src/main/index.ts')

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

describe('a credential gesture is keyed by the home it writes (D-016a)', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-one-folder-key-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  /** The real ops over a deliberately absent codex binary, so nothing is ever launched. */
  const ops = (): ReturnType<typeof createProviderAuthOps> =>
    createProviderAuthOps(userData, { codexCommand: () => join(userData, 'no-such-codex') })

  it('the credential key of a gesture is the home under the one folder, for either provider and for the default profile too', async () => {
    expect(ops().credentialHome('codex', 'developer')).toBe(
      join(userData, 'provider-homes', 'default', 'developer', 'codex'),
    )
    expect(ops().credentialHome('claude', 'developer')).toBe(
      join(userData, 'provider-homes', 'default', 'developer', 'claude'),
    )
    // ⚑ The default profile is a profile like any other here: its folder is `default` and its
    // profile is `brobot`, and the two names are not to be confused with each other.
    expect(ops().credentialHome('codex', DEFAULT_PROFILE_ID)).toBe(
      join(userData, 'provider-homes', 'default', 'brobot', 'codex'),
    )
    // Asking is a NAME, not a provisioning: nothing was made, not even the managed root.
    expect(existsSync(join(userData, 'provider-homes'))).toBe(false)
    // An id that is not a path segment names no home at all, so it names no key either.
    expect(() => ops().credentialHome('codex', 'a/b')).toThrow(/invalid profileId/)

    // The paired positive: the gesture that REALLY provisions, against a profile that exists,
    // writes the directory the key named — so the key a gesture is admitted under and the place it
    // writes are one place in the one folder, and nothing else appeared beside it.
    mkdirSync(join(userData, 'provider-homes', 'default', 'developer', 'claude'), {
      recursive: true,
    })
    const key = ops().credentialHome('codex', 'developer')
    expect(existsSync(key)).toBe(false)
    await ops()
      .check('codex', 'developer')
      .catch(() => undefined)
    expect(existsSync(key)).toBe(true)
    expect(readdirSync(join(userData, 'provider-homes'))).toEqual(['default'])
  })
})

describe('an ended conversation is read from its own profile’s home (D-016a)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let runtimes: Map<string, FakeRuntime>
  /** The home `readProviderConfig` was handed, in order — what the assertions read. */
  let asked: string[]

  async function realHome(provider: Provider, profileId: string): Promise<string> {
    return await prepareProviderHome(
      dir,
      { profileId, provider },
      // No credential is read and no directory is made here (the test lays its own files down):
      // the path is what is under test.
      {
        provisionHome: () => {},
        provisionCodexAuth: () => {},
        claudeAuthHealth: () => ({ ok: true }),
      },
    )
  }

  /**
   * ⚠️ **The REAL derivation, not a profile-blind stub.** Most hosts in this suite wire
   * `providerHomePath` to something that ignores which profile it is asked about, which is exactly
   * what would let "every ended conversation reads the default profile's home" pass unseen.
   */
  function buildHost(): RuntimeHost {
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
      providerHomePath: (provider, profileId) => deriveProviderHome(dir, { profileId, provider }),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => {
        asked.push(home)
        return {
          home,
          homeEnv: 'CODEX_HOME',
          model: 'file-based',
          authNote: null,
          files: [{ name: 'config.toml', path: join(home, 'config.toml'), exists: true, note: '' }],
        }
      },
    })
  }

  /** Lay down a `config.toml` that says whose home it is in, so a read can be told apart by text. */
  function furnish(profileId: string): string {
    const home = join(dir, 'provider-homes', 'default', profileId, 'codex')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'config.toml'), `# the home of ${profileId}\n`)
    return home
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-one-folder-ended-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    runtimes = new Map()
    asked = []
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it("an ended conversation's files are read from the home of the profile its row records, in the one folder", async () => {
    const workHome = furnish('work')
    const clientHome = furnish('client')

    const first = buildHost()
    const sink = new NullSink()
    const work = await first.createSession({ provider: 'codex', profileId: 'work' }, sink)
    const client = await first.createSession({ provider: 'codex', profileId: 'client' }, sink)
    // The two were launched into the two homes the literal paths name, or the reads below would be
    // comparing against something the launch never used.
    expect(work.providerHome).toBe(join(dir, 'provider-homes', 'default', 'work', 'codex'))
    expect(client.providerHome).toBe(join(dir, 'provider-homes', 'default', 'client', 'codex'))
    await first.close(work.sessionId, sink)
    await first.close(client.sessionId, sink)
    await first.closeAll()

    // ⚑ A host that holds no slot at all: the only branch left is the ended one, which reads the
    // home off the LEDGER ROW. A host that still held the live session would answer from the
    // session's own home and never ask the row.
    const relaunched = buildHost()
    asked.length = 0

    const workRead = relaunched.readConfigFile(work.sessionId, 'config.toml')
    expect(asked).toEqual([join(dir, 'provider-homes', 'default', 'work', 'codex')])
    // ⚠️ `toContain`: the launch itself appends the memory gates to a Codex home's `config.toml`.
    expect(workRead).toMatchObject({ ok: true })
    expect(workRead.ok && workRead.text).toContain('# the home of work')
    expect(workRead.ok && workRead.text).not.toContain('# the home of client')

    asked.length = 0
    const clientRead = relaunched.readConfigFile(client.sessionId, 'config.toml')
    expect(asked).toEqual([join(dir, 'provider-homes', 'default', 'client', 'codex')])
    expect(clientRead).toMatchObject({ ok: true })
    expect(clientRead.ok && clientRead.text).toContain('# the home of client')
    expect(clientRead.ok && clientRead.text).not.toContain('# the home of work')

    // Two ended conversations of two profiles did not read one home.
    expect(workHome).not.toBe(clientHome)
    await relaunched.closeAll()

    // The paired positive: a row that records NO profile ran in the default profile's home — which
    // is `default/brobot`, the profile, and not `default/default`, the folder said twice.
    db.prepare('UPDATE provider_session SET profile_id = NULL WHERE id = ?').run(client.sessionId)
    const defaultHome = furnish(DEFAULT_PROFILE_ID)
    const reopened = buildHost()
    asked.length = 0

    const defaultRead = reopened.readConfigFile(client.sessionId, 'config.toml')
    expect(asked).toEqual([join(dir, 'provider-homes', 'default', 'brobot', 'codex')])
    expect(asked[0]).toBe(defaultHome)
    expect(asked[0]).not.toBe(join(dir, 'provider-homes', 'default', 'default', 'codex'))
    expect(defaultRead).toMatchObject({ ok: true })
    expect(defaultRead.ok && defaultRead.text).toContain(`# the home of ${DEFAULT_PROFILE_ID}`)
    expect(defaultRead.ok && defaultRead.text).not.toContain('# the home of client')
    await reopened.closeAll()
  })
})

/**
 * The file with comments removed — line comments and block comments.
 *
 * ⛔ Copied from `one-way-to-stage.test.ts`, for its reason: `main/index.ts` NAMES `HOME_FOLDER` in a
 * comment on purpose, and a census of what it SPELLS must not count prose.
 */
function codeOf(source: string): string {
  let inBlock: '*/' | null = null
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock !== null) {
          if (!rest.startsWith(inBlock)) continue
          at += inBlock.length - 1
          inBlock = null
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*')) {
          inBlock = '*/'
          at += 1
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}

/** Whitespace collapsed, so a census does not measure where the formatter chose to wrap. */
function flat(source: string): string {
  return source.replace(/\s+/g, ' ').replace(/\(\s/g, '(')
}

/** How many times `needle` occurs in `haystack` — the count, not merely whether. */
function times(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// The provider's bound home strategy prepares the profile it is given. The binding gets its paths
// from the same pure facade as the read seam; a recorded address preserves storage separately.
const PREPARE_SEAM =
  'prepareProviderHome: async (provider, profileId, recordedLocation) => { await transcriptRetention?.beforeLaunch() return providerModules[provider].home.prepare(profileId, recordedLocation) },'
const MODULE_PATHS =
  'const providerModules = createProviderModules((provider) => homePathsForProvider(userData, provider),'
const PATH_SEAM =
  'providerHomePath: (provider, profileId) => deriveProviderHome(userData, { profileId, provider }),'
const PROFILES_SEAM = 'listProfiles: (provider) => listProfileIds(userData, provider),'
const DISCOVERY_SEAM =
  'listProviderHomes(userData) .map((home) => discoverSessionsIn(home.provider, home.path, home.profileId))'

describe('main wires the home seams to the one folder (D-016a)', () => {
  it('main wires the two home seams and the profile list to the one folder and to nothing else', () => {
    const main = flat(codeOf(readFileSync(MAIN, 'utf8')))

    // ⚑ Presence first — every negative below rides on these, and a census that read nothing would
    // satisfy all of them.
    expect(main.length, 'main/index.ts moved — re-point this').toBeGreaterThan(1000)
    expect(times(main, PREPARE_SEAM), 'the prepareProviderHome seam').toBe(1)
    expect(times(main, MODULE_PATHS), 'the bound provider paths').toBe(1)
    expect(times(main, PATH_SEAM), 'the providerHomePath seam').toBe(1)
    expect(times(main, PROFILES_SEAM), 'the listProfiles seam').toBe(1)
    expect(times(main, DISCOVERY_SEAM), 'the discoverSessions map').toBe(1)

    // The folder has one author, provider-homes.ts: preparation receives its bound paths, while
    // reads use the pure derivation directly.
    expect(times(main, 'providerModules[provider].home.prepare(profileId, recordedLocation)')).toBe(
      1,
    )
    expect(times(main, 'deriveProviderHome(userData')).toBe(1)
    // …and main never spells the layout itself.
    expect(main).not.toMatch(/HOME_FOLDER|['"]provider-homes['"]/)
    // Only preparation takes a saved address; pure derivation keeps its two-argument shape.
    expect(main.match(/\(provider, profileId, \w+\) =>/g)).toHaveLength(1)
    expect(main).not.toMatch(/providerHomePath: \(provider, profileId, \w+\) =>/)
  })

  it('the census has teeth: a seam that ignores the profile it is given is not the seam', () => {
    // ⛔ Every assertion above is a string search. This runs the same helpers over source that has
    // the defect (main's providerHomePath always deriving the default profile's home) and requires
    // it to be visible, and runs them over the real shape to show the search can also say yes.
    const defective = [
      'providerHomePath: (provider, _profileId) =>',
      "  deriveProviderHome(userData, { profileId: 'brobot', provider }),",
    ].join('\n')
    const planted = flat(codeOf(defective))
    expect(times(planted, 'deriveProviderHome(userData')).toBe(1)
    expect(times(planted, PATH_SEAM)).toBe(0)

    const honest = flat(
      codeOf(
        [
          'providerHomePath: (provider, profileId) =>',
          '  deriveProviderHome(userData, { profileId, provider }),',
        ].join('\n'),
      ),
    )
    expect(times(honest, PATH_SEAM)).toBe(1)

    // A third parameter is seen by the pattern, and a comment that names the folder is not code.
    expect(flat(codeOf('prepareProviderHome: (provider, profileId, segment) => x'))).toMatch(
      /\(provider, profileId, \w+\) =>/,
    )
    expect(codeOf('// every home is under `HOME_FOLDER`\nconst a = 1')).not.toMatch(/HOME_FOLDER/)
    expect(codeOf("const root = 'provider-homes'")).toMatch(/['"]provider-homes['"]/)
  })
})
