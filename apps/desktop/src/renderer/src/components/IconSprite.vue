<script setup lang="ts">
/**
 * Every icon the product draws, once, at the app root.
 *
 * Lifted verbatim from the design delivery's sprite so the shapes are the designer's, not an
 * approximation of them. Components reference a symbol with `<use href="#i-…">` and inherit
 * colour through `currentColor`, which is what lets one sprite serve a rail item, a button and a
 * state badge without any of them knowing about the others.
 */
</script>

<template>
  <svg width="0" height="0" style="position: absolute" aria-hidden="true">
    <symbol id="i-bot" viewBox="0 0 24 24">
      <rect x="5" y="7" width="14" height="11" rx="3" />
      <path d="M12 3v4M8.5 12h.01M15.5 12h.01M9 16h6M3 11v4M21 11v4" />
    </symbol>
    <symbol id="i-book" viewBox="0 0 24 24">
      <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zM12 5v15" />
    </symbol>
    <symbol id="i-chat" viewBox="0 0 24 24">
      <path
        d="M20 15a4 4 0 0 1-4 4H8l-5 3 1.5-4.5A7 7 0 0 1 3 13V9a6 6 0 0 1 6-6h7a5 5 0 0 1 5 5z"
      />
    </symbol>
    <symbol id="i-folder" viewBox="0 0 24 24">
      <path d="M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </symbol>
    <!-- W4.183 · v3's agent panel: copy a path, the model, its context, its memory. -->
    <symbol id="i-copy" viewBox="0 0 24 24">
      <path d="M9 9h11v11H9z" />
      <path d="M5 15H4V4h11v1" />
    </symbol>
    <!-- Open a file in its own app: a box with an arrow leaving it. -->
    <symbol id="i-open" viewBox="0 0 24 24">
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </symbol>
    <symbol id="i-search" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </symbol>
    <symbol id="i-cube" viewBox="0 0 24 24">
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </symbol>
    <symbol id="i-layers" viewBox="0 0 24 24">
      <path d="m12 4 9 5-9 5-9-5z" />
      <path d="m3 14 9 5 9-5" />
    </symbol>
    <symbol id="i-ram" viewBox="0 0 24 24">
      <path d="M3 8h18v8H3z" />
      <path d="M7 16v3M11 16v3M15 16v3M19 16v3M7 11h2M11 11h2M15 11h2" />
    </symbol>
    <symbol id="i-archive" viewBox="0 0 24 24">
      <path d="M3 6h18M5 6v14h14V6M9 10h6" />
      <path d="M4 3h16v3H4z" />
    </symbol>
    <symbol id="i-clock" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </symbol>
    <!-- An agent waiting on another agent: the plate's corner mark. -->
    <symbol id="i-hourglass" viewBox="0 0 24 24">
      <path d="M7 3h10M7 21h10M8 3v5l8 8v5M16 3v5l-8 8v5" />
    </symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></symbol>
    <symbol id="i-alert" viewBox="0 0 24 24">
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 9v4M12 17h.01" />
    </symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z" /></symbol>
    <symbol id="i-file" viewBox="0 0 24 24">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </symbol>
    <!-- 254 — a picture that came off the clipboard, so the chip for it does not read as a file
         somebody named. Same one-stroke register as `i-file`, deliberately: it is still an
         attachment, it is just not one anybody chose by name. -->
    <symbol id="i-image" viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m4 17 5-5 4 4 3-2 4 3" />
    </symbol>
    <!-- 216 — attach a file or folder for the agent to read. Same one-stroke register as the rest. -->
    <symbol id="i-paperclip" viewBox="0 0 24 24">
      <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />
    </symbol>
    <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></symbol>
    <symbol id="i-terminal" viewBox="0 0 24 24">
      <path d="m4 7 4 4-4 4M11 17h8" />
      <rect x="2.5" y="3.5" width="19" height="17" rx="2" />
    </symbol>
    <symbol id="i-spark" viewBox="0 0 24 24">
      <path
        d="m12 3 1.2 4.2L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-1.8zM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7zM5 3l.6 1.9L7.5 5.5l-1.9.6L5 8l-.6-1.9-1.9-.6 1.9-.6z"
      />
    </symbol>
    <symbol id="i-send" viewBox="0 0 24 24"><path d="m4 4 16 8-16 8 3-8zM7 12h13" /></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></symbol>
    <symbol id="i-eye" viewBox="0 0 24 24">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </symbol>
    <symbol id="i-more" viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </symbol>
    <symbol id="i-user" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </symbol>
    <!-- Navigate up to the conversation that gave this one its work. Use a separate symbol so rotating the shared `i-arrow` does not give one glyph two meanings. -->
    <symbol id="i-up" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></symbol>
    <!-- Represent a conversation and those around it with three nodes, one above two. -->
    <symbol id="i-graph" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5.5" cy="19" r="2.5" />
      <circle cx="18.5" cy="19" r="2.5" />
      <path d="M12 7.5v4.5M12 12l-5 4.8M12 12l5 4.8" />
    </symbol>
    <!-- Represent agents below an agent with two heads in the `i-user` style. -->
    <symbol id="i-users" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18.5 14.4a6.5 6.5 0 0 1 3 5.6" />
    </symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></symbol>
    <!-- STOP, and deliberately not `i-pause` (089). The composer's interrupt button has referenced
         `#i-square` since it was written and has been painting nothing ever since — a dangling
         reference is invisible, which is the whole reason the test below this file's fixes exists.
         The two are not interchangeable: 081 collision B gave `i-pause` to a message HELD before
         send, where nothing is elapsing, and this ends a turn that is. -->
    <symbol id="i-square" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </symbol>

    <!-- The drawer's tabs and the narrowed lifecycle toggle (079/080), drawn in the sprite's own
         line style. Two of them are a matched PAIR and must not be swapped: `i-lifecycle` is
         discrete marks on a baseline — session start, turn boundaries, idle gaps — and `i-activity`
         is one continuous trace. The first is the toggle that puts those marks in the conversation;
         the second is the tab that shows every event there is. Reading them the same way is exactly
         the confusion §3 retired the eye to end. -->
    <symbol id="i-lifecycle" viewBox="0 0 24 24">
      <path d="M3 18h18" />
      <path d="M6 18v-4M12 18v-9M18 18v-6" />
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="7" r="1.5" />
      <circle cx="18" cy="10" r="1.5" />
    </symbol>
    <symbol id="i-activity" viewBox="0 0 24 24"><path d="M3 12h4l2-6 4 12 2-6h6" /></symbol>
    <!-- 358 · a plug, for the tools a conversation has. ⚠️ **A new symbol rather than borrowing
         `#i-sliders` or `#i-terminal`**: both are already the drawer's own vocabulary — one is
         Controls and one is a shell command — and a second meaning on either would make a strip
         where the same shape says two things. `089`'s rule is that a `<use href>` not in this sprite
         paints NOTHING, so an icon is a real change here or it is an invisible button. -->
    <symbol id="i-tool" viewBox="0 0 24 24">
      <path d="M9 3v6M15 3v6" />
      <path d="M5 9h14v3a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z" />
      <path d="M12 17v4" />
    </symbol>
    <symbol id="i-sliders" viewBox="0 0 24 24">
      <path d="M4 7h9M19 7h1M4 12h1M11 12h9M4 17h5M15 17h5" />
      <circle cx="15.5" cy="7" r="2.2" />
      <circle cx="7.5" cy="12" r="2.2" />
      <circle cx="11.5" cy="17" r="2.2" />
    </symbol>
    <symbol id="i-gear" viewBox="0 0 24 24">
      <path
        d="m9.5 3-.5 2a7 7 0 0 0-1.7 1l-2-.6-2 3.4 1.5 1.4a7 7 0 0 0 0 2.1L3.3 14l2 3.4 2-.6a7 7 0 0 0 1.7 1l.5 2h4l.5-2a7 7 0 0 0 1.7-1l2 .6 2-3.4-1.5-1.6a7 7 0 0 0 0-2.1l1.5-1.4-2-3.4-2 .6a7 7 0 0 0-1.7-1l-.5-2z"
      />
      <circle cx="11.5" cy="11.5" r="3" />
    </symbol>
    <symbol id="i-info" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6h.01" />
    </symbol>
    <!-- The gauge (087) — the Dropped tab's until W4.208 retired it; the card's effort since. -->
    <symbol id="i-gauge" viewBox="0 0 24 24">
      <path d="M4 16a8 8 0 0 1 16 0" />
      <path d="m12 16 4-4" />
      <circle cx="12" cy="16" r="1.4" />
    </symbol>
    <!-- History folding into a summary line (086's one new glyph): a rule, with an arrow collapsing
         into it from above and from below. Used by the compaction boundary in the transcript, the
         meter's reading line, and every row of its Compactions list. -->
    <symbol id="i-compact" viewBox="0 0 24 24">
      <path d="M4 12h16" />
      <path d="m9 6.5 3 3 3-3" />
      <path d="m9 17.5 3-3 3 3" />
    </symbol>
    <!-- What diverged: two source nodes and a branch. Reserved by 080, LIVE since 096 — the glyph
         never had to change, which is what "reserve the spot" was for. -->
    <symbol id="i-diff" viewBox="0 0 24 24">
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="9" r="2.4" />
      <path d="M6 8.4v7.2M6 15.6a9 9 0 0 1 9-9" />
    </symbol>
    <!-- Work handed out (508): three rows, each with the mark of a thing given rather than of a
         thing done. ⛔ NOT `#i-check`, which is already `NEEDING_GLYPH.plan` and means *waiting on
         you* — a tab whose subject is mostly work that is still open must not wear the tick that
         means finished, and must not borrow the attention channel's glyph. The ONE new glyph this
         dispatch adds, on 096's one-purposeful-glyph economy. -->
    <symbol id="i-list" viewBox="0 0 24 24">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </symbol>
    <!-- Putting it back: a back-arrow curving counter-clockwise in time (096). The ONE new glyph
         this task adds, used only by the deferred revert foot — the same one-purposeful-glyph
         economy as 086's #i-compact. -->
    <symbol id="i-revert" viewBox="0 0 24 24">
      <path d="M3 8h7M3 8l3.5-3.5M3 8l3.5 3.5" />
      <path d="M7 8h9a5 5 0 0 1 0 10H9" />
    </symbol>
    <!-- A change that has been asked for and has not landed yet (034/076) — the top bar's pending
         marker, and the Info tab's re-read. -->
    <symbol id="i-refresh" viewBox="0 0 24 24">
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 3.5V8h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20.5V16h4.5" />
    </symbol>
    <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></symbol>

    <!-- What an agent NEEDS FROM YOU (081/082), drawn on the corner of its white plate. The third
         one, `i-bang`, is the only condition badge BEING adds besides the clock — and it lives on
         the opposite corner from these, because a session that errored can still be asking. The
         checkmark a plan approval wears is `i-check`, already above: approving a plan is the same
         gesture as ticking something off, and two glyphs for it would be two things to learn. -->
    <symbol id="i-lock" viewBox="0 0 24 24">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </symbol>
    <symbol id="i-question" viewBox="0 0 24 24">
      <path d="M9.1 9a2.9 2.9 0 0 1 5.6 1c0 2-2.7 2.1-2.7 3.8" />
      <path d="M12 17.6h.01" />
    </symbol>
    <symbol id="i-bang" viewBox="0 0 24 24">
      <path d="M12 6v8" />
      <path d="M12 18h.01" />
    </symbol>
  </svg>
</template>
