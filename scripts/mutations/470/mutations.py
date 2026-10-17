"""470 · A grant that waits for the next launch — the disclosure HO-028 §3 ruled, and its offer.

⛔ **What this table is about.** `460` F2 measured a real boundary: **a session launched with empty
`canSpawn` can retain its provider-native delegation path after a person widens the managed
grant**, so for the life of that provider handle two delegation paths overlap. ⚑ The PO ruled the
BEHAVIOUR correct and the silence wrong:

> ⚑ *"The grant change applies when the conversation next starts, and the app discloses that
> plainly."* ⛔ Not always-disabled, not reconfigure-live, **not an automatic restart** — *"that
> destroys in-flight work to apply a setting."* ⚠️ *"Offer the person a relaunch if they want it
> applied now — their press, never ours."*

🔴 **And the failure mode is named in the ruling itself**: *"Disclosed, it is a boundary.
Undisclosed, it is the F4 substitution hole reopening quietly."* ⛔ So every row below makes the
disclosure quieter, wronger, or wider than the fact it discloses.

## 🔴 The shape of the disclosure, because it is what most of these rows attack

⚑ **The sentence is a FIELD of the grant** — `CapabilityField.whenItTakesEffect` — rather than a
constant beside it. ⛔ `464`'s finding was that every person-facing sentence about `canSpawn` named
the grant with a LITERAL, so `456`'s rename left one of them pointing at the field one row down.
⚠️ A sentence declared inside the entry it is about cannot do that: the key is the data structure.
🔴 `M5` is `464`'s defect rebuilt by hand, and `M1`-`M7` are the sentence taken apart clause by
clause.

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M7`, `M18`-`M20`, `M22` | ⚑ **`apps/desktop/test/a-grant-that-waits-for-the-next-launch.test.ts`** |
| `M8`-`M17`, `M23`-`M27` | ⚑ **`apps/desktop/test/dom/a-grant-that-waits-for-the-next-launch.dom.test.ts`** |
| `M21` | ⚑ **`apps/desktop/test/dom/sign-in-superseded.dom.test.ts`** — the surface `149` built, still reading the table this dispatch moved |
| `M28`-`M33` | ⚑ **`apps/desktop/test/dom/a-grant-that-waits-for-the-next-launch.dom.test.ts`** §3-§4 — every one a defect review found in this dispatch's own first version |
| `M34`, `M35` | ⚑ **`apps/desktop/test/a-grant-that-waits-for-the-next-launch.test.ts`** §3 — `RuntimeScreen` is the component nothing mounts, so a source census is the only gate it has |
| `M36` | ⚑ **`scripts/test/capabilities-probe-reach.test.mjs`** — the cheap gate that holds the live probe |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row on `nativeDelegationContext`, `admitSpawn` or either launch object.** `470` changed no
rail and no launch: the behaviour was already what HO-028 §3 ruled it should be, which is why the
dispatch is ui-dev's. ⚑ `408`'s own table owns that predicate and
`only-the-delegating-tiers.test.ts` is its gate; a row here would be a second table pinning one
rule.

⚠️ **No row on `spawn-safety.ts`' three switch sentences.** They are a different liveness rule on
an adjacent surface — the app-wide stop DOES apply to a running conversation's governed rail — and
`464` F2 already records that they carry a retired verb. ⛔ `470` owns neither string.

⚠️ **No row making `openAs` non-empty in the DOM fixture.** That is the test's own premise, and a
mutation there measures the fixture rather than the sheet.
"""

from __future__ import annotations

CAPS = "apps/desktop/src/shared/capabilities.ts"
SHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"
REOPENING = "apps/desktop/src/renderer/src/lib/reopening.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
REACH = "scripts/test/capabilities-probe-reach.test.mjs"

