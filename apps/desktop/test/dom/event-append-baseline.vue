<script setup lang="ts">
/*
 * ⛔ **`EventStream.vue` AS IT SHIPPED AT `c0d71fe`, frozen** — the "before" column of `263` §2's
 * measurement, and nothing else in this repo may import it.
 *
 * ⚠️ **A copy on purpose, and it must NOT be kept in sync**, for the reason
 * `event-fold-baseline.vue` states one file over: `event-append-scale.probe.ts` mounts this and the
 * real component ALTERNATELY in one run, so both columns describe the same machine under the same
 * load. The moment someone "fixes" this file to match the current one, the probe measures nothing.
 *
 * ⚑ **Two frozen baselines now, and they freeze different things.** `event-fold-baseline.vue` is the
 * PRE-`255` tab — no fold at all — and answers *"what did opening this tab cost before it was
 * virtualized"*. This one is the POST-`255`, PRE-`263` tab, and answers the question `259` lens C
 * asked instead: *"what does one arriving event cost now that opening is cheap"*. Neither replaces
 * the other and neither may be edited.
 *
 * ⚑ **`clockTime` is IMPORTED here, unlike in the pre-255 baseline.** `255` fixed the clock and
 * `263` does not touch it, so importing keeps the two columns differing in exactly the one thing
 * under measurement — which is the whole point of an A/B. Inlining a copy would freeze an unrelated
 * dependency and quietly widen the diff.
 *
 * ⚠️ Not collected by any project — `vitest.dom.config.ts` includes `*.dom.test.ts` and
 * `vitest.config.ts` excludes `test/dom/**` entirely. It runs only under
 * `pnpm run probe:event-append`.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { useStickToBottom } from '../../src/renderer/src/composables/useStickToBottom'
import { clockTime } from '../../src/shared/clock'
import { describeEvent } from '../../src/renderer/src/lib/describe-event'
import type { WindowState } from '../../src/renderer/src/lib/transcript-window'

/**
 * The raw stream — a tab in the one drawer since 080, an `<aside>` of its own before that.
 *
 * ⚠️ **It is no longer what the debug toggle opens, and that separation is the point of the move.**
 * `toggle-debug-mode` now means one thing only: put lifecycle notices *inline in the conversation*
 * (079 §3). This tab is the other thing it used to mean — every event there is, unfiltered — and it
 * is opened by asking for it. One control, one meaning, each with its own home.
 *
 * Unlike the conversation beside it this filters NOTHING, in either mode. That is the contract the
 * note below states in the panel itself.
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
 * the DECORATION — the timestamp, the type chip, the grid — and `content-visibility` keeps the
 * engine from laying out or painting what it holds.
 *
 * ⚠️ **What that costs, measured with `pnpm run probe:event-fold`** — the pre-255 component and
 * this one mounted ALTERNATELY in one run, so the two columns describe the same machine under the
 * same load, in Chromium, with `visibilityState: "visible"` reported beside every number:
 * mounted **218.2/162.8/161.4 → 39.6/34.1/37.5 ms**, laid out **305.2/277.4/237.9 →
 * 39.8/34.2/37.6 ms**, painted **350.6/335.9/282.5 → 62.9/55.6/61.1 ms**. ⛔ **And
 * `querySelectorAll` still returns 5,000 rows with 5,000 readable details, over a `scrollHeight` of
 * 177,500 px either way** — the three numbers that had to not move.
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
 * ⚠️ **The one narrowing, named rather than discovered later.** `ui-live-smoke.mjs` reads this list
 * in SEVEN places. **Five ask only for `dataset.type`**; the other two read TEXT — `ledgerRows`,
 * which filters on the type and then maps each row's `.rdetail`, and step 3's `user_command`
 * breadcrumbs, which take the whole `<li>`'s `textContent` and grep it for *"changed approval
 * mode"* and the mode it moved to. Every string either of them wants is in the detail, so the fold
 * does not reach them. ⛔ What it DOES take is the two-token prefix a drawn row carries: the clock
 * time and the type chip. The type is still on `data-type`, which is how the other five ask; the
 * time is not readable off a folded row at all. `event-fold.dom.test.ts` pins exactly that, so it
 * stays a decision. (The count and the split were both wrong in this comment's first draft —
 * `ledgerRows` reads text and was filed under the five. Found by the adversarial pass.)
 */
const props = defineProps<{ window: WindowState }>()

const messages = computed(() => props.window.entries)

const { el, onScroll } = useStickToBottom(() => messages.value.length)

/**
 * A neutral colour key per event, off OUR event vocabulary — never off anything provider-shaped.
 * Lifecycle is the dim one because it is the noise the reading surface drops.
 */
