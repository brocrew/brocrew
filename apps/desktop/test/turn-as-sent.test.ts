import ts from 'typescript'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { userProviderHomePath } from '../src/main/adopt/user-homes'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { readingATurn, type TurnAsked } from '../src/main/archive/turn-as-sent'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { TurnAsSent } from '../src/shared/turn-as-sent'

/**
 * 🔴 **W4.164 · F093 R1 — one turn as the model got it, from the provider's own file.**
 *
 *  - §1 · Claude Code's transcript: the message as handed over, and each reminder and context
 *    record as it rendered it, in the role it sent it in.
 *  - §2 · Codex's rollout: its developer messages and its own user messages beside the message, and
 *    its base prompt in front of every request.
 *  - §2b · ⛔ W4.172 · found by the exact text BroBot handed over (`user_turn.sent`), never by words
 *    inside a message, and in its own provider conversation only.
 *  - §3 · ⛔ never dropped: a record this build does not know is kept raw, under its own name.
 *  - §4 · the host: a ledger message read from the provider's file, the archive's copy when it is
 *    gone, and the same text twice found in turn.
 *  - §5 · ⛔ W4.172 · reading a conversation from a person's own `~/.codex` writes nothing there.
 *
 * ⚑ **The fixtures are a scratch probe's** (the F093 map's capture, scratch folders spelled
 * `/scratch/probe`), never a person's conversation.
 */

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures', 'turn-as-sent')
const lines = (name: string): string[] =>
  readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((line) => line !== '')

/** Every line, until the reading has its turn. */
function read(provider: Provider, all: readonly string[], asked: TurnAsked): TurnAsSent {
  const reading = readingATurn(provider, asked)
  for (const line of all) if (reading.line(line) === 'done') break
  return reading.answer()
}

const FIRST = 'W4157-PERSON Please plan the next release.'
const NOTE = 'W4157-NOTE Should the notes cover the beta features?'

type Json = Record<string, unknown>
const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * ⚑ A file's lines, the message carrying `words` given `to(text)` as its text instead — Claude
 * Code's `user` record, or Codex's user block — and every other line as it was.
 */
function rewritten(
  provider: Provider,
  all: readonly string[],
  words: string,
  to: (text: string) => string,
): string[] {
  return all.map((line) => {
    const record = JSON.parse(line) as unknown
    if (!isJson(record)) return line
    if (provider === 'claude') {
      const message = record['message']
      if (record['type'] !== 'user' || !isJson(message)) return line
      const content = message['content']
      if (typeof content !== 'string' || !content.includes(words)) return line
      return JSON.stringify({ ...record, message: { ...message, content: to(content) } })
    }
    const payload = record['payload']
    if (record['type'] !== 'response_item' || !isJson(payload) || payload['role'] !== 'user') {
      return line
    }
    const content = Array.isArray(payload['content']) ? (payload['content'] as unknown[]) : []
    let changed = false
    const blocks = content.map((block) => {
      if (!isJson(block) || block['type'] !== 'input_text') return block
      const text = block['text']
      if (typeof text !== 'string' || !text.includes(words)) return block
      changed = true
      return { ...block, text: to(text) }
    })
    return changed ? JSON.stringify({ ...record, payload: { ...payload, content: blocks } }) : line
  })
}

/** The text a fixture's message carrying `words` was handed over with, exactly. */
function sentIn(provider: Provider, all: readonly string[], words: string): string {
  let found: string | null = null
  rewritten(provider, all, words, (text) => {
    found ??= text
    return text
  })
  if (found === null) throw new Error(`no message carries ${words}`)
  return found
}

describe('§1 · Claude Code’s transcript', () => {
  const claude = lines('claude-transcript.jsonl')
  const first = sentIn('claude', claude, FIRST)

  it('🔴 the first message as handed over, and every reminder as Claude Code rendered it', () => {
    const turn = read('claude', claude, { by: 'handed-over', text: first, before: [], life: null })
    if (!turn.found) throw new Error(turn.why)
    expect(turn.version).toBe('2.1.287')
    expect(turn.message).toBe(first)
    expect(turn.message.startsWith('Sent by a person, typed into this app.')).toBe(true)
    expect(turn.message.endsWith(FIRST)).toBe(true)
    // ⚑ In the order the model got them: the reminders in the user's role at the head of the
    // message, the message, then the context message's records.
    expect(turn.parts.map((part) => [part.author, part.label, part.role])).toEqual([
      ['the-provider', 'instructions', 'user'],
      ['the-provider', 'remote_session_change', 'user'],
      ['the-message', 'user', 'user'],
      ['the-provider', 'environment', 'system'],
      ['the-provider', 'model', 'system'],
      ['the-provider', 'deferred_tools_delta', 'system'],
      ['the-provider', 'agent_listing_delta', 'system'],
      ['the-provider', 'mcp_instructions_delta', 'system'],
      ['the-provider', 'skill_listing', 'system'],
      ['the-provider', 'total_tokens_reminder', 'system'],
      ['the-provider', 'date', 'system'],
    ])
    expect(turn.parts[2]?.text).toBe(turn.message)
    expect(turn.whole).toBe(true)
    const text = (label: string): string =>
      turn.parts.find((part) => part.label === label)?.text ?? ''
    // ⚑ Exactly as sent: the reminders' own wrappers, the agent's memory index inside its own.
    expect(text('instructions')).toMatch(/^<system-reminder>\nCodebase and user instructions/)
    expect(text('instructions')).toContain('- [Release notes style](release-notes-style.md)')
    expect(text('remote_session_change')).toContain('Co-Authored-By: Claude Opus 5.5')
    expect(text('date')).toBe("<system-reminder>\nToday's date is 2026-10-05.\n</system-reminder>")
    // ⚑ What Claude Code keeps for itself is named, never shown as sent.
    expect(turn.records.filter((one) => one.kind === 'not-sent').map((one) => one.label)).toEqual([
      'atis-latch',
      'attachment: session_context',
    ])
    expect(turn.standing).toEqual([])
    // ⚑ What reached the model that this record holds none of: Claude Code's transcript keeps no
    // system prompt, and the turn is read only up to the model's first answer.
    expect(turn.leavesOut).toEqual(['the-system-prompt', 'after-its-first-answer'])
  })

  it('⚑ a later message: its text, and Claude Code’s one line beside it', () => {
    const turn = read('claude', claude, {
      by: 'handed-over',
      text: sentIn('claude', claude, NOTE),
      before: [],
      life: null,
    })
    if (!turn.found) throw new Error(turn.why)
    expect(turn.message).toMatch(/^Sent by Ada \(worker\), another agent/)
    expect(turn.message.endsWith(NOTE)).toBe(true)
    expect(turn.parts.map((part) => part.label)).toEqual(['user', 'total_tokens_reminder'])
  })

  it('⛔ a text it never got: said so', () => {
    expect(
      read('claude', claude, { by: 'handed-over', text: 'never sent', before: [], life: null }),
    ).toEqual({
      found: false,
      why: 'No message in Claude Code’s own record of the conversation has exactly the text this app handed over.',
    })
    expect(
      read('claude', claude, {
        by: 'handed-over',
        text: first,
        before: ['handed-over'],
        life: null,
      }).found,
    ).toBe(false)
  })
})

