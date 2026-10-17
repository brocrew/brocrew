<script setup lang="ts">
import {
  WINDOW_CONTROLS,
  type WindowControl,
  type WindowControlEffect,
} from '../../../shared/window-controls'

/**
 * 🔴 **The window's three controls — real buttons, because the window has no frame** (385 §1).
 *
 * ⛔ **What this replaces was a picture.** Until this component the bar drew
 * `<div class="traffic-lights" aria-hidden="true"><span /><span /><span /></div>`: three coloured
 * dots, no handler, no accessible name, and — measured over CDP on the pre-385 build — clicking all
 * three changed `visibilityState`, `outerWidth`, `outerHeight` and the process not at all. Under a
 * REAL macOS title bar that was merely redundant. Under no title bar it would be an app a person
 * cannot close with the pointer.
 *
 * ## ⚠️ `no-drag`, and it is the difference between a button and a picture of one
 *
 * `.titlebar` is `-webkit-app-region: drag` so the window can be moved by it, and **a drag region
 * swallows the clicks on everything inside it** — the property does not inherit, but the region is
 * a rectangle and a child that says nothing sits inside it. So every button here opts out
 * explicitly.
 *
 * ⚑ **The old spans computed `none`, and `none` is what SAYING NOTHING computes to** — measured,
 * both in the shipped window and in a real engine. ⚠️ Writing the word `none` is a different thing
 * from leaving the declaration out: an element that declares it computes `no-drag`, so the two
 * keywords are one behaviour and only an element with no declaration at all is still inside the
 * region. `window-controls.dom.test.ts` §3 carries that table, and a mutation row survived teaching
 * it to us.
 *
 * ## ⚑ The roster is the vocabulary, so a fourth verb cannot arrive unlabelled
 *
 * The buttons are a `v-for` over {@link WINDOW_CONTROLS} — the wire's own list — and the label and
 * the colour are `Record<WindowControl, …>`, which is exhaustive by type. ⛔ **A loop over a literal
 * list here would have passed silently over a verb somebody added**, and the label a person reads is
 * the one thing about a control that cannot be inferred.
 *
 * ⚠️ **The labels are British and the verbs are not** (`shared/window-controls.ts`): a wire says
 * what Electron says, a person reads what this product says everywhere else.
 */
const LABEL: Record<WindowControl, string> = {
  close: 'Close this window',
  minimize: 'Minimise this window',
  zoom: 'Zoom this window',
}

/**
 * ⛔ **The vocabulary IS the roster, in the vocabulary's own order** — no second list here.
 *
 * ⚠️ **A second list would be a second opinion about which controls exist**, and the failure it
 * allows is silent in both directions: a verb missing from it draws no button, and a button whose
 * verb the wire has retired throws on press. `WINDOW_CONTROLS` is `close · minimize · zoom`, which
 * is macOS's own left-to-right order and v2.3's — and `shared/window-controls.ts` says so, so the
 * order is a statement rather than a coincidence.
 */
const controls: readonly WindowControl[] = WINDOW_CONTROLS

/**
 * 🔴 **The first mark, because the colour may not be the only one** (389 §2).
 *
 * ⚠️ `tokens.css` states the rule the three bare dots were breaking, in the paragraph beside
 * `--traffic-close` itself: *"the colour is the second mark, never the only one"*. 385 shipped them
 * as colour alone, so *which* control a dot is was a fact available only to a reader who can
 * separate red from amber from green — and `aria-label` answers a screen reader, not an eye.
 *
 * ⚑ **Revealed the way macOS reveals its own**: hidden until the pointer is over the GROUP, so the
 * resting bar stays three quiet dots, and shown on `:focus-visible` so the keyboard is not the one
 * route that never gets the glyph. ⛔ `Record<WindowControl, string>` again — the same exhaustive
 * shape as {@link LABEL}, for the same reason.
 */
const GLYPH: Record<WindowControl, string> = {
  close: '×',
  minimize: '−',
  zoom: '+',
}

/**
 * ⛔ **The answer is thrown away on purpose, and the failure is not.**
 *
 * There is nothing on screen for a window that just closed to say, and every branch main can answer
 * with is a thing the window manager is about to make visible anyway — including `'gone'`, which
 * means the window this press was for has already been destroyed.
 *
 * ⚠️ **`void` rather than a `catch`**, so a REJECTED invoke stays loud. A verb the two sides
 * disagree about is refused by name in `main/window-controls.ts`, and the symptom of swallowing
 * that here would be a button that does nothing — the exact defect this component exists to end.
 */
function press(control: WindowControl): void {
  const answered: Promise<WindowControlEffect> = window.api.windowControl(control)
  void answered
}
</script>

<template>
  <div class="window-controls">
    <button
      v-for="control in controls"
      :key="control"
      class="light"
      :class="control"
      type="button"
      :data-cy="`window-${control}`"
      :aria-label="LABEL[control]"
      :title="LABEL[control]"
      @click="press(control)"
    >
      {{ GLYPH[control] }}
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* ⛔ **The opt-out, on the control and not on the bar.** See the component note: the bar has to stay
   draggable, so the escape has to be per control. */
.light {
  display: grid;
  width: 11px;
  height: 11px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  -webkit-app-region: no-drag;
  /* Transparent rather than absent: the glyph is laid out at rest, so revealing it moves nothing. */
  color: transparent;
  font-size: var(--type-caption);
  line-height: 1;
  opacity: 0.9;
  place-items: center;
}

.light:hover {
  opacity: 1;
}

/* ⛔ **On the GROUP, not on the button** — macOS's own behaviour, and the useful one: a person
   reaching for the bar learns all three at once rather than one at a time under the pointer. */
.window-controls:hover .light,
.light:focus-visible {
  color: var(--traffic-glyph);
}

/* ⚠️ **A ring rather than a fill.** The focus ring is what a keyboard user has instead of the
   pointer this control is for, and an 11px dot has no room for an inset one. */
.light:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.light.close {
  background: var(--traffic-close);
}

.light.minimize {
  background: var(--traffic-min);
}

.light.zoom {
  background: var(--traffic-max);
}
</style>
