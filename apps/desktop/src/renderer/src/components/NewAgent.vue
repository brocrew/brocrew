<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  AGENT_DISPLAY_NAME_CHARS,
  DEFAULT_PROFILE_ID,
  PATH_SEGMENT_RULE,
  PROVIDER_NAME,
  foldProfileName,
  isPathSegment,
  profileLabel,
  providerName,
  type Provider,
} from '../../../shared/runtime-ipc'
import { identityIn } from '../lib/agent-store'
import { noProviderSavedSays } from '../lib/front-door-words'
import { useAgentStore } from '../composables/useAgentStore'

/**
 * 🔴 **A person brings an agent into existence** (423, HO-023 §3) — the gesture `417` removed and
 * `419` built every layer of but the one you can press.
 *
 * ## ⛔ Why there is a component here at all
 *
 * `417` deleted `+ New profile…`, and that row was the only person-operated way an `agent_identity`
 * row had ever come into being — *"a launch is what CREATES a profile"*. `419` answered the missing
 * capability with a `createAgent` runtime command, a store transaction and a preload member, and
 * stopped there on purpose: **no renderer file called it.** HO-023 §3 holds `417` and `420` on this
 * one gesture, so this is the last blocker rather than a feature.
 *
 * ## ⚑ Why it is a creation form and not `CapabilitiesSheet`
 *
 * A creation form and an editor are two components because the editor's guards all say *"the row I
 * was opened for"*, and a slug field can never appear on one. ⛔ **The class names below are copied
 * as DECLARATIONS, never borrowed** — `scoped` styles are per-component, so a name shared with
 * another file shares nothing.
 *
 * ## ⛔ What this form does NOT ask for, and each omission is a ruling
 *
 *  - **No capability CONTROLS.** `CapabilitiesSheet` already grants them, and a created identity
 *    holds no grant of its own: every capability column is null, so it follows
 *    `DEFAULT_CAPABILITIES`, the one set every agent holds until a person changes its row there.
 *  - **No folder.** A folder is chosen when a conversation starts. An identity's home is laid down
 *    by the first LAUNCH, which is what keeps `416`'s four `provider-homes` call sites harmless — see
 *    `RuntimeHost.createAgent` for why creation writes no locator at all.
 *  - **No conversation.** Creation writes one row. Nothing is started.
 *
 * ## ⚠️ The one sentence this file does NOT compose
 *
 * 🔴 **A taken name is not pre-checked here, and that is deliberate** (423 §2: *"Render the app's
 * sentence; do not compose a second one"*). The agent door already HAS that sentence — `runtime-host.ts`'s `nameIsTaken`, which names the FOLDED
 * spelling and explains why names compare without case — and a second copy here would be one
 * wording away from telling a person something the database did not say. ⛔ So Create stays lit
 * over a taken name, the press is made, and what a person reads is the host's own bytes.
 */
const emit = defineEmits<{ close: [] }>()

const store = useAgentStore()

const slug = ref('')
const name = ref('')
/**
 * ⚑ **`''` is *nobody has said* on the select, and it is folded to `null` on the way out.**
 * `NewAgent.provider` is `.nullable()` and never `.optional()` on the wire (339, HO-005 criterion
 * 10) — an absent key and an explicit null are the same value to a `Partial` and are not the same
 * intent — so the empty option has to become a null rather than disappear.
 */
const provider = ref<Provider | ''>('')

/**
 * ⛔ **What will actually be stored, shown while it is being typed** (376's rule, 238's fold).
 *
 * `Worker` and `worker` are ONE identity: `createAgentIdentityTx` folds before it inserts, and the
 * id is `aid:<folded>`. A surface that accepted the capitals and stored something else would be
 * 086's fabricated value with the fabrication on our side — and the host's collision sentence names
 * the folded spelling, so a person who never saw the fold would be sent looking for a row under a
 * name they did not type.
 */
