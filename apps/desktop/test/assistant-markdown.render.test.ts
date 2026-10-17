import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AssistantMessage from '../src/renderer/src/components/AssistantMessage.vue'
import UserMessage from '../src/renderer/src/components/UserMessage.vue'
import { renderChatMarkdown, renderMarkdown } from '../src/renderer/src/lib/markdown'

/**
 * Assistant replies render as Markdown (Slice 2 · 017) — through the SAME `lib/markdown.ts` the
 * document viewer uses, so there is exactly one markdown stack and one sanitization story. The
 * contract under test: a settled reply is rendered (fences become code blocks, lists become
 * lists), a STREAMING reply stays plain text (deltas end mid-syntax, and plain text never lies
 * about unfinished markdown), and nothing in a reply can smuggle markup past `html:false`.
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

describe('a streaming reply stays plain until it settles', () => {
  const streaming = {
    kind: 'assistant',
    id: 'assistant_1',
    text: 'so far:\n```ts\nconst half = ',
    streaming: true,
  }

  it('a half-open fence is shown verbatim — no block-level re-rendering mid-stream', async () => {
    const html = await render(streaming)
    expect(html).not.toContain('<pre>')
    expect(html).toContain('```ts')
  })

  it('the live tag and the caret still mark the block as growing (005)', async () => {
    const html = await render(streaming)
    expect(html).toContain('data-cy="streaming-tag"')
    expect(html).toContain('stream-caret')
    expect(html).toMatch(/data-streaming="true"/)
  })
})
