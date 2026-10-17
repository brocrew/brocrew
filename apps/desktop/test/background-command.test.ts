import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import { MAX_BACKGROUND_TEXT } from '../../../packages/runtime/src/background-work'
import { TOOL_SUMMARY_MAX } from '../../../packages/runtime/src/claude/normalize'
import { quotedLiteral } from '../src/shared/runtime-ipc'
import { messageWithHandedPaths } from '../src/main/runtime/handed-path'
// ⚑ D-017 · R11 — what a row runs is `shared/agent-state.ts`'s, so `main` names it as the row does.
import {
  BACKGROUND_COMMAND_CHARS,
  backgroundWhat,
  type BackgroundRow,
} from '../src/shared/agent-state'
import { cutNote } from '../src/renderer/src/lib/background-work'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * # 🔴 251 · What is actually running
 *
 * A `background_work` row carrying `local_bash "demo monitor emitting 3 ticks then exiting"`
 * describes the work without exposing the Monitor command. The display must make the running
 * command identifiable.
 *
 * ⛔ **The ruling that makes this dispatch small**: *"if it's the same as a shell then we're good, as
 * long as we display the shell correctly."* A Monitor IS a long-running shell, `local_bash` is
 * honest, and the word *Monitor* only ever reaches this app in the ENDING summary — after the one
 * moment it was needed. So nothing is labelled; the row shows the COMMAND, and a monitor becomes
 * legible because a person can read what it runs.
 *
 * ⚠️ **The command is already in the ledger and `toolCallId` is the join** — this is a read, not a
 * new fact on the wire, and 251 §2 says so explicitly. Every fixture below is a payload shape
 * `background-tasks.ts` really produces.
 */

/** The command carried by Bash’s `summary`. */
const WATCH = 'test -f ~/Desktop/person.txt && echo "EXISTS" || echo "NOT FOUND"'

function call(id: string, summary = WATCH, name = 'Bash'): RuntimeEvent {
  return { type: 'tool_call', id, name, summary }
}

function level(
  running: { id: string; kind?: string; toolCallId?: string; description?: string }[],
): RuntimeEvent {
  return { type: 'background_work', running, source: 'background_tasks_changed' } as RuntimeEvent
}

function feed(state: TranscriptState, ...events: RuntimeEvent[]): TranscriptState {
  events.forEach((event, index) => applyEvent(state, event, 1_000 + index))
  return state
}

/** The one row, so a test names what it is asserting about rather than an index. */
function only(state: TranscriptState): BackgroundRow {
  expect(state.background.running).toHaveLength(1)
  return state.background.running[0]!
}

