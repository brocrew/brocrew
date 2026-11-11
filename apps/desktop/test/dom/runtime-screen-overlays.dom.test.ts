import {
  agentStore,
  runtime,
  installRuntimeScreenFixture,
  disposeRuntimeScreenFixture,
  replaceFixtureAgentStore,
  agentBookAnswers,
} from './runtime-screen-fixture'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { useOverlays, type Overlay } from '../../src/renderer/src/lib/overlay-store'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { nextTick } from 'vue'
import { mount } from './harness'
import { LISTED } from './delete-conversation-fixture'
import { wearTheme } from '../../look/fixtures/themes'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

beforeEach(installRuntimeScreenFixture)
afterEach(disposeRuntimeScreenFixture)

const keyboardSheets = [
  { overlay: { kind: 'newAgent' }, ready: 'new-agent' },
  { overlay: { kind: 'externalMcpServers' }, ready: 'external-mcp-registry' },
  { overlay: { kind: 'agentSections', profileSlug: 'editor' }, ready: 'agent-sections-sheet' },
  { overlay: { kind: 'agentCapabilities', profileSlug: 'editor' }, ready: 'capabilities-sheet' },
  { overlay: { kind: 'startAsAgent', profileSlug: 'editor' }, ready: 'start-as-agent' },
  {
    overlay: { kind: 'deleteConversation', sessionId: LISTED.conversation },
    ready: 'delete-conversation',
  },
] satisfies { overlay: Overlay; ready: string }[]

function overlayKey(key: 'Escape' | 'Tab', shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
}

it.each(keyboardSheets)(
  'traps focus and restores the connected opener for $ready in the root overlay layer',
  async ({ overlay, ready }) => {
    const viewportBefore = { width: window.innerWidth, height: window.innerHeight }
    try {
      await page.viewport(1200, 800)
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      console.info(
        'S04_OVERLAY_VIEWPORT',
        JSON.stringify({ sheet: ready, viewportBefore, viewport }),
      )
      expect(viewport).toEqual({ width: 1200, height: 800 })
      const answers = {
        ...agentBookAnswers().book,
        checkDeleteConversation: async () => LISTED,
        agentModelAndEffort: async () => null,
      }
      const previous = Object.getOwnPropertyDescriptors(runtime)
      const previousApi = window.api
      const previousAgentStore = agentStore
      try {
        Object.assign(runtime, answers)
        window.api = { ...previousApi, runtime: runtime as unknown as RuntimeBridge }
        replaceFixtureAgentStore(createAgentStore(window.api.runtime))
        const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
        try {
          wearTheme('defined')
          await expect.poll(() => agentStore.loaded.value).toBe(true)
          m.q('rail-team').click()
          await expect.poll(() => m.all('team-create').length).toBe(1)
          const opener = m.q('team-create')
          opener.focus()
          expect(document.activeElement).toBe(opener)
          // Supply each real sheet payload through the root's existing overlay store.
          useOverlays().open(overlay)
          await expect.poll(() => m.all(ready).length).toBe(1)
          if (overlay.kind === 'agentSections' || overlay.kind === 'agentCapabilities') {
            await expect.poll(() => m.all('own-instructions-read-at').length).toBe(1)
            expect(m.all('own-instructions-unreadable')).toHaveLength(0)
          }
          if (overlay.kind === 'agentCapabilities') {
            await expect.poll(() => m.all('agent-model-loading').length).toBe(0)
            expect(m.all('agent-model-unreadable')).toHaveLength(0)
          }
          if (overlay.kind === 'deleteConversation') {
            await expect.poll(() => m.all('delete-reading').length).toBe(0)
            expect(m.q('delete-title').textContent).toBe(`Delete ${LISTED.name}?`)
            expect(m.all('delete-refusal')).toHaveLength(0)
          }
          const host = m.q('overlay-host')
          expect(host.parentElement).toBe(m.q('overlay-layer'))
          expect(m.q('overlay-layer').children).toHaveLength(1)
          const bounds = m.q(ready).getBoundingClientRect()
          console.info(
            'S04_OVERLAY_GEOMETRY',
            JSON.stringify({ sheet: ready, viewport, bounds: bounds.toJSON() }),
          )
          expect(bounds.width).toBeGreaterThan(250)
          expect(bounds.height).toBeGreaterThan(100)
          expect(bounds.left).toBeGreaterThanOrEqual(0)
          expect(bounds.top).toBeGreaterThanOrEqual(0)
          expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
          expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight)
          await expect.poll(() => host.contains(document.activeElement)).toBe(true)
          const first = m.q('close-overlay')
          const last = m.q('overlay-spawning')
          first.focus()
          overlayKey('Tab', true)
          expect(document.activeElement).toBe(last)
          overlayKey('Tab')
          expect(document.activeElement).toBe(first)
          overlayKey('Escape')
          await expect.poll(() => m.all('overlay-host').length).toBe(0)
          expect(useOverlays().overlay.value).toBeNull()
          expect(opener.isConnected).toBe(true)
          expect(document.activeElement).toBe(opener)
        } finally {
          m.unmount()
        }
      } finally {
        for (const key of Object.keys(answers)) {
          const descriptor = previous[key]
          if (descriptor) Object.defineProperty(runtime, key, descriptor)
          else Reflect.deleteProperty(runtime, key)
        }
        window.api = previousApi
        replaceFixtureAgentStore(previousAgentStore)
      }
    } finally {
      await page.viewport(viewportBefore.width, viewportBefore.height)
      const restored = { width: window.innerWidth, height: window.innerHeight }
      console.info('S04_OVERLAY_VIEWPORT_RESTORED', JSON.stringify({ sheet: ready, restored }))
      expect(restored).toEqual(viewportBefore)
    }
  },
)

it('paints a theme’s window background behind everything, and the app’s own without one', async () => {
  const m = mount(RuntimeScreen, {})
  await nextTick()
  const app = m.host.querySelector('.app')!
  const own = getComputedStyle(app).backgroundColor
  expect(getComputedStyle(app).backgroundImage).toBe('none')
  applyTheme({
    format: 1,
    id: 'night-window',
    name: 'Night window',
    window: {
      background: {
        color: '#0b1020',
        layers: [
          {
            gradient: {
              type: 'linear',
              angle: 180,
              stops: [
                { color: '#0b1020', at: 0 },
                { color: '#1b2a4a', at: 100 },
              ],
            },
          },
        ],
      },
    },
  })
  expect(getComputedStyle(app).backgroundColor).toBe('rgb(11, 16, 32)')
  expect(getComputedStyle(app).backgroundImage).toMatch(
    /^linear-gradient\(rgb\(11, 16, 32\) 0%, rgb\(27, 42, 74\) 100%\)$/,
  )
  applyTheme(null)
  expect(getComputedStyle(app).backgroundColor).toBe(own)
})
