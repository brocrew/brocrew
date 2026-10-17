#!/usr/bin/env python3
"""449 · a row that says who is in it, and a grant that means what it says — each row is THE DEFECT, put back (131).

🔴 **Two defects the person found in one screenshot, and the second one found itself.**

## ⛔ §A · the conversation list said the FOLDER

> *"in the left conversation list panel, can we actually show the role? now it shows
> `brobot-workspace` and that is not a relevant information."*

⚑ Three rows, all titled `brobot-workspace` — the workspace `424` gave BroBot, which every
conversation started there shares — over an AGENTS section listing `default`, `project-manager` and
`worker`. ⚠️ **The trap is that the folder is not useless, it is just not the identity**: two
conversations of ONE agent in two projects must not read as one row, which is `210` finding 4 with
the axes swapped. ⛔ So the rows below come in pairs — one that takes the identity away, and one
that takes the folder away.

## 🔴 §B · `same-project` told a model something this app does not do

⚠️ **Reported by one of our own project managers, unprompted, while answering a different
question:** *"my stated grant says 'may message: same-project', but the enforcement I actually hit
was narrower (spawned-agents-only)."*

⛔ **The enforcement is right and NOTHING about it moves here.** `withinMessagingReach` admits self,
then `mayCommand`, then the grant; `admitMessaging` then compares projects. For `same-project` that
composite is *of the conversations you command, the ones here* — `431`'s deliberate non-widening,
measured in `a-reach-you-can-see.test.ts` §1 since `433`.

🔴 **What was wrong is every surface that PUBLISHES the word.** `factory-text.ts` printed the bare
token; `canInterrupt`'s help never mentioned reach at all; and the three `-outside-your-project`
refusals opened with *"You may only send to conversations in the project you are working in"* — the
reading `431` reported rather than made — while their own remedy clause said the other thing two
lines down.

⚑ **And a renamed vocabulary word would have been wrong**, which is why no row here touches the
column: the SAME word gates the `read` act (439), which has no entitlement in front of it, so for a
PROJECT `same-project` really does mean *the one you are working in*. One word, two composites.
`M12` is that exception put back the wrong way round.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M3`, `M9`-`M13` | `apps/desktop/test/a-reach-you-can-see.test.ts` §4 |
| `M4`-`M5`, `M8` | `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` §3 |
| `M6`-`M7` | `apps/desktop/test/dom/capabilities-sheet.dom.test.ts` §1 |
| `M17`-`M19`, `M21` | `apps/desktop/test/a-row-that-says-who-is-in-it.test.ts` |
| `M14`-`M16`, `M20`, `M22`-`M23`, `M25` | `apps/desktop/test/dom/rail-identity.dom.test.ts` §A |
| `M24` | `apps/desktop/test/dom/closed-rail.dom.test.ts` |
| `M26`-`M27` | `apps/desktop/test/command-palette.test.ts` |

⚠️ **Two rows SURVIVED the first pass and both were holes in this file's own gate, not bad rows.**
`M20` and `M25` are about the rail's OTHER two sections — the recorded rows and `421`'s *Running ·
nobody watching* — and every test in `rail-identity.dom.test.ts` stubbed both of them out, so a
change reaching only the open rows read as a change to the rail. ⛔ A test that renders all three
sections from one roster closed both, and the whole table was re-verified on the final tree.

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from bytes with a SHA-256 check — `verify-each-mutation-row`, which is
not the same claim as a table run.

## ⚠️ What is deliberately NOT here

⛔ **No row that widens a reach.** §1 of the dispatch forbids it without `431`'s four paired tests
green, and `431` declined the ruling rather than making it — a mutation that shipped the widening
would be this table deciding it.

⛔ **No row on the blank PLACE.** `151 M17` is that defect and it is carried rather than copied:
it read *"a conversation with no directory gets a blank label instead of its id"*, the `||` moved
with the folder onto `place`, and the row was re-anchored in place and re-run
(`correct-a-stale-mutation-anchor-dont-retire-it`). ⚠️ A second row here would be two rows
protecting one line.

⛔ **No row on `no-such-agent`'s fold.** The refusal a `same-project` caller actually meets tells a
foreign conversation from an id that never was, deliberately; a row loosening it would be arguing
with `341`'s ordering rather than measuring this dispatch.
"""

