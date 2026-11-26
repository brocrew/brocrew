<script setup lang="ts">
import MarkdownWords from './MarkdownWords.vue'
import { computed } from 'vue'
import type { ConversationRowCy, ConversationRowView } from '../lib/conversation-row'
import { agoWords, fullTime } from '../lib/clock'
import { useProviderLabel } from '../composables/useProviderLabel'
import AgentState from './AgentState.vue'
import ProviderLabel from './ProviderLabel.vue'
import ConversationStarButton from './ConversationStarButton.vue'
import type { StarTarget } from '../composables/useConversationStars'

/**
 * One conversation, drawn the one way the window draws it: its plate, its title, then what it is
 * doing (who it runs as, its provider, its state word, how long ago, where), then its address.
 * `full` draws those as lines; `compact` draws the title and the status on one line, with the whole
 * status on its hover. The list around it keeps its own container, press and keys; `aside` holds a
 * list's own controls and `below` its own extra lines.
 */
const props = withDefaults(
  defineProps<{
    row: ConversationRowView
    form?: 'full' | 'compact'
    /** The current minute, from the list's clock, for the age. */
    minute?: number
    plate?: 'compact' | 'row'
    /** Prefix of the ids a list's own aria attributes point at. */
    idPrefix?: string
    /** `contents` lets the row's parts sit in the list's own grid. */
    layout?: 'own' | 'contents'
    cy?: ConversationRowCy
    /** Seconds the agent has been silent, from the owner's own counter, for the plate. */
    silentSeconds?: number
    starTarget?: StarTarget
  }>(),
  {
    form: 'full',
    minute: () => Date.now(),
    plate: 'compact',
    idPrefix: 'row',
    layout: 'own',
    cy: () => ({}),
  },
)

const label = useProviderLabel()
const s = computed(() => props.row.status)
const providerWord = computed(() => (s.value.provider ? label(s.value.provider) || null : null))
const addressProviderWord = computed(() =>
  props.row.addressProvider ? label(props.row.addressProvider) || null : null,
)
const age = computed(() =>
  s.value.activityAt === undefined ? null : agoWords(s.value.activityAt, props.minute),
)

/** The whole status as one line of text, for a hover and for the compact form's title. */
const statusText = computed(
  () =>
    s.value.hint ??
    [
      s.value.profile,
      providerWord.value,
      s.value.detail ?? s.value.word,
      age.value,
      s.value.elsewhere,
      s.value.place,
      ...tail.value.map((one) => one.text),
    ]
      .filter(Boolean)
      .join(' · '),
)
/** The words after the place, each with the data-cy the list gave it. */
const tail = computed(() =>
  (s.value.tail ?? []).map((one, i) =>
    typeof one === 'string'
      ? { key: `tail-${i}`, text: one, cy: props.cy.tail, hint: undefined }
      : { key: `tail-${i}`, text: one.text, cy: one.cy ?? props.cy.tail, hint: one.hint },
  ),
)
/** The status parts the one-line forms draw, in order. */
const compactParts = computed(() =>
  [
    { key: 'profile', text: s.value.profile, cy: props.cy.profile, hint: undefined },
    { key: 'provider', text: providerWord.value, cy: props.cy.provider, hint: undefined },
    { key: 'word', text: s.value.word, cy: props.cy.word, hint: undefined },
    { key: 'elsewhere', text: s.value.elsewhere, cy: props.cy.elsewhere, hint: undefined },
    { key: 'place', text: s.value.place, cy: props.cy.place, hint: undefined },
    ...tail.value,
  ].filter((part) => !!part.text),
)
const hasPrefix = computed(() => !!(s.value.profile || providerWord.value))
/** Whether anything is drawn before the tail, so the tail's first part needs no separator. */
const hasBefore = computed(() => hasPrefix.value || !!s.value.word || age.value !== null)
const tailParts = computed(() =>
  [
    { key: 'elsewhere', text: s.value.elsewhere, cy: props.cy.elsewhere, hint: undefined },
    { key: 'place', text: s.value.place, cy: undefined, hint: undefined },
    ...tail.value,
  ].filter((part) => !!part.text),
)
</script>

