<script setup lang="ts">
import { fileManagerHere } from '../lib/this-computer'
import { computed, ref, watch } from 'vue'
import type {
  KeptFile,
  ResourceDrawing,
  ResourceReading,
  ResourceReveal,
} from '../../../shared/runtime-ipc'
import type { DocumentForm } from '../../../shared/documents'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { FORM_WORD, sizeWords, whereFrom } from '../lib/files-kept'
import type { ResourceRevealer } from '../lib/opening-a-document'
import DocumentBody from './DocumentBody.vue'
import KeptFileDrawing from './KeptFileDrawing.vue'

/**
 * 🔴 **One resource, read in full by the person whose row named it** (510; a resource since D-016).
 *
 * ⚑ **It borrows the paper AND the toggle, which is the standard rather than a styling choice.**
 * A resource is a file a worker handed in to be read, so a text form takes {@link DocumentBody}
 * whole — Markdown to read, Raw to check what was actually written. `WorkflowOutputViewer`'s own
 * ruling (107 §4), one subject over, and this is the same kind of thing: one fetched artefact,
 * addressed by an id, with nothing to poll and nothing to send.
 *
 * ⛔ **Markdown-first, unlike a workflow's output** — ⚠️ **and that is true of ONE form rather than
 * of every resource.** `HO-097` §1 widened what is kept to pages, images and PDFs, so the branch is
 * on {@link ResourceReading.form}, which main derives from the kept name.
 *
 * ## 🔴 And viewing NEVER executes — `HO-097` §1.3, which is not a preference
 *
 * ⛔ **A page is shown as SOURCE and by one mechanism**: the only text renderer this panel mounts is
 * {@link DocumentBody}, whose markdown module is configured `html: false` — its own note calls that
 * *"the whole security story"* — so every tag in an agent-written page arrives as escaped text.
 * ⚠️ **No `webview`, no `v-html` and no `srcdoc` on this path**, and
 * `a-conversation-a-person-can-read`'s own suite is not the only thing that says so: `635`'s plants
 * a hostile document and measures that nothing ran.
 *
 * 🔴 **D-032 · a kept picture or PDF is DRAWN**, by {@link KeptFileDrawing} alone: a picture as an
 * `<img>`, a PDF in Chromium's own viewer, from main's bytes and type. Its docblock holds the rules.
 * ⚑ Show in Finder is offered for any file this app keeps, by its id.
 *
 * ⚠️ **The chrome — Esc, the backdrop, the focus trap, focus returned — belongs to `OverlayHost`**,
 * which wraps this. Nothing here re-implements any of it, exactly as `WorkflowOutputViewer` and
 * `ImageViewer` do not.
 *
 * ## ⛔ Where the bytes come from
 *
 * ⚑ This panel draws a row of the app's own `work_resource` table, fetched through main's door and
 * hash-re-checked on the way out — never a fixture.
 */
const props = defineProps<{
  /**
   * ⚑ The id the press named — what Show in Finder asks by, even when the read refused. Absent, the
   * read's own id.
   */
  resourceId?: string
  result: ResourceReading
  /**
   * 🔴 **D-032 · a kept picture or PDF, as main handed it to be drawn** — or why not. ⛔ `null` where
   * the file is text, or the surface gave no door to draw by: then the file is told about, not drawn.
   */
  drawing?: ResourceDrawing | null
  /** ⚑ **D-032 · Show in Finder**, by the id. ⛔ Absent, no button is drawn. */
  reveal?: ResourceRevealer
  /**
   * ⚑ **UI-002 · the row the press was drawn from** (`07` §3) — its title, who made it or handed it
   * over, for which piece and when. ⛔ Absent where the press had no row: the header then says what
   * the read itself says.
   */
  file?: KeptFile | null
}>()

/** ⚑ The row's facts — only while it names the file this panel read. */
const told = computed(() => {
  const file = props.file ?? null
  return props.result.ok && file !== null && file.resourceId === props.result.resourceId
    ? file
    : null
})

const emit = defineEmits<{ close: [] }>()

/**
 * ⛔ **Why there is nothing to show — four causes, four sentences.**
 *
 * ⚠️ **`unreadable` says several things and promises none of them**, deliberately: a sentence
 * claiming *the file is gone* would be wrong about a file sitting right there — absent, not a plain
 * file, or not readable all reach this word. ⛔ A field that says the wrong quiet thing is worse
 * than one that admits it does not know.
 *
 * ⚑ **An id written before D-016 names no resource**, and reads as `no-such-resource`: the
 * documents it named are not kept any more.
 *
 * ⚑ **`changed` is the one a person can act on.** Main re-hashes on every read, so this is a fact
 * about the bytes rather than a failure of the app.
 */
const fileManager = fileManagerHere()

