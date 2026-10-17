import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import ProviderMark from '../../src/renderer/src/components/ProviderMark.vue'
import ProviderSetupWizard from '../../src/renderer/src/components/ProviderSetupWizard.vue'
import blossomBlack from '../../src/renderer/src/assets/OAI_OpenAI-Blossom_Black.svg'
import blossomWhite from '../../src/renderer/src/assets/OAI_OpenAI-Blossom_White.svg'
import type { ProviderCapabilityMap } from '../../src/shared/runtime-ipc'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import type { ModelLists } from '../../src/renderer/src/lib/model-lists'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import definedFile from '../../resources/themes/defined/theme.json'
import synthwaveFile from '../../resources/themes/synthwave/theme.json'
import { mount, unmountAll } from './harness'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'

afterEach(() => {
  applyTheme(null)
  delete (window as unknown as { api?: unknown }).api
  unmountAll()
})

const PAPER: Theme = {
  format: 1,
  id: 'paper-provider-marks',
  name: 'Paper provider marks',
  content: { scheme: 'light', paper: '#ffffff' },
}

function synthwave(): Theme {
  const base = validateTheme(definedFile, { assets: new Map(), builtIns: new Map(), builtIn: true })
  if (!base.ok) throw new Error(JSON.stringify(base.problems))
  const found = validateTheme(synthwaveFile, {
    assets: new Map(),
    builtIns: new Map([['defined', base.theme]]),
    builtIn: true,
  })
  if (!found.ok) throw new Error(JSON.stringify(found.problems))
  return resolveTheme(found.theme, base.theme)
}

const lists: ModelLists = {
  held: () => null,
  read: async () => undefined,
  reread: async () => undefined,
  forget: () => undefined,
  add: async () => null,
  remove: async () => null,
}

function realMarks(capabilities: ProviderCapabilityMap = allProviderCapabilities()) {
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      checkProviderAuth: async () => ({ state: 'absent', reason: 'Not signed in.' }),
      apiKeyStatus: async () => ({ provider: 'codex', set: false, setAt: null, inUse: false }),
    },
  }
  const card = mount(
    ProviderCard,
    {
      provider: 'codex',
      capabilities,
      limit: null,
      limitsRead: true,
      clock: 0,
      version: null,
      readings: [],
      resources: null,
      resourcesPaused: false,
      resourcesError: null,
      loginMoved: 0,
      lists,
    },
    { width: 720 },
  )
  const setup = mount(
    ProviderSetupWizard,
    {
      provider: 'codex',
      markKind: capabilities.codex.mark?.kind ?? null,
      version: null,
      setup: null,
      auth: { state: 'absent', reason: 'Not signed in.' },
      keyRefused: false,
      signIn: { state: 'available' },
      reprovision: { state: 'absent', reason: 'Not offered.', checkedAgainst: 'fixture' },
      busy: 'idle',
      notice: null,
      recheck: async () => undefined,
    },
    { width: 720 },
  )
  // Both components are mounted in a content scope in the app.
  card.host.dataset.chatTheme = 'light'
  setup.host.dataset.chatTheme = 'light'
  return [card.host, setup.host] as const
}

function visibleBlossom(host: HTMLElement, variant: 'black' | 'white', size: number): void {
  const mark = host.querySelector<HTMLElement>('[data-provider-mark="codex"]')
  expect(mark, 'the real card or setup drew no Codex mark').not.toBeNull()
  expect(getComputedStyle(mark!).width).toBe(`${size}px`)
  expect(getComputedStyle(mark!).height).toBe(`${size}px`)
  expect(mark!.getBoundingClientRect().width).toBeGreaterThan(0)
  const black = mark!.querySelector<HTMLImageElement>('.provider-mark__black')!
  const white = mark!.querySelector<HTMLImageElement>('.provider-mark__white')!
  expect(black.getAttribute('src')).toBe(blossomBlack)
  expect(white.getAttribute('src')).toBe(blossomWhite)
  expect(getComputedStyle(black).display).toBe(variant === 'black' ? 'block' : 'none')
  expect(getComputedStyle(white).display).toBe(variant === 'white' ? 'block' : 'none')
}

describe('provider marks beside the provider name', () => {
  it('keeps the provider name and setup readable when an older capability map has no mark', async () => {
    const complete = allProviderCapabilities()
    const withoutMark = {
      ...complete,
      codex: { ...complete.codex, mark: undefined },
    } as unknown as ProviderCapabilityMap
    const [card, setup] = realMarks(withoutMark)
    await nextTick()

    expect(card.querySelector('h2')?.textContent).toBe('Codex')
    expect(setup.querySelector('[data-cy="setup-title"]')?.textContent?.trim()).toBeTruthy()
    expect(card.querySelector('[data-provider-mark]')).toBeNull()
    expect(setup.querySelector('[data-provider-mark]')).toBeNull()
  })

  it('shows an app-owned orange C for Claude at both card and setup sizes', () => {
    for (const size of ['card', 'setup'] as const) {
      const view = mount(ProviderMark, { provider: 'claude', kind: 'letter', size })
      const mark = view.host.querySelector<HTMLElement>('[data-provider-mark="claude"]')!
      expect(mark.textContent).toBe('C')
      expect(mark.querySelectorAll('svg, img')).toHaveLength(0)
      const accentSample = document.createElement('span')
      accentSample.style.backgroundColor = 'var(--accent)'
      mark.append(accentSample)
      expect(
        getComputedStyle(mark.querySelector<HTMLElement>('.provider-mark__claude')!)
          .backgroundColor,
      ).toBe(getComputedStyle(accentSample).backgroundColor)
      accentSample.remove()
      expect(getComputedStyle(mark).width).toBe(size === 'card' ? '28px' : '22px')
      view.unmount()
    }
  })

  it('uses the official black Blossom on paper and the white Blossom on dark chrome', () => {
    const view = mount(ProviderMark, { provider: 'codex', kind: 'blossom' })
    const mark = view.host.querySelector<HTMLElement>('[data-provider-mark="codex"]')!
    const black = mark.querySelector<HTMLImageElement>('.provider-mark__black')!
    const white = mark.querySelector<HTMLImageElement>('.provider-mark__white')!
    expect(black.getAttribute('src')).toBe(blossomBlack)
    expect(white.getAttribute('src')).toBe(blossomWhite)
    expect(getComputedStyle(mark).width).toBe('28px')

    expect(getComputedStyle(black).display).toBe('none')
    expect(getComputedStyle(white).display).toBe('block')
    view.host.dataset.chatTheme = 'light'
    expect(getComputedStyle(black).display).toBe('block')
    expect(getComputedStyle(white).display).toBe('none')
  })

  it('uses the surface scheme on the real provider card and setup, even when their scope is called light', async () => {
    const hosts = realMarks()
    await nextTick()
    applyTheme(PAPER)
    expect(document.documentElement.dataset.contentScheme).toBe('light')
    visibleBlossom(hosts[0]!, 'black', 28)
    visibleBlossom(hosts[1]!, 'black', 22)

    applyTheme(synthwave())
    expect(document.documentElement.dataset.contentScheme).toBe('dark')
    visibleBlossom(hosts[0]!, 'white', 28)
    visibleBlossom(hosts[1]!, 'white', 22)

    applyTheme(null)
    expect(document.documentElement.dataset.contentScheme).toBeUndefined()
    visibleBlossom(hosts[0]!, 'black', 28)
    visibleBlossom(hosts[1]!, 'black', 22)
  })
})
