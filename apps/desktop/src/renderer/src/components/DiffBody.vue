<script setup lang="ts">
import { computed, ref } from 'vue'
import { ROLE_PROPERTIES } from '../lib/text-roles'

/**
 * A diff, on paper (096 — 092's §5 ruling made real).
 *
 * **A diff is file content, so it borrows the paper. It is not a document, so it does not borrow the
 * toggle.** `DocumentBody.vue` is a white island in dark chrome because that is what a document looks
 * like, and a diff gets the same island for the same reason. What it does not get is Markdown/Raw:
 * that toggle asks *"rendered prose, or the source behind it?"*, and a diff has no prose — rendering
 * its `+`/`−` as markdown would destroy the gutter that makes it a diff. Its real axis is **Unified /
 * Split**, so it is a SIBLING viewer rather than a mode of that one.
 *
 * ⚠️ This does not re-open the document-viewer standard. Documents keep Markdown/Raw; a diff simply
 * is not one of them.
 */
const props = withDefaults(
  defineProps<{
    /** The per-file unified diff, verbatim as the provider sent it. */
    source: string
    /** The file this diff is of, shown on the paper's toolbar. */
    filename?: string
    /** A banner above the diff — the deleted-since and net-unchanged cases (092 §3). */
    banner?: string
    /** Draw the banner in the alarming register rather than the quiet one. */
    bannerLevel?: 'quiet' | 'warn'
  }>(),
  { filename: 'diff', banner: '', bannerLevel: 'quiet' },
)

const view = ref<'unified' | 'split'>('unified')

