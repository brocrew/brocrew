import { reactive, shallowReactive, watch, type WatchStopHandle } from 'vue'
import {
  MAX_HANDED_PATHS,
  alreadyStagedAs,
  sameFileDifferentCase,
  type DroppedPathVerdict,
  type HandedPath,
} from '../../../shared/runtime-ipc'

/**
 * What you have typed but not sent, kept per conversation (019).
 *
 * The bug this exists to prevent: the composer used to own its text, and the composer is ONE
 * component that is handed a different conversation rather than being torn down and rebuilt. So a
 * draft typed in thread A was still sitting there when you switched to thread B — and sending in B
 * delivered A's words to B's agent. That is the app saying something to the wrong agent, which is
 * the honesty bar, not a papercut; 015's multi-line composer only raised the stakes from a line to
 * a paragraph.
 *
 * Keys are namespaced rather than raw ids so the new-conversation surface — which has no session
 * id at all — can have a slot that no session can ever collide with.
 */

/** The slot for the thread that has not started yet. */
export const NEW_CONVERSATION = 'new'

/** The slot for one open conversation. */
export function draftKey(sessionId: string): string {
  return `session:${sessionId}`
}

/**
 * Which slot the composer on screen writes to: a conversation's own, or the launcher's when there
 * is no conversation yet. Total, and used by BOTH call sites, so "which draft am I editing" is one
 * decision with one answer rather than a rule duplicated at each binding — duplicating it is how
 * one of them ends up pointing at the wrong conversation.
 */
export function draftSlot(sessionId: string | null): string {
  return sessionId === null ? NEW_CONVERSATION : draftKey(sessionId)
}

/**
 * ⛔ **The rules for turning main's verdicts into the next staged list** (292 §2).
 *
 * ⚠️ **It was a function inside `PromptComposer` until 292, and that is exactly why `288` H2 was
 * reachable.** A gesture whose answer arrives after its composer has been torn down still has to be
 * staged — into the draft it was started for — and a rule that lives in the component cannot be
 * applied by anything that outlives it. ⚑ Pure and here, it is the same dedup, the same ceiling and
 * the same first-refusal-wins for a paste that lands while you are looking at another conversation
 * as for one that lands while you are watching.
 *
 * ⚠️ **One refusal, the first.** Three sentences stacked under a composer is not three times as
 * useful; the first thing that went wrong is what a person acts on.
 */
export function stageVerdicts(
  base: readonly HandedPath[],
  verdicts: readonly DroppedPathVerdict[],
): { next: HandedPath[]; refusal: string | null } {
  const next = [...base]
  let refusal: string | null = null
  for (const verdict of verdicts) {
    if ('refusal' in verdict) {
      refusal ??= verdict.refusal
      continue
    }
    // 🔴 **744 · a path RESTORED as missing and attached again is THERE now** — the fresh record takes
    // the stale one's place, so the chip stops saying *missing* about a file the person just handed
    // over. ⚑ Same place in the list, and still one attachment — so it is asked BEFORE the ceiling:
    // a full message is not made any fuller by a record replacing itself.
    const stale = next.findIndex((each) => each.path === verdict.handed.path && each.missing)
    if (stale !== -1) {
      next[stale] = verdict.handed
      continue
    }
    // ⛔ The ceiling refuses OUT LOUD rather than silently keeping the first ten (106): dropping
    // twelve files and being told about ten is worse than being told twelve is too many.
    if (next.length >= MAX_HANDED_PATHS) {
      refusal ??= `one message can carry ${MAX_HANDED_PATHS} attachments — the rest were not added`
      continue
    }
    // ⚠️ **The same path twice is not two attachments.** The message would name it twice and the
    // agent would read it twice; silently keeping one is what a person means by attaching
    // something already attached — by either gesture.
    //
    // ⛔ **…and a spelling that differs only in CASE is refused rather than folded** (236 §5, from
    // `227` LOW 4). It is one file on the default macOS volume format and two on a case-sensitive
    // one, so neither "silently one" nor "silently two" is true everywhere — which is `187` §1's
    // ruling, reached through {@link alreadyStagedAs}, which IS that matcher rather than a second
    // copy of it.
    const collides = alreadyStagedAs(
      verdict.handed.path,
      next.map((each) => each.path),
    )
    if (collides === verdict.handed.path) continue
    if (collides !== null) {
      refusal ??= sameFileDifferentCase(collides)
      continue
    }
    next.push(verdict.handed)
  }
  return { next, refusal }
}

