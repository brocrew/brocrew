import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import CardApproval from '../../src/renderer/src/components/CardApproval.vue'
import type { ApprovalControl } from '../../src/renderer/src/composables/useConversationControls'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { createLaunchGuard, saveFirstApproval } from '../../src/renderer/src/lib/first-approval'
import type { CreateSessionInput } from '../../src/shared/runtime-ipc'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { providersBridge } from '../../look/fixtures/providers'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll } from './harness'
import { assertDrawn, drawnReady } from './drawn'

const originalViewport = { width: window.innerWidth, height: window.innerHeight }
beforeEach(async () => {
  await page.viewport(1180, 1000)
})
afterEach(async () => {
  unmountAll()
  await page.viewport(originalViewport.width, originalViewport.height)
})
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}

it.each(['ask', 'auto'] as const)(
  'blocks button and keyboard until %s is chosen, without saving on selection',
  async (mode) => {
    providersBridge()
    const start = vi.fn()
    const save = vi.fn()
    const m = mount(
      NewConversation,
      {
        busy: false,
        error: null,
        debug: false,
        draft: 'Write a bakery menu.',
        recent: [],
        defaultProvider: 'claude',
        defaultApprovalMode: 'ask',
        approvalDefaultChosen: false,
        capabilities: CAPABILITY_FIXTURE,
        choices: NO_LAUNCH_CHOICES,
        lists: createModelLists(() => window.api.runtime),
        handing: createAttachmentBook().handing(NEW_CONVERSATION),
        onStart: start,
        onSetApprovalDefault: save,
      },
      { width: 1180, height: 1000 },
    )
    await settle()
    await drawnReady()
    const send = m.q('send-prompt') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    const field = m.host.querySelector('textarea')!
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true }),
    )
    expect(start).not.toHaveBeenCalled()
    expect(m.all('first-approval-description')).toHaveLength(0)
    expect(m.q('first-approval-choice').querySelector('.governs')?.textContent?.trim()).toBe(
      'CHOOSE HOW THIS AGENT WORKS',
    )
    expect(m.q('choose-ask').getAttribute('aria-pressed')).toBe('false')
    expect(m.q('choose-auto').getAttribute('aria-pressed')).toBe('false')
    expect(m.host.textContent).toContain('Choose Ask or Auto before sending.')
    m.q('choose-' + mode).click()
    await settle()
    expect(send.disabled).toBe(false)
    assertDrawn(m.q('first-approval-description'), 'chosen mode description')
    expect(m.q('first-approval-description').textContent).toContain(
      mode === 'ask'
        ? 'Asks when an action needs permission.'
        : 'Runs without asking. Use it only where you trust the agent with your files.',
    )
    expect(save).not.toHaveBeenCalled()
    send.click()
    await settle()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0]![0].approvalMode).toBe(mode)
    expect(m.all('launch-approval')).toHaveLength(0)
  },
)

it.each([null, 'ask', 'auto'] as const)(
  'an unread default sends nothing by button or keyboard, with %s chosen',
  async (mode) => {
    providersBridge()
    const start = vi.fn()
    const m = mount(
      NewConversation,
      {
        busy: false,
        error: null,
        debug: false,
        draft: 'Write a bakery menu.',
        recent: [],
        defaultProvider: 'claude',
        defaultApprovalMode: null,
        capabilities: CAPABILITY_FIXTURE,
        choices: NO_LAUNCH_CHOICES,
        lists: createModelLists(() => window.api.runtime),
        handing: createAttachmentBook().handing(NEW_CONVERSATION),
        onStart: start,
      },
      { width: 1180, height: 1000 },
    )
    await settle()
    if (mode !== null) {
      m.q('choose-' + mode).click()
      await settle()
    }
    const send = m.q('send-prompt') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    send.click()
    m.host
      .querySelector('textarea')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true }),
      )
    await settle()
    expect(start).not.toHaveBeenCalled()
  },
)

