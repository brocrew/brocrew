<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import { ROLE_PROPERTIES } from '../lib/text-roles'
import { changeSet, diffBody, isNetUnchanged, scoped, totals, type ChangeRow } from '../lib/changes'
import { basenameOf } from '../lib/paths'
import type { TranscriptState } from '../lib/transcript'
import DiffBody from './DiffBody.vue'

/**
 * **What this conversation did to your working tree** (096, designed in 092) — the last reserved
 * drawer slot, and the largest capability the app simply did not have.
 *
 * ## Lazy is the whole design (092 §4)
 *
 * 054 measured the transcript fold going quadratic — 2,646 ms and ~1 GB at 1,600 turns — and 092
 * called this pane *"that hazard with file contents attached."* So:
 *
 * - **closed tab** → nothing; the drawer mounts one tab body at a time.
 * - **collapsed** → the file list only: path, status and counts, bounded by DISTINCT FILES rather
 *   than by turns. No diff body is read, and `expanded` starts null.
 * - **expand** → exactly one body, an accordion: opening a second closes the first, so at most one
 *   `DiffBody` is ever mounted. That is enforced by `expanded` being a single value rather than a
 *   set — the accordion is structural here, not a click handler that remembers to clean up.
 *
 * ## Nothing is invented (092 §3)
 *
 * Every blank has a drawing, and each one is a different fact:
 * - **nothing changed** → 081's faceless dashed ring, never a `0`.
 * - **content not reported** → the file change we were allowed to make and not told the contents
 *   of. No path, no count, not expandable.
 * - **net unchanged** → written and put back. Shown, because the write happened.
 * - **no diff reported** → Claude tells us the file, not the change. The row says so and does not
 *   expand onto an empty box.
 *
 * ## 🔴 What a person can READ here (541)
 *
 * ⛔ **Every size in this stylesheet names a ROLE** (`lib/text-roles.ts`, `526`'s vocabulary), and
 * `CHANGES_TEXT` in `lib/drawer-tab-roles.ts` says which role each text has. ⚑ The bridge is
 * {@link ROLE_PROPERTIES} on this section's root, so changing a line in that module moves this tab
 * and nothing here has to be edited to agree. ⚠️ The one exception is the file count — a heading on
 * `--text-lg`, listed in `CHANGES_OFF_THE_SCALE` with the reason.
 *
 * 🔴 **The defect `525` measured was the deferred foot.** 416 characters of *what a rewind will do
 * to your files* at **8 px** — the longest string on the tab, at the size `tokens.css` §9 reserves
 * for micro-labels. ⛔ `HO-050` §1.2 rules that a rewind is a PRESS, so its disclosure stays beside
 * it (§2's own exception); `514` F1 is why the size matters: *a caveat placed where the reader
 * cannot take it in is a caveat that was not given*.
 *
 * ⚠️ **And the paths were NOT already right, which is the half the size measurement could not
 * see.** `531`'s ink sensor, on the shipped `--drawer-w` of 380 px, found a file NAME cut by
 * 85.59 px with nothing to recover it — **the only cut text in the whole drawer** — and at
 * `--drawer-w-narrow` (320 px) the third grid track collapses a path column to **0 px** when the
 * row's tag is long. ⛔ The row carries `:title="row.path"` now, which is `531`'s own ruling for a
 * string whose LENGTH a person controls: a cut without a title is a sentence nobody can get to; a
 * cut with one is a layout decision. ⚑ The collapse itself is a layout question this dispatch
 * measured and did not take.
 */
const props = defineProps<{
  /** The live control projection — the same one the meter reads, never the scroll position. */
  state: TranscriptState
  /** `rewind` for this session's provider. Supplies the deferred foot's reason; never enables it. */
  capability: CapabilityStatus | null
}>()

const scope = ref<'turn' | 'conversation'>('conversation')
/** The ONE expanded path, or null. A single value IS the accordion — see the header comment. */
const expanded = ref<string | null>(null)

