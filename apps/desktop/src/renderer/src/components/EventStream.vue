<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RuntimeEventMessage, TranscriptEvent } from '../../../shared/runtime-ipc'
import { useStickToBottom } from '../composables/useStickToBottom'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { describeEvent } from '../lib/describe-event'
import { ROLE_PROPERTIES } from '../lib/text-roles'
import type { WindowState } from '../lib/transcript-window'

/**
 * The raw stream — a tab in the one drawer since 080, an `<aside>` of its own before that.
 *
 * ⚠️ **It is no longer what the debug toggle opens, and that separation is the point of the move.**
 * `toggle-debug-mode` now means one thing only: put lifecycle notices *inline in the conversation*
 * (079 §3). This tab is the other thing it used to mean — every event there is, unfiltered — and it
 * is opened by asking for it. One control, one meaning, each with its own home.
 *
 * Unlike the conversation beside it this filters NOTHING, in either mode. That is the contract the
 * panel states in itself — ⚑ **526 · in the disclosure now, not standing over the list.** The head
 * keeps the two FACTS a reader needs every visit (the count, and `237 §1`'s reach sentence); the
 * paragraph explaining what a raw event is and which toggle this is not is read once and sits
 * behind *what this is*. ⛔ **Neither fact may ever go inside it** — see {@link explained}.
 *
 * ⛔ **…and FILTERING NOTHING was never the same claim as HOLDING EVERYTHING** (237 §1, from `230`
 * H1). This panel said *"Here you always see everything"* over `record.window.entries` — the ONE
 * bounded array that also feeds the conversation (`session-record.ts`, deliberately: one bound, no
 * second copy to forget). ⚠️ **The bound is real**: 2,500 events a page, two pages held, and on
 * event 5,001 `appendLive` releases the oldest 1,251 — so a `Bash` call early in a noisy turn is
 * gone from this tab and from the transcript at once. Off the tail it is worse and cheaper: the
 * array freezes, new events go to the control tail, and the sentence went on promising everything.
 *
 * ⛔ **So the WINDOW is a prop, not the entries.** ⚑ `211 §4` put `data-category` on these rows so
 * that a filtered conversation could not blind the instrument that justified the filter; this is the
 * same argument one level up — a BOUNDED tab can blind the instrument that justifies an absence.
 * The rows and the fact about the rows now come from one object, so a reader of either cannot be
 * reading about a different moment than the other.
 *
 * ## ⛔ The fold: every row is HERE, only the ones you can see are DRAWN (255)
 *
 * ⚑ **`212` measured this tab at the cap and `231` #6 filed it twice.** Opening Events on a full
 * window built 5,000 rows synchronously — five elements each — and the number a person waits for is
 * not the mount but the paint: **280-320 ms measured**, of which the mount 212 timed is roughly
 * half.
 *
 * ⛔ **The rows are not thrown away, because THREE readers depend on every one of them being here.**
 * `ledgerRows` (093) reads `.rdetail` off every `<li>` and refuses an unmounted log; `235`'s erasure
 * marker reads the same text; `ledgerReach` counts `li[data-type]`. A list that put only the
 * viewport in the DOM would answer *"the model never called `Bash`"* off forty rows — which is `211`
 * §4's blinded instrument and `230` H1's bounded array in one, on the surface that exists to be the
 * one that cannot be blinded. ⚠️ **So this virtualizes the RENDER and not the data**: the `<li>`, its
 * three data attributes and its `.rdetail` are built for all 5,000. What a folded row does not get is
 * the DECORATION — the timestamp, the type chip and the head line they share — and
 * `content-visibility` keeps the engine from laying out or painting what it holds. ⚑ **526 · it
 * was *"the grid"* until the row stopped being one**: the clock held a 46 px grid column at the
 * left edge and now trails the type on a flex head line, so the detail has the whole row.
 *
 * ⚠️ **What that costs, measured with `pnpm run probe:event-fold`** — the pre-255 component and
 * this one mounted ALTERNATELY in one run, so the two columns describe the same machine under the
 * same load, in Chromium, with `visibilityState: "visible"` reported beside every number:
 * mounted **218.2/162.8/161.4 → 39.6/34.1/37.5 ms**, laid out **305.2/277.4/237.9 →
 * 39.8/34.2/37.6 ms**, painted **350.6/335.9/282.5 → 62.9/55.6/61.1 ms**. ⛔ **And
 * `querySelectorAll` still returns 5,000 rows with 5,000 readable details, over a `scrollHeight` of
 * 177,500 px either way** — the three numbers that had to not move. ⚠️ **526 · the two columns no
 * longer agree, and a reader of that probe should know why.** The frozen pre-255 baseline still
 * measures 177,500; this component measures **165,000** at its 33 px row. ⛔ The equality was
 * `255`'s evidence that the FOLD changed nothing and it still is — what moved the after column is
 * a token assignment in a later dispatch.
 *
 * ⚑ **The absolutes move with the machine; the ratio does not**, which is why the two are
 * alternated in one run rather than measured apart.
 *
 * ⚑ **The probe is committed, so none of this has to be believed.** It is not in `pnpm run ci`: a
 * millisecond threshold in the gate is a report about the machine, not a claim about the app.
 *
 * ⚑ **A folded row still SAYS what it is.** It keeps its `data-type`, its `data-category`, its
 * ordinal and its one-line detail; only the chrome is deferred. That is what makes the fold safe to
 * get slightly wrong: a mis-sliced row is a row without a timestamp, never a blank one.
 *
 * ## ⛔ …and what the fold moved rather than removed (263 §2)
 *
 * ⚠️ **`255` measured OPENING and left ARRIVING unmeasured**, and `259` lens C found the cost had
 * simply moved: every live event invalidated `rows`, which re-derived the whole window, so at the
 * cap one arriving event cost **16-18 ms of main-thread time** against 1.6 ms on a 300-row window,
 * and a burst paced at one event per animation frame held **89 of 89 frames over 16.7 ms**. ⛔ The
 * coverage could not reach it: every 5,000-row case in `event-fold.dom.test.ts` is a static mount.
 *
 * ⚑ **{@link rowFor}'s cache is the whole fix, and it is a large one**: 16-18 ms → **9-10 ms**, and
 * the same burst from 89 of 89 frames overrunning to **28 of 89**. ⛔ **It is not inside a frame's
 * budget and this file does not pretend otherwise.** **4.5 ms** of what remains is Vue reconciling
 * 5,000 `<li>`s and belongs to no cache — `event-append-scale.probe.ts` measures that floor
 * directly, with a bare list carrying the same markup and no derivation at all, and that list holds
 * every one of its 89 paced frames. The rework that could go below it is a real virtualization,
 * which is exactly what the three instruments above forbid doing casually.
 *
 * ⚠️ **The one narrowing, named rather than discovered later.** `ui-live-smoke.mjs` reads this list
 * in SEVEN places. **Five ask only for `dataset.type`**; the other two read TEXT — `ledgerRows`,
 * which filters on the type and then maps each row's `.rdetail`, and step 3's `user_command`
 * breadcrumbs, which take the whole `<li>`'s `textContent` and grep it for *"changed approval
 * mode"* and the mode it moved to. Every string either of them wants is in the detail, so the fold
 * does not reach them. ⛔ What it DOES take is the two-token prefix a drawn row carries: the clock
 * time and the type chip. The type is still on `data-type`, which is how the other five ask; the
 * time is not readable off a folded row at all. `event-fold.dom.test.ts` pins exactly that, so it
 * stays a decision. (⚑ **526 · it is the head line's two tokens now, the type then the clock** —
 * this paragraph said *"the two-token PREFIX"* while the clock still led the row.) (The count and
 * the split were both wrong in this comment's first draft — `ledgerRows` reads text and was filed
 * under the five. Found by the adversarial pass.)
 */
