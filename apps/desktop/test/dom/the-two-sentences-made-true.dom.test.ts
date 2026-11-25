import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, visible } from './harness'

/**
 * # 🔴 672 §2 · A sentence nobody had measured, made true on the arm a person reaches
 *
 * | | ⛔ it said | ⚑ measured by `672` | ⚑ it says |
 * |---|---|---|---|
 * | **F6** the stale sign-in notice | *"Nothing here is lost — press Resume on it under the closed threads in the sidebar"* | the turn fails; approvals and background work do not come back; and the rail has had no *Resume* since `151` — each row IS the press, under *Closed conversations* | what is kept, where to press **by the rail's own heading**, and the two losses the reopen carries — §2, §3. ⚑ **D-017b** — there is no closed heading and no press to name: a message sent from the conversation's own view carries it on, so that is the remedy it says, and §3 asks that the conversation is still in the rail's one list for a person to open |
 *
 * ⚑ **`NoticeEntry` is reached through `TranscriptView`**, which is how a person meets it — the
 * clipped-text ledger holds this suite to mounting the parent and aiming the sensor at the notice's
 * own hook.
 */

afterEach(async () => {
  unmountAll()
  await page.viewport(1100, 900)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · F6 — the notice, read where it is drawn
// ─────────────────────────────────────────────────────────────────────────────────────────────

const STALE_AUTH_NOTICE =
  'The sign-in this conversation was launched with is no longer valid, so it cannot continue on ' +
  'it. Its transcript is kept. If your machine’s Claude login was renewed elsewhere on this computer, ' +
  'this app carries it on with the new login by itself, and a line below says so. Otherwise, send ' +
  'it a message to carry on: that reads your machine login again, and says so if that login has ' +
  'expired too. It carries on without its “Allow for this conversation” approvals or ' +
  'anything that was running in the background.'

const noticeOf = async (cause: 'auth_stale' | 'auth', drawnWhole = false): Promise<string> => {
  const state = createTranscript()
  applyEvent(state, {
    type: 'error',
    message: 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
    fatal: cause === 'auth_stale',
    cause,
    signIn: cause === 'auth_stale' ? { state: 'stale', message: STALE_AUTH_NOTICE } : undefined,
    presentation:
      cause === 'auth'
        ? {
            message:
              'This profile’s sign-in was rejected, so this conversation cannot continue. Start a new conversation to sign in again — the launcher will offer it.',
            level: 'error',
            terminal: false,
            repeat: 'each',
          }
        : undefined,
  })
  await page.viewport(760, 520)
  const m = mount(TranscriptView, { items: state.items, ownAgent: null }, { width: 720, height: 480 }) // prettier-ignore
  await nextTick()
  const shown = m.all('what-the-notice-says').filter(visible)
  expect(shown).toHaveLength(1)
  if (drawnWhole) {
    // 🔴 **672 · the sentence is DRAWN, not merely present** — `innerText` reads the whole string
    // through an ellipsis, and this notice was cut after its first clause until `672`
    await drawnReady()
    assertDrawn(m.q('what-the-notice-says'), 'the stale sign-in notice')
  }
  // ⚑ and every notice carries its whole sentence on its title, so a cut one is still readable
  expect(shown[0]!.title).toBe(shown[0]!.textContent)
  if (cause === 'auth_stale') {
    expect(shown[0]!.innerText.trim()).toBe("Couldn't continue with the old sign-in.")
    const details = m.q('claude-sign-in-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    details.querySelector('summary')!.click()
    await nextTick()
    expect(details.open).toBe(true)
    return details.innerText.trim()
  }
  return shown[0]!.innerText.trim()
}

describe('§2 · F6 · the stale sign-in notice', () => {
  it('Details says what is kept, how to carry on, and what does not come back', async () => {
    const text = await noticeOf('auth_stale', true)
    expect(text).toContain('Its transcript is kept')
    // ⚑ **D-017b** — no heading and no press: a message from the conversation's own view carries it on.
    expect(text).toContain('send it a message to carry on')
    expect(text).not.toContain('sidebar')
    expect(text).toContain('“Allow for this conversation” approvals')
    expect(text).toContain('running in the background')
    // ⛔ the two claims `672` measured false
    expect(text).not.toContain('Nothing here is lost')
    expect(text).not.toContain('Resume')
  })

  it('⚑ the planted control — the OTHER credential notice is unchanged, and still says sign in again', async () => {
    const text = await noticeOf('auth')
    expect(text).toContain('sign in again')
    expect(text).not.toContain('send it a message to carry on')
  })
})

describe('§2b · the provider’s own words are clamped — the app’s sentences are not', () => {
  it('🔴 a 25,000-character provider error is three lines with its whole on the title', async () => {
    // ⛔ `672`'s review measured this at 2,118 px once warnings wrapped — a provider's response
    // body is not a sentence a person acts on, and nothing bounds it on the way in
    const wall =
      'upstream said: ' + 'a provider response body that nobody wrote for a person. '.repeat(430)
    const state = createTranscript()
    applyEvent(state, { type: 'error', message: wall, fatal: false } as unknown as TranscriptEvent)
    await page.viewport(760, 520)
    const m = mount(TranscriptView, { items: state.items, ownAgent: null }, { width: 720, height: 480 }) // prettier-ignore
    await nextTick()
    await drawnReady()
    const what = m.q('what-the-notice-says')
    expect(visible(what)).toBe(true)
    expect(what.textContent?.length, 'the fold kept the whole of it').toBeGreaterThan(20_000)
    const line = Number.parseFloat(getComputedStyle(what).lineHeight)
    expect(Number.isFinite(line), 'a line height to measure against').toBe(true)
    expect(what.getBoundingClientRect().height).toBeLessThanOrEqual(line * 3 + 1)
    // ⚑ cut, and the cut is recoverable — the sensor sees it, and the title carries the whole
    assertClippedButTold(what, 'the provider wall')
  })

  it('⚑ the planted control — the app’s own error sentence is never clamped, on the same row style', async () => {
    const text = await noticeOf('auth_stale', true)
    // ⚑ **D-017b** — *"The reopened conversation starts without…"* became *"It carries on without…"*.
    expect(text).toContain('It carries on without its')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · F6 — the control the notice names, on the rail
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · F6 · the conversation the notice is about is there to open', () => {
  type Api = { runtime: Record<string, () => Promise<unknown>> }
  const stubbed = (): { api?: Api } => window as unknown as { api?: Api }
  afterEach(() => {
    delete stubbed().api
  })

  /**
   * ⚑ **D-017b · re-aimed** — the notice named the rail's *Closed conversations* heading and the row
   * under it, and this pressed both. ⛔ There is no closed heading now: a conversation whose sign-in
   * went stale is a row of the rail's ONE list, like any other, and its press opens it in its full
   * view — where the message the notice asks for is typed.
   */
  it('🔴 the stopped conversation is a row of the rail’s one list, and pressing it opens it', async () => {
    const stale = {
      provider: 'claude',
      cwd: '/tmp/alpha',
      status: 'errored',
      approvalMode: null,
      profileId: 'recipe-worker',
      reasoningEffort: null,
      model: null,
      planMode: null,
      adoptedAt: 1_700_000_000_000,
      hasTranscript: true,
      lastEnding: 'failed',
      updatedAt: Date.now() - 60_000,
      running: 'not-running',
      state: { is: 'idle' },
      // ⚑ **D-016 · commit 7 · R2 — it holds no piece**, so its row is titled by its agent.
      named: null,
      sessionId: 'sess_stale',
      ref: { provider: 'claude', sessionId: 'claude-thread', cwd: '/tmp/alpha', rotation: 0 },
      child: null,
      resumeRefusal: null,
    } as unknown as ResumableSessionInfo
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.resolve([stale]),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const pressed: string[] = []
    const rail = mount(
      SideRail,
      { open: [], activeId: null, place: null, onSelect: (id: string) => pressed.push(id) },
      // ⚑ a width the app draws the rail at (`--rail-w`), not a convenient one
      { width: 266.2 },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    // One Recent heading over the list, without a stopped-only section.
    const heading = rail.q('rail-toggle-recent').querySelector<HTMLElement>('.section-name')!
    expect(visible(heading)).toBe(true)
    expect(heading.textContent?.trim()).toBe('Recent')
    expect(rail.all('rail-closed-conversations')).toHaveLength(0)
    // ⚑ …and in it, the row is the press that opens the conversation
    const row = rail.q('open-session-sess_stale')
    expect(row.getAttribute('role')).toBe('button')
    expect(row.tabIndex).toBe(0)
    expect(visible(row)).toBe(true)
    row.click()
    await nextTick()
    expect(pressed).toEqual(['sess_stale'])
    row.focus()
    expect(document.activeElement).toBe(row)
    await userEvent.keyboard('{Enter}')
    expect(pressed).toEqual(['sess_stale', 'sess_stale'])
    await userEvent.keyboard(' ')
    expect(pressed).toEqual(['sess_stale', 'sess_stale', 'sess_stale'])
  })
})
