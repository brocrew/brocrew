<script setup lang="ts">
import { computed, ref } from 'vue'
import AgentBookButton from './AgentBookButton.vue'
import type { AgentIdentities } from '../../../shared/runtime-ipc'
import type { WhatIsBeingDone } from '../../../shared/what-is-being-done'
import type { AgentStore } from '../lib/agent-store'
import { AGENT_REMOVAL_MEANS } from '../../../shared/agent-roster'
import { activityWords, STANDING_TONE } from '../lib/agent-state'
import {
  groupWorkers,
  workerLabel,
  workerState,
  workerSubtitles,
  workerDescription,
  type ListedConversation,
} from '../lib/conversation-list'
import {
  doingSays,
  doingTone,
  teamRoster,
  theirConversations,
  type TeamFilter,
  type TeamMemberView,
} from '../lib/team-roster'
import { useWhoCalledWhom } from '../composables/useWhoCalledWhom'
import { useAgentStore } from '../composables/useAgentStore'
import { useMinuteClock } from '../composables/useMinuteClock'
import AgentState from './AgentState.vue'
import TeamForest from './TeamForest.vue'
import type { ForestRow, ForestView } from '../lib/the-forest'
import { NEW_AGENT } from '../lib/where-agents-are-created'
import { noProviderSavedSays } from '../lib/front-door-words'

/**
 * 🔴 **593 · the card says what each agent is DOING, and the plate is how it says it.**
 *
 * Show both which agents exist and what they are doing, using conversation/work facts instead of identity cards alone.
 *
 * ⚠️ **This is a MOUNT of {@link AgentState} and not an extraction.** The brief asked for the
 * avatar-plus-state to be given an address; it has had one since `082` —
 * `components/AgentState.vue`, with every rule in `lib/agent-state.ts` — and the rest of the app
 * already draws it, the rail among them. ⚑ **This page was the one surface with no plate at all.**
 *
 * ⛔ **651 · this sentence used to count them** — *"the FOURTEENTH mount… thirteen call sites across
 * nine components"* — which was TRUE at `593` and has been stale since. ⚠️ Nothing read the
 * number and the argument never needed it, so it is gone rather than updated: a count in prose ages
 * the moment anything else mounts the component
 * ([[a-number-can-survive-the-death-of-its-derivation]]).
 */
const cast = useWhoCalledWhom()
const props = withDefaults(
  defineProps<{
    agents: AgentIdentities | null
    /** A link opens the exact identity's profile and conversation shelf. */
    focusedIdentity?: string | null
    store?: AgentStore
    /**
     * 🔴 **575's complete reading of what every running conversation is doing** — the other half of
     * the door, `byIdentity`, which reached no surface between `575` and here.
     */
    beingDone?: WhatIsBeingDone | null
    /** ⛔ **The conversations THIS window holds** — the precondition for an `Open` press. */
    held?: readonly string[]
    /**
     * 🔴 **D-016 · the one list of conversations** — the rail's own (`SideRail.theOneList`), which
     * each card's *Conversations* shelf narrows to its agent. ⛔ `null` is *the list has not answered
     * yet*, and a shelf says so rather than drawing *none*.
     */
    conversations?: readonly ListedConversation[] | null
    /**
     * The folded forest for the Graph tab.
     *
     * ⛔ **Handed down already folded, like every other reading on this page.** ⚠️ This component
     * reads no store of its own (its `store` default is the one exception and it is a default, not
     * a read).
     *
     * ⚑ **`null` is *this window has not asked yet*** and the tab says so — never an empty tree.
     */
    forest?: ForestView | null
  }>(),
  {
    store: undefined,
    beingDone: null,
    held: () => [],
    conversations: null,
    forest: null,
  },
)
const emit = defineEmits<{
  create: []
  open: [slug: string]
  /**
   * ⛔ **626 · the second door on a card** — `EXT-015` §1's Team-page entry to the popup.
   * ⚠️ Named for what it OPENS rather than for the sheet's component, the way `open` is: this page
   * raises gestures and performs none of them.
   */
  openShapes: [slug: string]
  /**
   * ⚑ **D-017b · open a conversation in its one full view** — every row's and every forest node's
   * press, whatever the conversation is doing. The screen draws it.
   */
  openConversation: [id: string]
}>()
const store = props.store ?? useAgentStore()