const props = defineProps<{ window: WindowState }>()

/**
 * 🔴 **The four roles this tab uses, as four custom properties on this panel's root** (526).
 *
 * ⛔ **This is what makes the roster DECIDE rather than describe.** Every rule in
 * the stylesheet below names a ROLE — `var(--role-value)` — so which token a role takes is stated
 * in exactly one place and `169`'s *a rule spelled twice drifts* is not being paid here.
 * ⚠️ **Every FONT-SIZE declaration, precisely**: `--row-line` names `--text-xs`, because a line
 * box is not a role and nothing wears it. ⚑ Change `ROLE_SIZE.value` and every detail on the
 * tab moves; nothing in this file has to be edited to agree. ⚠️ **529 lifted the object itself
 * into `text-roles.ts` as `ROLE_PROPERTIES`**, because three surfaces now put the same five
 * properties on their own root and three copies of one bridge is the drift the bridge exists to
 * stop.
 *
 * ⚠️ **What is still in two places, said plainly:** which ROLE an element has. The stylesheet says
 * it by selector and the roster says it again, and the only thing binding them is
 * `the-tab-with-241-things.dom.test.ts`. ⛔ The one-place form of THAT would be a `data-role`
 * attribute on every element — about **5,240** of them at the window's cap (4,878 folded rows at
 * one text element each, plus a drawn band of ~122 rows at three), on the append path `263`
 * measured. Priced and refused; see the response. ⚠️ A first draft said 15,000, which assumed
 * every row draws all three — exactly what the fold prevents, eight lines above.
 *
 * ⚑ **The keys are literal on purpose.** `chat-theme.test.ts:602-611` reads a declaration as
 * `--x:` including the quoted object-key form `StateBadge` uses, so a property spelled by a
 * template literal would be a `var()` this repo could not see declared anywhere.
 */
const messages = computed(() => props.window.entries)

const { el, onScroll } = useStickToBottom(() => messages.value.length)

/**
 * A neutral colour key per event, off OUR event vocabulary — never off anything provider-shaped.
 * Lifecycle is the dim one because it is the noise the reading surface drops.
 *
 * `''` is CONTENT, and it is a ruling rather than a gap: the conversation's own substance is drawn
 * in the bright ink this tab uses by default, so it needs no class of its own.
 */
type EventKind = '' | 'k-perm' | 'k-tool' | 'k-error' | 'k-unknown' | 'k-lifecycle'

/**
 * ⛔ **A `Record` over the whole union, so the compiler forces a ruling on every event there is**
 * (263 §3, from `259` lens C finding 3).
 *
 * ⚠️ **This was a `switch` ending in `default: return ''`, and the default was silently wrong for
 * three events.** `workflow_run`, `background_work` and `scheduled_work` are all LEVELS — the quiet
 * *"here is what exists"* frames — and every one of them fell through to the content colour, so the
 * raw screen drew them as loudly as an assistant message. ⛔ Nothing dropped and nothing crashed:
 * `describeEvent` has a `never` default and `transcript.ts` is exhaustive, so the failure was
 * exactly that the screen said the wrong thing about them **and that the next variant would inherit
 * the same unruled decision without anyone choosing it**.
 *
 * ⚑ **I looked at this myself before the review and called it consistent with `background_work`.**
 * The reviewer is right and that reasoning was wrong: consistency with an unruled default is not a
 * ruling, and a map with no `default` arm is the difference — a new event variant is now a
 * TYPE ERROR here rather than a colour nobody chose.
 */
