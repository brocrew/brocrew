import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allProviderCapabilities, type RuntimeEvent } from '@brobot2/runtime'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { theStallAndItsAsk } from '../src/main/runtime/reply-rails'
import {
  applyEvent,
  createTranscript,
  replacedSignInNotice,
  type NoticeItem,
} from '../src/renderer/src/lib/transcript'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'
import { UNDRIVEN_SENTENCES, derivePieces, type PieceRow } from '../src/shared/tasks'

/**
 * # A Codex key that stops working is said as the key, not *"sign in again"*
 *
 * A Codex profile runs on the OpenAI API key a person saved in Providers: BroBot logs its home in
 * with the key, and Codex answers the launch's own sign-in probe with an `apiKey` account. When
 * OpenAI then refuses the key (401), Codex says `unauthorized` — and the conversation read
 * *"This profile’s sign-in was rejected… Start a new conversation to sign in again — the launcher will
 * offer it"*, while the launcher offers no sign-in at all as long as a key is saved. The runtime
 * marks the refusal `onAKey` (its own test is in `codex-runtime.test.ts`), and each surface says the
 * key. A profile on its ChatGPT sign-in keeps its notice word for word.
 *
 * ⚑ **And a refused Codex turn is a refused login, as a Claude one is** (§3–§4). A Codex turn that
 * failed on `unauthorized` used to stall its piece as *"its turn ended with this work still open"*,
 * whichever credential it was; its row now says `loginRefused`, so the piece stalls `login_refused`
 * and its giver is told whose login, which kind, and who can fix it.
 *
 * ⚑ Fake values only: no key, token or login is read or written by any test here.
 */

const noticesFor = (...events: RuntimeEvent[]): NoticeItem[] => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state.items.filter((item): item is NoticeItem => item.kind === 'notice')
}

const REFUSED = (onAKey: boolean): Extract<RuntimeEvent, { type: 'error' }> => ({
  type: 'error',
  message: onAKey
    ? 'Incorrect API key provided'
    : 'Your access token could not be refreshed. Please log out and sign in again.',
  fatal: false,
  cause: 'auth',
  ...(onAKey ? { onAKey: true as const } : {}),
})

describe('§1 · the conversation’s notice names the credential Codex refused', () => {
  it('🔴 on a key: the key, the button that checks it, and what a new conversation runs on', () => {
    const [notice] = noticesFor(REFUSED(true))
    expect(notice?.level).toBe('error')
    expect(notice?.text).toBe(
      'The API key this conversation was started with was refused, so this conversation cannot run on it. Check or replace the key under “API key” on the Codex card in Providers — “Check it works” there asks whether a saved key still works — then start a new conversation, which runs on the key saved then.',
    )
    expect(notice?.text).not.toMatch(/sign in|sign-in|launcher/)
    // ⚑ The provider's own words stay out of the notice, as for a sign-in (085's split).
    expect(notice?.text).not.toContain('Incorrect API key provided')
  })

  it('⚑ control: on a ChatGPT sign-in, today’s words exactly', () => {
    const [notice] = noticesFor(REFUSED(false))
    expect(notice?.text).toBe(
      'This profile’s sign-in was rejected, so this conversation cannot continue. Start a new conversation to sign in again — the launcher will offer it.',
    )
  })
})

describe('§1b · a refused sign-in this app replaces by itself says so', () => {
  const TODAY =
    'This profile’s sign-in was rejected, so this conversation cannot continue. Start a new conversation to sign in again — the launcher will offer it.'
  const started = (provider: 'claude' | 'codex'): RuntimeEvent =>
    ({
      type: 'session',
      state: 'started',
      ref: { provider, sessionId: `sess_${provider}` },
    }) as unknown as RuntimeEvent
  /** The refused turn's row, with the host's fact that the app replaces a refused copy. */
  const replaced = (onAKey = false): RuntimeEvent => ({
    ...REFUSED(onAKey),
    replacesRefusedSignIn: true,
  })
  const errorOf = (...events: RuntimeEvent[]): string | undefined =>
    noticesFor(...events).find((notice) => notice.level === 'error')?.text

  it('🔴 Codex, on a sign-in the app replaces: the new sentence, whole, naming the provider and its card', () => {
    expect(errorOf(started('codex'), replaced())).toBe(
      'Codex refused this agent’s sign-in, so this turn stopped. This app replaces it by itself when a newer sign-in to the same account is on this computer, and reopens this conversation. Signing in to Codex again on the Codex card in Providers gives it one.',
    )
  })

  it('⚑ one template: the provider’s name is the only word that changes, three times', () => {
    const said = replacedSignInNotice('Acme')
    expect(said.match(/Acme/g)).toHaveLength(3)
    expect(said.replaceAll('Acme', 'Codex')).toBe(replacedSignInNotice('Codex'))
    expect(said).not.toMatch(/cannot continue|launcher|BroBot/)
  })

  it('⛔ Claude, and Codex without the fact: today’s sentence, unchanged', () => {
    expect(errorOf(started('claude'), REFUSED(false))).toBe(TODAY)
    expect(errorOf(started('codex'), REFUSED(false))).toBe(TODAY)
  })

  it('⛔ a saved API key keeps its own sentence, whatever the fact says', () => {
    const key = errorOf(started('codex'), REFUSED(true))
    expect(key).toContain('The API key this conversation was started with was refused')
    expect(errorOf(started('codex'), replaced(true))).toBe(key)
  })

  it('⛔ a row with no provider to name reads as today, even with the fact', () => {
    expect(errorOf(replaced())).toBe(TODAY)
    // An older row carries neither.
    expect(errorOf(REFUSED(false))).toBe(TODAY)
  })
})