describe('251 §2 · the row names the command', () => {
  it('🔴 joins the level row to its own tool call and shows what it RUNS', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1'),
      level([
        {
          id: 'b6uoyo82k',
          kind: 'local_bash',
          toolCallId: 'toolu_1',
          description: 'waiting for person.txt to appear on Desktop',
        },
      ]),
    )
    const what = backgroundWhat(only(state))
    expect(what.from).toBe('command')
    expect(what.text).toBe(WATCH)
    // ⚑ The tool's own name comes with it, because the card prints it and the two surfaces show one
    // fact — 099/064. `local_bash` stays beside it as the provider's word for the KIND.
    expect(what.name).toBe('Bash')
    expect(only(state).kind).toBe('local_bash')
    // The replaced description cannot identify the running command; assert the command
    // itself.
    expect(only(state).description).toBe('waiting for person.txt to appear on Desktop')
  })

  it('⚠️ a row with NO toolCallId shows the description — never a blank (106)', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1'),
      level([{ id: 'b1', kind: 'local_bash', description: 'demo monitor emitting 3 ticks' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.from).toBe('description')
    expect(what.text).toBe('demo monitor emitting 3 ticks')
    expect(what.name).toBeUndefined()
  })

  it('⛔ …and a row with neither is named by the id the Stop sends', () => {
    const what = backgroundWhat(only(feed(createTranscript(), level([{ id: 'b1' }]))))
    expect(what.from).toBe('id')
    expect(what.text).toBe('b1')
    // The floor this whole function exists to hold: three answers, none of them empty.
    expect(what.text).not.toBe('')
  })

  it('⚠️ a description that is only whitespace falls THROUGH to the id', () => {
    const what = backgroundWhat(
      only(feed(createTranscript(), level([{ id: 'b1', description: '   ' }]))),
    )
    expect(what.from).toBe('id')
    expect(what.text).toBe('b1')
  })

  it('⚠️ an EMPTY tool summary is not carried as a command — `z.string()` allows one', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1', ''),
      level([{ id: 'b1', toolCallId: 'toolu_1', description: 'the provider’s sentence' }]),
    )
    // Rejected at the fold, so the row genuinely has no command rather than an empty one that
    // `backgroundWhat` would have to reject a second time.
    expect(only(state).command).toBeUndefined()
    expect(backgroundWhat(only(state)).from).toBe('description')
  })

  it('⛔ a toolCallId naming a call this fold has never seen falls back too', () => {
    const state = feed(
      createTranscript(),
      level([{ id: 'b1', toolCallId: 'toolu_gone', description: 'still a true sentence' }]),
    )
    expect(backgroundWhat(only(state)).from).toBe('description')
  })
})

