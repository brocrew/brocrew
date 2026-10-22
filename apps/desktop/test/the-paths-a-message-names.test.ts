import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveMessagePaths, THIS_COMPUTER } from '../src/main/message-paths'
import { renderChatMarkdown } from '../src/renderer/src/lib/markdown'
import { answerFor, fileManagerWord, pressFailedWords } from '../src/renderer/src/lib/message-paths'
import type { MessagePath } from '../src/shared/runtime-ipc'
import {
  markPathsIn,
  pathIn,
  pathsNamedIn,
} from '../src/renderer/src/lib/the-paths-a-message-names'

/**
 * Which text in a message is asked about as a path, and what a found one becomes.
 *
 * The finder only decides what is worth asking main about; main decides what exists. So a false
 * candidate costs one answer of `found: false`, and a missed one leaves a path plain. Each rule
 * below is paired with the case one fact over that it must not take or must take.
 */

const named = (markdown: string): string[] => pathsNamedIn(renderChatMarkdown(markdown))

const FOUND = (text: string, over: Partial<MessagePath> = {}): MessagePath =>
  ({
    text,
    found: true,
    absolute: `/Users/someone/work/${text.replace(/^\.?\//, '')}`,
    name: text.split('/').filter(Boolean).at(-1) ?? text,
    kind: 'file',
    opens: true,
    ...over,
  }) as MessagePath

const MAC = { canOpen: true, fileManager: 'Finder' }
const SPACED = '/Users/fictional/Library/Application Support/BroBot/my report.md'

