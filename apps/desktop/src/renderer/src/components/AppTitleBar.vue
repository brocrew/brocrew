<script setup lang="ts">
import { computed, watch } from 'vue'
import TitleUsage from './TitleUsage.vue'
import WindowControls from './WindowControls.vue'
import HistoryArrows from './HistoryArrows.vue'
import type { AppInfo } from '@brobot2/shared'

/**
 * 🔴 **The window's own bar, and after 385 it is the ONLY one** (389 §2).
 *
 * ## ⛔ Why it is a component now, when 385 left it inline in `RuntimeScreen`
 *
 * ⚠️ **`build-identity.test.ts` wrote the reason down before this dispatch existed**: *"Nothing in
 * this repository mounts `RuntimeScreen` — it is the whole app — so there is no render test that
 * can read this chip."* Everything the product knew about its own title bar was therefore a
 * **string** assertion over `RuntimeScreen.vue`'s text, plus two live rigs that are not in `ci`.
 * ⛔ `389 §6` refuses that shape by name: *"A DOM test at the real viewport, not an assertion about
 * a class name."*
 *
 * ⚑ **Nothing about the bar changed to make that possible except its address.** The markup, the
 * drag region, the three real controls, the closed wire vocabulary and the build chip are 385's,
 * moved. What the move buys is that `.titlebar` — scoped CSS, so unreachable from any other
 * component — can now be **mounted and measured**: its computed `-webkit-app-region`, its height,
 * and where the title actually lands at a given width are readings rather than regexes.
 *
 * ## ⚠️ The one thing the arrangement changes, and it was measured
 *
 * 385 laid the bar out `1fr auto 1fr`. ⛔ **`1fr` is `minmax(auto, 1fr)`** — its floor is the
 * track's own min-content — so the two side tracks are equal *only while neither cluster is wider
 * than half the free space*. The right-hand cluster grows: `startup-error` is an arbitrary provider
 * string, and `build-line` grows with the schema number. When it outgrows its share the third track
 * takes the extra from the second and **the centred title slides left** — off the centre of the
 * window it is supposed to name.
 *
 * `minmax(0, 1fr)` on both side tracks removes the floor, so they stay equal at every width and the
 * title is centred on the WINDOW rather than on the space two clusters happen to leave. The cost is
 * that the right cluster must be able to give ground, which is what `min-width: 0` plus the ellipsis
 * on `.sync-detail` are for. ⚑ v2.5 reaches the same arrangement by absolutely centring its title;
 * this reaches it with the grid the product already had.
 *
 * ## ⛔ What was removed, and it is a finding rather than a tidy-up
 *
 * The bar carried a third element reading **`Night workspace`**. Nothing produces it: `grep -rn
 * "Night workspace"` over the whole checkout returns exactly one hit — the template it was written
 * in. It is a sentence that DESCRIBES a fact the app does not have (standing rule 8), sitting in
 * the most-read strip in the window, and a reader has no way to tell it from `BroBot2` beside it,
 * which is real. ⚠️ **It is not replaced with the selected project**: a window-level selection drawn
 * against a conversation is exactly the wrong answer `389 §3` forbids one surface down.
 */
const props = defineProps<{
  /** What the main process says this build is, or `null` before the read lands. */
  info: AppInfo | null
  /** The startup read's own failure, on its own line — never folded into the chip. */
  error: string | null
}>()

const showBuildDetails = computed(() => import.meta.env.DEV)

/**
 * ⚑ **What build is this** (331), as one string, because the element it lands in is read by
 * `innerText` in two smokes and by a person in one second.
 *
 * `id` is a short sha, or `dev`, or `unknown` — the main process decided which and this does not
 * second-guess it. ⛔ **`dirty` is read as a field, never recovered from the text**: the producer
 * knows whether the tree was clean, and a renderer that re-read the dirtiness out of `id` would be a
 * second derivation of one fact, free to drift from the first.
 */
const buildLine = computed(() => {
  const read = props.info
  if (!read) return ''
  const uncommitted = read.build.dirty ? ' · uncommitted' : ''
  return `${read.build.id}${uncommitted} · schema ${read.db.migrationsApplied}${branchWords.value}`
})

