import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionHeader from '../../src/renderer/src/components/SessionHeader.vue'
import { archiveConversation } from '../../src/renderer/src/lib/archive-and-delete'
import type { ArchiveOutcome } from '../../src/shared/conversation-archive'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * Archive and Delete on the conversation header, as a person presses them: Archive asks main for
 * this conversation and draws a refusal whole; Delete only asks for its confirmation to open. And
 * a conversation brought back from the archive says so in the normal reading view.
 */

type Api = { runtime: { archiveConversation: (input: { sessionId: string }) => Promise<unknown> } }
const stubbed = (): { api?: Api } => window as unknown as { api?: Api }

let asked: { sessionId: string }[] = []

function stub(answer: ArchiveOutcome): void {
  asked = []
  stubbed().api = {
    runtime: {
      archiveConversation: (input) => {
        asked.push(input)
        return Promise.resolve(answer)
      },
    },
  }
}

/** The press the screen hands the header: main's refusal, or null once it is archived. */
const archive = async (): Promise<string | null> => {
  const outcome = await archiveConversation(
    (window as unknown as { api: { runtime: never } }).api.runtime,
    META.sessionId,
  )
  return outcome.done ? null : outcome.refusal
}

function bar(over: Record<string, unknown> = {}): { m: Mounted; deletes: number[] } {
  const deletes: number[] = []
  const m = mount(SessionHeader, {
    session: META,
    status: 'idle',
    debug: false,
    facets: { doing: 'idle' as const, being: 'live' as const },
    archive,
    onDelete: () => deletes.push(1),
    ...over,
  })
  return { m, deletes }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

describe('Archive on the conversation header', () => {
  it('one press asks main to archive this conversation, and nothing is said when it does', async () => {
    stub({ done: true, conversations: [META.sessionId] })
    const { m } = bar()
    expect(visible(m.q('archive-conversation'))).toBe(true)
    expect(m.q('archive-conversation').textContent).toContain('Archive')

    m.q('archive-conversation').click()
    await settle()

    expect(asked).toEqual([{ sessionId: META.sessionId }])
    expect(m.all('archive-refused')).toHaveLength(0)
  })

  it('a refusal is drawn as main wrote it, whole', async () => {
    const refusal =
      'This conversation is being archived, so it was not started. Send it again once that is ' +
      'done: whatever is sent to it brings it back.'
    stub({ done: false, refusal })
    const { m } = bar()
    // The control: nothing is said before a press.
    expect(m.all('archive-refused')).toHaveLength(0)

    m.q('archive-conversation').click()
    await settle()

    expect(asked).toEqual([{ sessionId: META.sessionId }])
    const said = m.q('archive-refused')
    expect(said.textContent?.trim()).toBe(refusal)
    expect(said.getAttribute('role')).toBe('alert')
    expect(visible(said)).toBe(true)
    // The button is a press again once main has answered.
    expect((m.q('archive-conversation') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a second press while the first is out asks nothing more', async () => {
    let answer: (outcome: ArchiveOutcome) => void = () => undefined
    asked = []
    stubbed().api = {
      runtime: {
        archiveConversation: (input) => {
          asked.push(input)
          return new Promise((resolve) => (answer = resolve))
        },
      },
    }
    const { m } = bar()
    m.q('archive-conversation').click()
    await nextTick()
    expect((m.q('archive-conversation') as HTMLButtonElement).disabled).toBe(true)
    m.q('archive-conversation').click()
    await nextTick()
    expect(asked).toHaveLength(1)

    answer({ done: true, conversations: [META.sessionId] })
    await settle()
    expect((m.q('archive-conversation') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Delete on the conversation header', () => {
  it('one press asks for the confirmation, and asks main for nothing', async () => {
    stub({ done: true, conversations: [META.sessionId] })
    const { m, deletes } = bar()
    expect(m.q('delete-conversation').textContent?.trim()).toBe('Delete…')

    m.q('delete-conversation').click()
    await settle()

    expect(deletes).toHaveLength(1)
    expect(asked).toEqual([])
  })
})

describe('where the header offers neither', () => {
  it('a header handed no archive draws no Archive and no Delete', () => {
    const { m } = bar({ archive: undefined })
    expect(m.all('archive-conversation')).toHaveLength(0)
    expect(m.all('delete-conversation')).toHaveLength(0)
    // The control: the bar is drawn, with the acts it always has.
    expect(m.all('toggle-debug-mode')).toHaveLength(1)
  })

  it('the launcher’s header, with no conversation, draws neither', () => {
    const { m } = bar({ session: null })
    expect(m.all('archive-conversation')).toHaveLength(0)
    expect(m.all('delete-conversation')).toHaveLength(0)
    expect(m.all('toggle-debug-mode')).toHaveLength(1)
  })
})

describe('the conversation pane hands both through', () => {
  const IDLE = { type: 'status', state: 'idle' } as TranscriptEvent
  const pane = (events: TranscriptEvent[], over: Record<string, unknown> = {}): Mounted =>
    mount(ConversationPane, paneProps({ record: record([IDLE, ...events]), held: [], ...over }), {
      width: 1200,
      height: 808,
    })

  it('the header’s Archive is the press the pane was handed, and Delete is raised', async () => {
    stub({ done: true, conversations: [META.sessionId] })
    const deletes: number[] = []
    const m = pane([], { archive, onDelete: () => deletes.push(1) })
    await settle()

    m.q('archive-conversation').click()
    await settle()
    expect(asked).toEqual([{ sessionId: META.sessionId }])

    m.q('delete-conversation').click()
    await settle()
    expect(deletes).toHaveLength(1)
  })

  it('a pane handed no archive offers neither', async () => {
    const m = pane([])
    await settle()
    expect(m.all('archive-conversation')).toHaveLength(0)
    expect(m.all('delete-conversation')).toHaveLength(0)
    expect(m.all('toggle-debug-mode')).toHaveLength(1)
  })

  const BROUGHT_BACK = 'Brought back from the archive: you wrote to it.'

  it('"Brought back from the archive" is a line in the normal reading view', async () => {
    const m = pane([{ type: 'reopened', broughtBack: BROUGHT_BACK } as TranscriptEvent])
    await settle()
    const lines = m.all('notice-warn').filter((line) => line.textContent?.includes(BROUGHT_BACK))
    expect(lines).toHaveLength(1)
    expect(visible(lines[0]!)).toBe(true)
  })

  it('…and a reopen that brought nothing back draws no such line', async () => {
    const m = pane([{ type: 'reopened' } as TranscriptEvent])
    await settle()
    expect(m.host.textContent).not.toContain('Brought back from the archive')
    // The control: the pane itself is drawn.
    expect(m.all('session-header')).toHaveLength(1)
  })
})
