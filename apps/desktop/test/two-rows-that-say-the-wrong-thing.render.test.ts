import type { TranscriptEvent } from '../src/shared/conversation-events'
import { MOVE_SEND_UNCONFIRMED } from '../src/shared/move-request'
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { AgentIdentity, CreatedSession } from '../src/shared/runtime-ipc'
import { MAILBOX_ENDINGS } from '../src/shared/mailbox'
import { UNDRIVEN_SENTENCES, derivePieces } from '../src/shared/tasks'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import QueuedMessage from '../src/renderer/src/components/QueuedMessage.vue'
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

/** What `recordTheGive` publishes right after it; it carries `messageId` while the message is held. */
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

describe('a held message that has already handed its work over', () => {
  it('the work is in the agent’s hands while the words are still held', () => {
    const entries = [queuedEvent(), assignedEvent()].map((event, ordinal) => ({
      ordinal,
      at: AT + ordinal,
      event,
    }))
    const given = derivePieces('sess_pm', entries)

    expect(given).toHaveLength(1)
    expect(given[0]).toMatchObject({
      piece: 'work_3b480f7e',
      label: 'W1.12',
      state: 'waiting',
      messageId: 'msg_1',
    })
    expect(given[0]?.brief).toContain('Add i18n to freeze-clock')
  })

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

  it('a held message that hands over NO work still says it was not sent', async () => {
    const state = fold([queuedEvent({ messageId: 'msg_2', relayedFrom: undefined })])
    const row = heldRow(state)

    expect(row).toMatchObject({ outcome: null })
    expect(row?.label).toBeUndefined()
    expect(stateWords(await renderRow(row!))).toBe('not sent · waiting for the turn to end')
  })

  it('every ending has words of its own, and none of them is silence', async () => {
    const READS: Record<string, string> = {
      sent: '',
      cancelled: 'not sent · you cancelled it',
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
  })

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

  it('an assignment for a message this window never saw leaves every row alone', async () => {
    const state = fold([
      queuedEvent({ messageId: 'msg_other' }),
      assignedEvent({ messageId: 'msg_1' }),
    ])
    const row = heldRow(state)

    expect(row?.label).toBeUndefined()
    expect(stateWords(await renderRow(row!))).toBe('not sent · waiting for the turn to end')
    expect(state.piecesGiven.get('work_3b480f7e')?.label).toBe('W1.12')
  })

  it('an unnamed row from before messages had names is never joined to a named assignment', async () => {
    const state = fold([queuedEvent({ messageId: undefined }), assignedEvent()])
    const row = heldRow(state)

    expect(row).toMatchObject({ outcome: null })
    expect(row?.messageId).toBeUndefined()
    expect(row?.label).toBeUndefined()
    expect(stateWords(await renderRow(row!))).toBe('not sent · waiting for the turn to end')
  })

  it('work that went straight out marks nothing', () => {
    const state = fold([assignedEvent({ messageId: undefined })])
    expect(kinds(state)).toEqual([])
    expect(state.piecesGiven.get('work_3b480f7e')?.label).toBe('W1.12')
  })
})

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

/** The markup without HTML comments: templates carry prose that would answer a negative. */
const visible = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

/** The author of each turn, as the meta row's `<strong>` draws it. */
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

describe('who is speaking in this conversation', () => {
  it('names the turn’s author by the identity, not by the provider', async () => {
    const markup = await pane({ identities: [identity()] })

    expect(authors(markup)).toContain('project-manager')
    expect(authors(markup)).not.toContain('claude')
    expect(visible(markup)).toContain('project-manager is working — type to queue a message')
    expect(visible(markup)).not.toContain('claude is working')
  })

  it('and the provider is still on the page, where provider facts live', async () => {
    const markup = await pane({ identities: [identity()] })
    const chip = /data-cy="provider-chip"[^>]*>[\s\S]*?<\/span>[^<]*<\/span>/.exec(visible(markup))

    expect(chip, 'this screen drew no provider chip at all').not.toBeNull()
    expect(chip![0]).toContain('claude')
  })

  it('reads the display name the moment an identity has one', async () => {
    const markup = await pane({ identities: [identity({ displayName: 'Project Manager' })] })

    expect(authors(markup)).toContain('Project Manager')
    expect(visible(markup)).toContain('Project Manager is working — type to queue a message')
  })

  it('says a generic word when there is no conversation yet, and never invents an identity', async () => {
    const markup = await pane({
      record: record([{ type: 'assistant_message', text: 'Progress confirmed.' }], null),
    })

    expect(visible(markup)).toContain('Progress confirmed.')
    expect(authors(markup)).toContain('Assistant')
    expect(authors(markup)).not.toContain('BroBot')
    expect(authors(markup)).not.toContain('project-manager')
  })

  it('the drawer derives that name from the identity and not from the provider', async () => {
    const markup = await renderToString(
      createSSRApp({
        render: () =>
          h(SessionDrawer as never, {
            session: META,
            state: createTranscript(),
            shown: createTranscript(),

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
