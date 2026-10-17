<script setup lang="ts">
import { binWord, platformHere } from '../lib/this-computer'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type {
  WorkspaceDeleteVerdict,
  WorkspaceFolderVerdict,
  WorkspaceRow,
  WorkspaceState,
} from '../../../shared/workspaces'
import { sizeWords } from '../lib/files-kept'
import { readableError } from '../lib/session-record'

/**
 * 🔴 **A3 · the workspaces, in the footer's menu** (`window.api.workspaces`, A2).
 *
 * ⚑ What it offers, all from the footer and nowhere else:
 *  - **the list**, most recently opened first, each with its name, its folder on hover and where it
 *    stands (this one, open, closed, not found); a press opens one — another BroBot window starts,
 *    or the one already open comes forward;
 *  - **a missing one**: *Not found — <folder>*, and *Remove from list*;
 *  - **Open workspace…** — a folder, picked;
 *  - **New workspace…** — a name, then its folder (suggested, editable, or chosen), checked before
 *    anything is made;
 *  - **Rename this workspace**.
 *
 * Read this chooser only when the footer is pressed. It does not affect launch or restart selection. Show main's refusal and warning sentences unchanged.
 */
const emit = defineEmits<{
  /** ⚑ This window's own workspace was renamed — its footer says the new name at once. */
  renamed: [name: string]
}>()

type Bridge = Window['api']['workspaces']
const bridge = (): Bridge | null => (window as Partial<Window>).api?.workspaces ?? null

/** ⚑ No bridge carries workspaces (a test, a window built before A2): the section is not drawn. */
const hasBridge = bridge() !== null
const rows = ref<WorkspaceRow[] | null>(null)
/** ⚑ What the last act said — a refusal, or a warning on something done. */
const said = ref<{ text: string; warn: boolean } | null>(null)
const busy = ref(false)

const STATE_WORD: Readonly<Record<WorkspaceState, string>> = {
  open: 'open',
  closed: 'closed',
  missing: 'not found',
  unknown: 'can’t tell',
}

const thisOne = computed(() => rows.value?.find((row) => row.isThisOne) ?? null)

async function refresh(): Promise<void> {
  const b = bridge()
  if (b === null) return
  try {
    rows.value = await b.list()
  } catch (error) {
    said.value = { text: readableError(error), warn: true }
  }
}

onMounted(refresh)

/** ⚑ One act: busy while it runs, its words shown, the list read again after. */
async function act(
  run: (b: Bridge) => Promise<string | null | { warn: string }>,
): Promise<boolean> {
  const b = bridge()
  if (b === null || busy.value) return false
  busy.value = true
  said.value = null
  let ok = false
  try {
    const answer = await run(b)
    if (typeof answer === 'string') said.value = { text: answer, warn: true }
    else {
      ok = true
      if (answer !== null) said.value = { text: answer.warn, warn: false }
    }
  } catch (error) {
    said.value = { text: readableError(error), warn: true }
  } finally {
    busy.value = false
  }
  await refresh()
  return ok
}

function openRow(row: WorkspaceRow): void {
  if (row.isThisOne || row.state === 'missing') return
  void act(async (b) => {
    const opened = await b.open(row.path)
    if (!opened.opened) return opened.refusal
    return opened.warning === null ? null : { warn: opened.warning }
  })
}

/* ------------------------------------------------------------------ delete (F092) */

/**
 * 🔴 **F092 · a workspace deleted: its folder to the Trash, its row off the list.** ⚑ Offered on a
 * closed row that is neither the default nor this one; `checkDelete` has the last word, and its
 * refusal is shown as it is. ⚑ The confirmation names everything that goes — the folder, its size,
 * the files its conversations made and its exported conversations — and that it can be put back
 * from the Trash. ⛔ "Move to Trash" is never the default: Cancel takes focus, and Esc cancels.
 */
const mayDelete = (row: WorkspaceRow): boolean =>
  row.state === 'closed' && !row.isDefault && !row.isThisOne

type ToTrash = Extract<WorkspaceDeleteVerdict, { ok: true }>
const deleting = ref<{ row: WorkspaceRow; verdict: ToTrash } | null>(null)

async function askToDelete(row: WorkspaceRow): Promise<void> {
  const b = bridge()
  if (b === null || busy.value) return
  busy.value = true
  said.value = null
  try {
    const verdict = await b.checkDelete(row.path)
    if (!verdict.ok) said.value = { text: verdict.refusal, warn: true }
    else {
      deleting.value = { row, verdict }
      void focusOn('workspace-delete-cancel')
    }
  } catch (error) {
    said.value = { text: readableError(error), warn: true }
  } finally {
    busy.value = false
  }
}

