import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allToolDefs, createAgentChromeTools } from '../src/tools/index.js'
import { jsonSchemaOf } from '../src/tools/schema.js'
import type { ToolDeps } from '../src/tools/common.js'
import { harness } from './fakes.js'

const fixtures: ReturnType<typeof harness>[] = []
function fixture() {
  const h = harness()
  fixtures.push(h)
  return h
}
afterEach(() => {
  for (const h of fixtures.splice(0)) {
    for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('every Chrome business tool names its profile', () => {
  const defs = allToolDefs()
  it('covers the complete business inventory', () => expect(defs).toHaveLength(34))
  for (const def of defs) {
    it(`${def.spec.name}: schema requires a nonempty named profile`, () => {
      const schema = jsonSchemaOf(def.spec)
      expect(schema.required).toContain('profile')
      expect(schema.properties.profile).toMatchObject({ type: 'string', minLength: 1 })
    })
    it(`${def.spec.name}: direct invocation rejects absent, empty and wildcard names before dependencies`, async () => {
      const accessed = vi.fn(() => { throw new Error('dependency accessed') })
      const deps = new Proxy({} as ToolDeps, { get: accessed })
      for (const profile of [undefined, '', '*', 'all profiles', ' ', 1, null]) {
        await expect(def.run({ profile }, deps)).rejects.toThrow(/profile/)
        expect(accessed).not.toHaveBeenCalled()
      }
    })
    if (def.spec.name === 'create_browser_profile') continue
    it(`${def.spec.name}: unknown and disabled profiles fail before browser effects`, async () => {
      const h = fixture()
      h.profile('off', { enabled: false })
      const call = vi.fn(async (_profiles: readonly string[], fn: () => Promise<unknown>) => fn())
      h.deps.browser.agentCall = call
      const before = fs.readFileSync(path.join(h.home, 'profiles.json'))
      for (const profile of ['unknown', 'off'])
        await expect(def.run({ profile }, h.deps)).rejects.toThrow(/profile/)
      expect(call).not.toHaveBeenCalled()
      expect(h.browser.touches).toEqual([])
      expect(fs.readFileSync(path.join(h.home, 'profiles.json'))).toEqual(before)
    })
    if ('tabId' in def.spec.props) {
      it(`${def.spec.name}: another profile's tab fails before call effects`, async () => {
        const h = fixture()
        h.profile('fern')
        h.profile('birch')
        const opened = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as { tabId: string }
        const call = vi.fn(async (_profiles: readonly string[], fn: () => Promise<unknown>) => fn())
        h.deps.browser.agentCall = call
        h.browser.touches.length = 0
        await expect(def.run({ profile: 'birch', tabId: opened.tabId }, h.deps)).rejects.toThrow(/profile/)
        expect(call).not.toHaveBeenCalled()
        expect(h.browser.touches).toEqual([])
      })
    }
  }
  it('scopes profile metadata and tab lists to the supplied enabled name', async () => {
    const h = fixture()
    h.profile('fern')
    h.profile('birch')
    const fern = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json
    await h.call('open_tab', { profile: 'birch', url: 'about:blank' })
    expect((await h.call('list_browser_profiles', { profile: 'fern' })).json).toEqual([expect.objectContaining({ name: 'fern' })])
    expect((await h.call('list_tabs', { profile: 'fern' })).json).toEqual([expect.objectContaining(fern)])
  })
  it('checks mismatched window anchors before touching or opening a browser', async () => {
    const h = fixture()
    h.profile('fern')
    h.profile('birch')
    const opened = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as { tabId: string }
    h.browser.touches.length = 0
    await expect(allToolDefs().find(d => d.spec.name === 'open_tab')!.run({ profile: 'birch', windowOf: opened.tabId, url: 'about:blank' }, h.deps)).rejects.toThrow(/profile/)
    expect(h.browser.touches).toEqual([])
    expect(h.browser.state('birch')).toBeNull()
  })
  it('creates only the explicitly supplied temporary profile', async () => {
    const h = fixture()
    expect(await h.callError('create_browser_profile', { temporary: true })).toContain('profile')
    expect(await h.callError('create_browser_profile', { name: 'implicit', temporary: true })).toMatch(/profile|unknown/)
    expect(h.store.list()).toEqual([])
    expect((await h.call('create_browser_profile', { profile: 'named-temp', temporary: true })).json).toMatchObject({ name: 'named-temp', temporary: true })
    expect(h.store.list().map(p => p.name)).toEqual(['named-temp'])
  })
  it('MCP schema bypass still refuses missing profile', async () => {
    const h = fixture()
    h.profile('fern')
    const tool = createAgentChromeTools(h.deps).find(t => t.definition.name === 'list_browser_profiles')!
    await expect(tool.execute({}, {})).rejects.toThrow(/profile/)
  })
  it('same-profile close succeeds after the tab registry entry disappears', async () => {
    const h = fixture()
    h.profile('fern')
    const opened = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as { tabId: string }
    expect((await h.call('close_tab', { profile: 'fern', tabId: opened.tabId })).json).toEqual({ ok: true })
    expect(h.tabs.list(p => h.browser.state(p)?.generation ?? null, 'fern')).toEqual([])
  })
})
