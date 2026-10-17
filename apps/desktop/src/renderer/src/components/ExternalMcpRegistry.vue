<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  EXTERNAL_MCP_EVERYONE,
  EXTERNAL_MCP_EVERYONE_MEANS,
  EXTERNAL_MCP_NAME_RULE,
  EXTERNAL_MCP_NONE_YET,
  EXTERNAL_MCP_REACH_IS_FIXED,
  EXTERNAL_MCP_REMOVAL_MEANS,
  EXTERNAL_MCP_RESTRICTED,
  EXTERNAL_MCP_RESTRICTED_MEANS,
  EXTERNAL_MCP_TAKES_EFFECT,
  type ExternalMcpServerReach,
} from '../../../shared/external-mcp'
import { foldProfileName } from '../../../shared/runtime-ipc'
import type { AgentStore } from '../lib/agent-store'
import { useAgentStore } from '../composables/useAgentStore'

/**
 * Manage the global registry of configured external MCP servers.
 *
 * > ⚑ *"For actual real work, I need to give some mcp tools to brobot and the agents… an interface
 * > where I can add a new mcp server (by its local unauthenticated url) and then all the agents can
 * > see it."*
 *
 * Server reach defaults to all agents, with explicit per-identity grants for restricted rows. A shared default makes a registered server usable by identities the app created but the person has never opened.
 *
 * ⚑ **So *is this server everyone's?* is asked HERE, once, and it starts open.** The tick-boxes on
 * `CapabilitiesSheet` survive as the mechanism for the exception and nothing else: *"nobody has yet
 * needed a restricted server … an unproven case earns one column and no more"* (`HO-048` §1.1).
 *
 * ## ⛔ Why there is no Edit
 *
 * `HO-042` §6 endorsed the immutable URL by name: *"a mutable URL would let one global row silently
 * retarget every identity that already trusted it."* ⚑ **So changing an address is remove-and-add**,
 * which cascades every grant away and makes a person grant the new target deliberately — and
 * {@link EXTERNAL_MCP_REMOVAL_MEANS} is drawn BEFORE the press rather than after it.
 *
 * ## ⚠️ Adding can take seconds, and the reason is the rail
 *
 * ⛔ **Add is not a write, it is a HANDSHAKE and then a write.** The door asks the server what it
 * offers and refuses the whole server if any of its tool names is one of BroBot2's — HO-040 §4.3,
 * and `HO-042` §2 chose refuse over a namespacing proxy. ⚑ So the button says `Checking…` rather
 * than `Adding…`: what it is waiting for is the server's answer, and a person whose server is not
 * running needs to know that is what took the time.
 *
 * ## 🔴 It composes NO refusal of its own
 *
 * ⛔ **`423` §2's rule — *render the app's sentence; do not compose a second one*.** Every refusal a
 * person can meet here is the host's: a reserved name, `__`, a non-loopback URL, a server that could
 * not be asked, a collision naming the exact tools, or a name already taken. ⚠️ A second copy in this
 * file would be one wording away from telling somebody something the app did not say. ⚑ The one
 * thing drawn locally is the FOLD, the way `NewAgent` draws it: what will be stored, while it is
 * being typed.
 */
const props = withDefaults(defineProps<{ store?: AgentStore }>(), { store: undefined })
const emit = defineEmits<{ close: [] }>()

const store = props.store ?? useAgentStore()

const name = ref('')
const url = ref('')
/**
 * 🔴 **524 · who the server is for, and `'everyone'` is the DEFAULT** (`HO-048` §1).
 *
 * ⛔ **The seed is the ruling, not a layout choice.** *"A registration form that starts restricted
 * and asks a person to open it up would reproduce today's cost with one extra click, which is not a
 * fix. It starts open."* ⚑ It is also the only place this app decides the default: the store, the
 * wire and the host all REQUIRE the field, so there is exactly one line to read to know what a
 * person who says nothing gets.
 *
 * ⚠️ **Not reset by {@link touched}**, which clears refusals. A person who typed a bad URL with
 * *restricted* ticked has not un-ticked it by fixing the URL — clearing a choice a person made while
 * they correct a different field is the shape `470` refuses.
 */
const reach = ref<ExternalMcpServerReach>('everyone')
const adding = ref(false)
/** The refusal the last Add came back with, or null. Cleared when anything is edited. */
const addRefusal = ref<string | null>(null)
/** The refusal the last Remove came back with, or null. */
const removeRefusal = ref<string | null>(null)
/** Which row is being removed, so a second press cannot race the first. */
const removing = ref<string | null>(null)

