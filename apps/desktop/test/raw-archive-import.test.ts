import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NORMALIZER_VERSION } from '../src/main/archive/normalizer'
import { FakeRuntime, FileEdits, claudeProjectDirName } from '@brobot2/runtime'
// Reached by path on purpose: the normalizer is not on the runtime package's public surface, and
// 088 may not change that package. Importing it HERE keeps the app's own mapping honest without
// widening what the app depends on.
import { normalizeMessage } from '../../../packages/runtime/src/claude/normalize'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  NO_DISCOVERY,
  discoverSessionsIn,
  type Discovery,
} from '../src/main/adopt/discover-sessions'
import { importClaudeTranscript } from '../src/main/archive/import-claude'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { listProviderHomes } from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { AssistantItem, ToolItem, UserItem } from '../src/renderer/src/lib/transcript'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'

/**
 * The transcript import, read from the provider's own file (088).
 *
 * The fixture is a **real** Claude transcript — a copy of one this machine actually produced,
 * committed alongside the test — because the whole slice is a claim about what those files
 * contain. A synthetic one would only prove the parser agrees with the fixture I invented.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

describe('transcript import from the provider’s own file', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  /** The fixture's own session id and cwd, read out of it rather than restated here. */
  let fixture: { sessionId: string; cwd: string; lines: string[] }

  function claudeHome(profileId = 'default'): string {
    return join(userData, 'provider-homes', 'default', profileId, 'claude')
  }

  /** Put the real transcript where Claude would have put it. */
  function plantFixture(profileId = 'default'): string {
    const projectDir = join(claudeHome(profileId), 'projects', claudeProjectDirName(fixture.cwd))
    mkdirSync(projectDir, { recursive: true })
    const path = join(projectDir, `${fixture.sessionId}.jsonl`)
    writeFileSync(path, readFileSync(FIXTURE))
    return path
  }

  function discoverEverything(): Discovery {
    return listProviderHomes(userData)
      .map((home) => discoverSessionsIn(home.provider, home.path, home.profileId))
      .reduce<Discovery>(
        (all, part) => ({
          found: [...all.found, ...part.found],
          skipped: [...all.skipped, ...part.skipped],
        }),
        { found: [], skipped: [] },
      )
  }

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: discoverEverything,
      exportDirectory: () => join(userData, 'exports'),
      nativeTranscriptPath,
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-archive-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)

    // Split the way the line reader does — every line, minus the empty piece after the last
    // newline — rather than `.filter(Boolean)`, which would drop blanks on both sides and make the
    // count agree with itself instead of with the file.
    const lines = readFileSync(FIXTURE, 'utf8').split('\n')
    if (lines.at(-1) === '') lines.pop()
    const named = lines
      .map((line) => JSON.parse(line) as { sessionId?: string; cwd?: string })
      .find((record) => typeof record.cwd === 'string')
    fixture = { sessionId: named?.sessionId ?? '', cwd: named?.cwd ?? '', lines }
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads every line of the provider’s own file', async () => {
    plantFixture()
    await buildHost().adoptSessions()
    const [session] = store.resumable()
    expect(store.ledgerStatus(session?.sessionId ?? '').derivedThrough).toBe(fixture.lines.length)
  })

  it('counts a blank line in the middle of a file, because the bytes include it', async () => {
    // An earlier version skipped blank lines. Nothing failed: the test built its expectation by
    // filtering them out too, so the reader and the expectation agreed with each other while both
    // disagreed with the file. This one compares against the file.
    const path = plantFixture()
    writeFileSync(path, readFileSync(path, 'utf8').replace('\n', '\n\n'))

    await buildHost().adoptSessions()
    const [session] = store.resumable()
    expect(store.ledgerStatus(session?.sessionId ?? '').derivedThrough).toBe(
      fixture.lines.length + 1,
    )
  })

  it('stops the DERIVE when the quit lands (073, 068 finding 6)', async () => {
    // 068: *"`importTranscript()` is called without the coordinator's cancellation predicate… A
    // quit therefore waits for the full derived build."* On the measured corpus that is the app
    // holding its own quit open on gigabytes of projection nobody is waiting for. Staged at the
    // derive's first question: the quit is signalled from inside the store.
    plantFixture()
    const host = buildHost({
      store: {
        ...store,
        ledgerStatus: (id) => {
          host.stopSweeping()
          return store.ledgerStatus(id)
        },
      },
    })

    const report = await host.adoptSessions()
    const id = store.resumable()[0]?.sessionId ?? ''

    // The projection was not built, because the app is quitting…
    expect(report.imported).toBe(0)
    expect(store.ledgerStatus(id).present).toBe(false)
    // …and nothing claims to cover lines it never read; the next pass reads the file again.
    expect(store.ledgerStatus(id).derivedThrough).toBe(0)
  })

  it('reads the conversation into a ledger, and shows it on reopen', async () => {
    plantFixture()
    const host = buildHost()
    const report = await host.adoptSessions()
    expect(report.imported).toBe(1)

    const [session] = store.resumable()
    const id = session?.sessionId ?? ''
    const ledger = store.events(id)

    // Dense from zero, exactly like a live session's (084's replay is one code path over both).
    expect(ledger.map((entry) => entry.ordinal)).toEqual(ledger.map((_entry, i) => i))
    expect(ledger.length).toBeGreaterThan(3)

    // Folded through the renderer's own transcript, this reads as the conversation it was.
    const transcript = createTranscript()
    for (const entry of ledger) applyEvent(transcript, entry.event)

    const users = transcript.items.filter((item): item is UserItem => item.kind === 'user')
    const assistants = transcript.items.filter(
      (item): item is AssistantItem => item.kind === 'assistant',
    )
    const tools = transcript.items.filter((item): item is ToolItem => item.kind === 'tool')

    expect(users.length).toBeGreaterThan(0)
    expect(assistants.length).toBeGreaterThan(0)
    expect(tools.length).toBeGreaterThan(0)
    // Every tool call in the fixture is answered, and correlated by id rather than by position.
    expect(tools.every((tool) => tool.result !== null)).toBe(true)
    // The conversation is in the order the file has it: the first thing said is the user's.
    const firstSpoken = transcript.items.find(
      (item) => item.kind === 'user' || item.kind === 'assistant',
    )
    expect(firstSpoken?.kind).toBe('user')
  })

  it('imports once, and never over a session that already has a conversation', async () => {
    plantFixture()
    const host = buildHost()
    await host.adoptSessions()
    const id = store.resumable()[0]?.sessionId ?? ''
    const imported = store.events(id).length

    // A second scan finds the ledger already there and leaves it alone…
    expect((await host.adoptSessions()).imported).toBe(0)
    expect(store.events(id)).toHaveLength(imported)

    // …and a session this app ran itself is never imported over, even though its file is right
    // there beside the adopted one: its ledger is the live record.
    const live = buildHost()
    const sink = new NullSink()
    const created = await live.createSession({ provider: 'claude', cwd: fixture.cwd }, sink)
    await live.close(created.sessionId, sink)
    const liveLedger = store.events(created.sessionId).length
    expect(liveLedger).toBeGreaterThan(0)

    expect((await live.adoptSessions()).imported).toBe(0)
    expect(store.events(created.sessionId)).toHaveLength(liveLedger)
  })

  it('does not import a session while it is still being written to', async () => {
    // Its ledger is the recording, and its provider is still appending to its file.
    const host = buildHost({ discoverSessions: NO_DISCOVERY })
    const created = await host.createSession({ provider: 'claude' }, new NullSink())
    expect((await host.adoptSessions()).imported).toBe(0)
    expect(store.ledgerStatus(created.sessionId).derived).toBeNull()
    await host.closeAll()
  })

  it('reports a line it cannot read instead of dropping it from the count', () => {
    const { entries, unreadable } = importClaudeTranscript(
      ['{"type":"user","message":{"content":"hi"}}', 'not json'],
      0,
    )
    expect(unreadable).toBe(1)
    expect(entries.map((entry) => entry.event)).toEqual([
      { type: 'user_turn', text: 'hi', attribution: 'provider_transcript' },
    ])
  })

  it('never speaks for the user from a record they did not type', () => {
    // Both shapes the harness uses to write in the user's name. The fixture contains the second
    // one — `[Request interrupted by user]` — which an earlier version rendered as a user bubble.
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              { type: 'text', text: '[Request interrupted by user]' },
              { type: 'tool_result', tool_use_id: 't1', content: 'partial', is_error: false },
            ],
          },
        }),
      ],
      0,
    )
    expect(entries.filter((entry) => entry.event.type === 'user_turn')).toEqual([])
    // …and the tool result in the same record still lands, after the note, not before it.
    expect(entries.map((entry) => entry.event.type)).toEqual(['unknown', 'unknown', 'tool_result'])
  })

  it('keeps the harness’s injected messages out of the user’s mouth', () => {
    // `isMeta` is context the harness wrote in the user's name. Rendering it as a user bubble
    // would attribute words to someone who never typed them.
    const { entries } = importClaudeTranscript(
      [JSON.stringify({ type: 'user', isMeta: true, message: { content: 'injected context' } })],
      0,
    )
    expect(entries.map((entry) => entry.event)).toEqual([
      expect.objectContaining({ type: 'unknown', category: 'echo', label: 'user' }),
    ])
  })

  it('produces exactly what the live path would, for every record the SDK also sends', () => {
    // AC 4, checked rather than claimed. The import cannot call the runtime's normalizer — it is
    // not on that package's public surface, and this slice may not change it — so the two live
    // side by side. This holds them together over a REAL transcript: for the record types the
    // SDK also produces, the imported events must equal the live ones, summaries included.
    //
    // Two deliberate differences are excluded, both documented in import-claude.ts:
    //   - `user_turn`, and ONLY for a record whose content is a string: live, the HOST records
    //     our own turn (084); replaying a file, that record is the only source. Exempting every
    //     `user_turn` would have hidden a real divergence — an earlier version turned the CLI's
    //     `[Request interrupted by user]` into a user bubble and this test said nothing.
    //   - `unknown`: the file holds CLI bookkeeping the SDK never sends, classified here.
    //
    // ⚠️ **A THIRD divergence exists and is deliberately not excluded** (110). For an `assistant`
    // record carrying `error: 'authentication_failed'` the live path emits `fatal: true` with
    // `cause: 'auth_stale'` and the import does not — because that pair is a claim about a session
    // we launched, and this is a file. The fixture holds no record with an `error` field, so nothing
    // here exercises it today. If the fixture is ever refreshed with one — plausible, since it is
    // literally the incident 110 was written for — this equality will go red on `fatal`/`cause`
    // ALONE. That is the documented divergence in `import-claude.ts`, not a bug: exclude it, do not
    // "fix" it by making the two agree.
    const compared: string[] = []
    for (const line of fixture.lines) {
      const record = JSON.parse(line) as { type?: string; message?: { content?: unknown } }
      if (record.type !== 'assistant' && record.type !== 'user') continue
      const typedByHand = typeof record.message?.content === 'string'
      const live = normalizeMessage(record as unknown as SDKMessage)
      const mine = importClaudeTranscript([line], 0)
        .entries.map((entry) => entry.event)
        .filter((event) => event.type !== 'unknown' && !(typedByHand && event.type === 'user_turn'))
      expect(mine, line.slice(0, 120)).toEqual(live)
      compared.push(record.type)
    }
    // The fixture really does exercise both, or this proves nothing.
    expect(compared).toContain('assistant')
    expect(compared).toContain('user')
    expect(compared.length).toBeGreaterThan(8)
  })

  it('…and on a FILE EDIT, which spans two records and so needs its own case (096)', () => {
    // ⚠️ **The sweep above cannot see this, and review found the gap that hid.** It compares one line
    // at a time, and a `file_change` is emitted only when a `tool_use` in one record is settled by a
    // `tool_result` in another — so BOTH sides were silent, agreed perfectly, and the import path
    // shipped with an always-empty Changes tab for every adopted Claude conversation.
    const call = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_edit_1',
            name: 'Edit',
            input: { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' },
          },
        ],
      },
    })
    const done = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_edit_1', content: 'ok' }],
      },
    })

    const edits = new FileEdits()
    const live = [call, done].flatMap((line) =>
      normalizeMessage(JSON.parse(line) as SDKMessage, undefined, edits),
    )
    const mine = importClaudeTranscript([call, done], 0)
      .entries.map((entry) => entry.event)
      .filter((event) => event.type !== 'unknown')

    expect(mine).toEqual(live)
    // NON-VACUITY, and the whole point: both sides really do emit one, so "they agree" is not two
    // silences agreeing. This is the assertion that would have gone red before the fix.
    const changes = mine.filter((event) => event.type === 'file_change')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      changes: [{ path: '/repo/src/a.ts', status: 'modified' }],
      source: 'Edit',
    })
  })

  it("says the true thing about a SUB-AGENT's records on disk: there is no parentage on them (131)", () => {
    // ⛔ **This test used to manufacture the LIVE SDK envelope** — `parent_tool_use_id` beside
    // `message` — hand the same invented records to both normalizers, and call the agreement
    // conformance. It proved equality on its own fixture and nothing about Claude JSONL. 130
    // scanned the corpus and 131 scanned it again before deleting anything:
    //
    //   0 of 13,862 `~/.claude/projects/**/*.jsonl` contain `parent_tool_use_id`
    //   0 contain `parentToolUseID` — 128's own claim about disk, refuted
    //   0 of the 107 files discovery can actually reach contain either
    //
    // So the importer's lookup could never fire, and the fixture that said it did was the only
    // reason nobody looked. The records below are the shape a child's file REALLY has, taken from
    // `<parent>/subagents/agent-<agentId>.jsonl`: `isSidechain`, an `agentId`, an
    // `attributionAgent` naming the agent TYPE — and no tool-use id anywhere on the envelope.
    // ⛔ **TWO files, imported the way production imports them — one call each (137, from 136).**
    // This used to concatenate the parent's dispatch record with rows copied out of the child's
    // `subagents/agent-*.jsonl` and hand the lot to a SINGLE `importClaudeTranscript`, a topology no
    // caller builds: the child-work viewer reads one child file, the disk reader parses one
    // `source.path`, and derivation walks one ordered raw-frame stream. The conclusion below was
    // right and the fixture standing under it was not — so the fixture moves and the conclusion
    // stays, which is the whole of 136's ruling on it.
    const parentFile = [
      // The dispatch, in the parent's own file. Its summary must still read as the description
      // rather than as a JSON dump (029) — that half was never about parentage.
      JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01Vy9DHCo9ANEMehzr8fMTtz',
              name: 'Agent',
              input: {
                description: 'Report working directory',
                prompt: 'Run `pwd` …',
                subagent_type: 'general-purpose',
              },
            },
          ],
        },
      }),
    ]
    // …and the child's own work and words, in the child's own file. Note what is NOT here.
    const childFile = [
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        agentId: 'a95dbf5b26468080b',
        attributionAgent: 'Explore',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'child_1', name: 'Bash', input: { command: 'pwd' } }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        agentId: 'a95dbf5b26468080b',
        attributionAgent: 'Explore',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Working directory is /tmp/x.' }],
        },
      }),
      JSON.stringify({
        type: 'user',
        isSidechain: true,
        agentId: 'a95dbf5b26468080b',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'child_1', content: '/tmp/x' }],
        },
      }),
    ]
    for (const line of [...parentFile, ...childFile]) {
      const live = normalizeMessage(JSON.parse(line) as SDKMessage)
      const mine = importClaudeTranscript([line], 0)
        .entries.map((entry) => entry.event)
        .filter((event) => event.type !== 'unknown')
      expect(mine, line.slice(0, 90)).toEqual(live)
    }

    const events = (lines: string[]): TranscriptEvent[] =>
      importClaudeTranscript(lines, 0).entries.map((entry) => entry.event)
    const parent = events(parentFile)
    const child = events(childFile)

    // NON-VACUITY first, per file: each really does become a conversation, so the assertions below
    // are about attribution rather than about a parser that read nothing.
    expect(parent.filter((e) => e.type !== 'unknown').map((e) => e.type)).toEqual(['tool_call'])
    expect(child.filter((e) => e.type !== 'unknown').map((e) => e.type)).toEqual([
      'tool_call',
      'assistant_message',
      'tool_result',
    ])
    expect(parent[0]).toMatchObject({ summary: 'Report working directory' })
    // ⛔ **And the fact itself.** Not "the importer fails to attribute" — the FORMAT does not say.
    // Nothing on a native record names the dispatching tool call, so an adopted conversation cannot
    // nest a child's work the way a live one does, and pretending otherwise is what the old fixture
    // did. Recovering it needs a two-FILE join (child `agentId` → the parent transcript's Agent
    // result and task notification) plus a sweep that reads the 13,755 `subagents/**` files it
    // deliberately excludes. That is a feature; this line is the honest state until it exists.
    //
    // ⚠️ **Asserted on each file separately**, because that is the unit the format is read in: no
    // single import ever sees both sides of the join, which is exactly why the join is the work.
    expect([...parent, ...child].some((e) => 'parentToolCallId' in e)).toBe(false)
  })

  it('keeps text and tools in the order the model produced them', () => {
    // 058's rule, which the live path also follows: a tool between two runs of text must not
    // jump in front of the text that preceded it.
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'BEFORE' },
              { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
              { type: 'text', text: 'AFTER' },
            ],
          },
        }),
      ],
      0,
    )
    expect(entries.map((entry) => entry.event)).toEqual([
      { type: 'assistant_message', text: 'BEFORE' },
      { type: 'tool_call', id: 't1', name: 'Bash', summary: 'ls' },
      { type: 'assistant_message', text: 'AFTER' },
    ])
  })
})

