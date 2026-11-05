import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { userEvent } from 'vitest/browser'
import type { MessagePathAsk, MessagePathTarget } from '../../src/shared/runtime-ipc'
import type { UserInputItem } from '../../src/renderer/src/lib/transcript'
import type { PathsHere } from '../../src/renderer/src/composables/useMessagePaths'
import UserInputCard from '../../src/renderer/src/components/UserInputCard.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { wearTheme } from '../../look/fixtures/themes'
import {
  aTranscriptQuestionWithMarkdown,
  QUESTION_MARKDOWN,
} from './a-transcript-question-with-markdown'
import { aWaitingPageWithMarkdown } from './a-waiting-page-with-markdown'
import { mount, unmountAll, visible } from './harness'
import { drawnReady, notDrawn, describeClip } from './drawn'

afterEach(() => {
  unmountAll()
  usePersonsQueue().forget()
  applyTheme(null)
  vi.restoreAllMocks()
  delete (window as { api?: unknown }).api
})

describe.each(['classic', 'crew-night', 'synthwave'] as const)(
  'shared question prose in %s',
  (theme) => {
    it('draws a failed file press outside a long folded question', async () => {
      if (theme !== 'classic') wearTheme(theme)
      const opened = vi.fn(async () => ({ ok: false, reason: 'failed' }))
      ;(window as unknown as { api: unknown }).api = {
        runtime: {
          resolveMessagePaths: async (ask: MessagePathAsk) =>
            ask.texts.map((text) => ({
              text,
              found: true,
              absolute: text,
              name: text,
              kind: 'file',
              opens: true,
            })),
          openMessagePath: opened,
          revealMessagePath: async () => ({ ok: true }),
        },
      }
      const waiting = await aWaitingPageWithMarkdown(
        1180,
        1000,
        false,
        false,
        '**Choose a draft**\n\nRead [the draft](notes.md).\n\n' +
          '- More context for the draft.\n'.repeat(30),
      )
      const card = waiting.q('question-card')
      expect(waiting.q('question-more').getAttribute('aria-expanded')).toBe('false')
      const words = waiting.q('question-words')
      await expect.poll(() => words.querySelectorAll('[aria-label="Open file"]').length).toBe(1)
      await drawnReady()
      const open = words.querySelector<HTMLButtonElement>('[aria-label="Open file"]')!
      expect(notDrawn(open, waiting.host).map(describeClip)).toEqual([])
      await userEvent.click(open)
      await expect.poll(() => card.querySelectorAll('[role="status"]').length).toBe(1)
      await drawnReady()
      const status = card.querySelector<HTMLElement>('[role="status"]')!
      expect(notDrawn(status, waiting.host).map(describeClip)).toEqual([])
      expect(opened).toHaveBeenCalledTimes(1)
      await drawnReady()
      expect(notDrawn(open, waiting.host).map(describeClip)).toEqual([])
      await userEvent.click(open)
      await expect.poll(() => opened.mock.calls.length).toBe(2)
      await expect.poll(() => card.querySelectorAll('[role="status"]').length).toBe(1)
      await drawnReady()
      expect(
        notDrawn(card.querySelector<HTMLElement>('[role="status"]')!, waiting.host).map(
          describeClip,
        ),
      ).toEqual([])
      expect(waiting.q('question-more').getAttribute('aria-expanded')).toBe('false')
    })

    it('renders provider prompts and parts while grant fields stay literal and path presses have one owner', async () => {
      if (theme !== 'classic') wearTheme(theme)
      const press = vi.fn(async () => 'The sample file could not be opened.')
      const paths: PathsHere = {
        sessionId: 'sess_glint',
        words: { canOpen: true, fileManager: 'Finder' },
        known: (text) => ({
          text,
          found: true,
          absolute: text,
          name: text,
          kind: 'file',
          opens: true,
        }),
        ask: vi.fn(),
        press,
      }
      const item: UserInputItem & { at: number } = {
        kind: 'userInput',
        id: 'provider_question',
        at: 1000,
        answered: null,
        note: null,
        refused: null,
        request: {
          type: 'user_input_request',
          id: 'req_provider',
          prompt: QUESTION_MARKDOWN,
          questions: [{ id: 'draft', prompt: QUESTION_MARKDOWN, options: [{ label: 'Short' }] }],
          permission: {
            cwd: '/work/**literal**',
            paths: ['/work/`literal`'],
            network: false,
            reason: '**literal reason**',
          },
        },
      }
      const m = mount(UserInputCard, { item, paths })
      for (const words of [
        m.q('user-input-prompt'),
        m.q('user-input-question-draft').querySelector('.ask')!,
      ]) {
        expect(words.querySelector('strong')?.textContent).toBe('Choose a draft')
        expect(words.querySelectorAll('ul > li')).toHaveLength(2)
        expect(words.querySelector('code')?.textContent).toBe('draft_id')
        expect(words.querySelectorAll('[aria-label="Open file"]')).toHaveLength(1)
        const before = press.mock.calls.length
        words.querySelector<HTMLButtonElement>('[aria-label="Open file"]')!.click()
        await expect.poll(() => press.mock.calls.length).toBe(before + 1)
        await expect.poll(() => words.querySelectorAll('[role="status"]').length).toBe(1)
      }
      const grant = m.q('user-input-permission')
      expect(grant.querySelector('.md-chat, strong, code')).toBeNull()
      expect(grant.textContent).toContain('**literal reason**')
      expect(grant.textContent).toContain('/work/`literal`')
      const before = press.mock.calls.length
      grant.querySelector<HTMLButtonElement>('[aria-label="Open file"]')!.click()
      await expect.poll(() => press.mock.calls.length).toBe(before + 1)
    })

    it.each([false, true])(
      'renders the same markdown with transcript folding %s',
      async (folds) => {
        const opens: MessagePathTarget[] = []
        const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
        ;(window as unknown as { api: unknown }).api = {
          runtime: {
            resolveMessagePaths: async (ask: MessagePathAsk) =>
              ask.texts.map((text) => ({
                text,
                found: true,
                absolute: `/work/sample/${text}`,
                name: text,
                kind: 'file',
                opens: true,
              })),
            openMessagePath: async (target: MessagePathTarget) => {
              opens.push(target)
              return { ok: false, reason: 'failed' }
            },
            revealMessagePath: async () => ({ ok: true }),
          },
        }
        if (theme !== 'classic') wearTheme(theme)
        const waiting = await aWaitingPageWithMarkdown(1180, 1000, false, false, QUESTION_MARKDOWN)
        const transcript = aTranscriptQuestionWithMarkdown(folds)
        if (folds) {
          expect(transcript.q('exchange-toggle').getAttribute('aria-expanded')).toBe('false')
          await expect.poll(() => transcript.all('question-card').length).toBe(0)
          transcript.q('exchange-toggle').click()
          await nextTick()
        } else {
          expect(transcript.all('exchange-toggle')).toHaveLength(0)
          expect(transcript.q('question-option').tagName).toBe('BUTTON')
        }
        for (const m of [waiting, transcript]) {
          const words = m.q('question-words')
          expect(words.querySelector('strong')?.textContent).toBe('Choose a draft')
          expect(words.querySelectorAll('ul > li')).toHaveLength(2)
          expect(words.querySelector('code')?.textContent).toBe('draft_id')
          expect(words.textContent).toContain('the draft')
          expect(words.textContent).not.toContain('**')
          await expect.poll(() => words.querySelectorAll('[aria-label="Open file"]').length).toBe(1)
          expect(words.querySelectorAll('[aria-label="Copy path"]')).toHaveLength(1)
          const copied = copy.mock.calls.length
          words.querySelector<HTMLButtonElement>('[aria-label="Copy path"]')!.click()
          await expect.poll(() => copy.mock.calls.length).toBe(copied + 1)
          expect(copy.mock.calls.at(-1)?.[0]).toBe('/work/sample/notes.md')
          const before = opens.length
          words.querySelector<HTMLButtonElement>('[aria-label="Open file"]')!.click()
          await expect.poll(() => opens.length).toBe(before + 1)
          expect(opens.at(-1)?.text).toBe('notes.md')
          await expect
            .poll(() => m.q('question-card').querySelectorAll('[role="status"]').length)
            .toBe(1)
          words.querySelector<HTMLButtonElement>('[aria-label="Open file"]')!.click()
          await expect.poll(() => opens.length).toBe(before + 2)
          expect(m.q('question-card').querySelectorAll('[role="status"]')).toHaveLength(1)
        }
        const context = transcript.q('question-context')
        await expect.poll(() => context.querySelectorAll('[aria-label="Open file"]').length).toBe(1)
        const before = opens.length
        context.querySelector<HTMLButtonElement>('[aria-label="Open file"]')!.click()
        await expect.poll(() => opens.length).toBe(before + 1)
        expect(opens.at(-1)?.text).toBe('context.md')
        await expect.poll(() => context.querySelectorAll('[role="status"]').length).toBe(1)
        if (folds) {
          transcript.q('exchange-toggle').click()
          await nextTick()
          expect(transcript.q('exchange-toggle').getAttribute('aria-expanded')).toBe('false')
          expect(visible(transcript.q('question-card'))).toBe(false)
        }
      },
    )
  },
)