describe('251 §2 · the two orderings the wire really produces', () => {
  it('🔴 the FIRST level frame has no binding yet, and the next one does', () => {
    // Measured, not imagined: `background_tasks_changed` is emitted before `task_started`, and
    // `task_started` is what carries `tool_use_id` into the binding `snapshot()` reads. 248 §5's own
    // capture has the two frames in the same millisecond.
    const state = feed(
      createTranscript(),
      call('toolu_1'),
      level([{ id: 'b1', description: 'waiting for person.txt' }]),
    )
    expect(backgroundWhat(only(state)).from).toBe('description')

    feed(state, level([{ id: 'b1', toolCallId: 'toolu_1', description: 'waiting for person.txt' }]))
    const what = backgroundWhat(only(state))
    expect(what.from).toBe('command')
    expect(what.text).toBe(WATCH)
  })

  it('🔴 a resolved command SURVIVES a level frame whose call the fold no longer holds', () => {
    // ⛔ The release case, and it is why the command is resolved into the row instead of looked up
    // when the bar renders: `carryForward` copies `background` across a slab release and carries no
    // items, so long-running work really can outlive the call that started it. Simulated here by
    // re-folding the carried registry into a FRESH transcript that never saw `toolu_1` — which is
    // exactly what `foldWindow` does with `carry.background`.
    const first = feed(
      createTranscript(),
      call('toolu_1'),
      level([{ id: 'b1', toolCallId: 'toolu_1', description: 'waiting for person.txt' }]),
    )
    expect(backgroundWhat(only(first)).from).toBe('command')

    const after = createTranscript()
    after.background = {
      running: [...first.background.running],
      dropped: first.background.dropped,
    }
    feed(after, level([{ id: 'b1', toolCallId: 'toolu_1', description: 'waiting for person.txt' }]))
    const what = backgroundWhat(only(after))
    expect(what.from).toBe('command')
    expect(what.text).toBe(WATCH)
  })

  it('⛔ …and remembering a command does NOT resurrect a row REPLACE removed', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1'),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    expect(only(state).command?.text).toBe(WATCH)
    // The level's own semantics are untouched: `[]` is the provider saying nothing is running.
    feed(state, level([]))
    expect(state.background.running).toEqual([])
    // …and a DIFFERENT id does not inherit the one we remembered.
    feed(state, level([{ id: 'b2', description: 'a second thing' }]))
    expect(only(state).command).toBeUndefined()
    expect(backgroundWhat(only(state)).from).toBe('description')
  })

  it("⚑ a SUB-AGENT's own backgrounded command resolves through its card", () => {
    // 248 §5 measured that a dispatched agent joins the level set; nothing stops that child
    // backgrounding a command of its own, on a row deliberately absent from the top-level index.
    const state = feed(
      createTranscript(),
      call('toolu_a', 'run the timer', 'Agent'),
      {
        type: 'sub_agent',
        agentId: 'agent-1',
        phase: 'started',
        parentToolCallId: 'toolu_a',
        title: 'run the timer',
      } as RuntimeEvent,
      { ...call('toolu_child', 'sleep 30'), parentToolCallId: 'toolu_a' } as RuntimeEvent,
      level([{ id: 'b-child', kind: 'local_bash', toolCallId: 'toolu_child' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.from).toBe('command')
    expect(what.text).toBe('sleep 30')
    expect(what.name).toBe('Bash')
  })
})

describe('251 §2 · arbitrary text on a line a reader trusts', () => {
  it('⛔ an ordinary command is NOT quoted — it is what the person typed', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1', 'git commit -m "fix the thing"'),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.text).toBe('git commit -m "fix the thing"')
    // The paired negative that means something: no backslash was put in front of their quotes.
    expect(what.text).not.toContain('\\"')
  })

  it('🔴 …and one carrying a control character IS, through 232 §2’s own function', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1', 'echo one\necho two'),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(state))
    // The newline is visible as an escape rather than turning one row into two.
    expect(what.text).toContain('\\n')
    expect(what.text).not.toContain('\n')
    expect(what.text).toBe(quotedLiteral('echo one\necho two'))
  })

  it('⛔ U+2028 is escaped, because a browser breaks the line on it', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1', 'echo a\u2028echo b'),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.text).toContain('\\u2028')
    expect(what.text).not.toContain('\u2028')
  })

  it('🔴 a BIDI override cannot reorder what the row draws (CVE-2021-42574)', () => {
    // ⛔ **The attack this surface is actually exposed to**, found by the adversarial pass over this
    // diff. U+202E reorders what is DRAWN without changing what is stored, so a command can be made
    // to read as one thing and be another — on the one surface a person consults before deciding it
    // is safe to close the app. Quoting is the whole answer: `JSON.stringify` renders it as a
    // visible escape, and the character stops being able to act.
    const trojan = 'echo \u202Eharmless'
    const state = feed(
      createTranscript(),
      call('toolu_1', trojan),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.text).toContain('\\u202e')
    expect(what.text).not.toContain('\u202E')
    // …and the weaker marks in the same family, which reorder less but hide just as well.
    for (const mark of ['\u200F', '\u2066', '\u061C']) {
      const one = feed(
        createTranscript(),
        call('toolu_2', `echo ${mark}x`),
        level([{ id: 'b2', toolCallId: 'toolu_2' }]),
      )
      expect(backgroundWhat(only(one)).text).not.toContain(mark)
    }
  })

  it('⚠️ ONE escaping rule, shared with the block that hands paths to a model (232 §2)', () => {
    // Not a source census: the same input goes through both callers and the same literal comes out,
    // so an edit to one that did not reach the other fails here.
    const nasty = 'a\nb\u2028c"d'
    expect(quotedLiteral(nasty)).toBe('"a\\nb\\u2028c\\"d"')
    expect(
      messageWithHandedPaths('', [{ path: nasty, kind: 'file', outsideCwd: false }]),
    ).toContain(quotedLiteral(nasty))
  })
})

