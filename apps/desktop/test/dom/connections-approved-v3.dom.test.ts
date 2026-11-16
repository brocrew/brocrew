import { expect, it, vi } from 'vitest'
import { defineComponent, h, ref, type Component } from 'vue'
import { providerDescriptor, type Provider, type ProviderConnection } from '@brobot2/shared'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import { mount } from './harness'
import {
  attributedUsageFixtures,
  providerCardReadingProps,
  providerLaunchFixture,
  settleProviderLaunch as settle,
} from './provider-launch.fixture'
import type { ProviderSetupBridge } from '../../src/shared/provider-setup'
import type { AuthState } from '../../src/shared/runtime-ipc'

providerLaunchFixture()

async function drawer(
  provider: Provider,
  auth?: AuthState,
  busy = false,
  readRows?: (rows: readonly ProviderConnection[]) => Promise<readonly ProviderConnection[]>,
) {
  const rows: ProviderConnection[] = (['sign-in', 'api-key'] as const).map((method) => ({
    id: `${provider}:${method}`,
    provider,
    name: method === 'sign-in' ? 'subscription' : 'API key',
    authMethod: method,
    credentialSource: method === 'sign-in' ? 'provider-sign-in' : 'provider-api-key',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }))
  window.api.runtime.providerConnections = () => readRows?.(rows) ?? Promise.resolve(rows)
  if (auth !== undefined) window.api.runtime.checkProviderAuth = async () => auth
  window.api.runtime.apiKeyStatus = async () => ({
    provider,
    set: true,
    setAt: 1,
    inUse: true,
  })
  const check = vi.fn<typeof window.api.runtime.checkApiKey>(async () => ({ ok: true }))
  window.api.runtime.checkApiKey = check
  const remove = vi.fn(window.api.runtime.removeApiKey)
  const save = vi.fn(window.api.runtime.setApiKey)
  window.api.runtime.removeApiKey = remove
  window.api.runtime.setApiKey = save
  const signIn = vi.fn<ProviderSetupBridge['signIn']>(async () => ({ ok: true }))
  const cancel = vi.fn<ProviderSetupBridge['cancel']>(async () => ({ ok: true }))
  const setup: ProviderSetupBridge = {
    state: async (provider) => ({
      provider,
      available: true,
      supported: { install: false, signIn: true },
      phase: busy ? 'signing-in' : 'idle',
      progress: '',
      authUrl: null,
      error: null,
      details: null,
      exitCode: null,
    }),
    onState: () => () => {},
    signIn,
    install: async () => ({ ok: false, reason: 'unsupported-provider' }),
    cancel,
  }
  Reflect.set(window.api, 'providerSetup', setup)
  const readings = attributedUsageFixtures(await window.api.runtime.providerUsage())
  const currentProvider = ref(provider)
  const revision = ref(0)
  const card: Component = ProviderCard
  const readingProps = providerCardReadingProps(readings[provider])
  const m = mount(
    defineComponent({
      setup: () => () =>
        h(card, {
          provider: currentProvider.value,
          descriptor: providerDescriptor(currentProvider.value),
          capabilities: null,
          limit: null,
          limitsRead: true,
          clock: Date.now(),
          version: { version: 'fictional' },
          ...readingProps,
          loginMoved: revision.value,
        }),
    }),
    {},
    { width: 760, height: 1400 },
  )
  await settle()
  return {
    m,
    check,
    signIn,
    cancel,
    remove,
    save,
    rows,
    refresh: () => {
      revision.value++
    },
    changeProvider: (next: Provider) => {
      currentProvider.value = next
    },
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: offers native sign-in when the current provider reading describes its key`, async () => {
    const { m, signIn, remove, save } = await drawer(provider, {
      state: 'usable',
      login: 'api-key',
      expiresAt: null,
    })
    const button = m.q('native-sign-in-again') as HTMLButtonElement
    expect(button.textContent?.trim()).toBe('Sign in')
    expect(button.disabled).toBe(false)
    button.click()
    await settle()
    expect(signIn).toHaveBeenCalledExactlyOnceWith(provider)
    expect(remove).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it(`${provider}: keeps native setup busy admission and cancellation with a saved key`, async () => {
    const { m, signIn, cancel, remove, save } = await drawer(provider, undefined, true)
    const button = m.q('native-sign-in-again') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    button.click()
    await settle()
    expect(signIn).not.toHaveBeenCalled()
    const stop = [...m.q('provider-status').querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Cancel sign-in',
    )!
    expect(stop).toBeDefined()
    stop.click()
    await settle()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(provider)
    expect(remove).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it(`${provider}: lets the existing native sign-in action run without removing the saved key`, async () => {
    const { m, signIn, remove, save } = await drawer(provider)
    const button = m.q('native-sign-in-again') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()
    await settle()
    expect(signIn).toHaveBeenCalledExactlyOnceWith(provider)
    expect(remove).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it(`${provider}: keeps sign-in and key actions inside their own connection entries`, async () => {
    const { m, check, signIn } = await drawer(provider)
    const entries = m.all('provider-connection')
    const subscription = entries.find((row) => row.textContent?.includes('· subscription'))!
    const key = entries.find((row) => row.textContent?.includes('· API key'))!
    expect(subscription.textContent).toContain('Check again')
    expect(subscription.textContent).toContain('Sign in again')
    const signInAgain = [...subscription.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Sign in again',
    )!
    expect(signInAgain.disabled).toBe(false)
    signInAgain.click()
    await settle()
    expect(signIn).toHaveBeenCalledExactlyOnceWith(provider)
    expect(await window.api.runtime.apiKeyStatus({ provider })).toMatchObject({ set: true })
    const checkKey = [...key.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Check key',
    )
    expect(checkKey).toBeDefined()
    checkKey!.click()
    await settle()
    expect(check).toHaveBeenCalledExactlyOnceWith({ provider })
    const headings = [...m.host.querySelectorAll('h3')].map((h) => h.textContent?.trim())
    expect(headings).not.toContain('Login')
    expect(headings).not.toContain('API key')
    expect(headings).not.toContain('Usage')
    expect(m.q('provider-connections').textContent).not.toContain('In use')
  })

  it(`${provider}: puts subscription usage and time-gone bars inside the subscription entry`, async () => {
    const { m } = await drawer(provider)
    const entries = m.all('provider-connection')
    const subscription = entries.find((row) => row.textContent?.includes('· subscription'))!
    const key = entries.find((row) => row.textContent?.includes('· API key'))!
    expect(subscription.textContent).toContain('Weekly')
    expect(subscription.querySelectorAll('meter').length).toBeGreaterThanOrEqual(2)
    expect(subscription.textContent).toContain('time gone')
    expect(key.querySelectorAll('meter')).toHaveLength(0)
    expect(key.textContent).not.toContain('Weekly')
    expect(m.q('provider-connections').textContent).not.toContain(
      "Usage and cost per connection aren't shown yet.",
    )
  })
}

for (const width of [1180, 760]) {
  it(`two usage windows stack across their shared block at ${width}px`, async () => {
    const { m } = await drawer('claude')
    m.host.style.width = `${width}px`
    await settle()
    const grid = m.host.querySelector<HTMLElement>('.usage-windows')!
    expect(grid).not.toBeNull()
    expect(grid.children).toHaveLength(2)
    const row = grid.getBoundingClientRect()
    expect(row.width).toBeGreaterThan(200)
    const style = getComputedStyle(grid)
    const contentWidth =
      row.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
    const cards = [...grid.children].map((card) => card.getBoundingClientRect())
    for (const card of cards) {
      expect(card.width).toBeGreaterThan(0)
      expect(card.height).toBeGreaterThan(0)
      expect(Math.abs(card.width - contentWidth)).toBeLessThan(1)
      expect(Math.abs(card.left - row.left - parseFloat(style.borderLeftWidth))).toBeLessThan(1)
    }
    expect(cards[1]!.top).toBeGreaterThanOrEqual(cards[0]!.bottom)
  })

  it(`a lone usage card spans its row at ${width}px`, async () => {
    const { m } = await drawer('codex')
    m.host.style.width = `${width}px`
    await settle()
    const grid = m.host.querySelector<HTMLElement>('.usage-windows')!
    expect(grid).not.toBeNull()
    expect(grid.children).toHaveLength(1)
    const row = grid.getBoundingClientRect()
    const card = grid.children[0]!.getBoundingClientRect()
    expect(row.width).toBeGreaterThan(200)
    const style = getComputedStyle(grid)
    const contentWidth =
      row.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
    expect(card.height).toBeGreaterThan(0)
    expect(Math.abs(card.width - contentWidth)).toBeLessThan(1)
    expect(Math.abs(card.left - row.left - parseFloat(style.borderLeftWidth))).toBeLessThan(1)
  })
}

function pendingRows() {
  let resolve!: (rows: readonly ProviderConnection[]) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<readonly ProviderConnection[]>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function cancelIn(m: Awaited<ReturnType<typeof drawer>>['m']): HTMLButtonElement {
  const buttons = [...m.host.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.textContent?.trim() === 'Cancel sign-in' && !button.disabled,
  )
  expect(buttons).toHaveLength(1)
  return buttons[0]!
}

for (const provider of ['claude', 'codex'] as const) {
  for (const partial of ['additional-only', 'key-only'] as const) {
    it(`${provider}: exposes exactly one active Cancel for a ${partial} metadata list`, async () => {
      const f = await drawer(provider, undefined, true, async (rows) =>
        partial === 'key-only'
          ? rows.filter((row) => row.authMethod === 'api-key')
          : [{ ...rows[0]!, id: 'fictional-partial-signin', name: 'fictional extra' }],
      )
      cancelIn(f.m).click()
      await settle()
      expect(f.cancel).toHaveBeenCalledExactlyOnceWith(provider)
    })
  }
  it(`${provider}: a saved key ends editor protection and accepts an empty refresh`, async () => {
    const f = await drawer(provider)
    f.save.mockResolvedValue(await window.api.runtime.apiKeyStatus({ provider }))
    f.m.q('provider-key-replace').click()
    await settle()
    const input = f.m.q('provider-key-input') as HTMLInputElement
    input.focus()
    input.value = 'fictional key for UI only'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    input.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    await settle()
    expect(f.save).toHaveBeenCalledExactlyOnceWith({ provider, key: 'fictional key for UI only' })
    expect(f.m.all('provider-key-input')).toHaveLength(0)
    window.api.runtime.providerConnections = async () => []
    f.refresh()
    await settle()
    expect(f.m.all('provider-connection')).toHaveLength(0)
  })
  it(`${provider}: keeps active Cancel through pending, failed and empty metadata refreshes`, async () => {
    const f = await drawer(provider, undefined, true)
    const pending = pendingRows()
    window.api.runtime.providerConnections = () => pending.promise
    f.refresh()
    await settle()
    cancelIn(f.m)
    pending.reject(new Error('Fictional metadata read failure'))
    await settle()
    cancelIn(f.m)
    window.api.runtime.providerConnections = async () => []
    f.refresh()
    await settle()
    cancelIn(f.m).click()
    await settle()
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(provider)
  })

  for (const missing of ['failed', 'empty'] as const) {
    it(`${provider}: offers active Cancel when the initial metadata read is ${missing}`, async () => {
      const f = await drawer(provider, undefined, true, async () => {
        if (missing === 'failed') throw new Error('Fictional initial metadata failure')
        return []
      })
      cancelIn(f.m).click()
      await settle()
      expect(f.cancel).toHaveBeenCalledExactlyOnceWith(provider)
    })
  }

  it(`${provider}: preserves the focused key input and draft across a late empty result and failed refresh`, async () => {
    const f = await drawer(provider)
    const pending = pendingRows()
    window.api.runtime.providerConnections = () => pending.promise
    f.refresh()
    await settle()
    f.m.q('provider-key-replace').click()
    await settle()
    const input = f.m.q('provider-key-input') as HTMLInputElement
    input.focus()
    input.value = 'fictional unsaved draft'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    const save = input.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!
    save.focus()
    pending.resolve([])
    await settle()
    expect(f.m.q('provider-key-input')).toBe(input)
    expect(input.value).toBe('fictional unsaved draft')
    expect(document.activeElement).toBe(save)
    const afterBlur = pendingRows()
    window.api.runtime.providerConnections = () => afterBlur.promise
    f.refresh()
    await settle()
    f.m.host.tabIndex = -1
    f.m.host.focus()
    afterBlur.resolve([])
    await settle()
    expect(f.m.q('provider-key-input')).toBe(input)
    expect(input.value).toBe('fictional unsaved draft')
    save.focus()
    window.api.runtime.providerConnections = async () => {
      throw new Error('Fictional refresh failure')
    }
    f.refresh()
    await settle()
    expect(f.m.q('provider-key-input')).toBe(input)
    expect(input.value).toBe('fictional unsaved draft')
    expect(document.activeElement).toBe(save)
    const cancel = [...input.closest('form')!.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Cancel',
    )!
    window.api.runtime.providerConnections = async () => f.rows
    cancel.click()
    await settle()
    f.refresh()
    await settle()
    f.m.q('provider-key-replace').click()
    await settle()
    expect((f.m.q('provider-key-input') as HTMLInputElement).value).toBe('')
    expect(f.save).not.toHaveBeenCalled()
  })

  for (const method of ['sign-in', 'api-key'] as const) {
    it(`${provider}: never lends global status, controls or usage to an additional ${method} row`, async () => {
      const f = await drawer(provider, {
        state: 'usable',
        login: method === 'api-key' ? 'api-key' : 'account',
        expiresAt: null,
      })
      const other = {
        ...f.rows.find((row) => row.authMethod === method)!,
        id: `fictional-additional-${method}`,
        name: 'fictional extra',
      }
      window.api.runtime.providerConnections = async () => [...f.rows, other]
      f.refresh()
      await settle()
      const row = f.m
        .all('provider-connection')
        .find((entry) => entry.textContent?.includes('· fictional extra'))!
      expect(row).toBeDefined()
      expect(row.querySelectorAll('button,input,meter')).toHaveLength(0)
      expect(row.textContent).toContain('Not checked')
      expect(row.textContent).not.toContain('Weekly')
      expect(row.textContent).not.toContain('Ready')
    })
  }
}

it('a provider change clears old rows and cancels the original setup intent on its owner', async () => {
  const f = await drawer('claude')
  let finish!: () => void
  const pending = new Promise<{ ok: true }>((resolve) => {
    finish = () => resolve({ ok: true })
  })
  f.signIn.mockReturnValueOnce(pending)
  f.m.q('native-sign-in-again').click()
  await settle()
  const metadata = pendingRows()
  window.api.runtime.providerConnections = () => metadata.promise
  f.changeProvider('codex')
  await settle()
  expect(f.m.all('provider-connection')).toHaveLength(0)
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith('claude')
  metadata.resolve([])
  finish()
  await settle()
})
