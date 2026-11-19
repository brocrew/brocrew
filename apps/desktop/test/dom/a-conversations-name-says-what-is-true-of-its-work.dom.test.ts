import { afterEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick, ref } from 'vue'
import type {
  ConversationRenameInput,
  ConversationRenameResult,
} from '../../src/shared/conversation-title'
import SessionHeader from '../../src/renderer/src/components/SessionHeader.vue'
import { conversationTitle } from '../../src/renderer/src/lib/conversation-list'
import { theirConversations } from '../../src/renderer/src/lib/team-roster'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import type { WorkThatNamesIt } from '../../src/shared/piece-called'
import { mount, unmountAll } from './harness'

/**
 * # 🔴 F033 · a conversation's name says what is true of its work
 *
 * The rail row, the palette, the header and the Team roster name a conversation by the work that
 * names it. ⚑ They now draw it in the one spelling every agent sentence uses: *"(and 2 more)"* beside
 * more open pieces, and *"(answered)"*, *"(taken back)"* or *"(closed)"* once it ended. ⛔ The header's
 * rename field edits the bare title, never a mark; and a root carries none.
 */

const liveness = {
  state: 'live' as const,
  since: 1_700_000_000_000,
  signInSuperseded: false,
}

const CLAIMED: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/checkout',
  providerHome: '/homes/claude',
  profileId: 'default',
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  ref: null,
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'm',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  queued: [],
  liveness,
  hasACommander: true,
  startedWithoutAWindow: true,
  mayHandItBack: true,
}

function header(
  named: WorkThatNamesIt | null,
  rename?: (input: ConversationRenameInput) => Promise<ConversationRenameResult>,
) {
  return mount(SessionHeader, {
    session: CLAIMED,
    status: 'idle',

    facets: { doing: 'idle' as const, being: 'live' as const },
    named,
    rename,
  })
}

const text = (element: Element | null): string =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

async function openTitle(m: ReturnType<typeof mount>): Promise<HTMLInputElement> {
  m.q('conversation-title-rename').click()
  await nextTick()
  await nextTick()
  return m.q('conversation-title-input') as HTMLInputElement
}