const servers = computed(() => store.identities.value?.externalMcpServers ?? [])

/** ⚑ What will be stored, while it is being typed — `NewAgent`'s idiom, for its reason. */
const folded = computed(() => foldProfileName(name.value.trim()))

/**
 * ⛔ **Blocked by an EMPTY field and by nothing else.** Both halves of the name rule and the whole
 * of the URL rule live at the door, which is where the sentences are — see the docblock. There is
 * nothing for the far side to refuse when a box is blank, which is the one case this can answer
 * without composing a second opinion.
 */
const blocked = computed(() => adding.value || folded.value === '' || url.value.trim() === '')

async function add(): Promise<void> {
  if (blocked.value) return
  adding.value = true
  addRefusal.value = await store.registerExternalMcp({
    name: name.value,
    url: url.value,
    reach: reach.value,
  })
  adding.value = false
  // ⛔ **The boxes are cleared only on success** — a refusal a person has to retype is a refusal
  // they cannot act on (`425`), and the commonest one here is *the server was not running*.
  if (addRefusal.value !== null) return
  name.value = ''
  url.value = ''
  // ⚑ **Back to the default with the boxes**, so the second registration of a session starts where
  // the first did. ⛔ A form that remembered *restricted* would make the ruling's default depend on
  // what a person happened to register before it.
  reach.value = 'everyone'
}

async function remove(serverId: string): Promise<void> {
  removing.value = serverId
  removeRefusal.value = await store.removeExternalMcp(serverId)
  removing.value = null
}

function touched(): void {
  addRefusal.value = null
  removeRefusal.value = null
}

/** `Mod+Enter` adds, the way every other confirming surface in this app does. */
function onKey(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !blocked.value) void add()
}
</script>

