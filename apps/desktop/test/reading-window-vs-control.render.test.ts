import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { CreatedSession, TranscriptEvent } from '../src/shared/runtime-ipc'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import {
  createSessionRecord,
  requestDraft,
  type RequestDraft,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import { tailWindow } from '../src/renderer/src/lib/transcript-window'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import {
  applyEvent,
  createTranscript,
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'

/**
 * **A card outlives the fold it was rendered from** (064, from 061 finding 8).
 *
 * The data half of this is in `reading-window-vs-control.test.ts`, where the draft is asserted
 * directly on the record. What that cannot show is that the draft actually reaches the card — that
 * the plumbing exists and that a card handed one renders from it rather than from a `ref` of its
 * own. So this renders the real components.
 *
 * ⚠️ **It cannot claim "Vue did not remount".** There is no client mount here — `renderToString`
 * has no component lifecycle to observe — so the assertion this file CAN make is the one that
 * matters anyway: the same draft, rendered against two different folds of the same request, comes
 * out the same both times. Whether Vue keeps or rebuilds the instance, nothing is lost, because
 * nothing that matters is in the instance. The keying itself is asserted as `itemKey` next door.
 */

const SCOPE = {
  cwd: '/tmp/scratch',
  paths: ['write /tmp/scratch/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

function permissionRequest(id: string): TranscriptEvent {
  return {
    type: 'permission_request',
    id,
    kind: 'command',
    action: 'Bash',
    detail: 'run: ls',
    scope: SCOPE,
  }
}

function question(id: string): TranscriptEvent {
  return {
    type: 'user_input_request',
    id,
    prompt: 'Which colour?',
    questions: [
      { id: 'q0', prompt: 'Which colour?', options: [{ label: 'GREEN' }, { label: 'RED' }] },
    ],
  }
}

/**
 * The items a fold produces for `events` — after `padding` unrelated events, so that the same
 * request lands on a different `seq` and therefore a different `item.id`. That is a re-fold, in the
 * only way this layer can see one.
 */
function fold(padding: number, ...events: TranscriptEvent[]): TranscriptItem[] {
  const state = createTranscript()
  for (let i = 0; i < padding; i++) applyEvent(state, { type: 'assistant_message', text: `x${i}` })
  for (const event of events) applyEvent(state, event)
  return state.items
}

async function render(items: TranscriptItem[], draftFor: (id: string) => RequestDraft) {
  return await renderToString(
    createSSRApp({ render: () => h(TranscriptView, { items, mode: 'debug', draftFor }) }),
  )
}

/**
 * The opening tag of one button, by its test id.
 *
 * Pulled out rather than matched inline because SSR writes `disabled` BEFORE `data-cy`, so the
 * obvious regex looks for the attribute on the wrong side of the one it is anchored to and passes
 * whatever the button says. Returning `''` for a button that is not there would make an absent
 * control read as an enabled one, so the caller asserts existence first.
 */
function buttonTag(html: string, cy: string): string {
  return html.match(new RegExp(`<button[^>]*data-cy="${cy}"[^>]*>`))?.[0] ?? ''
}

const META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work',
  providerHome: '/homes/claude',
  profileId: 'default',
  // 158: told nothing extra — the shape every fixture that is not about instructions wants.
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  ref: { provider: 'claude', sessionId: 'th_1', cwd: '/work', rotation: 0 },
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'm',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  // Nothing waiting to be sent (077) — these fixtures describe sessions at rest.
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  liveness: { state: 'live', since: 1_700_000_000_000 },
  hasACommander: false,
  // 523 · a conversation a window started: it is not handed back, it is ended.
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

const paneProps = (record: SessionRecord): Record<string, unknown> => ({
  record,
  mode: 'chat' as const,
  debug: false,
  drawerOpen: false,
  drawerTab: 'open' as const,
  draft: '',
  // ⛔ The conversation's attachment transaction (292 §2) — required since the staged paths and
  // the operations that produce them became one object.
  handing: createAttachmentBook().handing(draftKey('sess_1')),
})

describe('a card renders from the record, not from itself', () => {
  it('shows a typed answer against two different folds of the same request', async () => {
    const record = { requests: new Map() } as { requests: Map<string, RequestDraft> }
    const draftFor = (id: string): RequestDraft =>
      requestDraft(record as Parameters<typeof requestDraft>[0], id)
    draftFor('req_q').answers.set('q0', 'GREEN')

    const before = await render(fold(0, question('req_q')), draftFor)
    const after = await render(fold(7, question('req_q')), draftFor)

    // The chosen chip is marked in both. `selected` is bound off the draft, so a card that had
    // rebuilt its own empty `answers` would render neither.
    expect(before).toContain('selected')
    expect(after).toContain('selected')
    // …and the Answer button is enabled in both, which is what `complete` reads the draft for.
    for (const html of [before, after]) {
      expect(buttonTag(html, 'user-input-answer')).not.toBe('')
      expect(buttonTag(html, 'user-input-answer')).not.toContain('disabled')
    }
  })

  it('leaves the Answer button disabled when nothing has been typed', async () => {
    // Non-vacuity for the pair above: without it, a card that never disables Answer at all would
    // satisfy them, and the draft would be proving nothing.
    const record = { requests: new Map() } as { requests: Map<string, RequestDraft> }
    const draftFor = (id: string): RequestDraft =>
      requestDraft(record as Parameters<typeof requestDraft>[0], id)

    const html = await render(fold(0, question('req_empty')), draftFor)

    expect(buttonTag(html, 'user-input-answer')).toContain('disabled')
    expect(html).not.toContain('selected')
  })

  it('keeps an already-submitted decision unclickable across a re-fold', async () => {
    const record = { requests: new Map() } as { requests: Map<string, RequestDraft> }
    const draftFor = (id: string): RequestDraft =>
      requestDraft(record as Parameters<typeof requestDraft>[0], id)
    // What `session-store.respondPermission` writes before it awaits anything.
    draftFor('req_p').sent = true

    const before = await render(fold(0, permissionRequest('req_p')), draftFor)
    const after = await render(fold(7, permissionRequest('req_p')), draftFor)

    // Every button on the card, in both renders. The card is still UNANSWERED in the ledger — the
    // decision has not echoed back yet — which is exactly the window in which the old
    // component-local guard was thrown away by a re-fold.
    for (const html of [before, after]) {
      expect(html).toContain('data-cy="permission-card"')
      for (const cy of ['permission-allow', 'permission-deny']) {
        expect(buttonTag(html, cy), `${cy} is not on the card at all`).not.toBe('')
        expect(buttonTag(html, cy)).toContain('disabled')
      }
    }
  })

  it('offers the buttons when nothing has been sent — so the guard above is doing the work', async () => {
    // Non-vacuity: without it, a card that rendered every button disabled for an unrelated reason
    // would satisfy the test above and nobody would ever be able to answer anything.
    const record = { requests: new Map() } as { requests: Map<string, RequestDraft> }
    const draftFor = (id: string): RequestDraft =>
      requestDraft(record as Parameters<typeof requestDraft>[0], id)

    const html = await render(fold(0, permissionRequest('req_open')), draftFor)

    expect(buttonTag(html, 'permission-allow')).not.toBe('')
    expect(buttonTag(html, 'permission-allow')).not.toContain('disabled')
  })

  it('freezes the composer on a card the reader has scrolled past', async () => {
    // The record shape a release produces: the reading window holds old history, the control
    // projection holds the live tail with an unanswered card in it. Forked by hand rather than by
    // paging back through 5,000 synthetic events — `reading-window-vs-control.test.ts` pays for the
    // real gesture; this one only has to prove which of the two the pane reads.
    const record = createSessionRecord('sess_1')
    record.meta = META
    record.phase = 'open'
    record.control = createTranscript()
    record.tail = tailWindow([])
    applyEvent(record.control, permissionRequest('req_far'))
    applyEvent(record.control, { type: 'status', state: 'working' })

    const html = await renderToString(
      createSSRApp({ render: () => h(ConversationPane as never, paneProps(record)) }),
    )

    // Frozen, and the card it is frozen on is nowhere on screen.
    expect(html).toMatch(
      /class="composer-hint frozen"|class="[^"]*\bfrozen\b[^"]*"[^>]*data-cy="composer-hint"/,
    )
    expect(html).not.toContain('data-cy="permission-card"')
  })

  it('draws the stop the control projection holds, even though the page the reader is on does not', async () => {
    const record = createSessionRecord('sess_1')
    record.meta = META
    record.phase = 'open'
    record.control = createTranscript()
    record.tail = tailWindow([])
    // The page the reader scrolled back to caught the agent mid-turn…
    applyEvent(record.transcript, { type: 'status', state: 'working' })
    // …and the live tail has since stopped.
    applyEvent(record.control, { type: 'status', state: 'ended' })

    const html = await renderToString(
      createSSRApp({ render: () => h(ConversationPane as never, paneProps(record)) }),
    )

    // The pane reads CONTROL: the host's raw word, still on `data-status`, is the stop.
    expect(html).toContain('data-status="ended"')
    // ⚑ **D-017b · and a person reads the one state, never a process word** (`05` rule 5): it
    // used to say *Ended* here. It says `Idle` — not the page's `Working`, which is what reading
    // the reading window would have drawn.
    expect(html).toContain('data-standing="idle"')
    expect(html).not.toContain('data-standing="working"')
    expect(html).not.toContain('Ended')
    // 061's *"a provider-ended session can remain open"*: the reading window still says it is live.
    expect(record.transcript.ended).toBe(false)
  })

  it('works with no draft owner at all, which is what the read-only pane hands it', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(TranscriptView, { items: fold(0, permissionRequest('req_ro')), mode: 'debug' }),
      }),
    )
    expect(html).toContain('data-cy="permission-card"')
    expect(buttonTag(html, 'permission-allow')).not.toBe('')
    expect(buttonTag(html, 'permission-allow')).not.toContain('disabled')
  })
})