/**
 * ⚠️ **Changing scope closes the diff, and it has to** (review). `expanded` held a PATH, and a path
 * that leaves the scope simply stopped rendering: the diff vanished with no cue, and came back on its
 * own when the reader switched scope again. Both halves are wrong — a surface that closes without
 * saying so, and one that opens without being asked (the same defect 095 fixed one field over).
 * Closing on the switch is the honest version: the reader changed what they were looking at.
 */
function setScope(next: 'turn' | 'conversation'): void {
  if (scope.value === next) return
  scope.value = next
  expanded.value = null
}

const set = computed(() => changeSet(props.state))
const rows = computed(() => scoped(set.value, scope.value))
const sum = computed(() => totals(rows.value))
/**
 * Whether the under-disclosed row belongs in the CURRENT scope.
 *
 * ⚠️ It is a count of approvals across the conversation, not a per-turn fact, so it is shown on the
 * whole-conversation scope only. Review found the empty state could otherwise hide it: on This turn
 * with no rows, `empty` was false because the count was non-zero, so the pane drew a list containing
 * exactly one faceless row and no explanation of why the turn looked bare.
 */
const showUndisclosed = computed(
  () => scope.value === 'conversation' && set.value.underDisclosed > 0,
)
/**
 * ⛔ **"1 file change WERE approved"** (181 §2) — a singular subject with a plural verb, on a line a
 * user reads at the exact moment they are being told something is unknown.
 *
 * ⚠️ **Both counts are composed here, and that is the fix rather than a tidy-up.** The template
 * pluralised the NOUN inline (`file change{{ n === 1 ? '' : 's' }}`) and then hard-coded `were`
 * beside it, so the agreement was half-done in one place and absent in the other. One expression
 * that owns the whole clause cannot disagree with itself, and it is what the test can assert at 1
 * and at 2 — a fix that only reads right at one count is the same bug at the other (151/162's
 * register for this app's prose).
 */
const undisclosedLine = computed(() =>
  set.value.underDisclosed === 1
    ? '1 file change was approved'
    : `${set.value.underDisclosed} file changes were approved`,
)
/**
 * ⚠️ **The empty state is about the SCOPE, and the pane never shows an empty scope silently.** A
 * conversation with changes in turn 1 and none in turn 4 is not "no file changes in this
 * conversation" — it is "nothing this turn", which is a different sentence and a different offer.
 */
const blank = computed(() => rows.value.length === 0 && !showUndisclosed.value)

/** Only a row we actually hold a diff for opens. Everything else states why it does not. */
function expandable(row: ChangeRow): boolean {
  return row.bodyReportId !== null
}

function toggle(row: ChangeRow): void {
  if (!expandable(row)) return
  expanded.value = expanded.value === row.path ? null : row.path
}

/**
 * Read the one open diff. Called for a single row, and only while it is open.
 *
 * ⚠️ Null when the body is no longer held — a report whose diff text was released to bound memory
 * (see `MAX_HELD_DIFF_REPORTS`). The template keys its `.open` class off THIS rather than off
 * `expanded`, so a row can never sit visually open with nothing underneath it (review).
 */
const openDiff = computed(() => {
  const row = rows.value.find((entry) => entry.path === expanded.value)
  if (!row) return null
  const source = diffBody(props.state, row)
  return source === null ? null : { row, source }
})

/** `A`/`M`/`D`/`R`/`W` — neutral chrome. The hue lives in the counts, never in the letter. */
const LETTER = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  touched: 'W',
} as const

/**
 * The directory prefix, so a long path ellipsises on its directory and keeps its name.
 *
 * ⚠️ The NAME half is `basenameOf` from `lib/paths.ts` rather than a second `lastIndexOf` (review):
 * the local copy differed from the shared one on a trailing slash — `basenameOf('src/foo/')` is
 * `'foo'`, the local `nameOf('src/foo/')` was `''` — so a row for such a path rendered a blank
 * filename here while the rail and the header rendered it correctly. That is drift that had already
 * happened, not drift that might.
 */
function dirOf(path: string): string {
  const name = basenameOf(path)
  const cut = path.lastIndexOf(name)
  return cut <= 0 ? '' : path.slice(0, cut)
}

