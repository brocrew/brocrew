<script setup lang="ts">
/**
 * 🔴 **What a person sees between ⌘Q and the app being gone** (271 §2, from `270` finding 1).
 *
 * ## ⛔ The state this exists for
 *
 * A quit defers Electron and then runs an ordered teardown — stop import work, close every
 * session, drain the imports, close SQLite. Until 271 the window was told none of it: it went on
 * drawing an ordinary, usable application for the whole of that, and then vanished. `270` pressed
 * ⌘Q on a fresh instance and reported the far end of it as *"a dead-looking black app"*: *"The
 * person gets no feedback that anything is happening — it looks crashed, not closing."*
 *
 * ⚑ **It covers the whole window, including the titlebar and the rail**, which is why it is mounted
 * beside `RuntimeScreen` rather than inside it. A shade that left a live-looking rail and a working
 * New-conversation button next to a message saying the app is closing would be two answers to one
 * fact, which is the shape this repository keeps paying for (076 §3, 187 §1).
 *
 * ⛔ **It cannot be dismissed, and there is no way back.** A quit that has begun is not cancellable:
 * `before-quit` has already been deferred and the four steps are already running. So there is no
 * close button here and no `v-else` — the only thing that ends this shade is the process ending.
 *
 * ⚠️ **It is deliberately NOT a spinner.** How long the teardown takes is a property of what the
 * agents were doing, and this app has ruled twice (106/118) against a control or an animation that
 * implies a duration nobody can predict. The sentence says what is happening; the window going away
 * says when it is done.
 */
</script>

<template>
  <!--
    `aria-live="assertive"` and not `polite`: the application is going away, which is the one
    announcement that cannot usefully wait for a screen reader to finish its current sentence.
  -->
  <div class="closing-shade" data-cy="closing-shade" role="status" aria-live="assertive">
    <div class="closing-card">
      <p class="closing-title">BroCrew is closing</p>
      <p class="closing-detail">Stopping your agents and finishing their transcripts.</p>
    </div>
  </div>
</template>

<style scoped>
.closing-shade {
  position: fixed;
  inset: 0;
  /* Above everything the app draws. ⚠️ Measured rather than assumed: the highest `z-index` anywhere
     in the renderer today is `ToastStack`'s 100, so this clears it by two orders of magnitude and
     an overlay added later would have to be trying to get above it. */
  z-index: 9999;
  display: grid;
  place-items: center;
  /* Opaque enough that nothing behind it reads as usable, translucent enough that the app is still
     visibly THERE — the whole complaint in 270 was a window that looked gone rather than busy. */
  background: var(--closing-shade-bg);
  /* ⛔ NOT `pointer-events: none`. Swallowing the click IS the point: every control behind this is
     about to lose its database, and a press that reached one would get better-sqlite3's own
     `The database connection is not open` — which is exactly what 270 saw in its first probe. */
  cursor: progress;
}

.closing-card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-11) var(--space-14);
  text-align: center;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-card);
  background: var(--panel);
}

.closing-title {
  margin: 0;
  color: var(--text);
  font-size: var(--type-reading);
  font-weight: var(--fw-semibold);
}

.closing-detail {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-small);
}
</style>