function cancelDelete(): void {
  const row = deleting.value?.row
  deleting.value = null
  if (row !== undefined) void focusOn(`workspace-delete:${row.path}`)
}

async function confirmDelete(): Promise<void> {
  const held = deleting.value
  if (held === null) return
  await act(async (b) => {
    const done = await b.delete(held.verdict.path)
    if (!done.deleted) return done.refusal
    return {
      warn: done.warning === null ? `Moved to the ${bin}.` : `Moved to the ${bin}. ${done.warning}`,
    }
  })
  deleting.value = null
  void focusOn('workspace-new')
}

/** ⚑ What else goes with the folder, in words — only what there is. */
function goesWith(verdict: ToTrash): string | null {
  const parts = [
    ...(verdict.workingFiles > 0
      ? [
          `${verdict.workingFiles} ${verdict.workingFiles === 1 ? 'file' : 'files'} its conversations made`,
        ]
      : []),
    ...(verdict.exports > 0
      ? [`${verdict.exports} exported ${verdict.exports === 1 ? 'conversation' : 'conversations'}`]
      : []),
  ]
  return parts.length === 0 ? null : `It takes ${parts.join(' and ')} with it.`
}

function removeRow(row: WorkspaceRow): void {
  void act(async (b) => {
    const done = await b.remove(row.path)
    return done.done ? null : done.refusal
  })
}

function openAFolder(): void {
  void act(async (b) => {
    const path = await b.chooseFolder()
    if (path === null) return null
    const opened = await b.open(path)
    if (!opened.opened) return opened.refusal
    return opened.warning === null ? null : { warn: opened.warning }
  })
}

/* ------------------------------------------------------------------ a new one */

const making = ref(false)
const newName = ref('')
const newPath = ref('')
/** ⚑ The folder follows the name until the person edits it or picks one. */
const pathEdited = ref(false)
const verdict = ref<WorkspaceFolderVerdict | null>(null)

const section = ref<HTMLElement | null>(null)

/** ⚑ Focus into the form as it opens, and back to the button that opened it as it closes. */
async function focusOn(cy: string): Promise<void> {
  await nextTick()
  section.value?.querySelector<HTMLElement>(`[data-cy="${cy}"]`)?.focus()
}

function startMaking(): void {
  making.value = true
  newName.value = ''
  newPath.value = ''
  pathEdited.value = false
  verdict.value = null
  checkFailed.value = null
  said.value = null
  void focusOn('workspace-new-name')
}

function stopMaking(): void {
  making.value = false
  void focusOn('workspace-new')
}

/** ⚑ A folder suggestion or a check still on its way: nothing is made until both have answered. */
const naming = ref(false)
const checking = ref(false)
/** ⚑ A suggestion or a check that could not be asked, in its own words. */
const checkFailed = ref<string | null>(null)

let named = 0
watch(newName, async (name) => {
  const b = bridge()
  if (b === null || pathEdited.value) return
  const asked = ++named
  naming.value = name.trim() !== ''
  try {
    const folder = name.trim() === '' ? '' : await b.folderFor(name.trim())
    if (asked === named && !pathEdited.value) newPath.value = folder
  } catch (error) {
    if (asked === named)
      checkFailed.value = `BroCrew couldn’t suggest a folder: ${readableError(error)}`
  } finally {
    if (asked === named) naming.value = false
  }
})

let checked = 0
watch(newPath, async (path) => {
  const b = bridge()
  verdict.value = null
  checkFailed.value = null
  // ⚑ A path emptied by hand lets the name suggest one again.
  if (path.trim() === '') pathEdited.value = false
  if (b === null || path.trim() === '') return
  const asked = ++checked
  checking.value = true
  try {
    const answer = await b.checkFolder(path.trim(), true)
    if (asked === checked) verdict.value = answer
  } catch (error) {
    if (asked === checked)
      checkFailed.value = `BroCrew couldn’t check this folder: ${readableError(error)}`
  } finally {
    if (asked === checked) checking.value = false
  }
})

async function chooseNewFolder(): Promise<void> {
  const b = bridge()
  if (b === null || busy.value) return
  busy.value = true
  try {
    const path = await b.chooseFolder()
    if (path === null) return
    pathEdited.value = true
    newPath.value = path
  } catch (error) {
    checkFailed.value = readableError(error)
  } finally {
    busy.value = false
  }
}

const mayMake = computed(
  () =>
    !busy.value &&
    !naming.value &&
    !checking.value &&
    checkFailed.value === null &&
    newName.value.trim() !== '' &&
    newPath.value.trim() !== '' &&
    verdict.value?.ok !== false,
)

