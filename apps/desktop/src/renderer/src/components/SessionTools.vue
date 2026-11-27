<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  catalogue,
  filterCatalogue,
  inventoryAsOf,
  inventorySummary,
  readInventory,
  standingChoices,
  statusWord,
  TOOLS_ARE_AS_OF_A_STATEMENT,
  WHY_EVERY_CONVERSATION,
  type CatalogEntry,
  type EntrySource,
  type InventoryReading,
  type ToolStanding,
} from '../lib/tool-inventory'
import { REGISTER_WORDS } from '../lib/digest'
import type { ToolRegistry } from '../lib/transcript'

/**
 * Explore the tool inventory reported by the provider rather than infer installed tools from configuration.
 *
 * ⛔ **There is no file behind this sheet.** He asked where the MCP tools were and was right that
 * they are not in `config.toml`; they are in-process on both providers — an in-process MCP server
 * on Claude, a `dynamicTools` namespace on Codex — and BroBot writes nothing into any config file.
 * What this reads is the child's own opening frame, joined to the toolset this session was built
 * with. See `lib/tool-inventory.ts` for the join and for why the two halves stay apart.
 *
 * ## ⚑ What `392` changed, and it is not only the layout
 *
 * **The shape** is v2.5.1's: a list/detail browser with a search box and a standing filter, in a
 * sheet wide enough for a description and an argument table side by side. `388` cleared it: *"the
 * product already computes the needed reading and standing model."* ⛔ The detail pane describes
 * the selected tool and never runs it.
 *
 * Chips distinguish `confirmed`, `not listed` and `unconfirmable`; the vocabulary key also shows
 * each formal standing. An unpublished inventory must never look like a missing declared tool.
 *
 * ## ⛔ Four things this surface must not do (392 §3)
 *
 * 1. ⛔ **No enable, disable, inject or execute control.** Not a settings page: what is injected is
 *    BroBot's decision. `session-tools.dom.test.ts` §6 holds a CLOSED vocabulary of the nine
 *    affordances this sheet may draw, walks every INTERACTIVE element rather than every `<button>`,
 *    and names the catalogue rows from the fixture's own reading — so a control added tomorrow is
 *    red however it is spelled and whatever class it wears.
 * 2. ⛔ **No `origin`.** `382` measured that the field never crosses into this app, and v2.5.1
 *    renders, searches AND filters on it. A slot for a fact that can never arrive is worse than no
 *    slot — {@link filterCatalogue} names the two fields it searches and no third.
 * 3. ⛔ **No child selector.** There is no child `ToolRegistry` and no read-inventory command; the
 *    scope line says so rather than drawing a picker with one entry, and a child's tools are never
 *    borrowed from its parent's.
 * 4. ⛔ **No invented time or report source, and the time is no longer invented** (444 relay 1).
 *    ⚠️ **This rule read *"`382` measured `tools.at` as a hole… the time half is omitted rather
 *    than printed as `Time not reported` forever"*, and `444` filled the hole** — not with a new
 *    durable field but by reading the moment the ledger row already carried: `RuntimeHost` stamps
 *    `events.created_at` and puts the same number on the wire, and the fold simply never read it.
 *    ⛔ **What survives of the rule is the half that was always the point**: a reading with no
 *    moment draws NO line, never *"Time not reported"* and never a zero. ⚑ The report SOURCE is
 *    still a hole and still omitted — see {@link inventoryAsOf} for what may and may not be said.
 *
 * ## ⚠️ The scheme is inherited, never declared
 *
 * No `data-chat-theme` here. `OverlayHost` carries it (344/346) and `chat-theme.test.ts` asserts
 * that every hosted panel declares none. Class names are copied as DECLARATIONS rather than
 * borrowed: every style block in this app is `<style scoped>`, so `.icon-button` from a sibling
 * matches nothing here and would render as a bare button that looks plausible in a screenshot.
 */