CAPS = "apps/desktop/src/shared/capabilities.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"
WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
# 🔴 **570 · the AGENTS section left the navigation column** (`EXT-008` §4.4), and the roster
# row it drew is `TeamWorkspace`'s card. ⛔ **Every row below that pointed into that block is
# CORRECTED IN PLACE and re-verified RED one at a time, never retired** — the subject moved and
# only the bytes changed (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
TEAM = "apps/desktop/src/renderer/src/lib/team-roster.ts"
CLOSED = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
PALETTE = "apps/desktop/src/renderer/src/lib/command-palette.ts"
CONVERSATION_LIST = "apps/desktop/src/renderer/src/lib/conversation-list.ts"

# (name, suite, [(file, old, new), ...])
MUTATIONS: list[tuple[str, str, list[tuple[str, str, str]]]] = [
    # ── §B.1 · what the word admits ───────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `same-project` left `MESSAGING_REACH`,
        # which is now `['none','any']`. The `'same-project'` entry in `MESSAGING_REACH_ADMITS` is
        # deleted, so the widening this row plants has no word to attach to. bd70d693: 'same-project
        # reach ... removed'; capabilities.ts: 'D-016 - `same-project` went with projects'. Its
        # anchor is left stale, so the census records it retired.
        "M1 · 🔴 THE WIDENING `431` REFUSED, as a sentence · the grant a model reads drops *what "
        "it started* and claims everything in its project, which is the reading the enforcement "
        "does not implement and the one its own PM inferred from a bare token",
        "node",
        [
            (
                CAPS,
                "  // widening `431` refused to make.\n"
                "  'same-project':\n"
                "    'only conversations it started itself, and only while they are in the project it is working in',",
                "  // widening `431` refused to make.\n"
                "  'same-project':\n"
                "    'any conversation in the project it is working in',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** This row shortens the `same-project`
        # sentence in `MESSAGING_REACH_ADMITS`, and that entry no longer exists because the word
        # left the vocabulary in D-016 (bd70d693: 'same-project reach ... removed'). The 'here' half
        # of the sentence has no counterpart, since with no projects nothing says 'in the project it
        # is working in'. Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ the other half goes · the sentence says *what it started* and never *here*, which "
        "is `any` with extra steps — a caller reading it would expect to reach a child a person "
        "placed in another project, and `message-outside-your-project` is what it would meet",
        "node",
        [
            (
                CAPS,
                "  // widening `431` refused to make.\n"
                "  'same-project':\n"
                "    'only conversations it started itself, and only while they are in the project it is working in',",
                "  // widening `431` refused to make.\n"
                "  'same-project':\n"
                "    'only conversations it started itself',",
            )
        ],
    ),
    (
        "M3 · ⚠️ the brief's own premise, put back · `none` and `same-project` are published as one "
        "claim because they share a row in `REACHES_WHAT_IT_DID_NOT_START` — but `admitMessaging` "
        "refuses `none` before it looks at a project, so that grant reaches nothing and this one "
        "reaches what its holder started",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: `none`
        # must be published as 'nothing at all', because `admitReachAtAll` refuses it before
        # anything else, and never as a subset that includes the holder's own children. Only the
        # anchor moved. The comment above `none` was rewritten, the same `none:` line also appears
        # in `ASSIGNMENT_REACH_ADMITS` so the new comment line is part of the anchor, and the
        # project clause is gone from the planted sentence. Red comes from the byte-identical pin of
        # the two `none` sentences.
        [
            (CAPS, "  // ⚑ **Not even its own children**: `admitReachAtAll` refuses `none` before it asks anything else.\n  none: 'nothing at all — not even a conversation it started itself',", "  // ⚑ **Not even its own children**: `admitReachAtAll` refuses `none` before it asks anything else.\n  none: 'only conversations it started itself',"),
        ],
    ),
    # ── §B.2 · the model's own copy ───────────────────────────────────────────────────────────
    (
        "M4 · 🔴 THE REPORTED DEFECT · the grant line is the bare vocabulary token again, so a "
        "model reads `May message: same-project` and has to guess what it admits — which is "
        "exactly what ours did, and it guessed the app was enforcing something narrower",
        "node",
        # ⚑ **485 · the anchor moved with the sentence, and the row did not change its mind.**
        # `CAPABILITY_VALUES` was deleted from `factory-text.ts` and each grant's value became
        # `CapabilityField.says`, so this row puts the bare token back where it is authored now.
        # ⚠️ **The preceding comment line is part of the anchor** because `canMessage`'s and
        # `canInterrupt`'s bodies are byte-identical — one sentence, two fields — and an anchor has
        # to resolve exactly once.
        [
            (
                CAPS,
                "     * label is one string.\n     */\n"
                "    says: (held) => MESSAGING_REACH_ADMITS[held],",
                "     * label is one string.\n     */\n    says: (held) => held,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, the `canInterrupt`
        # capability field and its INTERRUPTION_REACH_ADMITS line, was removed on purpose. Commit
        # 010f9426: "can_interrupt … columns stay in the schema, unread and unwritten … End and
        # interrupt reach the chain below the caller, with no grant". Its anchor is left stale, so
        # the census records it retired.
        "M5 · ⛔ and the other verb · `May interrupt or end: same-project` reads as a licence over "
        "every conversation in the project, which is the state HO-016 §1 caught this field's NAME "
        "implying and the reason `375` put both verbs in the label",
        "node",
        # ⚑ **493 · the two fields no longer share a sentence table.** The defect is still the
        # bare word, now anchored directly on the interrupt-specific reader.
        [
            (
                CAPS,
                "    says: (held) => INTERRUPTION_REACH_ADMITS[held],",
                "    says: (held) => held,",
            )
        ],
    ),
    # ── §B.2 · the person's own copy ──────────────────────────────────────────────────────────
    (
        "M6 · ⛔ the sheet stops saying how far the grant reaches · a person choosing `same-project` "
        "for `can_message` reads two consequences and never the third, which is the shape `370` "
        "paid eight false sentences for",
        "dom",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: the `May
        # message` help must say how far each reach word goes, walked from `MESSAGING_REACH_ADMITS`.
        # Only the shape changed. The `list_projects` clause ('which projects it can be told what is
        # happening in') is gone from the help, so the reach sentence is now the last concatenated
        # term. The plant drops that term, leaving the help with the send and list-and-ask
        # consequences and no reach.
        [
            (CAPS, "      'exactly what it may write to, which ones it can list and ask about. ' +\n      reachSentence(MESSAGING_REACH_ADMITS),", "      'exactly what it may write to, which ones it can list and ask about.',"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, the `can_interrupt` help
        # and its reach sentence, went with the field. The column is unread and there is no grant
        # left to describe. Commit 010f9426: "can_interrupt … unread and unwritten … with no grant
        # and no project floor". Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 the worse half · `can_interrupt`'s help says only the two verbs and the `none` "
        "floor, so the ruled default reads as a control that lets this identity cut into anything "
        "in its project — the state this help was in before 449",
        "dom",
        [
            (
                CAPS,
                "      `and this identity can do neither. ${reachSentence(INTERRUPTION_REACH_ADMITS)}`,",
                "      'and this identity can do neither.',",
            )
        ],
    ),
    (
        "M8 · ⚠️ the vocabulary is ENUMERATED instead of walked · a fourth reach word joins the "
        "column, the rails and the model's grant line and is silently missing from the sentence a "
        "person reads — the drift a rendered sentence exists to make impossible",
        "node",
        [
            (
                CAPS,
                "  return `${MESSAGING_REACH.map((word) => `${word}: ${admits[word]}`).join('; ')}.`",
                "  return `${(['none', 'any'] as const).map((word) => `${word}: ${admits[word]}`).join('; ')}.`",
            )
        ],
    ),
    # ── §B.2 · the refusal ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `message-outside-your-project`
        # rail and the sentence 'you may only send to conversations you started yourself, and only
        # while they are in that project' are deleted. `MessageRail` is now only `may-not-message`,
        # `may-not-assign-work` and `assign-work-to-one-you-did-not-start`, and no sentence in
        # `describeMessageRail` mentions a project. bd70d693: 'project folders and their rails,
        # same-project reach ... are removed'. The remaining `assign-work-to-one-you-did-not-start`
        # sentence is a single rule with no half to drop, and it is already covered by 553/D-014.
        # Its anchor is left stale, so the census records it retired.
        "M9 · 🔴 the send refusal leads with HALF the rule again · *you may only send to "
        "conversations in the project you are working in* is the reading `431` reported rather "
        "than made, and it sat two lines above a remedy saying the opposite",
        "node",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1): the rule now FOLLOWS the act, and the relationship half this row drops is still in it; The DEFECT this row plants is unchanged.
            (
                RAILS,
                "        'agent you started in the project you are working in: you may only send to ' +\n        'conversations you started yourself, and only while they are in that project.'",
                "        'agent you started in the project you are working in: you may only send to ' +\n        'conversations in that project.'",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `interrupt-outside-your-project`
        # rail and its sentence were deleted: no project floor on interrupt. Commit 010f9426: "End
        # and interrupt reach the chain below the caller, with no grant and no project floor". Card:
        # "end and interrupt reach the chain below you, not the project". Its anchor is left stale,
        # so the census records it retired.
        "M10 · ⛔ the same, one verb over · the interrupt boundary claims a reach over every "
        "conversation in the caller's project, which `can_interrupt` has never granted",
        "node",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1): the rule now FOLLOWS the act, and the relationship half this row drops is still in it; The DEFECT this row plants is unchanged.
            (
                RAILS,
                "        'agents below you in the project you are working in: you may only cut into ' +\n        'conversations below you in the chain that created them, and only while they are in ' +\n        'that project.'",
                "        'agents below you in the project you are working in: you may only cut into ' +\n        'conversations in ' +\n        'that project.'",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `end-outside-your-project` rail and
        # its sentence were deleted: no project floor on end. Commit 010f9426: "End and interrupt
        # reach the chain below the caller, with no grant and no project floor". Its anchor is left
        # stale, so the census records it retired.
        "M11 · ⛔ and on the most destructive verb of the three · HO-016 §1's hierarchy is what "
        "makes a wrong sentence here cost the most, because the act it describes destroys a "
        "conversation",
        "node",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1): the rule now FOLLOWS the act, and the relationship half this row drops is still in it; The DEFECT this row plants is unchanged.
            (
                RAILS,
                "        'started in the project you are working in: you may only end conversations you started ' +\n        'yourself, and only while they are in that project.'",
                "        'started in the project you are working in: you may only end conversations in that project.'",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The refusal sentence 'You may only be
        # told what is in the project you are working in ...' belonged to `list_projects`' project
        # refusal (the `read` act), which bd70d693 deletes. `grep 'told what is in the project'`
        # finds nothing in src, and `message-rails.ts` has no project-scoped sentence left. Its
        # anchor is left stale, so the census records it retired.
        "M12 · 🔴 THE EXCEPTION, ERASED · the PROJECT refusal grows the *what you started* clause, "
        "so a caller is told it may only be told about projects holding conversations it started "
        "— `read` has no entitlement in front of it (439) and that sentence is simply false",
        "node",
        [
            (
                RAILS,
                "        'You may only be told what is in the project you are working in, and that is not the one ' +\n        'you named, so nothing was listed. Ask about the project you are working in.'",
                "        'You may only be told what is in the project you started work in, and that is not the one ' +\n        'you named, so nothing was listed. Ask about the project you are working in.'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `REACHES_WHAT_IT_DID_NOT_START` is now
        # `{ none: false, any: true }` and the `'same-project': false` entry is deleted with the
        # word (bd70d693: 'same-project reach ... removed'). The defect 'the ruled default becomes a
        # licence in its project' no longer exists: `any` reaching everything is now the ruled
        # default (HO-058 section 1). Flipping `none` would be a different defect. Its anchor is
        # left stale, so the census records it retired.
        "M13 · ⛔ THE RULING NOBODY MADE · `same-project` reaches past what its holder started, so "
        "the ruled DEFAULT every identity has without anybody deciding anything becomes a licence "
        "to message a person's own conversation in its project (`431`, criterion 6)",
        "node",
        [(RAILS, "  'same-project': false,", "  'same-project': true,")],
    ),
    # ── §A · who is in the row ────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 THE REPORTED DEFECT · the row is titled by its FOLDER again, so every "
        "conversation started in `<userData>/brobot-workspace` reads as the same conversation and "
        "the one fact a person asked for is nowhere on the rail",
        "dom",
        [
            (
                RAIL,
                # ⚑ **667 re-anchored and the ROW is unchanged** — the rail asks in `oneSpelling`
                # now, beside the pane it opens (`658`'s G5).
                # ⚑ **678 re-anchored and the ROW is unchanged** — `agentName` folds its own fallback since `671`, so
                # the renderer's `oneSpelling` is gone and the row asks `agentName` directly.
                "  return identityName(meta)",
                "  return whereItWorks(record) ?? record.sessionId",
            )
        ],
    ),
    (
        "M15 · ⛔ a record the host has not answered for yet is given an identity it does not have "
        "· `meta === null` folds to the default profile, and *BroBot* is invented for a "
        "conversation this app cannot place — `profileLabel`'s own note, one null over",
        "dom",
        [
            (
                RAIL,
                # ⚑ **667 re-anchored and the ROW is unchanged** — the rail asks in `oneSpelling`
                # now, beside the pane it opens (`658`'s G5).
                # ⚑ **678 re-anchored and the ROW is unchanged** — `agentName` folds its own fallback since `671`, so
                # the renderer's `oneSpelling` is gone and the row asks `agentName` directly.
                "  const meta = record.meta\n  if (!meta) return record.sessionId\n  return identityName(meta)",
                "  return agentName(record.meta?.profileId ?? null, props.agents?.identities ?? null)",
            )
        ],
    ),
    (
        "M16 · 🔴 THE TRAP · the folder goes with the label, so two conversations of ONE agent in "
        "two projects fold to one string — `210` finding 4 rebuilt by the fix for it",
        "dom",
        # ⚑ **470 · the rule moved to `session-record.whereItWorks`; the fallback stayed here**,
        # which is `449`'s own point — this row says one fewer thing rather than drawing an empty
        # separator. ⛔ The defect is unchanged: the folder goes and the label carries the row.
        [(RAIL, "  return whereItWorks(record)", "  return null")],
    ),
    (
        "M17 · ⛔ the name a PERSON gave an identity is never drawn · `423` put a control behind "
        "`displayName` and this reads straight past it, so the roster adds nothing and the two "
        "lists of one rail are back to naming an identity two ways",
        "node",
        [
            (
                WIRE,
                # ⚑ **671 · anchor corrected in place** — the fallback is folded (`667` G5a), so it is
                # handed `slug`. Subject unchanged: the roster reads straight past a person's name.
                "  const named = identities?.find((identity) => identity.slug === slug)?.displayName\n  return named ?? profileLabel(slug)",
                "  void identities\n  return profileLabel(slug)",
            )
        ],
    ),
    (
        "M18 · 🔴 the default identity is drawn as a bare `default` · `167 §2` ruled that presents "
        "the product's own main agent as an unset field, and it is the one thing "
        "`DEFAULT_PROFILE_LABEL` exists to stop",
        "node",
        [
            (
                WIRE,
                # ⚑ **671 · anchor corrected in place**, as M17 above.
                "  return named ?? profileLabel(slug)",
                "  return named ?? slug",
            )
        ],
    ),
    (
        "M19 · ⛔ the closed rows keep naming themselves by the folder · half the rail says who and "
        "half says where, which is the drift `151 §1`'s one-markup rule exists to prevent",
        "dom",
                # ⚑ **667 re-anchored and the ROW is unchanged** — the closed rows ask in
                # `oneSpelling` now, like the open rows above them (`658`'s G5).
                # ⚑ **678 re-anchored and the ROW is unchanged** — `agentName` folds its own fallback since `671`, so
                # the renderer's `oneSpelling` is gone and the row asks `agentName` directly.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: every
        # listed row names WHO is in it, not the folder. The closed-row fold moved from
        # closed-threads.ts into conversation-list.ts, where the same `label:
        # agentName(row.profileId, identities)` is still the line, so the plant puts the folder name
        # back as the label.
        [
            (CONVERSATION_LIST, '      label: agentName(row.profileId, identities),', '      label: basenameOf(row.cwd) || row.sessionId,'),
        ],
    ),
    (
        "M20 · ⚠️ the roster never reaches the closed fold, so a display name a person set shows on "
        "the open rows and not on the recorded ones — one identity, two names, one list apart",
        "node",
        [
            (
                RAIL,
                "    identities: props.agents?.identities ?? null,",
                "    identities: null,",
            )
        ],
    ),
    (
        "M21 · 🔴 the AGENTS section spells the fallback itself again · the census that keeps ONE "
        "derivation in this file stops holding, and the two lists are free to disagree about what "
        "an identity is called — which is how they came to disagree in the first place",
        "node",
        [
            (
                # ⚑ **570 · MOVED, and it moved into a FOLD rather than onto another
                # template.** `EXT-008` §4.4 took the AGENTS section out of the rail;
                # `team-roster.ts` computes the roster's heading now, and `568` shipped it
                # spelling exactly the fallback this row puts back — so this anchor is the
                # defect `570` repaired, pinned where it can happen again.
                TEAM,
                "        heading: agentName(identity.slug, source.identities),",
                "        heading: identity.displayName ?? identity.slug,",
            )
        ],
    ),
    (
        "M22 · ⛔ the open row stops drawing WHERE it is working · the identity is on the row and "
        "the fact that tells two conversations of it apart is not",
        "dom",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives and is
        # now stated once: the one row template draws provider, word, the in-another-window mark,
        # then the place, for every conversation. The plant drops the trailing `row.place` template,
        # so the row stops drawing where it is working.
        [
            (RAIL, '              ><template v-if="row.place"> · {{ row.place }}</template></small', '              ></small'),
        ],
    ),
    (
        "M23 · ⚠️ the hover that recovers an ellipsised folder is gone · at 200px the place is the "
        "first thing the column cuts, and the whole of it was one hover away · killed by `rail-identity.dom.test.ts`",
        "dom",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # hover that recovers an ellipsised folder is still on the one row `<small>` as
        # `:title="row.place ?? undefined"`. Only the `{{ row.record.meta?.provider }}` line after
        # it changed (it is `row.provider` now), so the anchor is corrected and the plant is the
        # same.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the hover that recovers an ellipsised folder is
        # still on the row's `<small>` as `:title="row.place ?? undefined"`. Only the line after it
        # changed (the `<template v-if="row.named">` label), so the plant deletes the title line
        # alone. Killed by `rail-identity.dom.test.ts`.
        [
            # ⚑ **W4.265 · re-anchored in place, not retired** — W4.265 · 0cfedf6d turned the row line's title into a joined list (label, provider, word, other window, place); the plant drops the place from that list, so the ellipsised folder is no longer recoverable on hover.
            (RAIL, "                      row.place,\n", ""),
        ],
    ),
    (
        "M24 · ⛔ the CLOSED row stops drawing it · the recorded half of the rail loses the fact the "
        "open half keeps, so the two lists describe one conversation differently again",
        "dom",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R55: the CLOSED row draws a ruled face first
                # where it has one, and `provider · note` otherwise; the defect planted is unchanged:
                # the row stops drawing its place.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # conversation drawn from the host's list (what was the recorded half of the rail) must
        # still carry its place, or the two halves describe one conversation differently. The
        # separate closed-row template is gone, so the plant is where a host-listed row's place is
        # set in the rail's `rows`: `place: host.place`.
        [
            (RAIL, '        place: host.place,', '        place: null,'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The *Running · nobody watching*
        # section and its `row.note` template are deleted. Its own words are a process fact: "it
        # said *Running · nobody watching*, a process fact (05 rule 5)" (command-palette.ts, D-017
        # F024), and D-017b: "no open / closed / kept-open split". The surviving rule, that a row
        # the host lists keeps its place, is the re-anchored M24; a second row would protect the
        # same `place: host.place` line. Its anchor is left stale, so the census records it retired.
        "M25 · ⚠️ and the RUNNING section · `421`'s own rows — the conversations this app is "
        "running that nobody is watching — are the ones a person most needs to place, and they "
        "lose it",
        "dom",
        [
            (
                RAIL,
                "              {{ row.provider }} · {{ row.note\n              }}<template v-if=\"row.place\"> · {{ row.place }}</template>",
                "              {{ row.provider }} · {{ row.note }}",
            )
        ],
    ),
    (
        "M26 · 🔴 the palette stops carrying the folder · the TITLE stopped being it in this very "
        "dispatch, so a person who knows a conversation by where it runs can no longer find it at "
        "all — a searchable fact made unsearchable by the commit that stopped displaying it",
        "node",
        [
            (
                PALETTE,
                "        row.place ?? '',\n        'jump',",
                "        'jump',",
            )
        ],
    ),
    (
        "M27 · ⛔ and the detail line under it · the palette row says provider and word where the "
        "rail row says provider, word and place, so the two surfaces `099` bound together describe "
        "one conversation differently",
        "node",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # palette detail line must carry provider, word and place, as the rail row does. D-017b
        # changed only the access (`row.record.meta?.provider` became `row.provider`) and
        # command-palette.test.ts still asserts the three-part line, so the plant drops `row.place`
        # from the same array.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the palette detail line must carry provider, word
        # and place, as the rail row does. The array moved to 6-space indentation inside the
        # conversations loop, so the anchor is corrected and the plant drops `row.place`. Killed by
        # `command-palette.test.ts`.
        [
            (PALETTE, "      [row.provider ?? 'unknown', row.word, row.place]", "      [row.provider ?? 'unknown', row.word]"),
        ],
    ),
]