/**
 * # ⛔ ONE draft's attachment transaction — the words' half already had one (292 §1/§2)
 *
 * ⚠️ **`262` made the draft a transaction and made a Send WAIT for the operations open inside it.
 * Both halves of that lived in the composer, and the composer is not what a draft belongs to** —
 * `019` decided that for the words and `216` for the paths, both for the same reason: the component
 * is handed a different conversation rather than rebuilt for each one, and `ConversationPane` keys
 * it so a conversation switch tears it down outright.
 *
 * ⛔ **So an acquisition begun in A and answered while B is on screen reached nothing at all**
 * (`288` H2, measured: neither A nor B received the image, because Vue drops emissions from an
 * unmounted component). ⚑ Held here, the operation is stamped with the draft it was started for and
 * commits to that draft wherever the screen has gone since — and a composer that comes BACK to A
 * finds the work still open and waits for it, which the component-local version could not do
 * either.
 */
export interface DraftHanding {
  /** Which draft this is — stamped on every operation, and the whole of the fix. */
  readonly key: string
  /** What is staged here, right now. */
  readonly staged: readonly HandedPath[]
  /** Replace it — the ONE writer, for the reason `one-way-to-stage.test.ts` gives. */
  stage(next: readonly HandedPath[]): void
  /** The first thing that went wrong here, or `null`. Survives leaving and returning, like the rest. */
  readonly refusal: string | null
  /** Say why — or clear it. */
  refuse(why: string | null): void
  /**
   * ⛔ **Reserve a slot for THIS draft before the first await, then stage what comes back.**
   *
   * ⚠️ **The reservation is synchronous and that is the whole guarantee** (262 §1). Everything
   * between calling `work()` and registering its promise is straight-line JavaScript, so no send
   * can run in between.
   *
   * @param work what to ask main; `null` means the gesture was CANCELLED and changes nothing at all
   *   — not even the refusal already on screen, which is the picker's standing rule.
   */
  acquire(work: () => Promise<readonly DroppedPathVerdict[] | null>): Promise<void>
  /** Whether anything is on its way into this draft. */
  readonly acquiring: boolean
  /**
   * Resolve once nothing is.
   *
   * ⚠️ **It DRAINS rather than snapshots**: a second gesture can begin while the first is settling —
   * ⌘V then ⌘V is one keystroke apart — and a single `allSettled` over the list as it was would
   * return with that one still in flight. ⛔ Bounded by construction: each pass waits only on
   * promises it has already seen and then asks what is left.
   *
   * ⚠️ **`allSettled`, not `all`.** A rejected bridge call is a gesture that failed, not a reason to
   * abandon the send — the message still has words and whatever else came back.
   *
   * ⛔ **UNBOUNDED, and that is a decision rather than an oversight.** A bridge call that never
   * answers holds the send for as long as it is wedged. ⚠️ No timeout, because the only definition
   * of *"long enough"* here is a guess wearing a number, and the one it would produce is a message
   * sent WITHOUT the picture it is about, which is the defect.
   */
  settle(): Promise<void>
}

/**
 * ⛔ **What you have ATTACHED but not sent, kept per conversation** (216 §2) — ⚠️ **and since 292,
 * what is still on its WAY in.**
 *
 * ⚑ **The same key space as {@link DraftBook}, deliberately, and for the identical reason.** The
 * composer is ONE component handed a different conversation rather than rebuilt — so an attachment
 * it owned itself would follow you between threads, and `019`'s bug would come back with a filename
 * on it: attach in thread A, switch to B, send, and B's agent is handed A's file.
 */