/**
 * Why a row cannot be opened — stated on the row, never left as a chevron that does nothing.
 *
 * ⚠️ Three different sentences, because they are three different facts (review found two of them
 * collapsed): the file's own diff was too big; the diff would have fit but the report was long and
 * the budget went to the files ahead of it; or the provider never sent a diff at all, which is every
 * Claude row.
 */
function whyClosed(row: ChangeRow): string {
  if (row.oversize) return 'large diff — open in editor'
  if (row.crowdedOut) return 'diff not kept — long report'
  return 'no diff reported'
}

/**
 * 🔴 **Everything this row says, on the row, because the row is where a pointer lands** (541).
 *
 * ⛔ **`531`'s ruling for a string whose LENGTH a person does not control:** a cut WITHOUT a title
 * is a sentence nobody can get to; a cut WITH one is a layout decision. ⚠️ The sensor measured
 * this pane as the only surface in the drawer drawing text that is cut and recoverable nowhere —
 * a file NAME short by 85.59 px at the shipped `--drawer-w`, and a path column squeezed to 0 px at
 * `--drawer-w-narrow` when the row's tag is long.
 *
 * ⚑ **The tag is in here as well as the path**, because the tag is `nowrap` in the same squeezed
 * row and says the one thing a person cannot otherwise find out: why this row will not open.
 * ⛔ **It is composed from the same three helpers the template branches on** — `row.status`,
 * {@link isNetUnchanged}, {@link whyClosed} — and a dom test asserts, per row kind, that the title
 * contains exactly what the row DREW. ⚠️ That test is the only thing binding them; without it this
 * is a second decision about what a row says.
 */
function rowTitle(row: ChangeRow): string {
  const tag =
    row.status === 'deleted'
      ? 'deleted'
      : isNetUnchanged(row)
        ? 'net unchanged'
        : expandable(row)
          ? null
          : whyClosed(row)
  return tag === null ? row.path : `${row.path} — ${tag}`
}

/** The banner over an expanded diff, for the two §3 cases that need one. */
const banner = computed(() => {
  const row = openDiff.value?.row
  if (!row) return { text: '', level: 'quiet' as const }
  if (row.status === 'deleted')
    return {
      text: 'This file was deleted. The diff below is the change that was recorded; there is nothing on disk to revert to.',
      level: 'warn' as const,
    }
  if (isNetUnchanged(row))
    return {
      text: 'Written and then reverted within this conversation — the net change is empty. Shown so a write you may care about is not silent.',
      level: 'quiet' as const,
    }
  return { text: '', level: 'quiet' as const }
})

/** The deferred foot's reason, from the capability rather than from prose written here. */
const why = computed(() => {
  const capability = props.capability
  if (!capability) return 'Rewind writes to your files. Not wired.'
  return capability.state === 'available' ? (capability.note ?? '') : capability.reason
})

/**
 * Proportion of the diffstat bar that is additions, per row. Absent counts draw no bar at all.
 *
 * ⚠️ A Map built once per render rather than a function the template calls twice per row (review) —
 * the second call was recomputing the same number purely to derive `100 - it`.
 */
const bars = computed(() => {
  const out = new Map<string, number>()
  for (const row of rows.value) {
    if (row.added === undefined || row.removed === undefined) continue
    const total = row.added + row.removed
    if (total > 0) out.set(row.path, Math.round((row.added / total) * 100))
  }
  return out
})
</script>