const folded = computed(() => foldProfileName(slug.value.trim()))

/**
 * ⚠️ **The wire's own alphabet, asked here so the button can be dark before the round trip** —
 * `isPathSegment` imported rather than restated, because this value BECOMES a directory segment
 * under `provider-homes/` and a second spelling of that alphabet is 169 §1's drift where it does
 * the most damage.
 *
 * ⛔ **It is not what makes the name safe.** `agentSlug`'s `.refine(isPathSegment, …)` is. This only
 * stops the app offering a gesture it already knows the wire will reject — and it is worded here
 * rather than shown from the wire because the wire's answer is `slug: must be …`, a zod path with a
 * rule stapled to it rather than a sentence.
 */
const slugRefusal = computed<string | null>(() => {
  if (slug.value.trim() === '') return null
  if (!isPathSegment(folded.value)) return `An agent's name must be ${PATH_SEGMENT_RULE}.`
  return null
})

/**
 * ⚑ **A folder on disk with no row is a real state, and naming it here ADOPTS it** — the other half
 * of the Team page's *"Create one with the same name to give it its row"* note (§4: reported, not
 * repaired). ⚠️ It was the rail's note until `EXT-008` §4.4 moved that section to a page at `570`.
 *
 * ⛔ **A note and never a refusal.** `createAgentIdentityTx` asks the `agent_identity` table and
 * nothing else, so an orphan folder does not make a name taken — and a person typing that exact
 * name is almost always doing it on purpose, from the folder list on the page this door opens
 * from.
 */
const adopts = computed(
  () =>
    folded.value !== '' &&
    // ⛔ **Both sides folded, and the host is why.** `agentIdentities` FILTERS on
    // `foldProfileName(folder)` and emits the raw directory name — *"a directory keeps the
    // spelling its first session ran under, so `Developer/` and the row `developer` are one
    // identity"* — so a bare `includes` would miss every orphan whose folder is not already
    // lower-case, which is precisely the population the fold exists for.
    (store.identities.value?.foldersWithoutARow ?? []).some(
      (folder) => foldProfileName(folder) === folded.value,
    ),
)

/**
 * 🔴 **The one name that is not a new agent, disclosed rather than refused** (423, measured).
 *
 * ⛔ **`agent_identity` is EMPTY on a fresh database** — the one migration writes no row but the
 * app-policy one. So on an app where no conversation has ever run, {@link DEFAULT_PROFILE_ID} is a name this form
 * can create, and creating it mints BroBot: the row the first launch would have written, following
 * the default grants like every other agent, plus the two facts this form carries.
 *
 * ⚑ **Which made it the one gesture that could answer HO-023 §3, and `433` gave it a second.**
 * `RuntimeScreen.frontDoorProvider` resolves *BroBot's identity, then the app frame's constant*.
 * ⛔ **This paragraph said *"nothing else in the shipped product can put a value in that identity's
 * provider column"* and `433` made it false**: `setAgentProvider` is a person-only verb on the
 * capability sheet, and a LAUNCH that mints a seeded identity's row writes
 * `seededProviderFor(slug)` rather than null. ⚠️ **What is unchanged is why this door still
 * matters**: it is where a person NAMES the identity, and a person walking it should be told what
 * they are naming rather than discovering it in the rail afterwards.
 *
 * ⛔ **Disclosed, not refused, and not renamed.** A refusal would close the only door to §3's
 * resolution; a *"did you mean BroBot?"* rewrite would be this surface deciding what somebody typed.
 * The words are {@link profileLabel}'s, which is the app's own answer to *how do you show this id to
 * a person*, so a rename of BroBot renames this sentence.
 */
const namingBroBot = computed(
  () =>
    folded.value === DEFAULT_PROFILE_ID &&
    // ⛔ **Only where the creation could actually happen.** On every app a conversation has run
    // on, {@link DEFAULT_PROFILE_ID} has a row and the press is refused by the host; promising a
    // person what the name decides and then refusing the press would be a sentence about a
    // gesture they cannot make. ⚑ The roster is already in hand, so the condition costs nothing.
    identityIn(store.identities.value, DEFAULT_PROFILE_ID) === null,
)