it.each(['ask', 'auto'] as const)(
  'preselects saved %s and changes only this launch, leaving its default alone',
  async (mode) => {
    providersBridge()
    const savedDefault = ref(mode)
    const save = vi.fn(async (next: 'ask' | 'auto') => {
      savedDefault.value = next
      return null
    })
    const start = vi.fn(async (input: CreateSessionInput) => {
      await saveFirstApproval('fictional-new', input.approvalMode, true, save)
    })
    const m = mount(NewConversation, {
      busy: false,
      error: null,
      debug: false,
      draft: 'Write a menu.',
      recent: [],
      defaultProvider: 'claude',
      defaultApprovalMode: savedDefault.value,
      approvalDefaultChosen: true,
      capabilities: CAPABILITY_FIXTURE,
      choices: NO_LAUNCH_CHOICES,
      lists: createModelLists(() => window.api.runtime),
      handing: createAttachmentBook().handing(NEW_CONVERSATION),
      onStart: start,
    })
    await settle()
    await drawnReady()
    assertDrawn(m.q('first-approval-choice'), 'per-conversation approval choice')
    expect(m.q('first-approval-choice').querySelector('.governs')?.textContent?.trim()).toBe(
      'HOW THIS AGENT WORKS',
    )
    expect(m.q('choose-' + mode).getAttribute('aria-pressed')).toBe('true')
    expect(m.q('first-approval-description').textContent).toContain(
      mode === 'ask'
        ? 'Asks when an action needs permission.'
        : 'Runs without asking. Use it only where you trust the agent with your files.',
    )
    expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(false)
    const next = mode === 'ask' ? 'auto' : 'ask'
    m.q('choose-' + next).click()
    await settle()
    expect(m.q('choose-' + next).getAttribute('aria-pressed')).toBe('true')
    expect(m.q('choose-' + mode).getAttribute('aria-pressed')).toBe('false')
    expect(m.q('first-approval-description').textContent).toContain(
      next === 'ask'
        ? 'Asks when an action needs permission.'
        : 'Runs without asking. Use it only where you trust the agent with your files.',
    )
    expect(save).not.toHaveBeenCalled()
    m.q('send-prompt').click()
    await settle()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0]![0].approvalMode).toBe(next)
    expect(save).not.toHaveBeenCalled()
    expect(savedDefault.value).toBe(mode)
  },
)

// The switch now moves immediately; a refused request restores its previous side.
it('a switch moves at once and returns to the saved state on refusal', async () => {
  const approval = reactive<{ -readonly [K in keyof ApprovalControl]: ApprovalControl[K] }>({
    mode: 'ask',
    pending: null,
    word: 'Ask',
    pendingLine: null,
    changeable: true,
    label: 'Approval mode',
    now: 'Asks when an action needs permission.',
    note: '',
    reach: '',
    next: 'auto',
    confirmWords: 'Auto',
    saving: false,
  })
  let finish: () => void = () => {}
  const save = vi.fn(async () => {
    approval.pending = 'auto'
    approval.saving = true
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    approval.pending = null
    approval.saving = false
  })
  const m = mount(
    defineComponent({ setup: () => () => h(CardApproval, { approval, onChoose: save }) }),
    {},
    { width: 350, height: 80 },
  )
  const input = m.q('card-approval') as HTMLInputElement
  input.click()
  await settle()
  expect(input.disabled).toBe(true)
  expect(input.checked).toBe(true)
  finish()
  await settle()
  expect(input.disabled).toBe(false)
  expect(input.checked).toBe(false)
  approval.mode = 'auto'
  await settle()
  expect(input.checked).toBe(true)
  approval.changeable = false
  await settle()
  expect(input.disabled).toBe(true)
})