<template>
  <section class="changes" data-cy="session-changes" :style="ROLE_PROPERTIES">
    <p class="note">
      What this conversation did to your working tree — the files the agent <b>touched</b>,
      consolidated from its edits. Collapsed by default; expand one to read its diff.
    </p>

    <div v-if="!blank" class="head">
      <div class="summary">
        <span class="files" data-cy="changes-files">
          {{ rows.length }} file{{ rows.length === 1 ? '' : 's' }}
          <template v-if="showUndisclosed"> · {{ set.underDisclosed }} unknown </template>
        </span>
        <span class="agg" data-cy="changes-totals">
          <span v-if="sum.added" class="pos">+{{ sum.added }}</span>
          <span v-if="sum.removed" class="neg">−{{ sum.removed }}</span>
        </span>
      </div>
      <div class="scope" role="group" aria-label="Scope">
        <button
          type="button"
          :class="{ on: scope === 'turn' }"
          data-cy="changes-scope-turn"
          @click="setScope('turn')"
        >
          This turn
        </button>
        <button
          type="button"
          :class="{ on: scope === 'conversation' }"
          data-cy="changes-scope-conversation"
          @click="setScope('conversation')"
        >
          Whole conversation
        </button>
      </div>
    </div>

    <!-- Rows the provider named beyond the cap. Stated, never silently truncated (092 §4). -->
    <p v-if="set.dropped" class="observed" data-cy="changes-dropped">
      {{ set.dropped }} more file{{ set.dropped === 1 ? '' : 's' }} were reported than this pane
      keeps rows for. They are not listed.
    </p>

    <!-- ⛔ **Observations this conversation has stopped holding** (299 §2, from 297 finding 5).
         Reports, not files: what a window release let go of is exactly what can no longer be named,
         and a file count here would be invented. Before this dispatch the release took the whole
         log without a word, so the pane said "no file changes in this conversation" about a
         conversation that had demonstrably changed files. -->
    <p v-if="set.droppedReports" class="observed" data-cy="changes-released">
      {{ set.droppedReports }} earlier report{{ set.droppedReports === 1 ? '' : 's' }} from this
      conversation {{ set.droppedReports === 1 ? 'is' : 'are' }} no longer held — the files they
      named are not in the list below.
    </p>

    <div v-if="blank" class="empty" data-cy="changes-empty">
      <div class="ring"></div>
      <p class="t">
        {{
          scope === 'turn' ? 'No file changes in this turn' : 'No file changes in this conversation'
        }}
      </p>
      <p class="s">
        When the agent edits, adds, or removes a file, it appears here — consolidated across the
        whole conversation.
      </p>
    </div>

    <div v-else class="list">
      <div
        v-for="row in rows"
        :key="row.path"
        class="file"
        :class="{ open: expanded === row.path }"
      >
        <button
          class="row"
          type="button"
          :disabled="!expandable(row)"
          :data-cy="`changes-row-${row.path}`"
          :title="rowTitle(row)"
          @click="toggle(row)"
        >
          <svg class="icon chev" :class="{ hidden: !expandable(row) }">
            <use href="#i-chevron" />
          </svg>
          <span class="st" :class="`st-${row.status}`" :title="row.status">{{
            LETTER[row.status]
          }}</span>
          <span class="path">
            <span class="dir">{{ dirOf(row.path) }}</span>
            <span class="name">{{ basenameOf(row.path) }}</span>
          </span>
          <span class="meta">
            <span v-if="row.status === 'deleted'" class="tag deleted">deleted</span>
            <span v-else-if="isNetUnchanged(row)" class="tag">net unchanged</span>
            <template v-else>
              <span v-if="bars.has(row.path)" class="stat" data-cy="changes-stat">
                <i class="a" :style="{ width: `${bars.get(row.path)}%` }"></i>
                <i class="d" :style="{ width: `${100 - (bars.get(row.path) ?? 0)}%` }"></i>
              </span>
              <span v-if="row.added || row.removed" class="counts">
                <span v-if="row.added" class="pos">+{{ row.added }}</span>
                <span v-if="row.removed" class="neg">−{{ row.removed }}</span>
              </span>
              <span v-if="!expandable(row)" class="tag quiet">{{ whyClosed(row) }}</span>
            </template>
          </span>
        </button>
        <div v-if="openDiff?.row.path === row.path" class="body">
          <DiffBody
            :source="openDiff.source"
            :filename="row.path"
            :banner="banner.text"
            :banner-level="banner.level"
          />
        </div>
      </div>

      <!--
        §3 · a change we know happened and were not told the contents of. ⚠️ ONE row for however many
        there were, with no path and no count — the numbers are on the row deliberately as a COUNT of
        occurrences, which is a thing we observed, and not as file counts, which we did not.
      -->
      <div v-if="showUndisclosed" class="file">
        <div class="row partial" data-cy="changes-under-disclosed">
          <span class="chev hidden"></span>
          <span class="st unknown">?</span>
          <span class="path"><span class="name">content not reported</span></span>
        </div>
        <p class="partial-note" data-cy="changes-under-disclosed-note">
          {{ undisclosedLine }} without the provider naming the files. They arrive on the change
          item, not on the approval. We will not invent a path or a count.
        </p>
      </div>
    </div>

    <div class="defer">
      <button class="act" type="button" disabled data-cy="changes-revert">
        <svg class="icon"><use href="#i-revert" /></svg>
        Revert these changes…
      </button>
      <p class="why" data-cy="changes-revert-why">
        <b>Deferred.</b> Rewind <b>writes to your files</b> — more than compaction, which only
        forgets. {{ why }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.changes {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.note {
  margin: 0;
  padding: var(--space-5) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: 1.55;
}

.note b {
  color: var(--text-soft);
  font-weight: var(--fw-semibold);
}

.head {
  padding: var(--space-6) var(--space-7) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
}

/*
 * ⛔ **The ONE size on this tab that is not a role** (541), and it is listed as such:
 * `CHANGES_OFF_THE_SCALE` in `lib/drawer-tab-roles.ts` names it, the roster test requires it to be
 * strictly larger than `prose`, and the completeness walk counts it — an escape hatch that is
 * enumerated is not an escape hatch. ⚠️ **`--text-lg` is the scale's own *panel / section H2***;
 * the five roles stop at `prose` and none of them is a heading, so the alternatives were to shrink
 * the count a person reads first or to add a role three other surfaces would inherit.
 */
.summary {
  display: flex;
  align-items: baseline;
  color: var(--text);
  font-size: var(--type-reading);
  font-weight: var(--fw-semibold);
  gap: var(--space-4);
  letter-spacing: var(--tracking-tight);
}

.summary .files {
  font-variant-numeric: tabular-nums;
}

.agg {
  margin-left: auto;
  font: var(--fw-semibold) var(--role-value) / 1 var(--font-mono);
}

.pos {
  color: var(--success);
}

.neg {
  margin-left: var(--space-3);
  color: var(--danger);
}

.scope {
  display: inline-flex;
  margin-top: var(--space-5);
  padding: var(--space-1);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-1);
  gap: var(--space-1);
}

.scope button {
  height: 22px;
  padding: 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--muted);
  font-size: var(--role-label);
  font-weight: var(--fw-semibold);
}

