<script setup lang="ts">
import type {
  InstructionSourceResult,
  RevealResult,
  SessionInstructions as Instructions,
  SessionPathTarget,
} from '../../../shared/runtime-ipc'
import type { ToolRegistry } from '../lib/transcript'
import { SUBJECT_WORDS } from '../lib/what-survives-the-conversation'
import SessionInstructions from './SessionInstructions.vue'

/**
 * 🔴 **The one wide surface `527` §3.3 asks for, and it is the AGENT's side.**
 *
 * ## ⛔ Which of the two opens wide, and the argument
 *
 * ⚑ **The reading is all on this side.** `525` counted it: the 253-character launch scope, four
 * `DocumentBody` mounts — the composed bytes, an agent-memory row, an injected row and a provider
 * file read on request — and a layer list that is never empty. ⛔ **The conversation's side is
 * four label/value rows** (`cwd`, what the provider reports it is running, the pid, the ref), and
 * `356 §1` already ruled on exactly those: *"model, reasoning, process and ref carry a VALUE and no
 * explanation, so there was nothing to move."* ⚠️ **A wide sheet holding four paths would be a
 * surface built for the material that did not need one.**
 *
 * ⚑ **And criterion 24 names this side by name.** *An agent's instructions are legible to him* is
 * about what is in here; nothing in the criterion is about a working directory. The PO's binding
 * half — *"a person reading a transcript who has to leave it to find out what the agent was told
 * has lost the thread"* — is the same sentence with the same subject. 🔴 **So the side the
 * criterion is about is the side that gets the surface the criterion asks for.**
 *
 * ## ⚑ Why a sheet rather than a wider drawer, and why that is not a new screen
 *
 * ⛔ **`525` Q4 closed the cheap door**: the drawer's own `overlay` fit is *"an absolutely
 * positioned, opaque 320 px rail, not the mock's wide modal reader"* — narrower than what it
 * replaces, and unreachable at today's `--app-min-w` anyway. ⚑ **The mock's identity sheet is a
 * full-viewport modal** (`dialog.overlay-shell.wide`) with the rail and the conversation inert
 * underneath it, and this app has had that layer since `067`: `OverlayHost`, which four other
 * sheets on this pane already open on.
 *
 * ⚠️ **It is not a screen, a route or a `place`** (`527` §2.2). Nothing navigates: the pane, the
 * transcript and the drawer stay mounted underneath, Escape or the backdrop closes it, and focus
 * goes back to the index entry that opened it — which is the PO's *"an index entry that opens wide
 * satisfies both."* ⛔ **`the-thread-a-person-does-not-leave.dom.test.ts` asserts that**, because a
 * sentence about not losing the thread is a claim about the DOM.
 *
 * ## 🔴 The width is the mock's number, and it arrives from our own token
 *
 * `525` measured the mock: the identity sheet is `min(780px, 100vw - 440px)` — **740 / 760 / 780
 * px** at 1180 / 1200 / 1440, and AGENT WORKSPACE came out 760 px wide at the 1200 px target.
 *
 * ⚑ **`--lane-clear` is `10 + 200 + 10 = 220px`, so `100% - 2 × --lane-clear` IS `100vw - 440px`.**
 * The two arithmetics are the same one for the same reason: the mock reserves `--sheet-clearance:
 * 220px` and we reserve the band `OverlayHost` draws the emergency stop in (`390`, `444`). ⛔ **So
 * the number is not copied from the drawing — it derives from the token that owns the gutter**, and
 * moving `--lane-w` moves it. `444`'s rule, one sheet over.
 */
const props = defineProps<{
  instructions: Instructions
  /** Read one file the provider reported, on request (356 §2). Passed straight through. */
  onReadInstruction?: (index: number) => Promise<InstructionSourceResult>
  /** Show one of this session's paths in the file manager (356 §1). Passed straight through. */
  onRevealPath?: (target: SessionPathTarget) => Promise<RevealResult>
  /** This conversation's tool registry, for the derived verb count (442 §3.3). Passed straight on. */
  tools?: ToolRegistry | null
  /**
   * ⛔ **Whether this conversation has an EARLIER LIFE whose composition nobody kept** (442 §1).
   *
   * ⚑ **Derived by the PANE from `SessionRecord.liveFrom`** — *"null means this session was never
   * reopened and there is no previous life to leave behind"* — and passed straight on from here.
   * ⚠️ **Not re-derived**: this sheet never sees the record, and a second derivation of one fact is
   * how two answers to it appear. ⛔ Required rather than defaulted, because the default would be
   * the reassuring one.
   */
  relaunched: boolean
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <!-- ⛔ **`data-subject="agent"` on the element that HEADS the sheet**, which is the rail
       `HO-050` §1.1 states: *"what must not happen is one sheet headed with a fact from each."*
       ⚑ The heading below says whose these are and what that MEANS, in the same words the index
       teaches it with — one string, in `what-survives-the-conversation.ts`, so the sheet and the
       index cannot come to disagree. -->
  <section class="agent-sheet" data-cy="agent-sheet" data-subject="agent">
    <div class="sheet-header">
      <div class="sheet-glyph">
        <svg class="icon glyph-icon"><use href="#i-info" /></svg>
      </div>
      <div class="sheet-header-copy">
        <strong data-cy="agent-sheet-title">What this agent was told</strong>
        <!-- ⚠️ **The lifetime, said on the surface and not only in the index.** A person can arrive
             here from the index entry and read nothing else; the one sentence that makes the split
             mean something has to be on both. -->
        <small data-cy="agent-sheet-lifetime">{{ SUBJECT_WORDS.agent.says }}</small>
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

    <!-- ⚑ **The component, mounted rather than inlined** (`527` §3.1). It emitted `<dt>`/`<dd>`
         fragments for `SessionInfo`'s `<dl>` until this dispatch; it has a root of its own now, so
         this sheet holds it the way any other surface would. ⛔ Every prop is passed straight
         through — nothing is re-derived here, because a second derivation is a second answer. -->
    <div class="sheet-body">
      <SessionInstructions
        :instructions="props.instructions"
        :on-read-instruction="props.onReadInstruction"
        :on-reveal-path="props.onRevealPath"
        :tools="props.tools"
        :relaunched="props.relaunched"
      />
    </div>
  </section>
</template>

<style scoped>
/* The sheet shell — copied as declarations from `SessionTools`, never borrowed as class names:
   every style block in this app is scoped, so a shared-looking name matches nothing here.

   🔴 **The width derives from `--lane-clear`, which is the mock's own arithmetic** — see the
   script's note. ⛔ **`min()` and not a flat cap**: below the point where the gutter costs more
   than the cap, the gutter must win, because the thing on the other side of it is the emergency
   stop `OverlayHost` draws on this layer (`390`). */
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
  flex: 0 0 auto;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--muted);
  place-items: center;
}

.glyph-icon {
  width: 16px;
  height: 16px;
}

.sheet-header-copy {
  min-width: 0;
}

.sheet-header-copy strong {
  display: block;
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-bold);
}

.sheet-header-copy small {
  display: block;
  color: var(--muted);
  font-size: var(--type-small);
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

.icon-button:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.icon {
  width: 14px;
  height: 14px;
}

/* ⛔ `min-height: 0` is what lets this scroll instead of growing past the sheet's
   `overflow: hidden` — the same property `SessionTools` names beside its own body. */
.sheet-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: auto;
  padding: var(--space-7) var(--space-9) var(--space-9);
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}
</style>
