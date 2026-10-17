import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ResumableSessions from '../../src/renderer/src/components/ResumableSessions.vue'
import type {
  AdoptionReport,
  ExportedSession,
  ImportedRecording,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible } from './harness'

function session(sessionId = 'fictional-one'): ResumableSessionInfo {
  return {
    sessionId,
    provider: 'codex',
    ref: {
      provider: 'codex',
      sessionId: `thread-${sessionId}`,
      cwd: '/fictional/project',
      rotation: 0,
    },
    cwd: `/fictional/${sessionId}`,
    status: 'idle',
    running: 'not-running',
    state: { is: 'idle' },
    named: null,
    approvalMode: 'ask',
    profileId: null,
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: Date.now(),
    hasTranscript: false,
    lastEnding: 'completed',
    child: null,
    resumeRefusal: null,
    updatedAt: Date.now(),
  }
}

const scanReport: AdoptionReport = {
  found: 0,
  adopted: 0,
  alreadyKnown: 0,
  imported: 0,
  descentsLearned: 0,
  named: 0,
  skipped: [
    {
      provider: 'codex',
      path: '/fictional/unreadable-conversation.jsonl',
      reason: 'No conversation id was recorded.',
    },
  ],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function host(rows = [session()]) {
  const runtime = {
    listResumable: vi.fn(async (): Promise<ResumableSessionInfo[]> => rows),
    listUnresumable: vi.fn(async (): Promise<UnresumableSessionInfo[]> => []),
    exportSession: vi.fn<
      (input: { sessionId: string; exportKind: 'native' | 'bundle' }) => Promise<ExportedSession>
    >(async () => ({
      kind: 'bundle',
      path: '/fictional/exports/conversation.brobot-session.json',
      frames: 3,
      ledgerEntries: 8,
      resumable: false,
      note: 'A self-contained conversation copy.',
    })),
    importRecordedSession: vi.fn<(input: { sessionId: string }) => Promise<ImportedRecording>>(
      async () => ({
        outcome: 'imported',
        readable: true,
        note: 'Imported three prior messages.',
      }),
    ),
    adoptSessions: vi.fn(async (): Promise<AdoptionReport> => scanReport),
  }
  ;(window as unknown as { api: unknown }).api = { runtime }
  return runtime
}

afterEach(() => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

describe('recorded conversations host actions', () => {
  it('says looking while both lists load, then shows the empty result', async () => {
    const runtime = host([])
    const loading = deferred<UnresumableSessionInfo[]>()
    runtime.listUnresumable.mockReturnValueOnce(loading.promise)
    const view = mount(ResumableSessions, {})
    await nextTick()
    expect(view.host.textContent).toContain('looking…')
    expect(view.all('resumable-empty')).toHaveLength(0)
    loading.resolve([])
    await expect.poll(() => view.all('resumable-empty').length).toBe(1)
    expect(visible(view.q('resumable-empty'))).toBe(true)
    expect(view.q('resumable-empty').textContent).toContain('Nothing recorded yet.')
    expect(runtime.listResumable).toHaveBeenCalledTimes(1)
    expect(runtime.listUnresumable).toHaveBeenCalledTimes(1)
  })

  it('recovers from a list failure using refresh and opens an unresumable recording', async () => {
    const runtime = host([])
    runtime.listUnresumable.mockRejectedValueOnce(
      new Error('Recorded conversations are unavailable.'),
    )
    const open = vi.fn()
    const view = mount(ResumableSessions, { onOpen: open })
    await expect.poll(() => view.all('resumable-error').length).toBe(1)
    expect(view.q('resumable-error').textContent).toContain(
      'Recorded conversations are unavailable.',
    )
    expect(view.all('resumable-empty')).toHaveLength(0)
    runtime.listUnresumable.mockResolvedValueOnce([
      {
        sessionId: 'fictional-restored',
        provider: 'codex',
        cwd: '/fictional/restored',
        status: 'ended',
        running: 'not-running',
        state: { is: 'idle' },
        named: null,
        profileId: null,
        adoptedAt: null,
        updatedAt: Date.now(),
        hasTranscript: true,
        foundInUserHome: false,
        restoredFromBundle: true,
        lastEnding: 'completed',
        reason: 'Restored from a bundle; there is no provider session to resume.',
      },
    ])
    view.q('refresh-resumable').click()
    await expect.poll(() => view.all('unresumable-row').length).toBe(1)
    expect(view.all('resumable-error')).toHaveLength(0)
    expect(view.q('unresumable-profile').textContent).toContain('from a bundle')
    expect(view.q('unresumable-reason').textContent).toContain('no provider session to resume')
    expect(visible(view.q('sessions-open-fictional-restored'))).toBe(true)
    view.q('sessions-open-fictional-restored').click()
    expect(open.mock.calls).toEqual([['fictional-restored']])
    expect(runtime.listResumable).toHaveBeenCalledTimes(2)
    expect(runtime.listUnresumable).toHaveBeenCalledTimes(2)
  })

  it('locks both export choices on the busy row while another row can still export', async () => {
    const runtime = host([session(), session('fictional-two')])
    const exporting = deferred<ExportedSession>()
    runtime.exportSession.mockReturnValueOnce(exporting.promise)
    const view = mount(ResumableSessions, {})
    await expect.poll(() => view.all('resumable-row').length).toBe(2)
    const native = view.q('export-native-fictional-one') as HTMLButtonElement
    const bundle = view.q('export-bundle-fictional-one') as HTMLButtonElement
    expect(visible(native)).toBe(true)
    native.click()
    await nextTick()
    expect(native.disabled).toBe(true)
    expect(bundle.disabled).toBe(true)
    bundle.click()
    const other = view.q('export-bundle-fictional-two') as HTMLButtonElement
    expect(other.disabled).toBe(false)
    other.click()
    await expect.poll(() => view.all('export-result').length).toBe(1)
    expect(runtime.exportSession.mock.calls).toEqual([
      [{ sessionId: 'fictional-one', exportKind: 'native' }],
      [{ sessionId: 'fictional-two', exportKind: 'bundle' }],
    ])
    expect(view.q('export-result').textContent).toContain('a copy, not a restored session')
    exporting.resolve({
      kind: 'native',
      path: '/fictional/exports/provider-file.jsonl',
      frames: 3,
      ledgerEntries: 0,
      resumable: true,
      note: 'The provider can use this file.',
    })
    await expect.poll(() => view.all('export-result').length).toBe(2)
    expect(view.host.textContent).toContain('/fictional/exports/provider-file.jsonl')
    expect(view.host.textContent).toContain('a provider can resume this')
    expect(view.host.textContent).toContain('The provider can use this file.')
    expect(native.disabled).toBe(false)
    expect(bundle.disabled).toBe(false)
    expect(runtime.listResumable).toHaveBeenCalledTimes(1)
  })

  it('reports an export failure and lets the person retry with a bundle', async () => {
    const runtime = host()
    runtime.exportSession.mockRejectedValueOnce(new Error('The export destination is unwritable.'))
    const view = mount(ResumableSessions, {})
    await expect.poll(() => view.all('resumable-row').length).toBe(1)
    view.q('export-native-fictional-one').click()
    await expect
      .poll(() => view.q('export-result').textContent)
      .toContain('The export destination is unwritable.')
    const retry = view.q('export-bundle-fictional-one') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    retry.click()
    await expect
      .poll(() => view.q('export-result').textContent)
      .toContain('/fictional/exports/conversation.brobot-session.json')
    expect(view.q('export-result').textContent).toContain('A self-contained conversation copy.')
    expect(view.q('export-result').textContent).not.toContain('unwritable')
    expect(runtime.exportSession.mock.calls).toEqual([
      [{ sessionId: 'fictional-one', exportKind: 'native' }],
      [{ sessionId: 'fictional-one', exportKind: 'bundle' }],
    ])
  })

  it('retries a failed message import and waits for the refreshed transcript before removing Import', async () => {
    const runtime = host()
    runtime.importRecordedSession.mockRejectedValueOnce(
      new Error('The recording is temporarily locked.'),
    )
    const importing = deferred<ImportedRecording>()
    runtime.importRecordedSession.mockReturnValueOnce(importing.promise)
    const view = mount(ResumableSessions, {})
    await expect.poll(() => view.all('resumable-row').length).toBe(1)
    view.q('import-messages-fictional-one').click()
    await expect
      .poll(() => view.q('import-result-fictional-one').textContent)
      .toContain('temporarily locked')
    expect(runtime.listResumable).toHaveBeenCalledTimes(1)
    const retry = view.q('import-messages-fictional-one') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    retry.click()
    await nextTick()
    expect(retry.disabled).toBe(true)
    expect(retry.textContent).toContain('importing…')
    retry.click()
    expect(runtime.importRecordedSession.mock.calls).toEqual([
      [{ sessionId: 'fictional-one' }],
      [{ sessionId: 'fictional-one' }],
    ])
    const rereading = deferred<ResumableSessionInfo[]>()
    runtime.listResumable.mockReturnValueOnce(rereading.promise)
    importing.resolve({
      outcome: 'imported',
      readable: true,
      note: 'Imported three prior messages.',
    })
    await expect.poll(() => view.host.textContent).toContain('looking…')
    rereading.resolve([{ ...session(), hasTranscript: true }])
    await expect.poll(() => view.all('resumable-row').length).toBe(1)
    await expect.poll(() => view.all('import-messages-fictional-one').length).toBe(0)
    expect(view.q('import-result-fictional-one').textContent).toContain(
      'Imported three prior messages.',
    )
    expect(view.q('resumable-adopted').textContent).not.toContain('prior messages not imported yet')
    expect(view.q('sessions-open-fictional-one').textContent).toContain('Open')
    expect(runtime.listResumable).toHaveBeenCalledTimes(2)
    expect(runtime.listUnresumable).toHaveBeenCalledTimes(2)
  })

  it('retries a failed scan, rereads the lists, and explains records it could not adopt', async () => {
    const runtime = host()
    runtime.adoptSessions.mockRejectedValueOnce(new Error('The scan could not read the folder.'))
    const scanning = deferred<AdoptionReport>()
    runtime.adoptSessions.mockReturnValueOnce(scanning.promise)
    const view = mount(ResumableSessions, {})
    await expect.poll(() => view.all('resumable-row').length).toBe(1)
    view.q('scan-sessions').click()
    await expect
      .poll(() => view.q('resumable-error').textContent)
      .toContain('The scan could not read the folder.')
    expect(runtime.listResumable).toHaveBeenCalledTimes(1)
    const retry = view.q('scan-sessions') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    retry.click()
    await nextTick()
    expect(retry.disabled).toBe(true)
    expect(retry.textContent).toContain('scanning…')
    expect(view.all('resumable-error')).toHaveLength(0)
    retry.click()
    expect(runtime.adoptSessions).toHaveBeenCalledTimes(2)
    scanning.resolve(scanReport)
    await expect.poll(() => retry.disabled).toBe(false)
    expect(view.q('scan-summary').textContent).toContain('nothing new to adopt — see below')
    const skipped = view.q('scan-skipped') as HTMLDetailsElement
    expect(skipped.textContent).toContain('1 found but not adopted — why')
    skipped.querySelector('summary')!.click()
    await nextTick()
    expect(skipped.open).toBe(true)
    expect(skipped.textContent).toContain('/fictional/unreadable-conversation.jsonl')
    expect(skipped.textContent).toContain('No conversation id was recorded.')
    expect(runtime.listResumable).toHaveBeenCalledTimes(2)
    expect(runtime.listUnresumable).toHaveBeenCalledTimes(2)
  })
})