it.each([null, 'Could not save the default.'])(
  'holds through save, releases at navigation and retains a refused choice (%s)',
  async (refusal) => {
    providersBridge()
    const guard = createLaunchGuard()
    const draft = ref('Write a bakery menu.')
    const error = ref<string | null>(null)
    const chosen = ref(false)
    const navigated = ref(false)
    const creating = ref(false)
    const create = vi.fn(async (input: CreateSessionInput) => {
      creating.value = true
      await nextTick()
      creating.value = false
      return `fictional-${input.approvalMode}`
    })
    let finishSave: (result: string | null) => void = () => {}
    const save = vi.fn(async (mode: 'ask' | 'auto') => {
      expect(mode).toBe('auto')
      const result = await new Promise<string | null>((resolve) => {
        finishSave = resolve
      })
      if (result === null) chosen.value = true
      return result
    })
    let finishNavigation: () => void = () => {}
    const navigate = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishNavigation = resolve
      })
      navigated.value = true
    })
    const finishSends: (() => void)[] = []
    const sendMessage = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishSends.push(resolve)
      })
    })
    const start = (input: CreateSessionInput, message: string) =>
      guard.run(async (release) => {
        error.value = null
        const opened = await create(input)
        const said = await saveFirstApproval(opened, input.approvalMode, chosen.value, save)
        if (said !== null) {
          error.value = said
          draft.value = message
          return
        }
        await navigate()
        release()
        await sendMessage()
      })
    const lists = createModelLists(() => window.api.runtime)
    const handing = createAttachmentBook().handing(NEW_CONVERSATION)
    const m = mount(
      defineComponent({
        setup: () => () =>
          h(NewConversation, {
            busy: guard.busy.value || creating.value,
            error: error.value,
            debug: false,
            draft: draft.value,
            recent: [],
            defaultProvider: 'claude',
            defaultApprovalMode: chosen.value ? 'auto' : 'ask',
            approvalDefaultChosen: chosen.value,
            capabilities: CAPABILITY_FIXTURE,
            choices: NO_LAUNCH_CHOICES,
            lists,
            handing,
            onStart: start,
            'onUpdate:draft': (text: string) => {
              draft.value = text
            },
          }),
      }),
      {},
      { width: 1180, height: 1000 },
    )
    await settle()
    m.q('choose-auto').click()
    await settle()
    const send = m.q('send-prompt') as HTMLButtonElement
    const field = m.host.querySelector('textarea')!
    send.click()
    await settle()
    expect(creating.value).toBe(false)
    expect(guard.busy.value).toBe(true)
    expect(send.disabled).toBe(true)
    expect((m.q('choose-ask') as HTMLButtonElement).disabled).toBe(true)
    send.click()
    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
      }),
    )
    // Also reject a second event before Vue has propagated a busy prop.
    await start({ provider: 'claude', profileId: 'default', approvalMode: 'ask' }, 'Second send')
    await settle()
    expect(create).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('auto')
    expect(navigate).not.toHaveBeenCalled()
    finishSave(refusal)
    await settle()
    if (refusal !== null) {
      expect(guard.busy.value).toBe(false)
      expect(navigated.value).toBe(false)
      expect(field.value).toBe('Write a bakery menu.')
      expect(m.q('choose-auto').getAttribute('aria-pressed')).toBe('true')
      expect(send.disabled).toBe(false)
      expect(sendMessage).not.toHaveBeenCalled()
      assertDrawn(m.q('first-approval-description'), 'retained Auto choice')
    } else {
      expect(guard.busy.value).toBe(true)
      expect(send.disabled).toBe(true)
      expect(navigate).toHaveBeenCalledTimes(1)
      finishNavigation()
      await settle()
      expect(navigated.value).toBe(true)
      expect(guard.busy.value).toBe(false)
      expect(sendMessage).toHaveBeenCalledTimes(1)
      // The first message acknowledgment is still unresolved when another launch starts.
      draft.value = 'Write a second menu.'
      await settle()
      expect(send.disabled).toBe(false)
      send.click()
      await settle()
      expect(create).toHaveBeenCalledTimes(2)
      expect(navigate).toHaveBeenCalledTimes(2)
      expect(guard.busy.value).toBe(true)
      finishSends[0]!()
      await settle()
      expect(guard.busy.value).toBe(true)
      expect(send.disabled).toBe(true)
      finishNavigation()
      await settle()
      expect(guard.busy.value).toBe(false)
      expect(sendMessage).toHaveBeenCalledTimes(2)
      finishSends[1]!()
      await settle()
    }
    expect(save).toHaveBeenCalledTimes(1)
  },
)
