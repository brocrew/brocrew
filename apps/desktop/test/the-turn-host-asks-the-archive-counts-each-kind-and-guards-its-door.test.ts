import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

/**
 * # f5980ebc · 791f5ca9 · F093 R1 — the host asks the archive, counts each kind apart, and its door
 *
 * `turn-as-sent.test.ts` §4 reads a file that holds the message, or no file at all; it never mixes
 * a turn read from the record with one handed over; its only compaction is `/compact` exactly; and
 * its door is a source-read of `requireAPerson`. These are what it leaves:
 *
 *  - §1 · 🔴 a file that does not hold the message is the last word: nothing else holds a copy, so
 *    the file's own answer is the answer.
 *  - §2 · ⚑ Codex: an imported turn and a handed-over turn with the same words are each counted
 *    with their own kind — the importer's words are not the block, so the handed-over one is the
 *    file's first of its kind. (⚠️ The Claude shape of this is a real defect, reported apart and
 *    not written here: on Claude both kinds match a string content exactly, so the count by kind
 *    finds the imported message for the handed-over turn.)
 *  - §3 · ⛔ a person's `/compact` on Codex, with the spaces a person types around it, is still the
 *    compaction — ⚑ and on Claude, or with more words, it is not.
 *  - §4 · ⛔ the door (`whatTheModelGot`): a place is a whole number from 0 — never negative, never
 *    a fraction.
 */

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures', 'turn-as-sent')
const lines = (name: string): string[] =>
  readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((line) => line !== '')

const FIRST = 'W4157-PERSON Please plan the next release.'

type Json = Record<string, unknown>
const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a Claude Code line is the `user` record whose string content carries `words`. */
function isTheClaudeMessage(line: string, words: string): boolean {
  const record = JSON.parse(line) as unknown
  if (!isJson(record) || record['type'] !== 'user') return false
  const message = record['message']
  const content = isJson(message) ? message['content'] : undefined
  return typeof content === 'string' && content.includes(words)
}

/** The text the Claude fixture's message carrying `words` was handed over with, exactly. */
function claudeSentIn(all: readonly string[], words: string): string {
  for (const line of all) {
    if (!isTheClaudeMessage(line, words)) continue
    const record = JSON.parse(line) as Json
    const message = record['message']
    const content = isJson(message) ? message['content'] : undefined
    if (typeof content === 'string') return content
  }
  throw new Error(`no message carries ${words}`)
}

/** One Codex `response_item` message in this role, one text block per text. */
const codexMessage = (role: string, ...texts: string[]): string =>
  JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      content: texts.map((text) => ({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text,
      })),
    },
  })
const codexEvent = (kind: string): string =>
  JSON.stringify({ type: 'event_msg', payload: { type: kind } })

