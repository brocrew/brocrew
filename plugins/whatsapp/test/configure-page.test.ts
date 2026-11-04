import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadConfig } from '../src/config.js'
import { startWhatsApp } from '../src/app.js'
import { FakeBridge } from './fakes.js'

class Element {
  hidden = false
  disabled = false
  checked = false
  value = ''
  textContent = ''
  className = ''
  children: unknown[] = []
  listeners = new Map<string, (event: Record<string, unknown>) => unknown>()
  addEventListener(type: string, listener: (event: Record<string, unknown>) => unknown) {
    this.listeners.set(type, listener)
  }
  setAttribute() {}
  append(...children: unknown[]) {
    this.children.push(...children)
  }
  replaceChildren() {
    this.children = []
  }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('fictional page timed out')
}

it('Configure uses ordinary MCP results for reads and switches, and displays tool failures', async () => {
  const home = fs.mkdtempSync(
    path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'fictional-whatsapp-page-'),
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const bridge = new FakeBridge()
  bridge.groupList = []
  const app = await startWhatsApp(loadConfig({ BROCREW_PLUGIN_DATA: home }), {
    bridge,
    transport: serverTransport,
  })
  const client = new Client({ name: 'fictional-configure-host', version: '1' })
  const elements = new Map<string, Element>()
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)!
  }
  const listeners = new Map<string, (event: unknown) => void>()
  const packets: Array<{
    channel: string
    method: string
    params: { tool: string; arguments: Record<string, unknown> }
    requestId: string
  }> = []
  const origin = 'brocrew-plugin://fictional'
  const window = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, listener)
    },
    postMessage(packet: (typeof packets)[number], target: string) {
      expect(target).toBe(origin)
      packets.push(packet)
      void client
        .callTool({
          name: packet.params.tool,
          arguments: packet.params.arguments,
          _meta: {
            workspaceId: 'fictional-workspace',
            requestId: packet.requestId,
            origin: 'settings.page',
          },
        })
        .then((data) => {
          listeners.get('message')?.({
            source: window,
            origin,
            data: {
              channel: packet.channel,
              requestId: packet.requestId,
              ok: true,
              data: { status: 'result', result: data },
            },
          })
        })
    },
  }
  try {
    await client.connect(clientTransport)
    vm.runInNewContext(fs.readFileSync('plugins/whatsapp/ui/app.js', 'utf8'), {
      window,
      location: { origin },
      document: {
        querySelector: (selector: string) => element(selector.slice(1)),
        createElement: () => new Element(),
        addEventListener() {},
      },
      setInterval: () => 1,
      clearInterval() {},
      setTimeout,
      clearTimeout,
    })
    await until(() => element('status').textContent === 'Linked.')
    expect(packets[0]).toEqual({
      channel: 'brocrew-plugin-tools:v1',
      method: 'callTool',
      requestId: '1',
      params: { tool: 'whatsapp_settings', arguments: {} },
    })
    expect(element('read').checked).toBe(false)
    element('read').listeners.get('change')?.({ target: { checked: true } })
    await until(() => element('read').checked)
    expect(app.settings.get().read).toBe(true)
    expect(
      packets.some(
        (packet) =>
          packet.params.tool === 'whatsapp_set_read' && packet.params.arguments.enabled === true,
      ),
    ).toBe(true)
    bridge.refreshGroups = async () => {
      throw new Error('fictional failure')
    }
    await element('refresh-groups').listeners.get('click')?.({})
    expect(element('status').textContent).toBe('Plugin unavailable. Try again.')
    expect(bridge.unlinked).toBe(0)
  } finally {
    listeners.get('pagehide')?.({})
    await client.close()
    await app.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
