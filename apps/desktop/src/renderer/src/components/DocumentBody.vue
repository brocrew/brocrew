<script setup lang="ts">
import { computed, ref } from 'vue'
import { renderMarkdown } from '../lib/markdown'

/**
 * A document, on paper.
 *
 * THE one place a document is rendered — a kept resource, the plan in the transcript, a
 * workflow run's output, a child's journal or script, and a conversation's rules in its drawer.
 * That is the point: a document cannot read one way on one surface and another way on the next,
 * because every surface is this component reading the same field.
 *
 * The paper is a deliberate light island in a dark app, at the PO's request: chrome stays dark,
 * the document is on white, because that is what a document looks like. The Markdown/Raw toggle is
 * the other half of the rule — rendered to read, raw to check what was actually written, and never
 * a rendering you cannot get behind.
 */
const props = withDefaults(
  defineProps<{
    /** The markdown source. Rendered in one view, shown verbatim in the other. */
    source: string
    /** What the document is called, shown on the paper's toolbar. */
    filename?: string
    /** Start on the raw source instead of the rendered document. */
    raw?: boolean
    /** A short preview rather than a full read — caps the height and scrolls. */
    compact?: boolean
    /**
     * 🔴 **635 · this file is NOT Markdown, so there is no Markdown view of it** (`HO-097` §1.3).
     *
     * ⛔ **The toggle is removed rather than merely defaulted to raw.** ⚠️ Rendering an HTML page
     * through the Markdown renderer is SAFE — `html: false` is that module's *"whole security
     * story"* and every tag arrives escaped — ⚑ but it is not a view of the document: it is the
     * source with some characters eaten, offered under a word that promises a rendering.
     * `a-closed-vocabulary-guards-what-a-member-says`, at a segmented control.
     */
    sourceOnly?: boolean
  }>(),
  { filename: 'Document', raw: false, compact: false, sourceOnly: false },
)

const view = ref<'markdown' | 'raw'>(props.raw || props.sourceOnly ? 'raw' : 'markdown')
const rendered = computed(() => renderMarkdown(props.source))
</script>

<template>
  <!-- ⛔ **`data-on-white`, and it is 126's mechanism on the last paper that did not have it**
       (tokens.css §14). This paper is `--paper-*` in BOTH themes by design — but it was not an
       ISLAND, so in the default dark theme it kept the app's ambient chrome tokens on top of the
       paper palette. Measured in Chromium, on every surface it drew at the time: `color-scheme: dark` on a
       white page, `--focus-ring-color` at **1.64:1** where WCAG's minimum for a focus indicator is
       3:1, and — in a drawer — a `rgba(255,255,255,.12)` scrollbar thumb inherited onto white.
       The same gesture read 6.07:1 in light and 5.54:1 one `v-else-if` away, inside the paper that
       DID get 126's scope: a 3.4× difference decided only by which `part` the caller asked for.

       Use `data-on-white` as in `ChildWorkViewer` to identify a paper surface independently of the ambient theme. Avoid adding a second `data-chat-theme` carrier.

       **The surfaces this component draws** — a kept resource, the plan document in the
       transcript, a workflow run's output, a child's journal or script, and a conversation's rules
       in its drawer. Every one takes the paper whole, so every one takes the island. -->
  <div
    class="doc-paper"
    :class="{ compact }"
    data-on-white
    data-cy="document-body"
    :data-view="view"
  >
    <div class="doc-toolbar">
      <span class="lbl">{{ filename }}</span>
      <span class="seg-group">
        <button
          v-if="!sourceOnly"
          class="seg"
          :class="{ on: view === 'markdown' }"
          type="button"
          data-cy="doc-view-markdown"
          @click="view = 'markdown'"
        >
          Markdown
        </button>
        <button
          class="seg"
          :class="{ on: view === 'raw' }"
          type="button"
          data-cy="doc-view-raw"
          @click="view = 'raw'"
        >
          Raw
        </button>
      </span>
    </div>
    <div class="doc-content">
      <!-- eslint-disable-next-line vue/no-v-html -- markdown-it runs with `html: false`, so this
           string cannot contain markup from the source; see lib/markdown.ts. -->
      <div v-if="view === 'markdown'" class="md-doc" data-cy="doc-rendered" v-html="rendered"></div>
      <pre v-else class="view-raw" data-cy="doc-raw">{{ source }}</pre>
    </div>
  </div>
</template>

