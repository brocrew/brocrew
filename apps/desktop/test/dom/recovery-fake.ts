import type {
  MessagePath,
  MessagePathAsk,
  MessagePathTarget,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import type {
  HistoryConversation,
  HistoryEvent,
  RecoveryBridge,
  StartupVerdict,
} from '../../src/shared/recovery'

/**
 * A scripted `window.recovery` for the recovery window's tests and look scenes. It answers the
 * verdicts it was given, ticks the progress it was given before each restore or return, pushes
 * verdicts when a test delivers them, and records every call so a test can say what was pressed.
 */
export interface RecoveryScript {
  /** What `verdict()` answers. */
  readonly verdict: StartupVerdict
  /** What `restore()` answers; defaults to the first verdict. */
  readonly afterRestore?: StartupVerdict
  /** What `returnToNewer()` answers; defaults to the first verdict. */
  readonly afterReturn?: StartupVerdict
  /** What `retry()` answers; defaults to the first verdict. */
  readonly afterRetry?: StartupVerdict
  /** Progress ticks sent before a restore or a return answers, as [done, total]. */
  readonly progress?: readonly (readonly [number, number])[]
  /** When set, a restore or return waits for this before it answers. */
  readonly hold?: Promise<void>
  /** When set, `verdict()` waits for this before it answers. */
  readonly verdictHold?: Promise<void>
  /** When set, `verdict()` rejects with this. */
  readonly verdictError?: Error
  /** When set, subscribing to progress throws this, as a broken preload would. */
  readonly onProgressError?: Error
  /** When it returns a promise, that history read waits for it before answering. */
  readonly holdRead?: (call: RecoveryCall) => Promise<void> | undefined
  /** The copy's conversations, or what each list read answers, by its number from 1. */
  readonly conversations?:
    readonly HistoryConversation[] | ((read: number) => readonly HistoryConversation[])
  /** Each conversation's events with their times, by id. */
  readonly transcripts?: Readonly<Record<string, readonly HistoryEvent[]>>
  /** What main answers for a message's paths; by default every text names nothing. */
  readonly paths?: (ask: MessagePathAsk) => MessagePath[]
  /** When set, asking about paths rejects with this, as main does outside the history. */
  readonly pathsError?: Error
}

export type RecoveryCall =
  | { readonly call: 'verdict' }
  | { readonly call: 'restore'; readonly checkpointId: string }
  | { readonly call: 'returnToNewer' }
  | { readonly call: 'retry' }
  | { readonly call: 'quit' }
  | { readonly call: 'zone' }
  | { readonly call: 'conversations' }
  | { readonly call: 'transcript'; readonly id: string }

export interface FakeRecoveryBridge extends RecoveryBridge {
  readonly calls: RecoveryCall[]
  /** Every ask about a message's paths, and every path shown, apart from `calls`. */
  readonly pathAsks: MessagePathAsk[]
  readonly pathsShown: MessagePathTarget[]
  /** Pushes a verdict to every `onVerdict` listener, as main does after a step commits. */
  deliver(verdict: StartupVerdict): void
}

export function fakeRecoveryBridge(script: RecoveryScript): FakeRecoveryBridge {
  const calls: RecoveryCall[] = []
  const listeners = new Set<(done: number, total: number) => void>()
  const verdictListeners = new Set<(verdict: StartupVerdict) => void>()
  let listReads = 0

  async function read<T>(call: RecoveryCall, answer: () => T): Promise<T> {
    calls.push(call)
    const held = script.holdRead?.(call)
    if (held) await held
    return answer()
  }

  async function withProgress(answer: StartupVerdict | undefined): Promise<StartupVerdict> {
    for (const [done, total] of script.progress ?? []) {
      for (const listener of listeners) listener(done, total)
      await Promise.resolve()
    }
    if (script.hold) await script.hold
    return answer ?? script.verdict
  }

  const pathAsks: MessagePathAsk[] = []
  const pathsShown: MessagePathTarget[] = []

  return {
    calls,
    pathAsks,
    pathsShown,
    async resolveMessagePaths(ask) {
      pathAsks.push(ask)
      if (script.pathsError) throw script.pathsError
      return script.paths?.(ask) ?? ask.texts.map((text) => ({ text, found: false }))
    },
    async revealMessagePath(target) {
      pathsShown.push(target)
      return { ok: true, path: `/Users/someone/copy/${target.text}` }
    },
    deliver(verdict) {
      for (const listener of verdictListeners) listener(verdict)
    },
    async verdict() {
      calls.push({ call: 'verdict' })
      if (script.verdictHold) await script.verdictHold
      if (script.verdictError) throw script.verdictError
      return script.verdict
    },
    restore(checkpointId) {
      calls.push({ call: 'restore', checkpointId })
      return withProgress(script.afterRestore)
    },
    returnToNewer() {
      calls.push({ call: 'returnToNewer' })
      return withProgress(script.afterReturn)
    },
    async retry() {
      calls.push({ call: 'retry' })
      return script.afterRetry ?? script.verdict
    },
    onProgress(listener) {
      if (script.onProgressError) throw script.onProgressError
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onVerdict(listener) {
      verdictListeners.add(listener)
      return () => verdictListeners.delete(listener)
    },
    async zone() {
      calls.push({ call: 'zone' })
      return null
    },
    async quit() {
      calls.push({ call: 'quit' })
    },
    history: {
      conversations() {
        listReads += 1
        const at = listReads
        return read({ call: 'conversations' }, () =>
          typeof script.conversations === 'function'
            ? script.conversations(at)
            : (script.conversations ?? []),
        )
      },
      transcript(id) {
        return read({ call: 'transcript', id }, () => script.transcripts?.[id] ?? [])
      },
    },
  }
}

/* Fake data shared by the tests and the look scenes. */

export const COPY_AT = '2026-10-10T09:00:00.000Z'

export const NEWER_WITH_A_COPY: StartupVerdict = {
  kind: 'newer',
  workspace: '/Users/someone/Library/Application Support/BroBot',
  newer: { inTheDatabase: 8, inTheBuild: 7, madeBy: { appVersion: '0.2.0' } },
  offers: { id: 'checkpoint-7', createdAt: COPY_AT, bytes: 48_000_000 },
}

export const NEWER_WITHOUT_A_COPY: StartupVerdict = {
  kind: 'newer',
  workspace: '/Users/someone/Library/Application Support/BroBot',
  newer: { inTheDatabase: 8, inTheBuild: 7, madeBy: null },
  offers: null,
}

export const HISTORY_ONLY: StartupVerdict = {
  kind: 'history-only',
  gate: {
    format: 'brobot-history-only',
    version: 1,
    restoreId: 'restore-1',
    checkpointId: 'checkpoint-7',
    checkpointCreatedAt: COPY_AT,
    installed: [{ live: 'brobot2.sqlite', present: true, sha256: 'ab'.repeat(32) }],
    preserved: 'recovery/preserved/restore-1',
    preservedFiles: [{ live: 'brobot2.sqlite', present: true, sha256: 'cd'.repeat(32) }],
  },
  database: '/Users/someone/Library/Application Support/BroBot/brobot2.sqlite',
}

const DAY = 86_400_000
const COPY_MS = Date.parse(COPY_AT)

/** Gives events the times they were recorded at, a minute apart, ending an hour before the copy. */
function timed(events: readonly TranscriptEvent[]): readonly HistoryEvent[] {
  const start = COPY_MS - 3_600_000 - events.length * 60_000
  return events.map((event, index) => ({ event, at: start + index * 60_000 }))
}

export const CONVERSATIONS: readonly HistoryConversation[] = [
  {
    id: 'conv-bakery',
    title: 'W1 · Bakery website',
    agent: 'BroBot',
    provider: 'claude',
    createdAt: COPY_MS - 3 * DAY,
    updatedAt: COPY_MS - 2 * 3_600_000,
  },
  {
    id: 'conv-header',
    title: 'W1.2 · Landing page header',
    agent: 'Ada',
    provider: 'claude',
    createdAt: COPY_MS - 2 * DAY,
    updatedAt: COPY_MS - DAY,
  },
  {
    id: 'conv-form',
    title: 'W1.3 · Contact form',
    agent: 'Ali',
    provider: 'codex',
    createdAt: COPY_MS - 2 * DAY,
    updatedAt: COPY_MS - 2 * DAY,
  },
]

/** A short exchange that ends with a request left unanswered, the card a copy must not offer. */
export const HEADER_EVENTS: readonly HistoryEvent[] = timed([
  { type: 'status', state: 'idle' } as never,
  {
    type: 'user_turn',
    text: 'Can you tidy the landing page header and make the logo larger?',
  } as never,
  { type: 'status', state: 'working' } as never,
  {
    type: 'assistant_message',
    text: 'Sure. I will look at the header first, then adjust the logo size and the spacing around it.',
  } as never,
  {
    type: 'tool_call',
    id: 'c1',
    name: 'Read',
    summary: JSON.stringify({ file_path: 'src/components/SiteHeader.vue' }),
  } as never,
  { type: 'tool_result', id: 'c1', summary: '64 lines', ok: true } as never,
  {
    type: 'assistant_message',
    text: 'The logo is now 40 px tall and the nav items are spaced evenly. I would like to run the tests next.',
  } as never,
  {
    type: 'permission_request',
    id: 'req-tests',
    kind: 'command',
    action: 'Bash',
    detail: 'pnpm test',
    cancelStopsNothing: true,
    scope: {
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny', 'cancel'],
      underDisclosed: true,
    },
  } as never,
])

/**
 * One of each recorded row whose live controls need something this window doesn't have: a picture,
 * a sub-agent that dispatched another, a finished workflow with an output file, a held message
 * that ended unsent, and a question nobody answered.
 */
export const EVERY_KIND_EVENTS: readonly HistoryEvent[] = timed([
  { type: 'user_turn', text: 'Sketch a lighthouse, survey the notes, and run the review panel.' },
  {
    type: 'image',
    imageId: 'img-1',
    path: '/workspace/pictures/lighthouse-sketch.png',
    prompt: 'a small pencil sketch of a lighthouse',
  },
  { type: 'tool_call', id: 'call-task', name: 'Task', summary: 'Explore' },
  {
    type: 'sub_agent',
    agentId: 'agent-outer',
    parentToolCallId: 'call-task',
    phase: 'started',
    kind: 'Explore',
    title: 'Survey the notes',
  },
  {
    type: 'tool_call',
    id: 'call-inner',
    name: 'Task',
    summary: 'general-purpose',
    parentToolCallId: 'call-task',
  },
  {
    type: 'sub_agent',
    agentId: 'agent-inner',
    parentToolCallId: 'call-inner',
    phase: 'ended',
    kind: 'general-purpose',
    title: 'Count the pages',
    outcome: 'completed',
    summary: 'Twelve pages.',
  },
  {
    type: 'sub_agent',
    agentId: 'agent-outer',
    phase: 'ended',
    outcome: 'completed',
    summary: 'The notes cover three topics.',
  },
  { type: 'tool_result', id: 'call-task', summary: 'done', ok: true },
  { type: 'tool_call', id: 'call-wf', name: 'Workflow', summary: '{"script":"…"}' },
  {
    type: 'workflow_run',
    taskId: 'wf-1',
    toolUseId: 'call-wf',
    name: 'review-panel',
    description: 'Two readers, then a judge',
    phases: [
      { index: 1, title: 'Read' },
      { index: 2, title: 'Judge' },
    ],
    agents: [
      { agentId: 'wf-a1', label: 'reader:one', phaseIndex: 1, state: 'done' },
      { agentId: 'wf-a2', label: 'reader:two', phaseIndex: 1, state: 'done' },
      { agentId: 'wf-a3', label: 'judge', phaseIndex: 2, state: 'done' },
    ],
    outcome: 'completed',
    outputFile: '/tmp/wf/tasks/review-panel.output',
    source: 'task_notification',
  },
  { type: 'tool_result', id: 'call-wf', summary: 'completed', ok: true },
  { type: 'message_queued', text: 'Also check the footer links.', messageId: 'held-1' },
  {
    type: 'message_unqueued',
    messageId: 'held-1',
    reason: 'abandoned',
    text: 'Also check the footer links.',
  },
  {
    type: 'user_input_request',
    id: 'question-1',
    prompt: 'Which colour should the beam be?',
    questions: [
      {
        id: 'beam',
        header: 'Beam',
        prompt: 'Which colour should the beam be?',
        multiSelect: false,
        options: [{ label: 'white' }, { label: 'amber' }],
      },
    ],
  },
] as never[])
