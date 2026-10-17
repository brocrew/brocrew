import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import type { Provider } from '../../src/shared/runtime-ipc'
import type { GivenLaunchSettings } from '../../src/shared/what-this-agent-was-given'
import { mount, unmountAll, visible, type Mounted } from './harness'
import { givenAnswer } from './what-this-agent-was-given.fixture'

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
})

async function popup(provider: Provider, launchSettings?: GivenLaunchSettings): Promise<Mounted> {
  const answer = givenAnswer({
    provider,
    launchSettings,
    providerParts: { version: null, model: null, snapshot: null, why: 'No fictional snapshot.' },
  })
  const read = vi.fn(async () => answer)
  ;(window as { api?: unknown }).api = { runtime: { whatThisAgentWasGiven: read } }
  const m = mount(AgentInputPopup, {
    sessionId: answer.sessionId,
    provider,
    who: 'Recipe worker',
    profile: 'recipe-worker',
    state: null,
    startLoaded: true,
  })
  await vi.waitFor(() => expect(m.all('input-launch')).toHaveLength(1))
  expect(read).toHaveBeenCalledExactlyOnceWith(answer.sessionId)
  return m
}

function row(m: Mounted, key: string): HTMLElement | null {
  return m.host.querySelector(`[data-cy="input-setting"][data-key="${key}"]`)
}

function expectRow(m: Mounted, key: string, label: string, words: string): void {
  const el = row(m, key)
  expect(el).not.toBeNull()
  expect(visible(el!)).toBe(true)
  const title = el!.querySelector('strong')!
  const value = el!.querySelector('span')!
  expect(title.textContent?.trim()).toBe(label)
  expect(value.textContent?.trim()).toBe(words)
  expect(visible(title)).toBe(true)
  expect(visible(value)).toBe(true)
}

describe('launch question tools in the agent-input popup', () => {
  it.each(['claude', 'codex'] as const)(
    'shows the recorded %s rows in the overview',
    async (provider) => {
      const m = await popup(provider, {
        recorded: true,
        settings:
          provider === 'claude'
            ? [{ key: 'tools-off', atLaunch: ['AskUserQuestion'] }]
            : [
                { key: 'tools-off', atLaunch: ['request_user_input'] },
                { key: 'tools-left-on', atLaunch: ['request_user_input_async'] },
              ],
      })
      expectRow(
        m,
        'tools-off',
        'Turned off',
        provider === 'claude' ? 'AskUserQuestion.' : 'request_user_input.',
      )
      if (provider === 'codex')
        expectRow(m, 'tools-left-on', 'Left on', 'request_user_input_async (no switch).')
      else expect(row(m, 'tools-left-on')).toBeNull()

      m.q('input-tab-1').click()
      await nextTick()
      expect(row(m, 'tools-off')).toBeNull()
      expect(row(m, 'tools-left-on')).toBeNull()
      m.q('input-tab-0').click()
      await nextTick()
      expectRow(
        m,
        'tools-off',
        'Turned off',
        provider === 'claude' ? 'AskUserQuestion.' : 'request_user_input.',
      )
      if (provider === 'codex')
        expectRow(m, 'tools-left-on', 'Left on', 'request_user_input_async (no switch).')
      else expect(row(m, 'tools-left-on')).toBeNull()
    },
  )

  it.each(['claude', 'codex'] as const)(
    'keeps an empty %s turned-off list as None',
    async (provider) => {
      const m = await popup(provider, {
        recorded: true,
        settings: [{ key: 'tools-off', atLaunch: [] }],
      })
      expectRow(m, 'tools-off', 'Turned off', 'None.')
      expect(row(m, 'tools-left-on')).toBeNull()
    },
  )

  it.each([
    ['claude', 'omitted'],
    ['codex', 'omitted'],
    ['claude', 'empty'],
    ['codex', 'empty'],
  ] as const)('does not invent %s rows when settings are %s', async (provider, kind) => {
    const m = await popup(
      provider,
      kind === 'omitted' ? undefined : { recorded: false, settings: [] },
    )
    expect(row(m, 'tools-off')).toBeNull()
    expect(row(m, 'tools-left-on')).toBeNull()
    const fallback = m.q('input-setting')
    expect(fallback.querySelector('strong')?.textContent?.trim()).toBe('Launch settings')
    expect(visible(fallback)).toBe(true)
  })
})