const props = defineProps<{
  /**
   * The fold's registry, with its three states.
   *
   * ⛔ **This component is never told which provider it is drawing**, and that is `039`: how a tool
   * name is spelled rides the registry as data, so nothing here recognises a provider to read one.
   */
  tools: ToolRegistry
}>()

const emit = defineEmits<{ close: [] }>()

const reading = computed(() => readInventory(props.tools))
const summary = computed(() => inventorySummary(reading.value))
/**
 * ⛔ **`null` when nothing stated one** — and then the line below is not drawn at all, which is
 * rule 4 in this file's docblock: an absent moment is silence, never *"Time not reported"*.
 */
const asOf = computed(() => inventoryAsOf(reading.value))
const entries = computed(() => catalogue(reading.value))

/* ── the two controls ──────────────────────────────────────────────────────────────────────── */

const query = ref('')
/** ⛔ `'all'` is not a standing and never joins one — see `CatalogFilter`. */
const standing = ref<ToolStanding | 'all'>('all')

/**
 * ⚑ **Only the standings this reading can produce get a chip.** Offering `confirmed` on a Codex
 * conversation would be a filter that can only ever empty the list, and it would imply the provider
 * might confirm something. Derived from `readInventory` by {@link standingChoices}, not listed here.
 */
const choices = computed(() =>
  // ⛔ **And nothing at all when there is no declaration to join to** — review found the gap:
  // `353`'s negative control (a launch with the toolset detached) is a `published` reading with
  // `declared === null`, in which every row has no standing, and `standingChoices` would still
  // have offered two chips that can only ever empty the list. The vocabulary is a fact about the
  // reading; whether this conversation has anything WITH a standing is a second question.
  reading.value.own === null ? [] : standingChoices(reading.value.kind),
)

const shown = computed(() =>
  filterCatalogue(entries.value, { query: query.value, standing: standing.value }),
)

const filtered = computed(() => query.value.trim() !== '' || standing.value !== 'all')

function clearFilters(): void {
  query.value = ''
  standing.value = 'all'
}

/**
 * ⚠️ **A standing this reading cannot produce is dropped rather than left showing an empty list.**
 * The registry is replaced whole on every frame, so a conversation can go from `unpublished` to
 * `published` under an open sheet — and a filter set to `unconfirmable` would then hide everything
 * with no visible cause.
 */
watch(choices, (next) => {
  if (standing.value !== 'all' && !next.includes(standing.value)) standing.value = 'all'
})

/* ── the selection ─────────────────────────────────────────────────────────────────────────── */

const selectedKey = ref<string | null>(null)

/**
 * ⛔ **Resolved against what is SHOWN, so a selection the filter hid cannot keep the detail pane.**
 * A pane describing a row that is no longer in the list is the shape `279` calls a name for an
 * absence: everything on screen agrees except the thing it is about.
 */
const selected = computed<CatalogEntry | null>(
  () => shown.value.find((entry) => entry.key === selectedKey.value) ?? shown.value[0] ?? null,
)

/**
 * Whether the NARROW layout is showing the detail rather than the list.
 *
 * ⚑ **Inert above the breakpoint**, where both panes are on screen at once — the class is always
 * written and the media query decides whether it means anything, which is the mock's own approach
 * and keeps one selection model rather than two.
 */
const detailOpen = ref(false)

function select(entry: CatalogEntry): void {
  selectedKey.value = entry.key
  detailOpen.value = true
}

/* ── the two vocabularies, kept apart ──────────────────────────────────────────────────────── */

/**
 * What a row's standing MEANS: the word a person reads, the FORMAL word it is, and a sentence.
 *
 * ⛔ **A `Record` over the union rather than a lookup with a default**, so the compiler asks for
 * every standing and a new one cannot inherit a plausible word. A fourth standing does not compile
 * until somebody decides what it says.
 *
 * ⚠️ **`label` and `formal` differ on two of the three and that is deliberate.** The chip is what a
 * person reads at a glance; `formal` is the word the code, the tests and `388` use. Printing only
 * the formal one would put `offered` — which reads benign — on the row that is this sheet's whole
 * reason to exist; printing only the plain one is what let `unconfirmable` wear another standing's
 * name for a whole dispatch.
 */
