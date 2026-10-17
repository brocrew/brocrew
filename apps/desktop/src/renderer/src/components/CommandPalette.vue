<script setup lang="ts">
import { chordSaid, platformHere } from '../lib/this-computer'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NO_MATCH_BODY,
  NO_MATCH_ESCAPE,
  SEND_CHORD_REFUSED,
  agentNote,
  bandedResults,
  buildCommands,
  groupLabel,
  inGroup,
  noMatchHeading,
  runnable,
  searchedNote,
  type PaletteAgent,
  type PaletteCommand,
  type PaletteNavigation,
  type PaletteOpenRow,
} from '../lib/command-palette'
import { useOverlays } from '../lib/overlay-store'
import { readableError } from '../lib/session-record'
import { useModalDepth } from './OverlayHost.vue'

/**
 * ⌘K — **the palette that used to say "not wired yet"** (249).
 *
 * ## ⛔ Why the key is claimed in the CAPTURE phase, which is the whole design
 *
 * ⚠️ **Two window listeners already own keys this surface needs, and neither may be edited.**
 *
 *  - `RuntimeScreen.vue`'s `onKey` — the `event.key === 'k'` branch — answers ⌘K with
 *    `say('Command palette — not wired yet.')`. It is a
 *    bubble-phase `window` listener registered in `onMounted`. A palette that opened while that
 *    line still ran would put a real surface on screen **and** a toast denying it exists — `106`
 *    with both answers at once, which is worse than the stub it replaces.
 *  - `ConversationPane.vue`'s `onKey` answers Escape by ASKING THE TURN TO STOP (`737`: R43's
 *    words). It guards on the four overlays that pane can raise, because — its own words —
 *    *"interrupting the turn as well would
 *    make one key do two unrelated things at once"*. This palette is the first surface in the app
 *    that can be open **over** a live pane, and it is not in that list.
 *
 * ⛔ **So Escape here would close the palette AND ask a running turn to stop.** That is the defect, and it
 * is not hypothetical: `send-gate.dom.test.ts` and `frozen-interrupt.dom.test.ts` both drive that
 * exact binding.
 *
 * ⚑ **A capture-phase listener on `window` runs before every bubble-phase listener on `window`, by
 * the DOM's own ordering rather than by registration order** — so `stopImmediatePropagation()` here
 * is a deterministic claim, not a race against whichever component mounted first. The alternative
 * (register in a child's `onMounted`, which does run before the parent's) works today and would
 * break silently the day a component moved.
 *
 * ⛔ **The claim is narrow, and that is what makes it honest.** Exactly three chords are taken, and
 * only while this component owns them:
 *
 * | chord | when | what |
 * |---|---|---|
 * | ⌘/Ctrl+K | always | open, or close if open |
 * | Escape · ↑ · ↓ · Enter · Tab | only while OPEN | the palette's own contract |
 * | everything else | never | passes through untouched, including ⌘↵ and ⇧⌘↵ |
 *
 * ⚠️ **`223`'s send chords are deliberately NOT bound.** ⌘↵ sends and ⇧⌘↵ interrupts-and-sends
 * (`PromptComposer.vue:61-65, 753-761`); a palette that swallowed either would be `169`'s finding
 * upside down — one affordance gated and the others not. ⌘N is not bound either: `RuntimeScreen`
 * owns it, and a second binding for one action is `076`'s two-buttons-for-one-transition.
 *
 * ## ⚠️ What is left dead in a file this dispatch may not touch
 *
 * `onKey`'s `event.key === 'k'` branch and the `@command="say('Command palette — not wired yet.')"`
 * binding on `<SideRail>`, both in `RuntimeScreen.vue`, are now unreachable — the first because this
 * listener stops the event, the second because `SideRail` no longer emits `command`. Both are two
 * lines the PM deletes at merge; they are named in 249's response for exactly that.
 *
 * ⚠️ **Cited by CONTENT rather than by line**, deliberately: 249 was written against `52d5bc2`
 * (where they are `:822-825` and `:942`) and 248 has since moved both. A line number in a comment
 * that will be wrong the day it merges is the same class of thing as the stub it describes.
 */

