import { MOVE_SEND_UNCONFIRMED } from '../src/shared/move-request'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { DEFAULT_PROFILE_LABEL } from '../src/shared/runtime-ipc'
import type { AgentIdentity, CreatedSession, TranscriptEvent } from '../src/shared/runtime-ipc'
import { MAILBOX_ENDINGS } from '../src/shared/mailbox'
import { UNDRIVEN_SENTENCES, derivePieces } from '../src/shared/tasks'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import QueuedMessage from '../src/renderer/src/components/QueuedMessage.vue'
import SessionBot from '../src/renderer/src/components/SessionBot.vue'
import SessionDrawer from '../src/renderer/src/components/SessionDrawer.vue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type QueuedItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { createWindow } from '../src/renderer/src/lib/transcript-window'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import { aNoticeALaterFactRetracted } from '../src/main/runtime/reply-rails'

// These SSR checks read expanded row details; browser controls exercise the real fold.
vi.mock('../src/renderer/src/components/OutsideCard.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup(_, { slots }) {
        return () => h('div', slots.default?.())
      },
    }),
  }
})

/**
 * 🔴 **537 · two rows in one transcript that said the wrong thing about themselves.**
 *
 * ⚠️ **Both were photographed, in one window, in one minute** — a project manager's conversation
 * while the tier ran for real (`537-assets/not-sent-and-claude-13-29.png`):
 *
 *  - **A** — a held row reading *not sent · waiting for the turn to end*, with the next assistant
 *    turn saying *"a new formal task arrived (`task_3b480f7e`)"*. ⛔ **The app hands the WORK over
 *    at queue time and the WORDS at the next turn boundary**, so the row was describing the second
 *    and a reader took it for the first.
 *  - **B** — every assistant turn authored `claude`, in a conversation the rail, the `PROFILE`
 *    field and the AGENTS list all called `project-manager`. ⛔ **Two answers to *who is this***.
 *
 * ⚑ **SSR renders — no DOM, no clicks, no computed styles** (086), so every negative here is paired
 * with a positive: `not.toContain('claude')` also passes against a component that rendered nothing.
 */

// ── the fixtures ────────────────────────────────────────────────────────────────────────────────

const AT = 1_700_000_000_000

/** What `RuntimeHost.queueMessage` publishes on its BUSY branch — see `runtime-host.ts`. */
const queuedEvent = (over: Partial<Record<string, unknown>> = {}): TranscriptEvent =>
  ({
    type: 'message_queued',
    messageId: 'msg_1',
    kind: 'work',
    text: 'Add i18n to freeze-clock: English, French and Spanish.',
    relayedFrom: 'sess_brobot',
    ...over,
  }) as unknown as TranscriptEvent

/**
 * ⛔ **What `recordTheGive` publishes IMMEDIATELY AFTER it, in the same synchronous stretch** — the
 * owner's `work_given` (D-016; `task_assigned` until then) — and it carries `messageId` exactly when
 * the message is being held (`412`, `379`).
 */
const assignedEvent = (over: Partial<Record<string, unknown>> = {}): TranscriptEvent =>
  ({
    type: 'work_given',
    piece: 'work_3b480f7e',
    label: 'W1.12',
    parent: 'work_root',
    givenBy: 'sess_brobot',
    title: 'Add i18n to freeze-clock',
    brief: 'Add i18n to freeze-clock: English, French and Spanish.',
    messageId: 'msg_1',
    ...over,
  }) as unknown as TranscriptEvent

const endedEvent = (reason: string, over: Partial<Record<string, unknown>> = {}): TranscriptEvent =>
  ({
    type: 'message_unqueued',
    messageId: 'msg_1',
    reason,
    text: 'Add i18n to freeze-clock: English, French and Spanish.',
    ...over,
  }) as unknown as TranscriptEvent

function fold(events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  let ordinal = 0
  for (const event of events) applyEvent(state, event, AT + ordinal, ordinal++)
  return state
}

const kinds = (state: TranscriptState): string[] => state.items.map((item) => item.kind)

const heldRow = (state: TranscriptState): (QueuedItem & { at: number }) | undefined =>
  state.items.find((item) => item.kind === 'queued') as (QueuedItem & { at: number }) | undefined

const renderRow = (item: QueuedItem & { at: number }): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(QueuedMessage as never, { item }) }))

/** The row's own words, taken from the element that carries them and nothing else. */
const stateWords = (markup: string): string => {
  const found = /data-cy="queued-state"[^>]*>([\s\S]*?)<\/span>/.exec(markup)
  if (found === null) throw new Error('this row drew no state at all')
  return found[1]!.replace(/<!--[\s\S]*?-->/g, '').trim()
}

