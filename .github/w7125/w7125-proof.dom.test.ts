import { sessions, runtime, walk, installRuntimeScreenFixture, disposeRuntimeScreenFixture } from './runtime-screen-fixture'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { PersonsQuestion, RoutedRequest } from '../../src/shared/question-contracts'
import { chainReading, escalationChain, NOTHING_NAMED_THE_WORK } from '../../src/shared/questions'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
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

// ---- W7.125.3.5: the Waiting on you list bar (date sort, Clear N answered, N new) and the document viewer header ----
// Fictional to-dos, built the way runtime-screen-attention-cases.ts builds one.
function todoQuestion(id: string, at: number, files: { resource: string; name: string }[] = []): PersonsQuestion {
  const request: RoutedRequest = { requestId: id, askedBy: 'fictional-requester', parent: null, went: { is: 'the-person-the-asker-named', to: 'a-person' }, at, state: 'open', endedAt: null, escalatedAt: null }
  const chain = escalationChain(request, () => null)
  return { request, chain, reading: chainReading(chain, () => 'A fictional agent'), sentence: 'An agent asks for a fictional action.', aPersonsSince: at, work: [], about: NOTHING_NAMED_THE_WORK, raisedBy: 'the-provider', offered: null, asked: null, action: { text: (id === 't01' || id === 'n01') ? LONG(id) : 'Do fictional action ' + id + '.', files } }
}
afterEach(() => usePersonsQueue().forget())
const LONG = (id: string) => 'Do fictional action ' + id + ': ' + 'read the whole fictional quarterly report, check every table against the fictional ledger, note each mismatch with its page number, and write a short fictional summary for the team before Friday. '.repeat(3).trim()
const ANSWERED = Array.from({ length: 12 }, (_, i) => 't' + String(i + 1).padStart(2, '0'))
const ARRIVING = Array.from({ length: 10 }, (_, i) => 'n' + String(i + 1).padStart(2, '0'))
const DOC = { resource: 'res_fictional_report', name: 'fictional-quarterly-report-with-a-long-name.md' }
const questionsOf = (ids: string[], base: number, withDoc = false) => ({ ...walk(), ledgers: 1, rows: ids.map((id, i) => todoQuestion(id, base + i, withDoc && i === 0 ? [DOC] : [])) })
function barFacts(host: HTMLElement, w: number) {
  const main = host.querySelector('.main')!.getBoundingClientRect()
  const bar = host.querySelector<HTMLElement>('.list-bar')
  const part = (cy: string) => { const el = host.querySelector<HTMLElement>('[data-cy="' + cy + '"]'); if (!el) return null; const b = el.getBoundingClientRect(); return { text: (el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent : el.textContent)?.trim(), box: r(el), leftInMain: b.left >= main.left - 0.5, rightInViewport: b.right <= w + 0.5, hit: hit(el) } }
  return { viewport: w, docScrollW: document.documentElement.scrollWidth, maxScrollX: (() => { const x = scrollX; scrollTo(99999, 0); const m = scrollX; scrollTo(x, 0); return m })(), main: r(host.querySelector('.main')!), bar: bar ? { box: r(bar), scrollW: bar.scrollWidth, clientW: bar.clientWidth } : null, sort: part('waiting-sort'), clear: part('waiting-clear-answered'), fresh: part('waiting-show-new'), answeredText: [...host.querySelectorAll<HTMLElement>('.todo-answered .todo-what')].map(e => ({ text: e.textContent?.trim(), box: r(e), scrollW: e.scrollWidth, clientW: e.clientWidth, cut: e.scrollWidth > e.clientWidth + 1 })), pastViewport: [...host.querySelectorAll<HTMLElement>('*')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > w + 1 && getComputedStyle(e).position !== 'fixed' }).slice(0, 12).map(e => ({ tag: e.tagName, cy: e.dataset.cy, box: r(e) })) }
}
async function queueBar(w: number, collapsed: boolean, label: string, docOnArrival = false) {
  const live = window.api.runtime as unknown as Record<string, unknown>
  live.answerAction = vi.fn(async () => ({ outcome: 'taken' }))
  live.readResource = vi.fn(async () => ({ ok: true, resourceId: DOC.resource, name: DOC.name, path: '/fictional/kept/' + 'a'.repeat(40) + '/' + DOC.name, form: 'markdown', text: '# Fictional quarterly report\n\nNothing real here.', bytes: 2048 }))
  runtime.questionsForAPerson.mockReset().mockResolvedValue(questionsOf(ANSWERED, 1_000, true))
  await page.viewport(w, 900); document.documentElement.style.removeProperty('--app-min-w')
  const m = mount(RuntimeScreen, {}, { width: w, height: 900 }); m.host.id = 'app'
  await settle()
  if ((m.q('side-rail').dataset.collapsed === 'true') !== collapsed) { m.q('rail-fold').click(); await settle() }
  m.q('rail-waiting').click()
  await expect.poll(() => m.all('waiting-on-you').length).toBeGreaterThan(0)
  await expect.poll(() => usePersonsQueue().todoCards.value.length, { timeout: 10_000 }).toBe(12)
  await userEvent.click(m.q('waiting-pill-todo')); await settle()
  // Answer all twelve through the screen's own door, then let the next look drop them and bring ten arrivals.
  runtime.questionsForAPerson.mockReset().mockResolvedValue(questionsOf(ARRIVING, 5_000, docOnArrival))
  const queue = usePersonsQueue()
  for (const card of [...queue.todoCards.value]) queue.answerTodo(card.row, true, '')
  await expect.poll(() => m.all('waiting-clear-answered')[0]?.textContent?.trim(), { timeout: 15_000 }).toBe('Clear 12 answered')
  await expect.poll(() => m.all('waiting-show-new')[0]?.textContent?.trim(), { timeout: 15_000 }).toBe('10 new')
  await settle()
  console.log('QUEUEBAR ' + label + ' ' + JSON.stringify(barFacts(m.host, w)))
  await page.screenshot({ path: '__screenshots__/w7125-' + label + '.png' })
  return m
}
for (const collapsed of [false, true]) {
  const rail = collapsed ? 'collapsed' : 'open'
  it('W7125 queue bar at 800, rail ' + rail, async () => {
    const m = await queueBar(800, collapsed, 'queuebar-' + rail + '-800')
    // The date sort, changed by the person: the select stays in the bar with its new words.
    // The repo's own pattern for this select (persons-queue.dom.test.ts): set the value, fire change.
    const select = m.q('waiting-sort') as HTMLSelectElement
    select.value = 'newest'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    expect(select.selectedOptions[0]?.textContent).toBe('Newest first')
    console.log('QUEUEBAR queuebar-' + rail + '-800-newest ' + JSON.stringify(barFacts(m.host, 800)))
    await page.screenshot({ path: '__screenshots__/w7125-queuebar-' + rail + '-800-newest.png' })
    usePersonsQueue().forget()
  })
  it('W7125 document viewer at 800, rail ' + rail, async () => {
    const live = window.api.runtime as unknown as Record<string, unknown>
    live.readResource = vi.fn(async () => ({ ok: true, resourceId: DOC.resource, name: DOC.name, path: '/fictional/kept/' + 'a'.repeat(40) + '/' + DOC.name, form: 'markdown', text: '# Fictional quarterly report\n\nNothing real here.', bytes: 2048 }))
    runtime.questionsForAPerson.mockReset().mockResolvedValue(questionsOf(['d01'], 1_000, true))
    await page.viewport(800, 900); document.documentElement.style.removeProperty('--app-min-w')
    const m = mount(RuntimeScreen, {}, { width: 800, height: 900 }); m.host.id = 'app'
    await settle()
    if ((m.q('side-rail').dataset.collapsed === 'true') !== collapsed) { m.q('rail-fold').click(); await settle() }
    m.q('rail-waiting').click()
    await expect.poll(() => usePersonsQueue().todoCards.value.length, { timeout: 10_000 }).toBe(1)
    await userEvent.click(m.q('waiting-pill-todo')); await settle()
    const opener = m.host.querySelector<HTMLElement>('[data-document="' + DOC.resource + '"]')
    expect(opener).not.toBeNull()
    await userEvent.click(opener!)
    await expect.poll(() => document.querySelector('[data-cy="canonical-document-viewer"]') !== null, { timeout: 10_000 }).toBe(true)
    await expect.poll(() => document.querySelector('[data-cy="canonical-document-copy-path"]') !== null, { timeout: 10_000 }).toBe(true)
    await settle()
    const v = document.querySelector<HTMLElement>('[data-cy="canonical-document-viewer"]')!
    const one = (sel: string) => { const el = document.querySelector<HTMLElement>(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 60), box: r(el), scrollW: el.scrollWidth, clientW: el.clientWidth, inViewport: b.left >= -0.5 && b.right <= 800.5, hit: hit(el) } }
    console.log('VIEWER ' + rail + ' ' + JSON.stringify({ viewport: 800, docScrollW: document.documentElement.scrollWidth, insideApp: m.host.contains(v) || document.body.contains(v), viewer: one('[data-cy="canonical-document-viewer"]'), head: one('.viewer-head'), title: one('[data-cy="canonical-document-title"]'), name: one('[data-cy="canonical-document-name"]'), id: one('[data-cy="canonical-document-id"]'), copyPath: one('[data-cy="canonical-document-copy-path"]'), finder: one('[data-cy="canonical-document-finder"]') }))
    await page.screenshot({ path: '__screenshots__/w7125-viewer-' + rail + '-800.png' })
    usePersonsQueue().forget()
  })
}
it('W7125 queue bar, wider 1280 comparison', async () => {
  await queueBar(1280, false, 'queuebar-open-1280')
  usePersonsQueue().forget()
})

