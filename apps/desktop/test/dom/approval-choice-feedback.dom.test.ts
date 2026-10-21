import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import type { ApprovalModeDisclosure, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, unmountAll } from './harness'
import { assertDrawn, drawnReady } from './drawn'

const originalViewport = { width: window.innerWidth, height: window.innerHeight }
beforeEach(async () => {
  await page.viewport(1440, 1100)
})
const dispose: (() => void)[] = []
afterEach(async () => {
  unmountAll()
  dispose.splice(0).forEach((stop) => stop())
  await page.viewport(originalViewport.width, originalViewport.height)
})
const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function screen(mode: 'ask' | 'auto') {
  const answers: {
    resolve: (value: ApprovalModeDisclosure) => void
    reject: (error: Error) => void
  }[] = []
  const setApprovalMode = vi.fn(
    () =>
      new Promise<ApprovalModeDisclosure>((resolve, reject) => answers.push({ resolve, reject })),
  )
  const store = createSessionStore({
    onEvent: () => () => {},
    onLiveness: () => () => {},
    createSession: async () => ({ ...META, approvalMode: mode }),
    setApprovalMode,
  } as unknown as RuntimeBridge)
  dispose.push(() => store.dispose())
  const id = (await store.create({ provider: 'claude' }))!
  const record = store.get(id)!
  const m = mount(
    defineComponent({
      setup: () => () =>
        h(ConversationPane, {
          ...paneProps({ record, drawerOpen: true, drawerTab: 'open' }),
          onSetApprovalMode: (choice: 'ask' | 'auto') => void store.setApprovalMode(id, choice),
        }),
    }),
    {},
    { width: 1180, height: 1000 },
  )
  await settle()
  await drawnReady()
  return { m, record, answers, setApprovalMode }
}

it.each(['ask', 'auto'] as const)(
  'moves from %s at once, uses accent pending words, and cancels by clicking back',
  async (mode) => {
    const { m, record, answers, setApprovalMode } = await screen(mode)
    const next = mode === 'ask' ? 'auto' : 'ask'
    const nextWord = next === 'auto' ? 'Auto' : 'Ask'
    const nowWord = mode === 'auto' ? 'Auto' : 'Ask'
    const input = m.q('card-approval') as HTMLInputElement
    input.click()
    // The native switch and the actual store move before any host acknowledgement.
    expect(input.checked).toBe(next === 'auto')
    expect(record.meta?.approvalMode).toBe(mode)
    expect(record.meta?.pendingApprovalMode).toBe(next)
    await settle()
    expect(input.disabled).toBe(true)
    const line = m.q('card-approval-pending')
    expect(line.textContent?.trim()).toBe(`${nextWord} starts with your next message.`)
    const accent = document.createElement('span')
    accent.style.color = 'var(--accent-text)'
    line.append(accent)
    expect(getComputedStyle(line).color).toBe(getComputedStyle(accent).color)
    accent.remove()
    assertDrawn(line, 'pending approval choice')
    expect(m.q('session-approval-indicator').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `${nowWord} → ${nextWord} next message`,
    )
    expect(m.host.textContent).not.toMatch(/\bYOLO\b/)
    expect(m.all('live-settings-pending')).toHaveLength(0)
    answers[0]!.resolve({
      approvalMode: mode,
      pendingApprovalMode: next,
      approvalNote: nowWord,
      blanketGrants: [],
    })
    await settle()
    expect(input.disabled).toBe(false)
    input.click()
    expect(input.checked).toBe(mode === 'auto')
    await settle()
    expect(setApprovalMode).toHaveBeenLastCalledWith({ sessionId: META.sessionId, mode })
    expect(m.all('card-approval-pending')).toHaveLength(0)
    answers[1]!.resolve({
      approvalMode: mode,
      pendingApprovalMode: null,
      approvalNote: nowWord,
      blanketGrants: [],
    })
    await settle()
    expect(input.checked).toBe(mode === 'auto')
  },
)

it('removes pending words when the next message adopts the mode', async () => {
  const { m, record, answers } = await screen('auto')
  const input = m.q('card-approval') as HTMLInputElement
  input.click()
  await settle()
  answers[0]!.resolve({
    approvalMode: 'auto',
    pendingApprovalMode: 'ask',
    approvalNote: 'Auto',
    blanketGrants: [],
  })
  await settle()
  record.meta = { ...record.meta!, approvalMode: 'ask', pendingApprovalMode: null }
  await settle()
  expect(input.checked).toBe(false)
  expect(m.all('card-approval-pending')).toHaveLength(0)
  expect(m.q('session-approval-indicator').textContent?.trim()).toBe('Ask')
})

it.each([false, true])(
  'reverts a failed change or cancellation, preserving the prior choice (pending=%s)',
  async (pending) => {
    const { m, record, answers } = await screen('auto')
    if (pending) record.meta = { ...record.meta!, pendingApprovalMode: 'ask' }
    await settle()
    const input = m.q('card-approval') as HTMLInputElement
    const before = input.checked
    input.click()
    expect(input.checked).toBe(!before)
    await settle()
    answers[0]!.reject(new Error('Could not save the mode.'))
    await settle()
    expect(input.checked).toBe(before)
    expect(input.disabled).toBe(false)
    expect(record.meta?.approvalMode).toBe('auto')
    expect(record.meta?.pendingApprovalMode).toBe(pending ? 'ask' : null)
    expect(m.q('session-error').textContent).toContain('Could not save the mode.')
  },
)