const STANDING: Record<
  ToolStanding,
  { label: string; formal: string; tone: string; hint: string }
> = {
  confirmed: {
    label: 'confirmed',
    formal: 'confirmed',
    tone: 'ok',
    hint: 'BroCrew declared it and the agent listed it — this conversation has it.',
  },
  offered: {
    label: 'not listed',
    formal: 'offered',
    tone: 'bad',
    hint: 'BroCrew declared it and the agent did NOT list it. The agent cannot call what it was not given.',
  },
  unconfirmable: {
    label: 'unconfirmable',
    formal: 'unconfirmable',
    tone: 'unknown',
    hint: 'BroCrew declared it. This provider publishes no inventory, so there is nothing to confirm it against.',
  },
}

/**
 * What the SCOPE's reading means — the other vocabulary, and a property of the whole inventory
 * rather than of a row, which is why it sits in the header and never in the filter bar.
 */
const READING: Record<InventoryReading['kind'], { label: string; hint: string }> = {
  untold: {
    label: 'untold',
    hint: 'No adapter has said anything about this conversation yet. Nothing is claimed either way.',
  },
  unpublished: {
    label: 'unpublished',
    hint: 'This provider publishes no inventory at all, so no entry here can be confirmed against one.',
  },
  published: {
    label: 'published',
    hint: 'The child stated its own inventory, so the join between what BroCrew offered and what it sees is real.',
  },
}

/**
 * Where a row came from — the THIRD axis (392), beside the reading and the standing.
 *
 * ⛔ **It is never absent, and the standing is the one that is.** A row always came from somewhere;
 * whether BroBot declared it is the question that can have no answer.
 */
const SOURCE: Record<EntrySource, string> = {
  brobot: 'BroCrew’s own toolset',
  unclaimed: 'The agent named it under BroCrew’s server; BroCrew’s declaration does not carry it',
  // 🔴 **516 · it said *"An MCP server the agent configured itself"*, and that was never a thing
  // this app could know.** ⛔ It is now positively false half the time: a person registers an
  // external server in the rail, grants it to an identity, and `claudeMcpServersFor` puts it in the
  // launch — so the commonest server in this group is one THE PERSON configured and the agent was
  // handed. ⚠️ The honest reading of this row is what the child reported and BroBot did not declare;
  // WHO set it up is a question the inventory cannot answer, so the sentence stops claiming to.
  server: 'An MCP server this conversation connected to, beside BroCrew’s own',
  builtin: 'The agent’s own built-in tools',
}

/* ── the list, grouped by where each row came from ─────────────────────────────────────────── */

interface Group {
  readonly key: string
  readonly label: string
  readonly note: string
  /**
   * ⛔ **`'none'` is not `null`, and the built-ins are why.** A server whose status is `null` gets a
   * sentence — *"the agent did not list this server"* — and the provider's own built-ins are not a
   * server at all, so asking about their connection is a question with no subject. The first draft
   * drew that sentence over thirty-two built-in tools.
   */
  readonly status: string | null | 'none'
  readonly connectionKind?: string
  readonly entries: readonly CatalogEntry[]
}

/**
 * ⛔ **`358`'s three stacked sections, kept, plus the fourth `392` had to add.** It is the one
 * grouping this sheet must get right — `358`'s `M23` is the row that sweeps BroBot's tools into the
 * provider's built-in list — and a flat relevance-ordered list would lose it the first time
 * somebody typed a letter. ⚠️ The fourth is what the child named under BroBot's own server that the
 * declaration does not carry: review found it filed with the declared rows, under a heading saying
 * the opposite of what its own detail pane said.
 *
 * ⚑ **Built from what is SHOWN**, so a group whose every row was filtered out disappears rather
 * than standing as an empty heading that reads like *"this server has no tools"*.
 */
