import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { runtimeEventSchema, type RuntimeEvent } from '../src/index'
import {
  TODO_READ_TOOLS,
  TODO_WRITE_TOOLS,
  TodoPlan,
  isTodoTool,
  type TodoWriteTool,
} from '../src/claude/todo-plan'

/**
 * The Claude half of 028, tested against the messages the 026 capture actually recorded.
 *
 * The shapes here are not invented: `TaskCreate` really does carry `{subject, description,
 * activeForm}` and NO id, the id really does arrive only as `tool_use_result.task.id` on the
 * following `user` message, and `TaskUpdate` really does take `{taskId, status}` with a fourth
 * status (`deleted`) beside the three that map. Everything this file asserts about the wire came
 * off the wire.
 */

const assistant = (...blocks: unknown[]): SDKMessage =>
  ({ type: 'assistant', message: { role: 'assistant', content: blocks } }) as unknown as SDKMessage

const call = (id: string, name: string, input: unknown): unknown => ({
  type: 'tool_use',
  id,
  name,
  input,
})

/** A tool result, with the id-bearing sibling the SDK puts BESIDE `message` rather than inside it. */
const result = (callId: string, toolUseResult?: unknown): SDKMessage =>
  ({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: callId, content: 'ok' }],
    },
    ...(toolUseResult !== undefined ? { tool_use_result: toolUseResult } : {}),
  }) as unknown as SDKMessage

/** One message settling SEVERAL creates at once, carrying the single task record they share. */
const batchResult = (callIds: string[], toolUseResult: unknown): SDKMessage =>
  ({
    type: 'user',
    message: {
      role: 'user',
      content: callIds.map((id) => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })),
    },
    tool_use_result: toolUseResult,
  }) as unknown as SDKMessage

/** The captured create/bind pair: the call, then the result that finally names the task. */
const created = (
  plan: TodoPlan,
  callId: string,
  taskId: string,
  subject: string,
): RuntimeEvent[] => {
  const events = plan.observe(
    assistant(call(callId, 'TaskCreate', { subject, description: 'why', activeForm: 'doing' })),
  )
  plan.observe(result(callId, { task: { id: taskId, subject } }))
  return events
}

const steps = (event: RuntimeEvent | undefined): unknown =>
  event?.type === 'plan_update' ? event.steps : undefined