const props = defineProps<{
  /**
   * `SideRail`'s own rows — ⚑ D-017b: the one list — handed in so the palette cannot label a
   * conversation twice.
   */
  conversations: readonly PaletteOpenRow[]
  /** Whether the rail's list reads have answered. `false` ≠ "there are none". */
  looked: boolean
  /**
   * What the list read said when it FAILED, or `null` — ⛔ a state `looked` cannot express: the
   * rail sets that flag only on success, so a read that threw would otherwise promise an answer
   * that is never coming.
   */
  listError: string | null
  activeId: string | null
  /**
   * ⛔ **What the conversation on screen's own agent will answer to** (279), or `null` when there is
   * no conversation on screen.
   *
   * ⚠️ **Handed in, not read here**, for the reason every other list on this component is: the rail
   * holds the session records and this palette holds none. A palette that reached into the store for
   * a transcript would be a second derivation of a fact the rail computes fourteen lines away, which
   * is `099` — and here it would also make this component the thing that decides which conversation
   * is "the" one, a question `RuntimeScreen` already owns.
   */
  agent: PaletteAgent | null
}>()

/**
 * ⛔ **Navigation leaves through the RAIL'S OWN events, not through a new mechanism** (`219`: *"Do
 * not invent a second mechanism"*).
 *
 * ⚑ Every one of these is a `SideRail` emit that `RuntimeScreen` already handles — `select`,
 * `newConversation`, `go`. That is the whole reason the
 * palette is mounted from the rail: the alternative was making `useSurface` a window singleton so a
 * detached component could write `place`/`activeId`, which is a second route to a surface change
 * that `095` spent a dispatch putting in one place.
 */
const emit = defineEmits<{ navigate: [action: PaletteNavigation] }>()

const overlays = useOverlays()
/**
 * ⛔ **Whether a modal dialog is up — counted by `OverlayHost` itself** (249, from this dispatch's
 * own review).
 *
 * ⚠️ **The first version asked the overlay STORE, and the store is not that fact.** It holds the
 * four overlays `RuntimeScreen` raises; the image viewer, the workflow-output reader and the
 * child-work reader are `ConversationPane`'s own local refs and never touch it, and `ReadingPane`
 * has two more. So ⌘K over a tool-result image answered *"no dialog"* and opened the palette inside
 * that host's Tab trap — the exact state the guard exists to prevent, on the three overlays the
 * docblock above cites by name.
 */
const modals = useModalDepth()

/**
 * Whether the panel is up.
 *
 * ⚠️ **`showing`, not `open`** — the prop above is *the open conversations*, and this app has one
 * noun per thing (`154`). Two `open`s in one component is a name collision `vue/no-dupe-keys` fails
 * the gate over, and it would have been a real ambiguity in every line below.
 */
const showing = ref(false)
const query = ref('')
/**
 * ⛔ **Why a chord this panel just swallowed did nothing** — or `null` (292 §4, from `288` M1).
 *
 * ⚠️ **A `ref` rather than a computed, because it is an ANSWER TO A GESTURE**, not a property of
 * the state: the same palette, the same query and the same rows are a perfectly ordinary place to
 * be until somebody presses ⌘↵ in it.
 */
const chordRefusal = ref<string | null>(null)
/**
 * ⛔ **Which row Enter would run — by its ID, not by its position.**
 *
 * ⚠️ **An index was the first version, and it was wrong on the ORDINARY startup path** (found in
 * this dispatch's own review). The rail's two closed-thread reads answer a moment after mount —
 * this panel has a whole sentence for that state — and they insert rows ABOVE the cursor. With an
 * index: ⌘K, ArrowDown to *Waiting on you*, the reads land, and the highlight is silently on
 * *Reopen &lt;some conversation&gt;* instead. Enter then launches a provider process for a
 * conversation the person never picked.
 *
 * ⚑ **The same event moves rows in and out on every conversation that ends** (`RuntimeScreen`
 * re-reads the closed list on every change to `store.open.length`), so this is not a boot-only
 * window. An id survives all of it: what was highlighted stays highlighted, or it genuinely left.
 */
const cursorId = ref<string | null>(null)
const box = ref<HTMLInputElement | null>(null)
/** The panel itself — what the Tab cycle and the scroll-into-view are scoped to. */
const panel = ref<HTMLElement | null>(null)
/** Who was focused when this opened, so it can be given back — `OverlayHost.vue:64,75`'s rule. */
let opener: HTMLElement | null = null

/**
 * Everything inside this panel a person can Tab to — `OverlayHost.vue:18-25`'s selector, and its
 * visibility filter with it: an element that is not laid out is not a stop on the cycle.
 */
