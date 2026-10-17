import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * ⛔ **168 M6 · a conversation older than the `profile_id` column loses its images** (188 §1).
 *
 * `imageResolver` refused every row whose profile is null. Two unrelated rows wear that value, and
 * `session-store.ts` says so in the type itself: *"Null for rows written before profiles could be
 * chosen — **they ran in the default one**"*, and separately `foundInUserHome` — `adopted_at`
 * non-null AND `profile_id` null — for a conversation swept out of `~/.claude` / `~/.codex`.
 *
 * Only the second has no home of ours. The first is sitting in `provider-homes/default/codex`
 * right now, and its generated images were dropped on every re-derivation with nothing said. ⚑ The
 * app had already settled this everywhere else: `providerHomePath`, `resumeSession` and
 * `attachHeldSession` all read a null profile as `default`.
 */
describe('a pre-profile Codex row still finds its generated images (168 M6)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  const SESSION = 'sess_legacy_images'
  const THREAD = 'th_legacy'
  const CALL = 'call_lighthouse'

  /** A rollout in the shape 067 measured: the id IS the filename, and the bytes are never read. */
  const rollout = (savedPath?: string): string[] => [
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-08-05T03:13:00.000Z',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'draw' }] },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-05T03:14:00.000Z',
      payload: {
        type: 'image_generation_end',
        call_id: CALL,
        status: 'completed',
        revised_prompt: 'a lighthouse',
        result: 'A'.repeat(64),
        ...(savedPath === undefined ? {} : { saved_path: savedPath }),
      },
    }),
  ]

  const host = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      // ⚑ **`<root>/<projectId>/<profileId>/<provider>` — the real layout, not a shortened one**, so
      // the naming-convention candidate is built where the app builds it. (Until `726` the asset
      // door also anchored `generated_images` at the fourth segment below the root; R92 removed it.)
      providerHomesRoot: () => join(dir, 'homes'),
      prepareProviderHome: (provider, profileId) =>
        join(dir, 'homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) => join(dir, 'homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, sessionId),
      newSessionId: () => SESSION,
      readProviderConfig: (_p, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })

  /** A session's rollout, written where the pass below reads it. */
  const rolloutOf = (id: string): string => join(dir, `${id}.jsonl`)
  const plantRollout = (id: string, lines: string[]): void => {
    writeFileSync(rolloutOf(id), `${lines.join('\n')}\n`)
  }

  /** The private pass `adoptSessions` and `importRecordedSession` both reach (as `import-codex`). */
  const importTranscript = (id: string): Promise<unknown> =>
    (
      host() as unknown as {
        importTranscript(
          id: string,
          p: 'codex',
          path: string,
          cancelled: () => boolean,
        ): Promise<unknown>
      }
    ).importTranscript(id, 'codex', rolloutOf(id), () => false)
  const runImport = (): Promise<unknown> => importTranscript(SESSION)

  /** `generated_images/<threadId>/<call_id>.png` — the convention both measured files follow. */
  const plantImage = (profileDirectory: string): string => {
    const home = join(dir, 'homes', 'default', profileDirectory, 'codex')
    const at = join(home, 'generated_images', THREAD)
    mkdirSync(at, { recursive: true })
    const path = join(at, `${CALL}.png`)
    writeFileSync(path, Buffer.from('89504e470d0a1a0a', 'hex'))
    // ⚠️ REAL-PATHED, like 178's step 65: the temp root is `/var/...` and its real path is
    // `/private/var/...`. The door serves what it resolved, so that is what the ledger names.
    return realpathSync(path)
  }

  const imageEvent = (): Record<string, unknown> | undefined =>
    store.events(SESSION).find((entry) => entry.event.type === 'image')?.event as
      Record<string, unknown> | undefined

  beforeEach(() => {
    // ⚠️ REAL-PATHED at the root, like 178's step 65: macOS hands out `/var/...` and its real path
    // is `/private/var/...`. The asset door answers with the REAL path, so a lexical root would make
    // every path compared below differ by its spelling alone, and fail for that reason rather than
    // the one under test.
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-legacy-images-')))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
    store = createSessionStore(db)
    store.create({
      id: SESSION,
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: DEFAULT_PROFILE_ID,
    })
    // The ref carries the thread id the images are filed under. Written to the column directly
    // rather than through a `session` EVENT: an event would make the ledger non-empty, and this
    // pass exists precisely to fill an empty one — it would report `skipped` and prove nothing.
    db.prepare('UPDATE provider_session SET external_ref = ? WHERE id = ?').run(
      JSON.stringify({ provider: 'codex', sessionId: THREAD, cwd: dir, rotation: 0 }),
      SESSION,
    )
    plantRollout(SESSION, rollout())
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** What an old build left behind: a recording of ours with no profile and no adoption. */
  const makeLegacy = (): void => {
    db.prepare('UPDATE provider_session SET profile_id = NULL WHERE id = ?').run(SESSION)
  }

  /** A conversation swept out of the user's own home: adopted, and in no home of ours. */
  const makeUserHome = (): void => {
    db.prepare('UPDATE provider_session SET profile_id = NULL, adopted_at = ? WHERE id = ?').run(
      1_700_000_000_000,
      SESSION,
    )
  }

  it('⛔ resolves the image for a row whose profile is null because it PREDATES profiles', async () => {
    const planted = plantImage(DEFAULT_PROFILE_ID)
    makeLegacy()

    expect(await runImport()).toBe('imported')
    expect(imageEvent(), 'the image survived the re-derivation').toMatchObject({
      imageId: CALL,
      path: planted,
    })
  })

  it('⚑ …and resolves it for an ordinary profiled row, which is the paired positive', async () => {
    const planted = plantImage(DEFAULT_PROFILE_ID)

    expect(await runImport()).toBe('imported')
    expect(imageEvent()).toMatchObject({ imageId: CALL, path: planted })
  })

  it('⛔ but names NOTHING for a row found in the user’s own home', async () => {
    // The other null. A row found in the user's own home has no home of ours, so there is no
    // naming-convention place to look, and a rollout that carries no `saved_path` names nothing.
    // (`726` · R92: a claim it DOES carry is believed wherever it points — see the flip below.)
    plantImage(DEFAULT_PROFILE_ID)
    makeUserHome()

    expect(await runImport()).toBe('imported')
    const image = imageEvent()
    expect(image, 'the image itself is still recorded — only its path is withheld').toBeDefined()
    expect(image).not.toHaveProperty('path')
  })

  it('⚠️ and still names nothing when the file is not where the convention says', async () => {
    // The negative that keeps the two above honest: resolution is a real filesystem check, not a
    // string the row is trusted for. Nothing is planted.
    makeLegacy()

    expect(await runImport()).toBe('imported')
    expect(imageEvent()).not.toHaveProperty('path')
  })

  /**
   * A second recording of ours, carrying the provider's own `saved_path` claim — a new row rather
   * than new frames under the first, because the pass derives only what has no projection yet.
   */
  let recorded = 0
  const recordWithClaim = (savedPath: string, profileId: string | null): string => {
    recorded += 1
    const id = `sess_claim_${recorded}`
    store.create({
      id,
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: DEFAULT_PROFILE_ID,
    })
    db.prepare('UPDATE provider_session SET external_ref = ? WHERE id = ?').run(
      JSON.stringify({ provider: 'codex', sessionId: THREAD, cwd: dir, rotation: 0 }),
      id,
    )
    if (profileId === null) {
      db.prepare('UPDATE provider_session SET profile_id = NULL, adopted_at = ? WHERE id = ?').run(
        1_700_000_000_000,
        id,
      )
    }
    plantRollout(id, rollout(savedPath))
    return id
  }
  const importAndRead = async (id: string): Promise<Record<string, unknown> | undefined> => {
    const outcome = await importTranscript(id)
    expect(outcome, id).toBe('imported')
    return store.events(id).find((entry) => entry.event.type === 'image')?.event as
      Record<string, unknown> | undefined
  }
  const plantElsewhere = (name: string, bytes: Buffer): string => {
    const elsewhere = join(dir, 'elsewhere')
    mkdirSync(elsewhere, { recursive: true })
    const path = join(elsewhere, name)
    writeFileSync(path, bytes)
    return path
  }
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

  it('🔴 726 · R92 — names an image the provider SAVED outside every home of ours, on either kind of row', async () => {
    // ⛔ On `main` both named nothing: a claim was served only from under the provider-homes root
    // (067 acceptance 7), and a row in the user's own home had no resolver at all. R92: *"any path
    // a person or an agent names is opened if it exists and is readable"*.
    const saved = plantElsewhere('lighthouse.png', PNG)
    expect(
      await importAndRead(recordWithClaim(saved, DEFAULT_PROFILE_ID)),
      'a profiled row',
    ).toMatchObject({
      imageId: CALL,
      path: saved,
    })
    expect(
      await importAndRead(recordWithClaim(saved, null)),
      'a row in the user’s own home',
    ).toMatchObject({ imageId: CALL, path: saved })
  })

  it('⚑ 726 · R92 CONTROL — a claim that is not an image, or not there, still names nothing', async () => {
    // What keeps a claim from being a path is its TYPE and its existence, wherever it points.
    const notImage = await importAndRead(
      recordWithClaim(plantElsewhere('notes.json', Buffer.from('{}')), null),
    )
    expect(notImage, 'the image itself is still recorded').toBeDefined()
    expect(notImage).not.toHaveProperty('path')
    const missing = await importAndRead(
      recordWithClaim(join(dir, 'elsewhere', 'never-written.png'), null),
    )
    expect(missing).toBeDefined()
    expect(missing).not.toHaveProperty('path')
  })
})
