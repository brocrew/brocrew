import type { PersistedEventInfo } from '../src/shared/conversation-events'
import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick } from 'vue'
import { answerToForward } from '@brobot2/runtime'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
// 🔴 **623 · FIVE of the six readers of this clause in this file are NEGATIVES** (`HO-095` §2), and
// four of them are about a hand-over — the exact hypothesis that section raises. ⛔ They were aimed
// at the word `gap`, which `623` reworded out of the app; ⚠️ aimed at the export, a rewording moves
// them instead of leaving them green over a claim they had stopped being able to make.
import { NOT_REACHED_THIS_WINDOW } from '../src/renderer/src/lib/session-record'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { WINDOW_MAX_EVENTS } from '../src/renderer/src/lib/transcript-window'
import type { ResumedSession } from '../src/shared/runtime-ipc'
import { ended, fakeBridge, hello, reply } from './lib/session-store-double'

/**
 * Drive multiple sessions through the store without components, a DOM or a provider.
 * These cases exercise routing, buffering and ordinal continuity independently of rendering.
 */

/**
 * ⛔ **296 · which word a BROKEN CHANNEL gets, per verb — and this block exists because a mutation
 * measured that nothing checked it.** `mutations.py` M17 flips the child-state catch from
 * `unreachable` to `unknown-agent`; the row was applied and all three projects stayed GREEN, so the
 * distinction the store's own comment argues for was protected by nothing at all.
 *
 * ⚠️ **The two words are not interchangeable and that is the whole point.** `unknown-agent` says
 * this session's LEDGER has no such child — a claim about our own record. `unreachable` says the
 * provider was asked and did not answer. A bridge that threw supports the second and not the first,
 * and printing the first would blame the ledger for a broken pipe.
 */

describe('296 · a channel that failed is not a fact about the child', () => {
  const throwing = (): ReturnType<typeof fakeBridge> => {
    const bridge = fakeBridge()
    bridge.readChildState = async () => {
      throw new Error('the bridge is gone')
    }
    bridge.sendToChild = async () => {
      throw new Error('the bridge is gone')
    }
    bridge.readChildWork = async () => {
      throw new Error('the bridge is gone')
    }
    return bridge
  }

  it('⛔ a thrown bridge is `unreachable` for BOTH child verbs', async () => {
    const store = createSessionStore(throwing())
    expect(await store.readChildState('sess_1', 'agent_1')).toEqual({
      ok: false,
      reason: 'unreachable',
    })
    expect(await store.sendToChild('sess_1', 'agent_1', 'hello')).toEqual({
      ok: false,
      reason: 'unreachable',
    })
  })

  it('⚑ …and STILL `unknown-agent` for the file read beside them — the paired negative', async () => {
    // ⚠️ The 112 ruling, unchanged and now pinned against its neighbour: a channel that failed says
    // nothing about a FILE, so the refusal that claims nothing about disk is the honest one there.
    // Without this half, both catches could be collapsed onto one word and nothing would notice.
    const store = createSessionStore(throwing())
    expect(await store.readChildWork('sess_1', { part: 'transcript', agentId: 'agent_1' })).toEqual(
      {
        ok: false,
        reason: 'unknown-agent',
      },
    )
  })

  it('the paired positive: a bridge that answers is passed through untouched', async () => {
    const store = createSessionStore(fakeBridge())
    expect(await store.readChildState('sess_1', 'agent_1')).toEqual({
      ok: false,
      reason: 'not-live',
    })
  })
})

