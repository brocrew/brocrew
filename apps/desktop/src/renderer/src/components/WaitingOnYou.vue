<script setup lang="ts">
import { computed } from 'vue'
import { agentName, type AgentIdentities } from '../../../shared/runtime-ipc'
import { aProviderNotChosenSays } from '../lib/front-door-words'
import { providersNotChosenIn } from '../lib/agent-store'
import { homeAttention, permissionsIntro, theStatBesideTheLines } from '../lib/home-attention'
import { usePersonsQueue } from '../lib/persons-queue'
import { usageSays, usageTitle } from '../lib/usage-limit'
import { limitsDisplayLabel, limitsDisplayWords } from '../lib/limits-display'
import type { AttentionDecision, AttentionRequest } from '../lib/attention'
import AttentionQueue from './AttentionQueue.vue'
import InstructionAsks from './InstructionAsks.vue'
import McpServerRequests from './McpServerRequests.vue'
import WorkWaits from './WorkWaits.vue'
import PersonsQueue from './PersonsQueue.vue'
import WaitingOnWhoWrote from './WaitingOnWhoWrote.vue'
import SinceYouWereLastHere from './SinceYouWereLastHere.vue'
import type { SinceView } from '../lib/recent-activity'

/**
 * **Waiting on you: everything a person OWES, and it is bounded by nothing.**
 *
 * ## 🔴 **Why it is its own destination** — `EXT-008` §3, and the rule is older than the mockup
 *
 * ⛔ **`HO-025` §2:** ⚑ ***a digest is WINDOWED; the queue is COMPLETE regardless of age.***
 * ⚠️ **So this and {@link WhileYouWereAway} are not two views of one thing** — one is what he owes
 * and one is what changed — ⛔ **and a single destination holding both would have to pick one of
 * those two properties and be wrong about the other.** ⚑ The mockup encodes the split without
 * having been told; `EXT-009` §2 is why it is being built now.
 *
 * ## ⚑ **Moved from Home, not re-derived** (606)
 *
 * ⛔ **Every line in this file was drawing on Home before `606`**, reading the same two populations
 * from the same two sources — `attention.ts`'s projection through `props.needsYou`, and
 * `persons-queue.ts`'s supplied module. ⚠️ **Nothing here computes a population**:
 * `home-attention.ts` and `digest.ts` decide what the numbers ARE. ⚑ **D-017 · R19 added the
 * instruction asks** — the host's read, carried by the same supplied module (`persons.asks`) so the
 * overlay's corner draws the same list — and narrowed the first source to the cards no host read
 * lists. ⚑ **F097 added the work whose agent answered a person**, carried the same way
 * (`persons.waitingOnWhoWrote`).
 *
 * ## ⛔ **WIRED, and the whole of it** — no `soon`, no placeholder, no seeded row
 *
 * ⚑ Every row it draws is a real request, from this window's conversations or the host's reads.
 */
const props = withDefaults(
  defineProps<{
    /**
     * ⛔ **The LIVE queue — the cards on this window's conversations that no host read lists** (205;
     * ⚑ **D-017 · R19**: `listedNowhereElse`).
     *
     * ⚑ Projected by `attention.ts` in `RuntimeScreen`, which is where the records live, and
     * handed down already built. This surface does not reach into the session store.
     */
    needsYou?: AttentionRequest[]
    /**
     * ⚠️ **The clock the ages are measured against**, which ticks only while something is waiting —
     * see `RuntimeScreen`. ⛔ Not a frozen fixture instant: an age measured against a stopped clock
     * stops with it.
     */
    clock?: number
    /** The last roster read, for the agents no other agent can start until a person chooses. */
    agents?: AgentIdentities | null
    /** What finished or failed since the person was last here, or `null` to draw no box. */
    sinceLastHere?: { view: SinceView; since: number } | null
  }>(),
  { needsYou: () => [], clock: () => Date.now(), agents: null, sinceLastHere: null },
)

const emit = defineEmits<{
  /** Answer a pending request without leaving this surface (205 §2). */
  decide: [request: AttentionRequest, decision: AttentionDecision]
  /** Go to the card itself. */
  openRequest: [request: AttentionRequest]
  /** Open an agent's sheet, where its provider is chosen. */
  openAgent: [profileSlug: string]
  openConversation: [conversation: string]
  seeRecentActivity: []
}>()