const EVENT_KIND: Record<TranscriptEvent['type'], EventKind> = {
  permission_request: 'k-perm',
  user_input_request: 'k-perm',
  user_decision: 'k-perm',

  tool_call: 'k-tool',
  tool_result: 'k-tool',

  error: 'k-error',

  unknown: 'k-unknown',

  // `message_queued`/`message_unqueued` are a queued message's own lifecycle (077): it waits,
  // then it is sent, cancelled, retracted (690: the app took back its own notice) or abandoned.
  // Lifecycle rather than content — the CONTENT is the
  // `user_turn` it eventually becomes, or nothing at all if it never gets there.
  message_queued: 'k-lifecycle',
  message_unqueued: 'k-lifecycle',
  worker_registered: 'k-lifecycle',
  // `user_command` (097) is lifecycle for the same reason: it is what a control DID, not what the
  // conversation said. It is dim here on purpose — you go looking for it, and when you are looking
  // for it this tab is where it is, because this tab filters nothing.
  user_command: 'k-lifecycle',
  // ⚑ **`work_given` (379 as `task_assigned`; a piece since D-016) is lifecycle by the same
  // sentence**: it is what the app RECORDED about a brief, not what the conversation said. ⚠️ The
  // words are on the `message_queued` or the `user_turn` beside it — this row carries the label and
  // the giver — so drawing it as loudly as content would put one message on the screen twice, once
  // brightly and once dimly.
  work_given: 'k-lifecycle',
  // ⚑ **`work_replied` (393 as `task_replied`) is lifecycle by the SAME sentence and it was the
  // closer call.** Unlike the give, the words on this row appear nowhere else in this ledger — a
  // reply is a tool call, so no `user_turn` carries them. ⛔ It is still what the app RECORDED about
  // a conversation rather than what the conversation said: the model's own account of the reply is
  // in the `tool_call`/`tool_result` pair immediately above, drawn as content. Drawing this loudly
  // too would put one act on the screen twice.
  work_replied: 'k-lifecycle',
  // ⚑ **`work_taken_back` (429 as `task_withdrawn`) is lifecycle by the same sentence as its two
  // neighbours**: it is what the app RECORDED about a piece of work, not what this conversation
  // said. ⛔ **And this conversation did not do it at all** — the conversation that gave the piece
  // took it back — so drawing it as content would put another conversation's act in this one's
  // voice.
  work_taken_back: 'k-lifecycle',
  // ⚑ **D-016 · a piece's title, status line, brief and closing are lifecycle by the same
  // sentence**: each is what the app RECORDED about a piece, set by whichever conversation set it.
  work_retitled: 'k-lifecycle',
  work_status_set: 'k-lifecycle',
  work_rebriefed: 'k-lifecycle',
  work_closed: 'k-lifecycle',
  // ⚑ **D-047 · what this conversation gave, as the app recorded it** — its words are the call's,
  // drawn beside it.
  work_sent: 'k-lifecycle',
  // ⚑ **`request_routed` (394) is lifecycle for `work_given`'s reason exactly**: the words are on
  // the `permission_request` or `user_input_request` drawn immediately above it, and this row is what
  // the app DECIDED about that request. ⚠️ Not `k-perm` — that class is for the cards a person acts
  // on, and colouring a routing decision like one would put a control's weight on a record.
  request_routed: 'k-lifecycle',
  // ⚑ **`question_asked` (437) is lifecycle for `request_routed`'s reason, and it needs it MORE.**
  // ⛔ A provider-raised question has its words on the `user_input_request` drawn above its routing;
  // this one has no such row, because the app raised it — so this IS the words. ⚠️ Still not
  // `k-perm`: nobody acts on it here, and the conversation that answers it is a different one.
  question_asked: 'k-lifecycle',
  // ⚑ **582 · the instruction asks, lifecycle beside the question row above them.** ⛔ Not `k-perm`:
  // that colour is the provider's consent cards, and an ask is this app's own row.
  instruction_proposed: 'k-lifecycle',
  instruction_settled: 'k-lifecycle',
  instruction_changed: 'k-lifecycle',
  mcp_server_requested: 'k-lifecycle',
  mcp_server_request_settled: 'k-lifecycle',
  // ⚑ **`work_interrupted` (395) is lifecycle for the same reason `user_command` is**: it is what
  // the app RECORDED about a gesture, and the gesture's own consequence — the `turn` two rows below
  // it — is drawn beside it. ⚠️ Not `k-error`: an interruption is somebody's decision, and colouring
  // it like a fault is the confusion this whole dispatch exists to remove.
  work_interrupted: 'k-lifecycle',
  // ⚑ **`tool_refused` (405) is `k-tool`, and it is the one app-authored row that is NOT
  // lifecycle.** ⛔ Every other row in this block is what the app RECORDED about a gesture; this one
  // is about a TOOL CALL, and it is the half of that call the `tool_call`/`tool_result` pair
  // immediately around it cannot show — `402` F2 measured both of them reading identically for a
  // refused spawn and an admitted one. ⚠️ Colouring it as lifecycle would dim exactly the row a
  // person came to this tab to find, away from the two rows it belongs with.
  tool_refused: 'k-tool',
  // ⚑ **`request_stranded` (396) is lifecycle for `request_routed`'s reason, and more plainly than
  // any of them**: it is not something a conversation did at all, it is what a LAUNCH recorded about
  // a request the previous run left open. ⚠️ Not `k-error` — nothing failed, and colouring a
  // restart's housekeeping like a fault is 395's confusion arriving through a different row.
  request_stranded: 'k-lifecycle',
  // ⚑ **`request_interrupted` (397) is lifecycle for `request_stranded`'s reason**: it is what the
  // app recorded about a card an interruption took, and the `work_interrupted` row directly above it
  // — already `k-lifecycle` — is the gesture itself. ⚠️ Not `k-error` for the third time: nothing
  // failed, somebody pressed Stop.
  request_interrupted: 'k-lifecycle',
  // ⚑ **D-009 · lifecycle for `request_interrupted`'s reason**: each ends a routed question.
  question_withdrawn: 'k-lifecycle',
  question_recipient_ended: 'k-lifecycle',
  question_ended_with_its_piece: 'k-lifecycle',
  // ⚑ **`work_restarted` (400) is lifecycle for the same reason its three neighbours are**: it is
  // the app writing down something it observed about a conversation, not something the conversation
  // did. ⛔ **Not `k-error` for the fourth time** — HO-018 §2.3: *"nothing about a quit tells us the
  // work failed"*, and a red row would say the opposite of the ruling that produced it.
  work_restarted: 'k-lifecycle',
  // ⚑ **`reopened` (673) is lifecycle for `work_restarted`'s reason**: the app writing down what it
  // did to a conversation — here, bring it back — not something the conversation did.
  reopened: 'k-lifecycle',
  // Lifecycle too: the app writing down that an agent brought this conversation back from the
  // archive, not something the conversation did.
  restored_from_archive: 'k-lifecycle',
  // ⚑ **D-017 · `launched` is lifecycle for `reopened`'s reason**: the app writing down that it
  // started this conversation's provider, not something the conversation did.
  launched: 'k-lifecycle',
  // ⚑ **D-017 · R10 — lifecycle for `reopened`'s reason**: the app writing down that another
  // conversation of the same agent took this one's place, not something either conversation did.
  replaced_by: 'k-lifecycle',
  replaces: 'k-lifecycle',
  // ⚑ **`work_stall_told` (404 as `work_reported`) is lifecycle for `work_given`'s reason exactly**:
  // the words are on the `user_turn` or `message_queued` drawn immediately above it, and this row
  // is the app's own record that they went in. ⚠️ Its `its-own-wake` (673), `its-own-question`
  // (719) and `its-own-brief` (D-016) members, rows written until D-016c, carry no words at all and
  // are quieter still — the gesture each stood for is the tool call already on this screen that
  // woke that conversation, asked it about the work or gave it a new brief of it.
  work_stall_told: 'k-lifecycle',
  work_reconciliation: 'k-lifecycle',
  work_recovery: 'k-lifecycle',
  // ⚑ **`message_sent` (439) is lifecycle by `work_stall_told`'s sentence exactly** — the words are
  // in the conversation this row sits in, on the sender's card, and this row is the app's own note
  // of what that call actually did. ⚠️ **678 · *"as the tool call that sent them"* was only the
  // first 200 characters**; since `671` this row carries the words itself, and the card reads them.
  message_sent: 'k-lifecycle',
  // ⚑ **`reply_undelivered` (415) is lifecycle by `work_stall_told`'s sentence and it was the
  // closest call in this map.** ⛔ **Not `k-error`, for the fifth time in this block**: nothing
  // failed and the reply is not lost — the `work_replied` row above it holds the words, the outcome
  // and the resources, and the piece is `answered` to every reader there is. ⚠️ What this row records
  // is that the conversation that gave the work was not there to be told, which is the app writing
  // down something it observed, exactly as its four neighbours do.
  reply_undelivered: 'k-lifecycle',
  // ⚑ **`request_escalated` (398), lifecycle, and the one whose colour is a claim worth stating.**
  // ⛔ Not `k-error`: nothing failed and nobody was late in any sense the app can prove — the parent
  // may be mid-turn on something more important. What happened is that a person was told, which is
  // housekeeping about a request rather than a fault in one.
  request_escalated: 'k-lifecycle',
  // ⚑ **`stop_unanswered` (723) is lifecycle**: nothing failed that this app can prove — the
  // provider may still answer — and the row is the app writing down what it observed.
  stop_unanswered: 'k-lifecycle',
  // `conversation_reset` (199) is lifecycle HERE and content in the transcript, and that is not a
  // contradiction: this tab filters nothing, so its classes are about how loudly a raw frame is
  // drawn, while `transcript-mode.ts` decides what a reader is allowed to miss. A reset is quiet
  // in a stream that shows everything and unmissable in a view that shows some of it.
  conversation_reset: 'k-lifecycle',
  session: 'k-lifecycle',
  turn: 'k-lifecycle',
  provider_turn: 'k-lifecycle',
  status: 'k-lifecycle',
  request_resolved: 'k-lifecycle',
  // ⛔ **The three the default was getting wrong** (263 §3). A LEVEL is a statement about what
  // exists, not about what was said — `247` and `253` both say so in the events' own docs — and the
  // raw screen has one way to draw *"quiet"*. `workflow_run` joins them for the same reason: its
  // frames are progress, and 19 of 41 measured ones carry nothing new at all (108).
  workflow_run: 'k-lifecycle',
  background_work: 'k-lifecycle',
  scheduled_work: 'k-lifecycle',
  // ⚑ **And 279's is the fourth, ruled by the same sentence rather than inheriting a default** —
  // which is what `263` §3 built this map for. `provider_commands` is the quietest level of them
  // all: it says what the agent COULD be asked to do, published once when a conversation opens and
  // then only if the provider changes its mind. Nothing in it is something the conversation said.
  provider_commands: 'k-lifecycle',
  // ⚑ **And 358's is the fifth, ruled here by the same sentence.** `tool_inventory` is the quietest
  // level of all — what the agent COULD call, stated once when the conversation opens and again only
  // if the child restates it. ⚠️ **Quiet is not the same as unimportant**, and the temptation to make
  // it loud is exactly why the map exists: a tool BroBot declared that the agent did not list is a
  // real problem, and the place that SAYS so is the Tools sheet, which reads the fold. This tab draws
  // raw frames, and a raw level frame is drawn the way every other level frame is.
  tool_inventory: 'k-lifecycle',

  // Content: what the conversation actually said or did, in the bright ink.
  user_turn: '',
  assistant_delta: '',
  assistant_message: '',
  thinking: '',
  activity: '',
  sub_agent: '',
  plan_update: '',
  image: '',
  context_reading: '',
  compaction: '',
  file_change: '',
  // ⚑ **Content, and ruled here rather than inheriting one** (263 §3, and 318). A memory note is
  // the one row on this list that BroBot authored from a disk observation rather than from a frame
  // the provider sent — but this map is about how loudly a row is drawn, not about who said it, and
  // what this row reports is a thing that happened to the conversation's own memory. `user_command`
  // three groups up is the counter-example that makes the line clear: that is what a control did,
  // and this is what the agent kept.
  memory_note: '',
  // ⚑ **Content, and the same ruling its neighbour above got** (318, 319). The two memory rows are
  // the pair 319 §1.4 asks the UI not to blur — one is *the agent wrote this*, seen on disk; this
  // one is *the agent read this*, reported by the provider — and they are drawn at the same weight
  // because the difference between them is a fact about SOURCE, which is the row's job to state in
  // words, not this map's job to state in loudness.
  memory_recall: '',
  // ⚑ **The third memory row, at the same weight as the two above** (332), and for the reason the
  // clause above gives: what separates these three is a fact about SOURCE and about WHEN, which is
  // each row's job to state in words rather than this map's job to state in loudness.
  memory_loaded: '',
  // 🔴 **586 · the provider's own all-clear, at the quietest weight there is** (`HO-080` §1.3).
  // ⛔ **`074`'s ruling decides this and it is the same ruling that keeps it out of the transcript
  // entirely**: `rate_limit_event` fires once or twice per TURN saying nothing is wrong, so it is
  // the densest row on this screen and the one a reader is least often looking for.
  // ⚠️ **This is the only surface it appears on at all**, which is why it is `''` rather than
  // absent: the raw stream is where a person checks WHY a wall did or did not clear, and a row
  // that is not drawn cannot answer that.
  provider_limit_clear: '',
  // ⚑ Never reaches a window — the host takes it before the ledger — so it has no row to draw.
  provider_usage: '',
}

