<script setup lang="ts">
import type { ProviderLimitDisplay } from '../lib/provider-limit-status'
import { computed } from 'vue'
import type { AgentState as OneState } from '../../../shared/agent-state'
import { plateWord, priorityDotToken, standingOf, type AgentFacets } from '../lib/agent-state'
import AgentState from './AgentState.vue'

/**
 * The bot, at one size, in one place, always (090).
 *
 * Keep the agent's plate at a stable size and position at the top of its panel so status changes stay visible as items arrive.
 *
 * ⚠️ **This reverses 088 §1, and the reason is the last sentence.** 088 drew the bot at `hero` 96
 * centred in an empty tab and dropped it to `row` 40 the moment anything arrived, so a waiting card
 * would not be pushed down — a good rule, built under a constraint it was given. But **a control you
 * are studying must not resize itself out from under you**, and studying it is now the point. So the
 * predicate is gone rather than joined by a third branch: one size, one place, no condition. The
 * vertical cost 088 was avoiding is real and did not disappear; it was measured and accepted rather
 * than argued away (see the response doc's above-the-fold numbers).
 *
 * Keep this block independent of its containing panel. It receives facets and provider data already held by `SessionDrawer`, so relocating it needs no new source of facts. The `session-bot` hook identifies the block rather than its placement.
 */
const props = defineProps<{
  /** What it is doing, is and needs (082) — all three, drawn composed. */
  facets: AgentFacets
  providerLimit?: ProviderLimitDisplay | null
  /**
   * Its name, drawn above the plate — handed in, never one this component invents.
   *
   * 🔴 **537 · it carries the AGENT's name and it used to carry the provider's.** ⛔ The plate said
   * `claude` about a conversation the rail, the PROFILE field and the AGENTS list all called
   * `project-manager` — see `ConversationPane.who`, which is the same correction on the same
   * screen. ⚑ **Renamed rather than re-pointed**, because `provider` holding an identity's name
   * would be `a-column-name-is-a-claim` in a prop.
   */
  who?: string
  /**
   * Show the profile slug beside the agent's name to identify which profile it uses.
   *
   * ⛔ **The slug, handed in, never derived here** — it is `CreatedSession.profileId`, which is the
   * same value `who` above is folded FROM (`agentName(profileId, identities)`). ⚠️ So
   * the two lines are one fact said twice: a person's word for it and the app's. ⚠️ **667 · one
   * difference, and it is the field's**: `who` asks in the canonical spelling and this line prints
   * the profile AS THE CONVERSATION RAN UNDER IT, so an unnamed agent launched as `Dev` reads *dev*
   * above *Dev*. Left, and reported — this line is the recorded key, not a name.
   */
  profile?: string | null
  /**
   * ⚑ **F023 · when it next wakes and what it left running** — ⚑ **D-017 · R11: the ONE state**
   * (`stateHere`, `shared/agent-state.ts`), with whose answer it waits on (R19), for the transcript
   * this window holds — so the word under the plate is the rail row's word, and `list_agents`'.
   * Absent, the plate says the arm's plain word.
   */
  state?: OneState
  /** A typed wait its holder is in, said in place of an idle word. */
  wait?: string
}>()

/**
 * Use a 77px plate, approximately 20% smaller than the 96px hero size.
 *
 * He offered the range (*"same size as now… or like 20% smaller"*) and this takes the smaller,
 * because the block is now permanent rather than only on an empty tab: it pays rent on every screen
 * the Open tab is on. `082`'s API already accepts an arbitrary number, so this needs no new scale
 * step and `SIZES` is untouched — 77 is a layout decision belonging to this block, not a rung on a
 * scale every surface can reach for.
 *
 * **Switching back to 96 is this line:** `SIZES.hero`. Both measured heights are in the response.
 */
const PLATE = 77

const name = computed(() => props.who ?? 'agent')

/**
 * The word under the plate. The DOING it already has — never a second reading of the session.
 *
 * 🔴 **The exception used to be spelled out HERE, and 258 moved it to `plateWord` because it went
 * stale the first time the vocabulary grew.** `250` wrote `standingOf(facets) === 'background'` in
 * this file; `258` added a fifth facet, and this block went straight back to printing `idle` — a few
 * lines above its own paragraph saying a job will wake the conversation later. Exactly the defect
 * `250` fixed, in exactly the same place, one word along.
 *
 * ⚑ **So the rule lives with the vocabulary now** (`223`) and this component asks for it. The
 * scoping is unchanged and is `250`'s: only the standings that carry a SECOND fact override the
 * DOING word — see {@link plateWord} for why the others must not.
 */
