import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { providerSchema, type Provider } from '@brobot2/shared'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import {
  SAVED_METHODS_MOST_INDEX_BYTES,
  SAVED_METHODS_MOST_METHOD_BYTES,
  savedMethodsRefusalSaid,
  savedMethodsUseSaid,
  type SavedMethodsRefusal,
} from '../src/shared/saved-methods'
import {
  fingerprintOf,
  readSavedMethods,
  SAVED_METHODS_INDEX,
  savedMethodsLinesOf,
  savedMethodsParagraphs,
  holdsTheLines,
  savedMethodsUseOf,
  withTheLinesKeptIn,
  withTheLinesSent,
  type SavedMethodsReading,
} from '../src/main/saved-methods'
import {
  composeProfileBundle,
  SAVED_METHODS_HEADING,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { sectionsOf, theLeadOwed } from '../src/main/runtime/codex-lead'
import { aLaunchRecordIn, savedMethodsNowFor } from '../src/main/runtime/what-this-agent-was-given'
import { savedMethodsFolder } from '../src/main/runtime/provider-homes'
import { requestTabs, type ReaderRow } from '../src/renderer/src/lib/request-order'
import { givenAnswer } from './dom/what-this-agent-was-given.fixture'

/**
 * A profile's saved methods reach every new and reopened conversation as one index, read at its
 * launch and built only from well-formed lines: on Claude in the system prompt, on Codex in the
 * conversation's lead, and never in a file the provider reads for itself.
 */

const NOW = Date.UTC(2026, 9, 14, 5, 30)
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
const scratch = (name: string): string => {
  const folder = mkdtempSync(join(realpathSync(tmpdir()), `${name}-`))
  folders.push(folder)
  return folder
}

/** A profile's saved-methods folder in a scratch data folder, with these method files in it. */
function aStore(files: Readonly<Record<string, string>> = {}): string {
  const folder = savedMethodsFolder(scratch('saved-methods'), 'fictional-writer')
  mkdirSync(folder, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text)
  return folder
}
const indexOf = (folder: string, lines: readonly string[]) =>
  writeFileSync(join(folder, SAVED_METHODS_INDEX), `${lines.join('\n')}\n`)
const read = (folder: string): SavedMethodsReading => readSavedMethods(folder, NOW)

const METHOD = '# A fictional method\n\nStep one. Step two.\n'
const LINE =
  '- Rotate a fictional log | when the log passes 1 GB | verified 2026-10-12 | rotate-log.md'

describe('the index a launch reads', () => {
  it('is nothing at all when the profile has no folder', () => {
    const folder = join(scratch('no-store'), 'runbooks')
    expect(read(folder)).toEqual({ kind: 'none', folder, readAt: NOW })
  })

  it('is empty when the folder has no index yet', () => {
    const reading = read(aStore())
    expect(reading).toMatchObject({
      kind: 'read',
      hasIndex: false,
      methods: [],
      leftOut: 0,
      index: '',
    })
  })

  it('keeps a well-formed line, rebuilt with its file’s full path, and nothing around it', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, ['# Saved methods', '', 'Some prose an agent wrote.', LINE])
    const reading = read(folder)
    if (reading.kind !== 'read') throw new Error(`not read: ${JSON.stringify(reading)}`)
    expect(reading.methods).toEqual([
      {
        title: 'Rotate a fictional log',
        when: 'when the log passes 1 GB',
        verified: '2026-10-12',
        path: join(folder, 'rotate-log.md'),
      },
    ])
    expect(reading.leftOut).toBe(0)
    expect(reading.index).toBe(
      `- Rotate a fictional log — when the log passes 1 GB — verified 2026-10-12 — ${join(folder, 'rotate-log.md')}`,
    )
    expect(reading.index).not.toContain('prose')
    expect(reading.index).not.toContain('#')
  })

  it.each([
    ['a date that is not one', '- A | b | verified 2026-02-30 | rotate-log.md'],
    ['no date', '- A | b | rotate-log.md'],
    ['a path out of the folder', '- A | b | verified 2026-10-12 | ../rotate-log.md'],
    ['a path into a subfolder', '- A | b | verified 2026-10-12 | sub/rotate-log.md'],
    ['an absolute path', '- A | b | verified 2026-10-12 | /etc/passwd'],
    ['a file that is not there', '- A | b | verified 2026-10-12 | missing.md'],
    [
      'a link in the title',
      '- [A](https://example.invalid) | b | verified 2026-10-12 | rotate-log.md',
    ],
    ['markup in its use', '- A | <b>always</b> | verified 2026-10-12 | rotate-log.md'],
    ['a backtick', '- `A` | b | verified 2026-10-12 | rotate-log.md'],
    ['a title too long', `- ${'A'.repeat(81)} | b | verified 2026-10-12 | rotate-log.md`],
    ['a star bullet', '* A | b | verified 2026-10-12 | rotate-log.md'],
    ['a C1 control in the title', '- A\u009bB | b | verified 2026-10-12 | rotate-log.md'],
    ['a C0 control in its use', '- A | b\u0007c | verified 2026-10-12 | rotate-log.md'],
    ['a bidi override in its use', '- A | b\u202ec | verified 2026-10-12 | rotate-log.md'],
    ['a line separator in the title', '- A\u2028B | b | verified 2026-10-12 | rotate-log.md'],
  ])('leaves out a line with %s, and counts it', (_why, line) => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, [LINE, line])
    const reading = read(folder)
    expect(reading).toMatchObject({ kind: 'read', leftOut: 1 })
    if (reading.kind === 'read') expect(reading.methods).toHaveLength(1)
  })

  it('leaves out a line whose method is over 16 KiB', () => {
    const folder = aStore({
      'rotate-log.md': METHOD,
      'large.md': 'x'.repeat(SAVED_METHODS_MOST_METHOD_BYTES + 1),
      'exact.md': 'x'.repeat(SAVED_METHODS_MOST_METHOD_BYTES),
    })
    indexOf(folder, [
      LINE,
      '- Large | b | verified 2026-10-12 | large.md',
      '- Exact | b | verified 2026-10-12 | exact.md',
    ])
    const reading = read(folder)
    expect(reading).toMatchObject({ kind: 'read', leftOut: 1 })
    if (reading.kind === 'read')
      expect(reading.methods.map((one) => one.title)).toEqual(['Rotate a fictional log', 'Exact'])
  })

  /** Index lines that, as sent, come to exactly `bytes`. */
  function linesComingTo(folder: string, bytes: number): string[] {
    const sentOf = (title: string, when: string) =>
      `- ${title} — ${when} — verified 2026-10-12 — ${join(folder, 'rotate-log.md')}`
    const lines: { title: string; when: string }[] = []
    let total = 0
    for (let at = 0; ; at += 1) {
      const title = `M${String(at).padStart(3, '0')}`
      const next = Buffer.byteLength(sentOf(title, 'b')) + (lines.length > 0 ? 1 : 0)
      if (total + next > bytes) break
      lines.push({ title, when: 'b' })
      total += next
    }
    // The last line's use takes up what is left, to the byte.
    const last = lines.at(-1)!
    last.when = `b${'x'.repeat(bytes - total)}`
    return lines.map((one) => `- ${one.title} | ${one.when} | verified 2026-10-12 | rotate-log.md`)
  }

  it('sends an index of exactly 4 KiB, and refuses one byte more whole rather than cut it', () => {
    const at = aStore({ 'rotate-log.md': METHOD })
    indexOf(at, linesComingTo(at, SAVED_METHODS_MOST_INDEX_BYTES))
    const exact = read(at)
    if (exact.kind !== 'read') throw new Error(`not read: ${JSON.stringify(exact)}`)
    expect(Buffer.byteLength(exact.index)).toBe(SAVED_METHODS_MOST_INDEX_BYTES)

    const over = aStore({ 'rotate-log.md': METHOD })
    indexOf(over, linesComingTo(over, SAVED_METHODS_MOST_INDEX_BYTES + 1))
    expect(read(over)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'too-large', bytes: SAVED_METHODS_MOST_INDEX_BYTES + 1 },
    })
  })

  it('refuses an index.md too large to read', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    writeFileSync(join(folder, SAVED_METHODS_INDEX), `${LINE}\n${'x'.repeat(64 * 1024)}`)
    expect(read(folder)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'index-file-too-large' },
    })
  })

  it('opens no index.md that is not a plain file, so a pipe there cannot hold the launch', () => {
    const piped = aStore({ 'rotate-log.md': METHOD })
    execFileSync('mkfifo', [join(piped, SAVED_METHODS_INDEX)])
    expect(read(piped)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'not-a-file', what: 'the-index' },
    })
    const folderNamedIndex = aStore()
    mkdirSync(join(folderNamedIndex, SAVED_METHODS_INDEX))
    expect(read(folderNamedIndex)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'not-a-file', what: 'the-index' },
    })
    const notAFolder = join(scratch('not-a-folder'), 'runbooks')
    writeFileSync(notAFolder, LINE)
    const refused = read(notAFolder)
    expect(refused).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'not-a-file', what: 'the-folder' },
    })
    if (refused.kind === 'refused')
      expect(savedMethodsRefusalSaid(refused.refusal)).toBe(
        'the saved-methods path is not a folder',
      )
  })

  it('follows no link: not the folder, not the index, not a method', () => {
    const real = aStore({ 'rotate-log.md': METHOD })
    indexOf(real, [LINE])

    const linkedFolder = join(scratch('linked-folder'), 'runbooks')
    symlinkSync(real, linkedFolder)
    expect(read(linkedFolder)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'a-link', what: 'the-folder' },
    })

    const linkedIndex = aStore({ 'rotate-log.md': METHOD })
    symlinkSync(join(real, SAVED_METHODS_INDEX), join(linkedIndex, SAVED_METHODS_INDEX))
    expect(read(linkedIndex)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'a-link', what: 'the-index' },
    })

    const linkedMethod = aStore()
    symlinkSync(join(real, 'rotate-log.md'), join(linkedMethod, 'rotate-log.md'))
    indexOf(linkedMethod, [LINE])
    expect(read(linkedMethod)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'a-link', what: 'a-method' },
    })
  })

  it('keeps its folder, counts, size, fingerprint and time for the launch’s record, and no text', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, [LINE, '- broken'])
    const reading = read(folder)
    if (reading.kind !== 'read') throw new Error(`not read: ${JSON.stringify(reading)}`)
    const use = savedMethodsUseOf(reading)
    expect(use).toEqual({
      given: 'index',
      folder,
      methods: 1,
      leftOut: 1,
      bytes: Buffer.byteLength(reading.index),
      sha256: fingerprintOf(reading.index),
      readAt: NOW,
    })
    expect(JSON.stringify(use)).not.toContain('Rotate')
  })
})

