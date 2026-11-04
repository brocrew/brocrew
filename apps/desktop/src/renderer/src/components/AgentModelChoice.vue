<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PROVIDER_NAME,
  type Provider,
  type ProviderCapabilityMap,
} from '../../../shared/runtime-ipc'
import {
  aChoiceInWords,
  aChoiceIsInForce,
  type AgentModelChoice,
} from '../../../shared/model-choice'
import { runsOnIn, type AgentStore } from '../lib/agent-store'
import { theMenusAreFor } from '../lib/agent-model-choice'
import type { ModelLists, PickedModel } from '../lib/model-lists'
import { useAgentStore } from '../composables/useAgentStore'
import { useModelLists } from '../composables/useModelLists'
import ModelPicker from './ModelPicker.vue'

/**
 * 🔴 **685 · the model and effort a person chooses for this agent — the control `677` built the
 * doors for** (`R25`). See `lib/agent-model-choice.ts` for every rule; this file is the drawing.
 *
 * ⚑ **D-042 · what it chooses is the agent's DEFAULT** (R2) — and ⚑ **UI-012 draws it with the one
 * model picker** (`09` §1): the face is the default as held, its panel the list of the provider the
 * menus are for, and its Take is this door's Save.
 *
 * ## ⛔ Its own component and its own gesture
 *
 * ⚑ `CapabilitiesSheet` has one Save button, and the provider choice beside this and
 * `OwnInstructions` below it each keep their own for the reason `433` gave: two commands behind one
 * press can half-succeed. ⚑ And it keeps the sheet's diff to a mount.
 *
 * ## ⚠️ It asks no provider anything until a person opens the picker
 *
 * ⛔ **A list read is a probe, and a probe is a LAUNCH** — a short-lived child per provider. So the
 * idle control draws the choice as stored and nothing more; the picker asks when it is opened.
 *
 * ## ⚑ Re-read when the roster is
 *
 * The door announces `agents` on a save and on a clear, and `RuntimeScreen` answers that subject by
 * re-reading the roster this sheet already watches — so a watch on the roster is how a choice made
 * in another window reaches this one. ⚑ A re-read moves the HELD choice; the picker's draft lives
 * in its open panel and is its own.
 */
const props = withDefaults(
  defineProps<{
    /** The identity, folded — the sheet's own slug. */
    profileSlug: string
    /**
     * ⚑ **The provider the sheet's *Runs on* row resolves** — the menus are that provider's, ⚠️
     * except where a held choice holds the provider instead (`696`, {@link menusFor}).
     */
    runsOn: Provider
    /**
     * ⚑ **The agent's OWN provider column** — `null` is *nobody has said*. Read to say when the
     * held choice is not in force (see `aChoiceForAnotherProviderSays`), and ⚑ `696` · to decide
     * which provider the menus are for ({@link menusFor}).
     */
    itsProvider?: Provider | null
    /** Read only for a refused list's remedy, in the picker (`model-field.ts`). */
    capabilities?: ProviderCapabilityMap | null
    /** Injectable for tests; the window's one store otherwise. */
    store?: AgentStore
    /** Injectable for tests; the window's one holder of the model lists otherwise. */
    lists?: ModelLists
  }>(),
  { store: undefined, itsProvider: null, capabilities: null, lists: undefined },
)

const emit = defineEmits<{
  /**
   * 🔴 **712 · R56 — the choice this control HOLDS, each time it learns it** (a read that answered,
   * or its own door's answer). ⚑ The provider row above says what its press would clear from this —
   * one read, so the two cannot disagree about the choice. ⛔ Never on a refused read: that keeps
   * the last good answer here, and the row keeps the one it was last told.
   */
  held: [choice: AgentModelChoice | null]
}>()

const store = computed(() => props.store ?? useAgentStore())
const modelLists = computed(() => props.lists ?? useModelLists())
const providers = Object.keys(PROVIDER_NAME) as Provider[]
const defaultConnection = computed(
  () =>
    store.value.identities.value?.identities.find((one) => one.slug === props.profileSlug)
      ?.connectionId,
)

/** ⛔ Whether an answer has arrived at all (086) — `held: null` is *nobody chose*, and ordinary. */
const asked = ref(false)
const unreadable = ref(false)
/**
 * ⛔ **Whether ANY read has answered** — `held` is a fact only after one has. ⚠️ Until review, a
 * failed first read drew *Nobody has chosen* beside *could not read*, and offered a choice over one
 * this window had never learned of (`685`'s review; 086's conflation, one layer up).
 */
const readOnce = ref(false)
/** ⚑ **D-042 · the agent's default** — what its new conversations start on. */
const held = ref<AgentModelChoice | null>(null)
const busy = ref(false)
/** The door's own `reason` for the last clear it refused, verbatim. */
const refusal = ref<string | null>(null)

async function read(): Promise<void> {
  const answer = await store.value.modelChoiceFor(props.profileSlug)
  asked.value = true
  unreadable.value = answer === null
  // ⛔ **A refused read leaves the last good answer on screen** — it has not learned the choice
  // went away, and the sentence below it says the read failed.
  if (answer !== null) {
    held.value = answer.held
    readOnce.value = true
    emit('held', answer.held)
  }
}

watch(() => props.profileSlug, read, { immediate: true })
watch(
  () => store.value.identities.value,
  () => void read(),
)

