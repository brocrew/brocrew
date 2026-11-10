import { describe, expect, it } from 'vitest'
import {
  aCommandTakesNoAttachments,
  aPersonsCommand,
} from '../src/main/runtime/a-command-goes-as-typed'
import { THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import {
  aCommandInTheBox,
  aCommandTakesNoAttachmentsYet,
  type ACommandInTheBox,
} from '../src/renderer/src/lib/a-command-with-files'
import { attentionQueue } from '../src/renderer/src/lib/attention'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent, type CommandRegistry } from '../src/renderer/src/lib/transcript'
import type { CreatedSession, RuntimeEvent } from '../src/shared/runtime-ipc'

/* ================================================================ §1 · the host's question, twice */

type Row = { name: string; aliases?: string[] }
const registry = (
  prefix: string | null,
  commands: readonly Row[] = [],
  dropped = 0,
): CommandRegistry => ({
  set: prefix === null ? null : { prefix, commands: commands.map((one) => ({ ...one })) },
  dropped,
})

const CLAUDE_ROWS: readonly Row[] = [
  { name: 'compact' },
  { name: 'cost', aliases: ['usage'] },
  { name: 'myplugin:review' },
  { name: 'srv:prompt (MCP)' },
]

/** ⚑ Every list shape the window can hold — and the one it cannot (`set: null`). */
const REGISTRIES: Readonly<Record<string, CommandRegistry>> = {
  'claude, whole': registry('/', CLAUDE_ROWS),
  'claude, cut short': registry('/', CLAUDE_ROWS, 3),
  'claude, empty': registry('/', []),
  'claude, empty and cut short': registry('/', [], 5),
  'codex, whole': registry('$', [{ name: 'imagegen' }]),
  'codex, cut short': registry('$', [{ name: 'imagegen' }], 2),
  'no list': registry(null),
}

/** ⚑ Every branch of the CLI's parser the host mirrors, and the shapes it refuses. */
const TEXTS = [
  '/compact',
  '  /compact   keep the schema notes',
  '/cost',
  '/usage',
  '/clear',
  '/review 12',
  '/myplugin review',
  '/myplugin other',
  '/srv:prompt (MCP)',
  '/srv:prompt (MCP) with arguments',
  '/srv:prompt (MCP)x',
  '/srv:prompt',
  // ⚑ **714's review** — a name ended by a newline or a tab (Shift+Enter in the composer), which the
  // CLI's `\s` ends as it ends a space.
  '/compact\nkeep the schema notes',
  '/cost\tnow',
  '/Users/me/notes',
  '/tmp is full',
  'hello /compact',
  '/',
  '/ compact',
  '',
  'compact',
  '$imagegen',
  '/imagegen',
  '/under_score-1',
] as const

/** The host's answer, over the same list the window holds, for a person. */
function theHosts(text: string, commands: CommandRegistry): ACommandInTheBox | null {
  const set = commands.set!
  return aPersonsCommand(
    text,
    THE_PERSON_AT_A_WINDOW,
    { commands: set.commands, prefix: set.prefix, dropped: commands.dropped },
    set.prefix,
  )
}

