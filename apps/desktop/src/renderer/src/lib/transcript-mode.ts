import type { TranscriptItem } from './transcript'

/**
 * The same chat body serves two audiences, so it takes a mode instead of being
 * forked into two components.
 *
 *  - **`debug`** — the conversation PLUS the lifecycle boundaries: session start,
 *    turn boundaries, idle gaps. Exactly what the toggle that turns it on says it
 *    shows, and nothing else.
 *  - **`normal`** — the conversation. Lifecycle chrome and recognized chatter drop
 *    out; anything the user could need to act on stays.
 *
 * The predicate reads only fields the item already carries — a notice's own
 * severity, an unmapped payload's neutral category — so it never branches on
 * provider and never needs to know which adapter produced the item.
 *
 * ## ⛔ `debug` used to mean EVERYTHING, and that is 211 §4 (from 210 finding 5)
 *
 * This file said *"everything, exactly as the dev screen has always shown it… where you go when you
 * need to see what the provider really said"*, and it did that. But **079 §3 had already moved that
 * job**: the raw stream became a drawer tab, and `EventStream.vue` says so in its own words —
 * *"This is not the lifecycle toggle: that one puts session starts and turn boundaries in the
 * conversation. Nothing here is filtered out."* The toggle's tooltip says the same three things.
 * (⚑ **526 · those words are behind that tab's `what this is` disclosure now**,
 * `[data-cy=event-log-explanation]`, shut on arrival. This paragraph said *"on screen"*, and the
 * argument it makes — that two surfaces had written down which behaviour was intended — rests on
 * the words existing and being findable, which they are.)
 * (⚠️ That note read *"Here you always see everything"* until 237 §1: filtering nothing and holding
 * everything are two claims, and only the first one was ever true. The half quoted here is the half
 * that survives.)
 * The FILTER never followed. So an Exploration Agent turned it on in a Codex planning conversation
 * and got **208 repeated `item/plan/delta` markers** — the plan was more readable with it off.
 *
 * ⚠️ **`142`'s rule is that the words and the behaviour must agree, and this moved the BEHAVIOUR**,
 * because both surfaces had already written down which of the two was intended, and because the
 * thing the old behaviour offered still exists one tab away, unfiltered, where it is asked for.
 *
 * ⚑ **The name `debug` is deliberately left alone.** It is a token in this file and three props; no
 * user reads it, `142` is about what the app SAYS, and renaming it would mean editing the live
 * smoke's own probes for a change nobody can see.
 */
export type TranscriptMode = 'debug' | 'normal'

/**
 * ⛔ **What the toggle promises, kept next to the filter that has to honour it** (211 §4).
 *
 * ⚠️ **It lives HERE and not in `SessionHeader.vue` on purpose.** The promise and the predicate
 * drifting apart is the whole of 210's finding 5; a sentence in a template three files away from the
 * `switch` it describes is drift waiting to happen, and this is the same move `fineTuneNames` made
 * for the same reason — what a control is NAMED has to be what is behind it.
 *
 * `lifecycle-toggle.test.ts` reads this string, pulls the three things out of it, and asserts the
 * filter shows each one and no recognized chatter beside them.
 *
 * ## ⛔ The third noun changed, and that is the one place 211 §4 moved the WORDS
 *
 * It read *"session start, turn boundaries, idle gaps"*. Writing the test that drives each promised
 * thing through the fold is what found the third: **an `idle` status produces no transcript item at
 * all** — `applyEvent` clears the activity and appends nothing — so no mode has ever been able to
 * show an "idle gap", and the honest half of that promise was zero. ⚠️ **The fix could not be to
 * make one**: an idle-gap row is a new item kind, which is feature work this ticket does not have,
 * and inventing it to satisfy a tooltip is the wrong direction entirely.
 *
 * ⚑ **`provider housekeeping` is what took its place because it is what the mode actually adds** —
 * the `unknown{lifecycle}` payloads, which `unknownCategorySchema` defines as *"session/turn
 * housekeeping"*: rate-limit notices, auth status, compaction, conversation resets. A real thing,
 * named after itself.
 */
export const LIFECYCLE_TOGGLE_TITLE =
  'Show lifecycle events in the conversation — session start, turn boundaries, provider housekeeping'

