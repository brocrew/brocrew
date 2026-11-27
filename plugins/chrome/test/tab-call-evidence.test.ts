import { afterEach, expect, it, vi } from 'vitest'
import { FakeLocator, harnessWithTab, removeHarnessesWithTab } from './fakes.js'
import { createAgentChromeTools } from '../src/tools/index.js'

afterEach(() => {
  vi.restoreAllMocks()
  removeHarnessesWithTab()
})
async function setup() {
  const { h, tabId, page, tab } = await harnessWithTab()
  tab.refs = new Set(['e1'])
  const locator = new FakeLocator('aria-ref=e1')
  vi.spyOn(page, 'locator').mockReturnValue(locator)
  const tools = createAgentChromeTools(h.deps)
  const failure = async (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      await tools.find((t) => t.definition.name === tool)!.execute(args, { signal })
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('expected a failure')
  }
  return { h, page, tabId, locator, failure }
}

it('a call behind a held tab fails within its own timeout, and never acts later', async () => {
  const { h, page, tabId, locator, failure } = await setup()
  let release!: () => void
  const held = h.deps.serializer.runExclusive(tabId, () => new Promise<void>((r) => (release = r)))
  const message = await failure('click', { tabId, ref: 'e1', timeoutMs: 200 })
  expect(message).toBe(
    `tab ${tabId} was not ready within 1 s (an earlier call on this tab is still running); nothing was sent`,
  )
  release()
  await held
  await new Promise((r) => setTimeout(r, 20))
  expect(locator.calls).toEqual([])
  expect(page.mouseCalls).toEqual([])
})

it('a window lookup that does not answer fails within the timeout with nothing sent', async () => {
  const { h, page, tabId, locator, failure } = await setup()
  vi.spyOn(h.browser, 'usePage').mockImplementation(
    (_profile, _page, signal) =>
      new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  )
  expect(await failure('click', { tabId, ref: 'e1', timeoutMs: 200 })).toBe(
    `tab ${tabId} was not ready within 1 s (the browser did not answer); nothing was sent`,
  )
  expect(locator.calls).toEqual([])
  expect(page.mouseCalls).toEqual([])
})

it('a call cancelled while it waits for the tab says so and never acts', async () => {
  const { h, page, tabId, locator, failure } = await setup()
  let release!: () => void
  const held = h.deps.serializer.runExclusive(tabId, () => new Promise<void>((r) => (release = r)))
  const cancel = new AbortController()
  const pending = failure('click', { tabId, ref: 'e1' }, cancel.signal)
  cancel.abort()
  expect(await pending).toBe(`cancelled before tab ${tabId} was ready; nothing was sent`)
  release()
  await held
  await new Promise((r) => setTimeout(r, 20))
  expect(locator.calls).toEqual([])
  expect(page.mouseCalls).toEqual([])
})

it("a click runs Playwright's checks without input, then Playwright's own click", async () => {
  const { h, page, tabId, locator } = await setup()
  await h.call('click', { tabId, ref: 'e1', button: 'right', double: true })
  expect(locator.calls).toEqual([
    ['click', expect.objectContaining({ button: 'right', clickCount: 2, trial: true })],
    ['click', expect.objectContaining({ button: 'right', clickCount: 2 })],
  ])
  expect(locator.calls[1]![1]).not.toHaveProperty('trial')
  expect(page.mouseCalls).toEqual([])
})

it('a click whose checks fail says nothing was sent on its first line', async () => {
  const { tabId, locator, failure } = await setup()
  vi.spyOn(locator, 'click').mockRejectedValueOnce(
    new Error('locator.click: Timeout 15000ms exceeded.\nCall log:\n  - element is not stable'),
  )
  expect(await failure('click', { tabId, ref: 'e1' })).toBe(
    'locator.click: Timeout 15000ms exceeded.; nothing was sent\nCall log:\n  - element is not stable',
  )
  expect(locator.click).toHaveBeenCalledOnce()
})

it('a click cancelled after its checks says nothing was sent and does not click', async () => {
  const { tabId, locator, failure } = await setup()
  const cancel = new AbortController()
  const click = vi.spyOn(locator, 'click').mockImplementation(async () => cancel.abort())
  expect(await failure('click', { tabId, ref: 'e1' }, cancel.signal)).toBe(
    'cancelled; nothing was sent',
  )
  expect(click).toHaveBeenCalledOnce()
})

it('a click that fails after its checks passed says completion is unknown', async () => {
  const { tabId, locator, failure } = await setup()
  vi.spyOn(locator, 'click')
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('locator.click: Timeout 15000ms exceeded.'))
  expect(await failure('click', { tabId, ref: 'e1' })).toBe(
    'locator.click: Timeout 15000ms exceeded.; completion unknown',
  )
})
