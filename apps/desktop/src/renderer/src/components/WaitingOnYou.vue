<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { agentName, type AgentIdentities } from '../../../shared/runtime-ipc'
import { aProviderNotChosenSays } from '../lib/front-door-words'
import { providersNotChosenIn } from '../lib/agent-store'
import { owedByList, owedHere, type WaitingList } from '../lib/owed-here'
import { homeAttention, permissionsIntro } from '../lib/home-attention'
import { isAnApproval, stopKey, usePersonsQueue } from '../lib/persons-queue'
import { usageSays, usageTitle } from '../lib/usage-limit'
import { limitsDisplayLabel, limitsDisplayWords } from '../lib/limits-display'
import type { AttentionDecision, AttentionRequest } from '../lib/attention'
import AttentionQueue from './AttentionQueue.vue'
import InstructionAsks from './InstructionAsks.vue'
import LoadingCards from './LoadingCards.vue'
import McpServerRequests from './McpServerRequests.vue'
import WorkWaits from './WorkWaits.vue'
import PersonsQueue from './PersonsQueue.vue'
import WaitingOnWhoWrote from './WaitingOnWhoWrote.vue'
import SinceYouWereLastHere from './SinceYouWereLastHere.vue'
import type { SinceView } from '../lib/recent-activity'

/**
 * Waiting on you: everything a person owes, however old, sorted into five lists. A big pill per
 * list carries its count, and one list shows at a time. While a list is open, what arrives in it
 * waits behind a "new" pill, so nothing moves under the person's eyes. Nothing here computes a
 * population: `persons-queue.ts` and `attention.ts` decide what each list holds.
 */
const props = withDefaults(
  defineProps<{
    /** The cards on this window's conversations that no host read lists, built by `RuntimeScreen`. */
    needsYou?: AttentionRequest[]
    /** The clock the ages are measured against; it ticks only while something is waiting. */
    clock?: number
    /** The last roster read, for the agents no other agent can start until a person chooses. */
    agents?: AgentIdentities | null
    /** What finished or failed since the person was last here, or `null` to draw no chip. */
    sinceLastHere?: { view: SinceView; since: number } | null
  }>(),
  { needsYou: () => [], clock: () => Date.now(), agents: null, sinceLastHere: null },
)

const emit = defineEmits<{
  /** Answer a pending request without leaving this page. */
  decide: [request: AttentionRequest, decision: AttentionDecision]
  /** Go to the card itself. */
  openRequest: [request: AttentionRequest]
  /** Open an agent's sheet, where its provider is chosen. */
  openAgent: [profileSlug: string]
  seeRecentActivity: []
}>()

const persons = usePersonsQueue()

const view = computed(() => persons.view.value)
const personsRows = computed(() => view.value?.rows ?? [])
const askRows = computed(() => persons.asks.value?.rows ?? [])
const serverRequests = computed(() => persons.serverRequests.value?.rows ?? [])
const replies = computed(() => persons.waitingOnWhoWrote.value?.rows ?? [])
const todos = computed(() => persons.workWaits.value.todos)
const incidents = computed(() => persons.workWaits.value.incidents)

/** A provider's usage limit is nobody's to settle: drawn in the page head, outside every list. */
const walls = computed(() => persons.limits.value?.walls ?? [])
const wallsUnread = computed(() => persons.limits.value?.unread === true)
const limitsDisplay = computed(() => persons.limits.value?.display)

/** The agents no other agent can start until a person chooses their provider. */
const notChosen = computed(() =>
  providersNotChosenIn(props.agents).map(({ slug, startedOn }) => ({
    slug,
    says: aProviderNotChosenSays(agentName(slug, props.agents?.identities ?? null), startedOn),
  })),
)

const onlyYou = computed(() => owedHere(persons, props.agents))

/** Every summary on this page, decided in one place. */
const attention = computed(() =>
  homeAttention({
    requests: props.needsYou,
    onlyYou: onlyYou.value,
    unread: persons.mayBeShort.value,
  }),
)

/**
 * Whether everything waiting is a request for a permission, this window's cards and the rows below
 * alike, so the intro may call them that.
 */