function focusable(): HTMLElement[] {
  if (!panel.value) return []
  return [
    ...panel.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null || el === document.activeElement)
}

const commands = computed(() =>
  buildCommands({
    conversations: props.conversations,
    activeId: props.activeId,
    agent: props.agent,
  }),
)

/**
 * The bands that have rows, best band first. A band with none is not drawn (`118`).
 *
 * ⛔ **This is the ONE order** — see {@link bandedResults}. {@link shown} is its flattening, so what
 * the cursor walks and what the eye reads are the same list by construction; they cannot come to
 * disagree about which row Enter is about.
 */
const bands = computed(() => bandedResults(commands.value, query.value))

/**
 * ⛔ **The rows the CURSOR may land on — which is not every row drawn, since 279.**
 *
 * ⚠️ **`279` §3 rules running a provider command out of scope, so a palette that let Enter land on
 * one would be offering something it will not do.** Filtering here rather than at each keyboard
 * branch is `169` §1's rule: `move`, `current`, the Enter handler and the click all read this one
 * list, so there is no path by which one of them reaches a row the others cannot.
 *
 * ⚑ **This is why {@link bands} and this are no longer the same list**, and every place that used to
 * ask `shown.length` for *"is anything drawn"* now asks {@link drawn} instead — see there. Getting
 * that wrong would put the no-match state on screen underneath a band full of rows.
 */
const shown = computed(() => bands.value.flatMap((band) => band.rows).filter(runnable))

/**
 * ⛔ **Whether anything at all is on screen** — the question the list-vs-miss branch really asks.
 *
 * ⚠️ **It used to be `shown.length > 0`, and that was the same question until 279 split it.** A
 * query matching only the agent's own commands draws a full band and no runnable row; asking
 * `shown` there would render *"Nothing matches"* over 44 visible results, and Enter would take the
 * escape hatch out of a palette that had found exactly what was asked for.
 */
const drawn = computed(() => bands.value.some((band) => band.rows.length > 0))

/** The sentence under the agent's band — see {@link agentNote} for the four states it tells apart. */
const agentSays = computed(() => agentNote(props.agent))

/**
 * ⛔ **Counted off the rows that were BUILT, not off the list they came from** (found in `249`'s own
 * review): a count of what was handed in and a count of what was searched are two numbers, and the
 * sentence is about the second.
 */
const note = computed(() =>
  searchedNote({
    conversations: inGroup(commands.value, 'conversations').length,
    looked: props.looked,
    // ⚠️ Handed over unconditionally: WHEN a failure outranks a count is {@link searchedNote}'s
    // rule, not this component's.
    failed: props.listError,
  }),
)

/**
 * The row Enter runs, or `null` when nothing matched.
 *
 * ⚠️ **A row that LEFT falls back to the first one**, which is the only honest landing place: the
 * conversation that was highlighted is no longer offered, so there is nothing to keep pointing at.
 * What this can never do is point at a DIFFERENT row while the person was not looking — that was
 * the index's failure, and it is why {@link cursorId} is an id.
 */
const current = computed<PaletteCommand | null>(
  () => shown.value.find((row) => row.id === cursorId.value) ?? shown.value[0] ?? null,
)

/** Typing starts again from the top; the row set genuinely changed because they changed it. */
watch(query, () => {
  cursorId.value = null
  // ⚑ Typing is moving on. A refusal about a chord, still on screen three searches later, would be
  // the app answering a gesture nobody made.
  chordRefusal.value = null
})

/**
 * ⛔ **Every move of the cursor brings its row back onto the screen** (found in this dispatch's own
 * review, twice).
 *
 * ⚠️ **On `current`, not inside `move()`, and the difference is the second half of the defect.**
 * The first fix scrolled only for the arrows — so typing, which resets the cursor to the top while
 * `.palette-rows` keeps whatever `scrollTop` the arrows left it at, showed a screenful of rows with
 * **no highlight in view** and an Enter that ran something several hundred pixels above the fold.
 * `.palette-rows` is `overflow: auto` under a `66vh` cap, and a dozen conversations overflow it.
 *
 * `block: 'nearest'` so a row already visible does not jerk the list to centre it.
 */
watch(current, (row) => {
  if (!row) return
  void nextTick(() => {
    panel.value?.querySelector(`#${CSS.escape(row.id)}`)?.scrollIntoView({ block: 'nearest' })
  })
})