.scope button.on {
  background: var(--accent-fill);
  color: var(--accent-text);
  box-shadow: inset 0 0 0 var(--border-width) var(--accent-border-weak);
}

.observed {
  margin: 0;
  padding: var(--space-5) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--wash-1);
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: 1.55;
}

/* 081's faceless dashed ring. Never a zero. */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-12) var(--space-9) var(--space-13);
  gap: var(--space-5);
  text-align: center;
}

.ring {
  width: 46px;
  height: 46px;
  border: 1.5px dashed var(--faint); /* raw: glyph stroke, drawn at its own width */
  border-radius: var(--radius-pill);
}

.empty .t {
  margin: 0;
  color: var(--muted);
  font-size: var(--role-prose);
  font-weight: var(--fw-semibold);
}

/*
 * ⚠️ **541 · both halves of the empty state are `prose`, and the hierarchy is weight and colour.**
 * ⛔ The alternative — a heading one step above its own explanation — puts the sentence a person
 * came for BELOW the reading size to keep a gap that `--fw-semibold` and `--muted` already draw.
 * ⚑ `536` landed the same lesson one tab over: a surface quiet about the thing somebody came
 * looking for reads as *gone*, and this is the sentence a clean base shows on every first run.
 */
.empty .s {
  max-width: 250px;
  margin: 0;
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: 1.55;
}

.list {
  padding: var(--space-4) var(--space-5) var(--space-3);
}

.file {
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
}

.file + .file {
  margin-top: var(--space-1);
}

.file.open {
  border-color: var(--line);
  background: var(--wash-1);
}

