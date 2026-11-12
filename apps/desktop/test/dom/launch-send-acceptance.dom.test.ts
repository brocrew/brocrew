import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import { createDraftBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

function open(surface: 'launcher' | 'agent') {
  const book = createDraftBook()
  const key = surface === 'launcher' ? NEW_CONVERSATION : 'new-agent:fictional'
  const shown = ref(true)
  let answer!: (ok: boolean) => void
  let finished: Promise<void> | undefined
  let calls = 0
  const accepted = new Promise<boolean>((resolve) => {
    answer = resolve
  })
  const submit = async () => {
    finished = book.send(key, () => {
      calls += 1
      return accepted
    })
    await finished
  }
  const Host = defineComponent({
    setup() {
      return () =>
        shown.value
          ? h(surface === 'launcher' ? NewConversation : (StartAsAgent as Component), {
              busy: false,
              error: null,
              draft: book.read(key),
              handing: book.paths.handing(key),
              'onUpdate:draft': (text: string) => book.write(key, text),
              defaultProvider: 'codex',
              provider: 'codex',
              profileSlug: 'fictional',
              defaultApprovalMode: 'ask',
              approvalDefaultChosen: true,
              capabilities: null,
              choices: NO_LAUNCH_CHOICES,
              agents: { identities: ref(null) } as unknown as AgentStore,
              submit,
            })
          : null
    },
  })
  const view = mount(Host, {}, { width: 1000, height: 900 })
  const type = async (text: string) => {
    const box = view.q('prompt-input') as HTMLTextAreaElement
    box.value = text
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  return { book, key, view, type, answer, shown, calls: () => calls, settled: () => finished }
}

for (const surface of ['launcher', 'agent'] as const) {
  it.each([false, true])(
    `${surface}: retain pending text, then settle acceptance=%s`,
    async (ok) => {
      const { book, key, view, type, answer, settled } = open(surface)
      await type('Please inspect this')
      if (surface === 'launcher')
        book.paths
          .handing(key)
          .stage([{ path: '/fictional/notes.md', kind: 'file', outsideCwd: false }])
      ;(view.q('send-prompt') as HTMLButtonElement).click()
      await nextTick()
      expect((view.q('prompt-input') as HTMLTextAreaElement).value).toBe('Please inspect this')
      expect(book.read(key)).toBe('Please inspect this')
      answer(ok)
      await settled()
      await nextTick()
      expect(book.read(key)).toBe(ok ? '' : 'Please inspect this')
      if (surface === 'launcher') expect(book.paths.read(key)).toHaveLength(ok ? 0 : 1)
    },
  )

  it(`${surface}: acceptance preserves newer input after leaving the surface`, async () => {
    const { book, key, view, type, answer, shown, settled } = open(surface)
    await type('Please inspect this')
    ;(view.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()
    await type('A newer thought')
    shown.value = false
    await nextTick()
    answer(true)
    await settled()
    expect(book.read(key)).toBe('A newer thought')
  })
}