export interface AttachmentBook {
  /** What is attached in this conversation, or `[]` — never another conversation's paths. */
  read(key: string): HandedPath[]
  /** Remember what is attached here. An empty list is forgotten rather than stored as a blank. */
  write(key: string, handed: readonly HandedPath[]): void
  /** Forget every slot not in `live`. ⚠️ Reached through {@link DraftBook.keepOnly} in the app. */
  keepOnly(live: Iterable<string>): void
  /** The slots currently holding something, for the same reason {@link DraftBook.keys} exists. */
  keys(): string[]
  /**
   * ⛔ **This draft's transaction** (292 §2) — the handle a composer is given instead of owning one.
   *
   * ⚑ **The SAME object for the same key, every time.** It is passed as a prop, so a fresh handle
   * per render would make the prop change on every render of a component that had not changed.
   */
  handing(key: string): DraftHanding
}

export function createAttachmentBook(): AttachmentBook {
  const attached = reactive(new Map<string, HandedPath[]>())
  /**
   * ⚠️ **`shallowReactive`, because the values are PROMISES.** A deep `reactive` would wrap each
   * one in a proxy, and a proxied promise is not identity-equal to the one `settle`'s drain is
   * filtering by — so the drain would never finish. What has to be reactive is the list changing,
   * which is the shallow half.
   */
  const open = shallowReactive(new Map<string, readonly Promise<void>[]>())
  const refusals = reactive(new Map<string, string>())
  /** ⚠️ Not reactive: handles are identities, not data. See {@link AttachmentBook.handing}. */
  const handles = new Map<string, DraftHanding>()

  const read = (key: string): HandedPath[] => [...(attached.get(key) ?? [])]
  const write = (key: string, handed: readonly HandedPath[]): void => {
    if (handed.length === 0) attached.delete(key)
    else attached.set(key, [...handed])
  }
  const refuse = (key: string, why: string | null): void => {
    if (why === null) refusals.delete(key)
    else refusals.set(key, why)
  }

  function handing(key: string): DraftHanding {
    const already = handles.get(key)
    if (already) return already
    const handle: DraftHanding = {
      key,
      get staged() {
        return read(key)
      },
      stage: (next) => write(key, next),
      get refusal() {
        return refusals.get(key) ?? null
      },
      refuse: (why) => refuse(key, why),
      get acquiring() {
        return (open.get(key) ?? []).length > 0
      },
      acquire: async (work) => {
        const run = (async () => {
          const verdicts = await work()
          if (verdicts === null) return
          // ⛔ **Swept while this was in flight.** The conversation was closed, so there is no draft
          // left to stage into — and writing anyway would resurrect a slot `keepOnly` had just
          // decided was gone. ⚑ Silent on purpose: there is no surface left to say it on either.
          if (!open.has(key)) return
          const { next, refusal } = stageVerdicts(read(key), verdicts)
          write(key, next)
          refuse(key, refusal)
        })()
        open.set(key, [...(open.get(key) ?? []), run])
        try {
          await run
        } finally {
          const left = (open.get(key) ?? []).filter((each) => each !== run)
          if (left.length === 0) open.delete(key)
          else open.set(key, left)
        }
      },
      settle: async () => {
        for (let waiting = open.get(key) ?? []; waiting.length > 0;) {
          await Promise.allSettled(waiting)
          const done = waiting
          waiting = (open.get(key) ?? []).filter((each) => !done.includes(each))
        }
      },
    }
    handles.set(key, handle)
    return handle
  }

  return {
    // ⚠️ **A fresh array, never the stored one.** A caller that pushed into the result would mutate
    // the book behind its own back, and the reactive Map would not see a key change. The empty case
    // has to be fresh too, or every conversation with nothing attached would share one array.
    read,

    write,

    keepOnly: (live) => {
      const keep = new Set(live)
      for (const key of [...attached.keys()]) {
        if (!keep.has(key)) attached.delete(key)
      }
      // ⛔ **The refusal and the work in flight go with the slot**, or a conversation reopened later
      // would come back wearing the sentence its last paste produced. ⚠️ The handle itself goes too:
      // it is one object per key and keeping them would grow without bound.
      for (const key of [...refusals.keys()]) if (!keep.has(key)) refusals.delete(key)
      for (const key of [...open.keys()]) if (!keep.has(key)) open.delete(key)
      for (const key of [...handles.keys()]) if (!keep.has(key)) handles.delete(key)
    },

    keys: () => [...attached.keys()],

    handing,
  }
}

