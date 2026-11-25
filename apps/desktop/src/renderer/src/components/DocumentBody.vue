<script setup lang="ts">
import { computed, ref } from 'vue'
import { renderMarkdown } from '../lib/markdown'
import PaperSheet from './PaperSheet.vue'
import SegmentedControl from './SegmentedControl.vue'

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
const views = computed(() => [
  ...(props.sourceOnly
    ? []
    : [{ value: 'markdown', label: 'Markdown', cy: 'doc-view-markdown' } as const]),
  { value: 'raw', label: 'Raw', cy: 'doc-view-raw' } as const,
])
const rendered = computed(() => renderMarkdown(props.source))
</script>

<template>
  <!-- The paper is an island whatever the theme, for every surface this draws: a kept resource,
       the plan in the transcript, a workflow run's output, a child's journal or script, and a
       conversation's rules in its drawer. -->
  <PaperSheet
    flush
    class="doc-paper"
    :class="{ compact }"
    data-cy="document-body"
    :data-view="view"
  >
    <div class="doc-toolbar">
      <span class="lbl">{{ filename }}</span>
      <SegmentedControl v-model="view" class="views" tone="paper" :options="views" />
    </div>
    <div class="doc-content">
      <!-- eslint-disable-next-line vue/no-v-html -- markdown-it runs with `html: false`, so this
           string cannot contain markup from the source; see lib/markdown.ts. -->
      <div v-if="view === 'markdown'" class="md-doc" data-cy="doc-rendered" v-html="rendered"></div>
      <pre v-else class="view-raw" data-cy="doc-raw">{{ source }}</pre>
    </div>
  </PaperSheet>
</template>

<style scoped>
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

.views {
  margin-left: auto;
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
</style>
