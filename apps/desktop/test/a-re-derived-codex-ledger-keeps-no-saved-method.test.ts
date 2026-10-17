import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import {
  codexMessageAsKept,
  codexTextAsKept,
  REQUEST_MARKER,
  savedMethodsLinesInLead,
} from '../src/main/archive/codex-injected'
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
  SAVED_METHODS_SECTION_AND_REST_NOT_KEPT,
  SAVED_METHODS_SECTION_NOT_KEPT,
  savedMethodsLinesOf,
  withTheLinesKept,
  withTheLinesSent,
  type SavedMethodsLines,
  type SavedMethodsReading,
} from '../src/main/saved-methods'

/**
 * A Codex conversation's ledger re-derived from its rollout keeps the saved methods' lines out, as
 * the live record does: the rollout holds the lead as the model got it, and the app's own "Saved
 * methods" section in it is kept in the form the live row keeps. The rollout itself, and so the
 * archive and its exports, stay as Codex wrote them.
 */

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

/** A fictional profile's saved-methods folder, with two methods or none. */
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

/** The same folder read again an hour later, as a reopen reads it. */
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

/** The whole lead a Codex launch puts in front of its first message, as the model is sent it. */
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
    // A scratch home, so the reader never looks at the real one.
    home: userHome,
    bundle,
    thisConversation: thisConversationSpans(launch),
  })
  if (read.firstTurnLead === null) throw new Error('no lead')
  return withTheLinesSent(
    read.firstTurnLead,
    savedMethods === undefined ? null : savedMethodsLinesOf(savedMethods),
  )
}

/** What a reopen an hour later owes a thread that holds the first lead: the section whose time moved. */
function whatChangedLead(earlier: SavedMethodsReading, later: SavedMethodsReading): string {
  const before = thisConversationSpans(context(earlier))
  const now = thisConversationSpans(context(later))
  const owed = theLeadOwed(
    { carried: [], sections: sectionsOf({ text: before.text, sections: before.spans }) },
    { text: now.text, sections: now.spans },
  )
  if (owed?.is !== 'what-changed') throw new Error('not what changed')
  return withTheLinesSent(owed.text, savedMethodsLinesOf(later))
}

const linesOf = (reading: SavedMethodsReading): SavedMethodsLines => {
  const lines = savedMethodsLinesOf(reading)
  if (lines === null) throw new Error('no lines')
  return lines
}

const holdsATitle = (text: string): boolean => TITLES.some((title) => text.includes(title))

// ── a rollout, as Codex writes one ──

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