const groups = computed<readonly Group[]>(() => {
  const own = reading.value.own
  const out: Group[] = []
  const under = (test: (entry: CatalogEntry) => boolean): CatalogEntry[] => shown.value.filter(test)

  if (own !== null) {
    const rows = under((entry) => entry.source === 'brobot')
    if (rows.length > 0)
      out.push({
        key: `brobot:${own.name}`,
        label: own.name,
        note: 'Declared by BroCrew for this conversation.',
        status: own.status === '' ? null : own.status,
        connectionKind: own.connectionKind,
        entries: rows,
      })
    // 🔴 **Its own group, under the same server, and review is why** — filed with the declared
    // rows it sat under a heading saying *"declared by BroBot"* beside a detail cell saying the
    // opposite. This is the state `unclaimed` exists to make visible, so it gets its own heading.
    const strangers = under((entry) => entry.source === 'unclaimed')
    if (strangers.length > 0)
      out.push({
        key: `unclaimed:${own.name}`,
        label: `${own.name} · not in BroCrew’s declaration`,
        note: 'The agent named these under BroCrew’s own server. BroCrew’s declaration does not carry them, so there is nothing of ours to confirm them against.',
        status: own.status === '' ? null : own.status,
        connectionKind: own.connectionKind,
        entries: strangers,
      })
  }
  for (const server of reading.value.foreign) {
    const rows = under((entry) => entry.source === 'server' && entry.server === server.name)
    // ⛔ **A server the child named with a STATUS and no tools is a real reading and must appear**
    // — `readInventory`'s own comment says both halves must — and the first cut lost it, because
    // the catalogue has a row per TOOL and that server has none. ⚠️ Only while nothing is filtered:
    // a heading whose rows the filter hid is a claim about the server rather than about the search.
    const empty = server.tools.length === 0 && !filtered.value
    if (rows.length > 0 || empty)
      out.push({
        key: `server:${server.name}`,
        label: server.name,
        // 🔴 **516 · it said *"The agent's own configuration, outside BroBot"*, and that was never a
        // thing this surface could know.** ⛔ It is now positively false half the time: a person
        // registers an external server in the rail, grants it to an identity, and
        // `claudeMcpServersFor` puts it in the launch — so the commonest server in this group is one
        // the PERSON configured and the agent was handed. ⚠️ What this app really knows is that the
        // child reported it and BroBot's own declaration does not carry it; WHO set it up is a
        // question the inventory cannot answer, so the sentence stops claiming to.
        note: empty
          ? 'The agent named this server and listed no tool under it.'
          : 'An MCP server this conversation connected to, beside BroCrew’s own. Names only.',
        status: server.status === '' ? null : server.status,
        connectionKind: server.connectionKind,
        entries: rows,
      })
  }
  const builtins = under((entry) => entry.source === 'builtin')
  if (builtins.length > 0)
    out.push({
      key: 'builtin',
      label: 'The agent’s own built-in tools',
      note: 'The provider’s own. Names only, and that is its limit rather than ours.',
      status: 'none',
      entries: builtins,
    })
  return out
})

/**
 * ⛔ **Why the list is empty, when it is** — three different sentences, and a person must be able to
 * tell them apart (392 §4). `null` ⇒ there is a list to draw.
 *
 * ⚠️ **`published` with nothing in it is a real state and is NOT `unpublished`.** The child answered
 * and named no tool at all; the provider that never answers is the row above it. `353`'s negative
 * control — a launch with the toolset detached — is exactly this reading with `declared` gone too.
 */
const emptiness = computed<string | null>(() => {
  // ⛔ **Not `reading.provenance` again.** The provenance is already printed above this list,
  // unconditionally; returning it here drew the same forty-word paragraph twice on one screen, one
  // under the other. Found in review.
  if (reading.value.kind === 'untold')
    return 'A conversation publishes its inventory when it starts. This one has not started, or is being read back from the library.'
  if (entries.value.length > 0) return null
  return reading.value.kind === 'published'
    ? 'The agent answered and named no tool at all — not one of its own, and none of BroCrew’s. That is a report, not a silence.'
    : 'BroCrew declared no tools for this conversation, and this provider publishes none of its own. Nothing has been withheld; there is nothing to list.'
})
</script>