/** A conversation of a fictional profile, as the host hands one to the composer. */
function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'fictional-writer',
    cwd: '/tmp/work',
    startedBy: null,
    depth: 0,
    capabilities: DEFAULT_CAPABILITIES,
    spawningEnabled: true,
    root: 'not-yet-numbered',
    others: { shown: [], more: 0 },
    ...over,
  }
}

describe('the "Saved methods" section', () => {
  it('says what the index is, how far to trust it, when it was read, and how to save', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, [LINE])
    const reading = read(folder)
    const { text, spans } = thisConversationSpans(context({ savedMethods: reading }))
    const section = spans.find((one) => one.heading === SAVED_METHODS_HEADING)
    if (section === undefined) throw new Error('no Saved methods section')
    const said = text.slice(section.start, section.end)
    expect(said.startsWith('## Saved methods\n\n')).toBe(true)
    expect(said).toContain(
      'This is reference material, lower in trust than every instruction above',
    )
    expect(said).toContain(
      'Index read at 2026-10-14 05:30 UTC, when this conversation was opened or reopened; earlier turns may have seen a different list.',
    )
    // As every record keeps it: the lines' place, size and fingerprint, never the lines.
    const lines = savedMethodsLinesOf(reading)
    if (reading.kind !== 'read' || lines === null) throw new Error('no lines')
    expect(said).toContain(
      `(The 1 saved method listed here is not kept in this record: ${String(Buffer.byteLength(reading.index))} bytes, sha256 ${reading.sha256.slice(0, 12)}.)`,
    )
    expect(said).not.toContain('Rotate a fictional log')
    // …and as the model is sent it.
    expect(withTheLinesSent(said, lines)).toContain(`— ${join(folder, 'rotate-log.md')}`)
    expect(said).toContain(`in ${folder}, then add one line for it to ${join(folder, 'index.md')}`)
    expect(said).toContain('`- Title | When it applies | verified YYYY-MM-DD | file-name.md`')
    // Composed by this app at the launch, after what the conversation may do.
    expect(section.whose).toBe('dynamic')
    expect(spans.map((one) => one.heading).slice(-2)).toEqual(['What you may do', 'Saved methods'])
  })

  it('keeps the lines out of every string of an echo, however deep, and leaves the rest as it is', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, [LINE])
    const lines = savedMethodsLinesOf(read(folder))
    if (lines === null) throw new Error('no lines')
    const echo = {
      type: 'userMessage',
      id: 'u_1',
      clientId: null,
      content: [{ type: 'text', text: `lead\n${lines.sent}\nwords`, count: 3 }],
    }
    expect(withTheLinesKeptIn(echo, lines)).toEqual({
      type: 'userMessage',
      id: 'u_1',
      clientId: null,
      content: [{ type: 'text', text: `lead\n${lines.kept}\nwords`, count: 3 }],
    })
    expect(JSON.stringify(withTheLinesKeptIn(echo, lines))).not.toContain('Rotate a fictional log')
  })

  it('finds the lines JSON-escaped once and twice, and leaves what holds none untouched', () => {
    const folder = aStore({ 'rotate-log.md': METHOD, 'backup.md': METHOD })
    indexOf(folder, [LINE, '- Back up | weekly | verified 2026-10-13 | backup.md'])
    const lines = savedMethodsLinesOf(read(folder))
    if (lines === null) throw new Error('no lines')
    // Two lines, so escaping changes them.
    expect(JSON.stringify(lines.sent)).toContain('\\n')
    const once = JSON.stringify({ text: lines.sent })
    const twice = JSON.stringify({ payload: once })
    const payload = { once, twice, deep: [{ also: lines.sent }] }
    expect(holdsTheLines(payload, lines)).toBe(true)
    const kept = JSON.stringify(withTheLinesKeptIn(payload, lines))
    expect(kept).not.toContain('Rotate a fictional log')
    expect(kept).not.toContain('Back up')
    expect(kept).toContain('The 2 saved methods listed here are not kept in this record')
    // Nothing to replace: the same value back, and a non-plain object as it is.
    const plain = { text: 'nothing here', bytes: new Uint8Array([1, 2]) }
    expect(holdsTheLines(plain, lines)).toBe(false)
    expect((withTheLinesKeptIn(plain, lines) as typeof plain).bytes).toBe(plain.bytes)
  })

  it('counts the methods in the note every record keeps, one or many', () => {
    const folder = aStore({ 'rotate-log.md': METHOD, 'backup.md': METHOD })
    indexOf(folder, [LINE])
    expect(savedMethodsLinesOf(read(folder))?.kept).toMatch(
      /^\(The 1 saved method listed here is not kept in this record: /,
    )
    indexOf(folder, [LINE, '- Back up | weekly | verified 2026-10-13 | backup.md'])
    expect(savedMethodsLinesOf(read(folder))?.kept).toMatch(
      /^\(The 2 saved methods listed here are not kept in this record: /,
    )
  })

  it('says none are saved when there are none, and why an index was not sent', () => {
    const NONE_SAID =
      'None saved yet when this conversation was opened or reopened (2026-10-14 05:30 UTC).'
    const none = savedMethodsParagraphs({
      kind: 'none',
      folder: '/fictional/runbooks',
      readAt: NOW,
    })
    expect(none[1]).toBe(NONE_SAID)
    expect(none[0]).not.toContain('Index read at')
    // A folder whose index lists none says the same, once.
    const empty = savedMethodsParagraphs({
      kind: 'read',
      folder: '/fictional/runbooks',
      hasIndex: true,
      readAt: NOW,
      methods: [],
      leftOut: 0,
      index: '',
      sha256: fingerprintOf(''),
    })
    expect(empty[1]).toBe(NONE_SAID)
    expect(empty[0]).not.toContain('Index read at')
    const refused = savedMethodsParagraphs({
      kind: 'refused',
      folder: '/fictional/runbooks',
      readAt: NOW,
      refusal: { kind: 'too-large', bytes: 5000 },
    })
    expect(refused[1]).toBe('The index was not sent: it came to 5,000 bytes, over the 4 KiB limit.')
  })

  it('is not in the text when the launch read none, and never in the profile’s own file', () => {
    expect(thisConversationSpans(context()).text).not.toContain('## Saved methods')
    const reading = read(aStore())
    expect(composeProfileBundle(context({ savedMethods: reading }))).not.toContain('Saved methods')
  })
})

