import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AssistantMessage from '../src/renderer/src/components/AssistantMessage.vue'
import UserMessage from '../src/renderer/src/components/UserMessage.vue'
import { renderChatMarkdown, renderMarkdown } from '../src/renderer/src/lib/markdown'

/**
 * Assistant replies render as Markdown (Slice 2 · 017) — through the SAME `lib/markdown.ts` the
 * document viewer uses, so there is exactly one markdown stack and one sanitization story. The
 * Growing and settled replies use the same renderer: fences become code blocks and lists become
 * lists. Author HTML remains disabled in both states.
 */

const render = (item: Record<string, unknown>, who = 'Codex'): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(AssistantMessage as never, { item, who }) }))

const settled = (text: string): Record<string, unknown> => ({
  kind: 'assistant',
  id: 'assistant_1',
  text,
  streaming: false,
  at: 1_750_000_000_000,
})

describe('a settled reply is rendered markdown', () => {
  const reply = [
    'Here is **the plan**:',
    '',
    '```ts',
    'const x = 1',
    '```',
    '',
    '- first item',
    '- second item',
    '',
    'See https://example.com for more.',
  ].join('\n')

  it('a fence is a code block, not literal backticks', async () => {
    const html = await render(settled(reply))
    expect(html).toContain('<pre>')
    expect(html).toContain('const x = 1')
    expect(html).not.toContain('```')
  })

  it('a list is a list, bold is bold, and a bare URL is a link', async () => {
    const html = await render(settled(reply))
    expect(html).toContain('<li>first item</li>')
    expect(html).toContain('<strong>the plan</strong>')
    expect(html).toContain('<a href="https://example.com"')
    expect(html).not.toContain('**')
  })

  it('the markdown lives inside the message body, which stays addressable and timed', async () => {
    const html = await render(settled(reply))
    expect(html).toContain('data-cy="assistant-message"')
    expect(html).toContain('data-cy="assistant-markdown"')
    expect(html).toMatch(/data-streaming="false"/)
    // 001: the clock is an attribute, never part of the copyable body.
    expect(html).toMatch(/data-at="[^"]+"/)
  })
})