/**
 * 🔴 **641 · which of the two views this page is showing.**
 *
 * ⛔ **Component-local, and deliberately NOT a `RESERVED_PLACES` word.** ⚠️ `useSurface`'s places
 * are DESTINATIONS — a thing the rail can send somebody to and the palette can name — and
 * `EXT-015` §1's principle is that this is *the same page, learned once*. ⚑ A tab that became a
 * place would make the Team page two entries in every list that enumerates them, which is the
 * opposite of what `641` §4.3 asked for: *"A tab, not a replacement. The existing Team list
 * stays."*
 */
const TEAM_VIEWS = [
  { key: 'roster' as const, label: 'Directory' },
  { key: 'forest' as const, label: 'Who called whom' },
]
type TeamView = (typeof TEAM_VIEWS)[number]['key']
const showing = ref<TeamView>('roster')
const strip = ref<HTMLElement | null>(null)

/**
 * ⛔ **A `role="tablist"` PROMISES arrow keys** — `SessionInstructions.vue`'s own rule, copied with
 * its behaviour rather than with its look: *"a promise a control does not keep is worse than a
 * plainer control"*. ⚑ Roving tabindex with it, so the strip is ONE stop in the page's tab order.
 */
function steer(event: KeyboardEvent, at: number): void {
  const keys = TEAM_VIEWS.map((one) => one.key)
  const to =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? (at + 1) % keys.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? (at - 1 + keys.length) % keys.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? keys.length - 1
            : -1
  if (to < 0) return
  event.preventDefault()
  const key = keys[to]
  if (key === undefined) return
  showing.value = key
  // ⚑ **Focus follows selection** — both panels are already in the document, so nothing is fetched
  // and there is no reason to make a person press twice.
  strip.value?.querySelector<HTMLButtonElement>(`[data-cy="team-tab-${key}"]`)?.focus()
}
/**
 * ⛔ **The LIVE minute, for the age line and for nothing else**: one re-render a minute, scheduled to
 * the rollover.
 *
 * ⚑ **593 · it is declared ABOVE the fold**, because {@link TeamRosterInput.now} takes it — a fold
 * that read `Date.now()` itself was not a function of its arguments, and no test could pin the
 * freshness line it produced.
 */
const minute = useMinuteClock()
const query = ref('')
const filter = ref<TeamFilter>('all')
const draftNames = ref<Record<string, string>>({})
const busy = ref<string | null>(null)
const message = ref<string | null>(null)

const view = computed(() =>
  teamRoster({
    source: props.agents,
    query: query.value,
    filter: filter.value,
    beingDone: props.beingDone,
    now: minute.value,
    listed: props.conversations ?? null,
  }),
)
const visibleMembers = computed(() => {
  const members = view.value?.members ?? []
  return props.focusedIdentity
    ? members.filter((member) => member.identity.id === props.focusedIdentity)
    : members
})
const draftFor = (slug: string, current: string | null): string =>
  draftNames.value[slug] ?? current ?? ''

async function rename(slug: string, current: string | null): Promise<void> {
  busy.value = slug
  message.value = await store.renameTo(slug, draftFor(slug, current).trim() || null)
  busy.value = null
}

async function remove(slug: string): Promise<void> {
  busy.value = slug
  message.value = await store.remove(slug)
  busy.value = null
}

/** Whether services are on in this workspace, as the host last said. */
const servicesOn = computed(() => props.agents?.servicesOn === true)
const servicesBusy = ref(false)

async function switchServices(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  servicesBusy.value = true
  message.value = await store.setServices(input.checked)
  servicesBusy.value = false
  // A refused change leaves the switch where services still stand.
  if (message.value !== null) input.checked = servicesOn.value
}

/**
 * 🔴 **Each agent's conversations, from the one list** (593; ⚑ D-016 · the rail's list, narrowed) —
 * see {@link theirConversations}. ⛔ `null` is *the list has not answered yet*.
 */
const held = computed(() => new Set(props.held))
function shelfOf(slug: string): ReturnType<typeof theirConversations> {
  return theirConversations(props.conversations, slug, held.value)
}

function workersOf(slug: string) {
  return groupWorkers(
    (shelfOf(slug) ?? []).filter((row) => row.worker),
    (row) => row.conversation,
  )
}
function activityOf(member: TeamMemberView, conversation: string) {
  return member.atWork.find((row) => row.conversation === conversation)
}
function otherActivity(member: TeamMemberView) {
  const workers = new Set(
    (shelfOf(member.identity.slug) ?? [])
      .filter((row) => row.worker)
      .map((row) => row.conversation),
  )
  return member.atWork.filter((row) => !workers.has(row.conversation))
}