// ---- W7.125 repair re-check: the fixed 200px floating Waiting on you corner, with answered to-dos ----
function cornerFacts(w: number) {
  const q = document.querySelector<HTMLElement>('[data-cy="persons-queue"]')
  const body = document.querySelector<HTMLElement>('[data-cy="persons-queue-body"]')
  const band = document.querySelector<HTMLElement>('.overlay-corner')
  return {
    viewport: w, docScrollW: document.documentElement.scrollWidth,
    band: band ? r(band) : null, queue: q ? r(q) : null,
    toggle: (() => { const t = document.querySelector<HTMLElement>('[data-cy="persons-queue-toggle"]'); return t ? { expanded: t.getAttribute('aria-expanded'), box: r(t), hit: hit(t) } : null })(),
    body: body ? { box: r(body), scrollW: body.scrollWidth, clientW: body.clientWidth, scrollH: body.scrollHeight, clientH: body.clientHeight } : null,
    answeredText: q ? [...q.querySelectorAll<HTMLElement>('.todo-answered .todo-what')].map(e => ({ text: e.textContent?.trim(), box: r(e), scrollW: e.scrollWidth, clientW: e.clientWidth, cut: e.scrollWidth > e.clientWidth + 1, insideQueue: e.getBoundingClientRect().right <= q.getBoundingClientRect().right + 0.5 })) : [],
    todoText: q ? [...q.querySelectorAll<HTMLElement>('.todo-what, .todo-lead, .todo-head, .todo-text')].filter(e => e.getBoundingClientRect().width > 0).map(e => { const cs = getComputedStyle(e); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4; return { cls: e.className, start: e.textContent?.trim().slice(0, 40), chars: e.textContent?.trim().length, box: r(e), lines: +(e.clientHeight / lh).toFixed(2), clipped: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1, ellipsis: cs.textOverflow, lineClamp: cs.webkitLineClamp || (cs as any).lineClamp, widthZero: e.clientWidth < 2 } }) : [],
    cards: q ? [...q.querySelectorAll<HTMLElement>('[data-cy^="persons-queue-todo-"]')].filter(e => /^persons-queue-todo-(?!lead-|text-|done-|cant-|open-|said-|head-|more-|note-|dismiss-|add-note-)/.test(e.dataset.cy || '')).map(e => ({ cy: e.dataset.cy, h: +e.getBoundingClientRect().height.toFixed(1) })) : [],
    controls: q ? [...q.querySelectorAll<HTMLElement>('button, a')].filter(b => b.getBoundingClientRect().width > 0).slice(0, 40).map(b => ({ t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30), box: r(b), insideQueue: b.getBoundingClientRect().left >= q.getBoundingClientRect().left - 0.5 && b.getBoundingClientRect().right <= q.getBoundingClientRect().right + 0.5, hit: hit(b) })) : [],
  }
}
for (const [w, collapsed] of [[800, false], [800, true], [1280, false]] as const) {
  const label = 'corner-' + (collapsed ? 'collapsed' : 'open') + '-' + w
  it('W7125 floating corner with answered to-dos, ' + label, async () => {
    const m = await queueBar(w, collapsed, label + '-page', true)
    await userEvent.click(m.q('waiting-show-new')); await settle()
    await expect.poll(() => m.host.querySelector<HTMLElement>('[data-document="' + DOC.resource + '"]'), { timeout: 10_000 }).not.toBeNull()
    await userEvent.click(m.host.querySelector<HTMLElement>('[data-document="' + DOC.resource + '"]')!)
    await expect.poll(() => document.querySelector('[data-cy="persons-queue-toggle"]') !== null, { timeout: 10_000 }).toBe(true)
    await userEvent.click(document.querySelector<HTMLElement>('[data-cy="persons-queue-toggle"]')!); await settle()
    expect(document.querySelector('[data-cy="persons-queue-toggle"]')!.getAttribute('aria-expanded')).toBe('true')
    await expect.poll(() => document.querySelectorAll('[data-cy="persons-queue"] .todo-answered').length, { timeout: 10_000 }).toBeGreaterThan(0)
    await settle()
    console.log('CORNER ' + label + ' ' + JSON.stringify(cornerFacts(w)))
    await page.screenshot({ path: '__screenshots__/w7125-' + label + '.png' })
  })
}
