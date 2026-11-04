import fs from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'
function screen() {
  class Element {
    textContent = ''
    dataset: Record<string, string> = {}
    get childElementCount() {
      return this.children.length
    }
    children: Element[] = []
    listeners = new Map<string, (event: unknown) => void>()
    value = 'fern'
    append(...nodes: Element[]) {
      this.children.push(...nodes)
    }
    prepend(...nodes: Element[]) {
      this.children.unshift(...nodes)
    }
    replaceChildren(...nodes: Element[]) {
      this.children = nodes
    }
    addEventListener(type: string, callback: (event: unknown) => void) {
      this.listeners.set(type, callback)
    }
    checkValidity() {
      return true
    }
    focus() {}
    select() {}
  }
  const nodes = new Map(
    ['#status', '#profiles', '#tabs', '#create', '#name'].map((id) => [id, new Element()]),
  )
  const events = new Map<string, (event: unknown) => void>()
  const packets: Record<string, unknown>[] = []
  const origin = 'brocrew-plugin://fictional-view'
  let interval = () => {}
  const window = {
    addEventListener: (type: string, callback: (event: unknown) => void) =>
      events.set(type, callback),
    postMessage: (packet: Record<string, unknown>, target: string) => {
      expect(target).toBe(origin)
      packets.push(packet)
    },
  }
  vm.runInNewContext(fs.readFileSync('plugins/chrome/ui/app.js', 'utf8'), {
    window,
    location: { origin },
    document: { querySelector: (id: string) => nodes.get(id), createElement: () => new Element() },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: (callback: () => void) => {
      interval = callback
      return 1
    },
    clearInterval() {},
    CSS: { escape: (value: string) => value },
  })
  return {
    nodes,
    events,
    packets,
    tick: () => interval(),
    reply(result: unknown, source: unknown = window, packet = packets[0], ok = true) {
      events.get('message')!({
        source,
        origin,
        data: {
          channel: 'brocrew-plugin-tools:v1',
          requestId: packet.requestId,
          ok,
          data: result,
        },
      })
    },
  }
}

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
it('Configure page unwraps the generic result and sends explicit named MCP actions', async () => {
  const view = screen()
  expect(view.packets[0]).toEqual({
    channel: 'brocrew-plugin-tools:v1',
    requestId: '1',
    method: 'callTool',
    params: { tool: 'configuration_snapshot', arguments: {} },
  })
  view.reply({
    status: 'result',
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            configRevision: 0,
            profiles: [{ name: 'fern', enabled: true, open: true }],
            tabs: [],
          }),
        },
      ],
    },
  })
  await settle()
  const row = view.nodes.get('#profiles')!.children[0]
  expect(row.dataset.profile).toBe('fern')
  row.children[0].children[2].children[1].listeners.get('click')!({})
  expect(view.packets.at(-1)).toMatchObject({
    method: 'callTool',
    params: { tool: 'configure_profile', arguments: { action: 'open-window', profile: 'fern' } },
  })
})
it.each([
  { status: 'disabled' },
  { status: 'transport-error', message: 'fictional transport failure' },
  { status: 'protocol-error', error: { code: -1, message: 'fictional protocol failure' } },
  {
    status: 'result',
    result: { isError: true, content: [{ type: 'text', text: 'fictional package refusal' }] },
  },
])('Configure page preserves failure for generic reply %j', async (result) => {
  const view = screen()
  view.reply(result)
  await settle()
  expect(view.nodes.get('#profiles')!.children).toHaveLength(0)
  expect(view.nodes.get('#status')!.textContent).toBe('Plugin unavailable. Try again.')
})
