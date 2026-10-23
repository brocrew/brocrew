import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, Teleport } from 'vue'
import MessageLinks from '../../src/renderer/src/components/MessageLinks.vue'
import MarkdownWords from '../../src/renderer/src/components/MarkdownWords.vue'
import LinkedHistory from '../../src/renderer/src/components/LinkedHistory.vue'
import UserMessage from '../../src/renderer/src/components/UserMessage.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import { renderMarkdown } from '../../src/renderer/src/lib/markdown'
import { createWindow } from '../../src/renderer/src/lib/transcript-window'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import type { ResolvedMessageLink } from '../../src/renderer/src/lib/message-links'
import { mount, record, unmountAll } from './harness'
import { HEADER_EVENTS } from './recovery-fake'

beforeEach(() => vi.spyOn(window, 'open').mockImplementation(() => null))
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
})

const available = (over: Partial<ResolvedMessageLink> = {}): ResolvedMessageLink => ({
  state: 'available',
  kind: 'piece',
  title: 'A fictional draft',
  status: 'Working',
  opens: { sessionId: 'fictional-draft' },
  ...over,
})

function fixture(text: string, answer = available()) {
  const words = ref(text)
  const resolve = vi.fn<(target: string) => Promise<ResolvedMessageLink>>(async () => answer)
  const open = vi.fn<(answer: ResolvedMessageLink) => Promise<boolean>>(async () => true)
  const Holder = defineComponent({
    setup: () => () =>
      h(
        MessageLinks,
        { resolve, open },
        {
          default: () =>
            h(
              'div',
              {
                'data-chat-theme': 'light',
                style: 'width: 100%; padding: 24px; background: var(--panel);',
              },
              [h(IconSprite), h(MarkdownWords, { text: words.value })],
            ),
        },
      ),
  })
  return { view: mount(Holder, {}, { width: 700, height: 500 }), words, resolve, open }
}

it('allows ordinary controls to receive a click in the same clock tick', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const acted = vi.fn()
    const resolve = vi.fn(async () => available())
    const Holder = defineComponent({
      setup: () => () =>
        h(
          MessageLinks,
          { resolve, open: async () => true },
          {
            default: () =>
              h('button', { 'data-cy': 'ordinary-action', onClick: acted }, 'Continue'),
          },
        ),
    })
    const view = mount(Holder, {})
    view.q('ordinary-action').click()
    expect(acted).toHaveBeenCalledTimes(1)
    expect(resolve).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it('links explicit destinations and repeated work labels, leaving names, code and existing links alone', async () => {
  const { view, resolve } = fixture(
    '[Draft](brocrew://conversation/fictional) W2.1.1 W2.1.1 Ana\n\n`W3.1`\n\n```txt\nW4.2 [code](brocrew://agent/aid%3Aana)\n```\n\n[W5.1](https://example.test/) [report](./report.md) ./W6.1/file.md W7.1\\report.md folder\\W7.2',
  )
  await expect.poll(() => resolve.mock.calls.length).toBe(2)
  expect(view.all('message-link')).toHaveLength(3)
  expect(resolve.mock.calls.map(([target]) => target).sort()).toEqual([
    'W2.1.1',
    'brocrew://conversation/fictional',
  ])
  expect(view.host.querySelector('code')?.textContent).toBe('W3.1')
  expect(view.host.querySelector('pre')?.querySelector('button')).toBeNull()
  expect(view.host.querySelector('a[href="https://example.test/"]')?.textContent).toBe('W5.1')
  expect(view.host.querySelector('a[data-local-path="./report.md"]')?.textContent).toBe('report')
  expect(view.host.textContent).toContain('Ana')
  expect(view.host.querySelector('a[href^="brocrew:"]')).toBeNull()
})

it('paints every pending target before trimming the settled preview cache', async () => {
  const { view, resolve, words } = fixture(
    Array.from({ length: 514 }, (_, index) => `W2.${index + 1}`).join(' '),
    available({ state: 'unavailable', title: null, status: null, opens: null }),
  )
  await expect.poll(() => resolve.mock.calls.length).toBe(514)
  await expect
    .poll(
      () =>
        view.all('message-link').filter((button) => button.dataset.linkState === 'unavailable')
          .length,
    )
    .toBe(514)
  expect(
    view.all('message-link').every((button) => button.textContent?.includes('Unavailable')),
  ).toBe(true)
  words.value = 'W9.1'
  await expect.poll(() => resolve.mock.calls.length).toBe(515)
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('unavailable')
  words.value = 'W9.1 with more text'
  await nextTick()
  await new Promise<void>((done) => requestAnimationFrame(() => done()))
  expect(resolve).toHaveBeenCalledTimes(515)
})

it('previews the resolved title and status on hover and keyboard focus, and resolves again on click', async () => {
  const { view, resolve, open } = fixture('W2.1')
  await expect.poll(() => resolve.mock.calls.length).toBe(1)
  const button = view.q('message-link')
  button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await expect
    .poll(() => view.all('message-link-preview')[0]?.textContent)
    .toContain('A fictional draft')
  expect(view.q('message-link-preview').textContent).toContain('Working')
  button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  await nextTick()
  expect(view.all('message-link-preview')).toHaveLength(0)
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(button)
  await expect.poll(() => button.getAttribute('aria-describedby')).toBeTruthy()
  expect(getComputedStyle(button).outlineStyle).not.toBe('none')
  if (import.meta.env.VITE_W4649_CAPTURE)
    await page.screenshot({ element: view.host, path: '__screenshots__/message-link-preview.png' })
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => open.mock.calls.length).toBe(1)
  expect(resolve).toHaveBeenCalledTimes(4)
  expect(open).toHaveBeenCalledWith(available())
  expect(window.open).not.toHaveBeenCalled()
  expect(button.getAttribute('href')).toBeNull()
})