<template>
  <div
    class="conversation-row"
    :data-form="props.form"
    :data-head="props.row.head"
    :data-layout="props.layout"
  >
    <template v-if="props.row.facets">
      <AgentState
        v-if="props.plate === 'row'"
        size="row"
        v-bind="props.row.facets"
        :label="props.row.plateLabel"
        :silent-seconds="props.silentSeconds"
      />
      <AgentState
        v-else
        size="compact"
        v-bind="props.row.facets"
        :label="props.row.plateLabel"
        :silent-seconds="props.silentSeconds"
      />
    </template>
    <slot name="lead" />
    <div
      class="rail-copy"
      :class="{
        'rail-worker-top': props.row.head === 'worker',
        'rail-brobot-copy': props.row.head === 'brobot',
      }"
    >
      <slot name="title">
        <span v-if="props.row.marks?.length" class="row-title-line">
          <strong
            :class="{ 'rail-canonical-title': props.row.canonical }"
            :data-cy="props.cy.title"
            :title="props.row.titleHint ?? props.row.title"
            >{{ props.row.title }}</strong
          ><span
            v-for="mark in props.row.marks"
            :key="mark.key"
            class="row-mark"
            :class="mark.tone"
            :title="mark.hint"
            :data-cy="mark.cy"
            >{{ mark.text }}</span
          >
        </span>
        <strong
          v-else
          :class="{ 'rail-canonical-title': props.row.canonical }"
          :data-cy="props.cy.title"
          :title="props.row.titleHint ?? props.row.title"
          >{{ props.row.title }}</strong
        >
      </slot>
      <span
        v-if="props.row.topWord"
        class="rail-worker-state"
        :title="props.row.topWordHint ?? props.row.topWord"
        :data-cy="props.cy.topWord"
        >{{ props.row.topWord }}</span
      >
      <slot v-if="props.form === 'compact' || props.row.head === 'brobot'" name="status">
        <small
          :id="`${props.idPrefix}-state-${props.row.id}`"
          class="rail-brobot-standing"
          :data-standing="s.standing"
          :data-needing="s.needing ?? undefined"
          :data-place="s.place ?? undefined"
          :aria-description="s.detail"
          :title="statusText"
          ><template v-for="(part, i) in compactParts" :key="part.key"
            ><template v-if="i > 0"> · </template
            ><ProviderLabel
              v-if="part.key === 'provider'"
              :provider="s.provider!"
              :data-cy="props.cy.provider"
            /><span v-else :data-cy="part.cy" :title="part.hint">{{ part.text }}</span></template
          ></small
        >
      </slot>
      <small
        v-else
        :id="`${props.idPrefix}-state-${props.row.id}`"
        :class="{
          'rail-standing-with-age': s.activityAt !== undefined,
          'rail-standing-canonical': props.row.canonical,
        }"
        :data-standing="s.standing"
        :aria-description="s.detail"
        :data-needing="s.needing ?? undefined"
        :data-place="s.place ?? undefined"
        :title="statusText"
        ><span class="rail-standing-prefix"
          ><span
            v-if="s.profile"
            class="rail-standing-profile"
            :data-cy="props.cy.profile"
            :title="s.profile"
            >{{ s.profile }}</span
          ><span
            v-if="providerWord"
            class="rail-standing-profile rail-standing-provider"
            :title="providerWord ?? undefined"
            :data-cy="props.cy.provider"
          >
            <template v-if="s.profile"> · </template>
            <ProviderLabel :provider="s.provider!" /> </span
          ><template v-if="s.word">
            <template v-if="hasPrefix"> · </template>
            <!-- In a card the inner span keeps the word to two lines, so it carries the name. -->
            <span
              class="rail-standing-word"
              :data-cy="props.layout === 'own' ? undefined : props.cy.word"
            >
              <span
                class="rail-standing-word-text"
                :data-cy="props.layout === 'own' ? props.cy.word : undefined"
                >{{ s.word }}</span
              >
            </span></template
          ></span
        ><span v-if="age !== null" class="rail-standing-age">
          <span> · </span>
          <time :title="`${age} · ${fullTime(s.activityAt!)}`">{{ age }}</time> </span
        ><span v-if="tailParts.length > 0" class="rail-standing-tail" :data-cy="props.cy.place"
          ><template v-for="(part, i) in tailParts" :key="part.key"
            ><template v-if="i > 0 || hasBefore"> · </template
            ><span :data-cy="part.cy" :title="part.hint">{{ part.text }}</span></template
          ></span
        ></small
      >
      <template v-if="props.form === 'full'">
        <small
          v-if="props.row.address"
          :title="[props.row.address, addressProviderWord].filter(Boolean).join(' · ')"
          >Conversation
          <span :data-cy="props.cy.address">{{ props.row.address }}</span>
          <template v-if="addressProviderWord">
            · <ProviderLabel :provider="props.row.addressProvider!"
          /></template>
          <template v-if="props.row.namedByYou"> · Named by you</template>
        </small>
        <MarkdownWords
          v-for="piece in props.row.pieces ?? []"
          :key="piece.key"
          class="rail-worker-piece"
          :title="[piece.lead, piece.text].filter(Boolean).join(' ')"
          :data-cy="piece.cy"
          :text="piece.text"
          :lead="piece.lead"
          :session-id="props.row.id"
        />
        <small
          v-if="props.row.opening"
          :id="`${props.idPrefix}-opening-${props.row.id}`"
          class="opening"
          :title="props.row.opening"
          :data-cy="props.cy.opening"
          >{{ props.row.opening }}</small
        >
        <slot name="below" />
      </template>
    </div>
    <slot name="aside" />
    <ConversationStarButton v-if="starTarget !== undefined" :target="starTarget" />
  </div>