const permissionsOnly = computed(
  () =>
    attention.value.total > 0 &&
    !attention.value.unread &&
    askRows.value.length === 0 &&
    serverRequests.value.length === 0 &&
    replies.value.length === 0 &&
    todos.value.rows.length === 0 &&
    incidents.value.rows.length === 0 &&
    notChosen.value.length === 0 &&
    props.needsYou.every((request) => request.kind === 'permission') &&
    personsRows.value.every(
      (row) =>
        row.kind === 'a-decision' &&
        row.answers.length > 0 &&
        row.answers.every((answer) => answer.kind === 'permission'),
    ),
)

type Pill = WaitingList

/** The five lists, always all five and always in this order, so the pills never move. */
const PILLS: readonly { readonly id: Pill; readonly label: string; readonly none: string }[] = [
  { id: 'questions', label: 'Questions', none: 'No questions for you.' },
  { id: 'todo', label: 'To do', none: 'Nothing to do.' },
  { id: 'approvals', label: 'Approvals', none: 'Nothing to approve.' },
  { id: 'work', label: 'Work that needs you', none: 'No work needs you.' },
  { id: 'reply', label: 'Your reply', none: 'Nobody is waiting on your reply.' },
]

const liveQuestions = computed(() => props.needsYou.filter((one) => one.kind === 'question'))
const livePermissions = computed(() => props.needsYou.filter((one) => one.kind === 'permission'))

/**
 * Every card each list draws: which component draws it (`from`), its key, and when it began
 * waiting (`null` when no clock was kept).
 */
type Aged = { readonly key: string; readonly at: number | null } & (
  | { readonly from: 'live'; readonly request: AttentionRequest }
  | { readonly from: 'not-chosen'; readonly says: string }
  | {
      readonly from:
        | 'persons'
        | 'ask'
        | 'server'
        | 'todo'
        | 'incidents'
        | 'recoveries'
        | 'stalled'
        | 'stopped'
        | 'reply'
    }
)
const live = (request: AttentionRequest): Aged => ({
  from: 'live',
  key: request.key,
  at: request.at,
  request,
})
const aged = computed<Readonly<Record<Pill, readonly Aged[]>>>(() => ({
  questions: [
    ...liveQuestions.value.map(live),
    ...personsRows.value
      .filter((row) => !isAnApproval(row))
      .map((row) => ({ from: 'persons' as const, key: row.key, at: row.blockedSince })),
  ],
  todo: persons.todoCards.value.map(({ row }) => ({ from: 'todo', key: row.key, at: row.at })),
  approvals: [
    ...livePermissions.value.map(live),
    ...personsRows.value
      .filter(isAnApproval)
      .map((row) => ({ from: 'persons' as const, key: row.key, at: row.blockedSince })),
    ...askRows.value.map((one) => ({ from: 'ask' as const, key: one.askId, at: one.at })),
    ...[...serverRequests.value, ...persons.serverRequestsSettled.value.map(({ row }) => row)].map(
      (one) => ({ from: 'server' as const, key: one.requestId, at: one.at }),
    ),
    ...notChosen.value.map((one) => ({
      from: 'not-chosen' as const,
      key: one.slug,
      at: null,
      says: one.says,
    })),
  ],
  work: [
    ...(['incidents', 'recoveries'] as const).flatMap((from) =>
      persons.workCards.value[from].map(({ entry }) => ({ from, key: entry.key, at: entry.at })),
    ),
    ...(persons.stalled.value?.rows ?? []).map((row) => ({
      from: 'stalled' as const,
      key: row.key,
      at: row.at,
    })),
    ...persons.stoppedCards.value.map(({ row }) => ({
      from: 'stopped' as const,
      key: stopKey(row),
      at: row.at,
    })),
  ],
  reply: replies.value.map((row) => ({ from: 'reply', key: row.key, at: row.at })),
}))

/** How many things in each list are the person's to settle: what its pill counts. */
const owed = computed(() => owedByList(persons, props.agents, props.needsYou))

/**
 * Before the screen's first reading, every list is drawn as grey cards, never as empty. The reads
 * behind the lists are supplied together, so the first one ends it for all five, answered or not.
 */
const loading = computed(() => !persons.looked.value)