async function make(): Promise<void> {
  if (!mayMake.value) return
  const name = newName.value.trim()
  const path = newPath.value.trim()
  const ok = await act(async (b) => {
    const opened = await b.create({ name, path })
    if (!opened.opened) return opened.refusal
    return opened.warning === null ? null : { warn: opened.warning }
  })
  if (ok) stopMaking()
}

/* ------------------------------------------------------------------ rename */

const renaming = ref(false)
const newTitle = ref('')

function startRenaming(): void {
  renaming.value = true
  newTitle.value = thisOne.value?.name ?? ''
  said.value = null
  void focusOn('workspace-rename-name')
}

function stopRenaming(): void {
  renaming.value = false
  void focusOn('workspace-rename')
}

async function rename(): Promise<void> {
  const row = thisOne.value
  const name = newTitle.value.trim()
  if (row === null || name === '' || busy.value) return
  const ok = await act(async (b) => {
    const done = await b.rename({ path: row.path, name })
    return done.done ? null : done.refusal
  })
  if (ok) {
    stopRenaming()
    // ⚑ The name as main kept it, read back from the list — not the words typed.
    emit('renamed', thisOne.value?.name ?? name)
  }
}

/** Where a deleted folder goes, as this computer names it. */
const bin = binWord(platformHere())
</script>

<template>
  <section
    v-if="hasBridge"
    ref="section"
    class="workspaces"
    aria-label="Workspaces"
    data-cy="workspaces"
  >
    <h3 class="head">Workspaces</h3>

    <ul v-if="rows" class="rows" data-cy="workspaces-list">
      <li v-for="row in rows" :key="row.path" :data-state="row.state" data-cy="workspace-row">
        <template v-if="row.state === 'missing'">
          <p class="missing" data-cy="workspace-missing">
            <strong>{{ row.name }}</strong> · Not found — {{ row.path }}
          </p>
          <button
            type="button"
            class="small bb-button"
            :disabled="busy"
            data-cy="workspace-remove"
            @click="removeRow(row)"
          >
            Remove from list
          </button>
        </template>
        <button
          v-else
          type="button"
          class="row"
          :class="{ here: row.isThisOne }"
          :title="row.path"
          :disabled="busy || row.isThisOne"
          :aria-current="row.isThisOne ? 'true' : undefined"
          data-cy="workspace-open"
          @click="openRow(row)"
        >
          <span class="name" :title="row.name">{{ row.name }}</span>
          <span class="state" data-cy="workspace-state">{{
            row.isThisOne ? 'this one' : STATE_WORD[row.state]
          }}</span>
        </button>
        <button
          v-if="mayDelete(row)"
          type="button"
          class="small delete bb-button"
          :disabled="busy || deleting !== null"
          :data-cy="`workspace-delete:${row.path}`"
          :aria-label="`Delete workspace ${row.name}…`"
          @click="askToDelete(row)"
        >
          Delete workspace…
        </button>
        <p v-if="row.readers" class="said warn readers" data-cy="workspace-readers">
          {{ row.readers }}
        </p>
      </li>
    </ul>

    <div
      v-if="deleting"
      class="confirm"
      role="alertdialog"
      :aria-label="`Delete ${deleting.row.name}?`"
      data-cy="workspace-delete-confirm"
      @keydown.esc.stop="cancelDelete"
    >
      <p class="ask">
        <strong>Delete {{ deleting.row.name }}?</strong>
      </p>
      <p class="said" data-cy="workspace-delete-what">
        Its folder {{ deleting.verdict.path }} ({{ sizeWords(deleting.verdict.bytes) }},
        {{ deleting.verdict.files }} {{ deleting.verdict.files === 1 ? 'file' : 'files' }}) goes to
        the {{ bin }}. You can put it back from there.
      </p>
      <p v-if="goesWith(deleting.verdict)" class="said" data-cy="workspace-delete-with">
        {{ goesWith(deleting.verdict) }}
      </p>
      <p v-if="deleting.verdict.warning" class="said warn" data-cy="workspace-delete-warning">
        {{ deleting.verdict.warning }}
      </p>
      <span class="buttons">
        <button
          type="button"
          class="small bb-button"
          data-cy="workspace-delete-cancel"
          @click="cancelDelete"
        >
          Cancel
        </button>
        <button
          type="button"
          class="small bb-button"
          :disabled="busy"
          data-cy="workspace-delete-yes"
          @click="confirmDelete"
        >
          Move to {{ bin }}
        </button>
      </span>
    </div>

    <p
      v-if="said"
      class="said"
      :class="{ warn: said.warn }"
      role="status"
      data-cy="workspaces-said"
    >
      {{ said.text }}
    </p>

    <form
      v-if="making"
      class="form"
      data-cy="workspace-new-form"
      @submit.prevent="make"
      @keydown.esc.stop="stopMaking"
    >
      <label>
        <span>Name</span>
        <input class="bb-input" v-model="newName" type="text" data-cy="workspace-new-name" />
      </label>
      <label>
        <span>Folder</span>
        <span class="folder">
          <input
            class="bb-input"
            v-model="newPath"
            type="text"
            data-cy="workspace-new-path"
            @input="pathEdited = true"
          />
          <button
            type="button"
            class="small bb-button"
            :disabled="busy"
            data-cy="workspace-new-choose"
            @click="chooseNewFolder"
          >
            Choose…
          </button>
        </span>
      </label>
      <p v-if="checkFailed" class="said warn" data-cy="workspace-new-check-failed">
        {{ checkFailed }}
      </p>
      <p
        v-else-if="verdict && (verdict.refusal || verdict.warning)"
        class="said"
        :class="{ warn: verdict.refusal !== null }"
        data-cy="workspace-new-verdict"
      >
        {{ verdict.refusal ?? verdict.warning }}
      </p>
      <span class="buttons">
        <button
          type="button"
          class="small bb-button"
          data-cy="workspace-new-cancel"
          @click="stopMaking"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="small go bb-button bb-button--primary"
          :disabled="!mayMake"
          data-cy="workspace-new-make"
        >
          Make and open
        </button>
      </span>
    </form>

    <form
      v-else-if="renaming"
      class="form"
      data-cy="workspace-rename-form"
      @submit.prevent="rename"
      @keydown.esc.stop="stopRenaming"
    >
      <label>
        <span>Name</span>
        <input class="bb-input" v-model="newTitle" type="text" data-cy="workspace-rename-name" />
      </label>
      <span class="buttons">
        <button
          type="button"
          class="small bb-button"
          data-cy="workspace-rename-cancel"
          @click="stopRenaming"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="small go bb-button bb-button--primary"
          :disabled="busy || newTitle.trim() === ''"
          data-cy="workspace-rename-save"
        >
          Rename
        </button>
      </span>
    </form>

    <div v-else class="acts">
      <button
        type="button"
        class="small bb-button"
        :disabled="busy"
        data-cy="workspace-open-folder"
        @click="openAFolder"
      >
        Open workspace…
      </button>
      <button
        type="button"
        class="small bb-button"
        :disabled="busy"
        data-cy="workspace-new"
        @click="startMaking"
      >
        New workspace…
      </button>
      <button
        v-if="thisOne"
        type="button"
        class="small bb-button"
        :disabled="busy"
        data-cy="workspace-rename"
        @click="startRenaming"
      >
        Rename this workspace
      </button>
    </div>
  </section>
