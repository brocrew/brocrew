<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  StorageOverview,
  StorageDirectory,
  StorageLocation,
  StoragePartId,
} from '../../../shared/storage'
import { STORAGE_PARTS, storageError, storageSize } from '../lib/storage-words'
import { platformHere } from '../lib/this-computer'
import { readableError } from '../lib/session-record'
const overview = ref<StorageOverview | null>(null)
const directory = ref<StorageDirectory | null>(null)
const location = ref<StorageLocation | null>(null)
const loading = ref(false)
const acting = ref(false)
const message = ref('')
const workspaceFolders = ref<StorageDirectory | null>(null)
const foldersLoading = ref(false)
const revealWord = /win/i.test(platformHere())
  ? 'Show in Explorer'
  : /mac/i.test(platformHere())
    ? 'Show in Finder'
    : 'Show folder'
let live = true
let request = 0
let folderRequest = 0
onUnmounted(() => {
  live = false
  request++
  folderRequest++
})
const parts = computed(() =>
  [...(overview.value?.parts ?? [])].sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1)),
)
const barTotal = computed(() => parts.value.reduce((sum, part) => sum + (part.bytes ?? 0), 0))
const trail = computed(() =>
  location.value ? [STORAGE_PARTS[location.value.part].name, ...location.value.segments] : [],
)
async function measure() {
  const mine = ++request
  location.value = null
  directory.value = null
  loading.value = true
  message.value = ''
  try {
    const result = await window.api.storage.measure()
    if (!live || mine !== request) return
    overview.value = result
    if (result.partial)
      message.value = result.error
        ? storageError(result.error)
        : 'Some sizes could not be measured.'
  } catch (error) {
    if (live && mine === request) message.value = readableError(error)
  } finally {
    if (live && mine === request) loading.value = false
  }
}
async function open(next: StorageLocation) {
  if (acting.value) return
  const mine = ++request
  location.value = { part: next.part, segments: [...next.segments] }
  directory.value = null
  loading.value = true
  message.value = ''
  try {
    const result = await window.api.storage.children(next)
    if (!live || mine !== request) return
    directory.value = result
    if (result.partial || result.error)
      message.value = result.error
        ? storageError(result.error)
        : 'Some sizes could not be measured.'
  } catch (error) {
    if (live && mine === request) message.value = readableError(error)
  } finally {
    if (live && mine === request) loading.value = false
  }
}
async function reveal(next?: StorageLocation) {
  try {
    const result = await window.api.storage.reveal(next)
    if (live && !result.ok) message.value = storageError(result.error)
  } catch (error) {
    if (live) message.value = readableError(error)
  }
}
async function clearCache() {
  if (acting.value) return
  acting.value = true
  try {
    const result = await window.api.storage.clearCache()
    if (!live) return
    if (!result.ok) {
      message.value = storageError(result.error)
      return
    }
    folderRequest++
    foldersLoading.value = false
    workspaceFolders.value = null
    await measure()
    if (live && !overview.value?.partial) message.value = 'Cache cleared.'
  } catch (error) {
    if (live) message.value = readableError(error)
  } finally {
    if (live) acting.value = false
  }
}
async function showFolders(event: Event) {
  if (!(event.target as HTMLDetailsElement).open || workspaceFolders.value || foldersLoading.value)
    return
  const mine = ++folderRequest
  foldersLoading.value = true
  try {
    const root = await window.api.storage.children({ part: 'workspace', segments: [] })
    const projects = root.entries.find((entry) => entry.name === 'projects' && entry.isDirectory)
    const result = projects
      ? await window.api.storage.children({ part: 'workspace', segments: ['projects'] })
      : root
    if (live && mine === folderRequest) {
      workspaceFolders.value = result
      if (result.error || result.partial)
        message.value = result.error
          ? storageError(result.error)
          : 'Some sizes could not be measured.'
    }
  } catch (error) {
    if (live && mine === folderRequest) message.value = readableError(error)
  } finally {
    if (live && mine === folderRequest) foldersLoading.value = false
  }
}
function child(base: StorageLocation, name: string): StorageLocation {
  return { part: base.part, segments: [...base.segments, name] }
}
function root(part: StoragePartId): StorageLocation {
  return { part, segments: [] }
}
onMounted(measure)
</script>
<template>
  <div class="storage-page" data-cy="storage-page" :aria-busy="loading">
    <header class="storage-head">
      <h2>Storage</h2>
      <p>What BroCrew keeps on this computer.</p>
    </header>
    <p v-if="loading" class="storage-loading" role="status" data-cy="storage-loading">
      <span class="spinner" aria-hidden="true"></span>Measuring storage…
    </p>
    <p v-if="message" class="storage-alert" role="status" data-cy="storage-message">
      {{ message }}
    </p>
    <section v-if="overview" class="storage-overview">
      <p class="storage-total">
        BroCrew uses
        <strong
          >{{ storageSize(overview.totalBytes) }}{{ overview.partial ? ' measured.' : '.' }}</strong
        ><span>{{
          overview.freeBytes === null
            ? 'Free space unavailable.'
            : `${storageSize(overview.freeBytes)} free on this disk.`
        }}</span
        ><a
          href="#"
          class="storage-open data-folder"
          :aria-label="`${revealWord}: BroCrew data folder`"
          @click.prevent="reveal()"
          >{{ revealWord }}</a
        >
      </p>
      <div class="storage-bar" role="img" aria-label="Disk use by part, largest first">
        <span
          v-for="part in parts"
          :key="part.id"
          :style="{
            flexGrow: (part.bytes ?? 0) / (barTotal || 1),
            background: STORAGE_PARTS[part.id].colour,
          }"
          :title="`${STORAGE_PARTS[part.id].name}: ${storageSize(part.bytes)}`"
        ></span>
      </div>
    </section>
    <nav v-if="location" class="storage-crumbs" aria-label="Storage location">
      <button type="button" @click="measure">Storage</button
      ><template v-for="(name, index) in trail" :key="index"
        ><span aria-hidden="true">›</span
        ><button
          type="button"
          :aria-current="index === trail.length - 1 ? 'page' : undefined"
          @click="open({ part: location.part, segments: location.segments.slice(0, index) })"
        >
          {{ name }}
        </button></template
      >
    </nav>
    <div v-if="!location && overview" class="storage-parts">
      <section v-for="part in parts" :key="part.id" class="storage-part" :data-part="part.id">
        <div class="storage-row">
          <span
            class="storage-dot"
            :style="{ background: STORAGE_PARTS[part.id].colour }"
            aria-hidden="true"
          ></span>
          <div class="storage-copy">
            <h3>{{ STORAGE_PARTS[part.id].name }}</h3>
            <p>{{ STORAGE_PARTS[part.id].meaning }}</p>
          </div>
          <strong class="storage-size"
            >{{ storageSize(part.bytes)
            }}{{ part.partial && part.bytes !== null ? '+' : '' }}</strong
          ><a class="storage-open" href="#" @click.prevent="reveal(root(part.id))">{{
            revealWord
          }}</a
          ><button
            class="drill-arrow"
            type="button"
            :aria-label="`Open ${STORAGE_PARTS[part.id].name}`"
            @click="open(root(part.id))"
          >
            ›
          </button>
          <div class="storage-action">
            <template v-if="part.id === 'backups'"
              ><button
                type="button"
                class="bb-btn"
                disabled
                title="Backup retention is coming soon."
              >
                Keep the last 2</button
              ><span class="coming-soon">coming soon</span></template
            ><button
              v-if="part.id === 'cache'"
              type="button"
              class="bb-btn"
              :disabled="acting || loading"
              data-cy="storage-clear-cache"
              @click="clearCache"
            >
              Clear
            </button>
          </div>
        </div>
        <details v-if="part.id === 'workspace'" class="largest-folders" @toggle="showFolders">
          <summary>Largest folders</summary>
          <p v-if="foldersLoading" role="status">Measuring folders…</p>
          <div v-if="workspaceFolders" class="folder-list">
            <div v-for="entry in workspaceFolders.entries" :key="entry.name" class="folder-row">
              <svg class="icon" aria-hidden="true"><use href="#i-folder" /></svg
              ><span>{{ entry.name }}</span
              ><span>{{ entry.isLink ? 'Link' : storageSize(entry.bytes) }}</span
              ><a
                href="#"
                v-if="!entry.isLink"
                class="storage-open"
                @click.prevent="reveal(child(workspaceFolders.location, entry.name))"
                >{{ revealWord }}</a
              ><button
                v-if="entry.isDirectory && !entry.isLink"
                class="drill-arrow"
                type="button"
                :aria-label="`Open ${entry.name}`"
                @click="open(child(workspaceFolders.location, entry.name))"
              >
                ›
              </button>
            </div>
            <p v-if="workspaceFolders.smallerCount" class="smaller-items">
              and {{ workspaceFolders.smallerCount }} smaller items,
              {{ storageSize(workspaceFolders.smallerBytes) }}
            </p>
          </div>
        </details>
      </section>
    </div>
    <section
      v-else-if="location && directory"
      class="storage-parts drill-panel"
      data-cy="storage-directory"
    >
      <header class="drill-head">
        <h3>{{ trail.at(-1) }}</h3>
        <span>{{ storageSize(directory.totalBytes) }}</span>
      </header>
      <div v-for="entry in directory.entries" :key="entry.name" class="drilled-row">
        <svg class="icon" aria-hidden="true">
          <use :href="entry.isDirectory ? '#i-folder' : '#i-file'" /></svg
        ><button
          v-if="entry.isDirectory && !entry.isLink"
          type="button"
          class="folder-name"
          @click="open(child(location, entry.name))"
        >
          {{ entry.name }}</button
        ><span v-else>{{ entry.name }}</span
        ><strong>{{ entry.isLink ? 'Link' : storageSize(entry.bytes) }}</strong
        ><a
          v-if="!entry.isLink"
          href="#"
          class="storage-open"
          @click.prevent="reveal(child(location, entry.name))"
          >{{ revealWord }}</a
        ><button
          v-if="entry.isDirectory && !entry.isLink"
          class="drill-arrow"
          type="button"
          :aria-label="`Open ${entry.name}`"
          @click="open(child(location, entry.name))"
        >
          ›
        </button>
      </div>
      <p v-if="directory.smallerCount" class="smaller-items" data-cy="storage-smaller">
        and {{ directory.smallerCount }} smaller items, {{ storageSize(directory.smallerBytes) }}
      </p>
      <p v-else-if="directory.entries.length === 0 && !directory.error" class="smaller-items">
        This folder is empty.
      </p>
    </section>
    <button v-if="!loading && !overview" type="button" class="bb-btn" @click="measure">
      Try again
    </button>
    <p class="storage-foot">Sizes are measured when you open this page.</p>
  </div>
