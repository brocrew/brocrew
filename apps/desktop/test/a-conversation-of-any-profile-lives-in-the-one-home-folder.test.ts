import { neutralHostDeps } from './lib/host-fixture'
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

  const ops = (): ReturnType<typeof createProviderAuthOps> =>
    createProviderAuthOps(userData, { codexCommand: () => join(userData, 'no-such-codex') })

  it('the credential key of a gesture is the home under the one folder, for either provider and for the default profile too', async () => {
    expect(ops().credentialHome('codex', 'developer')).toBe(
      join(userData, 'provider-homes', 'default', 'developer', 'codex'),
    )
    expect(ops().credentialHome('claude', 'developer')).toBe(
      join(userData, 'provider-homes', 'default', 'developer', 'claude'),
    )

    expect(ops().credentialHome('codex', DEFAULT_PROFILE_ID)).toBe(
      join(userData, 'provider-homes', 'default', 'brobot', 'codex'),
    )

    expect(existsSync(join(userData, 'provider-homes'))).toBe(false)

    expect(() => ops().credentialHome('codex', 'a/b')).toThrow(/invalid profileId/)

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

  let asked: string[]

  async function realHome(provider: Provider, profileId: string): Promise<string> {
    return await prepareProviderHome(
      dir,
      { profileId, provider },

      {
        provisionHome: () => {},
        provisionCodexAuth: () => {},
        claudeAuthHealth: () => ({ ok: true }),
      },
    )
  }

  function buildHost(): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store,
      ...neutralHostDeps(() => dir),
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

    expect(work.providerHome).toBe(join(dir, 'provider-homes', 'default', 'work', 'codex'))
    expect(client.providerHome).toBe(join(dir, 'provider-homes', 'default', 'client', 'codex'))
    await first.close(work.sessionId, sink)
    await first.close(client.sessionId, sink)
    await first.closeAll()

    const relaunched = buildHost()
    asked.length = 0

    const workRead = relaunched.readConfigFile(work.sessionId, 'config.toml')
    expect(asked).toEqual([join(dir, 'provider-homes', 'default', 'work', 'codex')])

    expect(workRead).toMatchObject({ ok: true })
    expect(workRead.ok && workRead.text).toContain('# the home of work')
    expect(workRead.ok && workRead.text).not.toContain('# the home of client')

    asked.length = 0
    const clientRead = relaunched.readConfigFile(client.sessionId, 'config.toml')
    expect(asked).toEqual([join(dir, 'provider-homes', 'default', 'client', 'codex')])
    expect(clientRead).toMatchObject({ ok: true })
    expect(clientRead.ok && clientRead.text).toContain('# the home of client')
    expect(clientRead.ok && clientRead.text).not.toContain('# the home of work')

    expect(workHome).not.toBe(clientHome)
    await relaunched.closeAll()

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

function flat(source: string): string {
  return source.replace(/\s+/g, ' ').replace(/\(\s/g, '(')
}

function times(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

const PREPARE_SEAM =
  'prepareProviderHome: async (provider, profileId, signal) => { transcriptRetention?.beforeLaunch() return providerModules[provider].home.prepare(profileId, signal) },'
const FORBIDDEN_SEGMENT =
  /\(provider, profileId, (?!signal\b)\w+\) =>|\(provider, profileId, signal, \w+\) =>/
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

    expect(main.length, 'main/index.ts moved — re-point this').toBeGreaterThan(1000)
    expect(times(main, PREPARE_SEAM), 'the prepareProviderHome seam').toBe(1)
    expect(times(main, MODULE_PATHS), 'the bound provider paths').toBe(1)
    expect(times(main, PATH_SEAM), 'the providerHomePath seam').toBe(1)
    expect(times(main, PROFILES_SEAM), 'the listProfiles seam').toBe(1)
    expect(times(main, DISCOVERY_SEAM), 'the discoverSessions map').toBe(1)

    expect(times(main, 'providerModules[provider].home.prepare(profileId, signal)')).toBe(1)
    expect(times(main, 'deriveProviderHome(userData')).toBe(1)

    expect(main).not.toMatch(/HOME_FOLDER|['"]provider-homes['"]/)

    expect(main).not.toMatch(FORBIDDEN_SEGMENT)
  })

  it('the census has teeth: a seam that ignores the profile it is given is not the seam', () => {
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

    expect(flat(codeOf('prepareProviderHome: (provider, profileId, segment) => x'))).toMatch(
      FORBIDDEN_SEGMENT,
    )
    const main = flat(codeOf(readFileSync(MAIN, 'utf8')))
    expect(times(main, PREPARE_SEAM)).toBe(1)
    for (const defective of [
      main.replace(
        PREPARE_SEAM,
        PREPARE_SEAM.replace(
          '(provider, profileId, signal) =>',
          '(provider, profileId, segment) =>',
        ),
      ),
      main.replace(
        PREPARE_SEAM,
        PREPARE_SEAM.replace(
          '(provider, profileId, signal) =>',
          '(provider, profileId, signal, segment) =>',
        ),
      ),
    ]) {
      expect(defective).not.toBe(main)
      expect(defective).toMatch(FORBIDDEN_SEGMENT)
      expect(times(defective, PREPARE_SEAM)).toBe(0)
    }
    const withoutSignal = main.replace(
      PREPARE_SEAM,
      PREPARE_SEAM.replace('home.prepare(profileId, signal)', 'home.prepare(profileId)'),
    )
    expect(withoutSignal).not.toBe(main)
    expect(times(withoutSignal, PREPARE_SEAM)).toBe(0)
    expect(main).not.toMatch(FORBIDDEN_SEGMENT)
    expect(codeOf('// every home is under `HOME_FOLDER`\nconst a = 1')).not.toMatch(/HOME_FOLDER/)
    expect(codeOf("const root = 'provider-homes'")).toMatch(/['"]provider-homes['"]/)
  })
})