type Branch = NonNullable<AppInfo['build']['branches']>[number]

/** ⚑ Why a branch is not in this build, as far as the build could tell. */
function whyLeftOut(branch: Extract<Branch, { held: false }>): string {
  const names = branch.conflictsWith ?? []
  if (names.length > 0) return `it conflicts with ${names.join(' and ')}`
  if (branch.conflictsWithBuild === true) return 'it conflicts with this build'
  if (branch.conflictsWithBuild === false && branch.conflictsWith !== null) {
    return 'it merges cleanly, so why isn’t known'
  }
  return 'why isn’t known'
}

const branchesOf = computed(() => props.info?.build.branches ?? [])
/** ⚑ The branches this build left out. */
const leftOut = computed(() =>
  branchesOf.value.flatMap((branch) => (branch.held === false ? [branch.name] : [])),
)

/**
 * 🔴 **F077 · a branch this build left out, or holds only part of, on the chip itself** —
 * *"· without ui"*, *"· ui 3 behind"*. ⚑ Short, because the chip's end is what its ellipsis cuts;
 * the why is on the hover ({@link buildTitle}). A build that holds all of them reads as before.
 */
const branchWords = computed(() => {
  const without = leftOut.value.length === 0 ? '' : ` · without ${leftOut.value.join(' and ')}`
  const behind = branchesOf.value
    .flatMap((branch) =>
      branch.held === 'older' ? [` · ${branch.name} ${branch.behind} behind`] : [],
    )
    .join('')
  return `${without}${behind}`
})

/**
 * The long form, for a hover: the full sha to paste, and the app version this chip used to show
 * instead of any of it.
 *
 * ⚠️ **Each state says what it is rather than leaving a gap.** A dev window is rebuilt as you save,
 * so no commit describes it and naming one would be the confident wrong answer; a build with no
 * stamp did not record a commit, which is a different sentence from *"the commit is empty"*.
 *
 * ⛔ **`'dev'` is spelled here rather than imported as `BUILD_IS_DEV`, and the reason is measured.**
 * `@brobot2/shared` reaches this file as `import type` only; turning that into a VALUE import pulls
 * `contracts.ts` in, whose top-level `z.object(...)` calls rollup cannot prove pure — so `zod` lands
 * in the renderer bundle. One build each, same commit, one variable: **1,351,038 bytes with the
 * import against 1,215,826 without — +135 kB, +11.1%, to share a three-letter string.**
 * ⚑ `build-identity.test.ts` holds this literal against `BUILD_IS_DEV` instead; the same treatment
 * `build-stamp.ts` gets, for the same reason in a different disguise.
 */
const buildTitle = computed(() => {
  const read = props.info
  if (!read) return ''
  // A release's number reads `v0.1.6`; a source build's version is a word (`dev e76e7c6`).
  const name = `${read.name} ${/^\d/.test(read.version) ? 'v' : ''}${read.version}`
  if (read.build.id === 'dev') {
    return `${name} — development build: this window is rebuilt as you save, so no commit describes it`
  }
  if (read.build.commit === '') {
    return `${name} — this build did not record a commit`
  }
  const tree = read.build.dirty
    ? ' with uncommitted changes in the working tree — the app running is NOT that commit'
    : ''
  const branches = read.build.branches ?? []
  const held = branches.filter((branch) => branch.held === true)
  const holds =
    held.length === 0
      ? ''
      : `\nHolds ${held.map((branch) => `${branch.name} ${branch.tip}`).join(', ')}.`
  const partly = branches.flatMap((branch) =>
    branch.held === 'older'
      ? [
          `\n${branch.name}: holds it up to ${branch.holdsUpTo}; ${branch.behind} newer ${branch.behind === 1 ? 'commit' : 'commits'}, up to ${branch.tip}, ${branch.behind === 1 ? 'isn’t' : 'aren’t'} in this build.`,
        ]
      : [],
  )
  const missing = branches.flatMap((branch) =>
    branch.held === false
      ? [`\nLeft out: ${branch.name} ${branch.tip} — ${whyLeftOut(branch)}.`]
      : [],
  )
  return `${name} — built from ${read.build.commit}${tree}${holds}${partly.join('')}${missing.join('')}`
})

