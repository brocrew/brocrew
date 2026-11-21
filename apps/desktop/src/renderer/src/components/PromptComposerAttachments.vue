<script lang="ts">
/**
 * 🔴 **744 · What a chip marked *missing* says on hover** — a restored draft's path that was not
 * there when BroBot started. ⚠️ **The WHOLE message waits on it**: the send is refused by name while
 * the path is still gone (`recheckHandedPaths`) and the words come back, so the sentence does not
 * suggest the rest would go without it.
 */
export const MISSING_ON_RESTORE =
  'Not found at this path when BroCrew started — the message will not send until it is back or you remove it'
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { HandedPath } from '../../../shared/attachment-contracts'
import { pathTail } from '../../../shared/path-tail'
import { isPastedImage, pastedImageLabel } from '../../../shared/runtime-ipc'

const props = defineProps<{ staged: readonly HandedPath[]; cwd: string }>()
const emit = defineEmits<{ detach: [path: string] }>()

/** The last segment, for the chip — the whole path is the `title` and the message's own words. */
/**
 * ⛔ **Whether a folder has been settled on at all** (217 §2).
 *
 * ⚑ Only the LAUNCHER can honestly be here: a live conversation's cwd is fixed when it starts, and
 * `ConversationPane` reads it off the session. A blank cwd on that surface would be a defect
 * upstream, and this caption — which claims nothing — is the right thing to show for it too.
 */
const cwdKnown = computed(() => props.cwd.trim() !== '')

/**
 * # ⛔ One row of the chip strip, decided ONCE (254 §2)
 *
 * ⚠️ **Nobody named a pasted image.** Every other chip here shows the last segment of a path a
 * person pointed at, so the label is a thing they recognise because they chose it. A screenshot has
 * no name until BroBot invents one, and showing `pasted-a3f9….png` would present an invention as
 * their choice — §2 asks for the difference to be visible, and this is where it is.
 *
 * ## ⛔ The authority is the PATH, not a flag the renderer carries
 *
 * ⚑ **`isPastedImage` is a shared function main and this side both use** — main builds the name,
 * this reads it — which is `197`'s remedy rather than `197`'s defect. Three things the first
 * version got wrong, all found by the adversarial pass and all fixed by the same move:
 *
 *  - **the queue.** `overTheWire` maps `HandedPath` field by field, so a screenshot queued behind a
 *    running turn and then *"put back in the composer"* came back with no flag — and the chip
 *    reverted to the invented filename, the file glyph and *"Don't send /…/pasted-a3f9….png"*: the
 *    three things §2 forbids, through one ordinary gesture.
 *  - **the caption wire.** `app:classify-attachments` applies no schema, so a flag on ANY path came
 *    back wearing main's authority and made an arbitrary file read as a screenshot.
 *  - **the altitude.** `pasted` was the one field on `HandedPath` main could not re-derive, which is
 *    that record's whole contract (232 §1). It is a DECORATION now: the measurements are shown only
 *    on a path that already says what it is, so a forged one decorates nothing.
 *
 * ⛔ **`outside` is suppressed for a paste**, and that is the one thing this hides on purpose.
 * `216` §2 made that mark the thing a person checks a handover of THEIR OWN choosing against; a
 * pasted image is somewhere BroBot picked, so the mark answers a question nobody asked and fires on
 * 100% of the gesture — which is `234` §4's *"a label that cries wolf teaches people to stop reading
 * it"*, arriving by construction rather than by an edge case. ⚑ The message to the model and the
 * transcript still carry it: what is dropped is the nag, not the record.
 */
interface Chip {
  handed: HandedPath
  pasted: boolean
  label: string
  glyph: string
  detach: string
  outside: 'none' | 'no-folder' | 'outside'
  /**
   * 🔴 **744 · R100 — a restored draft names a path that is no longer there** (`HandedPath.missing`,
   * main's caption at the restore). ⚑ Said on the chip rather than the chip vanishing: the message
   * came back as it was left, and the person decides what to do about the part that went.
   */
  missing: boolean
}

