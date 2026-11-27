import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scratchFolders } from './helpers/scratch-folders'
import { REQUEST_MARKER } from '../src/main/providers/codex/codex-injected'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { asyncLedgerGenerations } from '../src/main/database/sqlite/ledger/generations'
import { importCodexRollout } from '../src/main/providers/codex/import-transcript'
import { readingATurn, type TurnAsked } from '../src/main/archive/turn-as-sent'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { linesOf as heldLines } from './helpers/provider-lines'
import { WHAT_CHANGED_HEADER } from '../src/main/runtime/codex-lead'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { savedMethodsFolder } from '../src/main/connections/homes'
import {
  readSavedMethods,
  SAVED_METHODS_INDEX,
  savedMethodsParagraphs,
  type SavedMethodsReading,
} from '../src/main/saved-methods'

const NOW = Date.UTC(2026, 9, 14, 5, 30)
const THREAD = 'thread-saved-methods'
const SESSION = 'sess_saved_methods'
const TITLES = ['Rotate a fictional log', 'Back up a fictional disk'] as const

const scratch = scratchFolders()

function aProfile(methods: boolean): string {
  const folder = savedMethodsFolder(scratch('re-derived'), 'fictional-writer')
  if (methods) {
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'rotate-log.md'), '# Rotate\n')
    writeFileSync(join(folder, 'back-up.md'), '# Back up\n')
    writeFileSync(
      join(folder, SAVED_METHODS_INDEX),
      `- ${TITLES[0]} | when the log passes 1 GB | verified 2026-10-12 | rotate-log.md\n` +
        `- ${TITLES[1]} | weekly | verified 2026-10-13 | back-up.md\n`,
    )
  }
  return folder
}

const aReading = (methods: boolean): SavedMethodsReading => readSavedMethods(aProfile(methods), NOW)

const anHourLater = (reading: SavedMethodsReading): SavedMethodsReading =>
  readSavedMethods(reading.folder, NOW + 3_600_000)

function context(): InstructionContext {
  return {
    profileSlug: 'fictional-writer',
    cwd: '/tmp/work',
    startedBy: null,
    root: 'not-yet-numbered',
  }
}

function wholeLead(savedMethods?: SavedMethodsReading): string {
  const root = scratch('lead')
  const home = join(root, 'home')
  const cwd = join(root, 'work')
  const userHome = join(root, 'user-home')
  for (const one of [home, cwd, userHome]) mkdirSync(one)
  const launch = context()
  const bundle = publishProfileBundle('codex', home, composeProfileBundle(launch))
  const read = readSessionInstructions({
    provider: 'codex',
    cwd,
    providerHome: home,

    home: userHome,
    bundle,
    thisConversation: thisConversationSpans(launch),
  })
  if (read.firstTurnLead === null) throw new Error('no lead')
  return savedMethods === undefined
    ? read.firstTurnLead
    : `${read.firstTurnLead}\n\n${legacyIndex(savedMethods)}`
}

// Synthetic historical input. Older versions put the index in their launch lead.
function legacyIndex(reading: SavedMethodsReading): string {
  return ['## Saved methods', ...savedMethodsParagraphs(reading)].join('\n\n')
}

const holdsATitle = (text: string): boolean => TITLES.some((title) => text.includes(title))

const stamp = (minute: number): string => new Date(NOW + minute * 60_000).toISOString()
const aLine = (minute: number, type: string, payload: object): string =>
  JSON.stringify({ timestamp: stamp(minute), type, payload })
const meta = aLine(0, 'session_meta', { id: THREAD, cwd: '/tmp/work', cli_version: '0.0.0' })
const environment = (minute: number): string =>
  aLine(minute, 'response_item', {
    type: 'message',
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: '<environment_context>\n  <cwd>/tmp/work</cwd>\n</environment_context>',
      },
    ],
  })
const userSaid = (minute: number, text: string): string =>
  aLine(minute, 'response_item', {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  })
const answered = (minute: number, text: string): string =>
  aLine(minute, 'response_item', {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  })

