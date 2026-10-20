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
    replaceChildren(...nodes: Element[]) {
      this.children = nodes
    }
    addEventListener(type: string, callback: (event: unknown) => void) {
      this.listeners.set(type, callback)
    }
    checkValidity() {
      return true
    }
  }
  const nodes = new Map(
    ['#status', '#profiles', '#tabs', '#create', '#name'].map((id) => [id, new Element()]),
  )
  const events = new Map<string, (event: unknown) => void>()
  const packets: Record<string, unknown>[] = []
  const origin = 'brocrew-plugin://fictional-view'
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
    setInterval: () => 1,
    clearInterval() {},
  })
  return {
    nodes,
    events,
    packets,
    reply(result: unknown, source: unknown = window) {
      events.get('message')!({
        source,
        origin,
        data: {
          channel: 'brocrew-plugin-ui:v1',
          requestId: packets[0].requestId,
          ok: true,
          data: result,
        },
      })
    },
  }
}
it('uses only bounded DOM RPC, displays current windows/tabs as text, and proposes opening without a login state', async () => {
  const view = screen()
  expect(view.packets).toEqual([
    {
      channel: 'brocrew-plugin-ui:v1',
      requestId: '1',
      method: 'read',
      payload: { surface: 'chrome' },
      configRevision: 0,
    },
  ])
  const snapshot = {
    configRevision: 3,
    profiles: [{ name: 'fern', enabled: true, open: true }],
    tabs: [
      { profile: 'fern', title: '<script>fictional</script>', url: 'https://fictional.invalid/' },
    ],
  }
  view.reply(snapshot, {})
  await Promise.resolve()
  expect(view.nodes.get('#profiles')!.children).toHaveLength(0)
  view.reply(snapshot)
  await Promise.resolve()
  await Promise.resolve()
  const row = view.nodes.get('#profiles')!.children[0]
  expect(row.dataset.profile).toBe('fern')
  const heading = row.children[0]
  expect(heading.children.slice(0, 2).map((child) => child.textContent)).toEqual(['fern', 'Open'])
  const actions = heading.children[2]
  expect(actions.children.map((child) => child.textContent)).toEqual(['Disable', 'Open window'])
  expect(row.children[1].textContent).toBe('Open tabs')
  const tab = row.children[2].children[0]
  expect(tab.children.map((child) => child.textContent)).toEqual([
    '<script>fictional</script>',
    'https://fictional.invalid/',
  ])
  actions.children[1].listeners.get('click')!({})
  expect(view.packets.at(-1)).toEqual({
    channel: 'brocrew-plugin-ui:v1',
    requestId: '2',
    method: 'proposeConfig',
    payload: { action: 'open-window', profile: 'fern' },
    configRevision: 3,
  })
  expect(view.packets.every((packet) => !JSON.stringify(packet).includes('Token'))).toBe(true)
  view.events.get('pagehide')!({})
})
it('shows the reviewed empty-profile message', async () => {
  const view = screen()
  view.reply({ configRevision: 0, profiles: [], tabs: [] })
  await Promise.resolve()
  await Promise.resolve()
  expect(view.nodes.get('#profiles')!.children[0].textContent).toBe(
    'No profiles yet. Create one to get started.',
  )
})
