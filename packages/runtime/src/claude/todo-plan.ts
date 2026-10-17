import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PlanStep, RuntimeEvent } from '../events'

/**
 * Claude's todo tools, folded into the neutral `plan_update` checklist (028).
 *
 * **Why this is a class and `normalize.ts` is a pure function.** Codex states its whole plan on
 * every `turn/plan/updated`, so its half of this task is a stateless mapping. Claude's todo tools
 * are the opposite: each call changes ONE task, and the id a change addresses is not even in the
 * call that created it — `TaskCreate` carries `{subject, description, activeForm}` and the task's
 * id comes back only in the RESULT. So somebody has to hold the running list and bind ids across
 * two messages, and it must not be `normalizeMessage`, whose purity is what makes it testable one
 * message at a time. One instance per session, driven from the runtime's message loop.
 *
 * **The tool SET is the point, not any one name.** Captured live on this machine, `TodoWrite` never
 * fired: the model reached for `TaskCreate`/`TaskUpdate` instead. A hard-coded `'TodoWrite'` check
 * renders an empty checklist here and a full one somewhere else, for the same conversation — which
 * is the failure this file is shaped to design out. The recognized set lives in one switch (see
 * {@link TodoPlan.apply}) and is a set of SHAPES as much as of names: a name outside it is not a
 * todo tool, and a name inside it whose arguments do not parse is not one either.
 *
 * **Honest when the shape is unknown.** Every handler returns false rather than guessing, and false
 * means "this was an ordinary tool call, leave it as one": no checklist appears, no step is
 * invented, and the `tool_call` row the UI already shows stands on its own. A wrong checklist is
 * worse than no checklist, because the user cannot tell that it is wrong.
 */

/**
 * The todo tools that CHANGE the list. Every name here has its own arm in {@link TodoPlan.apply},
 * and the narrowing in front of that switch makes it a COMPILE error to add one without a handler —
 * so the set and the code that acts on it cannot drift, which is what the comment above asks for.
 *
 * `TodoWrite` has never fired on this machine; it is carried anyway, because which todo tool exists
 * is an environment fact and the tool we did NOT see is exactly the one worth keeping.
 */
export const TODO_WRITE_TOOLS = ['TaskCreate', 'TaskUpdate', 'TodoWrite'] as const

/** A todo tool that changes the list — the exact set {@link TodoPlan.apply} switches over. */
export type TodoWriteTool = (typeof TODO_WRITE_TOOLS)[number]

/**
 * The todo tools that only READ the list. They never reach {@link TodoPlan} — mapping a result shape
 * nobody has seen on the wire is the guessing this file refuses — but reading the agent's own
 * checklist has no effect at all, so for permission purposes they belong with the rest of it (032).
 */
export const TODO_READ_TOOLS = ['TaskList', 'TaskGet'] as const

/** A todo tool that only reads the list. Named for the same reason {@link TodoWriteTool} is. */
export type TodoReadTool = (typeof TODO_READ_TOOLS)[number]

/** Any tool whose entire effect is the agent's own checklist. */
export type TodoTool = TodoWriteTool | TodoReadTool

/**
 * Every tool whose entire effect is the agent's own bookkeeping (032). Exported so the permission
 * guard exempts exactly this set instead of keeping a second list of its own: two lists that can
 * disagree is the bug, and these names have already caused it twice.
 *
 * Typed as the literal union rather than `string[]`, so the set stays legible to the compiler and
 * to anyone reading it — widening it to `string[]` hid which names are actually in it at every use
 * site, which is the opposite of what a security-relevant set should do.
 *
 * **Exact names, never a prefix.** `TaskOutput` and `TaskStop` share the prefix and are deliberately
 * absent — `TaskStop` KILLS A RUNNING BACKGROUND TASK — as is the dispatch tool (`Task`/`Agent`),
 * which spawns a real agent and must keep its card. A `/^Task/` match would auto-approve all three.
 * Membership is not left to be inferred from this list alone: `claude-runtime.test.ts` asserts the
 * set against the SDK's REAL tool vocabulary, so a consequential name added here fails a test.
 *
 * **Claude-only, and that is not an omission.** Codex has no equivalent because its checklist never
 * arrives as a tool call at all — it is a `turn/plan/updated` notification (028's other half), and a
 * notification has no approval path to exempt it from.
 */
export const TODO_TOOLS: readonly TodoTool[] = [...TODO_WRITE_TOOLS, ...TODO_READ_TOOLS]

/** One line of the running list, plus the key a later update addresses it by. */
interface TodoStep {
  /**
   * How `TaskUpdate` finds this step. It starts as the CREATE's tool-use id — a placeholder, since
   * the provider's own id does not exist yet — and is replaced by the real task id the moment the
   * create's result binds it. Until then the step is visible but not addressable, which is the
   * truth: it exists, and nothing can name it yet.
   */
  key: string
  text: string
  status: PlanStep['status']
}