/** {@link EVENT_KIND}, looked up — a function so the call sites read as they always did. */
function kindOf(event: TranscriptEvent): EventKind {
  return EVENT_KIND[event.type]
}

/**
 * ⛔ **How an unmapped payload was CLASSIFIED, on the row — or absent for everything else** (211 §4).
 *
 * ⚑ **This tab is where a category can still be counted, and 211 is why that matters.** The
 * lifecycle toggle used to draw every recognized whisper in the conversation, so the live smoke
 * could read `reasoning`/`plan`/`activity` off `chatter-entry`'s own `data-category` and say the 049
 * split was working. 211 §4 stopped the conversation drawing them — correctly — and that would have
 * left the classification measurable nowhere: *"no plan chatter on screen"* and *"no plan chatter at
 * all"* would read the same. ⚠️ **Measure upstream of the filter, or the filter blinds the
 * instrument that justifies it.**
 *
 * A `data-` attribute bound to `undefined` is not rendered, so a row that is not an `unknown` simply
 * has no category — which is the honest shape: `session` and `turn` frames have no category, and
 * writing `''` on them would put an empty answer where there is no question.
 */
function categoryOf(event: TranscriptEvent): string | undefined {
  return event.type === 'unknown' ? event.category : undefined
}

/**
 * One row's worth of derived strings, computed ONCE per event rather than in the template (255).
 *
 * ⚠️ **`describeEvent` runs for every row and `clockTime` runs only for the drawn ones**, and that
 * asymmetry is the measurement rather than a preference: the whole corpus through `describeEvent`
 * costs **under a millisecond**, and the same corpus through the `clockTime` `255` REPLACED cost
 * **140-146 ms** — see `clock.ts`, where the shipped, memoised one is 3.8-4.0 ms; this sentence
 * said *"the SHIPPED `clockTime`"* until 526's review caught it —
 * where that number was 97% of what `212` recorded as the cost of mounting this tab. The detail is
 * on every row because the live smoke's `ledgerRows` reads it off rows nobody is looking at; the
 * timestamp is not, because nothing reads it but a person.
 */
interface Row {
  ordinal: number
  at: number
  /**
   * ⚠️ **`eventType` and not `type`, and the name is load-bearing.** `stranded-turn.test.ts`'s
   * census counts every object literal in `src` that assigns a `type` it cannot read back to a
   * string, because 122's whole claim is that ONE place constructs a `status` event — and it says
   * out loud that it would rather flag a row-shape than miss a second writer. It is right: this is
   * not an event and it should not look like one.
   */
  eventType: string
  /** The colour key — {@link kindOf}, resolved here so the template asks once. */
  kind: EventKind
  category: string | undefined
  detail: string
}