export interface DraftBook {
  /** What is typed in this conversation, or '' — never another conversation's text. */
  read(key: string): string
  /** Remember what is typed here. Empty text is forgotten rather than stored as a blank. */
  write(key: string, text: string): void
  /**
   * Forget every draft that is not in `live`. Called with the conversations still open, so a
   * conversation that ends takes its draft with it: no unbounded growth, and no ghost text
   * surfacing in a thread you reopened later.
   *
   * 🔴 **678 · R26 — except through a REOPEN**, which is not an ending a person asked for: see
   * {@link sweepDrafts}, which holds the slot through the close the reopen starts with.
   */
  keepOnly(live: Iterable<string>): void
  /**
   * The slots currently holding something. NOT every conversation that has ever been typed in:
   * an emptied draft is deleted, so this answers "what is unsent" — which is what `kept-drafts.ts`
   * writes out (744 · R100).
   */
  keys(): string[]
  /**
   * ⛔ **What is ATTACHED here, keyed the same and pruned by the SAME {@link keepOnly}** (216 §2).
   *
   * ⚑ **Owned by the draft book rather than standing beside it, so pruning one and not the other is
   * UNREPRESENTABLE.** It stood beside it first, and a mutation survived `216`'s table by deleting
   * the second `keepOnly` call — nothing could kill it, because the only caller is `RuntimeScreen`
   * and nothing in this repository mounts `RuntimeScreen` (`211` §11 item 2, `212` §9 item 4, `214`
   * §8 item 6; three dispatches have named that gap). ⚠️ **Making the defect impossible beats
   * testing for it**, and it says the real thing out loud: a message and the paths handed with it
   * are one message.
   */
  readonly paths: AttachmentBook
  /**
   * ⛔ **Put a REFUSED message back — the words and the paths together** (216).
   *
   * ⚠️ **Each book guards ITSELF, and that is the whole content of this method.** Written out at
   * the call site it guarded the text against clobbering live typing and wrote the paths
   * unconditionally, so something attached during the in-flight window was silently replaced by
   * the list that had just failed — `019`'s rule applied to the words and not to the paths, in a
   * dispatch whose thesis is that they are one message.
   *
   * ⚑ **It lives HERE rather than in `RuntimeScreen` because nothing in this repository mounts
   * `RuntimeScreen`** (`211` §11, `212` §9, `214` §8, and a mutation on that exact guard survived
   * `216`'s table). A rule the table cannot reach is a rule nobody is checking; moved into the
   * book, it is ordinary code with an ordinary test.
   *
   * ⛔ **The two guards are NOT the same guard, and 236 §5 split them** (from `227` LOW 3). The
   * words genuinely have to choose — one box, and live typing wins. The paths do not: a list can
   * hold both, so *"send A, stage B while A is in flight, A is refused"* keeps B where it is and
   * takes A's files back as well. It used to keep B and drop A's entirely, in silence.
   *
   * @returns how many returned attachments did NOT fit under {@link MAX_HANDED_PATHS} — zero in
   * every ordinary case. ⚠️ Reported rather than dropped quietly, because a person whose refused
   * message came back one file short has to be told which promise was broken.
   */
  restore(key: string, text: string, attachments: readonly HandedPath[]): number
}