</template>

<style scoped>
.conversation-row[data-layout='contents'] {
  display: contents;
}
.conversation-row[data-layout='own'] {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--space-4);
}
.conversation-row[data-layout='own'] > .rail-copy {
  flex: 1 1 auto;
}
/* The title and its marks on one line; the title gives way first. */
.row-title-line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  flex-wrap: wrap;
  column-gap: var(--space-3);
}
.row-title-line > strong {
  min-width: 0;
}
/* A mark beside the title: a word in a small box, with a dot where its tone has a colour. */
/* In a list's own card the status line wraps rather than cuts: each part keeps its place, the
   profile alone is cut (its title has it whole), and the state word takes at most two lines (its
   line's title has it whole). Only the rail, which lays the row into its own grid, keeps each line
   to one and puts the rest on the hover. */
.conversation-row[data-layout='own'][data-form='full']
  > .rail-copy
  > small:not(.rail-brobot-standing) {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  overflow: visible;
  column-gap: var(--space-2);
  white-space: normal;
}
.conversation-row[data-layout='own'][data-form='full'] .rail-standing-prefix,
.conversation-row[data-layout='own'][data-form='full'] .rail-standing-tail,
.conversation-row[data-layout='own'][data-form='full'] .rail-standing-age {
  display: contents;
}
.conversation-row[data-layout='own'][data-form='full'] .rail-standing-profile {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-row[data-layout='own'][data-form='full'] .rail-standing-word {
  min-width: 0;
  flex: 0 1 auto;
}
.conversation-row[data-layout='own'][data-form='full'] .rail-standing-word-text {
  display: -webkit-box;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
/* The one-line form: the title, then the status after it, the status giving way first. */
.conversation-row[data-form='compact'] {
  align-items: center;
}
.conversation-row[data-form='compact'] > .rail-copy {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-4);
}
.conversation-row[data-form='compact'] > .rail-copy > strong {
  flex: 0 1 auto;
}
.conversation-row[data-form='compact'] > .rail-copy > small {
  flex: 1 1 0;
  min-width: 0;
  margin-top: 0;
}
.row-mark {
  display: inline-flex;
  align-items: center;
  min-height: var(--space-8);
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-xs);
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
  vertical-align: baseline;
  white-space: nowrap;
  gap: var(--space-2);
}
.row-mark:is(.ours, .imported, .home, .only, .restored, .child)::before {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--faint);
  content: '';
}
.row-mark.ours::before,
.row-mark.home::before {
  background: var(--accent);
}
.row-mark.imported::before {
  background: var(--ready);
}
.row-mark.only::before {
  background: var(--accent-2);
}
.row-mark.child,
.row-mark.home {
  border-color: var(--accent-border);
  color: var(--accent-text);
}
.row-mark.only,
.row-mark.archived {
  background: var(--wash-3);
  color: var(--text-soft);
}
.rail-copy small.opening {
  color: var(--row-muted, var(--muted));
}
.rail-copy small.rail-standing-with-age {
  display: flex;
  color: var(--text);
}
.rail-standing-with-age .rail-standing-prefix {
  display: flex;
  flex: none;
  max-width: calc(100% - 4em - var(--space-4));
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-standing-with-age .rail-standing-profile {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Beside a profile, the provider's name is drawn whole and the profile takes any shortening. */
.rail-standing-with-age .rail-standing-profile + .rail-standing-provider {
  flex: none;
}
.rail-standing-word {
  flex: none;
}
.rail-standing-age {
  display: flex;
  flex: 0 1 auto;
  min-width: 4em;
}
.rail-standing-age > span {
  flex: none;
}
.rail-standing-age time,
.rail-standing-with-age .rail-standing-tail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-standing-with-age .rail-standing-tail {
  flex: 1 1 0;
  min-width: var(--space-4);
}
.rail-standing-canonical .rail-standing-prefix {
  flex: 1 1 auto;
  min-width: 0;
}
.rail-standing-canonical .rail-standing-profile {
  flex: none;
  max-width: 50%;
}
.rail-standing-canonical .rail-standing-word {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-worker-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: baseline;
  column-gap: var(--space-2);
  min-width: 0;
}
.rail-worker-top > small {
  grid-column: 1 / -1;
}
.rail-worker-top strong {
  min-width: 0;
  white-space: nowrap;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-worker-state {
  flex: none;
  font-size: var(--type-caption);
  color: var(--muted);
  white-space: nowrap;
}
.rail-copy .rail-worker-piece {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
