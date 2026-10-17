import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import type { ProviderSnapshot, SnapshotTool } from '../../src/shared/provider-snapshots'
import type { Provider } from '../../src/shared/runtime-ipc'
import type { GivenLaunchSettings } from '../../src/shared/what-this-agent-was-given'
import { mount, unmountAll, visible, type Mounted } from './harness'
import { givenAnswer } from './what-this-agent-was-given.fixture'

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
})

const declaration = (name: string): SnapshotTool => {
  const text = JSON.stringify({ name, description: `Use ${name} for this task.` })
  return { name, text, chars: text.length }
}

async function popup(provider: Provider, launchSettings?: GivenLaunchSettings): Promise<Mounted> {
  const answer = givenAnswer()
  const tools =
    provider === 'claude'
      ? ['Read', 'AskUserQuestion', 'Bash'].map(declaration)
      : [
          'functions.exec',
          'functions.request_user_input',
          'functions.request_user_input_async',
        ].map(declaration)
  const version = provider === 'claude' ? '2.1.287' : '0.160.0'
  const snapshot: ProviderSnapshot = {
    ...answer.providerParts.snapshot!,
    provider,
    version,
    label: provider === 'claude' ? `as of Claude Code ${version}` : `as of Codex ${version}`,
    model: provider === 'claude' ? 'claude-opus-5' : 'gpt-6.1-sol',
    shape: provider === 'claude' ? 'messages' : 'functions',
    parts: [
      {
        id: `${provider}.tools`,
        title: 'Provider tools',
        where: 'tools',
        when: 'every-request',
        text: tools.map((one) => one.text).join('\n'),
        chars: tools.reduce((sum, one) => sum + one.chars, 0),
        words: 12,
        approxTokens: 40,
        tools,
      },
    ],
  }
  const given = {
    ...answer,
    provider,
    launchSettings,
    providerParts: { ...answer.providerParts, version, model: snapshot.model, snapshot },
  }
  ;(window as { api?: unknown }).api = {
    runtime: { whatThisAgentWasGiven: vi.fn(async () => given) },
  }
  const m = mount(AgentInputPopup, {
    sessionId: given.sessionId,
    provider,
    who: 'Recipe worker',
    profile: 'recipe-worker',
    state: null,
    startLoaded: true,
  })
  await vi.waitFor(() => expect(m.all('input-launch')).toHaveLength(1))
  m.q(provider === 'claude' ? 'input-tab-2' : 'input-tab-1').click()
  await nextTick()
  return m
}

async function shownToolNames(m: Mounted, provider: Provider): Promise<string[]> {
  if (provider === 'claude') {
    const part = m.host.querySelector<HTMLDetailsElement>(
      '[data-cy="input-part"][data-key="part:claude.tools"]',
    )!
    if (!part.open) {
      part.querySelector('summary')!.click()
      await nextTick()
    }
    return [...part.querySelectorAll('[data-cy="input-provider-tool"] summary strong')].map((one) =>
      one.textContent!.trim(),
    )
  }
  return [...m.host.querySelectorAll('[data-cy="input-part"][data-key^="tool:"]')].map((one) =>
    one.getAttribute('data-key')!.slice('tool:'.length),
  )
}

describe('provider tools at launch', () => {
  it.each(['claude', 'codex'] as const)(
    'leaves the recorded turned-off %s tool out while keeping the others',
    async (provider) => {
      const off = provider === 'claude' ? 'AskUserQuestion' : 'request_user_input'
      const m = await popup(provider, {
        recorded: true,
        settings: [{ key: 'tools-off', atLaunch: [off] }],
      })
      const names = await shownToolNames(m, provider)
      const capture = import.meta.env.VITE_W4452_CAPTURE
      if (capture)
        await page.screenshot({
          element: m.q('input-popup-body'),
          path: `__screenshots__/provider-tools-${capture}-${provider}.png`,
        })
      expect(names).toEqual(
        provider === 'claude'
          ? ['Read', 'Bash']
          : ['functions.exec', 'functions.request_user_input_async'],
      )
      if (provider === 'claude') {
        const whole = m.host.querySelector(
          '[data-key="part:claude.tools"] [data-cy="input-part-whole"] pre',
        )!
        expect(whole.textContent).not.toContain(off)
      }
      m.q('input-tab-0').click()
      await nextTick()
      const row = m.host.querySelector('[data-cy="input-setting"][data-key="tools-off"]')!
      expect(visible(row)).toBe(true)
      expect(row.textContent).toContain(off)
    },
  )

  it.each(['claude', 'codex'] as const)(
    'keeps the stored %s copy where the launch did not record tools-off',
    async (provider) => {
      const m = await popup(provider)
      expect(await shownToolNames(m, provider)).toEqual(
        provider === 'claude'
          ? ['Read', 'AskUserQuestion', 'Bash']
          : [
              'functions.exec',
              'functions.request_user_input',
              'functions.request_user_input_async',
            ],
      )
    },
  )

  it('keeps the copy when settings were not recorded, even if a stale value is present', async () => {
    const m = await popup('claude', {
      recorded: false,
      settings: [{ key: 'tools-off', atLaunch: ['AskUserQuestion'] }],
    })
    expect(await shownToolNames(m, 'claude')).toEqual(['Read', 'AskUserQuestion', 'Bash'])
  })
})
