import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import type { DockLabel, DockLabelChange } from '../../src/shared/dock-label'
import { dockLabelBridge } from '../../look/fixtures/dock-label'
import { mount, unmountAll } from './harness'

/**
 * Settings → General's Dock label row: the workspace's short name and colour on the Dock icon,
 * and its switch. Each change goes to the main process, which saves it and paints the icon.
 */

const computer = vi.hoisted(() => ({ platform: 'MacIntel' }))
vi.mock('../../src/renderer/src/lib/this-computer', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/lib/this-computer')>()),
  platformHere: () => computer.platform,
}))

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
  computer.platform = 'MacIntel'
})

/** The General tab, with a workspace named "Atlas workspace", and every change it sends. */
async function general() {
  const bridge = dockLabelBridge('Atlas workspace')
  const sent: DockLabelChange[] = []
  const set = bridge.set
  bridge.set = async (change) => {
    sent.push(change)
    return set(change)
  }
  const m = mount(
    SettingsScreen,
    { tab: 'general', capabilities: null, warnings: null, clock: Date.now() },
    { width: 1000, height: 700 },
  )
  await vi.waitFor(() => expect(m.q('dock-label-name')).toBeTruthy())
  return { m, sent }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

it('shows the row with its approved words, the workspace’s name and its colour chosen', async () => {
  const { m } = await general()
  const row = m.q('dock-label')
  expect(row.textContent).toContain('Dock label')
  expect(row.textContent).toContain(
    'A short name and colour on the Dock icon, to tell workspaces apart.',
  )
  expect((m.q('dock-label-name') as HTMLInputElement).value).toBe('ATLAS')
  expect((m.q('dock-label-switch') as HTMLInputElement).checked).toBe(true)
  const swatches = [...m.q('dock-label-colours').querySelectorAll('[role="radio"]')]
  expect(swatches.length).toBeGreaterThanOrEqual(6)
  expect(swatches.length).toBeLessThanOrEqual(8)
  expect(swatches.filter((s) => s.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  for (const swatch of swatches) expect(swatch.getAttribute('aria-label')).toMatch(/^[A-Z][a-z]+$/)
})

it('is not shown where there is no Dock', async () => {
  computer.platform = 'Win32'
  dockLabelBridge()
  const m = mount(
    SettingsScreen,
    { tab: 'general', capabilities: null, warnings: null, clock: Date.now() },
    { width: 1000, height: 700 },
  )
  await settle()
  expect(m.host.querySelector('[data-cy="dock-label"]')).toBeNull()
})

it('keeps a typed name to what the band shows, and saves it when it is done', async () => {
  const { m, sent } = await general()
  const name = m.q('dock-label-name') as HTMLInputElement
  name.value = 'cedar 2!'
  name.dispatchEvent(new Event('input'))
  expect(name.value).toBe('CEDAR2')
  name.dispatchEvent(new Event('change'))
  await settle()
  expect(sent).toEqual([{ name: 'CEDAR2' }])
})

it('an emptied name goes back to the workspace’s own', async () => {
  const { m, sent } = await general()
  const name = m.q('dock-label-name') as HTMLInputElement
  name.value = ''
  name.dispatchEvent(new Event('input'))
  name.dispatchEvent(new Event('change'))
  await settle()
  expect(sent).toEqual([{ name: null }])
  expect(name.value).toBe('ATLAS')
})

it('a swatch chooses the colour, by pointer or by arrow keys', async () => {
  const { m, sent } = await general()
  ;(m.q('dock-label-colour-teal') as HTMLButtonElement).click()
  await settle()
  expect(sent).toEqual([{ colour: 'teal' }])
  expect(m.q('dock-label-colour-teal').getAttribute('aria-checked')).toBe('true')
  m.q('dock-label-colour-teal').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  )
  await settle()
  expect(sent).toEqual([{ colour: 'teal' }, { colour: 'blue' }])
  await vi.waitFor(() => expect(document.activeElement).toBe(m.q('dock-label-colour-blue')))
})

it('the switch turns the label off, and hides the name and colours until it is on again', async () => {
  const { m, sent } = await general()
  const toggle = m.q('dock-label-switch') as HTMLInputElement
  toggle.click()
  await settle()
  expect(sent).toEqual([{ on: false }])
  expect(m.host.querySelector('[data-cy="dock-label-name"]')).toBeNull()
  toggle.click()
  await settle()
  expect(sent).toEqual([{ on: false }, { on: true }])
  expect(m.q('dock-label-name')).toBeTruthy()
})

/** A promise the test settles by hand. */
function held<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const ATLAS: DockLabel = {
  on: true,
  name: 'ATLAS',
  colour: 'blue',
  defaults: { name: 'ATLAS', colour: 'blue' },
}

/** The General tab over a bridge the test controls. */
function generalOver(bridge: {
  read: () => Promise<DockLabel>
  set: (change: DockLabelChange) => Promise<DockLabel>
}) {
  ;(window as unknown as { api: Record<string, unknown> }).api = { dockLabel: bridge }
  return mount(
    SettingsScreen,
    { tab: 'general', capabilities: null, warnings: null, clock: Date.now() },
    { width: 1000, height: 700 },
  )
}

const WORDS = "That didn't work. Try again."

it('a late reply to a save does not erase a name typed since', async () => {
  const reply = held<DockLabel>()
  const m = generalOver({
    read: async () => ATLAS,
    set: (change) => (change.colour ? reply.promise : Promise.resolve(ATLAS)),
  })
  await vi.waitFor(() => expect(m.q('dock-label-name')).toBeTruthy())
  ;(m.q('dock-label-colour-teal') as HTMLButtonElement).click()
  const name = m.q('dock-label-name') as HTMLInputElement
  name.value = 'cedar'
  name.dispatchEvent(new Event('input'))
  expect(name.value).toBe('CEDAR')
  reply.resolve({ ...ATLAS, colour: 'teal' })
  await settle()
  expect(name.value).toBe('CEDAR')
  expect(m.q('dock-label-colour-teal').getAttribute('aria-checked')).toBe('true')
})

it('a reply to an older save is ignored once a newer one is out', async () => {
  const first = held<DockLabel>()
  const second = held<DockLabel>()
  let calls = 0
  const m = generalOver({
    read: async () => ATLAS,
    set: () => (++calls === 1 ? first.promise : second.promise),
  })
  await vi.waitFor(() => expect(m.q('dock-label-name')).toBeTruthy())
  ;(m.q('dock-label-colour-teal') as HTMLButtonElement).click()
  ;(m.q('dock-label-colour-pink') as HTMLButtonElement).click()
  second.resolve({ ...ATLAS, colour: 'pink' })
  await settle()
  first.resolve({ ...ATLAS, colour: 'teal' })
  await settle()
  expect(m.q('dock-label-colour-pink').getAttribute('aria-checked')).toBe('true')
  expect(m.q('dock-label-colour-teal').getAttribute('aria-checked')).toBe('false')
})

it('a read that fails says so in a status line, instead of leaving a dead switch with no reason', async () => {
  const read = held<DockLabel>()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const m = generalOver({ read: () => read.promise, set: async () => ATLAS })
  await settle()
  const status = m.q('dock-label-status')
  expect(status.getAttribute('role')).toBe('status')
  expect(status.textContent?.trim()).toBe('')
  read.reject(new Error('fictional: the main process did not answer'))
  await vi.waitFor(() => expect(status.textContent?.trim()).toBe(WORDS))
  expect((m.q('dock-label-switch') as HTMLInputElement).disabled).toBe(true)
  warn.mockRestore()
})

it('a save that fails puts the switch back, says so, and keeps the typed name', async () => {
  const save = held<DockLabel>()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const m = generalOver({ read: async () => ATLAS, set: () => save.promise })
  await vi.waitFor(() => expect(m.q('dock-label-name')).toBeTruthy())
  const name = m.q('dock-label-name') as HTMLInputElement
  name.value = 'cedar'
  name.dispatchEvent(new Event('input'))
  const toggle = m.q('dock-label-switch') as HTMLInputElement
  toggle.click()
  expect(toggle.checked).toBe(false)
  save.reject(new Error('fictional: the folder was not there'))
  await vi.waitFor(() => expect(m.q('dock-label-status').textContent?.trim()).toBe(WORDS))
  expect(toggle.checked).toBe(true)
  expect(name.value).toBe('CEDAR')
  warn.mockRestore()
})

it('the status line clears when the next save works', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  let fail = true
  const m = generalOver({
    read: async () => ATLAS,
    set: async () => {
      if (fail) throw new Error('fictional')
      return { ...ATLAS, colour: 'teal' }
    },
  })
  await vi.waitFor(() => expect(m.q('dock-label-name')).toBeTruthy())
  ;(m.q('dock-label-colour-teal') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(m.q('dock-label-status').textContent?.trim()).toBe(WORDS))
  fail = false
  ;(m.q('dock-label-colour-teal') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(m.q('dock-label-status').textContent?.trim()).toBe(''))
  warn.mockRestore()
})

it('two saves overlap and the newer fails: the window shows what the older one saved', async () => {
  const first = held<DockLabel>()
  const second = held<DockLabel>()
  let calls = 0
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const m = generalOver({
    read: async () => ATLAS,
    set: () => (++calls === 1 ? first.promise : second.promise),
  })
  await vi.waitFor(() => expect(m.q('dock-label-name')).toBeTruthy())
  const toggle = m.q('dock-label-switch') as HTMLInputElement
  toggle.click()
  await settle()
  toggle.click()
  await settle()
  // Off is saved; on then fails. The main process holds off.
  first.resolve({ ...ATLAS, on: false })
  await settle()
  second.reject(new Error('fictional: the folder was not there'))
  await vi.waitFor(() => expect(m.q('dock-label-status').textContent?.trim()).toBe(WORDS))
  expect(toggle.checked).toBe(false)
  expect(m.host.querySelector('[data-cy="dock-label-name"]')).toBeNull()
  warn.mockRestore()
})

it('…and the same when the newer one’s failure arrives first', async () => {
  const first = held<DockLabel>()
  const second = held<DockLabel>()
  let calls = 0
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const m = generalOver({
    read: async () => ATLAS,
    set: () => (++calls === 1 ? first.promise : second.promise),
  })
  await vi.waitFor(() => expect(m.q('dock-label-name')).toBeTruthy())
  const toggle = m.q('dock-label-switch') as HTMLInputElement
  toggle.click()
  await settle()
  toggle.click()
  await settle()
  second.reject(new Error('fictional'))
  await settle()
  first.resolve({ ...ATLAS, on: false })
  await vi.waitFor(() => expect(toggle.checked).toBe(false))
  expect(m.q('dock-label-status').textContent?.trim()).toBe(WORDS)
  warn.mockRestore()
})

it('an arrow key moves focus at once; tabbing away while it saves keeps focus where it went', async () => {
  const save = held<DockLabel>()
  const m = generalOver({ read: async () => ATLAS, set: () => save.promise })
  await vi.waitFor(() => expect(m.q('dock-label-name')).toBeTruthy())
  const blue = m.q('dock-label-colour-blue')
  blue.focus()
  blue.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(document.activeElement).toBe(m.q('dock-label-colour-violet'))
  // The person moves on before the save answers.
  const toggle = m.q('dock-label-switch') as HTMLInputElement
  toggle.focus()
  save.resolve({ ...ATLAS, colour: 'violet' })
  await settle()
  await settle()
  expect(document.activeElement).toBe(toggle)
  expect(m.q('dock-label-colour-violet').getAttribute('aria-checked')).toBe('true')
})
