<script lang="ts">
export const MISSING_ON_RESTORE = 'File missing. Remove it to send.'
</script>

<script setup lang="ts">
import type { HandedPath } from '../../../shared/attachment-contracts'

import { computed, onUnmounted, reactive, ref } from 'vue'

import { assetUrl } from '../../../shared/asset-url'
import { pathTail } from '../../../shared/path-tail'
import { isPastedImage, pastedImageLabel } from '../../../shared/runtime-ipc'
import { useClientMessagePaths, type PathsHere } from '../composables/useMessagePaths'

const props = defineProps<{
  attachments: readonly (HandedPath | string)[]
  paths?: PathsHere | null
  presentation?: 'staged' | 'queued' | 'delivered'
  cwd?: string
}>()
const emit = defineEmits<{ detach: [path: string] }>()
const fallback = useClientMessagePaths(() => props.paths?.sessionId ?? null)
const opener = computed(() => props.paths ?? fallback.value)
const failedImages = reactive(new Set<string>())
const failure = ref<string | null>(null)
const copied = ref<string | null>(null)
let reset: ReturnType<typeof setTimeout> | undefined
onUnmounted(() => clearTimeout(reset))

const entries = computed(() =>
  props.attachments.map((value) => {
    const path = typeof value === 'string' ? value : value.path
    const kind = typeof value === 'string' ? null : value.kind
    const pasted = kind === 'file' && isPastedImage(path)
    const name = pasted
      ? pastedImageLabel(typeof value === 'string' ? undefined : value.pasted)
      : pathTail(path) || path
    return {
      path,
      kind,
      pasted,
      name,
      outsideCwd: typeof value !== 'string' && value.outsideCwd,
      missing: typeof value !== 'string' && value.missing === true,
      image: kind === 'file' && /\.(png|jpe?g|webp|gif)$/i.test(path),
    }
  }),
)
type Entry = (typeof entries.value)[number]

const name = (handed: Entry): string =>
  props.presentation === 'delivered' ? handed.path : handed.name
const tooltip = (handed: Entry): string =>
  handed.path + (handed.outsideCwd ? '\nOutside this conversation’s folder' : '')
const hook = (handed: Entry): string => {
  if (props.presentation === 'delivered') return 'what-the-model-got-attached'
  const prefix =
    props.presentation === 'staged' ? '' : props.presentation === 'queued' ? 'queued-' : 'user-'
  return `${prefix}attached-${handed.kind}`
}

async function open(handed: Entry): Promise<void> {
  failure.value = null
  failure.value = opener.value
    ? await opener.value.press(handed.path, handed.kind === 'directory' ? 'folder' : 'file')
    : 'This window can’t open attachments.'
}

async function copy(handed: Entry): Promise<void> {
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
  <div
    v-if="entries.length"
    class="attachments"
    :class="presentation"
    data-attachment-chips
    :data-cy="
      presentation === 'queued'
        ? 'queued-attachments'
        : presentation
          ? undefined
          : 'user-attachments'
    "
  >
    <span v-if="presentation !== 'staged'" class="by">This app attached</span>
    <ul
      class="chips"
      aria-label="Attachments"
      :data-cy="presentation === 'staged' ? 'composer-attachments' : undefined"
    >
      <li
        v-for="handed in entries"
        :key="handed.path"
        class="chip"
        data-cy="attachment-chip"
        :data-kind="handed.kind"
        :data-pasted="String(handed.pasted)"
      >
        <component
          :is="presentation ? 'span' : 'button'"
          :type="presentation ? undefined : 'button'"
          class="open"
          :data-cy="presentation ? undefined : 'attachment-open'"
          :title="tooltip(handed)"
          :aria-label="presentation ? undefined : `Open ${name(handed)}`"
          @click="!presentation && open(handed)"
        >
          <img
            v-if="!presentation && handed.image && !failedImages.has(handed.path)"
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
                handed.kind === 'directory'
                  ? '#i-folder'
                  : handed.pasted || (!presentation && handed.image)
                    ? '#i-image'
                    : '#i-file'
              "
            />
          </svg>
          <span class="filename" :title="handed.path" :data-cy="hook(handed)">{{
            name(handed)
          }}</span>
        </component>
        <em
          v-if="presentation === 'staged' && !cwd?.trim()"
          class="mark"
          data-cy="attached-no-folder"
          >no folder yet</em
        >
        <em
          v-else-if="(presentation === 'staged' || presentation === 'queued') && handed.outsideCwd"
          class="mark"
          :data-cy="presentation === 'staged' ? 'attached-outside' : 'queued-attached-outside'"
          >outside</em
        >
        <em
          v-if="presentation === 'staged' && handed.missing"
          class="mark missing"
          data-cy="attached-missing"
          :title="MISSING_ON_RESTORE"
          >missing</em
        >
        <button
          v-if="presentation === 'staged'"
          type="button"
          class="copy"
          :title="handed.pasted ? 'Don’t send the image you pasted' : `Don’t send ${handed.path}`"
          :data-cy="`detach-${handed.kind}`"
          @click="emit('detach', handed.path)"
        >
          ×
        </button>
        <button
          v-if="!presentation"
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
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: calc(-1 * var(--focus-ring-width));
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

.staged,
.queued,
.delivered {
  margin-top: 0;
}

.queued,
.delivered {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.attachments:is(.queued, .delivered) .by {
  margin: 0;
}

.attachments:is(.staged, .queued, .delivered) .chip {
  gap: 1px;
}

.staged {
  grid-column: 1 / -1;
}

.attachments:is(.staged, .queued, .delivered) .open,
.staged .copy {
  padding: 0 var(--space-2);
  line-height: 1.15;
}

.attachments:is(.staged, .queued, .delivered) .icon {
  width: 12px;
  height: 12px;
}

.delivered {
  align-items: center;
  line-height: 1.1;
}

.delivered .filename {
  max-width: none;
  font-family: var(--font-mono);
}

.mark {
  flex: none;
  color: var(--faint);
  font-size: var(--type-caption);
  font-style: normal;
}

.missing {
  color: var(--danger);
}
</style>