const personsShort = computed(() => {
  const read = view.value
  if (read === null) return persons.looked.value
  return read.partial || read.stale || read.noLedger || read.rowsDropped
})
const workShort = computed(() =>
  [persons.stalled.value, persons.stopped.value].some(
    (band) => band !== null && (band.unread || !!band.short),
  ),
)

/** A list whose last read did not answer, or answered short: one line says some may be missing. */
const short = computed<Readonly<Record<Pill, boolean>>>(() => {
  const asks = persons.asks.value
  const requests = persons.serverRequests.value
  const written = persons.waitingOnWhoWrote.value
  return {
    questions: personsShort.value,
    todo: todos.value.unread || !!todos.value.short,
    approvals:
      personsShort.value ||
      (asks !== null && (asks.partial || asks.stale)) ||
      (requests !== null && (requests.partial || requests.stale)),
    work: incidents.value.unread || !!incidents.value.short || workShort.value,
    reply: written !== null && (written.unread || !!written.short),
  }
})

/**
 * One short line beside the title: how much needs the person, or that nothing does. None before
 * the first read, and none when nothing waits but the queue may be short, as the rail's badge
 * reads it: the list's own line says so.
 */
const intro = computed(() => {
  if (loading.value) return ''
  const total = attention.value.total
  if (total === 0) return attention.value.unread || personsShort.value ? '' : 'Nothing needs you.'
  if (permissionsOnly.value) return permissionsIntro(total)
  return total === 1 ? '1 thing needs you.' : `${String(total)} things need you.`
})

/**
 * The list on screen. Until the person picks one, the first list with something in it, chosen
 * once the reads have something to say, so the page never switches lists by itself afterwards.
 */
const picked = ref<Pill | null>(null)
const shown = computed<Pill>(() => picked.value ?? 'questions')
watch(
  [owed, aged, loading],
  () => {
    if (picked.value !== null) return
    const first =
      PILLS.find((pill) => owed.value[pill.id] > 0) ??
      PILLS.find((pill) => aged.value[pill.id].length > 0)
    if (first !== undefined) picked.value = first.id
    else if (!loading.value) picked.value = 'questions'
  },
  { immediate: true },
)

/**
 * Keep the open list still while the person reads it. Opening a list or changing its order sorts
 * it whole. Arrivals wait behind the "new" pill.
 */
const sort = ref<'oldest' | 'newest'>('oldest')
const inDateOrder = (cards: readonly Aged[], previous?: ReadonlyMap<string, number>): Aged[] => {
  const direction = sort.value === 'oldest' ? 1 : -1
  const rank = ({ at }: Aged) => (at === null ? Infinity : direction * at)
  const previousRank = ({ key }: Aged) => previous?.get(key) ?? Infinity
  return [...cards].sort((a, b) => rank(a) - rank(b) || previousRank(a) - previousRank(b) || 0)
}
const order = ref<ReadonlyMap<string, number> | null>(null)
function look(previous?: ReadonlyMap<string, number>): void {
  if (loading.value) {
    order.value = null
    return
  }
  const next = new Map<string, number>()
  for (const { key } of inDateOrder(aged.value[shown.value], previous))
    if (!next.has(key)) next.set(key, next.size)
  order.value = next
}
watch(shown, () => look())
watch(
  loading,
  (still) => {
    if (!still && order.value === null) look()
  },
  { immediate: true },
)
/**
 * Each list's cards in the order they are drawn, and so read and tabbed through: the open list as
 * the person found it, every other list in the selected order. Every list stays drawn, so nothing
 * typed in one is lost when another opens.
 */
const drawn = computed<Readonly<Record<Pill, readonly Aged[]>>>(() => {
  const found = order.value
  const lists = Object.fromEntries(PILLS.map((pill) => [pill.id, inDateOrder(aged.value[pill.id])]))
  if (found !== null)
    lists[shown.value] = aged.value[shown.value]
      .filter(({ key }) => found.has(key))
      .sort((a, b) => found.get(a.key)! - found.get(b.key)!)
  return lists as Record<Pill, Aged[]>
})
const held = computed(() => aged.value[shown.value].length - drawn.value[shown.value].length)

/** Over a list with nothing drawn, arrivals move nothing, so they are drawn at once. */
watch(held, (count) => {
  if (count > 0 && count === aged.value[shown.value].length) look()
})