/**
 * ⛔ **The queue that ends at a person, read here rather than passed in** (401).
 *
 * ⚑ **A supplied module, exactly as `SideRail` reads the spawn stop.** `RuntimeScreen` does the
 * looking and hands the answer to `persons-queue.ts`; this screen and the overlay lane read the
 * one view, so there is no state in which this count and the corner's count disagree.
 */
const persons = usePersonsQueue()

/**
 * ⚠️ **How many rows the *Yours to settle* group DRAWS** — `PersonsQueueView.count`. ⛔ Zero while
 * NEITHER read has answered, so a screen that has not looked yet claims nothing.
 */
const personsRows = computed(() => persons.view.value?.count ?? 0)

/**
 * ⚑ **D-017 · R19 — the asks this page draws**, oldest first as the host read them — the queue
 * module's, so the corner copy counts and lists the same ones.
 */
const asks = computed(() => persons.asks.value?.rows ?? [])

/** ⛔ **A look for asks that has not answered** — the group is drawn to say so. */
const asksUnread = computed(() => {
  const read = persons.asks.value
  return read !== null && (read.partial || read.stale)
})

/** The agents' requests to register an MCP server, as the queue module carries them. */
const serverRequests = computed(() => persons.serverRequests.value?.rows ?? [])

/** A look for those requests that has not answered: the group is drawn to say so. */
const serverRequestsUnread = computed(() => {
  const read = persons.serverRequests.value
  return read !== null && (read.partial || read.stale)
})

/**
 * ⚑ **F097 — the work whose agent answered a person**, oldest first as the host read it — the queue
 * module's, so the corner copy counts and lists the same pieces.
 */
const replies = computed(() => persons.waitingOnWhoWrote.value?.rows ?? [])

/** ⛔ **A look for that work that did not answer, or answered short** — the group says so. */
const repliesUnread = computed(() => {
  const read = persons.waitingOnWhoWrote.value
  return read !== null && (read.unread || !!read.short)
})

/** The to-dos agents asked of a person, as the queue module carries them. */
const todos = computed(() => persons.workWaits.value.todos)
/**
 * The pieces no agent moved after being reminded, counted as owed; and the recoveries, which are
 * not.
 */
const incidents = computed(() => persons.workWaits.value.incidents)
const recoveries = computed(() => persons.workWaits.value.recoveries)

/** ⛔ **Everything a person owes here that is not one of this window's cards** — the three groups. */
const onlyYou = computed(
  () =>
    personsRows.value +
    asks.value.length +
    serverRequests.value.length +
    replies.value.length +
    todos.value.rows.length +
    incidents.value.rows.length +
    notChosen.value.length,
)

/**
 * 🔴 **533 · what the queue says about the PROVIDERS** — ⚑ **UI-009 (F052) · drawn at the top of
 * this page, outside every group**: a usage limit is nobody's to settle, so it is not under *Yours
 * to settle*, and it says plainly how near the limit is and when it resets (`usage-limit.ts`).
 *
 * ⛔ **Deliberately not added to {@link personsRows} or to `homeAttention`.** That number is *how
 * much do I owe*, and a wall is owed by nobody.
 */
const walls = computed(() => persons.limits.value?.walls ?? [])
const wallsUnread = computed(() => persons.limits.value?.unread === true)
const limitsDisplay = computed(() => persons.limits.value?.display)

/**
 * The agents no other agent can start until a person chooses their provider: a person's to settle,
 * so counted with what they owe, here and on the rail's badge ({@link providersNotChosenIn}).
 */
const notChosen = computed(() =>
  providersNotChosenIn(props.agents).map(({ slug, startedOn }) => ({
    slug,
    says: aProviderNotChosenSays(agentName(slug, props.agents?.identities ?? null), startedOn),
  })),
)

