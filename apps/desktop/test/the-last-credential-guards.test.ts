import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { refuseResource, resourceRemedyOf } from '../src/main/resources/resources'
import { readProviderConfig } from '../src/main/runtime/provider-config'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { isRefusalRemedy } from '../src/shared/refusals'
import type { ToolRefusedEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **733 · the last credential guards** — `731` F-2 and F-4, under R92 and R93.
 *
 * A path named by a person or agent is opened if it exists and is readable, with no app-added
 * file or folder restriction.
 *
 * ⚑ `731` F-3 (the two link rules) is held where each reader's own tests live —
 * `instructions.test.ts`, `memory-notes.test.ts` and `the-same-kilobyte-once.test.ts` — beside the
 * controls for the two link rules that stay (a loop, a missing target).
 *
 * ⛔ **Every file named `auth.json` here is a dummy in a scratch home**, never a real credential
 * and never anybody's provider home (the standing security block).
 */

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

const DUMMY = '{ "note": "a dummy file named auth.json, in a scratch home" }\n'

/* -------------------------------------------------------------- §1 · `731` F-2, the Open */

describe('§1 · a config file the Info panel lists opens like any other file (`731` F-2)', () => {
  let userData: string
  let home: string
  let db: AppDatabase
  let host: RuntimeHost
  const revealed: string[] = []

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-733-'))
    // ⚑ **The home is reached through a LINK** (review of `733`), so a door that reported the path
    // it resolved instead of the row's own is caught on every platform — not only where `/var` is
    // really `/private/var`.
    const realHome = join(userData, 'provider-homes', 'codex-real')
    mkdirSync(realHome, { recursive: true })
    home = join(userData, 'provider-homes', 'codex')
    symlinkSync(realHome, home)
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
      // ⚑ **The product's own reader**, so the files the Open reaches are the ones the panel lists.
      readProviderConfig,
      revealPath: (path) => revealed.push(path),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const aCodexSession = async (): Promise<string> =>
    (await host.createSession({ provider: 'codex', cwd: join(userData, 'work') }, new NullSink()))
      .sessionId

  it('🔴 `auth.json` opens on the app’s paper — by the NAME the panel drew, never a path', async () => {
    writeFileSync(join(home, 'auth.json'), DUMMY)
    const id = await aCodexSession()

    // ⛔ On `main` there is no such door: the panel offered Finder and nothing else, and said why in
    // a credential's terms (*"Reveal, never open, and the difference is a credential"*).
    expect(host.readConfigFile(id, 'auth.json')).toEqual({
      ok: true,
      path: join(home, 'auth.json'),
      name: 'auth.json',
      text: DUMMY,
      truncated: false,
      bytes: Buffer.byteLength(DUMMY),
    })
  })

  it('🔴 …and so does every other file the config declares, by the same door', async () => {
    writeFileSync(join(home, 'config.toml'), 'model = "a-model"\n')
    const id = await aCodexSession()

    const read = host.readConfigFile(id, 'config.toml')
    expect(read.ok && read.text).toBe('model = "a-model"\n')
  })

  it('🔴 …and what it cannot open, it says why, in the words the reveal and the text door use', async () => {
    // A binary cannot be drawn as text (`731`'s one type check, and a reason about DRAWING).
    writeFileSync(join(home, 'auth.json'), Buffer.from([0x7b, 0x00, 0x7d]))
    const id = await aCodexSession()

    expect(host.readConfigFile(id, 'auth.json')).toEqual({ ok: false, reason: 'not-readable' })
    // A declared file that is not there is `gone`, as its reveal is.
    expect(host.readConfigFile(id, 'config.toml')).toEqual({ ok: false, reason: 'gone' })
    // ⛔ **The name is the confinement.** A name the config does not declare reaches nothing, even
    // with a readable file sitting at it in the same home — there is no path behind a guessed
    // string — and neither does an id this app has no record of.
    writeFileSync(join(home, 'not-declared.txt'), 'a file the config does not list\n')
    expect(host.readConfigFile(id, 'not-declared.txt')).toEqual({ ok: false, reason: 'no-path' })
    expect(host.readConfigFile(id, '../../auth.json')).toEqual({ ok: false, reason: 'no-path' })
    expect(host.readConfigFile('sess_nobody', 'auth.json')).toEqual({
      ok: false,
      reason: 'no-path',
    })
  })

  it('🔴 …and an ENDED conversation’s file opens too — its home comes from its ledger row', async () => {
    // ⛔ Review of `733`: closing removes the slot, and the panel still draws the config rows —
    // so a door that asked only the slot answered `no-path` under a file drawn as present.
    writeFileSync(join(home, 'auth.json'), DUMMY)
    const sink = new NullSink()
    const created = await host.createSession(
      { provider: 'codex', cwd: join(userData, 'work') },
      sink,
    )
    await host.close(created.sessionId, sink)

    const read = host.readConfigFile(created.sessionId, 'auth.json')
    expect(read.ok && read.text).toBe(DUMMY)
  })

  it('⚑ THE CONTROL — Finder is unchanged: the same row, the same string, and nothing read', async () => {
    writeFileSync(join(home, 'auth.json'), DUMMY)
    const id = await aCodexSession()

    expect(host.revealPath(id, { of: 'config-file', name: 'auth.json' })).toEqual({
      ok: true,
      path: join(home, 'auth.json'),
    })
    expect(revealed).toEqual([join(home, 'auth.json')])
    // ⚑ …and the LIST the panel draws still carries no content: a file's bytes cross only when a
    // person presses its Open (`a-sentence-the-product-can-be-held-to.test.ts`).
    const config = readProviderConfig('codex', home)
    expect(config.files.find((file) => file.name === 'auth.json')?.exists).toBe(true)
    expect(JSON.stringify(config)).not.toContain('a dummy file named auth.json')
  })
})

/* ------------------------------------------------------ §2 · `731` F-4, the remedy's words */

describe('§2 · the resource rails’ remedy, in words that state no condition that is gone (`731` F-4)', () => {
  const WORD = 'offer-a-workspace-markdown-file-that-reads'

  /** The one line a `tool_refused` row carrying `remedy` draws for a person. */
  const lineFor = (remedy: string): string => {
    const state = createTranscript()
    applyEvent(state, {
      type: 'tool_refused',
      tool: 'report_work',
      rail: 'resource-too-large',
      permanence: 'while-this-holds',
      retryable: true,
      remedy,
    } as ToolRefusedEvent)
    const [item] = state.items
    if (item === undefined || item.kind !== 'notice') throw new Error('the row drew no notice')
    return (item as NoticeItem).text
  }

  it('🔴 a person reads the act the model is told — a file of a type the store holds, anywhere', () => {
    const line = lineFor(WORD)
    // ⛔ On `main`: *"… · it can offer a different Markdown file"* — the store holds more types than
    // Markdown (`HO-097`), and *workspace* went with `726` · R92.
    expect(line).not.toMatch(/markdown/i)
    expect(line).not.toMatch(/workspace/i)
    expect(
      line.endsWith(' · it can write a file of a type this app holds and offer that instead'),
    ).toBe(true)
    // ⚑ **The same act as the model's sentence**, not a second opinion about it: both registers
    // name a file of a type this app holds, and the model's never said Markdown either.
    for (const rail of [
      'resource-unreadable',
      'resource-too-large',
      'resource-empty',
      'resource-not-text',
    ] as const) {
      const said = refuseResource(rail)
      expect(said.remedy, rail).toBe(WORD)
      expect(said.reason, rail).toContain(
        'Write a file and offer that path instead — one of the types this app holds',
      )
      expect(said.reason, rail).not.toMatch(/markdown|workspace/i)
    }
  })

  it('⚑ THE CONTROL — the stored code word is kept, and read back, and the other clauses are as they were', () => {
    // ⚑ The PM: *"The stored code word may stay as a code."* It is in `tool_refused` rows already
    // written, and a build that stopped recognising it would draw those rows with no remedy at all.
    expect(isRefusalRemedy(WORD)).toBe(true)
    expect(resourceRemedyOf('resource-empty')).toBe(WORD)
    expect(lineFor('shorten-the-summary-and-attach-the-long-form')).toMatch(
      / · it can shorten the summary and put the long form in a file it names$/,
    )
  })
})