const subtitle = computed(() => {
  const word = plateWord(props.facets, props.state)
  return (
    props.providerLimit?.word ?? (standingOf(props.facets) === 'idle' ? (props.wait ?? word) : word)
  )
})

/**
 * Use `priorityDotToken` for the state dot, matching the plate's own priority color so the two cannot disagree.
 */
const dot = computed(() => priorityDotToken(props.facets))
</script>

<template>
  <!-- Place the plate left of the name, profile, state, place and optional slotted content such as latest words. `AgentState` draws only the plate; this block owns the adjacent text. -->
  <!-- ⚑ **The whole name on the block's own title** — the name clips at its width, and an agent
       card draws a spawned agent's longer name here too. -->
  <div class="session-bot" data-cy="session-bot" :title="name">
    <!-- ⚑ W4.183 · the plate, and whatever the card puts under it (v3's workspace dock). -->
    <!-- ⚠️ A span, never a div: the plate block holds no div (`session-panel.render.test.ts`). -->
    <span class="bot-rail">
      <AgentState v-bind="props.facets" :size="PLATE" :label="name" :state="props.state" />
      <slot name="rail" />
    </span>
    <div class="bot-copy">
      <div class="bot-head">
        <span class="bot-name" data-cy="session-bot-name">{{ name }}</span>
        <span
          v-if="props.profile"
          class="bot-profile"
          :title="props.profile"
          data-cy="session-bot-profile"
          >{{ props.profile }}</span
        >
        <!-- Whatever the card puts at the row's end: the agent panel's approval mode. -->
        <slot name="head" />
      </div>
      <p class="bot-state">
        <span class="bot-dot" :style="{ '--_c': `var(${dot})` }" aria-hidden="true"></span>
        <span
          class="bot-word"
          data-cy="session-bot-word"
          :title="props.providerLimit?.detail"
          :aria-description="props.providerLimit?.detail"
          :tabindex="props.providerLimit ? 0 : undefined"
          >{{ subtitle }}</span
        >
      </p>
      <p
        v-if="props.providerLimit?.history"
        class="provider-history"
        data-cy="provider-limit-history"
      >
        {{ props.providerLimit.history }}
      </p>
      <slot />
    </div>
  </div>
</template>

<style scoped>
/*
 * Keep the plate beside a column of words in a fixed header. `flex: 0 0 auto` prevents growth and shrinkage; the list scrolls below because the header is outside `.panel-body`.
 */
.session-bot {
  display: grid;
  flex: 0 0 auto;
  align-items: start;
  padding: var(--space-7) var(--space-6) var(--space-5);
  column-gap: var(--space-6);
  grid-template-columns: auto minmax(0, 1fr);
}

.bot-rail {
  display: grid;
  justify-items: center;
  gap: var(--space-3);
}

.bot-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding-top: var(--space-3);
  gap: var(--space-2);
}

.bot-head {
  display: flex;
  min-width: 0;
  align-items: center;
  margin: 0;
  gap: var(--space-4);
}

.bot-name {
  overflow: hidden;
  min-width: 0;
  flex: 0 1 auto;
  color: var(--text);
  font-size: var(--type-title);
  font-weight: var(--fw-bold);
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ⚑ **The profile, in a pill beside the name** — the app's accent pill, as every other pill.
   ⚑ **The name gives way LAST**: the profile shrinks a thousand times faster, so a short name is
   never cut to make room for it (measured at the drawer's 320px floor). */
.bot-profile {
  overflow: hidden;
  min-width: 0;
  flex: 0 1000 auto;
  padding: 1px var(--space-4);
  border: var(--border-width) solid var(--accent-pill-border);
  border-radius: var(--radius-pill);
  background: var(--accent-pill-bg);
  color: var(--accent-text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bot-state {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  margin: 0;
  font-size: var(--type-small);
  gap: var(--space-1) var(--space-3);
}

.bot-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--_c);
}

.bot-word {
  color: var(--text-soft);
  font-weight: var(--fw-medium);
}

.provider-history {
  min-width: 0;
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  overflow-wrap: anywhere;
}
</style>