const REFUSAL: Record<string, string> = {
  'no-such-resource': 'This app is not keeping a file with that id.',
  'no-store': 'This app is not keeping a resources folder, so there is nothing to open.',
  unreadable:
    'This app keeps a file by that id and could not read it — it may have been moved, or replaced by something that is not a file.',
  changed:
    'The file is not the bytes that were kept. This app re-checks the hash on every read, and it did not match.',
}

/**
 * ⛔ **635 · what a person is told about a form this window holds and cannot draw.**
 *
 * ⚑ **It says the file is FINE** — kept and readable — and that the missing thing is this panel.
 * ⚠️ `452` §5.1's rule with the noun changed: a sentence that read *that file could not be opened*
 * would blame the file for a gap in the viewer.
 */
// ⚑ **731 · no pointer to the project folder.** Until `731` the image and PDF sentences ended *"— open
// the project folder to look at it"*: `HO-097`'s premise that an offered file sat there. It never
// was where the kept copy is (this app's own folder), and since `726`/`731` the folder a file is
// written in is a habit, never a condition (the PM, on `726` §9).
const NOT_DRAWN: Readonly<Record<DocumentForm, string>> = {
  markdown: 'This file is Markdown and is shown above.',
  page: 'This file is a page and its source is shown above.',
  image: 'This file is an image. It is kept, and this window cannot draw it yet.',
  pdf: 'This file is a PDF. It is kept, and this window cannot draw it yet.',
}

/**
 * 🔴 **D-032 · why a kept picture or PDF is not drawn**, in plain words, each saying what to do.
 * ⚑ Finder is offered where it can open what this window will not: a file too big to draw here, or
 * one whose bytes changed.
 */
const notDrawnSays = computed((): string | null => {
  const drawing = props.drawing ?? null
  if (drawing === null || drawing.ok) return null
  const finder = props.reveal !== undefined
  const kind = props.result.ok && props.result.form === 'pdf' ? 'a PDF' : 'an image'
  switch (drawing.reason) {
    case 'too-large':
      return `This file is ${sizeWords(drawing.bytes)}, more than this app draws (${sizeWords(drawing.mostBytes)}).${finder ? ` Try Show in ${fileManager} to open it.` : ''}`
    case 'too-many-pixels':
      return `This image is ${drawing.width} × ${drawing.height} pixels, more than this app draws (${Math.round(drawing.mostPixels / 1024 ** 2)} megapixels).${finder ? ` Show it in ${fileManager} to open it.` : ''}`
    case 'not-what-its-name-says':
      return `This file's name says it's ${kind}, but its contents aren't one, so it isn't drawn.`
    case 'not-a-picture-or-pdf':
      return "This file isn't an image or a PDF, so it isn't drawn."
    case 'changed':
      return `${REFUSAL.changed}${finder ? ` Show it in ${fileManager} to see what is there now.` : ''}`
    default:
      return REFUSAL[drawing.reason] ?? 'That file could not be opened.'
  }
})

/**
 * ⚑ **D-032 · Show in Finder, for any file this app keeps** — not for an id it keeps nothing by,
 * nor when it keeps no folder: there is nothing to show.
 */
const shownId = computed(
  () => props.resourceId ?? (props.result.ok ? props.result.resourceId : undefined),
)

const finderOffered = computed(
  () =>
    props.reveal !== undefined &&
    shownId.value !== undefined &&
    (props.result.ok || props.result.reason === 'changed' || props.result.reason === 'unreadable'),
)

/** What the last Show in Finder said, when it has something to say. */
const revealSaid = ref<string | null>(null)

watch(
  () => shownId.value,
  () => {
    revealSaid.value = null
  },
)

const REVEAL_SAYS: Record<Extract<ResourceReveal, { ok: false }>['reason'], string> = {
  'no-such-resource': REFUSAL['no-such-resource'] ?? '',
  'no-store': REFUSAL['no-store'] ?? '',
  gone: 'The file is no longer where this app kept it.',
  unreadable: `This app can't read the file where it keeps it, so ${fileManager} can't show it.`,
}

async function showInFinder(): Promise<void> {
  const reveal = props.reveal
  const asked = shownId.value
  if (reveal === undefined || asked === undefined) return
  revealSaid.value = null
  const said = await reveal(asked)
  if (asked !== shownId.value) return
  if (said.ok) {
    revealSaid.value = said.changed
      ? `Shown in ${fileManager}. It no longer matches what was kept.`
      : null
  } else revealSaid.value = REVEAL_SAYS[said.reason]
}
</script>

