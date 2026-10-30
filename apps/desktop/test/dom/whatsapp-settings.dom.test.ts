import { afterEach, expect, it, vi } from 'vitest'
import html from '../../../../plugins/whatsapp/ui/index.html?raw'
import script from '../../../../plugins/whatsapp/ui/app.js?raw'
import css from '../../../../plugins/whatsapp/ui/style.css?raw'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
})

async function settingsPage() {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width: 1200px; height: 900px; border: 0'
  const fixture = `
    window.fixture = {
      requests: [], hold: true, fail: false, refresh: null,
      snapshot: {
        configRevision: 0,
        status: { state: 'linked', account: 'Fictional phone', qr: null },
        read: false, prefix: true,
        groups: [
          { jid: '120363000000000001@g.us', name: 'Zulu Team', canWrite: false },
          { jid: '120363000000000002@g.us', name: 'Birch Club', canWrite: true },
          { jid: '120363000000000003@g.us', name: 'ATLAS Team', canWrite: false },
          { jid: '120363000000000004@g.us', name: 'amber Club', canWrite: true }
        ]
      }
    }
    const answer = (packet, ok = true) => window.postMessage({ channel: packet.channel, requestId: packet.requestId, ok, data: packet.method === 'read' ? window.fixture.snapshot : {} }, location.origin)
    window.addEventListener('message', (event) => {
      const packet = event.data
      if (packet?.channel !== 'brocrew-plugin-ui:v1' || typeof packet.ok === 'boolean') return
      window.fixture.requests.push(packet)
      if (packet.payload?.action === 'refresh-groups') {
        window.fixture.refresh = packet
        if (window.fixture.hold) return
        answer(packet, !window.fixture.fail)
      } else if (packet.method === 'proposeConfig') {
        if (packet.payload.action === 'set-group-write') window.fixture.snapshot.groups.find((g) => g.jid === packet.payload.group).canWrite = packet.payload.enabled
        answer(packet)
      } else answer(packet)
    })
    document.addEventListener('finish-refresh', () => answer(window.fixture.refresh, !window.fixture.fail))
  `
  const source = html
    .replace('<link rel="stylesheet" href="style.css" />', `<style>${css}</style>`)
    .replace(
      '<script type="module" src="app.js"></script>',
      `<script>${fixture}</script><script>${script}</script>`,
    )
  const url = URL.createObjectURL(new Blob([source], { type: 'text/html' }))
  const loaded = new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => resolve(), { once: true })
    frame.addEventListener('error', () => reject(new Error('Settings iframe did not load')), {
      once: true,
    })
  })
  frame.src = url
  document.body.append(frame)
  cleanup.push(() => {
    frame.remove()
    URL.revokeObjectURL(url)
  })
  await loaded
  await vi.waitFor(() =>
    expect(frame.contentDocument?.querySelectorAll('.group-name')).toHaveLength(4),
  )
  const doc = frame.contentDocument!
  const fixtureState = (
    frame.contentWindow as unknown as {
      fixture: {
        requests: Array<{ method: string; payload: { action?: string; enabled?: boolean } }>
        fail: boolean
        snapshot: { groups: Array<{ jid: string; name: string; canWrite: boolean }> }
      }
    }
  ).fixture
  const filter = doc.querySelector<HTMLInputElement>('#group-filter')!
  const names = () => [...doc.querySelectorAll('.group-name')].map((node) => node.textContent)
  const search = (value: string) => {
    filter.value = value
    filter.dispatchEvent(new Event('input'))
  }
  const refresh = doc.querySelector<HTMLButtonElement>('#refresh-groups')!
  return { doc, fixture: fixtureState, names, search, refresh }
}

it('filters names without case, keeps writing groups first and sorts each part by name', async () => {
  const p = await settingsPage()
  expect(p.names()).toEqual(['amber Club', 'Birch Club', 'ATLAS Team', 'Zulu Team'])
  p.search('tEaM')
  expect(p.names()).toEqual(['ATLAS Team', 'Zulu Team'])
  p.search('120363')
  expect(p.names()).toEqual([])
  p.search('no such group')
  expect(p.names()).toEqual([])
  p.search('')
  expect(p.names()).toHaveLength(4)
  const switches = p.doc.querySelectorAll<HTMLInputElement>('#groups input')
  const atlas = switches[2]!
  atlas.checked = true
  atlas.dispatchEvent(new Event('change'))
  await vi.waitFor(() =>
    expect(p.names()).toEqual(['amber Club', 'ATLAS Team', 'Birch Club', 'Zulu Team']),
  )
  const main = p.doc.querySelector('main')!.getBoundingClientRect()
  expect(main.width).toBe(p.doc.documentElement.clientWidth)
})

it('waits for a slow iframe load before checking its initial groups', async () => {
  const append = document.body.append.bind(document.body)
  let timer: ReturnType<typeof setTimeout> | undefined
  const delayed = vi.spyOn(document.body, 'append').mockImplementationOnce((...nodes) => {
    timer = setTimeout(() => append(...nodes), 1200)
  })
  try {
    const p = await settingsPage()
    expect(p.names()).toEqual(['amber Club', 'Birch Club', 'ATLAS Team', 'Zulu Team'])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    delayed.mockRestore()
  }
})

