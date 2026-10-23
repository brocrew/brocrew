import { expect, it, vi } from 'vitest'
import { reactive, isProxy } from 'vue'
import { readFileSync } from 'node:fs'
import * as policy from '../src/shared/plugin-settings'
import { pluginsBridge } from '../src/preload/plugins'
import { asTheWireWouldCarry } from './lib/the-wire'

it.each(['install', 'update'] as const)(
  'the reviewed %s consent crosses the real clone as two plain primitives',
  (kind) => {
    const shown = reactive({
      consent: {
        reviewId: '00000000-0000-4000-8000-000000000001',
        displayedDetailsHash: 'a'.repeat(64),
      },
    })
    expect(isProxy(shown.consent)).toBe(true)
    const copy = Reflect.get(policy, 'pluginDisplayedConsent') as
      ((review: typeof shown) => typeof shown.consent) | undefined
    const input = { kind, id: 'chrome', consent: copy ? copy(shown) : shown.consent }
    const carried = asTheWireWouldCarry('plugins.request', input)
    expect(carried).toEqual({
      kind,
      id: 'chrome',
      consent: {
        reviewId: shown.consent.reviewId,
        displayedDetailsHash: shown.consent.displayedDetailsHash,
      },
    })
    expect(isProxy(input.consent)).toBe(false)
    expect(carried.consent).not.toBe(shown.consent)
  },
)
it('the actual Vue command producer uses the plain-consent builder', () => {
  const source = readFileSync(
    new URL('../src/renderer/src/components/PluginsSection.vue', import.meta.url),
    'utf8',
  )
  expect(source).toMatch(/consent:\s*pluginDisplayedConsent\(shown\)/)
  expect(source).not.toMatch(/consent:\s*shown\.consent/)
})
it('the passive invalidation subscription carries no payload or invoke and can be removed', () => {
  const ipc = { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
    bridge = pluginsBridge(ipc),
    notify = vi.fn()
  const listen = Reflect.get(bridge, 'onReviewInvalidated') as
    ((listener: () => void) => () => void) | undefined
  const stop = listen?.(notify) ?? (() => {})
  const registered = ipc.on.mock.calls.find(([channel]) => channel === 'plugins:review-invalidated')
  expect(registered).toBeDefined()
  const forward = registered![1] as (event: unknown, ...args: unknown[]) => void
  forward({ privateEvent: true }, { privatePayload: true })
  expect(notify).not.toHaveBeenCalled()
  forward({ privateEvent: true })
  expect(notify).toHaveBeenCalledWith()
  expect(ipc.invoke).not.toHaveBeenCalled()
  stop()
  expect(ipc.off).toHaveBeenCalledWith('plugins:review-invalidated', forward)
})