/**
 * 🔴 **`696` · the provider the menus are for** — `theMenusAreFor`: the resolved *Runs on*, except
 * for an agent with no provider of its own holding a choice, whose agent-started launches run on the
 * CHOICE's provider (`R31a`). ⛔ Until `696`, *Change…* on such an agent's Claude choice opened the
 * screen's fallback — Codex's rows (`RuntimeScreen`'s `DEFAULT_PROVIDER`).
 */
const ownProvider = computed(() => {
  const row = store.value.identities.value?.identities.find((one) => one.slug === props.profileSlug)
  if (row === undefined) return props.itsProvider
  if (row.provider !== null) return row.provider
  const inferred = runsOnIn(store.value.identities.value, props.profileSlug)
  return inferred?.from === 'its-conversations' ? inferred.provider : null
})
const menusFor = computed(() =>
  theMenusAreFor(ownProvider.value ?? props.runsOn, ownProvider.value, held.value),
)

/**
 * ⚑ **The face: the default as held, when it is for the provider the menus are for.** ⚠️ One for
 * another provider is not a value this picker lists — it is drawn beside the face, marked.
 */
const shown = computed<PickedModel | null>(() =>
  held.value !== null && held.value.provider === menusFor.value ? held.value : null,
)

const notInForce = computed(
  () => held.value !== null && !aChoiceIsInForce(held.value, ownProvider.value),
)

/**
 * ⚑ **The picker's Take is this door's Save** — `setAgentModelAndEffort`. ⛔ **What is drawn
 * afterwards is the door's answer** (HO-029 §3): the choice read back on success, and its `reason`
 * verbatim in the open panel on a refusal, so a person can pick again.
 */
async function save(pick: PickedModel): Promise<string | null> {
  const answer = await store.value.chooseModelFor(props.profileSlug, pick)
  if (!answer.ok) return answer.reason
  held.value = answer.held
  unreadable.value = false
  readOnce.value = true
  refusal.value = null
  emit('held', answer.held)
  return null
}

/** ⚑ **Clear** — the three `null`s, through the same door. */
async function clear(): Promise<void> {
  busy.value = true
  refusal.value = null
  const answer = await store.value.chooseModelFor(props.profileSlug, null)
  busy.value = false
  if (!answer.ok) {
    refusal.value = answer.reason
    return
  }
  held.value = answer.held
  unreadable.value = false
  emit('held', answer.held)
}
</script>

<template>
  <div class="agent-model" data-cy="agent-model">
    <p v-if="!asked" class="agent-model-note" data-cy="agent-model-loading">Reading…</p>

    <template v-else>
      <div class="agent-model-row">
        <span class="agent-model-label">Model and effort</span>
        <strong v-if="!readOnce" data-cy="agent-model-unknown">Not known</strong>
        <template v-else>
          <ModelPicker
            :providers="providers"
            :preferred-provider="menusFor"
            :connection-id="held?.connectionId ?? defaultConnection"
            :profile-id="props.profileSlug"
            :shown="shown"
            empty="Nobody has chosen"
            take-words="Save as its default"
            :take="save"
            :capabilities="props.capabilities"
            :lists="modelLists"
          />
          <!-- 🔴 **`696` · a choice for ANOTHER provider, and where it stands** (`688` §1b) — not
               in force (`R31b`): nothing reads it. -->
          <span v-if="notInForce && held" class="agent-model-held" data-cy="agent-model-held">
            <strong>{{ aChoiceInWords(held) }}</strong>
            <em class="agent-model-off" data-cy="agent-model-not-in-force">not in force</em>
          </span>
        </template>
        <span class="agent-model-spacer"></span>
        <button
          v-if="held !== null"
          type="button"
          data-cy="agent-model-clear"
          :disabled="busy"
          @click="clear"
        >
          Clear
        </button>
      </div>

      <p
        v-if="unreadable"
        class="agent-model-state err"
        data-cy="agent-model-unreadable"
        role="alert"
      >
        <svg class="icon"><use href="#i-alert" /></svg>
        <span
          >This app could not read the model chosen for this agent. Close and open this again.</span
        >
      </p>

      <p v-if="refusal" class="agent-model-state err" data-cy="agent-model-refusal" role="alert">
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>{{ refusal }}</span>
      </p>
    </template>
  </div>
</template>

<style scoped>
.agent-model {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.agent-model-row,
.agent-model-held {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
}

.agent-model-row {
  gap: var(--space-4);
}

/* ⚑ **The sheet's own label register** — `.provider-row > span`, one row up. ⚠️ Spelled here
   because that rule is scoped to `CapabilitiesSheet` and reaches no element of this component. */
.agent-model-label {
  color: var(--muted);
  font-size: var(--type-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.agent-model-held strong,
.agent-model-row > strong {
  min-width: 0;
  color: var(--text);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

/* ⚑ **`696` · *not in force* is a STATE of the value beside it**, so it is drawn in the row's own
   muted register and never as a control or a warning: nothing is wrong that a press here fixes
   without a person deciding to. */
.agent-model-off {
  color: var(--muted);
  font-size: var(--type-caption);
  font-style: italic;
}

.agent-model-spacer {
  flex: 1;
}

.agent-model-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.agent-model-state {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  line-height: 1.5;
}

.agent-model-state.err {
  color: var(--danger);
}

.icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
</style>
