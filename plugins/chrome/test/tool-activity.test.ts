import fs from 'node:fs'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createToolServer } from '../src/shared/toolServer.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import { createKeyedSerializer } from '../src/shared/browser/browser-lease.js'
import { harness } from './fakes.js'

const fixtures: ReturnType<typeof harness>[] = []
afterEach(async () => {
  for (const h of fixtures.splice(0)) {
    await h.browser.close('fern')
    for (const root of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(root, { recursive: true, force: true })
  }
})
it('reports completed page load and screenshot work through the production tool handlers', async () => {
  const h = harness()
  fixtures.push(h)
  h.profile('fern', { enabled: true })
  const stages: string[] = []
  const tools = createAgentChromeTools(h.deps)
  const opened = await tools
    .find((t) => t.definition.name === 'open_tab')!
    .execute(
      { profile: 'fern', url: 'https://fictional.invalid/' },
      { activity: (stage) => stages.push(stage) },
    )
  const { tabId } = JSON.parse(opened.content[0].text)
  expect(stages).toEqual(['browser-ready', 'page-ready', 'page-loaded'])
  stages.length = 0
  await tools
    .find((t) => t.definition.name === 'navigate')!
    .execute(
      { tabId, url: 'https://fictional.invalid/next' },
      { activity: (stage) => stages.push(stage) },
    )
  expect(stages).toEqual(['page-ready', 'page-loaded'])
  stages.length = 0
  await tools
    .find((t) => t.definition.name === 'screenshot')!
    .execute({ tabId, scope: 'viewport' }, { activity: (stage) => stages.push(stage) })
  expect(stages).toEqual(['page-ready', 'screenshot-captured'])
})
it('preserves the same-tab serializer while another tab makes actual progress', async () => {
  const h = harness()
  fixtures.push(h)
  h.profile('fern', { enabled: true })
  h.deps.serializer = createKeyedSerializer()
  const first = (await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' }))
    .json as { tabId: string }
  const other = (await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' }))
    .json as { tabId: string }
  let release!: (value: Buffer) => void
  h.browser.pages.get('fern')![0].screenshot = () =>
    new Promise<Buffer>((resolve) => {
      release = resolve
    })
  const tools = createAgentChromeTools(h.deps)
  const screenshot = tools.find((t) => t.definition.name === 'screenshot')!
  const held = screenshot.execute({ tabId: first.tabId, scope: 'viewport' }, {})
  await new Promise<void>((resolve) => setImmediate(resolve))
  const waitingStages: string[] = []
  const waiting = tools
    .find((t) => t.definition.name === 'navigate')!
    .execute(
      { tabId: first.tabId, url: 'https://fictional.invalid/next' },
      { activity: (stage) => waitingStages.push(stage) },
    )
  const otherStages: string[] = []
  await screenshot.execute(
    { tabId: other.tabId, scope: 'viewport' },
    { activity: (stage) => otherStages.push(stage) },
  )
  expect(waitingStages).toEqual([])
  expect(otherStages).toEqual(['page-ready', 'screenshot-captured'])
  release(Buffer.from('png'))
  await Promise.all([held, waiting])
  expect(waitingStages).toEqual(['page-ready', 'page-loaded'])
})
it('uses the original progress token and emits no activity after the tool has settled', async () => {
  let late: (() => void) | undefined
  const server = createToolServer({
    name: 'fictional',
    version: '1',
    tools: [
      {
        definition: {
          name: 'echo',
          description: 'Fictional',
          inputSchema: { type: 'object', properties: {} },
        },
        execute(_args, context) {
          context.activity?.('page-loaded')
          late = () => context.activity?.('screenshot-captured')
          queueMicrotask(() => queueMicrotask(() => late?.()))
          return { content: [{ type: 'text', text: 'done' }] }
        },
      },
    ],
  })
  const client = new Client({ name: 'fictional', version: '1' })
  const [local, remote] = InMemoryTransport.createLinkedPair()
  await server.connect(remote)
  await client.connect(local)
  const original = local.onmessage
  const progress: unknown[] = []
  let completed!: () => void
  const done = new Promise<void>((resolve) => {
    completed = resolve
  })
  local.onmessage = (message, extra) => {
    if ('method' in message && message.method === 'notifications/progress')
      progress.push(message.params)
    else if ('id' in message && message.id === 999) completed()
    else original?.(message, extra)
  }
  try {
    await local.send({
      jsonrpc: '2.0',
      id: 999,
      method: 'tools/call',
      params: { name: 'echo', _meta: { progressToken: 'original-token' } },
    })
    await done
    late?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(progress).toEqual([
      { progressToken: 'original-token', progress: 1, message: 'page-loaded' },
    ])
  } finally {
    await client.close()
    await server.close()
  }
})