describe('251 §2 · a long command, and what the row says about the part it did not show', () => {
  const long = `echo ${'x'.repeat(400)}`

  it('🔴 the ceiling IS the wire’s ceiling, so the row never cuts a string the ledger already cut', () => {
    // ⛔ **The duplicated constant, pinned.** `MAX_BACKGROUND_TEXT` lives in `packages/runtime` and
    // is 201 rather than 200 because `truncate` keeps `TOOL_SUMMARY_MAX` characters and appends an
    // ellipsis. Importing a value from that package into the renderer would drag it into the bundle
    // for one integer, so the number is written twice and held equal here — this file runs in node.
    //
    // ⚠️ **The first draft was 160, and the live run showed what that costs**: a row cut at 160
    // saying "+41 more characters" about a string the ledger had ALREADY cut at 200 with a silent
    // `…`. Two truncations of one command, one counted and one not.
    expect(BACKGROUND_COMMAND_CHARS).toBe(MAX_BACKGROUND_TEXT)
    expect(BACKGROUND_COMMAND_CHARS).toBe(TOOL_SUMMARY_MAX + 1)
  })

  it('🔴 counts what it cut instead of drawing an ellipsis (092)', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1', long),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.text).toHaveLength(BACKGROUND_COMMAND_CHARS)
    expect(what.cut).toBe(long.length - BACKGROUND_COMMAND_CHARS)
    expect(cutNote(what.cut)).toBe(`+${long.length - BACKGROUND_COMMAND_CHARS} more characters`)
    // ⛔ The whole thing is still on the row, as its `title` — unclipped, so the count describes a
    // real string rather than one nothing holds.
    expect(what.full).toBe(long)
  })

  it('⚠️ a command that fits is not cut, and says so with a zero', () => {
    const state = feed(
      createTranscript(),
      call('toolu_1'),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.cut).toBe(0)
    expect(what.text).toBe(WATCH)
    expect(what.full).toBe(WATCH)
  })

  it('⛔ …and exactly at the ceiling is not cut either — the boundary, not near it', () => {
    const exact = 'y'.repeat(BACKGROUND_COMMAND_CHARS)
    const state = feed(
      createTranscript(),
      call('toolu_1', exact),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    expect(backgroundWhat(only(state)).cut).toBe(0)

    const over = 'y'.repeat(BACKGROUND_COMMAND_CHARS + 1)
    const two = feed(
      createTranscript(),
      call('toolu_1', over),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(two))
    expect(what.cut).toBe(1)
    expect(cutNote(what.cut)).toBe('+1 more character')
  })

  it('🔴 cuts by CODE POINT, so the last thing on the row is never half a character', () => {
    // An astral character sitting exactly on the boundary. `String.prototype.slice` would leave a
    // lone surrogate here, which renders as `�` — from the one function whose job is to not mislead
    // about what ran.
    const emoji = `${'z'.repeat(BACKGROUND_COMMAND_CHARS - 1)}🚀tail`
    const state = feed(
      createTranscript(),
      call('toolu_1', emoji),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.text.endsWith('🚀')).toBe(true)
    // ⚠️ **A LONE SURROGATE, not `U+FFFD`** (found by the adversarial pass over this diff). A
    // UTF-16 half-cut leaves U+D83D in the string; the replacement character only appears later, if
    // something re-encodes it. `not.toContain('\uFFFD')` was the first draft and it held under the
    // very mutation it was written to catch.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(what.text)).toBe(false)
    // …and the count is in code points too, so `tail` is 4 rather than the 5 UTF-16 units it weighs.
    expect(what.cut).toBe(4)
  })

  it('⚠️ the ceiling applies to the QUOTED form, because that is the string on screen', () => {
    // Two numbers for one thing is how a count stops being checkable. `full` is what the row would
    // have shown, and `cut` is measured against it.
    const raw = 'echo '.repeat(60).trimEnd().replace('echo echo', 'echo\necho')
    const state = feed(
      createTranscript(),
      call('toolu_1', raw),
      level([{ id: 'b1', toolCallId: 'toolu_1' }]),
    )
    const what = backgroundWhat(only(state))
    expect(what.full).toBe(quotedLiteral(raw))
    expect([...what.text].length + what.cut).toBe([...what.full].length)
  })
})