it('refreshes a renamed profile and its status on hover and focus before opening anything', async () => {
  const agent = available({
    kind: 'agent',
    title: 'Earlier name',
    status: 'Idle',
    opens: { identityId: 'aid:ana' },
  })
  const { view, resolve, open } = fixture('[Ana](brocrew://agent/aid%3Aana)', agent)
  await expect.poll(() => resolve.mock.calls.length).toBe(1)
  resolve.mockResolvedValueOnce({ ...agent, title: 'Current name', status: 'Working' })
  const button = view.q('message-link')
  button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await expect.poll(() => view.q('message-link-preview').textContent).toContain('Current name')
  expect(view.q('message-link-preview').textContent).toContain('Working')
  button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  resolve.mockResolvedValueOnce({ ...agent, title: 'Newest name', status: 'Idle' })
  button.focus()
  await expect.poll(() => view.q('message-link-preview').textContent).toContain('Newest name')
  expect(view.q('message-link-preview').textContent).toContain('Idle')
  expect(resolve).toHaveBeenCalledTimes(3)
  expect(open).not.toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
})

it('opens an agent by the decoded answer, with its own accessible indicator', async () => {
  const agent = available({
    kind: 'agent',
    title: 'Ana',
    status: null,
    opens: { identityId: 'aid:ana' },
  })
  const { view, open } = fixture('[Ana](brocrew://agent/aid%3Aana)', agent)
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('available')
  expect(view.q('message-link').querySelector('svg')?.getAttribute('aria-label')).toBe('Agent link')
  view.q('message-link').focus()
  await userEvent.keyboard(' ')
  await expect.poll(() => open.mock.calls.length).toBe(1)
  expect(open).toHaveBeenCalledWith(agent)
})

