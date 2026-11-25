import { sessions, runtime, installRuntimeScreenFixture, disposeRuntimeScreenFixture } from './runtime-screen-fixture'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
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

// ---- follow-up: the agent drawer, closed and reopened through the visible person-facing control ----
const hit = (el: Element) => { const b = el.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const top = document.elementFromPoint(x, y); return { x: +x.toFixed(1), y: +y.toFixed(1), reaches: !!top && (top === el || el.contains(top)), topTag: top ? top.tagName + '.' + String(top.className).slice(0, 40) : null } }
function drawerFacts(host: HTMLElement, w: number, name: string) {
  const toggle = host.querySelector<HTMLElement>('[data-cy="toggle-session-panel"]')
  const drawer = host.querySelector<HTMLElement>('[data-cy="session-drawer"]')
  const card = host.querySelector('.permission-card')
  const cmd = host.querySelector<HTMLElement>('.command-block')
  const btns = card ? [...card.querySelectorAll<HTMLElement>('button')].filter(b => b.getBoundingClientRect().width > 0) : []
  const tb = toggle ? toggle.getBoundingClientRect() : null
  return {
    name, viewport: w, docScrollW: document.documentElement.scrollWidth,
    toggle: toggle ? { label: toggle.getAttribute('aria-label'), title: toggle.getAttribute('title'), pressed: toggle.getAttribute('aria-pressed'), box: r(toggle), inViewport: tb!.right <= w && tb!.left >= 0, hit: hit(toggle) } : null,
    drawer: drawer ? { box: r(drawer), position: getComputedStyle(drawer).position } : null,
    cardCount: host.querySelectorAll('.permission-card').length, card: card ? r(card) : null,
    command: cmd ? { box: r(cmd), scrollW: cmd.scrollWidth, clientW: cmd.clientWidth, scrollH: cmd.scrollHeight, clientH: cmd.clientHeight, fullText: cmd.textContent!.replace(/\s+/g, ' ').trim() === command.replace(/\s+/g, ' ').trim(), hit: hit(cmd), inCard: !!card && cmd.getBoundingClientRect().right <= card.getBoundingClientRect().right + 0.5 } : null,
    controls: btns.map(b => ({ t: (b.textContent || '').trim().slice(0, 12), box: r(b), inViewport: b.getBoundingClientRect().right <= w + 0.5, hit: hit(b) })),
  }
}
async function drawerScenario(collapsed: boolean) {
  const w = 800, rail = collapsed ? 'collapsed' : 'open'
  await page.viewport(w, 900); document.documentElement.style.removeProperty('--app-min-w')
  runtime.attachOpen.mockResolvedValueOnce([{ ...META, sessionId: 'fictional-narrow', handover: 'attached', history: { entries: [{ ordinal: 0, at: Date.now(), event }], from: 0, hasOlder: false, turnAligned: true } }])
  await sessions.attachOpen()
  const m = mount(RuntimeScreen, {}, { width: w, height: 900 }); m.host.id = 'app'
  await expect.poll(() => m.all('permission-card').length).toBeGreaterThan(0)
  await settle()
  if ((m.q('side-rail').dataset.collapsed === 'true') !== collapsed) { m.q('rail-fold').click(); await settle() }
  const press = async (step: string, shot: string) => {
    // A real pointer click through the browser on the visible control, the repo's userEvent.click, not element.click().
    await userEvent.click(m.q('toggle-session-panel')); await settle()
    console.log('DRAWER ' + rail + ' ' + step + ' ' + JSON.stringify(drawerFacts(m.host, w, step)))
    await page.screenshot({ path: '__screenshots__/w7125-drawer-' + rail + '-' + shot + '.png' })
  }
  const pressedNow = () => m.q('toggle-session-panel').getAttribute('aria-pressed')
  let pref: string | null = null; try { pref = localStorage.getItem('brobot2.drawerOpen') } catch { pref = 'unreadable' }
  console.log('DRAWER ' + rail + ' fresh-state ' + JSON.stringify({ storedPreference: pref, pressed: pressedNow() }))
  expect(pressedNow()).toBe('true') // the genuine default-open state, or this scenario is not what it says it is
  console.log('DRAWER ' + rail + ' 0-initial ' + JSON.stringify(drawerFacts(m.host, w, '0-initial')))
  await page.screenshot({ path: '__screenshots__/w7125-drawer-' + rail + '-0-initial-open.png' })
  await press('1-closed-by-click', '1-closed'); expect(pressedNow()).toBe('false')
  await press('2-reopened-by-click', '2-reopened'); expect(pressedNow()).toBe('true')
  await press('3-closed-again-by-click', '3-closed-again'); expect(pressedNow()).toBe('false')
  m.unmount()
}
// One test per rail state: beforeEach/afterEach reset the fixture, so the persisted drawer preference
// (brobot2.drawerOpen) of one scenario can never leak into the next.
it('W7125 drawer follow-up, rail open', async () => { await drawerScenario(false) })
it('W7125 drawer follow-up, rail collapsed', async () => { await drawerScenario(true) })