/**
 * 110 · An archived refusal says what happened, and claims nothing about what can still happen.
 *
 * The record preserves measured provider-transcript fields, wording, and error text. Its
 * envelope has `isApiErrorMessage: true` and `apiErrorStatus: 401`, corroborating harness
 * authorship. Do not depend on those fields: the pinned SDK does not declare either on
 * `SDKAssistantMessage`, and the live wire has not established them.
 *
 * ⚠️ **This test exists because a mutation survived.** Flipping the importer's error to
 * `fatal: true, cause: 'auth_stale'` — the live path's shape — broke nothing, which meant the
 * asymmetry between the two paths was a decision no test defended.
 */
describe('an archived authentication failure (110)', () => {
  const REFUSAL = 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'

  // ⚑ `model: "<synthetic>"` and zeroed usage are what 110 read on the archived record, and since
  // 680 the marker is what diverts the notice (R28a) — this record now carries what it described.
  const record = JSON.stringify({
    type: 'assistant',
    error: 'authentication_failed',
    isApiErrorMessage: true,
    apiErrorStatus: 401,
    message: {
      role: 'assistant',
      model: '<synthetic>',
      content: [{ type: 'text', text: REFUSAL }],
    },
  })

  it('is not published as something the assistant said, and does not end the transcript', () => {
    const { entries } = importClaudeTranscript([record], 0)
    expect(entries.map((entry) => entry.event)).toEqual([
      // ⚠️ **No assistant bubble** (review). The live path stopped attributing this sentence to the
      // model; leaving the importer doing it would have left the same lie on every adopted
      // conversation. The record itself is the proof — `model: "<synthetic>"`, `usage` all zeroes.
      //
      // ⚠️ **And no `fatal`, no `cause`.** Both would be claims about a session, and this is a file.
      // An archived record may come from a `claude` CLI run that refreshed itself and carried on;
      // ending the transcript here would hide everything the session went on to do.
      { type: 'error', message: REFUSAL, fatal: false },
    ])
  })

  it('a refusal beside real content leaves the content alone — same shape rule as live', () => {
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'assistant',
          error: 'authentication_failed',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check the logs…' },
              { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
            ],
          },
        }),
      ],
      0,
    )
    expect(entries.map((entry) => entry.event)).toEqual([
      { type: 'assistant_message', text: 'Let me check the logs…' },
      { type: 'tool_call', id: 't1', name: 'Bash', summary: 'ls' },
      { type: 'error', message: 'claude could not authenticate', fatal: false },
    ])
  })

  it('no `.d.ts` symbol survives the import either', () => {
    // The word-translation path, reached by an error whose message is NOT diverted.
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'assistant',
          error: 'rate_limit',
          message: { role: 'assistant', content: [{ type: 'text', text: 'slow down' }] },
        }),
      ],
      0,
    )
    const error = entries.map((e) => e.event).find((e) => e.type === 'error')
    if (!error || error.type !== 'error') throw new Error('no error event')
    expect(error.message).not.toContain('rate_limit')
    expect(error.message).not.toContain('_')
    // …and the paired positive, so the two assertions above are not passing over an empty string.
    expect(error.message).toBe('claude is rate-limited')
  })
})

