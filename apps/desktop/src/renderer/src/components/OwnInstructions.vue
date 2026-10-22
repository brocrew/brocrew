<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NOBODY_HAS_WRITTEN_ONE,
  OWN_INSTRUCTIONS_CHARS,
  TAKES_EFFECT_AT_THE_NEXT_LAUNCH,
  WROTE_IT_MEANS,
  rulesChangeLabel,
  type InstructionUnread,
  type OwnInstructionsVersion,
  whatIsInForce,
  type AgentInstructionsReading,
} from '../../../shared/own-instructions'
import { agentName, type RuntimeBridge } from '../../../shared/runtime-ipc'
import type { RulesBaseline } from '../../../shared/agent-rules'
import type { AgentStore } from '../lib/agent-store'
import { fullTime } from '../lib/clock'
import { useAgentStore } from '../composables/useAgentStore'

/**
 * 🔴 **The editor `HO-063` gap 4 asked for — where a person writes rules that reach an agent at
 * every launch** (582, `HO-009` §2.2).
 *
 * ## ⛔ Why it is a component and not markup inside `CapabilitiesSheet`
 *
 * ⚠️ **That sheet has ONE Save button and its own refusal state**, and rules are a different
 * gesture — the same argument `433` made for keeping the provider choice off Save, and `558` for
 * the rename. ⛔ Folding a second write into that form would mean a press that half-succeeds, and
 * the sheet would have to draw a state that is neither saved nor unsaved.
 *
 * ⚑ **And it keeps the host sheet's diff to a mount**, which matters while another dispatch is in
 * this renderer (standing rule 23.1: a rail naming surfaces does not bound a dispatch that
 * restructures one).
 *
 * ## 🔴 What it does NOT do, and each is a ruling rather than a cut
 *
 * ⛔ **There is no edit and no delete.** `HO-009` §1.2 makes *what the rule used to be* the safety
 * property of this layer, so Save appends, Clear appends an empty version, and Restore appends an
 * old text forward. ⚠️ Every one of those is a dated, attributed row.
 *
 * ⛔ **It never claims a rule is in force NOW.** {@link TAKES_EFFECT_AT_THE_NEXT_LAUNCH} is the one
 * place that sentence lives, and standing rule 8.2 is why it is worded as it is: a sentence about
 * WHEN a fact is read is itself a fact about the system, and `574` measured what an agent does when
 * ours is wrong.
 */
type RulesBridge = Pick<
  RuntimeBridge,
  'undoAgentRules' | 'agentRulesUnread' | 'markAgentRulesSeen'
> &
  Partial<Pick<RuntimeBridge, 'onChanged'>>

const props = withDefaults(
  defineProps<{
    /** The identity these rules belong to — folded, as every other slug on this sheet is. */
    profileSlug: string
    /**
     * ⚑ **Injectable for tests; the window's one store otherwise** — `CapabilitiesSheet`'s own
     * arrangement, and `538`'s rule: a component that reaches for a singleton cannot be driven.
     */
    store?: AgentStore
    bridge?: RulesBridge
    /**
     * ⛔ **The heading, or `null` where the PARENT has already written one** (626).
     *
     * ⚠️ **It exists because this component is now mounted behind two doors** — `CapabilitiesSheet`,
     * where it heads its own block, and `AgentSectionsSheet`, where `EXT-015` §2's framework has
     * already drawn the section heading above it. 🔴 **Two headings for one thing is the defect
     * this avoids**, and hiding the framework's instead would make the section that CAN be filled
     * the only one shaped differently from the three that cannot.
     */
    heading?: string | null
  }>(),
  { store: undefined, bridge: undefined, heading: 'Its own instructions' },
)

const store = computed(() => props.store ?? useAgentStore())
const bridge = computed(
  () => props.bridge ?? (typeof window === 'undefined' ? undefined : window.api?.runtime),
)

/**
 * 🔴 **712 · R41 (`707` GAP-5) — the agent that asked, NAMED** (`agentName`, over the roster this
 * store already holds). ⛔ It printed the slug. ⚠️ `identities?.` because a store that never loaded
 * one — a test's double — reads as a roster not landed yet, and `agentName` then answers its own
 * fallback.
 */
function named(slug: string): string {
  return agentName(slug, store.value.identities?.value?.identities ?? null)
}

