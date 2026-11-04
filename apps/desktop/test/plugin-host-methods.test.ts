import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginHost, type PluginHostCall } from '../src/main/plugins/host-methods'
import type { PluginHostRequest, PluginToolCallResult } from '../src/shared/plugin-contract'

const owner = { pluginId: 'orbit-notes', runId: 'first-run' }
const button = {
  contributionId: 'add-note',
  kind: 'ui.button',
  api: 1,
  definition: {
    slot: 'composer.accessory',
    view: { label: 'Add a note' },
    invoke: { tool: 'notes_add', arguments: { collection: 'fictional' } },
  },
} as const
function fixture() {
  const callTool = vi
    .fn<(input: PluginHostCall) => Promise<PluginToolCallResult>>()
    .mockResolvedValue({
      status: 'result',
      result: { content: [] },
    })
  const host = new PluginHost({ callTool })
  host.attach(owner)
  host.setEnabled('workshop', owner.pluginId, true)
  const request = (method: string, params: unknown, workspaceId = 'workshop') =>
    host.request(
      owner,
      { api: 1, workspaceId, requestId: 'request', method, params } as PluginHostRequest,
      new AbortController().signal,
    )
  return { host, request, callTool }
}
afterEach(() => vi.useRealTimers())
describe('generic plugin host methods', () => {
  it('describes implemented host methods without advertising reserved services', async () => {
    const { request } = fixture()
    expect(await request('host.describe', null)).toEqual({
      value: {
        api: 1,
        methods: [
          'host.describe',
          'host.contributions.register',
          'host.contributions.update',
          'host.contributions.remove',
          'host.settings.open',
          'host.settings.close',
          'host.notifications.show',
          'host.notifications.dismiss',
        ],
        slots: ['composer.accessory', 'settings.plugin.configure'],
        hookKinds: ['turn.context.titles'],
        speechAvailable: false,
      },
    })
  })
  it('registers, patches, invokes and removes using the same MCP call with unchanged constants', async () => {
    const { host, request, callTool } = fixture()
    const registered = await request('host.contributions.register', button)
    expect(registered).toMatchObject({ value: { state: 'active' } })
    const handle = (registered as { value: { handle: string } }).value.handle
    await request('host.contributions.update', {
      handle,
      patch: { view: { label: 'Save a note' } },
    })
    expect(host.snapshot('workshop').contributions[0]?.definition).toMatchObject({
      view: { label: 'Save a note' },
    })
    await host.activate('workshop', handle)
    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: owner.pluginId,
        instanceId: owner.runId,
        workspaceId: 'workshop',
        name: 'notes_add',
        arguments: { collection: 'fictional' },
        origin: 'ui.button',
      }),
    )
    expect(await request('host.contributions.remove', { handle })).toEqual({
      value: { removed: true },
    })
    expect(host.snapshot('workshop').contributions).toEqual([])
    expect(await host.activate('workshop', handle)).toEqual({ error: { code: 'not-found' } })
  })
  it('isolates workspace switches and invalidates only the ended instance callbacks', async () => {
    const { host, request, callTool } = fixture()
    host.setEnabled('studio', owner.pluginId, true)
    const a = await request('host.contributions.register', button)
    await request('host.contributions.register', button, 'studio')
    await request('host.notifications.show', {
      title: 'Saved',
      text: 'Your fictional note is ready.',
      level: 'info',
    })
    host.setEnabled('workshop', owner.pluginId, false)
    expect(host.snapshot('workshop').notifications).toEqual([])
    expect(host.snapshot('workshop').contributions[0]?.state).toBe('inactive')
    expect(host.snapshot('studio').contributions[0]?.state).toBe('active')
    expect(
      await host.activate('workshop', (a as { value: { handle: string } }).value.handle),
    ).toEqual({ error: { code: 'disabled' } })
    host.detach(owner)
    host.attach({ ...owner, runId: 'replacement' })
    expect(
      await request('host.notifications.show', { title: 'Old', text: 'Old run', level: 'info' }),
    ).toEqual({ error: { code: 'not-found' } })
    expect(host.snapshot('studio').contributions).toEqual([])
    expect(callTool).not.toHaveBeenCalled()
  })
  it('shows notifications whose actions use MCP and whose dismissal has no domain effect', async () => {
    const { host, request, callTool } = fixture()
    const answer = await request('host.notifications.show', {
      notificationId: 'saved',
      title: 'Note saved',
      text: 'Open the collection.',
      level: 'info',
      actions: [
        {
          id: 'open',
          label: 'Open',
          invoke: { tool: 'notes_open', arguments: { collection: 'fictional' } },
        },
      ],
    })
    expect(answer).toEqual({ value: { notificationId: 'saved', shown: true } })
    await host.notificationAction(
      'workshop',
      host.snapshot('workshop').notifications[0]!.handle,
      'open',
    )
    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'notes_open',
        instanceId: owner.runId,
        arguments: { collection: 'fictional' },
      }),
    )
    expect(await request('host.notifications.dismiss', { notificationId: 'saved' })).toEqual({
      value: { dismissed: true },
    })
    expect(callTool).toHaveBeenCalledTimes(1)
  })
  it('keeps unsupported contributions and reserved services separate from ordinary buttons', async () => {
    const { host, request } = fixture()
    await request('host.contributions.register', button)
    expect(
      await request('host.contributions.register', {
        contributionId: 'local-voice',
        kind: 'speech.transcribe',
        api: 1,
        definition: {},
      }),
    ).toMatchObject({ value: { state: 'unsupported', available: false, selected: false } })
    for (const method of [
      'host.speech.publish',
      'host.accounts.configure',
      'host.service.request',
      'host.service.read',
      'host.service.cancel',
    ])
      expect(await request(method, {})).toEqual({ error: { code: 'unsupported' } })
    expect(host.snapshot('workshop').contributions[0]?.state).toBe('active')
  })
  it('opens settings by contribution and ignores a late open after workspace off', async () => {
    let finish!: (value: string) => void
    const closeSettings = vi.fn()
    const host = new PluginHost({
      callTool: vi.fn(),
      openSettings: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      closeSettings,
    })
    host.attach(owner)
    host.setEnabled('workshop', owner.pluginId, true)
    const req = (method: string, params: unknown) =>
      host.request(owner, {
        api: 1,
        workspaceId: 'workshop',
        requestId: 'settings',
        method,
        params,
      } as PluginHostRequest)
    await req('host.contributions.register', {
      contributionId: 'preferences',
      kind: 'settings.page',
      api: 1,
      definition: { title: 'Notes', entry: 'settings.html', assets: ['settings.html'] },
    })
    const pending = req('host.settings.open', { contributionId: 'preferences' })
    host.setEnabled('workshop', owner.pluginId, false)
    finish('view')
    expect(await pending).toEqual({ error: { code: 'disabled' } })
    expect(closeSettings).toHaveBeenCalledWith('view')
  })
  it('keeps a button callback valid when only the titles preference changes', async () => {
    const { host, request, callTool } = fixture()
    let finish!: (result: PluginToolCallResult) => void
    callTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const registered = await request('host.contributions.register', button)
    const pending = host.activate(
      'workshop',
      (registered as { value: { handle: string } }).value.handle,
    )
    host.setTitlesEnabled('workshop', owner.pluginId, true)
    finish({ status: 'result', result: { content: [] } })
    expect(await pending).toEqual({ value: { content: [] } })
  })
  it('invalidates an old callback when canonical hydration observes a missed off/on transition', async () => {
    const { host, request, callTool } = fixture()
    host.setEnabled('workshop', owner.pluginId, true, 4)
    const registered = await request('host.contributions.register', button)
    let finish!: (result: PluginToolCallResult) => void
    callTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = host.activate(
      'workshop',
      (registered as { value: { handle: string } }).value.handle,
    )
    host.setEnabled('workshop', owner.pluginId, true, 6)
    finish({ status: 'result', result: { content: [] } })
    expect(await pending).toEqual({ error: { code: 'disabled' } })
    expect(host.snapshot('workshop').contributions[0]?.state).toBe('active')
  })
  it('does not revive a detached callback when the same canonical revision is rehydrated', async () => {
    const { host, request, callTool } = fixture()
    host.setEnabled('workshop', owner.pluginId, true, 4)
    const registered = await request('host.contributions.register', button)
    let finish!: (result: PluginToolCallResult) => void
    callTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = host.activate(
      'workshop',
      (registered as { value: { handle: string } }).value.handle,
    )
    host.detachWorkspace('workshop')
    host.setEnabled('workshop', owner.pluginId, true, 4)
    await request('host.contributions.register', button)
    finish({ status: 'result', result: { content: [] } })
    expect(await pending).toEqual({ error: { code: 'disabled' } })
  })
  it('drops an old callback result after its contribution is removed', async () => {
    const { host, request, callTool } = fixture()
    const registered = await request('host.contributions.register', button)
    const handle = (registered as { value: { handle: string } }).value.handle
    let finish!: (result: PluginToolCallResult) => void
    callTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = host.activate('workshop', handle)
    await request('host.contributions.remove', { handle })
    finish({ status: 'result', result: { content: [] } })
    expect(await pending).toEqual({ error: { code: 'not-found' } })
  })
  it('detaches one logical workspace and suppresses its late result while another stays active', async () => {
    const { host, request, callTool } = fixture()
    const a = await request('host.contributions.register', button)
    host.setEnabled('studio', owner.pluginId, true)
    const b = await request('host.contributions.register', button, 'studio')
    let finish!: (result: PluginToolCallResult) => void
    callTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = host.activate('studio', (b as { value: { handle: string } }).value.handle)
    host.detachWorkspace('studio')
    finish({ status: 'result', result: { content: [] } })
    expect(await pending).toEqual({ error: { code: 'disabled' } })
    expect(host.snapshot('studio').contributions).toEqual([])
    expect(host.snapshot('workshop').contributions[0]?.state).toBe('active')
    callTool.mockResolvedValue({ status: 'result', result: { content: [] } })
    expect(
      await host.activate('workshop', (a as { value: { handle: string } }).value.handle),
    ).toEqual({ value: { content: [] } })
    expect(
      await request(
        'host.notifications.show',
        { title: 'Late', text: 'Fictional late effect', level: 'info' },
        'studio',
      ),
    ).toEqual({ error: { code: 'disabled' } })
  })
})
describe('before-turn titles', () => {
  const input = {
    workspaceId: 'workshop',
    turnId: 'turn',
    pieceId: 'piece',
    candidates: [
      { resourceId: 'guide', version: 'v1', title: 'Fictional guide', pieceId: 'piece' },
      { resourceId: 'other', version: 'v2', title: 'Other piece', pieceId: 'other-piece' },
    ],
  }
  it('is off by default, gives metadata only, and accepts canonical current-piece pointers only', async () => {
    const { host, request, callTool } = fixture()
    await request('host.contributions.register', {
      contributionId: 'titles',
      kind: 'turn.context.titles',
      api: 1,
      definition: {
        invoke: {
          tool: 'choose_titles',
          arguments: { collection: 'fictional' },
          inputField: 'context',
        },
      },
    })
    expect(await host.beforeTurn(input)).toEqual({ pointers: [] })
    host.setTitlesEnabled('workshop', owner.pluginId, true)
    callTool.mockResolvedValue({
      status: 'result',
      result: {
        content: [],
        structuredContent: {
          pointers: [
            { resourceId: 'guide', version: 'v1', title: 'Injected prose' },
            { resourceId: 'guide', version: 'old' },
            { resourceId: 'unknown', version: 'v1' },
            { resourceId: 'other', version: 'v2' },
          ],
        },
      },
    })
    expect(await host.beforeTurn(input)).toEqual({
      pointers: [{ resourceId: 'guide', version: 'v1' }],
    })
    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: {
          collection: 'fictional',
          context: { ...input, candidates: [input.candidates[0]] },
        },
      }),
    )
  })
  it('runs callbacks in parallel under one 500ms deadline and drops late/off results', async () => {
    vi.useFakeTimers()
    const { host, request, callTool } = fixture()
    for (const contributionId of ['fast', 'slow'])
      await request('host.contributions.register', {
        contributionId,
        kind: 'turn.context.titles',
        api: 1,
        definition: { invoke: { tool: contributionId } },
      })
    host.setTitlesEnabled('workshop', owner.pluginId, true)
    let finish!: (value: PluginToolCallResult) => void
    const result = {
      status: 'result',
      result: {
        content: [],
        structuredContent: { pointers: [{ resourceId: 'guide', version: 'v1' }] },
      },
    } as PluginToolCallResult
    callTool.mockImplementation(async ({ name }: { name: string }) =>
      name === 'fast'
        ? result
        : new Promise((resolve) => {
            finish = resolve
          }),
    )
    const pending = host.beforeTurn(input)
    await vi.advanceTimersByTimeAsync(499)
    expect(callTool).toHaveBeenCalledTimes(2)
    host.setEnabled('workshop', owner.pluginId, false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ pointers: [] })
    finish(result)
    await vi.runAllTimersAsync()
    expect(host.snapshot('workshop').notifications).toEqual([])
  })
  it('drops a selection from before the titles preference was turned off and back on', async () => {
    const { host, request, callTool } = fixture()
    await request('host.contributions.register', {
      contributionId: 'titles',
      kind: 'turn.context.titles',
      api: 1,
      definition: { invoke: { tool: 'choose_titles' } },
    })
    host.setTitlesEnabled('workshop', owner.pluginId, true)
    let finish!: (result: PluginToolCallResult) => void
    callTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = host.beforeTurn(input)
    host.setTitlesEnabled('workshop', owner.pluginId, false)
    host.setTitlesEnabled('workshop', owner.pluginId, true)
    finish({
      status: 'result',
      result: {
        content: [],
        structuredContent: { pointers: [{ resourceId: 'guide', version: 'v1' }] },
      },
    })
    expect(await pending).toEqual({ pointers: [] })
  })
  it('invalidates a title selection after a missed canonical titles revision without revoking buttons', async () => {
    const { host, request, callTool } = fixture()
    await request('host.contributions.register', {
      contributionId: 'titles',
      kind: 'turn.context.titles',
      api: 1,
      definition: { invoke: { tool: 'choose_titles' } },
    })
    host.setTitlesEnabled('workshop', owner.pluginId, true, 3)
    let finish!: (result: PluginToolCallResult) => void
    callTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = host.beforeTurn(input)
    host.setTitlesEnabled('workshop', owner.pluginId, true, 5)
    finish({
      status: 'result',
      result: {
        content: [],
        structuredContent: { pointers: [{ resourceId: 'guide', version: 'v1' }] },
      },
    })
    expect(await pending).toEqual({ pointers: [] })
    const registered = await request('host.contributions.register', button)
    callTool.mockResolvedValue({ status: 'result', result: { content: [] } })
    expect(
      await host.activate('workshop', (registered as { value: { handle: string } }).value.handle),
    ).toEqual({ value: { content: [] } })
  })
})