const list = ref<HTMLElement | null>(null)
watch(sort, () => {
  look()
  list.value?.scrollTo({ top: 0 })
})
function pick(pill: Pill): void {
  picked.value = pill
  look()
  list.value?.scrollTo({ top: 0 })
}
async function showNew(): Promise<void> {
  const pill = shown.value
  const previous = order.value ?? undefined
  look(previous)
  const firstNew = drawn.value[pill].findIndex(({ key }) => !previous?.has(key))
  await nextTick()
  list.value
    ?.querySelector(`[data-cy="waiting-list-${pill}"]`)
    ?.children[firstNew]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

/** Answered to-dos stay where they were, as one line, until the person clears them. */
const answered = computed(() =>
  persons.todoCards.value.filter((card) => card.taken && !card.listed && !card.pending),
)
function clearAnswered(): void {
  for (const card of answered.value) persons.dismissTodo(card.row)
}

/** "Nothing here" is said only over a list read whole with nothing in it, held or drawn. */
const drawsNothing = computed(
  () => aged.value[shown.value].length === 0 && !loading.value && !short.value[shown.value],
)
</script>

<template>
  <section
    class="waiting-surface bb-conversation-ground"
    data-wired="true"
    data-cy="waiting-on-you"
    data-chat-theme="light"
  >
    <header class="page-head">
      <div class="head-row">
        <h1 class="bb-page-title">Waiting on you</h1>
        <p v-if="intro" class="intro" data-cy="waiting-intro">{{ intro }}</p>
        <span class="head-spacer"></span>
        <div class="head-chips">
          <SinceYouWereLastHere
            v-if="props.sinceLastHere"
            :view="props.sinceLastHere.view"
            :since="props.sinceLastHere.since"
            :clock="props.clock"
            @see-all="emit('seeRecentActivity')"
          />
          <span v-if="limitsDisplay" class="chip" data-cy="limits-display-reading">
            {{ limitsDisplayLabel(limitsDisplay) }}
            <template v-if="limitsDisplay.reading && limitsDisplay.status !== 'ready'">
              · {{ limitsDisplayWords.lastReading(limitsDisplay.reading.evaluatedAt) }}
            </template>
            <template v-if="limitsDisplay.status === 'unavailable'">
              · {{ limitsDisplayWords.failed }}</template
            >
          </span>
          <ul
            v-if="walls.length > 0 && limitsDisplay?.status !== 'unavailable'"
            class="walls"
            data-cy="persons-queue-walls"
          >
            <li
              v-for="wall in walls"
              :key="wall.key"
              class="chip usage-limit"
              :data-standing="wall.standing"
              :data-cy="`persons-queue-wall-${wall.provider}`"
            >
              <span
                :title="usageTitle(wall)"
                :data-cy="`persons-queue-wall-says-${wall.provider}`"
                >{{
                  limitsDisplay?.reading
                    ? limitsDisplayWords.condition(
                        usageSays(wall, limitsDisplay.reading.evaluatedAt),
                        limitsDisplay.reading.evaluatedAt,
                      )
                    : usageSays(wall, props.clock)
                }}</span
              >
            </li>
          </ul>
          <span
            v-if="wallsUnread && !limitsDisplay"
            class="chip"
            data-cy="persons-queue-walls-unread"
          >
            Usage limits couldn't be read.
          </span>
        </div>
      </div>
      <div class="pills" role="tablist" aria-label="What is waiting on you">
        <button
          v-for="pill in PILLS"
          :key="pill.id"
          type="button"
          role="tab"
          class="pill"
          :class="{ zero: owed[pill.id] === 0 }"
          :aria-selected="pill.id === shown"
          :data-cy="`waiting-pill-${pill.id}`"
          @click="pick(pill.id)"
        >
          <span class="count" :data-cy="`waiting-pill-count-${pill.id}`">{{
            (loading || short[pill.id]) && owed[pill.id] === 0 ? '' : owed[pill.id]
          }}</span>
          {{ pill.label }}
        </button>
      </div>
    </header>

    <div ref="list" class="attention-list" role="tabpanel" :data-list="shown">
      <div class="list-bar">
        <p v-if="short[shown]" class="short" role="status" data-cy="waiting-list-short">
          Couldn't read all of this list. Trying again…
        </p>
        <span class="bar-spacer"></span>
        <select
          v-model="sort"
          class="bb-input waiting-sort"
          aria-label="Sort by date"
          data-cy="waiting-sort"
        >
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
        <button
          v-if="shown === 'todo' && answered.length > 0"
          type="button"
          class="clear"
          data-cy="waiting-clear-answered"
          @click="clearAnswered"
        >
          Clear {{ answered.length }} answered
        </button>
        <button
          v-if="held > 0"
          type="button"
          class="new"
          data-cy="waiting-show-new"
          @click="showNew"
        >
          {{ held }} new
        </button>
      </div>

      <div class="list-body">
        <LoadingCards v-if="loading && aged[shown].length === 0" />
        <p v-else-if="drawsNothing" class="none" data-cy="waiting-list-none">
          {{ PILLS.find((pill) => pill.id === shown)?.none }}
        </p>

        <div
          v-for="pill in PILLS"
          v-show="shown === pill.id"
          :key="pill.id"
          class="one-list"
          :data-cy="`waiting-list-${pill.id}`"
        >
          <div
            v-for="one in drawn[pill.id]"
            :key="`${one.from}:${one.key}`"
            class="one-card"
            :data-at="one.at ?? ''"
          >
            <AttentionQueue
              v-if="one.from === 'live'"
              :requests="[one.request]"
              :now="props.clock"
              :alone="false"
              @decide="(request, decision) => emit('decide', request, decision)"
              @open="(request) => emit('openRequest', request)"
            />
            <PersonsQueue
              v-else-if="one.from === 'persons'"
              :part="pill.id === 'approvals' ? 'approvals' : 'questions'"
              :only="one.key"
            />
            <PersonsQueue
              v-else-if="one.from === 'stalled' || one.from === 'stopped'"
              part="work"
              :only="one.key"
            />
            <InstructionAsks v-else-if="one.from === 'ask'" :only="one.key" />
            <McpServerRequests v-else-if="one.from === 'server'" :only="one.key" />
            <WorkWaits v-else-if="one.from === 'todo'" part="todos" :only="one.key" />
            <WorkWaits
              v-else-if="one.from === 'incidents' || one.from === 'recoveries'"
              :part="one.from"
              :only="one.key"
            />
            <WaitingOnWhoWrote v-else-if="one.from === 'reply'" :only="one.key" />
            <div
              v-else-if="one.from === 'not-chosen'"
              class="provider-not-chosen"
              :data-cy="`waiting-provider-not-chosen-${one.key}`"
            >
              <p class="usage-says">{{ one.says }}</p>
              <button
                type="button"
                class="usage-door"
                :data-cy="`waiting-provider-choose-${one.key}`"
                @click="emit('openAgent', one.key)"
              >
                Choose its provider
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.waiting-surface {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.page-head {
  flex: 0 0 auto;
  padding: var(--space-9) var(--space-12) var(--space-8);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--surface-header-bg);
}

.head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-4) var(--space-7);
}