<template>
  <section class="tools-sheet bb-knowledge-sheet" data-cy="session-tools">
    <div class="sheet-header bb-knowledge-header">
      <div class="sheet-glyph bb-knowledge-glyph">
        <svg class="icon glyph-icon"><use href="#i-tool" /></svg>
      </div>
      <div class="sheet-header-copy bb-knowledge-copy">
        <strong data-cy="tools-title">Inventory workbench</strong>
        <!-- ⛔ Counted off the inventory, never off the filtered view — see `inventorySummary`, and
             the count line beside the list, which is the one that describes the filter. -->
        <small data-cy="tools-summary">{{ summary }}</small>
      </div>
      <span class="spacer"></span>
      <!-- ⛔ **The reading is a property of the SCOPE**, so it sits here rather than in the filter
           bar beside the standings (392 §5). It is not a row's fact and it may not be filtered on. -->
      <span class="reading-badge" :data-reading="reading.kind" data-cy="tools-reading">{{
        READING[reading.kind].label
      }}</span>
      <span class="read-only" data-cy="tools-read-only">read-only</span>
      <button
        class="icon-button bb-knowledge-close"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </div>

    <div class="sheet-body">
      <!-- ⛔ **Where this came from, always, and before any list.** The whole complaint behind this
           dispatch is that a person could not find out where the tools were; a surface that showed
           rows without saying what read them would be the same gap one level up. -->
      <p class="provenance" data-cy="tools-provenance">{{ reading.provenance }}</p>

      <!-- 🔴 **WHEN it was true** (444 relay 1). ⛔ An `observed` fact with a moment, in `438`'s
           vocabulary rather than a second one — NOT a gap: a gap says the ledger cannot answer,
           and here the ledger answers with the row's own `created_at`. ⚠️ Drawn only when there
           is a moment; an absent one is silence, because a count nobody stated has no *when*. -->
      <p v-if="asOf !== null" class="provenance as-of" data-cy="tools-as-of">
        <span
          class="digest-register observed"
          :title="REGISTER_WORDS.observed.title"
          data-cy="tools-register"
          >{{ REGISTER_WORDS.observed.label }}</span
        >
        <span data-cy="tools-as-of-moment">{{ asOf }}. {{ TOOLS_ARE_AS_OF_A_STATEMENT }}</span>
      </p>

      <!-- ⛔ **The scope, said out loud rather than drawn as a picker with one entry** (392 §3.3).
           There is no child `ToolRegistry` and no read-inventory command; an empty selector would
           promise a scope that does not exist, and borrowing the parent's would be worse. -->
      <p class="scope-line" data-cy="tools-scope">
        This conversation only. BroCrew cannot read a child conversation’s inventory yet, and a
        child’s tools are never assumed from its parent’s.
      </p>

      <!-- ⛔ **The brief asked each row to name the profile and capability that put it there. That
           link does not exist in this code** — see `WHY_EVERY_CONVERSATION`. This says the true
           sentence instead, once. ⚑ **In the BODY rather than at the head of the list**, which is
           where `358` put it and where `392` photographed it taking six lines out of a 274px
           column: it is a fact about the whole inventory, so it belongs beside the other two. -->
      <p class="scope-line" data-cy="tools-why">{{ WHY_EVERY_CONVERSATION }}</p>

      <!-- A cap that bit is never silent (092/247). -->
      <p v-if="reading.dropped > 0" class="shortfall" data-cy="tools-dropped" role="alert">
        {{ reading.dropped }} row{{
          reading.dropped === 1 ? ' the agent named is' : 's the agent named are'
        }}
        not listed here — this inventory is understating what the conversation has.
      </p>

      <div class="inventory-browser" :class="{ 'show-detail': detailOpen }">
        <section class="catalog-pane" aria-label="Tool catalogue">
          <template v-if="entries.length > 0">
            <label class="catalog-search">
              <span class="search-label">Find</span>
              <!-- ⛔ Names and descriptions. NOT origins — the field never crosses (382). -->
              <input
                v-model="query"
                type="text"
                placeholder="name or description…"
                autocomplete="off"
                spellcheck="false"
                data-cy="tools-search"
              />
            </label>

            <div v-if="choices.length > 0" class="catalog-filters" data-cy="tools-filters">
              <button
                class="filter-chip"
                :class="{ active: standing === 'all' }"
                type="button"
                data-cy="tools-filter-all"
                @click="standing = 'all'"
              >
                all
              </button>
              <button
                v-for="choice in choices"
                :key="choice"
                class="filter-chip"
                :class="{ active: standing === choice }"
                type="button"
                :title="STANDING[choice].hint"
                :data-cy="`tools-filter-${choice}`"
                @click="standing = choice"
              >
                {{ STANDING[choice].label }}
              </button>
            </div>

            <!-- ⚑ **The SECOND number, and it is labelled as one.** `inventorySummary`'s docblock
                 has forbidden a filtered count on the header since `358`; this line is about the
                 filter and says so, and the header still counts the whole inventory. -->
            <p class="catalog-count" data-cy="tools-shown">
              Showing {{ shown.length }} of {{ entries.length }}
              {{ entries.length === 1 ? 'entry' : 'entries' }}
              <button
                v-if="filtered"
                class="link-button"
                type="button"
                data-cy="tools-clear-filters"
                @click="clearFilters"
              >
                clear
              </button>
            </p>
          </template>

          <div class="catalog-list" data-cy="tools-list">
            <div v-if="emptiness !== null" class="catalog-empty" data-cy="catalog-empty">
              <svg class="icon empty-icon"><use href="#i-tool" /></svg>
              <h3>{{ reading.kind === 'untold' ? 'Not reported yet' : 'No entries at all' }}</h3>
              <p>{{ emptiness }}</p>
            </div>

            <div v-else-if="shown.length === 0" class="catalog-empty" data-cy="catalog-no-matches">
              <svg class="icon empty-icon"><use href="#i-tool" /></svg>
              <h3>No matches</h3>
              <p>
                Nothing in this inventory matches what you asked for. The
                {{ entries.length }} {{ entries.length === 1 ? 'entry is' : 'entries are' }} still
                there.
              </p>
              <button
                class="link-button"
                type="button"
                data-cy="tools-clear-from-empty"
                @click="clearFilters"
              >
                Clear the search and the filter
              </button>
            </div>

            <template v-else>
              <section
                v-for="group in groups"
                :key="group.key"
                class="catalog-group"
                :data-cy="`tools-group-${group.key}`"
              >
                <div class="group-head">
                  <span class="group-name mono">{{ group.label }}</span>
                  <!-- ⛔ **A word, never a dot alone.** `null` is its own sentence: on an unpublished
                     provider nothing reports, and on a published one a server the child did not
                     name is not "disconnected" — it is absent from the child's own list. -->
                  <span
                    v-if="group.status === 'none'"
                    class="chip unknown"
                    :data-cy="`tools-status-${group.key}`"
                    >the provider’s own, not a server</span
                  >
                  <!-- ⛔ **Three sentences, and which one depends on WHOSE server it is.** Ours
                       missing from the child's list is the shape `353` had to investigate; a
                       server the child named a tool under but never described is `358`'s *"no
                       connection reported"*, and calling that one *"the agent did not list this
                       server"* under a heading the agent plainly did list is a contradiction
                       review caught. -->
                  <span
                    v-else-if="group.status === null"
                    class="chip unknown"
                    :data-cy="`tools-status-${group.key}`"
                    >{{
                      group.key.startsWith('server:')
                        ? 'no connection reported'
                        : reading.kind === 'unpublished'
                          ? 'not reported by this provider'
                          : 'the agent did not list this server'
                    }}</span
                  >
                  <span
                    v-else
                    class="chip"
                    :class="statusWord(group.status, group.connectionKind).tone"
                    :data-tone="statusWord(group.status, group.connectionKind).tone"
                    :data-cy="`tools-status-${group.key}`"
                    >{{ statusWord(group.status, group.connectionKind).label }}</span
                  >
                  <span class="tally">{{ group.entries.length }}</span>
                </div>
                <p class="group-note" :data-cy="`tools-note-${group.key}`">{{ group.note }}</p>

                <button
                  v-for="entry in group.entries"
                  :key="entry.key"
                  class="catalog-item"
                  :class="{ selected: selected?.key === entry.key }"
                  type="button"
                  :aria-current="selected?.key === entry.key"
                  :data-cy="`tool-${entry.key}`"
                  :data-standing="entry.standing ?? 'none'"
                  @click="select(entry)"
                >
                  <span class="item-body">
                    <!-- ⚑ The QUALIFIED name — what the model must actually say. A bare
                       `give_work` is a name nothing on either provider answers to. -->
                    <strong class="mono">{{ entry.name }}</strong>
                    <small
                      v-if="entry.description !== null"
                      :data-cy="`tool-description-${entry.key}`"
                      >{{ entry.description }}</small
                    >
                    <span
                      v-if="entry.standing !== null"
                      class="chip"
                      :class="STANDING[entry.standing].tone"
                      :title="STANDING[entry.standing].hint"
                      :data-cy="`tool-standing-${entry.key}`"
                      >{{ STANDING[entry.standing].label }}</span
                    >
                  </span>
                  <svg class="icon chev"><use href="#i-chevron" /></svg>
                </button>
              </section>
            </template>
          </div>
        </section>

        <article class="tool-detail" aria-label="Entry detail" data-cy="tool-detail">
          <!-- ⛔ **ABOVE the branch, and review found why.** Below the breakpoint the catalogue is
               hidden while this pane is showing; drawn only in the `v-else`, the way back
               disappeared exactly when the selection did — a filter that empties the list while
               the detail is open left a person on a pane with no exit. Only the narrow layout
               shows it at all; the CSS decides that, and the markup does not. -->
          <button
            class="link-button tool-back"
            type="button"
            data-cy="tool-back"
            @click="detailOpen = false"
          >
            ← All entries
          </button>

          <div v-if="selected === null" class="catalog-empty" data-cy="tool-detail-empty">
            <svg class="icon empty-icon"><use href="#i-tool" /></svg>
            <h3>Select an entry</h3>
            <p>What is known about it — and what is not — appears here.</p>
          </div>

          <template v-else>
            <h3 class="detail-name mono" data-cy="tool-detail-name">{{ selected.name }}</h3>

            <p class="detail-standing" data-cy="tool-detail-standing">
              <template v-if="selected.standing !== null">
                <span
                  class="chip"
                  :class="STANDING[selected.standing].tone"
                  data-cy="tool-detail-standing-chip"
                  >{{ STANDING[selected.standing].label }}</span
                >
                <span>{{ STANDING[selected.standing].hint }}</span>
              </template>
              <!-- ⛔ **Not a standing this sheet could not read — a question that does not apply.**
                   Standing joins BroBot's declaration to the child's list, and BroBot declared
                   nothing here, so there is no half of ours to check. -->
              <span v-else
                >BroCrew did not declare this one, so it has no standing: the agent published the
                name itself.</span
              >
            </p>

            <p v-if="selected.description !== null" class="detail-copy" data-cy="tool-detail-desc">
              {{ selected.description }}
            </p>
            <p v-else class="detail-copy absent" data-cy="tool-detail-desc">
              No description is published for it anywhere. BroCrew holds a sentence for its own
              tools and for no others, and inventing one would be this app describing a tool it did
              not write.
            </p>

            <!-- ⛔ **Four cells, and every one of them is a fact this app really holds.** v2.5.1's
                 grid has `Origin`, `Reported by` and `Last report`; `382` measured all three as
                 holes, and a slot for a fact that can never arrive is worse than no slot. -->
            <dl class="detail-evidence" data-cy="tool-detail-evidence">
              <div>
                <dt>Where it came from</dt>
                <dd data-cy="tool-detail-source">{{ SOURCE[selected.source] }}</dd>
              </div>
              <div>
                <dt>MCP server</dt>
                <dd data-cy="tool-detail-server">
                  <span v-if="selected.server !== null" class="mono">{{ selected.server }}</span>
                  <span v-else>None — the provider publishes this one itself.</span>
                </dd>
              </div>
              <div>
                <dt>Connection</dt>
                <!-- ⛔ **A row with no server has no connection to report**, and the group head
                     already makes that distinction — review found this cell answering *"Not
                     reported by the agent"* over thirty-two provider built-ins, which reads as a
                     silence where there is no question. -->
                <dd data-cy="tool-detail-connection">
                  {{
                    selected.server === null
                      ? 'It belongs to no server.'
                      : selected.serverStatus === null
                        ? 'Not reported by the agent.'
                        : statusWord(selected.serverStatus, selected.connectionKind).label
                  }}
                </dd>
              </div>
              <div>
                <dt>Inventory reading</dt>
                <dd>
                  <span class="reading-badge" :data-reading="reading.kind">{{
                    READING[reading.kind].label
                  }}</span>
                </dd>
              </div>
            </dl>

            <div class="detail-section-title">Arguments</div>
            <div class="detail-params" data-cy="tool-detail-params">
              <!-- ⛔ **Three absences, one level down** (392 §4). `[]` is BroBot saying this tool
                   takes nothing; `null` is nobody publishing an argument list at all. -->
              <p v-if="selected.parameters === null" class="param-empty absent">
                No argument list is published for it. The provider’s inventory is names only, and no
                parameter contract is inferred from a name.
              </p>
              <p v-else-if="selected.parameters.length === 0" class="param-empty">
                It takes no arguments.
              </p>
              <div
                v-for="parameter in selected.parameters"
                v-else
                :key="parameter.name"
                class="param"
                :data-cy="`tool-param-${parameter.name}`"
              >
                <span class="param-name mono"
                  >{{ parameter.name
                  }}<span v-if="parameter.required" class="req" aria-label="required">*</span></span
                >
                <span class="param-type mono">{{ parameter.type }}</span>
                <span class="param-doc">{{ parameter.description ?? '' }}</span>
              </div>
            </div>

            <p class="detail-foot" data-cy="tool-detail-foot">
              Standing is not permission. A capability decides whether a CALL is admitted, and that
              is checked when the agent calls — not here.
            </p>
          </template>
        </article>
      </div>

      <details class="vocabulary-key" data-cy="tools-vocabulary">
        <summary>
          Two vocabularies, kept apart
          <svg class="icon chev"><use href="#i-chevron" /></svg>
        </summary>
        <div class="vocabulary-columns">
          <section>
            <h4>A row’s standing</h4>
            <p v-for="(word, key) in STANDING" :key="key" :data-cy="`vocab-standing-${key}`">
              <span class="chip" :class="word.tone">{{ word.label }}</span>
              <code>{{ word.formal }}</code>
              {{ word.hint }}
            </p>
          </section>
          <section>
            <h4>The inventory’s reading</h4>
            <p v-for="(word, key) in READING" :key="key" :data-cy="`vocab-reading-${key}`">
              <span class="reading-badge" :data-reading="key">{{ word.label }}</span>
              {{ word.hint }}
            </p>
            <p class="vocab-rule">
              ⛔ Neither is read off the other. A reading is a fact about the whole inventory; a
              standing is a fact about one entry.
            </p>
          </section>
        </div>
      </details>
    </div>
  </section>
</template>

<style scoped src="./SessionTools.css"></style>
