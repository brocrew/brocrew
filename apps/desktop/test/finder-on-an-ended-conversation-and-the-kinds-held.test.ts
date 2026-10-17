import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { readProviderConfig } from '../src/main/runtime/provider-config'
import { refuseReply } from '../src/main/runtime/reply-rails'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  DOCUMENT_FORMS,
  FORM_OF_EXTENSION,
  HELD_FORMS_SAID,
  HELD_FORMS_WITH_EXTENSIONS_SAID,
} from '../src/shared/documents'

/**
 * 🔴 **736 · the same choices the CLI offers — the desktop half of the small items** (`733` F-4,
 * `733` F-5). The rulings' runtime halves — R94–R98 — are pinned where each adapter's own tests
 * live (`claude-runtime.test.ts`, `codex-runtime.test.ts`, `the-cli-decides-what-to-ask.test.ts`),
 * and measured on the loopback (`probe:tool-calls-as-the-cli`, `probe:codex-mcp-tool-approval`).
 *
 * ⛔ **No real home, no real credential**: every home here is a scratch dir, and the one `auth.json`
 * is a dummy.
 */

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/* ------------------------------------------ §1 · `733` F-5 — Finder on an ENDED conversation */

describe('§1 · an ended conversation’s paths are revealed from its ledger row (`733` F-5)', () => {
  let userData: string
  let home: string
  let db: AppDatabase
  let host: RuntimeHost
  const revealed: string[] = []

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-736-'))
    home = join(userData, 'provider-homes', 'codex')
    mkdirSync(home, { recursive: true })
    mkdirSync(join(userData, 'work'), { recursive: true })
    revealed.length = 0
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    let counter = 0
    host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: () => home,
      providerHomePath: () => home,
      resolveCwd: (_sessionId, requested) => requested ?? join(userData, 'work'),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig,
      revealPath: (path) => revealed.push(path),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const anEndedConversation = async (): Promise<string> => {
    const sink = new NullSink()
    const created = await host.createSession(
      { provider: 'codex', cwd: join(userData, 'work') },
      sink,
    )
    await host.close(created.sessionId, sink)
    return created.sessionId
  }

  it('🔴 its folder, its home and a config file it lists are revealed — from the row, not a slot', async () => {
    // ⛔ On `main`: every press answered `no-path` — *"this session has no such path"* — once
    // closing had removed the slot, though the panel still drew each row (and its Open read them,
    // `733`).
    writeFileSync(join(home, 'auth.json'), '{ "note": "a dummy, in a scratch home" }\n')
    const id = await anEndedConversation()

    expect(host.revealPath(id, { of: 'cwd' })).toEqual({ ok: true, path: join(userData, 'work') })
    expect(host.revealPath(id, { of: 'home' })).toEqual({ ok: true, path: home })
    expect(host.revealPath(id, { of: 'config-file', name: 'auth.json' })).toEqual({
      ok: true,
      path: join(home, 'auth.json'),
    })
    expect(revealed).toEqual([join(userData, 'work'), home, join(home, 'auth.json')])
    // …and a file the row names that is not there is `gone`, as for a live one.
    expect(host.revealPath(id, { of: 'config-file', name: 'config.toml' })).toEqual({
      ok: false,
      reason: 'gone',
    })
  })

  it('⚑ THE CONTROLS — a provider-reported source still names nothing once ended, and an unknown id nothing at all', async () => {
    // ⚑ The provider's own instruction list lives on the live handle and is never recorded, so an
    // ended conversation's provider row has no path to reveal — said, not guessed.
    const id = await anEndedConversation()
    expect(host.revealPath(id, { of: 'instruction-source', index: 0 })).toEqual({
      ok: false,
      reason: 'no-path',
    })
    expect(host.revealPath('sess_nobody', { of: 'cwd' })).toEqual({ ok: false, reason: 'no-path' })
    expect(revealed).toEqual([])
  })
})

/* -------------------------------- §2 · `733` F-4 — the kinds of file a model is told the store holds */

describe('§2 · the long form is any kind of file this app holds, rendered from the list (`733` F-4)', () => {
  it('🔴 the refusal names every kind, and no longer says the file must be Markdown', () => {
    // ⛔ On `main`: *"Put the long form in a Markdown file"* — while the store took pages, images
    // and PDFs as well (`HO-097`).
    const said = refuseReply('summary-too-long').reason
    // ⚑ D-016 · the long form is a RESOURCE now, so its path goes in `resource_paths` rather than
    // being quoted in the summary.
    expect(said).toContain(`Put the rest in ${HELD_FORMS_SAID} and name its path in resource_paths`)
    expect(said).not.toContain('in a Markdown file and')
    expect(HELD_FORMS_SAID).toBe('a Markdown file, a page, an image or a PDF')
  })

  // ⚑ Not a control — a pin on the rendering itself, which exists only since `736`.
  it('⚑ the words are RENDERED from the store’s own list, so a kind added there is said here', () => {
    // Every extension the store takes is in the tool's words, and every form the store knows.
    for (const extension of Object.keys(FORM_OF_EXTENSION)) {
      expect(HELD_FORMS_WITH_EXTENSIONS_SAID, extension).toContain(extension)
    }
    expect(DOCUMENT_FORMS.length).toBe(4)
    expect(HELD_FORMS_WITH_EXTENSIONS_SAID).toBe(
      'a Markdown file (.md), a page (.html, .htm), an image (.png, .jpg, .jpeg, .gif, .webp, .svg) or a PDF (.pdf)',
    )
  })
})
