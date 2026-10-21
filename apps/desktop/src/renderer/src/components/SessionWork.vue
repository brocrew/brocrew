<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { WORK_SEARCH_WORDS } from '../../../shared/work-search-words'
import { useWhoCalledWhom } from '../composables/useWhoCalledWhom'
import WorkSearchDialog from './WorkSearchDialog.vue'
import { workSearchQuery, type WorkSearchQuery } from '../../../shared/work-search'
import type { AgentIdentity } from '../../../shared/runtime-ipc'
import { WORK_DOUBT_WORDS, workGivenOutView, type WorkGivenOutReading } from '../lib/work-given-out'
import { ROWS_UNREAD_LEAD } from '../lib/rows-unread'
import { useMinuteClock } from '../composables/useMinuteClock'
import WorkFacts from './WorkFacts.vue'

/**
 * 🔴 **The work this conversation gave out** (508) — the seventh drawer tab, and the surface
 * `506` §1.4 declined to build inside the Open tab.
 *
 * ## ⛔ Why it is a tab and not a band beside the avatar
 *
 * Keep the polled work list separate from `SessionPanel`, which projects `TranscriptState` without subscriptions. Combining their independently timed reads can produce inconsistent views.
 *
 * ## ⚠️ 547 · a polled band DID land on that tab, and this paragraph is corrected rather than kept
 *
 * ⛔ **`547` put `WorkingTogether` on the Open tab**, and the sentence above would read as a rule it
 * broke. 🔴 **It did not.** What `506` §1.4 refused was a band THIS PANEL would have to fold —
 * a subscription inside a projection. ⚑ `547`'s band arrives as a PROP, `SessionPanel` forwards it
 * whole without looking at it, and the poll is `RuntimeScreen`'s like every other on that screen.
 * ⚠️ **What has changed is the reason this list is not there**, and it is now a smaller one: the
 * Work tab answers *what did this conversation hand out*, which is a question about pieces; the Open
 * tab's band answers *who is around this conversation*, which is a question about conversations.
 * ⛔ `547` §6 was told not to converge them and did not — see its F4.
 *
 * ⚑ **`258`'s method, with the location moved one tab rather than one screen.** That dispatch put
 * its LIST above the composer and gave the panel a SENTENCE plus a boolean; this one puts its list
 * in the same drawer the person is already looking at and gives the panel the same two things —
 * see `PANEL_EMPTY_WORDS.gaveWork`. ⚠️ The composer bar was the other candidate and it is further
 * from what he asked for: it is not the right panel at all.
 *
 * ## ⛔ Nothing is invented, and every blank is a different fact
 *
 *  - **nothing read yet** → the note and nothing else. ⚠️ Not a spinner and not *"loading"*: the
 *    first read goes out on mount, and a surface that announces its own round trip is a claim
 *    about work in flight that this tab has no way to keep honest.
 *  - **nothing given out** → `NOTHING_GIVEN_OUT`, with `081`'s faceless dashed ring, never a `0`.
 *    ⛔ Withheld while the reading is in doubt — see `WorkGivenOutView.empty`.
 *  - **the read did not answer** → the last good rows, marked. **a word this app cannot spell** →
 *    the rows, without the sentence that says what was covered. Two causes, two sentences.
 *  - **rows the walk could not read** → counted, once, and never per row.
 *
 * ## 🔴 What this tab may never draw
 *
 * ⛔ **Anything about whether the worker is alive.** `505` measured that the only thing this app
 * can say about a conversation it is not running is who is WATCHING it — *"a project manager that
 * is working and one that has been wedged for forty minutes are the SAME ROW"* — so there is no
 * plate here, no dot, and no word about the holder. ⚑ Every word on a row is about the PIECE, and
 * the piece's state is folded from events this app watched happen.
 *
 * ⛔ **And no control.** `withdraw_task` is an agent's door and stays one; `506` built the press
 * that reaches the conversation a work report names, and it lives on that report.
 */
const props = defineProps<{
  /** The conversation this drawer is showing — what the reading is checked against. */
  conversation: string
  /** ⚑ `null` until the first read for this conversation lands. */
  reading: WorkGivenOutReading | null
  /** ⚑ `null` until the identities read lands — a cold window names every row by its slug. */
  identities: readonly AgentIdentity[] | null
}>()

/**
 * ⛔ **A minute clock, never a mount-time constant** — `504`'s finding on the band one surface
 * over. The ages here are measured from when each question went out, so an instant frozen at mount
 * would make a row that was just re-read look older than the reading it came from.
 */
const minute = useMinuteClock()
const searchOpen = ref(false)
const cast = useWhoCalledWhom()
watch(
  () => props.conversation,
  () => {
    searchOpen.value = false
  },
)
function searchWork(query: WorkSearchQuery) {
  const parsed = workSearchQuery.safeParse(query)
  return parsed.success
    ? window.api.runtime.searchWork({ conversation: props.conversation, query: parsed.data })
    : Promise.resolve({ ok: false as const, reason: 'invalid' as const })
}

const view = computed(() =>
  workGivenOutView({
    reading: props.reading,
    forConversation: props.conversation,
    identities: props.identities,
    now: minute.value,
  }),
)
</script>