describe('§2 · the Codex card says what a profile holds while a key is saved', () => {
  it('🔴 the profile line names the key beside the sign-in', () => {
    const codex = allProviderCapabilities().codex
    const note = String((codex.homeCredential as { note?: unknown }).note ?? '')
    expect(note).toContain(
      'This profile keeps a sign-in of its own — or, while an OpenAI API key is saved under “API key” on the Codex card in Providers, that key instead.',
    )
    // ⚑ The launcher adds *"It is copied when…"* after the note, so the note ends on the sign-in.
    expect(note).toMatch(/never replaced on its own\.$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the piece a refused Codex turn was driving
// ─────────────────────────────────────────────────────────────────────────────────────────────

let ordinal = 0
const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: 8_000_000 + ordinal * 1_000,
  event,
})
const theTask = (entries: TranscriptEvent[], provider?: 'claude' | 'codex'): PieceRow => {
  ordinal = 0
  const found = derivePieces('sess_worker', entries.map(row), {
    ...(provider === undefined ? {} : { provider }),
  })[0]
  if (found === undefined) throw new Error('no piece was folded')
  return found
}
const itsTurnFailed = (turn: TranscriptEvent): TranscriptEvent[] => [
  {
    type: 'work_given',
    piece: 'work_7',
    label: 'W1.7',
    parent: 'work_root',
    givenBy: 'sess_giver',
    title: 'Build the index',
    brief: 'build the index',
  },
  { type: 'user_turn', text: 'build the index' },
  { type: 'status', state: 'working' },
  turn,
  // ⚑ Codex's session stays open after the refusal: no `errored`, an `idle`.
  { type: 'status', state: 'idle' },
]

describe('§3 · a refused Codex turn stalls its piece on the login, saying whose and which kind', () => {
  it('🔴 on a key', () => {
    expect(
      theTask(
        itsTurnFailed({ type: 'turn', state: 'failed', loginRefused: true, onAKey: true }),
        'codex',
      ),
    ).toMatchObject({
      state: 'stalled',
      stalledBecause: 'login_refused',
      stoppedOnALogin: { reopened: false, onAKey: true, provider: 'codex' },
    })
  })

  it('🔴 on a ChatGPT sign-in', () => {
    const task = theTask(
      itsTurnFailed({ type: 'turn', state: 'failed', loginRefused: true }),
      'codex',
    )
    expect(task.stalledBecause).toBe('login_refused')
    expect(task.stoppedOnALogin).toEqual({ reopened: false, provider: 'codex' })
  })

  it('⛔ a usage limit stays a usage limit', () => {
    const task = theTask(
      itsTurnFailed({ type: 'turn', state: 'failed', limit: { provider: 'codex' } }),
      'codex',
    )
    expect(task.stalledBecause).toBe('provider_limited')
    expect(task).not.toHaveProperty('stoppedOnALogin')
  })

  it('⚑ the sentence a person’s row reads names no provider’s login wrongly', () => {
    expect(UNDRIVEN_SENTENCES.login_refused).toBe(
      'its turn failed because its provider refused the sign-in or API key its conversation was started with.',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · what its giver is told
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the giver is told whose login was refused, which kind, and who can fix it', () => {
  const said = (login: Parameters<typeof theStallAndItsAsk>[3]): string =>
    theStallAndItsAsk('login_refused', null, undefined, login)

  it('🔴 a Codex key: the key, the card, and that a person has to do it', () => {
    expect(said({ reopened: false, onAKey: true, provider: 'codex' })).toBe(
      'its turn failed because the API key its Codex conversation was started with was refused, so a person needs to check or replace that key under “API key” on the Codex card in Providers',
    )
  })

  it('🔴 a Codex sign-in: signed in again by a person — no Claude, no renewal, no reopen it waits for', () => {
    expect(said({ reopened: false, provider: 'codex' })).toBe(
      'its turn failed because Codex refused the sign-in its conversation was started with, so a person needs to sign its Codex profile in again',
    )
  })

  it('⚑ a Codex conversation reopened since says so, as a Claude one does', () => {
    expect(said({ reopened: true, onAKey: true, provider: 'codex' })).toContain(
      '; its conversation has been reopened since, and nothing from that turn was sent again',
    )
  })

  it('⚑ control: Claude’s login, told by the store or not, reads as it did', () => {
    const claudes =
      'its turn failed because Claude refused the login its conversation was started with, as it does when another Claude on this computer renews or switches the login, and its conversation has not been reopened since'
    expect(said({ reopened: false, provider: 'claude' })).toBe(claudes)
    expect(said({ reopened: false })).toBe(claudes)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the store tells the fold whose conversation it is
// ─────────────────────────────────────────────────────────────────────────────────────────────

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('§5 · the store hands the fold each conversation’s provider', () => {
  it('🔴 a Codex conversation’s refused login says Codex, and a Claude one says nothing new', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-whose-login-'))
    const db = openDatabase(join(dir, 'db.sqlite'))
    try {
      applyMigrations(db, migrations)
      const store = createSessionStore(db)
      const refusedIn = (id: string, provider: 'claude' | 'codex'): PieceRow | undefined => {
        store.create({ id, provider, cwd: dir, approvalMode: 'ask', profileId: 'default' })
        const turn: TranscriptEvent = { type: 'turn', state: 'failed', loginRefused: true }
        itsTurnFailed(turn).forEach((event, ordinal) =>
          store.append(id, ordinal, event, 9_000_000 + ordinal),
        )
        return store.piecesOwnedBy(id).at(-1)
      }
      expect(refusedIn('sess_codex', 'codex')?.stoppedOnALogin).toEqual({
        reopened: false,
        provider: 'codex',
      })
      expect(refusedIn('sess_claude', 'claude')?.stoppedOnALogin).toEqual({
        reopened: false,
        provider: 'claude',
      })
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
