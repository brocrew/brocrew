import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import type { Socket } from 'node:net'
import { once } from 'node:events'
import { strict as assert } from 'node:assert'
import { PluginUiAssets, PLUGIN_SCHEME } from '../../src/main/plugins/ui/assets'
import { installPluginUiRpc, openPluginConfigurationView } from '../../src/main/plugins/ui/host'
import { genericUiFixture } from '../plugin-ui-fixtures'

app.setPath('userData', process.argv.at(-1)!)
protocol.registerSchemesAsPrivileged([PLUGIN_SCHEME])
const watchdog = setTimeout(() => app.exit(2), 20_000)
const sockets = new Set<Socket>()
const requests: string[] = []
let upgrades = 0
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`)
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end()
    return
  }
  if (request.url !== '/fictional-backend') {
    response.writeHead(404).end()
    return
  }
  let body = ''
  request.setEncoding('utf8').on('data', (chunk: string) => {
    body += chunk
  })
  request.on('end', () => {
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        saved: body ? JSON.parse(body) : null,
        source: 'fictional loopback backend',
      }),
    )
  })
})
server.on('connection', (socket) => {
  sockets.add(socket)
  socket.once('close', () => sockets.delete(socket))
})
server.on('upgrade', (request, socket) => {
  if (request.url !== '/fictional-websocket') return socket.destroy()
  upgrades++
  const accept = createHash('sha1')
    .update(String(request.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64')
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  const text = Buffer.from('fictional websocket connected')
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]))
  socket.on('data', (chunk: Buffer) => {
    if ((chunk[0]! & 0x0f) === 8) socket.end(Buffer.from([0x88, 0]))
  })
})

async function run() {
  await app.whenReady()
  app.dock?.hide()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fictional backend port')
  const backend = `http://127.0.0.1:${address.port}`
  const websocket = `ws://127.0.0.1:${address.port}/fictional-websocket`
  installPluginUiRpc(ipcMain)
  const fixture = genericUiFixture()
  let current = true,
    stopped = 0,
    invalidate!: () => void | Promise<void>
  const calls: { name: string; args: unknown }[] = []
  const owner = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  const page = await openPluginConfigurationView({
    verified: fixture.verified,
    binding: fixture.binding,
    current: () => current,
    onInvalidate(revoke) {
      invalidate = revoke
      return () => {
        stopped++
      }
    },
    tools: {
      current: () => current,
      async callTool(name, args) {
        calls.push({ name, args: structuredClone(args) })
        return {
          status: 'result',
          result: { content: [{ type: 'text', text: 'fictional MCP answer' }] },
        }
      },
    },
  })
  owner.contentView.addChildView(page.view)
  const contents = page.view.webContents
  const result = await contents.executeJavaScript(`(async () => {
    const fetched = await fetch(${JSON.stringify(backend + '/fictional-backend')}, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: 'fictional recipes' })
    }).then(reply => reply.json());
    const asset = await fetch('./app.js').then(reply => reply.text());
    const websocket = await new Promise((resolve, reject) => {
      const socket = new WebSocket(${JSON.stringify(websocket)});
      socket.onerror = () => reject(new Error('Fictional WebSocket failed'));
      socket.onmessage = event => { resolve(event.data); socket.close(); };
    });
    const tools = await new Promise(resolve => {
      const receive = event => {
        const reply = event.data;
        if (event.source === window && reply?.channel === 'brocrew-plugin-tools:v1' &&
            reply.requestId === 'fictional-backend-tools' && typeof reply.ok === 'boolean') {
          window.removeEventListener('message', receive); resolve(reply);
        }
      };
      window.addEventListener('message', receive);
      window.postMessage({ channel: 'brocrew-plugin-tools:v1', requestId: 'fictional-backend-tools',
        method: 'callTool', params: { tool: 'fictional_settings', arguments: { collection: 'fictional recipes' } }
      }, location.origin);
    });
    return { fetched, asset, websocket, tools, require: typeof require, api: typeof window.api };
  })()`)
  assert.deepEqual(result.fetched, {
    saved: { collection: 'fictional recipes' },
    source: 'fictional loopback backend',
  })
  assert.equal(result.asset, new TextDecoder().decode(fixture.verified.readFile('ui/app.js')!))
  assert.equal(result.websocket, 'fictional websocket connected')
  assert.equal(result.require, 'undefined')
  assert.equal(result.api, 'undefined')
  assert.deepEqual(result.tools.data, {
    status: 'result',
    result: { content: [{ type: 'text', text: 'fictional MCP answer' }] },
  })
  assert.deepEqual(calls, [
    { name: 'fictional_settings', args: { collection: 'fictional recipes' } },
  ])
  assert.equal(upgrades, 1)
  assert.ok(requests.includes('POST /fictional-backend'))
  const assets = new PluginUiAssets(fixture.verified, new URL(page.origin).hostname)
  assert.equal(assets.response({ url: assets.origin + '/main.mjs', method: 'GET' }).status, 404)
  assert.equal(assets.response({ url: assets.entry + '?other', method: 'GET' }).status, 404)
  current = false
  await invalidate()
  assert.equal(contents.isDestroyed(), true)
  assert.equal(stopped, 1)
  await assert.rejects(async () =>
    contents.executeJavaScript(`fetch(${JSON.stringify(backend + '/fictional-backend')})`),
  )
  owner.destroy()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return { fetch: true, websocket: true, asset: true, tools: true, invalidation: true }
}

void run().then(
  (result) => {
    clearTimeout(watchdog)
    process.stdout.write(JSON.stringify(result) + '\n', () => app.exit(0))
  },
  (error: unknown) => {
    console.error(error)
    app.exit(1)
  },
)