describe('the app’s own Saved methods section, found in a Codex message', () => {
  it('in the whole lead and in what changed, gives the lines and the kept form the live row holds', () => {
    const reading = aReading(true)
    const lines = linesOf(reading)
    const first = `${wholeLead(reading)}\n\nRotate the logs, please.`
    expect(holdsATitle(first)).toBe(true)
    expect(savedMethodsLinesInLead(first)).toEqual(lines)
    // The text a live row keeps of the same message, character for character.
    expect(codexTextAsKept(first)).toBe(withTheLinesKept(first, lines))
    expect(holdsATitle(codexTextAsKept(first))).toBe(false)
    expect(codexTextAsKept(first)).toContain('Rotate the logs, please.')

    const later = anHourLater(reading)
    const reopened = `${whatChangedLead(reading, later)}\n\nAnd once more.`
    expect(reopened).toContain('2026-10-14 06:30 UTC')
    expect(reopened).not.toContain('## What you may do')
    expect(savedMethodsLinesInLead(reopened)).toEqual(linesOf(later))
    expect(codexTextAsKept(reopened)).toBe(withTheLinesKept(reopened, linesOf(later)))
  })

  it('keeps a section with none saved, or an index that was not sent, as it is', () => {
    const none = `${wholeLead(aReading(false))}\n\nHello.`
    expect(none).toContain('None saved yet when this conversation was opened or reopened')
    expect(savedMethodsLinesInLead(none)).toBeNull()
    expect(codexTextAsKept(none)).toBe(none)

    const refused = `${wholeLead({
      kind: 'refused',
      folder: '/fictional/runbooks',
      readAt: NOW,
      refusal: { kind: 'not-a-file', what: 'the-index' },
    })}\n\nHello.`
    expect(refused).toContain('The index was not sent: index.md is not a plain file.')
    expect(savedMethodsLinesInLead(refused)).toBeNull()
    expect(codexTextAsKept(refused)).toBe(refused)
  })

  it('keeps nothing of a section not in this build’s form, through its last paragraph', () => {
    const reading = aReading(true)
    const current = wholeLead(reading)
    // The section as an earlier build composed it: no sentence saying when the index was read.
    const older = current.replace(
      / Index read at [^;]+; earlier turns may have seen a different list\./,
      '',
    )
    expect(older).not.toBe(current)
    const message = `${older}\n\nRotate the logs, please.`
    const kept = codexTextAsKept(message)
    expect(holdsATitle(kept)).toBe(false)
    expect(kept).toContain(`## Saved methods\n\n${SAVED_METHODS_SECTION_NOT_KEPT}\n\n`)
    expect(kept).not.toContain('To save a method')
    // The message's own words are kept.
    expect(kept.endsWith('\n\nRotate the logs, please.')).toBe(true)
  })

  it('keeps nothing from the section on when where it ends cannot be told', () => {
    const reading = aReading(true)
    const changed = wholeLead(reading).replace('at most 16 KiB', 'at most 8 KiB')
    const message = `${changed}\n\nRotate the logs, please.`
    const kept = codexTextAsKept(message)
    expect(holdsATitle(kept)).toBe(false)
    expect(kept.endsWith(`## Saved methods\n\n${SAVED_METHODS_SECTION_AND_REST_NOT_KEPT}`)).toBe(
      true,
    )
    expect(kept).not.toContain('Rotate the logs, please.')
  })

  it('reads no section outside the app’s lead, and nothing of a lead without one', () => {
    const lines = linesOf(aReading(true))
    const quoted = `Notes from earlier:\n\n## Saved methods\n\n${lines.sent}\n\nWhat do you think?`
    expect(savedMethodsLinesInLead(quoted)).toBeNull()
    expect(codexTextAsKept(quoted)).toBe(quoted)
    const payload = {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: quoted }],
    }
    expect(codexMessageAsKept(payload)).toBe(payload)

    const noSection = `${wholeLead()}\n\nRotate the logs, please.`
    expect(noSection).toContain('## What you may do')
    expect(noSection).not.toContain('## Saved methods')
    expect(codexTextAsKept(noSection)).toBe(noSection)
    // Only a message handed to the model is read for the app's lead, never the agent's answer.
    const answer = {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: wholeLead(aReading(true)) }],
    }
    expect(codexMessageAsKept(answer)).toBe(answer)
  })
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

  it('holds no saved method’s line in any row, and the archive holds the rollout as written', async () => {
    const reading = aReading(true)
    const later = anHourLater(reading)
    const first = `${wholeLead(reading)}\n\nRotate the logs, please.`
    const reopened = `${whatChangedLead(reading, later)}\n\nAnd once more.`
    // Words that hold Codex's own request marker make the line part injected: its echo keeps the line.
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

      // No row of any generation holds a title.
      const rows = db.prepare('SELECT * FROM events').all()
      expect(rows.length).toBeGreaterThan(0)
      expect(holdsATitle(JSON.stringify(rows))).toBe(false)

      const events = store.events(SESSION).map((entry) => entry.event)
      const turns = events.flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))
      // Each message as the live row keeps it, its words and all.
      expect(turns).toEqual([
        withTheLinesKept(first, linesOf(reading)),
        withTheLinesKept(reopened, linesOf(later)),
        'Check the disk.',
      ])
      expect(turns[0]).toContain(linesOf(reading).kept)
      const echoes = events.filter(
        (event) => event.type === 'unknown' && JSON.stringify(event).includes(REQUEST_MARKER),
      )
      expect(echoes).toHaveLength(1)
      expect(JSON.stringify(echoes)).toContain(JSON.stringify(linesOf(later).kept).slice(1, -1))
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
      text: withTheLinesKept(first, linesOf(reading)),
      before: [],
      life: THREAD,
    })
    expect(handedOver.found).toBe(true)
    // What the model got is read from Codex's own file, as it is there.
    if (handedOver.found) expect(handedOver.message).toBe(first)
  })
})
