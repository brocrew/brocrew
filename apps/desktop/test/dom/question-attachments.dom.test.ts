import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { AskedQuestion } from '../../src/shared/question-contracts'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { aWaitingPageWithMarkdown } from './a-waiting-page-with-markdown'
import { brobotToolInventory, mount, paneProps, record, unmountAll, visible } from './harness'

const resource = 'res_' + 'a'.repeat(32)
const name = 'draft.md'
const question = 'Which draft should we use?'

afterEach(() => {
  unmountAll()
  usePersonsQueue().forget()
  delete (window as { api?: unknown }).api
})

function openFrom(card: HTMLElement, words: string, filename: string) {
  expect(card.textContent).toContain(words)
  expect(card.textContent).not.toMatch(/res_|read_document|Read the file|The full text is saved at/)
  const button = [...card.querySelectorAll<HTMLButtonElement>('button[data-cy="file-row"]')].find(
    (one) => one.textContent?.trim() === filename,
  )!
  expect(button.textContent?.trim()).toBe(filename)
  expect(button.title).toBe(filename)
  expect(visible(button)).toBe(true)
  button.click()
}

it.each(['structured', 'legacy'] as const)(
  'opens the same %s question file from the conversation, folded preview and queue',
  async (kind) => {
    const prompt =
      kind === 'structured'
        ? question
        : `${question}\n\nRead ${name} with read_document using ${resource}.`
    const files = kind === 'structured' ? { files: [{ resource, name }] } : {}
    const questions = [{ id: 'answer', prompt, options: [{ label: 'Short' }] }]
    const asked: AskedQuestion = {
      prompt,
      ...files,
      context: null,
      passedUp: false,
      parts: questions,
    }
    const events: TranscriptEvent[] = [
      brobotToolInventory('ask_question'),
      {
        type: 'tool_call',
        id: 'ask',
        name: 'mcp__brobot__ask_question',
        summary: JSON.stringify({ question, who_answers: 'a-person' }),
      },
      { type: 'question_asked', requestId: 'req_app', prompt, questions, ...files },
      { type: 'request_routed', requestId: 'req_app', to: 'a-person' },
      { type: 'tool_result', id: 'ask', summary: 'recorded', ok: true },
    ]
    const read = vi.fn(async (resourceId: string) => ({
      ok: true as const,
      form: 'markdown' as const,
      resourceId,
      name,
      text: '# Draft',
      bytes: 7,
    }))

    const conversation = mount(
      ConversationPane,
      paneProps({ record: record(events), canAnswer: true, onReadResource: read }),
    )
    openFrom(conversation.q('question-card'), question, name)
    await expect.poll(() => conversation.all('canonical-document-viewer').length).toBe(1)
    expect(read).toHaveBeenLastCalledWith(resource)
    unmountAll()

    const folded = mount(
      ConversationPane,
      paneProps({
        record: record([
          ...events,
          { type: 'user_decision', requestId: 'req_app', outcome: 'answered' },
        ]),
        canAnswer: true,
        onReadResource: read,
      }),
    )
    expect(folded.q('exchange-toggle').getAttribute('aria-expanded')).toBe('false')
    expect(folded.q('exchange-preview').textContent?.trim()).toBe(question)
    openFrom(folded.q('outgoing'), question, name)
    await expect.poll(() => folded.all('canonical-document-viewer').length).toBe(1)
    expect(read).toHaveBeenCalledTimes(2)
    unmountAll()

    const openFile = vi.fn()
    const queue = await aWaitingPageWithMarkdown(1180, 1000, false, false, question, {
      asked,
      openFile,
    })
    await nextTick()
    openFrom(queue.q('question-card'), question, name)
    expect(openFile).toHaveBeenCalledExactlyOnceWith(resource)
  },
)
it.each(['structured', 'legacy'] as const)(
  'opens the same %s to-do file inline and from the queue',
  async (kind) => {
    const words = 'Review the draft.'
    const filename = 'action.txt'
    const prompt =
      kind === 'structured'
        ? words
        : `${words} The full text is attached as ${resource}: read it with read_document.`
    const action = { files: [{ resource, name: filename }] }
    const openFile = vi.fn()
    const queue = await aWaitingPageWithMarkdown(1180, 1000, false, false, question, {
      action: { ...action, text: prompt },
      openFile,
    })
    const events: TranscriptEvent[] = [
      brobotToolInventory('request_action'),
      {
        type: 'tool_call',
        id: 'todo',
        name: 'mcp__brobot__request_action',
        summary: JSON.stringify({ action: words }),
      },
      {
        type: 'question_asked',
        requestId: 'req_todo',
        prompt,
        action,
        questions: [{ id: 'answer', prompt, options: [{ label: 'Done' }] }],
      },
      { type: 'request_routed', requestId: 'req_todo', to: 'a-person' },
      { type: 'tool_result', id: 'todo', summary: 'recorded', ok: true },
    ]
    const conversation = mount(
      ConversationPane,
      paneProps({ record: record(events), canAnswer: true }),
    )
    openFrom(conversation.q('inline-todo-req_todo'), words, filename)
    queue.q('waiting-pill-todo').click()
    await nextTick()
    openFrom(queue.q('waiting-todo-req_todo'), words, filename)
    expect(openFile.mock.calls).toEqual([[resource], [resource]])
  },
)

it.each(['structured', 'legacy'] as const)(
  'opens both %s taskless files through the existing path handler',
  async (kind) => {
    const leaf = '/work/brocrew-12345678-1234-4123-8123-123456789abc-'
    const overflow = leaf + 'question.txt'
    const draft = leaf + 'draft notes.md'
    const prompt =
      kind === 'structured'
        ? question
        : `${question} The full text is saved at ${overflow}: read the file.\n\nRead the file ${draft}.`
    const files =
      kind === 'structured'
        ? {
            files: [
              { path: draft, name: 'draft notes.md' },
              { path: overflow, name: 'question.txt' },
            ],
          }
        : {}
    const openMessagePath = vi.fn<RuntimeBridge['openMessagePath']>(async () => ({
      ok: true as const,
      did: 'opened' as const,
    }))
    ;(window as unknown as { api: unknown }).api = {
      runtime: {
        resolveMessagePaths: async () => [],
        openMessagePath,
        revealMessagePath: async () => ({ ok: true }),
      },
    }
    const events: TranscriptEvent[] = [
      brobotToolInventory('ask_question'),
      {
        type: 'tool_call',
        id: 'ask_peer',
        name: 'mcp__brobot__ask_question',
        summary: JSON.stringify({ question, who_answers: 'an-agent', agent: 'sess_other' }),
      },
      {
        type: 'question_asked',
        requestId: 'req_peer',
        prompt,
        questions: [{ id: 'answer', prompt, options: [] }],
        ...files,
      },
      { type: 'request_routed', requestId: 'req_peer', to: 'an-agent', parent: 'sess_other' },
      { type: 'tool_result', id: 'ask_peer', summary: 'recorded', ok: true },
    ]
    const m = mount(ConversationPane, paneProps({ record: record(events) }))
    const toggle = m.q('exchange-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(m.q('exchange-preview').textContent?.trim()).toBe(question)
    openFrom(m.q('outgoing'), question, 'draft notes.md')

    toggle.click()
    await nextTick()
    expect(m.q('question-words').textContent?.trim()).toBe(question)
    openFrom(m.q('outgoing'), question, 'question.txt')
    expect(openMessagePath.mock.calls).toEqual([
      [{ sessionId: 'sess_1', text: draft }],
      [{ sessionId: 'sess_1', text: overflow }],
    ])
  },
)