describe('TodoPlan — Claude`s incremental todo tools → one wholesale checklist (028)', () => {
  it('rebuilds the COMPLETE list from increments: each event states every step, not the delta', () => {
    // This is the heart of the task. `TaskCreate` adds ONE task, but the neutral event replaces the
    // whole list — so if the adapter emitted the increment, the checklist would flicker down to a
    // single row on every change. Three creates must therefore read 1 → 2 → 3 steps, never 1 → 1 → 1.
    const plan = new TodoPlan()
    expect(steps(created(plan, 'toolu_a', '1', 'Sort the files')[0])).toEqual([
      { text: 'Sort the files', status: 'pending' },
    ])
    expect(steps(created(plan, 'toolu_b', '2', 'Remove duplicates')[0])).toHaveLength(2)
    const third = created(plan, 'toolu_c', '3', 'Organize into subfolders')[0]
    expect(steps(third)).toEqual([
      { text: 'Sort the files', status: 'pending' },
      { text: 'Remove duplicates', status: 'pending' },
      { text: 'Organize into subfolders', status: 'pending' },
    ])

    // …and an update restates all three too, with exactly one of them moved.
    const updated = plan.observe(
      assistant(call('toolu_d', 'TaskUpdate', { taskId: '1', status: 'in_progress' })),
    )
    expect(steps(updated[0])).toEqual([
      { text: 'Sort the files', status: 'active' },
      { text: 'Remove duplicates', status: 'pending' },
      { text: 'Organize into subfolders', status: 'pending' },
    ])
    expect(runtimeEventSchema.safeParse(updated[0]).success).toBe(true)
  })

  it('binds the task id from the RESULT — the create never carries one', () => {
    // The trap: `TaskCreate`'s input has no id, so an adapter that keyed on the input alone could
    // never match the `TaskUpdate` that follows. Proof by contrast — with the binding result the
    // update lands; without it, the same update finds nothing and is not absorbed at all.
    const bound = new TodoPlan()
    created(bound, 'toolu_a', '7', 'Bound')
    expect(
      steps(
        bound.observe(assistant(call('u', 'TaskUpdate', { taskId: '7', status: 'completed' })))[0],
      ),
    ).toEqual([{ text: 'Bound', status: 'done' }])

    const unbound = new TodoPlan()
    unbound.observe(
      assistant(call('toolu_a', 'TaskCreate', { subject: 'Unbound', description: 'd' })),
    )
    expect(
      unbound.observe(assistant(call('u', 'TaskUpdate', { taskId: '7', status: 'completed' }))),
    ).toEqual([])
  })

  it('a BATCH settled by one message binds the create its SUBJECT names', () => {
    // The batch broke the plan permanently until 028's review found it: the old guard bailed out
    // BEFORE draining, so both creates went on waiting for a result that had already been and gone,
    // both steps kept placeholder keys, and every later TaskUpdate missed for the rest of the
    // session. One message carries one task record however many creates it settles — and that
    // record's `subject` is what makes the batch resolvable. It is a structured field the provider
    // supplies, not a number parsed out of a sentence.
    const plan = new TodoPlan()
    plan.observe(
      assistant(
        call('toolu_a', 'TaskCreate', { subject: 'A', description: 'd' }),
        call('toolu_b', 'TaskCreate', { subject: 'B', description: 'd' }),
      ),
    )
    plan.observe(batchResult(['toolu_a', 'toolu_b'], { task: { id: '1', subject: 'B' } }))
    // B is the one the record named, so B is the one that became addressable.
    expect(
      steps(
        plan.observe(assistant(call('u', 'TaskUpdate', { taskId: '1', status: 'completed' })))[0],
      ),
    ).toEqual([
      { text: 'A', status: 'pending' },
      { text: 'B', status: 'done' },
    ])
  })

  it('an unbindable step degrades honestly — unaddressable, still visible, and not poisoning the plan', () => {
    const plan = new TodoPlan()
    plan.observe(
      assistant(
        call('toolu_a', 'TaskCreate', { subject: 'A', description: 'd' }),
        call('toolu_b', 'TaskCreate', { subject: 'B', description: 'd' }),
      ),
    )
    // No subject to disentangle the batch by, so bind NOTHING — ticking the wrong line is worse
    // than a step that no update can reach.
    plan.observe(batchResult(['toolu_a', 'toolu_b'], { task: { id: '1' } }))
    expect(
      plan.observe(assistant(call('u', 'TaskUpdate', { taskId: '1', status: 'completed' }))),
    ).toEqual([])
    // …but both steps are still on screen, and a LATER create still binds normally. This is what
    // proves the drain: with the entries left waiting, they would sit in the map for the whole
    // session and every subsequent result would be scanned against ids that were already spent.
    expect(steps(created(plan, 'toolu_c', '9', 'C')[0])).toEqual([
      { text: 'A', status: 'pending' },
      { text: 'B', status: 'pending' },
      { text: 'C', status: 'pending' },
    ])
    expect(
      steps(plan.observe(assistant(call('u2', 'TaskUpdate', { taskId: '9', status: 'done' })))[0]),
    ).toBeUndefined() // 'done' is OUR word, not Claude's — an unrecognized status is not guessed
    expect(
      steps(
        plan.observe(assistant(call('u3', 'TaskUpdate', { taskId: '9', status: 'completed' })))[0],
      ),
    ).toEqual([
      { text: 'A', status: 'pending' },
      { text: 'B', status: 'pending' },
      { text: 'C', status: 'done' },
    ])
  })

  it('a rename to the EMPTY string is refused, not silently swallowed', () => {
    // `readString` flattens absent and empty to the same '', and absorbing the call while ignoring
    // the rename would hide the tool row and leave the old text — reported as applied, visibly not.
    const plan = new TodoPlan()
    created(plan, 'toolu_a', '1', 'Original')
    expect(plan.observe(assistant(call('u', 'TaskUpdate', { taskId: '1', subject: '' })))).toEqual(
      [],
    )
    expect(plan.observe(assistant(call('u2', 'TaskUpdate', { taskId: '1', subject: 42 })))).toEqual(
      [],
    )
    // The step is untouched, and the ordinary tool rows for those calls stand on their own.
    expect(
      steps(
        plan.observe(assistant(call('u3', 'TaskUpdate', { taskId: '1', subject: 'Renamed' })))[0],
      ),
    ).toEqual([{ text: 'Renamed', status: 'pending' }])
  })

  it('`deleted` REMOVES the step — it is not a synonym for done', () => {
    // Claude's live `TaskUpdate` really does offer a fourth status. Rendering an ABANDONED task as
    // a finished one is a lie in the one direction a checklist must never lie.
    const plan = new TodoPlan()
    created(plan, 'toolu_a', '1', 'Keep me')
    created(plan, 'toolu_b', '2', 'Drop me')
    const after = plan.observe(
      assistant(call('u', 'TaskUpdate', { taskId: '2', status: 'deleted' })),
    )
    expect(steps(after[0])).toEqual([{ text: 'Keep me', status: 'pending' }])
  })

  it('an update with NO status leaves the status alone (rename, dependencies, owner)', () => {
    // `status` is optional on the real tool — `{taskId, addBlockedBy}` is a valid call — so absence
    // must not reset a step that was already in progress.
    const plan = new TodoPlan()
    created(plan, 'toolu_a', '1', 'Old name')
    plan.observe(assistant(call('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress' })))
    const renamed = plan.observe(
      assistant(
        call('u2', 'TaskUpdate', { taskId: '1', subject: 'New name', addBlockedBy: ['2'] }),
      ),
    )
    expect(steps(renamed[0])).toEqual([{ text: 'New name', status: 'active' }])
  })

  it('an unrecognized SHAPE is left as the ordinary tool call it already is', () => {
    // The 028 rule: never guess a checklist. Each of these must produce no event at all, so the
    // `tool_call` row the UI already shows stands alone and nothing is invented beside it.
    const plan = new TodoPlan()
    for (const input of [
      { description: 'no subject at all' },
      { subject: 42 },
      'not even an object',
    ]) {
      expect(
        plan.observe(assistant(call('c', 'TaskCreate', input))),
        JSON.stringify(input),
      ).toEqual([])
    }
    created(plan, 'toolu_a', '1', 'Real')
    // A status outside the vocabulary is NOT nudged to the nearest one we know.
    expect(
      plan.observe(assistant(call('u', 'TaskUpdate', { taskId: '1', status: 'halfway' }))),
    ).toEqual([])
    // And a tool that is simply not a todo tool never touches the plan.
    expect(plan.observe(assistant(call('b', 'Bash', { command: 'ls' })))).toEqual([])
  })

  it('`TodoWrite` — the OTHER shape in the set — replaces the list wholesale', () => {
    // It never fired on this machine; the set exists precisely because which todo tool is offered
    // is an environment fact. A hard-coded `'TodoWrite'` check would render nothing here, and a
    // hard-coded `'TaskCreate'` one would render nothing wherever `TodoWrite` IS what fires.
    const plan = new TodoPlan()
    created(plan, 'toolu_a', '1', 'Built incrementally')
    const written = plan.observe(
      assistant(
        call('w', 'TodoWrite', {
          todos: [
            { content: 'One', status: 'completed', activeForm: 'Doing one' },
            { content: 'Two', status: 'in_progress', activeForm: 'Doing two' },
          ],
        }),
      ),
    )
    expect(steps(written[0])).toEqual([
      { text: 'One', status: 'done' },
      { text: 'Two', status: 'active' },
    ])
    // One UNREADABLE row condemns the write, exactly as one unreadable step condemns a Codex plan.
    expect(plan.observe(assistant(call('w2', 'TodoWrite', { todos: [{ content: 'x' }] })))).toEqual(
      [],
    )
    // A `deleted` row is a different thing: it is read perfectly well, and in a WHOLESALE replace
    // it means "this one is retired". Omitting it is the point — condemning the write would throw
    // away a list the model stated completely, leaving the previous checklist standing beside a
    // tool row that said otherwise.
    const withDeleted = plan.observe(
      assistant(
        call('w3', 'TodoWrite', {
          todos: [
            { content: 'Kept', status: 'in_progress' },
            { content: 'Retired', status: 'deleted' },
            { content: 'Also kept', status: 'pending' },
          ],
        }),
      ),
    )
    expect(steps(withDeleted[0])).toEqual([
      { text: 'Kept', status: 'active' },
      { text: 'Also kept', status: 'pending' },
    ])
  })

  it('the recognized set has no dead members: every name in it really moves the checklist (032)', () => {
    // The half of "one source of truth" a compiler cannot check. The switch's narrowing already
    // makes a name-without-a-handler a compile error; this closes the opposite gap — a name listed
    // in the set whose handler never fires, which would read as recognized and behave as an
    // ordinary tool. The permission guard exempts this set, so a dead member is a tool waved
    // through on a promise the checklist never keeps.
    //
    // `Record<TodoWriteTool, …>` is doing real work: add a name to the set and this object stops
    // compiling until it is exercised here too.
    const drive: Record<TodoWriteTool, (plan: TodoPlan) => RuntimeEvent[]> = {
      TaskCreate: (plan) =>
        plan.observe(assistant(call('c', 'TaskCreate', { subject: 'S', description: 'd' }))),
      TaskUpdate: (plan) => {
        created(plan, 'seed', '1', 'S') // an update needs something to address
        return plan.observe(
          assistant(call('u', 'TaskUpdate', { taskId: '1', status: 'completed' })),
        )
      },
      TodoWrite: (plan) =>
        plan.observe(
          assistant(call('w', 'TodoWrite', { todos: [{ content: 'S', status: 'pending' }] })),
        ),
    }
    expect(TODO_WRITE_TOOLS.length).toBeGreaterThan(0)
    for (const name of TODO_WRITE_TOOLS) {
      const events = drive[name](new TodoPlan())
      expect(events, `${name} is in the recognized set but moved nothing`).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'plan_update' })
    }
    // The read-only siblings are the deliberate exception: exempt from prompting, absent from the
    // checklist, because their result shape has never been seen on the wire (028's rule stands).
    // Their membership in TODO_TOOLS is true by construction and is not asserted here — the claim
    // worth making about them is that they are exempt AND inert, and the exempt half belongs to the
    // guard test, which can actually fail.
    for (const name of TODO_READ_TOOLS) {
      expect(
        new TodoPlan().observe(assistant(call('r', name, { taskId: '1' }))),
        `${name} must not fabricate a checklist`,
      ).toEqual([])
      expect(isTodoTool(name), `${name} must be recognized as bookkeeping`).toBe(true)
    }
  })

  it('`supersedes` names only the calls THIS event absorbed, never every call so far', () => {
    // Superseding is permanent once the fold applies it, so carrying the running total would grow
    // the payload with the length of the session for no added effect — and this is persisted.
    const plan = new TodoPlan()
    const first = created(plan, 'toolu_a', '1', 'A')[0]
    const second = created(plan, 'toolu_b', '2', 'B')[0]
    expect(first).toMatchObject({ supersedes: ['toolu_a'] })
    expect(second).toMatchObject({ supersedes: ['toolu_b'] })
  })

  it('emits ONE event per message, however many todo calls that message carries', () => {
    // The event states the complete list, so three creates in one message would otherwise publish
    // two intermediate states nobody ever sees.
    const plan = new TodoPlan()
    const events = plan.observe(
      assistant(
        call('a', 'TaskCreate', { subject: 'A', description: 'd' }),
        call('b', 'TaskCreate', { subject: 'B', description: 'd' }),
        call('c', 'TaskCreate', { subject: 'C', description: 'd' }),
      ),
    )
    expect(events).toHaveLength(1)
    expect(steps(events[0])).toHaveLength(3)
    expect(events[0]).toMatchObject({ supersedes: ['a', 'b', 'c'] })
  })

  it('messages that are not tool traffic pass through untouched', () => {
    const plan = new TodoPlan()
    expect(plan.observe({ type: 'result', subtype: 'success' } as unknown as SDKMessage)).toEqual(
      [],
    )
    expect(plan.observe(assistant({ type: 'text', text: 'hello' }))).toEqual([])
    // A result arriving with nothing pending is not an error — it is every other tool in the turn.
    expect(plan.observe(result('toolu_unknown', { task: { id: '9' } }))).toEqual([])
  })
})