<template>
  <section class="work" data-cy="session-work">
    <button
      type="button"
      class="search-action"
      data-cy="work-search-open"
      @click="searchOpen = true"
    >
      {{ WORK_SEARCH_WORDS.action }}
    </button>
    <WorkSearchDialog
      v-if="searchOpen"
      :conversation="props.conversation"
      :can-open="cast.goTo.value !== null"
      :search="searchWork"
      @close="searchOpen = false"
      @open-work="
        (hit) => {
          searchOpen = false
          cast.goTo.value?.(hit.owner.conversation)
        }
      "
    />
    <p class="note">
      What this conversation handed out to other agents, and how each piece is going. Read from the
      ledgers of the conversations the work went to — not from this one.
    </p>

    <template v-if="view">
      <ol v-if="view.rows.length" class="rows" data-cy="work-rows">
        <li
          v-for="row in view.rows"
          :key="row.piece"
          class="row"
          :data-cy="`work-row-${row.piece}`"
        >
          <p class="head">
            <strong class="heading">{{ row.heading }}</strong>
            <!-- ⚑ **`agentName`'s answer, resolved from the identity the STORE carried** — so a
                 conversation created since this window mounted is named by its own slug rather
                 than by nothing (`472` F3). -->
            <span class="who" data-cy="work-row-who">{{ row.who }}</span>
            <span class="given" data-cy="work-row-given">{{ row.given }}</span>
          </p>
          <!-- ⛔ **The one line every surface draws for this fact** — see `WorkFacts.vue`. -->
          <WorkFacts :reading="row" />
          <p v-if="row.definitionOfDone" class="condition" data-cy="work-row-done">
            Done when: {{ row.definitionOfDone }}
          </p>
          <p v-if="row.said" class="said" :title="row.said" data-cy="work-row-said">
            {{ row.said }}
          </p>
        </li>
      </ol>

      <div v-if="view.empty" class="empty" data-cy="work-empty">
        <!-- 081's faceless dashed ring: no face, because there is no doing to claim. -->
        <div class="ring"></div>
        <p class="t">{{ view.empty }}</p>
        <p class="s">
          Work appears here when this conversation gives a piece of it to another agent.
        </p>
      </div>

      <!-- ⛔ **The list may not be current, and the tab says WHICH of the two reasons** (434). -->
      <p v-if="view.doubt" class="gap" data-cy="work-doubt">
        <strong>This list may not be current</strong>
        {{ WORK_DOUBT_WORDS[view.doubt] }}
      </p>

      <!-- ⛔ **Once for the tab and never per row**: it counts LEDGER rows, and an unread ledger row
           usually folds into no row at all, so this number and the rows above do not add up. -->
      <!-- 🔴 **678 · F-R18 — the one sentence** (`rows-unread.ts`). ⚠️ It said *"This list is short …
           work this conversation gave out may be missing from it"*; since `671` the count also
           covers a row a drawn piece's STATE was composed from. -->
      <p v-if="view.short" class="gap" data-cy="work-short">
        <strong>{{ ROWS_UNREAD_LEAD }}</strong>
        {{ view.short }}
      </p>

      <!-- 🔴 **What the read COVERED, said once** — `WALK_COVERS`, through `walkCovers`. -->
      <p v-if="view.says" class="covers" data-cy="work-covers">{{ view.says }}</p>

      <!-- 🔴 **How old this is** — said only for rows kept after a read that did not answer (W4.74):
           an answered list is read again on every move of its work, so it is the current one. -->
      <p v-if="view.asOf" class="covers" data-cy="work-age">
        Last read {{ view.asOf }}. It’s read again when its work moves.
      </p>
    </template>
  </section>
</template>

<style scoped>
.search-action {
  align-self: flex-end;
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.work {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--space-6);
  gap: var(--space-5);
  overflow-y: auto;
}

.note {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.rows {
  display: flex;
  margin: 0;
  flex-direction: column;
  padding: 0;
  gap: var(--space-4);
  list-style: none;
}

.row {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  gap: var(--space-3);
}

.head {
  display: flex;
  margin: 0;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.heading {
  /* ⚑ **718** — a heading with no place to break wraps anywhere, rather than being one word wider
     than the column the row wraps inside. */
  min-width: 0;
  color: var(--text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  overflow-wrap: anywhere;
}

.who {
  color: var(--text-soft);
  font-size: var(--type-caption);
}

/* The age sits to the right of everything else on the line, the way every meta row in this app
   puts its clock. */
.given {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--type-caption);
}

/* The work's first line. One line, clipped — the whole of it is on the `title`, and the row is a
   record rather than a document. */
.said {
  overflow: hidden;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.condition {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-7) var(--space-5);
  gap: var(--space-4);
  text-align: center;
}

.ring {
  width: 40px;
  height: 40px;
  border: 2px dashed var(--line-strong); /* raw: glyph stroke, drawn at its own width */
  border-radius: 50%;
}

.empty .t {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
}

.empty .s {
  max-width: 34ch;
  margin: 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.gap {
  margin: 0;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--wash-1);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.gap strong {
  display: block;
  color: var(--text-soft);
}

.covers {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}
</style>
