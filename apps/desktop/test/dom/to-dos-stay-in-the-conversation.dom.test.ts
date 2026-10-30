import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import WorkWaits from '../../src/renderer/src/components/WorkWaits.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { applyEvent, markRequestFailed } from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll } from './harness'

const queue = usePersonsQueue()
const TEXT = 'Check the sample report and confirm its title.'
const events: TranscriptEvent[] = [
  {
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      tools: [{ name: 'request_action', description: '', parameters: [] }],
    },
    published: null,
  } as unknown as TranscriptEvent,
  { type: 'user_turn', text: 'Prepare the sample report.' },
  {
    type: 'tool_call',
    id: 'call_report',
    name: 'mcp__brobot__request_action',
    summary: JSON.stringify({ action: TEXT }),
  } as TranscriptEvent,
  {
    type: 'question_asked',
    requestId: 'req_report',
    piece: 'work_report',
    label: 'W3.4',
    prompt: TEXT,
    questions: [],
    action: { files: [{ resource: 'res_report', name: 'sample-report.pdf' }] },
  } as TranscriptEvent,
  { type: 'request_routed', requestId: 'req_report', to: 'a-person' } as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'call_report',
    summary: 'The to-do is under Waiting on you.',
    ok: true,
  } as TranscriptEvent,
]
function supply(
  answerTodo: (
    session: string,
    request: string,
    done: boolean,
    note: string,
  ) => Promise<string | null>,
  open: (id: string) => void = () => {},
) {
  queue.supply(
    null,
    null,
    {
      held: new Set(),
      answerable: new Map(),
      answeredFromHere: new Set(),
      now: 1700000000000,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open,
      answerTodo,
    },
  )
}
const settle = async () => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}
afterEach(() => {
  unmountAll()
  queue.forget()
})

describe('to-dos in the conversation', () => {
  it('draws the real request as one card and shares pending and success with Waiting on you', async () => {
    const sent: unknown[] = []
    const opened: string[] = []
    let finish: (value: string | null) => void = () => {}
    supply(
      (...args) => {
        sent.push(args)
        return new Promise((resolve) => {
          finish = resolve
        })
      },
      (id) => opened.push(id),
    )
    const r = reactive(record(events))
    const m = mount(ConversationPane, paneProps({ record: r }), { width: 1200, height: 808 })
    expect(m.q('inline-todo-text-req_report').textContent).toBe(TEXT)
    expect(m.all('tool-entry')).toHaveLength(0)
    const note = m.q('inline-todo-note-req_report') as HTMLTextAreaElement
    note.value = 'The title matches.'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    m.q('inline-todo-done-req_report').click()
    m.q('inline-todo-done-req_report').click()
    await nextTick()
    expect(sent).toEqual([['sess_1', 'req_report', true, 'The title matches.']])
    expect((m.q('inline-todo-done-req_report') as HTMLButtonElement).disabled).toBe(true)
    finish(null)
    await settle()
    expect(m.q('inline-todo-said-req_report').textContent).toContain('Done.')
    expect(m.all('inline-todo-done-req_report')).toHaveLength(0)
    const waiting = mount(WorkWaits, { part: 'todos' })
    expect(waiting.q('waiting-todo-said-req_report').textContent).toContain('Done.')
    waiting.q('waiting-todo-open-req_report').click()
    expect(opened).toEqual(['sess_1'])
  })
  it('sends Can’t do it with a note and keeps a refusal retryable', async () => {
    const sent: unknown[] = []
    supply(async (...args) => {
      sent.push(args)
      return 'The report request is still open. Try again.'
    })
    const m = mount(ConversationPane, paneProps({ record: record(events) }))
    const note = m.q('inline-todo-note-req_report') as HTMLTextAreaElement
    note.value = 'I cannot open the sample.'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    m.q('inline-todo-cant-req_report').click()
    await settle()
    expect(sent).toEqual([['sess_1', 'req_report', false, 'I cannot open the sample.']])
    expect(m.q('inline-todo-said-req_report').textContent).toContain('still open')
    expect((m.q('inline-todo-cant-req_report') as HTMLButtonElement).disabled).toBe(false)
  })
  it('replayed answered and withdrawn requests have no answer controls', async () => {
    for (const ending of [
      {
        type: 'user_decision',
        requestId: 'req_report',
        outcome: 'answered',
        by: { is: 'a-person' },
      },
      { type: 'question_withdrawn', requestId: 'req_report' },
      { type: 'question_ended_with_its_piece', requestId: 'req_report', ending: 'work-closed' },
    ] as TranscriptEvent[]) {
      const m = mount(ConversationPane, paneProps({ record: record([...events, ending]) }))
      expect(m.q('inline-todo-text-req_report').textContent).toBe(TEXT)
      expect(m.all('inline-todo-done-req_report')).toHaveLength(0)
      m.unmount()
    }
  })
  it('updates the inline controls when the recorded request is answered elsewhere', async () => {
    const r = reactive(record(events))
    const m = mount(ConversationPane, paneProps({ record: r }))
    expect(m.all('inline-todo-done-req_report')).toHaveLength(1)
    applyEvent(r.transcript, {
      type: 'user_decision',
      requestId: 'req_report',
      outcome: 'answered',
    } as TranscriptEvent)
    await nextTick()
    expect(m.all('inline-todo-done-req_report')).toHaveLength(0)
    expect(m.q('inline-todo-said-req_report').textContent).not.toContain('Done.')
  })
  it('a definitive host refusal closes the inline card and shows the recorded reason', async () => {
    const r = reactive(record(events))
    const m = mount(ConversationPane, paneProps({ record: r }))
    expect(m.all('inline-todo-done-req_report')).toHaveLength(1)
    markRequestFailed(r.transcript, 'req_report', 'This to-do was already answered.')
    await nextTick()
    expect(m.all('inline-todo-done-req_report')).toHaveLength(0)
    expect(m.q('inline-todo-said-req_report').textContent).toBe('This to-do was already answered.')
  })
})