/**
 * ⛔ **One event is derived ONCE, not once per event that arrives after it** (263 §2, from `259`
 * lens C).
 *
 * ⚠️ **`255` fixed opening this tab and moved the cost to every event**, and the measurement is
 * unambiguous: at the cap one arriving event cost **16-18 ms of main-thread time**, against 1.6 ms
 * on a 300-row window — so it was the walk over the window, once per event, and not appending. The
 * same burst held **89 of 89 animation frames over 16.7 ms**. ⛔ `255`'s own coverage could not see
 * it: every 5,000-row case there is a STATIC mount, and its two growth cases are 300 rows and
 * replace the whole array. `event-append-scale.probe.ts` is the instrument that was missing.
 *
 * ⚑ **Keyed on the MESSAGE, and that is what makes it safe.** A recorded event is immutable — the
 * host ships it once and nothing in the renderer writes back to a window entry — so a row derived
 * from one is a pure function of an object that will never change. `appendLive` PUSHES, so the 5,000
 * objects already in the window are the same objects on the next tick, and a release only drops
 * some of them.
 *
 * ⚠️ **It does NOT span a page load, and that is correct rather than a gap.** `openAt` and
 * `prependPage` build FRESH `RuntimeEventMessage` objects out of the page the host sent
 * (`transcript-window.ts`), so scrolling back into history re-derives what it draws — which is the
 * same work the mount does and is paid once per page rather than once per event. The cache is about
 * the LIVE path, which is the one that repeats.
 *
 * ⚠️ **`WeakMap`, so a released event's row is collectable with it.** At the cap the window lets go
 * of 1,251 entries at a time; a `Map` would hold every row this tab ever drew for the life of the
 * session, which is `052`'s hazard rebuilt inside the fix for a different one.
 *
 * ⛔ **What this does NOT remove is the reconcile**, and the number is in the probe: the same markup
 * with the derivation deleted outright still costs 4.5 ms an append, because Vue walks the `v-for`
 * over every row whatever the row objects are. That is the floor under any cache, and it is what
 * `263` §2 asks to be reported rather than rebuilt — see the response for the ruling.
 */
const derived = new WeakMap<RuntimeEventMessage, Row>()

function rowFor(message: RuntimeEventMessage): Row {
  const already = derived.get(message)
  if (already) return already
  const row: Row = {
    ordinal: message.ordinal,
    at: message.at,
    eventType: message.event.type,
    kind: kindOf(message.event),
    category: categoryOf(message.event),
    detail: describeEvent(message.event),
  }
  derived.set(message, row)
  return row
}

const rows = computed<Row[]>(() => messages.value.map(rowFor))

/**
 * How far past the viewport rows are drawn in full, in rows.
 *
 * ⚑ **It is hysteresis, not a safety margin.** {@link syncSlice} returns without touching anything
 * while the viewport is still inside the band that was drawn, so a scroll gesture re-renders once
 * every {@link OVERSCAN} rows instead of on every `scroll` event.
 *
 * ⚠️ **48 because a re-slice costs 10-15 ms and nothing makes it cheaper.** Vue re-runs the `v-for`
 * over the whole window whenever the band moves. ⛔ So the fix is to move the band rarely: one 10 ms
 * patch per ~1,584 px of scrolling, against a 250 ms freeze on every open. ⚑ **526 · that read
 * *~1,700 px* while the row was 35.5; it is 48 × 33 now.**
 *
 * ⚠️ **That 10-15 ms is `255`'s number and `263` did NOT re-measure it.** It is very likely lower
 * now — a band move no longer re-derives the rows it walks past, which was most of an append's cost
 * — but *"likely"* is not a measurement, and `263`'s probe times appends rather than scrolls. Left
 * as the last measured figure, marked as such, rather than quietly improved on paper.
 *
 * ⚑ **`v-memo` is still not used, and `263` weakened half of the reason it was rejected.** `255`
 * argued that its cache is positional and that its dependencies could not survive a release
 * renumbering every index — the first half stands, but {@link rowFor} now hands back a STABLE object
 * per event, so `[row, isDrawn(index)]` would in fact invalidate exactly the positions whose row
 * changed. ⛔ It is left out because it is UNMEASURED here, not because the old argument still
 * holds: `263` §2 was scoped to the minimum, and the number that would justify a `v-memo` — the
 * 4.5 ms reconcile floor in `event-append-scale.probe.ts` — is the same number that argues for a real
 * virtualization instead. Said plainly rather than left as an argument this diff had already
 * outdated.
 */
const OVERSCAN = 48

/**
 * Rows drawn before anything has been measured — the server-rendered answer, and the first frame's.
 *
 * ⚠️ **SSR has no layout**, so `onMounted` never runs there and this is the whole of what
 * `renderToString` decorates. It is comfortably more than a tall drawer holds, so the tests that
 * render a handful of rows see exactly the markup they saw before this change.
 */
const INITIAL_DRAWN = 60

/**
 * A fallback used until {@link measureRow} runs, which is before the first paint.
 *
 * ⚠️ It is the SLICE's fallback only — the stylesheet has its own, `calc()`ed from the tokens the
 * row is made of. This one is superseded before a person sees a frame and never sizes anything, so
 * a round number is honest here where it would not be in the CSS.
 */
const ESTIMATED_ROW_PX = 36

/**
 * ⛔ **Deliberately NOT a `ref`.** The row height is read from layout and written back to layout as
 * a custom property; making it reactive would put it in this component's render dependencies, and
 * every measurement would re-run the `v-for` over all 5,000 rows to change one string on the `<ol>`.
 */
let rowPx = ESTIMATED_ROW_PX

const first = ref(0)
const last = ref(INITIAL_DRAWN - 1)

const isDrawn = (index: number): boolean => index >= first.value && index <= last.value

/**
 * How many rows are drawn in full — on the list, so the fold is visible to a reader and a test.
 *
 * ⚠️ **Counted as an INTERSECTION with the rows that exist, not as the band's own width.** A window
 * that has just released a page leaves the band pointing past the end for the tick before
 * {@link syncSlice} re-derives it, and clamping both edges to `total - 1` would have reported one
 * drawn row where none is.
 */
const drawn = computed(() => {
  const lowest = Math.max(0, first.value)
  const highest = Math.min(last.value, rows.value.length - 1)
  return Math.max(0, highest - lowest + 1)
})

/**
 * ⛔ **The row height is MEASURED, never assumed.** A folded row is sized by `--row-px` and a drawn
 * one by its two fixed line boxes; if those disagree the scrollbar lies about where you are, which
 * is the one thing `255` §2 forbids this change from making worse. Reading it off a real drawn row
 * means the two are equal by construction at whatever font size, zoom or theme is in force.
 */
function measureRow(): void {
  const node = el.value
  if (!node) return
  // ⚠️ `getBoundingClientRect`, not `offsetHeight`: `offsetHeight` is an INTEGER, and when the
  // row was 35.5 px rounding it to 36 made every folded row half a pixel too tall — 2,466 px of
  // accumulated lie over a full window, which is 69 rows, which is past the overscan. Measured.
  // 🔴 **526 · the row is 33 px now and that number is exactly why this line still says
  // `getBoundingClientRect`.** ⛔ **An integer row makes the two readings AGREE**, so `255 M5` —
  // the row that puts `offsetHeight` back — stopped killing anything the moment the height came
  // out whole: *a comparison tested where both sides agree measures nothing*, and standing rule 3
  // asks for the reading where they DIVERGE. ⚑ `event-fold.dom.test.ts` now plants a fractional
  // row and watches the write-back keep its fraction, which is where M5 dies again. ⚠️ The
  // shipped height being whole today is a property of four token values and a padding step; the
  // next edit to any of them can make it fractional without anyone noticing, which is the whole
  // reason the weaker call is still wrong.
  const drawnRow = node.querySelector<HTMLElement>('.raw-event:not(.folded)')
  const foldedRow = node.querySelector<HTMLElement>('.raw-event.folded')
  const px = drawnRow?.getBoundingClientRect().height ?? 0
  if (px <= 0) return
  rowPx = px
  // ⛔ **Written only when the stylesheet is not already right.** The fallback in `.folded` is
  // `calc()`ed from the SAME tokens the drawn row is made of, so in the ordinary case the two agree
  // and this writes nothing — and writing anyway costs a second full layout of five thousand rows,
  // measured at ~25 ms. The write is for the case the tokens cannot predict: a zoom or a font that
  // changes the line box under them.
  // ⚠️ **A quarter of a pixel, and the number is arithmetic rather than taste.** Whatever slips
  // through here accumulates once per folded row, so the drift by the end of a full window is
  // `5000 × tolerance / 33` rows — at 0.25 px that is 38 rows, comfortably inside {@link OVERSCAN}
  // and therefore invisible. A tolerance tight enough to trip on sub-pixel wobble would buy a second
  // full layout for nothing.
  if (foldedRow && Math.abs(foldedRow.getBoundingClientRect().height - px) > 0.25) {
    node.style.setProperty('--row-px', `${px}px`)
  }
}