.row {
  display: grid;
  width: 100%;
  align-items: center;
  padding: var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  gap: var(--space-4);
  grid-template-columns: 14px 18px minmax(0, 1fr) auto;
  text-align: left;
}

.row:hover:not(:disabled) {
  background: var(--wash-2);
}

.chev {
  width: 13px;
  height: 13px;
  color: var(--faint);
  transition: transform var(--dur-fast) var(--ease-out);
}

.chev.hidden {
  visibility: hidden;
}

.file.open .chev {
  transform: rotate(90deg);
}

.st {
  display: grid;
  width: 18px;
  height: 16px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--muted);
  font: var(--fw-bold) var(--role-value) / 1 var(--font-mono);
  place-items: center;
}

.st-added {
  border-color: var(--success-border);
  background: var(--success-bg);
  color: var(--success);
}

.st-modified {
  border-color: var(--accent-border);
  background: var(--accent-fill);
  color: var(--accent-text);
}

.st-deleted {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger);
}

/* `touched` and the unknown row share 081's dashed register — one vocabulary for "we don't know". */
.st-touched,
.st.unknown {
  border-style: dashed;
  background: transparent;
  color: var(--faint);
}

.path {
  display: flex;
  min-width: 0;
  align-items: baseline;
  overflow-x: hidden;
}

.dir {
  overflow: hidden;
  color: var(--faint);
  direction: rtl;
  font-family: var(--font-mono);
  font-size: var(--role-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * ⚠️ **541 · the size moved from `.path` onto the two spans, and that is not a tidy-up.** The
 * parent declared `--text-sm` and the NAME inherited it, so the name's size was a fact about its
 * container; ⛔ a roster entry for `.name` would then be measured on something no rule about names
 * had ever set. ⚑ Each half now declares its own role: the name is what the eye scans for
 * (`label`), the directory is where the file lives (`meta`) and is the half this pane sacrifices.
 */
.name {
  color: var(--text-soft);
  font-size: var(--role-label);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.file.open .name {
  color: var(--text);
}

.meta {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

/*
 * The diffstat track is `--wash-3`, NOT `--wash-4` — 086's catch, repeated by 092 because it is easy
 * to get wrong twice: `--wash-4` has no light-scope value, so on paper it inherits a near-transparent
 * white and the track disappears.
 */
.stat {
  display: flex;
  width: 46px;
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-bar);
  background: var(--wash-3);
  gap: 1px;
}

.stat i {
  height: 100%;
  display: block;
}

.stat .a {
  background: var(--success);
}

.stat .d {
  background: var(--danger);
}

.counts {
  font: var(--fw-semibold) var(--role-value) / 1 var(--font-mono);
  white-space: nowrap;
}

.tag {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-1);
  color: var(--muted);
  font: var(--fw-semibold) var(--role-meta) / 1 var(--font-mono);
  white-space: nowrap;
}

.tag.deleted {
  border-color: var(--danger-border);
  color: var(--danger);
}

.tag.quiet {
  border-style: dashed;
  background: transparent;
  color: var(--faint);
}

.row.partial {
  color: var(--faint);
  grid-template-columns: 14px 18px minmax(0, 1fr);
}

.row.partial .name {
  color: var(--faint);
  font-style: italic;
  font-weight: var(--fw-medium);
}

.partial-note {
  margin: 0;
  padding: 0 var(--space-4) var(--space-4) var(--space-20);
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: 1.5;
}

.body {
  padding: var(--space-3) var(--space-4) var(--space-4) 36px;
}

.defer {
  padding: var(--space-6) var(--space-7) var(--space-8);
  border-top: var(--border-width) solid var(--line);
  margin-top: auto;
}

.act {
  display: flex;
  width: 100%;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-1);
  color: var(--faint);
  cursor: not-allowed;
  font-size: var(--role-label);
  font-weight: var(--fw-semibold);
  gap: var(--space-4);
}

.act .icon {
  width: 13px;
  height: 13px;
}

.why {
  margin: var(--space-4) 0 0;
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: 1.55;
}

.why b {
  color: var(--muted);
  font-weight: var(--fw-semibold);
}

@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
</style>