describe('nothing in a reply becomes markup', () => {
  it('a <script> in a reply is text, not a script', async () => {
    const html = await render(settled('run this: <script>alert(1)</script>'))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('a javascript: link never renders as a link', async () => {
    const html = await render(settled('[click me](javascript:alert(1))'))
    expect(html).not.toContain('href="javascript:')
  })
})

describe('the chat preset is tuned for what an agent writes', () => {
  it('keeps sentence punctuation beside inline code without adding it to the code', () => {
    expect(renderChatMarkdown('Read `summary.md`. Then continue.')).toBe(
      '<p>Read <span class="md-code-punctuation"><code>summary.md</code>.</span> Then continue.</p>\n',
    )
    expect(renderChatMarkdown('Use `value`?!')).toContain('<code>value</code>?!</span>')
    expect(renderChatMarkdown('Use `value`.member')).not.toContain('md-code-punctuation')
    expect(renderChatMarkdown('```sh\nprintf sample\n```')).not.toContain('md-code-punctuation')
  })

  it('keeps a plain lead in the first paragraph without parsing it as markdown or HTML', () => {
    expect(renderChatMarkdown('The customer is in **Germany**.', 'Added:')).toBe(
      '<p><span class="md-lead">Added:</span> The customer is in <strong>Germany</strong>.</p>\n',
    )
    expect(renderChatMarkdown('A note.', '<img src=x> **label**')).toBe(
      '<p><span class="md-lead">&lt;img src=x&gt; **label**</span> A note.</p>\n',
    )
  })

  it('keeps leading blocks and link definitions intact beside a plain lead', () => {
    for (const source of ['# Heading', '```sh\nprintf sample\n```', '- First\n- Second']) {
      expect(renderChatMarkdown(source, 'Added:')).toBe(
        '<p><span class="md-lead">Added:</span></p>\n' + renderChatMarkdown(source),
      )
    }
    expect(
      renderChatMarkdown('[draft]: https://example.test\n\nRead [draft].', 'Added:'),
    ).toContain('<p><span class="md-lead">Added:</span> Read <a href="https://example.test"')
  })

  it('a single newline is a line break — a settled reply keeps the shape it streamed with', () => {
    // Without this, a three-line file list collapses into one run-on line the instant the
    // authoritative message lands, reflowing text the reader has already started reading.
    expect(renderChatMarkdown('Wrote these files:\nsrc/a.ts\nsrc/b.ts')).toContain('<br>')
    // The document preset deliberately does NOT do this: prose on paper reflows.
    expect(renderMarkdown('one\ntwo')).not.toContain('<br>')
  })

  it('a filename is not a URL — README.md and deploy.sh stay text', () => {
    // linkify-it's fuzzy mode reads `.md` (Moldova) and `.sh` (St. Helena) as ccTLDs, so every
    // filename an agent named became a link to a bogus host — and a click target.
    const html = renderChatMarkdown('I updated MEMORY.md and README.md, plus utils.sh')
    expect(html).not.toContain('<a')
    expect(html).toContain('README.md')
  })

  it('a real URL is still a link', () => {
    expect(renderChatMarkdown('docs at https://example.com/x')).toContain(
      '<a href="https://example.com/x"',
    )
  })

  it('a Windows path keeps the backslashes an escape would only remove', () => {
    for (const path of [
      'C:\\lane\\home\\AppData\\Roaming\\@brobot2\\desktop\\provider-homes\\default\\brobot',
      'D:\\work\\@team\\#1\\$data\\~tmp\\!draft\\(old)\\report.md',
      'C:\\Program Files (x86)\\@team\\#1.txt',
      '\\\\server\\share\\@team\\plan.md',
      '…\\@brobot2\\desktop\\brobot-workspace',
    ])
      expect(renderChatMarkdown(`It replied ${path} just now.`)).toBe(
        `<p>It replied ${path} just now.</p>\n`,
      )
  })

  it('keeps a backslash before punctuation markdown does not read inside a line', () => {
    for (const mark of "@$%,;^{}('/?#-+.)=!~")
      expect(renderChatMarkdown(`a\\${mark}b`)).toBe(`<p>a\\${mark}b</p>\n`)
    expect(renderChatMarkdown('a\\>b and a\\"b')).toBe('<p>a\\&gt;b and a\\&quot;b</p>\n')
  })

  it('markdown around a path still applies', () => {
    expect(renderChatMarkdown('**C:\\a\\@b** and _D:\\c\\d_')).toBe(
      '<p><strong>C:\\a\\@b</strong> and <em>D:\\c\\d</em></p>\n',
    )
    expect(renderChatMarkdown('C:\\dir,[guide](https://example.com)')).toBe(
      '<p>C:\\dir,<a href="https://example.com" title="https://example.com">guide</a></p>\n',
    )
  })

  it('an escape that changes something is still an escape', () => {
    expect(renderChatMarkdown('\\*not bold\\* and snake\\_case, literal\\\\alpha')).toBe(
      '<p>*not bold* and snake_case, literal\\alpha</p>\n',
    )
    expect(renderChatMarkdown('C:\\dir snake\\_case')).toBe('<p>C:\\dir snake_case</p>\n')
    expect(renderChatMarkdown('`C:\\dir`\\_suffix')).toBe('<p><code>C:\\dir</code>_suffix</p>\n')
    expect(renderChatMarkdown('\\![a](https://e.com)')).toBe(
      '<p>!<a href="https://e.com" title="https://e.com">a</a></p>\n',
    )
    const link = renderChatMarkdown('[a\\]b](C:\\dir\\report.md)')
    expect(link).toContain('data-local-path="C:\\dir\\report.md"')
    expect(link).toContain('>a]b</a>')
  })

  it('a kept backslash changes nothing else: link text and automatic links read as before', () => {
    expect(renderChatMarkdown('[literal \\\\alpha](C:\\dir\\report.md)')).toContain(
      '>literal \\alpha</a>',
    )
    const beforeALink = renderChatMarkdown('\\\\[guide](C:\\dir\\report.md)')
    expect(beforeALink.startsWith('<p>\\<!--local-file:')).toBe(true)
    expect(beforeALink).toContain('>guide</a>')
    expect(renderChatMarkdown('\\\\`C:\\dir`')).toBe('<p>\\<code>C:\\dir</code></p>\n')
    expect(renderChatMarkdown('\\@mailto:alice@example.com')).toBe(
      '<p>\\@mailto:alice@example.com</p>\n',
    )
  })

  it('at the start of a line, an escape still stops a heading, list, quote or rule', () => {
    expect(renderChatMarkdown('\\# not a heading')).toBe('<p># not a heading</p>\n')
    expect(renderChatMarkdown('1\\. not a list')).toBe('<p>1. not a list</p>\n')
    expect(renderChatMarkdown('2\\) not a list')).toBe('<p>2) not a list</p>\n')
    expect(renderChatMarkdown('\\- not a list')).toBe('<p>- not a list</p>\n')
    expect(renderChatMarkdown('\\+ not a list')).toBe('<p>+ not a list</p>\n')
    expect(renderChatMarkdown('\\> not a quote')).toBe('<p>&gt; not a quote</p>\n')
    expect(renderChatMarkdown('text\n\\=== not a rule')).toBe('<p>text<br>\n=== not a rule</p>\n')
  })
})

describe('the user’s own message is never rendered (017 keeps it plain)', () => {
  it('markdown a user typed is shown as the characters they typed', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(UserMessage as never, {
            item: {
              kind: 'user',
              id: 'user_1',
              text: 'run **this**: `ls -la`',
              at: 1_750_000_000_000,
            },
          }),
      }),
    )
    expect(html).not.toContain('<strong>')
    expect(html).not.toContain('<code>')
    expect(html).toContain('**this**')
  })
})

describe('a streaming reply uses the shared formatter while it grows', () => {
  const streaming = {
    kind: 'assistant',
    id: 'assistant_1',
    text: 'so far:\n```ts\nconst half = ',
    streaming: true,
  }

  it('a half-open fence uses the same code block rendering as a settled reply', async () => {
    const html = await render(streaming)
    expect(html).toContain(renderChatMarkdown(streaming.text).trimEnd())
    expect(html).toContain('<pre><code class="language-ts">const half = </code></pre>')
  })

  it('the live tag and the caret still mark the block as growing (005)', async () => {
    const html = await render(streaming)
    expect(html).toContain('data-cy="streaming-tag"')
    expect(html).toContain('stream-caret')
    expect(html).toMatch(/data-streaming="true"/)
  })
})
