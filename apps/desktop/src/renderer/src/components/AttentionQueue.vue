<script setup lang="ts">
import { agoWords } from '../lib/clock'
import type { PermissionDecision, UserInputResponse } from '../../../shared/runtime-ipc'
import {
  permissionOutcomes,
  permissionShortcutFor,
  shortcutFor,
  type AttentionDecision,
  type AttentionRequest,
} from '../lib/attention'
import { LIMIT_WORDS } from '../lib/user-input-offer'
import ConversationRow from './ConversationRow.vue'
import PermissionCard from './PermissionCard.vue'
import QuestionCard from './QuestionCard.vue'

/**
 * **Everything that needs you, in one place** (205, from 195 H3).
 *
 * ⛔ **The rows are `attention.ts`'s projection and this file adds no facts to them.** Every string
 * here comes off an `AttentionRequest`; nothing is derived a second time, so this surface and the
 * card it points at cannot come to describe one request differently.
 *
 * ## ⚠️ Six facts, and the discipline is that there are only six
 *
 * `195` H3: *"They cannot see the requested action, scope, available decisions, age, or an answer
 * control."* So each row says **which conversation · what kind · what is asked · the scope · how
 * long · what is on offer** — and stops. `031`'s rule is the constraint that shapes the whole
 * layout: *a paragraph nobody reads is worse than nothing*, and six rows that each need reading are
 * the same failure. The ask is one line; the scope is lines that wrap only when they must; the age
 * is three words.
 *
 * ## 🔴 481 · *what is on offer* now says what each offer DOES, and that is not a seventh fact
 *
 * ⛔ **HO-030 §2 ruled criterion 20 over every surface a person can answer from**, and the PO's
 * reason was habit rather than coverage: *"An inconsistent explanation is worse than a uniformly
 * absent one, because it trains the reader out of looking."* ⚑ **This surface is the one where
 * that costs most** — it is criterion 17's own, *everything waiting on him in one place*, so a
 * person who clears a backlog from here would meet the press every time and the sentence never.
 *
 * ⚠️ **The sentence belongs to the sixth fact, not beside it.** *What is on offer* was a row of
 * words a person had to already know the meaning of; `Cancel` versus `Deny` is a fact about the
 * ACT — one of them asks the whole turn to stop (⚑ `730`, R81: except a Cancel that cannot, which
 * says only that the request is cancelled) — and `031`'s constraint is satisfied by the
 * consequence being quiet and under the word, not by leaving it out.
 *
 * ⛔ **Nothing here composes it.** {@link whatThisAnswerDoes} is the same call `PersonsQueue`
 * makes; this file still adds no facts to its rows.
 */

const props = withDefaults(
  defineProps<{
    requests: AttentionRequest[]
    /** The clock the ages are measured against — passed so a test can hand it a fixed one. */
    now: number
    /**
     * ⛔ **Whether this queue is the ONLY list in its panel** (305 §1).
     *
     * `"Nothing needs you."` is a claim about the SCREEN, and this component may only make it when
     * it is the whole screen's answer. `304` found it printed above four rows the same screen was
     * drawing — three summaries reading one population while the rows below read the other. The
     * screen decides this from `home-attention.ts`, where every such sentence is settled; the
     * specific half — *"No conversation is frozen on a permission or a question"* — is this
     * queue's own and is said either way.
     *
     * Defaults to `true` so a bare mount is the whole surface, which is what every direct test of
     * this component is.
     */
    alone?: boolean
  }>(),
  { alone: true },
)

const emit = defineEmits<{
  /** Answer without leaving this surface. */
  decide: [request: AttentionRequest, decision: AttentionDecision]
  /** Go to the card itself, where the full disclosure and the richer controls are. */
  open: [request: AttentionRequest]
}>()

/**
 * ⛔ **The age, or the honest absence of one** (086).
 *
 * `at` is null when the fold had no clock — a replayed conversation whose events carried no time,
 * or a synthetic one. It renders as *"no time recorded"*, never as "just now" and never as a zero,
 * because `195`'s *"age"* is the argument for this whole surface and an invented one would undo it.
 */
function age(request: AttentionRequest): string {
  return request.at === null ? 'no time recorded' : agoWords(request.at, props.now)
}
function permission(request: AttentionRequest, decision: PermissionDecision): void {
  const offered = permissionShortcutFor(request.decisions, decision.outcome)
  if (offered) emit('decide', request, offered)
}

function answer(request: AttentionRequest, response: UserInputResponse): void {
  const offered = shortcutFor(request.decisions, response)
  if (offered) emit('decide', request, offered)
}
</script>

