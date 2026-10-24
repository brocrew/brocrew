<script lang="ts">
import { computed, provide, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'

/**
 * How many overlay hosts are on screen right now — see the `onMounted` below for why this is a
 * count, why it lives here rather than in `overlay-store.ts`, and what asked for it.
 */
const mounted = ref(0)

/**
 * The hosts on screen, in the order they opened. Two can be up at once, because several components
 * raise their own, and only the one on top may answer Escape and Tab: otherwise one Escape closes
 * every layer and the covered host's trap fights the top one for focus.
 */
const layers: HTMLElement[] = []

/**
 * Whether `element` is the host on top. A later host is above an earlier one, and a host is always
 * above the host it sits inside, whichever of the two finished mounting first.
 */
/**
 * The one layer every open host is drawn into, at the end of the screen's own root: a host opened
 * later is appended later, so the host drawn on top is the one {@link onTop} gives the keys to, at
 * any count, reopened or opened from inside another host. A surface that provides none (a test
 * mounting one component) draws its hosts where they stand.
 */
const OVERLAY_LAYER: InjectionKey<Ref<HTMLElement | null>> = Symbol('overlay layer')

export function provideOverlayLayer(layer: Ref<HTMLElement | null>): void {
  provide(OVERLAY_LAYER, layer)
}

function onTop(element: HTMLElement): boolean {
  return layers.every(
    (other) =>
      other === element ||
      (!element.contains(other) &&
        (other.contains(element) || layers.indexOf(other) < layers.indexOf(element))),
  )
}

/** ⛔ Whether ANY modal dialog is up — every one in this app is an `OverlayHost` (249). */
export function useModalDepth(): ComputedRef<number> {
  return computed(() => mounted.value)
}
</script>

<script setup lang="ts">
import { inject, nextTick, onMounted, onUnmounted, ref as aRef, watch } from 'vue'
import { usePersonsQueue } from '../lib/persons-queue'
import PersonsQueue from './PersonsQueue.vue'
import SpawnStopLane from './SpawnStopLane.vue'

/**
 * The layer an overlay opens on: a dimmed, blurred backdrop with exactly one thing on it.
 *
 * This chrome is REAL — Esc closes, a click on the backdrop closes, the ✕ closes, focus is trapped
 * inside while it is open and given back to whatever opened it. That matters even though the
 * overlays' own confirmations are not wired: a modal you cannot leave is broken in a way a person
 * feels immediately, and "the placeholder trapped me" is not a defensible sentence.
 */
const emit = defineEmits<{ close: [] }>()

/**
 * What a screen reader calls this dialog: the words of the panel's own title. Required, so a new
 * mount site without a name is a type error.
 */
const props = defineProps<{ label: string }>()

/**
 * 🔴 **The summons's announcement channel INSIDE the layer that declares everything else inert**
 * (401).
 *
 * ⛔ **`aria-modal="true"` on this host tells assistive technology to ignore the rest of the
 * document.** The shell's own region is outside it, so while any sheet is open a screen-reader
 * user would be told nothing at all — in exactly the state the summons is hosted here for.
 *
 * ⚑ **Unconditional, and not inside the queue's `v-if`.** A live region inserted into the tree
 * already carrying its text is not reliably announced; it has to be present and CHANGE.
 */
const persons = usePersonsQueue()

const panel = ref<HTMLElement | null>(null)
/** The layer this host is drawn into, or `null` to draw it where it stands. */
const layerElement = inject(OVERLAY_LAYER, aRef<HTMLElement | null>(null))

/**
 * Whether this host takes Escape and Tab. In a layer it is read off the layer itself: the last
 * open host in it is the one drawn on top, so it is the one that owns the keys, whatever order the
 * hosts mounted in. A host drawn where it stands falls back to the order hosts opened in.
 */
function ownsTheKeys(element: HTMLElement): boolean {
  const layer = layerElement.value
  if (layer !== null && element.parentElement === layer) {
    const open = [...layer.children].filter((one) => one.classList.contains('overlay-host'))
    return open[open.length - 1] === element
  }
  return onTop(element)
}
/** Who was focused when this opened, so it can be given back. */
let opener: HTMLElement | null = null
/** This host's element in `layers`, kept past unmount so it can be taken out again. */
let layer: HTMLElement | null = null

// A `<details>` element's own summary is a native tab stop; any other summary is not.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary:first-of-type:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'

/** The tab stops a person can reach: laid out, not hidden, and not inside an `inert` subtree. */
function focusable(): HTMLElement[] {
  if (!panel.value) return []
  return [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      el === document.activeElement ||
      (el.offsetParent !== null &&
        getComputedStyle(el).visibility !== 'hidden' &&
        el.closest('[inert]') === null),
  )
}

function onKey(event: KeyboardEvent): void {
  // A covered host leaves the keys to the one on top.
  if (!panel.value || !ownsTheKeys(panel.value)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return

  // The trap. Without it, Tab walks out of the overlay and into the surface behind it — which is
  // dimmed, unreachable by mouse, and still perfectly focusable.
  const items = focusable()
  if (items.length === 0) {
    event.preventDefault()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (!event.shiftKey && (active === last || !panel.value?.contains(active))) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  }
}

/** A click that STARTED on the backdrop — not a drag that ended there from inside the panel. */
function onBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close')
}

watch(
  panel,
  async (element) => {
    if (!element) return
    opener = document.activeElement as HTMLElement | null
    await nextTick()
    ;(focusable()[0] ?? element).focus()
  },
  { immediate: true },
)

/**
 * ⛔ **This host counts itself, so anything else can ask whether a modal is up** (249).
 *
 * ⚠️ **The overlay STORE is not that fact, and assuming it was is a real defect this caught.**
 * `overlay-store.ts` holds the overlays `RuntimeScreen` raises; the four `ConversationPane` raises —
 * the image viewer, the workflow output, the tools sheet and the child-work reader — are local refs
 * and never touch it, and `ReadingPane` has two more. A command palette that asked the store *"is a
 * dialog open"* would answer **no** while an `aria-modal` dialog with a Tab trap was on screen, and
 * open on top of it.
 *
 * ⚠️ **`three` was `four` and the line numbers it cited were gone** (390) — `SessionTools` joined
 * them at `358`. ⛔ **The count is asserted now rather than written down**:
 * `a-stop-a-modal-cannot-cover.dom.test.ts` §3 walks the components for `<OverlayHost` and refuses
 * a mount site its census has never opened, which is what stops the next one drifting.
 *
 * ⚑ **Counted rather than a boolean**, because two hosts really can be mounted at once —
 * `ReadingPane` raises its own while `RuntimeScreen`'s is up — and a boolean set by the second and
 * cleared by the first would report "clear" with one still on screen.
 */
/**
 * ⚠️ **The listener moved in here, and it was the SECOND component with `249`'s latent shape**
 * (251 §0). It used to be a bare `window.addEventListener` in the body of `setup`, which no SSR
 * test had ever reached — every `OverlayHost` in the app is behind a `v-if` that is false until
 * something is actually open, so the constraint was satisfied by accident rather than by design.
 * That is exactly how `CommandPalette` survived until `249` mounted it unconditionally in the rail.
 * Registered here, the first `.render.test.ts` that opens an overlay finds a component instead of a
 * `ReferenceError`. The `onUnmounted` below is its pair, and now both ends run in the same phase.
 */
onMounted(() => {
  window.addEventListener('keydown', onKey)
  mounted.value += 1
  layer = panel.value
  if (layer) layers.push(layer)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  mounted.value = Math.max(0, mounted.value - 1)
  // `layer` rather than `panel`: the template ref is already cleared by the time this runs.
  const at = layer ? layers.indexOf(layer) : -1
  if (at >= 0) layers.splice(at, 1)
  // Back where it came from: a person who opened this with the keyboard has to land somewhere real.
  opener?.focus?.()
})
</script>

<template>
  <!-- The mousedown, not the click: a drag that starts inside the panel and ends on the backdrop
       is not a click-out, and closing on it loses whatever was being selected.

       Put `data-chat-theme="light"` on the host so every hosted sheet inherits it. This also keeps backdrop dimming in one place instead of repeating it across panels.

       ⚠️ **It is a no-op on SIX of this app's seven mount sites and that is the point.** Counted
       rather than recalled: `ConversationPane` raises four of these and `ReadingPane` two, both
       INSIDE a surface that has carried this attribute since 344 — so the image viewer, the
       workflow output, the tools sheet and the child-work reader have been opening on paper for a
       whole dispatch already. The seventh is `RuntimeScreen`'s, and its sheets were the whole of
       what was still on near-black. (⚠️ **It said five of six until `390`**, which is one mount
       site `358` added and nobody came back for.) Re-declaring the same values on a nested carrier changes
       nothing (custom properties resolve to the nearest declaration, and both declarations are this
       one), and it makes the host self-sufficient wherever it is mounted next. -->
  <Teleport :to="layerElement" :disabled="layerElement === null">
    <div
      ref="panel"
      class="overlay-host"
      data-cy="overlay-host"
      data-chat-theme="light"
      role="dialog"
      aria-modal="true"
      :aria-label="props.label"
      tabindex="-1"
      @mousedown="onBackdrop"
    >
      <slot />

      <!-- 🔴 **The emergency stop, on the layer that covers the rail** (390, from `388` §3).

           ⛔ **Here rather than in eleven panel headers.** `388` measured it: this layer is `inset: 0`
           and traps focus, so `SideRail`'s anchored `rail-spawning` could not be clicked or tabbed to
           while any modal was open — and `385 §3`'s anchoring, which is real, only ever proved the
           control survives SCROLLING. ⚑ **Hosted once, an overlay added tomorrow carries the stop
           because it was hosted**, which is HO-013 §3 applied to a safety control: *"a rule that must
           be remembered each time is a rule that will eventually be forgotten."*

           ⚠️ **AFTER the slot, and that is the whole of "it must not break the focus trap."** The
           watch above focuses the first focusable inside this host when it opens; drawn first, the
           stop would take that focus on every sheet in the app. Drawn last it is inside the trap like
           everything else — one Shift+Tab from wherever a dialog opens, and Tab wraps at the ends
           rather than walking out. Not one line of `onKey` moved. -->
      <!-- ⚠️ **The shell's region cannot be heard from in here** — see the setup above. This one
           can, and with two hosts mounted only the innermost is the active dialog, so the pair
           cannot double up. -->
      <div class="only-for-a-reader" role="status" data-cy="overlay-queue-announcement">
        {{ persons.view.value?.announcement ?? '' }}
      </div>

      <div class="overlay-corner">
        <!-- 🔴 **The queue that ends at a person, on the layer that covers everything else** (401,
             criterion 11).

             ⛔ **Here for the stop's reason, one subject over.** A question is exactly what a person
             opens a sheet to answer, so a queue reachable only with everything closed is `390` with
             the subject changed — and hosted once, an overlay added tomorrow carries the summons
             because it was hosted rather than because somebody remembered.

             ⚠️ **BEFORE the stop in the DOM, and that is the whole of "it does not move the
             emergency control."** The trap wraps at the ends and the stop is the LAST focusable in
             this host, which is what makes it one Shift+Tab from wherever a dialog opens. Drawn
             after it, this would take that keystroke whenever anything was waiting — that is, at
             exactly the moment somebody is most likely to want the stop. ⚑ Still after the
             `<slot>`, so it cannot take the opening focus either. -->
        <PersonsQueue floating @leave="emit('close')" />
        <SpawnStopLane />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* The host IS the backdrop and the layout box: an overlay child centres itself here, and a drawer
   pushes itself flush right with `margin-left: auto`. */
/* 🔴 **ONE band, and the overlay layer reserves exactly one** (401).
 *
 * ⛔ **Out of flow, for the reason `SpawnStopLane` used to carry on its own rule**: `.overlay-host`
 * is `display: flex` with the panel centred in it, and a second IN-FLOW child would make the panel
 * one of two flex items and move every sheet in the app sideways. Absolute leaves the host with
 * exactly one thing to lay out, which is what it had before either card existed.
 *
 * ⛔ **A column rather than two corners, and `401` learned that from a drawer.** The first shape
 * mirrored the stop into the bottom RIGHT — clear of it at every width by arithmetic — and the
 * right-hand drawer of the time was `width: min(640px, 56vw); height: 100%; margin-left: auto`, so
 * the mirrored card sat inside the drawer's own footer and took its one door. ⚑ A right-hand panel
 * is the shape this app's overlays take. Stacked here, the layer occupies ONE band — the same
 * `10px`–`210px` the app has reserved since `390` and that `392`'s sheet already keeps a gutter
 * for — and two cards can never overlap each other, because one box lays them both out.
 *
 * ⚠️ **`z-index: 2`, which is the number both cards used to carry and for the same panel.** A
 * sheet's `position: sticky` header at `z-index: 1`, as a sticky descendant of a non-positioned
 * panel, paints in the HOST's stacking context — at the same level
 * this would be. Above it by a number rather than by DOM order, which is a rule about markup a
 * later edit can quietly break.
 *
 * ⚑ **Bounded, and it grows upward.** The stop is last so it keeps the bottom corner a hand goes
 * to; the summons stacks above it and its own list scrolls, so a person with nine questions cannot
 * push the emergency control off the screen.
 */
/* ⛔ **Off-screen without being hidden.** `display: none` and `visibility: hidden` take an element
   out of the accessibility tree, which would make the region above announce nothing at all; the
   clip-rect pattern leaves it in the tree and out of the picture. ⚠️ `white-space: nowrap` so a
   sentence cannot wrap into a 1px box and be laid out at a height a reader's cursor lands in.
   ⚑ Declared here as well as in `RuntimeScreen` because both style blocks are scoped — a class is
   not a shared utility in this app, and pretending otherwise is how one of the two silently
   becomes a visible 1px box. */
.only-for-a-reader {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip-path: inset(50%);
  white-space: nowrap;
}

.overlay-corner {
  position: absolute;
  z-index: 2;
  bottom: var(--space-6);
  left: var(--space-5);
  display: flex;
  width: var(--lane-w);
  max-height: calc(100% - 2 * var(--space-6));
  flex-direction: column;
  gap: var(--space-4);
}

.overlay-host {
  position: fixed;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(3px);
  background: var(--overlay-backdrop);
  /* 🔴 **The ink, and it is load-bearing** (346, and it is 091's defect wearing an inherited
     property). `color` INHERITS as a resolved colour, not as the `var()` that produced it: `body`
     resolves `var(--text)` outside every scope and hands `#e7ecf3` — a near-white tuned for
     near-black — down into everything, including this host. Measured before this line existed:
     every one of the five sheets and the palette computed `rgb(231, 236, 243)` on its own root.
     Nothing was invisible only because every text element inside them happens to declare a colour
     of its own; one line of new markup in any sheet would have been white on white. Re-resolved
     HERE, inside the scope, it is `--paper-ink`. ⚠️ In dark it resolves to the value it was already
     inheriting, so this changes nothing outside a light scope. */
  color: var(--text);
  inset: 0;
  outline: none;
}
</style>