/**
 * ⛔ **What to say when a refused message came back short** (236 §5, from `227` LOW 3).
 *
 * ⚑ Here rather than in `RuntimeScreen`, for this file's standing reason: nothing in this
 * repository mounts that component, so a sentence written there is a sentence no test can read.
 */
export function attachmentsNotRestored(count: number): string {
  return count === 1
    ? `One attachment from that message could not be put back — this message already carries ${MAX_HANDED_PATHS}.`
    : `${count} attachments from that message could not be put back — this message already carries ${MAX_HANDED_PATHS}.`
}

/**
 * ⛔ **Which slots a sweep must KEEP** — the launcher's among them, always (217 §2).
 *
 * ⚠️ **`NEW_CONVERSATION` is pinned, and `217` is when that stopped being cosmetic.** The launcher's
 * slot holds words and now holds PATHS, and the launcher is unmounted for as long as any
 * conversation is on screen — so a sweep that forgot it would quietly take away a message somebody
 * had half-composed, attachments and all, while they were reading something else. §2 asks that
 * attachments *"survive leaving and returning"*, and this is the line that decides it.
 *
 * ⚑ **It lives here rather than inline in `RuntimeScreen` so a test can reach it.** Nothing in this
 * repository mounts `RuntimeScreen` (`211` §11, `212` §9, `214` §8, and a `216` mutation survived on
 * exactly that) — a rule the table cannot reach is a rule nobody is checking.
 */
export function liveDraftSlots(open: readonly { sessionId: string }[], onScreen: string): string[] {
  return [NEW_CONVERSATION, onScreen, ...open.map((each) => draftKey(each.sessionId))]
}

/**
 * 🔴 **678 · R26 — the sweep, and the one gesture that holds a slot through it.**
 *
 * ⚑ **The PM's ruling: *"the draft survives the reopen. A person's typing is never thrown away by an
 * act they did not ask for."*** ⛔ **`672` measured that it did not** (`656` F5): a reopen from the
 * grant sheet CLOSES the conversation first, the close takes it out of `store.open`, and this sweep
 * — which keeps only the open slots and the one on screen — deleted its words and attachments before
 * the resume landed. ⚠️ **Only the SELECTED conversation escaped**, because it is `onScreen`, so the
 * grant sheet had to warn about every other row (`reopening.ts`, the arm `672` split and `678` folds
 * back).
 *
 * ⚑ **So a reopen HOLDS its conversation's slot for the whole gesture** ({@link DraftSweep.reopening})
 * — from before the close, because the close is what the sweep reacts to, until the resume has
 * answered. ⚑ **On success the record is open again before the hold lets go**, so the slot simply
 * stays. ⚠️ **On a refused resume the conversation is now closed, and its typing is STILL not the
 * person's to lose**: the slot waits until that conversation is open again — reopened from the rail
 * later, the draft is there. ⚑ **Since `744` (R100) it survives a restart as well**: every slot is kept
 * on disk, and a restored one is held exactly as a refused reopen's is
 * ({@link DraftSweep.holdRestored}).
 *
 * ⛔ **Everything else is `019`'s rule unchanged**: a conversation that ENDS — closed from its menu, or
 * ending on its own off-screen — takes its draft with it, and {@link liveDraftSlots} is still the one
 * statement of which slots a sweep keeps.
 *
 * ⚑ **Here and not inline in `RuntimeScreen`** for {@link liveDraftSlots}' reason: nothing mounts that
 * component, and a hold written there could only be pinned by reading its source.
 */