/**
 * 🔴 **678 · whether the queue has anything to say about STOPPED WORK** — and it decides whether
 * the queue is mounted when no row is there.
 *
 * ⛔ **The stalled band (`557`) was never in this gate**: `606` built this page on `personsRows`,
 * `attention.unread` and the providers, so work that had stopped with nobody told — its rows, a look
 * that did not answer, and since `678` rows its walk could not read (F-R18b) — drew only in the
 * corner copy an open sheet mounts, and this page said nothing. ⚑ Found by `678`'s review, because
 * the one sentence `678` put in that band would otherwise be read on no page a person goes to.
 * ⚠️ **Its ROWS are not added to {@link personsRows}**, the walls' rule: that counts
 * what a person owes, and the band's own words say what is wrong. ⛔ **685 · its two HOLES do reach
 * `homeAttention`** — through the queue's one derived field, `mayBeShort` (`678`), because a band
 * that could not be read forbids *quiet*; this said *"not added … to `homeAttention`"* after `678`
 * made that half false (`678` F3's sweep). ⚑ A WALL's look that did not answer does not reach it —
 * see `persons-queue.ts`' `limits`: a wall is owed by nobody (`533`).
 */
const stallSaysSomething = computed(() => {
  // Work whose holder stopped with it, its giver told, is drawn in the same place and gate.
  return (
    persons.stoppedCards.value.length > 0 ||
    [persons.stalled.value, persons.stopped.value].some(
      (band) => band !== null && (band.rows.length > 0 || band.unread || !!band.short),
    )
  )
})

/** ⛔ **Every summary on this screen, decided in ONE place** (305 §1, from `304`). */
const attention = computed(() =>
  homeAttention({
    requests: props.needsYou,
    onlyYou: onlyYou.value,
    // ⛔ **Any hole forbids *quiet*** (434, widened to four by 453) — a list never read, one that
    // has stopped answering, one with no ledger behind it, and one short by rows this app could
    // not parse. ⚑ The disjunction lives on the queue since `453`, and since `678` it also covers
    // the stalled band's two holes, which this page now draws — see the queue's own field, read by
    // the rail's call site too, so the two cannot come apart.
    // ⚑ **D-017 · R19** — the field covers a look for the asks that has not answered, too.
    unread: persons.mayBeShort.value,
  }),
)

/**
 * 🔴 **688 · F3 — an amber line stands on this page** — a provider's wall (drawn above every group
 * since UI-009), or a stopped piece of work, both in the summons register and both owed by nobody.
 * ⛔ Read beside {@link attention}, never inside its call — see `theStatBesideTheLines`.
 */
const anAmberLineStands = computed(
  () =>
    (persons.limits.value?.walls.length ?? 0) > 0 ||
    incidents.value.rows.length > 0 ||
    (persons.stalled.value?.rows.length ?? 0) > 0 ||
    (persons.stopped.value?.rows.length ?? 0) > 0,
)

/**
 * Whether everything waiting on this page is a request for a permission — this window's cards and
 * the rows below alike — so the intro may call them that. A row whose answers this window cannot
 * read is not known to be one.
 */
const permissionsOnly = computed(
  () =>
    attention.value.total > 0 &&
    !attention.value.unread &&
    asks.value.length === 0 &&
    serverRequests.value.length === 0 &&
    replies.value.length === 0 &&
    todos.value.rows.length === 0 &&
    incidents.value.rows.length === 0 &&
    notChosen.value.length === 0 &&
    props.needsYou.every((request) => request.kind === 'permission') &&
    (persons.view.value?.rows ?? []).every(
      (row) =>
        row.kind === 'a-decision' &&
        row.answers.length > 0 &&
        row.answers.every((answer) => answer.kind === 'permission'),
    ),
)

/** One short sentence over the page, true of what is in it. */
const intro = computed(() =>
  permissionsOnly.value ? permissionsIntro(attention.value.total) : attention.value.intro,
)

/** ⚑ **688 · F3** — the stat's word and ink, never green beside an amber line. */
const stat = computed(() => theStatBesideTheLines(attention.value, anAmberLineStands.value))

/**
 * ⚑ **UI-009 · the *Conversations* group only where it can hold something** — F052's empty
 * *Conversations 0* above a question listed below. ⛔ Still drawn on a screen that owes nothing, where
 * its clear line is the page's *"Nothing needs you."*
 */
const showConversations = computed(() => attention.value.live > 0 || onlyYou.value === 0)
</script>

