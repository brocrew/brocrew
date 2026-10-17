<script setup lang="ts">
import { agoWords } from '../lib/clock'
import type { AttentionDecision, AttentionRequest } from '../lib/attention'
// ⛔ **The words beside and under the buttons have a SECOND surface drawing them** (434) — the
// person's queue settles a row in place — so they live in the module that already owns what a
// request offers. `214 §3`: one fact about a request, written down once.
import {
  LIMIT_WORDS,
  WHAT_COMES_AFTER_IS_NOT_OURS,
  isRefusal,
  whatThisAnswerDoes,
} from '../lib/user-input-offer'
import AgentState from './AgentState.vue'

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
</script>

<template>
  <div class="attention-live" data-wired="true" data-cy="attention-live">
    <ol v-if="props.requests.length > 0" class="attention-rows">
      <li
        v-for="request in props.requests"
        :key="request.key"
        class="attention-request"
        :data-cy="`attention-request-${request.sessionId}`"
        :data-kind="request.kind"
      >
        <!-- WHICH conversation, and WHAT KIND — 203's word, not a second reading of it. -->
        <header class="request-head">
          <!-- ⚑ **D-017b · no BEING**: a plate never says whether a provider process runs (`05`
               rule 5) — the need is the fact this row is about. -->
          <AgentState size="compact" :needing="request.kind" :label="request.where" />
          <div class="request-who">
            <strong data-cy="attention-where">{{ request.where }}</strong>
            <small>
              <span v-if="request.provider" data-cy="attention-provider">{{
                request.provider
              }}</span>
              <span v-if="request.provider"> · </span>
              <span data-cy="attention-standing">{{ request.standing }}</span>
              <!-- 🔴 **714 · R41 — who it runs as, NAMED** (`AttentionRequest.who`); it drew the
                   slug. -->
              <span v-if="request.who" data-cy="attention-who"> · {{ request.who }}</span>
            </small>
          </div>
          <!-- HOW LONG it has been waiting. The PM's 63 seconds is why this is on the row. -->
          <span class="request-age" data-cy="attention-age">{{ age(request) }}</span>
        </header>

        <!-- WHAT IS ASKED. -->
        <p class="request-asked" data-cy="attention-asked">{{ request.asked }}</p>
        <!-- 🔴 725 · R44 — what the model wrote about it, under its agent's name: above the scope
             and never in it. -->
        <p v-if="request.agentSays" class="request-agent" data-cy="attention-agent-reason">
          {{ request.agentSays }}
        </p>

        <!-- THE SCOPE, exactly as the card discloses it (071). -->
        <ul v-if="request.scope.length > 0" class="request-scope" data-cy="attention-scope">
          <li v-for="(line, index) in request.scope" :key="index">{{ line }}</li>
        </ul>

        <!-- ⛔ **The disclosure is short, and this surface says so exactly as the card does** (181).
             Two different facts, never folded into one sentence: the adapter could not represent the
             scope at all, and the scope was whole but bounded. -->
        <p v-if="request.underDisclosed" class="request-warn" data-cy="attention-under-disclosed">
          This request is broader than what is shown — the provider described it in a way BroCrew
          cannot fully represent.
          <!-- 🔴 **487 · no instruction to allow it when nothing here can.** `483`'s own comment
               on this line said it points through a door that still cannot do what it names: on
               the fail-closed shape the card has no Allow either, so the clause below sent a
               person through a door to press a button that is not there. ⚑ It stays on every
               card that CAN be allowed, which is every ordinary one.
               ⚠️ **A template comment is RENDERED into the markup** — see `PermissionCard.vue`'s
               `cannotAllow` — so no retired copy is quoted here. -->
          <template v-if="request.noPositive === null">Open it before you allow it.</template>
        </p>
        <!-- 🔴 **Why nothing here can allow it** (487) — the same sentence the card draws, from the
             same function, because HO-030 §2 rules that a sentence true on one surface and absent
             on another *"trains the reader out of looking"*. -->
        <p v-if="request.noPositive" class="request-warn" data-cy="attention-cannot-allow">
          {{ request.noPositive }}
        </p>
        <p v-if="request.detailOmitted !== null" class="request-warn" data-cy="attention-omitted">
          {{ request.detailOmitted }} more characters of this are not shown here.
        </p>

        <!-- 🔴 **Somebody else can drive the conversation this card came from** (349, HO-006 §4.5).
             ⛔ **Here because THIS is where the decision is made.** Info's *other callers* row
             carries the same fact inside a conversation; a person answering from *Waiting on you* never opens one,
             so without this the one gesture the disclosure is about — *an agent can give this
             conversation work, but not decide what that work is allowed to do* — is performed on a
             surface that never mentions the other caller.
             ⚠️ **A `request-warn`, beside the two disclosure-is-short lines above**, because it
             bounds what this decision means in the same way they do: it is context for an answer,
             not a refusal and not a control. -->
        <p v-if="request.hasACommander" class="request-warn" data-cy="attention-has-a-commander">
          Another caller — usually an agent — supplied the work this conversation is doing, and can
          send it more. Deciding what that work is allowed to do is yours.
        </p>

        <!-- 🔴 **739 · `736` F-6 — why the last answer sent from here did not land, on a request
             that is still waiting**: the host's own sentence, verbatim (since `740`, a failed keep
             of *Always allow* says so). ⛔ The card and the person's queue drew it; this row, the
             one that was pressed, gave its buttons back with nothing said. -->
        <p v-if="request.refused" class="request-warn" data-cy="attention-refused">
          {{ request.refused }}
        </p>

        <!-- THE DECISIONS ON OFFER — only the ones this surface can send correctly.

             ⛔ **Dead the instant one is pressed** (207 M2). They stayed live: Allow took the
             broker slot, the still-enabled Deny came back refused as not-pending, and the row
             disappeared on the decision that was NOT the user's last visible act. `sent` is the
             store's own flag, set before the first await, and both ordinary cards have consumed it
             since 064 — this surface was the one that did not. -->
        <div class="request-actions">
          <button
            v-for="(decision, index) in request.decisions"
            :key="index"
            class="request-decide"
            :class="{ deny: isRefusal(decision) && request.refusesFirst !== true }"
            type="button"
            :disabled="request.sent"
            :data-cy="`attention-decide-${request.sessionId}`"
            @click="emit('decide', request, decision)"
          >
            <strong data-cy="attention-decide-word">{{ decision.label }}</strong>
            <!-- 🔴 **743 · `739` F-1, ruled — the wholesale grant, one click here too, under its own
                 warning** (058; `wideGrantWarning`, the card's words). ⚑ It is never in the
                 positional slots (299 §1: on a Bash card it was once the SECOND button, where a
                 Write card has *Allow for this conversation*): it comes after the row, as on the
                 card, and until `743` this row only said where it was. -->
            <span
              v-if="decision.kind === 'permission' && decision.warns"
              class="request-warns"
              data-cy="attention-wide-warning"
              >{{ decision.warns }}</span
            >
            <!-- 🔴 **481 · criterion 20's third clause, on the surface the Observer exists for.**
                 ⛔ **`whatThisAnswerDoes` and never a word written here**: HO-030 §2's ruling is
                 that a sentence true on one surface and absent on another *"trains the reader out
                 of looking"*, and a second copy of it would be `214` §3 — one fact about a request
                 written down twice, free to drift — on the sentence rather than on the button.
                 ⚑ So this row inherits `478`'s corrected Cancel and its request-aware Approve by
                 reading them, which is the only way it can inherit the next correction too. -->
            <small class="request-effect" data-cy="attention-effect">{{
              whatThisAnswerDoes(decision)
            }}</small>
          </button>

          <!-- 🔴 **The gap, once per row rather than once per button** (434, HO-024 §5.3) — the
               same placement `PersonsQueue` gives it, because it is the same unknown for every
               answer in the row: what the model does next.
               ⛔ **It arrives WITH the effect sentences and could not arrive before them.** Stating
               an immediate effect and stopping is what reads as *nothing else happens*, which is
               the one thing `430` ruled this app may not imply. -->
          <!-- 🔴 **695 · R36 — the provider's marks, in the card's own words** (`whatTheMarksSay`, one
               function for both surfaces): why no grant is here, why Deny leads — and, since 700,
               the provider's own words: its reason for a mark, or (725, R73) its rule. -->
          <p
            v-for="line in request.marksSay ?? []"
            :key="line"
            class="request-after"
            data-cy="attention-mark"
          >
            {{ line }}
          </p>
          <p v-if="request.decisions.length > 0" class="request-after" data-cy="attention-after">
            {{ WHAT_COMES_AFTER_IS_NOT_OURS }}
          </p>

          <div class="request-tail">
            <!-- The row does not vanish on click — the host answers, the fold settles the item and
                 the projection drops it — so the seconds in between say what is happening rather
                 than showing four buttons that do nothing. -->
            <span v-if="request.sent" class="request-limit" data-cy="attention-sent">
              answer sent — waiting for the conversation to settle
            </span>
            <span v-else-if="request.limit" class="request-limit" data-cy="attention-limit">
              {{ LIMIT_WORDS[request.limit] }}
            </span>
            <span class="spacer"></span>
            <button
              class="request-open"
              type="button"
              :data-cy="`attention-open-${request.sessionId}`"
              @click="emit('open', request)"
            >
              Open
            </button>
          </div>
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

.attention-request {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  gap: var(--space-3);
}

.request-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.request-who {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.request-who strong {
  overflow: hidden;
  font-size: var(--type-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-who small {
  color: var(--faint);
  font-size: var(--type-caption);
}

.request-age {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.request-asked {
  margin: 0;
  font-size: var(--type-small);
  line-height: 1.35;
}

.request-agent {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.request-scope {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  margin: 0;
  background: var(--code-bg);
  color: var(--code-text);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  gap: var(--space-1);
  list-style: none;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.request-warn {
  margin: 0;
  color: var(--waiting);
  font-size: var(--type-caption);
}

/* 🔴 **481 · a COLUMN of answers, and the sentence is what made it one.**

   ⛔ **A row of buttons that each carry a sentence is `031`'s paragraph nobody reads**, arrived at
   from the other direction: four side-by-side controls on a panel this width give each sentence a
   column narrow enough to wrap into a block, and a person scanning for a word reads four blocks
   instead. ⚑ Stacked, the word stays the thing you scan and its consequence sits under it — which
   is the shape `PersonsQueue` settled on for the same reason, in this page's own tokens rather than
   its classes. */
.request-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}

/* The two things that are ABOUT the row rather than about an answer — why one click is not enough
   here, or that one is already on its way — and the way to the card. */
.request-tail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.request-tail .spacer {
  flex: 1;
}

.request-decide,
.request-open {
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  font-size: var(--type-caption);
}

.request-decide {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  text-align: left;
}

.request-decide strong {
  color: var(--text);
  font-weight: var(--fw-medium);
}

/* ⚠️ **The consequence is quiet and the word is not.** A person scans the labels; the sentence is
   there for the press they are not sure about. */
.request-effect,
.request-after {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

.request-after {
  margin: 0;
}

/* ⛔ **A refusal is never the loud button** — the same predicate (`isRefusal`) on both surfaces,
   and on the WORD rather than the control, so dimming a refusal does not dim what it does. */
.request-decide.deny strong {
  color: var(--text-soft);
}

/* ⛔ **`color` on the button cannot reach a child that declares its own**, and since `481` both
   children do. The dead state is therefore declared on them: without these two lines a row whose
   answer is already on its way would draw its words exactly as live ones (`207` M2 is the finding
   `:disabled` carries, and it is about what a person can see, not about the attribute). */
.request-decide:disabled {
  cursor: default;
}

/* 🔴 743 · the wholesale grant's warning, inside its button: the card's amber `.warn`, at the size of
   the line under it. */
.request-warns {
  color: var(--waiting);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

.request-decide:disabled strong,
.request-decide:disabled .request-effect {
  color: var(--faint);
}

/* 🔴 743 · and the wholesale grant's warning, with the rest of a pressed button. */
.request-decide:disabled .request-warns {
  color: var(--faint);
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