describe('§1 · `708` H-3a — the composer asks the host’s question of the window’s list', () => {
  for (const [name, commands] of Object.entries(REGISTRIES)) {
    if (commands.set === null) continue
    it(`🔴 ${name}: the window's answer IS the host's, text for text`, () => {
      for (const text of TEXTS) {
        expect(aCommandInTheBox(text, commands), JSON.stringify(text)).toEqual(
          theHosts(text, commands),
        )
      }
    })
  }

  it('⚑ the corpus reaches every answer the host can give — else the parity above is thin', () => {
    const answers = new Set<string>()
    for (const commands of Object.values(REGISTRIES)) {
      if (commands.set === null) continue
      for (const text of TEXTS) {
        const said = theHosts(text, commands)
        answers.add(said === null ? 'null' : `${said.word}:${String(said.listed)}`)
      }
    }
    // by name, with arguments, by alias, by the plugin retry, by the MCP join — and a name only a
    // cut-short list could not rule out; and the refusals, where no list names it.
    for (const one of [
      '/compact:true',
      '/cost:true',
      '/usage:true',
      '/myplugin:true',
      '/srv:prompt (MCP):true',
      '/clear:false',
      'null',
    ])
      expect(answers, `nothing in the corpus answers ${one}`).toContain(one)
  })

  it('⛔ with NO list the window predicts nothing — where the host would still refuse by shape', () => {
    const none = REGISTRIES['no list']!
    for (const text of TEXTS) expect(aCommandInTheBox(text, none), text).toBeNull()
    // ⚑ …and the host's answer there is NOT nothing, which is why the window leaves it to the host:
    // it asks for a list, or judges by the CLI's shape test — a fact `set: null` says nothing about.
    expect(aPersonsCommand('/compact', THE_PERSON_AT_A_WINDOW, null, '/')).toEqual({
      word: '/compact',
      listed: false,
    })
  })
})

/* ================================================================ §2 · the sentence */

describe('§2 · the composer’s sentence is the host’s, less the part only a press makes true', () => {
  for (const listed of [true, false]) {
    it(`🔴 listed: ${String(listed)} — the host says the same words and then *Nothing has been sent.*`, () => {
      const before = aCommandTakesNoAttachmentsYet({ word: '/compact', listed })
      expect(aCommandTakesNoAttachments('/compact', listed)).toBe(
        `${before} Nothing has been sent.`,
      )
      // ⚑ Rule 5 — the clause that carries `R42`'s fourth clause, by name.
      expect(before).toContain('a command takes no attachments')
      // ⛔ …and nothing has been tried, so the composer does not say it was not sent.
      expect(before).not.toContain('Nothing has been sent')
    })
  }

  it('⚑ `listed` decides how much it claims — a word no list confirms only *reads as* one', () => {
    expect(aCommandTakesNoAttachmentsYet({ word: '/compact', listed: true })).toMatch(
      /^\/compact is a command, /,
    )
    expect(aCommandTakesNoAttachmentsYet({ word: '/clear', listed: false })).toMatch(
      /^\/clear reads as a command \(this conversation's command list could not confirm it\), /,
    )
  })
})

/* ================================================================ §3 · the attention row */

const SCOPE = {
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

function waitingAs(sessionId: string, profileId: string | null): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd: `/work/${sessionId}`,
    profileId,
  } as CreatedSession
  record.phase = 'open'
  applyEvent(
    record.control,
    {
      type: 'permission_request',
      id: `req_${sessionId}`,
      kind: 'command',
      action: 'Bash',
      detail: 'ls',
      scope: SCOPE,
    } as RuntimeEvent,
    1000,
  )
  return record
}

describe('§3 · R41 (`712` F-4) — an attention row NAMES who it runs as (`AttentionRequest.who`)', () => {
  const standing = (): string => 'waiting: permission'
  const NAMES: Readonly<Record<string, string>> = { 'web-frontend-pm': 'Ada' }
  const nameOf = (slug: string): string => NAMES[slug] ?? slug

  it('🔴 through the screen’s `nameOf`: *Ada*, and the slug stays the key beside it', () => {
    const [row] = attentionQueue([waitingAs('s1', 'web-frontend-pm')], standing, nameOf)
    expect(row?.who).toBe('Ada')
    expect(row?.profileId).toBe('web-frontend-pm')
  })

  it('⚑ THE CONTROL — no host word, no name: `null`, never a name for nobody', () => {
    const [row] = attentionQueue([waitingAs('s2', null)], standing, nameOf)
    expect(row?.who).toBeNull()
  })

  it('⚑ THE CONTROL — a caller with no roster gets the slug, which is `nameOf`’s own default', () => {
    const [row] = attentionQueue([waitingAs('s3', 'web-frontend-pm')], standing)
    expect(row?.who).toBe('web-frontend-pm')
  })
})