.head-row h1 {
  margin: 0;
}

.intro {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-reading);
}

.head-spacer {
  flex: 1;
}

.head-chips {
  display: flex;
  overflow-x: auto;
  min-width: 0;
  height: calc(var(--control-h) + var(--space-4));
  flex: 0 0 100%;
  align-self: center;
  align-items: flex-start;
  gap: var(--space-4);
  scrollbar-width: thin;
}

.head-chips > * {
  flex: none;
  white-space: nowrap;
}

.chip {
  display: inline-flex;
  min-height: var(--control-h);
  align-items: center;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--panel);
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-medium);
}

.walls {
  display: flex;
  margin: 0;
  gap: var(--space-4);
  padding: 0;
  list-style: none;
}

.chip.usage-limit {
  border-color: var(--waiting-pill-border);
  background: var(--waiting-bg);
  color: var(--waiting-text-label);
}

.chip.usage-limit[data-standing='stopped'] {
  font-weight: var(--fw-semibold);
}

/* The five lists: big, and always in one place. */
.pills {
  display: flex;
  flex-wrap: wrap;
  margin-top: var(--space-8);
  gap: var(--space-5);
}

.pill {
  display: inline-flex;
  height: var(--space-28);
  align-items: center;
  padding: 0 var(--space-11) 0 var(--space-4);
  border: var(--border-accent-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--panel);
  color: var(--text);
  font-size: var(--type-reading);
  font-weight: var(--fw-semibold);
  cursor: pointer;
  gap: var(--space-6);
}