describe('the candidates a message names', () => {
  it('keeps full Mac and Windows names with spaces in prose and inline code', () => {
    for (const text of [`See ${SPACED} for details.`, `See \`${SPACED}\` for details.`]) {
      expect(named(text)).toContain(SPACED)
      expect(named(text)[0]).toBe(SPACED)
    }
    const windows = 'C:\\Users\\First Last\\Documents\\my report.md'
    expect(named(`Open \`${windows}\``)[0]).toBe(windows)
    expect(named(`Open ${windows} for details.`)[0]).toBe(windows)
    expect(named('See reports/my report.md for details.')).toContain('reports/my report.md')
  })

  it('keeps both paths on one line and bounds expansions without losing later document candidates', () => {
    const second = '/Users/fictional/Other Folder/second.md'
    const candidates = named(`See ${SPACED} and ${second} for details.`)
    expect(candidates).toContain(SPACED)
    expect(candidates).toContain(second)
    const many = Array.from({ length: 60 }, (_, i) => `/tmp/Some Folder/report${i}.md`).join('\n')
    expect(named(many)).toHaveLength(50)
    expect(named(many).every((path) => path.length <= 1024)).toBe(true)
    const long = `/tmp/${Array.from({ length: 150 }, () => 'word').join(' ')}`
    expect(named(long).length).toBeLessThanOrEqual(8)
  })

  it('keeps a complete file ending beyond eight spaces and leaves large ordinary prose untouched', () => {
    const path = `/tmp/${Array.from({ length: 14 }, () => 'folder').join(' ')}/my report.md`
    expect(named(`See ${path} for details.`)).toContain(path)
    const prose = 'ordinary words '.repeat(30_000)
    expect(pathsNamedIn(`<p>${prose}</p>`)).toEqual([])
    let checks = 0
    expect(
      markPathsIn(
        `<p>${prose}</p>`,
        () => {
          checks += 1
          return undefined
        },
        MAC,
      ),
    ).toBe(`<p>${prose}</p>`)
    expect(checks).toBe(0)
  })

  it('bounds expansion and marking across duplicate runs and preserves text after exhaustion', () => {
    const source = '<p>/tmp/one.md</p>'.repeat(3000) + '<p>/tmp/after.md</p>'
    expect(pathsNamedIn(source)).toEqual(['/tmp/one.md'])
    let checks = 0
    const out = markPathsIn(
      source,
      (path) => {
        checks += 1
        return FOUND(path)
      },
      MAC,
    )
    expect(checks).toBeLessThanOrEqual(50 * 8)
    expect(out.match(/data-cy="message-path"/g)).toHaveLength(50)
    expect(out.endsWith('<p>/tmp/after.md</p>')).toBe(true)
    expect(out).toContain('<p>/tmp/one.md</p>')
  })

  it('retains the first complete long path through later filename prose and preferred eviction', () => {
    const path = '/tmp/one two three four five six seven eight/report.md'
    for (const after of [
      ' and README.md.',
      ` and ${Array.from({ length: 20 }, (_, i) => `README${i}.md`).join(' ')}.`,
    ]) {
      const source = renderChatMarkdown(`See ${path}${after}`)
      expect(pathsNamedIn(source)).toContain(path)
      const out = markPathsIn(
        source,
        (candidate) => (candidate === path ? FOUND(path) : undefined),
        MAC,
      )
      expect(out.match(/data-cy="message-path"/g)).toHaveLength(1)
      expect(out).toContain(`>${path}</span>`)
      expect(out).toContain(`</span>${after}</p>`)
      expect(pathsNamedIn(source).length).toBeLessThanOrEqual(50)
    }
  })
  it('takes an absolute path, a home path and a relative path with an extension', () => {
    expect(named('It is in /Users/someone/work/notes.md now.')[0]).toBe(
      '/Users/someone/work/notes.md',
    )
    expect(named('See ~/projects/plan.txt')).toEqual(['~/projects/plan.txt'])
    expect(named('the message is in projects/garden-planner/reports/x.md')).toEqual([
      'projects/garden-planner/reports/x.md',
    ])
  })

  it('takes a relative path that starts with ./ or ../, or ends in a slash', () => {
    expect(named('Look in ./a/b and ../c.txt and src/')).toEqual(
      expect.arrayContaining(['./a/b', '../c.txt', 'src/']),
    )
    // One fact over: the same last segment with no ./ and no extension is a plain word pair.
    expect(named('Look in a/b')).toEqual([])
  })

  it('takes a Windows drive path, and none of the forms main never resolves', () => {
    expect(named('Open `C:\\Users\\someone\\notes.md` or C:/work/plan.md')).toEqual([
      'C:\\Users\\someone\\notes.md',
      'C:/work/plan.md',
    ])
    // A share, a device path, `//`, a drive-relative path and a stream are never asked about.
    expect(named('On the share: `\\\\server\\share\\report.docx`')).toEqual([])
    expect(named('`\\\\?\\C:\\work\\plan.md` and `\\\\.\\C:\\work\\plan.md`')).toEqual([])
    expect(named('`//server/share/plan.md`')).toEqual([])
    expect(named('`C:work/plan.md` and `docs/plan.md:Zone.Identifier`')).toEqual([])
  })

  it('leaves trailing sentence punctuation, quotes and brackets outside the path', () => {
    expect(named('Read src/app.ts.')).toEqual(['src/app.ts'])
    expect(named('Read src/app.ts, then src/b.ts; then src/c.ts: done')).toEqual([
      'src/app.ts',
      'src/b.ts',
      'src/c.ts',
    ])
    expect(named('(see src/app.ts)')).toEqual(['src/app.ts'])
    expect(named('"src/app.ts" and \'src/b.ts\'')).toEqual(['src/app.ts', 'src/b.ts'])
    expect(named('Is it src/app.ts?')).toEqual(['src/app.ts'])
    // A line number after a file is not part of its name.
    expect(named('Broken at src/app.ts:42.')).toEqual(['src/app.ts'])
    expect(pathIn('src/app.ts:42:7.')).toEqual({ path: 'src/app.ts', tail: ':42:7.' })
  })

  it('does not take a URL, an email, a host:path or a bare file name', () => {
    expect(named('Go to https://example.com/docs/a.md')).toEqual([])
    expect(named('Go to `https://example.com/docs/a.md`')).toEqual([])
    expect(named('Write to someone@example.com')).toEqual([])
    expect(named('Clone `git@example.com:org/repo.git`')).toEqual([])
    expect(named('Read README.md first')).toEqual([])
    expect(named('Read `README.md` first')).toEqual([])
    expect(named('Match `src/**/*.ts`')).toEqual([])
    expect(named('and/or, TCP/IP, 1/2')).toEqual([])
    // One fact over: the bare name under a folder is taken.
    expect(named('Read docs/README.md first')).toEqual(['docs/README.md'])
  })

  it('looks inside inline code, and not inside a fenced block or a link', () => {
    expect(named('Open `projects/x/report.md`')).toEqual(['projects/x/report.md'])
    expect(named('```\ncat projects/x/report.md\n```')).toEqual([])
    expect(named('[the report](https://example.com/projects/x/report.md)')).toEqual([])
    // One fact over: the same text beside the fence is taken.
    expect(named('```\nls\n```\nthen projects/x/report.md')).toEqual(['projects/x/report.md'])
  })

  it('names each text once and asks about fifty at most', () => {
    expect(named('src/a.ts and src/a.ts')).toEqual(['src/a.ts'])
    const many = Array.from({ length: 60 }, (_, at) => `src/f${at}.ts`).join(' ')
    expect(named(many)).toHaveLength(50)
    // A text longer than main reads is not asked about; one at the bound is.
    expect(named(`src/${'a'.repeat(1018)}.ts`)).toHaveLength(0)
    expect(named(`src/${'a'.repeat(1017)}.ts`)).toHaveLength(1)
  })

  it('takes local link destinations within the same fifty-path limit, never their labels', () => {
    const many = Array.from({ length: 100 }, (_, at) => `[label${at}.pdf](reports/f${at}.md)`).join(
      ' ',
    )
    expect(named(many)).toEqual(Array.from({ length: 50 }, (_, at) => `reports/f${at}.md`))
    expect(named('[docs/private.md](https://example.com/elsewhere)')).toEqual([])
    expect(named('[x](javascript:alert(1))')).toEqual([])
  })

  it('takes explicit basenames without treating bare words or fragment links as files', () => {
    expect(named('[report](report.md) [other](x)')).toEqual(['report.md', 'x'])
    expect(named('report.md x [anchor](#part) [empty]() [mail](mailto:x@example.com)')).toEqual([])
  })

  it('renders a refused image inside a local label without nested anchors', () => {
    const source = renderChatMarkdown('[![badge](https://example.com/badge.png)](report.md)')
    expect(source.match(/<a\b/g)).toHaveLength(1)
    expect(source).toContain('<span class="refused-image">')
    expect(pathsNamedIn(source)).toEqual(['report.md'])
    const standalone = renderChatMarkdown('![badge](https://example.com/badge.png)')
    expect(standalone).toContain('<a href="https://example.com/badge.png" class="refused-image">')
  })
})