it.each([
  ['unavailable', "Couldn't open this link."],
  ['deleted', 'This work no longer exists.'],
] as const)(
  'keeps %s text marked unavailable and explains a failed press without opening anything',
  async (state, reason) => {
    const { view, open } = fixture(
      '[Old draft](brocrew://piece/gone)',
      available({ state, title: null, status: null, opens: null }),
    )
    await expect.poll(() => view.q('message-link').textContent).toContain('Unavailable')
    expect(view.q('message-link').textContent).toContain('Old draft')
    view.q('message-link').click()
    await expect.poll(() => view.all('message-link-failure')[0]?.textContent).toContain(reason)
    expect(open).not.toHaveBeenCalled()
    if (import.meta.env.VITE_W4649_CAPTURE && state === 'unavailable')
      await page.screenshot({
        element: view.host,
        path: '__screenshots__/message-link-unavailable.png',
      })
  },
)

it('treats a rejected resolver and a failed navigation as visible failures', async () => {
  const { view, resolve, open } = fixture('W8.1')
  await expect.poll(() => resolve.mock.calls.length).toBe(1)
  resolve.mockRejectedValueOnce(new Error('fictional read failed'))
  view.q('message-link').click()
  await expect.poll(() => view.all('message-link-failure').length).toBe(1)
  expect(open).not.toHaveBeenCalled()
  open.mockResolvedValueOnce(false)
  view.q('message-link').click()
  await expect.poll(() => open.mock.calls.length).toBe(1)
  expect(view.q('message-link-failure').textContent).toContain("Couldn't open this link.")
})

function failingFixture(target: string, answer: ResolvedMessageLink) {
  const scope = ref('first-conversation')
  const resolve = vi.fn<(target: string) => Promise<ResolvedMessageLink>>(async () => answer)
  const open = vi.fn<(answer: ResolvedMessageLink) => Promise<boolean>>(async () => true)
  const Holder = defineComponent({
    setup: () => () =>
      h(
        MessageLinks,
        { resolve, open, scope: scope.value },
        { default: () => [h(IconSprite), h(MarkdownWords, { text: target })] },
      ),
  })
  return { view: mount(Holder, {}, { width: 700, height: 500 }), scope, resolve }
}

const deletedAnswer = (kind: ResolvedMessageLink['kind']): ResolvedMessageLink => ({
  state: 'deleted',
  kind,
  title: null,
  status: null,
  opens: null,
})

it.each([
  ['agent', '[Fictional Ana](brocrew://agent/aid%3Aana)', 'This agent was deleted.'],
  ['piece', '[Old work](brocrew://piece/gone)', 'This work no longer exists.'],
] as const)('names a deleted %s in the failure', async (kind, text, reason) => {
  const { view } = failingFixture(text, deletedAnswer(kind))
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('unavailable')
  view.q('message-link').click()
  await expect.poll(() => view.all('message-link-failure')[0]?.textContent).toContain(reason)
})

it('lets the failure go after a few seconds', async () => {
  const { view } = failingFixture('[Old draft](brocrew://piece/gone)', deletedAnswer('piece'))
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('unavailable')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    view.q('message-link').click()
    await expect.poll(() => view.all('message-link-failure').length).toBe(1)
    vi.advanceTimersByTime(3100)
    await nextTick()
    expect(view.all('message-link-failure')).toHaveLength(1)
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(view.all('message-link-failure')).toHaveLength(0)
  } finally {
    vi.useRealTimers()
  }
})

it('lets the failure go when its close press is pressed', async () => {
  const { view } = failingFixture('[Old draft](brocrew://piece/gone)', deletedAnswer('piece'))
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('unavailable')
  view.q('message-link').click()
  await expect.poll(() => view.all('message-link-failure').length).toBe(1)
  const close = view.q('message-link-failure').querySelector('button')
  expect(close?.getAttribute('aria-label')).toBe('Close')
  close!.click()
  await expect.poll(() => view.all('message-link-failure').length).toBe(0)
})

it('lets the failure go when the conversation changes', async () => {
  const { view, scope } = failingFixture(
    '[Old draft](brocrew://piece/gone)',
    deletedAnswer('piece'),
  )
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('unavailable')
  view.q('message-link').click()
  await expect.poll(() => view.all('message-link-failure').length).toBe(1)
  scope.value = 'second-conversation'
  await expect.poll(() => view.all('message-link-failure').length).toBe(0)
})

