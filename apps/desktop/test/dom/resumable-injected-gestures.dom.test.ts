import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, provide, nextTick } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type {
  ExportedSession,
  ImportedRecording,
  ResumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import ResumableSessions from '../../src/renderer/src/components/ResumableSessions.vue'
import { mount, unmountAll } from './harness'

function recorded(sessionId: string): ResumableSessionInfo {
  return {
    sessionId,
    provider: 'codex',
    ref: { provider: 'codex', sessionId: `provider-${sessionId}`, cwd: '/fern', rotation: 0 },
    cwd: '/fern',
    status: 'idle',
    running: 'not-running',
    state: { is: 'idle' },
    named: null,
    approvalMode: 'ask',
    profileId: null,
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: 1,
    hasTranscript: false,
    lastEnding: 'completed',
    child: null,
    resumeRefusal: null,
    updatedAt: 1,
  }
}
function held<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const exported = (kind: 'native' | 'bundle', path: string): ExportedSession => ({
  kind,
  path,
  frames: 2,
  ledgerEntries: 0,
  resumable: kind === 'native',
  note: `Supplied ${kind} meaning.`,
})
function surface() {
  const listing = vi.fn(async () => [recorded('fern-a'), recorded('fern-b')])
  const unresumable = vi.fn(async () => [])
  const wrongExport = vi.fn(async () => exported('bundle', '/wrong/window'))
  const wrongImport = vi.fn(async (): Promise<ImportedRecording> => ({
    outcome: 'skipped',
    readable: false,
    note: 'Wrong window answer.',
  }))
  Reflect.set(window, 'api', {
    runtime: {
      listResumable: listing,
      listUnresumable: unresumable,
      exportSession: wrongExport,
      importRecordedSession: wrongImport,
    },
  })
  const transport = {
    listResumable: listing,
    listUnresumable: unresumable,
    exportSession: vi.fn<ClientSessionApi['exportSession']>(async function (this: unknown, input) {
      expect(this).toBe(transport)
      if (input.exportKind === 'reading') throw new Error('No readable export offered here')
      return exported(input.exportKind, `/supplied/${input.sessionId}`)
    }),
    importRecordedSession: vi.fn<ClientSessionApi['importRecordedSession']>(async function (
      this: unknown,
    ) {
      expect(this).toBe(transport)
      return {
        outcome: 'nothing-readable',
        readable: false,
        note: 'Supplied unreadable recording.',
      }
    }),
  }
  // This surface exercises the listed reads and two gestures only.
  const supplier = vi.fn(() => transport as unknown as ClientSessionApi | undefined)
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    supplier,
  )
  const view = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(ResumableSessions)
      },
    }),
    {},
    { width: 1000 },
  )
  return { view, transport, supplier, listing, unresumable, wrongExport, wrongImport }
}
async function ready(out: ReturnType<typeof surface>) {
  await expect.poll(() => out.view.all('resumable-row').length).toBe(2)
  expect(out.transport.exportSession).not.toHaveBeenCalled()
  expect(out.transport.importRecordedSession).not.toHaveBeenCalled()
}
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