export interface DraftSweep {
  /**
   * Hold `sessionId`'s slot through `gesture` — the close and the resume after it. ⚑ `gesture` says
   * whether the conversation is open again; `false` keeps the slot until it is.
   */
  reopening(sessionId: string, gesture: () => Promise<boolean>): Promise<boolean>
  /**
   * 🔴 **744 · R100 — hold the slots the last run's drafts were restored into, exactly as a refused
   * reopen's is held: until the conversation is OPEN in this window.** ⚠️ At launch nothing is, and
   * the rail has not answered yet, so without the hold the first sweep would empty every slot it had
   * just restored — a restart is not a close, and nobody asked for one.
   *
   * ⚠️ **Released by `open` alone, and that is R100 over `019`** (744 review, round two). Released
   * when the rail LISTED a conversation as kept open, a restored draft was lost the moment its parent
   * started that conversation — it leaves the kept-open list and enters no list this window keeps.
   * ⚑ R100 clears a draft when it is sent or its conversation no longer exists; so a restored draft
   * whose conversation a person then ends WITHOUT opening it here waits for it, and is back if it is
   * ever reopened. ⛔ `019`'s rule — an END takes the draft — still holds for everything typed in
   * this run.
   */
  holdRestored(sessionIds: readonly string[]): void
  /**
   * Hold archived conversations' slots the same way, until each is open in this window again: an
   * archive keeps everything, the words a person had typed included, and a restore brings them
   * back. A delete still drops them.
   */
  holdArchived(sessionIds: readonly string[]): void
  stop: WatchStopHandle
}

export function sweepDrafts(
  drafts: DraftBook,
  open: () => readonly { sessionId: string }[],
  onScreen: () => string,
  /**
   * ⚑ **D-017b · every conversation the window's one list names** — a stop is not an ending, so a
   * conversation's words survive a walk away for as long as it is listed, whether or not anything
   * runs it; ⛔ they are not all in `open`, which is the records this window is fed.
   */
  listed: () => readonly string[],
  /**
   * 🔴 **744 · the app is closing — empty NOTHING.** The quit ends every conversation, and those
   * endings are not a person closing them (R34b: the quit leaves them open); a sweep that pruned on
   * them would hand the quit's last save a book without their words. ⚠️ It cannot tell them from a
   * person's own Close still tearing down when the quit began, so that draft is kept too.
   */
  closing: () => boolean = () => false,
): DraftSweep {
  // ⚠️ **A COUNT per conversation, not a set** — two reopens of one conversation can overlap (a
  // double press lands on the store's own `busy` guard, but a hold must not be the thing that
  // decides that), and the first one to finish must not release the second one's hold.
  const held = reactive(new Map<string, number>())
  // ⚑ Conversations whose reopen was refused after the close — held until they are open again.
  const untilOpen = reactive(new Set<string>())
  const stop = watch(
    [open, onScreen, () => [...held.keys()], () => [...untilOpen], listed],
    ([live, shown, holding, waiting, inTheList]) => {
      if (closing()) return
      for (const sessionId of waiting) {
        if (live.some((each) => each.sessionId === sessionId)) untilOpen.delete(sessionId)
      }
      drafts.keepOnly([
        ...liveDraftSlots(live, shown),
        ...holding.map(draftKey),
        ...waiting.map(draftKey),
        ...inTheList.map(draftKey),
      ])
    },
    { immediate: true },
  )
  return {
    async reopening(sessionId, gesture) {
      held.set(sessionId, (held.get(sessionId) ?? 0) + 1)
      let back = false
      try {
        back = await gesture()
        return back
      } finally {
        // ⚠️ **Parked BEFORE the hold lets go**, in the same tick, so no sweep can run between the
        // two and find the slot held by neither.
        if (!back && !open().some((each) => each.sessionId === sessionId)) untilOpen.add(sessionId)
        const left = (held.get(sessionId) ?? 1) - 1
        if (left === 0) held.delete(sessionId)
        else held.set(sessionId, left)
      }
    },
    holdRestored(sessionIds) {
      for (const sessionId of sessionIds) untilOpen.add(sessionId)
    },
    holdArchived(sessionIds) {
      for (const sessionId of sessionIds) untilOpen.add(sessionId)
    },
    stop,
  }
}

