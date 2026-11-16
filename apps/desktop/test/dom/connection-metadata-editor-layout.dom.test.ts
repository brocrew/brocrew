import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import { provideOverlayLayer } from '../../src/renderer/src/components/OverlayHost.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll } from './harness'
import { drawnReady } from './drawn'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import { providerConnectionFixtures } from '../../look/fixtures/providers'

const originalViewport = { width: innerWidth, height: innerHeight }
const settle = async () => {
  for (let n = 0; n < 5; n++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
  await drawnReady()
}
afterEach(async () => {
  unmountAll()
  useSpawnSafety().forget()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
  await page.viewport(originalViewport.width, originalViewport.height)
})
for (const provider of ['claude', 'codex'] as const) {
  for (const width of [1180, 760]) {
    it(`${provider}: metadata editor is fully visible at ${width} and Escape returns to its drawer`, async () => {
      await page.viewport(width, 900)
      providersBridge()
      const signIn = vi.spyOn(window.api.runtime, 'signInProvider')
      const key = vi.spyOn(window.api.runtime, 'setApiKey')
      const update = vi.fn()
      const stop = vi.fn()
      useSpawnSafety().supply(
        {
          identities: [],
          foldersWithoutARow: [],
          use: [],
          spawningEnabled: true,
          defaultApprovalMode: 'ask',
          externalMcpServers: [],
        },
        stop,
      )
      window.api.runtime.updateProviderConnection = update
      const Frame = defineComponent({
        setup() {
          const layer = ref<HTMLElement | null>(null)
          provideOverlayLayer(layer)
          return () =>
            h('div', { style: 'width:100%;height:100%' }, [
              h(ProvidersScreen, {
                capabilities: CAPABILITY_FIXTURE,
                warnings: null,
                clock: Date.now(),
              }),
              h('div', { ref: layer }),
            ])
        },
      })
      const m = mount(Frame, {}, { width, height: 900 })
      await settle()
      const row = m.host.querySelector<HTMLButtonElement>(
        `[data-cy=provider-row][data-provider=${provider}]`,
      )!
      row.click()
      await settle()
      const entry = m
        .all('provider-connection')
        .find((one) =>
          one.textContent?.includes(provider === 'claude' ? 'subscription' : 'ChatGPT'),
        )!
      const edit = entry.querySelector<HTMLButtonElement>('[data-cy=connection-edit]')!
      edit.focus()
      edit.click()
      await settle()
      for (const id of [
        'connection-name',
        'connection-description',
        'connection-cancel',
        'connection-save',
      ]) {
        const field = m.q(id)
        const box = field.getBoundingClientRect()
        expect(box.width).toBeGreaterThan(0)
        expect(box.height).toBeGreaterThan(0)
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(width)
        expect(box.top).toBeGreaterThanOrEqual(0)
        expect(box.bottom).toBeLessThanOrEqual(900)
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        expect(field.contains(hit)).toBe(true)
      }
      const dialog = m.host.querySelector('[role=dialog][aria-label="Edit connection"]')
      expect(dialog).not.toBeNull()
      expect(dialog!.contains(document.activeElement)).toBe(true)
      const lane = dialog!.querySelector<HTMLElement>('[data-cy=overlay-spawning]')!
      expect(lane).not.toBeNull()
      const laneBox = lane.getBoundingClientRect()
      expect(
        lane.contains(
          document.elementFromPoint(laneBox.x + laneBox.width / 2, laneBox.y + laneBox.height / 2),
        ),
      ).toBe(true)
      lane.click()
      expect(stop.mock.calls).toEqual([[false]])
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await settle()
      expect(m.all('connection-editor')).toHaveLength(0)
      expect(m.all('provider-drawer')).toHaveLength(1)
      expect(document.activeElement).toBe(edit)
      expect(update).not.toHaveBeenCalled()
      edit.click()
      await settle()
      const field = m.q('connection-name') as HTMLInputElement
      field.value = 'Fictional pending edit'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      const selected = providerConnectionFixtures().find((one) => one.id === `${provider}:sign-in`)!
      let release: (() => void) | undefined
      update.mockImplementationOnce(
        () =>
          new Promise((done) => {
            release = () => done({ ...selected, name: 'Fictional pending edit', description: null })
          }),
      )
      try {
        m.q('connection-save').click()
        await settle()
        expect((m.q('connection-cancel') as HTMLButtonElement).disabled).toBe(true)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        m.q('connection-cancel').click()
        m.q('connection-editor')
          .querySelector<HTMLButtonElement>('[data-cy=close-overlay]')!
          .click()
        m.host
          .querySelector('[role=dialog][aria-label="Edit connection"]')!
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await settle()
        expect(m.all('connection-editor')).toHaveLength(1)
        expect(m.all('provider-drawer')).toHaveLength(1)
        expect(field.value).toBe('Fictional pending edit')
        expect(update.mock.calls).toEqual([
          [
            {
              provider,
              connectionId: selected.id,
              name: 'Fictional pending edit',
              description: null,
            },
          ],
        ])
      } finally {
        release?.()
      }
      await settle()
      expect(m.all('connection-editor')).toHaveLength(0)
      expect(m.host.textContent).toContain('Fictional pending edit')
      expect(signIn).not.toHaveBeenCalled()
      expect(key).not.toHaveBeenCalled()
    })
  }
}