/**
 * Keep the OS title in sync with the bar's launch name so windows using different data folders can be distinguished.
 *
 * ⛔ **Two names, one of them fixed.** This bar draws {@link AppInfo.windowTitle}, which main
 * composes; the window's OWN title — the one Mission Control, the Window menu and an accessibility
 * reader give — is the page's `<title>`, and `index.html` spells that `BroBot2` once, whatever main
 * says. ⚠️ Electron retitles a person's window from the page (`page-title-updated`; only a hidden
 * launch prevents it, `launch-presentation.ts`), so writing the page's title is how the two agree.
 *
 * ⚑ **It adds no fact.** Whether this launch runs on a data folder that is not the default one is
 * main's to know (`718` GAP-M1), and since `724` `windowTitle` carries it — `BroBot2 — <folder>` —
 * so both places say it with no change here. ⚠️ `typeof document` because the render tests mount this on the
 * server, where an immediate watcher still runs once.
 */
watch(
  () => props.info?.windowTitle ?? null,
  (title) => {
    if (title !== null && typeof document !== 'undefined') document.title = title
  },
  { immediate: true },
)
</script>

<template>
  <!-- ⛔ **The window's own bar, and after 385 it is the ONLY one** (§2). `frame: false` in
       `main/index.ts` takes macOS's away; `WindowControls` is the three controls that replaces,
       and `-webkit-app-region: drag` below is what makes this strip the thing you move the window
       by. -->
  <header class="titlebar" data-cy="app-titlebar">
    <!-- The window's controls, then its usage on one line: the cluster that gives way first. -->
    <div class="title-left">
      <WindowControls />
      <HistoryArrows />
      <TitleUsage />
    </div>
    <!-- ⚑ **730 · the whole name on the title**, because a long one is cut — see `.window-title`. -->
    <div class="window-title" data-cy="window-title" :title="info?.windowTitle">
      <svg class="icon"><use href="#i-bot" /></svg>
      <!-- ⚑ 695 §1 · the launch's own name: `BroBot2 — test` on a window no person launched, so one
           brought forward is never mistaken for his. `BroBot` until the read lands. ⚑ **724 · and
           `BroBot — <folder>` on a person's launch whose data folder is not the app's default**
           (`windowTitleFor`) — `730`'s draw, which main composes and this line only draws. -->
      <strong>{{ info?.windowTitle ?? 'BroCrew' }}</strong>
    </div>
    <!-- The sync state, and what it is true of: this build and the schema it opened. The
         conversation COUNT deliberately is not here — it is read once at mount and would sit
         there saying "0 recorded" while the rail, which counts them live, says two. One stale
         number beside a live one reads as a bug in whichever you trust less. -->
    <div class="sync-state" data-cy="app-info">
      <span class="sync-dot" />
      <span class="sync-word">Saved locally</span>
      <!-- Development diagnostics stay out of release title bars. -->
      <span
        v-if="props.info && showBuildDetails"
        class="sync-detail mono"
        :class="{ 'build-dirty': props.info.build.dirty || branchWords !== '' }"
        data-cy="build-line"
        :title="buildTitle"
      >
        {{ buildLine }}
      </span>
      <!-- Its OWN `v-if`, not an `v-else-if` on the line above. Two independent reads land here
           now (039), and chaining them meant the commoner failure was the invisible one: app info
           arriving while capabilities failed left the error set and unrendered, so plan mode
           quietly vanished for every provider with nothing on screen to say why. -->
      <span v-if="props.error" class="sync-detail danger" data-cy="startup-error">{{
        props.error
      }}</span>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: grid;
  height: var(--titlebar-h);
  align-items: center;
  padding: 0 var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  -webkit-app-region: drag;
  background-color: var(--titlebar-bg-color, var(--titlebar-bg));
  background-image: var(--titlebar-bg-image, none);
  background-position: var(--titlebar-bg-position, 0% 0%);
  background-repeat: var(--titlebar-bg-repeat, repeat);
  background-size: var(--titlebar-bg-size, auto);
  image-rendering: var(--titlebar-bg-rendering, auto);
  text-shadow: var(--titlebar-ink-glow-shadow, none);
  /* ⛔ **`minmax(0, 1fr)` and not `1fr`** (389 §2). A bare `1fr` floors at the track's own
     min-content, so a long `startup-error` on the right widens track 3 past track 1 and walks the
     centred title off the window's centre. With the floor removed the two side tracks are equal at
     every width, and the cluster that has to give ground is the one that can — see `.sync-state`. */
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  user-select: none;
}

