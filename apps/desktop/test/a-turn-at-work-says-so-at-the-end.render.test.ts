import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import { plainToolName, workingLine } from '../src/renderer/src/lib/working-line'
import type { CreatedSession, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * While a turn runs, whatever started it, the end of the conversation says so: a quiet "working…",
 * with the tool it is running when there is one. It goes when the turn ends, never sits beside the
 * model's thinking or its reply as they arrive, and is announced once rather than at every tool.
 */

const AT = 1_791_300_000_000

const META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/freeze-clock',
  providerHome: '/homes/claude',
  profileId: 'worker',
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
  for (const event of events) applyEvent(r.transcript, event)
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
 * `not.toContain('BroBot')` over a pane's markup is answered by a COMMENT and never by a word on
 * screen (`a-source-census-must-strip-prose-before-it-asserts`, one surface over).
 */
const visible = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const WORKING = { type: 'status', state: 'working' } as TranscriptEvent
const IDLE = { type: 'status', state: 'idle' } as TranscriptEvent
const aNote = {
  type: 'user_turn',
  text: 'W4 here: the review page is ready to open.',
  attribution: 'app_authored',
  relayedFrom: 'sess_pm',
  relayedFromProfile: 'brobot',
} as TranscriptEvent
const aPersonsWords = { type: 'user_turn', text: 'the button is disabled' } as TranscriptEvent
const call = (id: string, name: string): TranscriptEvent =>
  ({ type: 'tool_call', id, name, summary: '{}' }) as TranscriptEvent
const result = (id: string): TranscriptEvent =>
  ({ type: 'tool_result', id, summary: 'done', ok: true }) as TranscriptEvent

const line = (markup: string): string | null => {
  const found = /data-cy="transcript-working"[^>]*>([\s\S]*?)<\/p>/.exec(visible(markup))
  return found === null
    ? null
    : found[1]!
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

describe('a turn at work says so at the end of the conversation', () => {
  it('⚑ a turn another agent’s note started, running a tool: working… and the tool', async () => {
    expect(line(await pane([aNote, WORKING, call('c1', 'Bash')]))).toBe('working… running Bash')
  })

  it('⚑ a turn a person’s words started, running a server’s tool: by its own name', async () => {
    expect(line(await pane([aPersonsWords, WORKING, call('c1', 'mcp__brobot__give_work')]))).toBe(
      'working… running give_work',
    )
  })

  it('⚑ between tools it says working… alone', async () => {
    expect(line(await pane([aNote, WORKING, call('c1', 'Grep'), result('c1')]))).toBe('working…')
  })

  it('⛔ it goes when the turn ends', async () => {
    const ended = [
      aNote,
      WORKING,
      call('c1', 'Bash'),
      result('c1'),
      { type: 'assistant_message', text: 'Both designs are ready.' } as TranscriptEvent,
      { type: 'turn', state: 'completed' } as TranscriptEvent,
      IDLE,
    ]
    expect(line(await pane(ended))).toBeNull()
  })

  it('⛔ a conversation with no turn running shows nothing', async () => {
    expect(line(await pane([aPersonsWords, IDLE]))).toBeNull()
    expect(line(await pane([]))).toBeNull()
  })

  it('⛔ never beside the model’s thinking or its reply while they arrive', async () => {
    const thinking = { type: 'thinking', phase: 'delta', text: 'weighing it' } as TranscriptEvent
    const markup = await pane([aNote, WORKING, thinking])
    expect(line(markup)).toBeNull()
    expect(visible(markup)).toContain('data-cy="thinking-entry"')
    const writing = { type: 'assistant_delta', text: 'Both designs' } as TranscriptEvent
    expect(line(await pane([aNote, WORKING, call('c1', 'Bash'), result('c1'), writing]))).toBeNull()
  })

  it('⚑ only the constant word is announced; the tool beside it is not', async () => {
    const markup = visible(await pane([aNote, WORKING, call('c1', 'Bash')]))
    expect(markup).toMatch(/<span role="status"[^>]*>working…<\/span>/)
    expect(markup).toMatch(/data-cy="transcript-working-tool"[^>]*>\s*running Bash\s*</)
  })
})

describe('the rule, alone', () => {
  it('⚑ a tool its turn left unfinished is not running', () => {
    expect(workingLine(true, [])).toEqual({ tool: null })
    expect(workingLine(false, [])).toBeNull()
    expect(plainToolName('Bash')).toBe('Bash')
    expect(plainToolName('mcp__a_server__a_tool')).toBe('a_tool')
    expect(plainToolName('mcp__')).toBe('mcp__')
  })
})