function enterTitle(input: HTMLInputElement, title: string): void {
  input.value = title
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

afterEach(() => unmountAll())

describe('F033 · the name says what is true of its work', () => {
  it('🔴 a conversation holding more open pieces: “(and 2 more)”, in the header and the rail title', () => {
    const named = { label: 'W1.4', title: 'Ship the page', more: 2 }
    expect(text(header(named).q('conversation-title'))).toBe('W1.4 · Ship the page (and 2 more)')
    expect(conversationTitle('Ada', named)).toBe('W1.4 · Ship the page (and 2 more)')
  })

  it('🔴 one that ended: “(answered)”, and one taken back: “(taken back)”', () => {
    expect(
      text(
        header({ label: 'W1.48', title: 'Check the logo', ended: 'answered' }).q(
          'conversation-title',
        ),
      ),
    ).toBe('W1.48 · Check the logo (answered)')
    unmountAll()
    expect(
      text(
        header({ label: 'W1.37', title: 'Old idea', ended: 'withdrawn' }).q('conversation-title'),
      ),
    ).toBe('W1.37 · Old idea (taken back)')
    expect(conversationTitle('Ali', { label: 'W1.37', title: 'Old idea', ended: 'closed' })).toBe(
      'W1.37 · Old idea (closed)',
    )
  })

  it('⛔ the rename field shows the bare title — never a mark', async () => {
    const m = header({ label: 'W1.4', title: 'Ship the page', more: 2 }, vi.fn())
    expect(text(m.q('conversation-title-rename'))).toBe('W1.4 · Ship the page (and 2 more)')
    ;(m.q('conversation-title-rename') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()
    expect((m.q('conversation-title-input') as HTMLInputElement).value).toBe('Ship the page')
  })

  it('⚑ the Team roster’s line names it the same way', () => {
    const row = (sessionId: string, named: WorkThatNamesIt): ListedConversation =>
      ({
        sessionId,
        provider: 'claude',
        label: 'Ada',
        identity: 'ada',
        place: null,
        state: { is: 'idle' },
        named,
        inAnotherWindow: false,
        updatedAt: 0,
      }) as unknown as ListedConversation
    const shelf = theirConversations(
      [
        row('s1', { label: 'W1.4', title: 'Ship the page', more: 2 }),
        row('s2', { label: 'W1.48', title: 'Check the logo', ended: 'answered' }),
      ],
      'ada',
      new Set<string>(),
    )
    expect(shelf!.map((one) => one.named)).toEqual([
      'W1.4 · Ship the page (and 2 more)',
      'W1.48 · Check the logo (answered)',
    ])
  })

  it('⛔ a root carries no mark', () => {
    const root = { label: 'W1', title: 'Bakery website' }
    expect(text(header(root).q('conversation-title'))).toBe('W1 · Bakery website')
    expect(conversationTitle('BroBot', root)).toBe('W1 · Bakery website')
  })
})


describe('The conversation title is its own record', () => {
  it('sends the stable conversation ID and shows only the identity returned by the rename', async () => {
    const rename = vi.fn(async (): Promise<ConversationRenameResult> => ({
      ok: true,
      conversation: 'sess_1',
      address: 'W1.1',
      title: 'Ship the new page',
      author: { kind: 'person' },
      previousTitle: 'Ship the page',
      previousAuthor: null,
    }))
    const m = header({ label: 'W1.4', title: 'Ship the page', more: 2 }, rename)
    expect(m.all('conversation-address')).toHaveLength(0)

    const input = await openTitle(m)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Ship the page')
    enterTitle(input, ' Ship the new page ')

    await expect.poll(() => text(m.q('conversation-title'))).toBe('Ship the new page')
    expect(rename).toHaveBeenCalledExactlyOnceWith({
      conversation: 'sess_1',
      title: ' Ship the new page ',
    })
    expect(text(m.q('conversation-address'))).toBe('Conversation W1.1')
    expect(text(m.q('conversation-linked-task'))).toBe('Task W1.4 · Ship the page (and 2 more)')
    expect(text(m.q('conversation-address').parentElement)).toContain('Named by you')
    expect(m.all('conversation-title-input')).toHaveLength(0)
  })

  it('keeps the field and refusal focused, and Escape or blur discards a draft', async () => {
    const rename = vi.fn(async (): Promise<ConversationRenameResult> => ({
      ok: false,
      code: 'bad-title',
      reason: 'Not changed: write one line.',
    }))
    const m = header(null, rename)
    const input = await openTitle(m)
    enterTitle(input, '  ')

    await expect.poll(() => m.all('conversation-title-refused').length).toBe(1)
    expect(text(m.q('conversation-title-refused'))).toBe('Not changed: write one line.')
    expect(document.activeElement).toBe(input)
    expect(input.disabled).toBe(false)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(m.all('conversation-title-input')).toHaveLength(0)
    const next = await openTitle(m)
    expect(next.value).toBe('checkout')
    next.blur()
    await nextTick()
    expect(m.all('conversation-title-input')).toHaveLength(0)
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('leaves another conversation’s draft alone when a previous save settles', async () => {
    const session = ref(CLAIMED)
    let settle!: (result: ConversationRenameResult) => void
    const pending = new Promise<ConversationRenameResult>((resolve) => {
      settle = resolve
    })
    const rename = vi.fn(() => pending)
    const m = mount(
      {
        setup: () => () =>
          h(SessionHeader, {
            session: session.value,
            status: 'idle',
            facets: { doing: 'idle', being: 'live' },
            rename,
          }),
      },
      {},
    )

    const first = await openTitle(m)
    enterTitle(first, 'First title')
    await nextTick()
    expect(first.disabled).toBe(true)
    session.value = { ...CLAIMED, sessionId: 'sess_second', cwd: '/second' }
    await nextTick()
    const second = await openTitle(m)
    second.value = 'Second draft'
    second.dispatchEvent(new Event('input', { bubbles: true }))
    settle({ ok: false, code: 'bad-title', reason: 'Previous title refused' })
    await pending
    await nextTick()

    expect(second.value).toBe('Second draft')
    expect(second.disabled).toBe(false)
    expect(document.activeElement).toBe(second)
    expect(m.all('conversation-title-refused')).toHaveLength(0)
  })
})
