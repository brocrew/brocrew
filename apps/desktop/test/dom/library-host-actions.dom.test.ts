import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import type {
  ImportedFromHome,
  LibraryEntry,
  LibraryPage,
  RebuiltLedger,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible } from './harness'

function entry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: 'fictional-thread',
    provider: 'codex',
    providerSessionId: 'fictional-thread',
    recordId: null,
    cwd: '/fictional/project',
    title: 'Review the parser',
    preview: 'Check the token handling',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    bytes: 128,
    origin: 'user-home',
    onDisk: true,
    readable: false,
    derived: null,
    lastEnding: 'completed',
    unresumableReason: null,
    child: null,
    ...over,
  }
}

function page(row: LibraryEntry): LibraryPage {
  return {
    entries: [row],
    matched: 1,
    counts: {
      total: 1,
      ours: 0,
      userHome: 1,
      restored: 0,
      imported: row.recordId === null ? 0 : 1,
      notImported: row.recordId === null ? 1 : 0,
      onlyHere: 0,
      providers: [{ provider: 'codex', total: 1 }],
    },
    skipped: [],
    skippedTotal: 0,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function host(row: LibraryEntry) {
  const runtime = {
    listLibrary: vi.fn(async () => page(row)),
    listResumable: vi.fn(async () => []),
    listUnresumable: vi.fn(async () => []),
    importUserHomeSession: vi.fn<
      (input: { provider: string; providerSessionId: string }) => Promise<ImportedFromHome>
    >(async () => ({
      outcome: 'imported',
      sessionId: 'fictional-record',
      readable: true,
      note: 'Imported the parser conversation.',
    })),
    rebuildLedger: vi.fn<(input: { sessionId: string }) => Promise<RebuiltLedger>>(async () => ({
      outcome: 'stopped',
      status: null,
    })),
  }
  ;(window as unknown as { api: unknown }).api = { runtime }
  return runtime
}

afterEach(() => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

describe('library imports and rebuilds through the host', () => {
  it('keeps import busy until the refreshed row can be opened, and preserves its result', async () => {
    const runtime = host(entry())
    const importing = deferred<ImportedFromHome>()
    const rereading = deferred<LibraryPage>()
    runtime.importUserHomeSession.mockReturnValueOnce(importing.promise)
    runtime.listLibrary
      .mockReturnValueOnce(Promise.resolve(page(entry())))
      .mockReturnValueOnce(rereading.promise)
    const read = vi.fn()
    const view = mount(SessionLibrary, { onRead: read })
    await expect.poll(() => view.all('library-import-fictional-thread').length).toBe(1)
    const button = view.q('library-import-fictional-thread') as HTMLButtonElement
    expect(visible(button)).toBe(true)
    button.click()
    await nextTick()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Importing…')
    button.click()
    expect(runtime.importUserHomeSession.mock.calls).toEqual([
      [{ provider: 'codex', providerSessionId: 'fictional-thread' }],
    ])
    expect(read).not.toHaveBeenCalled()

    importing.resolve({
      outcome: 'imported',
      sessionId: 'fictional-record',
      readable: true,
      note: 'Imported the parser conversation.',
    })
    await expect
      .poll(() => view.q('library-outcome-fictional-thread').textContent)
      .toContain('Imported the parser conversation.')
    expect(button.disabled).toBe(true)
    const imported = entry({ recordId: 'fictional-record', readable: true, derived: 'current' })
    rereading.resolve(page(imported))
    await expect.poll(() => view.all('library-read-fictional-thread').length).toBe(1)
    expect(view.all('library-import-fictional-thread')).toHaveLength(0)
    expect(view.q('library-outcome-fictional-thread').textContent).toContain(
      'Imported the parser conversation.',
    )
    view.q('library-read-fictional-thread').click()
    expect(read.mock.calls).toEqual([[imported]])
  })

  it('shows an import error and allows a new attempt without rereading on failure', async () => {
    const runtime = host(entry())
    runtime.importUserHomeSession.mockRejectedValueOnce(
      new Error('The conversation file is unreadable.'),
    )
    const view = mount(SessionLibrary, {})
    await expect.poll(() => view.all('library-import-fictional-thread').length).toBe(1)
    view.q('library-import-fictional-thread').click()
    await expect
      .poll(() => view.q('library-outcome-fictional-thread').textContent)
      .toContain('The conversation file is unreadable.')
    expect(visible(view.q('library-outcome-fictional-thread'))).toBe(true)
    expect(runtime.listLibrary).toHaveBeenCalledTimes(1)
    const retry = view.q('library-import-fictional-thread') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    retry.click()
    await expect
      .poll(() => view.q('library-outcome-fictional-thread').textContent)
      .toContain('Imported the parser conversation.')
    expect(runtime.importUserHomeSession).toHaveBeenCalledTimes(2)
    expect(runtime.listLibrary).toHaveBeenCalledTimes(2)
  })

  it('offers Import again after an unfinished user-home file gains a recorded row', async () => {
    const runtime = host(entry())
    runtime.importUserHomeSession.mockResolvedValueOnce({
      outcome: 'still-writing',
      sessionId: 'fictional-record',
      readable: false,
      note: 'Its file is still being written. Try importing it again when it has finished.',
    })
    runtime.listLibrary
      .mockResolvedValueOnce(page(entry()))
      .mockResolvedValue(page(entry({ recordId: 'fictional-record', readable: false })))
    const view = mount(SessionLibrary, {})
    await expect.poll(() => view.all('library-import-fictional-thread').length).toBe(1)
    view.q('library-import-fictional-thread').click()
    await expect.poll(() => runtime.listLibrary.mock.calls.length).toBe(2)
    await expect
      .poll(() => view.q('library-outcome-fictional-thread').textContent)
      .toContain('still being written')
    expect(view.all('library-import-fictional-thread')).toHaveLength(1)
    const retry = view.q('library-import-fictional-thread') as HTMLButtonElement
    await expect.poll(() => retry.disabled).toBe(false)
    retry.click()
    await expect.poll(() => runtime.importUserHomeSession.mock.calls.length).toBe(2)
    expect(runtime.rebuildLedger).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'a current import offers Rebuild only while its file is on disk (%s)',
    async (onDisk) => {
      const current = entry({
        recordId: 'fictional-record',
        readable: true,
        derived: 'current',
        onDisk,
      })
      const runtime = host(current)
      const rebuilding = deferred<RebuiltLedger>()
      runtime.rebuildLedger.mockReturnValueOnce(rebuilding.promise)
      const read = vi.fn()
      const view = mount(SessionLibrary, { onRead: read })
      await expect.poll(() => view.all('library-read-fictional-thread').length).toBe(1)
      expect(view.all('library-rebuild-fictional-thread')).toHaveLength(onDisk ? 1 : 0)
      if (!onDisk) {
        expect(view.all('library-behind-fictional-thread')).toHaveLength(0)
        return
      }
      expect(view.q('library-behind-fictional-thread').querySelector('.txt')).toBeNull()
      const button = view.q('library-rebuild-fictional-thread') as HTMLButtonElement
      button.click()
      await nextTick()
      expect(runtime.rebuildLedger.mock.calls).toEqual([[{ sessionId: 'fictional-record' }]])
      expect(button.disabled).toBe(true)
      expect(read).not.toHaveBeenCalled()
      rebuilding.resolve({ outcome: 'imported', status: null })
      await expect
        .poll(() => view.q('library-outcome-fictional-thread').textContent)
        .toContain('Read again from its file.')
      await expect.poll(() => button.disabled).toBe(false)
      expect(runtime.listLibrary).toHaveBeenCalledTimes(2)
    },
  )

  it('reports a stopped rebuild, then replaces the stale row after a successful retry', async () => {
    const stale = entry({ recordId: 'fictional-record', readable: true, derived: 'stale' })
    const runtime = host(stale)
    const rebuilding = deferred<RebuiltLedger>()
    runtime.rebuildLedger
      .mockReturnValueOnce(rebuilding.promise)
      .mockResolvedValueOnce({ outcome: 'imported', status: null })
    const read = vi.fn()
    const view = mount(SessionLibrary, { onRead: read })
    await expect.poll(() => view.all('library-rebuild-fictional-thread').length).toBe(1)
    const button = view.q('library-rebuild-fictional-thread') as HTMLButtonElement
    button.click()
    await nextTick()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Rebuilding…')
    button.click()
    expect(runtime.rebuildLedger.mock.calls).toEqual([[{ sessionId: 'fictional-record' }]])
    expect(read).not.toHaveBeenCalled()
    rebuilding.resolve({ outcome: 'stopped', status: null })
    await expect
      .poll(() => view.q('library-outcome-fictional-thread').textContent)
      .toContain('Stopped part-way. The previous transcript is untouched; try again.')
    await expect.poll(() => button.disabled).toBe(false)
    expect(runtime.listLibrary).toHaveBeenCalledTimes(2)

    runtime.listLibrary.mockResolvedValueOnce(
      page(entry({ recordId: 'fictional-record', readable: true, derived: 'current' })),
    )
    button.click()
    await expect.poll(() => view.all('library-rebuild-fictional-thread').length).toBe(1)
    expect(view.q('library-outcome-fictional-thread').textContent).toContain(
      'Read again from its file.',
    )
    expect(view.q('library-read-fictional-thread').textContent).toContain('Open')
    expect(runtime.rebuildLedger).toHaveBeenCalledTimes(2)
  })

  it('keeps an unfinished rebuild retryable and says the previous transcript was not replaced', async () => {
    const runtime = host(entry({ recordId: 'fictional-record', readable: true, derived: 'stale' }))
    runtime.rebuildLedger.mockResolvedValueOnce({ outcome: 'still-writing', status: null })
    const view = mount(SessionLibrary, {})
    await expect.poll(() => view.all('library-rebuild-fictional-thread').length).toBe(1)
    view.q('library-rebuild-fictional-thread').click()
    await expect
      .poll(() => view.q('library-outcome-fictional-thread').textContent)
      .toContain(
        'Its file is still being written. Nothing was replaced; try again when it has finished.',
      )
    expect(view.q('library-outcome-fictional-thread').getAttribute('data-outcome')).toBe(
      'still-writing',
    )
    await expect
      .poll(() => (view.q('library-rebuild-fictional-thread') as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('shows a failed rebuild request and keeps Try again available', async () => {
    const runtime = host(entry({ recordId: 'fictional-record', readable: true, derived: 'failed' }))
    runtime.rebuildLedger.mockRejectedValueOnce(new Error('The archive cannot be opened.'))
    const view = mount(SessionLibrary, {})
    await expect.poll(() => view.all('library-rebuild-fictional-thread').length).toBe(1)
    view.q('library-rebuild-fictional-thread').click()
    await expect
      .poll(() => view.q('library-outcome-fictional-thread').textContent)
      .toContain('The archive cannot be opened.')
    expect(runtime.listLibrary).toHaveBeenCalledTimes(1)
    const retry = view.q('library-rebuild-fictional-thread') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    expect(retry.textContent).toContain('Try again')
    retry.click()
    await expect
      .poll(() => view.q('library-outcome-fictional-thread').textContent)
      .toContain('Stopped part-way.')
    expect(runtime.rebuildLedger).toHaveBeenCalledTimes(2)
  })
})