function show(): void {
  // ⛔ **One question at a time** (`overlay-store.ts`: *"two questions at once is how a person ends
  // up answering the wrong one"*). An overlay is a question the app has already asked; opening over
  // it would put this panel inside `OverlayHost`'s Tab trap, which pulls focus back into the sheet
  // behind. Said out loud rather than silently ignored — a key that does nothing and explains
  // nothing is the control this dispatch is removing.
  if (modals.value > 0) {
    // ⚠️ **"Close", not "answer"** (found in this dispatch's own review). An overlay can be a
    // READER rather than a question, so *"answer"* would name a gesture it does not have, and
    // *"the palette opens over a conversation"* would be said on pages where no conversation is
    // drawn. `239`'s rule is that a refusal names a remedy that is on screen: closing is, on every
    // one of them (the ✕, Escape, or the backdrop).
    overlays.notify(
      `Close what is open first — ${chordSaid(platformHere(), 'K')} opens over the app, not over a panel.`,
    )
    return
  }
  opener = document.activeElement as HTMLElement | null
  query.value = ''
  cursorId.value = null
  showing.value = true
  void nextTick(() => box.value?.focus())
}

function hide(): void {
  if (!showing.value) return
  showing.value = false
  // The refusal named Esc as the way out; having taken it, there is nothing left to refuse.
  chordRefusal.value = null
  // Back where it came from: a person who opened this with ⌘K has to land somewhere real.
  opener?.focus?.()
  opener = null
}

function move(by: number): void {
  const rows = shown.value
  if (rows.length === 0) return
  const at = rows.findIndex((row) => row.id === current.value?.id)
  // Wraps, because a list you can walk off the end of makes you press the other arrow to get back.
  cursorId.value = rows[(Math.max(0, at) + by + rows.length) % rows.length]!.id
}

/**
 * Run a row and get out of the way.
 *
 * ⛔ **Closed BEFORE the action, deliberately.** Every navigation here changes the surface behind
 * this panel; leaving it up over the conversation it just opened would be the modal that outlives
 * its own answer. The one asynchronous action — export — reports through a toast, which is a
 * surface that survives this component going away (`ToastStack` is mounted by `RuntimeScreen`).
 */
function run(command: PaletteCommand): void {
  // ⛔ **A row this palette can only SHOW does nothing here either** (279 §3). The cursor already
  // cannot reach one — `shown` filters on the same {@link runnable} — so this is the CLICK half of
  // the same rule, in the same predicate. Two answers to *"may this row act"* is how one gesture
  // ends up doing what the other refuses, which is `169`'s finding and `219`'s.
  //
  // ⚠️ **It does not `hide()` first.** Clicking a listed row is not a way out of the palette: a
  // person reading the agent's commands who brushes one must not have the panel close under them,
  // taking the list with it.
  if (!runnable(command)) return
  hide()
  if (command.action.kind === 'export') {
    void runExport(command.action.sessionId, command.action.exportKind)
    return
  }
  emit('navigate', command.action)
}

/**
 * ⚠️ **The host's own sentence, both ways.** `ExportedSession.note` exists so that *"exported"*
 * never has to be read as *"restored"*, and the failure — *"Claude's file for this conversation is
 * gone, so there is nothing to export."* — is this app's prose. Neither is re-phrased here; `118`'s
 * rule is one explanation everywhere, and the surface that owns the verb owns the words.
 *
 * ⛔ **Through {@link readableError}, and the first version was not** (found in this dispatch's own
 * review). `exportSession` is an `ipcMain.handle`, so every main-side throw reaches the renderer
 * wrapped: `Error invoking remote method 'runtime:command': Error: <message>`. Raw, that puts
 * `EACCES: permission denied, mkdir '/…'` on a person's screen for a full disk — a library talking,
 * which `221` §3 spent a dispatch removing from one surface and which this would have added back on
 * another. The stripper already exists and already has two callers in the store; this is the third.
 */
async function runExport(sessionId: string, exportKind: 'native' | 'bundle'): Promise<void> {
  try {
    const written = await window.api.runtime.exportSession({ sessionId, exportKind })
    overlays.notify(`${written.path} — ${written.note}`)
  } catch (cause) {
    overlays.notify(`Nothing was exported: ${readableError(cause)}`)
  }
}

/**
 * The way out of a search miss.
 *
 * ⚑ **The same {@link NO_MATCH_ESCAPE} the rule module declares**, rather than an object written a
 * second time in the template: the sentence in {@link NO_MATCH_BODY} names *All conversations*, and
 * a button that went somewhere else would be the copy and the control disagreeing.
 */