it('keeps an agent indicator when its resolver cannot be reached', async () => {
  const { view, resolve, open } = fixture('[Ana](brocrew://agent/aid%3Aana)')
  resolve.mockRejectedValueOnce(new Error('fictional bridge unavailable'))
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('unavailable')
  expect(view.q('message-link').querySelector('svg')?.getAttribute('aria-label')).toBe('Agent link')
  resolve.mockRejectedValueOnce(new Error('still unavailable'))
  view.q('message-link').click()
  await expect.poll(() => view.all('message-link-failure').length).toBe(1)
  expect(open).not.toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
})

it('keeps the scheme kind for a missing agent and the conversation fallback for malformed targets', async () => {
  const { view, resolve, open } = fixture(
    '[Broken](brocrew:??bad) [Gone agent](brocrew://agent/bad-id)',
  )
  resolve.mockImplementation(async (target) =>
    available({
      state: 'unavailable',
      kind: target.includes('//agent/') ? 'agent' : 'conversation',
      title: null,
      status: null,
      opens: null,
    }),
  )
  await expect
    .poll(() =>
      view.all('message-link').every((button) => button.dataset.linkState === 'unavailable'),
    )
    .toBe(true)
  expect(
    view
      .all('message-link')
      .map((button) => button.querySelector('svg')?.getAttribute('aria-label')),
  ).toEqual(['Conversation link', 'Agent link'])
  view.all('message-link')[1]!.focus()
  await expect.poll(() => resolve.mock.calls.length).toBe(3)
  await new Promise<void>((done) => requestAnimationFrame(() => done()))
  expect(view.all('message-link-preview')).toHaveLength(0)
  view.all('message-link')[1]!.click()
  await expect.poll(() => view.all('message-link-failure').length).toBe(1)
  expect(open).not.toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
})

it('notices links in later messages, and a fresh click cannot use a formerly available answer', async () => {
  const { view, resolve, open, words } = fixture('An ordinary message')
  expect(resolve).not.toHaveBeenCalled()
  words.value = 'W9.1'
  await expect.poll(() => resolve.mock.calls.length).toBe(1)
  resolve.mockResolvedValueOnce(available({ state: 'unavailable', opens: null }))
  view.q('message-link').click()
  await expect.poll(() => view.all('message-link-failure').length).toBe(1)
  expect(open).not.toHaveBeenCalled()
})

it('waits for an older read, then takes a fresh unavailable decision on repeated labels', async () => {
  const { view, resolve, open } = fixture('W9.1 W9.1')
  let finish!: (answer: ResolvedMessageLink) => void
  resolve.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  await expect.poll(() => resolve.mock.calls.length).toBe(1)
  resolve.mockResolvedValueOnce(available({ state: 'unavailable', opens: null }))
  view.all('message-link')[0]!.click()
  await nextTick()
  await new Promise((done) => setTimeout(done, 0))
  expect(resolve).toHaveBeenCalledTimes(1)
  expect(open).not.toHaveBeenCalled()
  finish(available())
  await expect
    .poll(() =>
      view.all('message-link').every((button) => button.textContent?.includes('Unavailable')),
    )
    .toBe(true)
  await nextTick()
  await new Promise((done) => setTimeout(done, 0))
  expect(
    view.all('message-link').every((button) => button.dataset.linkState === 'unavailable'),
  ).toBe(true)
  expect(resolve).toHaveBeenCalledTimes(2)
  expect(open).not.toHaveBeenCalled()
})