.pill:hover {
  border-color: var(--accent-border);
  background: var(--accent-fill-weak);
}

.pill .count {
  display: grid;
  min-width: var(--space-20);
  height: var(--space-20);
  place-items: center;
  padding: 0 var(--space-5);
  border-radius: var(--radius-pill);
  background: var(--panel-3);
  color: var(--text);
  font-size: var(--type-title);
  font-weight: var(--fw-heavy);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

.pill[aria-selected='true'] {
  border-color: var(--accent);
  background: var(--accent-fill);
  color: var(--accent-text);
}

.pill[aria-selected='true'] .count {
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

.pill.zero:not([aria-selected='true']) {
  color: var(--text-soft);
  font-weight: var(--fw-medium);
}

.pill.zero .count {
  border: var(--border-accent-width) solid var(--line-strong);
  background: transparent;
  color: var(--text-soft);
}

.attention-list {
  container: waiting-requests / inline-size;
  min-height: 0;
  flex: 1;
  padding: 0 var(--space-12) var(--space-20);
  background: var(--attention-bg);
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.attention-list > * {
  max-width: 940px;
}

/* A reserved row: the "new" pill and the list's one note appear here, so no card moves. */
.list-bar {
  position: sticky;
  z-index: 1;
  top: 0;
  display: flex;
  min-height: var(--space-24);
  align-items: center;
  gap: var(--space-6);
}

.bar-spacer {
  flex: 1;
}

.waiting-sort {
  width: auto;
}

.short {
  margin: 0;
  color: var(--waiting-text-label);
  font-size: var(--type-small);
  font-weight: var(--fw-medium);
}

.clear {
  min-height: var(--control-h);
  padding: 0 var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-medium);
}

.new {
  display: inline-flex;
  min-height: var(--control-h);
  align-items: center;
  padding: 0 var(--space-7);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--accent-2);
  color: var(--accent-ink);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  box-shadow: var(--shadow-card);
}

.none {
  margin: 0;
  padding: var(--space-20) var(--space-12);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius-card);
  background: var(--panel);
  color: var(--text-soft);
  font-size: var(--type-reading);
  text-align: center;
}

/* Every card on the page shares one shell, one column wide. */
.provider-not-chosen,
.attention-list :deep(.pq-row),
.attention-list :deep(.pq-stall),
.attention-list :deep(.wait),
.attention-list :deep(.request),
.attention-list :deep(.reply),
.attention-list :deep(.asks > .ask),
.attention-list :deep(.attention-request) {
  min-width: 0;
  padding: var(--card-padding) var(--space-9);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}

/* One column of cards, drawn in age order across every kind: whatever holds them steps aside. */
.list-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.one-list,
.one-card,
.attention-list :deep(.persons-queue),
.attention-list :deep(.pq-body),
.attention-list :deep(.pq-rows),
.attention-list :deep(.pq-stalled),
.attention-list :deep(.waits),
.attention-list :deep(.requests),
.attention-list :deep(.replies),
.attention-list :deep(.asks),
.attention-list :deep(.attention-live),
.attention-list :deep(.attention-rows) {
  display: contents;
}

/* An answered card is one quiet line, where it was. */
.attention-list :deep(.wait.settled) {
  padding-block: var(--space-5);
  background: var(--panel-2);
  box-shadow: none;
}

.attention-list :deep(.pq-stall),
.attention-list :deep(.wait),
.attention-list :deep(.request),
.attention-list :deep(.reply),
.attention-list :deep(.asks > .ask) {
  gap: var(--space-4);
}

.attention-list :deep(.pq-stall > p),
.attention-list :deep(.wait > p) {
  margin: 0;
}

