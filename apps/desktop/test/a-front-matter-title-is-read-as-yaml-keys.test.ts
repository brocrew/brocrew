import { describe, expect, it } from 'vitest'
import { resourceTitle } from '../src/main/resources/resources'
import { formOfName, type DocumentForm } from '../src/shared/documents'

/**
 * # F046 · a Markdown file's front matter `title:` is read as YAML keys
 *
 * F046 (`50a548e2`, review fixes `3cbc4bf5`) put a Markdown file's front matter `title:` ahead of
 * its first `# ` heading, and the heading ahead of its name. This file pins how that front matter is
 * read, through the one rule every kept file is titled by (`resourceTitle`), with no host:
 *
 *  - **§1 · the order** — a front matter `title:`, then the first `# ` heading outside a fence, then
 *    the name; and the front matter is a Markdown file's only (a page is not read for one).
 *  - **§2 · the value** — a quoted value decoded (`"…\"…"`, `'it''s'`); a ` #` comment ends a value
 *    and a value that is only a comment is no title; a block scalar (`|`, `>`), `~` and `null` are no
 *    title; `title:foo` is not a key; an indented `title:` under another key is not read.
 *  - **§3 · what counts as front matter** — a first line `---` closed by `---` or `...`, every
 *    unindented line in it a key, a comment or blank: a horizontal rule followed by prose is not
 *    front matter, a block of only keys and `# ` lines is; a key may hold spaces or be quoted
 *    (F085); and any line ending reads the same.
 *
 * ⚑ The rule of the file: **every negative is paired with a positive one fact over**, from the same
 * reader — {@link pair} refuses a pair whose two answers are the same, so a reader that answers one
 * thing for everything cannot pass a row. ⚠️ The bytes handed to the rule are always a `Buffer`.
 *
 * ⚑ **The `---`, `# Intro`, blank, `some prose`, blank, `---` case is `Intro`** — derived from the
 * code on `3cbc4bf5`: `some prose` is an unindented line that is neither blank, a comment nor a
 * `key:`, so the block is not YAML, `frontMatterTitle` answers `null`, and the heading scan finds
 * `# Intro` (a `---` is never a heading). Its twin with `title: oops` in place of the prose is YAML
 * (a `# ` line there is a comment) and is titled `oops`.
 */

/** What the rule answers for `content` kept under `name` — the form the name's extension gives. */
const titled = (name: string, content: string | Buffer): string =>
  resourceTitle({
    name,
    form: formOfName(name) as DocumentForm,
    bytes: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
  })

const NAME = 'doc.md'

/**
 * One fact checked both ways: `negative` is the text that must NOT be titled the way `positive` is,
 * and the two answers must differ — a pair that agrees measures nothing.
 */
interface Pair {
  readonly what: string
  readonly negative: string
  readonly notTitled: string
  readonly positive: string
  readonly isTitled: string
}