/** Normal or service: offered only while a person has services on in this workspace. */
const servicesOn = computed(() => store.identities.value?.servicesOn === true)
const kind = ref<'normal' | 'service'>('normal')

const creating = ref(false)
/** The refusal the create came back with, or null. Cleared when anything is edited. */
const createRefusal = ref<string | null>(null)

async function create(): Promise<void> {
  creating.value = true
  createRefusal.value = await store.create({
    slug: folded.value,
    // ⚑ **A blank box is `null`, never `''`** — clearing a field says *there is nothing to say* —
    // and the host folds a blank one again on the far side so it holds for every caller rather than only for this sheet.
    displayName: name.value.trim() === '' ? null : name.value.trim(),
    provider: provider.value === '' ? null : provider.value,
    ...(kind.value === 'service' && !namingBroBot.value ? { asAService: true as const } : {}),
  })
  creating.value = false
  // ⛔ **Closes only on success**: a sheet that closed over a refusal would take the sentence away
  // with it, and the sentence is the only place the name is explained.
  if (createRefusal.value === null) emit('close')
}

/**
 * ⛔ **Blocked by an EMPTY name and by the one refusal we have already been told about.** A name is
 * the whole of what a creation is, so there is nothing for the far side to refuse when it is blank;
 * a taken one is not here, for the reason in this file's docblock.
 */
const blocked = computed(() => creating.value || folded.value === '' || slugRefusal.value !== null)

/** `Mod+Enter` creates, the way every other confirming surface in this app does. */
function onKey(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !blocked.value) void create()
}

function touched(): void {
  createRefusal.value = null
}

/**
 * ⛔ **Both providers, from the TABLE rather than typed** — 169 §2's rule and `providerPossessives`'
 * own idiom one file over. A literal `'codex'` in this component would be a provider decision in the
 * renderer, which `provider-neutrality.test.ts` allows in exactly two places and this is not one.
 */
const providers = computed<Provider[]>(() => Object.keys(PROVIDER_NAME) as Provider[])
</script>

