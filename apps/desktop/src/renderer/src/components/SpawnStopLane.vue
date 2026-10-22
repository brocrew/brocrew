<script setup lang="ts">
import { useSpawnSafety } from '../lib/spawn-safety'

/**
 * 🔴 **The emergency stop, on the layer that covers the rail** (390, from `388` §3).
 *
 * ⛔ **Mounted by `OverlayHost` and by nothing else.** Every modal in this app is an `OverlayHost`
 * — a fixed `inset: 0` `aria-modal` layer with a focus trap, which deliberately covers the rail —
 * so hosting the lane there is what makes *"the stop stays reachable while a modal is open"* a
 * property of the overlay layer rather than a thing every panel has to remember. ⚑ An overlay
 * added tomorrow carries it because it was hosted, not because somebody pasted it in.
 *
 * ⚠️ **The same state and the same words as `SideRail`'s row** — both read
 * `spawn-safety.ts`'s one view, so there is no state in which the two disagree. See that file for
 * why it is a supplied module rather than two components that happen to agree.
 *
 * ## ⚑ Where it sits, and why the bottom-left corner
 *
 * ⛔ **The corner the rail's own switch is in.** `385 §3` anchored `rail-spawning` to the foot of
 * the rail, above the user card; this lands in the same column at the same end of the window, so a
 * person's hand goes to the same place whether or not something is open on top of it. The mock pins
 * its copy inside each sheet's header, which this app cannot do from the host — the panel is a
 * `<slot>` — and chasing that shape would have meant a header per panel instead of one lane.
 *
 * ⚠️ **Last in the host's DOM, so nothing about the trap moves.** `OverlayHost` focuses the first
 * focusable inside itself when it opens; drawn first, this control would take that focus on every
 * sheet in the app. Drawn last it is one Shift+Tab from wherever a dialog opens — and the trap that
 * wraps Tab at the ends is what makes that reliable rather than accidental.
 */
const safety = useSpawnSafety()
</script>

<template>
  <!-- ⚠️ **`v-if`, and it is 355's `v-if` rather than a new decision**: before the identities read
       lands there is no answer, and a stop drawn either way would be a claim nobody has made. -->
  <button
    v-if="safety.view.value"
    class="spawn-stop-lane"
    :class="{ off: !safety.view.value.on }"
    type="button"
    data-cy="overlay-spawning"
    data-safety-lane
    :aria-pressed="safety.view.value.on"
    @click="safety.press()"
  >
    <span class="switch-dot" :class="{ on: safety.view.value.on }"></span>
    <span class="lane-copy">
      <strong data-cy="overlay-spawning-state">{{ safety.view.value.heading }}</strong>
      <small data-cy="overlay-spawning-line">{{ safety.view.value.line }}</small>
    </span>
  </button>
</template>

<style scoped>
/* ⛔ **Placement moved to `.overlay-corner` at `401`, and the reasons moved with it.** Out of flow
   (`.overlay-host` is a centring flex box and a second in-flow child moves every sheet sideways),
   `z-index: 2` (a sheet's sticky header at 1 paints in the HOST's context), the
   `10px` left edge and the `200px` width are now declared once on the column that lays out both of
   the cards this host draws — because two cards positioning themselves cannot be stopped from
   overlapping each other, and one box laying them out cannot let them. ⚠️ **Nothing about this
   control's own geometry changed**: it is still the same 200px card, 10px from the left edge, 12px
   above the bottom, and still the last thing in the host. */
.spawn-stop-lane {
  display: grid;
  align-items: start;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--danger-border);
  border-radius: var(--radius-md);
  /* 🔴 **Opaque, and it was translucent until it was photographed.** `OverlayHost` carries
     `data-chat-theme="light"` (346), so every token in here resolves to its PAPER value — and the
     first version painted `--danger-bg`, an 8%-alpha tint, which on the dim backdrop composites to
     the near-black app behind it. ⛔ **Paper ink on a near-black card**: the heading was invisible
     and only the quieter line under it could be read. The panel this lane sits beside is
     `var(--panel)`, so this is too — a small sheet on the sheet layer, which is also what it is. */
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text-soft);
  gap: var(--space-4);
  grid-template-columns: 8px minmax(0, 1fr);
  text-align: left;
}

/* ⚠️ **No hover rule of its own, and that is deliberate rather than missing.** `base.css` gives
   every button `cursor: pointer` and an accent border on hover, at a specificity this could not
   have beaten anyway (`button:hover:not(:disabled)`), so a rule here would have been dead CSS
   claiming to do something. The affordance is the app's, which is the right one for a control that
   is meant to read as the same control the rail draws. */

/* The dot the rail draws, at the rail's own sizes — green while agents may start new conversations,
   red once they may not. ⚠️ The CARD is danger-toned in both states, because what it is is a
   safety control; the DOT is the state. */
.switch-dot {
  width: 8px;
  height: 8px;
  margin-top: var(--space-2);
  border: var(--border-width) solid var(--line-strong);
  border-radius: 50%;
  background: var(--danger);
}

.switch-dot.on {
  border-color: transparent;
  background: var(--success);
}

.lane-copy {
  min-width: 0;
}

.lane-copy strong {
  display: block;
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-medium);
  line-height: 1.25;
}

/* The explanation wraps so a person can read "Current work can continue" before pressing. */
.lane-copy small {
  display: block;
  margin-top: var(--space-1);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}
</style>
