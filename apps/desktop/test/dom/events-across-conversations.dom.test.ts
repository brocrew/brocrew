import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { createSessionRecord, type SessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import {
  appendLive,
  createWindow,
  type WindowState,
} from '../../src/renderer/src/lib/transcript-window'
import type { CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { drawerProps, META, mount, paneProps, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 The Events tab belongs to ONE conversation (292 §4, from `288` M2)
 *
 * ## What was wrong
 *
 * `RuntimeScreen` renders `ConversationPane` with no session key, so the pane — and the drawer, and
 * `EventStream` inside it — is REUSED when the active conversation changes. ⛔ **Everything the
 * stream keeps is therefore carried across**: the DOM scroll offset, the virtualized slice's
 * `first`/`last`, the measured row height, and `useStickToBottom`'s `let stuck`, which closes over
 * a plain local and exposes no way to reset it.
 *
 * ⚠️ **The follow is the one that costs something.** Scroll up in A to read an event, open B, and
 * B's new events stop arriving at the bottom — though nobody released follow in B. There is no
 * control to press and nothing on screen that changed, which is the shape `106` is about.
 *
 * ## What this file can prove, said before any of it is read
 *
 * ⚑ **It drives the real `SessionDrawer`**, which is where the key lives, over a real Chromium
 * scroll box — so the claim is about the component the app renders rather than about a prop. It
 * cannot drive `RuntimeScreen` (nothing in this repository mounts it: `211` §11, `212` §9,
 * `214` §8), so the fact that the pane is reused is taken from that file's own render site and is
 * modelled here by swapping the drawer's props on one mount, which is exactly what reuse means.
 */

const AT = 1_700_000_000_000

function noise(index: number): TranscriptEvent {
  return { type: 'tool_call', name: `Read_${index}`, id: `t_${index}`, input: {} } as never
}

/** A window with `count` events already in it — enough to overflow the box and be scrollable. */
function filled(count: number, from: number): WindowState {
  const win = reactive(createWindow())
  for (let index = 0; index < count; index += 1) {
    appendLive(win, { event: noise(from + index), at: AT + index } as never)
  }
  return win
}

function sessionNamed(sessionId: string): CreatedSession {
  return { ...META, sessionId }
}

interface Open {
  view: Mounted
  /** Point the drawer at another conversation, exactly as re-pointing a reused pane does. */
  go: (sessionId: string, window: WindowState) => void
  log: () => HTMLElement
}

function drawer(sessionId: string, window: WindowState): Open {
  const live = ref({ sessionId, window })
  const Host = defineComponent({
    name: 'DrawerHost',
    setup() {
      return () =>
        h(SessionDrawer as Component, {
          ...drawerProps({
            session: sessionNamed(live.value.sessionId),
            state: createTranscript(),
            shown: createTranscript(),
            window: live.value.window,
            tab: 'events',
          }),
        })
    },
  })
  const view = mount(Host, {}, { width: 900, height: 600 })
  return {
    view,
    go: (next, win) => (live.value = { sessionId: next, window: win }),
    log: () => view.q('event-log'),
  }
}

/** Is the box parked on its newest line? The same threshold `useStickToBottom` uses. */
function atBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 40
}

afterEach(unmountAll)

describe('the Events tab across a conversation switch (292 §4)', () => {
  it('🔴 B follows its own newest events, though A had been scrolled away from the bottom', async () => {
    const a = filled(200, 0)
    const open = drawer('sess_a', a)
    await nextTick()

    // Non-vacuity: the box really does scroll, and it really is following A to begin with.
    const log = open.log()
    expect(
      log.scrollHeight,
      'the events box does not overflow — nothing here is measuring',
    ).toBeGreaterThan(log.clientHeight + 100)
    appendLive(a, { event: noise(900), at: AT + 900 } as never)
    await nextTick()
    await nextTick()
    expect(atBottom(open.log()), 'A was not following to start with').toBe(true)

    // The person scrolls up in A to read something. Follow is released — for A.
    log.scrollTop = 0
    log.dispatchEvent(new Event('scroll'))
    await nextTick()
    appendLive(a, { event: noise(901), at: AT + 901 } as never)
    await nextTick()
    await nextTick()
    expect(atBottom(open.log()), 'scrolling up did not release the follow — no defect to fix').toBe(
      false,
    )

    // …then opens B, with the drawer still on Events.
    const b = filled(200, 5_000)
    open.go('sess_b', b)
    await nextTick()

    appendLive(b, { event: noise(5_900), at: AT + 5_900 } as never)
    await nextTick()
    await nextTick()

    // 🔴 **The finding.** B inherited A's released follow and A's offset.
    expect(atBottom(open.log()), 'B stopped following though nobody released follow in B').toBe(
      true,
    )
  })

  it("⚑ …and the rows on screen are B's — measured, and it passes WITHOUT the key too", async () => {
    // ⛔ **Reported honestly, because measuring it changed what it is worth.** `288` M2's second
    // half is *"with equal-length windows the virtualized slice can hold A's indices, because the
    // only watcher observes row count"* — and the indices really do stay put. ⚠️ **They are not
    // observable as wrong CONTENT**: the band is a pair of numbers, and the rows it draws are read
    // from `props.window.entries`, which is B's the moment the prop changes. So the held indices
    // surface as the SCROLL OFFSET, which is the test above, and not as B showing A's events.
    //
    // ⚑ **Measured with the key removed: this test passes either way** — kept as the paired
    // positive that the tab really did re-point at B, so the follow assertion above cannot be
    // satisfied by a component that had stopped drawing anything.
    const a = filled(200, 0)
    const open = drawer('sess_a', a)
    await nextTick()

    const log = open.log()
    log.scrollTop = 0
    log.dispatchEvent(new Event('scroll'))
    await nextTick()
    // What A is showing at the top, so "B's rows" is a difference rather than an absolute.
    expect(open.view.q('event-log').textContent).toContain('Read_0')

    open.go('sess_b', filled(200, 5_000))
    await nextTick()
    await nextTick()

    const shown = open.view.q('event-log').textContent ?? ''
    expect(shown, 'the Events tab is still drawing the previous conversation').not.toContain(
      'Read_0',
    )
    expect(shown).toContain('Read_5000')
  })

  it('⚑ the paired positive: within ONE conversation the release still holds', async () => {
    // ⛔ **Without this, a stream that simply followed everything always would pass both tests
    // above** — and that is the defect `useStickToBottom` exists to prevent: a live log that yanks
    // you back to the bottom while you are reading. The reset is bound to the conversation
    // changing, not to events arriving.
    const a = filled(200, 0)
    const open = drawer('sess_a', a)
    await nextTick()

    const log = open.log()
    log.scrollTop = 0
    log.dispatchEvent(new Event('scroll'))
    await nextTick()

    appendLive(a, { event: noise(950), at: AT + 950 } as never)
    await nextTick()
    await nextTick()

    expect(atBottom(open.log()), 'the log yanked the reader back to the bottom').toBe(false)
  })
})

/**
 * # 🔴 The TRANSCRIPT belongs to one conversation too (299 §2, from 297 finding 3)
 *
 * ⛔ **`SessionDrawer` was keyed in 292 §4 and `ConversationPane` keys its composer, and the
 * transcript — which holds the same `let stuck` through the same composable — was the one child
 * nobody keyed.** Everything above describes the defect; this is the same defect one component
 * along, in the surface a reader actually looks at, where what stops following is the conversation
 * itself and every permission card in it.
 *
 * ⚑ **`ConversationPane` is mounted directly**, because that is where the key lives. `RuntimeScreen`
 * is mounted by nothing in this repository (211 §11, 212 §9, 214 §8), so the reuse it performs is
 * modelled the way the drawer's is above: one mount, its `record` prop re-pointed.
 */

function said(ordinal: number): TranscriptEvent {
  return {
    type: 'assistant_message',
    text: `line ${ordinal} — ${'the quick brown fox jumps over the lazy dog. '.repeat(2)}`,
  } as TranscriptEvent
}

/** A conversation with `count` messages already in it, reactive so it can grow on screen. */
function talking(sessionId: string, count: number): SessionRecord {
  const rec = reactive(createSessionRecord(sessionId)) as SessionRecord
  rec.meta = { ...META, sessionId }
  rec.phase = 'open'
  for (let index = 0; index < count; index += 1) {
    applyEvent(rec.transcript, said(index), AT + index, index)
  }
  return rec
}

/** One more message, as the provider really sends it. */
function grow(rec: SessionRecord): void {
  const next = rec.transcript.items.length
  applyEvent(rec.transcript, said(1_000 + next), AT + 1_000 + next, 1_000 + next)
}

describe('the transcript across a conversation switch (299 §2)', () => {
  function paneOn(record: SessionRecord): {
    view: Mounted
    go: (next: SessionRecord) => void
    box: () => HTMLElement
  } {
    const live = ref(record)
    const Host = defineComponent({
      name: 'PaneHost',
      setup() {
        return () => h(ConversationPane as Component, paneProps({ record: live.value }))
      },
    })
    const view = mount(Host, {}, { width: 1_200, height: 500 })
    return { view, go: (next) => (live.value = next), box: () => view.q('transcript') }
  }

  it('🔴 B follows its own newest line, though A had been scrolled away from the bottom', async () => {
    const a = talking('sess_a', 40)
    const open = paneOn(a)
    await nextTick()
    const box = open.box()
    expect(
      box.scrollHeight,
      'the transcript does not overflow — nothing here is measuring',
    ).toBeGreaterThan(box.clientHeight + 100)

    // Following A to begin with.
    grow(a)
    await nextTick()
    await nextTick()
    expect(atBottom(open.box()), 'A was not following to start with').toBe(true)

    // The reader scrolls up in A to read something. Follow is released — for A.
    box.scrollTop = 0
    box.dispatchEvent(new Event('scroll'))
    await nextTick()
    grow(a)
    await nextTick()
    await nextTick()
    expect(atBottom(open.box()), 'scrolling up did not release the follow').toBe(false)

    // …then opens B on the same, reused pane.
    const b = talking('sess_b', 40)
    open.go(b)
    await nextTick()
    grow(b)
    await nextTick()
    await nextTick()

    // 🔴 Without the key, B inherits A's released follow and A's offset — and stops following its
    // own newest line, permission cards included, for the life of the mount.
    expect(atBottom(open.box()), 'B stopped following though nobody released follow in B').toBe(
      true,
    )
  })

  it('⚑ …and A is still where the reader left it when they go back to it', async () => {
    // The paired positive: a key rebuilds the child, so B cannot inherit A — and it also must not
    // mean "every switch scrolls to the bottom of whatever it finds". A returns as a fresh mount of
    // its own conversation, following its own newest line.
    const a = talking('sess_a', 40)
    const open = paneOn(a)
    await nextTick()
    const b = talking('sess_b', 40)
    open.go(b)
    await nextTick()
    open.go(a)
    await nextTick()
    grow(a)
    await nextTick()
    await nextTick()
    expect(atBottom(open.box()), 'A stopped following its own newest line').toBe(true)
  })
})