// ── §1 · Defect A ───────────────────────────────────────────────────────────────────────────────

describe('§1 · a held message that has already handed its work over', () => {
  /**
   * 🔴 **The premise, measured rather than asserted about** — and it is the half that makes `not
   * sent` false rather than merely blunt.
   *
   * ⛔ **`derivePieces` is the fold `SessionStore.piecesOwnedBy` answers `list_tasks` from**, so
   * what it says here is what the receiving agent is told the moment the message is queued.
   */
  it('the work is in the agent’s hands while the words are still held', () => {
    const entries = [queuedEvent(), assignedEvent()].map((event, ordinal) => ({
      ordinal,
      at: AT + ordinal,
      event,
    }))
    const given = derivePieces('sess_pm', entries)

    expect(given).toHaveLength(1)
    // ⚑ **`waiting` is `derivePieces`' own word for *the child was busy and the work is being held*.**
    expect(given[0]).toMatchObject({
      piece: 'work_3b480f7e',
      label: 'W1.12',
      state: 'waiting',
      messageId: 'msg_1',
    })
    // ⛔ **And the instruction travels with it** — `list_tasks` carries the piece's brief, so the
    // agent can act on words this row was calling unsent.
    expect(given[0]?.brief).toContain('Add i18n to freeze-clock')
  })

  /**
   * 🔴 **IN THE GAP — after the assignment and BEFORE the delivery** (`assert-in-the-gap-not-after-the-repair`).
   *
   * ⚠️ **This is the instant the photograph caught**, and the one an assertion taken after the
   * delivery cannot see at all.
   */
  it('says where the work IS, and stops claiming the instruction never arrived', async () => {
    const state = fold([queuedEvent(), assignedEvent()])
    const row = heldRow(state)

    expect(row).toMatchObject({ outcome: null, messageId: 'msg_1', label: 'W1.12' })

    const words = stateWords(await renderRow(row!))
    expect(words).toBe('on its list as W1.12 · these words go when the turn ends')
    // The incorrect sentence is absent; the positive above proves the row actually draws
    // content.
    expect(words).not.toContain('not sent')
  })

  /**
   * ⚑ **AFTER the delivery**, which is the other half of the gap and was already right.
   *
   * ⛔ **Nothing a person does is involved**: `runFlush` publishes `message_unqueued: sent` and
   * then `user_turn`, and the fold splices the placeholder out because the turn is the record now.
   */
  it('and when the words finally go, the row goes with them', () => {
    const state = fold([
      queuedEvent(),
      assignedEvent(),
      endedEvent('sent'),
      { type: 'user_turn', text: 'Add i18n to freeze-clock: English, French and Spanish.' },
    ])

    expect(kinds(state)).toEqual(['user'])
    expect(heldRow(state)).toBeUndefined()
  })

  /**
   * ⛔ **The control, and it is the ordinary held message**: a person's own mid-turn words, a
   * routed question, a reply to a busy parent. ⚑ None of them hands work over, so for none of them
   * has anything arrived anywhere — and `not sent` is the true thing to say.
   */
  it('a held message that hands over NO work still says it was not sent', async () => {
    const state = fold([queuedEvent({ messageId: 'msg_2', relayedFrom: undefined })])
    const row = heldRow(state)

    expect(row).toMatchObject({ outcome: null })
    expect(row?.label).toBeUndefined()
    expect(stateWords(await renderRow(row!))).toBe('not sent · waiting for the turn to end')
  })

  /**
   * 🔴 **§1.3 · every way a held message stops being held, and what the row reads in each.**
   *
   * ⛔ **Looped over the SHIPPED vocabulary** (`MAILBOX_ENDINGS`), never over a list written here:
   * `a-loop-over-a-literal-variant-list-is-not-exhaustive`, and the table gains a member the day
   * the vocabulary does rather than passing over it in silence.
   *
   * ⚠️ **The unended one is in the table too**, because `ending: null` is a real answer and not a
   * gap — it is a live host holding the message, and it is what a crash left behind until
   * `settleStrandedMessages` writes `abandoned` at the next launch (`354`, `379`).
   */
  it('every ending has words of its own, and none of them is silence', async () => {
    const READS: Record<string, string> = {
      // ⛔ The row is spliced out and the turn it became is the record — asserted above.
      sent: '',
      cancelled: 'not sent · you cancelled it',
      // ⚠️ **690 · `retracted` has no words of its OWN yet** — the app took back its own notice
      // (R32), and the frontend owns its treatment (the response's GAP). ⛔ A bare WORK row ended
      // `retracted` is a shape the host never writes — it retracts only notices, always with a
      // `detail` — so this pins only that the fallback is still words; the shape it does write is
      // the test below the next one.
      retracted: 'not sent',
      abandoned: 'not sent · the conversation ended first',
      handover: MOVE_SEND_UNCONFIRMED,
    }
    expect(Object.keys(READS).sort()).toEqual([...MAILBOX_ENDINGS].sort())

    for (const ending of MAILBOX_ENDINGS) {
      const state = fold([queuedEvent(), assignedEvent(), endedEvent(ending)])
      const row = heldRow(state)
      if (ending === 'sent') {
        expect(row, 'a sent message stops being a queued item at all').toBeUndefined()
        continue
      }
      expect(row, `the ${ending} row must stay on screen`).toBeDefined()
      expect(stateWords(await renderRow(row!))).toBe(READS[ending])
    }

    // ⚑ **And the arm the vocabulary has no member for** — still held, work handed over.
    const held = heldRow(fold([queuedEvent(), assignedEvent()]))
    expect(stateWords(await renderRow(held!))).toBe(
      'on its list as W1.12 · these words go when the turn ends',
    )
  })

  /**
   * ⚠️ **`detail` is the more specific reason and it still wins** (`216`) — the arm that tells a
   * message abandoned because its file vanished from one abandoned because the conversation ended.
   */
  it('a detailed abandonment keeps its own reason', async () => {
    const state = fold([
      queuedEvent(),
      assignedEvent(),
      endedEvent('abandoned', { detail: 'the file it carried is no longer there' }),
    ])
    expect(stateWords(await renderRow(heldRow(state)!))).toBe(
      'not sent · the file it carried is no longer there',
    )
  })

  /**
   * ⚑ **690 · `retracted` as the host writes it** — a NOTICE carrying its stall report, ended with
   * R32's sentence as its `detail` (`RuntimeHost.takeBackWhatALaterFactMadeFalse`, `703`: here the
   * giver closed the work before it read the notice). ⚠️ Drawn through the existing *not sent ·
   * detail* arm, and nothing new; its own treatment is the frontend's.
   */
  it('a notice this app took back reads "not sent" and the reason it gave', async () => {
    const report = {
      piece: 'work_3b480f7e',
      label: 'W1.12',
      owner: 'sess_ada',
      state: 'stalled',
      stalledBecause: 'turn_ended',
    }
    const words = `W1.12 with Ada is not being worked on: ${UNDRIVEN_SENTENCES.turn_ended}`
    const detail = aNoticeALaterFactRetracted('closed', 'Ada')
    const state = fold([
      queuedEvent({ kind: 'notice', relayedFrom: undefined, work: report, text: words }),
      endedEvent('retracted', { work: report, detail, text: words }),
    ])
    const row = heldRow(state)
    expect(row).toMatchObject({ outcome: 'retracted', detail })
    expect(stateWords(await renderRow(row!))).toBe(`not sent · ${detail}`)
  })

  /**
   * 🔴 **The join refuses to guess, and that is `354`'s rule rather than a defensive check.**
   *
   * ⛔ **`054` pages the transcript**, so a window can hold the give without the row it is
   * about. ⚠️ A join that answered *the oldest row nobody named* would put one message's piece
   * label onto another message's words — which is the defect `413` spent a dispatch removing, one
   * event over.
   */
  it('an assignment for a message this window never saw leaves every row alone', async () => {
    const state = fold([
      queuedEvent({ messageId: 'msg_other' }),
      assignedEvent({ messageId: 'msg_1' }),
    ])
    const row = heldRow(state)

    expect(row?.label).toBeUndefined()
    expect(stateWords(await renderRow(row!))).toBe('not sent · waiting for the turn to end')
    // ⚑ **Paired positive**: the label really was recorded, so the negative above is about the
    // JOIN and not about a give the fold dropped on the floor.
    expect(state.piecesGiven.get('work_3b480f7e')?.label).toBe('W1.12')
  })

  /**
   * 🔴 **And the row with NO NAME AT ALL is the one that would take it** — `354`'s rule in the one
   * shape a strict comparison is needed for.
   *
   * ⛔ **A ledger written before `354` holds `message_queued` rows with no `messageId`.** ⚠️ The
   * ending fold has a deliberate fallback for them — *the oldest unnamed one* — and reaching for
   * that fallback HERE would let a named assignment stamp its number onto words it has nothing to
   * do with. ⚑ An assignment always carries the id it was minted beside, so there is nothing to
   * fall back FOR.
   */
  it('an unnamed row from before messages had names is never joined to a named assignment', async () => {
    const state = fold([queuedEvent({ messageId: undefined }), assignedEvent()])
    const row = heldRow(state)

    expect(row).toMatchObject({ outcome: null })
    expect(row?.messageId).toBeUndefined()
    expect(row?.label).toBeUndefined()
    expect(stateWords(await renderRow(row!))).toBe('not sent · waiting for the turn to end')
  })

  /** ⚠️ **An idle target's give carries no `messageId`** — there is no held row, and none is wanted. */
  it('work that went straight out marks nothing', () => {
    const state = fold([assignedEvent({ messageId: undefined })])
    expect(kinds(state)).toEqual([])
    expect(state.piecesGiven.get('work_3b480f7e')?.label).toBe('W1.12')
  })
})