it('keeps every brocrew destination off OS anchors, including refused images and malformed targets', () => {
  const document = renderMarkdown(
    '[open](BROCREW://unknown/elsewhere) ![image](brocrew://agent/aid%3Aana) [![nested](brocrew://piece/missing)](brocrew://conversation/fictional)',
  )
  const host = window.document.createElement('div')
  host.innerHTML = document
  expect(host.querySelectorAll('button[data-brocrew-target]')).toHaveLength(3)
  expect(host.querySelector('a')).toBeNull()
  expect(host.querySelector('img')).toBeNull()
})

it('wraps only typed work labels and keeps person textContent byte-equal, including Markdown-looking text', async () => {
  const text =
    '**Unformatted** W4.12. W4.12 Ana `W4.13`\r\n\r\n~~~text\nW4.14 [Ana](brocrew://agent/aid%3Aana)\n~~~\n\n[Ana](brocrew://agent/aid%3Aana) & <literal>\nC:\\W4.15 W4.16\\draft.md'
  const item = record([{ type: 'user_turn', text } as never]).transcript.items.find(
    (one) => one.kind === 'user',
  )!
  const resolve = vi.fn(async () => available())
  const Holder = defineComponent({
    setup: () => () =>
      h(
        MessageLinks,
        { resolve, open: async () => true },
        {
          default: () => h(UserMessage, { item }),
        },
      ),
  })
  const view = mount(Holder, {})
  expect(view.q('user-message').textContent).toBe(text)
  await expect.poll(() => view.all('message-link').length).toBe(4)
  expect(resolve).toHaveBeenCalledTimes(3)
  expect(view.q('user-message').textContent).toBe(text)
  expect(view.q('user-message').textContent).toContain(
    '~~~text\nW4.14 [Ana](brocrew://agent/aid%3Aana)\n~~~',
  )
  expect(view.q('user-message').querySelector('strong')).toBeNull()
  expect(view.all('message-link').map((button) => button.dataset.brocrewTarget)).toEqual([
    'W4.12',
    'W4.12',
    'W4.13',
    'W4.14',
  ])
  resolve.mockResolvedValueOnce(available({ state: 'unavailable', opens: null }))
  view.all('message-link')[0]!.click()
  await expect.poll(() => view.all('message-link')[0]!.dataset.linkState).toBe('unavailable')
  expect(view.q('user-message').textContent).toBe(text)
  expect(getComputedStyle(view.all('message-link')[0]!, '::after').content).toContain('Unavailable')
  expect(view.all('message-link')[0]!.getAttribute('aria-description')).toBe('Unavailable')
})

it('draws archived history without a composer or active answers and pages only through its read callback', async () => {
  const history = createWindow()
  history.hasOlder = true
  history.entries = HEADER_EVENTS.map(({ event, at }, ordinal) => ({
    sessionId: 'fictional-archive',
    ordinal,
    event,
    at,
  }))
  const loadOlder = vi.fn(async () => {})
  const view = mount(LinkedHistory, { history, title: 'Archived draft', loadOlder })
  expect(view.q('linked-history').dataset.readOnly).toBe('true')
  expect(view.host.querySelector('textarea')).toBeNull()
  expect(view.host.textContent).toContain('Read-only.')
  expect(view.q('linked-history').querySelector('h2')?.textContent).toBe('Archived draft')
  const authors = view.all('assistant-author')
  expect(authors.length).toBeGreaterThan(0)
  expect(authors.every((author) => author.textContent === 'Assistant')).toBe(true)
  expect(view.all('permission-answered')).toHaveLength(1)
  expect(view.all('permission-allow')).toHaveLength(0)
  expect(view.all('permission-deny')).toHaveLength(0)
  const older = view.host.querySelector<HTMLButtonElement>('[data-cy="load-older"]')
  expect(older).not.toBeNull()
  older!.click()
  await expect.poll(() => loadOlder.mock.calls.length).toBe(1)
})

