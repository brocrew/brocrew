import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyChromeProfile, ChromeProposal } from '../src/main/plugins/lifecycle/chrome-apply'
import type { PluginNodeReady } from '../src/main/plugins/node-host'
afterEach(() => vi.unstubAllGlobals())
const connection: PluginNodeReady = {
  serverPid: 123,
  origin: 'http://127.0.0.1:1',
  mcp: () => ({ url: '', headers: { Authorization: 'Bearer fictional-mcp' } }),
  admin: () => ({
    url: 'http://127.0.0.1:1/v1',
    headers: { Authorization: 'Bearer fictional-admin' },
  }),
}
describe('fixed person-only Chrome profile action mapping', () => {
  it.each([
    [{ action: 'create-profile', profile: 'birch' }, '/profiles', { name: 'birch' }, 201],
    [
      { action: 'set-enabled', profile: 'birch', enabled: true },
      '/profiles/birch/flags',
      { enabled: true },
      200,
    ],
    [{ action: 'open-window', profile: 'birch' }, '/profiles/birch/open', {}, 202],
  ])(
    'maps a validated action to only its own fixed admin endpoint',
    async (proposal, path, body, status) => {
      const fetch = vi.fn(async () => new Response('{}', { status: Number(status) }))
      vi.stubGlobal('fetch', fetch)
      await applyChromeProfile(
        connection,
        ChromeProposal.parse(proposal),
        new AbortController().signal,
      )
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:1/v1' + path,
        expect.objectContaining({
          method: 'POST',
          redirect: 'error',
          body: JSON.stringify(body),
          headers: expect.objectContaining({ Authorization: 'Bearer fictional-admin' }),
        }),
      )
    },
  )
  it.each([
    { action: 'open-window', profile: '../foreign' },
    { action: 'set-enabled', profile: 'birch', enabled: true, url: 'http://foreign.invalid/' },
    { action: 'delete-profile', profile: 'birch' },
  ])('rejects unreviewed actions/fields before any request', async (proposal) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      applyChromeProfile(connection, proposal as never, new AbortController().signal),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not retry an ambiguous admin failure or return downstream bytes', async () => {
    const fetch = vi.fn(async () => new Response('fictional-private-diagnostic', { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      applyChromeProfile(
        connection,
        { action: 'open-window', profile: 'birch' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Plugin unavailable. Try again.')
    expect(fetch).toHaveBeenCalledOnce()
  })
})