it('refreshes through the bridge action without blocking the page, then keeps the filter and writing choices', async () => {
  const p = await settingsPage()
  p.search('team')
  p.refresh.click()
  await vi.waitFor(() =>
    expect(p.fixture.requests.some((r) => r.payload?.action === 'refresh-groups')).toBe(true),
  )
  expect(p.refresh.textContent).toBe('Refreshing…')
  expect(p.refresh.disabled).toBe(true)
  p.search('club')
  expect(p.names()).toEqual(['amber Club', 'Birch Club'])
  const read = p.doc.querySelector<HTMLInputElement>('#read')!
  expect(read.disabled).toBe(false)
  read.checked = true
  read.dispatchEvent(new Event('change'))
  await vi.waitFor(() =>
    expect(
      p.fixture.requests.some(
        (r) => r.payload?.action === 'set-read' && r.payload.enabled === true,
      ),
    ).toBe(true),
  )
  expect(p.doc.querySelector<HTMLInputElement>('#groups input')!.disabled).toBe(false)
  p.refresh.click()
  expect(p.fixture.requests.filter((r) => r.payload?.action === 'refresh-groups')).toHaveLength(1)
  p.fixture.snapshot.groups.push({
    jid: '120363000000000005@g.us',
    name: 'Cedar Club',
    canWrite: false,
  })
  p.doc.dispatchEvent(new Event('finish-refresh'))
  await vi.waitFor(() => expect(p.refresh.textContent).toBe('Refresh'))
  expect(p.refresh.disabled).toBe(false)
  expect(p.names()).toEqual(['amber Club', 'Birch Club', 'Cedar Club'])
  expect(
    [...p.doc.querySelectorAll<HTMLInputElement>('#groups input')].map((input) => input.checked),
  ).toEqual([true, true, false])
})

it('ends the refreshing state after a failure and leaves the last list usable', async () => {
  const p = await settingsPage()
  p.fixture.fail = true
  p.refresh.click()
  await vi.waitFor(() =>
    expect(p.fixture.requests.some((r) => r.payload?.action === 'refresh-groups')).toBe(true),
  )
  p.doc.dispatchEvent(new Event('finish-refresh'))
  await vi.waitFor(() => expect(p.refresh.disabled).toBe(false))
  expect(p.refresh.textContent).toBe('Refresh')
  expect(p.doc.querySelector('#status')!.textContent).toBe('Plugin unavailable. Try again.')
  p.search('atlas')
  expect(p.names()).toEqual(['ATLAS Team'])
})

it('keeps reading and the robot prefix above a short list with its controls outside the scroll', async () => {
  const p = await settingsPage()
  const top = (selector: string) => p.doc.querySelector(selector)!.getBoundingClientRect().top
  expect(top('#status')).toBeLessThan(top('#unlink'))
  expect(top('#unlink')).toBeLessThan(top('#read'))
  expect(top('#read')).toBeLessThan(top('#prefix'))
  expect(top('#prefix')).toBeLessThan(top('h2'))
  expect(top('h2')).toBeLessThan(top('#group-filter'))
  expect(top('#group-filter')).toBeLessThan(top('#groups'))
  p.fixture.snapshot.groups.push(
    ...Array.from({ length: 60 }, (_, i) => ({
      jid: `120363000000001${String(i).padStart(3, '0')}@g.us`,
      name: `Fictional group ${i}`,
      canWrite: false,
    })),
  )
  p.refresh.click()
  await vi.waitFor(() =>
    expect(p.fixture.requests.some((r) => r.payload?.action === 'refresh-groups')).toBe(true),
  )
  p.doc.dispatchEvent(new Event('finish-refresh'))
  await vi.waitFor(() => expect(p.names()).toHaveLength(64))
  const list = p.doc.querySelector<HTMLElement>('#groups')!
  expect(list.clientHeight).toBeLessThanOrEqual(320)
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
  expect(p.doc.defaultView!.getComputedStyle(list).overflowY).toBe('auto')
  const filterTop = top('#group-filter')
  const refreshTop = top('#refresh-groups')
  list.scrollTop = 200
  expect(list.scrollTop).toBe(200)
  expect(top('#group-filter')).toBe(filterTop)
  expect(top('#refresh-groups')).toBe(refreshTop)
  const zulu = [...list.querySelectorAll('li')]
    .find((li) => li.textContent!.includes('Zulu Team'))!
    .querySelector('input')!
  zulu.checked = true
  zulu.dispatchEvent(new Event('change'))
  await vi.waitFor(() =>
    expect(p.names().slice(0, 3)).toEqual(['amber Club', 'Birch Club', 'Zulu Team']),
  )
  const birch = [...list.querySelectorAll('li')]
    .find((li) => li.textContent!.includes('Birch Club'))!
    .querySelector('input')!
  birch.checked = false
  birch.dispatchEvent(new Event('change'))
  await vi.waitFor(() =>
    expect(p.names().slice(0, 4)).toEqual(['amber Club', 'Zulu Team', 'ATLAS Team', 'Birch Club']),
  )
})
