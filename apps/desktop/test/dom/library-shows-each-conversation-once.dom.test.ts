import { afterEach, expect, it, vi } from 'vitest'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import type {
  AdoptionReport,
  ExportedSession,
  ImportedFromHome,
  ImportedRecording,
  LibraryEntry,
  LibraryQuery,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'
import { entry, page } from './library-filter-fixture'
import { openableRow } from './ordinary-rail-rows.fixture'
import {
  disposeRuntimeScreenFixture,
  installRuntimeScreenFixture,
  runtime as screenRuntime,
} from './runtime-screen-fixture'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

function recording(id: string, readable: boolean): ResumableSessionInfo {
  const cwd = `/example/${id}`
  return {
    ...openableRow(cwd, 1),
    sessionId: `record-${id}`,
    provider: 'codex',
    ref: { provider: 'codex', sessionId: id, cwd, rotation: 0 },
    adoptedAt: id === 'adopted' ? 1 : null,
    hasTranscript: readable,
  }
}

const kinds = ['recorded', 'adopted', 'imported', 'external', 'ended', 'restored'] as const
const readFailure = {
  provider: 'codex' as const,
  path: '/example/unreadable',
  reason: 'Nothing to read.',
}
const scanFailure = {
  provider: 'claude' as const,
  path: '/example/not-adopted',
  reason: 'Incomplete file.',
}

function fixture() {
  const entries = kinds.map((id) =>
    entry({
      id: `library-${id}`,
      recordId: id === 'external' ? null : `record-${id}`,
      provider: 'codex',
      providerSessionId: id,
      title: '',
      preview: '',
      cwd: `/example/${id}`,
      origin:
        id === 'restored'
          ? 'restored'
          : id === 'imported' || id === 'external'
            ? 'user-home'
            : 'ours',
      onDisk: id === 'external' || id === 'imported',
      readable: id !== 'adopted' && id !== 'external' && id !== 'ended',
      unresumableReason:
        id === 'ended'
          ? 'The provider file is gone.'
          : id === 'imported'
            ? 'Found in your provider folder.'
            : id === 'restored'
              ? 'Restored from a bundle.'
              : null,
    }),
  )
  const recordings = [recording('recorded', true), recording('adopted', false)]
  const closed: UnresumableSessionInfo[] = entries
    .filter((row) => row.unresumableReason !== null)
    .map((row) => ({
      ...openableRow(row.cwd, row.updatedAt),
      sessionId: row.recordId!,
      provider: row.provider,
      hasTranscript: row.readable,
      foundInUserHome: row.origin === 'user-home',
      restoredFromBundle: row.origin === 'restored',
      reason: row.unresumableReason!,
    }))
  const runtime = {
    listLibrary: vi.fn(async ({ query }: LibraryQuery) => {
      const matched = entries.filter((row) => row.cwd.includes(query ?? ''))
      return page({
        entries: matched,
        matched: matched.length,
        skipped: [readFailure],
        skippedTotal: 1,
      })
    }),
    listResumable: vi.fn(async () => recordings),
    listUnresumable: vi.fn(async () => closed),
    importRecordedSession: vi.fn(async (): Promise<ImportedRecording> => {
      recordings[1] = recording('adopted', true)
      entries[1] = { ...entries[1]!, readable: true }
      return { outcome: 'imported', readable: true, note: 'Prior messages imported.' }
    }),
    importUserHomeSession: vi.fn(async (): Promise<ImportedFromHome> => ({
      outcome: 'up-to-date',
      sessionId: 'new',
      readable: true,
      note: 'Already here.',
    })),
    exportSession: vi.fn(async (): Promise<ExportedSession> => ({
      kind: 'bundle',
      path: '/example/export',
      frames: 2,
      ledgerEntries: 2,
      resumable: false,
      note: 'A copy.',
    })),
    adoptSessions: vi.fn(async (): Promise<AdoptionReport> => ({
      found: 0,
      adopted: 0,
      alreadyKnown: 0,
      imported: 0,
      descentsLearned: 0,
      named: 0,
      skipped: [readFailure, scanFailure],
    })),
  }
  return { runtime, entries, closed }
}

function open({ runtime } = fixture()) {
  window.api = { runtime } as never
  const opened = vi.fn<(entry: LibraryEntry) => void>()
  const view = mount(SessionLibrary, { onRead: opened }, { width: 1280, height: 900 })
  const rows = () => [...view.host.querySelectorAll('[data-cy^="library-row-"]')]
  return { view, runtime, opened, rows }
}

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

it('draws the six kinds once through the shared row and applies the same search to them all', async () => {
  const { view, runtime, rows } = open()
  await expect.poll(() => rows().length).toBe(6)
  expect(rows().map((row) => row.getAttribute('data-cy'))).toEqual(
    kinds.map((id) => `library-row-library-${id}`),
  )
  for (const row of rows()) expect(row.querySelectorAll('.conversation-row')).toHaveLength(1)
  expect(view.host.textContent).not.toContain('Recorded conversations')

  const search = view.q('library-search') as HTMLInputElement
  for (const kind of kinds) {
    search.value = `/example/${kind}`
    search.dispatchEvent(new Event('input'))
    await expect
      .poll(() => rows().map((row) => row.getAttribute('data-cy')))
      .toEqual([`library-row-library-${kind}`])
  }
  expect(runtime.listResumable).toHaveBeenCalledTimes(1)
  expect(runtime.listUnresumable).toHaveBeenCalledTimes(1)
})

it('keeps the actions and reasons on their owning rows, and one list for both kinds of scan result', async () => {
  const { view, runtime, opened } = open()
  await expect.poll(() => view.all('export-native-record-recorded').length).toBe(1)
  view.q('sessions-open-record-ended').click()
  view.q('sessions-open-record-adopted').click()
  view.q('library-read-library-restored').click()
  expect(opened.mock.calls.map(([row]) => row.recordId)).toEqual([
    'record-ended',
    'record-adopted',
    'record-restored',
  ])
  expect(view.q('library-why-library-ended').textContent).toContain('The provider file is gone.')
  expect(view.all('library-why-library-imported')).toHaveLength(0)
  expect(view.all('library-why-library-restored')).toHaveLength(0)
  expect(view.q('resumable-adopted').textContent).toBe('adopted')

  view.q('export-native-record-recorded').click()
  await expect.poll(() => view.all('export-result').length).toBe(1)
  view.q('export-bundle-record-recorded').click()
  expect(runtime.exportSession.mock.calls).toEqual([
    [{ sessionId: 'record-recorded', exportKind: 'native' }],
    [{ sessionId: 'record-recorded', exportKind: 'bundle' }],
  ])
  view.q('import-messages-record-adopted').click()
  await expect.poll(() => view.all('import-messages-record-adopted').length).toBe(0)
  expect(view.q('resumable-adopted').textContent).toBe('adopted')
  expect(view.q('resumable-adopted').title).toBe("Found in an agent's folder")
  expect(runtime.importRecordedSession).toHaveBeenCalledExactlyOnceWith({
    sessionId: 'record-adopted',
  })
  view.q('library-import-library-external').click()
  expect(runtime.importUserHomeSession).toHaveBeenCalledExactlyOnceWith({
    provider: 'codex',
    providerSessionId: 'external',
  })

  expect(view.all('library-check-homes')).toHaveLength(1)
  expect(view.all('scan-sessions')).toHaveLength(0)
  view.q('library-check-homes').click()
  const panel = view.q('library-skipped')
  await expect.poll(() => panel.querySelectorAll('li').length).toBe(2)
  expect(view.all('library-skipped')).toHaveLength(1)
  expect(panel.textContent).toContain('2 could not be read')
  expect(panel.textContent).toContain(readFailure.reason)
  expect(panel.textContent).toContain(`${scanFailure.reason} — Found but not adopted.`)
  expect(runtime.adoptSessions).toHaveBeenCalledTimes(1)
})

it('keeps a separate continuation reason when discovery finds an app recording in a personal folder', async () => {
  const data = fixture()
  const ended = data.entries.find((row) => row.id === 'library-ended')!
  ended.origin = 'user-home'
  ended.onDisk = true
  const { view } = open(data)
  await expect.poll(() => view.all('library-why-library-ended').length).toBe(1)
  expect(view.q('library-why-library-ended').textContent).toContain('The provider file is gone.')
  expect(view.q('library-row-library-ended').querySelector('.row-mark.imported')).not.toBeNull()
})

it.each([
  ['recorded', 'library-read-library-recorded'],
  ['adopted', 'sessions-open-record-adopted'],
  ['imported', 'library-read-library-imported'],
  ['ended', 'sessions-open-record-ended'],
  ['restored', 'library-read-library-restored'],
])('opens the full conversation for %s by recording id', async (kind, control) => {
  installRuntimeScreenFixture()
  try {
    const { runtime } = fixture()
    window.api.runtime.listLibrary = runtime.listLibrary
    window.api.runtime.listResumable = runtime.listResumable
    window.api.runtime.listUnresumable = runtime.listUnresumable
    const view = mount(RuntimeScreen, {}, { width: 1280, height: 900 })
    view.q('rail-sessions').click()
    await expect.poll(() => view.all(control).length).toBe(1)
    expect(view.all('conversation-pane')).toHaveLength(0)
    view.q(control).click()
    await expect.poll(() => view.all('conversation-pane').length).toBe(1)
    expect(screenRuntime.look).toHaveBeenCalledExactlyOnceWith({
      sessionId: `record-${kind}`,
      claim: true,
    })
    expect(screenRuntime.resume).not.toHaveBeenCalled()
    expect(screenRuntime.startAndSend).not.toHaveBeenCalled()
  } finally {
    disposeRuntimeScreenFixture()
  }
})
