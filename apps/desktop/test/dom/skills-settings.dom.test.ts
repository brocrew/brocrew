import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SkillsSection from '../../src/renderer/src/components/SkillsSection.vue'
import { fictionalSkills } from '../../look/fixtures/skills'
import { settingsWindow } from '../../look/fixtures/settings-window'
import type { SkillsWindow } from '../../src/shared/skills-window'
import { mount, unmountAll } from './harness'
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})
async function ready(bridge?: SkillsWindow, fixture = fictionalSkills()) {
  const m = mount(SkillsSection, { bridge: bridge ?? fixture.bridge }, { width: 1100, height: 850 })
  await vi.waitFor(() => expect(m.all('skills-loading')).toHaveLength(0))
  return { m, ...fixture }
}
it('shows loading before an empty answer and a real empty state only afterwards', async () => {
  let release!: () => void
  const pending = new Promise<void>((done) => {
    release = done
  })
  const m = mount(SkillsSection, {
    bridge: async () => {
      await pending
      return { operation: 'shared-list', skills: [] }
    },
  })
  await nextTick()
  expect(m.q('skills-loading').textContent).toContain('Reading skills…')
  expect(m.all('skills-empty')).toHaveLength(0)
  release()
  await vi.waitFor(() => expect(m.q('skills-empty').textContent).toBe('No skills yet.'))
})
it('a failed initial read is never presented as an empty folder', async () => {
  const { m } = await ready(async () => {
    throw new Error('fictional read failure')
  })
  expect(m.q('skills-status').textContent).toBe('Skills could not be read.')
  expect(m.all('skills-empty')).toHaveLength(0)
})
it('lists built-in and shared text without versions, agent choices or an editor', async () => {
  const { m } = await ready()
  expect(m.all('skill-row')).toHaveLength(2)
  expect(m.all('skill-toggle')).toHaveLength(1)
  expect(m.q('skill-toggle').textContent).toBe('Turn off')
  expect(m.q('skill-toggle').getAttribute('aria-label')).toBe('Turn off recipe-check')
  const text = m
    .all('skill-source')
    .map((one) => one.textContent)
    .join(' ')
  expect(text).toContain('Check the flour, water and timing.')
  expect(text).not.toContain('name: recipe-check')
  for (const hook of ['skills-add', 'skill-editor', 'skill-agent-row', 'skill-on', 'skill-version'])
    expect(m.all(hook)).toHaveLength(0)
  expect(m.host.textContent).not.toContain('Version:')
})
it('turns a whole shared skill off and back on, retaining its text', async () => {
  const { m } = await ready()
  const original = m.all('skill-source').map((one) => one.textContent)
  m.q('skill-toggle').click()
  await vi.waitFor(() => expect(m.q('skill-toggle').textContent).toBe('Turn on'))
  expect(m.all('skill-source').map((one) => one.textContent)).toEqual(original)
  m.q('skill-toggle').click()
  await vi.waitFor(() => expect(m.q('skill-toggle').textContent).toBe('Turn off'))
})
it('keeps the last list and readable text while reading and after a failed read', async () => {
  const { m, state } = await ready()
  let release!: () => void
  state.pendingList = new Promise<void>((done) => {
    release = done
  })
  window.dispatchEvent(new Event('focus'))
  await nextTick()
  expect(m.all('skill-row')).toHaveLength(2)
  expect(m.all('skills-loading')).toHaveLength(1)
  state.failRead = true
  release()
  await vi.waitFor(() => expect(m.q('skills-status').textContent).toBe('Skills could not be read.'))
  expect(m.all('skill-row')).toHaveLength(2)
})
it('a refused move keeps the previous state and text', async () => {
  const { m, state } = await ready()
  state.failSave = true
  m.q('skill-toggle').click()
  await vi.waitFor(() => expect(m.q('skills-status').textContent).toBe('The skill was not saved.'))
  expect(m.q('skill-toggle').textContent).toBe('Turn off')
  expect(m.all('skill-source')[1]!.textContent).toContain('Check the flour')
})
it('disables another move until the pending move finishes', async () => {
  const fixture = fictionalSkills()
  let release!: () => void
  const pending = new Promise<void>((done) => {
    release = done
  })
  const bridge: SkillsWindow = async (request) => {
    if (request.operation === 'shared-toggle') await pending
    return fixture.bridge(request)
  }
  const { m } = await ready(bridge, fixture)
  m.q('skill-toggle').click()
  await nextTick()
  expect((m.q('skill-toggle') as HTMLButtonElement).disabled).toBe(true)
  release()
  await vi.waitFor(() => expect(m.q('skill-toggle').textContent).toBe('Turn on'))
})
it('reaches the simplified page through the real Settings tab', async () => {
  const m = mount(settingsWindow('providers', 'classic'), {}, { width: 1180, height: 900 })
  m.q('settings-tab-skills').click()
  await vi.waitFor(() => expect(m.all('skill-row')).toHaveLength(2))
  expect(m.all('skill-toggle')).toHaveLength(1)
})
