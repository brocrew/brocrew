import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import RecoveryApp from '../../src/renderer/src/components/RecoveryApp.vue'
import { mount, unmountAll, type Mounted } from './harness'
import {
  CONVERSATIONS,
  fakeRecoveryBridge,
  HISTORY_ONLY,
  NEWER_WITH_A_COPY,
  type FakeRecoveryBridge,
  type RecoveryScript,
} from './recovery-fake'

/**
 * Each verdict the recovery window draws puts the cursor on its heading, the dialog is described by
 * its body text, and a running step names its progress bar.
 */

afterEach(() => unmountAll())

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function open(
  script: RecoveryScript,
): Promise<{ view: Mounted; bridge: FakeRecoveryBridge }> {
  const bridge = fakeRecoveryBridge(script)
  const view = mount(RecoveryApp, { bridge }, { width: 1200, height: 800 })
  await settle()
  return { view, bridge }
}

describe('focus follows the verdict', () => {
  it('the first verdict puts focus on its heading, which is not a tab stop', async () => {
    const { view } = await open({ verdict: NEWER_WITH_A_COPY })
    const heading = view.q('recovery-heading')
    expect(heading.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(heading)
  })

  it('a verdict that replaces the screen moves focus from the pressed button to the new heading', async () => {
    const { view } = await open({
      verdict: NEWER_WITH_A_COPY,
      afterRestore: HISTORY_ONLY,
      conversations: CONVERSATIONS,
    })
    const restore = view.q('recovery-restore')
    restore.focus()
    expect(document.activeElement).toBe(restore)

    restore.click()
    await settle()
    const heading = view.q('recovery-heading')
    expect(view.q('recovery-banner').contains(heading)).toBe(true)
    expect(heading.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(heading)
  })

  it('a verdict main pushes moves focus too', async () => {
    const { view, bridge } = await open({ verdict: { kind: 'working', what: 'restore' } })
    view.host.ownerDocument.body.focus()
    bridge.deliver({ ...HISTORY_ONLY })
    await settle()
    expect(document.activeElement).toBe(view.q('recovery-heading'))
  })

  it('a failed first check puts focus on its heading', async () => {
    const { view } = await open({ verdict: HISTORY_ONLY, verdictError: new Error('no answer') })
    expect(document.activeElement).toBe(view.q('recovery-heading'))
  })
})

describe('the dialog is described by what it says', () => {
  it('references every body line, and they say the refusal', async () => {
    const { view } = await open({ verdict: NEWER_WITH_A_COPY })
    const dialog = view.q('recovery-dialog')
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    const ids = (dialog.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    expect(ids.length).toBeGreaterThan(0)
    const described = ids
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
    const lines = view.all('recovery-body').map((line) => line.textContent?.trim() ?? '')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(described).toContain(line)
    expect(described).toContain('BroCrew 0.2.0 or later')
  })
})

describe('the progress bar is named by the running step', () => {
  it('a restore names it with the step', async () => {
    let release!: () => void
    const hold = new Promise<void>((done) => (release = done))
    const { view } = await open({
      verdict: NEWER_WITH_A_COPY,
      afterRestore: HISTORY_ONLY,
      progress: [[1, 4]],
      hold,
    })
    view.q('recovery-restore').click()
    await settle()
    const bar = view.q('recovery-progress').querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-label')).toMatch(/^Restoring the copy/)
    release()
    await settle()
  })

  it('a working verdict names it with its heading', async () => {
    const { view } = await open({ verdict: { kind: 'working', what: 'restore' } })
    const bar = view.q('recovery-progress').querySelector('[role="progressbar"]')!
    const label = bar.getAttribute('aria-label')
    expect(label).toBeTruthy()
    expect(label).toBe(view.q('recovery-heading').textContent?.trim())
  })

  it('a return from history names it with the step', async () => {
    let release!: () => void
    const hold = new Promise<void>((done) => (release = done))
    const { view } = await open({
      verdict: HISTORY_ONLY,
      afterReturn: NEWER_WITH_A_COPY,
      conversations: CONVERSATIONS,
      hold,
    })
    view.q('recovery-return').click()
    await settle()
    const bar = view.q('recovery-progress').querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-label')).toBe('Returning to the newer data…')
    release()
    await settle()
  })
})
