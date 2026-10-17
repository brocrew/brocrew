"""536 · The memories that are not on the tab any more.

🔴 **the person:** *"we used to see the 'memories' as well if I am not mistaken, now they're gone?"*

## ⛔ §0's answer, because these rows only make sense once it is settled

⚑ **Nothing ever took memory off this surface.** `671484ab` (`165`) drew the agent's own store the
day the field existed, `a3dc55c6` (`317`) turned it into the whole store with a reach word per
file, and every line of that is still drawn at `fca3f3c9`. ⚠️ **What moved is the BLOCK**:
`14d0c62f` (`527`) took `SessionInstructions` off the Info tab and put it on a sheet one press
behind *What this agent was told*.

⛔ **What has NEVER existed is a word for the state a fresh identity is in.** Every version of the
panel since `165` draws memory with a `v-for` over `agentMemory` and a `v-if` on its length, and
`442` added the layer row with the same guard — so a store with no files produced no row, no layer
and no sentence. 🔴 **The sheet named four layers of the prompt and was silent about the fifth**,
which is the account reading as complete when it is not. ⚑ **That is the common case**: a fresh
identity has written nothing, which is the state most identities are in most of the time.

## ⚠️ What this table is mostly about, and it is not the boolean

⛔ **Two of the six rows are about NOT SAYING SOMETHING FALSE**, because that is the direction this
repair can go wrong in a way that reads as a better sentence:

 1. **Claiming the agent wrote nothing.** `314` §3 measured an unreadable index and a dangling link
    both producing an empty `agentMemory` while the agent had written plenty. ⛔ M5 plants exactly
    that sentence and requires the word census to see it.
 2. **Claiming nothing reached the model.** Same measurement, the other clause: on a dangling link
    the provider's own `stat` had been reading the target until the machine rebooted. ⛔ This app
    can speak for its own read and for nothing else.

## 🔴 And one row is about the premise the whole repair rests on

⛔ **M6.** The composition block is the ONE thing this component draws unconditionally (`442`), and
that is why an absence may be stated inside it at all. ⚠️ Put it behind `anything` and the sentence
vanishes for precisely the identity it was written for — an identity that has been told nothing.

## ⛔ What this table does NOT cover

 1. **The rows.** `165`, `317` and `322` own the store's file rows and their reach words; nothing
    here edits one. ⚑ Rule 2 — *nothing where nothing was injected* — is untouched by this
    dispatch and M3 is the row that proves it.
 2. **The move.** `527` put the block on a sheet and `536` did not move it back. The index entry
    that names memory is asserted in
    `the-memory-a-fresh-identity-does-not-have.dom.test.ts` §4 and is `527`'s ground, not this
    table's.
 3. **`provider-discovered`'s silence.** It is the third conditional layer and it states no
    absence. ⛔ Reported as a finding rather than built — a third sentence on a fresh identity is
    the *four headings* answer `536` §3 forbids.
"""

SHARED = "apps/desktop/src/shared/told.ts"
VIEW = "apps/desktop/src/renderer/src/lib/told.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
# ⚑ **583 · the group that carries the absence, and the gate that decides it is drawn** — see M6.
GROUPS = "apps/desktop/src/renderer/src/lib/whose-groups.ts"

MUTATIONS = [
    # ---- the shipped silence, put back -----------------------------------------------------------
    (
        "M1 · 🔴 THE SHIPPED SILENCE, PUT BACK · the view stops stating the absence, so a fresh "
        "identity's sheet names four layers of the prompt and says nothing about the fifth. ⛔ This "
        "is what the person opened on a clean base, and `536` §0's whole finding",
        [
            (
                VIEW,
                "    remembers: memory.length === 0 ? TOLD_REMEMBERS_NOTHING : null,\n",
                "    remembers: null,\n",
            )
        ],
    ),
    # ---- the guard, both directions --------------------------------------------------------------
    (
        "M2 · ⛔ the absence is stated on every conversation, including the ones that HAVE a store "
        "— a reader with three memory files told they have none, beside the layer that lists them",
        [
            (
                VIEW,
                "    remembers: memory.length === 0 ? TOLD_REMEMBERS_NOTHING : null,\n",
                "    remembers: TOLD_REMEMBERS_NOTHING,\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ the panel draws the element unconditionally, so a session with a store gets an "
        "EMPTY italic line where the sentence was. ⛔ The `v-if` is the only thing standing between "
        "this and `086`'s rule in the other direction — a feature announced by its absence",
        [
            (
                PANEL,
                '        <div v-if="told.remembers" class="muted absent" data-cy="told-remembers-nothing">\n',
                '        <div class="muted absent" data-cy="told-remembers-nothing">\n',
            )
        ],
    ),
    (
        "M4 · ⛔ the sentence is computed and never drawn — the view is right, the surface is silent, "
        "and nothing but a mounted assertion can tell the two apart (`brobot2-ssr-tests-pass-vacuously`)",
        [
            (
                PANEL,
                # ⚑ **583 · the sentence is on the `the agent's own` tab now** (standing rule 27),
                # at a new indentation. ⛔ The defect is unchanged and so is what only a mounted
                # assertion can tell apart: the view computes it and the surface says nothing.
                '          <div v-if="told.remembers" class="muted absent" data-cy="told-remembers-nothing">\n'
                "            {{ told.remembers }}\n"
                "          </div>\n",
                "",
            )
        ],
    ),
    # ---- the two rows about not saying something false --------------------------------------------
    (
        "M5 · 🔴 the sentence claims the AGENT wrote nothing, which `314` §3 measured false: an "
        "unreadable index and a dangling link both empty `agentMemory` while the agent had written "
        "plenty. ⛔ It reads as the better sentence, which is why it needs a census and not a reader",
        [
            (
                SHARED,
                "  'No memory of this agent’s own is shown here — BroCrew read none from its store. That store is ' +\n",
                "  'No memory of this agent’s own is shown here — it has written nothing down. That store is ' +\n",
            )
        ],
    ),
    (
        "M6 · ⛔ the whole composition block goes behind `anything`, so the account of the prompt "
        "disappears for an identity that has been told nothing — the one identity every sentence in "
        "it was written for. ⚑ `442` draws this block unconditionally and that is the premise the "
        "absence rests on",
        [
            (
                # ⚑ **583 · the premise moved and the row asks the same question** (standing rule 27).
                # ⛔ `442`'s unconditional composition block became a TAB STRIP, and the sentence this
                # table is about moved with it into `the agent's own` group — which is drawn whether
                # or not it has rows, for exactly this reason. ⚠️ So the mutation is the same one:
                # gate the group that carries the absence on having something in it, and the absence
                # vanishes for the identity every sentence in it was written for.
                GROUPS,
                "      drawn: whose === 'configured' || whose === 'learned' || mine.length > 0 || held.length > 0,\n",
                "      drawn: whose === 'configured' || mine.length > 0 || held.length > 0,\n",
            )
        ],
    ),
]