/**
 * Which rows get their decoration, from where the reader actually is.
 *
 * ⚠️ **`force` is for the cases where the SLICE is stale rather than the scroll position** — the
 * window gaining or losing rows, and the drawer being resized. Neither is a scroll, so the
 * hysteresis below would correctly decide that nothing the reader did had happened.
 */
function syncSlice(force = false): void {
  const node = el.value
  const total = rows.value.length
  if (!node || total === 0) return
  const px = rowPx
  const top = Math.floor(node.scrollTop / px)
  const bottom = Math.ceil((node.scrollTop + node.clientHeight) / px)
  if (!force && top >= first.value && bottom <= last.value) return
  first.value = Math.max(0, Math.min(top, total - 1) - OVERSCAN)
  last.value = Math.min(total - 1, bottom + OVERSCAN)
}

function handleScroll(): void {
  onScroll()
  syncSlice()
}

/**
 * ⛔ **The slice is re-derived when the WINDOW changes, not only when the reader scrolls** (255).
 *
 * ⚠️ **Measured rather than reasoned about, having reasoned about it wrongly first.** The argument
 * that a growing list always produces a `scroll` event — {@link useStickToBottom} puts a followed
 * list back on its newest line, and that is a scroll — is FALSE in the case that matters: the event
 * does not arrive in time, so the newest row is drawn folded and a followed stream appears to go
 * blank on its own tail. Deleting this reddens `event-fold.dom.test.ts`.
 *
 * ⚑ **`post`, so it runs after the rows it is about are in the DOM.**
 */
watch(
  () => rows.value.length,
  () => syncSlice(true),
  { flush: 'post' },
)

let resize: ResizeObserver | null = null

onMounted(() => {
  measureRow()
  // ⚑ NOT forced. A drawer shorter than {@link INITIAL_DRAWN} rows is already covered by the slice
  // this mounted with, and forcing here would re-render the whole window once to arrive at the same
  // answer. A taller one falls through the hysteresis and re-slices, which is the case that needs it.
  syncSlice()
  // ⚠️ **The number of rows that fit is not a constant.** The window is resizable and the drawer
  // takes its share of it (`drawerFit`, 079 §4), so this list's height moves with the window and
  // the band has to be re-derived — a resize is not a scroll and produces no `scroll` event.
  // Re-MEASURING here as well is deliberate: a width change re-wraps nothing (the detail is
  // `nowrap` + ellipsis), but a font or zoom change arrives as a resize too and moves the row.
  resize = new ResizeObserver(() => {
    measureRow()
    syncSlice(true)
  })
  if (el.value) resize.observe(el.value)
})

onBeforeUnmount(() => {
  resize?.disconnect()
  resize = null
})

const count = computed(() => messages.value.length)

/**
 * ⛔ **Is the explanation open** (526).
 *
 * ⚠️ **The FACTS are never behind it, and that is the whole ruling.** `237 §1` put the count and
 * the reach sentence on this tab because a reader could not otherwise tell a complete ledger from
 * a window onto one, and `scripts/ui-live-smoke.mjs` refuses the run if `[data-cy=event-log-reach]`
 * does not say so in words. ⛔ A disclosure that could hide either of those would be `237`'s
 * defect rebuilt as a gesture. ⚑ What it holds is the EXPLANATION — what a raw event is, and which
 * toggle this is not — which is read once and then re-read by nobody.
 *
 * ⚑ **`v-show` and not `v-if`, deliberately.** `raw-stream.render.test.ts` asserts the explanation's
 * words are in the server-rendered markup, and the fold below already proves that text in the DOM
 * and text on the screen are two different questions. `display: none` keeps the first and answers
 * the second — and keeps it out of the accessibility tree while it is shut.
 */
const explained = ref(false)

/**
 * ⛔ **Whether what is on screen IS the session, or a window onto it** (237 §1).
 *
 * ⚠️ **Both halves, because they fail differently.** `hasOlder` is the release: the ledger holds
 * events before the first one drawn here. `atTail` is the reader having scrolled back far enough
 * that the newest events are no longer in this array at all — and that state is cheaper to reach,
 * freezes the list silently, and would otherwise look identical to a session that had gone quiet.
 *
 * ⛔ **It is the two EDGES, and it cannot see a hole in the middle.** A window that lost an event to
 * an ordinal gap still reports `true` here, and deliberately: a gap is a different fault with a
 * different owner — `SessionRecord.nextOrdinal` is what notices one, and `session-record.ts` says it
 * is *"reported, not hidden"*. Claiming this attribute covered it would be the wider lie.
 */
const whole = computed(() => !props.window.hasOlder && props.window.atTail)

/**
 * The sentence, which is now a report rather than a promise.
 *
 * ⚑ **The old one — *"Here you always see everything"* — was FALSE in exactly the state a reader
 * most needs it to be true**, and the count beside it made it worse: `messages.length` reads as a
 * total to anyone who has not read `transcript-window.ts`.
 */
const reach = computed(() => {
  if (whole.value) return 'This is the whole ledger — every event this session has recorded.'
  const parts: string[] = []
  if (props.window.hasOlder) {
    parts.push(
      `this is a WINDOW onto the ledger, beginning at ordinal ${props.window.from}` +
        (props.window.turnAligned ? '' : ' — cut mid-turn'),
    )
  }
  if (!props.window.atTail) {
    parts.push(
      props.window.behind > 0
        ? props.window.behind === 1
          ? '1 newer event has arrived and is not in this list'
          : `${props.window.behind} newer events have arrived and are not in this list`
        : 'it no longer holds the newest event',
    )
  }
  return `Not everything: ${parts.join(', and ')}.`
})
</script>

