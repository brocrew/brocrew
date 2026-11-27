<script setup lang="ts">
import { computed } from 'vue'
import { BUNDLE_SUFFIX, MAX_PATH_CHARS } from '../../../shared/runtime-ipc'
import { useClientApi } from '../client-provider/injection'
import { useBundleImport } from '../lib/bundle-import'

const props = defineProps<{
  /** Read the library again once a bundle has been restored. */
  reload: () => Promise<void>
}>()

const selectedClientApi = useClientApi()
/**
 * # ⛔ Bringing a bundle back — the return half of Export (214 §1, from 213 finding 1)
 *
 * `213`, after an hour: *"Export succeeded and BroBot described it as a self-contained copy. The
 * visible Import actions only import provider-history messages; there was no bundle/file import
 * action or picker anywhere in the Sessions UI."* ⛔ **Its verdict was that this is what stops
 * BroBot being a durable workbench**, and `011`/`027` had already proved the bytes were right.
 *
 * ⚠️ **A field AND a picker, which is 076 §3's shape** and not a hedge. The picker is for the file
 * you just exported — main defaults the dialog to the app's own exports directory. The field is for
 * the one somebody sent you, which is the case the whole feature is for: a path out of a chat
 * window is pasted, not browsed to. `NewConversation`'s cwd control is the same pair for the same
 * reason, and its typed half is the one this app's own smoke can drive.
 */
const { bundlePath, restoring, restored, restoreBundle } = useBundleImport(
  selectedClientApi,
  props.reload,
)

async function chooseBundle(): Promise<void> {
  const desktop = selectedClientApi.desktop
  if (!desktop) return
  const picked = await desktop.chooseBundle()
  // Null is CANCELLED, which is not a failure and must not clear what was already typed.
  if (picked === null) return
  bundlePath.value = picked
  restored.value = null
}

/**
 * What the last restore did, in one sentence.
 *
 * ⚑ **"already here" is its own sentence, not a quieter "restored"** (`194` H4) — and since 236 §1
 * it is THREE sentences, because *"you already have this"* was being said about files that were
 * newer than what we had. The host compares now; this only reads the answer. See
 * `RuntimeHost.importBundleFile` for why the newer half is reported rather than taken in.
 */
const restoreNote = computed<string | null>(() => {
  const result = restored.value
  if (result === null) return null
  if (!result.ok) return result.reason
  if (result.behind) {
    // ⛔ **The numbers, in the sentence.** *"A newer copy exists"* with no figures is a claim the
    // reader cannot check or act on; `231` #7's objection is to a sentence that was confidently
    // wrong, and a vaguely-worded true one would be the same failure with better manners.
    const { held, inFile } = result.behind
    return (
      `This file is NEWER than the copy you have — it holds ${inFile} entries to your ${held}, ` +
      `${inFile - held} of them yours does not. Nothing was written: BroCrew matches a bundle by ` +
      'the provider’s own id and cannot yet take a second life of one conversation into the copy ' +
      'it already has.'
    )
  }
  return result.already
    ? 'You already have this conversation.'
    : `Restored ${result.events} entries from ${result.provider}. It ran in ${result.cwd}, so it is here to read rather than to carry on — there is no Resume for it.`
})
</script>

<template>
  <div class="restore bb-card" data-cy="library-restore">
    <label for="library-bundle-path">Restore a conversation from a bundle</label>
    <div class="restore-row">
      <input
        id="library-bundle-path"
        v-model="bundlePath"
        type="text"
        :maxlength="MAX_PATH_CHARS"
        class="mono bb-input"
        data-cy="library-bundle-path"
        :placeholder="`a …${BUNDLE_SUFFIX} file Export wrote, or one somebody sent you`"
        @keyup.enter="restoreBundle"
      />
      <button class="bb-button" type="button" data-cy="library-bundle-choose" @click="chooseBundle">
        Choose…
      </button>
      <button
        type="button"
        class="scan bb-button"
        :disabled="bundlePath.trim() === '' || restoring"
        data-cy="library-bundle-restore"
        @click="restoreBundle"
      >
        {{ restoring ? 'Restoring…' : 'Restore' }}
      </button>
    </div>

    <p
      v-if="restoreNote"
      class="restore-note"
      :class="{ refused: restored !== null && !restored.ok }"
      data-cy="library-bundle-result"
      :role="restored !== null && !restored.ok ? 'alert' : 'status'"
    >
      {{ restoreNote }}
    </p>
  </div>
</template>

<style scoped src="./library-scan-button.css"></style>

<style scoped>
/* ⛔ The return path (214 §1). Its own row under the header rather than a fourth button beside
   "Check homes": it takes a path, and a control that opens a field is not the same shape as one
   that acts on press. Quiet by default — this is the rarer of the two gestures on this screen. */
.restore {
  display: grid;
  padding: var(--space-4) 0 0;
  gap: var(--space-2);
}

.restore label {
  color: var(--muted);
  font-size: var(--type-caption);
}

/* ⚠️ **`wrap`, and the row above it is why** (104 §3, 103). The two buttons are unshrinkable, so at
   300px — the width `library-layout.dom.test.ts` measured as the one that bites — they and the
   field cannot share a line. Wrapping is what every other line on this screen does there, and the
   sweep that caught this is the same one that caught the row's provenance phrase. */
.restore-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.restore-row input {
  flex: 1 1 12rem;
  font-size: var(--type-small);
}

.restore-row > button:first-child {
  flex: 0 0 auto;
}

.restore-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}

/* A refusal is the one outcome that has to catch the eye — and it is still not an error colour on
   the list, which read perfectly well (121's rule, applied to this pair). */
.restore-note.refused {
  color: var(--danger-text, var(--waiting));
}
.restore {
  margin: 0;
  padding: var(--card-padding);
  gap: var(--space-5);
}
.restore-row {
  flex-wrap: wrap;
}
.restore-row input {
  flex: 1 0 100%;
}
</style>