describe('§2 · Codex’s rollout', () => {
  const codex = lines('codex-rollout.jsonl')

  it.each(['# AGENTS.md instructions for /scratch/probe', '# AGENTS.md instructions'])(
    'titles the AGENTS part headed %s',
    (heading) => {
      for (const changed of [false, true]) {
        const text =
          heading +
          '\n\n<INSTRUCTIONS>\n' +
          (changed ? 'These AGENTS.md instructions replace all previously provided\n' : '') +
          'Use the workspace rules.\n</INSTRUCTIONS>'
        const records = rewritten('codex', codex, '# AGENTS.md instructions for ', () => text)
        const sent = sentIn('codex', records, FIRST)
        const turn = read('codex', records, {
          by: 'handed-over',
          text: sent,
          before: [],
          life: null,
        })
        if (!turn.found) throw new Error(turn.why)
        expect(turn.parts.find((part) => part.text === text)).toMatchObject({
          author: 'the-provider',
          role: 'user',
          title: changed
            ? 'The AGENTS files Codex read, sent again because they changed'
            : 'The AGENTS files Codex read, as it sent them',
        })
      }
    },
  )

  it('keeps a different heading that only shares the AGENTS prefix untitled', () => {
    const text = '# AGENTS.md instructions elsewhere\n\nOther context.'
    const records = rewritten('codex', codex, '# AGENTS.md instructions for ', () => text)
    const turn = read('codex', records, {
      by: 'handed-over',
      text: sentIn('codex', records, FIRST),
      before: [],
      life: null,
    })
    if (!turn.found) throw new Error(turn.why)
    expect(turn.parts.find((part) => part.text === text)?.title).toBeUndefined()
  })

  it.each(['BroBot', 'BroCrew'])(
    'labels recorded conversation headers from %s without rewriting them',
    (name) => {
      for (const [header, title] of [
        [
          `Composed by ${name} for this conversation at this launch:`,
          'What is true of this conversation, then the message',
        ],
        [
          `Composed by ${name} for this conversation at this launch. These sections replace the ones of the same name you were given earlier in this conversation:`,
          'What changed in what is true of this conversation, then the message',
        ],
      ]) {
        const records = rewritten(
          'codex',
          codex,
          FIRST,
          (text) => header + text.slice(text.indexOf('\n\n')),
        )
        const sent = sentIn('codex', records, FIRST)
        const turn = read('codex', records, {
          by: 'handed-over',
          text: sent,
          before: [],
          life: null,
        })
        if (!turn.found) throw new Error(turn.why)
        expect(turn.message).toBe(sent)
        expect(turn.parts.find((part) => part.author === 'the-message')).toMatchObject({
          text: sent,
          title,
        })
      }
    },
  )

  it.each([
    'Composed by AnotherApp for this conversation at this launch:\n\n',
    'Quoted: Composed by BroBot for this conversation at this launch:\n\n',
    'Composed by BroCrew for this conversation at this launch:\n',
  ])('keeps unrecognized or quoted framing under the message title: %s', (prefix) => {
    const records = rewritten('codex', codex, FIRST, () => prefix + FIRST)
    const sent = sentIn('codex', records, FIRST)
    const turn = read('codex', records, { by: 'handed-over', text: sent, before: [], life: null })
    if (!turn.found) throw new Error(turn.why)
    expect(turn.message).toBe(sent)
    expect(turn.parts.find((part) => part.author === 'the-message')).toMatchObject({
      text: sent,
      title: 'The message',
    })
  })

  it('🔴 the first message, Codex’s developer messages and its own user messages, and its base prompt', () => {
    const sent = sentIn('codex', codex, FIRST)
    const turn = read('codex', codex, { by: 'handed-over', text: sent, before: [], life: null })
    if (!turn.found) throw new Error(turn.why)
    expect(turn.version).toBe('0.160.0')
    // ⚑ This conversation's lead rides in front of the first message, in the same block.
    expect(turn.message).toBe(sent)
    expect(turn.message).toMatch(/^Composed by BroCrew for this conversation at this launch:/)
    expect(turn.message.endsWith(FIRST)).toBe(true)
    // ⚑ Each block of each message, as sent.
    expect(turn.parts.map((part) => [part.author, part.role])).toEqual([
      ['the-provider', 'developer'],
      ['the-provider', 'developer'],
      ['the-provider', 'developer'],
      ['the-provider', 'user'],
      ['the-provider', 'user'],
      ['the-message', 'user'],
    ])
    expect(turn.parts[0]?.text).toMatch(/^## Memory\n/)
    expect(turn.parts[1]?.text).toMatch(/^<skills_instructions>/)
    expect(turn.parts[2]?.text).toMatch(/^<permissions instructions>/)
    expect(turn.parts[3]?.text).toMatch(/^# AGENTS\.md instructions for \/scratch\/probe/)
    expect(turn.parts[4]?.text).toMatch(/^<environment_context>/)
    expect(turn.standing).toHaveLength(1)
    expect(turn.standing[0]?.label).toBe('base_instructions')
    expect(turn.standing[0]?.text).toMatch(/^You are Codex, a coding agent based on GPT-5\./)
    // ⚑ Its base prompt is kept: only what came after the model's first answer is left out.
    expect(turn.leavesOut).toEqual(['after-its-first-answer'])
    expect(turn.records.map((one) => one.label)).toContain('world_state')
    expect(turn.records.map((one) => one.label)).toContain('turn_context')
    expect(turn.records.every((one) => one.kind === 'not-sent')).toBe(true)
  })

  it('⚑ a later message: only its text was sent that turn', () => {
    const turn = read('codex', codex, {
      by: 'handed-over',
      text: sentIn('codex', codex, NOTE),
      before: [],
      life: null,
    })
    if (!turn.found) throw new Error(turn.why)
    expect(turn.message).toMatch(/^Sent by Ada \(worker\), another agent/)
    expect(turn.parts.map((part) => part.author)).toEqual(['the-message'])
    // ⚑ The base prompt stands in front of every request of the conversation.
    expect(turn.standing[0]?.label).toBe('base_instructions')
  })
})

describe('§2b · ⛔ the exact text handed over, in one provider conversation', () => {
  const claude = lines('claude-transcript.jsonl')
  const codex = lines('codex-rollout.jsonl')

  it('🔴 words inside a message are not it, nor is its text with a character more or less', () => {
    const sent = sentIn('claude', claude, FIRST)
    expect(
      read('claude', claude, { by: 'handed-over', text: sent, before: [], life: null }).found,
    ).toBe(true)
    expect(
      read('claude', claude, { by: 'handed-over', text: FIRST, before: [], life: null }).found,
    ).toBe(false)
    expect(
      read('claude', claude, { by: 'handed-over', text: `${sent}\n`, before: [], life: null })
        .found,
    ).toBe(false)
    expect(
      read('claude', claude, { by: 'handed-over', text: sent.slice(1), before: [], life: null })
        .found,
    ).toBe(false)
    const theirs = sentIn('codex', codex, FIRST)
    expect(
      read('codex', codex, { by: 'handed-over', text: theirs, before: [], life: null }).found,
    ).toBe(true)
    expect(
      read('codex', codex, { by: 'handed-over', text: FIRST, before: [], life: null }).found,
    ).toBe(false)
    expect(
      read('codex', codex, { by: 'handed-over', text: `${theirs} `, before: [], life: null }).found,
    ).toBe(false)
  })

  it('🔴 a message with an image: found by its text, and the image named beside it', () => {
    const sent = sentIn('claude', claude, NOTE)
    const withAnImage = claude.map((line) => {
      const record = JSON.parse(line) as Json
      const message = record['message']
      if (record['type'] !== 'user' || !isJson(message) || message['content'] !== sent) return line
      const image = {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AA' },
      }
      return JSON.stringify({
        ...record,
        message: { ...message, content: [image, { type: 'text', text: sent }] },
      })
    })
    const turn = read('claude', withAnImage, {
      by: 'handed-over',
      text: sent,
      before: [],
      life: null,
    })
    expect(turn.found && turn.message).toBe(`[an image]\n\n${sent}`)
    const theirs = sentIn('codex', codex, NOTE)
    const codexImage = codex.map((line) => {
      const record = JSON.parse(line) as Json
      const payload = record['payload']
      if (record['type'] !== 'response_item' || !isJson(payload)) return line
      const content = Array.isArray(payload['content']) ? (payload['content'] as unknown[]) : []
      const carries = content.some((block) => isJson(block) && block['text'] === theirs)
      if (!carries) return line
      const image = { type: 'input_image', image_url: 'data:,' }
      return JSON.stringify({ ...record, payload: { ...payload, content: [image, ...content] } })
    })
    const codexTurn = read('codex', codexImage, {
      by: 'handed-over',
      text: theirs,
      before: [],
      life: null,
    })
    expect(codexTurn.found && codexTurn.message).toBe(theirs)
    expect(codexTurn.found && codexTurn.parts.map((part) => part.text)).toEqual([
      '[an image]',
      theirs,
    ])
  })

  it('⚑ only in the provider conversation it was in', () => {
    const sent = sentIn('claude', claude, FIRST)
    const own = /"sessionId":"([^"]+)"/.exec(claude.join('\n'))?.[1] ?? ''
    expect(
      read('claude', claude, { by: 'handed-over', text: sent, before: [], life: own }).found,
    ).toBe(true)
    expect(
      read('claude', claude, { by: 'handed-over', text: sent, before: [], life: 'another' }).found,
    ).toBe(false)
    const theirs = sentIn('codex', codex, FIRST)
    const thread = /"id":"([^"]+)"/.exec(codex[0] ?? '')?.[1] ?? ''
    expect(
      read('codex', codex, { by: 'handed-over', text: theirs, before: [], life: thread }).found,
    ).toBe(true)
    expect(
      read('codex', codex, { by: 'handed-over', text: theirs, before: [], life: 'another' }).found,
    ).toBe(false)
  })
})

