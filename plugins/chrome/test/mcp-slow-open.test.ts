import fs from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, it } from 'vitest'
import { startHttpMcpServer } from '../src/shared/httpMcpServer.js'
import { createToolServer } from '../src/shared/toolServer.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import { harness } from './fakes.js'

it('returns a usable tab receipt over MCP with the fictional page response still held', async () => {
  const h = harness()
  h.profile('fern', { enabled: true })
  const arrived = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let active = 0
  Object.assign(h.browser, {
    async agentCall<T>(_profiles: string[], run: () => Promise<T>): Promise<T> {
      active++
      try {
        return await run()
      } finally {
        active--
      }
    },
  })
  const createPage = h.browser.newPage.bind(h.browser)
  h.browser.newPage = async (profile, options) => {
    const page = await createPage(profile, options)
    const fake = h.browser.pages.get(profile)!.at(-1)!
    const goto = fake.goto.bind(fake)
    fake.goto = async (url) => {
      if (url.endsWith('/waiting')) {
        arrived.resolve()
        await release.promise
      }
      return goto(url)
    }
    return page
  }
  const server = await startHttpMcpServer({
    port: 0,
    createServer: () =>
      createToolServer({
        name: 'fictional-tabs',
        version: '1',
        tools: createAgentChromeTools(h.deps),
      }),
  })
  const endpoint = new URL(
    `http://127.0.0.1:${(server.httpServer.address() as { port: number }).port}/mcp`,
  )
  const caller = new Client({ name: 'fictional-caller', version: '1' })
  const reader = new Client({ name: 'fictional-reader', version: '1' })
  try {
    await caller.connect(new StreamableHTTPClientTransport(endpoint))
    await reader.connect(new StreamableHTTPClientTransport(endpoint))
    const receipt = caller.callTool(
      {
        name: 'open_tab',
        arguments: { profile: 'fern', url: 'https://fictional.invalid/waiting', newWindow: true },
      },
      undefined,
      { timeout: 500 },
    )
    const outcome = receipt.then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    )
    expect(
      await Promise.race([arrived.promise.then(() => 'started'), outcome.then(() => 'settled')]),
    ).toBe('started')
    const { value, error } = await outcome
    const list = await reader.callTool({ name: 'list_tabs', arguments: { profile: 'fern' } })
    const listContent = list.content as Array<{ text: string }>
    expect(JSON.parse(listContent[0].text)).toMatchObject([{ tabId: 't1', windowId: 1 }])
    expect(error).toBeUndefined()
    const content = value?.content as Array<{ text: string }>
    expect(JSON.parse(content[0].text)).toMatchObject({
      tabId: 't1',
      windowId: 1,
      url: 'https://fictional.invalid/waiting',
      title: '',
    })
    expect(active).toBe(1)
    const next = await reader.callTool(
      {
        name: 'open_tab',
        arguments: { profile: 'fern', url: 'about:blank', windowOf: 't1' },
      },
      undefined,
      { timeout: 500 },
    )
    const nextContent = next.content as Array<{ text: string }>
    expect(JSON.parse(nextContent[0].text)).toMatchObject({ tabId: 't2', windowId: 1 })
    expect(active).toBe(1)
  } finally {
    release.resolve()
    await caller.close()
    await reader.close()
    await server.close()
    await h.browser.close('fern')
    for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  }
})
