import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, claudeProjectDirName, type SessionRef } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { nativeExportPath } from '../src/main/archive/export-session'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { childWorkRoot, readChildWork } from '../src/main/child-work'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

/**
 * 🔴 **731 · `706` F-5 — a Claude transcript is found where the CLI RECORDED it.**
 *
 * `706` taught the resume preflight what the bundled CLI's own resume does: look in the folder named
 * from the cwd, then in every project folder, because the id is Claude's own UUID and a symlinked,
 * moved or very long working folder names a folder the CLI never wrote. ⛔ **`706` F-5**: the archive, the export and the child-work reader
 * still asked only the first folder, so such a conversation RESUMED and was never archived, its
 * children were `gone`, and its export landed where only a scan would find it.
 *
 * ⚑ Every flip below is RED on `main` for exactly that reason; every control is the ordinary case,
 * the same on both trees.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

const ID = 'fd4cb53c-79df-4db2-be37-4c7ce61c0cf8'
const LINES = `{"type":"user","sessionId":"${ID}"}\n{"type":"assistant","sessionId":"${ID}"}\n`

let dir: string

beforeEach(() => {
  // Real, because macOS resolves `/tmp` to `/private/tmp` and the lookups hand back real paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-731-')))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Put `<id>.jsonl` in one project folder of `home`, and say where. */
function plant(home: string, folder: string, id = ID, text = LINES): string {
  const path = join(home, 'projects', folder, `${id}.jsonl`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return path
}

function refAt(cwd: string, id = ID): SessionRef {
  return { provider: 'claude', sessionId: id, cwd, rotation: 0 } as SessionRef
}

describe('the archive’s lookup (`nativeTranscriptPath`)', () => {
  it('🔴 finds a transcript the CLI recorded in ANOTHER folder — a symlink’s real path, a move', () => {
    const home = join(dir, 'home')
    // The cwd as given names `-work-link`; the CLI recorded the folder the link RESOLVED to.
    const recorded = plant(home, '-private-work-real')
    // ⛔ On `main`: `null`, so nothing was archived.
    expect(nativeTranscriptPath('claude', home, refAt('/work/link'))).toBe(recorded)
  })

  it('🔴 …and a very long one, in a folder the CLI named its own way', () => {
    const home = join(dir, 'home')
    const cwd = `/w/${'a'.repeat(240)}`
    // Whatever the CLI named the folder, the id finds it.
    const recorded = plant(home, 'a-folder-named-another-way')
    expect(nativeTranscriptPath('claude', home, refAt(cwd))).toBe(recorded)
  })

  it('⚑ THE CONTROL — the ordinary case is unchanged: the named folder, and first', () => {
    const home = join(dir, 'home')
    expect(nativeTranscriptPath('claude', home, refAt('/work/here'))).toBeNull()
    const named = plant(home, claudeProjectDirName('/work/here'))
    expect(nativeTranscriptPath('claude', home, refAt('/work/here'))).toBe(named)
    // ⚠️ Held twice: the folder named from the cwd wins, as the preflight's first lookup does.
    plant(home, '-a-folder-before-it-alphabetically')
    expect(nativeTranscriptPath('claude', home, refAt('/work/here'))).toBe(named)
    // …and another conversation's file is never this one's: the id is what is looked for.
    const nobody = '0b8b2c1e-0000-4000-8000-000000000000'
    expect(nativeTranscriptPath('claude', home, refAt('/work/else', nobody))).toBeNull()
  })
})

describe('the child-work root (`childWorkRoot`)', () => {
  const CHILD = 'a4d82f4376e9dd5c5'
  const CHILD_LINE = JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    agentId: CHILD,
    message: { role: 'assistant', content: [{ type: 'text', text: 'the child answered' }] },
  })

  it('🔴 sits beside the transcript the CLI RECORDED, so the children are found there', () => {
    const home = join(dir, 'home')
    const recorded = plant(home, '-private-work-real')
    const children = join(dirname(recorded), ID, 'subagents')
    mkdirSync(children, { recursive: true })
    writeFileSync(join(children, `agent-${CHILD}.jsonl`), `${CHILD_LINE}\n`)

    const root = childWorkRoot(home, refAt('/work/link'))
    // ⛔ On `main`: `<home>/projects/-work-link/<id>`, where nothing is, so the child read `gone`.
    expect(root).toBe(join(dirname(recorded), ID))
    const read = readChildWork(root, CHILD, 'transcript')
    expect(typeof read === 'string' ? read : read.text).toContain('the child answered')
  })

  it('⚑ THE CONTROL — with no transcript yet, the folder named from the cwd, as before', () => {
    const home = join(dir, 'home')
    expect(childWorkRoot(home, refAt('/work/here'))).toBe(
      join(home, 'projects', claudeProjectDirName('/work/here'), ID),
    )
  })
})