describe('where each provider is given it', () => {
  function delivered(provider: Provider, savedMethods: SavedMethodsReading) {
    const root = scratch(`saved-methods-${provider}`)
    const home = join(root, 'home')
    const cwd = join(root, 'work')
    const userHome = join(root, 'user-home')
    mkdirSync(home)
    mkdirSync(cwd)
    mkdirSync(userHome)
    const launch = context({ cwd, savedMethods })
    const bundle = publishProfileBundle(provider, home, composeProfileBundle(launch))
    expect(bundle.ok).toBe(true)
    const read = readSessionInstructions({
      provider,
      cwd,
      providerHome: home,
      // A scratch home, so the reader never looks at the real one.
      home: userHome,
      bundle,
      thisConversation: thisConversationSpans(launch),
    })
    // As `main/index.ts` hands it on: the model is sent the lines the records keep out.
    const lines = savedMethodsLinesOf(savedMethods)
    const sent = (text: string | null) => (text === null ? null : withTheLinesSent(text, lines))
    return {
      read: { ...read, systemHint: sent(read.systemHint), firstTurnLead: sent(read.firstTurnLead) },
      kept: read.instructions,
      file: bundle.ok ? readFileSync(bundle.path, 'utf8') : '',
    }
  }

  for (const provider of providerSchema.options) {
    it(`${provider}: the index rides the launch, never the file the provider reads`, () => {
      const folder = aStore({ 'rotate-log.md': METHOD })
      indexOf(folder, [LINE])
      const { read: got, kept, file } = delivered(provider, read(folder))
      const sent = provider === 'claude' ? got.systemHint : got.firstTurnLead
      expect(sent).toContain('## Saved methods')
      expect(sent).toContain('Rotate a fictional log')
      expect(sent).toContain(
        'Index read at 2026-10-14 05:30 UTC, when this conversation was opened or reopened; earlier turns may have seen a different list.',
      )
      expect(file).not.toContain('Saved methods')
      // What the launch's record keeps: the section, without the agent's lines.
      expect(JSON.stringify(kept)).toContain('## Saved methods')
      expect(JSON.stringify(kept)).not.toContain('Rotate a fictional log')
      if (provider === 'codex') expect(got.systemHint).toBeNull()
      else expect(got.firstTurnLead).toBeNull()
    })
  }

  for (const provider of providerSchema.options) {
    it(`${provider}: with none saved, the section says so and when it was read`, () => {
      const folder = join(scratch('none-saved'), 'runbooks')
      const { read: got } = delivered(provider, read(folder))
      const sent = provider === 'claude' ? got.systemHint : got.firstTurnLead
      expect(sent).toContain(
        'None saved yet when this conversation was opened or reopened (2026-10-14 05:30 UTC).',
      )
    })
  }

  it('codex: a reopen whose list is the same and read later is sent only the Saved methods section', () => {
    for (const files of [{ 'rotate-log.md': METHOD }, null] as const) {
      const folder = files === null ? join(scratch('none-again'), 'runbooks') : aStore(files)
      if (files !== null) indexOf(folder, [LINE])
      const earlier = thisConversationSpans(
        context({ savedMethods: readSavedMethods(folder, NOW) }),
      )
      const later = thisConversationSpans(
        context({ savedMethods: readSavedMethods(folder, NOW + 3_600_000) }),
      )
      const owed = theLeadOwed(
        { carried: [], sections: sectionsOf({ text: earlier.text, sections: earlier.spans }) },
        { text: later.text, sections: later.spans },
      )
      // Not the whole text: only the one section whose time moved.
      expect(owed?.is).toBe('what-changed')
      expect(owed?.text).toContain('## Saved methods')
      expect(owed?.text).toContain('2026-10-14 06:30 UTC')
      expect(owed?.text).not.toContain('## What you may do')
    }
  })

  it('codex: a thread that holds an older index is sent the new one, by its heading', () => {
    const before = aStore({ 'rotate-log.md': METHOD })
    const earlier = thisConversationSpans(context({ savedMethods: read(before) }))
    indexOf(before, [LINE])
    const now = thisConversationSpans(context({ savedMethods: read(before) }))
    const held = {
      carried: [],
      sections: sectionsOf({ text: earlier.text, sections: earlier.spans }),
    }
    expect(held.sections.has('Saved methods')).toBe(true)
    const owed = theLeadOwed(held, { text: now.text, sections: now.spans })
    expect(owed?.is).toBe('what-changed')
    // Owed from records, so in its kept form; the model is sent the lines.
    expect(owed?.text).not.toContain('Rotate a fictional log')
    expect(withTheLinesSent(owed?.text ?? '', savedMethodsLinesOf(read(before)))).toContain(
      'Rotate a fictional log',
    )
  })
})