<template>
  <section class="external-mcp" data-cy="external-mcp-registry" @keydown="onKey">
    <div class="sheet-header">
      <div class="sheet-glyph">M</div>
      <div class="sheet-header-copy">
        <strong data-cy="external-mcp-title">External tools</strong>
        <small
          >MCP servers running on this machine. Registered once for the whole app, and every agent
          can use one unless you restrict it.</small
        >
      </div>
      <span class="spacer"></span>
      <button
        class="icon-button"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </div>

    <div class="sheet-body">
      <p v-if="!store.loaded.value" class="note" data-cy="external-mcp-loading">
        Reading the registered servers…
      </p>
      <p
        v-else-if="store.loadError.value"
        class="note err"
        data-cy="external-mcp-load-error"
        role="alert"
      >
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>{{ store.loadError.value }}</span>
      </p>

      <template v-else>
        <!-- ⛔ **An empty registry is a real state and is not an error** — it is what every install
             starts in: `0032` creates the table empty and no migration seeds it.
             🔴 **566 · this paragraph was FALSE and had been since `524`.** It read *"it grants
             nobody until you tick it on an agent's own sheet"*, which `HO-048` §1 withdrew when the
             default became *available to every identity* — the radio eight lines below this one,
             pre-selected. ⚠️ **`524` corrected the rail's copy of the same sentence and the test
             comment that pinned it, and missed this one**; `566` found it grepping `grants nobody`.
             ⚑ **Now the one constant three surfaces share** — see {@link EXTERNAL_MCP_NONE_YET},
             whose docblock carries the measurement. -->
        <p v-if="servers.length === 0" class="note" data-cy="external-mcp-none">
          {{ EXTERNAL_MCP_NONE_YET }}
        </p>

        <div v-else class="rows" data-cy="external-mcp-rows">
          <div
            v-for="server in servers"
            :key="server.id"
            class="row"
            :data-cy="`external-mcp-row-${server.name}`"
          >
            <span class="row-copy">
              <strong>{{ server.name }}</strong>
              <small class="mono">{{ server.url }}</small>
              <!-- ⚑ **524 · the row says who it is for, because that is now a fact about it.** ⛔ Both
                   values are drawn, never only the exception: a list where one state is silence
                   cannot tell *everyone's* from *this build does not know*, which is the state
                   `foldExternalMcpReach` produces for a row it cannot read.
                   ⚠️ **`external-mcp-row-reach-…` and not `external-mcp-reach-…`**: a server NAME is
                   a path segment, so `everyone` and `restricted` are both legal names — and the
                   shorter spelling would have collided with the two radios below the moment somebody
                   registered one, silently handing a test the wrong element
                   (`an-assertion-can-be-satisfied-by-a-neighbouring-element`). -->
              <small :data-cy="`external-mcp-row-reach-${server.name}`">
                {{ server.reach === 'everyone' ? EXTERNAL_MCP_EVERYONE : EXTERNAL_MCP_RESTRICTED }}
              </small>
            </span>
            <span class="spacer"></span>
            <button
              type="button"
              :disabled="removing !== null"
              :data-cy="`external-mcp-remove-${server.name}`"
              @click="remove(server.id)"
            >
              {{ removing === server.id ? 'Removing…' : 'Remove' }}
            </button>
          </div>
          <!-- 🔴 **Said BEFORE the press, not after it** (`367` §2's rule as this app applies it):
               a person is told what a thing does before they choose it. ⛔ Removing is the only way
               to change an address, so the cascade is on the path they actually walk. -->
          <p class="note" data-cy="external-mcp-removal-means">{{ EXTERNAL_MCP_REMOVAL_MEANS }}</p>
        </div>

        <div class="field">
          <span class="lbl">
            Name
            <em
              v-if="folded !== '' && folded !== name.trim()"
              class="stored"
              data-cy="external-mcp-folded"
            >
              Stored as {{ folded }}
            </em>
          </span>
          <input
            v-model="name"
            type="text"
            placeholder="jira"
            spellcheck="false"
            autocomplete="off"
            data-cy="external-mcp-name"
            @input="touched"
          />
          <!-- ⚑ The RULE, not a refusal: a person is told the alphabet before they meet it. The
               reserved name and the `__` rule are the door's sentences and are not restated here. -->
          <p class="note" data-cy="external-mcp-name-note">
            This is the namespace the agent sees its tools under — {{ EXTERNAL_MCP_NAME_RULE }}.
          </p>
        </div>

        <div class="field">
          <span class="lbl">Address</span>
          <input
            v-model="url"
            type="text"
            placeholder="http://127.0.0.1:8765/mcp"
            spellcheck="false"
            autocomplete="off"
            data-cy="external-mcp-url"
            @input="touched"
          />
          <!-- ⛔ **What this build does NOT do, said out loud** (criterion 7's other half). There is
               no credential of any kind anywhere in it, so a server that needs one cannot be
               registered rather than being registered and silently failing to connect. -->
          <p class="note" data-cy="external-mcp-url-note">
            A server running on this machine, with no sign-in. BroCrew stores no password or token
            for an external server yet, so only an unauthenticated local address can be registered.
          </p>
        </div>

        <!-- 🔴 **524 · the one question `HO-048` §1 moved onto the server** — asked once here
             instead of once per identity, forever.
             ⛔ **Radios and not a checkbox**, and the reason is which state is silence: a single
             *Restrict this server* box makes the DEFAULT the unlabelled one, and the ruling is
             precisely about what a person who says nothing gets. ⚑ Two labelled answers, the wide
             one selected, is the only shape where the default is a thing a person can read.
             ⚠️ **No `disabled`, no confirmation, nothing to acknowledge** — `367`'s disclosure
             shape, which `HO-048` §2 asked for by name. -->
        <div class="field" data-cy="external-mcp-reach-field">
          <span class="lbl">Who it is for</span>
          <label class="reach">
            <input
              v-model="reach"
              type="radio"
              value="everyone"
              name="external-mcp-reach"
              data-cy="external-mcp-reach-everyone"
            />
            <span>{{ EXTERNAL_MCP_EVERYONE }}</span>
          </label>
          <label class="reach">
            <input
              v-model="reach"
              type="radio"
              value="restricted"
              name="external-mcp-reach"
              data-cy="external-mcp-reach-restricted"
            />
            <span>{{ EXTERNAL_MCP_RESTRICTED }}</span>
          </label>
          <!-- 🔴 **`HO-048` §2's sentence — stated, and NOT gated.** ⛔ *"That is what he wants and
               it is how he already works. I am not gating it. But it should be said in one sentence
               on the registration form … so that registering a server is a thing a person does
               knowingly rather than a thing that turns out to have been broad."* ⚑ Drawn only under
               the answer it is about, so it is a description of the choice on screen rather than a
               warning attached to the form. -->
          <p
            v-if="reach === 'everyone'"
            class="note"
            data-cy="external-mcp-everyone-means"
            role="status"
          >
            {{ EXTERNAL_MCP_EVERYONE_MEANS }}
          </p>
          <p v-else class="note" data-cy="external-mcp-restricted-means" role="status">
            {{ EXTERNAL_MCP_RESTRICTED_MEANS }}
          </p>
          <!-- ⛔ **Said BEFORE the press** — `EXTERNAL_MCP_REMOVAL_MEANS`' rule on the second thing
               this form fixes for the life of the row. -->
          <p class="note" data-cy="external-mcp-reach-fixed">{{ EXTERNAL_MCP_REACH_IS_FIXED }}</p>
        </div>

        <p class="note" data-cy="external-mcp-when">{{ EXTERNAL_MCP_TAKES_EFFECT }}</p>
      </template>

      <!-- Action feedback survives a separate failure to refresh the server list. -->
      <p v-if="addRefusal" class="note err block" data-cy="external-mcp-add-refusal" role="alert">
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>{{ addRefusal }}</span>
      </p>
      <p
        v-if="removeRefusal"
        class="note err block"
        data-cy="external-mcp-remove-refusal"
        role="alert"
      >
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>{{ removeRefusal }}</span>
      </p>
    </div>

    <div class="sheet-actions">
      <button type="button" data-cy="external-mcp-cancel" @click="emit('close')">Close</button>
      <button
        class="primary"
        type="button"
        :disabled="blocked"
        data-cy="external-mcp-add"
        @click="add"
      >
        <!-- ⚑ **`Checking…` and not `Adding…`**: what the press is waiting for is the SERVER's
             answer — the collision preflight is the rail — and a person whose server is not running
             needs to know that is what took the time. -->
        {{ adding ? 'Checking…' : 'Add server' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* The sheet shell — copied as DECLARATIONS from `NewAgent`, never borrowed as class names: `scoped`
   styles are per-component, so a name shared with another file shares nothing
   (`a-scoped-class-matches-nothing-in-another-component`). */
.external-mcp {
  display: flex;
  width: min(560px, 92vw);
  max-height: 88vh;
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
}

.sheet-header {
  display: flex;
  min-height: var(--surface-header-h);
  flex: 0 0 auto;
  align-items: center;
  padding: var(--space-5) var(--space-7) var(--space-5) var(--space-9);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-6);
}

.sheet-glyph {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--muted);
  font: var(--fw-bold) var(--type-caption) / 1 var(--font-mono);
  place-items: center;
}

.sheet-header-copy strong {
  display: block;
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-bold);
}

.sheet-header-copy small {
  display: block;
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
}

.spacer {
  flex: 1;
}

.icon-button {
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  color: var(--muted);
  place-items: center;
}

.icon {
  width: 14px;
  height: 14px;
}

/* ⚠️ `min-height: 0` so the scrolling body can actually shrink inside the flex column — without it
   a long note pushes the actions off a short window instead of scrolling. */
.sheet-body {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: var(--space-8) var(--space-9);
  overflow-y: auto;
  gap: var(--space-7);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.row {
  display: flex;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  gap: var(--space-5);
}

.row-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.row-copy strong {
  color: var(--text);
  font-size: var(--type-caption);
}

.row-copy small {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: var(--font-mono);
}

.row button {
  padding: var(--space-3) var(--space-5);
  font-size: var(--type-caption);
}

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.lbl {
  display: flex;
  align-items: baseline;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.stored {
  color: var(--muted);
  font-size: var(--type-caption);
  font-style: normal;
  letter-spacing: 0;
  opacity: 0.8;
  text-transform: none;
}

.field input {
  width: 100%;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

/* 🔴 **524 · the two answers, and the radio must undo `.field input`.** ⛔ That rule is written for
   the two TEXT boxes above and sets `width: 100%`, which would stretch a radio across the sheet and
   push its label off the row — `a-second-child-of-a-flex-parent-is-blockified`'s neighbour, arriving
   through a selector rather than through layout. ⚑ Overridden here rather than by narrowing the rule
   above, so the boxes a person types into are untouched by this dispatch. */
.reach {
  display: flex;
  align-items: baseline;
  color: var(--text);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.reach input {
  width: auto;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: none;
}

.note {
  display: flex;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  line-height: 1.5;
}

.note.err {
  color: var(--danger);
}

.note .icon {
  flex: 0 0 auto;
  margin-top: 1px;
}

.sheet-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  padding: var(--space-6) var(--space-9);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-4);
}

/* ⚠️ Padding and size only. `button` and `button.primary` are styled GLOBALLY in `base.css`,
   including the disabled state. */
.sheet-actions button {
  padding: var(--space-4) var(--space-7);
  font-size: var(--type-caption);
}
</style>