/**
 * Whether `item` belongs on screen in `mode`.
 *
 * What `normal` drops, and why it is safe to drop:
 *  - **`notice` at `info`** — "session started", "session ended", "turn completed".
 *    Pure lifecycle chrome: it tells you the machinery worked. `warn` and `error`
 *    stay, because that is where a failed or interrupted turn, a rate-limit notice,
 *    a stall warning and a fatal error all live — a user who cannot see those is
 *    being lied to by omission.
 *  - **`unknown` that the runtime recognized** — plans, lifecycle and activity
 *    chatter. `unrecognized` stays loud: surfacing a genuine surprise instead of
 *    swallowing it is the whole point of that variant. (Reasoning left this bucket
 *    in 027 — it is a first-class `thinking` item now, and is SHOWN.)
 *
 * ⛔ **What `debug` adds back is exactly the two of those that ARE the boundaries** (211 §4): the
 * `info` notices, and the `unknown` payloads the runtime classified `lifecycle` — which
 * `unknownCategorySchema` defines as *"session/turn housekeeping"*, the same three things the
 * tooltip names. `reasoning`, `plan`, `activity` and `echo` stay out in both modes: they are
 * recognized chatter, they are what drowned the plan in 210, and they are in the Events tab in full.
 *
 * ⚠️ **A superseded `tool` row stays out of BOTH modes too, and that is a change.** It is a call the
 * runtime told us is already rendered as something else (028's checklist) — the same fact twice, not
 * a boundary — so showing it here was the old "everything" contract, not this one.
 *
 * Everything the conversation is made of — the user's own messages, assistant
 * replies, tool activity, and every card that is waiting on an answer — is kept in
 * both modes.
 */
