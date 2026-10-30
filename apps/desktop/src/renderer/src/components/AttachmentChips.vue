<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'
import type { HandedPath } from '../../../shared/runtime-ipc'
import { assetUrl } from '../../../shared/asset-url'
import { runtimePathCalls, useMessagePaths, type PathsHere } from '../composables/useMessagePaths'

const props = defineProps<{ attachments: readonly HandedPath[]; paths?: PathsHere | null }>()
const fallback = useMessagePaths(() => props.paths?.sessionId ?? null, runtimePathCalls)
const opener = computed(() => props.paths ?? fallback.value)
const failedImages = reactive(new Set<string>())
const failure = ref<string | null>(null)
const copied = ref<string | null>(null)
let reset: ReturnType<typeof setTimeout> | undefined
onUnmounted(() => clearTimeout(reset))

const name = (handed: HandedPath): string =>
  handed.path.split(/[\\/]/).filter(Boolean).at(-1) || handed.path
const image = (handed: HandedPath): boolean =>
  handed.kind === 'file' && /\.(png|jpe?g|webp|gif)$/i.test(handed.path)
const tooltip = (handed: HandedPath): string =>
  handed.path + (handed.outsideCwd ? '\nOutside this conversation’s folder' : '')

async function open(handed: HandedPath): Promise<void> {
  failure.value = null
  failure.value = opener.value
    ? await opener.value.press(handed.path, handed.kind === 'directory' ? 'folder' : 'file')
    : 'This window can’t open attachments.'
}

async function copy(handed: HandedPath): Promise<void> {
  failure.value = null
  try {
    await navigator.clipboard.writeText(handed.path)
    copied.value = handed.path
    clearTimeout(reset)
    reset = setTimeout(() => {
      copied.value = null
    }, 1600)
  } catch {
    failure.value = "That path didn't copy. Try copying it again."
  }
}
</script>

<template>
  <div v-if="attachments.length" class="attachments" data-cy="user-attachments">
    <span class="by">This app attached</span>
    <ul class="chips" aria-label="Attachments">
      <li
        v-for="handed in attachments"
        :key="handed.path"
        class="chip"
        data-cy="attachment-chip"
        :data-kind="handed.kind"
      >
        <button
          type="button"
          class="open"
          data-cy="attachment-open"
          :title="tooltip(handed)"
          :aria-label="`Open ${name(handed)}`"
          @click="open(handed)"
        >
          <img
            v-if="image(handed) && !failedImages.has(handed.path)"
            class="thumbnail"
            :src="assetUrl(handed.path)"
            alt=""
            loading="lazy"
            decoding="async"
            @error="failedImages.add(handed.path)"
          />
          <svg v-else class="icon" aria-hidden="true">
            <use
              :href="
                handed.kind === 'directory' ? '#i-folder' : image(handed) ? '#i-image' : '#i-file'
              "
            />
          </svg>
          <span class="filename" :data-cy="`user-attached-${handed.kind}`">{{ name(handed) }}</span>
        </button>
        <button
          type="button"
          class="copy"
          data-cy="attachment-copy"
          :title="copied === handed.path ? 'Copied' : 'Copy path'"
          :aria-label="copied === handed.path ? 'Copied' : `Copy path for ${name(handed)}`"
          @click="copy(handed)"
        >
          <svg class="icon" aria-hidden="true">
            <use :href="copied === handed.path ? '#i-check' : '#i-copy'" />
          </svg>
        </button>
      </li>
    </ul>
    <p v-if="failure" class="message-path-failure" role="status" data-cy="attachment-failure">
      {{ failure }}
    </p>
  </div>
</template>

<style scoped>
.attachments {
  margin-top: var(--space-3);
  min-width: 0;
}
.by {
  display: block;
  color: var(--faint);
  font-size: var(--type-caption);
  margin-bottom: var(--space-2);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.chip {
  display: flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  overflow: hidden;
}
.open,
.copy {
  display: flex;
  align-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-soft);
  padding: var(--space-3);
}
.open {
  min-width: 0;
  gap: var(--space-3);
  text-align: left;
}
.copy {
  flex: 0 0 auto;
  align-self: stretch;
  color: var(--muted);
}
.open:hover,
.copy:hover {
  background: var(--accent-fill);
  color: var(--accent-text);
}
.open:focus-visible,
.copy:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.filename {
  min-width: 0;
  max-width: 24ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-small);
}
.icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
.thumbnail {
  width: 36px;
  height: 36px;
  object-fit: cover;
  flex: 0 0 auto;
  border-radius: var(--radius);
}
</style>