describe('what the popup says it was given', () => {
  const at = (time: number) => new Date(time).toISOString().slice(11, 16)

  it('keeps the use on the launch’s record and reads it back', () => {
    const use = savedMethodsUseOf({
      kind: 'refused',
      folder: '/fictional/runbooks',
      readAt: NOW,
      refusal: { kind: 'a-link', what: 'the-index' },
    })
    expect(
      aLaunchRecordIn({ placement: 'first-message', savedMethods: use })?.savedMethods,
    ).toEqual(use)
    const index = {
      given: 'index' as const,
      folder: '/fictional/runbooks',
      methods: 2,
      leftOut: 0,
      bytes: 300,
      sha256: fingerprintOf('x'),
      readAt: NOW,
    }
    expect(
      aLaunchRecordIn({ placement: 'first-message', savedMethods: index })?.savedMethods,
    ).toEqual(index)
    expect(
      aLaunchRecordIn({ placement: 'first-message', savedMethods: { ...index, sha256: 'short' } })
        ?.savedMethods,
    ).toBeUndefined()
    expect(
      aLaunchRecordIn({ placement: 'first-message', savedMethods: { ...use, text: 'x' } })
        ?.savedMethods,
    ).toBeUndefined()
  })

  it('draws the line under the "This conversation" row, and nothing without a reading', () => {
    const text = '## Saved methods\n\nNone saved yet.\n'
    const conversation = {
      text,
      textIs: 'as-launched' as const,
      sections: [],
      size: { characters: text.length, words: 4, tokens: 5 },
    }
    const rowIn = (given: ReturnType<typeof givenAnswer>): ReaderRow => {
      const items = requestTabs(given, [], true, at).flatMap((tab) => tab.items)
      const found = items.find((item) => item.kind === 'row' && item.key === 'this-conversation')
      expect(found?.kind).toBe('row')
      return found as ReaderRow
    }
    const lines = (row: ReaderRow) =>
      row.pieces.filter((piece) => piece.kind === 'notice' && piece.cy === 'input-saved-methods')
    const given = rowIn(
      givenAnswer({ thisConversation: conversation, savedMethods: { given: 'none' } }),
    )
    expect(lines(given)).toEqual([
      {
        kind: 'notice',
        cy: 'input-saved-methods',
        text: 'Saved methods: none saved for this profile yet.',
      },
    ])
    expect(lines(rowIn(givenAnswer({ thisConversation: conversation })))).toEqual([])
  })

  it('says each state in one line, and the left-out lines in another', () => {
    expect(savedMethodsUseSaid({ given: 'none' }, at)).toEqual([
      'Saved methods: none saved for this profile yet.',
    ])
    expect(
      savedMethodsUseSaid(
        {
          given: 'index',
          folder: '/fictional/runbooks',
          methods: 3,
          leftOut: 2,
          bytes: 1812,
          sha256: fingerprintOf('x'),
          readAt: NOW,
        },
        at,
      ),
    ).toEqual([
      'Saved methods: 3, 1,812 bytes, read at 05:30.',
      '2 lines of the index were not in the saved-method form and were left out.',
    ])
    expect(
      savedMethodsUseSaid(
        { given: 'refused', refusal: { kind: 'too-large', bytes: 5210 }, readAt: NOW },
        at,
      ),
    ).toEqual([
      'The saved-methods index was not sent: it came to 5,210 bytes, over the 4 KiB limit. Read at 05:30.',
    ])
  })

  it('says an empty index as none, and one left-out line in the singular', () => {
    expect(
      savedMethodsUseSaid(
        {
          given: 'index',
          folder: '/fictional/runbooks',
          methods: 0,
          leftOut: 1,
          bytes: 40,
          sha256: fingerprintOf('x'),
          readAt: NOW,
        },
        at,
      ),
    ).toEqual([
      'Saved methods: none in the index, read at 05:30.',
      '1 line of the index was not in the saved-method form and was left out.',
    ])
  })

  it('names what was a link, and says each other refusal plainly', () => {
    const said = (refusal: SavedMethodsRefusal) =>
      savedMethodsUseSaid({ given: 'refused', refusal, readAt: NOW }, at)[0]
    expect(said({ kind: 'a-link', what: 'the-folder' })).toBe(
      'The saved-methods index was not sent: the folder is a link, which this app does not follow. Read at 05:30.',
    )
    expect(said({ kind: 'a-link', what: 'the-index' })).toBe(
      'The saved-methods index was not sent: index.md is a link, which this app does not follow. Read at 05:30.',
    )
    expect(said({ kind: 'a-link', what: 'a-method' })).toBe(
      'The saved-methods index was not sent: a method’s file is a link, which this app does not follow. Read at 05:30.',
    )
    expect(said({ kind: 'not-a-file', what: 'the-index' })).toBe(
      'The saved-methods index was not sent: index.md is not a plain file. Read at 05:30.',
    )
    expect(said({ kind: 'index-file-too-large' })).toBe(
      'The saved-methods index was not sent: index.md is too large to read. Read at 05:30.',
    )
    expect(said({ kind: 'unreadable' })).toBe(
      'The saved-methods index was not sent: its folder could not be read. Read at 05:30.',
    )
  })
})

