// Observer only: attaches to the service launched by the installed candidate.
// @SOURCE@ is replaced by the orchestrator before bundling against candidate dependencies.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PluginWorkspaceLease, pluginWorkspaceIdentity } from '@SOURCE@/apps/desktop/src/main/plugins/supervisor/client'
import { connectPersonPluginControl } from '@SOURCE@/apps/desktop/src/main/plugins/lifecycle/person-control'

const [root, workspace, evidence, proofMode = 'both-plugins'] = process.argv.slice(2)
assert(proofMode === 'both-plugins' || proofMode === 'whatsapp-only', 'invalid observer proof mode')
const requiredPlugins = proofMode === 'whatsapp-only' ? ['whatsapp'] : ['chrome', 'whatsapp']
assert.equal(process.platform, 'win32')
assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.env.GITHUB_REPOSITORY, 'brocrew/brocrew')
assert(root && workspace && evidence)
const save = (name: string, value: unknown) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + '\n')
const result: any = { passed: false, proofMode, calls: [], failures: [], cleanup: {} }
const owner = () => JSON.parse(readFileSync(join(root, 'supervisor', 'owner.json'), 'utf8'))
const initialOwner = owner()
assert.equal(initialOwner.phase, 'accepting')
mkdirSync(workspace)
const workspaceId = pluginWorkspaceIdentity(workspace), incarnation = randomUUID()
let lease: PluginWorkspaceLease | undefined, person: Awaited<ReturnType<typeof connectPersonPluginControl>> | undefined
const sessions: { url: URL; capability: string; session?: string; protocol: string }[] = []
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Preserve decoded JSON-RPC results, not authorization headers or capabilities. The actual
// exchange is plain loopback HTTP and accepts JSON or the Streamable HTTP SSE response form.
async function rpc(route: typeof sessions[number], message: any, notification = false) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${route.capability}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': route.protocol,
  }
  if (route.session) headers['Mcp-Session-Id'] = route.session
  const response = await fetch(route.url, { method: 'POST', headers, body: JSON.stringify(message), redirect: 'error', signal: AbortSignal.timeout(15000) })
  const session = response.headers.get('mcp-session-id')
  if (session) route.session = session
  if (notification) { assert(response.ok); await response.body?.cancel(); return { status: response.status } }
  assert.equal(response.status, 200, `HTTP RPC ${message.method}`)
  const text = await response.text()
  assert(text.length <= 4 * 1024 * 1024, 'bounded MCP response')
  const contentType = response.headers.get('content-type') ?? ''
  const messages = contentType.includes('text/event-stream')
    ? text.split(/\r?\n\r?\n/).flatMap(event => {
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        return data ? [JSON.parse(data)] : []
      })
    : [JSON.parse(text)]
  const reply = messages.find(value => value.id === message.id)
  assert(reply, `missing RPC id for ${message.method}`)
  assert.equal(reply.jsonrpc, '2.0')
  assert.equal(reply.error, undefined, JSON.stringify(reply.error))
  return reply.result
}

async function tools(route: typeof sessions[number], id: string) {
  const entries: any[] = [], pages: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const reply = await rpc(route, { jsonrpc: '2.0', id: `${id}-tools-${page}`, method: 'tools/list', params: cursor ? { cursor } : {} })
    assert(Array.isArray(reply.tools)); pages.push(reply); entries.push(...reply.tools)
    if (!reply.nextCursor) return { entries, pages }
    assert.equal(typeof reply.nextCursor, 'string'); assert.notEqual(reply.nextCursor, cursor)
    cursor = reply.nextCursor
  }
  throw Error('tools/list exceeded 20 pages')
}

