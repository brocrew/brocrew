import { sessions, runtime, installRuntimeScreenFixture, disposeRuntimeScreenFixture } from './runtime-screen-fixture'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import { mount, META, permission } from './harness'
const { default: RuntimeScreen } = await import('../../src/renderer/src/components/RuntimeScreen.vue')
const original = { width: innerWidth, height: innerHeight }
beforeEach(installRuntimeScreenFixture)
afterEach(async () => { disposeRuntimeScreenFixture(); document.documentElement.style.removeProperty('--app-min-w'); await page.viewport(original.width, original.height) })
const command = 'if (Test-Path C:\\fictional\\permissions-check.txt) { "EXISTS" } else { [IO.File]::WriteAllText("C:\\fictional\\permissions-check.txt", "RC20-PERMISSION"); [IO.File]::ReadAllText("C:\\fictional\\permissions-check.txt") }'
const event = { ...permission('narrow-permission'), action: 'PowerShell', detail: command }
const r = (e: Element) => { const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }
function measure(host: HTMLElement, w: number) {
  const de = document.documentElement
  const all = [...host.querySelectorAll<HTMLElement>('*')]
  const past = all.filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > w + 1 && getComputedStyle(e).position !== 'fixed' })
  const cards = [...host.querySelectorAll('.permission-card')]
  const cmds = [...host.querySelectorAll<HTMLElement>('.command-block')]
  const before = scrollX; scrollTo(99999, 0); const maxScrollX = scrollX; scrollTo(before, 0)
  return {
    viewport: w, docScrollW: de.scrollWidth, docClientW: de.clientWidth, bodyScrollW: document.body.scrollWidth, maxScrollX,
    hostScrollW: host.scrollWidth, frame: r(host.querySelector('.app')!), main: r(host.querySelector('.main')!),
    rail: host.querySelector('[data-cy="rail"],.rail') ? r(host.querySelector('[data-cy="rail"],.rail')!) : null,
    pastViewport: past.slice(0, 12).map(e => ({ tag: e.tagName, cy: e.dataset.cy, cls: String(e.className).slice(0, 60), box: r(e) })),
    cards: cards.map(r),
    commands: cmds.map(c => ({ box: r(c), scrollW: c.scrollWidth, clientW: c.clientWidth, text: c.textContent!.trim().slice(0, 40), whiteSpace: getComputedStyle(c).whiteSpace, overflowX: getComputedStyle(c).overflowX,
      insideCard: cards.some(k => { const a = c.getBoundingClientRect(), b = k.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 }) })),
    buttons: [...host.querySelectorAll<HTMLElement>('button')].filter(b => b.getBoundingClientRect().width > 0 && (b.closest('.permission-card') || b.closest('.waiting-on-you,[data-cy="waiting-on-you"]'))).map(b => ({ t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 28), ...r(b), inView: b.getBoundingClientRect().right <= w + 0.5 })),
  }
}
async function settle() { await nextTick(); await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res()))) }
const ident = () => ({ ua: navigator.userAgent, dpr: devicePixelRatio, body: getComputedStyle(document.body).fontFamily, fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight).slice(0, 20) })
async function scenario(label: string, w: number, minW: string | null, queue: boolean, collapsed: boolean) {
  await page.viewport(w, 900)
  if (minW) document.documentElement.style.setProperty('--app-min-w', minW); else document.documentElement.style.removeProperty('--app-min-w')
  runtime.attachOpen.mockResolvedValueOnce([{ ...META, sessionId: 'fictional-narrow', handover: 'attached', history: { entries: [{ ordinal: 0, at: Date.now(), event }], from: 0, hasOlder: false, turnAligned: true } }])
  await sessions.attachOpen()
  const m = mount(RuntimeScreen, {}, { width: w, height: 900 }); m.host.id = 'app'
  await expect.poll(() => m.all('permission-card').length).toBeGreaterThan(0)
  await settle()
  if ((m.q('side-rail').dataset.collapsed === 'true') !== collapsed) { m.q('rail-fold').click(); await settle() }
  if (queue) { m.q('rail-waiting').click(); await expect.poll(() => m.all('waiting-on-you').length).toBeGreaterThan(0); await settle() }
  console.log('GEOMETRY ' + label + ' ' + JSON.stringify(measure(m.host, w)))
  await page.screenshot({ path: '__screenshots__/w7125-' + label + '.png' })
  m.unmount()
}
it('W7125 proof', async () => {
  console.log('IDENT ' + JSON.stringify(ident()))
  for (const [phase, minW] of [['before1180', '1180px'], ['after800', null]] as const)
    for (const collapsed of [false, true])
      for (const queue of [false, true])
        await scenario(`${phase}-${queue ? 'queue' : 'conv'}-${collapsed ? 'collapsed' : 'open'}-800`, 800, minW, queue, collapsed)
  for (const queue of [false, true]) await scenario(`after800-wide1280-${queue ? 'queue' : 'conv'}-open`, 1280, null, queue, false)
})