/**
 * Open a pressed forest node in its full conversation view, whatever its current state.
 */
function pressForest(row: ForestRow): void {
  emit('openConversation', row.conversation)
}
</script>

<template>
  <section class="team-workspace" data-cy="team-workspace" data-chat-theme="light">
    <header class="team-header">
      <div>
        <p class="eyebrow">Workspace directory</p>
        <h1 class="bb-page-title">Team</h1>
        <p class="team-lede">Identities persist before and between conversations.</p>
      </div>
      <div class="team-services" data-cy="team-services">
        <label class="team-services-switch">
          <input
            type="checkbox"
            role="switch"
            :checked="servicesOn"
            :disabled="servicesBusy || props.agents === null"
            data-cy="team-services-switch"
            @change="switchServices"
          />
          <span>Services</span>
        </label>
        <small class="team-services-line" data-cy="team-services-line">{{
          servicesOn ? 'On: agents can be services.' : 'Off: queued work waits. Nothing is stopped.'
        }}</small>
      </div>
      <button
        class="bb-button bb-button--primary"
        type="button"
        data-cy="team-create"
        @click="emit('create')"
      >
        {{ NEW_AGENT }}
      </button>
    </header>

    <div
      ref="strip"
      class="team-tabs"
      role="tablist"
      aria-label="How to read the team"
      data-cy="team-tabs"
    >
      <button
        v-for="(one, at) in TEAM_VIEWS"
        :key="one.key"
        type="button"
        role="tab"
        class="team-tab"
        :class="{ on: one.key === showing }"
        :id="`team-tab-${one.key}`"
        :aria-selected="one.key === showing"
        :aria-controls="`team-panel-${one.key}`"
        :tabindex="one.key === showing ? 0 : -1"
        :data-cy="`team-tab-${one.key}`"
        @click="showing = one.key"
        @keydown="steer($event, at)"
      >
        {{ one.label }}
      </button>
    </div>

    <div
      v-show="showing === 'forest'"
      id="team-panel-forest"
      role="tabpanel"
      aria-labelledby="team-tab-forest"
      data-cy="team-panel-forest"
    >
      <TeamForest :view="props.forest" @press="pressForest" />
    </div>

    <div
      v-show="showing === 'roster'"
      id="team-panel-roster"
      role="tabpanel"
      aria-labelledby="team-tab-roster"
      data-cy="team-panel-roster"
    >
      <p v-if="view === null" data-cy="team-loading">Reading identities…</p>
      <template v-else>
        <div class="team-controls" data-cy="team-controls">
          <input
            class="bb-input"
            v-model="query"
            aria-label="Search team"
            placeholder="Search team"
          />
          <select class="bb-input" v-model="filter" aria-label="Filter team">
            <option value="all">Everyone</option>
            <option value="never-run">Never run</option>
            <option value="worked">Has run</option>
          </select>
        </div>

        <p v-if="message" class="team-message" data-cy="team-message">{{ message }}</p>

        <div class="team-count-bar" data-cy="team-count-bar">
          <span class="team-count" data-cy="team-count">{{ view.total }}</span>
          <span>{{ view.total === 1 ? 'identity' : 'identities' }}</span>
          <span
            v-if="view.homeFoldersWithoutIdentity.length > 0"
            class="team-count-note"
            data-cy="team-count-note"
            >— and
            {{ view.homeFoldersWithoutIdentity.length }}
            {{ view.homeFoldersWithoutIdentity.length === 1 ? 'folder' : 'folders' }} on disk with
            no identity row, listed below</span
          >
        </div>

        <p v-if="view.total === 0" data-cy="team-none">
          No agent identities yet. Create one above, or one appears once a conversation has run as
          it.
        </p>
        <p v-else-if="view.members.length === 0" data-cy="team-no-match">
          No identity here matches that.
        </p>

        <section class="team-grid" data-cy="team-members" aria-label="Team members">
          <article
            v-for="member in visibleMembers"
            :key="member.identity.id"
            class="team-card bb-card"
            :data-cy="`team-card-${member.identity.slug}`"
          >
            <div class="card-head">
              <AgentState size="card" v-bind="member.facets" :label="member.heading" />
              <div class="card-who">
                <button
                  class="team-card-heading"
                  type="button"
                  :data-cy="`team-open-${member.identity.slug}`"
                  @click="emit('open', member.identity.slug)"
                >
                  <strong
                    class="team-heading-text"
                    :data-cy="`team-name-${member.identity.slug}`"
                    :title="member.heading"
                    >{{ member.heading }}</strong
                  >
                </button>
                <p class="who-line">
                  <span class="team-slug">{{ member.identity.slug }}</span>
                  <span
                    v-if="props.agents?.services?.includes(member.identity.slug) === true"
                    class="team-service-tag"
                    :data-cy="`team-service-${member.identity.slug}`"
                    >Service</span
                  >
                </p>
                <p
                  class="team-now"
                  :class="doingTone(member.doing)"
                  :data-doing="member.doing.it"
                  :data-cy="
                    member.doing.it === 'never-run'
                      ? `team-never-run-${member.identity.slug}`
                      : `team-now-${member.identity.slug}`
                  "
                >
                  <span class="dot"></span>{{ doingSays(member.doing) }}
                </p>
              </div>
            </div>

            <ul
              v-for="group in workersOf(member.identity.slug)"
              :key="group.key"
              class="shelf-rows team-workers"
              data-cy="team-worker-group"
              :data-identity="group.worker!.identity"
              :data-giver="group.worker!.giver"
              :aria-label="member.heading"
            >
              <li
                v-for="row in group.rows"
                :key="row.conversation"
                class="shelf-row"
                :data-cy="`team-worker-${row.conversation}`"
              >
                <div class="shelf-body">
                  <div class="team-worker-top">
                    <strong
                      class="team-worker-name"
                      :data-cy="`team-worker-name-${row.conversation}`"
                      :title="
                        [
                          workerLabel(member.heading, row.worker, row.namingPiece),
                          workerDescription(row.worker!, props.agents?.identities ?? null),
                        ].join('\n')
                      "
                      >{{ workerLabel(member.heading, row.worker, row.namingPiece) }}</strong
                    >
                    <span
                      class="team-now"
                      :class="STANDING_TONE[row.standing]"
                      :title="row.detail"
                      >{{ workerState(row.word, row.namingPiece) }}</span
                    >
                  </div>
                  <p
                    v-for="piece in workerSubtitles(
                      row.conversation,
                      row.namingPiece,
                      cast.forest.value?.nodes.rows.flatMap((node) =>
                        node.node === 'a-task' ? [node.work] : [],
                      ) ?? [],
                    )"
                    :key="piece.key"
                    class="team-worker-piece"
                    :title="piece.text"
                  >
                    {{ piece.text }}
                  </p>
                  <template v-if="activityOf(member, row.conversation)">
                    <p
                      v-if="activityOf(member, row.conversation)!.doing"
                      class="team-doing"
                      :class="activityOf(member, row.conversation)!.doing!.tone"
                      :data-cy="`team-doing-${row.conversation}`"
                    >
                      <span class="dot"></span
                      ><span class="doing-word">{{
                        activityWords(activityOf(member, row.conversation)!.doing!)
                      }}</span
                      ><span class="doing-since"
                        >· {{ activityOf(member, row.conversation)!.since }}</span
                      >
                    </p>
                    <p v-else class="team-silent" :data-cy="`team-quiet-${row.conversation}`">
                      Nothing published · {{ activityOf(member, row.conversation)!.since }}
                    </p>
                  </template>
                  <p class="shelf-line">
                    <span v-if="row.says" class="shelf-where">{{ row.says }}</span>
                    <span v-if="row.place" class="shelf-folder">{{ row.place }}</span>
                  </p>
                </div>
                <button
                  class="band-act"
                  type="button"
                  :data-cy="`team-worker-go-${row.conversation}`"
                  :title="row.detail"
                  :aria-description="row.detail"
                  @click="emit('openConversation', row.conversation)"
                >
                  {{ row.action }}<svg class="icon"><use href="#i-arrow" /></svg>
                </button>
              </li>
            </ul>

            <ul
              v-if="otherActivity(member).length > 0"
              class="team-at-work"
              :data-cy="`team-at-work-${member.identity.slug}`"
            >
              <li v-for="one in otherActivity(member)" :key="one.conversation" class="at-work-row">
                <p
                  v-if="one.doing"
                  class="team-doing"
                  :class="one.doing.tone"
                  :data-doing="one.doing.doing"
                  :data-cy="`team-doing-${one.conversation}`"
                >
                  <span class="dot"></span>
                  <span class="doing-word">{{ activityWords(one.doing) }}</span>
                  <span class="doing-since">· {{ one.since }}</span>
                </p>
                <p v-else class="team-silent" :data-cy="`team-quiet-${one.conversation}`">
                  Nothing published · {{ one.since }}
                </p>
                <button
                  class="band-act"
                  type="button"
                  :data-cy="`team-go-${one.conversation}`"
                  @click="emit('openConversation', one.conversation)"
                >
                  Open the conversation
                  <svg class="icon"><use href="#i-arrow" /></svg>
                </button>
              </li>
            </ul>

            <details
              v-if="!member.neverRun || props.focusedIdentity === member.identity.id"
              :open="props.focusedIdentity === member.identity.id"
              class="card-more their-more"
              :data-cy="`team-shelf-${member.identity.slug}`"
            >
              <summary :data-cy="`team-conversations-${member.identity.slug}`">
                Conversations
              </summary>
              <div class="more-body">
                <p v-if="shelfOf(member.identity.slug) === null" class="shelf-quiet">
                  The list of conversations has not answered yet.
                </p>
                <p v-else-if="shelfOf(member.identity.slug)!.length === 0" class="shelf-quiet">
                  No conversation on the list runs as it.
                </p>
                <ol v-else class="shelf-rows" :aria-label="`Conversations of ${member.heading}`">
                  <li
                    v-for="row in shelfOf(member.identity.slug)!"
                    :key="row.conversation"
                    class="shelf-row"
                    :data-cy="`team-conversation-${row.conversation}`"
                  >
                    <div class="shelf-body">
                      <p class="shelf-line">
                        <span
                          class="team-now"
                          :class="STANDING_TONE[row.standing]"
                          :title="row.detail"
                          :aria-description="row.detail"
                        >
                          <span class="dot"></span>{{ row.word }}
                        </span>
                        <span v-if="row.named" class="shelf-named">{{ row.named }}</span>
                        <span v-if="row.says" class="shelf-where">{{ row.says }}</span>
                        <span v-if="row.place" class="shelf-folder">{{ row.place }}</span>
                      </p>
                    </div>
                    <button
                      class="band-act"
                      type="button"
                      :data-cy="`team-conversation-go-${row.conversation}`"
                      :title="row.detail"
                      :aria-description="row.detail"
                      @click="emit('openConversation', row.conversation)"
                    >
                      {{ row.action }}
                      <svg class="icon"><use href="#i-arrow" /></svg>
                    </button>
                  </li>
                </ol>
              </div>
            </details>

            <AgentBookButton
              :profile-slug="member.identity.slug"
              :data-cy="`team-shapes-${member.identity.slug}`"
              @open="(profile) => emit('openShapes', profile)"
            />

            <details class="card-more">
              <summary :data-cy="`team-more-${member.identity.slug}`">
                Details, name and removal
              </summary>
              <div class="more-body">
                <p class="more-fact">
                  <span class="more-key">Engine</span>
                  <span :data-cy="`team-provider-${member.identity.slug}`">{{
                    member.provider ?? noProviderSavedSays(member.use.runsOn)
                  }}</span>
                </p>
                <p class="more-fact">
                  <span class="more-key">Recorded</span>
                  <span :data-cy="`team-recorded-${member.identity.slug}`"
                    >{{ member.use.conversations }} conversation{{
                      member.use.conversations === 1 ? '' : 's'
                    }}</span
                  >
                </p>
                <div class="team-actions">
                  <input
                    class="bb-input"
                    :value="draftFor(member.identity.slug, member.identity.displayName)"
                    maxlength="200"
                    :aria-label="`Display name for ${member.heading}`"
                    @input="
                      draftNames[member.identity.slug] = ($event.target as HTMLInputElement).value
                    "
                  />
                  <button
                    class="bb-button"
                    type="button"
                    :disabled="busy === member.identity.slug"
                    :data-cy="`team-rename-${member.identity.slug}`"
                    @click="rename(member.identity.slug, member.identity.displayName)"
                  >
                    Save name
                  </button>
                  <button
                    class="bb-button"
                    type="button"
                    :disabled="!member.canRemove || busy === member.identity.slug"
                    :title="member.canRemove ? 'Remove identity' : member.heldSays.join('; ')"
                    :data-cy="`team-remove-${member.identity.slug}`"
                    @click="remove(member.identity.slug)"
                  >
                    Remove
                  </button>
                </div>
                <p
                  v-if="!member.canRemove"
                  class="team-refusal"
                  :data-cy="`team-removal-refusal-${member.identity.slug}`"
                >
                  This cannot be removed yet: {{ member.heldSays.join('; ') }}.
                </p>
              </div>
            </details>
          </article>
        </section>
        <p class="team-removal-means" data-cy="team-removal-means">{{ AGENT_REMOVAL_MEANS }}</p>

        <p v-if="view.asOf" class="team-asof" data-cy="team-asof">
          What each agent is doing was read {{ view.asOf }}, and again every half minute while this
          page is open and BroCrew is in front.
        </p>

        <section
          v-if="view.homeFoldersWithoutIdentity.length"
          class="team-orphans"
          data-cy="team-other-home-folders"
        >
          <h2>
            {{
              view.homeFoldersWithoutIdentity.length === 1
                ? 'Another home folder'
                : 'Other home folders'
            }}
          </h2>
          <p data-cy="team-other-home-folders-says">
            {{
              view.homeFoldersWithoutIdentity.length === 1
                ? 'This folder exists on disk without an identity row.'
                : 'These folders exist on disk without an identity row.'
            }}
            Create one with the same name to give it its row.
          </p>
          <ul>
            <li v-for="folder in view.homeFoldersWithoutIdentity" :key="folder">{{ folder }}</li>
          </ul>
        </section>
      </template>
    </div>
  </section>