export function createDraftBook(): DraftBook {
  const drafts = reactive(new Map<string, string>())
  const paths = createAttachmentBook()

  return {
    paths,
    read: (key) => drafts.get(key) ?? '',

    write: (key, text) => {
      // An empty draft is the absence of one. Storing '' would leave a slot behind for every
      // conversation ever typed in, and make `keys()` a poor answer to "what is unsent".
      if (text === '') drafts.delete(key)
      else drafts.set(key, text)
    },

    keepOnly: (live) => {
      const keep = new Set(live)
      for (const key of [...drafts.keys()]) {
        if (!keep.has(key)) drafts.delete(key)
      }
      // ⛔ **One call, both books.** See {@link DraftBook.paths}: pruned separately they would
      // eventually disagree about which conversations exist, and the survivor would be a ghost.
      paths.keepOnly(keep)
    },

    keys: () => [...drafts.keys()],

    restore: (key, text, attachments) => {
      // Only if the box is still empty: the user may have started typing the next message while
      // the send was in flight, and overwriting live typing is the bug 019 exists to prevent.
      if ((drafts.get(key) ?? '') === '') {
        if (text !== '') drafts.set(key, text)
      }
      // The same question, asked separately — see {@link DraftBook.restore}.
      if (attachments.length === 0) return 0
      // ⛔ **MERGED, not chosen between** (236 §5, from `227` LOW 3). This used to write the
      // returned paths only when the slot was empty, which kept the newer edit — correctly — and
      // then lost the refused message's attachments entirely, with nothing said. ⚠️ Both facts are
      // true at once and can both be honoured: what is staged now stays exactly where it is, and
      // the paths that came back join it.
      const now = paths.read(key)
      const merged = [...now]
      let refused = 0
      for (const handed of attachments) {
        // Already there — the same message being handed back over itself is the ordinary case.
        if (merged.some((each) => each.path === handed.path)) continue
        // ⛔ **The ceiling still binds, and what did not fit is COUNTED rather than dropped in
        // silence** (106). A restore that pushed the list past the ceiling would leave Send lit
        // over a message the wire refuses — the shape 223 exists to end — so the number goes back
        // to the caller, which is the only thing here with a surface to say it on.
        if (merged.length >= MAX_HANDED_PATHS) {
          refused += 1
          continue
        }
        merged.push(handed)
      }
      if (merged.length !== now.length) paths.write(key, merged)
      return refused
    },
  }
}

/**
 * 🔴 **D-010 · *Put it back* APPENDS, and never replaces** (plan §3.4, design notes §3). ⛔ It set
 * the draft to the returned words, which was harmless while one message could wait: several may
 * now, so putting a second back would have erased the first — and either would erase what the
 * person had started typing. ⚑ After a blank line, so the two messages stay two paragraphs.
 */
export function puttingItBack(draft: string, text: string): string {
  if (text === '') return draft
  return draft.trim() === '' ? text : `${draft.replace(/\s+$/, '')}\n\n${text}`
}

/**
 * ⚑ **D-010 · and its files JOIN what is staged** — `restore`'s own rule (236 §5): what is staged
 * stays, the returned paths join it, one already there is not added twice, and the ceiling binds —
 * with how many did not fit returned, so the composer can say so ({@link attachmentsNotRestored}).
 */
export function withTheseToo(
  staged: readonly HandedPath[],
  handed: readonly HandedPath[],
): { readonly staged: HandedPath[]; readonly didNotFit: number } {
  const merged = [...staged]
  let didNotFit = 0
  for (const one of handed) {
    if (merged.some((each) => each.path === one.path)) continue
    if (merged.length >= MAX_HANDED_PATHS) {
      didNotFit += 1
      continue
    }
    merged.push(one)
  }
  return { staged: merged, didNotFit }
}
