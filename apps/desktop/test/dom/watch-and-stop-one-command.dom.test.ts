import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { CommandTail, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { META, mount, paneProps, record, unmountAll } from './harness'

/**
 * # 🔴 Watching one running command, and stopping just it (300)
 *
 * The remaining gaps are observable command state and a working stop control:
 *
 * > **3.** *"Watch a running command while it runs. You see the card, but not the live output."*
 * > **5.** *"Stop one command without stopping everything. Escape stops the whole turn."*
 *
 * ## ⛔ The stream here has NO `tool_result`, and §5 asked for exactly that
 *
 * `280` #1 existed because *"every desktop test uses a Claude-style receipt"* — and the shape this
 * feature lives in is the one Codex really produces: a `tool_call` carrying the provider's own
 * process id, output arriving for as long as the command runs, and **no receipt at all**, because a
 * detached Codex command emits no `item/completed` ever (275, measured over 30 s after the process
 * was killed). Every fixture below is that shape.
 *
 * ## ⚠️ What is asserted, and what would pass without the feature
 *
 * The follow is a TIMER, so a test that only checked "the tail is on screen after a read" would pass
 * over a card that read once and never again — which is not watching, it is a snapshot. Each case
 * below moves the clock and asserts the screen moved with it.
 */

/** The fold toggle of the one tool card these fixtures render. */
const toggle = (view: { host: HTMLElement }): HTMLElement =>
  view.host.querySelector<HTMLElement>('[data-cy^="tool-toggle-"]')!

/** The card's own Stop, or `null` — an absence this file asserts as often as a presence. */
const stopButton = (view: { host: HTMLElement }): HTMLButtonElement | null =>
  view.host.querySelector<HTMLButtonElement>('[data-cy^="tool-stop-"]')

/**
 * ⚠️ `q` throws by design — a query that returns null is a vacuous test — so an ABSENCE needs this.
 *
 * ⛔ A PREFIX, because every `data-cy` on a tool card carries the row's own id: a bare name would
 * make a two-card assertion silently read the first card, which is precisely the kind of thing §4
 * warns about.
 */
const found = (view: { host: HTMLElement }, cy: string): HTMLElement | null =>
  view.host.querySelector<HTMLElement>(`[data-cy^="${cy}"]`)

const CALL = 'exec-14dfe485-2de2-4f00-b24c-f0b42a7ad785'
const KEY = '28992'

/**
 * A Codex-shaped running command: the call, its process id, and **no receipt**.
 *
 * ⚠️ `backgroundId` on the `tool_call` is what the live probe measured on a FOREGROUND command —
 * `tool_call id=exec-9d6bf5cd-… backgroundId=77615`, while the turn was still blocked on it — so
 * this fixture is a foreground command, which is the harder half of gap 5 and the one nothing could
 * stop before.
 */
function runningCommand(): ReturnType<typeof record> {
  return record([
    { type: 'status', state: 'working' } as unknown as TranscriptEvent,
    {
      type: 'tool_call',
      id: CALL,
      name: 'shell',
      summary: 'seq 1 12',
      backgroundId: KEY,
    } as unknown as TranscriptEvent,
  ])
}

/** A session whose adapter both streams output and stops one command — Codex, measured. */
function liveMeta(): typeof META {
  return {
    ...META,
    liveness: {
      ...META.liveness,
      canReadCommandOutput: true,
      canStopBackgroundWork: true,
    },
  }
}

const tail = (text: string, over: Partial<CommandTail> = {}): CommandTail => ({
  text,
  dropped: 0,
  closed: false,
  ...over,
})

function paneWith(over: Record<string, unknown>): Component {
  const props = paneProps({ record: runningCommand(), ...over })
  ;(props.record as ReturnType<typeof record>).meta = liveMeta()
  return defineComponent({
    name: 'WatchHost',
    setup() {
      return () => h(ConversationPane as Component, props)
    },
  })
}

afterEach(() => {
  unmountAll()
  vi.useRealTimers()
})

describe('watching one running command (300 · gap 3)', () => {
  it('🔴 shows what it has printed, and KEEPS SHOWING as it prints more', async () => {
    vi.useFakeTimers()
    const printed: string[] = ['tick-1\n']
    const reads: string[] = []
    const view = mount(
      paneWith({
        onReadCommandOutput: (id: string) => {
          reads.push(id)
          return Promise.resolve(tail(printed.join('')))
        },
      }),
      {},
      { width: 1100, height: 900 },
    )
    await nextTick()

    // ⛔ **Nothing is followed until somebody opens the card**, which is what keeps a turn that ran a
    // dozen commands from becoming a dozen pollers. The paired positive is two lines down.
    expect(reads, 'a folded card asked for a tail nobody was looking at').toEqual([])
    expect(found(view, 'tool-tail')).toBeNull()

    toggle(view).click()
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()

    expect(
      reads,
      'opening the card asks at once — a second of "nothing yet" reads as broken',
    ).toEqual([CALL])
    expect(found(view, 'tool-tail-text')!.textContent).toBe('tick-1\n')

    // ⚑ **The whole of "while it runs"**: the screen moves without anybody touching it.
    printed.push('tick-2\n')
    await vi.advanceTimersByTimeAsync(1_000)
    await nextTick()
    expect(found(view, 'tool-tail-text')!.textContent).toBe('tick-1\ntick-2\n')
    expect(reads.length, 'the follow really is a follow').toBeGreaterThan(1)
  })

  it('⛔ stops asking the moment the card is folded again', async () => {
    vi.useFakeTimers()
    const reads: string[] = []
    const view = mount(
      paneWith({
        onReadCommandOutput: (id: string) => {
          reads.push(id)
          return Promise.resolve(tail('x'))
        },
      }),
      {},
      { width: 1100, height: 900 },
    )
    await nextTick()
    const fold = toggle(view)
    fold.click()
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    const whileOpen = reads.length
    expect(whileOpen, 'the paired positive: it was being followed').toBeGreaterThan(1)

    fold.click()
    await nextTick()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(reads.length, 'a folded card was still being polled').toBe(whileOpen)
  })

  it('⚠️ says WHY there is nothing, in the provider’s own words, rather than showing an empty box', async () => {
    // ⛔ `106`: a surface that shows nothing where something was expected is one a person cannot act
    // on. ⚑ And the sentence is the PROVIDER's, out of its capability — `039`'s rule that the
    // renderer owns no copy of a reason.
    const view = mount(
      paneWith({
        capabilities: {
          claude: {
            commandOutput: {
              state: 'absent',
              reason: 'Claude does not report a command’s output until it finishes.',
              checkedAgainst: 'the probe',
            },
          },
        },
        onReadCommandOutput: undefined,
      }),
      {},
      { width: 1100, height: 900 },
    )
    await nextTick()
    toggle(view).click()
    await nextTick()
    expect(found(view, 'tool-tail-absent')!.textContent).toContain('until it finishes')
    expect(found(view, 'tool-tail-text'), 'an empty tail was drawn too').toBeNull()
  })

  it('⛔ a conversation switch takes the tail with it', async () => {
    vi.useFakeTimers()
    const first = runningCommand()
    first.meta = liveMeta()
    // ⚠️ **Built rather than patched**: `SessionRecord.sessionId` is `readonly`, which is the type
    // saying what `287` finding 4 says in prose — the id a conversation is is not something a
    // surface may reassign underneath itself.
    const second = createSessionRecord('sess_2')
    second.meta = { ...liveMeta(), sessionId: 'sess_2' }
    second.phase = 'open'
    for (const event of [
      { type: 'status', state: 'working' },
      { type: 'tool_call', id: 'exec-other', name: 'shell', summary: 'other', backgroundId: '999' },
    ] as unknown as TranscriptEvent[]) {
      applyEvent(second.transcript, event)
    }
    // ⚠️ **A `ref`, and the first draft used a plain `let`** — which Vue does not track, so the
    // switch never re-rendered and the test passed over a pane that had not been asked to change.
    // `193`'s vacuity rule reached by a different road: the assertion was about a state the fixture
    // never produced.
    const showing = ref(first)
    const props = paneProps({
      record: first,
      onReadCommandOutput: () => Promise.resolve(tail("A's output\n")),
    })
    const Host = defineComponent({
      name: 'SwitchHost',
      setup() {
        return () => h(ConversationPane as Component, { ...props, record: showing.value })
      },
    })
    const view = mount(Host, {}, { width: 1100, height: 900 })
    await nextTick()
    toggle(view).click()
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    expect(found(view, 'tool-tail-text')!.textContent).toBe("A's output\n")

    // ⚑ **This pane is REUSED across conversations without a key** — `287` finding 4 is the same
    // hazard on the registry's own latch. A tail left behind would be drawn under B's card.
    showing.value = second
    await nextTick()
    await nextTick()
    expect(
      found(view, 'tool-tail-text'),
      "conversation A's output is on screen under conversation B",
    ).toBeNull()
  })
})

describe('stopping one command from the conversation (300 · gap 5)', () => {
  it('🔴 offers a Stop on the card, and sends the PROVIDER’s key rather than the call id', async () => {
    const asked: string[] = []
    const view = mount(
      paneWith({
        onStopBackgroundWork: (id: string) => {
          asked.push(id)
          return Promise.resolve(true)
        },
      }),
      {},
      { width: 1100, height: 900 },
    )
    await nextTick()
    const stop = stopButton(view)
    expect(
      stop,
      'a running command with a key and a stoppable session offers no Stop',
    ).toBeDefined()
    stop!.click()
    await nextTick()
    // ⛔ `28992`, not `exec-14dfe485-…`: they are different strings and only one of them stops
    // anything. The live probe sent this one and the OS stopped listing the process.
    expect(asked).toEqual([KEY])
    await nextTick()
    expect(stopButton(view)!.textContent).toContain('Stopping…')
  })

  it('⛔ gives the button back when the request did not go out', async () => {
    // ⚠️ **`106` manufactured by the app itself**: a stop that failed and left the only control
    // reading *"Stopping…"* for ever is worse than no button. `BackgroundBar` learnt this in 248.
    const view = mount(
      paneWith({ onStopBackgroundWork: () => Promise.resolve(false) }),
      {},
      { width: 1100, height: 900 },
    )
    await nextTick()
    const stop = stopButton(view)!
    stop.click()
    await nextTick()
    await nextTick()
    expect(stopButton(view)!.textContent).toContain('Stop this command')
  })

  it('🔴 a NEW command wearing a recycled provider key is not born disabled — 287 finding 4', async () => {
    // ⛔ **Codex's `processId` is a counter it recycles** — `background-terminals.test.ts` brings one
    // back on purpose, because *"the provider's counter is not unique for ever"*. ⚠️ The first draft
    // of this latch was keyed on that number, so the next command born with it arrived reading
    // *"Stopping…"* over a request nobody had made for it. This is why the latch is keyed by CALL.
    const showing = ref(runningCommand())
    showing.value.meta = liveMeta()
    const props = paneProps({
      record: showing.value,
      onStopBackgroundWork: () => Promise.resolve(true),
    })
    const Host = defineComponent({
      name: 'RecycleHost',
      setup() {
        return () => h(ConversationPane as Component, { ...props, record: showing.value })
      },
    })
    const view = mount(Host, {}, { width: 1100, height: 900 })
    await nextTick()
    stopButton(view)!.click()
    await nextTick()
    await nextTick()
    expect(stopButton(view)!.textContent, 'the paired positive: it really is latched').toContain(
      'Stopping…',
    )

    // The command ends, and a SECOND one is born wearing the same recycled number.
    const next = createSessionRecord('sess_1')
    next.meta = liveMeta()
    next.phase = 'open'
    for (const event of [
      { type: 'status', state: 'working' },
      { type: 'tool_call', id: CALL, name: 'shell', summary: 'seq 1 12', backgroundId: KEY },
      { type: 'tool_result', id: CALL, summary: 'stopped', ok: false },
      { type: 'tool_call', id: 'exec-second', name: 'shell', summary: 'again', backgroundId: KEY },
    ] as unknown as TranscriptEvent[]) {
      applyEvent(next.transcript, event)
    }
    showing.value = next
    await nextTick()
    await nextTick()
    const buttons = view.host.querySelectorAll<HTMLButtonElement>('[data-cy^="tool-stop-"]')
    expect(
      buttons.length,
      'the settled row keeps its button, or the paired positive is empty',
    ).toBe(1)
    expect(
      buttons[0]?.textContent,
      'a command born with a recycled number arrived already disabled',
    ).toContain('Stop this command')
  })

  it('⛔ does NOT offer it on a session whose adapter cannot stop one — 106, and the paired positive', async () => {
    const plain = runningCommand()
    plain.meta = { ...META, liveness: { ...META.liveness, canReadCommandOutput: true } }
    const props = paneProps({ record: plain, onStopBackgroundWork: () => Promise.resolve(true) })
    const view = mount(
      defineComponent({
        name: 'NoStopHost',
        setup() {
          return () => h(ConversationPane as Component, props)
        },
      }),
      {},
      { width: 1100, height: 900 },
    )
    await nextTick()
    expect(stopButton(view) !== null).toBe(false)
    // ⚑ The positive that makes the negative mean something: the card really is on screen and
    // really is running, so the absence is the gate rather than an empty transcript.
    expect(view.q('tool-entry').getAttribute('data-status')).toBe('running')
  })

  it('⛔ and not on a command that has already reported back', async () => {
    const settled = record([
      {
        type: 'tool_call',
        id: CALL,
        name: 'shell',
        summary: 'seq 1 12',
        backgroundId: KEY,
      } as unknown as TranscriptEvent,
      {
        type: 'tool_result',
        id: CALL,
        summary: 'done',
        ok: true,
        backgroundId: KEY,
      } as unknown as TranscriptEvent,
    ])
    settled.meta = liveMeta()
    const props = paneProps({ record: settled, onStopBackgroundWork: () => Promise.resolve(true) })
    const view = mount(
      defineComponent({
        name: 'SettledHost',
        setup() {
          return () => h(ConversationPane as Component, props)
        },
      }),
      {},
      { width: 1100, height: 900 },
    )
    await nextTick()
    // ⛔ **This is what keeps a RECYCLED provider id unreachable.** Codex's `processId` is a counter
    // it reuses and a transcript row lives for ever; the gate is that the row must still be running.
    expect(stopButton(view) !== null).toBe(false)
    // ⚑ **`587` · the paired positive, one drawing on.** A command that has reported back is no
    // longer a card — it is a member of a quiet run — so the row is found as a run and asked what
    // became of it. ⛔ **The positive is still a POSITIVE**: without it, *no stop button* would
    // pass on a conversation that drew no row at all.
    expect(view.all('tool-run')).toHaveLength(1)
    view.q('tool-run-toggle').click()
    await nextTick()
    expect(view.q('tool-run-outcome').getAttribute('data-outcome'), 'the paired positive').toBe(
      'done',
    )
  })
})
