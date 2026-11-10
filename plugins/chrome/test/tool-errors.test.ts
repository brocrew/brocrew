import { expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createToolServer, PublicToolError } from '../src/shared/toolServer.js'

const detail = 'Upstream closed the connection: ' + 'x'.repeat(2100)
it.each([
  ['unexpected error', new Error(detail), detail, true],
  ['known refusal', new PublicToolError(detail), detail, false],
  ['non-Error exception', 'Browser disconnected', 'Browser disconnected', true],
  ['success', null, 'done', false],
] as const)('preserves %s through MCP', async (_label, error, text, isError) => {
  const server = createToolServer({
    name: 'fictional',
    version: '1',
    tools: [
      {
        definition: {
          name: 'probe',
          description: 'Fictional tool',
          inputSchema: { type: 'object', properties: {} },
        },
        execute() {
          if (error !== null) throw error
          return { content: [{ type: 'text', text: 'done' }] }
        },
      },
    ],
  })
  const client = new Client({ name: 'fictional', version: '1' })
  const [local, remote] = InMemoryTransport.createLinkedPair()
  await server.connect(remote)
  try {
    await client.connect(local)
    expect(await client.callTool({ name: 'probe', arguments: {} })).toEqual({
      content: [{ type: 'text', text: error === null ? text : `Error: ${text}` }],
      ...(isError ? { isError: true } : {}),
    })
  } finally {
    await client.close()
    await server.close()
  }
})