it('debounces a quick pass over 20 links and cancels pointer reads when they scroll past', async () => {
  const { view, resolve, open } = fixture(
    Array.from({ length: 20 }, (_, index) => `W20.${index + 1}`).join(' '),
  )
  await expect.poll(() => resolve.mock.calls.length).toBe(20)
  await expect
    .poll(() => view.all('message-link').every((one) => one.dataset.linkState === 'available'))
    .toBe(true)
  resolve.mockClear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const links = view.all('message-link')
    for (const one of links) {
      one.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(5)
      one.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    }
    await vi.advanceTimersByTimeAsync(200)
    expect(resolve).not.toHaveBeenCalled()
    const last = links[19]!
    last.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(100)
    window.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(100)
    expect(resolve).not.toHaveBeenCalled()
    last.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(100)
    last.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(25)
    last.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(149)
    expect(resolve).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(resolve.mock.calls).toEqual([['W20.20']])
    expect(open).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it('shares one fresh request across focus, repeated hover and a click while it is pending', async () => {
  const { view, resolve, open } = fixture('W21.1 W21.1')
  await expect
    .poll(() => view.all('message-link').every((one) => one.dataset.linkState === 'available'))
    .toBe(true)
  let finish!: (answer: ResolvedMessageLink) => void
  resolve.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  const [first, second] = view.all('message-link')
  first!.focus()
  await expect.poll(() => resolve.mock.calls.length).toBe(2)
  second!.focus()
  first!.focus()
  first!.click()
  await new Promise((done) => setTimeout(done, 200))
  expect(resolve).toHaveBeenCalledTimes(2)
  expect(open).not.toHaveBeenCalled()
  finish(available())
  await expect.poll(() => open.mock.calls.length).toBe(1)
  expect(open).toHaveBeenCalledWith(available())
  expect(resolve).toHaveBeenCalledTimes(2)
})

it('keeps middle click and drag internal, and copies link text from its context menu', async () => {
  const { view, open } = fixture('[Fictional draft](brocrew://conversation/fictional-draft)')
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('available')
  const button = view.q('message-link')
  const middle = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
  button.dispatchEvent(middle)
  expect(middle.defaultPrevented).toBe(true)
  const transfer = new DataTransfer()
  const drag = new DragEvent('dragstart', {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
  })
  button.dispatchEvent(drag)
  expect(drag.defaultPrevented).toBe(true)
  expect(transfer.getData('text/uri-list')).toBe('')
  window.getSelection()?.removeAllRanges()
  button.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
  )
  expect(window.getSelection()?.toString()).toBe('Fictional draft')
  const copied = new DataTransfer()
  const copy = new ClipboardEvent('copy', {
    bubbles: true,
    cancelable: true,
    clipboardData: copied,
  })
  button.dispatchEvent(copy)
  expect(copy.defaultPrevented).toBe(true)
  expect(copied.getData('text/plain')).toBe('Fictional draft')
  expect(copied.getData('text/uri-list')).toBe('')
  expect(button.getAttribute('href')).toBeNull()
  expect(open).not.toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
  window.getSelection()?.removeAllRanges()
})

it('keeps a long archived transcript inside a short viewport and scrolls both ends into view', async () => {
  const original = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1000, 420)
  try {
    const history = createWindow()
    history.entries = Array.from({ length: 200 }, (_, ordinal): RuntimeEventMessage => ({
      sessionId: 'fictional-long-archive',
      ordinal,
      at: 1700000000000 + ordinal,
      event:
        ordinal % 2 === 0
          ? {
              type: 'user_turn',
              text: `Archived message ${ordinal + 1}. Please keep this fictional draft readable.`,
            }
          : {
              type: 'assistant_message',
              text: `Archived message ${ordinal + 1}. This fictional reply stays in the retained history.`,
            },
    }))
    // As the screen's main area holds it: a column that does not scroll itself.
    const Holder = defineComponent({
      setup: () => () =>
        h(
          'main',
          {
            style:
              'display:flex;flex-direction:column;min-height:0;overflow:hidden;height:100%;width:100%',
          },
          [
            h(LinkedHistory, {
              history,
              title: 'Long archived draft',
              loadOlder: async () => {},
            }),
          ],
        ),
    })
    const view = mount(Holder, {}, { width: 1000, height: 420 })
    await nextTick()
    await new Promise<void>((done) => requestAnimationFrame(() => done()))
    const panel = view.q('linked-history')
    const stream = view.q('transcript')
    const bounds = panel.getBoundingClientRect()
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
    expect(stream.clientHeight).toBeGreaterThan(0)
    expect(stream.scrollHeight).toBeGreaterThan(stream.clientHeight)
    const first = stream.querySelector<HTMLElement>('[data-ordinal="0"]')
    const last = stream.querySelector<HTMLElement>('[data-ordinal="199"]')
    expect(first).not.toBeNull()
    expect(last).not.toBeNull()
    const visible = (row: HTMLElement): boolean => {
      const box = row.getBoundingClientRect()
      const viewport = stream.getBoundingClientRect()
      return box.height > 0 && box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1
    }
    stream.scrollTop = 0
    stream.dispatchEvent(new Event('scroll'))
    await expect.poll(() => visible(first!)).toBe(true)
    expect(visible(last!)).toBe(false)
    stream.scrollTop = stream.scrollHeight
    stream.dispatchEvent(new Event('scroll'))
    await expect.poll(() => visible(last!)).toBe(true)
    expect(visible(first!)).toBe(false)
    expect(panel.querySelector('h2')!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      bounds.top,
    )
  } finally {
    unmountAll()
    await page.viewport(original.width, original.height)
  }
})