describe('the export’s folder (`nativeExportPath`)', () => {
  it('🔴 names the folder the CLI recorded the conversation in', () => {
    const recorded = join(dir, 'home', 'projects', '-private-work-real', `${ID}.jsonl`)
    // ⛔ On `main` the fifth argument did not exist, and the folder was named from the cwd.
    expect(nativeExportPath('claude', join(dir, 'out'), refAt('/work/link'), 0, recorded)).toBe(
      join(dir, 'out', 'projects', '-private-work-real', `${ID}.jsonl`),
    )
  })

  it('⚑ THE CONTROL — Codex is untouched by where the file was recorded', () => {
    const codex = nativeExportPath(
      'codex',
      join(dir, 'out'),
      { provider: 'codex', sessionId: ID, cwd: '/work/here', rotation: 0 } as SessionRef,
      0,
      join(dir, 'anything.jsonl'),
    )
    expect(codex.replaceAll('\\', '/')).toMatch(
      new RegExp(`/sessions/\\d{4}/\\d{2}/\\d{2}/rollout-.*-${ID}\\.jsonl$`),
    )
  })
})

describe('the whole round, through the host', () => {
  let db: AppDatabase
  let store: SessionStore
  let userData: string

  beforeEach(() => {
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
  })

  const homeOf = (provider: string, profileId: string): string =>
    join(userData, 'provider-homes', 'default', profileId, provider)

  function buildHost(): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      exportDirectory: () => join(dir, 'exports'),
      nativeTranscriptPath,
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: homeOf,
      providerHomePath: homeOf,
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })
  }

  /** Start a Claude conversation, let the "CLI" record it in `folder`, close it, export it. */
  async function aRound(folder: (named: string) => string): Promise<{
    exported: string
    note: string
    named: string
    recorded: string
  }> {
    const host = buildHost()
    const sink = new NullSink()
    const created = await host.createSession({ provider: 'claude', cwd: join(dir, 'work') }, sink)
    const ref = created.ref
    if (ref === null || ref === undefined) throw new Error('the fake gave no ref')
    const named = claudeProjectDirName(ref.cwd)
    // A conversation started with no profile runs in the default one's home.
    const recorded = plant(
      homeOf('claude', DEFAULT_PROFILE_ID),
      folder(named),
      ref.sessionId,
      `{"type":"user","sessionId":"${ref.sessionId}"}\n`,
    )
    await host.close(created.sessionId, sink)
    const written = await host.exportSession({ sessionId: created.sessionId, exportKind: 'native' })
    await host.closeAll()
    return { exported: written.path, note: written.note, named, recorded }
  }

  it('🔴 a conversation the CLI recorded in another folder is found, and exported there', async () => {
    const round = await aRound(() => '-private-somewhere-real')
    // ⛔ On `main` it was never found where the CLI recorded it (`706` F-5).
    expect(round.exported).toBe(
      join(dir, 'exports', 'projects', '-private-somewhere-real', basename(round.recorded)),
    )
    expect(readFileSync(round.exported, 'utf8')).toBe(readFileSync(round.recorded, 'utf8'))
  })

  it('⚑ THE CONTROL — the ordinary case exports as it always did', async () => {
    const round = await aRound((named) => named)
    expect(round.exported).toBe(
      join(dir, 'exports', 'projects', round.named, basename(round.recorded)),
    )
    expect(readFileSync(round.exported, 'utf8')).toBe(readFileSync(round.recorded, 'utf8'))
  })

  it('🔴 …and what a person is told says where Claude looks: this folder FIRST, then by id', async () => {
    // ⛔ On `main`: *"Claude finds a session by this exact path"* — the first half as if it were the
    // whole, since `706` taught the preflight what the CLI's own resume does.
    const round = await aRound((named) => named)
    expect(round.note).toContain('Claude looks for a session in this folder first, then by its id')
    expect(round.note).not.toContain('by this exact path')
  })
})