/** The last reading, or `null` while nothing has arrived and when the read was refused. */
const reading = ref<AgentInstructionsReading | null>(null)
/**
 * ⛔ **Whether an answer has arrived at all** (086, and `AgentStore.loaded`'s rule one module over).
 * ⚠️ Null `reading` is three facts until this splits them: not asked, asked and refused, asked and
 * empty — and the third is the ORDINARY one for an agent nobody has written rules for.
 */
const asked = ref(false)
const draft = ref('')
const refusal = ref<string | null>(null)
const busy = ref(false)
const editorBaseline = ref<RulesBaseline>({ expectedVersion: 0, currentText: '' })

const inForce = computed(() => (reading.value === null ? null : whatIsInForce(reading.value.own)))
const history = computed(() => reading.value?.own.versions ?? [])
const waiting = computed(() => reading.value?.waiting ?? [])
/**
 * ⛔ **The draft differs from what is in force** — which is what makes Save mean something.
 *
 * ⚠️ **Compared against the TEXT and not against a dirty flag**, so typing a character and deleting
 * it again leaves the button off: a version whose text equals the one before it would be an audit
 * row recording that nothing happened, which is `a-true-mutation-measures-nothing` arriving in a
 * ledger a person reads.
 */
const changed = computed(() => draft.value !== (inForce.value?.text ?? ''))
const tooLong = computed(() => draft.value.length > OWN_INSTRUCTIONS_CHARS)
const olderDraft = computed(
  () =>
    reading.value !== null &&
    (editorBaseline.value.expectedVersion !== (inForce.value?.version ?? 0) ||
      editorBaseline.value.currentText !== (inForce.value?.text ?? '')),
)

const unread = ref<InstructionUnread | null>(null)
const reviewElement = ref<HTMLElement | null>(null)
const reviewCards = ref<
  readonly { version: OwnInstructionsVersion; before: string; personVersion: number | null }[]
>([])
const restoring = ref<{ version: OwnInstructionsVersion; baseline: RulesBaseline } | null>(null)
const clearing = ref<RulesBaseline | null>(null)
let profileEpoch = 0
let readSequence = 0
let unreadSequence = 0
let reviewSequence = 0
let observer: IntersectionObserver | null = null
let stopChanges: (() => void) | undefined

const unseen = computed(() =>
  history.value.filter(
    (one) =>
      one.whoWroteIt === 'an-agent-direct' &&
      one.version > (unread.value?.seenThrough ?? Number.MAX_SAFE_INTEGER),
  ),
)

function baseline(): RulesBaseline {
  return { expectedVersion: inForce.value?.version ?? 0, currentText: inForce.value?.text ?? '' }
}

async function readUnread(epoch = profileEpoch): Promise<void> {
  const api = bridge.value
  if (!api) return
  const sequence = ++unreadSequence
  try {
    const value = await api.agentRulesUnread({ profileId: props.profileSlug })
    if (epoch === profileEpoch && sequence === unreadSequence) unread.value = value
  } catch {
    // A failed reading cannot acknowledge a change.
  }
}

async function read(resetDraft = true): Promise<void> {
  const epoch = profileEpoch
  const sequence = ++readSequence
  const answer = await store.value.instructionsFor(props.profileSlug)
  if (epoch !== profileEpoch || sequence !== readSequence) return
  asked.value = true
  reading.value = answer
  if (answer !== null && resetDraft) {
    draft.value = whatIsInForce(answer.own)?.text ?? ''
    editorBaseline.value = baseline()
  }
  await readUnread(epoch)
}

watch(
  () => props.profileSlug,
  () => {
    profileEpoch++
    unreadSequence++
    reviewSequence++
    observer?.disconnect()
    reading.value = null
    asked.value = false
    unread.value = null
    reviewCards.value = []
    restoring.value = null
    clearing.value = null
    busy.value = false
    refusal.value = null
    draft.value = ''
    editorBaseline.value = { expectedVersion: 0, currentText: '' }
    void read()
  },
  { immediate: true },
)

onMounted(() => {
  stopChanges = bridge.value?.onChanged?.((change) => {
    if (change.what === 'agents') void readUnread()
  })
})