// ── §2 · Defect B ───────────────────────────────────────────────────────────────────────────────

const META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/freeze-clock',
  providerHome: '/homes/claude',
  profileId: 'project-manager',
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
  // ⚑ D-017b — `process` left `SessionLiveness` with the Info process row.
  liveness: { state: 'live', since: AT },
  hasACommander: false,
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

function record(events: TranscriptEvent[], meta: CreatedSession | null = META): SessionRecord {
  const r = createSessionRecord('sess_1')
  r.meta = meta
  r.phase = 'open'
  for (const event of events) applyEvent(r.transcript, event)
  return r
}

const pane = (over: Record<string, unknown> = {}): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(ConversationPane as never, {
          record: record([
            { type: 'assistant_message', text: 'Progress confirmed.' },
            { type: 'status', state: 'working' },
          ]),
          mode: 'normal' as const,
          debug: false,
          drawerOpen: false,
          drawerTab: 'open',
          models: null,
          draft: '',
          handing: createAttachmentBook().handing(draftKey('sess_1')),
          identities: null,
          ...over,
        }),
    }),
  )

/**
 * ⚑ **What a person actually reads** — the markup with its HTML comments removed.
 *
 * ⛔ **Needed rather than tidy**: this repo's templates carry their reasoning inline, so a raw
 * `not.toContain('BroBot')` over a pane's markup is answered by a COMMENT and never by a word on
 * screen. ⚠️ Same shape as `a-source-census-must-strip-prose-before-it-asserts`, one surface over.
 */