</template>

<style scoped>
.shelf-rows.team-workers {
  margin: var(--space-6) 0 0;
  padding-left: var(--space-5);
  border-left: var(--border-width) solid var(--line);
}
.team-worker-name {
  font-size: var(--type-small);
  font-weight: var(--fw-medium);
  overflow-wrap: anywhere;
}

.team-workspace {
  display: flex;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--space-16) var(--space-20) var(--space-28);
  overflow-y: auto;
  color: var(--paper-ink);
  background: var(--paper-bg);
}

.team-count-bar {
  display: flex;
  align-items: baseline;
  margin: 0 0 var(--space-6);
  color: var(--paper-muted);
  font-size: var(--type-small);
  gap: var(--space-3);
}
.team-count {
  color: var(--paper-ink);
  font-size: var(--type-reading);
  font-weight: var(--fw-semibold);
}
.team-count-note {
  min-width: 0;
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6);
}
.card-who {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
}

.who-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  margin: 0;
  gap: var(--space-4);
}
.team-slug {
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.team-now {
  display: flex;
  align-items: center;
  margin: var(--space-1) 0 0;
  color: var(--muted);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
}
.team-now .dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--faint);
}
.team-now.live {
  color: var(--accent-text-pale);
}
.team-now.live .dot {
  background: var(--accent);
}
.team-now.waiting {
  color: var(--waiting-text-label);
}
.team-now.waiting .dot {
  background: var(--waiting);
}