/**
 * `deleted` is not a status: it means the row goes away. Claude's live `TaskUpdate` schema really
 * does offer it beside the three real ones, and mapping it to `done` would report a task the model
 * ABANDONED as one it finished — a lie in the one direction a checklist must never lie.
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
   * Fold one SDK message into the running list, returning the `plan_update` it produced — at most
   * one per message, never one per call. The event states the COMPLETE list, so emitting one per
   * call inside a message that creates three tasks would just publish two states nobody sees.
   */
  observe(message: SDKMessage): RuntimeEvent[] {
    if (message.type === 'assistant') return this.observeCalls(message)
    if (message.type === 'user') return this.observeResults(message)
    return []
  }

  /** The tool calls in one assistant message, in source order — the same order 058 renders them. */
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

  /**
   * **{@link TODO_WRITE_TOOLS} is the recognized tool set** — the one the class comment says is the
   * whole point, now named rather than implied so the permission guard can read the same set (032).
   * Every tool call in the stream is offered here, and a name outside it answers the only question
   * that matters: no, that was not a todo tool.
   *
   * The narrowing is what holds the set and the handlers together. `name` arrives as a `string` and
   * is narrowed before the switch, so a name added to the set with no arm stops compiling at
   * {@link unhandledTodoTool}, and an arm for a name outside the set stops compiling on its own
   * `case`. Adding a provider's next todo tool means adding both — the one arrangement that cannot
   * drift apart.
   *
   * `TaskList` and `TaskGet` are absent deliberately. Their RESULTS would be the authoritative full
   * list and are tempting for exactly that reason — but neither was ever called in capture, so
   * their result shape is documentation rather than something seen on the wire, and 027's lesson
   * was to map what the provider actually sends. They are still bookkeeping, so they sit in
   * {@link TODO_READ_TOOLS} and are exempt from prompting; they simply do not move the checklist.
   */
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
   * Bind the provider's task id from a create's RESULT. Nothing visible changes — the step has been
   * on screen since the create — so this emits nothing; it only makes the step addressable.
   *
   * The record rides on the MESSAGE (`tool_use_result.task`), not on the `tool_result` block, so one
   * message carries ONE task record however many creates it settles. Two things follow, and getting
   * either wrong breaks the checklist permanently rather than visibly:
   *
   *  1. **Every create this message settles is drained**, whether or not it gets bound. A result
   *     arrives exactly once; an entry still waiting after its own result has gone is an entry that
   *     waits for the rest of the session. Bailing out before draining leaked the whole batch and
   *     left every one of its steps unaddressable — the map only ever grew.
   *  2. **The record's `subject` is what disentangles a batch.** With two creates settled at once
   *     there is still only one task record, but it NAMES which create it belongs to. That is a
   *     structured field the provider supplies, not a guess, so it is used in preference to
   *     position; position is the fallback for the ordinary one-at-a-time case.
   *
   * A step that cannot be bound keeps its placeholder key and stays visible at `pending`. It is then
   * unaddressable: a later `TaskUpdate` for it finds nothing, returns false, and renders as the
   * ordinary tool row it always was — so the change is still on screen, just not in the checklist.
   * That is the honest degradation, and it is preferred to binding on a coin flip, which would tick
   * off the WRONG line.
   *
   * The result's TEXT also names the id ("Task #1 created successfully: …"), and it is deliberately
   * not parsed. Reading a number out of an English sentence is exactly the guessing this file
   * refuses to do everywhere else; if the structured field ever stops arriving, the checklist should
   * visibly stop tracking rather than quietly track by regex.
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
      this.awaitingId.delete(id) // drained unconditionally — see (1) above
      settled.push(waiting)
    }
    if (settled.length === 0) return []
    // `tool_use_result` is a sibling field the SDK carries beside `message`, not part of its typed
    // shape — read defensively rather than asserted into existence.
    const result = (message as unknown as { tool_use_result?: unknown }).tool_use_result
    const task = readField(result, 'task')
    const taskId = readString(task, 'id')
    if (!taskId) return [] // no structured id: every step here stays unaddressable, honestly
    const subject = readString(task, 'subject')
    const named = subject ? settled.filter((step) => step.text === subject) : []
    // Exactly one candidate, by name or by being the only one settled here. Anything else is a
    // coin flip and is declined.
    const target = named.length === 1 ? named[0] : settled.length === 1 ? settled[0] : undefined
    if (target) target.key = taskId
    return []
  }

  /** `TaskCreate` — one new task, always `pending` (its own tool documents that). */
  private create(callId: string, input: unknown): boolean {
    const subject = readString(input, 'subject')
    if (!subject) return false // no subject → not a shape we recognize → not a checklist
    const step: TodoStep = { key: callId, text: subject, status: 'pending' }
    this.steps.push(step)
    this.awaitingId.set(callId, step)
    return true
  }

  /**
   * `TaskUpdate` — one existing task changes. `status` is OPTIONAL on the real tool (an update may
   * only rename, reassign or set dependencies), so its absence must leave the status alone rather
   * than reset it.
   *
   * An update naming a task this plan never saw created returns false: our model of the list is
   * incomplete, and silently ignoring the change would leave a checklist that looks authoritative
   * and is not. Falling back to the ordinary tool row says what happened without claiming the
   * checklist covers it.
   */
  private update(input: unknown): boolean {
    const taskId = readString(input, 'taskId')
    if (!taskId) return false
    const index = this.steps.findIndex((step) => step.key === taskId)
    const step = this.steps[index]
    if (!step) return false
    const rawStatus = readString(input, 'status')
    const status = rawStatus ? TASK_STATUS.get(rawStatus) : undefined
    if (rawStatus && status === undefined) return false // a status we do not recognize → do not guess
    // ABSENT and EMPTY are different asks, and `readString` flattens both to `''`. Absent means "do
    // not rename"; an explicit `''` means "rename to nothing", which is not a step anyone can read.
    // Absorbing the call while ignoring the rename would hide the tool row and leave the old text —
    // the update reported as applied and visibly not applied.
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

  /**
   * `TodoWrite` — the WHOLESALE shape, which replaces the list outright.
   *
   * It never fired in capture on this machine, and is mapped from its documented shape rather than
   * from the wire. That is a deliberate exception to "verify on the wire": the whole reason this is
   * a set is that which todo tool exists is an environment fact, so the tool we did NOT see is
   * exactly the one worth carrying. If its arguments do not match, {@link update}'s rule applies and
   * nothing is guessed.
   */
  private write(input: unknown): boolean {
    const todos = isRecord(input) ? input['todos'] : undefined
    if (!Array.isArray(todos)) return false
    const next: TodoStep[] = []
    for (const todo of todos) {
      const text = readString(todo, 'content')
      const status = TASK_STATUS.get(readString(todo, 'status'))
      // One UNREADABLE row condemns the whole write, exactly as one unreadable step condemns a
      // Codex plan: a list with a line missing reads as complete and is not.
      if (!text || !status) return false
      // A `deleted` row is a different thing entirely — it is READ perfectly well, and in a
      // wholesale replace it says "this one is retired". Omitting it is the whole point; treating
      // it as unreadable would throw away a list the model stated completely and correctly, leaving
      // the previous checklist standing while the tool row said otherwise.
      if (status === REMOVE) continue
      next.push({ key: `todo:${next.length}`, text, status })
    }
    this.steps.splice(0, this.steps.length, ...next)
    // Whatever those creates were going to become, this list is now the truth about the plan.
    this.awaitingId.clear()
    return true
  }

  /** The complete list as it now stands, plus the calls THIS event absorbed (never all of them). */
  /**
   * The plan DOCUMENT, as a `plan_update` (030) — the markdown `ExitPlanMode` proposes.
   *
   * It restates the RUNNING CHECKLIST alongside the body, and that is the whole reason this lives
   * here rather than being built at the call site. `steps` REPLACES on every event by design (028),
   * so an event carrying `steps: []` because it happens to be about the document would erase a
   * checklist the agent had already built. Stating the current list keeps the one invariant every
   * consumer relies on — "each event is the complete list" — true of this event too, instead of
   * making the fold learn a special case.
   *
   * Usually the list is empty: plan mode proposes BEFORE the work, so the checklist comes later.
   * That is a fact about ordering, not something to depend on.
   */
  document(body: string): RuntimeEvent {
    return {
      type: 'plan_update',
      steps: this.steps.map((step) => ({ text: step.text, status: step.status })),
      body,
    }
  }

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
 * Is `name` a tool whose only effect is the agent's own checklist? The one place the literal union
 * is widened to `string`, so that every caller asking the question gets the same answer instead of
 * casting the set at its own call site.
 */
export function isTodoTool(name: string): name is TodoTool {
  return (TODO_TOOLS as readonly string[]).includes(name)
}

/**
 * Unreachable by construction: `name` is `never` here only while every {@link TODO_WRITE_TOOLS}
 * member has an arm above. Add one without a handler and this call stops compiling — the
 * compile-time half of "the recognized set and the code acting on it cannot disagree".
 *
 * It RETURNS rather than throws, and the difference matters: `observe` runs inside the runtime's
 * message loop, so a throw here would take the session down over a checklist. `false` is what every
 * unrecognized tool already gets — the row renders as the ordinary tool call it is (028's honest
 * degradation) — so the impossible case degrades the same way the ordinary one does.
 */
function unhandledTodoTool(name: never): boolean {
  void name // the parameter's TYPE is the whole mechanism; its value cannot exist
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
