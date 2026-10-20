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
  const tool = vi.fn(() => ({
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