describe('F093 R1 · the host: the archive, each kind counted apart, a compaction', () => {
  const migrationsDir = join(here, '../src/main/db/migrations')
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let nativeFile: string | null
  let clock = 1_000
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-turn-host-edges-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    store = createSessionStore(db, tick)
    nativeFile = null
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => nativeFile,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_turn_${String(tick())}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** A fixture's lines as this conversation's provider record: its provider id made this one's. */
  function asThisLife(name: string, life: string): string[] {
    const all = lines(name)
    const theirs = name.startsWith('claude')
      ? /"sessionId":"([^"]+)"/.exec(all.join('\n'))?.[1]
      : /"id":"([^"]+)"/.exec(all[0] ?? '')?.[1]
    return all.map((line) => line.split(theirs ?? '\u0000').join(life))
  }

  /** A conversation planted in the ledger, its launch named `life-b`, with these rows after it. */
  function planted(id: string, provider: Provider, rows: readonly object[]): void {
    const cwd = join(userData, 'w')
    store.create({
      id,
      provider,
      cwd,
      approvalMode: 'ask',
      profileId: 'planted',
      launchedAs: 'life-b',
    })
    expect(store.nameItsLaunch(id, { provider, sessionId: 'life-b', cwd, rotation: 0 })).toBe(true)
    for (const [index, event] of [{ type: 'launched' }, ...rows].entries()) {
      store.append(id, index + 1, event as Parameters<SessionStore['append']>[2], tick())
    }
  }

  /** ⚑ The provider's file, where the record guard takes it as this profile's. */
  function theFile(provider: Provider, all: readonly string[]): void {
    nativeFile =
      provider === 'claude'
        ? join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
        : join(
            userData,
            'provider-homes',
            'codex',
            'sessions',
            '2026',
            '10',
            '05',
            'rollout-x.jsonl',
          )
    mkdirSync(dirname(nativeFile), { recursive: true })
    writeFileSync(nativeFile, `${all.join('\n')}\n`)
  }

  const CLAUDE_FIRST = claudeSentIn(lines('claude-transcript.jsonl'), FIRST)

  it('🔴 a file that does not hold the message: the file’s own answer is the answer', async () => {
    planted('sess_lacks', 'claude', [
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      { type: 'turn', state: 'completed' },
    ])
    const whole = asThisLife('claude-transcript.jsonl', 'life-b')
    const without = whole.filter((line) => !isTheClaudeMessage(line, FIRST))
    // ⚑ The premise: exactly the message's line is gone from the file.
    expect(without).toHaveLength(whole.length - 1)
    theFile('claude', without)
    expect(await host.turnAsSent('sess_lacks', 2)).toEqual({
      found: false,
      why: 'No message in Claude Code’s own record of the conversation has exactly the text this app handed over.',
    })
    // ⚑ The control: the whole file holds it, and it is found there.
    theFile('claude', whole)
    const turn = await host.turnAsSent('sess_lacks', 2)
    if (!turn.found) throw new Error(turn.why)
    expect(turn.message).toBe(CLAUDE_FIRST)
  })

  it('⚑ Codex: a turn read from the record and a turn handed over with the same words are each the file’s first of their kind', async () => {
    // ⚑ What Codex put around the person's words (`REQUEST_MARKER`): the importer keeps `hello`.
    const imported = 'Context.\n\n## My request for Codex:\nhello'
    planted('sess_mixed', 'codex', [
      { type: 'user_turn', text: 'hello', attribution: 'provider_transcript' },
      { type: 'turn', state: 'completed' },
      { type: 'user_turn', text: 'hello', sent: 'hello' },
      { type: 'turn', state: 'completed' },
    ])
    theFile('codex', [
      JSON.stringify({ type: 'session_meta', payload: { id: 'life-b' } }),
      codexEvent('task_started'),
      codexMessage('user', imported),
      codexMessage('assistant', 'Noted.'),
      codexEvent('task_complete'),
      codexEvent('task_started'),
      codexMessage('user', 'hello'),
      codexMessage('assistant', 'Noted.'),
      codexEvent('task_complete'),
    ])
    // ⚑ The imported turn: its record, whole.
    const first = await host.turnAsSent('sess_mixed', 2)
    expect(first.found && first.message).toBe(imported)
    // 🔴 The handed-over turn: the first handed over with `hello` — the imported one before it is
    // of the other kind, and does not count.
    const second = await host.turnAsSent('sess_mixed', 4)
    if (!second.found) throw new Error(second.why)
    expect(second.message).toBe('hello')
    expect(second.parts).toEqual([
      { author: 'the-message', label: 'user', role: 'user', text: 'hello', title: 'The message' },
    ])
  })

  it('⛔ a person’s /compact on Codex, with the spaces typed around it, is the compaction — ⚑ on Claude, or with more words, it is not', async () => {
    const COMPACTION = 'This was a command for Codex’s own compaction. No words reached the model.'
    const NO_COPY =
      'This app kept no copy of the text it handed over for this message — it was sent before this app kept one, or keeping it failed — so it cannot be matched exactly in the provider’s own record.'
    for (const [index, typed] of ['/compact ', '  /compact\n'].entries()) {
      planted(`sess_compact_${String(index)}`, 'codex', [{ type: 'user_turn', text: typed }])
      expect(await host.turnAsSent(`sess_compact_${String(index)}`, 2), typed).toEqual({
        found: false,
        why: COMPACTION,
      })
    }
    // ⚑ The controls: Claude's /compact is not Codex's, and more words are a message.
    planted('sess_compact_claude', 'claude', [{ type: 'user_turn', text: '/compact ' }])
    expect(await host.turnAsSent('sess_compact_claude', 2)).toEqual({ found: false, why: NO_COPY })
    planted('sess_compact_more', 'codex', [{ type: 'user_turn', text: '/compact now' }])
    expect(await host.turnAsSent('sess_compact_more', 2)).toEqual({ found: false, why: NO_COPY })
  })
})

describe('F093 R1 · ⛔ the door: a place is a whole number from 0', () => {
  it('⛔ a negative place, or a fraction, is refused at the boundary — ⚑ 0 and a later place are taken', () => {
    const asked = (ordinal: unknown) =>
      runtimeCommandSchema.safeParse({ kind: 'whatTheModelGot', sessionId: 's', ordinal }).success
    // ⚑ The controls: the first place, and a later one.
    expect(asked(0)).toBe(true)
    expect(asked(7)).toBe(true)
    for (const bad of [-1, 1.5, -0.5]) expect(asked(bad), String(bad)).toBe(false)
    // ⛔ …and a conversation must be named.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'whatTheModelGot', sessionId: '', ordinal: 0 })
        .success,
    ).toBe(false)
  })
})
