import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { REQUEST_MARKER } from '../src/main/archive/codex-injected'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { importCodexRollout } from '../src/main/archive/import-codex'
import { readingATurn, type TurnAsked } from '../src/main/archive/turn-as-sent'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { linesOf as heldLines } from './helpers/provider-lines'
import { sectionsOf, theLeadOwed } from '../src/main/runtime/codex-lead'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { savedMethodsFolder } from '../src/main/runtime/provider-homes'
import {
  readSavedMethods,
  SAVED_METHODS_INDEX,
  type SavedMethodsReading,
} from '../src/main/saved-methods'

const NOW = Date.UTC(2026, 9, 14, 5, 30)
const THREAD = 'thread-saved-methods'
const SESSION = 'sess_saved_methods'
const TITLES = ['Rotate a fictional log', 'Back up a fictional disk'] as const

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
const scratch = (name: string): string => {
  const folder = mkdtempSync(join(realpathSync(tmpdir()), `${name}-`))
  folders.push(folder)
  return folder
}

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

function context(savedMethods?: SavedMethodsReading): InstructionContext {
  return {
    profileSlug: 'fictional-writer',
    cwd: '/tmp/work',
    startedBy: null,
    depth: 0,
    capabilities: DEFAULT_CAPABILITIES,
    spawningEnabled: true,
    root: 'not-yet-numbered',
    others: { shown: [], more: 0 },
    ...(savedMethods === undefined ? {} : { savedMethods }),
  }
}

function wholeLead(savedMethods?: SavedMethodsReading): string {
  const root = scratch('lead')
  const home = join(root, 'home')
  const cwd = join(root, 'work')
  const userHome = join(root, 'user-home')
  for (const one of [home, cwd, userHome]) mkdirSync(one)
  const launch = context(savedMethods)
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
  return read.firstTurnLead
}

function whatChangedLead(earlier: SavedMethodsReading, later: SavedMethodsReading): string {
  const before = thisConversationSpans(context(earlier))
  const now = thisConversationSpans(context(later))
  const owed = theLeadOwed(
    { carried: [], sections: sectionsOf({ text: before.text, sections: before.spans }) },
    { text: now.text, sections: now.spans },
  )
  if (owed?.is !== 'what-changed') throw new Error('not what changed')
  return owed.text
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
    const reopened = `${whatChangedLead(reading, later)}\n\nAnd once more.`

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
        deriveLedger(store, SESSION, 'codex', heldLines(rollout), { fallbackAt: NOW, rebuild })
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
