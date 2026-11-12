import {
  installRuntimeScreenFixture,
  disposeRuntimeScreenFixture,
  runtime,
  sessions,
} from './runtime-screen-fixture'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import type { SavedDrafts } from '../../src/shared/saved-drafts'
import { newAgentDraftSlot } from '../../src/shared/saved-drafts'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { mount } from './harness'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')
beforeEach(installRuntimeScreenFixture)
afterEach(disposeRuntimeScreenFixture)

async function open() {
  const saves: SavedDrafts[] = []
  let lastSave: (() => void) | undefined
  window.api = {
    ...window.api,
    saveDrafts: async (saved: SavedDrafts) => {
      saves.push(saved)
    },
    onLastDraftSave: (listener: () => void) => {
      lastSave = listener
      return () => {
        lastSave = undefined
      }
    },
  }
  const view = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
  await expect.poll(() => view.all('start-as-agent').length).toBe(1)
  const sheet = view.q('start-as-agent')
  const box = sheet.querySelector<HTMLTextAreaElement>('[data-cy="prompt-input"]')!
  box.value = 'A sheet draft before creation'
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  return { view, sheet, box, saves, lastSave: () => lastSave?.() }
}

it('last-save and unmount keep a submitted sheet draft while create is still pending', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  runtime.createSession.mockImplementationOnce(async () => {
    await pending
    throw new Error('Fictional launch refused')
  })
  const { view, sheet, box, saves, lastSave } = await open()
  ;(sheet.querySelector('[data-cy="send-prompt"]') as HTMLButtonElement).click()
  await expect.poll(() => runtime.createSession.mock.calls.length).toBe(1)
  expect(box.value).toBe('A sheet draft before creation')
  lastSave()
  await nextTick()
  expect(saves.at(-1)).toMatchObject({
    last: true,
    drafts: [
      { slot: newAgentDraftSlot('editor'), text: 'A sheet draft before creation', attached: [] },
    ],
  })
  view.unmount()
  expect(saves.at(-1)?.drafts).toContainEqual({
    slot: newAgentDraftSlot('editor'),
    text: 'A sheet draft before creation',
    attached: [],
  })
  release()
  await expect.poll(() => sessions.isPlacing()).toBe(false)
  expect(runtime.send).not.toHaveBeenCalled()
})

it('an explicit sheet close discards that draft instead of treating it as quit', async () => {
  const { sheet, saves, lastSave } = await open()
  ;(sheet.querySelector('[data-cy="close-overlay"]') as HTMLButtonElement).click()
  await nextTick()
  lastSave()
  expect(saves.at(-1)?.drafts.some((draft) => draft.slot === newAgentDraftSlot('editor'))).toBe(
    false,
  )
})