onBeforeUnmount(() => {
  profileEpoch++
  readSequence++
  unreadSequence++
  reviewSequence++
  observer?.disconnect()
  stopChanges?.()
})

async function save(
  text: string,
  broughtBack?: number,
  against = editorBaseline.value,
): Promise<void> {
  if (reading.value === null || busy.value) return
  const epoch = profileEpoch
  busy.value = true
  const result = await store.value.instruct(props.profileSlug, text, broughtBack, against)
  if (epoch !== profileEpoch) return
  refusal.value = result
  restoring.value = null
  clearing.value = null
  busy.value = false
  await read(result === null)
}

async function decide(askId: string, approve: boolean): Promise<void> {
  if (busy.value) return
  const epoch = profileEpoch
  const keepDraft = changed.value
  busy.value = true
  const result = await store.value.decideInstruction(askId, approve)
  if (epoch !== profileEpoch) return
  refusal.value = result
  busy.value = false
  await read(result === null && !keepDraft)
}

async function replaceDraft(): Promise<void> {
  if (busy.value) return
  const epoch = profileEpoch
  busy.value = true
  await read()
  if (epoch !== profileEpoch) return
  busy.value = false
  if (reading.value !== null) {
    restoring.value = null
    clearing.value = null
    refusal.value = null
  }
}

function previewRestore(version: OwnInstructionsVersion): void {
  clearing.value = null
  restoring.value = { version, baseline: baseline() }
}

function previewClear(): void {
  restoring.value = null
  clearing.value = baseline()
}

async function restore(): Promise<void> {
  const selected = restoring.value
  if (selected) await save(selected.version.text, selected.version.version, selected.baseline)
}

async function undo(): Promise<void> {
  const api = bridge.value
  if (!api || inForce.value === null || busy.value) return
  const epoch = profileEpoch
  const profileId = props.profileSlug
  const expectedVersion = inForce.value.version
  busy.value = true
  try {
    const result = await api.undoAgentRules({ profileId, expectedVersion })
    if (epoch !== profileEpoch) return
    if (result === null) {
      refusal.value = "This change couldn't be undone. Read the latest rules before trying again."
      await read(false)
    } else {
      reading.value = result
      draft.value = whatIsInForce(result.own)?.text ?? ''
      editorBaseline.value = baseline()
      refusal.value = null
      restoring.value = null
      clearing.value = null
      await readUnread(epoch)
    }
  } catch {
    if (epoch === profileEpoch)
      refusal.value = "This change couldn't be undone. Read the latest rules before trying again."
  } finally {
    if (epoch === profileEpoch) busy.value = false
  }
}

async function reviewChanges(): Promise<void> {
  if (busy.value) return
  const epoch = profileEpoch
  const sequence = ++reviewSequence
  const profileId = props.profileSlug
  await read(false)
  if (epoch !== profileEpoch || sequence !== reviewSequence) return
  const versions = history.value
  reviewCards.value = unseen.value.map((one) => {
    const previous = versions.find((candidate) => candidate.version < one.version)
    return {
      version: one,
      before: previous?.text ?? '',
      personVersion:
        previous &&
        (previous.whoWroteIt === 'a-person' || previous.whoWroteIt === 'an-agents-proposal')
          ? previous.version
          : null,
    }
  })
  observer?.disconnect()
  if (reviewCards.value.length === 0) return
  const throughVersion = reviewCards.value.reduce(
    (latest, card) => Math.max(latest, card.version.version),
    0,
  )
  await nextTick()
  const target = reviewElement.value
  const api = bridge.value
  if (
    !target ||
    !api ||
    epoch !== profileEpoch ||
    sequence !== reviewSequence ||
    typeof IntersectionObserver === 'undefined'
  )
    return
  observer = new IntersectionObserver((entries) => {
    if (
      epoch !== profileEpoch ||
      sequence !== reviewSequence ||
      !entries.some((entry) => entry.isIntersecting) ||
      document.visibilityState !== 'visible'
    )
      return
    observer?.disconnect()
    void api
      .markAgentRulesSeen({ profileId, throughVersion })
      .then((marked) => {
        if (epoch !== profileEpoch || !marked) return
        return readUnread(epoch)
      })
      .catch(() => {
        /* Keep the notice when acknowledgement could not be recorded. */
      })
  })
  observer.observe(target)
}
</script>

