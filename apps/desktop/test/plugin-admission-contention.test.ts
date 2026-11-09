import { afterEach, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { cleanupLifecycleFixtures, deferred } from './plugin-lifecycle-fixtures'
import { closes, lease, live, request } from './helpers/plugin-agent-bridge'

afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

it('keeps an issued route usable while another async lifecycle context owns the writer fence', async () => {
  const f = await live()
  const owner = lease(), req = request(f.local.sink.workspaceId)
  const [route] = await f.bridge.routes(owner, req)
  const entered = deferred<void>(), release = deferred<void>()
  const writer = f.state.withExclusive(async () => {
    f.state.inspect()
    entered.resolve()
    await release.promise
  })
  await entered.promise
  const client = new Client({ name: 'fictional-contention', version: '1' })
  client.onerror = () => {}
  closes.push(() => client.close())
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(route!.url), {
      requestInit: { headers: { Authorization: `Bearer ${route!.capability}` } },
    }))
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
    expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
      content: [{ type: 'text', text: 'fictional fern' }],
    })
    expect(f.call).toHaveBeenCalledOnce()
    expect(f.bridge.toolsUnavailable('chrome')).toBe(false)
  } finally {
    release.resolve()
    await writer
  }
})