function kindOf(event: TranscriptEvent): string {
  switch (event.type) {
    case 'permission_request':
    case 'user_input_request':
    case 'user_decision':
      return 'k-perm'
    case 'tool_call':
    case 'tool_result':
      return 'k-tool'
    case 'error':
      return 'k-error'
    case 'unknown':
      return 'k-unknown'
    // `message_queued`/`message_unqueued` are a queued message's own lifecycle (077): it waits,
    // then it is sent, cancelled or abandoned. Lifecycle rather than content — the CONTENT is the
    // `user_turn` it eventually becomes, or nothing at all if it never gets there.
    //
    // `user_command` (097) is lifecycle for the same reason: it is what a control DID, not what the
    // conversation said. It is dim here on purpose — you go looking for it, and when you are looking
    // for it this tab is where it is, because this tab filters nothing.
    // `conversation_reset` (199) is lifecycle HERE and content in the transcript, and that is not a
    // contradiction: this tab filters nothing, so its classes are about how loudly a raw frame is
    // drawn, while `transcript-mode.ts` decides what a reader is allowed to miss. A reset is quiet
    // in a stream that shows everything and unmissable in a view that shows some of it.
    case 'conversation_reset':
    case 'session':
    case 'turn':
    case 'status':
    case 'request_resolved':
    case 'message_queued':
    case 'message_unqueued':
    case 'user_command':
      return 'k-lifecycle'
    default:
      return ''
  }
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
 * costs **under a millisecond**, and the same corpus through the SHIPPED `clockTime` cost
 * **140-146 ms** — see `clock.ts`,
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
  kind: string
  category: string | undefined
  detail: string
}

const rows = computed<Row[]>(() =>
  messages.value.map((message) => ({
    ordinal: message.ordinal,
    at: message.at,
    eventType: message.event.type,
    kind: kindOf(message.event),
    category: categoryOf(message.event),
    detail: describeEvent(message.event),
  })),
)

/**
 * How far past the viewport rows are drawn in full, in rows.
 *
 * ⚑ **It is hysteresis, not a safety margin.** {@link syncSlice} returns without touching anything
 * while the viewport is still inside the band that was drawn, so a scroll gesture re-renders once
 * every {@link OVERSCAN} rows instead of on every `scroll` event.
 *
 * ⚠️ **48 because a re-slice costs 10-15 ms and nothing makes it cheaper.** Vue re-runs the `v-for`
 * over the whole window whenever the band moves; `v-memo` would skip the 4,900 unchanged rows and
 * is NOT used, because its cache is positional and its dependencies would have to include enough of
 * the row to survive a window release renumbering every index — at which point the memo is the
 * comparison it was meant to avoid. ⛔ So the fix is to move the band rarely: one 10 ms patch per
 * ~1,700 px of scrolling, against a 250 ms freeze on every open.
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
 * one by its own two lines of text; if those disagree the scrollbar lies about where you are, which
 * is the one thing `255` §2 forbids this change from making worse. Reading it off a real drawn row
 * means the two are equal by construction at whatever font size, zoom or theme is in force.
 */
function measureRow(): void {
  const node = el.value
  if (!node) return
  // ⚠️ `getBoundingClientRect`, not `offsetHeight`: the row is 35.5 px and `offsetHeight` is an
  // INTEGER, so rounding it to 36 made every folded row half a pixel too tall — 2,466 px of
  // accumulated lie over a full window, which is 69 rows, which is past the overscan. Measured.
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
  // `5000 × tolerance / 35.5` rows — at 0.25 px that is 35 rows, comfortably inside {@link OVERSCAN}
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
  <div class="event-stream" data-cy="event-stream">
    <p class="stream-note" :class="{ windowed: !whole }" data-cy="event-log-note">
      <strong>{{ count }} event{{ count === 1 ? '' : 's' }}</strong> — raw normalized
      <code>RuntimeEvent</code>s, unfiltered and in arrival order with the host's ordinal. This is
      not the lifecycle toggle: that one puts session starts and turn boundaries
      <em>in the conversation</em>. Nothing here is filtered out.
      <!-- ⛔ 237 §1: what is DRAWN and what is HELD are two facts, and this tab used to state only
           the first while promising the second. -->
      <span data-cy="event-log-reach">{{ reach }}</span>
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
          <span class="rts">{{ clockTime(row.at) }}</span>
          <span class="rbody">
            <span class="rtype">{{ row.eventType }}</span>
            <span class="rdetail">{{ row.detail }}</span>
          </span>
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

.stream-note {
  margin: 0;
  padding: var(--space-4) var(--space-7);
  border-bottom: 1px solid var(--line);
  color: var(--faint);
  font-size: var(--text-6xs);
  line-height: 1.5;
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

.stream-note code {
  font-family: var(--font-mono);
}

.stream-list {
  /* ⛔ **Declared here, measured at runtime** (255). A folded row is sized from this, and the value
     is the drawn row's own geometry out of the tokens it is built from: two lines at `--text-6xs`
     × 1.5, the block padding twice, and the rule under it — 35.5 px, which is what a real row
     measures. `measureRow` overrides it inline only when the engine disagrees. */
  --row-px: calc(3 * var(--text-6xs) + 2 * var(--space-3) + 1px);

  min-height: 0;
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.raw-event {
  display: grid;
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--line);
  color: var(--mono-text-dim);
  font: var(--text-6xs) / 1.5 var(--font-mono);
  gap: var(--space-4);
  grid-template-columns: 46px minmax(0, 1fr);
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

.rbody {
  min-width: 0;
}

.rts {
  color: var(--faint);
}

.rtype {
  color: var(--mono-text);
}

.rdetail {
  display: block;
  overflow: hidden;
  color: var(--faint);
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

.empty {
  padding: var(--space-5) var(--space-6);
  color: var(--faint);
  font-size: var(--text-5xs);
}
</style>
