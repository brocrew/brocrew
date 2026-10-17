import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { RESOURCE_TITLE_CHARS, resourceTitle, resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { formOfName, type DocumentForm } from '../src/shared/documents'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # D-026 · R2 — a kept file is titled by what its own bytes say
 *
 * Every file this app keeps is titled ONCE, as it is kept, from the bytes `keptFor` already holds:
 * a Markdown file's front matter `title:`, else its first `# ` heading outside a fenced code block
 * (F046), a page's first `<title>` a
 * browser would use, else the file's name. Agents do nothing for it. This file pins the rule and
 * the three doors that write it:
 *
 *  - **§1 · the rule, `resourceTitle`** — read straight, with no host: what is a heading and what
 *    only looks like one, what a fence is, how the bytes are read (any line ending, a leading byte
 *    order mark, a front matter `title:` first), what a browser would call the page's `<title>` (a comment, a
 *    script, a style, a drawing and an unclosed arm passed over), how its entities are decoded
 *    (ONCE), the cap of 200 characters and the `…` that says a title was cut, and the forms with no
 *    text to look in.
 *  - **§2 · the doors** — over a real `RuntimeHost`, a real ledger and the real toolsets, on the
 *    Fake provider only: a give's inputs, an `update_work`'s files (a giver's input, an owner's made
 *    file) and a reply's files each keep the title the bytes give, and read back through the window's
 *    door (`filesKept`); a row kept before titles were taken reads as its name there, and
 *    `list_tasks {made}` says a title only where it differs from the name.
 *
 * ⚑ Two rules of the file: **the bounds are literals** (200, 199, 198, 197), so a changed constant
 * is read as a change and not followed; and **a negative is paired with a positive from the same
 * reader** — a text that is NOT a title sits beside the identical text one fact over that IS, and
 * every presence is asserted before an order or a text. ⚠️ The bytes handed to the rule are always
 * a `Buffer`: the rule decodes them itself, and a string would hide how it does.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the rule
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** What the rule answers for `content` kept under `name` — the form the name's extension gives. */
const titled = (name: string, content: string | Buffer): string =>
  resourceTitle({
    name,
    form: formOfName(name) as DocumentForm,
    bytes: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
  })

/**
 * Whether a string holds no lone surrogate: `encodeURIComponent` throws on one, which is the
 * check `String#isWellFormed` makes, one this project's `lib` does not declare yet.
 */
const isWellFormed = (text: string): boolean => {
  try {
    encodeURIComponent(text)
    return true
  } catch {
    return false
  }
}

/** One text kept under one name, and the title the rule must give it; every row names its case. */
type Case = readonly [what: string, text: string, expected: string]

/**
 * Every row of the table under one name. ⚑ The table must hold BOTH answers — a row whose title is
 * the name (nothing found) and a row whose title is something found — so a table that only shows
 * the rule finding, or only refusing, is itself a failure of the test.
 */
const check = (name: string, table: readonly Case[]): void => {
  expect(
    table.some(([, , expected]) => expected === name),
    `${name}: the table holds a row answered by the name`,
  ).toBe(true)
  expect(
    table.some(([, , expected]) => expected !== name),
    `${name}: the table holds a row answered by a title found`,
  ).toBe(true)
  for (const [what, text, expected] of table) {
    expect(titled(name, text), `${name} · ${what}`).toBe(expected)
  }
}

