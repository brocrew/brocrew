import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeLocator, harness } from './fakes.js'
import { createKeyedSerializer } from '../src/shared/browser/browser-lease.js'

describe('dialogs require an explicit answer', () => {
  const made: ReturnType<typeof harness>[] = []
  afterEach(() => {
    vi.useRealTimers()
    for (const h of made.splice(0))
      for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
        fs.rmSync(dir, { recursive: true, force: true })
  })
  async function setup() {
    const h = harness()
    made.push(h)
    h.deps.serializer = createKeyedSerializer()
    h.profile('p')
    const { tabId } = (await h.call('open_tab', { profile: 'p', url: 'about:blank' })).json as {
      tabId: string
    }
    const page = h.browser.pages.get('p')![0]
    const tab = h.tabs.resolve(tabId, () => 1)
    return { h, tabId, page, tab }
  }
  function dialog(type = 'confirm', message = 'Continue?') {
    return {
      type: () => type,
      message: () => message,
      accept: vi.fn<(promptText?: string) => Promise<void>>().mockResolvedValue(undefined),
      dismiss: vi.fn(async () => {}),
    }
  }
  it('keeps an unanswered dialog after the former deadline and reports it to blocked calls', async () => {
    const { h, page, tabId, tab } = await setup()
    vi.useFakeTimers()
    const d = dialog()
    page.emit('dialog', d)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(d.dismiss).not.toHaveBeenCalled()
    expect(d.accept).not.toHaveBeenCalled()
    expect(tab.pendingDialog).toBe(d)
    const error = await h.callError('snapshot', { tabId })
    expect(error).toContain('confirm')
    expect(error).toContain('Continue?')
    expect(error).toContain(tabId)
    expect(error).toContain('handle_dialog')
    expect(page.evaluated).toEqual([])
  })
  it('reports a dialog after the opening evaluate deadline without replaying the action', async () => {
    const { h, page, tabId, tab } = await setup()
    const d = dialog('prompt', 'Your name?')
    let finish!: () => void
    const blocked = new Promise<void>((resolve) => {
      finish = resolve
    })
    d.accept.mockImplementation(async () => {
      finish()
    })
    const evaluate = vi.spyOn(page, 'evaluate').mockImplementation(() => {
      page.emit('dialog', d)
      return blocked.then(() => ({ ok: 1 }))
    })
    expect(
      await h.callError('evaluate', { tabId, expression: 'prompt("Your name?")', timeoutMs: 100 }),
    ).toMatch(/prompt.*Your name\?.*handle_dialog/)
    expect(await h.callError('snapshot', { tabId })).toContain('handle_dialog')
    expect(evaluate).toHaveBeenCalledTimes(1)
    await h.call('handle_dialog', { tabId, accept: true, promptText: 'Ada' })
    expect(d.accept).toHaveBeenCalledWith('Ada')
    expect(tab.pendingDialog).toBeNull()
    await h.call('snapshot', { tabId })
    expect(h.deps.serializer.activeKeys()).toBe(0)
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(page.listenerCount('dialog')).toBe(1)
  })
  it('reports an opening click timeout, and reports already-open dialogs before the tab queue', async () => {
    const { h, page, tabId, tab } = await setup()
    tab.refs = new Set(['e1'])
    const d = dialog()
    const error = Object.assign(new Error('fixture blocked click'), { name: 'TimeoutError' })
    vi.spyOn(page, 'locator').mockReturnValue(
      new FakeLocator('aria-ref=e1', () => {
        page.emit('dialog', d)
        throw error
      }),
    )
    expect(await h.callError('click', { tabId, ref: 'e1' })).toMatch(
      /confirm.*handle_dialog.*unknown/,
    )
    let release!: () => void
    const held = h.deps.serializer.runExclusive(
      tabId,
      () =>
        new Promise<void>((r) => {
          release = r
        }),
    )
    await Promise.resolve()
    expect(await h.callError('snapshot', { tabId })).toContain('handle_dialog')
    release()
    await held
    await h.call('handle_dialog', { tabId, accept: false })
    expect(d.dismiss).toHaveBeenCalledOnce()
  })
  it('preserves a successful action result while reporting the dialog it left open', async () => {
    const { h, page, tabId } = await setup()
    vi.spyOn(page, 'evaluate').mockImplementation(async () => {
      page.emit('dialog', dialog())
      return { ok: 1 }
    })
    const result = await h.call('evaluate', { tabId, expression: 'fixture()' })
    expect(result.text).toContain('{"ok":1}')
    expect(result.text).toMatch(/confirm.*Continue\?.*handle_dialog/)
  })
  it('reports a dialog opened during new-tab navigation with its usable tab id', async () => {
    const { h } = await setup()
    const d = dialog()
    const create = h.browser.newPage.bind(h.browser)
    vi.spyOn(h.browser, 'newPage').mockImplementation(async (...args) => {
      const page = await create(...args)
      vi.spyOn(page, 'goto').mockImplementation(async () => {
        h.browser.pages.get('p')!.at(-1)!.emit('dialog', d)
        throw Object.assign(new Error('fixture navigation blocked'), { name: 'TimeoutError' })
      })
      return page
    })
    const opened = (await h.call('open_tab', { profile: 'p', url: 'about:blank' })).json as {
      tabId: string
      dialog: string
      loadError: string
    }
    expect(opened.dialog).toContain(opened.tabId)
    expect(opened.dialog).toMatch(/confirm.*Continue\?.*handle_dialog/)
    expect(opened.loadError).toContain('handle_dialog')
    expect(d.dismiss).not.toHaveBeenCalled()
    await h.call('handle_dialog', { tabId: opened.tabId, accept: false })
    expect(d.dismiss).toHaveBeenCalledOnce()
  })
  it('preserves a successful screenshot and reports its open dialog in the caption', async () => {
    const { h, page, tabId } = await setup()
    vi.spyOn(page, 'screenshot').mockImplementation(async () => {
      page.emit('dialog', dialog())
      return Buffer.from('png')
    })
    const result = await h.call('screenshot', { tabId, scope: 'viewport' })
    expect(result.raw.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
    )
    expect(result.text).toContain(`viewport screenshot of ${tabId}`)
    expect(result.text).toMatch(/confirm.*Continue\?.*handle_dialog/)
  })
  it('retains a dialog when its explicit answer fails, and permits retrying that answer', async () => {
    const { h, page, tabId, tab } = await setup()
    const d = dialog()
    page.emit('dialog', d)
    d.dismiss.mockRejectedValueOnce(new Error('fixture answer failed'))
    await h.callError('handle_dialog', { tabId, accept: false })
    expect(tab.pendingDialog).toBe(d)
    await h.call('handle_dialog', { tabId, accept: false })
    expect(d.dismiss).toHaveBeenCalledTimes(2)
    expect(tab.pendingDialog).toBeNull()
  })
  it('rechecks a queued call when a dialog opens before its action starts', async () => {
    const { h, page, tabId } = await setup()
    let release!: () => void
    const held = h.deps.serializer.runExclusive(
      tabId,
      () =>
        new Promise<void>((r) => {
          release = r
        }),
    )
    await Promise.resolve()
    const action = vi.spyOn(page, 'ariaSnapshot')
    const result = h.callError('snapshot', { tabId })
    await Promise.resolve()
    page.emit('dialog', dialog())
    release()
    await held
    expect(await result).toContain('handle_dialog')
    expect(action).not.toHaveBeenCalled()
  })
  it('does not erase a subsequent dialog while an explicit response finishes', async () => {
    const { h, page, tabId, tab } = await setup()
    const first = dialog()
    const second = dialog('prompt', 'Next?')
    first.accept.mockImplementation(async () => {
      page.emit('dialog', second)
    })
    page.emit('dialog', first)
    await h.call('handle_dialog', { tabId, accept: true })
    expect(tab.pendingDialog).toBe(second)
    expect(await h.callError('snapshot', { tabId })).toContain('Next?')
  })
  it('keeps a dialog discoverable after a preplanned answer fails', async () => {
    const { h, page, tabId, tab } = await setup()
    await h.call('handle_dialog', { tabId, accept: true })
    const d = dialog()
    d.accept.mockRejectedValueOnce(new Error('fixture planned answer failed'))
    page.emit('dialog', d)
    await Promise.resolve()
    expect(tab.pendingDialog).toBe(d)
    const listed = (await h.call('list_tabs')).json as Array<{ tabId: string; dialog: string }>
    expect(listed.find((t) => t.tabId === tabId)?.dialog).toContain('handle_dialog')
  })
  it('preserves one-shot explicit plans and isolates other tabs and ordinary failures', async () => {
    const { h, page, tabId } = await setup()
    await h.call('handle_dialog', { tabId, accept: false })
    const first = dialog()
    page.emit('dialog', first)
    expect(first.dismiss).toHaveBeenCalledTimes(1)
    const second = dialog()
    page.emit('dialog', second)
    const other = (await h.call('open_tab', { profile: 'p', url: 'about:blank' })).json as {
      tabId: string
    }
    expect((await h.call('snapshot', { tabId: other.tabId })).text).toContain('button')
    expect(second.dismiss).not.toHaveBeenCalled()
    await h.call('handle_dialog', { tabId, accept: true })
    vi.spyOn(page, 'ariaSnapshot').mockRejectedValue(new Error('ordinary failure'))
    expect(await h.callError('snapshot', { tabId })).toBe('ordinary failure')
    expect(page.listenerCount('dialog')).toBe(1)
  })
})