<template>
  <div class="event-stream" :style="ROLE_PROPERTIES" data-cy="event-stream">
    <!-- 🔴 **The head of the tab is two things now, and 526 split them because they are read a
         different number of times.** ⚠️ The count and the reach sentence are FACTS about what is
         below, and a reader needs both every time they open this tab; the explanation is read
         once. ⛔ Four lines of 7.5 px prose standing over the list on every visit is what `525`
         measured, and it cost 62 px of the viewport the list has to scroll inside. -->
    <p class="stream-note" :class="{ windowed: !whole }" data-cy="event-log-note">
      <strong>{{ count }} event{{ count === 1 ? '' : 's' }}</strong> ·
      <!-- ⛔ 237 §1: what is DRAWN and what is HELD are two facts, and this tab used to state only
           the first while promising the second. ⚑ **It is outside the disclosure on purpose** —
           see {@link explained}. -->
      <span data-cy="event-log-reach">{{ reach }}</span>
      <button
        class="why"
        type="button"
        :aria-expanded="explained"
        aria-controls="event-log-explanation"
        data-cy="event-log-why"
        @click="explained = !explained"
      >
        <svg class="icon chev" :class="{ down: explained }"><use href="#i-chevron" /></svg>
        what this is
      </button>
    </p>
    <p
      v-show="explained"
      id="event-log-explanation"
      class="stream-explain"
      data-cy="event-log-explanation"
    >
      Raw normalized <code>RuntimeEvent</code>s, unfiltered and in arrival order with the host's
      ordinal. This is not the lifecycle toggle: that one puts session starts and turn boundaries
      <em>in the conversation</em>. Nothing here is filtered out.
    </p>
    <!--
      ⛔ **The completeness fact rides on the list itself** (237 §1). ⚠️ Anything that reads these
      rows — a person, or the live smoke concluding *"the model never called Bash"* — is reading one
      array, and whether that array is the whole ledger is a property OF THAT READ. On a sibling
      element it could describe a different moment; in main it would be a different process
      answering a different question. Here it cannot disagree with what it describes.
    -->
    <ol
      ref="el"
      class="stream-list"
      data-cy="event-log"
      :data-whole="whole ? 'true' : 'false'"
      :data-from="props.window.from"
      :data-has-older="props.window.hasOlder ? 'true' : 'false'"
      :data-at-tail="props.window.atTail ? 'true' : 'false'"
      :data-behind="props.window.behind"
      :data-drawn="drawn"
      @scroll="handleScroll"
    >
      <!--
        ⛔ **Every row, every time** (255). The `v-for` is over the whole window and the fold is a
        CLASS, not a filter: `data-type`, `data-category`, the ordinal and the detail are on all
        5,000, so `ledgerRows`, `235`'s erasure marker and `ledgerReach`'s row count read exactly
        what they read before. What the fold takes away is the decoration and the layout.
      -->
      <!-- ⚑ **526 · the name leads and the clock trails.** ⛔ The timestamp used to hold a 46 px
           column at the left edge of every row — the first thing the eye met, identical on the
           rows either side of it, and it pushed the detail into **290 px of the 344 px a row
           has** (380 px track − 1 px border − 11 px scrollbar − 24 px padding, then − 46 px − an
           8 px gap). It is META: it says something about the row rather than in it.
           ⚠️ **Moving it to the end of the head line gives the detail the whole 344 px**, which
           is what paid for the size: 290 px at 7.5 px mono ends the ellipsis at **62.5**
           characters and 344 px at 9 px ends it at **61.8** — break-even, for a fifth more glyph.
           ⚑ **The advance is 0.6182 em, measured in this engine on the resolved `--font-mono`
           stack**, not the 0.6 em a first draft of this comment assumed. -->
      <!-- 🔴 **526 · the one place the truncated half can be read.** ⛔ `describeEvent` had 50
           arms at `526` and **25 of them exceeded this column on every instance** — a
           `task_assigned` is 106 characters — and until then the remainder was reachable NOWHERE: no tooltip, no copy, no second surface, and a folded row's text cannot even
           be selected (`content-visibility: hidden`, said above). ⚑ Fifteen call sites across
           fourteen components already pair a short rendering with `:title="fullTime(…)"`; this
           was the surface that did not.
           ⚠️ **On the DRAWN branch only, and that is the price.** ⛔ A `title` on the `v-else`
           would put an attribute on all five thousand rows, which is the hot path `263`
           measured; here it is one string already on `row` for the ~120 rows a viewport holds.
           ⚑ **The clock gets one too, and the first draft of this comment REFUSED it on a
           number that belongs to code `255` deleted.** It priced `fullTime` at *"an `Intl` format
           per drawn row"* and cited 140-146 ms — but that figure is
           `Date.prototype.toLocaleTimeString` building a fresh formatter five thousand times, the
           shape `255` replaced. ⛔ **`fullTime` is memoised exactly as `clockTime` is**
           (`clock.ts`), so the real price is 4 ms per five thousand, which over a drawn band of
           ~122 rows is **≈0.1 ms a re-slice**. ⚠️ Found by the adversarial pass over this diff: a
           refusal priced on the wrong number is not a priced refusal. ⚑ And the clock is the one
           thing on the row a person cannot otherwise date — `clockTime` renders hours and minutes
           and nothing else. -->
      <li
        v-for="(row, index) in rows"
        :key="row.ordinal"
        class="raw-event"
        :class="[row.kind, isDrawn(index) ? undefined : 'folded']"
        :data-type="row.eventType"
        :data-category="row.category"
        :data-ordinal="row.ordinal"
      >
        <template v-if="isDrawn(index)">
          <span class="rhead">
            <span class="rtype">{{ row.eventType }}</span>
            <span class="rts" :title="fullTime(row.at)">{{ clockTime(row.at) }}</span>
          </span>
          <span class="rdetail" :title="row.detail">{{ row.detail }}</span>
        </template>
        <span v-else class="rdetail">{{ row.detail }}</span>
      </li>
      <li v-if="rows.length === 0" class="empty">nothing yet</li>
    </ol>
  </div>
</template>

<style scoped>
/* The tab body scrolls, so this fills it and the list inside takes the overflow — the same shape
   the drawer's other panels have, minus the head the tab strip now provides. */