describe('the session store', () => {
  it('keeps two conversations at once, each with its own transcript', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)

    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''
    expect(first).not.toBe(second)

    bridge.__emit(first, 0, hello('to the first'))
    bridge.__emit(second, 0, hello('to the second'))
    bridge.__emit(second, 1, reply('answering the second'))

    // Each session's events land in its own transcript and nowhere else.
    expect(store.get(first)?.transcript.items.map((item) => 'text' in item && item.text)).toEqual([
      'to the first',
    ])
    expect(store.get(second)?.transcript.items.map((item) => 'text' in item && item.text)).toEqual([
      'to the second',
      'answering the second',
    ])
    await nextTick()
    expect(store.live.value.map((record) => record.sessionId)).toEqual([first, second])
    store.dispose()
  })

  it('never asks the host to reopen something it is already running', async () => {
    // This is the "session is already open" error, gone by construction: the store answers from
    // what it already holds instead of asking.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    const again = await store.resume(id)

    expect(again).toBe(id)
    expect(bridge.__calls.filter((call) => call.startsWith('resume:'))).toEqual([])
    expect(store.launchError.value).toBeNull()
    store.dispose()
  })

  it('holds events that arrive before the host has said what the session is', async () => {
    // The provider starts talking the moment it is spawned, which can be before `createSession`
    // resolves. Those events are the beginning of the conversation, not noise.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)

    // Two sessions opening at once, one of them already streaming.
    bridge.__emit('sess_1', 0, hello('said before we were told'))
    bridge.__emit('sess_2', 0, hello('the other one, also early'))

    await store.create({ provider: 'claude' }) // becomes sess_1
    await store.create({ provider: 'codex' }) // becomes sess_2

    expect(store.get('sess_1')?.transcript.items.map((i) => 'text' in i && i.text)).toEqual([
      'said before we were told',
    ])
    // The old single-session code cleared one shared buffer on every start; the second session's
    // opening events would have gone with it.
    expect(store.get('sess_2')?.transcript.items.map((i) => 'text' in i && i.text)).toEqual([
      'the other one, also early',
    ])
    store.dispose()
  })

  it('continues the ordinals across a resume, so the seam raises no gap', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_old', [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      { ordinal: 1, at: 2_000, event: reply('this') },
      {
        ordinal: 2,
        at: 3_000,
        event: {
          type: 'session',
          state: 'ended',
          ref: { provider: 'claude', sessionId: 'x', cwd: '/w', rotation: 0 },
        },
      },
    ])

    await store.resume('sess_old')
    // The live stream carries on from where the recording stopped.
    bridge.__emit('sess_old', 3, reply('and now this'))

    const items = store.get('sess_old')?.transcript.items ?? []
    expect(items.map((item) => 'text' in item && item.text)).toEqual([
      'what did we say?',
      'this',
      // ⚑ **D-017b · no `session ended` notice** — whether a process runs is never said (`05` rule
      // 5), so the replay's ending draws nothing between the two lives.
      'and now this',
    ])
    // A hole would have been folded in as an error notice; there is none.
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(false)
    // …and it is usable again rather than still reading as the ended session it was.
    expect(store.get('sess_old')?.transcript.ended).toBe(false)
    store.dispose()
  })

  /**
   * ## An attached conversation never stopped, so nothing in it may be declared finished (100)
   *
   * ⚠️ **653 · of its RUNNING life.** An attached hand-over whose running life was itself a reopen
   * carries `liveFrom`, and the life before it IS corrected there — see
   * `a-woken-conversation-drawn-as-ended.test.ts`. The fixture below has no earlier life, which is
   * the case this section is about.
   *
   * `markReopened` says, in its own words, *"the only true one on reopen is that nothing is
   * running"*: it settles every pending card, clears the activity, stops the running sub-agents and
   * closes the open tool calls. That is right for a RECORDING being reopened and wrong for a
   * session the host never stopped — and the difference is the whole reason `attachOpen` is not
   * just `resume` under another name.
   *
   * Driven as an A/B against the SAME history, because that is the only way to show the difference
   * is the code path rather than the fixture.
   */
  const stillWaiting = (): PersistedEventInfo[] => [
    { ordinal: 0, at: 1_000, event: hello('run it') },
    // ⚠️ **A tool call with no result — a tool that is RUNNING** (review sweep). The invariant names
    // three things an attached session keeps: an answerable card, a running tool, and a running
    // sub-agent. Testing only the card would leave `stopOpenToolCalls` — which `markReopened` also
    // calls — unpinned, and it is the one that draws a working tool as finished.
    {
      ordinal: 1,
      at: 1_500,
      event: { type: 'tool_call', id: 'call_live', name: 'Bash', summary: 'sleep 30' },
    },
    {
      ordinal: 2,
      at: 2_000,
      event: {
        type: 'permission_request',
        id: 'req_live',
        kind: 'command',
        action: 'run a command',
        detail: 'ls',
        scope: {
          cwd: '/work',
          paths: [],
          networkHosts: [],
          persistence: 'once',
          amendments: [],
          availableDecisions: ['allow', 'deny'],
          underDisclosed: false,
        },
      },
    },
  ]

  it('leaves an attached conversation still waiting on the question it is waiting on', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_live', stillWaiting())
    bridge.__held.add('sess_live')

    expect(await store.attachOpen()).toEqual(['sess_live'])

    const items = store.get('sess_live')?.transcript.items ?? []
    const card = items.find((item) => item.kind === 'permission')
    // Still answerable: this agent is sitting in front of the user right now waiting for a click.
    expect(card).toMatchObject({ outcome: null })
    expect(card && 'note' in card && card.note).toBeFalsy()
    // …and the tool it is running is still running, not drawn as one that died with a past life.
    const tool = items.find((item) => item.kind === 'tool')
    expect(tool).toBeDefined()
    expect(tool && 'unfinished' in tool && tool.unfinished).toBeFalsy()
    // …and the epoch that would have made a re-fold settle both of them later was never written.
    expect(store.get('sess_live')?.liveFrom).toBeNull()
    store.dispose()
  })

  it('does not fold an event twice when it is both buffered and in the replayed page', async () => {
    // ⚠️ **Found in review.** The host writes an event to the ledger and THEN pushes it to the
    // sink, so an event that arrives while the hand-over is in flight is already inside the history
    // the host read — and the buffer holds it too, because this record has no `meta` yet. Applied
    // twice, `acceptEvent` folds the duplicate in AND reports a gap, because the ordinal it gets is
    // not the one it is waiting for. Only a LIVE hand-over can produce this; a stopped conversation
    // emits nothing mid-resume, which is why the resume path never met it.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_live', [
      { ordinal: 0, at: 1_000, event: hello('run it') },
      { ordinal: 1, at: 2_000, event: reply('the reply that must appear once') },
    ])
    bridge.__held.add('sess_live')

    const attaching = store.attachOpen()
    // Delivered before the answer comes back — the same ordinal the page above already carries.
    bridge.__emit('sess_live', 1, reply('the reply that must appear once'), 2_000)
    await attaching

    const items = store.get('sess_live')?.transcript.items ?? []
    const replies = items.filter(
      (item) => 'text' in item && item.text === 'the reply that must appear once',
    )
    expect(replies).toHaveLength(1)
    // …and no hole was invented, which is the second half of the same mistake.
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(false)
    // Non-vacuity: the page really was replayed, so this is not passing over an empty transcript.
    expect(items.some((item) => 'text' in item && item.text === 'run it')).toBe(true)
    store.dispose()
  })

  it('a SECOND hand-over for a session already taken is refused, and costs it nothing (149)', async () => {
    // ⛔ **The other half of the guard 149 narrowed, and nothing pinned it — M26 came back green.**
    // Reconciliation runs on its own the moment a store is built and a click can be in the air at
    // the same time, so two hand-overs for one conversation can both be in flight. The second must
    // stop: `openWindow` clears the record before it replays, so re-adopting throws away every live
    // event folded since the first one — the busiest conversations losing the most.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_live', [{ ordinal: 0, at: 1_000, event: hello('run it') }])
    bridge.__held.add('sess_live')

    expect(await store.resume('sess_live')).toBe('sess_live') // the click gets there first
    bridge.__emit('sess_live', 1, reply('and this arrived after the hand-over'), 2_000)

    // …and the reconciliation lands afterwards, offering the same conversation again.
    expect(await store.attachOpen()).toEqual([]) // it reports taking nothing, because it took nothing

    const items = store.get('sess_live')?.transcript.items ?? []
    expect(items.some((item) => 'text' in item && item.text === 'run it')).toBe(true)
    expect(
      items.some((item) => 'text' in item && item.text === 'and this arrived after the hand-over'),
    ).toBe(true)
    store.dispose()
  })

  it('never reports a reopen this window cannot show — the claim needs a source (149, 039)', async () => {
    // ⛔ **148 H1's other half.** `resume` used to return the id the moment the round trip resolved,
    // whatever the window had done with it, which is how a refused adoption was reported as a
    // reopened conversation. The question it answers now is "is this conversation open HERE".
    //
    // Two reopens in flight for one session take the same record (`slot` returns it). The one that
    // FAILS no longer deletes it while the other is out (card 611: one rule for every hand-over), so
    // the survivor adopts a record the map still holds: it is open here, and it is reported.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const real = bridge.resume
    let release: (() => void) | null = null
    let call = 0
    bridge.resume = (input) => {
      call += 1
      // The first press is held open; the second is refused while it waits.
      if (call === 1) return new Promise((resolve) => (release = () => resolve(real(input))))
      return Promise.reject(new Error('the host said no'))
    }

    const held = store.resume('sess_x')
    expect(await store.resume('sess_x')).toBeNull() // refused, and the record stays for the other
    release!()

    expect(await held).toBe('sess_x')
    expect(store.isLive('sess_x')).toBe(true)
    expect(store.live.value.map((record) => record.sessionId)).toContain('sess_x')
    store.dispose()
  })

  it('settles the same card when the conversation is REOPENED, which is the difference', async () => {
    // ⚠️ **The other half of the A/B, and without it the test above is just an assertion that a
    // card is unsettled — which would pass against a build where nothing was ever settled at all.**
    // 085's rule stands for a genuine reopen: the buttons reach a new adapter that has never heard
    // of the id, so offering them is offering to act on the past.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_old', stillWaiting())

    await store.resume('sess_old')

    const items = store.get('sess_old')?.transcript.items ?? []
    const card = items.find((item) => item.kind === 'permission')
    expect(card && 'note' in card && card.note).toContain('when this conversation was last open')
    // …and the tool really is marked as having died with the session it belonged to.
    const tool = items.find((item) => item.kind === 'tool')
    expect(tool && 'unfinished' in tool && tool.unfinished).toBe(true)
    expect(store.get('sess_old')?.liveFrom).not.toBeNull()
    store.dispose()
  })

  it('reports a gap rather than pretending the conversation is whole', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    bridge.__emit(id, 0, hello('one'))
    bridge.__emit(id, 5, reply('five'))

    const items = store.get(id)?.transcript.items ?? []
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(true)
    store.dispose()
  })

  it('drops a session from the open list when it ends, and leaves the others alone', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''

    // ⚑ The ledger holds what the host sent — the page a look draws the record from (D-017b).
    bridge.__history.set(first, [{ ordinal: 0, at: 1_700_000_000_000, event: ended }])
    bridge.__emit(first, 0, ended)
    await nextTick()

    expect(store.live.value.map((record) => record.sessionId)).toEqual([second])
    // ⚑ **D-017b · its fold ended, so it is looked at again** — drawn from its ledger, `recorded`,
    // in the same view, rather than kept as the ended life's record.
    await vi.waitFor(() => {
      expect(bridge.__calls).toContain(`look:${first}`)
      expect(store.get(first)?.meta).toMatchObject({ handover: 'recorded' })
    })
    // It is not forgotten — the record stays, so a chat you close does not vanish while you are
    // still reading it. A message sent from it continues it.
    expect(store.get(first)?.phase).toBe('recorded')
    expect(store.get(first)?.transcript.ended).toBe(true)
    // The record is still here, which is what lets the screen keep showing a chat you just
    // closed instead of blanking it mid-read.
    expect(store.get(first)).not.toBeNull()
    expect(store.isLive(first)).toBe(false)
    store.dispose()
  })

  it('⚑ a recorded conversation let go tells the host this window stopped looking at it; one still held does not', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = 'sess_recorded'
    bridge.__history.set(id, [{ ordinal: 0, at: 1_700_000_000_000, event: ended }])
    expect(await store.look(id)).toBe(id)
    expect(store.get(id)?.phase).toBe('recorded')

    // ⛔ Held while a look at it is out: it is not let go, so the host is told nothing.
    const again = store.look(id, 'again')
    store.forget(id)
    expect(bridge.__calls).not.toContain(`stopLooking:${id}`)
    await again

    // ⚑ Let go: the host is told, once.
    store.forget(id)
    expect(store.get(id)).toBeNull()
    expect(bridge.__calls.filter((call) => call === `stopLooking:${id}`)).toHaveLength(1)
    store.dispose()
  })

  /**
   * ## Close and reopen the same record
   *
   * ⛔ **The premises were split and that is why nothing caught it.** Resume was tested on a virgin
   * record, close was tested on its own, and no test did both to one record — so a guard that read
   * *"already adopted"* off `meta` alone, and therefore refused to re-adopt a record whose life had
   * ENDED, satisfied every assertion in this file while stranding a live provider child behind a
   * conversation the window called over. The only way out was reloading the window, which works
   * because a fresh renderer holds no already-adopted record.
   *
   * ⚑ **It was never the sign-in button's bug.** Any close-then-reopen inside one window took this
   * path; the amber remedy is simply the first thing that does both in one gesture.
   */
  it('close then resume on the SAME record leaves the conversation OPEN and visible (149)', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, hello('what did we say?'))
    // What the host will hand back: this conversation's ledger, ending where it stopped.
    bridge.__history.set(id, [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      {
        ordinal: 1,
        at: 2_000,
        event: {
          type: 'session',
          state: 'ended',
          ref: { provider: 'claude', sessionId: 'x', cwd: '/w', rotation: 0 },
        },
      },
    ])

    expect(await store.close(id)).toBe(true)
    expect(store.isLive(id)).toBe(false) // the premise: an adopted record that has ended

    expect(await store.resume(id)).toBe(id)

    // ⛔ The four ways the failure showed itself, each asserted rather than inferred from one flag.
    expect(store.get(id)?.phase).toBe('open')
    expect(store.isLive(id)).toBe(true)
    expect(store.live.value.map((record) => record.sessionId)).toContain(id)
    expect(store.get(id)?.control.ended).toBe(false) // …and the composer is usable again

    // ⚠️ **And the previous life was not folded in twice.** 064 measured exactly that — "a
    // three-message conversation closed and reopened rendered six messages" — and `openWindow`
    // clearing the record first is what keeps re-adoption safe.
    const items = store.get(id)?.transcript.items ?? []
    expect(items.filter((item) => 'text' in item && item.text === 'what did we say?')).toHaveLength(
      1,
    )
    store.dispose()
  })

  /**
   * 🔴 **The sentence 239 called the most trust-eroding thing in the running app** (242 §3).
   *
   * ⛔ **What a person sees, twice per Codex Resume**: *"event stream gap: expected ordinal 108, got
   * 111"*, then *"expected ordinal 135, got 138"* — printed into the ordinary conversation, in
   * 239's words *"an intact-looking transcript announcing that it may not be intact."*
   *
   * ## ⛔ Measured before it was fixed, and the sentence is TRUE
   *
   * ⚑ **The ledger is whole.** `deliver` takes the ordinal, writes the row, and only then pushes to
   * the sink — so every one of the missing events is on disk, in order, and `assertGapFree` over the
   * session's ledger passes. ⚠️ **What is missing is what the RENDERER kept**, and this is where it
   * goes:
   *
   *  1. The host reads the history page and takes `startingOrdinal` **before** `runtime.resume`.
   *  2. `register` starts the pump, so the new life's first events are sent to the sink
   *     immediately — while the `resume` IPC answer is still travelling back to this window.
   *  3. ⛔ **The listener folded them**, because the routing test was `record?.meta` and a reopened
   *     conversation's record HAS `meta` — it is the record the previous life left behind.
   *  4. `replayInto` then clears the window and re-anchors `nextOrdinal` to the page, which ENDS
   *     BEFORE those events. They are gone, and the next live event is reported as a gap.
   *
   * 🔴 **So the notice is not the bug; it is the only honest thing in the sequence.** It is
   * correctly reporting a hole that was really there, and the repair is to stop making the hole —
   * `earlyEvents` and `adoptSession`'s drain, which already exist for exactly this, simply were not
   * reachable on the one path where a record already had `meta`.
   *
   * ⚠️ **Three, both times, because three is what Codex emits between register and the answer.**
   * The number is a property of the provider's opening, not of the mechanism.
   */
  it('🔴 events that land WHILE the reopen is in flight are kept, not dropped (242 §3, 239)', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, hello('what did we say?'))
    bridge.__history.set(id, [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      {
        ordinal: 1,
        at: 2_000,
        event: {
          type: 'session',
          state: 'ended',
          ref: { provider: 'claude', sessionId: 'x', cwd: '/w', rotation: 0 },
        },
      },
    ])
    expect(await store.close(id)).toBe(true)

    // ⚑ **The race, made deterministic.** The host's pump is running before its answer arrives, so
    // these three are emitted after the history window was snapshotted and before `resume` resolves
    // — which is exactly the ordering `reopenSession` produces and cannot avoid.
    const answer = bridge.resume
    bridge.resume = async (input) => {
      const resumed = await answer(input)
      bridge.__emit(id, 2, reply('first of the new life'))
      bridge.__emit(id, 3, reply('second'))
      bridge.__emit(id, 4, reply('third'))
      return resumed
    }

    expect(await store.resume(id)).toBe(id)
    bridge.__emit(id, 5, reply('and now this'))

    const items = store.get(id)?.transcript.items ?? []
    // ⛔ **No hole reported**, which is the sentence a person was reading…
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(false)
    // …and the three events it was telling the truth about are ON SCREEN.
    expect(items.map((item) => ('text' in item ? item.text : item.kind))).toEqual([
      'what did we say?',
      // ⚑ D-017b: the previous life's ending draws no `session ended` notice (`05` rule 5).
      'first of the new life',
      'second',
      'third',
      'and now this',
    ])
    store.dispose()
  })

  it('🔴 a SECOND reopen settling first does not un-hold the first one (242 §3, adversarial pass)', async () => {
    /**
     * ⛔ **The hold was a boolean, and two reopens of one session are reachable.**
     *
     * `store.resume` is wired to `@reopen` from both the side rail and the session library, and
     * their re-entrancy guards are separate per-component maps that do not consult each other. So
     * the second press's `finally` lowered the flag while the FIRST was still waiting on the
     * provider — and every event from that moment was folded into the transcript `replayInto` was
     * about to clear. ⚠️ **242 §3's defect, reintroduced by 242 §3's fix**, which is why the hold is
     * a COUNT.
     */
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, hello('what did we say?'))
    bridge.__history.set(id, [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      {
        ordinal: 1,
        at: 2_000,
        event: {
          type: 'session',
          state: 'ended',
          ref: { provider: 'claude', sessionId: 'x', cwd: '/w', rotation: 0 },
        },
      },
    ])
    expect(await store.close(id)).toBe(true)

    // A slow first reopen, and a fast second one that settles while the first is still out.
    const answer = bridge.resume
    // ⚠️ A no-op rather than `null`: the only assignment is inside a Promise executor, which TS's
    // control flow does not follow, so a nullable would narrow to `null` at the call below.
    let releaseFirst = (): void => {}
    let call = 0
    bridge.resume = async (input) => {
      call += 1
      if (call === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        return await answer(input)
      }
      // The second press is refused by the host — "already opening" — and takes the failure exit,
      // which is the one that must NOT lower a hold it does not own.
      throw new Error('session is already opening')
    }

    const first = store.resume(id)
    const second = store.resume(id)
    await expect(second).resolves.toBeNull()

    // ⛔ The events the new life emits WHILE the first reopen is still in flight.
    bridge.__emit(id, 2, reply('first of the new life'))
    bridge.__emit(id, 3, reply('second'))
    bridge.__emit(id, 4, reply('third'))
    releaseFirst()
    expect(await first).toBe(id)
    bridge.__emit(id, 5, reply('and now this'))

    const items = store.get(id)?.transcript.items ?? []
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(false)
    expect(items.map((item) => ('text' in item ? item.text : item.kind))).toEqual([
      'what did we say?',
      // ⚑ D-017b: the previous life's ending draws no `session ended` notice (`05` rule 5).
      'first of the new life',
      'second',
      'third',
      'and now this',
    ])
    store.dispose()
  })

  it('⛔ …and a reopen that FAILS does not keep them in a buffer nobody reads (242 §3)', async () => {
    // ⚠️ **The other end of the hold.** `foldHeldEvents` runs on the successful path from inside
    // `adoptSession`; a refused reopen never reaches it, so without the failure branch these events
    // would be received by this window, held, and never drawn — a quieter version of the very
    // defect being fixed.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, hello('what did we say?'))
    expect(await store.close(id)).toBe(true)

    bridge.resume = () => {
      bridge.__emit(id, 1, reply('arrived while the reopen was failing'))
      return Promise.reject(new Error('the host said no'))
    }
    // ⚑ The ledger holds both: the host writes a row before it sends it (`deliver`).
    bridge.__history.set(id, [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      { ordinal: 1, at: 2_000, event: reply('arrived while the reopen was failing') },
    ])
    expect(await store.resume(id)).toBeNull()

    // ⚑ **D-017b · a RECORDED record's held events are not folded into its page**: they say this
    // window is being fed the conversation, so it is looked at again, and the page it is drawn from
    // has them. ⛔ And nothing is left in the buffer.
    await vi.waitFor(() => {
      expect(bridge.__calls).toContain(`look:${id}`)
      const items = store.get(id)?.transcript.items ?? []
      expect(items.map((item) => ('text' in item ? item.text : item.kind))).toContain(
        'arrived while the reopen was failing',
      )
    })
    expect(store.get(id)?.earlyEvents).toEqual([])
    store.dispose()
  })

  it('⛔ …and does not ask the host about a session it is already being handed (242 §3)', async () => {
    // ⚠️ **The cost of holding events, kept at zero.** `askAboutUnknown` exists for a session nobody
    // ever described (172); a hand-over in flight IS the description, and asking again would spend a
    // round trip — carrying every open conversation's history window — to be told what is already on
    // its way. The bound in 172 M2 makes it one wasted trip rather than one per event, which is why
    // this is a cost rather than a storm; it is still a trip nothing needed.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    expect(await store.close(id)).toBe(true)
    const before = bridge.__calls.filter((call) => call === 'attachOpen').length

    const answer = bridge.resume
    bridge.resume = async (input) => {
      bridge.__emit(id, 1, reply('mid-handover'))
      return await answer(input)
    }
    await store.resume(id)

    expect(bridge.__calls.filter((call) => call === 'attachOpen')).toHaveLength(before)
    store.dispose()
  })

  it('…and a resume the host REFUSED still reports failure — the paired negative (149)', async () => {
    // The other half of the pair. Reporting the id is a claim that this window has the conversation
    // open; when it does not, saying so is what puts the sentence under the row the user pressed and
    // keeps the Resume there to press again.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    expect(await store.close(id)).toBe(true)
    bridge.resume = () => Promise.reject(new Error('the host said no'))

    expect(await store.resume(id)).toBeNull()
    expect(store.isLive(id)).toBe(false)
    expect(store.get(id)?.phase).toBe('recorded')
    expect(store.resumeError.value).toBe('the host said no')
    store.dispose()
  })

  it('does not call a session ended when the host refused to close it', async () => {
    // Marking it ended anyway would drop a conversation the host is still running out of the
    // list, and the only way back would be a reopen the host would then refuse.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.close = () => Promise.reject(new Error('the host said no'))

    // ⚑ **And it SAYS the host refused** (147). `reopenSignIn` closes and then reopens, and a reopen
    // on top of a close that failed attaches to the very child it was trying to leave behind — and
    // reports success. The sentence is already on the record; this boolean is what lets a caller
    // stop. The pair matters: the success case below has to answer `true`, or a caller that checked
    // it would never reopen anything.
    expect(await store.close(id)).toBe(false)

    expect(store.isLive(id)).toBe(true)
    expect(store.get(id)?.error).toBe('the host said no')
    // ⚠️ **And the word goes back to `open`** (089). `closing` is a claim about a future that is
    // not coming; a row left in it would draw a fading underline, forever, on a live conversation.
    expect(store.get(id)?.phase).toBe('open')
    store.dispose()
  })

  /**
   * ⚠️ **The window `closing` exists for** (089). Teardown drains and archives (075), and for the
   * whole of it the provider still reports `live` — `LivenessState` has no word for this. That a
   * close was asked for is a fact only this side holds, which is why the store says it rather than
   * waiting to be told (064's principle, on the way out).
   */
  it('says a session is CLOSING from the moment we ask, not when the ending lands', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    expect(store.get(id)?.phase).toBe('open')

    let release = (): void => {}
    bridge.close = () =>
      new Promise<void>((resolve) => {
        release = () => resolve()
      })
    const closing = store.close(id)
    await nextTick()

    // Mid-teardown: on its way out, and still in the open list, because it is still open.
    expect(store.get(id)?.phase).toBe('closing')
    expect(store.isLive(id)).toBe(true)

    release()
    await closing
    expect(store.get(id)?.phase).toBe('recorded')
    expect(store.isLive(id)).toBe(false)
    store.dispose()
  })

  it('says it about a session closed before the host finished opening it, too', async () => {
    // ⚠️ The case the first version of this missed (089 review): the guard read `=== 'open'`, so a
    // conversation closed while still `opening` went `starting → ended` with no closing state at
    // all — and that is the case where teardown is MOST likely to take a visible moment, because
    // the host must wait for the provider to arrive before it can stop it.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = 'sess_opening'
    const resume = bridge.resume
    let finishOpening = (): void => {}
    bridge.resume = (input) =>
      new Promise((resolve) => {
        finishOpening = () => resolve(resume(input))
      })
    const opening = store.resume(id)
    expect(store.get(id)?.phase).toBe('opening')

    let fail = (): void => {}
    bridge.close = () =>
      new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error('the host said no'))
      })
    const closing = store.close(id)
    await nextTick()
    expect(store.get(id)?.phase).toBe('closing')

    // …and a refusal puts back the phase it actually had, not a flat `open` it was never in.
    fail()
    await closing
    expect(store.get(id)?.phase).toBe('opening')
    finishOpening()
    await opening
    store.dispose()
  })

  it('sends to the session you name, not to whichever spoke last', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''

    await store.send(first, 'for the first')
    await store.send(second, 'for the second')

    expect(bridge.__calls.filter((call) => call.startsWith('send'))).toEqual([
      `send:${first}`,
      `send:${second}`,
    ])
    store.dispose()
  })

  it('the USER picks interrupt-or-queue; a bare send never interrupts on its own (077)', async () => {
    // A plain send from the open composer must not silently interrupt and discard the running
    // turn’s work. The person chooses whether to queue or interrupt a mid-turn message.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, { type: 'status', state: 'working' })

    await store.send(id, 'stop that, do this instead', 'interrupt')
    await store.send(id, 'and afterwards, this', 'queue')

    expect(bridge.__calls).toContain(`sendInterrupting:${id}`)
    expect(bridge.__calls).toContain(`queueMessage:${id}`)
    store.dispose()
  })

  it('⛔ a cancel names the MESSAGE, and the name reaches the wire (354)', async () => {
    // ⚠️ **The store is the last place the id could be dropped**, and dropping it would not fail:
    // `cancelQueuedMessage` used to be built from `SessionInput`, so a bridge call missing the field
    // would simply be a command the schema refuses one layer further out — a refusal nobody in this
    // suite would see. This is the assertion that makes the store carry it.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    await store.cancelQueuedMessage(id, 'msg_the_one_on_screen')

    expect(bridge.__calls).toContain(`cancelQueued:${id}:msg_the_one_on_screen`)
    // ⚑ **Non-vacuous**: the string really does carry both halves, so an id that never arrived would
    // read `…:undefined` and this would go red rather than matching on the session alone.
    expect(bridge.__calls).not.toContain(`cancelQueued:${id}:undefined`)
    store.dispose()
  })

  it('⛔ stopping one piece of background work leaves the conversation alone (248 §4)', async () => {
    // ⚠️ **`busy` is the assertion, not decoration.** `forSession` — which every other control verb
    // here goes through — raises `record.busy` for the length of the call, and that is right for
    // `interrupt`: the session IS busy, which is why you are interrupting it. This gesture leaves
    // the turn untouched, so a session that went `busy` would darken the plan's two buttons and the
    // sign-in Reopen, mid-press, on an idle conversation (737: not the composer, which `busy` never
    // reached). `094` is the dispatch about a state and its affordances disagreeing.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    const record = store.live.value.find((one) => one.sessionId === id)
    expect(record, 'the conversation this test is about').toBeDefined()

    const answer = store.stopBackgroundWork(id, 'b6uoyo82k')
    expect(record?.busy, 'the conversation is not made busy by stopping one task').toBe(false)
    await expect(answer).resolves.toBe(true)
    expect(bridge.__calls).toContain(`stopBackgroundWork:${id}:b6uoyo82k`)
    store.dispose()
  })

  it('⛔ …and a stop that FAILS says so beside the conversation (106, 118)', async () => {
    // A control that failed and said nothing is a control that cannot act pretending it can. The
    // rejection here is a real one from the real `runtimeCommandSchema` — `throughTheWire` refuses
    // an empty id — so what is under test is what the store does with a bridge that threw, not a
    // hand-built error object.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    const record = store.live.value.find((one) => one.sessionId === id)

    await expect(store.stopBackgroundWork(id, '')).resolves.toBe(false)
    expect(record?.error, 'the failure reached the session banner').toBeTruthy()
    // …and the paired positive: the conversation is still usable, which is the whole point of the
    // verb being separate from `interrupt`.
    expect(record?.busy).toBe(false)
    store.dispose()
  })

  it('🔴 a handed PATH goes down whichever branch the intent picks (216 §2)', async () => {
    // ⛔ A mutation survived the table until this existed: the store spread `attachments` onto one
    // branch and not the others, so attaching while the agent happened to be BUSY sent the words and
    // dropped the paths — the chip vanishing as if it had gone.
    const attachments = [{ path: '/work/alpha/notes.md', kind: 'file' as const, outsideCwd: false }]
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, { type: 'status', state: 'working' })

    await store.send(id, 'interrupting', 'interrupt', attachments)
    await store.send(id, 'queueing', 'queue', attachments)

    // Every branch that was taken carried them.
    expect(bridge.__inputs).toHaveLength(2)
    expect(bridge.__inputs.every((input) => input.attachments?.length === 1)).toBe(true)
    expect(bridge.__inputs.map((input) => input.text)).toEqual(['interrupting', 'queueing'])
    store.dispose()
  })

  it('🔴 WHAT THE STORE PUTS ON THE BRIDGE CLONES — the defect 216 shipped, found live by 218', async () => {
    // ⛔ **This is what was actually broken in the running app, on both surfaces, from `3151a36`.**
    // Pressing Send with anything attached put `An object could not be cloned.` on the screen and
    // ended the session with no turn at all — the attachment never reached the host, ever.
    //
    // ⚠️ **`createAttachmentBook` keeps the staged paths in a `reactive(new Map())`**, so what a
    // composer hands back to `send` is a Vue Proxy. The store spread the ARRAY and left every
    // element a proxy; `ipcRenderer.invoke` structured-clones its payload, and that algorithm
    // refuses a Proxy by name.
    //
    // ⚑ **The two tests above pass on the broken version**, and that is the point of this one: they
    // hand the store an object LITERAL, which clones perfectly. Only a value that came out of the
    // book the app actually uses reproduces it — and only the clone algorithm itself, run over what
    // reached the bridge, can tell the two apart.
    const book = createAttachmentBook()
    book.write(draftKey('a'), [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }])
    const staged = book.read(draftKey('a'))
    // The defect is present in the INPUT — if Vue ever stops proxying here this line fails and the
    // guard can be retired deliberately rather than sitting green over a problem that moved.
    expect(() => structuredClone(staged), 'a reactive read is no longer a Proxy').toThrow()

    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    await store.send(id, 'look at this', 'now', staged)

    const sent = bridge.__inputs.at(-1)?.attachments
    // 🔴 The claim: what crossed is cloneable, which is the only thing the real bridge asks of it.
    expect(() => structuredClone(sent)).not.toThrow()
    expect(sent).toEqual([{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }])
    store.dispose()
  })

  it('🔴 an ATTACHMENT-ONLY message is sent, not swallowed as "nothing to send"', async () => {
    // ⛔ Found in review, and it survived the mutation table until this existed: the empty-text
    // early-out guarded on the words alone, so "here, look at this" with a folder staged returned
    // `true` — reported as SENT — having sent nothing. `messageWithHandedPaths` composes exactly
    // this case (with no words it sends the block alone), so the store must let it through.
    const attachments = [{ path: '/work/alpha/src', kind: 'directory' as const, outsideCwd: false }]
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    expect(await store.send(id, '', 'now', attachments)).toBe(true)
    expect(bridge.__inputs).toHaveLength(1)
    expect(bridge.__inputs[0]?.attachments).toEqual(attachments)

    // ⚑ THE PAIRED NEGATIVE: nothing typed and nothing attached still short-circuits, because that
    // really is nothing to send — and returning `false` would make the caller hand an empty string
    // back to a composer the user had just cleared.
    expect(await store.send(id, '   ', 'now', [])).toBe(true)
    expect(bridge.__inputs).toHaveLength(1)
    store.dispose()
  })

  it('⛔ the double REFUSES a shape the wire refuses — the teeth on `throughTheWire` (221 §4)', async () => {
    // ⚠️ **Without this, every assertion in this file is over a fake that might be validating
    // nothing.** A wrapper that silently skipped every method would leave all 47 tests green and
    // the vacuity exactly where it was — which is the shape of the defect it was written for.
    const bridge = fakeBridge()

    // A message with no words and nothing attached: refused by the schema, as `077` always meant.
    await expect(bridge.send({ sessionId: 'sess_1', text: '' })).rejects.toThrow(
      /the wire would refuse this send/,
    )
    // …on all three send verbs, and on whitespace, which `min(1)` used to let through.
    await expect(bridge.queueMessage({ sessionId: 'sess_1', text: '  ' })).rejects.toThrow(
      /the wire would refuse this queueMessage/,
    )
    await expect(bridge.sendInterrupting({ sessionId: 'sess_1', text: '' })).rejects.toThrow(
      /the wire would refuse this sendInterrupting/,
    )
    // ⛔ …and a rule that has nothing to do with sending, so the wrapper is not a send special case:
    // an attachment path must be ABSOLUTE (216, found in review).
    await expect(
      bridge.send({
        sessionId: 'sess_1',
        text: 'look',
        attachments: [{ path: '.env', kind: 'file', outsideCwd: false }],
      }),
    ).rejects.toThrow(/absolute/)

    // ⚑ **THE PAIRED POSITIVE**: the shapes the app really sends still go straight through, so this
    // is a gate rather than a wall. Nothing above reached the recorder; both below did.
    expect(bridge.__inputs).toHaveLength(0)
    await bridge.send({ sessionId: 'sess_1', text: 'words' })
    await bridge.send({
      sessionId: 'sess_1',
      text: '',
      attachments: [{ path: '/work/alpha/src', kind: 'directory', outsideCwd: false }],
    })
    expect(bridge.__inputs).toHaveLength(2)
  })

  it('⚑ …and a send with NOTHING attached carries no such key, so the ordinary wire is unchanged', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    await store.send(id, 'just words')

    expect(bridge.__inputs).toEqual([{ sessionId: id, text: 'just words' }])
    store.dispose()
  })

  it('an unqualified send into a running turn QUEUES rather than interrupting (077)', async () => {
    // The race: the composer decided "idle" and the turn started before the command landed. It is
    // resolved to the non-destructive side on purpose — interrupting would throw away work nobody
    // asked to discard, on the strength of a status that changed mid-keypress.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, { type: 'status', state: 'working' })

    await store.send(id, 'typed while it looked idle')

    expect(bridge.__calls).toContain(`queueMessage:${id}`)
    // Paired positive/negative (086): the queue call above proves something happened, and these
    // prove it was not either of the two operations that would have been wrong.
    expect(bridge.__calls).not.toContain(`sendInterrupting:${id}`)
    expect(bridge.__calls).not.toContain(`send:${id}`)
    store.dispose()
  })

  it('says whether the message GOT THROUGH, so a refusal can hand the text back (077)', async () => {
    // ⚠️ The composer clears the box on emit. Without a truthful answer here, a refused send —
    // teardown, an ended conversation, or a message already waiting — takes the user's text with
    // it. That is the "silently dropped message" the dispatch calls the worst outcome, and 077 is
    // what made it reachable by adding two new refusals.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, { type: 'status', state: 'working' })

    expect(await store.send(id, 'this one lands', 'queue')).toBe(true)

    bridge.queueMessage = () => Promise.reject(new Error('a message is already waiting to be sent'))
    expect(await store.send(id, 'this one is refused', 'queue')).toBe(false)
    // The reason reaches the session, so the surface can say why as well as hand the text back.
    expect(store.get(id)?.error).toContain('already waiting')

    store.dispose()
  })

  it('reads the SESSION being working, not the page being read (064)', async () => {
    // ⚠️ 061 finding 5, on the send path: *"send can call the wrong bridge operation."* A reader
    // paged back into a quiet stretch of history left `record.transcript.status` at whatever that
    // stretch ended on, and the choice of bridge operation was read off it — so a message aimed at
    // a running turn went out as a plain send and the runtime refused it.
    //
    // 077 changed WHICH operation the busy case picks (queue, not interrupt) and changed nothing
    // about the rule this test exists for: the answer still comes from `control`, never from the
    // fold the reader happens to be looking at.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = 'sess_reading'
    bridge.__history.set(id, [
      { ordinal: WINDOW_MAX_EVENTS, at: 1_000, event: { type: 'status', state: 'working' } },
    ])
    const claim = bridge.claim
    bridge.claim = async (input) => {
      const answer = await claim(input)
      return { ...answer, history: { ...answer.history, hasOlder: true } }
    }
    await store.claim(id)
    bridge.__history.set(
      id,
      Array.from({ length: WINDOW_MAX_EVENTS }, (_, ordinal) => ({
        ordinal,
        at: 1_000,
        event: hello('earlier words'),
      })),
    )
    await store.loadOlder(id)
    const record = store.get(id)!
    expect(record.control).not.toBe(record.transcript)
    expect(record.control.status).toBe('working')
    expect(record.transcript.status).toBe('idle')

    await store.send(id, 'actually, do this instead')

    expect(bridge.__calls).toContain(`queueMessage:${id}`)
    // The whole point: had it read the READING fold it would have seen `idle` and sent plainly.
    expect(bridge.__calls).not.toContain(`send:${id}`)
    store.dispose()
  })

  it('takes a request off the table before it awaits anything (064)', async () => {
    // The in-flight guard used to be a `ref` inside the card, so a re-fold that remounted the card
    // handed back a fresh `false` and an already-submitted decision became clickable again (061
    // finding 8). Set on the record by the thing that actually sends, it cannot be lost that way.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    await store.respondPermission(id, 'req_1', { outcome: 'allow' })

    expect(store.get(id)?.requests.get('req_1')?.sent).toBe(true)
    store.dispose()
  })

  it('puts a refused request BACK on the table (064)', async () => {
    // Found by review. Making the in-flight guard durable made a FAILURE durable too: the host
    // refused the answer, so nothing echoes back on the stream, so the next re-fold rebuilds the
    // card without the note — and it would have come back with every button dead and no reason on
    // it. Before 064 a remount happened to clear the guard, which was the accident this replaces.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.respondPermission = () => Promise.reject(new Error('nope'))

    await store.respondPermission(id, 'req_1', { outcome: 'allow' })

    expect(store.get(id)?.requests.get('req_1')?.sent).toBe(false)
    store.dispose()
  })

  it('puts a failure on the session it belongs to, not on the app', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''
    bridge.interrupt = () =>
      Promise.reject(new Error("Error invoking remote method 'x': Error: nope"))

    await store.interrupt(first)

    expect(store.get(first)?.error).toBe('nope')
    expect(store.get(second)?.error).toBeNull()
    expect(store.launchError.value).toBeNull()
    store.dispose()
  })

  it('puts a refused answer on the card it was meant for, and leaves it live (473)', async () => {
    // The card disables its buttons on the first click so a second cannot race it. If the refusal
    // never reached the item, that card would sit there answerable-looking and dead, and the
    // composer — which freezes while any request is unanswered — would never thaw (Slice 2 · 005).
    //
    // 🔴 **473 · the MARK changed and the delivery did not.** This fixture is a REJECTION — the
    // pre-146 shape, where `ipcMain.handle` flattened every refusal to a `.message` — so the store
    // learns nothing about whether the request was consumed. ⛔ Since `469` measured what a wrong
    // guess costs, silence is read as *not settled*: the sentence lands on the card as `refused`,
    // above buttons that are still live, instead of as a `note` that retires it.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, {
      type: 'permission_request',
      id: 'req_1',
      kind: 'command',
      action: 'run a command',
      detail: 'ls',
      scope: {
        cwd: '/work',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny'],
        underDisclosed: false,
      },
    })
    bridge.respondPermission = () =>
      Promise.reject(
        new Error("Error invoking remote method 'x': Error: request req_1 is not pending"),
      )

    await store.respondPermission(id, 'req_1', { outcome: 'allow' })

    const card = store.get(id)?.transcript.items.find((item) => item.kind === 'permission')
    expect(card).toMatchObject({ outcome: null })
    expect(card && 'refused' in card && card.refused).toContain('request req_1 is not pending')
    // ⛔ The half that says which mark it got: a note is what retires a card, and this one is not
    // retired — the provider has not been told anything.
    expect(card && 'note' in card && card.note).toBeNull()
    store.dispose()
  })

  /**
   * **146 §1 · which mark a refusal gets, and why it is not one mark.**
   *
   * ⛔ The defect 145 HIGH 1 measured: every failed response went through `markRequestFailed`,
   * which writes `note`, and any note makes a card settled and non-awaiting. The adapters refuse an
   * unusable answer BEFORE it takes the broker slot — the request is still pending, and
   * `RuntimeHost` says so — so the card lost its buttons while the provider went on waiting.
   *
   * ⚑ **The bridge here is faithful rather than canned.** It runs the real `answerToForward` — the
   * same function both adapters call — over the question the card actually holds, and translates
   * its verdict exactly as `RuntimeHost.refusalOf` does. So the refusal below is DERIVED from a
   * whitespace-only option label, not asserted into existence.
   */
  describe('a refusal that did not consume the request (146 §1)', () => {
    /** The host's own sentences, verbatim — see `RuntimeHost.refusalOf`. */
    const NOT_USABLE = 'that answer cannot be sent: every question needs one that says something'
    const NOT_PENDING = 'the agent is no longer waiting for an answer to this'

    /**
     * ⚑ **The seam with `dom/user-input-refusal.dom.test.ts`.** That test presses the chip and the
     * Answer button on a real card and asserts the payload it emits is exactly `{q0: ['   ']}`;
     * this one takes that value on. Neither half is hand-waved and the value is literal in both.
     */
    const CLICKED = { q0: ['   '] }
    const QUESTIONS = [
      {
        id: 'q0',
        prompt: 'Which one?',
        options: [{ label: '   ' }, { label: 'the real one' }],
        multiSelect: true,
      },
    ]

    const openQuestion = async (): Promise<{
      bridge: ReturnType<typeof fakeBridge>
      store: ReturnType<typeof createSessionStore>
      id: string
    }> => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      const id = (await store.create({ provider: 'claude' })) ?? ''
      bridge.__emit(id, 0, {
        type: 'user_input_request',
        id: 'toolu_1',
        prompt: 'AskUserQuestion',
        questions: QUESTIONS,
      })
      return { bridge, store, id }
    }

    const cardOf = (
      store: ReturnType<typeof createSessionStore>,
      id: string,
    ): { note: string | null; refused: string | null } => {
      const item = store.get(id)?.transcript.items.find((i) => i.kind === 'userInput')
      expect(item, 'the question card is in the transcript').toBeDefined()
      return item?.kind === 'userInput' ? item : { note: null, refused: null }
    }

    it('says why ON the card and leaves every control alive', async () => {
      const { bridge, store, id } = await openQuestion()
      // The host's own composition: the shared rule decides, `refusalOf` translates.
      bridge.respondUserInput = async ({ response }) => {
        const forward = answerToForward(
          QUESTIONS,
          response.kind === 'answer' ? response.answers : {},
        )
        return forward.forwardable
          ? { outcome: 'taken' }
          : { outcome: 'refused', reason: NOT_USABLE, stillOpen: true }
      }

      await store.respondUserInput(id, 'toolu_1', { kind: 'answer', answers: CLICKED })

      expect(cardOf(store, id).refused).toBe(NOT_USABLE)
      // ⛔ **THE DEFECT.** A note here is what removed Answer and Reject and unfroze the composer.
      expect(cardOf(store, id).note).toBeNull()
      // Still counted as waiting, which is the value `ConversationPane` freezes the composer on.
      expect(sessionPanel(store.get(id)!.control).waiting).toBe(1)
      // …and answerable a second time: the in-flight guard came back off (064).
      expect(store.get(id)?.requests.get('toolu_1')?.sent).toBe(false)
      // No red banner three paragraphs away from the card (085): a refusal is not a session fault.
      expect(store.get(id)?.error).toBeNull()
      store.dispose()
    })

    it('…and a refusal that DID consume it still settles the card', async () => {
      // The paired positive. Without it this fix would read as "no refusal ever settles anything",
      // and a card offering buttons for a request nobody is waiting on is the same lie inverted.
      const { bridge, store, id } = await openQuestion()
      bridge.respondUserInput = async () => ({
        outcome: 'refused',
        reason: NOT_PENDING,
        stillOpen: false,
      })

      await store.respondUserInput(id, 'toolu_1', { kind: 'answer', answers: CLICKED })

      expect(cardOf(store, id).note).toBe(NOT_PENDING)
      expect(cardOf(store, id).refused).toBeNull()
      expect(sessionPanel(store.get(id)!.control).waiting).toBe(0)
      store.dispose()
    })

    it('…and a fault nobody classified leaves it LIVE (473 reverses 146 here)', async () => {
      // 🔴 **The ruling this test pinned is reversed, and `469` is why.** It used to read *"an
      // unclassified throw says nothing about whether the request was consumed, so leaving the card
      // live on a guess is worse than settling it with the reason on it"*, and it settled the card.
      //
      // ⛔ **`469` drove the ordinary takeover-then-permission path and measured the cost of that
      // guess**: the window drew *Not answered* with actions, pending, panel and live all zero
      // while the child's ledger held zero `user_decision` rows and the provider sat on
      // `waiting_permission`. ⚠️ **The two wrong guesses are not the same size.** A live card on a
      // request that has gone costs ONE press — the host answers `not-pending`, `AnswerAck`
      // classifies it, and the case below settles it in the host's own words. A settled card on a
      // request that is still waiting costs the conversation, and no gesture recovers it.
      const { bridge, store, id } = await openQuestion()
      bridge.respondUserInput = () => Promise.reject(new Error('the pipe closed'))

      await store.respondUserInput(id, 'toolu_1', { kind: 'answer', answers: CLICKED })

      expect(cardOf(store, id).refused).toContain('the pipe closed')
      // ⛔ …and it says the card is still waiting rather than reporting a past-tense failure.
      expect(cardOf(store, id).refused).toContain('still waiting')
      expect(cardOf(store, id).note).toBeNull()
      expect(sessionPanel(store.get(id)!.control).waiting).toBe(1)
      // ⚑ The in-flight guard came back off, so the person can press again — which is the whole of
      // what makes the live card recoverable rather than a dead one with a sentence on it (064).
      expect(store.get(id)?.requests.get('toolu_1')?.sent).toBe(false)
      // ⛔ **The half this test was missing** (150, 148 L5). It asserted the note ON THE CARD and
      // stopped, so a regression that cleared the session-level error — the red banner, which is
      // the only thing a user reading the top of the pane would see — stayed green. The behaviour
      // was already correct; the test simply did not describe it, which is the same false green
      // 146 LOW 3 kept finding.
      expect(store.get(id)?.error, 'the session says so too, not just the card').toContain(
        'the pipe closed',
      )
      store.dispose()
    })

    it('a taken answer writes nothing at all — the stream says what happened', async () => {
      // ⚠️ The non-vacuity of all three above: `noteAnswer` returning early on the ordinary path is
      // what keeps a successful answer from acquiring a sentence about a refusal that never was.
      const { store, id } = await openQuestion()

      await store.respondUserInput(id, 'toolu_1', {
        kind: 'answer',
        answers: { q0: ['the real one'] },
      })

      expect(cardOf(store, id).note).toBeNull()
      expect(cardOf(store, id).refused).toBeNull()
      expect(store.get(id)?.requests.get('toolu_1')?.sent).toBe(true)
      store.dispose()
    })
  })

  it('🔴 523 · D-017b · handing one back keeps its record, recorded and looked at again — and a refused one leaves it alone', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const sessionId = await store.claim('sess_1').then(() => 'sess_1')
    expect(store.isLive(sessionId), 'the claim adopted nothing to release').toBe(true)

    const released = await store.release(sessionId)
    // ⛔ **Never drawn as ended.** `421`'s whole subject is that a live conversation must not be,
    // and this one is still running with its provider child and its ledger — what changed is that
    // this window is no longer fed it. ⚑ **D-017b · so the record stays, `recorded`**, and the host
    // is asked to describe it as one this window does not hold: the view a person was reading stays
    // where it is (it was deleted before D-017b).
    expect(store.get(sessionId)?.phase).toBe('recorded')
    expect(store.isLive(sessionId)).toBe(false)
    expect(store.get(sessionId)?.control.ended).toBe(false)
    expect(released.running).toBe('unwatched')
    await vi.waitFor(() => {
      expect(bridge.__calls).toContain(`look:${sessionId}`)
      expect(store.get(sessionId)?.meta).toMatchObject({ handover: 'recorded' })
    })

    // ⚑ **And the pairing, which is the half that matters**: a refused hand-back leaves a
    // conversation this window really does still hold, so letting go of it first would take the
    // pane away from a person who still has it. Same direction as `close`'s *"marking it ended here
    // would hide a live conversation behind an error message."*
    await store.claim(sessionId)
    expect(store.isLive(sessionId), 'the second claim took nothing').toBe(true)
    bridge.release = () => Promise.reject(new Error('You started this conversation'))
    await expect(store.release(sessionId)).rejects.toThrow('You started this conversation')
    expect(store.isLive(sessionId), 'a refused hand-back took the conversation away').toBe(true)
  })

  describe('F062 · a window that takes a running conversation back reads what the host knew', () => {
    const bash = { said: 'an-activity', phase: 'tool', detail: 'Bash' } as const
    const quiet = { said: 'nothing', because: 'no-activity-right-now' } as const

    /** A claim answered the way the host answers one, with what it knew beside the page. */
    function claimedWith(
      bridge: ReturnType<typeof fakeBridge>,
      asHandedOver: ResumedSession['asHandedOver'],
    ) {
      const original = bridge.claim
      bridge.claim = async (input) => ({
        ...(await original(input)),
        ...(asHandedOver === undefined ? {} : { asHandedOver }),
      })
    }

    it('🔴 the status the host held, and the activity it was told, replace a page that begins too late to hold them', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      // The page: one turn's opening words and nothing after — no `status` row, no tool call.
      bridge.__history.set('sess_long', [{ ordinal: 0, at: 1_000, event: hello('a long turn') }])
      claimedWith(bridge, { status: 'working', told: bash })
      await store.claim('sess_long')
      const record = store.get('sess_long')!
      expect(record.control.status).toBe('working')
      expect(record.control.activity).toEqual({ phase: 'tool', detail: 'Bash' })
    })

    it('⛔ the page’s own activity stays where the host holds none, and the status is still the host’s', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      bridge.__history.set('sess_long', [
        { ordinal: 0, at: 1_000, event: hello('a long turn') },
        { ordinal: 1, at: 2_000, event: { type: 'activity', phase: 'thinking' } },
      ])
      claimedWith(bridge, { status: 'waiting_permission', told: quiet })
      await store.claim('sess_long')
      const record = store.get('sess_long')!
      expect(record.control.status).toBe('waiting_permission')
      expect(record.control.activity).toEqual({ phase: 'thinking' })
    })

    it('⚑ the host’s activity wins over a sub-agent’s call the page mistook for the conversation’s own', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      bridge.__history.set('sess_long', [
        { ordinal: 0, at: 1_000, event: hello('hand it over') },
        { ordinal: 1, at: 2_000, event: { type: 'activity', phase: 'tool', detail: 'Read' } },
      ])
      claimedWith(bridge, {
        status: 'working',
        told: { said: 'an-activity', phase: 'tool', detail: 'Task' },
      })
      await store.claim('sess_long')
      expect(store.get('sess_long')!.control.activity).toEqual({ phase: 'tool', detail: 'Task' })
    })

    it('🔴 …and the control: nothing handed over leaves the fold exactly as the page makes it', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      bridge.__history.set('sess_long', [{ ordinal: 0, at: 1_000, event: hello('a long turn') }])
      claimedWith(bridge, undefined)
      await store.claim('sess_long')
      const record = store.get('sess_long')!
      expect(record.control.status).toBe('idle')
      expect(record.control.activity).toBeNull()
    })

    it('⛔ the same hand-over is taken on a reload (attachOpen) and ignored on a resume, whose page ends where the new life begins', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      bridge.__history.set('sess_reload', [{ ordinal: 0, at: 1_000, event: hello('running') }])
      bridge.__held.add('sess_reload')
      const attach = bridge.attachOpen
      bridge.attachOpen = async () =>
        (await attach()).map((one) => ({ ...one, asHandedOver: { status: 'working', told: bash } }))
      await store.attachOpen()
      expect(store.get('sess_reload')!.control.status).toBe('working')

      bridge.__history.set('sess_resumed', [{ ordinal: 0, at: 1_000, event: hello('a recording') }])
      const resume = bridge.resume
      bridge.resume = async (input) => ({
        ...(await resume(input)),
        asHandedOver: { status: 'working', told: bash },
      })
      await store.resume('sess_resumed')
      expect(store.get('sess_resumed')!.control.status).not.toBe('working')
      expect(store.get('sess_resumed')!.control.activity).toBeNull()
    })
  })

  it('leaves no half-session behind when a reopen fails', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.resume = () => Promise.reject(new Error('no resumable session: sess_gone'))

    const opened = await store.resume('sess_gone')

    expect(opened).toBeNull()
    expect(store.get('sess_gone')).toBeNull()
    // A reopen failure sets `resumeError` while `launchError` remains empty. A shared ref
    // would show the same refusal in both the row and launcher banner; the negative assertion
    // prevents that duplicate display.
    expect(store.resumeError.value).toContain('no resumable session')
    expect(store.launchError.value).toBeNull()
    store.dispose()
  })

  /**
   * # A launch you can walk away from (102)
   *
   * 100 left one door open and named it: a slot wedged in `starting` had no in-app release, so the
   * only way out of a launcher that never settled was to quit the app. These are the store's half —
   * that a Cancel finds the launch it means, that the rejection it causes is not reported as a
   * failure, and that nothing half-open is left behind.
   */
  it('stops a new conversation that is still opening, and reports no failure for it', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()

    const launching = store.create({ provider: 'claude' })
    // Non-vacuity: the fake really is holding a launch open, so `create` below is genuinely
    // unsettled rather than having already failed for some other reason.
    expect(bridge.__stalledCount()).toBe(1)
    expect(store.isLaunching()).toBe(true)

    expect(await store.cancelLaunch()).toBe(true)
    expect(await launching).toBeNull()

    expect(store.isLaunching()).toBe(false)
    // ⚠️ **The point of the whole test.** The cancel reaches the provider by ABORTING it, so the
    // command always rejects — and a red sentence under a button that means "stop" would be the app
    // arguing with the user about something they asked for.
    expect(store.launchError.value).toBeNull()
    expect(store.resumeError.value).toBeNull()
    expect(store.live.value).toHaveLength(0)
    store.dispose()
  })

  it('…and an ordinary launch still opens, so the cancel is not just a broken start', async () => {
    // The pair 102 asks for by name: a test that only proved "cancel refuses" would pass just as
    // well against a store that had stopped being able to start anything at all.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)

    const sessionId = await store.create({ provider: 'claude' })

    expect(sessionId).not.toBeNull()
    expect(store.launchError.value).toBeNull()
    expect(store.live.value).toHaveLength(1)
    // …and a cancel with nothing in flight is a no-op rather than an error: the launch finishing
    // between the press and the call is a race no press can avoid.
    expect(await store.cancelLaunch()).toBe(false)
    expect(store.live.value).toHaveLength(1)
    store.dispose()
  })

  it('keeps a long Codex reopen visibly starting until the host answers', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const reopening = store.resume('sess_orchard')
    try {
      expect(bridge.__stalledCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(store.isLaunching('sess_orchard')).toBe(true)
      expect(store.resumeError.value).toBeNull()
      expect(await store.cancelLaunch('sess_orchard')).toBe(true)
      expect(await reopening).toBeNull()
      expect(store.isLaunching('sess_orchard')).toBe(false)
    } finally {
      vi.useRealTimers()
      await store.cancelLaunch('sess_orchard')
      await reopening
      store.dispose()
    }
  })

  it('stops a REOPEN that is still opening, and leaves no half-attached session (102)', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()

    const reopening = store.resume('sess_wedged')
    // An event for the conversation lands mid-launch — the shape 100's review found, where a
    // buffered event creates a record before the host has said anything about it. Cancelling must
    // take that record with it, or the rail is left offering a session nothing is behind.
    bridge.__emit('sess_wedged', 0, hello('are you there'))
    expect(store.get('sess_wedged')).not.toBeNull()

    expect(await store.cancelLaunch('sess_wedged')).toBe(true)
    expect(await reopening).toBeNull()

    expect(store.get('sess_wedged')).toBeNull()
    expect(store.live.value).toHaveLength(0)
    expect(store.resumeError.value).toBeNull()
    store.dispose()
  })

  it('does not report a launch as failed when the cancel found nothing to stop', async () => {
    // ⚠️ **Review finding.** The store marks a key cancelled BEFORE asking, so the rejection the
    // abort causes is not shown as a failure. When the host answers "there was nothing to cancel",
    // that mark has to come off again — otherwise the press swallows the launch's own, real reason
    // for ending, and the launcher just stops spinning with nothing said.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()

    const launching = store.create({ provider: 'claude' })
    const key = 'launch-1' // the first name this store hands out
    // The launch ends on its own — the host's 15s deadline, a bad cwd, anything — a moment before
    // the press lands. The fake answers the cancel with `false`, exactly as the host does.
    const stalled = bridge.__reject(key, new Error("This conversation's agent did not answer."))
    expect(stalled, 'positive: the launch this test is about really was in flight').toBe(true)

    expect(await store.cancelLaunch()).toBe(false)
    expect(await launching).toBeNull()

    expect(store.launchError.value).toContain('did not answer')
    store.dispose()
  })

  it('cancels the launch it was pointed at, and not the other one in flight', async () => {
    // Two launches at once is ordinary: the rail is on screen while the launcher is, and a reopen
    // does not disable the other rows. A cancel keyed by "whatever this window is doing" would
    // stop both, which is why the key is per gesture.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()

    const creating = store.create({ provider: 'claude' })
    const reopening = store.resume('sess_other')
    expect(bridge.__stalledCount()).toBe(2)

    expect(await store.cancelLaunch('sess_other')).toBe(true)
    expect(await reopening).toBeNull()

    // The create is untouched: still in flight, still holding its own name.
    expect(bridge.__stalledCount()).toBe(1)
    expect(store.isLaunching()).toBe(true)
    // ⚠️ **And the answer is per GESTURE** (review). One shared flag would say "yes" here for the
    // reopen that has just been cancelled — which is how the launcher came to render a Cancel that
    // looked up a launch it did not have and did nothing at all.
    expect(store.isLaunching('sess_other')).toBe(false)
    expect(await store.cancelLaunch()).toBe(true)
    expect(await creating).toBeNull()
    store.dispose()
  })

  it.each(['live', 'silent', 'ended', 'errored'] as const)(
    'a later early %s packet without detail clears the earlier detail at adoption',
    async (state) => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      const agent = [{ label: 'model', value: 'a reported model' }]
      bridge.__liveness('sess_1', 'silent', {
        since: 10,
        detail: 'the earlier silence',
        thinking: true,
        agent,
      })
      bridge.__liveness('sess_1', state, { since: 20 })
      const latest = { state, since: 20, agent }
      expect(store.get('sess_1')?.meta).toBeNull()
      expect(store.get('sess_1')?.earlyLiveness).toEqual(latest)
      await store.create({ provider: 'claude' })
      expect(store.get('sess_1')?.meta?.liveness).toEqual(latest)
      expect(store.get('sess_1')?.earlyLiveness).toBeNull()
      store.dispose()
    },
  )

  it('a later early packet keeps its own detail and the earlier agent disclosure', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const agent = [{ label: 'model', value: 'a reported model' }]
    bridge.__liveness('sess_1', 'silent', { detail: 'old detail', agent })
    bridge.__liveness('sess_1', 'errored', { since: 20, detail: 'the current failure' })
    await store.create({ provider: 'claude' })
    expect(store.get('sess_1')?.meta?.liveness).toEqual({
      state: 'errored',
      since: 20,
      detail: 'the current failure',
      agent,
    })
    store.dispose()
  })

  it('routes liveness to the right conversation once both are open', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''

    bridge.__liveness(second, 'errored')

    expect(store.get(first)?.meta?.liveness.state).toBe('live')
    expect(store.get(second)?.meta?.liveness.state).toBe('errored')
    store.dispose()
  })

  it('lets go of the bridge when the window does', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    await store.create({ provider: 'claude' })

    store.dispose()

    expect(bridge.__listening()).toBe(false)
  })

  it('shows what the HOST says after a mode switch, not what was asked for (034)', async () => {
    // The gap between the two is the whole point: neither provider can change the mode of a turn
    // already running, so between the click and the next message the session is genuinely still
    // prompting. A store that wrote the requested mode straight into the record would put the one
    // dangerous claim on screen for exactly as long as a turn lasts.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = await store.create({ provider: 'codex' })

    await store.setApprovalMode(id!, 'auto')

    expect(bridge.__calls).toContain(`setApprovalMode:${id}:auto`)
    expect(store.get(id!)?.meta?.approvalMode).toBe('ask')
    expect(store.get(id!)?.meta?.pendingApprovalMode).toBe('auto')
    expect(store.get(id!)?.meta?.approvalNote).toMatch(/from your next message/)
    store.dispose()
  })

  it('a refused mode change clears saving, preserves the mode and exposes the error', async () => {
    const bridge = fakeBridge()
    let refuse: (error: Error) => void = () => {}
    bridge.setApprovalMode = () =>
      new Promise((_resolve, reject) => {
        refuse = reject
      })
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'codex' }))!
    const saving = store.setApprovalMode(id, 'auto')
    expect(store.get(id)?.busy).toBe(true)
    expect(store.get(id)?.meta?.approvalMode).toBe('ask')
    refuse(new Error('Mode could not be saved'))
    await saving
    expect(store.get(id)?.busy).toBe(false)
    expect(store.get(id)?.meta?.approvalMode).toBe('ask')
    expect(store.get(id)?.error).toContain('Mode could not be saved')
    store.dispose()
  })

  it.each(['ask', 'auto'] as const)(
    'keeps native %s updates while a choice is awaiting its answer',
    async (nativeMode) => {
      const bridge = fakeBridge()
      let refuse: (error: Error) => void = () => {}
      bridge.setApprovalMode = () =>
        new Promise((_resolve, reject) => {
          refuse = reject
        })
      const store = createSessionStore(bridge)
      const id = (await store.create({ provider: 'codex' }))!
      const saving = store.setApprovalMode(id, 'auto')
      expect(store.get(id)?.meta?.pendingApprovalMode).toBe('auto')
      bridge.__liveness(id, 'live', {
        approval: {
          approvalMode: nativeMode,
          pendingApprovalMode: null,
          approvalNote: nativeMode,
          blanketGrants: [],
        },
      })
      expect(store.get(id)?.meta?.approvalMode).toBe(nativeMode)
      expect(store.get(id)?.meta?.pendingApprovalMode).toBe(nativeMode === 'auto' ? null : 'auto')
      const record = store.get(id)!
      bridge.refreshConfig = async () => ({ ...record.meta!.config, model: 'fictional-new-model' })
      await store.refreshConfig(id)
      expect(record.meta?.config.model).toBe('fictional-new-model')
      refuse(new Error('Mode could not be saved'))
      await saving
      expect(record.meta?.approvalMode).toBe(nativeMode)
      expect(record.meta?.pendingApprovalMode).toBeNull()
      expect(record.meta?.config.model).toBe('fictional-new-model')
      store.dispose()
    },
  )

  it('recomputes the open list as sessions come and go', async () => {
    // The list is a computed over a reactive Map; if Map mutations were not tracked, the sidebar
    // would simply never update — a failure that looks like nothing happening at all.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const seen = computed(() => store.live.value.length)

    expect(seen.value).toBe(0)
    const first = (await store.create({ provider: 'claude' }))!
    const record = store.get(first)!
    const error = store.launchError
    expect(seen.value).toBe(1)
    expect(store.live.value[0]).toBe(record)
    bridge.__emit(first, 0, { type: 'status', state: 'working' })
    expect(store.get(first)).toBe(record)
    expect(store.live.value[0]).toBe(record)
    expect(record.control.status).toBe('working')
    store.noteLaunchFailure('The approval choice could not be saved.')
    expect(store.launchError).toBe(error)
    expect(error.value).toBe('The approval choice could not be saved.')
    await store.create({ provider: 'codex' })
    expect(seen.value).toBe(2)
    expect(store.get(first)).toBe(record)
    expect(store.launchError).toBe(error)
    expect(error.value).toBeNull()
    store.dispose()
  })
})
