// Gate-only scripted provider. It consumes the real per-launch broker route, never a plugin credential.
import fs from 'node:fs'
import path from 'node:path'
import { FakeRuntime } from '../../../packages/runtime/src/fake-runtime.ts'
import { Client } from '../../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'
import { managedPluginHttpServers } from '../../../packages/runtime/src/managed-plugin-mcp.ts'
import { deriveProviderHome } from '../../../apps/desktop/src/main/runtime/provider-homes.ts'
import { fixtureTitle, fixtureText } from './fake-browser.mjs'
import { providerErrors } from './provider-state.mjs'

function refused(category) {
  const error = new Error('Fixture provider refused')
  error.providerCategory = category
  return error
}

/** This user's folder, private by its mode; on Windows the gate's scratch root's access list does that. */
const ownedPrivately = (stat) =>
  process.platform === 'win32' || (stat.uid === process.getuid() && !(stat.mode & 0o077))
// The gate never provisions or checks a credential. Normal builds refuse this named seam.
export function preparePackagedGateHome(root, userData, provider, profileId) {
  const rootStat = fs.lstatSync(root)
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    fs.realpathSync(root) !== root ||
    !ownedPrivately(rootStat) ||
    !['claude', 'codex'].includes(provider)
  )
    throw new Error('Invalid fake-provider root')
  const home = deriveProviderHome(userData, { provider, profileId })
  if (
    !path.isAbsolute(root) ||
    !userData.startsWith(root + path.sep) ||
    path.resolve(userData) !== userData ||
    !home.startsWith(userData + path.sep)
  )
    throw new Error('Invalid fake-provider root')
  const relative = path.relative(root, home)
  let folder = root
  for (const part of relative.split(path.sep)) {
    folder = path.join(folder, part)
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { mode: 0o700 })
    const stat = fs.lstatSync(folder)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !ownedPrivately(stat))
      throw new Error('Invalid fake-provider folder')
  }
  // A fresh scripted session cannot inherit a saved login, even inside scratch.
  for (const name of ['auth.json', '.credentials.json', '.claude.json', 'credentials.json'])
    if (fs.existsSync(path.join(home, name)))
      throw new Error('Fake-provider home is not credential-free')
  if (provider === 'claude')
    fs.writeFileSync(path.join(root, 'fake-provider-home-ready.json'), '{"prepared":true}', {
      mode: 0o600,
    })
  return home
}

export const openPrompt = 'Use Chrome to open the fern fixture page and read its title.'
export const closePrompt = 'Use Chrome to close the fern fixture tab.'
export function scriptedHandle(handle, options, directory, connect = brokerClient) {
  let tabId
  const proof = {
    agentStarted: true,
    turnSent: false,
    toolCalled: false,
    errorCategory: 'other',
    routeReady: false,
    opened: false,
    read: false,
    titleReturned: false,
    closed: false,
    calls: 0,
  }
  const send = handle.send.bind(handle)
  const save = () =>
    fs.writeFileSync(path.join(directory, 'provider-proof.json'), JSON.stringify(proof), {
      mode: 0o600,
    })
  save()
  handle.send = async (text, origin) => {
    proof.turnSent = true
    proof.errorCategory = 'prompt'
    save()
    // RuntimeHost surrounds the person's words with factory/plugin/app context.
    const has = (prompt) => text.split(/\r?\n/).some((line) => line.trim() === prompt)
    const action =
      tabId && has(closePrompt)
        ? 'close'
        : has(openPrompt)
          ? 'open'
          : has(closePrompt)
            ? 'close'
            : null
    if (action === null) return send(text, origin)
    save()
    let client
    proof.errorCategory = 'connect'
    save()
    try {
      client = await connect(options.managedPluginMcp)
      proof.routeReady = true
      save()
      const tool = async (name, args) => {
        proof.errorCategory = 'tool'
        save()
        const value = await client.callTool({ name, arguments: args }, undefined, {
          timeout: 20000,
        })
        // A response (even a refusal) witnesses that the broker received the call.
        proof.toolCalled = true
        save()
        if (value.isError || !Array.isArray(value.content)) throw refused('tool')
        proof.calls++
        save()
        return value.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
      }
      if (action === 'open') {
        if (tabId) throw new Error('Fixture tab already open')
        const plan = JSON.parse(fs.readFileSync(path.join(directory, 'browser-fixture.json')))
        const opened = JSON.parse(await tool('open_tab', { profile: 'fern', url: plan.url }))
        if (
          !/^t\d+$/.test(opened.tabId) ||
          opened.url !== plan.url ||
          opened.title !== fixtureTitle ||
          opened.loadError
        )
          throw refused('navigation')
        tabId = opened.tabId
        proof.opened = true
        save()
        const read = await tool('snapshot', { tabId, mode: 'text', timeoutMs: 5000 })
        if (!read.includes(`title: ${fixtureTitle}`) || !read.includes(fixtureText))
          throw refused('snapshot')
        proof.read = true
        save()
        proof.errorCategory = 'bridge'
        save()
        // The scripted provider answers only from the actual tool response.
        await send(`Chrome title: ${opened.title}`, origin)
        proof.errorCategory = 'other'
        proof.titleReturned = true
        save()
      } else {
        if (!tabId) throw new Error('No fixture tab')
        const closed = JSON.parse(await tool('close_tab', { tabId }))
        if (closed.ok !== true) throw new Error('Fixture close failed')
        tabId = undefined
        proof.closed = true
        save()
        await send('Chrome fixture tab closed.', origin)
      }
    } catch (error) {
      proof.errorCategory = providerErrors.includes(error?.providerCategory)
        ? error.providerCategory
        : proof.errorCategory
      save()
      throw error
    } finally {
      await client?.close()
    }
  }
  return handle
}
export async function brokerClient(servers = []) {
  try {
    managedPluginHttpServers(servers)
  } catch {
    throw refused('route-invalid')
  }
  const server = servers.find((candidate) => candidate.name === 'plugin-chrome')
  if (!server) throw refused('route-absent')
  const client = new Client({ name: 'fern-fixture-provider', version: '1' })
  client.onerror = () => {}
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: { Authorization: `Bearer ${server.capability}` }, redirect: 'error' },
  })
  let category = 'connect'
  try {
    await client.connect(transport, { timeout: 10000 })
    category = 'inventory'
    const inventory = await client.listTools({}, { timeout: 10000 })
    if (
      !['open_tab', 'snapshot', 'close_tab'].every((name) =>
        inventory.tools.some((tool) => tool.name === name),
      )
    )
      throw new Error('Fixture tools absent')
    return client
  } catch {
    await client.close().catch(() => {})
    throw refused(category)
  }
}
export class PackagedGateRuntime extends FakeRuntime {
  constructor(provider, directory) {
    super(provider)
    this.directory = directory
  }
  async start(options) {
    return scriptedHandle(await super.start(options), options, this.directory)
  }
  async resume(ref, options) {
    return scriptedHandle(await super.resume(ref, options), options, this.directory)
  }
}