.event-stream {
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

/* 🔴 **526 · PROSE, at the reading size; the roster is `lib/raw-stream-roles.ts`'s and the token
   each role takes is `lib/text-roles.ts`'s** (529 lifted the second half out when two more tabs
   needed it).
   ⛔ Every size in this stylesheet names a token `ROLE_SIZE` assigns to a role, and
   `the-tab-with-241-things.dom.test.ts` compares each one against what Chromium computed — so a
   number here that drifts from the roster reddens rather than shipping. */
.stream-note {
  margin: 0;
  padding: var(--space-4) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: var(--leading-normal);
}

.stream-note strong {
  color: var(--muted);
}

/* A window is not an error, so it is not red — but it must not read like the ordinary case either,
   because the ordinary case is what a person assumes when nothing says otherwise (237 §1). */
.stream-note.windowed {
  border-bottom-color: var(--line-strong);
  color: var(--waiting-text-label);
}

/* ⚑ **The explanation, and it is `SessionInfo`'s gesture rather than a new one** (526) — a `.why`
   trigger with a chevron over a block that is shut by default. ⚠️ Its size is `prose`'s because
   that is what it is; what makes a reading size affordable on a 368 px rail is that nobody pays
   for it until they ask. */
.stream-explain {
  margin: 0;
  padding: var(--space-4) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: var(--leading-normal);
}

/* ⚑ **`.stream-explain` only, since 526.** The `<code>RuntimeEvent</code>` moved into the
   disclosure with the sentence it belongs to, so a `.stream-note code` half of this selector would
   match nothing — `raw-stream-roles.ts`'s roster says the same thing one file over. */
.stream-explain code {
  font-family: var(--font-mono);
}

/* ⚠️ **The global `button` skin has a border, a fill and an accent hover border** (`base.css`), so
   this resets it — the same reset `SessionInfo`'s `.why` makes, for the same reason. ⛔ The focus
   ring is NOT reset: `button:focus-visible` is the only keyboard affordance this control has. */
.why {
  display: inline-flex;
  align-items: center;
  margin-left: var(--space-2);
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: var(--role-label);
  gap: var(--space-2);
}

.why:hover {
  color: var(--text-soft);
}

/* `#i-chevron` points RIGHT at rest, which is closed; open turns it down. */
.chev {
  width: 9px;
  height: 9px;
  flex: none;
  transition: transform var(--dur-fast) var(--ease-out);
}

.chev.down {
  transform: rotate(90deg);
}

.stream-list {
  /* 🔴 **526 · ONE line box for both of a row's two lines, as a LENGTH, and it is arithmetic
     rather than taste.**
     ⛔ **Chromium lays out in 1/64 px**: a line box is rounded to the nearest unit and a `height`
     is floored to one. ⚠️ A unitless leading over two DIFFERENT font sizes therefore produced two
     independently-rounded boxes whose sum the `calc()` below could not name — measured at
     **0.015625 px a row, which is 78 px of lie at the bottom of a full window** and which
     `measureRow`'s 0.25 px tolerance is deliberately too loose to correct. ⚑ `--leading-tight` of
     `--text-xs` is 12 px exactly, so both boxes and the sum land on whole units whatever size the
     text inside them is. ⛔ `event-fold.dom.test.ts` is what makes this a fact rather than a hope.
     ⚠️ **The row is SHORTER than it was — 33 px against 35.5 — and carries MORE text**: 24 px of
     line box instead of 22.5, and 9 px of padding instead of 13. That is where the size increase
     was paid for. */
  /* Rounded to a whole pixel: a fractional line box is snapped to 1/64 px per row, and over five
     thousand folded rows that drift moves the scrollbar by tens of pixels. */
  --row-line: round(nearest, calc(var(--leading-tight) * var(--type-caption)), 1px);

  /* ⛔ **Declared here, measured at runtime** (255). A folded row is sized from this, and the value
     is the drawn row's own geometry out of the tokens it is built from: two line boxes, the block
     padding twice, and the rule under it. `measureRow` overrides it inline only when the engine
     disagrees. */
  --row-px: calc(2 * var(--row-line) + 2 * var(--space-2) + 1px);

  min-height: 0;
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

/* 🔴 **526 · two stacked single-line boxes, and `--leading-tight` is the token for exactly that.**
   ⛔ **Every row must be the same height and nothing on one may wrap** — `--row-px` above sizes
   five thousand folded rows from this block's arithmetic, and half a pixel of drift is 2,466 px of
   lie at the bottom of a full window. ⚠️ That constraint is why the detail keeps its ellipsis and
   why `value` is a compact size rather than a reading one. */
.raw-event {
  display: block;
  padding: var(--space-2) var(--space-6);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--mono-text-dim);
  font-family: var(--font-mono);
  line-height: var(--row-line);
}

/* ⚑ **`center` rather than `baseline`, and the reason is weaker than the one first written here.**
   ⚠️ That comment said baseline alignment would make the flex line as tall as the largest
   above-baseline plus the largest below-baseline — a third number `--row-line` could not name.
   ⛔ **Applied as a mutation and it SURVIVED — twice, in the `dom` project.** Once both children
   inherit one line-height LENGTH, Chromium answers 33 px either way: `--row-px` is not written
   back and every row still measures the same height, which are the two assertions that would
   have caught a 0.8 px difference. ⚠️ **526's review re-derived 33.8 px from the flexbox spec's
   baseline rule and predicted this would redden; the engine disagrees**, and the engine is what
   ships. ⚑ So `center` is the clearer statement of intent and not a correctness requirement —
   what holds the row's height is the inherited length above. */
.rhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

/**
 * ⛔ **A row that is not on screen: same element, same attributes, no rendering** (255).
 *
 * ⚠️ **`content-visibility: hidden` rather than `auto`, and the difference is measured.** `auto`
 * asks the engine to decide relevance for 5,000 elements every frame and costs 50-70 ms of the
 * mount doing it; `hidden` is the app saying which rows it drew, which it already knows. ⛔ The
 * cost of that choice is real and is named in `255`'s response: text inside a hidden row cannot be
 * SELECTED, so Cmd+A over this tab copies the drawn rows rather than the window. Nothing else in
 * this app reads the rows that way — `ledgerRows` reads `textContent`, which containment does not
 * touch.
 *
 * ⚑ **The height is measured, not declared** — `--row-px` comes off a real drawn row, so a folded
 * row is exactly as tall as the row it stands in for and the scrollbar means what it says.
 */
.raw-event.folded {
  height: var(--row-px);
  content-visibility: hidden;
}

/* `meta` — {@link ROLE_SIZE}. `flex: none` so the clock is never the thing that gets truncated;
   the type is, because a type that ran long would push the clock off the row entirely. */
.rts {
  flex: none;
  color: var(--faint);
  font-size: var(--role-meta);
}

/* `label` — the scan target, so it leads the row. */
.rtype {
  overflow: hidden;
  min-width: 0;
  color: var(--mono-text);
  font-size: var(--role-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* `value`. ⚑ It spans the whole row now rather than a column of it, which is what paid for the
   size — see the head-line comment in the template for the 290 → 344 px arithmetic.
   ⛔ **`--text-3xs` and not `--text-sm`, and the refusal is priced.** `DocumentBody.vue:243`'s
   `.view-raw` sets a raw mono READING surface at 10.5 px/1.65 and `ChildWorkViewer` copies it
   byte for byte, so 10.5 is this app's standard — but it costs **53.0** characters against 9 px's
   **61.8** (at a measured 0.6182 em advance), on a column where 25 of `describeEvent`'s 50 arms
   already overflow. ⚑ 9 px is also
   exactly the smallest mono BODY in either drawing (v2.7's `.full-path`, 9px/1.7)
   and exactly the floor `tokens.css` §9 declares. Break-even on characters won. */
.rdetail {
  display: block;
  overflow: hidden;
  color: var(--faint);
  font-size: var(--role-value);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.raw-event.k-lifecycle .rtype {
  color: var(--faint);
}

.raw-event.k-perm .rtype {
  color: var(--waiting-text-label);
}

.raw-event.k-tool .rtype {
  color: var(--accent-text-soft);
}

.raw-event.k-error .rtype {
  color: var(--danger-text);
}

.raw-event.k-unknown .rtype {
  color: var(--neutral-glyph);
}

/* `prose` — it is the whole of what this tab says when there is nothing in it, and 8 px was the
   smallest thing on a screen holding one sentence (526). */
.empty {
  padding: var(--space-5) var(--space-6);
  color: var(--faint);
  font-family: var(--font-sans);
  font-size: var(--role-prose);
}
</style>