.titlebar > * {
  image-rendering: auto;
}

.title-left {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
}

.title-left > :first-child {
  flex: none;
}

.window-title {
  display: flex;
  align-items: center;
  color: var(--titlebar-ink, var(--muted));
  font-size: var(--type-body);
  gap: var(--space-4);
  justify-self: center;
  letter-spacing: 0.01em;
  /* It is the thing being centred, so it must not be the thing that grows the middle track. */
  min-width: 0;
  /* 🔴 **730 · and it has a ceiling, because since `724` it can carry a folder's name** (up to 255
     characters). ⛔ Unbounded, at the 1,180 px floor a 255-character folder drew the title from
     −291 px to 1,471 px — its first words, the ones that say whose window it is, off the left
     edge — and squeezed `WindowControls` to 0 px; 120 characters already ran 17 px into the sync
     cluster (`a-window-on-another-data-folder-says-so.dom.test.ts`, in `RuntimeScreen`'s frame).
     ⚑ Half the window: at and above the floor the bar is the window's width (`.app` is `width:
     100vw; min-width: var(--app-min-w)`); below it — a zoom, or a window dragged narrower — `50vw`
     is a tighter cap than half the bar, which only gives the controls and the cluster more room.
     ⛔ Not a percentage: it would resolve against the `auto` track this box is what sizes. The name
     is cut at its end and whole on the `title` above — `overflow` alone already gives the flex item
     a 0 minimum. */
  max-width: 50vw;
  white-space: nowrap;
}

.window-title strong {
  overflow: hidden;
  color: var(--titlebar-ink, var(--text-soft));
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
}

.sync-state {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
  color: var(--titlebar-ink, var(--muted));
  font-size: var(--type-small);
  gap: var(--space-4);
  justify-self: end;
  /* ⚑ The half of the centring fix that lives on the cluster: without it the flex row refuses to
     shrink below its content and the grid gives it the pixels anyway. */
  min-width: 0;
  /* Kept inside its own track, so a long window title beside it is never drawn over: the build
     line gives way first, cut with its whole text on its title. An end-aligned grid item takes its
     content's width, so the track's width is its ceiling too. */
  max-width: 100%;
  overflow: hidden;
}

/* The state in words, on one line. */
.sync-word {
  flex: none;
  white-space: nowrap;
}

.sync-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--success);
  /* The dot is a fixed 6px and the row is allowed to shrink; without this it is the first thing
     flex takes the pixels from, and the state loses its mark before the text loses a letter. */
  flex: 0 0 auto;
  box-shadow: var(--sync-dot-glow);
}

.sync-detail {
  overflow: hidden;
  color: var(--titlebar-ink, var(--faint));
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  /* ⚑ **Selectable, against the titlebar's `user-select: none`** (331). The short sha is here so a
     person can put it in a message — being able to drag across it and copy is most of what makes
     that true, and the drag region above already opts out at `.sync-state`. */
  user-select: text;
  white-space: nowrap;
}

.sync-detail.danger {
  color: var(--titlebar-danger, var(--danger));
}

/* ⚠️ **Amber, not red** (331). A build from an uncommitted tree is not a failure — it is a caution
   about what the sha beside it means, and `tokens.css` says outcome amber for exactly that
   ("ok=green, warnings=amber, failed=red"). `--waiting` is a DECLARED token; 104/105 found three
   `var(--warning, …)` fallbacks in this repo doing all the work for a token that exists nowhere,
   and inventing a fourth for one chip would be that finding again.

   ⛔ The colour is the second mark, never the only one — the word `uncommitted` is in the text, so
   the warning survives a screenshot in greyscale and a reader who cannot separate the hues. */
.sync-detail.build-dirty {
  color: var(--titlebar-waiting, var(--waiting));
}
</style>