SAID = (
    "    whenItTakesEffect:\n"
    "      'This app’s own rail reads this grant each time an agent asks, so what it allows "
    "changes as ' +\n"
    "      'soon as you save. Provider-native delegation is decided when a conversation starts "
    "and is ' +\n"
    "      'not touched again while it runs, so a conversation that is already open keeps the ' +\n"
    "      'delegation it launched with until it is reopened.',\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the sentence, taken apart clause by clause ────────────────────────────────────────
    (
        "M1 · 🔴 THE STATE BEFORE THIS DISPATCH: the grant declares nothing about when a change "
        "lands · this is `main` as HO-028 §3 found it — the rail moves now, the provider's own "
        "door waits for the next launch, and the sheet says neither. ⛔ *Undisclosed, it is the F4 "
        "substitution hole reopening quietly*",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the disclosure rule
        # moved onto canWriteRules, the one field with a sentence. Re-verified RED alone.
        [
            (CAPS, "    whenItTakesEffect:\n      'A conversation reads this when it starts, so one already running keeps what it was told. Narrowing it stops new requests and never removes rules that are already saved — take those away on the agent they were written for.',\n", '    whenItTakesEffect: null,\n'),
        ],
    ),
    (
        "M2 · ⛔ the IMMEDIATE half goes · the sentence keeps only *provider-native delegation is "
        "decided when a conversation starts*, so a person reads *this takes effect at the next "
        "launch* full stop — which is FALSE of the rail `460` measured reading the durable row on "
        "every call, and would send somebody to reopen a conversation that needed nothing",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the now-half
        # survives on canWriteRules' sentence. Re-verified RED alone.
        [
            (CAPS, 'Narrowing it stops new requests and never removes rules', 'Narrowing it never removes rules'),
        ],
    ),
    (
        "M3 · ⛔ the WAITING half goes · the sentence keeps only the rail's clock, so a person "
        "reads *this takes effect now* — the other half of the same falsehood, and the direction "
        "that leaves two delegation paths open with the surface saying one",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the waiting half
        # survives on canWriteRules' sentence. Re-verified RED alone.
        [
            (CAPS, "      'A conversation reads this when it starts, so one already running keeps what it was told. Narrowing", "      'Narrowing"),
        ],
    ),
    (
        "M4 · ⚠️ a SECOND grant claims a launch boundary it does not have · `maxDepth` is read by "
        "the spawn rails on the call they refuse and by nothing at launch, so a sentence here "
        "would shout at a person changing a grant it does not affect — HO-028 §3: *the disclosure "
        "should not shout*",
        # ⚑ Landing D-014 · re-anchored in place, not retired — maxDepth survives and only its
        # default moved (`ruled: 2` → `ruled: 6`, D-014 'depth limit 6'). The rule that only a grant
        # read at launch speaks is still pinned by
        # `expect(speaking.map(...)).toEqual(['canWriteRules'])`. Re-verified RED alone.
        [
            (CAPS, '    ruled: 6,\n    narrowest: 0,\n    whenItTakesEffect: null,\n', "    ruled: 6,\n    narrowest: 0,\n    whenItTakesEffect:\n      'A conversation reads this when it starts, so one already running keeps the depth it was told until it is reopened.',\n"),
        ],
    ),
    (
        "M5 · 🔴 `464`'S DEFECT, REBUILT BY HAND: the sentence names the grant with a literal · "
        "*May add new agents* is `canCreateAgents`' label, and a sentence about `canSpawn` "
        "carrying it is exactly what `456`'s rename left behind — a disclosure pointing at the "
        "field one row down",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the label sweep
        # survives over canWriteRules' sentence. Re-verified RED alone.
        [
            (CAPS, "take those away on the agent they were written for.',", "take those away with May add new agents on the agent they were written for.',"),
        ],
    ),
    (
        "M6 · ⛔ the sentence promises the running conversation is TOLD · `setCapabilities` writes "
        "the row and the renderer and enqueues nothing (`460` F3, unclosed), so this is a claim "
        "about a decision nobody has made — the dispatch's §3 forbids it by name",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the no-telling rule
        # lives on canWriteRules' sentence. ⚠️ D-014 dropped `told` from the test's regex, so *is
        # told* would now evade it; the row plants *tells*. Re-verified RED alone.
        [
            (CAPS, "take those away on the agent they were written for.',", "take those away on the agent they were written for. This app tells a conversation already running as soon as you save.',"),
        ],
    ),
    (
        "M7 · ⚠️ a second word for one gesture · *relaunched* where the app says *reopened* — "
        "`470` measured that `relaunch` is rendered nowhere in this app before writing a control, "
        "and the first one would be `099`/`064` on the word a person has to find on a button",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the no-relaunch
        # rule sweeps canWriteRules' sentence. Re-verified RED alone.
        [
            (CAPS, "take those away on the agent they were written for.',", "take those away on the agent they were written for, and relaunch a conversation to apply it now.',"),
        ],
    ),
    # ── §2 · the sheet: where it is drawn, and where it deliberately is not ─────────────────────
    (
        "M8 · 🔴 the sentence is drawn on EVERY control · the `v-if` on the field's own "
        "declaration goes, so a person changing *May message* or *Deepest chain* reads a "
        "disclosure about provider-native delegation that is false of both",
        [
            (
                SHEET,
                '        <p\n          v-if="field.whenItTakesEffect"\n          class="identity-note"\n',
                '        <p\n          v-if="true"\n          class="identity-note"\n',
            )
        ],
    ),
    (
        "M9 · ⛔ the offer is drawn with nothing to offer · the emptiness check goes, so a sheet "
        "opened on an identity with no conversation open draws a heading and an empty list — a "
        "surface implying a working state it does not have (009)",
        [
            (
                SHEET,
                '          v-if="field.whenItTakesEffect && props.openAs.length > 0"\n',
                '          v-if="field.whenItTakesEffect"\n',
            )
        ],
    ),
    (
        "M10 · ⛔ the offer appears under every grant · the declaration check goes and only the "
        "list matters, so a person is offered a reopen to apply a change to *May interrupt or "
        "end*, which reaches a running conversation the moment it is saved",
        [
            (
                SHEET,
                '          v-if="field.whenItTakesEffect && props.openAs.length > 0"\n',
                '          v-if="props.openAs.length > 0"\n',
            )
        ],
    ),
    (
        "M11 · 🔴 every button asks for the FIRST conversation · the press carries the head of the "
        "list instead of the row it is in, so a person with two conversations open reopens the "
        "wrong one and the one they meant keeps the delegation it launched with",
        [
            (
                SHEET,
                '                @click="emit(\'reopen\', one.sessionId)"\n',
                '                @click="emit(\'reopen\', props.openAs[0]?.sessionId ?? \'\')"\n',
            )
        ],
    ),
    (
        "M12 · 🔴 the button is live over a conversation holding work · `149`'s rule goes and a "
        "press ends a running turn or terminally settles an open card to apply a setting — which "
        "is the automatic restart HO-028 §3 refused, one press away. ⚠️ **Re-anchored by `516`**, which widened the sheet's unsaved-edit guard from `moved` (the capability FIELDS) to `anythingMoved` (those plus the external-server grants, which are rows in another table and not a `CapabilityField`) — standing rule 20's shape, and the DEFECT this row names is unchanged",
        [
            (
                SHEET,
                '                :disabled="one.heldBy !== null || one.busy || anythingMoved"\n',
                '                :disabled="one.busy || anythingMoved"\n',
            )
        ],
    ),
    (
        "M13 · ⚠️ the double-click guard goes · a second press while the first close is still in "
        "flight, which is the guard `canReopenSignIn` spends `busy` on for the same reason. ⚠️ **Re-anchored by `516`**, which widened the sheet's unsaved-edit guard from `moved` (the capability FIELDS) to `anythingMoved` (those plus the external-server grants, which are rows in another table and not a `CapabilityField`) — standing rule 20's shape, and the DEFECT this row names is unchanged",
        [
            (
                SHEET,
                '                :disabled="one.heldBy !== null || one.busy || anythingMoved"\n',
                '                :disabled="one.heldBy !== null || anythingMoved"\n',
            )
        ],
    ),
    (
        "M14 · ⛔ every row says what reopening COSTS, even the ones that cannot be reopened · a "
        "dead button beside a sentence about what pressing it would keep and lose, with nothing "
        "saying what it is waiting for — 106: a control that cannot act must say what would let it. ⚠️ **Re-anchored by `516`**, which widened the sheet's unsaved-edit guard from `moved` (the capability FIELDS) to `anythingMoved` (those plus the external-server grants, which are rows in another table and not a `CapabilityField`) — standing rule 20's shape, and the DEFECT this row names is unchanged",
        [
            (
                SHEET,
                # ⚠️ **672 · re-anchored** — `reopeningSays` took the row's ARM (`ReopenArm`: the
                # draft was kept only for the selected conversation); the defect this row names is unchanged.
                # ⚑ **678 · re-anchored back** — R26 keeps every row's draft, so the arm is gone again.
                "              {{ anythingMoved ? SAVE_FIRST : reopeningSays(one.heldBy) + actThere(one) }}\n",
                "              {{ anythingMoved ? SAVE_FIRST : reopeningSays(null) + actThere(one) }}\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ a conversation this app holds no path for draws an empty row · the fallback to "
        "the session id goes, so the one row a person cannot identify is the one with no name at "
        "all beside a live Reopen button",
        [
            (
                SHEET,
                '              <span class="reopen-where">{{ one.where ?? one.sessionId }}</span>\n',
                '              <span class="reopen-where">{{ one.where }}</span>\n',
            )
        ],
    ),
    (
        "M16 · ⚠️ the offer stops saying WHOSE conversations these are · `464` spent a dispatch on "
        "the owner axis — *this is `pm`'s own row* — and a list of conversations that named no "
        "identity would be the same ambiguity arriving one paragraph later",
        [
            (
                SHEET,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R41 (`707` GAP-5): the offer names the identity
                # (`called`) where it printed the slug in <code>; the defect planted is unchanged.
                "            Open as {{ called }} in this window. Reopening one gives it what this row says now.\n",
                "            Open in this window. Reopening one gives it what this row says now.\n",
            )
        ],
    ),
    (
        "M17 · ⛔ a folder name pushes the sheet out of the window · a flex item's automatic "
        "minimum size is its content unless its overflow is hidden, so an arbitrary basename "
        "widens the row past `335`'s `min(660px, 92vw)` and the button after it leaves the sheet. "
        "⚑ THIS ROW SURVIVED against `min-width: 0` — the two declarations do one job, and a rule "
        "written twice is a rule no mutation can kill; the redundant one was removed",
        [
            (
                SHEET,
                ".reopen-where {\n  overflow: hidden;\n",
                ".reopen-where {\n",
            )
        ],
    ),
    # ── §3 · one rule and one table, read by both surfaces ──────────────────────────────────────
    (
        "M18 · 🔴 the offer is about every open conversation, not this identity's · the filter "
        "goes, so a person is offered a reopen for somebody else's conversation on a sheet that "
        "says every grant on it belongs to one identity",
        [
            (
                REOPENING,
                "      return ran !== undefined && foldProfileName(ran) === wanted\n",
                "      return ran !== undefined\n",
            )
        ],
    ),
    (
        "M19 · ⛔ the waiting sentence goes back to its old deixis · *Answer the question ABOVE "
        "first* is true of a bar bolted to one conversation and false of a row in a list of them "
        "— the one thing `470` had to move to make `149`'s table serve two surfaces",
        [
            (
                REOPENING,
                "  question: 'It has a question waiting. Answer that first — reopening now would close it.',\n",
                "  question: 'Answer the question above first — reopening now would close it.',\n",
            )
        ],
    ),
    (
        "M20 · ⛔ the cost sentence stops naming what a reopen LOSES · `149` measured this — "
        "session grants and a queued message's intent do not survive — and *"
        "nothing here is lost* is the sentence it replaced for claiming more than happened (086)",
                # ⚠️ **Anchor corrected at `656`, not retired.** ⛔ That dispatch added the one cost
                # the sentence had never named — work left running in the background — so the
                # three-line literal this row quoted stopped existing while its SUBJECT did not:
                # *the cost sentence names what a reopen loses*. ⚑ **The replacement is unchanged**,
                # and it now strips four costs rather than three. `470` is `unrun`, so no verdict is
                # inherited; re-verified RED by hand (`correct-a-stale-mutation-anchor-dont-retire-it`).
                # ⚑ **678 · corrected again, the replacement unchanged in kind** — R26 added *"or
                # attached"* and the three lines re-wrapped; the row still strips every cost.
                # ⚑ **741 · corrected again, the replacement unchanged in kind** — R99 (corrected) added
                # *"leaves plan mode"* and the lines re-wrapped; the row still strips every cost.
                # ⚑ **739 · corrected again, the replacement unchanged in kind** — `736` F-1's kept
                # grant is now told (*"and what you chose to always allow stays where it was kept"*);
                # the row still keeps what is kept and strips every cost.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The full cost sentence
        # the row protects is unchanged in kind — still naming what a reopen forgets/resets — only
        # its last clause was reworded by D-017 R2 from 'a message waiting to be sent comes back as
        # text for you to send again' to 'is sent once it has reopened', since a reopen now starts
        # the conversation and hands over held messages rather than returning them as text.
        [
            # ⚑ **always allow that recurs · re-anchored in place, not retired** — the cost sentence names the conversation grant by its button's words; the plant still keeps what is kept and strips every cost
            (REOPENING, "  free:\n    'Reopening keeps the transcript and whatever you have typed or attached, and what you chose to ' +\n    'always allow stays where it was kept. It forgets its ' +\n    '“Allow for this conversation” approvals, leaves plan mode and stops anything still ' +\n    'running in the background, and a message waiting to be sent is sent once it has reopened.',\n", "  free:\n    'Reopening keeps the transcript and whatever you have typed or attached, and what you chose to ' +\n    'always allow stays where it was kept.',\n"),
        ],
    ),
    (
        "M21 · ⚠️ the open-conversation guard stops holding a RUNNING turn back · only the waiting "
        "card arm survives, so the button is live mid-turn on both surfaces at once — which is "
        "what moving the rule into one module means when the rule is wrong",
        [
            (
                REOPENING,
                "  if (!state.ended && state.status !== 'idle') return 'turn'\n",
                "  if (false) return 'turn'\n",
            )
        ],
    ),
    (
        "M22 · 🔴 the sign-in bar goes back to its own copy of the cost · one fact, two authors, "
        "two surfaces — `464` F3's class (*a grant's LABEL is derived by three readers; a grant's "
        "SENTENCES are all literals*) rebuilt on the sentence this dispatch un-forked",
        [
            (
                PANE,
                # ⚠️ **672 · re-anchored** — the bar passed its ARM, the selected conversation's by
                # construction; the second copy of the cost this row plants is unchanged.
                # ⚑ **678 · re-anchored back** — R26: one sentence for every conversation again.
                "const signInBarCost = computed(() => reopeningSays(signInHeldBy.value))",
                "const signInBarCost = computed(() =>\n"
                "  signInHeldBy.value === null\n"
                "    ? 'Reopening keeps the transcript and whatever you have typed.'\n"
                "    : 'Not now.',\n"
                ")",
            )
        ],
    ),
    # ── §5 · the sheet's own state, because the offer is the first control here that ACTS ──────
    (
        "M23 · 🔴 the Reopen is live over an unsaved tick · a press hands the conversation the row "
        "AS STORED, which is the opposite of what is on the person's screen — and it is the "
        "conversation they were trying to fix. ⛔ The one hazard this control can cause, and the "
        "reason the sheet tracks WHICH fields were moved rather than a boolean. ⚠️ **Re-anchored by `516`**, which widened the sheet's unsaved-edit guard from `moved` (the capability FIELDS) to `anythingMoved` (those plus the external-server grants, which are rows in another table and not a `CapabilityField`) — standing rule 20's shape, and the DEFECT this row names is unchanged",
        [
            (
                SHEET,
                '                :disabled="one.heldBy !== null || one.busy || anythingMoved"\n',
                '                :disabled="one.heldBy !== null || one.busy"\n',
            )
        ],
    ),
    (
        "M24 · ⛔ the sheet closes over a successful save and takes the offer with it · the remedy "
        "stops existing at exactly the moment it starts being true — which is the argument the "
        "file already makes one line up about a refusal, on the other outcome",
        [
            (
                SHEET,
                "  if (waited && props.openAs.length > 0) return\n",
                "",
            )
        ],
    ),
    (
        "M25 · ⚠️ the sheet stays open after EVERY save · a person who changed a number is held on "
        "a surface offering to reopen a conversation for a grant they did not touch — HO-028 §3: "
        "*the disclosure should not shout at a person changing a grant it does not affect*. ⚠️ **Re-anchored by `516`**, which widened the sheet's unsaved-edit guard from `moved` (the capability FIELDS) to `anythingMoved` (those plus the external-server grants, which are rows in another table and not a `CapabilityField`) — standing rule 20's shape, and the DEFECT this row names is unchanged",
        [
            (
                SHEET,
                "    props.fields.some((field) => field.whenItTakesEffect !== null && applied.includes(field.key)) ||\n",
                "    props.fields.some((field) => field.whenItTakesEffect !== null) ||\n",
            )
        ],
    ),
    (
        "M26 · ⛔ the edits are never marked as landed · the watch that fills the controls keys on "
        "the row's IDENTITY and a save does not change that, so nothing else clears this — the "
        "Reopen stays dead after the very save it was waiting for",
        [
            (
                SHEET,
                "  Object.assign(seeded, sent)\n  // 🔴 **470 · …and it stays open when the save left a conversation behind.**",
                "  // 🔴 **470 · …and it stays open when the save left a conversation behind.**",
            )
        ],
    ),
    (
        "M27 · ⚠️ the dead button says what reopening COSTS instead of what would let it act · "
        "`106`: a control that cannot act must say what would let it, and the cost of a press that "
        "cannot happen is not that. ⚠️ **Re-anchored by `516`**, which widened the sheet's unsaved-edit guard from `moved` (the capability FIELDS) to `anythingMoved` (those plus the external-server grants, which are rows in another table and not a `CapabilityField`) — standing rule 20's shape, and the DEFECT this row names is unchanged",
        [
            (
                SHEET,
                # ⚠️ **672 · re-anchored** — `reopeningSays` took the row's ARM (`ReopenArm`: the
                # draft was kept only for the selected conversation); the defect this row names is unchanged.
                # ⚑ **678 · re-anchored back** — R26 keeps every row's draft, so the arm is gone again.
                "              {{ anythingMoved ? SAVE_FIRST : reopeningSays(one.heldBy) + actThere(one) }}\n",
                "              {{ reopeningSays(one.heldBy) + actThere(one) }}\n",
            )
        ],
    ),
    # ── §6 · what review found, each row the defect it found ───────────────────────────────────
    (
        "M28 · 🔴 A DEFECT REVIEW FOUND: the sheet records a TOUCH rather than a MOVE · tick a box "
        "and untick it and the field stays marked edited — the Reopen dead, a sentence saying "
        "*not what you have changed here* over a screen that matches the row exactly, and a Save "
        "that moved nothing holding the sheet open. \u26d4 The only way out was a write that "
        "changed nothing",
        [
            (
                SHEET,
                "  () => new Set(props.fields.filter((f) => seeded[f.key] !== signatureOf(f.key)).map((f) => f.key)),",
                "  () => new Set(props.fields.filter((f) => f.key in seeded).map((f) => f.key)),",
            )
        ],
    ),
    (
        "M29 · 🔴 A DEFECT REVIEW FOUND: an edit that lands WHILE the save is in flight is marked "
        "as saved · nothing disables the editors across two IPC calls, so re-seeding from the "
        "SCREEN when the write returns makes a tick that was never sent look sent — the Reopen "
        "goes live over it and a press hands the conversation the row WITHOUT it",
        [
            (
                SHEET,
                "  Object.assign(seeded, sent)",
                "  for (const f of props.fields) seeded[f.key] = signatureOf(f.key)",
            )
        ],
    ),
    (
        "M30 · 🔴 A DEFECT REVIEW FOUND: the identity is compared UNFOLDED · `agent_identity.slug` "
        "is written through `foldProfileName` and `meta.profileId` keeps the launch's verbatim "
        "spelling, so a conversation started as `Worker` is dropped from `worker`'s offer — and "
        "an empty list claims nothing, so the miss reads as nothing being open",
        [
            (
                REOPENING,
                "  const wanted = foldProfileName(profileSlug)",
                "  const wanted = profileSlug",
            )
        ],
    ),
    (
        "M31 · 🔴 …and the fold that is actually load-bearing · the SLUG side is already folded "
        "(`agent_identity.slug` is written through `foldProfileName`); it is `meta.profileId` that "
        "keeps the launch's verbatim spelling, so folding only the parameter leaves `Worker` "
        "matching nothing. ⚑ TWO rows because M30 SURVIVED alone — each fold defends a different "
        "side, and a rule written twice is a rule no single mutation can kill",
        [
            (
                REOPENING,
                "      return ran !== undefined && foldProfileName(ran) === wanted",
                "      return ran !== undefined && ran === wanted",
            )
        ],
    ),
    (
        "M32 · ⛔ A DEFECT REVIEW FOUND: the waiting sentence names a remedy behind a modal · "
        "`send-refusals.ts` states the rule — *a disabled control must say what would let it, and "
        "the thing it names must be reachable* — and the card and the Stop it names are in the "
        "conversation, under an `aria-modal` scrim whose only answer to a click is to dismiss the "
        "sentence telling you to go there",
        [
            (
                SHEET,
                "  return one.heldBy === null ? '' : ACT_THERE",
                "  return ''",
            )
        ],
    ),
    (
        "M33 · ⚠️ …and the other way: the locus clause on EVERY row · a conversation holding "
        "nothing back is told to cancel the sheet to reach something it is not waiting for, which "
        "is the same `106` defect pointing backwards",
        [
            (
                SHEET,
                "  return one.heldBy === null ? '' : ACT_THERE",
                "  return ACT_THERE",
            )
        ],
    ),
    (
        "M34 · 🔴 A DEFECT REVIEW FOUND: pressing Reopen walks the window to that conversation · "
        "the sheet is reachable from the rail on every surface, so a press on a row for some "
        "other conversation moved the window behind the modal and closing the sheet dropped the "
        "person somewhere they never asked to be — from the launcher, it took the launcher with it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # grant sheet calls closeAndReopen(sessionId, false) so a press on some other conversation's
        # row never walks the window. The guard gained an `opened !== null &&` clause, so the line
        # is now `if (opened !== null && show) showConversation(opened, from)`; the plant drops
        # `show` from it.
        [
            (SCREEN, '    if (opened !== null && show) showConversation(opened, from)', '    if (opened !== null) showConversation(opened, from)'),
        ],
    ),
    (
        "M35 · 🔴 A DEFECT REVIEW FOUND: a refused reopen says nothing where the gesture was made · "
        "the close lands, the row leaves the offer, the resume is refused, and `reopen`'s own rule "
        "— *the refusal belongs to the gesture* — routes the sentence to the rail and the library, "
        "both of which paint UNDER `OverlayHost`'s dimmed, blurred scrim",
        [
            (
                SCREEN,
                "  if (said !== null) overlays.notify(said)",
                "  void said",
            )
        ],
    ),
    # ── §4 · the live instrument's cheap gate ───────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted
        # scripts/test/capabilities-probe-reach.test.mjs (272 lines) together with the live probe it
        # held. The `grant-canSpawn-when` hook named a canSpawn control that no longer exists
        # ('tests of deleted code deleted'). Its anchor is left stale, so the census records it
        # retired.
        "M36 · ⛔ the live probe's new hook leaves the roster · `310` cost two days of a dead "
        "`smoke:ui` step with `pnpm run ci` green throughout, because nothing in `ci` reads a live "
        "instrument's source. ⚑ A hook the probe reaches for and nobody classified is the hook "
        "nobody would have checked",
        [
            (
                REACH,
                "  // 470 · when a change to that grant lands — the second sentence on the same "
                "control.\n"
                "  'grant-canSpawn-when': 'apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue',\n",
                "",
            )
        ],
    ),
]
