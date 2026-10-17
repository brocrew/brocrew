import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import type { Provider } from '../../src/shared/runtime-ipc'
import type { GivenBuiltInSkills } from '../../src/shared/what-this-agent-was-given'
import { mount, unmountAll, visible } from './harness'
import { givenAnswer } from './what-this-agent-was-given.fixture'

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
})

async function popup(provider: Provider, count?: 6 | 7 | 8) {
  const names = [
    'delegate',
    'hand-back',
    'split-work',
    'ask-and-wait',
    'remember',
    'build-software',
    'add-a-capability',
    'build-a-team',
  ].slice(0, count ?? 6)
  const builtInSkills: GivenBuiltInSkills | undefined =
    count === undefined
      ? undefined
      : {
          version: 'v6',
          reminder:
            names
              .map(
                (name) => `${provider === 'claude' ? 'brobot:' : ''}${name} — Fictional reminder.`,
              )
              .join('\n') + '\n',
          listed: names.map((name) => ({
            name: provider === 'claude' ? `brobot:${name}` : name,
            description: `The complete description of ${name}.`,
            descriptionMayBeCut: false,
            path: `/tmp/fictional/${provider}/skills/${name}/SKILL.md`,
            scope: provider === 'claude' ? 'plugin' : null,
          })),
        }
  const answer = givenAnswer({
    provider,
    builtInSkills,
    placement: provider === 'claude' ? 'system-prompt' : 'first-message',
    providerParts: { version: null, model: null, snapshot: null, why: 'No fictional snapshot.' },
  })
  ;(window as { api?: unknown }).api = {
    runtime: { whatThisAgentWasGiven: vi.fn(async () => answer) },
  }
  const m = mount(AgentInputPopup, {
    sessionId: answer.sessionId,
    provider,
    who: 'Recipe worker',
    profile: 'recipe-worker',
    state: null,
    startLoaded: true,
  })
  await vi.waitFor(() => expect(m.all('input-launch')).toHaveLength(1))
  m.q(`input-tab-${provider === 'claude' ? 1 : 2}`).click()
  await nextTick()
  return { m, offered: builtInSkills }
}

describe('the popup records the offered built-in skills separately from a provider copy', () => {
  for (const provider of ['claude', 'codex'] as const) {
    for (const count of [6, 7, 8] as const) {
      it(`${provider} shows all ${count} offered names, full descriptions, paths and reminder`, async () => {
        const { m, offered } = await popup(provider, count)
        const part = m.host.querySelector<HTMLDetailsElement>(
          '[data-cy="input-part"][data-key="built-in-skills"]',
        )!
        expect(part).not.toBeNull()
        part.querySelector('summary')!.click()
        await vi.waitFor(() =>
          expect(part.querySelectorAll('[data-cy="input-skill"]')).toHaveLength(count),
        )
        expect(visible(part)).toBe(true)
        expect(part.querySelectorAll('[data-cy="input-skill"]')).toHaveLength(count)
        for (const skill of offered!.listed) {
          expect(part.textContent).toContain(skill.name)
          expect(part.textContent).toContain(skill.description)
          expect(part.textContent).toContain(skill.path)
        }
        expect(part.textContent).toContain('Recorded at launch')
        expect(part.querySelector('pre')!.textContent).toBe('v6')
        expect(part.textContent).not.toContain(
          `Listed by ${provider === 'claude' ? 'Claude' : 'Codex'}`,
        )
        m.q(provider === 'claude' ? 'input-tab-3' : 'input-tab-4').click()
        await nextTick()
        const reminder = m.host.querySelector<HTMLDetailsElement>(
          '[data-key="built-in-skill-reminder"]',
        )!
        expect(reminder).not.toBeNull()
        reminder.querySelector('summary')!.click()
        await vi.waitFor(() => expect(reminder.querySelector('pre')).not.toBeNull())
        expect(reminder.querySelector('pre')!.textContent).toBe(`v6\n${offered!.reminder}`)
        expect(visible(reminder)).toBe(true)
        expect(reminder.querySelector('[data-cy="input-part-author"]')!.textContent).toBe('BroCrew')
      })
    }
    it(`${provider} does not invent a built-in set for an older launch`, async () => {
      const { m } = await popup(provider)
      expect(m.host.querySelector('[data-key="built-in-skills"]')).toBeNull()
    })
  }
})