<template>
  <div class="attention-live" data-wired="true" data-cy="attention-live">
    <ol v-if="props.requests.length > 0" class="attention-rows">
      <li
        v-for="request in props.requests"
        :key="request.key"
        class="attention-request bb-raised-item"
        :data-cy="`attention-request-${request.sessionId}`"
        :data-kind="request.kind"
      >
        <!-- WHICH conversation, and WHAT KIND — 203's word, not a second reading of it. -->
        <header class="request-head">
          <!-- ⚑ **D-017b · no BEING**: a plate never says whether a provider process runs (`05`
               rule 5) — the need is the fact this row is about. -->
          <ConversationRow
            form="compact"
            id-prefix="attention"
            :row="{
              id: request.key,
              facets: { needing: request.kind },
              plateLabel: request.where,
              head: 'plain',
              title: request.where,
              status: {
                provider: request.provider,
                word: request.standing,
                tail: request.who ? [request.who] : [],
              },
            }"
            :cy="{
              title: 'attention-where',
              provider: 'attention-provider',
              word: 'attention-standing',
              tail: 'attention-who',
            }"
          />
          <!-- HOW LONG it has been waiting. The PM's 63 seconds is why this is on the row. -->
          <span class="request-age" data-cy="attention-age">{{ age(request) }}</span>
        </header>

        <PermissionCard
          v-if="request.card?.kind === 'permission'"
          :item="request.card"
          :own-agent="request.who"
          :provider="request.provider"
          :queue-sent="request.sent"
          :queue-outcomes="permissionOutcomes(request.decisions)"
          compact
          stack-answers
          @decide="(_, decision) => permission(request, decision)"
        />
        <QuestionCard
          v-else-if="request.card?.kind === 'userInput'"
          :item="request.card"
          :own-agent="request.who"
          :path-session-id="request.sessionId"
          :queue-sent="request.sent"
          :queue-offers="request.decisions"
          compact
          fold
          @respond="(_, response) => answer(request, response)"
        />
        <p v-if="request.hasACommander" class="request-warn" data-cy="attention-has-a-commander">
          Another caller — usually an agent — supplied the work this conversation is doing, and can
          send it more. Deciding what that work is allowed to do is yours.
        </p>
        <div class="request-tail">
          <span v-if="request.sent" class="request-limit" data-cy="attention-sent">
            answer sent — waiting for the conversation to settle
          </span>
          <span v-else-if="request.limit" class="request-limit" data-cy="attention-limit">
            {{ LIMIT_WORDS[request.limit] }}
          </span>
          <button
            class="request-open"
            type="button"
            :data-cy="`attention-open-${request.sessionId}`"
            @click="emit('open', request)"
          >
            Open
          </button>
        </div>
      </li>
    </ol>

    <!-- The good state, said out loud rather than left as an empty box (037's rule).

         ⛔ **The headline and the ring are the WHOLE SCREEN's answer, and appear only when it is
         one** (305 §1). Below a labelled group it does not own, this block keeps the sentence it
         can back — no conversation is frozen — and drops the claim it cannot. ⚠️ **And since
         `401` the kept sentence is NARROWED as well as kept**: what this queue can see is the
         conversations this window is running, and there is now a group under it listing ones it
         is not. -->
    <div v-else class="attention-clear" :class="{ inline: !props.alone }" data-cy="attention-clear">
      <template v-if="props.alone">
        <div class="check-ring">
          <svg class="icon"><use href="#i-check" /></svg>
        </div>
        <strong>Nothing needs you.</strong>
        <span>No conversation is frozen on a permission or a question.</span>
      </template>
      <!-- ⛔ **QUALIFIED when this is not the whole answer** (401). The unqualified sentence is a
           claim about every conversation there is, and `401` puts a list of questions escalated
           from conversations this window is NOT running directly underneath it — two adjacent
           sentences, one denying what the other states. ⚑ This one says only what this list can
           see, which is what `alone` has meant since `305` §1. -->
      <span v-else>No conversation on this list is frozen on a permission or a question.</span>
    </div>
  </div>
</template>

<style scoped>
.attention-live {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.attention-rows {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-4);
  list-style: none;
  overflow-y: auto;
}

.request-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.request-age {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.request-warn {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}
.request-tail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.request-open {
  margin-left: auto;
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  font-size: var(--type-caption);
}

.request-limit {
  color: var(--faint);
  font-size: var(--type-caption);
}

.attention-clear {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-7);
  color: var(--text-soft);
  gap: var(--space-2);
  text-align: center;
}

/* One quiet line under a group label, not a centred reassurance panel: the panel below it is not
   empty, so this half of it must not read as the answer to the whole screen. */
.attention-clear.inline {
  flex: 0 0 auto;
  align-items: start;
  padding: 0 var(--space-9) var(--space-5);
  color: var(--faint);
  font-size: var(--type-caption);
  text-align: left;
}

.check-ring {
  display: grid;
  width: 34px;
  height: 34px;
  border: var(--border-width) solid var(--line);
  border-radius: 50%;
  place-items: center;
}
</style>