<template>
  <div class="own-instructions" data-cy="own-instructions">
    <h3 v-if="props.heading !== null">{{ props.heading }}</h3>

    <!-- 🔴 **Standing rule 8.2's sentence, rendered from one constant and scoped to itself.**
         ⚠️ It says what this write does and what a person must do INSTEAD for a live agent, which
         is `HO-009` §2.2's *"Both, or the person will believe a rule is in force that is not."* -->
    <p class="identity-note" data-cy="own-instructions-when">
      {{ TAKES_EFFECT_AT_THE_NEXT_LAUNCH }}
    </p>

    <!-- ⛔ **`EXT-015` §2.1's OTHER half — *when it was read*** (626). ⚠️ The sentence above says
         when a change takes EFFECT; this one says how old the thing on screen is, and a person
         needs both to know whether what they are looking at is current.
         ⚑ **It is drawn HERE rather than by the sheet**, because `readAt` arrives on this
         component's own reading and nothing else holds it — a parent that wanted it would have to
         take a second reading, which is a second answer to one question. -->
    <p v-if="reading !== null" class="identity-note" data-cy="own-instructions-read-at">
      Read {{ fullTime(reading.readAt) }}.
    </p>

    <p v-if="!asked" class="sheet-state" data-cy="own-instructions-loading">Reading…</p>
    <p
      v-else-if="reading === null"
      class="sheet-state err"
      data-cy="own-instructions-unreadable"
      role="alert"
    >
      <svg class="icon"><use href="#i-alert" /></svg>
      <span>This app could not read what this agent has been told. Close and open this again.</span>
    </p>

    <template v-else>
      <div v-if="unread?.unread" class="change-notice" data-cy="own-instructions-unread">
        <strong>New rule change</strong>
        <button
          type="button"
          :disabled="busy"
          data-cy="own-instructions-change-review"
          @click="reviewChanges"
        >
          See what changed
        </button>
      </div>
      <section
        v-if="reviewCards.length > 0"
        class="change-preview"
        data-cy="own-instructions-change-summary"
      >
        <article v-for="card in reviewCards" :key="card.version.version">
          <h4>{{ rulesChangeLabel(card.version) }} · version {{ card.version.version }}</h4>
          <p v-if="card.version.author" class="identity-note">
            {{ card.version.author.profile }} · {{ fullTime(card.version.writtenAt) }}
          </p>
          <p v-if="card.personVersion !== null" class="identity-note">
            This replaced your rules from version {{ card.personVersion }}.
          </p>
          <p class="identity-note">Reason: {{ card.version.said || 'No reason was recorded.' }}</p>
          <strong>Before</strong>
          <pre class="version-text">{{ card.before || 'No rules' }}</pre>
          <strong>After</strong>
          <pre class="version-text">{{ card.version.text || 'No rules' }}</pre>
        </article>
        <span
          ref="reviewElement"
          class="review-end"
          data-cy="own-instructions-change-end"
          aria-hidden="true"
        ></span>
      </section>
      <!-- ⛔ **Every ask waiting on this identity, oldest first** — and `HO-009` §2.2's gate is
           this control: nothing an agent proposed is written until a person presses Approve.
           ⚠️ **A relay never appears here**, because a relay was written when it was made; the
           history below is where a person sees one, labelled with what this app did and did not
           check. -->
      <div v-if="waiting.length > 0" class="asks" data-cy="own-instructions-asks">
        <div
          v-for="one in waiting"
          :key="one.asked.askId"
          class="ask"
          :data-cy="`own-instructions-ask-${one.asked.askId}`"
        >
          <p class="ask-who">
            <strong>{{ named(one.asked.proposedBy) }}</strong> asked to set these rules ·
            {{ fullTime(one.at) }}
          </p>
          <!-- ⚠️ **A CLAIM, and labelled as one** — `438`'s rule: nothing in this app checked a
               word of it. -->
          <p class="ask-why" data-cy="own-instructions-ask-why">It said: “{{ one.asked.why }}”</p>
          <pre class="ask-text">{{ one.asked.text }}</pre>
          <div class="ask-controls">
            <button
              type="button"
              :disabled="busy"
              :data-cy="`own-instructions-approve-${one.asked.askId}`"
              @click="decide(one.asked.askId, true)"
            >
              Approve
            </button>
            <button
              type="button"
              :disabled="busy"
              :data-cy="`own-instructions-refuse-${one.asked.askId}`"
              @click="decide(one.asked.askId, false)"
            >
              Refuse
            </button>
          </div>
        </div>
      </div>

      <p v-if="history.length === 0" class="identity-note" data-cy="own-instructions-empty">
        {{ NOBODY_HAS_WRITTEN_ONE }}
      </p>

      <textarea
        v-model="draft"
        class="own-instructions-text"
        data-cy="own-instructions-text"
        rows="8"
        :maxlength="OWN_INSTRUCTIONS_CHARS"
        :disabled="busy"
        placeholder="Rules this agent should follow, in every conversation."
      ></textarea>
      <p class="identity-note" data-cy="own-instructions-count">
        {{ draft.length }} of {{ OWN_INSTRUCTIONS_CHARS }} characters
      </p>

      <section v-if="olderDraft" class="change-preview" data-cy="own-instructions-newer-rules">
        <p class="identity-note">
          The saved rules changed while you were editing. Your draft is still here.
        </p>
        <strong>Latest saved rules · version {{ inForce?.version ?? 0 }}</strong>
        <pre class="version-text">{{ inForce?.text || 'No rules' }}</pre>
        <button
          type="button"
          :disabled="busy"
          data-cy="own-instructions-reload"
          @click="replaceDraft"
        >
          Replace my draft with the latest rules
        </button>
      </section>

      <p v-if="refusal" class="sheet-state err" data-cy="own-instructions-refusal" role="alert">
        <svg class="icon"><use href="#i-alert" /></svg>
        <span>{{ refusal }}</span>
      </p>

      <div class="own-instructions-controls">
        <button
          v-if="bridge && inForce !== null"
          type="button"
          data-cy="own-instructions-undo"
          :disabled="busy || changed || olderDraft"
          @click="undo"
        >
          Undo latest change
        </button>
        <button
          type="button"
          data-cy="own-instructions-save"
          :disabled="busy || !changed || tooLong || olderDraft"
          @click="save(draft)"
        >
          Save as version {{ (inForce?.version ?? 0) + 1 }}
        </button>
        <!-- ⛔ **Clear APPENDS an empty version** and the label says so, because a control called
             *Delete* beside a history that cannot be deleted would be the app describing an act it
             does not perform. -->
        <button
          type="button"
          data-cy="own-instructions-clear"
          :disabled="busy || olderDraft || (inForce?.text ?? '') === ''"
          @click="previewClear"
        >
          Take them away
        </button>
      </div>

      <!-- 🔴 **The history — `HO-009` §1.2's whole reason for this layer's shape.**
           ⛔ Every row says WHO, WHEN and what it brought back; the provenance sentence comes from
           {@link WROTE_IT_MEANS} rather than being written beside the word (standing rule 8). -->
      <section v-if="clearing" class="change-preview" data-cy="own-instructions-clear-preview">
        <h4>Remove these rules?</h4>
        <pre class="version-text">{{ clearing.currentText }}</pre>
        <p class="identity-note">
          This saves an empty version. You can restore any earlier version from the history.
        </p>
        <button
          type="button"
          :disabled="busy"
          data-cy="own-instructions-clear-confirm"
          @click="save('', undefined, clearing)"
        >
          Remove rules
        </button>
        <button type="button" :disabled="busy" @click="clearing = null">Cancel</button>
      </section>
      <section v-if="restoring" class="change-preview" data-cy="own-instructions-restore-preview">
        <h4>Restore version {{ restoring.version.version }}?</h4>
        <strong>Before</strong>
        <pre class="version-text">{{ restoring.baseline.currentText || 'No rules' }}</pre>
        <strong>After</strong>
        <pre class="version-text">{{ restoring.version.text || 'No rules' }}</pre>
        <p class="identity-note">This saves another version and keeps the history.</p>
        <button
          type="button"
          :disabled="busy"
          data-cy="own-instructions-restore-confirm"
          @click="restore"
        >
          Restore this version
        </button>
        <button type="button" :disabled="busy" @click="restoring = null">Cancel</button>
      </section>
      <ol v-if="history.length > 0" class="versions" data-cy="own-instructions-versions">
        <li
          v-for="one in history"
          :key="one.version"
          class="version"
          :data-cy="`own-instructions-version-${one.version}`"
        >
          <p class="version-head">
            <strong>Version {{ one.version }}</strong>
            <em v-if="one.version === inForce?.version" data-cy="own-instructions-in-force">
              in force
            </em>
            · {{ fullTime(one.writtenAt) }} · {{ WROTE_IT_MEANS[one.whoWroteIt] }}
            <span class="version-author">
              · {{ rulesChangeLabel(one)
              }}<template v-if="one.author"> · {{ one.author.profile }}</template></span
            >
            <span
              v-if="one.broughtBack !== null"
              :data-cy="`own-instructions-brought-back-${one.version}`"
            >
              · brought back version {{ one.broughtBack }}
            </span>
          </p>
          <p v-if="one.said" class="version-said">It said: “{{ one.said }}”</p>
          <pre v-if="one.text !== ''" class="version-text">{{ one.text }}</pre>
          <p v-else class="identity-note" :data-cy="`own-instructions-emptied-${one.version}`">
            This version took the rules away.
          </p>
          <button
            v-if="one.version !== inForce?.version"
            type="button"
            :disabled="busy"
            :data-cy="`own-instructions-restore-${one.version}`"
            @click="previewRestore(one)"
          >
            Restore this text
          </button>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.change-notice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
  padding: var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
}
.change-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-2);
}
.change-preview h4 {
  margin: 0;
}
.change-preview article {
  min-width: 0;
}
.review-end {
  display: block;
  min-height: 1px;
  width: 1px;
}
.version-author {
  display: block;
}