it('uses the ancestor export receiver and exact native/bundle payloads with independent row busy states', async () => {
  const out = surface()
  await ready(out)
  const pending = held<ExportedSession>()
  out.transport.exportSession.mockReturnValueOnce(pending.promise)
  const native = out.view.q('export-native-fern-a') as HTMLButtonElement
  const sameRow = out.view.q('export-bundle-fern-a') as HTMLButtonElement
  native.click()
  await nextTick()
  expect(native.disabled).toBe(true)
  expect(sameRow.disabled).toBe(true)
  sameRow.click()
  out.view.q('export-bundle-fern-b').click()
  await expect.poll(() => out.view.all('export-result').length).toBe(1)
  expect(out.transport.exportSession.mock.calls).toEqual([
    [{ sessionId: 'fern-a', exportKind: 'native' }],
    [{ sessionId: 'fern-b', exportKind: 'bundle' }],
  ])
  pending.resolve(exported('native', '/supplied/first.native'))
  await expect.poll(() => out.view.all('export-result').length).toBe(2)
  expect(out.view.host.textContent).toContain('/supplied/first.native')
  expect(out.view.host.textContent).toContain('Supplied native meaning.')
  expect(out.view.host.textContent).toContain('Supplied bundle meaning.')
  expect(native.disabled).toBe(false)
  expect(sameRow.disabled).toBe(false)
  expect(out.listing).toHaveBeenCalledTimes(1)
  expect(out.wrongExport).not.toHaveBeenCalled()
})
it('refreshes only from supplied readable=true and holds import busy through that refresh', async () => {
  const out = surface()
  await ready(out)
  out.view.q('import-messages-fern-a').click()
  await expect
    .poll(() => out.view.q('import-result-fern-a').textContent)
    .toContain('Supplied unreadable recording.')
  expect(out.listing).toHaveBeenCalledTimes(1)
  const imported = held<ImportedRecording>()
  out.transport.importRecordedSession.mockReturnValueOnce(imported.promise)
  const button = out.view.q('import-messages-fern-a') as HTMLButtonElement
  button.click()
  await nextTick()
  expect(button.disabled).toBe(true)
  button.click()
  const refreshed = held<ResumableSessionInfo[]>()
  out.listing.mockReturnValueOnce(refreshed.promise)
  imported.resolve({
    outcome: 'refused',
    readable: true,
    note: 'Supplied readable ledger survives refusal.',
  })
  await expect.poll(() => out.listing.mock.calls.length).toBe(2)
  expect(button.disabled).toBe(true)
  refreshed.resolve([{ ...recorded('fern-a'), hasTranscript: true }, recorded('fern-b')])
  await expect.poll(() => out.view.all('import-messages-fern-a').length).toBe(0)
  expect(out.view.q('import-result-fern-a').textContent).toContain(
    'Supplied readable ledger survives refusal.',
  )
  expect(out.transport.importRecordedSession.mock.calls).toEqual([
    [{ sessionId: 'fern-a' }],
    [{ sessionId: 'fern-a' }],
  ])
  expect(out.unresumable).toHaveBeenCalledTimes(2)
  expect(out.wrongImport).not.toHaveBeenCalled()
})
it.each(['export', 'import'] as const)(
  'reports supplied %s refusal, releases its row and permits retry',
  async (kind) => {
    const out = surface()
    await ready(out)
    const operation =
      kind === 'export' ? out.transport.exportSession : out.transport.importRecordedSession
    operation.mockRejectedValueOnce(
      new Error("Error invoking remote method 'runtime:command': Error: Fern host is restarting."),
    )
    const cy = kind === 'export' ? 'export-native-fern-a' : 'import-messages-fern-a'
    const result = kind === 'export' ? 'export-result' : 'import-result-fern-a'
    out.view.q(cy).click()
    await expect.poll(() => out.view.q(result).textContent).toContain('Fern host is restarting.')
    expect(out.view.q(result).textContent).not.toContain('Error invoking remote method')
    expect((out.view.q(cy) as HTMLButtonElement).disabled).toBe(false)
    out.view.q(cy).click()
    await expect.poll(() => out.view.q(result).textContent).not.toContain('restarting')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(out.wrongExport).not.toHaveBeenCalled()
    expect(out.wrongImport).not.toHaveBeenCalled()
  },
)
it.each(['absent', 'older', 'getter'] as const)(
  'keeps %s capability errors in the existing row result and clears both busy flags',
  async (kind) => {
    const out = surface()
    await ready(out)
    out.supplier.mockImplementation(() => {
      if (kind === 'getter') throw new Error('Supplied session getter failure.')
      return kind === 'absent' ? undefined : ({} as ClientSessionApi)
    })
    out.view.q('export-native-fern-a').click()
    out.view.q('import-messages-fern-b').click()
    await expect.poll(() => out.view.all('export-result').length).toBe(1)
    expect(out.view.q('export-result').textContent).toContain(
      kind === 'getter'
        ? 'Supplied session getter failure.'
        : 'Session export is not available in this window.',
    )
    expect(out.view.q('import-result-fern-b').textContent).toContain(
      kind === 'getter'
        ? 'Supplied session getter failure.'
        : 'Importing recorded messages is not available in this window.',
    )
    expect((out.view.q('export-native-fern-a') as HTMLButtonElement).disabled).toBe(false)
    expect((out.view.q('import-messages-fern-b') as HTMLButtonElement).disabled).toBe(false)
    expect(out.listing).toHaveBeenCalledTimes(1)
    expect(out.wrongExport).not.toHaveBeenCalled()
    expect(out.wrongImport).not.toHaveBeenCalled()
  },
)