describe('marking what main found', () => {
  const html = renderChatMarkdown('Read projects/x/report.md and gone/missing.md.')

  it('marks the longest confirmed spaced prefix and leaves following words and a second path intact', () => {
    const second = '/tmp/Second Folder/second.md'
    const text = `See ${SPACED} for details and ${second} next.`
    const source = renderChatMarkdown(text)
    const answers = new Map([SPACED, second].map((path) => [path, FOUND(path)]))
    const out = markPathsIn(source, (path) => answers.get(path), MAC)
    expect(out.match(/data-cy="message-path"/g)).toHaveLength(2)
    expect(out).toContain(`>${SPACED}</span>`)
    expect(out).toContain('</span> for details and ')
    expect(out).toContain('</span> next.</p>')
    const code = markPathsIn(renderChatMarkdown(`\`${SPACED}\``), (path) => answers.get(path), MAC)
    expect(code).toContain(`<code><span class="message-path"`)
    expect(code).toContain(`>${SPACED}</span>`)
  })

  it('resolves synthetic spaced paths through the unchanged asynchronous main resolver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brobot-spaced-paths-'))
    try {
      const folder = join(root, 'Application Support', 'Project Files')
      await mkdir(folder, { recursive: true })
      const path = join(folder, 'my report.md')
      await writeFile(path, 'fictional fixture')
      // This prefix exists, but it must not become a partial link for a missing document.
      await mkdir(join(root, 'missing'))
      for (const text of [`See ${path} for details.`, `See \`${path}\` for details.`]) {
        const source = renderChatMarkdown(text)
        const asks = pathsNamedIn(source)
        const answers = new Map(
          (await resolveMessagePaths(asks, root, THIS_COMPUTER, { mayOpen: true })).map(
            (answer) => [answer.text, answer],
          ),
        )
        const out = markPathsIn(source, (candidate) => answers.get(candidate), MAC)
        expect(out.match(/data-cy="message-path"/g)).toHaveLength(1)
        expect(out).toContain(`>${path}</span>`)
        expect(out).toContain(' for details.')
        expect(asks.length).toBeLessThanOrEqual(50)
      }
      const missing = renderChatMarkdown(`See ${join(root, 'missing report.md')} for details.`)
      const answers = new Map(
        (
          await resolveMessagePaths(pathsNamedIn(missing), root, THIS_COMPUTER, { mayOpen: true })
        ).map((answer) => [answer.text, answer]),
      )
      expect(markPathsIn(missing, (path) => answers.get(path), MAC)).toBe(missing)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('marks only a text main said it found, with the full path in its hover', () => {
    const answers = new Map<string, MessagePath>([
      ['projects/x/report.md', FOUND('projects/x/report.md')],
      ['gone/missing.md', { text: 'gone/missing.md', found: false }],
    ])
    const out = markPathsIn(html, (text) => answers.get(text), MAC)
    expect(out).toContain('data-message-path="projects/x/report.md"')
    expect(out).toContain('title="/Users/someone/work/projects/x/report.md"')
    expect(out).toContain('aria-label="Open file"')
    expect(out).toContain('data-message-path-copy="projects/x/report.md"')
    expect(out).toContain('aria-label="Copy path"')
    expect(out).not.toContain('data-message-path="gone/missing.md"')
    // The full stop after the missing path is where it was.
    expect(out).toContain('gone/missing.md.</p>')
  })

  it('returns the HTML unchanged while main has not answered', () => {
    expect(markPathsIn(html, () => undefined, MAC)).toBe(html)
  })

  it('draws a link to a file as path text, never a link, before and without an answer', () => {
    const source = renderChatMarkdown('See [/tmp/report.md](/tmp/report.md).')
    expect(source).not.toContain('href=')
    const pending = markPathsIn(source, () => undefined, MAC)
    expect(pending).not.toContain('<a')
    expect(pending).toContain('<span class="message-path-text" data-cy="message-path-text"')
    expect(pending).toContain('>/tmp/report.md</span>')
    expect(pending).not.toContain('<button')
    // A web link is still a link.
    expect(renderChatMarkdown('[site](https://example.com/a)')).toContain(
      'href="https://example.com/a"',
    )
  })

  it('names a path main will only show as Show, in the words of the platform', () => {
    const shown = FOUND('bin/run.command', { opens: false })
    const out = markPathsIn(renderChatMarkdown('Run bin/run.command'), () => shown, {
      canOpen: true,
      fileManager: 'Explorer',
    })
    expect(out).toContain('aria-label="Show in Explorer"')
    expect(out).not.toContain('aria-label="Open')
  })

  it('names Open "Show in" the file manager where the window may not open, and keeps Copy', () => {
    const out = markPathsIn(html, () => FOUND('projects/x/report.md'), {
      canOpen: false,
      fileManager: 'Finder',
    })
    expect(out).toContain('aria-label="Show in Finder"')
    expect(out).toContain('aria-label="Copy path"')
    expect(out).not.toContain('aria-label="Open')
  })

  it('draws a picture on this computer as its path with Copy and Open, never a link or an image', () => {
    const path = '/tmp/report.png'
    const source = renderChatMarkdown(
      `See ![screenshot](${path}) and ![badge](https://example.com/b.png).`,
    )
    expect(source).not.toContain('<img')
    expect(source).not.toContain(`href="${path}"`)
    expect(source).toContain('<a href="https://example.com/b.png" class="refused-image">')
    expect(pathsNamedIn(source)).toEqual([path])
    const out = markPathsIn(source, () => FOUND(path, { absolute: path }), MAC)
    expect(out).toContain('<span class="message-path-label">screenshot</span>')
    expect(out).toContain(`>${path}</span>`)
    expect(out).toContain(`data-message-path-copy="${path}"`)
    expect(out).toContain(`data-message-path="${path}"`)
    expect(out).not.toContain(`href="${path}"`)
    const inside = renderChatMarkdown(`[![screenshot](${path})](https://example.com/a)`)
    expect(inside).not.toContain(`href="${path}"`)
    expect(inside.match(/<a\b/g)).toHaveLength(1)
  })

  it('draws a Windows link destination for Copy with its backslashes, never %5C', () => {
    const path = 'C:\\Users\\someone\\out\\app.apk'
    const out = markPathsIn(
      renderChatMarkdown(`See [the app](${path}).`),
      () => FOUND(path, { absolute: path }),
      MAC,
    )
    expect(out).toContain(`data-message-path-copy="${path}"`)
    expect(out).not.toContain('%5C')
  })

  it('draws a network share with Copy and an Open that is off and says why, without asking main', () => {
    const path = '\\\\server\\share\\report.md'
    const source = renderChatMarkdown(`See [the report](<${path}>).`)
    expect(pathsNamedIn(source)).toEqual([])
    const out = markPathsIn(source, () => undefined, MAC)
    expect(out).toContain(`data-message-path-copy="${path}"`)
    expect(out).toContain('aria-disabled="true" title="Network paths can\'t be opened here."')
    expect(out).not.toContain('data-message-path=')
    expect(out).not.toContain('<a ')
  })

  it('escapes what main said before it reaches the markup', () => {
    const hostile = FOUND('projects/x/report.md', {
      absolute: '/tmp/"><img src=x onerror=alert(1)>',
      name: '<b>report</b>',
    })
    const out = markPathsIn(html, () => hostile, MAC)
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<b>')
    expect(out).toContain('&quot;&gt;&lt;img')
  })

  it('leaves a path in a fenced block or a link alone even when main found it', () => {
    const fenced = renderChatMarkdown('```\nprojects/x/report.md\n```')
    expect(markPathsIn(fenced, () => FOUND('projects/x/report.md'), MAC)).toBe(fenced)
    const linked = renderChatMarkdown('[projects/x/report.md](https://example.com/a)')
    expect(markPathsIn(linked, () => FOUND('projects/x/report.md'), MAC)).toBe(linked)
  })
})

describe('what the window reads off main', () => {
  it('keeps an answer only for the text it was asked about', () => {
    expect(answerFor('a/b.md', FOUND('a/b.md')).found).toBe(true)
    expect(answerFor('a/b.md', FOUND('other.md')).found).toBe(false)
    expect(answerFor('a/b.md', undefined).found).toBe(false)
  })

  it('names the file manager from the platform', () => {
    expect(fileManagerWord('MacIntel')).toBe('Finder')
    expect(fileManagerWord('Win32')).toBe('Explorer')
    expect(fileManagerWord('Linux x86_64')).toBe('your file manager')
  })

  it('says what happened and what to do when a press did not work', () => {
    expect(pressFailedWords('gone', 'file', 'Finder', 'open')).toBe(
      "That file isn't there any more. Ask the agent where it is now.",
    )
    expect(pressFailedWords('failed', 'file', 'Finder', 'open')).toBe(
      "That file didn't open. Copy its path and open it from Finder.",
    )
    expect(pressFailedWords('failed', 'folder', 'your file manager', 'show')).toBe(
      "Your file manager didn't show that folder. Try again.",
    )
  })
})
