import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import { APP_NOTICE_MARK, THE_APP_IS_THE_AUTHOR } from '../src/shared/app-notice'
import { GO_AHEAD_AUTHORSHIP, GO_AHEAD_SENDER } from '../src/renderer/src/lib/plan-mode'
import type { CreatedSession, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **624 · what a person actually reads on the app's own carrier** — `HO-095` §6.1, §6.2, §6.3.
 *
 * ## ⛔ The photograph this file is written from
 *
 * An app-authored approval carrier must not appear under the person’s avatar or “You”
 * heading, nor offer “Cancel it” for a project that already exists.
 *
 * ## 🔴 Why every arm below draws TWO rows
 *
 * ⛔ **`a-positive-assertion-must-differ-from-the-default`.** *The carrier says `This app`* is
 * satisfied by a build that says `This app` on every row in the column, and *no Cancel it* is
 * satisfied by a build that has stopped drawing the control at all. ⚑ So each render carries the
 * app's row AND the person's own, and the assertions are about the DIFFERENCE — standing rule
 * 12, two planted rather than one.
 */
const here = dirname(fileURLToPath(import.meta.url))
const COMPONENTS = join(here, '../src/renderer/src/components')

const AT = 1_700_000_000_000

const META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/brobot-workspace',
  providerHome: '/homes/claude',
  profileId: 'brobot',
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
    model: 'claude-sonnet-5',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  liveness: { state: 'live', since: AT },
  hasACommander: false,
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

function record(events: TranscriptEvent[]): SessionRecord {
  const r = createSessionRecord('sess_1')
  r.meta = META
  r.phase = 'open'
  let ordinal = 0
  for (const event of events) applyEvent(r.transcript, event, AT + ordinal, ordinal++)
  return r
}

const pane = (events: TranscriptEvent[]): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(ConversationPane as never, {
          record: record(events),
          mode: 'normal' as const,
          debug: false,
          drawerOpen: false,
          drawerTab: 'open',
          models: null,
          draft: '',
          handing: createAttachmentBook().handing(draftKey('sess_1')),
          identities: null,
        }),
    }),
  )

/**
 * ⚑ **What a person actually reads** — the markup with its HTML comments removed.
 *
 * ⛔ **Needed rather than tidy**: this repo's templates carry their reasoning inline, so a raw
 * `not.toContain('You')` over a pane is answered by a COMMENT and never by a word on screen
 * (`a-source-census-must-strip-prose-before-it-asserts`, one surface over).
 */
const visible = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

/** Every value a `data-cy` draws, in document order — the CLOSING tag, because scoped styles stamp the opener. */
const textsOf = (markup: string, cy: string): string[] =>
  [...visible(markup).matchAll(new RegExp(`data-cy="${cy}"[^>]*>([^<]*)<`, 'g'))].map((found) =>
    found[1]!.trim(),
  )

/** ⚑ Code only — block comments, line comments and template comments all go. */
const code = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ── the rows, named once ────────────────────────────────────────────────────────────────────

/**
 * ⚑ **D-016 · proposals went, and no build writes this carrier any more** — but a conversation's
 * history is kept whole, so an old ledger still holds it and it is still drawn. ⛔ Its word is no
 * longer in `APP_NOTICES`, so the rows below are cast past the type they no longer fit, the way
 * a replayed ledger reaches the fold.
 */
const THE_DECISION =
  'A person decided on the project you proposed, World Clock.\n\napproved. world-clock exists now.'

const theCarrier = (): TranscriptEvent =>
  ({
    type: 'user_turn',
    text: THE_DECISION,
    attribution: 'app_authored',
    appNotice: 'a-decision-a-person-made',
  }) as unknown as TranscriptEvent

const theHeldCarrier = (): TranscriptEvent =>
  ({
    type: 'message_queued',
    messageId: 'msg_app',
    kind: 'notice',
    text: THE_DECISION,
    appNotice: 'a-decision-a-person-made',
  }) as unknown as TranscriptEvent

const theirsHeld = (): TranscriptEvent =>
  ({
    type: 'message_queued',
    messageId: 'msg_mine',
    kind: 'work',
    text: 'and here is something I typed',
  }) as TranscriptEvent

const theirTurn = (): TranscriptEvent =>
  ({ type: 'user_turn', text: 'something I typed' }) as TranscriptEvent

const theGoAhead = (): TranscriptEvent =>
  ({
    type: 'user_turn',
    text: 'Go ahead with this plan.',
    attribution: 'app_authored',
  }) as TranscriptEvent

// ────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the author is not the reader
// ────────────────────────────────────────────────────────────────────────────────────────────

