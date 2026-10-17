import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import type { TextPackUse } from '../../src/shared/text-pack'
import type { GivenBuiltInSkills } from '../../src/shared/what-this-agent-was-given'
import { mount, unmountAll } from './harness'
import { givenAnswer } from './what-this-agent-was-given.fixture'

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
})

const names = ['delegate', 'hand-back', 'split-work', 'ask-and-wait', 'remember', 'build-software']
const builtInSkills: GivenBuiltInSkills = {
  version: 'v6',
  reminder: names.map((name) => `brobot:${name} — Fictional reminder.`).join('\n') + '\n',
  listed: names.map((name) => ({
    name: `brobot:${name}`,
    description: `The complete description of ${name}.`,
    descriptionMayBeCut: false,
    path: `/tmp/fictional/claude/skills/${name}/SKILL.md`,
    scope: 'plugin',
  })),
}

/** The popup's first tab for a Claude agent, every part opened. */
async function firstTab(textPack?: TextPackUse) {
  const answer = givenAnswer({
    provider: 'claude',
    builtInSkills,
    ...(textPack ? { textPack } : {}),
    placement: 'system-prompt',
    providerParts: { version: null, model: null, snapshot: null, why: 'No fictional snapshot.' },
  })
  ;(window as { api?: unknown }).api = {
    runtime: { whatThisAgentWasGiven: vi.fn(async () => answer) },
  }
  const m = mount(AgentInputPopup, {
    sessionId: answer.sessionId,
    provider: 'claude',
    who: 'Recipe worker',
    profile: 'recipe-worker',
    state: null,
    startLoaded: true,
  })
  await vi.waitFor(() => expect(m.all('input-launch')).toHaveLength(1))
  m.q('input-tab-1').click()
  await nextTick()
  const parts = [...m.host.querySelectorAll<HTMLDetailsElement>('[data-cy="input-part"]')]
  for (const part of parts) part.querySelector('summary')?.click()
  // A part draws its body once it is open: wait for the skills it lists.
  await vi.waitFor(() => expect(m.all('input-skill').length).toBeGreaterThan(0))
  await nextTick()
  return m
}

describe('the popup says which texts came from a text pack', () => {
  it('names the pack’s folder for the core and the skills it gave', async () => {
    const m = await firstTab({ folder: '/tmp/fictional/pack', refused: null })
    const text = m.host.textContent ?? ''
    expect(
      text.split('From the text pack at /tmp/fictional/pack').length - 1,
    ).toBeGreaterThanOrEqual(2)
    expect(m.all('input-text-pack').length).toBeGreaterThanOrEqual(1)
  })
  it('says why a pack was not used, and the core stays the shipped one', async () => {
    const m = await firstTab({ folder: '/tmp/fictional/pack', refused: { kind: 'core-missing' } })
    const text = m.host.textContent ?? ''
    expect(text).toContain(
      'The text pack at /tmp/fictional/pack could not be used: core.md is missing. This conversation uses the texts this build ships.',
    )
    expect(text).not.toContain('From the text pack at')
    expect(text).toContain('Shipped with BroCrew')
  })
  it('says nothing of a pack when the launch read none', async () => {
    const m = await firstTab()
    expect(m.all('input-text-pack')).toHaveLength(0)
    expect(m.host.textContent).not.toContain('text pack')
  })
})
