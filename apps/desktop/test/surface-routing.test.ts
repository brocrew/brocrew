import { computed, nextTick, ref, type ComputedRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { LAUNCHER, useSurface } from '../src/renderer/src/composables/useSurface'

/**
 * 095 · the launcher is a place, and a late answer may not take it (094 §4, P5).
 *
 * The measured symptom: *"a user who reopens a conversation and then starts a new one gets thrown
 * back into the old one mid-sentence. What was typed is not lost — it stays in the `new` draft slot
 * — but the surface is taken away with no indication."* The smoke saw it as `the app replaced the
 * launcher with conversation sess_80cd9bdc… while its settings were being filled in`.
 *
 * ⚠️ **These are the assertions the live step could not be**, and that matters here specifically:
 * step 52 is red *because of* this bug, so it is the acceptance test for the fix and not a
 * regression test for it — a run of the smoke is a run of two providers and twenty minutes. What
 * follows is the same claim in milliseconds, with the race made deterministic by holding the
 * resume's promise open by hand.
 */

/** A record the way the store makes one: `meta` is what tells the pane there is anything to draw. */
function record(sessionId: string): SessionRecord {
  const made = createSessionRecord(sessionId)
  made.meta = { provider: 'codex', cwd: '/tmp', model: null } as unknown as SessionRecord['meta']
  made.phase = 'open'
  return made
}

/**
 * The two things `useSurface` reads from the store, and nothing else.
 *
 * `get` deliberately answers for a session that is no longer LIVE, because the real one does — the
 * store keeps the record and drops it from `live`. That asymmetry is load-bearing twice over: it is
 * why closing the conversation you are reading does not blank the pane, and it is why the watch's
 * early return holds while a closed conversation is still on screen.
 */
function fakeStore(): {
  live: ComputedRef<SessionRecord[]>
  get: (id: string) => SessionRecord | null
  arrive: (sessionId: string) => SessionRecord
  leave: (sessionId: string) => void
  forget: (sessionId: string) => void
} {
  const rows = ref<SessionRecord[]>([])
  const remembered = new Map<string, SessionRecord>()
  return {
    live: computed(() => rows.value),
    get: (id) => remembered.get(id) ?? null,
    arrive(sessionId) {
      const made = record(sessionId)
      remembered.set(sessionId, made)
      rows.value = [...rows.value, made]
      return made
    },
    leave(sessionId) {
      rows.value = rows.value.filter((row) => row.sessionId !== sessionId)
    },
    forget(sessionId) {
      remembered.delete(sessionId)
      rows.value = rows.value.filter((row) => row.sessionId !== sessionId)
    },
  }
}

describe('the launcher is a destination, not a gap', () => {
  it('an app with nothing open is AT the launcher, and says so', async () => {
    const store = fakeStore()
    const { place, surface, activeId } = useSurface(store)
    await nextTick()
    expect(surface.value).toBe('launcher')
    // ⚠️ The half that fixes P5: the launcher has a NAME now. Before this, `place` stayed null and
    // "am I on the launcher" was a question about the order of six `v-else-if`s in a template.
    expect(place.value).toBe(LAUNCHER)
    expect(activeId.value).toBeNull()
  })

  it('a conversation arriving does not take it away', async () => {
    // ⚠️ **THE regression test.** The pre-095 watch set `activeId` on every change to `store.open`
    // while nothing was selected, and `place: null` drew the launcher — so the conversation it
    // elected replaced the surface under whoever was typing into it.
    const store = fakeStore()
    const { place, surface, activeId } = useSurface(store)
    await nextTick()
    expect(surface.value, 'the launcher, before anything arrives').toBe('launcher')

    store.arrive('sess_arrived')
    await nextTick()

    expect(surface.value, 'the launcher survives a conversation arriving').toBe('launcher')
    expect(place.value).toBe(LAUNCHER)
    // The watch does not elect here at all — the reader is somewhere they asked for, so there is no
    // gap to fill. The test below is the positive that proves the watch still works.
    expect(activeId.value).toBeNull()
  })

  it('…and the same arrival IS followed when the surface is the selection itself', async () => {
    // ⚠️ **The positive for the test above, and it is not decoration** (review). A "fix" that simply
    // stopped the watch electing would pass every assertion up there and silently break the thing
    // the watch exists for. Identical arrival, one difference: `place` is null, so the surface is
    // "the conversation you picked" and there is a gap to fill.
    const store = fakeStore()
    store.arrive('sess_first')
    const { place, surface, activeId } = useSurface(store)
    await nextTick()
    expect(activeId.value).toBe('sess_first')

    store.forget('sess_first')
    await nextTick()
    expect(place.value, 'nothing left to elect, so the launcher is named').toBe(LAUNCHER)

    place.value = null
    store.arrive('sess_second')
    await nextTick()
    expect(activeId.value, 'positive: the election still happens where it should').toBe(
      'sess_second',
    )
    expect(surface.value).toBe('conversation')
  })

  it('…and a conversation LEAVING does not take it away either', async () => {
    const store = fakeStore()
    store.arrive('sess_a')
    store.arrive('sess_b')
    const { place, surface } = useSurface(store)
    await nextTick()
    // Elected the newest and drew it: the ordinary case, and the baseline for what follows.
    expect(surface.value).toBe('conversation')

    place.value = LAUNCHER
    await nextTick()
    expect(surface.value).toBe('launcher')

    store.leave('sess_b')
    await nextTick()
    expect(surface.value, 'the other conversation ending is not a reason to move').toBe('launcher')
  })

  it('but closing the LAST conversation still lands somewhere sensible', async () => {
    // The reason the watch exists, and the dispatch's own "what must not regress". A record that is
    // gone entirely — a resume that failed, and the store deletes the half-session — leaves nothing
    // to elect, and the app has to be somewhere.
    const store = fakeStore()
    store.arrive('sess_only')
    const { surface, activeId } = useSurface(store)
    await nextTick()
    expect(surface.value).toBe('conversation')

    store.forget('sess_only')
    await nextTick()
    expect(activeId.value).toBeNull()
    expect(surface.value).toBe('launcher')
  })

  it('and a reader on Waiting on you is not moved to the launcher by an empty rail', async () => {
    // Naming the launcher may only happen where the launcher is what would have been drawn. A
    // version that assigned unconditionally would yank a reader off the page they chose the moment
    // the last conversation ended. ⚑ D-016 · it was Home until Home was deleted; Waiting on you is
    // the rail's first destination now.
    const store = fakeStore()
    store.arrive('sess_only')
    const { place, surface } = useSurface(store)
    await nextTick()

    place.value = 'waiting'
    store.forget('sess_only')
    await nextTick()
    expect(surface.value).toBe('waiting')
    expect(place.value).toBe('waiting')
  })
})

describe('a late answer may not take the surface', () => {
  it('a resume that lands after the user opened the launcher changes nothing', async () => {
    // The measured trace, made deterministic: `reopen` takes a `view()` before it awaits and hands
    // it to `showConversation` after — so the launcher the user opened DURING the resume survives.
    const store = fakeStore()
    store.arrive('sess_first')
    const { place, surface, activeId, view, showConversation } = useSurface(store)
    await nextTick()
    expect(surface.value).toBe('conversation')

    // `reopen` starts here, from the conversation surface…
    const asked = view()
    // …the user presses "New conversation" while the provider is starting…
    place.value = LAUNCHER
    await nextTick()
    expect(surface.value).toBe('launcher')
    // …and the resume finally lands.
    const reopened = store.arrive('sess_reopened')
    showConversation(reopened.sessionId, asked)
    await nextTick()

    expect(surface.value, 'the launcher was asked for and is kept').toBe('launcher')
    // ⚠️ **And the selection is untouched too** (review). The first version of this SELECTED the
    // reopened conversation while refusing to draw it — which reads as generous and is the same
    // defect one field over: a late answer writing over what the reader chose. It is in the rail,
    // which is where an answer nobody is waiting for belongs.
    expect(activeId.value).toBe('sess_first')
    place.value = null
    await nextTick()
    expect(surface.value).toBe('conversation')
  })

  it('…and the same resume, with nobody moving, does take the surface', async () => {
    // NON-VACUITY for the test above: the guard must be about the reader HAVING MOVED, not about
    // resumes being unable to draw anything. Same call, same shape, nothing pressed in between.
    const store = fakeStore()
    store.arrive('sess_first')
    const { place, surface, activeId, view, showConversation } = useSurface(store)
    await nextTick()

    const asked = view()
    const reopened = store.arrive('sess_reopened')
    showConversation(reopened.sessionId, asked)
    await nextTick()
    expect(surface.value).toBe('conversation')
    expect(activeId.value).toBe('sess_reopened')
    expect(place.value).toBeNull()
  })

  it('and a conversation picked while the resume was in flight is not overwritten', async () => {
    // ⚠️ **The case a `place`-only guard misses, and review found it** (CONFIRMED, twice). The
    // reader never leaves the conversation surface, so `place` is null at both ends and matches —
    // and the resume they asked for two clicks ago replaces the conversation they just clicked.
    const store = fakeStore()
    store.arrive('sess_a')
    const { activeId, view, showConversation } = useSurface(store)
    await nextTick()

    const asked = view() // `reopen('sess_old')` goes out here
    store.arrive('sess_b')
    showConversation('sess_b', view()) // …the reader clicks sess_b in the rail…
    await nextTick()
    expect(activeId.value).toBe('sess_b')

    const old = store.arrive('sess_old') // …and the resume lands.
    showConversation(old.sessionId, asked)
    await nextTick()
    expect(activeId.value, 'the click wins over the answer that predates it').toBe('sess_b')
  })
})

/**
 * 212 §3 · **Picking a conversation that is already open crosses no await** (from 210 finding 3).
 *
 * 210 measured 6.9 s to switch a conversation with the drawer open and 7.9 s between two holding
 * unsent drafts, and named two suspects: the history-window re-read (149/172) and draft persistence.
 * ⛔ **Neither is on this path.** Measured in the running app over 40 switches — 20 plain, 20 with a
 * long unsent draft in both composers — the click handler cost **0.1 ms** and the rail row's
 * `data-active` reached the DOM in **2.3-6.3 ms**, worst case, every time. The whole 5-8 s belonged
 * to a driver waiting on timers in a window the OS had marked hidden.
 *
 * ⚑ **So the thing worth holding is the shape, not the clock**: `select` is
 * `showConversation(sessionId, view())`, and `view()` is read INLINE. There is no await between the
 * click and the selection, so no round trip can ever get between them. ⚠️ That is not decoration —
 * the sibling `reopen` path a few lines up in `RuntimeScreen` DOES await, and the tests above exist
 * because a surface change on the far side of an await is a different animal. This one pins that
 * picking an already-open conversation stays on the near side of that line.
 */
describe('212 §3 · the selected conversation changes before anything can yield', () => {
  it('⛔ showConversation moves the selection SYNCHRONOUSLY — no tick, no await', async () => {
    const store = fakeStore()
    store.arrive('sess_a')
    const surface = useSurface(store)
    await nextTick()
    store.arrive('sess_b')
    await nextTick()

    // The reader is on sess_a — elected, because `place` is null and the surface IS the selection.
    expect(surface.activeId.value, 'the reader starts on the first conversation').toBe('sess_a')
    expect(surface.surface.value).toBe('conversation')

    // ⛔ **Read with NO await in between.** That is the entire assertion: if `showConversation` ever
    // grew a round trip — persisting the choice, asking the host which window to open — this line
    // would still be reading `sess_a`, and the rail row would stay unmarked until it came back.
    surface.showConversation('sess_b', surface.view())
    expect(surface.activeId.value, 'the selection did not move in the same turn as the click').toBe(
      'sess_b',
    )
    expect(surface.place.value, 'and the surface is the conversation, immediately').toBeNull()
    expect(surface.surface.value).toBe('conversation')
  })
})