it('resolves and opens archived links once in nested scopes before and after teleporting', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const teleported = ref(false)
  const resolve = vi.fn(async () => available())
  const open = vi.fn(async () => true)
  const history = createWindow()
  history.entries = [
    {
      sessionId: 'fictional-archive',
      ordinal: 0,
      at: 1700000000000,
      event: { type: 'assistant_message', text: 'See W30.1.' },
    },
  ]
  const Holder = defineComponent({
    setup: () => () =>
      h(
        MessageLinks,
        { resolve, open },
        {
          default: () =>
            h(Teleport, { to: target, disabled: !teleported.value }, [
              h(
                MessageLinks,
                { resolve, open },
                {
                  default: () =>
                    h(LinkedHistory, {
                      history,
                      title: 'Archived draft',
                      loadOlder: async () => {},
                    }),
                },
              ),
            ]),
        },
      ),
  })
  try {
    const view = mount(Holder, {})
    await expect.poll(() => resolve.mock.calls.length).toBe(1)
    view.q('message-link').click()
    await expect.poll(() => open.mock.calls.length).toBe(1)
    expect(resolve).toHaveBeenCalledTimes(2)
    teleported.value = true
    await nextTick()
    const moved = target.querySelector<HTMLButtonElement>('[data-cy="message-link"]')
    expect(moved).not.toBeNull()
    expect(view.all('message-link')).toHaveLength(0)
    moved!.focus()
    await expect.poll(() => resolve.mock.calls.length).toBe(3)
    moved!.click()
    await expect.poll(() => open.mock.calls.length).toBe(2)
    expect(resolve).toHaveBeenCalledTimes(4)
    expect(window.open).not.toHaveBeenCalled()
    // On the screen the archive is a page of the main area, inside the screen's own link scope.
    const source = (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')).default
    const at = source.indexOf('<LinkedHistory\n', source.indexOf('<template>'))
    expect(at).toBeGreaterThan(-1)
    const scope = source.indexOf(
      '<MessageLinks :resolve="resolveMessageLink" :open="openMessageDestination">',
    )
    expect(scope).toBeGreaterThan(-1)
    expect(scope).toBeLessThan(at)
    expect(source.indexOf('</MessageLinks>', scope)).toBeGreaterThan(at)
    expect(source.lastIndexOf('<main', at)).toBeGreaterThan(source.lastIndexOf('</main>', at))
  } finally {
    unmountAll()
    target.remove()
  }
})
