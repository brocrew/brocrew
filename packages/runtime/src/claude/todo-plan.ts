import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PlanStep, RuntimeEvent } from '../events'

/**
 * Claude emits per-task changes, with create ids supplied on the result; one checklist is kept per
 * session. Unknown tool names or malformed inputs remain ordinary tool calls.
 */

/** Keep TodoWrite for provider versions that send a full list. Every write tool requires a switch arm. */
export const TODO_WRITE_TOOLS = ['TaskCreate', 'TaskUpdate', 'TodoWrite'] as const

/** A todo tool that changes the list — the exact set {@link TodoPlan.apply} switches over. */
export type TodoWriteTool = (typeof TODO_WRITE_TOOLS)[number]

/**
 * The todo tools that only read the list. They never reach {@link TodoPlan} (no result shape is
 * mapped that has not been seen on the wire), but they have no effect, so for permission purposes
 * they belong with the rest of the checklist tools.
 */
export const TODO_READ_TOOLS = ['TaskList', 'TaskGet'] as const

/** A todo tool that only reads the list. Named for the same reason {@link TodoWriteTool} is. */
type TodoReadTool = (typeof TODO_READ_TOOLS)[number]

/** Any tool whose entire effect is the agent's own checklist. */
export type TodoTool = TodoWriteTool | TodoReadTool

/**
 * Share exact bookkeeping names with permission handling. This excludes TaskOutput, TaskStop and
 * dispatch tools. Codex checklist notifications do not go through this tool path.
 */
export const TODO_TOOLS: readonly TodoTool[] = [...TODO_WRITE_TOOLS, ...TODO_READ_TOOLS]

/** One line of the running list, plus the key a later update addresses it by. */
interface TodoStep {
  /**
   * How `TaskUpdate` finds this step. It starts as the create's tool-use id, a placeholder, and is
   * replaced by the real task id when the create's result binds it. Until then the step is visible
   * but not addressable.
   */
  key: string
  text: string
  status: PlanStep['status']
}

/**
 * `deleted` is not a status: it removes the row. Claude's `TaskUpdate` offers it beside the three
 * real ones, and mapping it to `done` would report an abandoned task as finished.
 */
const REMOVE = Symbol('deleted')

/** Claude's status vocabulary → ours. Shared by `TaskUpdate` and `TodoWrite`, which use the same. */
const TASK_STATUS = new Map<string, PlanStep['status'] | typeof REMOVE>([
  ['pending', 'pending'],
  ['in_progress', 'active'],
  ['completed', 'done'],
  ['deleted', REMOVE],
])

export class TodoPlan {
  private readonly steps: TodoStep[] = []

  /** Tool-use id → the step that call created, until its result binds the provider's task id. */
  private readonly awaitingId = new Map<string, TodoStep>()

  /**
   * Fold one SDK message into the running list, returning the `plan_update` it produced: at most one
   * per message, since the event states the complete list.
   */
  observe(message: SDKMessage): RuntimeEvent[] {
    if (message.type === 'assistant') return this.observeCalls(message)
    if (message.type === 'user') return this.observeResults(message)
    return []
  }

  /** The tool calls in one assistant message, in source order. */
  private observeCalls(message: Extract<SDKMessage, { type: 'assistant' }>): RuntimeEvent[] {
    const content = message.message.content
    if (!Array.isArray(content)) return []
    const absorbed: string[] = []
    for (const block of content) {
      if (!isRecord(block) || block['type'] !== 'tool_use') continue
      const callId = block['id']
      const name = block['name']
      if (typeof callId !== 'string' || typeof name !== 'string') continue
      if (this.apply(name, callId, block['input'])) absorbed.push(callId)
    }
    return absorbed.length > 0 ? [this.snapshot(absorbed)] : []
  }

  /** Narrow to the write-tool union for exhaustive handling; `TaskList` and `TaskGet` do not update the checklist. */
  private apply(name: string, callId: string, input: unknown): boolean {
    if (!isTodoWriteTool(name)) return false
    switch (name) {
      case 'TaskCreate':
        return this.create(callId, input)
      case 'TaskUpdate':
        return this.update(input)
      case 'TodoWrite':
        return this.write(input)
      default:
        return unhandledTodoTool(name)
    }
  }