<style scoped>
.doc-paper {
  position: relative;
  overflow: hidden;
  border: var(--border-width) solid var(--paper-line);
  border-radius: var(--radius-paper);
  background: var(--paper-bg);
  box-shadow: var(--paper-shadow);
  color: var(--paper-ink);
  /* ⚠️ **Declared here even though the island already sets `color-scheme: light`, and a drawer is
     why.** `scrollbar-color` INHERITS as an already-substituted value: the conversation drawer's
     `.drawer-body` writes `var(--scrollbar-thumb)` on the ancestor, the var resolves THERE, and the
     paper inherits `rgba(255, 255, 255, 0.12)` — a white thumb on a white code block — whatever
     scope it is in.
     A colour scheme cannot override an explicit colour. Re-declaring it inside the island is what
     makes the var resolve on paper, and the same inheritance then carries it down to the two
     elements that actually scroll: `.doc-content` when compact, and a wide `pre`. Measured when this
     was written: every surface outside a drawer read `auto` and is fixed by the scheme alone; a
     drawer is what needed this line.

     ⛔ **No `scrollbar-width` beside it, and that is the difference between the two properties
     rather than an omission.** Every other site in this app pairs them — but every other site is a
     scroll CONTAINER, and this element is `overflow: hidden` and never scrolls. `scrollbar-width`
     does not inherit (`scrollbar-color` does), so a `thin` here would reach neither scroller and
     would be a dead declaration that read like a fix. The paper's scrollbars keep the platform
     width they already had; only their colour was wrong. */
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.doc-toolbar {
  display: flex;
  align-items: center;
  padding: var(--space-4) var(--space-5) var(--space-4) var(--space-6);
  border-bottom: var(--border-width) solid var(--paper-line);
  background: var(--paper-bar);
  gap: var(--space-4);
}

.lbl {
  overflow: hidden;
  color: var(--paper-muted);
  font: var(--fw-heavy) var(--type-caption) / 1 var(--font-mono);
  letter-spacing: var(--tracking-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seg-group {
  display: inline-flex;
  margin-left: auto;
  padding: var(--space-1);
  border: var(--border-width) solid var(--paper-line);
  border-radius: var(--radius-seg-group);
  background: var(--paper-seg-bg);
}

.seg {
  display: inline-flex;
  height: 22px;
  align-items: center;
  padding: 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-seg);
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

.doc-content {
  padding: var(--space-9) var(--space-10) var(--space-10);
}

.compact .doc-content {
  max-height: 320px;
  overflow: auto;
  padding: var(--space-6) var(--space-7);
}

/* The rendered document. Deep, because the HTML comes from the markdown renderer. */
.md-doc :deep(h1) {
  margin: 0 0 var(--space-5);
  color: var(--paper-ink);
  font-size: var(--type-heading);
  font-weight: var(--fw-heavy);
  letter-spacing: -0.01em;
}

.md-doc :deep(h2) {
  margin: var(--space-8) 0 var(--space-3);
  color: var(--paper-ink2);
  font-size: var(--type-body);
  font-weight: var(--fw-heavy);
}

.md-doc :deep(h3) {
  margin: var(--space-6) 0 var(--space-2);
  color: var(--paper-ink2);
  font-size: var(--type-body);
  font-weight: var(--fw-heavy);
}

.md-doc :deep(p),
.md-doc :deep(li) {
  color: var(--paper-ink2);
  font-size: var(--type-body);
  line-height: 1.6;
}

.md-doc :deep(p) {
  margin: 0 0 var(--space-4);
}

.md-doc :deep(ul),
.md-doc :deep(ol) {
  margin: 0 0 var(--space-4);
  padding-left: var(--space-9);
}

.md-doc :deep(strong) {
  color: var(--paper-ink-strong);
}

.md-doc :deep(code) {
  padding: 0 3px;
  border-radius: var(--radius-code-inline);
  background: var(--paper-code-bg);
  color: var(--paper-ink);
  font: var(--type-small) / 1.5 var(--font-mono);
}

.md-doc :deep(pre) {
  padding: var(--space-5);
  border-radius: var(--radius-sm);
  background: var(--paper-code-bg);
  overflow-x: auto;
}

.md-doc :deep(a) {
  color: var(--paper-link);
}

.view-raw {
  margin: 0;
  color: var(--paper-ink2);
  font: var(--type-small) / 1.65 var(--font-mono);
  white-space: pre-wrap;
}
</style>
