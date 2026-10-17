import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import type { CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createSessionRecord, type SessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { META, mount, paneProps, permission, record, unmountAll } from './harness'

/**
 * **248 §4 · stopping ONE piece of background work, from the conversation it belongs to.**
 *
 * ⚠️ **In the DOM project because SSR cannot press a button** — and the whole question here is what
 * happens on the press: the row must stop inviting a second one, and the pane must ask for exactly
 * the id the provider named.
 *
 * ⛔ **`094` is the standing finding this is held to**: three stop affordances gated on `busy` one at
 * a time left a turn nobody could abandon. So there is ONE gate here and one control behind it —
 * `canStopBackgroundWork` — read by the button and by nothing else, and the card carries no stop of
 * its own precisely so a second gate cannot come to a different conclusion.
 */

afterEach(unmountAll)

/**
 * The pane’s drawer is open on the Open tab; the running bar is on the agent’s card.
 */
const openPane = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  paneProps({ drawerOpen: true, drawerTab: 'open', ...over })

/** A conversation frozen on a card — `paneProps`'s own default, spelled out so it can be combined. */
const OPEN_CARD: TranscriptEvent[] = [
  permission('req_1'),
  { type: 'status', state: 'waiting_permission' } as TranscriptEvent,
]

const DETACHED: TranscriptEvent[] = [
  { type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'node -e "setTimeout(…, 30000)"' },
  {
    type: 'tool_result',
    id: 'toolu_1',
    summary: 'Command running in background with ID: b6uoyo82k',
    ok: true,
    backgrounded: true,
    backgroundId: 'b6uoyo82k',
  },
  {
    type: 'background_work',
    running: [{ id: 'b6uoyo82k', kind: 'local_bash', description: 'the 30-second timer' }],
    source: 'background_tasks_changed',
  },
]

/**
 * A record whose liveness says whether this adapter can stop — absent means it cannot say.
 *
 * `answers` is what the host will say came back: `true` = the request went out, `false` = it did not
 * (the work had already finished, or the bridge refused and put the reason beside the conversation).
 */
function paneWith(
  canStop: boolean,
  answers = true,
): { m: ReturnType<typeof mount>; asked: () => string[] } {
  const asked: string[] = []
  const r = record(DETACHED)
  const meta: CreatedSession = {
    ...META,
    ...(canStop ? { liveness: { ...META.liveness, canStopBackgroundWork: true } } : {}),
  }
  r.meta = meta
  const m = mount(
    ConversationPane,
    openPane({
      record: r,
      onStopBackgroundWork: (id: string) => {
        asked.push(id)
        return Promise.resolve(answers)
      },
    }),
    { width: 1200 },
  )
  return { m, asked: () => asked }
}

/** Vue's render queue, plus the microtask the awaited answer resolves on. */
const settled = async (): Promise<void> => {
  await nextTick()
  await nextTick()
}

describe('248 §4 · the per-task stop', () => {
  it('⛔ asks for the PROVIDER’s own id, and stops inviting a second press', () => {
    const { m, asked } = paneWith(true)
    // Positive first: the registry really rendered, so the press below is a real gesture.
    expect(m.q('background-bar').textContent).toContain('still running')
    const button = m.q('background-stop-b6uoyo82k')
    expect(button.hasAttribute('disabled')).toBe(false)
    button.click()
    // ⛔ `b6uoyo82k` is Claude's `task_id`. `247` refused a neutral surrogate for the reason its type
    // states: *"a neutral identifier nobody could act on."*
    expect(asked()).toEqual(['b6uoyo82k'])
  })

  it('⚠️ …and the row says it was asked, rather than pretending it is stopped', async () => {
    // `233`/`240` spent two dispatches on this: `Query.stopTask` promises only that a
    // `task_notification` with status `stopped` will be emitted. The receipt is that event arriving,
    // so until it does the honest word is "Stopping…".
    const { m } = paneWith(true)
    expect(m.q('background-stop-b6uoyo82k').textContent).toContain('Stop')
    m.q('background-stop-b6uoyo82k').click()
    await settled()
    const button = m.q('background-stop-b6uoyo82k')
    expect(button.textContent).toContain('Stopping…')
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('🔴 a stop that did NOT go out gives the control back', async () => {
    // ⛔ The first version of this component disabled the row on the press and never learned the
    // answer, so a stop the bridge threw on left the ONLY control for still-running work reading
    // "Stopping…" for ever — `106`'s control that cannot act, manufactured by the app. Found by the
    // adversarial pass over this diff, by four readers independently.
    const { m, asked } = paneWith(true, false)
    m.q('background-stop-b6uoyo82k').click()
    await settled()
    const button = m.q('background-stop-b6uoyo82k')
    // The paired positive: the request really was made, so this is about the ANSWER.
    expect(asked()).toEqual(['b6uoyo82k'])
    expect(button.textContent).toContain('Stop')
    expect(button.textContent).not.toContain('Stopping…')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('⛔ no button at all where the adapter cannot stop — 106, and 118 for why not greyed', () => {
    const { m } = paneWith(false)
    // The ROW is still there: the registry's job is to say what is running whether or not anything
    // can be done about it. That is the paired positive for the absence below.
    expect(m.q('background-row-b6uoyo82k')).toBeTruthy()
    expect(document.querySelector('[data-cy="background-stop-b6uoyo82k"]')).toBeNull()
  })

  it('⚠️ the conversation is NOT interrupted by stopping one piece of work', async () => {
    // The whole reason this is a separate verb: `245` ranked *"Stop one running task"* apart from
    // *"interrupt the whole turn"* because the app only ever had the second.
    //
    // ⛔ **The pane is left FROZEN on a permission card**, which `paneProps`'s default record is, so
    // an interrupt affordance is genuinely on screen while Stop is pressed. Without that the
    // assertion below would be over an event that could not have fired either way — an unpaired
    // negative, and the adversarial pass over this diff caught it as one.
    const interrupts: string[] = []
    const r = record([...OPEN_CARD, ...DETACHED])
    r.meta = { ...META, liveness: { ...META.liveness, canStopBackgroundWork: true } }
    const m = mount(
      ConversationPane,
      openPane({
        record: r,
        onStopBackgroundWork: () => Promise.resolve(true),
        onInterrupt: () => interrupts.push('i'),
      }),
      { width: 1200 },
    )
    // The paired positive: pressing the interrupt affordance DOES reach the handler here.
    m.q('interrupt-session').click()
    expect(interrupts).toEqual(['i'])
    m.q('background-stop-b6uoyo82k').click()
    await settled()
    // …and pressing Stop adds nothing to it.
    expect(interrupts).toEqual(['i'])
  })
})

/**
 * # 🔴 287 finding 4 · a successful Stop poisoned that provider id for the life of the component
 *
 * ⛔ **The latch was cleared only when the request came back `false`.** A stop that SUCCEEDS never
 * does — the row simply leaves on the next level frame — so the id stayed in the set, and the next
 * piece of work born with it was born disabled at **Stopping…**, over a request nobody had made for
 * it. ⚠️ **Reuse is in this code's own model**: `background-terminals.test.ts` brings a Codex
 * `processId` back on purpose because *"the provider's counter is not unique for ever"*.
 */
describe('287 finding 4 · the stop latch is retired with its row', () => {
  /** The level, as the Codex watch publishes it — REPLACE semantics, so `[]` is "nothing running". */
  const level = (ids: string[]): TranscriptEvent =>
    ({
      type: 'background_work',
      running: ids.map((id) => ({ id, kind: 'local_bash', description: 'the 30-second timer' })),
      source: 'thread/backgroundTerminals/list',
    }) as TranscriptEvent

  /**
   * ⚠️ **Built here rather than through `record()`, because the SESSION ID is the variable.** That
   * helper hard-codes `sess_1`, and `SessionRecord.sessionId` is readonly — which is right: a
   * record's identity is not something the app may edit. This is the same three lines with the id
   * as a parameter.
   */
  function stoppable(sessionId = 'sess_1'): SessionRecord {
    const r = createSessionRecord(sessionId)
    // ⚑ **The meta names the record's own conversation**, as it does in the app: the bar is on the
    // agent's card in the drawer now, and the drawer scopes the bar's latch by `session.sessionId`.
    r.meta = {
      ...META,
      sessionId,
      liveness: { ...META.liveness, canStopBackgroundWork: true },
    }
    r.phase = 'open'
    for (const event of DETACHED) applyEvent(r.transcript, event)
    return r
  }

  it('🔴 row X → an ACCEPTED stop → the row leaves → X comes back, and its Stop is live again', async () => {
    // ⚠️ `reactive`, because this test is about what happens when the registry CHANGES — which is
    // what the store does to a record in the app, and a plain object would render once and lie.
    const r = reactive(stoppable())
    const m = mount(
      ConversationPane,
      openPane({ record: r, onStopBackgroundWork: () => Promise.resolve(true) }),
      { width: 1200 },
    )
    m.q('background-stop-b6uoyo82k').click()
    await settled()
    // The paired positive: the latch really is on, which is the behaviour 248 wanted.
    expect(m.q('background-stop-b6uoyo82k').hasAttribute('disabled')).toBe(true)

    // The provider reports the work gone…
    applyEvent(r.transcript, level([]))
    await settled()
    expect(document.querySelector('[data-cy="background-bar"]')).toBeNull()

    // …and later hands the same number to new work. ⛔ This button used to be born disabled.
    applyEvent(r.transcript, level(['b6uoyo82k']))
    await settled()
    const button = m.q('background-stop-b6uoyo82k')
    expect(button.textContent).toContain('Stop')
    expect(button.textContent).not.toContain('Stopping…')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('⚠️ …while a row that is STILL listed keeps its latch — the stop really is in flight', async () => {
    // The other side of the same rule, and the reason this is a watcher on the row set rather than
    // a blanket clear: Codex reports the work until it actually stops, up to one poll away.
    const r = reactive(stoppable())
    const m = mount(
      ConversationPane,
      openPane({ record: r, onStopBackgroundWork: () => Promise.resolve(true) }),
      { width: 1200 },
    )
    m.q('background-stop-b6uoyo82k').click()
    await settled()
    applyEvent(r.transcript, level(['b6uoyo82k', 'other']))
    await settled()
    expect(m.q('background-stop-b6uoyo82k').hasAttribute('disabled')).toBe(true)
    expect(m.q('background-stop-other').hasAttribute('disabled')).toBe(false)
  })

  it('🔴 …and switching conversation does not carry the latch to a row that shares the id', async () => {
    // ⛔ `RuntimeScreen` reuses this pane UNKEYED as the active record changes, so component state
    // about one conversation's Stop would otherwise follow the reader into the next — and a provider
    // id is only unique within a session.
    const asked: string[] = []
    const stop = (id: string): Promise<boolean> => {
      asked.push(id)
      return Promise.resolve(true)
    }
    const a = openPane({ record: stoppable('sess_a'), onStopBackgroundWork: stop })
    const b = openPane({ record: stoppable('sess_b'), onStopBackgroundWork: stop })
    const shown = ref(a)
    const Swap = defineComponent({
      name: 'SwapPane',
      // ⚠️ `paneProps` is deliberately untyped (`Record<string, unknown>`) so every DOM test can hand
      // it a partial fixture; `h` wants the component's own prop type, so the cast lives at this one
      // hop rather than being pushed into the shared helper.
      setup: () => () => h(ConversationPane, shown.value as never),
    })
    const m = mount(Swap, {}, { width: 1200 })

    m.q('background-stop-b6uoyo82k').click()
    await settled()
    expect(asked).toEqual(['b6uoyo82k'])
    expect(m.q('background-stop-b6uoyo82k').hasAttribute('disabled')).toBe(true)

    shown.value = b
    await settled()
    const button = m.q('background-stop-b6uoyo82k')
    expect(button.textContent, 'the other conversation’s work was never asked to stop').toContain(
      'Stop',
    )
    expect(button.hasAttribute('disabled')).toBe(false)
    // …and it is still one control that works: pressing it asks for the other conversation's row.
    button.click()
    await settled()
    expect(asked).toEqual(['b6uoyo82k', 'b6uoyo82k'])
  })
})

/**
 * # 🔴 287 finding 5 · Stop stayed offered while the conversation was closing
 *
 * ⛔ **`SessionStore.close` sets `record.phase = 'closing'` BEFORE it awaits the host** — 089 put it
 * there on purpose — and `canStopBackgroundWork` read straight past it. This is an ordinary
 * conversation close, so the app-wide quit door does not protect it, and both adapters silently
 * no-op once they are shutting down. `106`: a control that cannot act is not offered.
 */
describe('287 finding 5 · no Stop while the conversation is closing', () => {
  function paneInPhase(phase: 'open' | 'closing'): ReturnType<typeof mount> {
    const r = record(DETACHED)
    r.phase = phase
    r.meta = { ...META, liveness: { ...META.liveness, canStopBackgroundWork: true } }
    return mount(
      ConversationPane,
      openPane({ record: r, onStopBackgroundWork: () => Promise.resolve(true) }),
      { width: 1200 },
    )
  }

  it('🔴 the button is gone once the record is closing — and the ROW still says what is running', () => {
    const m = paneInPhase('closing')
    // ⚠️ The registry's job is unchanged: it says what is running whether or not anything can be
    // done about it. That is the paired positive for the absence below — and it is why this is not
    // simply hiding the bar.
    expect(m.q('background-row-b6uoyo82k')).toBeTruthy()
    expect(document.querySelector('[data-cy="background-stop-b6uoyo82k"]')).toBeNull()
  })

  it('⚠️ …and it is there a moment earlier, on the same fixture with `phase: open`', () => {
    const m = paneInPhase('open')
    expect(m.q('background-stop-b6uoyo82k').hasAttribute('disabled')).toBe(false)
  })
})

/**
 * The right panel places Stop beside the running sub-agent. It uses the bar’s
 * `canStopBackgroundWork` gate, Claude’s `task_id` used as the row key, and the same honest
 * “Stopping…” state.
 */
describe('the right panel · Stop beside a running sub-agent', () => {
  const TASK = 'aefe239bb44c7ef29'
  const native = (registered: boolean): TranscriptEvent[] => [
    {
      type: 'tool_call',
      id: 'toolu_a',
      name: 'Agent',
      summary: 'Find stale lines in the vision doc',
    },
    {
      type: 'sub_agent',
      agentId: TASK,
      phase: 'started',
      parentToolCallId: 'toolu_a',
      title: 'Find stale lines in the vision doc',
    },
    {
      type: 'background_work',
      running: registered
        ? [{ id: TASK, kind: 'local_agent', description: 'Find stale lines in the vision doc' }]
        : [],
      source: 'background_tasks_changed',
    },
  ]

  function panel(
    canStop: boolean,
    events: TranscriptEvent[],
    answers = true,
  ): { m: ReturnType<typeof mount>; asked: string[] } {
    const asked: string[] = []
    const r = record(events)
    r.meta = {
      ...META,
      ...(canStop ? { liveness: { ...META.liveness, canStopBackgroundWork: true } } : {}),
    }
    const m = mount(
      ConversationPane,
      openPane({
        record: r,
        drawerOpen: true,
        drawerTab: 'open',
        onStopBackgroundWork: (id: string) => {
          asked.push(id)
          return Promise.resolve(answers)
        },
      }),
      { width: 1400 },
    )
    return { m, asked }
  }

  const stopIn = (m: ReturnType<typeof mount>): HTMLButtonElement | null =>
    m.q('panel-agents').querySelector<HTMLButtonElement>('.row-stop')

  it('🔴 asks for the provider’s own id, and says it was asked', async () => {
    const { m, asked } = panel(true, native(true))
    // ⚑ The sub-agent really is listed, so the button sits beside a real row.
    expect(m.q('panel-agents').textContent).toContain('Find stale lines in the vision doc')
    const button = stopIn(m)
    expect(button, 'no Stop beside the running sub-agent').not.toBeNull()
    expect(button!.textContent?.trim()).toBe('Stop')
    button!.click()
    await settled()
    expect(asked).toEqual([TASK])
    expect(stopIn(m)!.textContent?.trim()).toBe('Stopping…')
    expect(stopIn(m)!.disabled).toBe(true)
  })

  it('⚑ …and gives the control back when the stop did not go out', async () => {
    const { m, asked } = panel(true, native(true), false)
    stopIn(m)!.click()
    await settled()
    expect(asked).toEqual([TASK])
    expect(stopIn(m)!.textContent?.trim()).toBe('Stop')
    expect(stopIn(m)!.disabled).toBe(false)
  })

  it('⛔ THE CONTROLS — no Stop where the adapter cannot stop, nor for work the provider did not list', () => {
    // ⚑ The row is there in both, so each absence is about the Stop and not about the row.
    const cannot = panel(false, native(true))
    expect(cannot.m.q('panel-agents').textContent).toContain('Find stale lines')
    expect(stopIn(cannot.m)).toBeNull()
    cannot.m.unmount()
    const unlisted = panel(true, native(false))
    expect(unlisted.m.q('panel-agents').textContent).toContain('Find stale lines')
    expect(stopIn(unlisted.m)).toBeNull()
  })
})