export function isVisibleIn(mode: TranscriptMode, item: TranscriptItem): boolean {
  switch (item.kind) {
    case 'notice':
      // ⚑ F035 · the scheduled job that woke a turn is content, not chrome: shown in both modes.
      return mode === 'debug' || item.level !== 'info' || item.wokenByAJob === true
    case 'unknown':
      if (item.label === 'dev_intent') return false
      return item.category === 'unrecognized' || (mode === 'debug' && item.category === 'lifecycle')
    // A tool call the runtime told us is now rendered as something ELSE (028). Claude builds its
    // checklist out of `TaskCreate`/`TaskUpdate` calls, so without this the conversation shows both
    // the calls and the checklist they produced — the same fact twice, and only for Claude, since
    // Codex's plan arrives as a notification instead.
    //
    // ⚠️ **This clause used to end *"Debug is unaffected by design: it returns early above, and its
    // whole contract is that it shows what the provider really said"*, and 211 §4 retired that
    // contract.** The early return is gone and this now applies in both modes: a duplicate of a row
    // already on screen is not a lifecycle boundary, and the drawer's Events tab is where "what the
    // provider really said" lives.
    case 'tool':
      return item.superseded !== true
    // ⛔ **`continuation` (278 §1) is shown in BOTH modes, and hiding it in `normal` would be the
    // defect this item was built to end.** It is a message that really went to the provider and
    // really started a turn — the model's next reply is an answer to it — so a reader who could not
    // see it would be looking at work with no visible cause. ⚠️ It is emphatically not lifecycle
    // chrome: 276 measured the sentence changing what the model DID (3/5 planning-profile turns
    // crossed from proposing into executing on the text alone), which makes it content by the same
    // argument `compaction` is filed with the always-shown group below rather than with the `info`
    // notices at the top of this switch.
    //
    // ⚑ **Its own `return`, not a label on the fall-through group below**, and that is a lesson
    // from this dispatch's own mutation table: written as a shared label, `278 M9` — which flips
    // this one answer — also silenced `reset`, because `case 'reset':` fell into it. A row whose
    // effect is wider than its label is `268 §2`'s defect, and the fix is here rather than in the
    // row: a case that owns one decision cannot be widened by an edit to its neighbour.
    case 'continuation':
      return true
    // ⛔ **`appNotice` (624) is shown in BOTH modes, with its own `return`**, for the reason
    // `continuation` states one clause up.
    //
    // ⚑ **It is the row a decision reaches the proposer on**, and hiding it in `normal` would
    // undo `615` on the surface a person reads: the conversation would show the agent answering a
    // decision with nothing on screen saying one had been made. ⚠️ `HO-095` §1 lists *"the
    // decision reaches the proposer"* among the ten things that worked, and `624` §6 says not to
    // break them — the authorship moved, the row did not.
    case 'appNotice':
      return true
    // ⛔ **`work` (406) is shown in BOTH modes, with its own `return`**, for the reason
    // `continuation` states one clause up: a case that owns one decision cannot be widened by an
    // edit to its neighbour, and this one sits directly beside it.
    //
    // ⚑ **It is CONTENT and not lifecycle chrome.** The words are a real message that really went
    // to the provider and really started a turn — the parent's next reply is an answer to it — and
    // the facts on it are what HO-019 §2 requires a person to be able to read at a glance. ⚠️
    // Hiding it in `normal` would restore the whole defect in the harder direction: a person would
    // see the work finish nowhere, and a debug toggle is not where somebody looks for that.
    case 'workReport':
      return true
    // ⛔ **`relayed` (413) is shown in BOTH modes, with its own `return`**, for the reason
    // `continuation` states two clauses up.
    //
    // ⚑ **It is the one entry on this list that would be a SECURITY answer if it were hidden.**
    // The words are how one agent gives another work, and the whole finding is that a person could
    // not tell them from words they had typed themselves — HO-020 §5.3, *"acting on false
    // authority"*. ⚠️ Hiding the marked entry in `normal` would show the person nothing at all
    // where they used to see their own bubble, which is worse than the defect: a piece would arrive
    // in a conversation and leave no trace on the surface a person reads.
    case 'relayed':
      return true
    // ⛔ **`memoryNote` (318) is shown in BOTH modes, and its own `return` says so**, for the reason
    // `continuation` states two clauses up: a case that owns one decision cannot be widened by an
    // edit to its neighbour, and this one is the likeliest on the list to be quietly folded in with
    // the lifecycle group below.
    //
    // Treat saved memory as conversation content, like compaction: it records a lasting change the person needs to see. Showing it only in debug mode would hide the artifact of a requested memory.
    case 'memoryNote':
      return true
    // ⛔ **`memoryRecall` (319) is shown in BOTH modes, with its own `return`**, for the reason
    // `memoryNote` states one clause up and for one more of its own: this is the row friction log
    // F5 actually asked for — *"I still don't see anything when the agent RECALLS memory"* — and a
    // row a person can only reach by turning on debug mode is a row that does not answer him.
    //
    // ⚑ **Content by the same argument its neighbour is, and not chatter.** A recall is the moment
    // something the agent kept came BACK — the return leg of the trip `memoryNote` records — and
    // 319 §1.4 is the ruling that the two must sit together rather than one being filtered away.
    case 'memoryRecall':
      return true
    // Show loaded memory in both modes with its own case. It explains memory present before the first message; hiding that launch row behind debug mode makes the source easy to miss.
    case 'memoryLoaded':
      return true
    // `thinking` is CONTENT since 027, not chatter: it is what the agent was doing, and hiding it
    // in normal mode was the complaint that produced the task. It renders as a quiet disclosure, so
    // it informs without competing with the reply. `plan` (028) is the same argument one step
    // further on — a checklist is the most legible thing a long task produces.
    //
    // `subAgent` (029) is a sub-agent at TOP level: one whose dispatching row is not on screen. The
    // nested case never reaches here — those cards live on their `tool` item and are rendered by
    // it. Shown rather than hidden, because an agent the agent dispatched is exactly the thing 029
    // exists to stop being invisible, and a card with no parent is still a real sub-agent.
    // `image` (067) is CONTENT — the most literal content there is. It is what the user asked the
    // agent to make, and before this it was hidden in normal mode as `activity` chatter, which is
    // how a 2 MB picture became a collapsed grey line nobody could open.
    // `queued` (077) is a message the USER wrote — the most content there is, and the one item on
    // this list that would be actively harmful to hide. It exists to say "this has not been sent
    // yet"; a normal-mode reader who could not see it would have typed a message, watched it vanish,
    // and had no way to learn it was waiting or to take it back.
    // ⚠️ **`compaction` (087) is here on purpose, and it is the one entry that would be easy to file
    // above with the lifecycle notices.** Both providers announce it as housekeeping and the
    // classifier used to treat it that way — but it is the moment earlier turns stopped being in the
    // model's head, and a reader who cannot see it has no way to explain why the agent forgot what
    // they told it. It is also why it is not a `NoticeItem`: an `info` notice is dropped by the
    // clause at the top of this switch, so filing it as one would have hidden it in exactly the mode
    // people read in.
    // ⛔ **`reset` (199) is the entry above's argument at full strength, and it is the one this
    // file's own reasoning predicted.** The clause above says a compaction is not lifecycle chrome
    // because *"it is the moment earlier turns stopped being in the model's head"* — a reset is
    // that and more: the earlier turns are not summarized, they are gone, and the provider is
    // answering from a different conversation than the one above this row. It reached the reading
    // view as nothing at all until 199, because the only thing the app did with the signal was
    // classify it `unknown{lifecycle}`, which the clause at the top of this switch drops.
    // ⚠️ The note sits above the run rather than beside its own label because a comment between two
    // `case` lines reads as a fall-through body to `no-fallthrough`.
    case 'reset':
    case 'user':
    case 'queued':
    case 'assistant':
    case 'permission':
    case 'userInput':
    case 'thinking':
    case 'plan':
    case 'subAgent':
    case 'image':
    case 'compaction':
      return true
    default: {
      // A new item kind must be given a decision here rather than defaulting into
      // (or silently out of) the user-facing view.
      const exhaustive: never = item
      void exhaustive
      return true
    }
  }
}

/**
 * The items `mode` shows, in order.
 *
 * ⚠️ **No short circuit for `debug` any more** (211 §4). It read `mode === 'debug' ? items : …`, and
 * that line was the OTHER half of "debug shows everything": leaving it in place while
 * {@link isVisibleIn} learned to filter would have made the two disagree, with the array-returning
 * one winning wherever a whole transcript is drawn — which is every conversation on screen.
 */
export function visibleItems(mode: TranscriptMode, items: TranscriptItem[]): TranscriptItem[] {
  return items.filter((item) => isVisibleIn(mode, item))
}