function escapeToLibrary(): void {
  hide()
  emit('navigate', NO_MATCH_ESCAPE)
}

/** A click that STARTED on the backdrop — `OverlayHost.vue:55-58`'s rule, and for its reason. */
function onBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) hide()
}

/**
 * The key claim. See this component's docblock for why it is `capture` and why it is this narrow.
 *
 * ⚠️ **`stopImmediatePropagation` is called for every chord this owns, INCLUDING the ones that do
 * nothing visible** — the ⌘K that only reports a dialog is in the way, and the Tab that is
 * swallowed. A chord half-claimed is the split-gesture defect `169`/`219`/`221` each spent a
 * dispatch on: `RuntimeScreen`'s stub would answer the half this let through.
 */
function onKey(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (showing.value) hide()
    else show()
    return
  }
  if (!showing.value) return

  // ⚠️ **⌘N gets out of the way rather than being taken.** `RuntimeScreen` owns it and this palette
  // offers the same destination as a row; binding it here would be two paths to one transition
  // (`076`). Closing without preventing leaves ⌘N doing exactly what it does everywhere else, and
  // stops it changing the surface UNDERNEATH an open modal — 094's finding, in miniature.
  if ((event.metaKey || event.ctrlKey) && (event.key === 'n' || event.key === 'N')) {
    hide()
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    hide()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopImmediatePropagation()
    move(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Enter') {
    if (event.isComposing) return
    // ⚠️ **⌘↵ and ⇧⌘↵ are NOT this panel's** (`223`). They mean send/queue and interrupt-and-send
    // in the composer; a palette that ran a row on them would answer a gesture aimed at a surface
    // it is covering. Plain Enter is the palette's.
    //
    // ⛔ **…and this used to `return` and let them "pass through", which is not a thing that can
    // happen** (292 §4, from `288` M1). The send handler is on the composer's textarea; an event
    // dispatched at this palette's input bubbles upward and to `window`, never sideways into a
    // sibling. So the chord was a silent no-op. ⚑ It is claimed and REFUSED now — see
    // {@link SEND_CHORD_REFUSED} for why refusing beats wiring — and claimed the way every other
    // chord this panel owns is claimed, so nothing underneath answers the half this let through.
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      event.stopImmediatePropagation()
      chordRefusal.value = SEND_CHORD_REFUSED
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (current.value) run(current.value)
    // ⛔ **On a miss, Enter takes the ONE thing the miss offers** (found in this dispatch's own
    // review). It is not "run whatever was selected before" — there is no row, and `current` is
    // null — it is the escape hatch the sentence above the button has just named. A palette whose
    // only offered action could not be reached by the key everything else in it uses would be
    // `169`'s finding exactly: the button acts and the chord does not.
    //
    // ⛔ **`!drawn`, not `shown.length === 0`, since 279.** They were the same question until the
    // agent's band arrived, and they part on the query that matches only a provider command: there
    // is nothing to run, the button is not on screen, and firing the escape hatch would navigate
    // away from a palette that had just found what was asked for. Enter does nothing there, which
    // is the honest answer to a key pressed over rows that are not actions.
    else if (!drawn.value) escapeToLibrary()
    return
  }
  if (event.key === 'Tab') {
    /**
     * ⛔ **A real cycle, not "put focus back in the box"** (found in this dispatch's own review).
     *
     * ⚠️ **The panel is not always single-focusable.** In the no-match state it also renders *Open
     * All conversations* — a `<button>`, and the only action on screen. The first version of this
     * refocused the input unconditionally, which made that button unreachable to a keyboard-only
     * user while a mouse could press it: `106`'s control-that-cannot-act, restricted to the people
     * least able to work around it.
     *
     * Same shape as `OverlayHost.vue:34-52`, and deliberately so — this panel does not use
     * `OverlayHost` (it teleports past the rail's stacking context and claims its own keys), so the
     * trap it does not inherit has to be written rather than assumed.
     */
    event.preventDefault()
    event.stopImmediatePropagation()
    const items = focusable()
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    // ⚠️ **`at === -1` is its own case, not "the first item"** (found in this dispatch's own
    // review). Clicking the explanatory paragraph on a miss blurs the box and leaves focus on
    // `<body>`; treating that as index 0 sent the next Tab PAST the search box to the button,
    // skipping the field the person had just been typing in. `OverlayHost.vue:46-51` handles the
    // same case explicitly and this now does too: from outside, Tab lands on the first and
    // Shift+Tab on the last.
    if (at === -1) {
      ;(event.shiftKey ? items[items.length - 1] : items[0])?.focus()
      return
    }
    const step = event.shiftKey ? -1 : 1
    items[(at + step + items.length) % items.length]?.focus()
  }
}