<template>
  <section class="new-agent" data-cy="new-agent" @keydown="onKey">
    <div class="sheet-header">
      <div class="sheet-glyph">{{ (folded || '?').slice(0, 1).toUpperCase() }}</div>
      <div class="sheet-header-copy">
        <strong data-cy="new-agent-title">New agent</strong>
        <small
          >An identity work can run as. Its name is its identity and cannot be changed later.</small
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
      <div class="field" :class="{ refused: slugRefusal !== null }">
        <span class="lbl">
          Name
          <!-- ⚑ **What will be stored, while it is being typed.** The fold is real and a person
               should meet it here rather than in the host's refusal afterwards. -->
          <em
            v-if="folded !== '' && folded !== slug.trim()"
            class="stored"
            data-cy="agent-slug-folded"
          >
            Stored as {{ folded }}
          </em>
        </span>
        <input
          v-model="slug"
          type="text"
          placeholder="archivist"
          spellcheck="false"
          autocomplete="off"
          data-cy="new-agent-slug"
          :aria-invalid="slugRefusal !== null"
          @input="touched"
        />
        <p v-if="slugRefusal" class="note err" data-cy="new-agent-slug-refusal" role="alert">
          <svg class="icon"><use href="#i-alert" /></svg>
          <span>{{ slugRefusal }}</span>
        </p>
        <p v-else-if="namingBroBot" class="note" data-cy="new-agent-slug-is-brobot">
          {{ profileLabel(folded) }} is the identity every new conversation on this app runs as, and
          it does not exist here yet. A provider chosen here is the one those conversations start
          on, and you can change it later on this agent's own sheet.
        </p>
        <p v-else-if="adopts" class="note" data-cy="new-agent-slug-adopts">
          There is already a folder with this name and no identity for it. Creating this agent gives
          that folder its row; nothing in it is read or moved.
        </p>
        <p v-else class="note" data-cy="new-agent-slug-note">
          This becomes the agent's identity in the database and the name of its folder on disk, so
          it cannot be changed afterwards. Names are compared without case.
        </p>
      </div>

      <label class="field">
        <span class="lbl">Display name</span>
        <input
          v-model="name"
          type="text"
          :maxlength="AGENT_DISPLAY_NAME_CHARS"
          placeholder="No name — it is shown as its name on disk"
          data-cy="new-agent-name"
          @input="touched"
        />
      </label>

      <label class="field">
        <span class="lbl">Provider</span>
        <select v-model="provider" data-cy="new-agent-provider" @change="touched">
          <option value="">{{ noProviderSavedSays(null) }}</option>
          <option v-for="each in providers" :key="each" :value="each">
            {{ providerName(each) }}
          </option>
        </select>
        <!-- ⚑ An agent keeps its provider: a give never changes it (`theProviderAStartRunsOn`). One
             nobody chose takes it at its first conversation and keeps it. The front door's own
             sentence names a constant instead, because a launch has no parent — see
             `RuntimeScreen`'s `DEFAULT_PROVIDER`. -->
        <p v-if="namingBroBot" class="note" data-cy="new-agent-provider-note">
          New conversations on this app run on this. Not chosen means they run on the app's own
          default instead, which the new-conversation screen names.
        </p>
        <p v-else class="note" data-cy="new-agent-provider-note">
          Its conversations run on this, and no agent that gives it work can change it. Not chosen
          means its first conversation decides, and it keeps that provider.
        </p>
      </label>

      <fieldset v-if="servicesOn && !namingBroBot" class="field kind" data-cy="new-agent-kind">
        <legend class="lbl">Kind</legend>
        <label class="kind-choice">
          <input v-model="kind" type="radio" value="normal" data-cy="new-agent-kind-normal" />
          <span>Normal</span>
          <small class="note">Separate workers for each caller.</small>
        </label>
        <label class="kind-choice">
          <input v-model="kind" type="radio" value="service" data-cy="new-agent-kind-service" />
          <span>Service</span>
          <small class="note">One conversation. Work runs one piece at a time.</small>
        </label>
      </fieldset>

      <!-- ⛔ **What this does NOT create, said out loud** (criterion 7's other half: nothing may
           imply work it did not do). -->
      <p class="note" data-cy="new-agent-scope">
        This creates the identity and nothing else. No conversation is started, and its folder is
        laid down the first time one runs as it. What it may do is set on its capabilities, and it
        starts on this app's defaults.
      </p>

      <p v-if="createRefusal" class="note err block" data-cy="new-agent-refusal" role="alert">
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>{{ createRefusal }}</span>
      </p>
    </div>

    <div class="sheet-actions">
      <button type="button" data-cy="new-agent-cancel" @click="emit('close')">Cancel</button>
      <button
        class="primary"
        type="button"
        :disabled="blocked"
        data-cy="new-agent-create"
        @click="create"
      >
        {{ creating ? 'Creating…' : 'Create agent' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* The sheet shell — declarations, never borrowed as class names:
   `scoped` styles are per-component, so a name shared with another file shares nothing. */
.new-agent {
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

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}
.kind {
  border: 0;
  padding: 0;
  margin: 0;
}
.kind-choice {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: var(--space-3);
  align-items: baseline;
}
.kind-choice .note {
  grid-column: 2;
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

.field input,
.field select {
  width: 100%;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--text);
  font-family: inherit;
  font-size: var(--type-caption);
}

[data-cy='new-agent-slug'] {
  font-family: var(--font-mono);
}

.field.refused input {
  border-color: var(--danger);
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
