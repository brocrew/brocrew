import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, shallowRef, type Component } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { SkillsReply, SkillsWindow } from '../../src/shared/skills-window'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import ProfileSkills from '../../src/renderer/src/components/ProfileSkills.vue'
import SkillsSection from '../../src/renderer/src/components/SkillsSection.vue'
import { fictionalSkills } from '../../look/fixtures/skills'
import { mount, unmountAll } from './harness'

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('Skill views must use their injected client')
    },
  })
})
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
  vi.restoreAllMocks()
})

function screen(
  component: Component,
  props: () => Record<string, unknown>,
  sessions: () => Partial<ClientSessionApi> | undefined,
) {
  const capability = vi.fn(() => sessions() as ClientSessionApi | undefined)
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    capability,
  )
  const view = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(component, props())
      },
    }),
    {},
    { width: 1000, height: 800 },
  )
  return { view, capability }
}

function profileReply(
  profileId: string,
  name: string,
  nextOffset: number | null = null,
): SkillsReply {
  return {
    operation: 'profile-list',
    profileId,
    readAt: 1,
    nextOffset,
    skills: [
      {
        folder: name,
        name,
        description: `${name} description`,
        builtIn: false,
        enabled: true,
        given: true,
      },
    ],
  }
}

it('uses the injected profile method receiver only when active, with the current profile and pagination', async () => {
  const active = ref(false)
  const slug = ref('fern')
  const transport = {
    marker: 'injected',
    skills: vi.fn<SkillsWindow>(function (this: { marker: string }, request) {
      expect(this.marker).toBe('injected')
      expect(structuredClone(request)).toEqual(request)
      if (request.operation !== 'profile-list') throw new Error('Wrong operation')
      return Promise.resolve(
        profileReply(
          request.profileId,
          request.offset ? 'second' : 'first',
          request.offset ? null : 5,
        ),
      )
    }),
  }
  const { view, capability } = screen(
    ProfileSkills,
    () => ({ profileSlug: slug.value, active: active.value }),
    () => transport,
  )
  expect(capability).not.toHaveBeenCalled()
  active.value = true
  await vi.waitFor(() => expect(view.all('agent-skill')).toHaveLength(1))
  const more = [...view.host.querySelectorAll('button')].find(
    (one) => one.textContent?.trim() === 'Load more',
  )!
  more.click()
  await vi.waitFor(() => expect(view.all('agent-skill')).toHaveLength(2))
  expect(transport.skills.mock.calls.map(([request]) => request)).toEqual([
    { operation: 'profile-list', profileId: 'fern' },
    { operation: 'profile-list', profileId: 'fern', offset: 5 },
  ])
  slug.value = 'moss'
  await vi.waitFor(() => expect(transport.skills).toHaveBeenCalledTimes(3))
  expect(transport.skills.mock.calls[2]?.[0]).toEqual({
    operation: 'profile-list',
    profileId: 'moss',
  })
})

it('keeps live profile-runtime overrides first, with one method getter and its original receiver', async () => {
  const active = ref(true)
  let gets = 0
  const runtime = {
    marker: 'override',
    get skills(): SkillsWindow {
      gets++
      return function (this: typeof runtime) {
        expect(this).toBe(runtime)
        return Promise.resolve(profileReply('fern', this.marker))
      }
    },
  }
  const bridge = shallowRef<unknown>(runtime)
  const { view, capability } = screen(
    ProfileSkills,
    () => ({ profileSlug: 'fern', active: active.value, bridge: bridge.value }),
    () => {
      throw new Error('Override must win')
    },
  )
  await vi.waitFor(() => expect(view.q('agent-skill').textContent).toContain('override'))
  expect(gets).toBe(1)
  active.value = false
  await nextTick()
  bridge.value = { skills: () => Promise.resolve(profileReply('fern', 'replacement')) }
  active.value = true
  await vi.waitFor(() => expect(view.q('agent-skill').textContent).toContain('replacement'))
  expect(capability).not.toHaveBeenCalled()
})

it('ignores a late injected profile result after switching profiles and after deactivation', async () => {
  const slug = ref('fern')
  const active = ref(true)
  const answers: ((reply: SkillsReply) => void)[] = []
  const skills = vi.fn<SkillsWindow>(() => new Promise((resolve) => answers.push(resolve)))
  const { view } = screen(
    ProfileSkills,
    () => ({ profileSlug: slug.value, active: active.value }),
    () => ({ skills }),
  )
  slug.value = 'moss'
  await nextTick()
  answers[1]!(profileReply('moss', 'current'))
  await vi.waitFor(() => expect(view.q('agent-skill').textContent).toContain('current'))
  answers[0]!(profileReply('fern', 'stale'))
  await nextTick()
  expect(view.q('agent-skill').textContent).not.toContain('stale')
  active.value = false
  await nextTick()
  active.value = true
  await nextTick()
  active.value = false
  await nextTick()
  answers[2]!(profileReply('moss', 'inactive'))
  await nextTick()
  expect(view.q('agent-skill').textContent).toContain('current')
})