const chips = computed<Chip[]>(() =>
  props.staged.map((handed) => {
    // ⚠️ **`kind` as well as the name.** The name is main's own and nothing a renderer can invent —
    // but a FOLDER called `pasted-<32 hex>.png` is a legal thing to attach, and it would otherwise
    // wear the image glyph and lose the label that says it is a folder. ⚑ `kind` comes from `stat`,
    // so the two facts together are decidable rather than merely likely.
    const pasted = handed.kind === 'file' && isPastedImage(handed.path)
    return {
      handed,
      pasted,
      label: pasted ? pastedImageLabel(handed.pasted) : pathTail(handed.path) || handed.path,
      glyph: pasted ? '#i-image' : handed.kind === 'directory' ? '#i-folder' : '#i-file',
      // ⛔ **The undo names the same thing the label does.** *"Don't send
      // /Users/…/pasted-images/pasted-a3f9….png"* is a sentence about a file the person has never
      // seen the name of, on the one control that exists to let them change their mind — `106`'s
      // complaint the other way round: words that do not describe what pressing it undoes.
      detach: pasted ? 'Don’t send the image you pasted' : `Don’t send ${handed.path}`,
      // 🔴 **The `outside` mark is NOT suppressed for a paste — reverted** (found reviewing the fix
      // that suppressed it). ⚠️ The argument for hiding it was `234` §4's *"a label that cries wolf
      // teaches people to stop reading it"*: BroBot chose the location, so the mark answers a
      // question nobody asked and fires on 100% of the gesture. ⛔ **But `pasted` is decided by a
      // NAME, and a name is forgeable** — so suppressing it meant any file called
      // `pasted-<32 hex>.png`, picked or dropped from anywhere, lost the one disclosure `216` §2
      // exists for. ⚑ A caption may be approximately right; a DISCLOSURE may not, and the two are
      // not mine to trade. The mark is true here, and it stays.
      outside: !cwdKnown.value ? 'no-folder' : handed.outsideCwd ? 'outside' : 'none',
      missing: handed.missing === true,
    }
  }),
)
</script>

<template>
  <ul class="attached" data-cy="composer-attachments">
    <li
      v-for="chip in chips"
      :key="chip.handed.path"
      :data-kind="chip.handed.kind"
      :data-pasted="String(chip.pasted)"
    >
      <svg class="icon">
        <!-- ⛔ **A third glyph, because there is a third thing** (254 §2). A paste is still a
             `file` to `kind` — that is what `stat` says and what the agent will read it as —
             so the icon is the one place the difference can show without lying about the type. -->
        <use :href="chip.glyph" />
      </svg>
      <span class="what" :title="chip.handed.path" :data-cy="`attached-${chip.handed.kind}`">{{
        chip.label
      }}</span>
      <!-- 🔒 Outside the cwd is allowed — every folder is (`726` · R92) — and SAID, so the
           agent's own permission card is not the first place anybody notices.
           ⛔ **Three states, not two** (217 §2). With NO folder chosen there is nothing to be
           outside OF, and `outsideWorkingDirectory` answers `true` for a blank cwd by design
           ("an unknown cwd counts as OUTSIDE") — so a two-state chip would mark every single
           attachment `outside` on the launcher's commonest case and be lying about a directory
           the person has not picked yet. The honest sentence is the one that says less.
           ⚠️ **…and a FOURTH state since 254 §2: a pasted image says nothing at all**, because
           the person did not choose where it went. See {@link Chip}. -->
      <em v-if="chip.outside === 'no-folder'" class="outside" data-cy="attached-no-folder"
        >no folder yet</em
      >
      <em v-else-if="chip.outside === 'outside'" class="outside" data-cy="attached-outside"
        >outside</em
      >
      <!-- 🔴 **744 · R100 — gone since the draft was kept.** ⚑ Beside the outside mark rather
           than instead of it: both are true. ⚠️ A caption, not a refusal — but the send IS
           refused, whole and by name, while the path is still gone (`recheckHandedPaths`), and
           the words come back; the title says so rather than implying the rest would go. -->
      <em v-if="chip.missing" class="missing" data-cy="attached-missing" :title="MISSING_ON_RESTORE"
        >missing</em
      >
      <button
        type="button"
        class="detach"
        :title="chip.detach"
        :data-cy="`detach-${chip.handed.kind}`"
        @click="emit('detach', chip.handed.path)"
      >
        ×
      </button>
    </li>
  </ul>
</template>

<style scoped>
.attached {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  margin: 0;
  padding: 0;
  gap: var(--space-3);
  list-style: none;
}

.attached li {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-3);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-2);
}

.attached .icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  color: var(--faint);
}

.attached .what {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attached .outside {
  color: var(--faint);
  font-style: normal;
}

.attached .missing {
  color: var(--danger);
  font-style: normal;
}

.detach {
  display: grid;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1;
  cursor: pointer;
  place-items: center;
}

.detach:hover {
  background: var(--panel-2);
  color: var(--text);
}
</style>