describe('the index as the folder holds it now, since no record keeps its lines', () => {
  const at = (time: number) => new Date(time).toISOString().slice(11, 16)
  const useOf = (folder: string) => {
    const reading = read(folder)
    if (reading.kind !== 'read') throw new Error(`not read: ${JSON.stringify(reading)}`)
    return { reading, use: savedMethodsUseOf(reading) }
  }

  it('is the same as sent, changed since, gone, or unreadable', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, [LINE])
    const { reading, use } = useOf(folder)
    expect(savedMethodsNowFor(use, NOW)).toEqual({
      savedMethodsNow: { is: 'same', index: reading.index },
    })
    indexOf(folder, [LINE.replace('1 GB', '2 GB')])
    expect(savedMethodsNowFor(use, NOW).savedMethodsNow).toMatchObject({ is: 'changed' })
    rmSync(join(folder, SAVED_METHODS_INDEX))
    symlinkSync(join(folder, 'rotate-log.md'), join(folder, SAVED_METHODS_INDEX))
    expect(savedMethodsNowFor(use, NOW).savedMethodsNow).toMatchObject({
      is: 'refused',
      refusal: { kind: 'a-link', what: 'the-index' },
    })
    // An index.md with no method in the saved-method form lists none: changed, with nothing.
    rmSync(join(folder, SAVED_METHODS_INDEX))
    indexOf(folder, ['# Saved methods', '', 'Nothing yet.'])
    expect(savedMethodsNowFor(use, NOW)).toEqual({ savedMethodsNow: { is: 'changed', index: '' } })
    // No index.md in a folder that is still there: gone, not changed.
    rmSync(join(folder, SAVED_METHODS_INDEX))
    expect(savedMethodsNowFor(use, NOW)).toEqual({ savedMethodsNow: { is: 'gone' } })
    // No folder at all: gone.
    rmSync(folder, { recursive: true })
    expect(savedMethodsNowFor(use, NOW)).toEqual({ savedMethodsNow: { is: 'gone' } })
    // Nothing to compare when nothing was sent.
    expect(savedMethodsNowFor({ given: 'none' }, NOW)).toEqual({})
  })

  /** A Codex launch's record in the instructions layout, with this conversation's text. */
  function aCodexGiven(over: Partial<ReturnType<typeof givenAnswer>> = {}) {
    const text =
      '## Saved methods\n\n(The 1 saved method listed here is not kept in this record.)\n'
    const given = givenAnswer()
    return givenAnswer({
      placement: 'first-message',
      providerParts: { ...given.providerParts, snapshot: null },
      thisConversation: {
        text,
        textIs: 'as-launched',
        sections: [],
        size: { characters: text.length, words: 10, tokens: 15 },
      },
      ...over,
    })
  }
  const leadRow = (given: ReturnType<typeof givenAnswer>): ReaderRow => {
    const items = requestTabs(given, [], true, at).flatMap((tab) => tab.items)
    expect(items.some((item) => item.kind === 'row' && item.key === 'this-conversation')).toBe(
      false,
    )
    const found = items.find((item) => item.kind === 'row' && item.key === 'conversation-lead')
    expect(found?.kind).toBe('row')
    return found as ReaderRow
  }
  const savedPieces = (row: ReaderRow) =>
    row.pieces.filter(
      (piece) =>
        (piece.kind === 'notice' && piece.cy.startsWith('input-saved-methods')) ||
        (piece.kind === 'text' && piece.text.includes('rotate-log.md')),
    )

  it('codex: the lead row says what it was sent, and shows the index as it is now', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, [LINE])
    const { reading, use } = useOf(folder)
    const row = leadRow(aCodexGiven({ savedMethods: use, ...savedMethodsNowFor(use, NOW) }))
    expect(savedPieces(row)).toEqual([
      {
        kind: 'notice',
        cy: 'input-saved-methods',
        text: `Saved methods: 1, ${String(use.given === 'index' ? use.bytes : 0)} bytes, read at 05:30.`,
      },
      {
        kind: 'notice',
        cy: 'input-saved-methods-now',
        text: 'Not kept with this record. The index as the folder holds it now, the same as sent:',
      },
      { kind: 'text', text: reading.index },
    ])
  })

  it('codex: the lead row says why an index was not sent', () => {
    const row = leadRow(
      aCodexGiven({
        savedMethods: {
          given: 'refused',
          refusal: { kind: 'not-a-file', what: 'the-index' },
          readAt: NOW,
        },
      }),
    )
    expect(savedPieces(row)).toEqual([
      {
        kind: 'notice',
        cy: 'input-saved-methods',
        text: 'The saved-methods index was not sent: index.md is not a plain file. Read at 05:30.',
      },
    ])
  })

  it('codex: an older launch’s record with no saved methods says nothing about them', () => {
    expect(savedPieces(leadRow(aCodexGiven()))).toEqual([])
  })
})

