import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { desktopProviderApi } from '../../src/renderer/src/client-provider/window'
import { mount } from './harness'
import {
  disposeRuntimeScreenFixture,
  installRuntimeScreenFixture,
  runtime,
} from './runtime-screen-fixture'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

beforeEach(installRuntimeScreenFixture)
afterEach(disposeRuntimeScreenFixture)

it('hears identity events, states and changes through the client and lets each go on unmount', async () => {
  const disposers = {
    onEvent: vi.fn(),
    onStates: vi.fn(),
    onChanged: vi.fn(),
    onLimitsDisplayChanged: vi.fn(),
    onProvidersChanged: vi.fn(),
    onNavigate: vi.fn(),
  }
  const hearProviders = vi.fn(() => disposers.onProvidersChanged)
  const hearNavigate = vi.fn(() => disposers.onNavigate)
  window.api.runtime.onProvidersChanged = hearProviders
  window.api.onNavigate = hearNavigate
  runtime.onEvent.mockImplementation(() => disposers.onEvent)
  runtime.onStates.mockImplementation(() => disposers.onStates)
  runtime.onChanged.mockImplementation(() => disposers.onChanged)
  runtime.onLimitsDisplayChanged.mockImplementation(() => disposers.onLimitsDisplayChanged)

  // The client's screen slice is the window's runtime, resolved when asked.
  expect(desktopProviderApi.screen).toBe(window.api.runtime)

  const m = mount(RuntimeScreen, {})
  await expect.poll(() => runtime.onEvent.mock.calls.length).toBeGreaterThan(0)
  expect(hearProviders).toHaveBeenCalled()
  expect(hearNavigate).toHaveBeenCalled()
  for (const disposer of Object.values(disposers)) expect(disposer).not.toHaveBeenCalled()

  m.unmount()
  for (const disposer of Object.values(disposers)) expect(disposer).toHaveBeenCalled()
})
