import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createAgentMcpServer } from '../../src/agent-mcp-server'
import type { AgentToolset } from '../../src/agent-tools'

export async function agentMcpCatalogue(set: AgentToolset) {
  const server = createAgentMcpServer(set).instance
  const client = new Client({ name: 'fictional-core-catalogue', version: '1' })
  const [clientWire, serverWire] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverWire)
    await client.connect(clientWire)
    return {
      name: set.server,
      description: client.getInstructions(),
      tools: (await client.listTools()).tools,
    }
  } finally {
    await client.close()
    await server.close()
  }
}