const pair = (rows: readonly Pair[]): void => {
  for (const row of rows) {
    expect(row.notTitled, `${row.what}: the two answers differ`).not.toBe(row.isTitled)
    expect(titled(NAME, row.positive), `${row.what} · the positive`).toBe(row.isTitled)
    expect(titled(NAME, row.negative), `${row.what} · the negative`).toBe(row.notTitled)
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the order
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('F046 · §1 · front matter first, then the first heading outside a fence, then the name', () => {
  it('each tier answers only when the one above it has nothing', () => {
    // ⚑ The three tiers, each one fact apart from the next.
    expect(
      titled(NAME, '---\ntitle: From the front matter\n---\n# The heading\n'),
      'a front matter title is the title, though a heading follows',
    ).toBe('From the front matter')
    expect(
      titled(NAME, '---\nauthor: someone\n---\n# The heading\n'),
      'front matter with no title: the first heading',
    ).toBe('The heading')
    expect(
      titled(NAME, '---\nauthor: someone\n---\nno heading at all\n'),
      'front matter with no title and no heading: the name',
    ).toBe(NAME)
  })

  it('with no front matter title, a heading inside a fence is passed over and the one after it is the title', () => {
    pair([
      {
        what: 'a fenced heading after title-less front matter',
        negative: '---\nauthor: someone\n---\n```\n# fenced\n```\n',
        notTitled: NAME,
        positive: '---\nauthor: someone\n---\n```\n# fenced\n```\n# Outside\n',
        isTitled: 'Outside',
      },
    ])
  })

  it('a key after another is still read, and a later key never stands for an earlier title', () => {
    pair([
      {
        what: 'a title that is not the first key',
        negative: '---\nauthor: someone\ndate: 2026-10-03\n---\n# H\n',
        notTitled: 'H',
        positive: '---\nauthor: someone\ndate: 2026-10-03\ntitle: Third key\n---\n# H\n',
        isTitled: 'Third key',
      },
    ])
  })

  it('a page is never read for front matter: the same text under a Markdown name is', () => {
    const text = '---\ntitle: Only Markdown reads this\n---\n<p>body</p>\n'
    expect(titled('page.html', text), 'a page with front matter and no <title>').toBe('page.html')
    expect(titled(NAME, text), 'the same bytes as a Markdown file').toBe('Only Markdown reads this')
  })

  it('a front matter title is cut at 200 characters, ending in an ellipsis, like any title found', () => {
    const long = 'a'.repeat(250)
    const got = titled(NAME, `---\ntitle: ${long}\n---\n`)
    expect(got).toHaveLength(200)
    expect(got).toBe(`${'a'.repeat(199)}…`)
    // ⚑ …and one that fits is whole.
    expect(titled(NAME, `---\ntitle: ${'a'.repeat(200)}\n---\n`)).toBe('a'.repeat(200))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the value
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('F046 · §2 · the value of `title:`', () => {
  it('a quoted value is unquoted and decoded, and quotes inside an unquoted value are kept as written', () => {
    expect(titled(NAME, '---\ntitle: "Hello"\n---\n# H\n'), 'double quotes').toBe('Hello')
    expect(
      titled(NAME, '---\ntitle: "Say \\"hi\\" \\\\ bye"\n---\n# H\n'),
      'an escaped quote and an escaped backslash in double quotes',
    ).toBe('Say "hi" \\ bye')
    expect(titled(NAME, "---\ntitle: 'it''s'\n---\n# H\n"), "a doubled '' in single quotes").toBe(
      "it's",
    )
    expect(
      titled(NAME, '---\ntitle: " padded "\n---\n# H\n'),
      'a quoted value is trimmed inside its quotes',
    ).toBe('padded')
    pair([
      {
        what: 'quotes inside an unquoted value are not stripped',
        negative: '---\ntitle: say "hi"\n---\n# H\n',
        notTitled: 'say "hi"',
        positive: '---\ntitle: "say hi"\n---\n# H\n',
        isTitled: 'say hi',
      },
      {
        what: 'an empty quoted value is no title',
        negative: '---\ntitle: ""\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: "x"\n---\n# H\n',
        isTitled: 'x',
      },
      {
        what: 'a quoted value of only spaces is no title',
        negative: "---\ntitle: '   '\n---\n# H\n",
        notTitled: 'H',
        positive: "---\ntitle: ' y '\n---\n# H\n",
        isTitled: 'y',
      },
    ])
  })

  it('a ` #` comment ends a value, quoted or not, and a `#` inside a word does not', () => {
    pair([
      {
        what: 'a comment after an unquoted value',
        negative: '---\ntitle: Plan # draft, retitle me\n---\n# H\n',
        notTitled: 'Plan',
        positive: '---\ntitle: Plan, draft\n---\n# H\n',
        isTitled: 'Plan, draft',
      },
      {
        what: 'a `#` with no space before it is part of the value',
        negative: '---\ntitle: Learn C #sharp\n---\n# H\n',
        notTitled: 'Learn C',
        positive: '---\ntitle: Learn C#sharp\n---\n# H\n',
        isTitled: 'Learn C#sharp',
      },
      {
        what: 'a URL fragment is not a comment',
        negative: '---\ntitle: see http://x #y\n---\n# H\n',
        notTitled: 'see http://x',
        positive: '---\ntitle: see http://x#y\n---\n# H\n',
        isTitled: 'see http://x#y',
      },
    ])
    expect(
      titled(NAME, '---\ntitle: "Hello" # c\n---\n# H\n'),
      'a comment after double quotes',
    ).toBe('Hello')
    expect(
      titled(NAME, "---\ntitle: 'it''s' # c\n---\n# H\n"),
      'a comment after single quotes',
    ).toBe("it's")
  })

  it('a value that is only a comment, or nothing, is no title, and the heading is', () => {
    pair([
      {
        what: 'a value that is only a comment',
        negative: '---\ntitle: # TODO\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: TODO\n---\n# H\n',
        isTitled: 'TODO',
      },
      {
        what: 'a key with no value',
        negative: '---\ntitle:\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: Something\n---\n# H\n',
        isTitled: 'Something',
      },
      {
        what: 'a key with only spaces after it',
        negative: '---\ntitle:    \n---\nno heading\n',
        notTitled: NAME,
        positive: '---\ntitle:    Spaced\n---\nno heading\n',
        isTitled: 'Spaced',
      },
    ])
  })

  it('a block scalar is not read, and `~` and `null` are no title, while values that only begin like them are', () => {
    pair([
      {
        what: 'a literal block scalar',
        negative: '---\ntitle: |\n  Multi\n  line\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: a | b\n---\n# H\n',
        isTitled: 'a | b',
      },
      {
        what: 'a folded block scalar',
        negative: '---\ntitle: >-\n  folded\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: a > b\n---\n# H\n',
        isTitled: 'a > b',
      },
      {
        what: 'YAML’s `~`',
        negative: '---\ntitle: ~\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: ~home\n---\n# H\n',
        isTitled: '~home',
      },
      {
        what: 'YAML’s `null`',
        negative: '---\ntitle: null\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: null and void\n---\n# H\n',
        isTitled: 'null and void',
      },
    ])
  })

  it('`title:` with no space or tab after it is not a key, and a tab is as good as a space', () => {
    pair([
      {
        what: '`title:foo`',
        negative: '---\ntitle:foo\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: foo\n---\n# H\n',
        isTitled: 'foo',
      },
    ])
    expect(titled(NAME, '---\ntitle:\tTabbed\n---\n# H\n'), 'a tab after the colon').toBe('Tabbed')
  })

  it('an indented `title:` under another key is not read; the same key at the top level is', () => {
    pair([
      {
        what: 'a nested title',
        negative: '---\nmeta:\n  title: Nested\n---\n# H\n',
        notTitled: 'H',
        positive: '---\nmeta:\n  sub: y\ntitle: Top\n---\n# H\n',
        isTitled: 'Top',
      },
      {
        what: 'a title one space in',
        negative: '---\nauthor: a\n title: Indented\n---\n# H\n',
        notTitled: 'H',
        positive: '---\nauthor: a\ntitle: Indented\n---\n# H\n',
        isTitled: 'Indented',
      },
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · what counts as front matter
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('F046 · §3 · what counts as front matter', () => {
  it('a horizontal rule followed by prose is not front matter: a `title:` line under it is not the title', () => {
    pair([
      {
        what: 'a rule, prose, then a body `title:` line',
        negative: '---\nThis file opens with a rule.\ntitle: In the body\n---\n# Real\n',
        notTitled: 'Real',
        positive: '---\ntitle: In the body\n---\n# Real\n',
        isTitled: 'In the body',
      },
    ])
  })

  it('a block of only keys, blanks and `# ` lines IS front matter — a `# ` line there is a YAML comment', () => {
    pair([
      {
        what: 'prose in place of the key makes the first `---` a rule, and `# Intro` the heading',
        negative: '---\n# Intro\n\nsome prose\n\n---\nbody\n',
        notTitled: 'Intro',
        positive: '---\n# Intro\n\ntitle: oops\n\n---\nbody\n',
        isTitled: 'oops',
      },
    ])
  })

  /**
   * 🔴 **F085 — a key may hold spaces.** `range checked: 551c81d5..d074f4c2` is a YAML key, and a
   * front matter with one was read as no front matter at all, so a file named by its `title:` was
   * titled by its first heading. ⚑ Each is paired with the line the guard still refuses in its place.
   */
  it('F085 · a key with a space, a quoted key and a colon inside a key are keys; prose, a list item and an unclosed quote are not', () => {
    pair([
      {
        what: 'a key with a space in it, against prose with no `: `',
        negative:
          '---\nThis file opens with a rule.\ntitle: Re-check of 8 UI-side findings\n---\n# Re-check: F001\n',
        notTitled: 'Re-check: F001',
        positive:
          '---\nrange checked: 551c81d5..d074f4c2\ntitle: Re-check of 8 UI-side findings\n---\n# Re-check: F001\n',
        isTitled: 'Re-check of 8 UI-side findings',
      },
      {
        what: 'a quoted key, against a quote that never closes',
        negative: '---\n"range checked\ntitle: Named\n---\n# Heading\n',
        notTitled: 'Heading',
        positive: '---\n"range checked": x\ntitle: Named\n---\n# Heading\n',
        isTitled: 'Named',
      },
      {
        what: 'a colon inside a key, against a list item',
        negative: '---\n- checked at 10:30: yes\ntitle: Named\n---\n# Heading\n',
        notTitled: 'Heading',
        positive: '---\nchecked at 10:30: yes\ntitle: Named\n---\n# Heading\n',
        isTitled: 'Named',
      },
      {
        what: 'a key, against a line whose colon has no space after it',
        negative: '---\nchecked:yes\ntitle: Named\n---\n# Heading\n',
        notTitled: 'Heading',
        positive: '---\nchecked: yes\ntitle: Named\n---\n# Heading\n',
        isTitled: 'Named',
      },
    ])
  })

  it('F085 · the guard is linear: a long line of spaces with no colon is refused at once', () => {
    const started = Date.now()
    expect(titled(NAME, `---\nx${' '.repeat(200_000)}\ntitle: Named\n---\n# Heading\n`)).toBe(
      'Heading',
    )
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('front matter opens on the first line only, and must be closed — by `---` or `...`', () => {
    pair([
      {
        what: 'an unclosed block',
        negative: '---\ntitle: Unclosed\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: Unclosed\n---\n# H\n',
        isTitled: 'Unclosed',
      },
      {
        what: 'a blank line before the first `---`',
        negative: '\n---\ntitle: Late\n---\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: Late\n---\n# H\n',
        isTitled: 'Late',
      },
      {
        what: 'closed by `...`',
        negative: '---\ntitle: Dotted\n..\n# H\n',
        notTitled: 'H',
        positive: '---\ntitle: Dotted\n...\n# H\n',
        isTitled: 'Dotted',
      },
    ])
  })

  it('any line ending reads the same, and a leading byte order mark hides no front matter', () => {
    expect(titled(NAME, '---\r\ntitle: Windows\r\n---\r\n# H\r\n'), 'CRLF').toBe('Windows')
    expect(titled(NAME, '---\ntitle: Windows\n---\n# H\n'), 'the same with LF').toBe('Windows')
    expect(titled(NAME, '---\rtitle: Old Mac\r---\r# H\r'), 'a lone CR').toBe('Old Mac')
    // ⚠️ CRLF must not leave a `\r` on the value, nor on the closing `---`.
    expect(titled(NAME, '---\r\ntitle: Clean\r\n---\r\n')).not.toContain('\r')
    const BOM = Buffer.from([0xef, 0xbb, 0xbf])
    expect(
      titled(NAME, Buffer.concat([BOM, Buffer.from('---\ntitle: Marked\n---\n# H\n')])),
      'front matter behind a byte order mark',
    ).toBe('Marked')
    expect(
      titled(NAME, Buffer.concat([BOM, Buffer.from('---\nauthor: a\n---\n# H\n')])),
      'title-less front matter behind a byte order mark',
    ).toBe('H')
  })

  it('a real file: a front matter title and a body that opens with a heading', () => {
    // ⚑ The file W1's check names: kept before F046 it was titled by its first heading.
    expect(
      titled(
        'recheck-runtime-2026-09-30.md',
        '---\ntitle: Re-check of 9 runtime findings\nauthor: ana\n---\n\n# Method\n\nrows\n',
      ),
    ).toBe('Re-check of 9 runtime findings')
    expect(
      titled('recheck-runtime-2026-09-30.md', '---\nauthor: ana\n---\n\n# Method\n\nrows\n'),
      'the same file with no title key',
    ).toBe('Method')
  })
})
