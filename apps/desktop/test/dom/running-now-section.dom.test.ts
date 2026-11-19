import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import { screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { createTranscript } from '../../src/renderer/src/lib/transcript'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import type { KeptFile } from '../../src/shared/runtime-ipc'
import { META, drawerProps, mount, unmountAll, visible } from './harness'
import { idlePanel, OWNER } from './sub-agents-idle-fixture'
import { memoryStorage } from './memory-storage'
import { drawnReady } from './drawn'

const KEY = 'brobot2.cardRunningNowFolded'
const viewport = { width: innerWidth, height: innerHeight }
let storage: Storage
let chatTheme: string | null

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  chatTheme = document.documentElement.getAttribute('data-chat-theme')
  applyTheme(null)
  document.documentElement.setAttribute('data-chat-theme', 'light')
})
afterEach(async () => {
  unmountAll()
  vi.unstubAllGlobals()
  screenFacts().update({ reading: null, railSays: null, cardFiles: null })
  if (chatTheme === null) document.documentElement.removeAttribute('data-chat-theme')
  else document.documentElement.setAttribute('data-chat-theme', chatTheme)
  await page.viewport(viewport.width, viewport.height)
})

function panel() {
  const scene = idlePanel(1)
  const file: KeptFile = {
    resourceId: 'fictional-map-notes', name: 'map-notes.md', title: 'Map notes', form: 'markdown',
    bytes: 240, role: 'made', keptAt: 1800000000000, sha256: 'b'.repeat(64),
    addedBy: { conversation: OWNER, name: 'Map editor', identity: 'map-editor' },
    piece: 'fictional-map-task', label: 'W95', pieceTitle: 'Read the map',
  }
  screenFacts().update({
    reading: scene.reading,
    railSays: scene.rail(),
    cardFiles: { conversation: OWNER, files: [file], answered: true },
  })
  const state = createTranscript()
  state.background.running = [{ id: 'map-check', kind: 'shell', description: 'Check the map' }]
  mount(IconSprite, {})
  return mount(SessionDrawer, drawerProps({
    session: { ...META, sessionId: OWNER }, state, identities: scene.identities,
  }), { width: 400, height: 1000 })
}

it('keeps the running count on a saved fold and leaves agent information visible', async () => {
  const view = panel()
  const run = view.q('panel-agents')
  const button = run.querySelector<HTMLButtonElement>('.head > button')
  expect(button, 'Running now has no shared collapse control').not.toBeNull()
  expect(button!.textContent).toContain('Running now')
  expect(button!.textContent).toContain('(1)')
  button!.click()
  await nextTick()
  expect(visible(view.q('running-now-rows'))).toBe(false)
  expect(visible(view.q('session-bot'))).toBe(true)
  expect(visible(view.q('card-open-inputs'))).toBe(true)
  expect(visible(view.q('card-files'))).toBe(true)
  expect(storage.getItem(KEY)).toBe('true')
  const saved = storage.getItem(KEY)!
  unmountAll()
  storage = memoryStorage()
  storage.setItem(KEY, saved)
  vi.stubGlobal('localStorage', storage)
  const again = panel()
  expect(visible(again.q('running-now-rows'))).toBe(false)
  again.q('panel-agents').querySelector<HTMLButtonElement>('.head > button')!.click()
  await nextTick()
  expect(visible(again.q('running-now-rows'))).toBe(true)
  expect(storage.getItem(KEY)).toBe('false')
})

it('matches neighboring cards and keeps the instructions-to-first-card spacing', async () => {
  await page.viewport(1180, 1000)
  const view = panel()
  await nextTick()
  await drawnReady()
  const run = view.q('panel-agents')
  const task = view.q('card-task')
  const files = view.q('card-files')
  const started = view.q('cast-sub-agents')
  const style = getComputedStyle(task)
  for (const other of [run, files, started]) {
    const actual = getComputedStyle(other)
    for (const property of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRadius'] as const)
      expect(actual[property], property).toBe(style[property])
  }
  expect(run.getBoundingClientRect().left).toBe(task.getBoundingClientRect().left)
  expect(run.getBoundingClientRect().width).toBe(task.getBoundingClientRect().width)
  const gap = parseFloat(style.marginBottom)
  expect(run.getBoundingClientRect().top - task.getBoundingClientRect().bottom).toBeCloseTo(gap)
  expect(files.getBoundingClientRect().top - run.getBoundingClientRect().bottom).toBeCloseTo(gap)
  const inputs = view.q('card-open-inputs')
  expect(task.getBoundingClientRect().top - inputs.getBoundingClientRect().bottom)
    .toBeCloseTo(parseFloat(getComputedStyle(inputs).marginBottom))
  expect(view.host.querySelector('[data-cy="card-agent"]')).toBeNull()
  if (import.meta.env.VITE_RUNNING_SECTION_CAPTURE)
    await page.screenshot({ element: view.host, path: `${import.meta.env.VITE_RUNNING_SECTION_CAPTURE}/classic-open.png` })
  run.querySelector<HTMLButtonElement>('.head > button')!.click()
  await nextTick()
  await drawnReady()
  expect(visible(view.q('running-now-rows'))).toBe(false)
  if (import.meta.env.VITE_RUNNING_SECTION_CAPTURE)
    await page.screenshot({ element: view.host, path: `${import.meta.env.VITE_RUNNING_SECTION_CAPTURE}/classic-collapsed.png` })
})