</template>
<style scoped>
.storage-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.storage-head h2 {
  margin: 0 0 var(--space-3);
  font-size: var(--type-title);
  font-weight: var(--fw-bold);
}
.storage-head p,
.storage-copy p,
.storage-foot {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}
.storage-overview {
  margin: 0;
  padding: var(--space-6);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
.storage-total {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin: 0 0 var(--space-10);
  font-size: var(--type-body);
}
.storage-total span {
  margin-left: var(--space-3);
  color: var(--muted);
}
.storage-bar {
  display: flex;
  height: 18px;
  width: 100%;
  gap: 2px;
  overflow: hidden;
  border-radius: var(--radius-2xs);
}
.storage-bar span {
  flex-basis: 0;
  min-width: 3px;
}
.storage-parts {
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.storage-part {
  margin: 0;
}
.storage-part + .storage-part {
  border-top: var(--border-width) solid var(--line);
}
.storage-row {
  display: flex;
  gap: var(--space-12);
  align-items: center;
  padding: var(--space-4) var(--space-6);
  min-height: 60px;
}
.storage-dot {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: var(--radius-seg-tight);
}
.storage-copy {
  min-width: 0;
  flex: 1;
}
.storage-copy h3 {
  margin: 0 0 var(--space-3);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
}
.backup-count {
  color: var(--muted);
  font-size: var(--type-small);
  font-weight: var(--fw-normal);
  margin-left: var(--space-8);
}
.storage-size {
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  width: 65px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.storage-open {
  color: var(--accent-text);
  font-size: var(--type-small);
  white-space: nowrap;
  text-decoration: none;
}
.storage-open:hover {
  text-decoration: underline;
}
.storage-action {
  width: 135px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-3);
}
.storage-action .bb-btn {
  font-size: var(--type-small);
  white-space: nowrap;
  min-height: 30px;
  padding: var(--space-4) var(--space-8);
}
.coming-soon {
  color: var(--muted);
  font-size: var(--type-caption);
}
.largest-folders {
  margin: 0 var(--space-6) var(--space-6) 34px;
  font-size: var(--type-small);
}
.largest-folders summary {
  cursor: pointer;
  color: var(--accent-text);
  padding-bottom: var(--space-6);
}
.folder-list {
  max-width: 750px;
  border-left: var(--border-width) solid var(--line);
  margin-left: var(--space-3);
  padding-left: var(--space-12);
}
.folder-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-1) 0;
  color: var(--muted);
}
.folder-row .icon {
  width: 14px;
  height: 14px;
  flex: none;
}
.folder-row span:nth-of-type(2) {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.storage-foot {
  padding-bottom: 0;
}
.data-folder {
  margin-left: auto;
}
.drill-arrow {
  border: 0;
  background: transparent;
  color: var(--accent-text);
  font: inherit;
  font-size: var(--type-title);
  padding: 0 var(--space-3);
  cursor: pointer;
  line-height: 1;
}
.storage-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-6);
  padding: var(--space-6) 0;
  font-size: var(--type-small);
}
.storage-crumbs button,
.folder-name {
  border: 0;
  padding: 0;
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.storage-crumbs button[aria-current] {
  color: var(--text);
  font-weight: var(--fw-semibold);
}
.drill-head,
.drilled-row {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  padding: var(--space-8) var(--space-10);
}
.drill-head {
  border-bottom: var(--border-width) solid var(--line);
}
.drill-head h3 {
  margin: 0;
  font-size: var(--type-body);
}
.drill-head span {
  margin-left: auto;
  font-weight: var(--fw-semibold);
}
.drilled-row + .drilled-row {
  border-top: var(--border-width) solid var(--line);
}
.drilled-row .icon {
  width: 18px;
  height: 18px;
  color: var(--muted);
}
.drilled-row strong {
  margin-left: auto;
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
}
.smaller-items {
  margin: 0;
  padding: var(--space-8) var(--space-10);
  color: var(--muted);
  font-size: var(--type-small);
  border-top: var(--border-width) solid var(--line);
}
.storage-loading {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--muted);
  font-size: var(--type-small);
}
.spinner {
  width: 14px;
  height: 14px;
  flex: none;
  border: calc(var(--border-width) * 2) solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
.storage-alert {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-small);
}
.storage-head h2 {
  font-size: var(--type-title, var(--type-body));
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
@media (max-width: 1200px) {
  .storage-action {
    width: auto;
  }
  .storage-row {
    flex-wrap: wrap;
  }
  .storage-copy {
    flex-basis: 50%;
  }
  .storage-size {
    margin-left: auto;
  }
}
</style>
