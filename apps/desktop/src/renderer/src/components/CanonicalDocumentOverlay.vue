<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import OverlayHost from './OverlayHost.vue'
import CanonicalDocumentViewer from './CanonicalDocumentViewer.vue'
import {
  aSurfaceMayOpenADocument,
  type ResourceDrawer,
  type ResourceReader,
  type ResourceRevealer,
} from '../lib/opening-a-document'
import type { KeptFile, ResourceDrawing, ResourceReading } from '../../../shared/runtime-ipc'

/**
 * 🔴 **One resource, open over whatever surface asked for it** (640; a resource since D-016).
 *
 * ⛔ **The fold `562` §6 boarded with a trigger, and `635` pulled it.** Three surfaces — among
 * them `ConversationPane` (510) and `ReadingPane` (510) — each held their own `readingDocument`, each mounted their own `OverlayHost` + {@link CanonicalDocumentViewer}, and
 * each stamped the fetch themselves. ⚑ **One `readingDocument` and one mount now live here**, and
 * a fourth surface gets the whole behaviour by mounting this and calling `open`.
 *
 * ## ⚠️ What did NOT move, because `562` proved it was already one
 *
 * ⛔ **May this be pressed** is {@link aSurfaceMayOpenADocument} · **what the press says** is
 * `READ_THE_DOCUMENT_NAMED` / `OPEN_THE_DOCUMENT` · **where it goes** is `readResource` on the
 * bridge · **who fetches** is `RuntimeScreen`'s `readResourceForAnySurface`, still handed in as the
 * `read` prop · **what a failure shows** is {@link CanonicalDocumentViewer}'s refusals. 🔴 **This
 * component changes none of the five.**
 *
 * ## ⛔ And viewing still never executes — the guarantee is BELOW this, not beside it
 *
 * ⚑ **`635`/`HO-097` §1.3 put the no-execute rule in {@link CanonicalDocumentViewer}**, whose only
 * text renderer is `DocumentBody` with markdown-it at `html: false` — *"the whole security story"*;
 * ⚑ D-032 draws a kept picture or PDF there through `KeptFileDrawing` alone.
 * ⚠️ **No surface ever sanitised anything**, so folding three mounts into one neither adds nor
 * removes a guard: all three drew the same panel, which is why `635` could widen what it shows to
 * pages, images and PDFs by editing ONE file.
 *
 * ## ⚑ Deliberately NOT an `overlay-store` member
 *
 * ⛔ **`550`'s ruling holds**: that layer's kinds carry the value they draw, and this one has to be FETCHED, so a
 * `{ kind: 'resource', resourceId }` would make the one overlay in that chain that opens on a
 * pending read.
 */
const props = defineProps<{
  /**
   * ⚑ **The fetch, from the screen that owns the bridge.** ⛔ **Absent is what makes the press
   * absent** — a surface mounted with no door draws no control, which is `106`.
   */
  read?: ResourceReader
  /**
   * 🔴 **D-032 · the door onto a kept picture or PDF's bytes**, asked once per open, right after
   * the read says the file is one. ⛔ Absent, the viewer says what the file is and draws nothing.
   */
  draw?: ResourceDrawer
  /** ⚑ **D-032 · Show in Finder**, by the id. ⛔ Absent, no button is drawn. */
  reveal?: ResourceRevealer
  /**
   * 🔴 **Which conversation this panel belongs to, where the surface has more than one** (067).
   *
   * ⛔ **`ConversationPane` is reused across conversations without a `key`**, so a file opened
   * in one must not float over the next. ⚠️ **Two halves, because they fail differently**: the
   * watch below drops the panel the moment the surface moves, and the `showing` guard hides a read
   * that was in flight when it moved. ⚑ **A surface that draws one thing for its whole life
   * passes nothing** — `ReadingPane` is keyed by its entry — and `undefined === undefined` is then
   * the whole of the guard.
   */
  scope?: string
  descriptiveTitle?: boolean
  returnFocus?: () => HTMLElement | null
}>()
const emit = defineEmits<{ close: [] }>()

/**
 * ⛔ **The app's one `readingDocument`.** ⚑ The id travels in the value as well as the result,
 * because a header that echoed a different id than the press would be two readings of one fetch.
 */
const reading = ref<{
  scope: string | undefined
  resourceId: string
  result: ResourceReading
  /** ⚑ **UI-002 · the row the press was drawn from**, where it had one — its header's facts. */
  file: KeptFile | null
  /** ⚑ **D-032 · the picture or PDF to draw**, where the read says it is one and a door was given. */
  drawing: ResourceDrawing | null
} | null>(null)

/** ⚑ Which open is the latest, so an answer that lands after a later press is dropped. */
let opens = 0

const showing = computed(() =>
  reading.value !== null && reading.value.scope === props.scope ? reading.value : null,
)

watch(
  () => props.scope,
  () => {
    opens++
    reading.value = null
  },
)

/**
 * ⚑ **Open the resource an id names.** ⛔ **The scope is captured BEFORE the await** — the reader
 * can move while the file is being read, and stamping it afterwards would attribute the file to
 * whatever is on screen when it lands.
 */
async function open(resourceId: string, file: KeptFile | null = null): Promise<void> {
  const read = props.read
  if (!aSurfaceMayOpenADocument(read)) return
  const scope = props.scope
  const asked = ++opens
  const result = await read(resourceId)
  // ⚑ D-032 · a picture or a PDF is asked for its bytes once, as it opens — never on a timer.
  const draw = props.draw
  const drawn =
    result.ok && result.text === null && (result.form === 'image' || result.form === 'pdf')
  const drawing = drawn && draw !== undefined ? await draw(resourceId) : null
  if (asked !== opens) return
  reading.value = { scope, resourceId, result, file, drawing }
}

function close(): void {
  opens++
  reading.value = null
  emit('close')
}
defineExpose({ open, close })
</script>

<template>
  <!-- ⛔ `OverlayHost` owns Esc, the backdrop, the focus trap and giving focus back; nothing here
       re-implements any of it. -->
  <OverlayHost
    v-if="showing"
    :label="
      props.descriptiveTitle
        ? `File: ${showing.file?.title ?? (showing.result.ok ? showing.result.name : 'Kept file')}`
        : 'Document'
    "
    :return-focus="props.returnFocus"
    @close="close"
  >
    <CanonicalDocumentViewer
      :resource-id="showing.resourceId"
      :result="showing.result"
      :file="showing.file"
      :drawing="showing.drawing"
      :reveal="props.reveal"
      @close="close"
      ><template #provenance><slot name="provenance" /></template
    ></CanonicalDocumentViewer>
  </OverlayHost>
</template>
