import { computed, onUnmounted, ref, shallowReactive, watch } from 'vue'
import type { CommandTail, ProviderCapabilityMap, ToolAnswer } from '../../../shared/runtime-ipc'
import type { SessionRecord } from '../lib/session-record'

/** What `ConversationPane` reads to decide what its tool rows may do. */
export interface ToolRowProps {
  readonly record: SessionRecord
  readonly capabilities: ProviderCapabilityMap | null
  readonly onStopBackgroundWork?: (id: string) => Promise<boolean>
  readonly onReadCommandOutput?: (toolCallId: string) => Promise<CommandTail | null>
  readonly onReadToolAnswer?: (toolCallId: string) => Promise<ToolAnswer | null>
}

/**
 * What a tool row in `ConversationPane` may do — stop its background work, follow what its command
 * prints, read its whole answer — and the one follow timer and stop latch behind those (S01, moved
 * out of `ConversationPane.vue` unchanged).
 */
export function useToolRowControls(props: ToolRowProps) {
  /**
   * ⛔ **Whether this conversation's adapter can stop one piece of background work** (248).
   *
   * `=== true` on an OPTIONAL disclosure, the way `signInSuperseded` is read one line up: absent means
   * *"this adapter cannot say"* and covers two real states that mean the same thing to a button — a
   * recording, which has no handle at all, and a liveness message published before the session was
   * described. `106`: a control that cannot act is not offered.
   *
   * 🔴 **`closing` is a third state where it cannot act, and it was missing** (287 §2, finding 5).
   * `SessionStore.close` sets `record.phase = 'closing'` before it awaits the host — 089 put it there
   * on purpose — and this read straight past it, so Stop stayed live through the whole teardown. This
   * is an ordinary conversation close, so the app-wide quit door does not cover it; both adapters
   * silently no-op once they are shutting down. ⚠️ **The adapters answer `false` for that now too, and
   * this is still not redundant with it**: a control that cannot act must not be OFFERED, which is a
   * different requirement from a request that must not lie about having gone out. `interruptible` one
   * screen down reads the same phase for the same reason.
   *
   * ⚠️ **`ended` is deliberately NOT named here**, and it is not an omission: the three session
   * boundaries run `stopDetachedWork`, which empties the registry — so `BackgroundBar`'s own `v-if` is
   * already false and there is no row to carry a button. `closing` is the one phase where the rows are
   * still on screen and the adapter has already stopped listening.
   */
  const canStopBackgroundWork = computed(
    () =>
      props.record.meta?.liveness.canStopBackgroundWork === true &&
      props.onStopBackgroundWork !== undefined &&
      props.record.phase !== 'closing',
  )

  /**
   * ⛔ **May a card ASK what its command has printed** (300) — `SessionLiveness.canReadCommandOutput`,
   * plus a prop to ask through.
   *
   * ⚠️ **`closing` is deliberately NOT here, and the asymmetry with {@link canStopBackgroundWork} one
   * screen up is the point.** That gate is about a control that ACTS: a Stop offered through a
   * teardown is `106`'s control that cannot act. This is a READ of a buffer, and a conversation being
   * closed is exactly when the last thing a command printed is worth seeing. The read answers `null`
   * once the handle is gone, which the card says in words.
   */
  const canWatchCommands = computed(
    () =>
      props.record.meta?.liveness.canReadCommandOutput === true &&
      props.onReadCommandOutput !== undefined,
  )

  /**
   * ⛔ **May a row offer to show the whole of what its tool answered** (462) —
   * `SessionLiveness.canReadToolAnswer`, plus a prop to ask through.
   *
   * ⚠️ **`closing` is deliberately NOT here either**, on {@link canWatchCommands}' own ruling one
   * block up: this is a READ, and a conversation being closed is exactly when what its last tool said
   * is worth having. ⛔ And unlike that gate there is no capability beside this one, because both
   * adapters hold answers — what differs is which receipts carry what, which the panel reports from
   * what actually arrived.
   */
  const canReadToolAnswers = computed(
    () =>
      props.record.meta?.liveness.canReadToolAnswer === true &&
      props.onReadToolAnswer !== undefined,
  )

  /**
   * ⛔ **This provider's standing on watching a command** (300, 039's rule) — the sentence a card shows
   * where there will never be a tail.
   *
   * ⚠️ **Looked up by the session's provider rather than branched on it.** `provider-neutrality.test.ts`
   * is the gate; the whole of `capabilities.ts` exists so a surface asks what a session SUPPORTS. Null
   * before the session has been described, which reads as "nothing to say" and gets the short sentence.
   */
  const outputCapability = computed(() => {
    const provider = props.record.meta?.provider
    if (provider === undefined) return null
    // ⚠️ **`?.` and not a `=== null` guard, and the difference is a crash the type did not predict.**
    // The prop is declared `ProviderCapabilityMap | null`, so `null` looks like the whole absence —
    // but a mount that OMITS a required prop passes `undefined`, and five render tests do exactly
    // that. Found by those tests; the reading rule is `074`'s either way: nothing declared is nothing
    // to say, whichever shape the nothing arrives in.
    return props.capabilities?.[provider]?.commandOutput ?? null
  })

  /** The same, for a command that went to the background — its own entry since provider follow-ups 1. */
  const backgroundOutputCapability = computed(() => {
    const provider = props.record.meta?.provider
    if (provider === undefined) return null
    return props.capabilities?.[provider]?.backgroundCommandOutput ?? null
  })

  /**
   * 🔴 **The commands being FOLLOWED, and what each has printed** (300).
   *
   * ## ⛔ Why the timer is here and not in the card
   *
   * `255` virtualizes the transcript, so a row that owns a poller owns it for as long as the scroller
   * keeps that row mounted — which is a lifetime nobody chose. One timer on the pane reads every
   * followed call, and a card that scrolls away withdraws before it unmounts (`ToolEntry`'s
   * `onBeforeUnmount`, which is `onUnmounted` for a measured reason).
   *
   * ⚠️ **`shallowReactive` over a `Map`, and the tails are replaced rather than mutated.** A deep
   * `reactive` would proxy every value; the card compares nothing and only reads, so identity is all
   * that has to change for it to re-render — the same trade `drafts.ts` records for its own map.
   */
  const followed = shallowReactive(new Map<string, CommandTail | null>())
  /** ⚠️ Not a `computed` over `followed`: a call can be followed before its first read answers. */
  const following = new Set<string>()
  let followTimer: ReturnType<typeof setInterval> | null = null

  /**
   * ⛔ **How often a followed command is re-read.**
   *
   * ⚠️ **One second, and it is chosen against the thing being watched rather than against a frame
   * budget.** Codex delivers a command's output as the process produces it — measured at one line a
   * second for a ticker — and a person reading a scrolling log cannot tell 1 Hz from smoother. It is
   * also `275`'s own poll interval halved, over a read that costs a map lookup rather than a request
   * to a child process, so it is the cheaper of the two by a wide margin.
   */
  const FOLLOW_MS = 1_000

  /**
   * ⛔ **One drain at a time** — found by the adversarial pass over this diff.
   *
   * The timer fires every second and the drain is asynchronous; nothing bounded how long a read takes,
   * so a slow bridge would have had two drains overlapping and a third behind them. The `following`
   * re-check below keeps the ANSWERS correct either way, but a queue of drains is not a follow, it is
   * a backlog — the same single-flight `BackgroundTerminals.refresh` states for the same reason.
   */
  let draining: Promise<void> | null = null
  /** An ask that arrived mid-drain — collapsed into ONE follow-up, never a queue. */
  let drainAgain = false

  async function readFollowed(): Promise<void> {
    const read = props.onReadCommandOutput
    if (read === undefined) return
    // ⛔ **A card that opens mid-drain still gets its immediate answer**, and it gets exactly one.
    // Returning early here would leave the newly-opened card saying *"nothing kept"* for a whole
    // second about a command that has been printing for a minute — the thing `onWatchCommand`'s own
    // note calls reading as broken. `BackgroundTerminals.refresh` collapses the same way.
    if (draining !== null) {
      drainAgain = true
      return
    }
    draining = (async () => {
      // ⚠️ **The id list is snapshotted before the awaits**, so a card that withdraws mid-drain does
      // not mutate the set being iterated — and the write below re-checks membership, because a
      // withdrawal that lands while its own read is in flight must not put the answer back.
      for (const callId of [...following]) {
        const tail = await read(callId)
        if (following.has(callId)) followed.set(callId, tail)
      }
    })()
    try {
      await draining
    } finally {
      draining = null
    }
    if (drainAgain) {
      drainAgain = false
      await readFollowed()
    }
  }

  function tick(): void {
    if (following.size === 0) {
      stopFollowing()
      return
    }
    void readFollowed()
  }

  function stopFollowing(): void {
    if (followTimer === null) return
    clearInterval(followTimer)
    followTimer = null
  }

  /**
   * A card asking to be followed, or letting go (300).
   *
   * ⛔ **The first read is immediate and the timer is second**, because a card that opened would
   * otherwise show *"not holding anything"* for a whole second about a command that has been printing
   * for a minute — a true sentence at the wrong moment, which reads as a broken feature.
   */
  function onWatchCommand(callId: string, on: boolean): void {
    if (!on) {
      following.delete(callId)
      followed.delete(callId)
      if (following.size === 0) stopFollowing()
      return
    }
    if (!canWatchCommands.value) return
    following.add(callId)
    void readFollowed()
    if (followTimer === null) followTimer = setInterval(tick, FOLLOW_MS)
  }

  const tailFor = (callId: string): CommandTail | null => followed.get(callId) ?? null

  /**
   * ⛔ **The CALLS whose stop is in flight** — the card's own latch, and `BackgroundBar`'s to the
   * letter (see its `asked`, and 287 finding 4 for what it cost to get wrong).
   *
   * 🔴 **Keyed by the CALL and not by the provider's key, and the first draft got that wrong.** The
   * key is what a stop is SENT with; it is also a counter Codex recycles. A latch on it could not tell
   * the command we asked about from the next one born wearing its number — and the test written for
   * the retirement below is what found it, by putting a second command on screen with the same
   * `processId` and watching it arrive disabled. A call id is unique by construction.
   */
  const stoppingCalls = ref(new Set<string>())
  const stoppingCall = (callId: string): boolean => stoppingCalls.value.has(callId)

  /**
   * ⛔ **There is no retirement sweep here, and the ABSENCE is the finding** (300, adversarial pass).
   *
   * The first draft keyed this latch on the provider's key and added a watcher that swept it against
   * the still-live rows — `BackgroundBar`'s `retire`, ported. ⚑ **Keying by CALL id removed the need
   * for it**: a call id is unique by construction, so the hazard that sweep existed for — a recycled
   * `processId` arriving on a new command and finding itself already latched — cannot be reached at
   * all. The test written to prove the sweep worked passed with the sweep DELETED, which is `260`'s
   * rule from the inside: a mechanism whose test cannot fail is proving nothing.
   *
   * ⚠️ **What is left held is one string per press, for the life of the conversation, reaching no
   * button** — the row stops being live, so `ToolEntry` stops offering one. The conversation switch
   * below empties it. `246` §2: do not keep a mechanism nothing can produce a need for.
   */

  async function onStopCommand(callId: string, key: string): Promise<void> {
    const stop = props.onStopBackgroundWork
    if (stop === undefined || stoppingCalls.value.has(callId)) return
    stoppingCalls.value = new Set(stoppingCalls.value).add(callId)
    // ⚠️ No `catch` that swallows, for `BackgroundBar`'s stated reason: the store already turns a
    // refusal into `false` AND the sentence beside the conversation, so a rejection reaching here
    // would be a contract break rather than an outcome.
    if (!(await stop(key))) {
      const next = new Set(stoppingCalls.value)
      next.delete(callId)
      stoppingCalls.value = next
    }
  }

  watch(
    () => props.record.sessionId,
    () => {
      // 🔴 **The follow and the latch belong to ONE conversation** (300). This pane is reused across
      // conversations without a `key` — `BackgroundBar` took a `conversation` prop in 287 for exactly
      // this reason — so a tail left here would be drawn under the next conversation's card, and a
      // held stop key would disable a button over a request nobody made for it. ⚠️ A provider id is
      // only unique within a session, which is what makes the second one reachable rather than tidy.
      following.clear()
      followed.clear()
      drainAgain = false
      stopFollowing()
      if (stoppingCalls.value.size > 0) stoppingCalls.value = new Set()
    },
  )

  onUnmounted(() => {
    // ⛔ **A timer must never outlive the pane that owns it** (300) — `StallWatchdog`'s rule in the
    // runtime, and the same one here: an interval left running holds this closure, its record and
    // every tail it captured, and goes on asking the store about a conversation nobody is looking at.
    stopFollowing()
  })

  return {
    canStopBackgroundWork,
    canWatchCommands,
    canReadToolAnswers,
    outputCapability,
    backgroundOutputCapability,
    onWatchCommand,
    tailFor,
    stoppingCall,
    onStopCommand,
  }
}