</template>

<style scoped>
.workspaces {
  display: grid;
  padding-bottom: var(--space-4);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-3);
}

.head {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.rows {
  display: grid;
  margin: 0;
  padding: 0;
  gap: var(--space-1);
  list-style: none;
}

.row {
  display: flex;
  width: 100%;
  align-items: center;
  min-height: var(--control-h);
  justify-content: space-between;
  padding: var(--space-4) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  font-family: var(--font-sans);
  font-size: var(--type-caption);
  gap: var(--space-3);
  text-align: left;
}

.row:hover:not(:disabled) {
  background: var(--wash-5);
}

.row.here {
  background: var(--wash-2);
  color: var(--text);
}

.row:disabled {
  cursor: default;
}

.name {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state {
  flex: 0 0 auto;
  color: var(--faint);
  font-size: var(--type-caption);
}

.delete {
  margin: var(--space-1) 0 var(--space-2) var(--space-3);
}

.confirm {
  display: grid;
  padding: var(--space-6);
  background: var(--danger-bg);
  border: var(--border-width) solid var(--danger-border);
  border-radius: var(--radius-sm);
  gap: var(--space-2);
}

.confirm .ask {
  margin: 0;
  color: var(--text);
  font-size: var(--type-caption);
}

.confirm .said {
  overflow-wrap: anywhere;
}

.missing {
  margin: 0 0 var(--space-1);
  padding: 0 var(--space-3);
  color: var(--muted);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.said {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}

.said.warn {
  color: var(--danger-text-notice);
}

.readers {
  padding: 0 var(--space-3);
  overflow-wrap: anywhere;
}

.acts,
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.form {
  display: grid;
  gap: var(--space-3);
}

.form label {
  display: grid;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-1);
}

.folder {
  display: flex;
  gap: var(--space-2);
}

input[type='text'] {
  flex: 1;
  font-size: var(--type-small);
}
</style>