/**
 * 🔴 **680 · a refusal is not the speaker's words in an IMPORTED conversation either** (PM ruling
 * R28a, for every error word). The importer carried 110's copy of the rule — the credential word
 * alone — so an adopted transcript holding the version-floor refusal drew it as the assistant's.
 */
describe('680 · an archived refusal, for any error word', () => {
  const FLOOR =
    "API Error: 400 Claude Code 2.1.218 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again."

  it('🔴 the CLI’s own message is diverted onto the error, whole — no bubble, no guessed advice', () => {
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'assistant',
          error: 'unknown',
          isApiErrorMessage: true,
          message: {
            role: 'assistant',
            model: '<synthetic>',
            content: [{ type: 'text', text: FLOOR }],
          },
        }),
      ],
      0,
    )
    expect(entries.map((entry) => entry.event)).toEqual([
      // ⚠️ No `refusal` values: the version the CLI ran is read from a live `system/init`, which a
      // file does not replay — so the reader is shown the provider's sentence (R28b).
      { type: 'error', message: FLOOR, fatal: false },
    ])
  })

  it('⛔ the control — a REAL model’s message beside the same word keeps its text', () => {
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'assistant',
          error: 'max_output_tokens',
          message: {
            role: 'assistant',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'the first half of a real answer' }],
          },
        }),
      ],
      0,
    )
    expect(entries.map((entry) => entry.event)).toEqual([
      { type: 'assistant_message', text: 'the first half of a real answer' },
      { type: 'error', message: 'the reply hit its maximum length', fatal: false },
    ])
  })

  it('🔴 a notice with NO error word, marked `isApiErrorMessage`, is the CLI’s too', () => {
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'assistant',
          isApiErrorMessage: true,
          message: {
            role: 'assistant',
            model: '<synthetic>',
            content: [
              {
                type: 'text',
                text: "The model's tool call could not be parsed (retry also failed).",
              },
            ],
          },
        }),
      ],
      0,
    )
    expect(entries.map((entry) => entry.event)).toEqual([
      {
        type: 'error',
        message: "The model's tool call could not be parsed (retry also failed).",
        fatal: false,
      },
    ])
  })

  it('⚑ the importer builds a different ledger from the same file, so older ledgers read stale', () => {
    // `normalizer.ts`'s own rule: a change that would alter what a re-derived file shows is a bump,
    // or the Rebuild that would repair an adopted conversation is never offered.
    expect(NORMALIZER_VERSION).toBeGreaterThanOrEqual(4)
  })
})
