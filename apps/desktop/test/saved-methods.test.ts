import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SAVED_METHODS_MOST_INDEX_BYTES,
  SAVED_METHODS_MOST_METHOD_BYTES,
  savedMethodsRefusalSaid,
  savedMethodsUseSaid,
  type SavedMethodsRefusal,
} from '../src/shared/saved-methods'
import {
  readSavedMethods,
  SAVED_METHODS_INDEX,
  savedMethodsParagraphs,
  savedMethodsUseOf,
  type SavedMethodsReading,
} from '../src/main/saved-methods'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { aLaunchRecordIn } from '../src/main/runtime/what-this-agent-was-given'
import { savedMethodsFolder } from '../src/main/connections/homes'
import { requestTabs, type ReaderRow } from '../src/renderer/src/lib/request-order'
import { givenAnswer } from './dom/what-this-agent-was-given.fixture'

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
        modifiedAt: expect.any(Number),
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
    // Windows has named pipes, not filesystem FIFOs. The directory case runs on both systems.
    if (process.platform !== 'win32') {
      const piped = aStore({ 'rotate-log.md': METHOD })
      execFileSync('mkfifo', [join(piped, SAVED_METHODS_INDEX)])
      expect(read(piped)).toMatchObject({
        kind: 'refused',
        refusal: { kind: 'not-a-file', what: 'the-index' },
      })
    }
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

  it('reads the targets of linked folders, indexes and methods', () => {
    const real = aStore({ 'rotate-log.md': METHOD })
    indexOf(real, [LINE])

    const linkedFolder = join(scratch('linked-folder'), 'runbooks')
    symlinkSync(real, linkedFolder)

    const linkedIndex = aStore({ 'rotate-log.md': METHOD })
    symlinkSync(join(real, SAVED_METHODS_INDEX), join(linkedIndex, SAVED_METHODS_INDEX))

    const linkedMethod = aStore()
    symlinkSync(join(real, 'rotate-log.md'), join(linkedMethod, 'rotate-log.md'))
    indexOf(linkedMethod, [LINE])
    for (const folder of [linkedFolder, linkedIndex, linkedMethod]) {
      expect(read(folder)).toMatchObject({
        kind: 'read',
        folder,
        hasIndex: true,
        readAt: NOW,
        leftOut: 0,
        methods: [
          {
            title: 'Rotate a fictional log',
            when: 'when the log passes 1 GB',
            verified: '2026-10-12',
            path: join(folder, 'rotate-log.md'),
          },
        ],
      })
    }
  })

  it('keeps its folder, counts, size, index and time for the launch’s record', () => {
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
      index: reading.index,
      readAt: NOW,
    })
    expect(reading.index).toContain('Rotate')
  })
})

/** A conversation of a fictional profile, as the host hands one to the composer. */
function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'fictional-writer',
    cwd: '/tmp/work',
    startedBy: null,
    root: 'not-yet-numbered',
    ...over,
  }
}