describe('what each row of the popup draws for the index as it is now', () => {
  const at = (time: number) => new Date(time).toISOString().slice(11, 16)
  const SENT = `- Rotate a fictional log — when the log passes 1 GB — verified 2026-10-12 — /fictional/runbooks/rotate-log.md`
  const use = {
    given: 'index' as const,
    folder: '/fictional/runbooks',
    methods: 1,
    leftOut: 0,
    bytes: Buffer.byteLength(SENT),
    sha256: fingerprintOf(SENT),
    readAt: NOW,
  }
  const text = '## Saved methods\n\n(The 1 saved method listed here is not kept in this record.)\n'
  const conversation = {
    text,
    textIs: 'as-launched' as const,
    sections: [],
    size: { characters: text.length, words: 12, tokens: 15 },
  }
  /** The row a launch's text is drawn in: this conversation's on Claude, the lead's on Codex. */
  const rowOf = (layout: 'claude' | 'codex', over: Partial<ReturnType<typeof givenAnswer>>) => {
    const base = givenAnswer()
    const given = givenAnswer({
      thisConversation: conversation,
      ...(layout === 'codex'
        ? {
            placement: 'first-message' as const,
            providerParts: { ...base.providerParts, snapshot: null },
          }
        : {}),
      ...over,
    })
    const key = layout === 'claude' ? 'this-conversation' : 'conversation-lead'
    const found = requestTabs(given, [], true, at)
      .flatMap((tab) => tab.items)
      .find((item) => item.kind === 'row' && item.key === key)
    expect(found?.kind).toBe('row')
    return found as ReaderRow
  }
  const nowPieces = (row: ReaderRow) => {
    const from = row.pieces.findIndex(
      (piece) => piece.kind === 'notice' && piece.cy === 'input-saved-methods-now',
    )
    return from === -1 ? [] : row.pieces.slice(from)
  }

  for (const layout of ['claude', 'codex'] as const) {
    it(`${layout}: changed since, with the index as it is now under the agent's name`, () => {
      const now = SENT.replace('1 GB', '2 GB')
      expect(
        nowPieces(
          rowOf(layout, { savedMethods: use, savedMethodsNow: { is: 'changed', index: now } }),
        ),
      ).toEqual([
        {
          kind: 'notice',
          cy: 'input-saved-methods-now',
          text: 'Not kept with this record. The index as the folder holds it now, changed since this launch:',
        },
        { kind: 'label', author: 'Agent', trust: 'Read now' },
        { kind: 'text', text: now },
      ])
    })

    it(`${layout}: an index that lists no methods now, and one that is gone, show no text`, () => {
      expect(
        nowPieces(
          rowOf(layout, { savedMethods: use, savedMethodsNow: { is: 'changed', index: '' } }),
        ),
      ).toEqual([
        {
          kind: 'notice',
          cy: 'input-saved-methods-now',
          text: 'Not kept with this record. The folder’s index lists no methods now.',
        },
      ])
      expect(
        nowPieces(rowOf(layout, { savedMethods: use, savedMethodsNow: { is: 'gone' } })),
      ).toEqual([
        {
          kind: 'notice',
          cy: 'input-saved-methods-now',
          text: 'Not kept with this record, and the folder holds no index now.',
        },
      ])
    })

    it(`${layout}: an index that cannot be read now says why, and shows no text`, () => {
      expect(
        nowPieces(
          rowOf(layout, {
            savedMethods: use,
            savedMethodsNow: { is: 'refused', refusal: { kind: 'a-link', what: 'the-index' } },
          }),
        ),
      ).toEqual([
        {
          kind: 'notice',
          cy: 'input-saved-methods-now',
          text: 'Not kept with this record, and the index cannot be read now: index.md is a link, which this app does not follow.',
        },
      ])
    })
  }

  it('an older record that kept the lines themselves is shown as it was kept, and is not read again', () => {
    // Such a record has no folder or fingerprint, so its use is not read back and nothing is
    // compared or claimed about it; its text, lines included, is what the record holds.
    const older = { given: 'index', methods: 1, leftOut: 0, bytes: SENT.length, readAt: NOW }
    expect(
      aLaunchRecordIn({ placement: 'system-prompt', savedMethods: older })?.savedMethods,
    ).toBeUndefined()
    const kept = `## Saved methods\n\n${SENT}\n`
    const row = rowOf('claude', {
      thisConversation: {
        text: kept,
        textIs: 'as-launched',
        sections: [],
        size: { characters: kept.length, words: 20, tokens: 30 },
      },
    })
    expect(row.pieces.some((piece) => piece.kind === 'text' && piece.text.includes(SENT))).toBe(
      true,
    )
    expect(
      row.pieces.some(
        (piece) => piece.kind === 'notice' && piece.cy.startsWith('input-saved-methods'),
      ),
    ).toBe(false)
  })
})
