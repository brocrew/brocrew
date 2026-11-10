import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createToolServer } from '../src/shared/toolServer.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import { ToolError } from '../src/tools/schema.js'
import { OperationBlockedError } from '../src/shared/browser/browser-lease.js'
import { harness } from './fakes.js'

const detail = 'net::ERR_CONNECTION_RESET at https://fictional.invalid/ ' + 'x'.repeat(2100)
it.each([
  ['browser failure', new Error(detail), detail, true],
  ['timeout', Object.assign(new Error(detail), { name: 'TimeoutError' }), detail, true],
  ['known refusal', new ToolError('fictional refusal'), 'fictional refusal', false],
  [
    'transition refusal',
    new OperationBlockedError(),
    'the profile is being restarted — call again in a few seconds',
    false,
  ],
] as const)('preserves production %s through MCP', async (_label, error, text, isError) => {
  const h = harness()
  h.profile('fern', { enabled: true })
  h.browser.ensureError = error
  const server = createToolServer({
    name: 'fictional',
    version: '1',
    tools: createAgentChromeTools(h.deps),
  })
  const client = new Client({ name: 'fictional', version: '1' })
  const [local, remote] = InMemoryTransport.createLinkedPair()
  await server.connect(remote)
  try {
    await client.connect(local)
    expect(
      await client.callTool({
        name: 'open_tab',
        arguments: { profile: 'fern', url: 'about:blank' },
      }),
    ).toEqual({
      content: [{ type: 'text', text: `Error: ${text}` }],
      ...(isError ? { isError: true } : {}),
    })
  } finally {
    await client.close()
    await server.close()
    await h.browser.close('fern')
    for (const root of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(root, { recursive: true, force: true })
  }
})