.team-at-work {
  display: flex;
  margin: var(--space-6) 0 0;
  flex-direction: column;
  padding: 0;
  gap: var(--space-3);
  list-style: none;
}
.at-work-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-4);
}

.team-doing {
  display: flex;
  min-width: 0;
  max-width: 100%;
  flex: 1 1 auto;
  align-items: baseline;
  margin: 0;
  color: var(--accent-text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
}
.team-doing.waiting {
  color: var(--waiting-text-label);
}

.team-doing .dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--accent);
}
.team-doing.waiting .dot {
  background: var(--waiting);
}

.doing-word {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doing-since {
  flex: 0 0 auto;
  color: var(--faint);
  font-size: var(--type-caption);
  font-weight: var(--fw-normal);
}

.team-silent {
  min-width: 0;
  flex: 1;
  margin: 0;
  color: var(--faint);
  font-size: var(--type-caption);
}

.band-act {
  display: inline-flex;
  align-items: center;
  border: 0;
  background: none;
  color: var(--accent-text-pale);
  padding: 0;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  gap: var(--space-2);
  cursor: pointer;
  white-space: nowrap;
}
.band-act:hover {
  text-decoration: underline;
}
.band-act .icon {
  width: 11px;
  height: 11px;
}

.their-more {
  margin-top: var(--space-6);
}

.shelf-rows {
  display: flex;
  margin: 0;
  flex-direction: column;
  padding: 0;
  gap: var(--space-4);
  list-style: none;
}
.shelf-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-2) var(--space-4);
}
.shelf-body {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
}
.shelf-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  margin: 0;
  gap: var(--space-3);
}
.shelf-named,
.shelf-where,
.shelf-folder {
  color: var(--faint);
  font-size: var(--type-caption);
}
.shelf-quiet {
  margin: var(--space-3) 0 0;
  color: var(--paper-muted);
  font-size: var(--type-caption);
}

