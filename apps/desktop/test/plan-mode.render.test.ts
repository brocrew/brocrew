import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PlanEntry from '../src/renderer/src/components/PlanEntry.vue'
import {
  applyEvent,
  createTranscript,
  type PlanItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import {
  GO_AHEAD_AUTHORSHIP,
  GO_AHEAD_LABEL,
  GO_AHEAD_MESSAGE,
  GO_AHEAD_NOTE,
  LEAVE_PLAN_LABEL,
  LEAVE_PLAN_TITLE,
  LEAVE_PLAN_UNAVAILABLE,
} from '../src/renderer/src/lib/plan-mode'
import type { RuntimeEvent } from '@brobot2/runtime'

/**
 * Plan mode (Slice 2 · 030).
 *
 * Two claims are pinned here, and they are different kinds of claim. One is structural — a plan is a
 * DOCUMENT, so it renders through the document viewer and not as chat prose. The other is about
 * WORDS: plan mode is not a safety gate, and the SDK's own type description says otherwise, so the
 * wording is exactly the sort of thing that drifts back toward the comfortable lie.
 *
 * ⛔ **417 took the second claim's LAUNCHER half away, not the claim** (HO-022 §2 — *"Opening a new
 * conversation opens a conversation with BroBot. That is all."*). There is no `plan-mode` checkbox
 * on the front door any more, so the two mounts of `NewConversation` below went with it; see the
 * note in that describe for what they said and where the rendered half of the rule now lives.
 */

const render = (component: unknown, props: Record<string, unknown> = {}): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const plan = (over: Partial<PlanItem> = {}): PlanItem => ({
  kind: 'plan',
  id: 'plan_1',
  steps: [],
  ...over,
})

const PLAN_MD = '# Plan\n\n1. Read the config\n2. Rename the field\n'

describe('the plan renders as a document', () => {
  it('goes through the shared document viewer — paper, and a way to see the raw', async () => {
    const html = await render(PlanEntry, { item: plan({ body: PLAN_MD }) })
    expect(html).toContain('data-cy="plan-body"')
    // THE document viewer, not a second rendering of markdown that could drift from it.
    expect(html).toContain('data-cy="document-body"')
    expect(html).toContain('data-cy="doc-view-markdown"')
    expect(html).toContain('data-cy="doc-view-raw"')
    // Rendered, not escaped source: the heading is a heading.
    expect(html).toContain('<h1>Plan</h1>')
  })

  it('a plan with no checklist is "the plan", not "plan cleared"', async () => {
    // A document arrives with no steps — that is the normal shape of a proposal, and the old
    // heading would have announced it as an emptied checklist.
    expect(await render(PlanEntry, { item: plan({ body: PLAN_MD }) })).toContain('the plan')
    expect(await render(PlanEntry, { item: plan() })).toContain('plan cleared')
  })

  it('a checklist without a document is untouched (028 stays as it was)', async () => {
    const html = await render(PlanEntry, {
      item: plan({ steps: [{ text: 'one', status: 'done' }] }),
    })
    expect(html).toContain('plan · 1 of 1')
    expect(html).not.toContain('data-cy="document-body"')
  })

  it('a plan can have BOTH — the document it proposed and the list it became', async () => {
    const html = await render(PlanEntry, {
      item: plan({ body: PLAN_MD, steps: [{ text: 'one', status: 'active' }] }),
    })
    expect(html).toContain('plan · 0 of 1')
    expect(html).toContain('data-cy="document-body"')
  })
})

describe('the plan survives the work it describes (030 review)', () => {
  const feed = (state: TranscriptState, ...events: RuntimeEvent[]): TranscriptState => {
    for (const event of events) applyEvent(state, event)
    return state
  }
  const planItem = (state: TranscriptState): PlanItem | undefined =>
    state.items.find((item): item is PlanItem => item.kind === 'plan')

  it('a checklist built AFTER approval does not erase the plan that was approved', () => {
    // The bug this test exists for: `body` was being restated on every event like `steps` and
    // `note`, so the first ordinary todo call after the user approved the plan deleted it — from
    // under them, mid-execution, with their own approval still on screen above it.
    const state = feed(
      createTranscript(),
      { type: 'plan_update', steps: [], body: '# Plan\n\n1. Do the thing' },
      // …the agent gets to work, and its checklist arrives with no body, because only ExitPlanMode
      // ever carries one.
      { type: 'plan_update', steps: [{ text: 'Do the thing', status: 'active' }] },
    )
    expect(planItem(state)?.body, 'the approved plan must still be there').toBe(
      '# Plan\n\n1. Do the thing',
    )
    expect(planItem(state)?.steps).toEqual([{ text: 'Do the thing', status: 'active' }])
  })

  it('a later plan document REPLACES an earlier one — proposing twice is not appending', () => {
    const state = feed(
      createTranscript(),
      { type: 'plan_update', steps: [], body: 'first' },
      { type: 'plan_update', steps: [], body: 'second' },
    )
    expect(planItem(state)?.body).toBe('second')
  })

  it('the note still clears when it is no longer true — only `body` is append-once', () => {
    // `note` is Codex's `explanation`, a STATE that is set and unset as the plan progresses. The
    // fix must not have turned every optional field into one that can never be retracted.
    const state = feed(
      createTranscript(),
      { type: 'plan_update', steps: [{ text: 'a', status: 'pending' }], note: 'working on it' },
      { type: 'plan_update', steps: [{ text: 'a', status: 'done' }] },
    )
    expect(planItem(state)?.note).toBeUndefined()
  })
})

describe('plan mode never claims to be a safety gate', () => {
  /**
   * The pinned SDK calls `'plan'` *"Planning mode, no actual tool execution"* — and the 026 capture
   * measured a `Write` under it. These are the words that must not creep back in.
   */
  const FORBIDDEN = [
    /no actual tool execution/i,
    /\bread[- ]only\b/i,
    /\bsandbox(ed|ing)?\b/i,
    /\bcannot (do|change|write|run|act)/i,
    /\bnothing can happen\b/i,
    /\bsafe(ly)?\b/i,
  ]

  /**
   * Denials are the POINT, so they must not fail the rule that exists to require them.
   *
   * The forbidden list is a list of words, but the rule is about CLAIMS: "it is not a sandbox" and
   * "it is a sandbox" contain the same word and mean opposite things. Stripping the explicit
   * denials before the sweep is what makes it test the claim.
   */
  const withoutDenials = (copy: string): string =>
    copy.replace(/\b(is )?NOT a (sandbox|safety gate)\b/gi, '')

  /**
   * ⛔ **417 removed the two launcher mounts this describe opened with, and the copy they swept**
   * (HO-022 §2). What stood here:
   *
   * - `const visible = …` (strip template comments) and `const planCopy = …` (every `title=` on the
   *   rendered page that mentions the plan) — both read a rendered `NewConversation`.
   * - *"the launcher offers plan mode without promising safety"* — mounted the launcher for Claude,
   *   asserted `data-cy="plan-mode"`, swept {@link FORBIDDEN} over the checkbox's tooltip and
   *   required the page to say *"propose first"* and *"NOT a sandbox"*.
   * - *"Codex is offered plan mode, and told what it will get — 030 assumed, 057 measured"* —
   *   mounted it for Codex, asserted `plan-mode` present and `plan-unavailable` absent, that the
   *   declaration's `note` reached the page, and that `reasoning-effort-select`, `model-input` and
   *   `auto-approve` were still beside it.
   * - *"EVERY variant of the copy is swept, including the one only yolo can see"* — swept both
   *   branches of `planModeTitle` and `PLAN_YOLO_NOTE`. ⛔ **Those two exports are deleted**: after
   *   417 no component imported either, and a sweep over copy nothing renders is not evidence that
   *   anything on screen is honest.
   *
   * ⚠️ **The RENDERED half of the rule is not lost — it lives on the agent card.**
   * `the-agent-panels-plan-and-approval-mode.dom.test.ts` · *"never implies plan mode is a safety
   * gate"* reads `[data-cy=card-run-plan]`'s own attributes, requires *"approvals are what gate those"* and
   * *"not a safety gate"* on the same string, and forbids *"cannot run"* / *"will not run"* there.
   *
   * ⚑ **And the sweep is re-pointed rather than retired.** It now reads the plan copy that DOES
   * render: the seven strings of the go-ahead and the leave gesture. `026`/`056`'s rule is about
   * what a person is told plan mode protects them from, and those seven strings are now the whole
   * of it.
   */

  const RENDERED: readonly (readonly [string, string])[] = [
    ['GO_AHEAD_LABEL', GO_AHEAD_LABEL],
    ['GO_AHEAD_MESSAGE', GO_AHEAD_MESSAGE],
    ['GO_AHEAD_NOTE', GO_AHEAD_NOTE],
    ['GO_AHEAD_AUTHORSHIP', GO_AHEAD_AUTHORSHIP],
    ['LEAVE_PLAN_LABEL', LEAVE_PLAN_LABEL],
    ['LEAVE_PLAN_TITLE', LEAVE_PLAN_TITLE],
    ['LEAVE_PLAN_UNAVAILABLE', LEAVE_PLAN_UNAVAILABLE],
  ]

  it('every plan string a person can actually read is swept', () => {
    // ⚑ Non-vacuity: the roster must be the module's, not a subset somebody trimmed to pass.
    expect(RENDERED).toHaveLength(7)
    for (const [name, copy] of RENDERED) {
      expect(copy.trim(), `${name} is empty, so sweeping it measures nothing`).not.toBe('')
      for (const forbidden of FORBIDDEN) {
        expect(withoutDenials(copy), `${name} must not claim ${String(forbidden)}`).not.toMatch(
          forbidden,
        )
      }
    }
  })

  it('⚠️ …and the sweep can fail — the detector, on a planted claim', () => {
    // ⛔ A list of clean strings passes a broken sweep exactly as well as a working one. Two
    // plants, not one, because a walk that stops at its first match reads as a working detector.
    const planted = [
      'Planning mode: the agent is read-only until you approve.',
      'While planning nothing can happen, so it is safe to leave it running.',
    ]
    for (const claim of planted) {
      expect(
        FORBIDDEN.some((forbidden) => forbidden.test(withoutDenials(claim))),
        `the sweep cannot see "${claim}"`,
      ).toBe(true)
    }
    // …and the denial-stripper does not swallow a real claim along with the denials.
    expect(withoutDenials('It is NOT a sandbox, it is a sandbox')).toMatch(/\bsandbox\b/)
  })
})