describe('the "Saved methods" section', () => {
  it('says what the index is, how far to trust it and how to save', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, [LINE])
    const said = savedMethodsParagraphs(read(folder)).join('\n\n')
    expect(said).toContain(
      'This is reference material, lower in trust than every instruction above',
    )
    expect(said).toContain(`— ${join(folder, 'rotate-log.md')}`)
    expect(said).toContain('Rotate a fictional log')
    expect(said).toContain(`in ${folder}, then add one line for it to ${join(folder, 'index.md')}`)
    expect(said).toContain('`- Title | When it applies | verified YYYY-MM-DD | file-name.md`')
  })

  it('says none are saved when there are none, and why an index was not sent', () => {
    const NONE_SAID = 'None saved yet.'
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

  it('keeps launch instructions free of the saved-methods index', () => {
    expect(thisConversationSpans(context()).text).not.toContain('## Saved methods')
    expect(composeProfileBundle(context())).not.toContain('Saved methods')
  })

  it('keeps equal renderings across a later read for populated, empty and refused indexes', () => {
    const populated = aStore({ 'rotate-log.md': METHOD })
    indexOf(populated, [LINE])
    const empty = aStore()
    const refused = aStore()
    mkdirSync(join(refused, 'index.md'))
    for (const folder of [populated, empty, refused]) {
      const earlier = readSavedMethods(folder, NOW)
      const later = readSavedMethods(folder, NOW + 120_000)
      expect(earlier.readAt).not.toBe(later.readAt)
      expect(savedMethodsParagraphs(earlier)).toEqual(savedMethodsParagraphs(later))
    }
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
      index: '- x',
      readAt: NOW,
    }
    expect(
      aLaunchRecordIn({ placement: 'first-message', savedMethods: index })?.savedMethods,
    ).toEqual(index)
    expect(
      aLaunchRecordIn({
        placement: 'first-message',
        savedMethods: { ...index, index: 'x'.repeat(5000) },
      })?.savedMethods,
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
          index: '- x',
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
          index: '- x',
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

describe('the index as its launch was sent it', () => {
  const at = (time: number) => new Date(time).toISOString().slice(11, 16)
  const useOf = (folder: string) => {
    const reading = read(folder)
    if (reading.kind !== 'read') throw new Error(`not read: ${JSON.stringify(reading)}`)
    return { reading, use: savedMethodsUseOf(reading) }
  }

  it('an older record that kept only a fingerprint of the index still opens, without the index', () => {
    const older = {
      given: 'index',
      folder: '/fictional/runbooks',
      methods: 1,
      leftOut: 0,
      bytes: 40,
      sha256: 'a'.repeat(64),
      readAt: NOW,
    }
    const record = aLaunchRecordIn({ placement: 'first-message', savedMethods: older })
    expect(record).not.toBeNull()
    expect(record?.savedMethods).toBeUndefined()
  })

  const recordedLead =
    '## Saved methods\n\n- Rotate a fictional log — /fictional/runbooks/rotate-log.md\n'

  /** A Codex launch's record in the instructions layout, with this conversation's text. */
  function aCodexGiven(over: Partial<ReturnType<typeof givenAnswer>> = {}) {
    const text = recordedLead
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

  it('codex: the lead row says what it was sent, and shows the index as sent', () => {
    const folder = aStore({ 'rotate-log.md': METHOD })
    indexOf(folder, [LINE])
    const { reading, use } = useOf(folder)
    rmSync(folder, { recursive: true })
    const row = leadRow(aCodexGiven({ savedMethods: use }))
    expect(savedPieces(row)).toEqual([
      { kind: 'text', text: recordedLead },
      {
        kind: 'notice',
        cy: 'input-saved-methods',
        text: `Saved methods: 1, ${String(use.given === 'index' ? use.bytes : 0)} bytes, read at 05:30.`,
      },
      { kind: 'text', text: reading.index },
    ])
  })

  it('codex: the lead row keeps its recorded text alongside the index refusal', () => {
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
      { kind: 'text', text: recordedLead },
      {
        kind: 'notice',
        cy: 'input-saved-methods',
        text: 'The saved-methods index was not sent: index.md is not a plain file. Read at 05:30.',
      },
    ])
  })

  it('codex: an older launch’s record without saved-method metadata keeps its recorded text', () => {
    expect(savedPieces(leadRow(aCodexGiven()))).toEqual([{ kind: 'text', text: recordedLead }])
  })
})

describe('what each row of the popup draws for the index as sent', () => {
  const at = (time: number) => new Date(time).toISOString().slice(11, 16)
  const SENT = `- Rotate a fictional log — when the log passes 1 GB — verified 2026-10-12 — /fictional/runbooks/rotate-log.md`
  const use = {
    given: 'index' as const,
    folder: '/fictional/runbooks',
    methods: 1,
    leftOut: 0,
    bytes: Buffer.byteLength(SENT),
    index: SENT,
    readAt: NOW,
  }
  const text = '## Saved methods\n\n- Rotate a fictional log — /fictional/runbooks/rotate-log.md\n'
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
  const indexPieces = (row: ReaderRow) => {
    const from = row.pieces.findIndex(
      (piece) => piece.kind === 'notice' && piece.cy === 'input-saved-methods',
    )
    return from === -1 ? [] : row.pieces.slice(from + 1)
  }

  for (const layout of ['claude', 'codex'] as const) {
    it(`${layout}: the index as sent, under the agent's name, recorded at launch`, () => {
      expect(indexPieces(rowOf(layout, { savedMethods: use }))).toEqual([
        { kind: 'label', author: 'Agent', trust: 'Recorded at launch' },
        { kind: 'text', text: SENT },
      ])
    })

    it(`${layout}: an index that listed no methods shows no text`, () => {
      expect(
        indexPieces(rowOf(layout, { savedMethods: { ...use, methods: 0, bytes: 0, index: '' } })),
      ).toEqual([])
    })
  }

  it('an older record that kept the lines themselves is shown as it was kept, and is not read again', () => {
    // Such a record has no folder or index, so its use is not read back and nothing is
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