/**
 * ⛔ **`onMounted`, not the body of `setup` — and that difference turned `main` RED** (251 §0).
 *
 * ⚠️ **The `desktop` vitest project is SSR: there is no `window` while `setup` runs.** This line
 * used to sit at the top level, which was invisible for exactly as long as nothing server-rendered
 * this component — and then `249` mounted the palette inside `SideRail`, so every SSR test that
 * renders the rail imports it, and `250`'s `idle-truth.render.test.ts` was the first one to. Seven
 * tests died on `ReferenceError: window is not defined` with the failure pointing here and the
 * dispatch pointing at the rail.
 *
 * ⚑ **The capture phase survives the move**, which is the whole reason the comment above exists:
 * capture listeners run before bubble listeners on the same target no matter what order they were
 * registered in, so `RuntimeScreen`'s ⌘K stub is still answered by this panel and not by a toast.
 * And nothing can press a key between `setup` and `mounted` — the two run in the same tick.
 *
 * ⛔ **`ConversationPane.vue:699`, `RuntimeScreen.vue:843` and `OverlayHost.vue:100` are all this
 * shape**, and this was the one that was not.
 */
onMounted(() => window.addEventListener('keydown', onKey, { capture: true }))
onUnmounted(() => window.removeEventListener('keydown', onKey, { capture: true }))

defineExpose({
  /**
   * The rail's ⌘K button presses this — one path to opening, whichever gesture asked.
   *
   * ⚠️ **`isOpen` was here too and is gone** (found in this dispatch's own review). Nothing called
   * it, which makes it `217` §9 (c)'s dead prop one layer up — the exact shape this dispatch's own
   * census asserts against for the rail's retired `command` emit. Shipping one while removing the
   * other would have been the rule applied to somebody else's code and not to mine.
   */
  toggle: (): void => (showing.value ? hide() : show()),
})
</script>