.card-more {
  margin-top: var(--space-7);
  border-top: var(--border-width) solid var(--paper-line);
  padding-top: var(--space-5);
  color: var(--paper-muted);
  font-size: var(--type-caption);
}
.card-more > summary {
  cursor: pointer;
  list-style: none;
}
.card-more > summary::marker,
.card-more > summary::-webkit-details-marker {
  content: '';
}
.card-more > summary::before {
  display: inline-block;
  margin-right: var(--space-3);
  content: '›';
  transition: transform 120ms ease;
}
.card-more[open] > summary::before {
  transform: rotate(90deg);
}
.card-more > summary:hover {
  color: var(--paper-ink);
}

.more-body {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-4);
  gap: var(--space-4);
}
.more-fact {
  display: flex;
  margin: 0;
  gap: var(--space-4);
}
.more-key {
  min-width: 68px;
  color: var(--faint);
  font-size: var(--type-caption);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.team-header,
.team-controls,
.team-actions {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.team-tabs {
  display: flex;
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-4);
}

.team-tab {
  min-height: var(--control-h);
  padding: var(--space-3) var(--space-6);
  border: 0;
  border-bottom: var(--border-accent-width) solid transparent;
  margin-bottom: -1px;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
}

.team-tab:hover {
  color: var(--text);
}

.team-tab.on {
  border-bottom-color: var(--accent);
  color: var(--text);
  font-weight: var(--fw-bold);
}

.team-services {
  margin-left: auto;
  display: grid;
  gap: var(--space-2);
  justify-items: end;
}
.team-services-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
}
.team-services-line {
  color: var(--muted);
}
.team-service-tag {
  margin-left: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-2);
  color: var(--muted);
}
.team-header {
  justify-content: space-between;
  border-bottom: var(--border-width) solid var(--paper-line);
  padding-bottom: var(--space-12);
}
.team-header h1 {
  margin: var(--space-2) 0;
}
.eyebrow,
.team-lede {
  color: var(--paper-muted);
}
.eyebrow {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--type-caption);
}
.team-lede {
  margin: 0;
}
.team-controls {
  margin: var(--space-10) 0;
}
.team-controls input,
.team-controls select,
.team-actions input {
  min-width: 0;
}
.team-controls input {
  flex: 1;
}
.team-controls select {
  width: auto;
}
.team-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-8);
}
.team-card {
  padding: var(--card-padding);
}
.team-card-heading {
  display: grid;
  justify-items: start;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  cursor: pointer;
  max-width: 100%;
}
.team-card-heading strong {
  font-size: var(--type-heading);
}
.team-heading-text {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-refusal {
  margin: 0;
  font-size: var(--type-caption);
  color: var(--paper-muted);
}
.team-actions {
  margin-top: var(--space-2);
  flex-wrap: wrap;
}
.team-actions input {
  flex: 1 1 120px;
}
.team-orphans {
  margin-top: var(--space-14);
  border-top: var(--border-width) solid var(--paper-line);
  padding-top: var(--space-9);
}
.team-orphans h2 {
  margin: 0 0 var(--space-3);
  font-size: var(--type-heading);
}
.team-message {
  color: var(--paper-muted);
}
.team-removal-means,
.team-asof {
  margin: var(--space-7) 0 0;
  color: var(--paper-muted);
  font-size: var(--type-caption);
}
.team-worker-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
}
.team-worker-top .team-now {
  flex: none;
  white-space: nowrap;
}
.team-worker-top .team-worker-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-worker-piece {
  margin: var(--space-1) 0;
  color: var(--muted);
  font-size: var(--type-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
