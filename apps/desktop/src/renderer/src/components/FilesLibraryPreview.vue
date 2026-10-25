<script setup lang="ts">
import { nextTick, ref, shallowRef, watch } from 'vue'
import type { ResourceReader, ResourceDrawer, ResourceRevealer } from '../lib/opening-a-document'
import { fullTime } from '../lib/clock'
import { libraryFailureSays, type FilesLibraryController } from '../composables/useFilesLibrary'
import CanonicalDocumentOverlay from './CanonicalDocumentOverlay.vue'

const props = defineProps<{
  library: FilesLibraryController
  workspace: string
  read?: ResourceReader
  draw?: ResourceDrawer
  reveal?: ResourceRevealer
}>()
const viewer = ref<InstanceType<typeof CanonicalDocumentOverlay> | null>(null)
const opener = shallowRef<HTMLElement | null>(null)
watch(
  () => props.library.opened.value,
  async (opened) => {
    if (opened === null) {
      viewer.value?.close()
      return
    }
    opener.value = opened.opener
    await nextTick()
    if (opened.serial === props.library.opened.value?.serial)
      await viewer.value?.open(opened.file.resourceId, opened.file)
  },
)
watch(
  () => props.workspace,
  () => props.library.closePreview(),
)
function navigate(file: NonNullable<typeof props.library.opened.value>['file']): void {
  props.library.navigatePreviewTask(file)
  void nextTick(() => props.library.searchElement.value?.focus())
}
function preferredFocus(): HTMLElement | null {
  return opener.value?.isConnected ? opener.value : props.library.searchElement.value
}
</script>

<template>
  <CanonicalDocumentOverlay
    ref="viewer"
    :read="props.read"
    :draw="props.draw"
    :reveal="props.reveal"
    :scope="props.workspace"
    descriptive-title
    :return-focus="preferredFocus"
    @close="props.library.closePreview()"
  >
    <template #provenance>
      <details v-if="props.library.opened.value" class="provenance" data-cy="files-provenance">
        <summary>
          Where this file is kept<span v-if="props.library.provenance.value">
            · {{ props.library.provenance.value.total }} keeps ({{
              props.library.provenance.value.matching
            }}
            in this view)</span
          >
        </summary>
        <div class="placements">
          <p v-if="props.library.provenanceBusy.value">Reading kept locations…</p>
          <p v-if="props.library.provenanceError.value" data-cy="files-provenance-error">
            {{ libraryFailureSays(props.library.provenanceError.value) }}
            <button
              type="button"
              :disabled="props.library.provenanceBusy.value"
              @click="props.library.readProvenance()"
            >
              Retry locations
            </button>
          </p>
          <template v-if="props.library.provenance.value">
            <p v-if="props.library.provenance.value.stale">
              These locations belong to an earlier reading. Close and refresh the library for a new
              reading.
            </p>
            <ul>
              <li
                v-for="keep in props.library.provenance.value.keeps"
                :key="keep.file.resourceId"
                data-cy="files-placement"
                :data-matching="keep.matching"
              >
                <strong>{{ keep.file.title }}</strong
                ><span
                  >{{ keep.file.name
                  }}<span v-if="keep.file.clipped"> · Display details shortened</span></span
                >
                <span
                  ><button type="button" @click="navigate(keep.file)">
                    {{ keep.file.label
                    }}<template v-if="keep.file.pieceTitle"> · {{ keep.file.pieceTitle }}</template>
                  </button>
                  · {{ keep.file.role === 'made' ? 'Made' : 'Input' }} ·
                  {{ keep.matching ? 'In this view' : 'Outside this view' }}</span
                >
                <span
                  >{{ keep.file.addedBy?.name ?? 'Person' }} · Kept
                  {{ fullTime(keep.file.keptAt) }}</span
                >
              </li>
            </ul>
            <p>
              {{ props.library.provenance.value.keeps.length }} of
              {{ props.library.provenance.value.total }} keeps loaded
            </p>
            <button
              v-if="props.library.provenance.value.next"
              type="button"
              :disabled="props.library.provenanceBusy.value"
              data-cy="files-provenance-more"
              @click="props.library.readProvenance(true)"
            >
              Load more locations
            </button>
          </template>
        </div>
      </details>
    </template>
  </CanonicalDocumentOverlay>
</template>

<style scoped>
.provenance {
  flex: none;
  min-width: 0;
  border-bottom: 1px solid var(--line);
  padding: 8px 12px;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.45;
}
summary {
  cursor: pointer;
  overflow-wrap: anywhere;
}
.placements {
  max-height: 220px;
  overflow: auto;
  padding-top: 8px;
}
.placements ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}
.placements li {
  display: grid;
  gap: 3px;
  overflow-wrap: anywhere;
}
.placements li[data-matching='false'] {
  color: var(--muted);
}
.placements p {
  margin: 6px 0;
}
.placements button {
  color: var(--accent);
  font: inherit;
  border: 0;
  background: transparent;
  text-align: start;
  cursor: pointer;
  padding: 2px 0;
  text-decoration: underline;
}
</style>
