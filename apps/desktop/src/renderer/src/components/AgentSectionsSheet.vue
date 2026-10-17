<script setup lang="ts">
import OwnInstructions from './OwnInstructions.vue'
import type { AgentStore } from '../lib/agent-store'
import { SUBJECT_WORDS } from '../lib/what-survives-the-conversation'
import {
  AGENT_SECTIONS,
  SECTION_AT_EACH_DOOR,
  type AgentSection,
  type WhyNot,
} from '../lib/agent-sections'

/**
 * ⛔ **The popup's SECOND door — the one with no conversation behind it** (`EXT-015` §1, `626`).
 *
 * ## ⚑ Why this is a sibling of `AgentInstructionsSheet` and not the same component
 *
 * ⚠️ **`EXT-015` §1 asks for *"the same popup, the same layout"* from two doors, and that sentence
 * cannot be literally true today.** ⛔ `AgentInstructionsSheet` requires an `Instructions` object —
 * the composition taken at a conversation's launch — and it reaches the renderer only on a session
 * record. 🔴 **The Team page has no session**, and the reading it CAN take
 * (`agentInstructions({ profileId })` → `AgentInstructionsReading`) is three fields: `own`,
 * `waiting`, `readAt`.
 *
 * ⚑ **So the layout is shared and the payload is not.** Both doors show the same four sections in
 * the same order, from one vocabulary (`agent-sections.ts`); this one fills the section it can and
 * ⛔ **states the other three rather than hiding them**, which is `626` relay 2 §3.2 and the
 * criterion-18 rule the PO has raised in four consecutive documents.
 *
 * ## ⛔ What this component deliberately does NOT do
 *
 * ⚠️ **It does not re-implement the editor.** `OwnInstructions` already holds the versions, the
 * `broughtBack` revert, the character bound and the empty state, and it takes a slug and reads for
 * itself — ⚑ **so this sheet mounts it and passes nothing but the slug.** 🔴 Re-implementing any of
 * it would be a second answer to a question that already has one.
 *
 * ⚠️ **It composes no sentence of its own for an absent section.** Every one of those lives in
 * {@link SECTION_AT_EACH_DOOR}, so the two doors cannot come to disagree about what is missing and
 * why — the rule `AgentInstructionsSheet` already follows for its lifetime line.
 */
const props = withDefaults(
  defineProps<{
    /** The identity this popup is about — the slug, as every other sheet on this page takes. */
    profileSlug: string
    /** ⚑ What the Team card calls it, so the sheet names the agent a person just clicked. */
    agentName?: string | null
    /** ⚑ **Injectable for tests; the window's one store otherwise** — `OwnInstructions`' own rule. */
    store?: AgentStore
  }>(),
  { agentName: null, store: undefined },
)

const emit = defineEmits<{ close: [] }>()

/** ⚑ This door, named once — every lookup below asks the vocabulary with it. */
const DOOR = 'the-team-page' as const

/** ⛔ Both lists come from the vocabulary, never from the order of blocks in this template. */
function at(section: AgentSection) {
  return SECTION_AT_EACH_DOOR[section].at[DOOR]
}

/**
 * ⚑ **The absent case, narrowed HERE rather than in the template.**
 *
 * ⚠️ **A Vue template cannot narrow a discriminated union across a function call** — `at(s).drawn`
 * in a `v-else-if` does not teach `at(s).why` anything, and `vue-tsc` says so. ⛔ Returning the
 * narrowed shape (or `null`) moves the discrimination into TypeScript, where it is checked, instead
 * of asserting it away with a cast.
 */
function absentAt(section: AgentSection): { readonly why: WhyNot; readonly says: string } | null {
  const declared = at(section)
  return declared.drawn ? null : { why: declared.why, says: declared.says }
}

function heading(section: AgentSection): string {
  return SECTION_AT_EACH_DOOR[section].heading
}
</script>