it('keeps the injected shared receiver through toggle and refresh, suppresses focus during saving and disposes its timer/listener', async () => {
  const fixture = fictionalSkills()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const transport = {
    marker: 'shared receiver',
    skills: vi.fn<SkillsWindow>(async function (this: { marker: string }, request) {
      expect(this.marker).toBe('shared receiver')
      if (request.operation === 'shared-toggle') await pending
      return fixture.bridge(request)
    }),
  }
  const intervals = vi.spyOn(globalThis, 'setInterval')
  const clears = vi.spyOn(globalThis, 'clearInterval')
  const { view } = screen(
    SkillsSection,
    () => ({}),
    () => transport,
  )
  await vi.waitFor(() => expect(view.all('skill-row')).toHaveLength(2))
  expect(intervals.mock.calls.some(([, delay]) => delay === 5000)).toBe(true)
  view.q('skill-toggle').click()
  await nextTick()
  expect(view.q('skill-toggle').hasAttribute('disabled')).toBe(true)
  window.dispatchEvent(new Event('focus'))
  expect(transport.skills).toHaveBeenCalledTimes(2)
  release()
  await vi.waitFor(() => expect(view.q('skill-toggle').textContent?.trim()).toBe('Turn on'))
  expect(transport.skills.mock.calls.map(([request]) => request)).toEqual([
    { operation: 'shared-list' },
    { operation: 'shared-toggle', folder: 'recipe-check', enabled: false },
    { operation: 'shared-list' },
  ])
  view.unmount()
  window.dispatchEvent(new Event('focus'))
  expect(transport.skills).toHaveBeenCalledTimes(3)
  const timerIndex = intervals.mock.calls.findIndex(([, delay]) => delay === 5000)
  expect(clears).toHaveBeenCalledWith(intervals.mock.results[timerIndex]!.value)
})

it('keeps a live shared function override unchanged and ahead of an unavailable injected capability', async () => {
  const fixture = fictionalSkills()
  const first = vi.fn<SkillsWindow>(function (this: unknown, request) {
    expect(this).toBeUndefined()
    return fixture.bridge(request)
  })
  const bridge = shallowRef<SkillsWindow>(first)
  const { view, capability } = screen(
    SkillsSection,
    () => ({ bridge: bridge.value }),
    () => {
      throw new Error('Override must win')
    },
  )
  await vi.waitFor(() => expect(view.all('skill-row')).toHaveLength(2))
  const second = vi.fn<SkillsWindow>((request) => fixture.bridge(request))
  bridge.value = second
  await nextTick()
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() =>
    expect(second).toHaveBeenCalledExactlyOnceWith({ operation: 'shared-list' }),
  )
  expect(first).toHaveBeenCalledTimes(1)
  expect(capability).not.toHaveBeenCalled()
})

it.each(
  (['profile', 'shared'] as const).flatMap((surface) =>
    (
      [
        'missing capability',
        'missing operation',
        'capability getter',
        'operation getter',
        'throw',
        'reject',
      ] as const
    ).map((kind) => ({ surface, kind })),
  ),
)('keeps $kind on the existing $surface error surface', async ({ surface, kind }) => {
  const failure = new Error('Fictional skills failed verbatim')
  const transport = {
    get skills(): SkillsWindow {
      if (kind === 'operation getter') throw failure
      return () => {
        if (kind === 'throw') throw failure
        return Promise.reject(failure)
      }
    },
  }
  const { view } = screen(
    surface === 'profile' ? ProfileSkills : SkillsSection,
    () => ({ profileSlug: 'fern', active: true }),
    () => {
      if (kind === 'capability getter') throw failure
      if (kind === 'missing capability') return undefined
      if (kind === 'missing operation') return {}
      return transport
    },
  )
  const error = surface === 'profile' ? 'agent-skills-error' : 'skills-status'
  await vi.waitFor(() =>
    expect(view.q(error).textContent).toContain(
      kind.startsWith('missing') ? 'Skills could not be read.' : failure.message,
    ),
  )
  expect(view.all(surface === 'profile' ? 'agent-skills-empty' : 'skills-empty')).toHaveLength(0)
})