describe('D-026 · the rule: a kept file is titled by what its own bytes say', () => {
  it('a Markdown file is titled by its first level-1 heading, and by nothing that only looks like one', () => {
    const NAME = 'doc.md'
    check(NAME, [
      // ⛔ …and each negative sits beside the text one fact over that IS a heading.
      ['`#Title` has no space after the `#`', '#Title\n', NAME],
      ['`# Title` has one', '# Title\n', 'Title'],
      ['`## Section` is level 2', '## Section\n', NAME],
      ['`# Section` is level 1', '# Section\n', 'Section'],
      ['four spaces in is code', '    # four spaces is code\n', NAME],
      ['three spaces in is a heading', '   # three spaces in\n', 'three spaces in'],
      ['a bare `#` is an empty heading', '#\n', NAME],
      ['a `#` then a tab then words is a heading', '#\tTabbed\n', 'Tabbed'],
      ['a heading that is only a closing run is empty', '# #\n', NAME],
      ['a heading with words before its closing run is not', '# Title ##\n', 'Title'],
      ['no heading at all', 'just words\n', NAME],
      ['the same words as a heading', '# just words\n', 'just words'],
      // ⚑ The EMPTY first heading is the title, and a second is never looked for.
      ['an empty first heading, then a second', '#\n# Second\n', NAME],
      ['a first heading, then a second', '# First\n# Second\n', 'First'],
      // ⚑ A `##` is passed over and the first `#` wins, whatever follows it.
      [
        'a `##` before the first `#`, and a `#` after',
        'First line\n\n## Sub\n\n# Main\n\n# Later\n',
        'Main',
      ],
      // ⚑ The closing run: dropped when a space or tab stands before it, kept otherwise.
      ['trailing spaces are trimmed', '# Title   \n', 'Title'],
      ['a `#` that ends the words after a space is a closing run', '# C# #\n', 'C#'],
      ['a `#` not preceded by a space or tab is kept', '# Learn C#\n', 'Learn C#'],
      // ⚑ Inline Markdown is kept as written.
      ['inline Markdown is not rendered', '# The *bold* `code` title\n', 'The *bold* `code` title'],
    ])
  })

  it('a fenced code block is passed over — and only a fence is', () => {
    const NAME = 'doc.md'
    check(NAME, [
      // ⚑ A heading inside a closed fence is not the title; the one after it is.
      ['a closed backtick fence holds the heading', '```\n# inside\n```\n', NAME],
      ['…and a real heading follows it', '```\n# inside\n```\n# Real\n', 'Real'],
      ['a closed tilde fence holds the heading', '~~~\n# inside\n~~~\n', NAME],
      ['…and a real heading follows it', '~~~\n# inside\n~~~\n# Real\n', 'Real'],
      ['a heading ahead of the fence is the title', '# Before\n```\n# inside\n```\n', 'Before'],
      // ⚠️ An unclosed fence runs to the end.
      ['an unclosed fence runs to the end', '```\n# inside\n', NAME],
      // ⚑ A closer of the other character does not close; a shorter run does not; a longer one does.
      ['a backtick run does not close a tilde fence', '~~~\n```\n# inside\n~~~\n# Real\n', 'Real'],
      [
        'a shorter run does not close a longer fence',
        '````\n```\n# inside\n````\n# Real\n',
        'Real',
      ],
      ['a longer run closes a shorter fence', '```\n# inside\n`````\n# Real\n', 'Real'],
      // ⚑ A backtick fence whose info string holds a backtick opens none; without it, it opens.
      ['a backtick in the info string opens no fence', '``` a ` b\n# Real\n', 'Real'],
      ['no backtick in the info string opens a fence that never closes', '``` a b\n# Real\n', NAME],
      // ⚑ Indentation: three spaces open a fence, four open none.
      ['three spaces in open and close a fence', '   ```\n# inside\n   ```\n# Real\n', 'Real'],
      ['three spaces in open a fence that never closes', '   ```\n# Real\n', NAME],
      ['four spaces in open no fence', '    ```\n# Real\n', 'Real'],
    ])
  })

  it('a Markdown file’s bytes are read as the viewer reads them: any line ending, a leading byte order mark, a front matter title first', () => {
    const BOM = Buffer.from([0xef, 0xbb, 0xbf])
    // ⚑ Line endings: CRLF, and a lone CR is a line break — each beside the same text with LF.
    expect(titled('doc.md', '# Windows\r\n\r\nbody\r\n'), 'CRLF').toBe('Windows')
    expect(titled('doc.md', '# Windows\n\nbody\n'), 'the same text with LF').toBe('Windows')
    expect(titled('doc.md', 'intro\r# Old Mac\rbody\r'), 'a lone CR is a line break').toBe(
      'Old Mac',
    )
    expect(titled('doc.md', 'intro\n# Old Mac\nbody\n'), 'the same text with LF').toBe('Old Mac')

    // ⚑ A leading byte order mark does not hide the first `#`; with no heading it still gives the
    // name. The twin with no mark is the same text.
    expect(
      titled('doc.md', Buffer.concat([BOM, Buffer.from('# With a mark\n')])),
      'a heading behind a byte order mark',
    ).toBe('With a mark')
    expect(titled('doc.md', '# With a mark\n'), 'the same heading with no mark').toBe('With a mark')
    expect(
      titled('doc.md', Buffer.concat([BOM, Buffer.from('no heading\n')])),
      'no heading behind a byte order mark',
    ).toBe('doc.md')

    // ⚑ **F046 — a front matter `title:` comes first.** ⚠️ With none, no front-matter skip (D-026's
    // ruling, to match the viewer): a `# ` line inside YAML front matter is the first heading the
    // viewer draws, so it is the title.
    expect(
      titled('doc.md', '---\ntitle: x\n# a yaml comment\n---\n# Real\n'),
      'a front matter title, before a heading inside the front matter',
    ).toBe('x')
    expect(
      titled('doc.md', '---\ntitle: x\n---\n# Real\n'),
      'a front matter title, before the first heading',
    ).toBe('x')
    expect(
      titled('doc.md', '---\nauthor: y\n# a yaml comment\n---\n# Real\n'),
      'no title in the front matter: a heading inside it',
    ).toBe('a yaml comment')
    expect(
      titled('doc.md', '---\nauthor: y\n---\n# Real\n'),
      'no title in the front matter and no heading in it',
    ).toBe('Real')

    // ⚑ **A quoted title keeps everything inside its quotes, `#` included**; a ` #` comment is cut
    // only outside them, and an unquoted title keeps the rule that cuts it.
    const fm = (value: string): string => titled('doc.md', `---\ntitle: ${value}\n---\n# Real\n`)
    expect(fm('"a #b"'), 'a double-quoted title with " #" inside').toBe('a #b')
    expect(fm("'a #b'"), 'a single-quoted title with " #" inside').toBe('a #b')
    expect(fm('"a #b" # a comment'), 'a comment after the closing quote').toBe('a #b')
    expect(fm('a #b'), 'an unquoted title: " #" starts a comment').toBe('a')
    // ⚑ Escapes: `\"` and `\\` inside double quotes, `''` inside single ones; a quote they make
    // does not close the value.
    expect(fm('"say \\"hi #1\\" \\\\ ok"'), 'escaped quotes and a backslash').toBe(
      'say "hi #1" \\ ok',
    )
    expect(fm("'it''s #1'"), 'a doubled single quote').toBe("it's #1")
    // ⚠️ A quote that never closes, or text after it, is read as an unquoted value.
    expect(fm('"a #b'), 'a quote that never closes').toBe('"a')
  })

  it('a page is titled by the first <title> a browser would use', () => {
    const NAME = 'page.html'
    check(NAME, [
      [
        'a plain page',
        '<!doctype html><html><head><title>Status page</title></head><body><h1>Other</h1></body></html>',
        'Status page',
      ],
      ['a page with no <title>', '<!doctype html><body><h1>Other</h1></body>', NAME],
      [
        'the tag in capitals, with an attribute and a space',
        '<HEAD><TITLE lang="en">Upper</TITLE >',
        'Upper',
      ],
      // ⚑ A comment hides what is in it; the real <title> after it is found.
      ['a <title> after a comment', '<!-- <title>Old</title> --><title>New</title>', 'New'],
      ['a <title> only inside a comment', '<!-- <title>Old</title> --><p>x</p>', NAME],
      ['`<!-->` is a whole comment', '<!--><title>Real</title>', 'Real'],
      ['an unclosed comment hides the rest', '<!-- never closed <title>Hidden</title>', NAME],
      ['a closed comment hides nothing after it', '<!-- closed --><title>Hidden</title>', 'Hidden'],
      // ⚑ A script's or a style's text is text, never an element.
      [
        'a <title> after a script that holds one in a string',
        '<script>var s = "<title>Fake</title>"</script><title>Real</title>',
        'Real',
      ],
      ['a <title> only in a script', '<script>var s = "<title>Fake</title>"</script>', NAME],
      [
        'a <title> after a style that holds one in a comment',
        '<style>/* <title>Fake</title> */</style><title>Real</title>',
        'Real',
      ],
      ['a <title> only in a style', '<style>/* <title>Fake</title> */</style>', NAME],
      // ⚑ A drawing's <title> is its tooltip, never the page's.
      [
        'an <svg> with a tooltip, then the page’s <title>',
        '<body><svg viewBox="0 0 1 1"><title>Tooltip</title><circle r="1"/></svg><title>The page</title>',
        'The page',
      ],
      [
        'an <svg> with a tooltip and no page <title>',
        '<body><svg viewBox="0 0 1 1"><title>Tooltip</title><circle r="1"/></svg>',
        NAME,
      ],
      [
        'an <svg> nested in an <svg>, then the page’s <title>',
        '<svg><svg></svg><title>Inner</title></svg><title>The page</title>',
        'The page',
      ],
      ['a self-closed <svg/> holds nothing', '<svg/><title>The page</title>', 'The page'],
      [
        'an <svg> that is not self-closed holds its <title>',
        '<svg><title>Inner</title></svg>',
        NAME,
      ],
      [
        'a <math> holds its <title>, and the page’s follows',
        '<math><title>Inner</title></math><title>The page</title>',
        'The page',
      ],
      ['a <math> alone holds its <title>', '<math><title>Inner</title></math>', NAME],
      // ⚠️ Unclosed arms give none — each beside the same text closed.
      ['an unclosed <svg> gives none', '<svg><title>x</title><title>y</title>', NAME],
      ['the same <svg> closed', '<svg><title>x</title></svg><title>y</title>', 'y'],
      ['an unclosed <script> gives none', '<script>var a;<title>t</title>', NAME],
      ['the same <script> closed', '<script>var a;</script><title>t</title>', 't'],
      ['an unclosed <title> gives none', '<head><title>Never closed<body>text', NAME],
      ['the same <title> closed', '<head><title>Closed</title><body>text', 'Closed'],
      // ⚑ `<titles>` is not a title.
      ['`<titles>` before the <title>', '<titles>Not</titles><title>Real</title>', 'Real'],
      ['`<titles>` alone', '<titles>Not</titles>', NAME],
      // ⚑ The first <title> is THE title, even when it is empty.
      ['an empty first <title>, then a second', '<title>  </title><title>Second</title>', NAME],
      ['a first <title>, then a second', '<title> First </title><title>Second</title>', 'First'],
      // ⚑ Whitespace collapses to single spaces.
      ['whitespace collapses', '<title>\n  A   long\n\ttitle \n</title>', 'A long title'],
    ])

    // ⚑ A `.htm` is a page too.
    expect(titled('old.htm', '<title>Old page</title>'), 'a .htm file').toBe('Old page')
    expect(titled('old.htm', '<p>no title</p>'), 'a .htm file with no <title>').toBe('old.htm')

    // ⚑ A `.svg` FILE is an image, with no text to look in: the very bytes that an `<svg>` inside a
    // page passes over are named by the file's name — and the same bytes in a page are a drawing
    // inside a page, which holds no page <title>.
    const drawing = '<svg xmlns="http://www.w3.org/2000/svg"><title>Logo tooltip</title></svg>'
    expect(titled('logo.svg', drawing), 'the drawing as a .svg file').toBe('logo.svg')
    expect(titled('logo.html', drawing), 'the same bytes as a page').toBe('logo.html')
    expect(
      titled('logo.html', `${drawing}<title>The page</title>`),
      'the same bytes as a page, with its own <title>',
    ).toBe('The page')
  })

  it('a page’s title is decoded once, its entities by their own rules, and a title that decodes to nothing is the name', () => {
    const NAME = 'page.html'
    check(NAME, [
      [
        'named, decimal and hex entities decode; the rest stay as written',
        // named · decimal · hex x and X · ONE pass (`&amp;lt;` stops at `&lt;`) · an unknown name ·
        // zero · a surrogate · a value above 0x10FFFF · an astral value · a no-break space.
        '<title>Tom &amp; Jerry &mdash; &lt;b&gt; &#65;&#x42;&#X43; &amp;lt; &unknown; &#0; &#xD800; &#1114112; &#128512; &nbsp;end</title>',
        'Tom & Jerry — <b> ABC &lt; &unknown; &#0; &#xD800; &#1114112; 😀 end',
      ],
      ['a decoded title', '<title>Fish &amp; Chips</title>', 'Fish & Chips'],
      ['one pass: an escaped `&lt;` is not decoded twice', '<title>&amp;lt;</title>', '&lt;'],
      ['an unknown name stays as written', '<title>&unknown;</title>', '&unknown;'],
      ['a title that decodes to a no-break space is no title', '<title>&nbsp;</title>', NAME],
      ['a title that is empty is no title', '<title></title>', NAME],
    ])
  })

  it('a title found is capped at 200 characters and a cut one ends in … — never inside a surrogate pair — while a name is never cut', () => {
    // ⚑ The bound is a literal, so a changed constant is read as a change and not followed.
    expect(RESOURCE_TITLE_CHARS).toBe(200)

    // ⚑ 200 kept whole beside 201 cut — the same heading, one character longer.
    const whole = titled('doc.md', `# ${'h'.repeat(200)}`)
    expect(whole, '200 characters').toBe('h'.repeat(200))
    expect(whole.length, '200 characters, counted').toBe(200)
    expect(whole.endsWith('…'), '200 characters are not cut').toBe(false)
    const cut = titled('doc.md', `# ${'h'.repeat(201)}`)
    expect(cut, '201 characters').toBe(`${'h'.repeat(199)}…`)
    expect(cut.length, '201 characters, counted').toBe(200)
    expect(titled('doc.md', `# ${'h'.repeat(300)}`), '300 characters').toBe(`${'h'.repeat(199)}…`)
    // …on a page's <title>, the same.
    expect(titled('page.html', `<title>${'p'.repeat(200)}</title>`), 'a page of 200').toBe(
      'p'.repeat(200),
    )
    expect(titled('page.html', `<title>${'p'.repeat(300)}</title>`), 'a page of 300').toBe(
      `${'p'.repeat(199)}…`,
    )

    // ⚠️ The instrument first: it tells a whole pair from half of one.
    expect(isWellFormed('x😀'), 'a whole pair').toBe(true)
    expect(isWellFormed('x\ud83d'), 'half a pair').toBe(false)

    // ⚠️ Never inside a surrogate pair: a pair that straddles the cut is dropped whole, one that
    // ends before it is kept whole.
    const straddles = titled('doc.md', `# ${'x'.repeat(198)}😀tail`)
    expect(straddles, 'a pair across the cut').toBe(`${'x'.repeat(198)}…`)
    expect(isWellFormed(straddles), 'a pair across the cut leaves no lone surrogate').toBe(true)
    const kept = titled('doc.md', `# ${'x'.repeat(197)}😀tail`)
    expect(kept, 'a pair that ends at the cut').toBe(`${'x'.repeat(197)}😀…`)
    expect(kept.length, 'a pair that ends at the cut, counted').toBe(200)
    expect(isWellFormed(kept), 'a pair that ends at the cut is whole').toBe(true)

    // ⚑ A NAME is never cut: it is what the rule falls back to, one path segment the file system
    // bounds — with no heading, and with an empty one — beside a heading of 300 that is cut.
    const longName = `${'n'.repeat(250)}.md`
    expect(titled(longName, 'no heading here\n'), 'a long name, no heading').toBe(longName)
    expect(titled(longName, '#\n'), 'a long name, an empty heading').toBe(longName)
    expect(titled(longName, `# ${'h'.repeat(300)}\n`), 'a long name, a long heading').toBe(
      `${'h'.repeat(199)}…`,
    )
  })

  it('a form with no text to look in is titled by its name', () => {
    // ⚑ An image and a PDF are titled by their names whatever their bytes say…
    expect(titled('diagram.png', '# Not a title\n'), 'an image').toBe('diagram.png')
    expect(titled('shot.jpeg', '<title>x</title>'), 'an image, with a <title> in it').toBe(
      'shot.jpeg',
    )
    expect(titled('report.pdf', '%PDF-1.4 <title>x</title> # y\n'), 'a PDF').toBe('report.pdf')
    // …and the same bytes under a Markdown or a page name ARE read.
    expect(titled('diagram.md', '# Not a title\n'), 'the same bytes as Markdown').toBe(
      'Not a title',
    )
    expect(titled('shot.html', '<title>x</title>'), 'the same bytes as a page').toBe('x')
    expect(
      titled('report.md', '%PDF-1.4 <title>x</title> # y\n'),
      'the PDF’s bytes as Markdown',
    ).toBe('report.md')
    expect(
      titled('report.html', '%PDF-1.4 <title>x</title> # y\n'),
      'the PDF’s bytes as a page',
    ).toBe('x')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the doors
// ─────────────────────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

type Answered = { structured: Record<string, unknown>; text: string }

describe('D-026 · the doors: every way a file is kept writes the title its bytes give', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d026-titles-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d026-titles-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_260_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      resourcesRoot: () => resourcesRoot(userData),
      newSessionId: () => `sess_${++counter}`,
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
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The rig
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * A conversation a person opened. ⚑ Every one is opened `auto`, so a given child's brief turn ends
   * instead of parking on a card, and a conversation is idle when the test reads it.
   */
  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  /** An identity a give can name: opened by a person, then closed. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const callFull = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Answered> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => (await callFull(caller, name, args)).structured

  const isIdle = (id: string): boolean => {
    const last = events(id)
      .filter((event) => event.type === 'status')
      .at(-1) as { state?: string } | undefined
    return last?.state === 'idle'
  }

  /** What the PROVIDER was handed: the Fake echoes each send as an assistant message. */
  const saidToProvider = (id: string): string[] =>
    events(id)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => text.slice('echo: '.length))

  const wrote = (name: string, content: Buffer | string): string => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return path
  }

  /** One file kept by ONE `update_work` call, its own timestamp, answered `ok`. */
  const keeps = async (
    caller: string,
    piece: string,
    name: string,
    content: string,
  ): Promise<string> => {
    const kept = await callOn(caller, 'update_work', { piece, resources: [wrote(name, content)] })
    expect(kept.outcome, JSON.stringify(kept)).toBe('ok')
    const files = kept.resources as { resource: string; name: string }[]
    expect(files.map((one) => one.name)).toEqual([name])
    return files[0]?.resource as string
  }

  /** The window's door on one piece, answered `ok`. */
  const doorOnPiece = (piece: string) => {
    const door = host.filesKept({ scope: 'piece', piece })
    if (!door.ok) throw new Error(`the door refused ${piece}: ${door.reason}`)
    return door.files
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2.1 · the three doors
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('all three doors keep the title the bytes give: a give’s input, a giver’s or an owner’s update_work file, and a reply’s file', async () => {
    await bringIdentityIntoBeing('ali')
    const pm = await personOpens('pm')

    // (1) ⚑ A give's inputs: one file with a heading, and one with none, in the SAME give.
    const brief = 'index it'
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'ali',
      title: 'the index',
      brief,
      inputs: [
        wrote('brief.md', '# The brief\n\nread me\n'),
        wrote('plain-in.md', 'no heading here\n'),
      ],
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const agent = given.agent as string
    const label = given.label as string
    // ⚑ The brief reached the provider AND the turn ended: an `idle` the Fake publishes when the
    // conversation starts is not the end of the first turn.
    await waitFor(
      () => saidToProvider(agent).some((said) => said.includes(brief)),
      `${agent} to be handed its brief`,
    )
    await waitFor(() => isIdle(agent), `${agent} to go idle on its first piece`)
    const inputs = Object.fromEntries(
      (given.inputs as { resource: string; name: string }[]).map((one) => [one.name, one.resource]),
    )
    expect(Object.keys(inputs).sort(), JSON.stringify(given.inputs)).toEqual([
      'brief.md',
      'plain-in.md',
    ])

    // (2) ⚑ A giver's update_work: the PM gave the piece, so its file is an input.
    const givenId = await keeps(pm, label, 'given.md', '# Handed over\n\nrows\n')
    // (3) ⚑ The owner's: the agent holds the piece, so its file is what it made — and a page.
    const madeId = await keeps(
      agent,
      label,
      'made.html',
      '<!doctype html><title>Status &amp; plan</title><p>body</p>',
    )
    // (4) ⚑ A reply's file — AFTER the other two: a reply ends the piece, and an ended piece takes
    // no files.
    const replied = await callOn(agent, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'the index, with the findings',
      resource_paths: [wrote('findings.md', '# Open findings\n\nrows\n')],
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    const repliedIds = replied.resources as string[]
    expect(repliedIds, JSON.stringify(replied)).toHaveLength(1)

    // ⚠️ The premise, off the ledger: each file is the kind the fixture says it is.
    const doors = [
      ['a give’s input with a heading', inputs['brief.md'], 'brief.md', 'The brief', 'input'],
      ['a give’s input with none', inputs['plain-in.md'], 'plain-in.md', 'plain-in.md', 'input'],
      ['a giver’s update_work file', givenId, 'given.md', 'Handed over', 'input'],
      ['an owner’s update_work page', madeId, 'made.html', 'Status & plan', 'made'],
      ['a reply’s file', repliedIds[0], 'findings.md', 'Open findings', 'made'],
    ] as const

    // ⛔ Each door is its own assertion, so a door that writes the name goes red alone.
    for (const [door, id, name, title, role] of doors) {
      expect(id, `${door}: its id`).toMatch(/^res_/)
      const row = store.resource(id as string)
      expect(row, `${door}: the row is kept`).not.toBeNull()
      expect(row?.name, `${door}: its name`).toBe(name)
      expect(row?.role, `${door}: its role`).toBe(role)
      expect(row?.title, `${door}: its stored title`).toBe(title)
    }

    // ⚑ …and the window's door answers the same titles for the same files, each row's name still the
    // file's name — the piece holds all five and nothing else.
    const rows = doorOnPiece(label)
    expect(rows.map((one) => one.name).sort()).toEqual(doors.map(([, , name]) => name).sort())
    expect(Object.fromEntries(rows.map((one) => [one.name, one.title]))).toEqual({
      'brief.md': 'The brief',
      'plain-in.md': 'plain-in.md',
      'given.md': 'Handed over',
      'made.html': 'Status & plan',
      'findings.md': 'Open findings',
    })
    for (const [door, id, name, title] of doors) {
      const row = rows.find((one) => one.name === name)
      expect(row?.resourceId, `${door}: the door's row is the kept file`).toBe(id)
      expect(row?.title, `${door}: the door's title`).toBe(title)
      expect(row?.title, `${door}: the door's title is the stored one`).toBe(
        store.resource(id as string)?.title,
      )
    }
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2.2 · a row kept before titles were taken
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('a file kept before titles were taken reads as its name at the door, and list_tasks says a title only where it differs from the name', async () => {
    const ali1 = await personOpens('ali')
    const aliRoot = store.rootOf(ali1)
    if (aliRoot === null) throw new Error('ali1 owns no root')

    // ⚑ Two files kept by this build, one call each, so each takes its own timestamp: one titled by
    // its heading, one whose title is its name.
    const reportId = await keeps(ali1, aliRoot.label, 'report.md', '# Quarterly report\n\nbody\n')
    const notesId = await keeps(ali1, aliRoot.label, 'notes.md', 'just notes\n')
    // ⚑ …and a row as a build before D-026 wrote it: no title at all.
    db.prepare(
      'INSERT INTO work_resource (id, work_id, role, name, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('res_legacy', aliRoot.piece, 'made', 'old.md', 'a'.repeat(64), 1, tick())

    // ⚠️ The premise, off the ledger: the legacy row's stored title is null, the new ones' are not.
    expect(store.resource('res_legacy')?.title, 'the legacy row').toBeNull()
    expect(store.resource(reportId)?.title, 'the report').toBe('Quarterly report')
    expect(store.resource(notesId)?.title, 'the notes').toBe('notes.md')

    // The door: a title is never null and never empty, and a legacy row reads as its name.
    const rows = doorOnPiece(aliRoot.label)
    const door = Object.fromEntries(rows.map((one) => [one.name, one]))
    expect(Object.keys(door).sort()).toEqual(['notes.md', 'old.md', 'report.md'])
    expect(door['report.md']?.title, 'the door: a new file with a heading').toBe('Quarterly report')
    expect(door['report.md']?.name, 'the door: the heading is not its name').toBe('report.md')
    expect(door['notes.md']?.title, 'the door: a new file with none').toBe('notes.md')
    expect(door['old.md']?.title, 'the door: a legacy row reads as its name').toBe('old.md')
    expect(door['old.md']?.resourceId, 'the door: the legacy row is the one inserted').toBe(
      'res_legacy',
    )

    // list_tasks {made}: the structure carries the stored value (null for the legacy row)…
    const listed = await callFull(ali1, 'list_tasks', { made: true })
    expect(listed.structured, listed.text).toMatchObject({ outcome: 'ok', more: 0 })
    const made = Object.fromEntries(
      (listed.structured.made as { name: string; title: string | null }[]).map((one) => [
        one.name,
        one.title,
      ]),
    )
    expect(made).toEqual({
      'report.md': 'Quarterly report',
      'notes.md': 'notes.md',
      'old.md': null,
    })

    // …and the words say a title only where it differs from the name.
    const lineOf = (name: string): string => {
      const line = listed.text.split('\n').find((one) => one.includes(`(${name})`))
      if (line === undefined) throw new Error(`no line names (${name}): ${listed.text}`)
      return line
    }
    expect(lineOf('report.md'), 'a titled file says its title').toContain(
      `${reportId} (report.md) · Quarterly report — on `,
    )
    expect(lineOf('notes.md'), 'a file titled by its name says it once').toContain(
      `${notesId} (notes.md) — on `,
    )
    expect(lineOf('notes.md'), 'a file titled by its name has no title arm').not.toContain(
      '(notes.md) · ',
    )
    expect(lineOf('old.md'), 'a legacy row says its name once').toContain(
      'res_legacy (old.md) — on ',
    )
    for (const said of ['· null', 'undefined']) {
      expect(lineOf('old.md'), `a legacy row never says ${said}`).not.toContain(said)
    }
  })

  it('the titling after a launch titles a file kept before titles, and again a file titled by its name whose bytes say a title — never a title the bytes do not account for', async () => {
    const ali1 = await personOpens('ali')
    const aliRoot = store.rootOf(ali1)
    if (aliRoot === null) throw new Error('ali1 owns no root')
    // ⚑ Kept by this build, then set back to the name: what a build that did not read a front
    // matter title wrote for a file with front matter and no heading.
    const frontMatter = await keeps(
      ali1,
      aliRoot.label,
      'slip.md',
      '---\ntitle: "Slipping a #piece in"\n---\nbody\n',
    )
    const heading = await keeps(ali1, aliRoot.label, 'heading.md', '# A heading\n\nbody\n')
    const none = await keeps(ali1, aliRoot.label, 'notes.md', 'just notes\n')
    const chosen = await keeps(
      ali1,
      aliRoot.label,
      'chosen.md',
      '---\ntitle: From the bytes\n---\n',
    )
    const setTitle = db.prepare('UPDATE work_resource SET title = ? WHERE id = ?')
    setTitle.run('slip.md', frontMatter)
    setTitle.run('heading.md', heading)
    // ⚠️ A title neither the name nor the heading-only reader gives is never replaced.
    setTitle.run('A title of its own', chosen)
    // …and a row as a build before titles wrote it: no title, and no bytes kept.
    db.prepare(
      'INSERT INTO work_resource (id, work_id, role, name, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('res_legacy', aliRoot.piece, 'made', 'old.md', 'a'.repeat(64), 1, tick())

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 1, retitled: 2 })
    expect(store.resource(frontMatter)?.title, 'a front matter title, quoted').toBe(
      'Slipping a #piece in',
    )
    expect(store.resource(heading)?.title, 'a heading').toBe('A heading')
    expect(store.resource(none)?.title, 'no title in its bytes: its name').toBe('notes.md')
    expect(store.resource(chosen)?.title, 'a title that is not its name').toBe('A title of its own')
    expect(store.resource('res_legacy')?.title, 'no bytes: its name').toBe('old.md')

    // ⚑ Once by the data: a second launch titles nothing, and the file titled by its name stays so.
    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 0 })
    expect(store.resource(none)?.title).toBe('notes.md')
    // ⛔ The write itself refuses a title equal to the one it replaces, and a row whose title is no
    // longer the one read.
    expect(store.retitleResource(none, 'notes.md', 'notes.md')).toBe(false)
    expect(store.retitleResource(chosen, 'chosen.md', 'Another')).toBe(false)
  })

  /**
   * 🔴 **F046's rest — a file the old reader titled by its first heading takes its front matter's
   * title.** Two files kept on 2026-09-30 read *"Method"* and *"Re-check: F001, …"*: a heading taken
   * before front matter was read. ⛔ Only a title the reader gave is replaced — one equal to what the
   * reader before front matter gives from the same bytes — so a title anyone chose stays, and so does
   * one cut at 200 characters, which a fresh read gives again.
   */
  it('F046 · a file titled by its first heading before front matter was read takes its front matter’s title — never a title someone chose', async () => {
    const ali1 = await personOpens('ali')
    const aliRoot = store.rootOf(ali1)
    if (aliRoot === null) throw new Error('ali1 owns no root')
    const recheck =
      '---\ntitle: Re-check of 9 runtime findings against garden-develop @ d074f4c2\nauthor: Ana\n---\n\n# Method\n\nRead each finding again.\n'
    const old = await keeps(ali1, aliRoot.label, 'recheck-runtime.md', recheck)
    const chosen = await keeps(ali1, aliRoot.label, 'recheck-ui.md', recheck)
    const long = `---\ntitle: ${'A'.repeat(260)}\n---\n\n# Short heading\n`
    const capped = await keeps(ali1, aliRoot.label, 'long.md', long)
    const setTitle = db.prepare('UPDATE work_resource SET title = ? WHERE id = ?')
    // ⚑ What a build that read no front matter wrote: the first heading.
    setTitle.run('Method', old)
    // ⚑ A title neither reader gives from these bytes: somebody's, and never replaced.
    setTitle.run('The UI re-check, as Anh named it', chosen)
    const keptCapped = store.resource(capped)?.title
    expect(keptCapped, 'a title over the cap is kept cut').toMatch(/^A{199}…$/)
    // ⚑ No front matter, a heading over the cap: the old reader and a fresh read cut it the same.
    const longHeading = await keeps(
      ali1,
      aliRoot.label,
      'long-heading.md',
      `# ${'H'.repeat(260)}\n`,
    )
    const keptHeading = store.resource(longHeading)?.title
    expect(keptHeading).toMatch(/^H{199}…$/)
    // ⚑ A file the old reader titled whose bytes are gone: nothing to read, so it is left as it is.
    const gone = await keeps(ali1, aliRoot.label, 'gone.md', recheck.replace('Ana', 'Anh'))
    setTitle.run('Method', gone)
    const goneRow = store.resource(gone)
    if (goneRow === null) throw new Error('gone.md was not kept')
    rmSync(join(resourcesRoot(userData), goneRow.sha256, goneRow.name))

    // ⚑ A file kept once every build read front matter: its title was never the old reader's to give,
    // so it is not read again, whatever it holds.
    const later = await keeps(ali1, aliRoot.label, 'later.md', recheck.replace('Ana', 'Ama'))
    setTitle.run('Method', later)
    db.prepare('UPDATE work_resource SET created_at = ? WHERE id = ?').run(
      Date.UTC(2026, 9, 11),
      later,
    )

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 1 })
    expect(store.resource(later)?.title, 'kept after the reader shipped everywhere').toBe('Method')
    expect(store.resource(old)?.title).toBe(
      'Re-check of 9 runtime findings against garden-develop @ d074f4c2',
    )
    expect(store.resource(chosen)?.title).toBe('The UI re-check, as Anh named it')
    expect(store.resource(capped)?.title, 'a cut title is what a fresh read gives').toBe(keptCapped)
    expect(store.resource(longHeading)?.title, 'a cut heading is what a fresh read gives').toBe(
      keptHeading,
    )
    expect(store.resource(gone)?.title, 'bytes gone: left as it is').toBe('Method')

    // ⚑ Once by the data: the next launch finds the reader's titles already replaced.
    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 0 })
    // ⛔ And the write compares with what it read: a title changed since is left alone.
    expect(store.retitleResource(old, 'Method', 'Something else')).toBe(false)
  })

  /**
   * 🔴 **F085 — the file a spaced key hid from the reader is titled again.** Anh's re-check has
   * `range checked: …` in its front matter, so the reader took its heading even after front matter
   * was read; its stored title is exactly that heading, which is what the older reader gives too, so
   * the pass replaces it now that the key is read.
   */
  it('F085 · a file whose front matter has a key with a space takes its front matter’s title', async () => {
    const ali1 = await personOpens('ali')
    const aliRoot = store.rootOf(ali1)
    if (aliRoot === null) throw new Error('ali1 owns no root')
    const anh =
      '---\nauthor: Anh\nrange checked: 551c81d5..d074f4c2\ntitle: Re-check of 8 UI-side findings against d074f4c2\n---\n\n# Re-check: F001, F006, F007, F008, F033, F035, F037, F038 against d074f4c2\n'
    const kept = await keeps(ali1, aliRoot.label, 'recheck-ui.md', anh)
    expect(store.resource(kept)?.title, 'kept now, the key is read').toBe(
      'Re-check of 8 UI-side findings against d074f4c2',
    )
    // ⚑ As a reader that refused the spaced key stored it: the first heading.
    db.prepare('UPDATE work_resource SET title = ? WHERE id = ?').run(
      'Re-check: F001, F006, F007, F008, F033, F035, F037, F038 against d074f4c2',
      kept,
    )
    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 1 })
    expect(store.resource(kept)?.title).toBe('Re-check of 8 UI-side findings against d074f4c2')
  })
})