.own-instructions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* 🔴 **`min-width: 0`, and it is the whole of what keeps a pasted operating model inside the
     sheet.** ⛔ A flex item's `min-width` defaults to `auto`, which is its CONTENT — so one long
     unbroken line pushes this box wider than the column it sits in and the sheet behind it scrolls
     sideways. ⚠️ Found by `own-instructions.dom.test.ts`, not by reading: SSR has no layout, and
     this is exactly the class of defect `083` exists for. */
  min-width: 0;
}

/* 🔴 **688 · O1 — the agent's sheet draws this component, and its scoped rules reach none of it.**
   ⛔ `CapabilitiesSheet`'s `.identity-note` and `.sheet-state` are scoped to that sheet: they reach
   this component's ROOT and no element inside it, so every note, *Reading…* and error below was
   drawn in the browser's default ink, size and margins (`685` O1, photographed). ⚑ **Spelled here,
   as `AgentModelChoice` spells them for the same reason**, so both mount sites — the capabilities
   sheet and the sections sheet — draw them in the sheet's own registers. */
.own-instructions h3 {
  margin: 0;
  /* ⚑ The sheet's LABEL register — `.provider-row > span` (*Runs on*) and `.agent-model-label`
     (*Model and effort*), the two sections above this one on the same sheet. */
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-normal);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.identity-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}