describe('624 §1 · the carrier says who wrote it', () => {
  it('🔴 SENT · the app is named, and the person’s own turn is still the person’s', async () => {
    const markup = await pane([theirTurn(), theCarrier()])
    expect(textsOf(markup, 'app-notice-sender')).toEqual([THE_APP_IS_THE_AUTHOR])
    expect(textsOf(markup, 'app-notice-mark')).toEqual([APP_NOTICE_MARK])
    // ⛔ **The words really are on screen**, or the heading above is a heading over nothing.
    expect(visible(markup)).toContain('A person decided on the project you proposed')
    // 🔴 **And the reader's own bubble is untouched**, which is what makes the heading a
    // measurement rather than a build that stopped drawing `You` anywhere.
    expect(visible(markup)).toContain('something I typed')
  })

  it('the app-authored row is headed by the app, and the person’s row by the person', async () => {
    const markup = await pane([theHeldCarrier(), theirsHeld()])
    // ⛔ **Both rows are drawn**, and they disagree — which is the whole assertion.
    expect(textsOf(markup, 'queued-sender')).toEqual([THE_APP_IS_THE_AUTHOR, 'You'])
    // ⚑ **And the mark says what the row is**, in the position the sent row uses for the same
    // fact, so the row does not change its story when it stops being held.
    expect(textsOf(markup, 'queued-about')).toEqual([APP_NOTICE_MARK])
  })

  it('⚑ THE CONTROL · a plan go-ahead is still BroBot’s and still says so', async () => {
    // 🔴 **The negatives above are only as strong as this arm.** ⛔ *The carrier is not a
    // continuation* is satisfied by a build that has stopped drawing continuations, and
    // *nothing says BroBot* by one that has stopped naming BroBot anywhere
    // (`a-negative-is-only-as-strong-as-the-search-shape`).
    const markup = await pane([theGoAhead()])
    expect(textsOf(markup, 'continuation-sender')).toEqual([GO_AHEAD_SENDER])
    expect(textsOf(markup, 'app-notice-sender')).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// §2 · no Cancel it on a delivery of a fact
// ────────────────────────────────────────────────────────────────────────────────────────────

describe('624 §2 · the app’s delivery offers nothing to press', () => {
  it('🔴 the carrier has no Cancel it, and the person’s own held message still has one', async () => {
    const markup = await pane([theHeldCarrier(), theirsHeld()])
    // ⛔ **ONE control on TWO rows**, which is the A/B: a build that hid both would fail the
    // second half, and a build that hid neither would fail the first.
    expect(textsOf(markup, 'cancel-queued')).toEqual(['Cancel it'])
    // ⚑ **And it belongs to the person's row.** The app's row is drawn FIRST, so the single
    // control appearing after the second row's words is what places it.
    const shown = visible(markup)
    expect(shown.indexOf('cancel-queued')).toBeGreaterThan(shown.indexOf('and here is something'))
  })

  it('⛔ and an ABANDONED carrier offers nothing back to the composer either', async () => {
    // ⚠️ **Reachable, not hypothetical**: a notice the app is holding when the conversation ends
    // is `abandoned`, and `Put it back in the composer` would load this app's own sentence into
    // the person's draft to be sent under their name — `214`'s defect manufactured by the row
    // built to remove it.
    const ended = {
      type: 'message_unqueued',
      messageId: 'msg_app',
      reason: 'abandoned',
      text: THE_DECISION,
      appNotice: 'a-decision-a-person-made',
    } as unknown as TranscriptEvent
    const markup = await pane([ended, theirsHeld()])
    expect(textsOf(markup, 'queued-sender')).toEqual([THE_APP_IS_THE_AUTHOR, 'You'])
    expect(textsOf(markup, 'restore-queued')).toEqual([])
    // ⚑ **THE CONTROL, one fact over**: a person's own abandoned message DOES offer it.
    const mineEnded = {
      type: 'message_unqueued',
      messageId: 'msg_mine2',
      reason: 'abandoned',
      text: 'mine, never sent',
    } as unknown as TranscriptEvent
    expect(textsOf(await pane([mineEnded]), 'restore-queued')).toEqual([
      'Put it back in the composer',
    ])
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// §3 · app notices retain their header and words without the caption
// ────────────────────────────────────────────────────────────────────────────────────────────

describe('app notices omit the caption', () => {
  it('the carrier keeps its words and omits the explanation', async () => {
    const markup = await pane([theCarrier()])
    expect(textsOf(markup, 'app-notice-why')).toEqual([])
    // Reject captions that falsely describe the sender or the action the person approved.
    expect(visible(markup)).not.toContain('Start work on this plan')
    expect(visible(markup)).not.toContain(GO_AHEAD_AUTHORSHIP)
  })

  it('⚑ THE CONTROL · the go-ahead still carries its own caption, unchanged', async () => {
    // 🔴 **`624` re-aimed the caption; it did not delete it.** ⛔ Without this arm the negative
    // above passes over a build that removed `GO_AHEAD_AUTHORSHIP` from the product.
    const markup = await pane([theGoAhead()])
    expect(textsOf(markup, 'continuation-why')).toEqual([GO_AHEAD_AUTHORSHIP])
  })

  it('neither the decision nor the answer draws a caption', async () => {
    const answer = {
      type: 'user_turn',
      text: 'A person answered the question you asked.',
      attribution: 'app_authored',
      appNotice: 'an-answer-to-a-question',
    } as unknown as TranscriptEvent
    const markup = await pane([theCarrier(), answer])
    expect(textsOf(markup, 'app-notice-why')).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the component owns no second spelling
// ────────────────────────────────────────────────────────────────────────────────────────────

describe('624 §4 · one source for the words', () => {
  it('⛔ the entry renders the constants and spells none of them itself', () => {
    const source = code(readFileSync(join(COMPONENTS, 'AppNoticeEntry.vue'), 'utf8'))
    // ⚑ **Standing rule 8**: copy is rendered from one source. ⛔ A component that spelled its
    // own heading would be the second spelling `WORK_REPORT_MARK`'s docblock already records
    // diverging once.
    expect(source).toContain('THE_APP_IS_THE_AUTHOR')
    expect(source).toContain('APP_NOTICE_MARK')
    expect(source).not.toContain('noticeMeans(')
    expect(source).not.toContain("'This app'")
    // ⛔ **And it never says `You`**, which is the entire reason the component exists.
    expect(source).not.toMatch(/>\s*You\s*</)
  })

  it('⚑ the population is the DISPATCH — the entry is reachable from TranscriptView', () => {
    const view = code(readFileSync(join(COMPONENTS, 'TranscriptView.vue'), 'utf8'))
    expect(view).toContain("item.kind === 'appNotice'")
    // ⚑ Non-vacuity: the folder really does hold the component the view names.
    expect(readdirSync(COMPONENTS)).toContain('AppNoticeEntry.vue')
  })
})
