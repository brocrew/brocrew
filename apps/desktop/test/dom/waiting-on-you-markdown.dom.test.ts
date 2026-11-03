import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import type { MessagePathAsk, MessagePathTarget } from '../../src/shared/runtime-ipc'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { wearTheme } from '../../look/fixtures/themes'
import { aWaitingPageWithMarkdown, LITERAL_COMMAND } from './a-waiting-page-with-markdown'
import { unmountAll } from './harness'

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
  it('renders question words, added notes, part prompts, disclosed requests and to-dos', async () => {
    await page.viewport(1180, 1000)
    if (theme === 'crew-night') wearTheme(theme)
    const m = await aWaitingPageWithMarkdown()
    m.q('question-more').click()
    await nextTick()
    for (const selector of [
      '[data-cy="question-words"]',
      '[data-cy="persons-queue-asked-sess_glint:req_provider"] .pq-asked-words',
    ]) {
      const words = m.host.querySelector(selector)!
      expect(words.querySelector('strong')?.textContent).toBe('Choose a draft')
      expect(words.querySelectorAll('ul > li')).toHaveLength(2)
      expect(words.querySelector('code')?.textContent).toBe('notes.md')
      expect(words.querySelector('a')?.getAttribute('href')).toBe('https://example.test/preview')
      expect(words.textContent).toContain('/work/sample/notes.md')
      expect(words.textContent).not.toContain('**')
    }
    for (const selector of ['[data-cy="question-context"]', '.pq-asked-context']) {
      const context = m.host.querySelector(selector)!
      expect(context.textContent).toContain('Added:')
      expect(context.querySelector('strong')?.textContent).toBe('after review')
    }
    expect(m.host.querySelector('.ask .md-chat strong')?.textContent).toBe('the short draft')
    expect(m.host.querySelector('.pq-asked-part .md-chat strong')?.textContent).toBe(
      'the short draft',
    )
    expect(m.host.querySelector('.pq-request-what strong')?.textContent).toBe(
      'Run the preview check',
    )
    expect(m.host.querySelector('.todo-text strong')?.textContent).toBe('Check the preview')
    expect(m.host.querySelectorAll('.todo-text li')).toHaveLength(2)
  })

  it('keeps approval commands literal, including markdown punctuation', async () => {
    if (theme === 'crew-night') wearTheme(theme)
    const m = await aWaitingPageWithMarkdown()
    const command = m.host.querySelector('.pq-request-line code')!
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
    for (const selector of [
      '[data-cy="question-words"]',
      '.pq-asked-part',
      '[data-cy="persons-queue-asked-sess_glint:req_provider"] .pq-asked-words',
      '.todo-text',
    ]) {
      const words = m.host.querySelector(selector)!
      const open = words.querySelector<HTMLButtonElement>('[aria-label="Open file"]')!
      expect(open, selector).not.toBeNull()
      expect(words.querySelector('[aria-label="Copy path"]')).not.toBeNull()
      open.click()
      await nextTick()
    }
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
    await expect.poll(() => m.host.querySelectorAll('[aria-label="Open file"]').length).toBe(5)
    for (const button of m.host.querySelectorAll<HTMLButtonElement>('[aria-label="Open file"]'))
      button.click()
    await nextTick()
    expect(asks.flatMap((ask) => ask.texts)).toContain('notes.md')
    expect(opens).toHaveLength(5)
    expect(
      opens.every((target) => target.sessionId === 'sess_glint' && target.text === 'notes.md'),
    ).toBe(true)
    expect(m.host.querySelectorAll('[aria-label="Copy path"]')).toHaveLength(5)
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
      const blocks = m.host.querySelectorAll<HTMLElement>('.md-chat pre')
      expect(blocks).toHaveLength(3)
      for (const block of blocks) {
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
    },
  )
})