/* ⚠️ **Without the sheet's `padding: var(--space-9)`** — that is the whole sheet's loading state; a
   line inside one section is not. `AgentModelChoice`'s `.agent-model-state` made the same cut. */
.sheet-state {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  line-height: 1.5;
}

.sheet-state.err {
  color: var(--danger);
}

.sheet-state .icon {
  width: 14px;
  height: 14px;
  flex: none;
}

.own-instructions-text {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--text);
  resize: vertical;
}

.own-instructions-controls,
.ask-controls {
  display: flex;
  gap: var(--space-3);
}

.asks,
.versions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ask,
.version {
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.ask-who,
.ask-why,
.version-head,
.version-said {
  margin: 0;
  font-size: var(--type-caption);
  /* ⚑ **A reasoning a model wrote has no line breaks in it** — `overflow-wrap` is what makes a
     long one wrap rather than widen the box it is in. */
  overflow-wrap: anywhere;
}

/* ⛔ **`pre-wrap` and its own scroll**, because a person's rules are prose with newlines and a
   pasted operating model is long — and the page body must never scroll sideways. */
.ask-text,
.version-text {
  margin: 0;
  padding: var(--space-2);
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  font: inherit;
  background: var(--code-bg);
  border-radius: var(--radius-sm);
}
</style>
