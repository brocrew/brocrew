import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import RecoveryApp from '../../src/renderer/src/components/RecoveryApp.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import type { StartFailure, StartupVerdict } from '../../src/shared/recovery'
import { copyDate, START_FAILURES } from '../../src/renderer/src/lib/recovery-words'
import { applyEvent, createTranscript, markReadOnly } from '../../src/renderer/src/lib/transcript'
import { ASSET_SCHEME } from '../../src/shared/asset-url'
import { clockTime } from '../../src/shared/clock'
import { mount, unmountAll, type Mounted } from './harness'
import {
  CONVERSATIONS,
  COPY_AT,
  EVERY_KIND_EVENTS,
  fakeRecoveryBridge,
  HEADER_EVENTS,
  HISTORY_ONLY,
  NEWER_WITH_A_COPY,
  NEWER_WITHOUT_A_COPY,
  type FakeRecoveryBridge,
  type RecoveryCall,
  type RecoveryScript,
} from './recovery-fake'

/**
 * The recovery window draws one verdict: the refusal for newer data, the read-only history, or
 * the failure screen. Every press goes through the bridge, and nothing in the history can act.
 */

afterEach(() => unmountAll())

/** Lets the bridge's promises and Vue's render settle. */
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

function labels(view: Mounted): string[] {
  return [...view.host.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
}

const failed = (reason: StartFailure, canRetry: boolean): StartupVerdict => ({
  kind: 'failed',
  reason,
  canRetry,
  ...(reason === 'replaced-outside'
    ? { where: 'gate' as const, checkpointCreatedAt: COPY_AT }
    : {}),
  detail: `The coordinator stopped: ${reason}.`,
})

describe('newer data', () => {
  it('offers the copy with its date, and the press restores that checkpoint', async () => {
    const { view, bridge } = await open({
      verdict: NEWER_WITH_A_COPY,
      afterRestore: HISTORY_ONLY,
      conversations: CONVERSATIONS,
    })
    const date = copyDate(COPY_AT)
    const restore = view.q('recovery-restore')
    expect(restore.textContent?.trim()).toBe(`Restore the copy from ${date}`)
    expect(view.host.textContent).toContain('BroCrew 0.2.0 or later')
    expect(view.host.textContent).not.toContain('checkpoint-7')
    restore.click()
    await settle()
    expect(bridge.calls).toContainEqual({ call: 'restore', checkpointId: 'checkpoint-7' })
    // The verdict the restore answered is what the window draws next.
    expect(view.q('recovery-banner').textContent).toContain('Read-only history')
  })

  it('draws progress while the restore runs', async () => {
    let release!: () => void
    const hold = new Promise<void>((done) => (release = done))
    const { view } = await open({
      verdict: NEWER_WITH_A_COPY,
      afterRestore: HISTORY_ONLY,
      progress: [
        [1, 4],
        [2, 4],
      ],
      hold,
    })
    view.q('recovery-restore').click()
    await settle()
    const progress = view.q('recovery-progress')
    expect(progress.textContent).toContain(`Restoring the copy from ${copyDate(COPY_AT)}`)
    expect(progress.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50')
    expect((view.q('recovery-close') as HTMLButtonElement).disabled).toBe(true)
    release()
    await settle()
    expect(view.all('recovery-progress')).toHaveLength(0)
  })

  it('without a copy offers no restore, only Close', async () => {
    const { view } = await open({ verdict: NEWER_WITHOUT_A_COPY })
    expect(view.all('recovery-restore')).toHaveLength(0)
    expect(labels(view)).toEqual(['Close'])
    expect(view.host.textContent).toContain('open the workspace with the newer version of BroCrew')
  })
})

describe('the history window', () => {
  const script: RecoveryScript = {
    verdict: HISTORY_ONLY,
    afterReturn: NEWER_WITH_A_COPY,
    conversations: CONVERSATIONS,
    transcripts: { 'conv-header': HEADER_EVENTS },
  }

  it('says what it is in a banner, and lists the copy’s conversations', async () => {
    const { view } = await open(script)
    const banner = view.q('recovery-banner')
    expect(banner.textContent).toContain(`Read-only history from the copy of ${copyDate(COPY_AT)}`)
    expect(banner.textContent).toContain('Agents are stopped')
    expect(banner.textContent).toContain(
      'return to the newer data, then open it with the newer version of BroCrew',
    )
    const rows = view.all('recovery-conversation')
    expect(rows.map((row) => row.querySelector('.row-title')?.textContent)).toEqual([
      'W1 · Bakery website',
      'W1.2 · Landing page header',
      'W1.3 · Contact form',
    ])
  })

  it('shows a transcript read-only: no control in it can act', async () => {
    const { view, bridge } = await open(script)
    view.all('recovery-conversation')[1]!.click()
    await settle()
    expect(bridge.calls).toContainEqual({ call: 'transcript', id: 'conv-header' })
    const transcript = view.q('recovery-transcript')
    expect(transcript.textContent).toContain('make the logo larger')
    // The request left waiting in the copy is settled, with no decision drawn.
    expect(view.all('permission-answered')).toHaveLength(1)
    for (const outcome of ['allow', 'deny', 'cancel', 'allow_always', 'allow_all_for_session']) {
      expect(view.all(`permission-${outcome}`)).toHaveLength(0)
    }
    // Pressing everything in it reaches nothing outside it.
    const before = bridge.calls.length
    for (const button of transcript.querySelectorAll('button')) button.click()
    await settle()
    expect(bridge.calls.slice(before)).toEqual([])
    expect(view.q('recovery-banner')).toBeTruthy()
  })

  it('marks internal links unavailable in the copy and a press reaches no navigation or recovery door', async () => {
    const { view, bridge } = await open({
      ...script,
      transcripts: {
        'conv-header': [
          {
            at: 1,
            event: {
              type: 'assistant_message',
              text: '[Ana](brocrew://agent/aid%3Aana) W1.2',
            } as never,
          },
        ],
      },
    })
    view.all('recovery-conversation')[1]!.click()
    await settle()
    await expect.poll(() => view.all('message-link').length).toBe(2)
    await expect
      .poll(() =>
        view.all('message-link').every((button) => button.dataset.linkState === 'unavailable'),
      )
      .toBe(true)
    const calls = bridge.calls.length
    view.all('message-link')[0]!.click()
    await expect
      .poll(() => view.all('message-link-failure')[0]?.textContent)
      .toBe("Couldn't open this link.")
    expect(bridge.calls.slice(calls)).toEqual([])
    expect(view.q('recovery-transcript').querySelector('a[href^="brocrew:"]')).toBeNull()
    expect(view.all('message-link')[0]!.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Agent link',
    )
  })

  it('Return calls returnToNewer and draws the verdict it answers', async () => {
    const { view, bridge } = await open(script)
    view.q('recovery-return').click()
    await settle()
    expect(bridge.calls).toContainEqual({ call: 'returnToNewer' })
    expect(view.q('recovery-heading').textContent).toContain(
      "This version of BroCrew can't open this workspace",
    )
  })
})

describe('history reads and a changing verdict', () => {
  /** A promise and the function that settles it. */
  function gate(): { promise: Promise<void>; release: () => void } {
    let release!: () => void
    const promise = new Promise<void>((done) => (release = done))
    return { promise, release }
  }

  it('while Return is held, the rows are disabled and choosing one starts no read', async () => {
    const held = gate()
    const { view, bridge } = await open({
      verdict: HISTORY_ONLY,
      afterReturn: NEWER_WITH_A_COPY,
      conversations: CONVERSATIONS,
      transcripts: { 'conv-header': HEADER_EVENTS },
      hold: held.promise,
    })
    view.q('recovery-return').click()
    await settle()
    const rows = view.all('recovery-conversation') as HTMLButtonElement[]
    expect(rows.length).toBe(3)
    expect(rows.every((row) => row.disabled)).toBe(true)
    rows[1]!.click()
    await settle()
    expect(bridge.calls.filter((c) => c.call === 'transcript')).toEqual([])
    held.release()
    await settle()
    expect(view.q('recovery-heading').textContent).toContain("This version of BroCrew can't open")
  })

  it('a transcript that answers after the verdict changed is dropped', async () => {
    const read = gate()
    const { view, bridge } = await open({
      verdict: HISTORY_ONLY,
      // A refused Return lands back on history from a copy with the same conversations.
      afterReturn: HISTORY_ONLY,
      conversations: CONVERSATIONS,
      transcripts: { 'conv-header': HEADER_EVENTS },
      holdRead: (call: RecoveryCall) => (call.call === 'transcript' ? read.promise : undefined),
    })
    view.all('recovery-conversation')[1]!.click()
    await settle()
    expect(bridge.calls).toContainEqual({ call: 'transcript', id: 'conv-header' })
    view.q('recovery-return').click()
    await settle()
    read.release()
    await settle()
    expect(view.all('recovery-transcript')).toHaveLength(0)
    expect(view.q('recovery-reader').textContent).toContain('Choose a conversation')
  })

  it('a list that answers after the verdict changed is dropped', async () => {
    const first = gate()
    let lists = 0
    const { view, bridge } = await open({
      verdict: HISTORY_ONLY,
      conversations: (read) => (read === 1 ? CONVERSATIONS : CONVERSATIONS.slice(0, 1)),
      holdRead: (call: RecoveryCall) =>
        call.call === 'conversations' && ++lists === 1 ? first.promise : undefined,
    })
    // Main settles another history verdict while the first list is still being read.
    bridge.deliver(HISTORY_ONLY)
    await settle()
    first.release()
    await settle()
    expect(view.all('recovery-conversation')).toHaveLength(1)
  })
})

describe('recorded rows whose controls need what this window lacks', () => {
  const script: RecoveryScript = {
    verdict: HISTORY_ONLY,
    conversations: CONVERSATIONS,
    transcripts: { 'conv-header': EVERY_KIND_EVENTS },
  }

  /** The action controls these rows draw where a pane can handle them. */
  const ACTIONS = [
    'open-image',
    'subagent-open-transcript',
    'workflow-agent-label',
    'workflow-open-journal',
    'workflow-open-script',
    'workflow-open-output',
    'restore-queued',
    'user-input-answer',
    'user-input-reject',
  ]

  /** Opens every local disclosure, so anything drawn behind one is drawn. */
  async function disclose(root: Mounted): Promise<void> {
    for (const head of root.all('subagent-head')) head.click()
    await settle()
    for (const head of root.all('subagent-head')) {
      if (head.getAttribute('aria-expanded') === 'false') head.click()
    }
    root.q('workflow-head').click()
    await settle()
    for (const phase of [1, 2]) root.q(`workflow-phase-head-${phase}`).click()
    await settle()
  }

  it('the same rows in an ordinary transcript do draw those controls', async () => {
    // Without this, the absences below could be the fixture failing to draw anything.
    const state = createTranscript()
    for (const { event, at } of EVERY_KIND_EVENTS) applyEvent(state, event, at)
    markReadOnly(state, 'settled')
    const view = mount(TranscriptView, { items: state.items, mode: 'normal' })
    await settle()
    await disclose(view)
    const drawn = ACTIONS.filter((cy) => !cy.startsWith('user-input') && cy !== 'open-image')
    for (const cy of drawn) expect(view.all(cy).length, cy).toBeGreaterThan(0)
    // The test browser serves no pictures, so the request ends as the moved-file line.
    expect(view.all('open-image').length + view.all('image-missing').length).toBe(1)
    expect(view.all('image-unavailable')).toHaveLength(0)
  })

  it('draws none of them, and keeps the recorded words, names and disclosures', async () => {
    const { view, bridge } = await open(script)
    view.all('recovery-conversation')[1]!.click()
    await settle()
    const transcript = view.q('recovery-transcript')
    await disclose(view)

    // Both sub-agent cards and the workflow tree opened: the local disclosures still work.
    expect(view.all('subagent-entry')).toHaveLength(2)
    expect(view.all('subagent-summary').map((el) => el.textContent?.trim())).toEqual([
      'Twelve pages.',
      'The notes cover three topics.',
    ])
    expect(view.all('workflow-agent')).toHaveLength(3)

    for (const cy of ACTIONS) expect(view.all(cy), cy).toHaveLength(0)

    // The picture is not requested, and its row says why it isn't drawn without blaming the file.
    expect(transcript.querySelector(`img[src^="${ASSET_SCHEME}:"]`)).toBeNull()
    expect(view.all('image-missing')).toHaveLength(0)
    expect(view.q('image-unavailable').textContent).toContain("this window can't show pictures")
    expect(view.q('image-file-name').textContent).toBe('lighthouse-sketch.png')
    expect(view.q('image-caption').textContent).toContain('pencil sketch of a lighthouse')

    // Each card keeps its id, each agent its label, and the run its output file's name.
    expect(view.all('subagent-agent-id').map((el) => el.textContent)).toEqual([
      'agent-outer',
      'agent-inner',
    ])
    expect(view.all('workflow-agent-label-plain').map((el) => el.textContent)).toEqual([
      'reader:one',
      'reader:two',
      'judge',
    ])
    expect(view.q('workflow-output-name').textContent).toContain('review-panel.output')

    // The held message keeps its words and says it was never sent.
    expect(view.q('queued-message').textContent?.trim()).toBe('Also check the footer links.')
    expect(view.q('queued-state').textContent).toContain('not sent')

    // The question is settled with the copy's note, and none of its choices can be pressed.
    expect(view.q('user-input-answered').textContent).toContain('history from a copy')
    const choices = view.all('user-input-choice-beam') as HTMLButtonElement[]
    expect(choices).toHaveLength(2)
    expect(choices.every((choice) => choice.disabled)).toBe(true)

    // Every button left is a disclosure, so pressing them all reaches no bridge.
    const before = bridge.calls.length
    for (const button of transcript.querySelectorAll('button')) button.click()
    await settle()
    expect(bridge.calls.slice(before)).toEqual([])
  })

  it('shows each row at the clock time the copy recorded it', async () => {
    const { view } = await open(script)
    view.all('recovery-conversation')[1]!.click()
    await settle()
    const held = EVERY_KIND_EVENTS.find(({ event }) => event.type === 'message_queued')!
    expect(view.q('queued-message').getAttribute('data-at')).toBe(clockTime(held.at))
  })
})

describe('the failure screen', () => {
  it('words each reason its own way, and offers Try again only when it can', async () => {
    const seen = new Set<string>()
    for (const reason of START_FAILURES) {
      for (const canRetry of [true, false]) {
        const { view } = await open({ verdict: failed(reason, canRetry) })
        const words = [...view.all('recovery-heading'), ...view.all('recovery-body')]
          .map((el) => el.textContent?.trim())
          .join(' ')
        if (canRetry) seen.add(words.replace('Try again.', ''))
        expect(view.q('recovery-detail').textContent).toBe(`The coordinator stopped: ${reason}.`)
        expect(view.all('recovery-retry')).toHaveLength(canRetry ? 1 : 0)
        expect(view.all('recovery-close')).toHaveLength(1)
        view.unmount()
      }
    }
    expect(seen.size).toBe(START_FAILURES.length)
  })

  it('Try again calls retry and draws what it answers', async () => {
    const { view, bridge } = await open({
      verdict: failed('not-the-only-app-on-this-folder', true),
      afterRetry: NEWER_WITHOUT_A_COPY,
    })
    view.q('recovery-retry').click()
    await settle()
    expect(bridge.calls).toContainEqual({ call: 'retry' })
    expect(view.q('recovery-heading').textContent).toContain("This version of BroCrew can't open")
  })

  it('a start that failed after the data opened says so, quotes the error, and offers Try again', async () => {
    const { view } = await open({
      verdict: {
        kind: 'failed',
        reason: 'start-failed',
        canRetry: true,
        detail: 'listen EADDRINUSE: address already in use 127.0.0.1:9555',
      },
    })
    expect(view.q('recovery-heading').textContent).toContain("BroCrew couldn't finish starting")
    const body = view.all('recovery-body').map((el) => el.textContent?.trim())
    expect(body.join(' ')).toContain("opened this workspace's data, then something else")
    expect(body.at(-1)).toBe('Try again.')
    expect(view.q('recovery-detail').textContent).toBe(
      'listen EADDRINUSE: address already in use 127.0.0.1:9555',
    )
    expect(labels(view)).toEqual(['Try again', 'Close'])
  })

  it('names the two kinds of change from outside differently', async () => {
    const journal = await open({
      verdict: { kind: 'failed', reason: 'replaced-outside', canRetry: false, where: 'journal' },
    })
    expect(journal.view.host.textContent).toContain('while a restore was unfinished')
    journal.view.unmount()
    const gate = await open({ verdict: failed('replaced-outside', false) })
    expect(gate.view.host.textContent).toContain(`after its copy from ${copyDate(COPY_AT)}`)
  })
})

describe('starting up', () => {
  it('says it is checking while the first verdict is on its way', async () => {
    let release!: () => void
    const verdictHold = new Promise<void>((done) => (release = done))
    const { view } = await open({ verdict: NEWER_WITH_A_COPY, verdictHold })
    expect(view.q('recovery-pending').textContent).toContain('Checking')
    release()
    await settle()
    expect(view.all('recovery-pending')).toHaveLength(0)
    expect(view.q('recovery-restore')).toBeTruthy()
  })

  for (const [name, script] of [
    ['a rejected verdict', { verdict: HISTORY_ONLY, verdictError: new Error('no answer') }],
    [
      'a progress subscription that throws',
      { verdict: HISTORY_ONLY, onProgressError: new Error('no answer') },
    ],
  ] as const) {
    it(`${name} shows the failure words and a Close that quits`, async () => {
      const { view, bridge } = await open(script)
      expect(view.q('recovery-heading').textContent).toContain(
        "BroCrew couldn't check this workspace",
      )
      expect(view.q('recovery-detail').textContent).toContain('no answer')
      expect(labels(view)).toEqual(['Close'])
      view.q('recovery-close').click()
      await settle()
      expect(bridge.calls).toContainEqual({ call: 'quit' })
    })
  }

  it('a working verdict is replaced by the next one main delivers', async () => {
    const { view, bridge } = await open({ verdict: { kind: 'working', what: 'restore' } })
    expect(view.q('recovery-heading').textContent).toContain('Restoring the copy')
    expect(view.all('recovery-progress')).toHaveLength(1)
    expect(labels(view)).toEqual([])
    bridge.deliver({ ...HISTORY_ONLY })
    await settle()
    expect(view.q('recovery-banner').textContent).toContain('Read-only history')
    expect(view.all('recovery-conversation')).toHaveLength(0)
  })
})

describe('who else is using the workspace', () => {
  const words = (view: Mounted): string =>
    [...view.all('recovery-heading'), ...view.all('recovery-body')]
      .map((el) => el.textContent?.trim())
      .join(' ')

  it('unconfirmed sole use is said as just that, and claims no other app', async () => {
    const { view } = await open({
      verdict: {
        kind: 'failed',
        reason: 'not-the-only-app-on-this-folder',
        canRetry: true,
        ownership: 'unknown',
      },
    })
    expect(words(view)).toContain('couldn’t confirm it alone can use this workspace')
    expect(words(view)).not.toMatch(/Another copy of BroCrew (is using|has)/)
    expect(words(view)).toContain('If another copy of BroCrew is open on this workspace')
    expect(labels(view)).toEqual(['Try again', 'Close'])
  })

  it('a known other owner is named plainly, with what to do next', async () => {
    for (const canRetry of [true, false]) {
      const { view } = await open({
        verdict: {
          kind: 'failed',
          reason: 'not-the-only-app-on-this-folder',
          canRetry,
          ownership: 'taken',
        },
      })
      expect(view.q('recovery-heading').textContent).toContain(
        'Another copy of BroCrew is using this workspace',
      )
      expect(words(view)).toContain(
        canRetry
          ? 'Close the other copy of BroCrew, then try again.'
          : 'Close the other copy of BroCrew, then open this one again.',
      )
      expect(labels(view)).toEqual(canRetry ? ['Try again', 'Close'] : ['Close'])
      view.unmount()
    }
  })

  it('a return that failed says so, not that a restore did', async () => {
    const { view } = await open({
      verdict: { kind: 'failed', reason: 'restore-failed', canRetry: false, during: 'return' },
    })
    expect(view.q('recovery-heading').textContent).toContain('the return to the newer data')
    expect(view.host.textContent).not.toContain('the restore')
  })
})

describe('Close, and the edges', () => {
  const verdicts: [string, StartupVerdict][] = [
    ['newer', NEWER_WITH_A_COPY],
    ['history-only', HISTORY_ONLY],
    ['failed', failed('migration-failed', true)],
    ['open', { kind: 'open', checkpoint: 'not-needed' }],
  ]

  for (const [name, verdict] of verdicts) {
    it(`Close quits on ${name}`, async () => {
      const { view, bridge } = await open({ verdict })
      view.q('recovery-close').click()
      await settle()
      expect(bridge.calls).toContainEqual({ call: 'quit' })
    })
  }

  it('says plainly that open data never needed this window', async () => {
    const { view } = await open({ verdict: { kind: 'open', checkpoint: 'made' } })
    expect(view.q('recovery-heading').textContent).toContain('can be opened normally')
    expect(labels(view)).toEqual(['Close'])
  })

  it('opened outside BroBot, it says so instead of breaking', async () => {
    const view = mount(RecoveryApp, { bridge: null }, { width: 800, height: 600 })
    await settle()
    expect(view.q('recovery-no-bridge').textContent).toContain('only works inside BroCrew')
    expect(view.host.querySelectorAll('button')).toHaveLength(0)
  })
})