describe('a Codex ledger re-derived from its rollout', () => {
  function aStore() {
    const db = openDatabase(join(scratch('db'), 'db.sqlite'))
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    const store = createSessionStore(db)
    store.adopt({
      id: SESSION,
      provider: 'codex',
      sessionId: THREAD,
      cwd: '/tmp/work',
      profileId: 'default',
      updatedAt: NOW,
      createdAt: NOW,
    })
    return { db, store }
  }

  it('keeps saved-method lines when importing and rebuilding the ledger', async () => {
    const reading = aReading(true)
    const later = anHourLater(reading)
    const first = `${wholeLead(reading)}\n\nRotate the logs, please.`
    const reopened = `${WHAT_CHANGED_HEADER}\n\n${legacyIndex(later)}\n\nAnd once more.`

    const marked = `${wholeLead(later)}\n\n${REQUEST_MARKER}\nCheck the disk.`
    const rollout = [
      meta,
      environment(1),
      userSaid(2, first),
      answered(3, 'Done.'),
      environment(4),
      userSaid(5, reopened),
      answered(6, 'Done again.'),
      userSaid(7, marked),
      answered(8, 'Checked.'),
    ]
    expect(rollout.filter(holdsATitle)).toHaveLength(3)

    const { db, store } = aStore()
    try {
      const derive = (rebuild: boolean) =>
        deriveLedger(asyncLedgerGenerations(store), SESSION, 'codex', heldLines(rollout), {
          fallbackAt: NOW,
          rebuild,
        })
      expect(await derive(false)).toBe('imported')
      expect(await derive(true)).toBe('imported')

      const rows = db.prepare('SELECT * FROM events').all()
      expect(rows.length).toBeGreaterThan(0)
      expect(holdsATitle(JSON.stringify(rows))).toBe(true)

      const events = store.events(SESSION).map((entry) => entry.event)
      const turns = events.flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))

      expect(turns).toEqual([first, reopened, 'Check the disk.'])
      const echoes = events.filter(
        (event) => event.type === 'unknown' && JSON.stringify(event).includes(REQUEST_MARKER),
      )
      expect(echoes).toHaveLength(1)
      expect(holdsATitle(JSON.stringify(echoes))).toBe(true)
    } finally {
      db.close()
    }
  })

  it('reads a rollout without the section as it did', () => {
    const plain = `${wholeLead()}\n\nRotate the logs, please.`
    const rollout = [meta, environment(1), userSaid(2, plain), answered(3, 'Done.')]
    const turns = importCodexRollout(rollout, NOW).entries.flatMap((entry) =>
      entry.event.type === 'user_turn' ? [entry.event.text] : [],
    )
    expect(turns).toEqual([plain])
  })
})

describe('the turn as Codex got it, found in its rollout', () => {
  const read = (rollout: readonly string[], asked: TurnAsked) => {
    const reading = readingATurn('codex', asked)
    for (const line of rollout) if (reading.line(line) === 'done') break
    return reading.answer()
  }

  it('by the text a re-derived ledger holds, and by the text a live row keeps', () => {
    const reading = aReading(true)
    const first = `${wholeLead(reading)}\n\nRotate the logs, please.`
    const rollout = [meta, environment(1), userSaid(2, first), answered(3, 'Done.')]
    const imported = importCodexRollout(rollout, NOW).entries.flatMap((entry) =>
      entry.event.type === 'user_turn' ? [entry.event.text] : [],
    )
    expect(imported).toHaveLength(1)

    const fromItsRecord = read(rollout, {
      by: 'its-own-record',
      text: imported[0] ?? '',
      before: [],
      life: THREAD,
    })
    expect(fromItsRecord.found).toBe(true)

    const handedOver = read(rollout, {
      by: 'handed-over',
      text: first,
      before: [],
      life: THREAD,
    })
    expect(handedOver.found).toBe(true)

    if (handedOver.found) expect(handedOver.message).toBe(first)
  })
})