describe('§3 · ⛔ never dropped: what this build does not know is kept raw', () => {
  it('🔴 Claude Code: a record of a kind not known, inside the turn', () => {
    const claude = lines('claude-transcript.jsonl')
    const sent = sentIn('claude', claude, FIRST)
    const at = claude.findIndex((line) => line.includes(FIRST) && line.includes('"type":"user"'))
    const future = JSON.stringify({ type: 'brand_new_record', note: 'from a later version' })
    const turn = read('claude', [...claude.slice(0, at + 1), future, ...claude.slice(at + 1)], {
      by: 'handed-over',
      text: sent,
      before: [],
      life: null,
    })
    if (!turn.found) throw new Error(turn.why)
    expect(turn.records).toContainEqual({
      label: 'brand_new_record',
      kind: 'unknown',
      raw: { type: 'brand_new_record', note: 'from a later version' },
    })
    // ⚑ …and an attachment of a kind not known, with its rendered text, is still shown as sent.
    const attachment = JSON.stringify({
      type: 'attachment',
      attachment: { type: 'a_new_reminder' },
      rendered: [{ content: '<system-reminder>\nNew.\n</system-reminder>' }],
      renderedRole: 'system',
    })
    const withIt = read('claude', [...claude.slice(0, at + 1), attachment], {
      by: 'handed-over',
      text: sent,
      before: [],
      life: null,
    })
    expect(withIt.found && withIt.parts.at(-1)).toEqual({
      author: 'the-provider',
      label: 'a_new_reminder',
      role: 'system',
      text: '<system-reminder>\nNew.\n</system-reminder>',
    })
  })

  it('🔴 Codex: a record of a kind not known, and a line that is not JSON', () => {
    const codex = lines('codex-rollout.jsonl')
    const at = codex.findIndex((line) => line.includes(NOTE))
    const future = JSON.stringify({ type: 'future_thing', payload: { type: 'x', n: 1 } })
    const turn = read('codex', [...codex.slice(0, at), future, '{torn', ...codex.slice(at)], {
      by: 'handed-over',
      text: sentIn('codex', codex, NOTE),
      before: [],
      life: null,
    })
    if (!turn.found) throw new Error(turn.why)
    expect(turn.records).toContainEqual({
      label: 'future_thing: x',
      kind: 'unknown',
      raw: { type: 'future_thing', payload: { type: 'x', n: 1 } },
    })
    expect(turn.records).toContainEqual({
      label: 'a line that is not JSON',
      kind: 'unknown',
      raw: '{torn',
    })
  })
})