  /**
   * Drain every settled call. Bind only a structured id, using a unique subject match or the sole
   * settled create; unmatched steps stay visible with their placeholder keys.
   */
  private observeResults(message: Extract<SDKMessage, { type: 'user' }>): RuntimeEvent[] {
    if (this.awaitingId.size === 0) return []
    const content = message.message.content
    if (!Array.isArray(content)) return []
    const settled: TodoStep[] = []
    for (const block of content) {
      if (!isRecord(block) || block['type'] !== 'tool_result') continue
      const id = block['tool_use_id']
      if (typeof id !== 'string') continue
      const waiting = this.awaitingId.get(id)
      if (!waiting) continue
      this.awaitingId.delete(id)
      settled.push(waiting)
    }
    if (settled.length === 0) return []
    // `tool_use_result` is a sibling of `message` outside the SDK's typed shape; read it defensively.
    const result = (message as unknown as { tool_use_result?: unknown }).tool_use_result
    const task = readField(result, 'task')
    const taskId = readString(task, 'id')
    if (!taskId) return [] // no structured id: every step here stays unaddressable, honestly
    const subject = readString(task, 'subject')
    const named = subject ? settled.filter((step) => step.text === subject) : []
    // Exactly one candidate, by name or as the only one settled; anything else is a guess and is declined.
    const target = named.length === 1 ? named[0] : settled.length === 1 ? settled[0] : undefined
    if (target) target.key = taskId
    return []
  }

  /** `TaskCreate`: one new task, always `pending`. */
  private create(callId: string, input: unknown): boolean {
    const subject = readString(input, 'subject')
    if (!subject) return false // no subject → not a shape we recognize → not a checklist
    const step: TodoStep = { key: callId, text: subject, status: 'pending' }
    this.steps.push(step)
    this.awaitingId.set(callId, step)
    return true
  }

  /** A metadata-only update leaves status alone. Unknown task IDs fall back to the ordinary tool row. */
  private update(input: unknown): boolean {
    const taskId = readString(input, 'taskId')
    if (!taskId) return false
    const index = this.steps.findIndex((step) => step.key === taskId)
    const step = this.steps[index]
    if (!step) return false
    const rawStatus = readString(input, 'status')
    const status = rawStatus ? TASK_STATUS.get(rawStatus) : undefined
    if (rawStatus && status === undefined) return false // a status we do not recognize → do not guess
    // Absent `subject` means "do not rename"; an explicit `''` would rename to nothing, which is not
    // readable, so the call is declined rather than reported as applied and visibly not applied.
    const subject = readField(input, 'subject')
    if (subject !== undefined && typeof subject !== 'string') return false
    if (subject === '') return false
    if (subject) step.text = subject
    if (status === REMOVE) {
      this.steps.splice(index, 1)
      this.awaitingId.delete(step.key)
    } else if (status) {
      step.status = status
    }
    return true
  }

  /** TodoWrite replaces the list only when its arguments match the documented shape. */
  private write(input: unknown): boolean {
    const todos = isRecord(input) ? input['todos'] : undefined
    if (!Array.isArray(todos)) return false
    const next: TodoStep[] = []
    for (const todo of todos) {
      const text = readString(todo, 'content')
      const status = TASK_STATUS.get(readString(todo, 'status'))
      // One unreadable row rejects the whole write: a list with a line missing reads as complete.
      if (!text || !status) return false
      // A `deleted` row is readable and means "retired" in a wholesale replace, so it is omitted.
      if (status === REMOVE) continue
      next.push({ key: `todo:${next.length}`, text, status })
    }
    this.steps.splice(0, this.steps.length, ...next)
    // This list is now the truth about the plan, whatever those creates were going to become.
    this.awaitingId.clear()
    return true
  }

  /** Pair the current checklist with the proposed document, since each `plan_update` replaces the list. */
  document(body: string): RuntimeEvent {
    return {
      type: 'plan_update',
      steps: this.steps.map((step) => ({ text: step.text, status: step.status })),
      body,
    }
  }

  /** The complete checklist plus only the calls this event absorbed. */
  private snapshot(absorbed: string[]): RuntimeEvent {
    return {
      type: 'plan_update',
      steps: this.steps.map((step) => ({ text: step.text, status: step.status })),
      supersedes: absorbed,
    }
  }
}

function isTodoWriteTool(name: string): name is TodoWriteTool {
  return (TODO_WRITE_TOOLS as readonly string[]).includes(name)
}

/**
 * Is `name` a tool whose only effect is the agent's own checklist? The single place the literal union
 * is widened to `string`, so every caller gets the same answer.
 */
export function isTodoTool(name: string): name is TodoTool {
  return (TODO_TOOLS as readonly string[]).includes(name)
}

/** The exhaustive switch makes this unreachable; returning false keeps the message loop running. */
function unhandledTodoTool(name: never): boolean {
  void name
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function readString(value: unknown, key: string): string {
  const found = readField(value, key)
  return typeof found === 'string' ? found : ''
}