<template>
  <!-- ⚑ **Light paper, unconditionally** — the attribute every body surface inside `<main>` carries
       (344), and `chat-theme.test.ts` asserts the set of them by name. -->
  <section
    class="waiting-surface"
    data-wired="true"
    data-cy="waiting-on-you"
    data-chat-theme="light"
  >
    <header class="page-head">
      <div class="head-copy">
        <h1 class="bb-page-title">Waiting on you</h1>
        <!-- ⛔ **The sentence the rail row deliberately does not carry** (`EXT-008` §5):
             explanation belongs where the thing is. ⚑ It is `home-attention.ts`'s, so this page
             and the rail's badge cannot come to different claims about one population. -->
        <p data-cy="waiting-intro">{{ intro }}</p>
      </div>
      <span class="head-spacer"></span>
      <!-- ⛔ **What this destination is bounded BY, said on the destination** — `HO-025` §2's half
           of the split, and the reason the number beside it may never be added to the other row's.
           ⚠️ Drawn as a property of the list rather than as a count, because the count is on the
           rail row and on the groups below. -->
      <p class="page-bound" data-cy="waiting-bound">
        Everything still open, however old. This list is not windowed.
      </p>
      <!-- ⛔ **`homeAttention.stat` and its tone, on the screen the number is ABOUT** (606). ⚑
           `live + onlyYou` is *how much do I owe*, which is this destination. ⚠️ **`All clear` /
           `Not known` / `3 items` are its three words** and the middle one is the one that matters: a list that
           did not answer has no number to give, and `homeAttention` refuses to invent a zero.
           🔴 **688 · F3 — and `Nothing`, in neutral ink, where `All clear` would sit green beside
           an amber line** (a wall, stopped work) — see `theStatBesideTheLines`. -->
      <div class="head-stat">
        <span>Needs you</span>
        <strong :class="stat.tone" data-cy="waiting-stat">{{ stat.stat }}</strong>
      </div>
    </header>

    <div class="attention-list">
      <SinceYouWereLastHere
        v-if="props.sinceLastHere"
        :view="props.sinceLastHere.view"
        :since="props.sinceLastHere.since"
        :clock="props.clock"
        @open="(conversation) => emit('openConversation', conversation)"
        @see-all="emit('seeRecentActivity')"
      />
      <p v-if="limitsDisplay" class="usage-unread" data-cy="limits-display-reading">
        {{ limitsDisplayLabel(limitsDisplay) }}
        <span v-if="limitsDisplay.reading && limitsDisplay.status !== 'ready'">
          · {{ limitsDisplayWords.lastReading(limitsDisplay.reading.evaluatedAt) }}
        </span>
        <span v-if="limitsDisplay.status === 'unavailable'">
          · {{ limitsDisplayWords.failed }}</span
        >
      </p>
      <!-- 🔴 **533 · the providers' usage limits — UI-009 (F052): first, and under no label.**
           ⛔ Nothing here is a person's to settle, so it is not in *Yours to settle*; ⚑ the sentence
           is plain (*"Claude is near its weekly limit; it resets on 7 October."*), and the
           provider's own lines and the exact reset are on its title. ⚠️ No control on it: a limit
           ends when the provider says so. -->
      <ul v-if="walls.length > 0" class="usage" data-cy="persons-queue-walls">
        <li
          v-for="wall in walls"
          :key="wall.key"
          class="usage-limit"
          :data-standing="wall.standing"
          :data-cy="`persons-queue-wall-${wall.provider}`"
        >
          <p
            class="usage-says"
            :title="usageTitle(wall)"
            :data-cy="`persons-queue-wall-says-${wall.provider}`"
          >
            {{
              limitsDisplay?.reading
                ? limitsDisplayWords.condition(
                    usageSays(wall, limitsDisplay.reading.evaluatedAt),
                    limitsDisplay.reading.evaluatedAt,
                  )
                : usageSays(wall, props.clock)
            }}
          </p>
        </li>
      </ul>
      <!-- 🔴 **533 · the look for limits has stopped answering.** ⛔ Drawn rather than left blank,
           because a band that vanishes reads as an all-clear: *every provider is still taking
           work*. -->
      <p
        v-if="wallsUnread && !limitsDisplay"
        class="usage-unread"
        data-cy="persons-queue-walls-unread"
      >
        The last look at what the providers have said did not answer, so a limit that would stop
        your agents may not be shown here.
      </p>
      <!-- ⛔ WIRED (205): every row is a real pending request on a real open conversation.

           ⚠️ **The heading appears only when the other group is here too** (305 §1). One list
           needs no label; two do, and a label over the only list on screen is noise a reader has
           to rule out. -->
      <div
        v-if="showConversations && (onlyYou > 0 || attention.unread)"
        class="group-label"
        data-cy="live-group"
      >
        <span>Conversations</span>
        <strong data-cy="live-decisions">{{ attention.live }}</strong>
      </div>
      <!-- ⛔ **`alone` is a claim about the SCREEN** (305 §1). `AttentionQueue`'s empty block says
           *"Nothing needs you."* only when it is the whole answer; with an escalated question
           listed below it, it is not. -->
      <AttentionQueue
        v-if="showConversations"
        :requests="props.needsYou"
        :now="props.clock"
        :alone="onlyYou === 0 && !attention.unread"
        @decide="(request, decision) => emit('decide', request, decision)"
        @open="(request) => emit('openRequest', request)"
      />

      <!-- 🔴 **Yours to settle** (401 + 403, criterion 11) — what no conversation on this screen
           can show, because the conversation that raised it is ordinarily one this window is not
           running. ⚑ Its own group and its own label for `305 §1`'s reason: a reader must be able
           to tell a card they can answer here from a chain that takes them somewhere else.

           ⚑ **678 · the card also draws for stopped work alone.** ⛔ **The LABEL keeps its own
           condition**, because it names what is a person's to settle. -->
      <template v-if="personsRows > 0 || attention.unread || stallSaysSomething">
        <!-- ⚠️ **`yours-count`, breaking the `-decisions` suffix its sibling uses** (403):
             `decisions` is the NAME of one of the two populations inside this group, and a handle
             that read `yours-decisions` would name half of what it counts. -->
        <div v-if="personsRows > 0 || attention.unread" class="group-label" data-cy="yours-group">
          <span>Yours to settle</span>
          <strong data-cy="yours-count">{{ personsRows }}</strong>
        </div>
        <PersonsQueue />
      </template>

      <!-- What an agent asked a person to do: answered on its card, counted as owed. -->
      <template v-if="persons.todoCards.value.length > 0 || todos.unread">
        <div class="group-label" data-cy="todos-group">
          <span>Things an agent asked you to do</span>
          <strong data-cy="todos-count">{{ todos.rows.length }}</strong>
        </div>
        <WorkWaits part="todos" />
      </template>

      <!-- Pieces no agent is driving: a wait that names nothing, or a piece that stopped. -->
      <template
        v-if="persons.workCards.value.incidents.length > 0 || incidents.unread || !!incidents.short"
      >
        <div class="group-label" data-cy="incidents-group">
          <span>Work that needs you</span>
          <strong data-cy="incidents-count">{{ incidents.rows.length }}</strong>
        </div>
        <WorkWaits part="incidents" />
      </template>

      <!-- Each piece the app is picking back up, chose not to, or could not. -->
      <template v-if="persons.workCards.value.recoveries.length > 0 || recoveries.unread">
        <div class="group-label" data-cy="recoveries-group">
          <span>Picking work back up</span>
          <strong data-cy="recoveries-count">{{ recoveries.rows.length }}</strong>
        </div>
        <WorkWaits part="recoveries" />
      </template>

      <!-- ⚑ **D-017 · R19 — what an agent asked a person to approve about an identity's rules**, from
           the host's read over every conversation — the ask `OwnInstructions` draws on that
           identity's sheet, decided here through the same door. ⚠️ Its own group: an ask is decided
           on its row and has no conversation to open. ⚑ **`InstructionAsks` draws it**, as it does
           in the overlay's corner, so the two cannot list one ask two ways. -->
      <template v-if="asks.length > 0 || asksUnread">
        <div class="group-label" data-cy="asks-group">
          <span>Rules an agent asked for</span>
          <strong data-cy="asks-count">{{ asks.length }}</strong>
        </div>
        <InstructionAsks />
      </template>

      <!-- The agents' requests to register an MCP server, decided on their own rows, as the corner
           and the Tools page draw them. -->
      <template
        v-if="
          serverRequests.length > 0 ||
          serverRequestsUnread ||
          persons.serverRequestsSettled.value.length > 0
        "
      >
        <div class="group-label" data-cy="server-requests-group">
          <span>MCP servers an agent asked for</span>
          <strong data-cy="server-requests-count">{{ serverRequests.length }}</strong>
        </div>
        <McpServerRequests />
      </template>

      <!-- ⚑ The agents no other agent can start until a person chooses their provider — their
           conversations ran on both, and none is saved. A person's to settle, so counted with what
           they owe; its door opens the agent's sheet, where the provider is chosen. -->
      <template v-if="notChosen.length > 0">
        <div class="group-label" data-cy="provider-not-chosen-group">
          <span>Agents waiting for a provider</span>
          <strong data-cy="provider-not-chosen-count">{{ notChosen.length }}</strong>
        </div>
        <ul class="usage" data-cy="waiting-provider-not-chosen">
          <li
            v-for="agent in notChosen"
            :key="agent.slug"
            class="usage-limit"
            data-standing="stopped"
            :data-cy="`waiting-provider-not-chosen-${agent.slug}`"
          >
            <p class="usage-says">{{ agent.says }}</p>
            <button
              type="button"
              class="usage-door"
              :data-cy="`waiting-provider-choose-${agent.slug}`"
              @click="emit('openAgent', agent.slug)"
            >
              Choose its provider
            </button>
          </li>
        </ul>
      </template>

      <!-- 🔴 **F097 — the work whose agent answered a person and waits on their next words**, from the
           host's read over every conversation. ⚠️ Its own group, as the asks are: no card, nothing
           frozen behind it, and its door opens the conversation the person wrote to. ⚑
           **`WaitingOnWhoWrote` draws it**, as it does in the overlay's corner. -->
      <template v-if="replies.length > 0 || repliesUnread">
        <div class="group-label" data-cy="replies-group">
          <span>Waiting on your reply</span>
          <strong data-cy="replies-count">{{ replies.length }}</strong>
        </div>
        <WaitingOnWhoWrote />
      </template>
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
  background-color: var(--conversation-bg-color, var(--chat-bg));
  background-image: var(--conversation-bg-image, var(--paper-wash));
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  image-rendering: var(--conversation-bg-rendering, auto);
  color: var(--text);
}