describe('§4 · the host: a ledger message, read from the provider’s file', () => {
  const migrationsDir = join(here, '../src/main/db/migrations')
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let nativeFile: string | null
  /** Whose file `nativeFile` is — a provider conversation — or null for every one. */
  let fileLife: string | null
  let clock = 1_000
  const tick = (): number => clock++
  const window: RuntimeEventSink = {
    ownerId: 'webContents:1',
    alive: true,
    aPersonIsBehindIt: true,
    send: () => {},
    sendLiveness: () => {},
  } as RuntimeEventSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-turn-as-sent-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    store = createSessionStore(db, tick)
    nativeFile = null
    fileLife = null
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: (_provider, _home, ref) =>
        fileLife === null || ref.sessionId === fileLife ? nativeFile : null,
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

  /** A conversation that sent `words` in turn, and the ledger place of each. */
  async function conversation(provider: Provider, words: readonly string[]) {
    // ⚑ Unattended, so the double ends each turn by itself, and each message is its own turn.
    const { sessionId } = await host.createSession({ provider, approvalMode: 'auto' }, window)
    const ended = (): number =>
      store.events(sessionId).filter((entry) => entry.event.type === 'turn').length
    for (const [index, one] of words.entries()) {
      await host.send(sessionId, one, window)
      for (let waited = 0; ended() <= index && waited < 2_000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    const places = store
      .events(sessionId)
      .filter((entry) => entry.event.type === 'user_turn')
      .map((entry) => entry.ordinal)
    return { sessionId, places, life: store.find(sessionId)?.ref.sessionId ?? '' }
  }

  /** The text the host handed over for the message at `ordinal`, as the ledger keeps it. */
  const handedOver = (sessionId: string, ordinal: number | undefined): string => {
    const event = store.events(sessionId).find((entry) => entry.ordinal === ordinal)?.event
    if (event?.type !== 'user_turn' || typeof event.sent !== 'string') {
      throw new Error(`no text kept for the message at ${String(ordinal)}`)
    }
    return event.sent
  }

  /** A fixture's lines as this conversation's provider record: its provider id made this one's. */
  function asThisLife(name: string, life: string): string[] {
    const all = lines(name)
    const theirs = name.startsWith('claude')
      ? /"sessionId":"([^"]+)"/.exec(all.join('\n'))?.[1]
      : /"id":"([^"]+)"/.exec(all[0] ?? '')?.[1]
    return all.map((line) => line.split(theirs ?? '\u0000').join(life))
  }

  const CLAUDE_FIRST = sentIn('claude', lines('claude-transcript.jsonl'), FIRST)

  it('🔴 the provider’s own file, found as an import finds it', async () => {
    const { sessionId, places, life } = await conversation('claude', [FIRST, NOTE])
    const first = handedOver(sessionId, places[0])
    const note = handedOver(sessionId, places[1])
    nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    const file = rewritten(
      'claude',
      rewritten('claude', asThisLife('claude-transcript.jsonl', life), FIRST, () => first),
      NOTE,
      () => note,
    )
    writeFileSync(nativeFile, `${file.join('\n')}\n`)
    const one = await host.turnAsSent(sessionId, places[0] ?? -1)
    expect(one.found && one.message).toBe(first)
    const two = await host.turnAsSent(sessionId, places[1] ?? -1)
    expect(two.found && two.message).toBe(note)
  })

  it('⚑ the same text twice: the second message is the file’s second', async () => {
    const { sessionId, places, life } = await conversation('claude', [FIRST, FIRST])
    const sent = handedOver(sessionId, places[0])
    // ⚑ The premise: both were handed over with the same text.
    expect(handedOver(sessionId, places[1])).toBe(sent)
    nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    const claude = rewritten(
      'claude',
      asThisLife('claude-transcript.jsonl', life),
      FIRST,
      () => sent,
    )
    const message = claude.find((line) => line.includes(FIRST) && line.includes('"type":"user"'))
    // The first message again, as a second turn of its own, after the first's answer.
    const again = (message ?? '').replace(/"uuid":"[^"]+"/, '"uuid":"again"')
    const answered = claude.findIndex((line) => line.includes('"type":"assistant"'))
    const file = [...claude.slice(0, answered + 1), again, ...claude.slice(answered + 1)]
    writeFileSync(nativeFile, `${file.join('\n')}\n`)
    const second = await host.turnAsSent(sessionId, places[1] ?? -1)
    if (!second.found) throw new Error(second.why)
    // ⚑ The second one's turn: only what followed it.
    expect(second.parts.map((part) => part.author)).toEqual(['the-message'])
  })

  it('🔴 each turn in the provider conversation Claude names after it: a /clear starts the count again', async () => {
    // ⚑ Claude names a conversation after its first turn is handed over: the turn, then the
    // `session` (or `conversation_reset`) its init raises, then the turn's end.
    const id = 'sess_planted'
    const cwd = join(userData, 'w')
    store.create({
      id,
      provider: 'claude',
      cwd,
      approvalMode: 'ask',
      profileId: 'planted',
      launchedAs: 'life-b',
    })
    const ref = (sessionId: string) => ({
      provider: 'claude' as const,
      sessionId,
      cwd,
      rotation: 0,
    })
    expect(store.nameItsLaunch(id, ref('life-b'))).toBe(true)
    const said = [
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      { type: 'session', state: 'started', ref: ref('life-a') },
      { type: 'turn', state: 'completed' },
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      { type: 'conversation_reset', ref: ref('life-b'), source: 'planted' },
      { type: 'turn', state: 'completed' },
      { type: 'user_turn', text: FIRST, sent: `${CLAUDE_FIRST}\n\nAGAIN` },
      { type: 'turn', state: 'completed' },
    ]
    for (const [index, event] of said.entries()) {
      store.append(id, index + 1, event as Parameters<SessionStore['append']>[2], tick())
    }
    // ⚑ The current conversation's file holds the first message, and a later one with more; the
    // first conversation's file is gone.
    fileLife = 'life-b'
    nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    const claude = asThisLife('claude-transcript.jsonl', 'life-b')
    const message = claude.find((line) => line.includes(FIRST) && line.includes('"type":"user"'))
    const answered = claude.findIndex((line) => line.includes('"type":"assistant"'))
    // ⚑ Inside the line's JSON, a blank line is written escaped.
    const again = (message ?? '').replace(FIRST, `${FIRST}\\n\\nAGAIN`)
    writeFileSync(
      nativeFile,
      `${[...claude.slice(0, answered + 1), again, ...claude.slice(answered + 1)].join('\n')}\n`,
    )
    // The first life's turn: its own file is gone, and nothing else holds a copy.
    expect(await host.turnAsSent(id, 1)).toEqual({
      found: false,
      why: 'The provider’s own record of this message is gone, and the app kept no copy of it.',
    })
    // ⚑ The first turn after the /clear is the new conversation's first, though the same text was
    // handed over before it, in the conversation before.
    const first = await host.turnAsSent(id, 4)
    expect(first.found && first.message).toBe(CLAUDE_FIRST)
    const second = await host.turnAsSent(id, 7)
    expect(second.found && second.message.endsWith('AGAIN')).toBe(true)
  })

  it('⛔ a send that reached no provider conversation, and a turn a quit left open', async () => {
    const id = 'sess_planted_two'
    const cwd = join(userData, 'w')
    store.create({
      id,
      provider: 'claude',
      cwd,
      approvalMode: 'ask',
      profileId: 'planted',
      launchedAs: 'life-b',
    })
    const ref = (sessionId: string) => ({
      provider: 'claude' as const,
      sessionId,
      cwd,
      rotation: 0,
    })
    expect(store.nameItsLaunch(id, ref('life-b'))).toBe(true)
    const said = [
      { type: 'launched' },
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      { type: 'turn', state: 'failed' },
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      { type: 'session', state: 'started', ref: ref('life-a') },
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      // ⚑ The app quit inside that turn; the next launch is a new conversation.
      { type: 'launched' },
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      { type: 'session', state: 'started', ref: ref('life-b') },
      { type: 'turn', state: 'completed' },
    ]
    for (const [index, event] of said.entries()) {
      store.append(id, index + 1, event as Parameters<SessionStore['append']>[2], tick())
    }
    nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    writeFileSync(nativeFile, `${asThisLife('claude-transcript.jsonl', 'life-b').join('\n')}\n`)
    // The failed send: in no conversation's file.
    expect(await host.turnAsSent(id, 2)).toEqual({
      found: false,
      why: 'This message reached no provider conversation.',
    })
    // The turn the quit left open is the first conversation's, never read in the second's file.
    expect((await host.turnAsSent(id, 6)).found).toBe(false)
    // The second conversation's own first message is its file's.
    const own = await host.turnAsSent(id, 8)
    expect(own.found && own.message).toBe(CLAUDE_FIRST)
  })

  it('⛔ a message whose text this app did not keep: said so, never found by its words', async () => {
    const id = 'sess_planted_three'
    const cwd = join(userData, 'w')
    store.create({
      id,
      provider: 'claude',
      cwd,
      approvalMode: 'ask',
      profileId: 'planted',
      launchedAs: 'life-b',
    })
    expect(
      store.nameItsLaunch(id, { provider: 'claude', sessionId: 'life-b', cwd, rotation: 0 }),
    ).toBe(true)
    const said = [{ type: 'launched' }, { type: 'user_turn', text: FIRST }]
    for (const [index, event] of said.entries()) {
      store.append(id, index + 1, event as Parameters<SessionStore['append']>[2], tick())
    }
    nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    writeFileSync(nativeFile, `${asThisLife('claude-transcript.jsonl', 'life-b').join('\n')}\n`)
    expect(await host.turnAsSent(id, 2)).toEqual({
      found: false,
      why: 'This app kept no copy of the text it handed over for this message — it was sent before this app kept one, or keeping it failed — so it cannot be matched exactly in the provider’s own record.',
    })
  })

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

  it('🔴 a turn read from the provider’s own record: found by the text its importer took from it', async () => {
    // ⚑ The Claude importer's turn is the record's string content, as it is (`import-claude.ts`).
    planted('sess_imported', 'claude', [
      { type: 'user_turn', text: CLAUDE_FIRST, attribution: 'provider_transcript' },
      { type: 'turn', state: 'completed' },
    ])
    nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    writeFileSync(nativeFile, `${asThisLife('claude-transcript.jsonl', 'life-b').join('\n')}\n`)
    const turn = await host.turnAsSent('sess_imported', 2)
    expect(turn.found && turn.message).toBe(CLAUDE_FIRST)
    // ⛔ …exactly: its words alone are not it.
    planted('sess_imported_words', 'claude', [
      { type: 'user_turn', text: FIRST, attribution: 'provider_transcript' },
    ])
    expect(await host.turnAsSent('sess_imported_words', 2)).toEqual({
      found: false,
      why: 'No message in Claude Code’s own record of the conversation has the text this app read from it.',
    })
  })

  it('⛔ a person’s compaction on Codex: said so', async () => {
    planted('sess_compact', 'codex', [{ type: 'user_turn', text: '/compact' }])
    expect(await host.turnAsSent('sess_compact', 2)).toEqual({
      found: false,
      why: 'This was a command for Codex’s own compaction. No words reached the model.',
    })
  })

  it('⛔ an earlier message with the same words and nothing to match it by: which one cannot be told', async () => {
    planted('sess_two_alike', 'claude', [
      { type: 'user_turn', text: FIRST },
      { type: 'turn', state: 'completed' },
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      { type: 'turn', state: 'completed' },
    ])
    nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    writeFileSync(nativeFile, `${asThisLife('claude-transcript.jsonl', 'life-b').join('\n')}\n`)
    expect(await host.turnAsSent('sess_two_alike', 4)).toEqual({
      found: false,
      why: 'An earlier message of this conversation had the same words and no copy of what was handed over with it, so which of the two this one is cannot be told.',
    })
    // ⚑ The control: an earlier message with other words does not stand in its way.
    planted('sess_two_unalike', 'claude', [
      { type: 'user_turn', text: 'something else' },
      { type: 'turn', state: 'completed' },
      { type: 'user_turn', text: FIRST, sent: CLAUDE_FIRST },
      { type: 'turn', state: 'completed' },
    ])
    const turn = await host.turnAsSent('sess_two_unalike', 4)
    expect(turn.found && turn.message).toBe(CLAUDE_FIRST)
  })

  it.each([['same text'], ['different text']] as const)(
    'an imported turn followed by a handed-over turn: %s',
    async (earlier) => {
      const sent = 'Please check the release notes.'
      const imported = earlier === 'same text' ? sent : 'Please check the installation guide.'
      const reminder = '<system-reminder>\nOnly the imported turn.\n</system-reminder>'
      const id = 'sess_imported_then_handed'
      planted(id, 'claude', [
        { type: 'user_turn', text: imported, attribution: 'provider_transcript' },
        { type: 'turn', state: 'completed' },
        { type: 'user_turn', text: sent, sent },
        { type: 'turn', state: 'completed' },
      ])
      const user = (text: string): object => ({
        type: 'user',
        sessionId: 'life-b',
        message: { role: 'user', content: text },
      })
      const assistant = {
        type: 'assistant',
        sessionId: 'life-b',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      }
      const frames = [
        user(imported),
        {
          type: 'attachment',
          attachment: { type: 'a_new_reminder' },
          rendered: [{ content: reminder }],
          renderedRole: 'system',
        },
        assistant,
        user(sent),
        assistant,
      ].map((record) => JSON.stringify(record))
      nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
      mkdirSync(dirname(nativeFile), { recursive: true })
      writeFileSync(nativeFile, `${frames.join('\n')}\n`)

      const second = await host.turnAsSent(id, 4)
      if (!second.found) throw new Error(second.why)
      expect(second.message).toBe(sent)
      expect(second.parts.map((part) => [part.author, part.text])).toEqual([['the-message', sent]])

      const first = await host.turnAsSent(id, 2)
      if (!first.found) throw new Error(first.why)
      expect(first.message).toBe(imported)
      expect(first.parts.map((part) => [part.author, part.text])).toEqual([
        ['the-message', imported],
        ['the-provider', reminder],
      ])
    },
  )

  /**
   * ⚑ **W4.204 · a conversation adopted from one of this app's profile homes, then reopened here**,
   * as the ledger really holds it: the rows read from the provider's record, with no conversation
   * named; then the reopen, the message this app handed over, and the provider naming the
   * conversation it resumed (Codex names it before the message, Claude after).
   */
  function adoptedThenReopened(
    id: string,
    provider: Provider,
    read: readonly object[],
    live: readonly object[],
  ): void {
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
    for (const [index, event] of [
      ...read,
      { type: 'reopened' },
      { type: 'launched' },
      ...live,
    ].entries()) {
      store.append(id, index + 1, event as Parameters<SessionStore['append']>[2], tick())
    }
  }
  const resumed = (provider: Provider): object => ({
    type: 'session',
    state: 'resumed',
    ref: { provider, sessionId: 'life-b', cwd: join(userData, 'w'), rotation: 0 },
  })

  /**
   * 🔴 **W4.204 · a message handed over after one read from the record, with the same text.** The
   * file cannot say which of its records this app handed over, so the earlier turn takes its own
   * record first, by its own rule, and the message handed over is the next one.
   */
  it('🔴 a handed-over message after a read one with the same text: each finds its own record', async () => {
    const T = 'W4204-SAME Please check the release notes.'
    adoptedThenReopened(
      'sess_read_then_handed',
      'claude',
      [
        { type: 'user_turn', text: T, attribution: 'provider_transcript' },
        { type: 'assistant_message', text: 'ok' },
      ],
      [
        { type: 'user_turn', text: T, sent: T },
        resumed('claude'),
        { type: 'turn', state: 'completed' },
      ],
    )
    const user = JSON.stringify({
      type: 'user',
      sessionId: 'life-b',
      message: { role: 'user', content: T },
    })
    const assistant = JSON.stringify({
      type: 'assistant',
      sessionId: 'life-b',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    })
    const attachment = JSON.stringify({
      type: 'attachment',
      attachment: { type: 'a_new_reminder' },
      rendered: [{ content: '<system-reminder>\nThe first turn’s.\n</system-reminder>' }],
      renderedRole: 'system',
    })
    nativeFile = join(userData, 'provider-homes', 'claude', 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    writeFileSync(nativeFile, `${[user, attachment, assistant, user, assistant].join('\n')}\n`)
    const handed = await host.turnAsSent('sess_read_then_handed', 5)
    if (!handed.found) throw new Error(handed.why)
    expect(handed.parts.map((part) => part.text)).toEqual([T])
    // ⚑ The control: the turn read from the record is the first one, its reminder with it — in the
    // conversation the reopen named, not "no conversation".
    const read = await host.turnAsSent('sess_read_then_handed', 1)
    if (!read.found) throw new Error(read.why)
    expect(read.parts.map((part) => part.text)).toEqual([
      T,
      '<system-reminder>\nThe first turn’s.\n</system-reminder>',
    ])
  })

  it('🔴 …and on Codex, where the record read has no wrapper around its words', async () => {
    const T = 'W4204-SAME Please check the release notes.'
    adoptedThenReopened(
      'sess_read_then_handed_codex',
      'codex',
      [
        { type: 'user_turn', text: T, attribution: 'provider_transcript' },
        { type: 'assistant_message', text: 'ok' },
      ],
      [
        resumed('codex'),
        { type: 'user_turn', text: T, sent: T },
        { type: 'turn', state: 'completed' },
      ],
    )
    const item = (role: string, text: string): string =>
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role, content: [{ type: 'input_text', text }] },
      })
    const event = (kind: string): string =>
      JSON.stringify({ type: 'event_msg', payload: { type: kind } })
    nativeFile = join(userData, 'provider-homes', 'codex', 'sessions', 'rollout-x-life-b.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    writeFileSync(
      nativeFile,
      `${[
        JSON.stringify({ type: 'session_meta', payload: { id: 'life-b' } }),
        event('task_started'),
        item('user', '<environment_context>\n  <cwd>/w</cwd>\n</environment_context>'),
        item('user', T),
        item('assistant', 'ok'),
        event('task_complete'),
        event('task_started'),
        item('user', T),
        item('assistant', 'ok'),
        event('task_complete'),
      ].join('\n')}\n`,
    )
    const handed = await host.turnAsSent('sess_read_then_handed_codex', 6)
    if (!handed.found) throw new Error(handed.why)
    expect(handed.parts.map((part) => part.text)).toEqual([T])
    // ⚑ The control: the turn read from the record is the first one, in the conversation named.
    const read = await host.turnAsSent('sess_read_then_handed_codex', 1)
    if (!read.found) throw new Error(read.why)
    expect(read.message).toBe(T)
    expect(read.parts.map((part) => part.text)).toContain(
      '<environment_context>\n  <cwd>/w</cwd>\n</environment_context>',
    )
  })

  it('⛔ a file that is not the provider’s record of a conversation is never read', async () => {
    const { sessionId, places, life } = await conversation('claude', [FIRST])
    const sent = handedOver(sessionId, places[0])
    // ⚑ Where the provider's database could name anything: outside its `projects/`.
    nativeFile = join(userData, 'provider-homes', 'claude', 'elsewhere.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    const file = rewritten('claude', asThisLife('claude-transcript.jsonl', life), FIRST, () => sent)
    writeFileSync(nativeFile, `${file.join('\n')}\n`)
    expect(await host.turnAsSent(sessionId, places[0] ?? -1)).toEqual({
      found: false,
      why: 'The provider’s own record of this message is gone, and the app kept no copy of it.',
    })
  })

  it('⛔ a place that holds no message, and a conversation the app does not hold: said so', async () => {
    const { sessionId } = await conversation('claude', [FIRST])
    expect(await host.turnAsSent(sessionId, 0)).toEqual({
      found: false,
      why: 'There is no message at that place.',
    })
    expect(await host.turnAsSent('sess_nobody', 3)).toEqual({
      found: false,
      why: 'This conversation has no record with its provider yet, or is not in this app.',
    })
    // ⚑ The provider's file gone, and nothing else holds a copy.
    const gone = await conversation('claude', [FIRST])
    expect(await host.turnAsSent(gone.sessionId, gone.places[0] ?? -1)).toEqual({
      found: false,
      why: 'The provider’s own record of this message is gone, and the app kept no copy of it.',
    })
  })

  it('⛔ read only, and reached by a window only inside the person’s own read', () => {
    for (const file of [
      'archive/turn-as-sent.ts',
      'archive/turn-reading.ts',
      'providers/claude/turn-reading.ts',
      'providers/codex/turn-reading.ts',
    ]) {
      const source = readFileSync(join(here, '../src/main', file), 'utf8')
      expect(source).not.toMatch(/from 'node:fs'/)
    }
    const host = readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8')
    const source = ts.createSourceFile('runtime-host.ts', host, ts.ScriptTarget.Latest, true)
    const owner = source.statements.find(
      (node): node is ts.ClassDeclaration =>
        ts.isClassDeclaration(node) && node.name?.text === 'RuntimeHost',
    )
    const selected = owner?.members.find(
      (node): node is ts.MethodDeclaration =>
        ts.isMethodDeclaration(node) && node.name.getText(source) === 'readTurnAsSent',
    )
    expect(selected).toBeDefined()
    if (selected === undefined) throw new Error('The turn reader method is missing')
    const method = selected.getText(source)
    expect(method).toContain('this.deps.nativeTranscriptPath(row.provider, home, ref)')
    expect(method).toContain('isTheProvidersRecord(row.provider, home, found)')
    expect(method).not.toMatch(/writeFile|appendFile|rmSync|unlink|readdir/)
    // ⛔ W4.172 · no channel of its own: `whatTheModelGot` carries it, a person's read that a quit
    // refuses (`ipc.ts`).
    const main = readFileSync(join(here, '../src/main/index.ts'), 'utf8')
    const preload = readFileSync(join(here, '../src/preload/index.ts'), 'utf8')
    for (const wire of [main, preload]) expect(wire).not.toMatch(/turnAsSent|turn-as-sent/)
    const ipc = readFileSync(join(here, '../src/main/runtime/ipc.ts'), 'utf8')
    expect(ipc).toContain("  whatTheModelGot: 'refused',")
    const handled = ipc.slice(ipc.indexOf("    case 'whatTheModelGot':"))
    expect(handled.slice(0, handled.indexOf('return host.whatTheModelGot'))).toContain(
      'requireAPerson(sink, command.kind)',
    )
  })
})

