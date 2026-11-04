import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { providerForALaunch } from '../../src/renderer/src/lib/agent-store'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../../src/renderer/src/lib/launch-choices'
import { DEFAULT_PROFILE_ID, type Provider } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'
import { assertDrawn, drawnReady } from './drawn'

const REAL = { width: 1200, height: 808 }
const PANE = { width: REAL.width - 208, height: REAL.height }
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
function installBridge(): void {
  ;(window as unknown as { api: unknown }).api = {
    runtime: { checkProviderAuth: () => Promise.resolve({ state: 'usable' }) },
  }
}

/**
 * The front door under a frame that owns what `RuntimeScreen` owns.
 *
 * ⚑ **UI-012 · the state a person settles into** — and since the model picker's panel holds what
 * the list says, the column's standing prose is at its shortest in every state, which is the state
 * `EXT-010` §2.1's complaint has to survive being measured in.
 */
function open(over: Record<string, unknown> = {}): Mounted {
  installBridge()
  const words = ref('')
  const choices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES, ...(over.seed as object) })
  const book = createAttachmentBook()
  const resolved = computed<Provider>(() =>
    providerForALaunch(null, DEFAULT_PROFILE_ID, 'claude', choices.value.provider),
  )
  const Frame = defineComponent({
    name: 'StartTypingFrame',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: false,
          error: null,
          debug: false,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          defaultProvider: resolved.value,
          defaultApprovalMode: 'ask',
          capabilities: allProviderCapabilities(),
          choices: choices.value,
          onStart: () => {},
          'onUpdate:draft': (text: string) => (words.value = text),
          'onUpdate:choices': (next: LaunchChoices) => (choices.value = next),
          ...over,
        })
    },
  })
  return mount(Frame, {}, { width: PANE.width, height: PANE.height })
}

afterEach(async () => {
  unmountAll()
  delete (window as { api?: unknown }).api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

// The approved launcher removes the standing explanations and saved-default editor.
// Keep its keyboard and reading-cost checks on the controls that now exist.
function tabOrder(m: Mounted): HTMLElement[] {
  return [
    ...m
      .q('new-conversation-surface')
      .querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
  ].filter((el) => el.checkVisibility() && el.tabIndex >= 0)
}
const caretIn = async (m: Mounted) => {
  await vi.waitFor(() => expect(document.activeElement).toBe(m.q('prompt-input')), {
    timeout: 4000,
  })
}
describe('the short launcher keeps typing first', () => {
  it('draws the heading, composer and model choice without the removed explanations', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await nextTick()
    await drawnReady()
    expect(m.host.textContent).toContain('What should we work through?')
    for (const cy of [
      'provider-is-fixed',
      'launcher-why-credential',
      'launcher-why-approval',
      'launch-approval-mode',
    ])
      expect(m.all(cy)).toHaveLength(0)
    expect(m.q('launcher-column').querySelectorAll('.note')).toHaveLength(1)
    assertDrawn(m.q('first-approval-description'), 'the preselected mode explains its consequence')
    assertDrawn(m.q('model-picker-face'), 'the model choice stays readable')
    expect(m.q('prompt-input').getBoundingClientRect().height).toBeGreaterThan(0)
  })
  it('starts in the composer and retains the native keyboard order', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open()
    await caretIn(m)
    expect(tabOrder(m).map((el) => el.dataset.cy)).toEqual([
      'toggle-debug-mode',
      'prompt-input',
      'attach-path',
      'model-picker-face',
      'choose-ask',
      'choose-auto',
    ])
    expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
    await userEvent.tab({ shift: true })
    await vi.waitFor(() => expect(document.activeElement).toBe(m.q('toggle-debug-mode')))
  })
  it('leaves both explicit choices unselected before the first start', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open({ approvalDefaultChosen: false })
    await caretIn(m)
    expect(
      tabOrder(m)
        .map((el) => el.dataset.cy)
        .slice(-2),
    ).toEqual(['choose-ask', 'choose-auto'])
    for (const cy of ['choose-ask', 'choose-auto'])
      expect(m.q(cy).getAttribute('aria-pressed')).toBe('false')
    m.q('choose-auto').focus()
    await userEvent.keyboard('{Enter}')
    await nextTick()
    expect(m.q('choose-auto').getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(m.q('choose-auto'))
    assertDrawn(m.q('first-approval-description'), 'the selected mode explains its consequence')
  })
  it('does not send while the saved policy has not been read', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = open({ defaultApprovalMode: null, draft: 'A menu' })
    await nextTick()
    m.q('choose-ask').click()
    await nextTick()
    expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
  })
})