const visible = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

/**
 * ⚑ **The author of a turn, as the meta row draws it** — and `<strong>` alone will not find it:
 * scoped styles stamp a `data-v-…` attribute on the tag, so the census asks for the CLOSING half.
 */
const authors = (markup: string): string[] =>
  [...visible(markup).matchAll(/<strong[^>]*>([^<]*)<\/strong>/g)].map((found) => found[1]!)

const identity = (over: Partial<AgentIdentity> = {}): AgentIdentity =>
  ({
    slug: 'project-manager',
    displayName: null,
    role: null,
    provider: null,
    ...over,
  }) as AgentIdentity

describe('§2 · who is speaking in this conversation', () => {
  /**
   * Messages display the app identity’s role name, such as “Project Manager”, rather than the
   * provider name “claude”. BroBot messages retain “BroBot”.
   *
   * ⛔ **One derivation, and it fed the turn author, the composer's placeholder and its footer.**
   */
  it('names the turn’s author by the identity, not by the provider', async () => {
    const markup = await pane({ identities: [identity()] })

    expect(authors(markup)).toContain('project-manager')
    expect(authors(markup)).not.toContain('claude')
    expect(visible(markup)).toContain('project-manager is working — type to queue a message')
    expect(visible(markup)).not.toContain('claude is working')
  })

  /**
   * ⛔ **The provider was NOT deleted, and this is the pairing that proves it** (`§2.2`).
   *
   * ⚑ **`SessionHeader`'s chip draws the provider**, on this same screen and in this same render
   * — so which provider produced a turn stays legible and the word only stopped being used as a
   * NAME.
   *
   * ⚠️ **This said the chip draws `provider · model · reasoning`, and `578` made that false**
   * (`EXT-010` §1.1): the model and the effort moved to `SessionShelf`'s own cells, which are on
   * this screen too. ⛔ The claim this paragraph makes is about the PROVIDER and is unchanged; the
   * sentence is corrected in the commit that moved the other two (standing rule 19's corollary).
   */
  it('and the provider is still on the page, where provider facts live', async () => {
    const markup = await pane({ identities: [identity()] })
    // ⚑ The chip itself: its dot, then its word, then its own close.
    const chip = /data-cy="provider-chip"[^>]*>[\s\S]*?<\/span>[^<]*<\/span>/.exec(visible(markup))

    expect(chip, 'this screen drew no provider chip at all').not.toBeNull()
    expect(chip![0]).toContain('claude')
  })

  /**
   * ⚑ **A display name is the field a person sets, and one edit moves every surface at once** —
   * which is `agentName`'s whole shape and the answer to *"it's better if they say Project
   * Manager"*.
   */
  it('reads the display name the moment an identity has one', async () => {
    const markup = await pane({ identities: [identity({ displayName: 'Project Manager' })] })

    expect(authors(markup)).toContain('Project Manager')
    expect(visible(markup)).toContain('Project Manager is working — type to queue a message')
  })

  /**
   * ⛔ **The null that must not reach `agentName`** — a record this window made and the host has
   * not answered for yet. ⚑ Naming it BroBot on the strength of that null would invent an
   * identity; a generic word is the absence of one, said out loud.
   */
  it('says a generic word when there is no conversation yet, and never invents an identity', async () => {
    const markup = await pane({
      record: record([{ type: 'assistant_message', text: 'Progress confirmed.' }], null),
    })

    // ⚑ **Paired positive**: the turn really drew, so the negatives below are about the WORD and
    // not about a pane that rendered nothing (086).
    expect(visible(markup)).toContain('Progress confirmed.')
    expect(authors(markup)).toContain('Assistant')
    expect(authors(markup)).not.toContain('BroBot')
    expect(authors(markup)).not.toContain('project-manager')
  })

  /** ⚑ **The plate at the top of the Open tab is the same correction** — it read the provider too. */
  it('the plate above the open tab draws the name it is handed', async () => {
    const facets = { doing: 'working', being: 'live', needing: 'nothing' }
    const markup = await renderToString(
      createSSRApp({
        render: () => h(SessionBot as never, { facets, who: 'project-manager' }),
      }),
    )
    expect(visible(markup)).toContain('project-manager')
    expect(visible(markup)).not.toContain('claude')
  })

  /**
   * 🔴 **And the drawer is what HANDS it that name**, which the component above cannot say.
   *
   * ⛔ **A prop census asks who is given a name; this asks what the giver derived it from** — the
   * same split as `§3`, on the one surface `537` §5 leaves in scope: the WORD the panel uses for
   * an agent, not its contents.
   */
  it('the drawer derives that name from the identity and not from the provider', async () => {
    const markup = await renderToString(
      createSSRApp({
        render: () =>
          h(SessionDrawer as never, {
            session: META,
            state: createTranscript(),
            shown: createTranscript(),
            mode: 'normal',
            window: createWindow(),
            sessionRef: META.ref,
            status: 'working',
            ended: false,
            models: null,
            waiting: 0,
            tab: 'open',
            fit: 'docked',
            facets: { doing: 'working' as const, being: 'live' as const },
            work: null,
            identities: [identity()],
          }),
      }),
    )
    const plate = /data-cy="session-bot"[\s\S]*?<\/div>/.exec(visible(markup))

    expect(plate, 'the open tab drew no plate at all').not.toBeNull()
    expect(plate![0]).toContain('project-manager')
    expect(plate![0]).not.toContain('claude')
  })
})

