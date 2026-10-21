import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll } from './harness'

const originalApi = window.api
afterEach(() => {
  unmountAll()
  window.api = originalApi
})
const row = (
  id: string,
  title: string,
  at: number,
  identity = DEFAULT_PROFILE_ID,
): ListedConversation => ({
  sessionId: id,
  label: 'BroBot',
  identity,
  provider: 'claude',
  place: null,
  state: { is: 'idle' },
  named: { label: 'Notes', title },
  inAnotherWindow: false,
  updatedAt: at,
})
function open(
  recent: ListedConversation[] | null,
  draft = '',
  extra: Record<string, unknown> = {},
) {
  const text = ref(draft),
    opened: string[] = []
  const wrapper = defineComponent({
    setup: () => () =>
      h(NewConversation, {
        recent,
        draft: text.value,
        busy: false,
        error: null,
        debug: false,
        handing: createAttachmentBook().handing(NEW_CONVERSATION),
        defaultProvider: 'claude',
        defaultApprovalMode: 'ask',
        capabilities: CAPABILITY_FIXTURE,
        choices: NO_LAUNCH_CHOICES,
        'onUpdate:draft': (value: string) => {
          text.value = value
        },
        onOpen: (id: string) => opened.push(id),
        ...extra,
      }),
  })
  return { m: mount(wrapper, {}, { width: 1180, height: 900 }), text, opened }
}
const order = (host: HTMLElement) =>
  [...host.querySelectorAll('.recent-card')].map((e) => e.getAttribute('data-cy'))
it('shows only BroBot, newest first, limited to six without changing the source list', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(String(i), `Title ${i}`, i + 1))
  const { m } = open([...rows, row('other', 'Other agent', 50, 'designer')])
  await nextTick()
  expect(order(m.host)).toEqual(
    ['7', '6', '5', '4', '3', '2'].map((id) => `recent-conversation-${id}`),
  )
  expect(rows.map((r) => r.sessionId)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
})
it('ranks accent- and case-insensitive typed words before recency and opens that exact conversation', async () => {
  const { m, text, opened } = open([
    row('new', 'Release review', 30),
    row('old', 'Café MENU planning', 10),
    row('half', 'Menu labels', 20),
  ])
  await nextTick()
  const field = m.q('prompt-input') as HTMLTextAreaElement
  field.value = 'CAFE menu'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(order(m.host)).toEqual(['old', 'half', 'new'].map((id) => `recent-conversation-${id}`))
  m.q('recent-conversation-old').focus()
  expect(document.activeElement).toBe(m.q('recent-conversation-old'))
  m.q('recent-conversation-old').click()
  expect(opened).toEqual(['old'])
  expect(text.value).toBe('CAFE menu')
})
it('searches every held title before limiting the results and counts each word once', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(String(i), 'Other', i + 1))
  const { m } = open(
    [...rows, row('match', 'Café planning', 0), row('partial', 'Planning', 20)],
    'cafe cafe planning',
  )
  await nextTick()
  expect(order(m.host)[0]).toBe('recent-conversation-match')
  expect(order(m.host)[1]).toBe('recent-conversation-partial')
  expect(order(m.host)).toHaveLength(6)
})
it('retains recent cards for an unmatched query and restores recency when cleared', async () => {
  const { m, text } = open([row('old', 'Café', 1), row('new', 'Review', 2)], 'cafe')
  await nextTick()
  expect(order(m.host)[0]).toBe('recent-conversation-old')
  text.value = 'unmatched'
  await nextTick()
  expect(order(m.host)[0]).toBe('recent-conversation-new')
  expect(m.host.querySelectorAll('.recent-card .bb-chip')).toHaveLength(0)
  text.value = ''
  await nextTick()
  expect(order(m.host)[0]).toBe('recent-conversation-new')
})
it('keeps loading distinct from an empty list and a list containing only other agents', async () => {
  const loading = open(null)
  await nextTick()
  expect(loading.m.q('recent-loading').textContent).toContain('Reading')
  loading.m.unmount()
  for (const rows of [[], [row('other', 'Other', 1, 'designer')]]) {
    const empty = open(rows)
    await nextTick()
    expect(empty.m.q('recent-empty').textContent).toContain('No conversations yet.')
    empty.m.unmount()
  }
})
it('uses the existing state wording and discloses another window', async () => {
  const r = { ...row('away', 'Review', 1), inAnotherWindow: true }
  const { m } = open([r])
  await nextTick()
  expect(m.q('recent-conversation-away').textContent).toContain('idle')
  expect(m.q('recent-conversation-away').textContent).toContain('open in another window')
})

function beforeSend(m: ReturnType<typeof mount>, notice: HTMLElement): void {
  const send = m.q('send-prompt')
  expect(notice.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(notice.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    send.getBoundingClientRect().top,
  )
  expect(notice.closest('[role="alert"]')).not.toBeNull()
}
it('puts a missing program notice above send and announces it', async () => {
  const { m } = open([], 'Start a plan', {
    programs: {
      claude: {
        standing: 'missing',
        from: null,
        path: null,
        version: null,
        tested: { oldest: '2.1.257', newest: '2.1.290' },
        said: 'Claude Code was not found.',
        help: { label: 'Install Claude Code', url: 'https://code.claude.com/docs/en/setup' },
      },
    },
  })
  await nextTick()
  beforeSend(m, m.q('launch-program'))
})
it('puts a refused launch or key reason above send and announces it', async () => {
  const { m } = open([], 'Start a plan', { error: 'The saved API key was refused.' })
  await nextTick()
  beforeSend(m, m.q('command-error'))
})
it('puts the sign-in remedy above send after a sign-in refusal', async () => {
  window.api = {
    runtime: {
      checkProviderAuth: async () => ({
        state: 'absent',
        reason: 'Sign in before continuing.',
        why: 'no-login',
      }),
    },
  } as never
  const busy = ref(false),
    error = ref<string | null>(null),
    text = ref('Start a plan')
  const handing = createAttachmentBook().handing(NEW_CONVERSATION)
  const wrapper = defineComponent({
    setup: () => () =>
      h(NewConversation, {
        busy: busy.value,
        error: error.value,
        refusedAs: 'sign-in',
        debug: false,
        draft: text.value,
        handing,
        recent: [],
        defaultProvider: 'claude',
        defaultApprovalMode: 'ask',
        capabilities: CAPABILITY_FIXTURE,
        choices: NO_LAUNCH_CHOICES,
        onStart: () => {
          busy.value = true
        },
        'onUpdate:draft': (value: string) => {
          text.value = value
        },
      }),
  })
  const m = mount(wrapper, {}, { width: 1180, height: 900 })
  await nextTick()
  m.q('send-prompt').click()
  await nextTick()
  expect(busy.value).toBe(true)
  error.value = 'Sign in before continuing.'
  busy.value = false
  await expect.poll(() => m.host.querySelector('[data-cy="sign-in-panel"]')).not.toBeNull()
  beforeSend(m, m.q('sign-in-panel'))
})
