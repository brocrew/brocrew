import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import SavedMethods from '../../src/renderer/src/components/SavedMethods.vue'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type {
  MethodBody,
  MethodChangeResult,
  MethodChangeSummary,
  MethodLibrary,
  MethodLibraryItem,
} from '../../src/shared/saved-method-library'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

type Bridge = Pick<
  RuntimeBridge,
  | 'agentMethods'
  | 'agentMethodBody'
  | 'agentMethodChanges'
  | 'removeAgentMethod'
  | 'undoAgentMethod'
  | 'checkInterruptedAgentMethods'
>
const originalViewport = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  unmountAll()
  await page.viewport(originalViewport.width, originalViewport.height)
})
const item = (fields: Partial<MethodLibraryItem> = {}): MethodLibraryItem => ({
  key: 'method:review.md',
  name: 'review.md',
  kind: 'method',
  references: [{ title: 'Review a patch', when: 'Before handing it back', verified: '2026-10-20' }],
  fingerprint: 'file-a',
  bytes: 19,
  canDelete: true,
  ...fields,
})
const inventory = (fields: Partial<MethodLibrary> = {}): MethodLibrary => ({
  state: 'read',
  items: [item()],
  total: 1,
  offset: 0,
  nextOffset: null,
  indexState: 'ok',
  indexFingerprint: 'index-a',
  malformedLines: 0,
  truncated: false,
  readAt: 1_700_000_000_000,
  ...fields,
})
const change = (fields: Partial<MethodChangeSummary> = {}): MethodChangeSummary => ({
  id: 'change-a',
  sequence: 1,
  operation: 'delete',
  sourceId: null,
  target: 'review.md',
  outcome: 'done',
  by: { who: 'a-person' },
  createdAt: 1_700_000_000_001,
  settlement: { by: { who: 'the-app-itself' }, at: 1_700_000_000_002 },
  canUndo: true,
  ...fields,
})
const methodBody = (
  key = 'method:review.md',
  fingerprint = 'file-a',
  text = '# Review\nRead the diff.',
): MethodBody => ({
  ok: true,
  key,
  fingerprint,
  text,
  bytes: text.length,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function fixture() {
  let listed: MethodLibrary | null = inventory()
  let changes: readonly MethodChangeSummary[] = []
  const bridge = {
    agentMethods: vi.fn<Bridge['agentMethods']>(async () => listed),
    agentMethodBody: vi.fn<Bridge['agentMethodBody']>(async ({ key }) => methodBody(key)),
    agentMethodChanges: vi.fn<Bridge['agentMethodChanges']>(async () => ({ ok: true, changes })),
    removeAgentMethod: vi.fn<Bridge['removeAgentMethod']>(async () => ({
      ok: true,
      change: change(),
    })),
    undoAgentMethod: vi.fn<Bridge['undoAgentMethod']>(async () => ({
      ok: true,
      change: change({ operation: 'undo', sourceId: 'change-a' }),
    })),
    checkInterruptedAgentMethods: vi.fn<Bridge['checkInterruptedAgentMethods']>(async () => ({
      ok: true,
      change: change({ settlement: { by: { who: 'a-person' }, at: 1_700_000_000_003 } }),
    })),
  }
  return {
    bridge,
    list(value: MethodLibrary | null) {
      listed = value
    },
    history(value: readonly MethodChangeSummary[]) {
      changes = value
    },
  }
}
async function open(parts = fixture()) {
  await page.viewport(900, 1100)
  const profile = ref('quill')
  const host = defineComponent({
    setup: () => () => h(SavedMethods, { profileSlug: profile.value, bridge: parts.bridge }),
  })
  const view = mount(host, {}, { width: 740, height: 1050 })
  await vi.waitFor(() => expect(view.all('methods-loading')).toHaveLength(0))
  await nextTick()
  return { ...parts, view, profile }
}
async function select(view: Mounted, number = 0) {
  await vi.waitFor(() => expect(view.all('method-open')[number]).toBeDefined())
  await vi.waitFor(() =>
    expect((view.all('method-open')[number] as HTMLButtonElement).disabled).toBe(false),
  )
  view.all('method-open')[number]!.click()
  await nextTick()
  await nextTick()
}
async function previewDelete(view: Mounted) {
  await select(view)
  await vi.waitFor(() =>
    expect((view.q('method-delete') as HTMLButtonElement).disabled).toBe(false),
  )
  view.q('method-delete').click()
  await nextTick()
}

describe('saved methods in the book', () => {
  it('shows the index, indexed and unindexed methods and missing references; escapes body text and bounds long bodies', async () => {
    const parts = fixture()
    parts.list(
      inventory({
        total: 4,
        items: [
          item({ key: 'index', name: 'index.md', kind: 'index', references: [] }),
          item(),
          item({ key: 'method:notes.md', name: 'notes.md', references: [] }),
          item({
            key: 'method:gone.md',
            name: 'gone.md',
            kind: 'missing-reference',
            problem: 'missing',
            fingerprint: null,
            bytes: null,
          }),
        ],
      }),
    )
    const text = '<img src=x onerror="alert(1)">\n' + 'Long method line\n'.repeat(90)
    parts.bridge.agentMethodBody.mockResolvedValue(methodBody('method:review.md', 'file-a', text))
    const { view } = await open(parts)
    expect(view.q('methods-items').textContent).toContain('Index file')
    expect(view.q('methods-items').textContent).toContain('Indexed method')
    expect(view.q('methods-items').textContent).toContain('Unindexed method')
    expect(view.q('methods-items').textContent).toContain('Missing referenced file')
    expect(view.q('methods-items').textContent).toContain('Before handing it back')
    await select(view, 1)
    await vi.waitFor(() => expect(view.q('method-body').textContent).toBe(text))
    expect(view.q('method-body').querySelector('img')).toBeNull()
    await drawnReady()
    assertDrawn(view.q('method-body'), 'the selected method text', view.host)
    const body = view.q('method-body')
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
    expect(body.getBoundingClientRect().height).toBeLessThan(300)
    expect(view.q('saved-methods').scrollWidth).toBeLessThanOrEqual(view.host.clientWidth)
  })

  it('writes only after confirmation and sends exactly the item and index fingerprints displayed', async () => {
    const { view, bridge } = await open()
    await previewDelete(view)
    expect(bridge.removeAgentMethod).not.toHaveBeenCalled()
    expect(view.q('method-confirmation').textContent).toContain('# Review\nRead the diff.')
    expect(view.q('method-confirmation').textContent).toContain('removes its index references')
    await drawnReady()
    await page.screenshot({
      element: view.q('saved-methods'),
      path: '__screenshots__/saved-methods-confirm-preview.png',
    })
    view.q('method-confirm').click()
    await vi.waitFor(() =>
      expect(bridge.removeAgentMethod).toHaveBeenCalledExactlyOnceWith({
        profileId: 'quill',
        selection: {
          confirmed: true,
          key: 'method:review.md',
          fingerprint: 'file-a',
          indexState: 'ok',
          indexFingerprint: 'index-a',
        },
      }),
    )
    await vi.waitFor(() => expect(view.all('method-confirmation')).toHaveLength(0))
    expect(view.q('methods-message').textContent).toBe('Done')
  })

  it('keeps an open delete baseline when the readings refresh, then retains a refused preview', async () => {
    const parts = fixture()
    const { view, bridge } = await open(parts)
    await previewDelete(view)
    parts.list(inventory({ indexFingerprint: 'index-b', items: [item({ fingerprint: 'file-b' })] }))
    view.q('methods-refresh').click()
    await vi.waitFor(() => expect(bridge.agentMethods).toHaveBeenCalledTimes(2))
    bridge.removeAgentMethod.mockResolvedValue({ ok: false, reason: 'changed-or-unreadable' })
    view.q('method-confirm').click()
    await vi.waitFor(() => expect(view.q('methods-message').textContent).toContain('files changed'))
    expect(bridge.removeAgentMethod.mock.calls[0]![0].selection).toEqual({
      confirmed: true,
      key: 'method:review.md',
      fingerprint: 'file-a',
      indexState: 'ok',
      indexFingerprint: 'index-a',
    })
    expect(view.q('method-confirmation').textContent).toContain('# Review\nRead the diff.')
    expect((view.q('method-confirm') as HTMLButtonElement).disabled).toBe(true)
    await vi.waitFor(() => expect(bridge.agentMethods).toHaveBeenCalledTimes(3))
    view.q('method-cancel').click()
    await nextTick()
    expect(view.all('method-confirmation')).toHaveLength(0)
  })

  it('says deleting index.md removes all index references while method files remain', async () => {
    const parts = fixture()
    parts.list(
      inventory({
        items: [
          item({
            key: 'index',
            name: 'index.md',
            kind: 'index',
            fingerprint: 'index-a',
            references: [],
          }),
        ],
      }),
    )
    parts.bridge.agentMethodBody.mockResolvedValue(
      methodBody('index', 'index-a', '- Review | Before handback | 2026-10-20 | review.md'),
    )
    const { view, bridge } = await open(parts)
    await previewDelete(view)
    expect(view.q('method-index-warning').textContent).toContain(
      "new conversations aren't told about any saved method. The method files stay.",
    )
    expect(bridge.removeAgentMethod).not.toHaveBeenCalled()
  })

  it('deletes a missing reference without asking for a nonexistent body', async () => {
    const parts = fixture()
    parts.list(
      inventory({
        items: [
          item({ kind: 'missing-reference', fingerprint: null, bytes: null, problem: 'missing' }),
        ],
      }),
    )
    const { view, bridge } = await open(parts)
    await previewDelete(view)
    expect(bridge.agentMethodBody).not.toHaveBeenCalled()
    expect(view.q('method-confirmation').textContent).toContain(
      'index references to this missing file',
    )
    view.q('method-confirm').click()
    await vi.waitFor(() => expect(bridge.removeAgentMethod).toHaveBeenCalledTimes(1))
    expect(bridge.removeAgentMethod.mock.calls[0]![0].selection.fingerprint).toBeNull()
  })

  it('refuses a stale body fingerprint until a new inventory and body have been read', async () => {
    const parts = fixture()
    parts.bridge.agentMethodBody.mockResolvedValue(
      methodBody('method:review.md', 'file-b', 'Changed text'),
    )
    const { view, bridge } = await open(parts)
    await select(view)
    await vi.waitFor(() => expect(view.q('method-stale').textContent).toContain('file changed'))
    expect((view.q('method-delete') as HTMLButtonElement).disabled).toBe(true)
    view.q('method-delete').click()
    expect(bridge.removeAgentMethod).not.toHaveBeenCalled()
    parts.list(inventory({ items: [item({ fingerprint: 'file-b' })] }))
    view.q('methods-refresh').click()
    await vi.waitFor(() => expect(view.all('methods-loading')).toHaveLength(0))
    await select(view)
    await vi.waitFor(() =>
      expect((view.q('method-delete') as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it('refuses a body returned for a different app key even if its fingerprint matches', async () => {
    const parts = fixture()
    parts.bridge.agentMethodBody.mockResolvedValue(methodBody('method:other.md'))
    const { view, bridge } = await open(parts)
    await select(view)
    expect((view.q('method-delete') as HTMLButtonElement).disabled).toBe(true)
    expect(view.q('method-stale').textContent).toContain('Read the files again')
    expect(bridge.removeAgentMethod).not.toHaveBeenCalled()
  })

  it.each(['link', 'unreadable', 'too-large', 'not-a-file'] as const)(
    'keeps a %s entry read-only',
    async (problem) => {
      const parts = fixture()
      parts.list(inventory({ items: [item({ problem, canDelete: false, fingerprint: null })] }))
      const { view, bridge } = await open(parts)
      await select(view)
      expect(view.all('method-delete')).toHaveLength(0)
      expect(bridge.agentMethodBody).not.toHaveBeenCalled()
      expect(bridge.removeAgentMethod).not.toHaveBeenCalled()
    },
  )

  it('keeps a truncated inventory read-only even when an item carries a delete flag', async () => {
    const parts = fixture()
    parts.list(inventory({ truncated: true }))
    const { view } = await open(parts)
    await select(view)
    expect(view.q('methods-truncated').textContent).toContain('incomplete')
    expect(view.all('method-delete')).toHaveLength(0)
  })

  it('shows history when inventory fails and inventory when history fails', async () => {
    const parts = fixture()
    parts.history([change()])
    parts.bridge.agentMethods.mockRejectedValue(new Error('fixture read error'))
    const first = await open(parts)
    expect(first.view.q('methods-error').textContent).toContain("couldn't read")
    expect(first.view.q('method-change').textContent).toContain('review.md')
    first.view.unmount()
    const other = fixture()
    other.bridge.agentMethodChanges.mockResolvedValue({ ok: false, reason: 'history-unreadable' })
    const second = await open(other)
    expect(second.view.q('methods-items').textContent).toContain('review.md')
    expect(second.view.q('methods-history-error').textContent).toContain("couldn't read")
  })

  it('distinguishes not provisioned, missing folder, unreadable inventory and empty inventory', async () => {
    const parts = fixture()
    parts.list(null)
    const { view } = await open(parts)
    expect(view.q('methods-error').textContent).toContain("aren't available for this agent")
    parts.list(inventory({ state: 'missing', items: [], total: 0 }))
    view.q('methods-refresh').click()
    await vi.waitFor(() => expect(view.all('methods-missing')).toHaveLength(1))
    parts.list(inventory({ state: 'unavailable', items: [], total: 0, problem: 'unreadable' }))
    view.q('methods-refresh').click()
    await vi.waitFor(() => expect(view.all('methods-unavailable')).toHaveLength(1))
    parts.list(inventory({ items: [], total: 0, indexState: 'absent', indexFingerprint: null }))
    view.q('methods-refresh').click()
    await vi.waitFor(() => expect(view.all('methods-empty')).toHaveLength(1))
    expect(view.q('methods-index-absent').textContent).toContain('no index file')
  })

  it('previews Undo metadata and sends only the stored eligible source id', async () => {
    const parts = fixture()
    parts.history([change({ id: 'latest-delete' }), change({ id: 'older-delete', canUndo: false })])
    const { view, bridge } = await open(parts)
    expect(view.all('method-undo')).toHaveLength(1)
    view.q('method-undo').click()
    await nextTick()
    expect(bridge.undoAgentMethod).not.toHaveBeenCalled()
    expect(view.q('method-confirmation').textContent).toContain('review.md')
    expect(view.q('method-confirmation').querySelector('pre')).toBeNull()
    view.q('method-confirm').click()
    await vi.waitFor(() =>
      expect(bridge.undoAgentMethod).toHaveBeenCalledExactlyOnceWith({
        profileId: 'quill',
        changeId: 'latest-delete',
      }),
    )
  })

  it('labels pending, partial, no change and legacy observations honestly; Check is confirmed and restores nothing', async () => {
    const parts = fixture()
    parts.history([
      change({ id: 'pending', outcome: 'pending', settlement: null, canUndo: false }),
      change({
        id: 'partial',
        outcome: 'partial',
        canUndo: false,
        settlement: { by: { who: 'a-person' }, at: 1_700_000_000_003 },
      }),
      change({ id: 'unchanged', outcome: 'partial', noEffect: true, canUndo: false }),
      change({ id: 'legacy', settlement: null, canUndo: false }),
    ])
    const { view, bridge } = await open(parts)
    const rows = view.all('method-change')
    expect(rows[0]!.textContent).toContain('Needs checking.')
    expect(rows[0]!.textContent).toContain('No observation recorded yet.')
    expect(rows[1]!.textContent).toContain('Only partly finished.')
    expect(rows[1]!.textContent).toContain('after a person asked BroCrew')
    expect(rows[2]!.textContent).toContain('No change')
    expect(rows[2]!.textContent).not.toContain('Only partly finished.')
    expect(rows[2]!.textContent).toContain('Recorded by BroCrew')
    expect(rows[3]!.textContent).toContain('Not known who checked this.')
    view.q('methods-check').click()
    await nextTick()
    expect(view.q('method-confirmation').textContent).toContain("It doesn't restore anything.")
    expect(bridge.checkInterruptedAgentMethods).not.toHaveBeenCalled()
    view.q('method-confirm').click()
    await vi.waitFor(() =>
      expect(bridge.checkInterruptedAgentMethods).toHaveBeenCalledExactlyOnceWith({
        profileId: 'quill',
        confirmed: true,
      }),
    )
  })

  it('uses inventory nextOffset and separate bounded history pages', async () => {
    const parts = fixture()
    parts.list(inventory({ total: 42, nextOffset: 7 }))
    parts.history(
      Array.from({ length: 21 }, (_, i) => change({ id: `change-${i}`, canUndo: false })),
    )
    const { view, bridge } = await open(parts)
    expect(view.all('method-change')).toHaveLength(20)
    view.q('methods-next').click()
    await vi.waitFor(() =>
      expect(bridge.agentMethods).toHaveBeenLastCalledWith({
        profileId: 'quill',
        offset: 7,
        limit: 20,
      }),
    )
    expect(bridge.agentMethodChanges).toHaveBeenCalledTimes(1)
    view.q('history-next').click()
    await vi.waitFor(() =>
      expect(bridge.agentMethodChanges).toHaveBeenLastCalledWith({
        profileId: 'quill',
        offset: 20,
        limit: 21,
      }),
    )
    expect(bridge.agentMethods).toHaveBeenCalledTimes(2)
  })

  it.each(['undo', 'check'] as const)(
    'keeps a refused %s preview and refetches independent readings',
    async (kind) => {
      const parts = fixture()
      parts.history([
        change({ outcome: kind === 'check' ? 'pending' : 'done', canUndo: kind === 'undo' }),
      ])
      if (kind === 'undo')
        parts.bridge.undoAgentMethod.mockResolvedValue({ ok: false, reason: 'not-latest-change' })
      else
        parts.bridge.checkInterruptedAgentMethods.mockRejectedValue(
          new Error('fixture transport failure'),
        )
      const { view } = await open(parts)
      view.q(kind === 'undo' ? 'method-undo' : 'methods-check').click()
      await nextTick()
      view.q('method-confirm').click()
      await vi.waitFor(() =>
        expect((view.q('method-confirm') as HTMLButtonElement).disabled).toBe(true),
      )
      await vi.waitFor(() => expect(view.all('methods-message')).toHaveLength(1))
      expect(view.q('method-confirmation').textContent).toContain(
        'Something changed since this preview.',
      )
      expect(view.q('methods-message').textContent).toContain(
        kind === 'undo' ? 'newer change prevents this Undo' : "couldn't confirm the result",
      )
      await vi.waitFor(() => expect(parts.bridge.agentMethods).toHaveBeenCalledTimes(2))
      expect(parts.bridge.agentMethodChanges).toHaveBeenCalledTimes(2)
    },
  )

  it('ignores an older refresh that completes after the next reading', async () => {
    const parts = fixture()
    const delayed = deferred<MethodLibrary | null>()
    const { view } = await open(parts)
    await previewDelete(view)
    parts.bridge.agentMethods.mockImplementationOnce(() => delayed.promise)
    view.q('methods-refresh').click()
    await vi.waitFor(() => expect(parts.bridge.agentMethods).toHaveBeenCalledTimes(2))
    parts.list(inventory({ items: [item({ name: 'newest-reading.md' })] }))
    view.q('method-confirm').click()
    await vi.waitFor(() => expect(parts.bridge.agentMethods).toHaveBeenCalledTimes(3))
    await vi.waitFor(() =>
      expect(view.q('methods-items').textContent).toContain('newest-reading.md'),
    )
    delayed.resolve(inventory({ items: [item({ name: 'older-reading.md' })] }))
    await nextTick()
    await nextTick()
    expect(view.q('methods-items').textContent).not.toContain('older-reading.md')
    expect(view.q('methods-items').textContent).toContain('newest-reading.md')
  })

  it('discards a delayed body when another method is selected', async () => {
    const parts = fixture()
    parts.list(
      inventory({
        total: 2,
        items: [item(), item({ key: 'method:notes.md', name: 'notes.md', references: [] })],
      }),
    )
    const old = deferred<MethodBody | null>()
    parts.bridge.agentMethodBody.mockImplementationOnce(() => old.promise)
    const { view } = await open(parts)
    await select(view)
    await select(view, 1)
    await vi.waitFor(() => expect(view.q('method-reading').textContent).toContain('notes.md'))
    old.resolve(methodBody('method:review.md', 'file-a', 'OLD BODY'))
    await nextTick()
    await nextTick()
    expect(view.q('method-reading').textContent).not.toContain('OLD BODY')
    expect(view.q('method-body').textContent).toContain('Read the diff.')
  })

  it('discards delayed inventory and history across a profile switch', async () => {
    const parts = fixture()
    const oldInventory = deferred<MethodLibrary | null>()
    const oldHistory = deferred<Awaited<ReturnType<Bridge['agentMethodChanges']>>>()
    parts.bridge.agentMethods.mockImplementationOnce(() => oldInventory.promise)
    parts.bridge.agentMethodChanges.mockImplementationOnce(() => oldHistory.promise)
    const profile = ref('quill')
    const view = mount(
      defineComponent({
        setup: () => () => h(SavedMethods, { profileSlug: profile.value, bridge: parts.bridge }),
      }),
      {},
      { width: 740, height: 1050 },
    )
    profile.value = 'robin'
    await nextTick()
    await vi.waitFor(() => expect(view.all('methods-loading')).toHaveLength(0))
    oldInventory.resolve(inventory({ items: [item({ name: 'old-profile.md' })] }))
    oldHistory.resolve({ ok: true, changes: [change({ target: 'old-profile.md' })] })
    await nextTick()
    await nextTick()
    expect(view.host.textContent).not.toContain('old-profile.md')
    await previewDelete(view)
    view.q('method-confirm').click()
    await vi.waitFor(() => expect(parts.bridge.removeAgentMethod).toHaveBeenCalledTimes(1))
    expect(parts.bridge.removeAgentMethod.mock.calls[0]![0].profileId).toBe('robin')
  })

  it('closes a captured confirmation on profile switch and ignores a late body rejection', async () => {
    const { view, profile, bridge } = await open()
    await previewDelete(view)
    profile.value = 'robin'
    await nextTick()
    await vi.waitFor(() => expect(view.all('methods-loading')).toHaveLength(0))
    expect(view.all('method-confirmation')).toHaveLength(0)
    expect(view.all('method-reading')).toHaveLength(0)
    expect(bridge.removeAgentMethod).not.toHaveBeenCalled()
    const oldBody = deferred<MethodBody | null>()
    bridge.agentMethodBody.mockImplementationOnce(() => oldBody.promise)
    await select(view)
    profile.value = 'finch'
    await nextTick()
    oldBody.reject(new Error('old profile read failed'))
    await nextTick()
    await nextTick()
    expect(view.all('method-body-error')).toHaveLength(0)
  })

  it.each(['delete', 'undo', 'check'] as const)(
    'blocks duplicate %s actions and ignores a late completion after switching profile',
    async (kind) => {
      const parts = fixture()
      parts.history([
        change({ outcome: kind === 'check' ? 'pending' : 'done', canUndo: kind === 'undo' }),
      ])
      const pending = deferred<MethodChangeResult>()
      const action =
        kind === 'delete'
          ? parts.bridge.removeAgentMethod
          : kind === 'undo'
            ? parts.bridge.undoAgentMethod
            : parts.bridge.checkInterruptedAgentMethods
      action.mockImplementationOnce(() => pending.promise)
      const { view, profile } = await open(parts)
      if (kind === 'delete') await previewDelete(view)
      else {
        view.q(kind === 'undo' ? 'method-undo' : 'methods-check').click()
        await nextTick()
      }
      view.q('method-confirm').click()
      view.q('method-confirm').click()
      await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1))
      expect((view.q('method-cancel') as HTMLButtonElement).disabled).toBe(true)
      expect(action.mock.calls[0]![0].profileId).toBe('quill')
      profile.value = 'robin'
      await nextTick()
      await vi.waitFor(() => expect(view.all('methods-loading')).toHaveLength(0))
      const reads = parts.bridge.agentMethods.mock.calls.length
      pending.resolve({ ok: false, reason: 'changed-or-unreadable' })
      await nextTick()
      await nextTick()
      expect(view.all('methods-message')).toHaveLength(0)
      expect(view.all('method-confirmation')).toHaveLength(0)
      expect(parts.bridge.agentMethods).toHaveBeenCalledTimes(reads)
    },
  )

  it.each(['delete', 'undo', 'check'] as const)(
    'does not refetch or handle an old %s action after unmount',
    async (kind) => {
      const parts = fixture()
      parts.history([
        change({ outcome: kind === 'check' ? 'pending' : 'done', canUndo: kind === 'undo' }),
      ])
      const pending = deferred<MethodChangeResult>()
      const action =
        kind === 'delete'
          ? parts.bridge.removeAgentMethod
          : kind === 'undo'
            ? parts.bridge.undoAgentMethod
            : parts.bridge.checkInterruptedAgentMethods
      action.mockImplementationOnce(() => pending.promise)
      const { view } = await open(parts)
      if (kind === 'delete') await previewDelete(view)
      else {
        view.q(kind === 'undo' ? 'method-undo' : 'methods-check').click()
        await nextTick()
      }
      view.q('method-confirm').click()
      await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1))
      const reads = parts.bridge.agentMethods.mock.calls.length
      view.unmount()
      pending.reject(new Error('late transport failure'))
      await nextTick()
      await nextTick()
      expect(parts.bridge.agentMethods).toHaveBeenCalledTimes(reads)
    },
  )

  it('discards a late failed body after unmount without starting new readings', async () => {
    const parts = fixture()
    const pending = deferred<MethodBody | null>()
    parts.bridge.agentMethodBody.mockImplementationOnce(() => pending.promise)
    const { view } = await open(parts)
    await select(view)
    const reads = parts.bridge.agentMethods.mock.calls.length
    view.unmount()
    pending.resolve({ ok: false, problem: 'unreadable' })
    await nextTick()
    await nextTick()
    expect(parts.bridge.agentMethods).toHaveBeenCalledTimes(reads)
  })
})