/**
 * Every file and folder under `root`, `root` among them: a file's size, mtime and fingerprint, a
 * folder's mtime — which moves when anything is made or removed in it, so a write that cleans up
 * after itself is seen too.
 */
function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = { './': `dir:${String(lstatSync(root).mtimeMs)}` }
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      if (entry.isDirectory()) {
        out[`${rel}/`] = `dir:${String(lstatSync(path).mtimeMs)}`
        walk(path)
        continue
      }
      const stat = lstatSync(path)
      const sha = createHash('sha256').update(readFileSync(path)).digest('hex')
      out[rel] = `${String(stat.size)}:${String(stat.mtimeMs)}:${sha}`
    }
  }
  walk(root)
  return out
}

const ENV_KEYS = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'] as const

describe.sequential(
  '§5 · ⛔ a conversation from a person’s own ~/.codex: read, and nothing written there',
  () => {
    const migrationsDir = join(here, '../src/main/db/migrations')
    let userData: string
    /** The throwaway "home" the person's own `.codex` sits in. */
    let theirs: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let saved: Record<(typeof ENV_KEYS)[number], string | undefined>

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-turn-as-sent-theirs-'))
      theirs = mkdtempSync(join(tmpdir(), 'brobot2-their-home-'))
      saved = {
        HOME: process.env['HOME'],
        USERPROFILE: process.env['USERPROFILE'],
        CODEX_HOME: process.env['CODEX_HOME'],
        CLAUDE_CONFIG_DIR: process.env['CLAUDE_CONFIG_DIR'],
      }
      process.env['HOME'] = theirs
      process.env['USERPROFILE'] = theirs
      process.env['CODEX_HOME'] = join(theirs, '.codex')
      process.env['CLAUDE_CONFIG_DIR'] = join(theirs, '.claude')
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsDir)
      store = createSessionStore(db)
      host = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        // ⚑ The real lookup: Codex's own state database names the rollout.
        nativeTranscriptPath,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new FakeRuntime(provider),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => 'sess_unused',
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CODEX_HOME',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    })

    afterEach(async () => {
      for (const key of ENV_KEYS) {
        const value = saved[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
      rmSync(theirs, { recursive: true, force: true })
    })

    /**
     * ⛔ **SAFETY — the person's Codex folder, only when it is the throwaway one.** Throws before
     * anything is written or read when it resolves anywhere else.
     */
    const theirCodex = (): string => {
      const home = userProviderHomePath('codex')
      if (!home.startsWith(`${theirs}${sep}`) || homedir() !== theirs) {
        throw new Error(`refusing to run: the codex home resolves to ${home}, outside ${theirs}`)
      }
      return home
    }

    it('⛔ its state database is read through a copy: no -shm, no -wal, nothing new or changed', async () => {
      const codexHome = theirCodex()
      const thread = '01a1097a-21e1-7d90-a4ad-84b011603090'
      const rollout = join(
        codexHome,
        'sessions',
        '2026',
        '10',
        '05',
        `rollout-2026-10-05-${thread}.jsonl`,
      )
      mkdirSync(dirname(rollout), { recursive: true })
      const codex = lines('codex-rollout.jsonl')
      // ⚑ The turn as the Codex importer took it from the rollout: Codex's message text, split from
      // what Codex put around it (`import-codex.ts`) — the row a conversation adopted from a
      // person's own folder carries, with no text handed over.
      const said = sentIn('codex', codex, NOTE)
      writeFileSync(rollout, `${codex.join('\n')}\n`)
      // ⚑ Codex's state database in WAL mode, closed: no `-shm` beside it — the hazard
      // `readProviderDatabase` exists for (`native-file.ts`).
      const state = new Database(join(codexHome, 'state_5.sqlite'))
      state.pragma('journal_mode = WAL')
      state.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)')
      state.prepare('INSERT INTO threads (id, rollout_path) VALUES (?, ?)').run(thread, rollout)
      state.close()
      writeFileSync(join(codexHome, 'config.toml'), 'model = "theirs"\n')
      // ⚑ A conversation found in the person's own folder: adopted, with no profile.
      store.adopt({
        id: 'sess_theirs',
        provider: 'codex',
        sessionId: thread,
        cwd: join(userData, 'project'),
        profileId: null,
        createdAt: 1_000,
        updatedAt: 2_000,
      })
      store.append(
        'sess_theirs',
        1,
        { type: 'user_turn', text: said, attribution: 'provider_transcript' },
        3_000,
      )
      const before = treeOf(theirs)
      expect(Object.keys(before).some((path) => path.endsWith('-shm'))).toBe(false)

      const turn = await host.turnAsSent('sess_theirs', 1)
      // ⚑ The premise: it really was read from the rollout the database names.
      expect(turn.found && turn.message).toBe(said)

      expect(treeOf(theirs)).toEqual(before)
    })
  },
)