async function main() {
  try {
    // No launch callback: if installed app did not start a service, this cannot substitute one.
    lease = await PluginWorkspaceLease.attach({ root, workspaceRoot: workspace, generation: randomUUID(), build: 'windows-installed-upgrade-observer' })
    await lease.renew()
    const capabilityFolder = join(root, 'capabilities')
    // Capability location is content-addressed by this fixed purpose in the shipped app.
    const { createHash } = await import('node:crypto')
    const key = readFileSync(join(capabilityFolder, createHash('sha256').update('brocrew-person-control-v1').digest('hex'), 'person'), 'utf8')
    person = await connectPersonPluginControl({ path: join(root, 'person-control', 'person.sock'), key, handle: async () => true })
    await person.call({ kind: 'attach', workspaceId })
    const end = performance.now() + 45000
    let routes: any
    do {
      const reply = await lease.agentRoutes({ workspaceId, incarnation, occupied: [] })
      assert.equal(reply.format, 2)
      routes = reply.value
      result.routes = { format: routes.format, servers: routes.servers.map((server: any) => ({ pluginId: server.pluginId, name: server.name, url: server.url })), pending: routes.pending, none: routes.none, unknown: routes.unknown }
      result.cards = await person.call({ kind: 'list-tool-cause' })
      save('observer-progress.json', result)
      if (requiredPlugins.every(id => routes.servers.some((server: any) => server.pluginId === id))) break
      if (routes.pending.length === 0) break
      await delay(250)
    } while (performance.now() < end)
    if (proofMode === 'both-plugins') assert.equal(routes.servers.length, 2, 'both installed plugins need live HTTP routes')
    for (const id of requiredPlugins) {
      const server = routes.servers.find((one: any) => one.pluginId === id); assert(server)
      const url = new URL(server.url); assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.username, ''); assert.equal(url.password, '')
      const route = { url, capability: server.capability, protocol: '2025-03-26', session: undefined as string | undefined }; sessions.push(route)
      const initialized = await rpc(route, { jsonrpc: '2.0', id: `${id}-init`, method: 'initialize', params: { protocolVersion: route.protocol, capabilities: {}, clientInfo: { name: 'windows-installed-upgrade', version: '1' } } })
      assert.equal(typeof initialized.protocolVersion, 'string'); route.protocol = initialized.protocolVersion
      await rpc(route, { jsonrpc: '2.0', method: 'notifications/initialized' }, true)
      const listed = await tools(route, id)
      assert(listed.entries.some(tool => tool.name === (id === 'chrome' ? 'list_browser_profiles' : 'list_chats')))
      const call: any = { id, initialize: initialized, tools: listed }
      result.calls.push(call); save('observer-progress.json', result)
      if (id === 'chrome') {
        call.reply = await rpc(route, { jsonrpc: '2.0', id: 'chrome-profiles', method: 'tools/call', params: { name: 'list_browser_profiles', arguments: {} } })
        assert.notEqual(call.reply.isError, true)
        const content = call.reply.content.find((part: any) => part.type === 'text'); assert(content)
        assert(Array.isArray(JSON.parse(content.text)), 'profile list must answer with an array')
      }
      save('observer-progress.json', result)
    }
    const current = owner(); assert.equal(current.epoch, initialOwner.epoch); assert.equal(current.phase, 'accepting')
    result.ownerEpoch = current.epoch
    save('observer-progress.json', result)
    // Keep the routes and both leases held until native process witnesses have been captured.
    console.log('WINDOWS_PLUGIN_UPGRADE_TOOLS_READY_V1')
    const witnessPath = join(evidence, 'observer-native-witness.json'), witnessDeadline = performance.now() + 60000
    while (!existsSync(witnessPath) && performance.now() < witnessDeadline) await delay(100)
    assert(existsSync(witnessPath), 'native observer witness deadline')
    const witness = JSON.parse(readFileSync(witnessPath, 'utf8'))
    assert.equal(witness.passed, true, witness.failure); assert.equal(witness.ownerEpoch, current.epoch)
    result.nativeWitness = witness
  } catch (error: any) { result.failures.push(error.stack ?? String(error)) }
  finally {
    for (const route of sessions) if (route.session) {
      try { const response = await fetch(route.url, { method: 'DELETE', headers: { Authorization: `Bearer ${route.capability}`, 'Mcp-Session-Id': route.session, 'MCP-Protocol-Version': route.protocol }, redirect: 'error', signal: AbortSignal.timeout(15000) }); result.cleanup.httpSessions ??= []; result.cleanup.httpSessions.push({ status: response.status }); assert([200, 202, 204, 405].includes(response.status)); await response.body?.cancel() }
      catch (error: any) { result.failures.push(`HTTP session close: ${error.message}`) }
    }
    try { if (lease) await lease.agentRoutes({ workspaceId, incarnation, occupied: [], release: true }); result.cleanup.routesReleased = !!lease } catch (error: any) { result.failures.push(`route release: ${error.message}`) }
    try { if (person) { await person.call({ kind: 'detach' }); result.cleanup.personDetached = true } } catch (error: any) { result.failures.push(`person detach: ${error.message}`) } finally { person?.close() }
    try { if (lease) { result.cleanup.leaseClosed = await lease.close(); assert.equal(result.cleanup.leaseClosed, true) } } catch (error: any) { result.failures.push(`lease close: ${error.message}`) }
    result.passed = result.failures.length === 0 && result.calls.length === requiredPlugins.length
    save('observer-result.json', result)
  }
  assert.equal(result.passed, true, result.failures.join('\n'))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