// ── §3 · how far the naming defect reaches ──────────────────────────────────────────────────────

const COMPONENTS = fileURLToPath(new URL('../src/renderer/src/components/', import.meta.url))

/**
 * ⚑ **Every `who` a component is HANDED, as a census reads them** — `<Thing who="…" />` and
 * `:who="…"` alike, so a literal and a binding are one population rather than two greps.
 */
function whoBindings(source: string): string[] {
  return [...source.matchAll(/(?:^|\s):?who="([^"]*)"/g)].map((found) => found[1]!.trim())
}

describe('§3 · every surface that puts a name on an agent’s words', () => {
  /**
   * 🔴 **The control, and it plants TWO** (standing rule 12) — a reader that found only the first
   * binding in a file would pass a one-planted control and miss exactly what this census exists
   * to catch.
   */
  it('the census reads every binding in a file, not the first', () => {
    expect(
      whoBindings(
        '<A :who="pane.who" />\n  <B who="sub-agent" />\n<C :who="props.entry.provider"/>',
      ),
    ).toEqual(['pane.who', 'sub-agent', 'props.entry.provider'])
  })

  /**
   * 🔴 **§4.4 · the shape that makes the negative worth something.**
   *
   * ⛔ **The question is not *"does anything say `claude`"*** — that word is a legitimate provider
   * fact in half a dozen places. ⚠️ **It is *"what does each surface that NAMES A SPEAKER derive
   * that name from"***, and the answer is one of exactly three kinds:
   *
   *  - **`identity`** — it asks {@link agentName}, the app's one naming function (`449`).
   *  - **`not-an-identity`** — the row genuinely has none. A provider sub-agent is not an agent of
   *    ours. ⚠️ **678 · a recording left this kind**: `LibraryEntry` carried no `profileId` until
   *    `671` (G4a), so `ReadingPane` headed its replies with the provider; it now binds `who` like the
   *    live pane, and its provider fallback is exactly the rows with no identity of ours — found in
   *    the user's OWN provider home, which `profileLabel`'s note forbids naming, or restored.
   *  - **`pre-session`** — a launcher door, where there is no conversation and no roster yet.
   *
   * 🔴 **538 · one of the two `pre-session` rows is GONE, and this census is how anybody would
   * know.** ⛔ `537` F6 left `StartAsAgent` naming the identity by SLUG and gave the reason
   * *"neither component is handed the roster"*; `538` measured that this component already binds
   * to a window-scoped singleton for its project list, so the agent one costs no prop — and its
   * `who` now comes through {@link agentName} like every other identity surface. ⚠️ **The binding
   * `props.profileSlug` therefore stopped existing**, the equality below went RED on the
   * population, and the table was re-aimed rather than widened.
   *
   * ⛔ **`NewConversation`'s literal `BroBot` STAYS `pre-session`, and that is a decision.** It is
   * the front door, where no identity has been chosen at all — and `agentName(DEFAULT_PROFILE_ID,
   * …)` answers *BroBot (default)*, so pointing it here would change shipped COPY on the one
   * surface `535` is drawing. `538` reports it instead.
   *
   * ⛔ **A new surface must land in this table** rather than picking a fourth answer quietly —
   * which is the whole of `an-instrument-that-can-go-quiet-without-saying-so`.
   *
   * 🔴 **545 · a surface can now name an identity WITHOUT being handed a `who`, and this census
   * cannot see one.** ⛔ `RelayedEntry` and `QueuedMessage` compute their own heading from
   * `relayed-turn.ts`, so the population below does not grow and the question *what does each
   * surface that names an actor derive that name from* would have gone quiet for two of them.
   * ⚑ **The answer landed in a census rather than nowhere** —
   * `a-relayed-row-names-who-relayed-it.render.test.ts` §8, whose population is `TranscriptView`'s
   * own dispatch and whose `identity` arm asserts the transitive derivation this one asserts
   * directly. ⚠️ The two are joined by the assertion below, so deleting either is visible from the
   * other.
   */
  it('and each of them derives its name from one of three kinds, named here', () => {
    const KINDS: Record<string, 'identity' | 'not-an-identity' | 'pre-session'> = {
      // 537 — `ConversationPane.who` is `agentName(…, identities)` over its profile — ⚑ asked in
      // one spelling since `667` (`agentName`'s own fold since `671`), and derived from the `ownAgent`
      // the cards are handed.
      // 538 — and `StartAsAgent.who` is `agentName(props.profileSlug, …)`, which is why this key
      // now covers two components rather than one.
      // ⚑ 678 — and `ReadingPane.who`, over `agentName(props.entry.profileId, …)`: three now.
      // ⚑ D-017b — `ConversationPane` and `SessionDrawer` ask it through `whoIsIn`, which is
      // `agentName` over the profile the conversation runs as (the next test pins it).
      // The recovery window's reader binds it too: the agent name the restored copy holds, and
      // the provider's name only for a conversation that copy ran as nobody.
      who: 'identity',
      // ⚑ D-017b — 701's `ownAgent` binding went with `KeptOpenPane`: a conversation the quit left
      // open opens in the one full view, whose `who` is the row above.
      'props.who': 'identity',
      // A child’s graph node is named by `CastCard.name` through `GraphNode`’s `name`,
      // without a `who` binding. A provider sub-agent’s own pane is distinct: it is not an
      // app-owned agent and has no identity.
      'sub-agent': 'not-an-identity',
      // The front door, with no identity chosen yet — a `537` finding `538` deliberately left,
      // and `545` §5 looked at again and left for the same reason. See the pin below.
      BroBot: 'pre-session',
    }

    const found = new Map<string, string[]>()
    for (const name of readdirSync(COMPONENTS).filter((one) => one.endsWith('.vue'))) {
      for (const binding of whoBindings(readFileSync(join(COMPONENTS, name), 'utf8'))) {
        found.set(binding, [...(found.get(binding) ?? []), name])
      }
    }

    // ⚑ **Paired positive**: the census really walked the tree, so the equality below is about the
    // population rather than about an empty read.
    expect(found.size).toBeGreaterThan(3)
    expect([...found.keys()].sort()).toEqual(Object.keys(KINDS).sort())
    // 🔴 **545 · the join**: the two transcript entries that name an identity are absent from this
    // population BY CONSTRUCTION — they BIND no `who` to anything below them — and the other census
    // is where they are answered for. ⚠️ **658 · each is now HANDED one**, as its RECIPIENT
    // (*"Ada to BroBot"*) — ⚑ **667 · as `:own-agent`, the NAME or `null`, and no longer `:who`**,
    // whose census is `the-three-sentences-beside-the-cards.test.ts` §2 — and still asks the one
    // naming function for its SENDER. ⛔ Asserted rather than commented, so a day when one of them starts taking a
    // `who` (and therefore belongs here) fails here instead of being covered twice by neither.
    for (const owner of ['RelayedEntry.vue', 'QueuedMessage.vue']) {
      const source = readFileSync(join(COMPONENTS, owner), 'utf8')
      expect(
        whoBindings(source),
        `${owner} is handed a who and this table does not name it`,
      ).toEqual([])
      expect(source, `${owner} stopped asking the one naming function`).toContain('relayedSender(')
    }
    // ⛔ **And no surface that names a speaker reads a PROVIDER, except the ones that have no
    // identity to read** — which is the sentence `537` was sent to make true.
    for (const [binding, kind] of Object.entries(KINDS)) {
      if (kind !== 'identity') continue
      expect(binding, `${String(found.get(binding))} names a speaker by its provider`).not.toMatch(
        /provider/,
      )
    }
  })

  /**
   * 🔴 **A binding is a FORWARD; this is the census of what the name is DERIVED from** — and the
   * half of `§3` that a list of props cannot answer.
   *
   * ⛔ **`:who="who"` says nothing about where `who` came from**, which is exactly how five
   * surfaces came to say `claude`: the binding never changed and the computed behind it read
   * `meta.provider`. ⚠️ **So the two components that OWN a name are asked directly**, with prose
   * stripped — `a-source-census-must-strip-prose-before-it-asserts`, because every one of these
   * files quotes the word it retired.
   */
  it('and the two that OWN a name ask the app’s one naming function for it', () => {
    /** ⚑ Code only: block comments, line comments and template comments all go. */
    const code = (source: string): string =>
      source
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')

    // ⚑ **538 · `StartAsAgent.vue` joined this list**, because it now OWNS a name rather than
    // forwarding a slug — and a component that owns one has to ask the same function the other two
    // do, or the population census above would pass while the derivation behind the binding said
    // something else. ⛔ That is the exact gap this pair of assertions exists for (`537` §3.2).
    // 🔴 **538 · the second half is a declared TABLE now, and not a banned substring.**
    //
    // ⛔ **`not.toContain('displayName ?? ')` was right while both owners named nothing else.**
    // `StartAsAgent.vue` joined the list and it draws a PROJECT picker — `one.displayName ??
    // one.slug` — which is a different population with its own ruling (`370`'s recommendation,
    // adopted for projects at `RuntimeHost`). ⚠️ **Banning the substring would make this census
    // refuse a correct line; deleting it would let the identity spelling back in.** ⚑ So every
    // `<x>.displayName ??` an owner holds is DECLARED, with what it names — which is
    // `a-source-census-must-strip-prose-before-it-asserts`' sibling rule: say what the population
    // is, rather than banning a word that belongs to two of them.
    const FALLBACKS_AN_OWNER_MAY_HOLD: Record<string, string> = {
      // `StartAsAgent`'s project `<option>` — a project, not an agent, and `538` did not touch it.
      one: 'a project in the picker, which names itself and never an identity',
    }
    const spelt = (source: string): string[] =>
      [...source.matchAll(/([A-Za-z_$][\w$.]*)\.displayName \?\?/g)].map((found) => found[1]!)

    // ⚑ **678 · `ReadingPane.vue` joined**: it OWNS a name since `671` put `profileId` on its entry.
    // ⚑ **D-017b · the live pane and its drawer ask through `whoIsIn`** (`lib/session-record.ts`) —
    // ONE derivation for both, `agentName` over the profile the conversation runs as, and its
    // provider's name only for a conversation this app ran as nobody (a person's own, or a
    // bundle's), which is `ReadingPane`'s `not-an-identity` fallback one surface over.
    const ASKS: Record<string, string> = {
      'ConversationPane.vue': 'whoIsIn(',
      'SessionDrawer.vue': 'whoIsIn(',
      'StartAsAgent.vue': 'agentName(',
      'ReadingPane.vue': 'agentName(',
    }
    const record = code(readFileSync(join(COMPONENTS, '..', 'lib', 'session-record.ts'), 'utf8'))
    expect(record, 'whoIsIn stopped asking agentName').toContain(
      'return profile === null ? providerName(meta.provider) : agentName(profile, identities)',
    )
    expect(record).toContain('if (meta === null || meta.ranAsNobody !== undefined) return null')
    expect(spelt(record), 'whoIsIn spells a display-name fallback').toEqual([])
    for (const [owner, asks] of Object.entries(ASKS)) {
      const source = code(readFileSync(join(COMPONENTS, owner), 'utf8'))
      expect(source, `${owner} does not ask ${asks}`).toContain(asks)
      // ⛔ **And it must not be `displayName ?? slug` written a second time for an IDENTITY**,
      // which is the expression `a-row-that-says-who-is-in-it.test.ts` §3 greps `SideRail` for.
      for (const subject of spelt(source)) {
        expect(
          FALLBACKS_AN_OWNER_MAY_HOLD,
          `${owner} spells a display-name fallback over \`${subject}\` that nobody has declared`,
        ).toHaveProperty(subject)
      }
    }

    // ⚑ **The control, and it plants TWO** (standing rule 12): a reader that found only the first
    // fallback in a file would pass a one-planted control and miss the second spelling — which is
    // the defect this half exists to catch.
    expect(spelt('a = identity.displayName ?? x\nb = props.row.displayName ?? y')).toEqual([
      'identity',
      'props.row',
    ])
    // ⛔ …and the undeclared one really is refused, so the loop above is a measurement rather than
    // a walk over an empty list.
    expect(FALLBACKS_AN_OWNER_MAY_HOLD).not.toHaveProperty('identity')

    // ⚑ **The planted control, and it is the file this census would be vacuous without**:
    // `SessionContext` reads `provider` on the same screen and is NOT naming anybody — it is a
    // capability KEY — so a census that simply banned the word would have to call it a defect.
    const context = code(readFileSync(join(COMPONENTS, 'SessionContext.vue'), 'utf8'))
    expect(context).toContain('provider')
    expect(whoBindings(context)).toEqual([])
  })

  /**
   * 🔴 **545 §5 · the last literal that names an actor, PINNED rather than repaired.**
   *
   * ## ⛔ The decision, and it is the one `538` made for the reason `538` gave
   *
   * ⚠️ **`NewConversation` always launches {@link DEFAULT_PROFILE_ID}** — `417` removed the profile
   * name box, so the front door is BroBot's by construction and the literal is not wrong. ⛔
   * Pointing it at {@link agentName} would draw *BroBot (default)* on the one surface `535` is
   * redrawing, which is a shipped COPY change wearing a consistency argument.
   *
   * ## ⚑ But the worry `545` §5 states is real and costs one assertion to close
   *
   * > *"it is the same word as this dispatch's constant, and two literals spelling one name is how
   * > they come to disagree."*
   *
   * 🔴 **So the literal is bound to {@link DEFAULT_PROFILE_LABEL} rather than left free.** ⛔ The
   * day somebody renames the default identity's label, this fails — which is the whole of
   * `331`'s remedy: *a constant spelled in two places is pinned in a test rather than refactored
   * into a third*.
   */
  it('⚑ the front door’s literal is the default identity’s own word', () => {
    // ⚑ **Prose stripped**, because this file quotes the literal it is about — the sibling rule to
    // `a-source-census-must-strip-prose-before-it-asserts`, and the reason the test above does it.
    const source = readFileSync(join(COMPONENTS, 'NewConversation.vue'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const literals = whoBindings(source)
    expect(literals, 'the front door stopped naming anybody').toEqual(['BroBot'])
    expect(
      DEFAULT_PROFILE_LABEL.startsWith(literals[0]!),
      `the default identity is called “${DEFAULT_PROFILE_LABEL}” and the front door says “${literals[0]!}”`,
    ).toBe(true)
    // ⛔ **And it is the DEFAULT it launches**, which is what makes the literal correct at all —
    // a door that let a person choose an identity could not spell one.
    expect(source).toContain('profileId: DEFAULT_PROFILE_ID')
  })
})