/** One rendered line of the diff. `hunk` is the `@@` header, which is chrome rather than content. */
interface Line {
  kind: 'hunk' | 'add' | 'del' | 'ctx'
  text: string
  /** Line number in the OLD file, blank on an insertion. */
  old: string
  /** Line number in the NEW file, blank on a deletion. */
  now: string
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Walk the diff into lines, counting the two line numbers as it goes.
 *
 * ⚠️ **The numbers come from the `@@` header, not from a counter that starts at 1.** A diff shows
 * hunks, not files: the second hunk of a file might start at line 340, and numbering it 12 would be a
 * plausible wrong answer of exactly the kind this pane exists to avoid. A malformed or absent header
 * leaves the numbers BLANK rather than guessing.
 */
const lines = computed<Line[]>(() => {
  const out: Line[] = []
  let old = 0
  let now = 0
  let numbering = false
  for (const text of props.source.split('\n')) {
    const hunk = HUNK.exec(text)
    if (hunk) {
      old = Number(hunk[1])
      now = Number(hunk[2])
      numbering = true
      out.push({ kind: 'hunk', text, old: '', now: '' })
      continue
    }
    if (text.startsWith('+')) {
      out.push({ kind: 'add', text: text.slice(1), old: '', now: numbering ? String(now++) : '' })
    } else if (text.startsWith('-')) {
      out.push({ kind: 'del', text: text.slice(1), old: numbering ? String(old++) : '', now: '' })
    } else {
      const body = text.startsWith(' ') ? text.slice(1) : text
      out.push({
        kind: 'ctx',
        text: body,
        old: numbering ? String(old++) : '',
        now: numbering ? String(now++) : '',
      })
    }
  }
  // A trailing newline in the payload becomes one empty context line that renders as a blank row.
  while (out.length && out[out.length - 1]!.kind === 'ctx' && out[out.length - 1]!.text === '')
    out.pop()
  return out
})

/** Split view: the same lines, in two columns. An insertion has no left side and vice versa. */
const pairs = computed(() =>
  lines.value.map((line) => ({
    line,
    left: line.kind === 'add' ? null : line,
    right: line.kind === 'del' ? null : line,
  })),
)
</script>

<template>
  <div class="diff-paper" data-cy="diff-body" :data-view="view" :style="ROLE_PROPERTIES">
    <div class="diff-bar">
      <span class="lbl" :title="filename">{{ filename }}</span>
      <span class="seg-group">
        <button
          class="seg"
          :class="{ on: view === 'unified' }"
          type="button"
          data-cy="diff-view-unified"
          @click="view = 'unified'"
        >
          Unified
        </button>
        <button
          class="seg"
          :class="{ on: view === 'split' }"
          type="button"
          data-cy="diff-view-split"
          @click="view = 'split'"
        >
          Split
        </button>
      </span>
    </div>
    <div class="diff-scroll">
      <p v-if="banner" class="diff-banner" :class="bannerLevel" data-cy="diff-banner">
        {{ banner }}
      </p>
      <template v-if="view === 'unified'">
        <div
          v-for="(line, index) in lines"
          :key="index"
          class="dl"
          :class="line.kind"
          data-cy="diff-line"
        >
          <span class="ln">{{ line.old }}</span>
          <span class="ln">{{ line.now }}</span>
          <span class="gut">{{ line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : '' }}</span>
          <span class="lc">{{ line.text }}</span>
        </div>
      </template>
      <template v-else>
        <template v-for="(pair, index) in pairs" :key="index">
          <!-- ⚠️ **The hunk header spans both columns rather than being dropped** (review). The first
               version blanked it in Split, so a diff of three hunks 200 lines apart read as one
               continuous run of code — the @@ line is the only thing saying where in the file you
               are, and Unified showed it while Split silently did not. -->
          <div v-if="pair.line.kind === 'hunk'" class="ds hunk" data-cy="diff-line">
            <span class="lc span-all">{{ pair.line.text }}</span>
          </div>
          <div v-else class="ds" :class="pair.line.kind" data-cy="diff-line">
            <span class="ln">{{ pair.left?.old ?? '' }}</span>
            <span class="lc" :class="pair.left?.kind === 'del' ? 'del' : ''">{{
              pair.left ? pair.left.text : ''
            }}</span>
            <span class="ln">{{ pair.right?.now ?? '' }}</span>
            <span class="lc" :class="pair.right?.kind === 'add' ? 'add' : ''">{{
              pair.right ? pair.right.text : ''
            }}</span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* The diff is always paper. Its invariant added/removed colours live in tokens.css,
 * alongside the paper palette, so both chrome and light hosts use readable ink. */
.diff-paper {
  overflow: hidden;
  border: var(--border-width) solid var(--paper-line);
  border-radius: var(--radius-md);
  background: var(--paper-bg);
  box-shadow: var(--paper-shadow);
  color: var(--paper-ink);
}

.diff-bar {
  display: flex;
  height: 30px;
  align-items: center;
  padding: 0 var(--space-4) 0 var(--space-6);
  border-bottom: var(--border-width) solid var(--paper-line);
  background: var(--paper-bar);
  gap: var(--space-4);
}

.lbl {
  min-width: 0;
  overflow: hidden;
  color: var(--paper-ink2);
  direction: rtl;
  font: var(--fw-semibold) var(--type-caption) / 1 var(--font-mono);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seg-group {
  display: inline-flex;
  flex: 0 0 auto;
  margin-left: auto;
  padding: var(--space-1);
  border: var(--border-width) solid var(--paper-line);
  border-radius: var(--radius-xs);
  background: var(--paper-seg-bg);
}

.seg {
  display: inline-flex;
  height: 18px;
  align-items: center;
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-seg-tight);
  background: transparent;
  color: var(--paper-muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
}

.seg:hover {
  color: var(--paper-ink);
}

.seg.on {
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

.diff-scroll {
  max-height: 230px;
  overflow: auto;
  background: var(--paper-bg);
}

/*
 * 🔴 **541 · the ONE rule in this file that names a role, and the reason it is the only one.**
 *
 * ⛔ **This sentence is not the diff's.** `SessionChanges` composes it — *"This file was deleted …
 * there is nothing on disk to revert to"* — and hands it over as a prop; it is a caveat about what
 * a revert cannot undo, which is the same subject as that tab's deferred foot, and it was at 8 px
 * for the same reason (`514` F1). ⚑ So it wears `prose` from `lib/text-roles.ts` and is classified
 * by `CHANGES_TEXT`.
 *
 * ⚠️ **Everything BELOW stays on its own tokens, deliberately.** A diff is a CODE reading surface
 * whose density is its own question — `DocumentBody`'s `.view-raw` is the standard to grade it
 * against — and putting this vocabulary in charge of a gutter would make a bounded token dispatch
 * into a redesign of a viewer. Named as a finding, not taken.
 */
.diff-banner {
  margin: 0;
  padding: var(--space-4) var(--space-6);
  border-bottom: var(--border-width) solid var(--paper-line);
  background: var(--paper-code-bg);
  color: var(--paper-muted);
  font-size: var(--role-prose);
  line-height: 1.5;
}

.diff-banner.warn {
  background: var(--diff-del-bg);
  color: var(--diff-del-edge);
}

.dl {
  display: grid;
  font: var(--type-caption) / 1.65 var(--font-mono);
  grid-template-columns: 30px 30px 12px minmax(0, 1fr);
}

.ln {
  padding-right: var(--space-3);
  color: var(--paper-muted);
  opacity: 0.7;
  text-align: right;
  user-select: none;
}

.gut {
  color: var(--paper-muted);
  text-align: center;
  user-select: none;
}

.lc {
  overflow: hidden;
  padding-right: var(--space-5);
  color: var(--paper-ink);
  white-space: pre;
}

.dl.hunk {
  border-top: var(--border-width) solid var(--paper-line);
  border-bottom: var(--border-width) solid var(--paper-line);
  background: var(--paper-code-bg);
}

.dl.hunk .lc {
  padding-left: var(--space-3);
  color: var(--paper-muted);
}

.dl.add {
  background: var(--diff-add-bg);
  box-shadow: inset var(--border-accent-width) 0 0 var(--diff-add-edge);
}

.dl.add .gut {
  color: var(--diff-add-edge);
}

.dl.del {
  background: var(--diff-del-bg);
  box-shadow: inset var(--border-accent-width) 0 0 var(--diff-del-edge);
}

.dl.del .gut {
  color: var(--diff-del-edge);
}

/* Split: old on the left, new on the right, one row per line of the unified walk. */
.ds {
  display: grid;
  font: var(--type-caption) / 1.65 var(--font-mono);
  grid-template-columns: 26px minmax(0, 1fr) 26px minmax(0, 1fr);
}

.ds.hunk {
  border-top: var(--border-width) solid var(--paper-line);
  border-bottom: var(--border-width) solid var(--paper-line);
  background: var(--paper-code-bg);
}

.span-all {
  padding-left: var(--space-3);
  color: var(--paper-muted);
  grid-column: 1 / -1;
}

.ds .lc.del {
  background: var(--diff-del-bg);
  box-shadow: inset var(--border-accent-width) 0 0 var(--diff-del-edge);
}

.ds .lc.add {
  background: var(--diff-add-bg);
  box-shadow: inset var(--border-accent-width) 0 0 var(--diff-add-edge);
}
</style>
