import { afterEach, expect, it, vi } from 'vitest'
import chromeHtml from '../../../../plugins/chrome/ui/index.html?raw'
import chromeScript from '../../../../plugins/chrome/ui/app.js?raw'
import chromeCss from '../../../../plugins/chrome/ui/style.css?raw'
import whatsappHtml from '../../../../plugins/whatsapp/ui/index.html?raw'
import whatsappScript from '../../../../plugins/whatsapp/ui/app.js?raw'
import whatsappCss from '../../../../plugins/whatsapp/ui/style.css?raw'
import loadScript from '../../../../plugins/shared/ui/settings-load-state.js?raw'
import loadCss from '../../../../plugins/shared/ui/settings-load-state.css?raw'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
})

const pages = [
  {
    name: 'Chrome',
    html: chromeHtml,
    script: chromeScript,
    css: chromeCss,
    content: '#profiles, #create',
    empty: '.profiles-empty',
    snapshot: { configRevision: 0, profiles: [], tabs: [] },
  },
  {
    name: 'WhatsApp',
    html: whatsappHtml,
    script: whatsappScript,
    css: whatsappCss,
    content: 'main > section',
    empty: '#groups .empty',
    snapshot: {
      configRevision: 0,
      status: { state: 'unlinked', account: '', qr: null },
      read: false,
      prefix: true,
      groups: [],
    },
  },
]

async function settingsPage(page: (typeof pages)[number]) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width: 1000px; height: 800px; border: 0'
  const fixture = `
    window.fixture = { requests: [] }
    window.addEventListener('message', ({ data: packet }) => {
      if (packet?.channel === 'brocrew-plugin-ui:v1' && typeof packet.ok !== 'boolean')
        window.fixture.requests.push(packet)
    })
    document.addEventListener('fixture-answer', ({ detail }) => window.postMessage({
      channel: 'brocrew-plugin-ui:v1', requestId: window.fixture.requests.at(-1).requestId,
      ...detail,
    }, location.origin))
  `
  const source = page.html
    .replace('<link rel="stylesheet" href="style.css" />', `<style>${page.css}</style>`)
    .replace(
      '<link rel="stylesheet" href="settings-load-state.css" />',
      `<style>${loadCss}</style>`,
    )
    .replace('<script src="settings-load-state.js"></script>', `<script>${loadScript}</script>`)
    .replace(
      '<script type="module" src="app.js"></script>',
      `<script>${fixture}</script><script>${page.script}</script>`,
    )
  const url = URL.createObjectURL(new Blob([source], { type: 'text/html' }))
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener('load', () => resolve(), { once: true }),
  )
  frame.src = url
  document.body.append(frame)
  cleanup.push(() => {
    frame.contentWindow?.dispatchEvent(new Event('pagehide'))
    frame.remove()
    URL.revokeObjectURL(url)
  })
  await loaded
  const win = frame.contentWindow!
  const requests = (win as unknown as { fixture: { requests: Array<{ requestId: string }> } })
    .fixture.requests
  await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
  const doc = frame.contentDocument!
  const contentVisible = () =>
    [...doc.querySelectorAll<HTMLElement>(page.content)].some(
      (node) => node.getBoundingClientRect().height > 0,
    )
  const answer = (data: unknown, ok = true) => {
    doc.dispatchEvent(new CustomEvent('fixture-answer', { detail: { ok, data } }))
  }
  return { doc, answer, contentVisible }
}

for (const page of pages) {
  it(`${page.name} waits for data, shows a read error, then reveals a genuinely empty list`, async () => {
    const p = await settingsPage(page)
    expect(p.doc.querySelector('#status')!.textContent?.trim()).toBe('Loading…')
    expect(p.doc.querySelector('#status')!.getAttribute('aria-busy')).toBe('true')
    expect(p.contentVisible()).toBe(false)
    expect(p.doc.querySelector(page.empty)).toBeNull()
    p.answer(undefined, false)
    await vi.waitFor(() =>
      expect(p.doc.querySelector('#status')!.textContent).toBe('Plugin unavailable. Try again.'),
    )
    expect(p.contentVisible()).toBe(false)
    expect(p.doc.querySelector(page.empty)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 1600))
    p.answer(page.snapshot)
    await vi.waitFor(() => expect(p.doc.querySelector(page.empty)).not.toBeNull())
    expect(p.contentVisible()).toBe(true)
    expect(p.doc.querySelector('#status')!.getAttribute('aria-busy')).toBe('false')
  })
}
