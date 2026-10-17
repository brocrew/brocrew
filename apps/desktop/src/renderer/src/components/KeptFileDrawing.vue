<script setup lang="ts">
import { fileManagerHere } from '../lib/this-computer'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { ResourceDrawing } from '../../../shared/runtime-ipc'
import { pdfFrameUrl, pictureUrl, type KeptFileUrl } from '../lib/kept-file-urls'

/**
 * 🔴 **D-032 · a kept picture or PDF, drawn** — inside {@link CanonicalDocumentViewer}, from main's
 * answer and nothing else.
 *
 * ## ⛔ An agent's file is untrusted, and this is the one file of the window that frames anything
 *
 *  - ⚑ **A picture is an `<img>`**, from `pictureUrl` alone: a `blob:` of exactly its type, or a
 *    `data:` URL for an SVG. An `<img>` runs no script and loads nothing the file names.
 *  - 🔴 **A PDF is one frame whose `src` is `pdfFrameUrl`'s**, a `blob:` typed `application/pdf`
 *    that Chromium hands to its own viewer. No `sandbox`, `srcdoc` or `csp` attribute: the viewer
 *    loads under neither (measured on Electron 43.2.0), and the navigation guard and the content
 *    security policy admit this one shape. ⛔ A `blob:` frame has the window's own origin, so it
 *    must never hold anything but a PDF: `pdfFrameUrl` refuses any other type.
 *  - ⛔ **The type is main's `drawnAs`**, never one chosen here or read off the name.
 *  - ⚑ **The URL is let go** when the file shown changes and when this closes.
 *  - ⛔ **`name` is the agent's own**, drawn as text (an attribute, an interpolation), never markup.
 *
 * ⚑ `window-navigation.test.ts`'s census names this file as the only one that may make a frame.
 */
const props = defineProps<{
  drawing: Extract<ResourceDrawing, { ok: true }>
  /** ⚑ Whether the viewer offers to show the file in the file manager, so a picture that won't draw can point to it. */
  finder: boolean
}>()

const shown = shallowRef<KeptFileUrl | null>(null)
const isPdf = ref(false)
/** ⚠️ A picture the window could not make a URL for or decode: said, rather than an empty box. */
const broken = ref(false)

watch(
  () => props.drawing,
  (drawing) => {
    shown.value?.release()
    shown.value = null
    broken.value = false
    isPdf.value = drawing.drawnAs === 'application/pdf'
    try {
      shown.value = isPdf.value ? pdfFrameUrl(drawing) : pictureUrl(drawing)
    } catch {
      // ⚠️ A type main draws and this window does not know: said, never framed or guessed at.
      isPdf.value = false
      broken.value = true
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  shown.value?.release()
  shown.value = null
})

const fileManager = fileManagerHere()
</script>

<template>
  <div class="drawing" :class="{ pdf: isPdf }" data-cy="kept-file-drawing">
    <iframe
      v-if="isPdf && shown"
      class="pdf-frame"
      :src="shown.url"
      :title="drawing.name"
      data-cy="kept-file-pdf"
    />
    <p v-else-if="broken" class="broken" data-cy="kept-file-broken">
      This image couldn't be drawn.{{ finder ? ` Show it in ${fileManager} to open it.` : '' }}
    </p>
    <img
      v-else-if="shown"
      class="picture"
      :src="shown.url"
      :alt="drawing.name"
      data-cy="kept-file-picture"
      @error="broken = true"
    />
  </div>
</template>

<style scoped>
/* Paper, as `ImageViewer`'s stage: a transparent PNG needs a ground to be a picture. */
.drawing {
  display: grid;
  min-height: 0;
  flex: 1;
  padding: var(--space-6);
  background: var(--paper-bg);
  overflow: auto;
  place-items: center;
}

.drawing.pdf {
  padding: 0;
}

.picture {
  max-width: 100%;
  max-height: 72vh;
  object-fit: contain;
}

/* The viewer's own toolbar scrolls and zooms inside; the frame takes the panel's room. */
.pdf-frame {
  width: min(900px, 92vw);
  height: 76vh;
  border: 0;
}

.broken {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}
</style>