.waiting-surface > * {
  image-rendering: auto;
}

.page-head {
  display: flex;
  min-height: var(--surface-header-h);
  flex: 0 0 auto;
  align-items: center;
  padding: var(--space-10) var(--space-12);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--surface-header-bg);
  gap: var(--space-8);
}

.head-copy {
  min-width: 0;
}

.head-copy h1 {
  margin: 0;
}

.head-copy p {
  margin: var(--space-3) 0 0;
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

.head-spacer {
  flex: 1;
}

.head-stat {
  flex: none;
  padding: var(--space-4) var(--space-6);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
}

.head-stat span {
  display: block;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
}

.head-stat strong {
  display: block;
  margin-top: var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
}

.head-stat strong.waiting {
  color: var(--waiting);
}

.head-stat strong.ok {
  color: var(--success);
}

.page-bound {
  max-width: var(--reader-measure);
  flex: 0 1 16em;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
  text-align: right;
}

.attention-list {
  container: waiting-requests / inline-size;
  min-height: 0;
  flex: 1;
  padding: var(--space-10) var(--space-12);
  background: var(--attention-bg);
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.usage {
  padding: 0;
  margin: 0 0 var(--space-8);
  gap: var(--space-6);
  list-style: none;
}

/* Match the shared card shell while keeping these components' overlay copies unchanged. */
.usage-limit,
.usage-unread,
.attention-list :deep(.pq-row),
.attention-list :deep(.pq-stall),
.attention-list :deep(.wait),
.attention-list :deep(.request),
.attention-list :deep(.reply),
.attention-list :deep(.asks > .ask),
.attention-list :deep(.attention-request),
.attention-list :deep(.attention-clear) {
  min-width: 0;
  padding: var(--card-padding);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}

/* A usage card, like a request card: its sentence on the top line, its door at the foot. */
.usage-limit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
}

.usage-says {
  margin: 0;
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}

.usage-limit[data-standing='stopped'] .usage-says {
  font-weight: var(--fw-semibold);
}

.usage-door {
  margin-top: auto;
}

/* A provider's usage alone takes the whole row rather than leave half of it empty. */
.usage > .usage-limit:only-child {
  grid-column: 1 / -1;
}

.usage-unread {
  margin: 0 0 var(--space-6);
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

.group-label {
  display: flex;
  align-items: center;
  margin: var(--space-8) 0 var(--space-4);
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.group-label strong {
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--panel);
  color: var(--text-soft);
  line-height: var(--leading-relaxed);
}

.attention-list :deep(.persons-queue:not(.floating)),
.attention-list :deep(.waits:not(.floating)),
.attention-list :deep(.requests:not(.floating)),
.attention-list :deep(.replies:not(.floating)),
.attention-list :deep(.asks:not(.floating)) {
  padding: 0;
}

.attention-list :deep(.pq-rows),
.attention-list :deep(.pq-stalled),
.attention-list :deep(.waits),
.attention-list :deep(.requests),
.attention-list :deep(.replies),
.attention-list :deep(.asks),
.attention-list :deep(.attention-rows) {
  gap: var(--space-6);
}

/* Every card on the page shares one grid: a column, then two from 832px. */
.usage,
.attention-list :deep(.pq-rows),
.attention-list :deep(.pq-stalled),
.attention-list :deep(.waits),
.attention-list :deep(.requests),
.attention-list :deep(.replies),
.attention-list :deep(.asks),
.attention-list :deep(.attention-rows) {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

@container waiting-requests (min-width: 832px) {
  .usage,
  .attention-list :deep(.pq-rows),
  .attention-list :deep(.pq-stalled),
  .attention-list :deep(.waits),
  .attention-list :deep(.requests),
  .attention-list :deep(.replies),
  .attention-list :deep(.asks),
  .attention-list :deep(.attention-rows) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
  }
}

.attention-list :deep(.pq-row) {
  align-content: start;
}

/* The rules an agent asked for, in the request card's own code box: its panel, line and ink. */
.attention-list :deep(.ask-text) {
  border: var(--border-width) solid var(--line);
  background: var(--panel);
  color: var(--text);
}

.attention-list :deep(.pq-request-line code) {
  width: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.attention-list :deep(.pq-body) {
  gap: var(--space-8);
}

.attention-list :deep(.pq-stall),
.attention-list :deep(.wait),
.attention-list :deep(.request),
.attention-list :deep(.reply),
.attention-list :deep(.asks > .ask) {
  gap: var(--space-4);
}

.attention-list :deep(.pq-stall > p) {
  margin: 0;
}

/* Each card, like a request card: its top line in the request's caption type, and its controls at
   the foot, so cards on one row end level; a door alone sits at the bottom right. */
.attention-list :deep(.pq-stall-says),
.attention-list :deep(.pq-stop-who),
.attention-list :deep(.wait-head),
.attention-list :deep(.request-who),
.attention-list :deep(.reply-who),
.attention-list :deep(.ask-who) {
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}

.attention-list :deep(.pq-stall > .pq-go),
.attention-list :deep(.pq-stop-actions),
.attention-list :deep(.wait-controls),
.attention-list :deep(.request-controls),
.attention-list :deep(.ask-controls),
.attention-list :deep(.reply-go) {
  margin-top: auto;
}

.attention-list :deep(.pq-stall > .pq-go),
.attention-list :deep(.reply-go) {
  align-self: flex-end;
}

.attention-list :deep(.pq-stall-said),
.attention-list :deep(.pq-stall-what),
.attention-list :deep(.reply-what) {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}

.usage-door,
.attention-list :deep(.pq-go),
.attention-list :deep(.reply-go),
.attention-list :deep(.request-open),
.attention-list :deep(.ask-controls > button),
.attention-list :deep(.wait-controls > button),
.attention-list :deep(.request-controls > button) {
  display: inline-flex;
  min-height: var(--control-h);
  align-items: center;
  justify-content: center;
  padding: var(--space-3) var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-snug);
  gap: var(--control-gap);
}

.usage-door:hover,
.attention-list :deep(.pq-go:hover),
.attention-list :deep(.reply-go:hover),
.attention-list :deep(.request-open:hover),
.attention-list :deep(.ask-controls > button:hover),
.attention-list :deep(.wait-controls > button:hover:not(:disabled)),
.attention-list :deep(.request-controls > button:hover:not(:disabled)) {
  border-color: var(--accent-border);
  background: var(--accent-fill);
}

.attention-list :deep(.pq-go .icon),
.attention-list :deep(.reply-go .icon) {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.attention-list :deep(.attention-clear) {
  margin: 0;
  padding: var(--space-16);
}
</style>
