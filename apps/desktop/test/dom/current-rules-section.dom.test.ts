import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { page } from 'vitest/browser'
import CurrentRulesSection from '../../src/renderer/src/components/CurrentRulesSection.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import type { CurrentRules, CurrentRulesResult } from '../../src/shared/conversation-title'
import { mount, unmountAll } from './harness'

afterEach(() => unmountAll())

const RULES =
  'Every turn: look at who is working and the pace.\nIf few agents are working, start real work now.'

function shown(first: CurrentRules, save?: (text: string) => Promise<CurrentRulesResult>) {
  const rules = ref(first)
  const wrapper = defineComponent({
    setup: () => () => [h(IconSprite), h(CurrentRulesSection, { rules: rules.value, save })],
  })
  return { ...mount(wrapper, {}, { width: 460, height: 360 }), rules }
}

describe('the current rules on the agent card', () => {
  it('says they go with every turn, their size against the bound, and who set them', async () => {
    const view = shown({ text: RULES, by: 'agent', at: Date.now() - 2 * 3_600_000 })
    expect(view.q('card-rules').textContent).toContain(
      `Current rules · sent with every turn (${RULES.length}/1,280)`,
    )
    expect(view.q('card-rules-changed').textContent).toBe('Set by the agent · 2h ago')
    // Nothing to press where the window cannot write them.
    expect(view.all('card-rules-edit')).toHaveLength(0)
    expect(view.all('card-rules-delete')).toHaveLength(0)
  })

  it('lets the person edit them, counting the draft, and save one new text', async () => {
    const save = vi.fn(async (): Promise<CurrentRulesResult> => ({ ok: true }))
    const view = shown({ text: RULES, by: 'agent', at: Date.now() }, save)
    await page.screenshot({ element: view.host, path: '__screenshots__/current-rules-shown.png' })
    view.q('card-rules-edit').click()
    await vi.waitFor(() => expect(view.all('card-rules-input')).toHaveLength(1))
    const input = view.q('card-rules-input') as HTMLTextAreaElement
    expect(input.value).toBe(RULES)
    input.value = 'Keep the pace at two an hour.'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(view.q('card-rules-size').textContent).toContain('(29/1,280)'))
    await page.screenshot({ element: view.host, path: '__screenshots__/current-rules-editing.png' })
    // The panel re-reads on any work in the app: the same rules read again keep the edit open.
    view.rules.value = { ...view.rules.value }
    await nextTick()
    expect(view.all('card-rules-input')).toHaveLength(1)
    view.q('card-rules-save').click()
    await vi.waitFor(() => expect(view.all('card-rules-input')).toHaveLength(0))
    expect(save).toHaveBeenCalledExactlyOnceWith('Keep the pace at two an hour.')
  })

  it('deletes them only once the person confirms, and shows a refusal', async () => {
    const save = vi.fn(async (): Promise<CurrentRulesResult> => ({
      ok: false,
      reason: 'Conversation not found.',
    }))
    const view = shown({ text: RULES, by: 'person', at: Date.now() - 5 * 60_000 }, save)
    expect(view.q('card-rules-changed').textContent).toBe('Set by you · 5m ago')
    view.q('card-rules-delete').click()
    await vi.waitFor(() => expect(view.all('card-rules-delete-confirmation')).toHaveLength(1))
    expect(save).not.toHaveBeenCalled()
    await page.screenshot({ element: view.host, path: '__screenshots__/current-rules-delete.png' })
    view.q('card-rules-delete-confirm').click()
    await vi.waitFor(() =>
      expect(view.q('card-rules-refused').textContent?.trim()).toBe('Conversation not found.'),
    )
    expect(save).toHaveBeenCalledExactlyOnceWith('')
  })
})
