import { expect, it, vi } from 'vitest'
import { withChromeResourcePolicy } from '../src/main/plugins/lifecycle/chrome-policy'
import type { BrokerRequest, BrokerServer } from '../src/main/plugins/tool-broker'
const request = (name = 'navigate'): BrokerRequest => ({
  name,
  input: { tabId: 'fictional-tab' },
  resources: [],
  identity: {
    pluginId: 'chrome',
    installId: 'fictional-install',
    epoch: 'fictional-epoch',
    workspaceId: 'fictional-workspace',
    kind: 'agent',
    incarnation: 'fictional-agent',
  },
})
function fixture() {
  const tool = vi.fn<BrokerServer['tool']>(() => ({
    result: Promise.resolve({ ok: true as const, value: 'fictional fern' }),
    quiescent: Promise.resolve(),
    cancel() {},
  }))
  const port: BrokerServer = {
    tool,
    admin() {
      throw new Error('private')
    },
  }
  const snapshot = {
    profiles: [{ name: 'fern', enabled: true, allowSettings: true, allowExtensions: false }],
    tabs: [{ id: 'fictional-tab', profile: 'fern' }],
  }
  return { tool, snapshot, policy: withChromeResourcePolicy(port, async () => snapshot) }
}
it('resolves a tab to the current enabled profile, and refuses the next call after revocation', async () => {
  const f = fixture()
  const first = f.policy.tool(request(), new AbortController().signal)
  expect(await first.result).toMatchObject({ ok: true })
  await first.quiescent
  f.snapshot.profiles[0]!.enabled = false
  const second = f.policy.tool(request(), new AbortController().signal)
  expect(await second.result).toEqual({ ok: false })
  await second.quiescent
  expect(f.tool).toHaveBeenCalledOnce()
})
it('checks settings and extension choices and refuses unknown tab ownership', async () => {
  const f = fixture(),
    signal = new AbortController().signal
  const settings = { ...request('set_setting'), input: { profile: 'fern' } }
  f.snapshot.profiles[0]!.allowSettings = false
  expect(await f.policy.tool(settings, signal).result).toEqual({ ok: false })
  const extensions = { ...request('install_extension'), input: { profile: 'fern' } }
  expect(await f.policy.tool(extensions, signal).result).toEqual({ ok: false })
  const unknown = { ...request(), input: { tabId: 'unknown' } }
  expect(await f.policy.tool(unknown, signal).result).toEqual({ ok: false })
  expect(f.tool).not.toHaveBeenCalled()
})
it('cancellation of a held policy read never admits a late tool', async () => {
  const f = fixture(),
    abort = new AbortController()
  let release!: () => void
  const policy = withChromeResourcePolicy(
    {
      tool: f.tool,
      admin() {
        throw new Error('private')
      },
    },
    async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return f.snapshot
    },
  )
  const work = policy.tool(request(), abort.signal)
  abort.abort()
  release()
  expect(await work.result).toEqual({ ok: false })
  await work.quiescent
  expect(f.tool).not.toHaveBeenCalled()
})

it('refuses a result revoked in another workspace while the tool was running', async () => {
  const f = fixture()
  let finish!: (value: { ok: true; value: string }) => void
  f.tool.mockImplementationOnce(() => ({
    result: new Promise((resolve) => {
      finish = resolve
    }),
    quiescent: Promise.resolve(),
    cancel() {},
  }))
  const work = f.policy.tool(request('set_setting'), new AbortController().signal)
  await vi.waitFor(() => expect(f.tool).toHaveBeenCalledOnce())
  f.snapshot.profiles[0]!.allowSettings = false
  finish({ ok: true, value: 'revoked result' })
  expect(await work.result).toEqual({ ok: false })
  await work.quiescent
})

it.each(['close_tab', 'navigate'])(
  'uses the expected postcondition when %s removes its tab',
  async (name) => {
    const f = fixture()
    f.tool.mockImplementationOnce(() => {
      f.snapshot.tabs = []
      return {
        result: Promise.resolve({ ok: true as const, value: 'closed' }),
        quiescent: Promise.resolve(),
        cancel() {},
      }
    })
    const work = f.policy.tool(request(name), new AbortController().signal)
    expect(await work.result).toEqual(
      name === 'close_tab' ? { ok: true, value: 'closed' } : { ok: false },
    )
    await work.quiescent
    expect(f.tool).toHaveBeenCalledOnce()
  },
)
it.each(['disabled', 'remapped', 'removed', 'shared-held', 'failed', 'cancelled'] as const)(
  'does not accept a close result after %s',
  async (mode) => {
    const f = fixture(),
      abort = new AbortController()
    f.tool.mockImplementationOnce(() => {
      if (mode === 'remapped') f.snapshot.tabs[0]!.profile = 'other'
      else f.snapshot.tabs = []
      if (mode === 'disabled') f.snapshot.profiles[0]!.enabled = false
      if (mode === 'removed') f.snapshot.profiles = []
      if (mode === 'shared-held')
        Object.assign(f.snapshot.profiles[0]!, { shared: true, status: 'in-use' })
      if (mode === 'cancelled') abort.abort()
      return {
        result: Promise.resolve(
          mode === 'failed' ? { ok: false as const } : { ok: true as const, value: 'closed' },
        ),
        quiescent: Promise.resolve(),
        cancel() {},
      }
    })
    const work = f.policy.tool(request('close_tab'), abort.signal)
    expect(await work.result).toEqual({ ok: false })
    await work.quiescent
  },
)

it.each(['before', 'after'] as const)(
  'fails closed when the %s open-tab snapshot cannot be verified',
  async (when) => {
    const f = fixture(),
      reasons: string[] = []
    let reads = 0
    const policy = withChromeResourcePolicy(
      {
        tool: f.tool,
        admin() {
          throw new Error('private')
        },
      },
      async () => {
        if (++reads === (when === 'before' ? 1 : 2)) throw new Error('fictional metadata timeout')
        return f.snapshot
      },
      (reason) => reasons.push(reason),
    )
    const work = policy.tool(
      { ...request('open_tab'), input: { profile: 'fern', url: 'https://fictional.invalid' } },
      new AbortController().signal,
    )
    expect(await work.result).toEqual({ ok: false })
    await work.quiescent
    expect(f.tool).toHaveBeenCalledTimes(when === 'before' ? 0 : 1)
    expect(reasons).toEqual(['resource-policy-failed'])
  },
)

it('does not add a refusal for a surviving tab remapped to another enabled profile', async () => {
  const f = fixture()
  f.snapshot.profiles.push({
    name: 'other',
    enabled: true,
    allowSettings: true,
    allowExtensions: false,
  })
  f.tool.mockImplementationOnce(() => {
    f.snapshot.tabs[0]!.profile = 'other'
    return {
      result: Promise.resolve({ ok: true as const, value: 'original policy allows this' }),
      quiescent: Promise.resolve(),
      cancel() {},
    }
  })
  const work = f.policy.tool(request('close_tab'), new AbortController().signal)
  expect(await work.result).toMatchObject({ ok: true })
  await work.quiescent
})
