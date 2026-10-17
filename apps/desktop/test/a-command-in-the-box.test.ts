import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

/**
 * # 🔴 714 — names, a new project, and a command with files: the halves a DOM mount cannot see
 *
 * ## §1–§2 · `708` H-3a — the composer's copy of the host's question
 *
 * ⛔ **The host decides `R42` in `aPersonsCommand` (`main/runtime/a-command-goes-as-typed.ts`), and the
 * renderer cannot import it** — so `a-command-with-files.ts` asks the same question of the list this
 * window folded. ⚑ **One rule in two places is held together by running BOTH over one corpus**: the
 * day either one moves, a row below disagrees. ⚠️ **Where the window holds NO list, the two are
 * meant to differ** — the host asks for one or judges by shape, and the window leaves that to it —
 * so §1 asserts that difference too, rather than skipping those rows.
 *
 * ## §3 · R41 (`712` F-4) — the attention row NAMES who it runs as
 *
 * ## §4 · R41 — the roster reaches the two surfaces no DOM mount here raises
 *
 * ⚠️ `RuntimeScreen` and `SessionLibrary` are read as SOURCE here. `RuntimeScreen` is mounted by no
 * test in this repo (it needs the whole bridge); `SessionLibrary` IS mounted by DOM files of its own (the `library-*` suites among them), over
 * doubles of the library's reads, and a mount there would add those doubles to prove one
 * forwarded attribute — so its hop is pinned where it is written. The components the roster is
 * handed TO are mounted in `names-a-new-project-and-a-command-with-files.dom.test.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(here, '../src/renderer/src')

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

  it('⛔ the renderer imports nothing from main — the copy above is a COPY, held by §1', () => {
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = join(dir, entry.name)
        if (entry.isDirectory()) walk(at)
        else if (/\.(ts|vue)$/.test(entry.name)) files.push(at)
      }
    }
    walk(RENDERER)
    expect(files.length, 'the renderer walk found nothing').toBeGreaterThan(50)
    const IMPORT_OF_MAIN = /\bfrom\s+['"](?:\.\.\/)+main\//
    // ⚑ The search can find one: a planted import is matched.
    expect(IMPORT_OF_MAIN.test(`import { x } from '../../../main/runtime/y'`)).toBe(true)
    for (const file of files)
      expect(IMPORT_OF_MAIN.test(readFileSync(file, 'utf8')), `${file} imports main`).toBe(false)
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

/* ================================================================ §4 · the roster's two hops */

/** The one opening tag of `<Name` … `/>` — bounded by the tag's own end, never a count. */
function theTag(source: string, name: string): string {
  const from = source.indexOf(`<${name}\n`)
  expect(from, `no <${name} in the source`).toBeGreaterThan(-1)
  expect(source.indexOf(`<${name}\n`, from + 1), `a second <${name}`).toBe(-1)
  const to = source.indexOf('/>', from)
  return source.slice(from, to)
}

describe('§4 · R41 — the roster reaches the reopen list, through the two hops read as source', () => {
  it('🔴 `RuntimeScreen` hands `SessionLibrary` the window’s roster', () => {
    const screen = readFileSync(join(RENDERER, 'components/RuntimeScreen.vue'), 'utf8')
    expect(theTag(screen, 'SessionLibrary')).toContain(
      ':identities="agentStore.identities.value?.identities ?? null"',
    )
  })

  it('🔴 `SessionLibrary` forwards it to `ResumableSessions`, and reads it nowhere else', () => {
    const library = readFileSync(join(RENDERER, 'components/SessionLibrary.vue'), 'utf8')
    expect(theTag(library, 'ResumableSessions')).toContain(':identities="props.identities"')
    expect(library.match(/props\.identities/g)).toHaveLength(1)
  })
})
