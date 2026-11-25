import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import type { MessagePathAsk, MessagePathTarget } from '../../src/shared/runtime-ipc'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { wearTheme } from '../../look/fixtures/themes'
import MarkdownWords from '../../src/renderer/src/components/MarkdownWords.vue'
import { aWaitingPageWithMarkdown, LITERAL_COMMAND } from './a-waiting-page-with-markdown'
import { mount, unmountAll } from './harness'
import { drawnReady, inkRects } from './drawn'

const original = { width: window.innerWidth, height: window.innerHeight }
afterEach(() => {
  unmountAll()
  usePersonsQueue().forget()
  applyTheme(null)
  delete (window as { api?: unknown }).api
})
afterAll(async () => {
  await page.viewport(original.width, original.height)
})

describe.each(['classic', 'crew-night'] as const)('Waiting on you markdown in %s', (theme) => {
  it('keeps the added note punctuation with its filename and outside its code text', async () => {
    if (theme === 'crew-night') wearTheme(theme)
    const m = await aWaitingPageWithMarkdown()
    const provider = m.q('persons-queue-asked-sess_glint:req_provider')
    provider.querySelector<HTMLButtonElement>('[data-cy="question-more"]')!.click()
    await nextTick()
    const context = provider.querySelector('[data-cy="question-context"]')!
    const code = context.querySelector('code')!
    const group = code.parentElement!
    expect(code.textContent).toBe('summary.md')
    expect(group.textContent).toBe('summary.md.')
    expect(group.lastChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(group.lastChild?.textContent).toBe('.')
    expect(getComputedStyle(group).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(group).fontFamily).toBe(getComputedStyle(code).fontFamily)
    await drawnReady()
    const punctuation = inkRects(group.lastChild as Text)
    expect(punctuation).toHaveLength(1)
    expect(punctuation[0]!.top).toBeLessThan(code.getBoundingClientRect().bottom)
    expect(context.textContent).toBe('Added: Added after review: read summary.md.')
    const filename = 'long-name-'.repeat(80) + 'summary.md'
    const narrow = mount(MarkdownWords, { text: `Read \`${filename}\`.` }, { width: 180 })
    expect(narrow.host.querySelector('code')?.textContent).toBe(filename)
    expect(narrow.host.textContent).toBe(`Read ${filename}.`)
    expect(narrow.host.scrollWidth).toBeLessThanOrEqual(narrow.host.clientWidth)
  })

  it('renders question words, added notes, part prompts, disclosed requests and to-dos', async () => {
    await page.viewport(1180, 1000)
    if (theme === 'crew-night') wearTheme(theme)
    const m = await aWaitingPageWithMarkdown()
    for (const button of m.all('question-more')) button.click()
    await nextTick()
    for (const selector of [
      '[data-cy="question-words"]',
      '[data-cy="persons-queue-asked-sess_glint:req_provider"] [data-cy="question-words"]',
    ]) {
      const words = m.host.querySelector(selector)!
      expect(words.querySelector('strong')?.textContent).toBe('Choose a draft')
      expect(words.querySelectorAll('ul > li')).toHaveLength(2)
      expect(words.querySelector('code')?.textContent).toBe('notes.md')
      expect(words.querySelector('a')?.getAttribute('href')).toBe('https://example.test/preview')
      expect(words.textContent).toContain('/work/sample/notes.md')
      expect(words.textContent).not.toContain('**')
    }
    const contexts = m.all('question-context')
    expect(contexts).toHaveLength(2)
    for (const context of contexts) {
      expect(context.textContent).toContain('Added:')
      expect(context.querySelector('strong')?.textContent).toBe('after review')
    }
    expect(m.host.querySelector('.ask .md-chat strong')?.textContent).toBe('the short draft')
    expect(
      m.host.querySelector('[data-cy="persons-queue-asked-part"] .md-chat strong')?.textContent,
    ).toBe('the short draft')
    m.q('waiting-pill-approvals').click()
    await nextTick()
    expect(m.host.querySelector('[data-cy="permission-action"] strong')?.textContent).toBe(
      'Run the preview check',
    )
    m.q('waiting-pill-todo').click()
    await nextTick()
    expect(m.host.querySelector('.todo-lead strong')?.textContent).toBe('Check the preview')
    expect(m.host.querySelectorAll('.todo-text li')).toHaveLength(2)
  })

  it('keeps approval commands literal, including markdown punctuation', async () => {
    if (theme === 'crew-night') wearTheme(theme)
    const m = await aWaitingPageWithMarkdown()
    m.q('waiting-pill-approvals').click()
    await nextTick()
    const command = m.host.querySelector('[data-cy="permission-detail"]')!
    expect(command.textContent).toBe(LITERAL_COMMAND)
    expect(command.querySelector('strong, a, .md-chat')).toBeNull()
  })

  it('resolves and opens found paths in the asking conversation', async () => {
    const opens: MessagePathTarget[] = []
    ;(window as unknown as { api: unknown }).api = {
      runtime: {
        resolveMessagePaths: async (ask: MessagePathAsk) =>
          ask.texts.map((text) => ({
            text,
            found: true,
            absolute: text,
            name: 'notes.md',
            kind: 'file',
            opens: true,
          })),
        openMessagePath: async (target: MessagePathTarget) => {
          opens.push(target)
          return { ok: true, did: 'opened' }
        },
        revealMessagePath: async () => ({ ok: true }),
      },
    }
    if (theme === 'crew-night') wearTheme(theme)
    const m = await aWaitingPageWithMarkdown()
    m.q('question-more').click()
    await nextTick()
    await expect
      .poll(() => m.host.querySelectorAll('[aria-label="Open file"]').length)
      .toBeGreaterThan(0)
    const opensIn = async (selector: string): Promise<void> => {
      const words = m.host.querySelector(selector)!
      const open = words.querySelector<HTMLButtonElement>('[aria-label="Open file"]')!
      expect(open, selector).not.toBeNull()
      expect(words.querySelector('[aria-label="Copy path"]')).not.toBeNull()
      open.click()
      await nextTick()
    }
    for (const selector of [
      '[data-cy="question-words"]',
      '[data-cy="persons-queue-asked-part"]',
      '[data-cy="persons-queue-asked-sess_glint:req_provider"] [data-cy="question-words"]',
    ]) {
      await opensIn(selector)
    }
    m.q('waiting-pill-todo').click()
    await expect
      .poll(() => m.host.querySelectorAll('.todo-text [aria-label="Open file"]').length)
      .toBeGreaterThan(0)
    await opensIn('.todo-text')
    expect(opens).toHaveLength(4)
    expect(opens.every((target) => target.sessionId === 'sess_glint')).toBe(true)
    expect(opens.every((target) => target.text === '/work/sample/notes.md')).toBe(true)
  })

  it('resolves explicitly linked relative files in prompts, parts and to-dos', async () => {
    const asks: MessagePathAsk[] = []
    const opens: MessagePathTarget[] = []
    ;(window as unknown as { api: unknown }).api = {
      runtime: {
        resolveMessagePaths: async (ask: MessagePathAsk) => {
          asks.push(ask)
          return ask.texts.map((text) =>
            text === 'notes.md'
              ? {
                  text,
                  found: true,
                  absolute: '/work/sample/notes.md',
                  name: 'notes.md',
                  kind: 'file',
                  opens: true,
                }
              : { text, found: false },
          )
        },
        openMessagePath: async (target: MessagePathTarget) => {
          opens.push(target)
          return { ok: true, did: 'opened' }
        },
        revealMessagePath: async () => ({ ok: true }),
      },
    }
    if (theme === 'crew-night') wearTheme(theme)
    const m = await aWaitingPageWithMarkdown(1180, 1000, false, true)
    // The questions list holds four of the five; the to-do list holds the fifth.
    let copies = 0
    for (const [pill, count] of [
      ['questions', 4],
      ['todo', 1],
    ] as const) {
      m.q(`waiting-pill-${pill}`).click()
      // Every list stays drawn; only the open one is on screen.
      const shown = `[data-cy="waiting-list-${pill}"]`
      await expect
        .poll(() => m.host.querySelectorAll(`${shown} [aria-label="Open file"]`).length)
        .toBe(count)
      for (const button of m.host.querySelectorAll<HTMLButtonElement>(
        `${shown} [aria-label="Open file"]`,
      ))
        button.click()
      await nextTick()
      copies += m.host.querySelectorAll(`${shown} [aria-label="Copy path"]`).length
    }
    expect(asks.flatMap((ask) => ask.texts)).toContain('notes.md')
    expect(opens).toHaveLength(5)
    expect(
      opens.every((target) => target.sessionId === 'sess_glint' && target.text === 'notes.md'),
    ).toBe(true)
    expect(copies).toBe(5)
  })

  it.each([1180, 480])(
    'keeps long markdown inside its cards at %s pixels and preserves the fold',
    async (width) => {
      await page.viewport(width, 1000)
      if (theme === 'crew-night') wearTheme(theme)
      const m = await aWaitingPageWithMarkdown(width, 1000, true)
      expect(m.q('question-more').getAttribute('aria-expanded')).toBe('false')
      m.q('question-more').click()
      await nextTick()
      expect(m.q('question-more').getAttribute('aria-expanded')).toBe('true')
      const blocks = (list = 'questions'): HTMLElement[] => [
        ...m.host.querySelectorAll<HTMLElement>(`[data-cy="waiting-list-${list}"] .md-chat pre`),
      ]
      // Two in the questions list; the to-do's own is checked in its list below.
      expect(blocks()).toHaveLength(2)
      for (const block of blocks()) {
        expect(getComputedStyle(block).overflowX).toBe('auto')
        expect(block.scrollWidth).toBeGreaterThan(block.clientWidth)
      }
      for (const card of m.host.querySelectorAll<HTMLElement>('.pq-row, .todo')) {
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
      }
      for (const text of m.host.querySelectorAll<HTMLElement>(
        '.md-chat, .md-chat code, .md-chat a',
      )) {
        expect(parseFloat(getComputedStyle(text).fontSize)).toBeGreaterThanOrEqual(12)
      }
      m.q('question-more').click()
      await nextTick()
      expect(m.q('question-more').getAttribute('aria-expanded')).toBe('false')
      expect(m.all('question-context')).toHaveLength(0)
      m.q('waiting-pill-todo').click()
      await nextTick()
      m.q('waiting-todo-more-req_todo').click()
      await nextTick()
      expect(blocks('todo')).toHaveLength(1)
      for (const block of blocks('todo')) {
        expect(getComputedStyle(block).overflowX).toBe('auto')
        expect(block.scrollWidth).toBeGreaterThan(block.clientWidth)
      }
      for (const card of m.host.querySelectorAll<HTMLElement>('.todo')) {
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
      }
    },
  )
})