<template>
  <Teleport to="body">
    <!-- ⚠️ **Teleported, unlike every other overlay in this app, and the reason is where it is
         mounted from.** `OverlayHost` is a child of `RuntimeScreen` and needs no escape; this panel
         is a child of the 264px left rail, which has its own stacking and its own `overflow: auto`.
         Rendered in place it would be clipped by the rail. `body` also puts it outside every
         `data-chat-theme` scope — which until 346 was the whole reason it was dark chrome.

         Put the light scope on this scrim because the palette teleports to `body` and does not inherit `OverlayHost`'s scope. -->
    <div
      v-if="showing"
      class="palette-scrim"
      data-cy="palette-scrim"
      data-chat-theme="light"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      @mousedown="onBackdrop"
    >
      <div ref="panel" class="palette" data-cy="palette-panel">
        <!-- ⚠️ **`aria-expanded` and `aria-controls` are CONDITIONAL, because in the no-match state
             there is no list.** `aria-expanded="true"` beside an `aria-controls` naming an element
             that is not in the document is a claim a screen reader acts on and cannot check — the
             same class of thing as a visible control that does nothing, one layer down in the prose
             this app speaks to assistive tech (`106`; `223`'s *"naming a gesture a mount has
             switched off is 106 one layer down"*). -->
        <div class="palette-box">
          <svg class="icon"><use href="#i-terminal" /></svg>
          <input
            ref="box"
            v-model="query"
            class="palette-input"
            type="text"
            data-cy="palette-search"
            role="combobox"
            aria-label="Search conversations and destinations"
            :aria-expanded="drawn"
            :aria-controls="drawn ? 'palette-rows' : undefined"
            :aria-activedescendant="current ? current.id : undefined"
            placeholder="Jump to a conversation, or go somewhere…"
            autocomplete="off"
            spellcheck="false"
          />
          <span class="palette-chord">esc</span>
        </div>

        <ul
          v-if="drawn"
          id="palette-rows"
          class="palette-rows"
          data-cy="palette-rows-scroll"
          role="listbox"
        >
          <template v-for="band in bands" :key="band.group">
            <!-- ⚠️ **The agent's band names its provider** (279 §2's *"visibly distinguishable"*) —
                 see `groupLabel`, which prints the name it was handed rather than deciding one. -->
            <li class="palette-band" role="presentation" :data-cy="`palette-band-${band.group}`">
              {{ groupLabel(band.group, props.agent) }}
            </li>
            <li
              v-for="row in band.rows"
              :id="row.id"
              :key="row.id"
              class="palette-row"
              :class="{ current: current?.id === row.id, listed: !runnable(row) }"
              :role="runnable(row) ? 'option' : 'presentation'"
              :aria-selected="runnable(row) ? current?.id === row.id : undefined"
              :data-cy="`palette-row-${row.id}`"
              :data-current="current?.id === row.id"
              :data-listed="!runnable(row)"
              :title="row.group === 'agent' ? (row.detail ?? undefined) : undefined"
              @mousedown.prevent="run(row)"
            >
              <strong>{{ row.title }}</strong>
              <!-- Absent, not blank, when there is nothing true to say (`211` §3).
                   ⚠️ **A hover on the AGENT's rows only, and the bound above is the reason**
                   (279, from this dispatch's own review). `MAX_COMMAND_TEXT` is 500 because the live
                   catalogue's descriptions run to 1 135 characters and cutting at 200 loses the half
                   of `/code-review` that names `--fix` — but this line is clipped to one line, so
                   without a hover those extra characters would be carried across the wire and shown
                   to nobody. ⛔ Not on BroBot's own rows: their details are short strings this app
                   wrote, and a tooltip on every row of every band is a change to a surface `249`
                   settled rather than a consequence of this one. -->
              <small v-if="row.detail">{{ row.detail }}</small>
            </li>
          </template>
        </ul>

        <!-- ⛔ **A search miss, and the way out of it stated in the miss itself** (`239`). It is NOT
             the empty state and never can be: `buildCommands` always returns every destination,
             so an empty list here means one thing only — what was typed matched nothing. ⚠️ **It
             said *the three destinations* until `566` made it four and `570` five**, which is a
             count in prose doing the work of a list (`a-title-that-names-a-count-the-assertion-
             never-checks`); `command-palette.test.ts` holds the roster and this says the rule. That is
             `104`'s "first-run distinct from no-match", settled by construction rather than by a
             branch that could get the two the wrong way round. -->
        <div v-else class="palette-miss" data-cy="palette-no-match">
          <strong>{{ noMatchHeading(query) }}</strong>
          <p>{{ NO_MATCH_BODY }}</p>
          <button
            type="button"
            class="palette-escape"
            data-cy="palette-open-library"
            @click="escapeToLibrary()"
          >
            Open All conversations
          </button>
        </div>

        <!-- ⛔ **What the agent on screen answers to, and what this palette will not do with it**
             (279 §2, §3).

             ⚠️ **Here rather than under the band, and the reason is the state the band does not
             have.** §2 asks that a session with no commands *"say so"* rather than show an empty
             section — and when there is nothing to list there is no band to hang a line under. One
             home for the sentence covers all four states (see `agentNote`); a copy inside the
             `v-for` would have covered only the one where it is least needed. -->
        <p v-if="agentSays" class="palette-foot agent" data-cy="palette-agent-note">
          {{ agentSays }}
        </p>

        <!-- ⛔ **A send chord pressed in here is REFUSED out loud** (292 §4, from `288` M1). It used
             to return so the chord could "pass through" to the composer, and a keyboard event
             dispatched at this panel's input cannot reach a sibling control — so it did nothing at
             all, silently, on a chord the composer's own hint advertises. ⚑ `alert`, unlike the
             foot below it: this answers something the person just did. -->
        <p v-if="chordRefusal" class="palette-refused" role="alert" data-cy="palette-chord-refused">
          {{ chordRefusal }}
        </p>

        <!-- ⛔ **What this palette actually looked at.** The sentence `249` §2 asks for, and the
             difference between a search and a claim about one. -->
        <p class="palette-foot" data-cy="palette-searched">{{ note }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Above `OverlayHost` (50) and below `ToastStack` (100): an export's receipt has to be readable
   over this panel, and a modal that opens WHILE this one is up must not end up behind it. ⚠️ The
   first version of this comment said the two "never coexist by construction", which `show`'s guard
   makes true only at the moment of opening — an overlay raised afterwards is a state neither of
   them prevents, and the z-index is what keeps it survivable. */
.palette-scrim {
  position: fixed;
  z-index: 60;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  backdrop-filter: blur(3px);
  background: var(--overlay-backdrop);
  /* The ink, for the reason written on `OverlayHost`'s backdrop (346): `color` inherits as a
     resolved colour, so a scope that does not re-ask for it hands the chrome's near-white down. */
  color: var(--text);
  inset: 0;
}

/* The panel shell the overlays in this app use, narrower: a palette is read top-to-bottom in one
   column, not laid out. */
.palette {
  display: flex;
  width: min(640px, 92vw);
  max-height: 66vh;
  flex-direction: column;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.palette-box {
  display: flex;
  min-height: 48px;
  align-items: center;
  padding: 0 var(--space-6);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-5);
}

.palette-box .icon {
  width: 15px;
  height: 15px;
  color: var(--faint);
}

.palette-input {
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: var(--type-reading);
}

.palette-input::placeholder {
  color: var(--placeholder);
}

/* The way out, where the eye already is — same register as the composer's own chord hints. */
.palette-chord {
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  color: var(--faint);
  font-size: var(--type-caption);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.palette-rows {
  min-height: 0;
  padding: var(--space-4);
  margin: 0;
  list-style: none;
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.palette-band {
  padding: var(--space-5) var(--space-4) var(--space-2);
  color: var(--faint);
  font-size: var(--type-caption);
  font-weight: var(--fw-section);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
}

.palette-row {
  padding: var(--space-4);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-md);
  color: var(--muted);
  cursor: default;
}

/* ⛔ Hover and cursor paint the SAME way, because a palette has two pointers — the mouse and the
   arrow keys — and a row that looked different depending on which one reached it would be telling
   a person that Enter does something other than what the highlight says. */
.palette-row:hover,
.palette-row.current {
  border-color: var(--accent-border-weak);
  background: var(--accent-fill);
  color: var(--text);
}

/* ⛔ **A row this palette can only SHOW does not light up** (279 §3), and that is the third thing
   the rule above is about: the highlight means *Enter runs this*, so a row Enter cannot reach must
   never wear it. The hover is cancelled rather than merely unstyled — a `:hover` inherited from the
   selector above would put the accent fill under a mouse on a row that does nothing.

   ⚠️ **The name is `.listed`, and the monospace is the rest of §2's "visibly distinguishable".** A
   provider command is a string you TYPE; drawing it in the same face as a conversation title would
   make two different kinds of thing look like one, which is what the dispatch says teaches the wrong
   model of the app. */
.palette-row.listed:hover {
  border-color: transparent;
  background: transparent;
  color: var(--muted);
}

.palette-row.listed strong {
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-weight: var(--fw-medium);
}

.palette-row strong {
  display: block;
  overflow: hidden;
  color: inherit;
  font-size: var(--type-body);
  font-weight: var(--fw-medium);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-row small {
  display: block;
  overflow: hidden;
  margin-top: var(--space-1);
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-miss {
  padding: var(--space-9);
  text-align: center;
}

.palette-miss strong {
  display: block;
  color: var(--text-soft);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
}

.palette-miss p {
  margin: var(--space-4) auto 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-snug);
  max-width: 44ch;
}

.palette-escape {
  min-height: 28px;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  margin-top: var(--space-6);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
}

.palette-escape:hover {
  background: var(--wash-5);
  color: var(--text);
}

.palette-foot {
  padding: var(--space-4) var(--space-6);
  border-top: var(--border-width) solid var(--line);
  margin: 0;
  background: var(--composer-bg);
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-snug);
}

/* The agent's sentence sits above the search sentence and reads a shade louder: it is the one line
   that says what this band is and what it is not (279 §3), and it is easy to skim past. */
.palette-foot.agent {
  color: var(--text-soft);
}

/* ⛔ **A refusal, not a hint** (292 §4). It sits in the same strip as the foot and reads in the
   ordinary text colour rather than `--faint`: the foot describes what was searched and may be
   skimmed past, this answers a key somebody just pressed. ⚑ No new token: `--danger-text` is what
   `PromptComposer`'s `.attach-refused` already uses for exactly this sentence shape — a gesture
   that did not happen, and why. */
.palette-refused {
  padding: var(--space-4) var(--space-6);
  border-top: var(--border-width) solid var(--line);
  margin: 0;
  background: var(--composer-bg);
  color: var(--danger-text);
  font-size: var(--type-caption);
  line-height: var(--leading-snug);
}
</style>
