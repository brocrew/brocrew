export const thirdPartyMcpSource = String.raw`
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const home = process.env.BROCREW_FICTIONAL_ORCHID_DATA
const auth = JSON.parse(readFileSync(process.env.BROCREW_FICTIONAL_ORCHID_AUTH, 'utf8'))
const tool = {
  name: 'echo',
  description: 'Echo a fictional profile from the package process.',
  inputSchema: { type: 'object', properties: { profile: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  _meta: { packageOwned: 'orchid' },
}
const replies = {
  initialize: (params) => ({
    protocolVersion: params.protocolVersion,
    serverInfo: { name: 'fictional-orchid', version: '1.0.0' },
    capabilities: { tools: {} },
  }),
  'tools/list': () => ({ tools: [tool] }),
  'tools/call': (params) => ({
    content: [{ type: 'text', text: 'Fictional plugin result: ' + params.arguments.profile }],
    _meta: { home, pid: process.pid, packageOwned: 'orchid', inheritedParent: process.env.FICTIONAL_PLUGIN_PARENT },
  }),
}
const server = createServer((req, res) => {
  const token = req.url === '/mcp' ? auth.mcpToken : auth.adminToken
  if (req.headers.authorization !== 'Bearer ' + token) return res.writeHead(401).end()
  res.setHeader('content-type', 'application/json')
  if (req.url === '/healthz') return res.end(JSON.stringify({ ok: true, version: '1.0.0' }))
  if (req.url !== '/mcp') return res.writeHead(404).end()
  if (req.method !== 'POST') return res.writeHead(405).end()
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    const packet = JSON.parse(body)
    if (packet.id === undefined) return res.writeHead(202).end()
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: packet.id,
        result: replies[packet.method](packet.params),
      }),
    )
  })
})
server.listen(0, '127.0.0.1', () => {
  process.send({
    channel: 'brocrew-plugin-node:v1',
    runId: process.env.BROCREW_PLUGIN_RUN_ID,
    type: 'listening',
    port: server.address().port,
  })
})
`