.provider-not-chosen {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.usage-says {
  flex: 1;
  margin: 0;
  color: var(--text);
  font-size: var(--type-reading);
  font-weight: var(--fw-semibold);
}

/* Readable type on every card: who and when at 13, the words at 15, nothing fainter than muted. */
.attention-list :deep(.pq-stall-says),
.attention-list :deep(.pq-stop-who),
.attention-list :deep(.request-who),
.attention-list :deep(.reply-who),
.attention-list :deep(.ask-who),
.attention-list :deep(.question-head),
.attention-list :deep(.request-head) {
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-normal);
}

.attention-list :deep(.pq-stall-what),
.attention-list :deep(.wait-says),
.attention-list :deep(.reply-what),
.attention-list :deep(.request-asked),
.attention-list :deep(.request-line),
.attention-list :deep(.ask-why) {
  color: var(--text);
  font-size: var(--type-reading);
  font-weight: var(--fw-semibold);
  line-height: var(--leading-snug);
}

.attention-list :deep(.pq-stall-said),
.attention-list :deep(.pq-meta),
.attention-list :deep(.request-age),
.attention-list :deep(.request-means) {
  color: var(--muted);
  font-size: var(--type-small);
}

/* Every card's buttons on one line: the answers first, the way to the conversation last. */
.attention-list :deep(.pq-stop-actions),
.attention-list :deep(.wait-controls),
.attention-list :deep(.request-controls),
.attention-list :deep(.ask-controls),
.attention-list :deep(.pq-actions),
.attention-list :deep(.request-actions) {
  display: flex;
  flex-wrap: wrap;
  align-self: stretch;
  align-items: center;
  gap: var(--space-4);
}

.attention-list :deep(.pq-controls) {
  display: flex;
  margin-left: auto;
  gap: var(--space-4);
}

.attention-list :deep(.pq-stall > .pq-go),
.attention-list :deep(.reply-go),
.attention-list :deep(.pq-stall-actions .pq-go),
.attention-list :deep(.pq-door),
.attention-list :deep(.wait-door) {
  margin-left: auto;
}

.usage-door,
.attention-list :deep(.pq-answer),
.attention-list :deep(.pq-take-over),
.attention-list :deep(.request-decide),
.attention-list :deep(.ask-controls > button:not(.pq-go)),
.attention-list :deep(.wait-controls > button),
.attention-list :deep(.request-controls > button:not(.pq-go)),
.attention-list :deep(.close-work button) {
  display: inline-flex;
  min-height: var(--control-h);
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-7);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-medium);
  gap: var(--control-gap);
}

/* The way to the conversation reads as a link, so the answers stay the buttons. */
.attention-list :deep(.pq-go),
.attention-list :deep(.reply-go),
.attention-list :deep(.request-open),
.attention-list :deep(.wait-controls > .wait-door) {
  display: inline-flex;
  min-height: var(--control-h);
  align-items: center;
  padding: 0 var(--space-2) 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--accent-2-text);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  gap: var(--control-gap);
}

.usage-door:hover,
.attention-list :deep(.pq-answer:hover),
.attention-list :deep(.request-decide:hover:not(:disabled)),
.attention-list :deep(.ask-controls > button:not(.pq-go):hover),
.attention-list :deep(.wait-controls > button:hover:not(:disabled)),
.attention-list :deep(.request-controls > button:not(.pq-go):hover:not(:disabled)) {
  border-color: var(--accent-border);
  background: var(--accent-fill);
}

.attention-list :deep(.pq-go:hover),
.attention-list :deep(.reply-go:hover),
.attention-list :deep(.request-open:hover),
.attention-list :deep(.wait-controls > .wait-door:hover) {
  background: var(--accent-2-mix-7);
}

.attention-list :deep(.pq-go .icon),
.attention-list :deep(.reply-go .icon),
.attention-list :deep(.wait-door .icon) {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

/* The rules an agent asked for, in the request card's own code box: its panel, line and ink. */
.attention-list :deep(.ask-text) {
  border: var(--border-width) solid var(--line-strong);
  background: var(--code-bg);
  color: var(--code-text);
}

/* A row that draws the live card itself keeps the card's own spacing. */
.attention-list :deep(.pq-row.with-live-card) {
  gap: var(--space-1);
}
</style>