<template>
  <!-- ⛔ **`data-subject="agent"`, and here it is the whole truth rather than half of it**: nothing
       on this sheet belongs to a conversation, because there is no conversation to belong to. -->
  <section class="agent-sheet" data-cy="agent-sections-sheet" data-subject="agent">
    <div class="sheet-header">
      <div class="sheet-glyph">
        <svg class="icon glyph-icon"><use href="#i-info" /></svg>
      </div>
      <div class="sheet-header-copy">
        <!-- ⚠️ **NOT *"What this agent was told"***, which is the conversation door's title and
             would be false here: nothing has been told, because nothing has been launched. ⚑ What
             a person is looking at is what WOULD shape it. -->
        <strong data-cy="agent-sections-title">What shapes this agent</strong>
        <small data-cy="agent-sections-lifetime">{{ SUBJECT_WORDS.agent.says }}</small>
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
      <p class="who" data-cy="agent-sections-who">
        {{ agentName ?? profileSlug }}
      </p>

      <!-- ⛔ **Every section, in the vocabulary's order, drawn or accounted for** — never filtered.
           ⚑ `v-for` over `AGENT_SECTIONS` rather than four hand-written blocks, so a fifth member
           appears here the day somebody adds it instead of the day somebody remembers to. -->
      <section
        v-for="section in AGENT_SECTIONS"
        :key="section"
        class="agent-section"
        :data-cy="`agent-section-${section}`"
        :data-drawn="at(section).drawn"
      >
        <h3>{{ heading(section) }}</h3>

        <!-- ⚑ The one section this door can fill. `OwnInstructions` reads for itself from the
             slug, so nothing is threaded through here and nothing is re-derived. -->
        <OwnInstructions
          v-if="section === 'your-instructions'"
          :profile-slug="props.profileSlug"
          :store="props.store"
          :heading="null"
        />

        <!-- 🔴 **The absent ones SAY what they are**, and the two reasons are drawn differently
             because they are not the same fact: `not-here` will never be here, `not-yet` is a
             thing this build cannot reach. ⛔ A person who cannot tell those apart cannot tell
             whether to wait. -->
        <p
          v-else-if="absentAt(section) !== null"
          class="absent"
          :class="absentAt(section)!.why"
          :data-cy="`agent-section-absent-${section}`"
          :data-why="absentAt(section)!.why"
        >
          {{ absentAt(section)!.says }}
        </p>
      </section>
    </div>
  </section>
</template>

<style scoped>
/* The sheet shell — copied as declarations from `AgentInstructionsSheet`, never borrowed as class
   names: every style block in this app is scoped, so a shared-looking name matches nothing here.
   ⛔ The width arithmetic is that sheet's and is argued there. */
.agent-sheet {
  display: flex;
  width: min(780px, calc(100% - 2 * var(--lane-clear)));
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
  gap: var(--space-5);
}

.sheet-glyph {
  display: grid;
  width: 34px;
  height: 34px;
  align-content: center;
  justify-content: center;
  border-radius: var(--radius-md);
  /* ⛔ **`--panel-2`, which is what EVERY other `.sheet-glyph` in this app uses** — all eight of
     them, `AgentInstructionsSheet.vue:163` included, and that one is the twin door this sheet
     stands beside with byte-identical glyph markup.
     ⚠️ **`626` wrote `--accent-soft`, a token this app never declares**, so the tile painted
     nothing; `css-tokens.test.mjs` caught it on the first full gate. ⛔ **The first repair was
     `--accent-fill` and that was wrong too** — its commit claimed the value was read off the
     sibling sheets when they say `--panel-2`, which is a provenance asserted and not followed. ⚑ `--accent-fill` is the ACTIVE-rail fill and appears at
     twenty-five sites, none of them a glyph tile. */
  background: var(--panel-2);
}

.glyph-icon {
  color: var(--accent);
}

.sheet-header-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
}

.sheet-header-copy small {
  color: var(--faint);
}

.spacer {
  flex: 1 1 auto;
}

.sheet-body {
  display: flex;
  overflow-y: auto;
  flex: 1 1 auto;
  flex-direction: column;
  padding: var(--space-7) var(--space-9) var(--space-9);
  gap: var(--space-7);
}

.who {
  margin: 0;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-small);
}

.agent-section {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-6);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-4);
}

.agent-section:first-of-type {
  padding-top: 0;
  border-top: 0;
}

.agent-section h3 {
  margin: 0;
  font-size: var(--type-small);
}

/* ⚠️ **Quiet, but never invisible.** A sentence a person is meant to read to the end is not a
   placeholder, and `--faint` is the register this app already uses for *this is true and it is not
   the point*. */
.absent {
  margin: 0;
  color: var(--faint);
}

/* ⛔ **`not-yet` is marked and `not-here` is not**, which is the one visual difference between them:
   a thing that is coming gets the register this app uses for an incomplete fact; a thing that will
   never be here is simply a sentence. */
.absent.not-yet {
  padding-left: var(--space-5);
  border-left: var(--border-accent-width) solid var(--line-strong);
}
</style>