<template>
  <div class="doc-read" data-cy="canonical-document-viewer">
    <header class="viewer-head">
      <div class="heading">
        <!-- ⚑ **UI-002 · the file's title, first** (`07` §3) — its first heading, or its name. -->
        <strong v-if="told" class="title" data-cy="canonical-document-title" :title="told.title">{{
          told.title
        }}</strong>
        <!-- ⚑ **The FILE's name, its kind and size, and the id.** ⛔ Never the path: `380`'s rule,
             and the id is what a person can quote back into a conversation — it is the string the
             row's own body already names. -->
        <p v-if="result.ok" class="facts">
          <strong class="name" data-cy="canonical-document-name">{{ result.name }}</strong>
          <span data-cy="canonical-document-kind"
            >{{ FORM_WORD[result.form] }} · {{ sizeWords(result.bytes) }}</span
          >
          <span class="id" data-cy="canonical-document-id">{{ result.resourceId }}</span>
        </p>
        <strong v-else class="name">File</strong>
        <!-- ⚑ **UI-002 · who, for which piece, and when** — the row's; a read alone does not say. -->
        <p v-if="told" class="from" data-cy="canonical-document-from">
          {{ whereFrom(told) }} ·
          <span :title="fullTime(told.keptAt)">{{ clockTime(told.keptAt) }}</span>
        </p>
      </div>
      <!-- ⚑ D-032 · Show in the file manager, for any kept file: the id goes to main, and no path comes back. -->
      <button
        v-if="finderOffered"
        class="finder"
        type="button"
        data-cy="canonical-document-finder"
        @click="showInFinder"
      >
        <svg class="icon"><use href="#i-folder" /></svg>
        Show in {{ fileManager }}
      </button>
      <button
        class="icon-button"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </header>

    <p v-if="revealSaid" class="revealed" data-cy="canonical-document-revealed">{{ revealSaid }}</p>
    <!-- 🔴 **635 · the stage branches on the FORM** (`HO-097` §1.3: *"show each type the way a
         person expects"*). ⛔ **And viewing never executes**: text is rendered by `DocumentBody`
         alone, whose renderer is `html: false` — *"the whole security story"* — so a page arrives
         as escaped text and its script is characters on paper. -->
    <div v-if="result.ok && result.text !== null" class="stage">
      <DocumentBody
        :source="result.text"
        :filename="result.name"
        :source-only="result.form !== 'markdown'"
      />
    </div>
    <!-- 🔴 D-032 · a kept picture or PDF, drawn by the one component that may: see its docblock. -->
    <KeptFileDrawing
      v-else-if="result.ok && drawing?.ok && drawing.resourceId === result.resourceId"
      :drawing="drawing"
      :finder="reveal !== undefined"
    />
    <p v-else-if="result.ok && notDrawnSays" class="refusal" data-cy="canonical-document-undrawn">
      {{ notDrawnSays }}
    </p>
    <!-- ⚠️ **A form that encodes no text, and no door to draw it by.** ⛔ It is KEPT, its piece's
         record lists it, and every agent can read about it — this view says so rather than drawing
         an empty file. -->
    <p v-else-if="result.ok" class="refusal" data-cy="canonical-document-not-drawn">
      {{ NOT_DRAWN[result.form] }}
    </p>
    <p v-else class="refusal" data-cy="canonical-document-refusal">
      {{ REFUSAL[result.reason] ?? 'That file could not be opened.' }}
    </p>
  </div>
</template>

<style scoped>
/* `WorkflowOutputViewer`'s frame, to the declaration — two document panels that sat differently
   over the conversation would read as two different kinds of thing opening, which they are not.
   ⚠️ `--drawer-solid` and never `--surface-1`: that token was used twice and declared nowhere, and
   both document panels painted `transparent` over the transcript until `125` found it. */
.doc-read {
  display: flex;
  max-width: min(900px, 92vw);
  max-height: 88vh;
  flex-direction: column;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--drawer-solid);
}

.viewer-head {
  display: flex;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-4);
}

.heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
}

.title {
  overflow: hidden;
  color: var(--text);
  font-size: var(--type-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facts,
.from {
  display: flex;
  min-width: 0;
  margin: 0;
  flex-wrap: wrap;
  align-items: baseline;
  color: var(--muted);
  column-gap: var(--space-4);
  font-size: var(--type-caption);
}

.name {
  color: var(--text-soft);
  font-size: var(--type-caption);
  /* ⚠️ D-032 · an agent's file name may hold direction overrides: kept to itself, never spilling. */
  unicode-bidi: isolate;
}

.id {
  color: var(--faint);
  font: var(--type-caption) / 1.4 var(--font-mono);
}

.finder {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  margin-left: auto;
  padding: var(--space-1) var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.finder:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.finder .icon {
  width: 11px;
  height: 11px;
}

.icon-button {
  margin-left: auto;
}

.finder + .icon-button {
  margin-left: 0;
}

.revealed {
  margin: 0;
  padding: var(--space-3) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: var(--type-caption);
}

.stage {
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.refusal {
  margin: 0;
  padding: var(--space-6) var(--space-5);
  color: var(--muted);
  font-size: var(--type-caption);
}
</style>
