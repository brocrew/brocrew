import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { forgetProfileSignIns } from '../../src/renderer/src/composables/useProfileSignIn'
import type { AuthState, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { ProviderSetupState } from '../../src/shared/provider-setup'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { assertDrawn, drawnReady } from './drawn'
import { META, contrast, mount, paneProps, parseColor, record, unmountAll } from './harness'

const refused: TranscriptEvent = {
  type: 'error',
  message: 'HTTP 401: the launch sign-in was refused',
  fatal: true,
  cause: 'auth_stale',
}
const retry = (attempt: number): TranscriptEvent => ({
  type: 'error',
  message: `claude could not authenticate; retrying (attempt ${attempt}/3, HTTP 401)`,
  fatal: false,
})
const events: TranscriptEvent[] = [
  { type: 'user_turn', text: 'Please finish the bakery menu.' },
  retry(1),
  retry(2),
  refused,
  { type: 'turn', state: 'failed', wordOf: 'this-app' },
  { type: 'unknown', provider: 'claude', category: 'unrecognized', label: 'dev_intent', raw: {} },
]
const USABLE: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const STALE: AuthState = { state: 'stale', reason: 'The fake machine sign-in expired.' }
const SETUP: ProviderSetupState = {
  provider: 'claude',
  available: true,
  supported: { install: true, signIn: true },
  phase: 'idle',
  progress: '',
  authUrl: null,
  error: null,
  details: null,
  exitCode: null,
}

function bridge(auth: AuthState) {
  const runtime = {
    checkProviderAuth: vi.fn(async () => auth),
    listResumable: async () => [],
    listUnresumable: async () => [],
  }
  let listener: (state: ProviderSetupState) => void = () => {}
  const providerSetup = {
    state: vi.fn(async () => SETUP),
    onState: (next: typeof listener) => {
      listener = next
      return () => {}
    },
    signIn: vi.fn(async () => ({ ok: true as const })),
    cancel: vi.fn(async () => ({ ok: true as const })),
  }
  Object.assign(window, { api: { runtime, providerSetup } })
  return { runtime, providerSetup, changed: (state: ProviderSetupState) => listener(state) }
}
async function settled() {
  for (let index = 0; index < 4; index++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
function scene(
  extra: Record<string, unknown> = {},
  refusal: TranscriptEvent = refused,
  width = 1000,
) {
  const r = record([])
  r.meta = {
    ...META,
    provider: 'claude',
    profileId: 'bakery-builder',
    ref: { ...META.ref!, provider: 'claude' },
  }
  r.transcript.ref = r.meta.ref
  for (const event of events) applyEvent(r.transcript, event === refused ? refusal : event)
  r.phase = 'recorded'
  return mount(
    ConversationPane,
    paneProps({ record: r, capabilities: CAPABILITY_FIXTURE, ...extra }),
    { width, height: 650 },
  )
}
afterEach(() => {
  unmountAll()
  forgetProfileSignIns()
  delete (window as { api?: unknown }).api
})

describe('Claude sign-in recovery where the error is read', () => {
  it('one short line offers current-login recovery, with all diagnostics under Details', async () => {
    await page.viewport(1200, 800)
    const api = bridge(USABLE)
    const send = vi.fn()
    const m = scene({ onSend: send })
    await settled()
    expect(api.runtime.checkProviderAuth).toHaveBeenCalledWith({
      provider: 'claude',
      profileId: 'bakery-builder',
    })
    expect(m.all('notice-error')).toHaveLength(1)
    expect(m.all('notice-warn')).toHaveLength(0)
    expect(m.q('what-the-notice-says').innerText).toBe("Couldn't continue with the old sign-in.")
    const action = m.q('claude-sign-in-action')
    await drawnReady()
    assertDrawn(action, 'the current-sign-in action')
    assertDrawn(m.q('what-the-notice-says'), 'the short sign-in error')
    expect(action.innerText).toBe('Retry with current sign-in')
    expect(m.host.innerText).not.toContain('Unmodeled event')
    const details = m.q('claude-sign-in-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(m.host.innerText).not.toContain('HTTP 401')
    expect(m.q('what-the-notice-says').getBoundingClientRect().height).toBeLessThan(30)
    if (import.meta.env.VITE_CLAUDE_CAPTURE)
      await page.screenshot({
        element: m.host,
        path: `${import.meta.env.VITE_CLAUDE_CAPTURE}/after-current.png`,
      })
    action.click()
    await settled()
    expect(send).toHaveBeenCalledExactlyOnceWith('Please finish the bakery menu.', 'now', [])
    details.querySelector('summary')!.click()
    await settled()
    expect(details.open).toBe(true)
    expect(details.innerText).toContain('attempt 1/3')
    expect(details.innerText).toContain('attempt 2/3')
    expect(details.innerText).toContain('the launch sign-in was refused')
    expect(details.innerText).toContain('Its transcript is kept')
    expect(details.innerText).toContain('turn failed')
    const diagnostics = details.querySelector<HTMLElement>('.diagnostics')!
    const ink = parseColor(getComputedStyle(diagnostics).color)
    const paper = parseColor(getComputedStyle(diagnostics).backgroundColor)
    if (ink === null || paper === null) throw new Error('The diagnostic colours could not be read')
    expect(contrast(ink, paper)).toBeGreaterThanOrEqual(4.5)
    if (import.meta.env.VITE_CLAUDE_CAPTURE)
      await page.screenshot({
        element: m.host,
        path: `${import.meta.env.VITE_CLAUDE_CAPTURE}/after-details.png`,
      })
  })

  it('an invalid machine login offers the existing native sign-in and its browser link', async () => {
    await page.viewport(1200, 800)
    const api = bridge(STALE)
    const m = scene()
    await settled()
    expect(m.q('what-the-notice-says').innerText).toBe('Claude sign-in expired.')
    expect(m.q('claude-sign-in-action').innerText).toBe('Sign in again')
    await drawnReady()
    assertDrawn(m.q('claude-sign-in-action'), 'the sign-in action')
    expect(m.all('pane-sign-in')).toHaveLength(0)
    if (import.meta.env.VITE_CLAUDE_CAPTURE)
      await page.screenshot({
        element: m.host,
        path: `${import.meta.env.VITE_CLAUDE_CAPTURE}/after-expired.png`,
      })
    m.q('claude-sign-in-action').click()
    await settled()
    expect(api.providerSetup.signIn).toHaveBeenCalledWith('claude')
    api.changed({
      ...SETUP,
      phase: 'signing-in',
      progress: 'Finish signing in in your browser.',
      authUrl: 'https://claude.ai/oauth/authorize?code=fake',
    })
    await settled()
    expect(m.q('native-sign-in-link').getAttribute('href')).toBe(
      'https://claude.ai/oauth/authorize?code=fake',
    )
    expect((m.q('claude-sign-in-action') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a recording retains the explanation and Details without a live recovery action', async () => {
    bridge(USABLE)
    const r = record(events)
    const m = mount(TranscriptView, {
      items: r.transcript.items,
      provider: 'claude',
      recorded: true,
      mode: 'debug',
    })
    await settled()
    expect(m.all('claude-sign-in-action')).toHaveLength(0)
    expect(m.all('claude-sign-in-details')).toHaveLength(1)
    expect(m.host.innerText).not.toContain('Unmodeled event')
  })

  it('a rejected current login needs sign-in even when local expiry still says usable', async () => {
    await page.viewport(1200, 800)
    const api = bridge(USABLE)
    const reopened = vi.fn()
    const m = scene({ onReopenSignIn: reopened }, { ...refused, cause: 'auth' })
    await settled()
    expect(m.q('what-the-notice-says').innerText).toBe('Claude sign-in expired.')
    expect(m.q('claude-sign-in-action').innerText).toBe('Sign in again')
    expect(m.host.innerText).not.toContain('Start a new conversation')
    m.q('claude-sign-in-action').click()
    await settled()
    expect(api.providerSetup.signIn).toHaveBeenCalledExactlyOnceWith('claude')
    api.changed({ ...SETUP, phase: 'signed-in', progress: 'Signed in.' })
    await settled()
    expect(reopened).toHaveBeenCalledTimes(1)
    expect(m.q('claude-sign-in-action').innerText).toBe('Retry with current sign-in')
  })

  it('keeps the recovery action readable and keyboard reachable in a narrow pane', async () => {
    await page.viewport(760, 800)
    const api = bridge(STALE)
    const m = scene({}, refused, 600)
    await settled()
    await drawnReady()
    const action = m.q('claude-sign-in-action')
    expect(m.host.getBoundingClientRect().width).toBe(600)
    assertDrawn(action, 'narrow sign-in action')
    assertDrawn(m.q('what-the-notice-says'), 'narrow sign-in error')
    action.focus()
    expect(document.activeElement).toBe(action)
    await userEvent.keyboard('{Enter}')
    expect(api.providerSetup.signIn).toHaveBeenCalledExactlyOnceWith('claude')
  })
})
