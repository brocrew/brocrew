"""487 · the refusals every offer must keep — `483`'s repair 1, criterion 15/17's family.

⛔ **One rule, in three places, and the table is shaped like the repair.**

 1. **The floor.** ⚠️ Both adapters exempt `deny` and `cancel` from the offered-set gate —
    `respondPermission` asks `isAlwaysHonoured` before anything else — and every producer of
    `availableDecisions` was written as if that exemption did not exist. ⛔ `482` proved the gap
    at the GATE and could not close it; four shapes of Codex command approval published an offer
    with neither refusal in it, and a surface draws `availableDecisions` and nothing else, so
    nobody could answer them. 🔴 **§1 is `publishedOffer` and the producer that needed it.**
 2. **The sentence.** ⚠️ The card said *"The provider offered no decisions for this request."* on
    every empty offer; on the branch `483` traced as reachable the provider offered plenty and
    **BroBot withheld the positives**, so the card blamed somebody else for its own fail-closed —
    criterion 18's shape. 🔴 **§2 is the word the adapter now writes and the sentences it picks.**
 3. **The surfaces.** ⛔ Three surfaces can answer a permission, and HO-030 §2 rules that a
    sentence true on one and absent on another *"trains the reader out of looking"*. 🔴 **§3 is
    one row per surface that could fall silent, plus Home's instruction to allow a card that
    cannot be allowed.**
 4. **The double.** ⛔ The Fake is what the desktop ledger tests answer through; a double that
    publishes an offer the real adapters could not is how a surface gets exercised against a
    floor the shipped app applies somewhere else. 🔴 **§4 is that one row.**

⚠️ **What this table deliberately does NOT contain, and why.**

 - ⛔ **No row on `fileScope`'s or `claudeScope`'s `publishedOffer(...)` call.** Both already
   produced an offer carrying the floor before 487 — `STANDARD_DECISIONS` and
   `claudeDecisionsFor` both end in `deny, cancel` — so replacing the call with the bare list is
   a NO-OP and would report a survivor it was never possible to kill
   (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`, and
   `a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ The rule those two call sites
   carry is *no producer states the floor in its own words*, and that is a SOURCE census
   (`the-refusals-every-offer-must-keep.test.ts` §2) rather than a behaviour a row can restore.
 - ⛔ **No row on the agent-tool producer.** That line is `482 M14`'s anchor; 487 re-pointed it
   in place onto the `publishedOffer(['allow'])` it became, and writing a second row over the
   same defect would double-count it (`142`'s rule: correct, never duplicate).
 - ⛔ **No row on `ALWAYS_HONOURED` itself.** `482 M13` owns it, and 487's own producer census
   strengthens that row rather than replacing it: narrowing the constant now changes what every
   producer publishes, so the census fails on literals instead of on a filter that moved with it.
 - ⛔ **No row on `answerFor` or `permissionDecisionFor`.** `473 M1/M2/M7/M8` own the payload
   these presses travel on. 487's §1.3 EXERCISES them and adds no rule to them.
 - ⛔ **No row that widens the positive `allowed` gate.** A gate widened by the floor is not a
   defect 487 could restore — both refusals are exempt from it by construction, so adding them
   changes nothing a test can see. ⚑ `M8` reaches the real question from the other side: the
   fail-closed branch surrendering its positives.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.

🔴 **The gate map** — which file kills which row:

| rows | killer |
|---|---|
| M1, M2, M3, M4 | `packages/runtime/test/the-refusals-every-offer-must-keep.test.ts` §1 |
| M1, M2, M5, M8 | …and `packages/runtime/test/codex-runtime.test.ts`'s 487 producer census |
| M6, M7 | `packages/runtime/test/codex-runtime.test.ts` — the census and the leak family |
| M9, M10, M11, M12 | `apps/desktop/test/the-card-nobody-could-answer.render.test.ts` §1 |
| M13, M14 | `apps/desktop/test/the-card-nobody-could-answer.render.test.ts` §2, all three surfaces |
| M13 | …and `apps/desktop/test/wide-grant.render.test.ts`, the card on its own |
| M15 | `apps/desktop/test/dom/homes-queue-says-what-each-answer-does.dom.test.ts` |
| M16 | `apps/desktop/test/dom/persons-queue.dom.test.ts` |
| M17 | `apps/desktop/test/every-answer-through-the-persons-queue.test.ts` §487 |
| M18, M19 | `apps/desktop/test/the-card-nobody-could-answer.render.test.ts` §1 and §3 |
| M20 | `apps/desktop/test/the-card-nobody-could-answer.render.test.ts` §1, the leak assertion |

⚑ **§5's three rows came out of this dispatch's OWN adversarial review**, after the first draft
landed and gated green. ⛔ **Each one is a defect the review found in the repair**: a word that
decided WHETHER rather than only WHY, a residual arm that asked for an empty row instead of for no
positive, a sentence that claimed an accept had been offered when the app could not read the token,
and a queue that promised a refusal beside no buttons. ⚠️ **`M12`'s premise was overturned by the
same review and the row was RE-AIMED rather than retired** — the defect it restores is now the
stronger one (the word overruling the offer), and its recorded verdict was measured after the
re-aim, not before.

⛔ **One more deliberate omission, added with §5**: no row on the Fake's `driveTurn` gate reading
the raw offer instead of the published one. Both of that double's offers already name the two
refusals, so the two sets coincide and the mutation changes nothing a test can see — the same
unkillable shape as `fileScope`'s call above.
"""

PERMISSION = "packages/runtime/src/permission.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
FAKE = "packages/runtime/src/fake-runtime.ts"
OFFER = "apps/desktop/src/renderer/src/lib/permission-offer.ts"
CARD = "apps/desktop/src/renderer/src/components/PermissionCard.vue"
HOME = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"
QUEUE = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
ATTENTION = "apps/desktop/src/renderer/src/lib/attention.ts"
PERSONS = "apps/desktop/src/renderer/src/lib/persons-queue.ts"

# ⚑ The whole body, so a row can change what the floor does without touching the signature the
# five producers call.
FLOOR_BODY = (
    "  return [...positives.filter((outcome) => !isAlwaysHonoured(outcome)), ...ALWAYS_HONOURED]\n"
)

# ⚑ The classification, as one expression: every row below that moves a branch of it replaces the
# whole thing, because the branches are a chained ternary and half of one is not valid TypeScript.
WHY_NO_POSITIVE = (
    "  const noPositive = [...(allowed ?? STANDARD_DECISIONS)].some(\n"
    "    (outcome) => !isAlwaysHonoured(outcome),\n"
    "  )\n"
    "    ? undefined\n"
    "    : !requested.faithful\n"
    "      ? ('could-not-describe-the-grant' as const)\n"
    "      : // ⚠️ A `null` from {@link outcomeOfCodexDecision} is an offered decision we could not map —\n"
    # ⚑ **736 · corrected in place** — R95 made the exec-policy amendment `allow_always`, and the
    # comment inside this anchor says so now; what the row plants is unchanged.
    "        // the network amendment, or a look-alike (the exec-policy one is `allow_always` since `736`).\n"
    "        // The provider offered a way to accept and we cannot put it on a card,\n"
    "        // which is a different sentence from the provider offering none.\n"
    "        mapped.some((outcome) => outcome === null)\n"
    "        ? ('could-not-represent-the-answers' as const)\n"
    "        : ('none-was-offered' as const)\n"
)

MUTATIONS = [
    # --------------------------------------------------------------------- §1 · the floor itself
    (
        "M1 · 🔴 THE DEFECT, restored at its root · `publishedOffer` publishes what the producer "
        "handed it and nothing else, so every fail-closed card goes back to an offer with no "
        "answer on it and a person holds a card they cannot press",
        [(PERMISSION, FLOOR_BODY, "  return [...positives]\n")],
    ),
    (
        "M2 · ⛔ the floor is kept only where there was already something · the exact reading that "
        "shipped — *an EMPTY offer means nothing may be pressed* — which leaves the one card "
        "`483` traced as reachable unanswerable and every other card unchanged",
        [
            (
                PERMISSION,
                FLOOR_BODY,
                "  if (positives.length === 0) return []\n"
                "  return [...positives.filter((outcome) => !isAlwaysHonoured(outcome)), ...ALWAYS_HONOURED]\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ the de-duplication goes · a provider that already named `decline` gets two Deny "
        "buttons, because the row is built from the offer and a repeat in it is a repeat on screen",
        [
            (
                PERMISSION,
                FLOOR_BODY,
                "  return [...positives, ...ALWAYS_HONOURED]\n",
            )
        ],
    ),
    (
        "M4 · 🔴 the floor WIDENS · `allow` rides in beside the two refusals, so every card "
        "advertises a positive the gate will reject — `482`'s *it is never a widening* turned "
        "false, and the exact lie about scope `023 P1-F` exists to prevent",
        [
            (
                PERMISSION,
                FLOOR_BODY,
                "  return [\n"
                "    ...positives.filter((outcome) => !isAlwaysHonoured(outcome)),\n"
                "    ...ALWAYS_HONOURED,\n"
                "    'allow',\n"
                "  ]\n",
            )
        ],
    ),
    (
        "M5 · ⛔ the Codex command producer publishes the gate's members raw again · the four "
        "short shapes come back at once, and the two the census calls controls do not move — "
        "which is what makes this row about the OFFER rather than about the floor",
        [
            (
                CODEX,
                "    availableDecisions: publishedOffer([...(allowed ?? STANDARD_DECISIONS)]),\n",
                "    availableDecisions: [...(allowed ?? STANDARD_DECISIONS)],\n",
            )
        ],
    ),
    # ------------------------------------------------------------- §2 · the word, and its reasons
    (
        "M6 · 🔴 the card stops saying WHY it cannot be allowed · the offer keeps both refusals "
        "and the reason is never written, so the fact rides on nothing again and every surface "
        "shows two buttons over silence",
        [(CODEX, WHY_NO_POSITIVE, "  const noPositive = undefined\n")],
    ),
    (
        "M7 · ⛔ BroBot's own fail-closed is reported as the provider offering nothing · the "
        "sentence `483` found, restored one layer deeper: the word is right for two branches and "
        "blames somebody else on the reachable one",
        [
            (
                CODEX,
                WHY_NO_POSITIVE,
                "  const noPositive = [...(allowed ?? STANDARD_DECISIONS)].some(\n"
                "    (outcome) => !isAlwaysHonoured(outcome),\n"
                "  )\n"
                "    ? undefined\n"
                "    : ('none-was-offered' as const)\n",
            )
        ],
    ),
    (
        "M8 · ⚠️ an undisplayable grant stops failing positives closed · the gate the offer is "
        "derived from goes unrestricted, so a card whose scope could not be shown offers Approve "
        "— `036 P1-F #5`, and the one thing 487 had to leave exactly as strict",
        [
            (
                CODEX,
                "  const allowed = !requested.faithful\n"
                "    ? new Set<PermissionOutcome>()\n"
                "    : hasExplicitList\n"
                "      ? new Set(enumerated)\n"
                "      : null\n",
                "  const allowed = hasExplicitList ? new Set(enumerated) : null\n",
            )
        ],
    ),
    # ------------------------------------------------------------- §3 · what each surface says
    (
        "M9 · ⛔ the withheld sentence goes back to blaming the provider · the exact copy `483` "
        "found on the card, restored as the thing the reachable branch renders",
        [
            (
                OFFER,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "  'could-not-describe-the-grant':\n    'BroCrew is offering no way to allow this: accepting would grant something it cannot show you, ' +\n    'so it withheld every way to allow it. Refusing still works, and always does.',\n",
                "  'could-not-describe-the-grant': 'The provider offered no decisions for this request.',\n",
            )
        ],
    ),
    (
        "M10 · ⚠️ the sentence names the shape it could not describe · the positives were withheld "
        "so that a person would not be granted something they were never shown, and a negative "
        "that spells it out hands back exactly what withholding them was for",
        [
            (
                OFFER,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "    'BroCrew is offering no way to allow this: accepting would grant something it cannot show you, ' +\n    'so it withheld every way to allow it. Refusing still works, and always does.',\n",
                "    'BroCrew cannot show you the fileSystem entries this would grant, so it withheld ' +\n    'every way to allow it. Refusing still works, and always does.',\n",
            )
        ],
    ),
    (
        "M11 · ⛔ the sentence stops telling a person what they can still do · it says only what "
        "is missing, on the one screen whose whole repair is that there IS something to press "
        "(`106` from the other side)",
        [
            (
                OFFER,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "    'BroCrew is offering no way to allow this: accepting would grant something it cannot show you, ' +\n    'so it withheld every way to allow it. Refusing still works, and always does.',\n",
                "    'BroCrew is offering no way to allow this: accepting would grant something it cannot ' +\n    'show you, so it withheld every way to allow it.',\n",
            )
        ],
    ),
    (
        "M12 · 🔴 the WORD decides whether, instead of only why · the adapter's reason is returned "
        "without ever looking at the offer, so a request carrying a positive AND a word paints "
        "*no way to allow this* directly above a live Approve — 487's own sentence, pointing the "
        "other way ⚑ PREMISE RE-AIMED BY 487's OWN REVIEW",
        [
            (
                OFFER,
                "  if (offer.wide !== null || offer.row.some(outcomeAllows)) return null\n"
                "  if (because !== undefined) return { why: because, says: noPositiveSays(because) }\n",
                "  if (because !== undefined) return { why: because, says: noPositiveSays(because) }\n"
                "  if (offer.wide !== null || offer.row.some(outcomeAllows)) return null\n",
            )
        ],
    ),
    (
        "M13 · 🔴 the CARD falls silent · both refusals are drawn and nothing above them says why "
        "there is no Approve, which is the state `482` and `483` both measured and neither could "
        "repair",
        [
            (
                CARD,
                'const cannotAllow = computed(() => noWayToAllow(scope.value.noPositiveBecause, offer.value))\n',
                "const cannotAllow = computed(() => null)\n",
            )
        ],
    ),
    (
        "M14 · ⛔ HOME and the person's queue fall silent together · the row stops carrying the "
        "sentence, so the card explains itself and the two surfaces a person answers from say "
        "nothing — HO-030 §2's *trains the reader out of looking*, exactly",
        [
            (
                ATTENTION,
                "          noPositive: noWayToAllow(scope.noPositiveBecause, offer)?.says ?? null,\n",
                "          noPositive: null,\n",
            )
        ],
    ),
    (
        "M15 · 🔴 Home tells a person to open a card and allow it, on a card nothing can allow · "
        "`483`'s own finding on this line — it points through a door that still cannot do what it "
        "names — restored by making the instruction unconditional again",
        [
            (
                HOME,
                '          <template v-if="request.noPositive === null">Open it before you allow it.</template>\n',
                "          Open it before you allow it.\n",
            )
        ],
    ),
    (
        "M16 · ⚠️ the person's queue draws the sentence only where there is nothing to press · "
        "the row keeps the field and renders it under the `noAnswerHere` condition instead, which "
        "is the one state 487 says this is NOT: a row that can be refused and cannot be allowed",
        [
            (
                QUEUE,
                '            v-if="row.noPositive"\n',
                '            v-if="row.noPositive && row.noAnswerHere"\n',
            )
        ],
    ),
    # ----------------------------------------------------------------------- §4 · the double
    (
        "M17 · ⛔ the double publishes an offer the real adapters could not · `simulatePermission` "
        "skips the floor, so every desktop test that answers a fail-closed card is exercising a "
        "surface against a rule the shipped app applies and this one does not",
        [
            (
                FAKE,
                "    const availableDecisions = publishedOffer(offer.availableDecisions)\n",
                "    const availableDecisions = [...offer.availableDecisions]\n",
            )
        ],
    ),
    # ------------------------------------- §5 · the three rules 487's own review added (see ⚑)
    (
        "M18 · 🔴 the residual arm asks for an EMPTY row instead of for NO POSITIVE · a Codex "
        "command approval persisted before 487 offering `['decline','cancel']` and no reason "
        "falls through to silence on every surface, and Home goes back to telling a person to "
        "open it and allow it — `483`'s defect surviving the repair, on replayed data",
        [
            (
                OFFER,
                "  return offer.row.length === 0\n"
                "    ? { why: 'nothing-at-all', says: NO_ANSWER_ON_THIS_REQUEST }\n"
                "    : { why: 'not-said', says: NO_REASON_ON_THIS_REQUEST }\n",
                "  return offer.row.length === 0\n"
                "    ? { why: 'nothing-at-all', says: NO_ANSWER_ON_THIS_REQUEST }\n"
                "    : null\n",
            )
        ],
    ),
    (
        "M19 · ⛔ the person's queue says *refusing still works* over zero buttons · the sentence "
        "is drawn beside a `noAnswerHere` that has already taken every control away, so a row "
        "whose answer is on its way tells a person to refuse a card they can no longer press "
        "— `468`'s false instruction with a new subject",
        [
            (
                PERSONS,
                "      noPositive: settling.answers.length === 0 ? null : (live?.noPositive ?? null),\n",
                "      noPositive: live?.noPositive ?? null,\n",
            )
        ],
    ),
    (
        "M20 · ⚠️ the sentence asserts an ACCEPT was offered · `outcomeOfCodexDecision` returns "
        "null for anything it cannot read, not only the amendment forms, so a list of two "
        "refusals and one token this app could not parse is reported as *the ways to accept it* "
        "— a claim about the provider drawn from something we could not read",
        [
            (
                OFFER,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "    'BroCrew is offering no way to allow this: part of what this request offered came in a form ' +\n    'BroCrew cannot put on a card. Refusing still works, and always does.',\n",
                "    'BroCrew is offering no way to allow this: the ways to accept it were offered in a form ' +\n    'BroCrew cannot put on a card. Refusing still works, and always does.',\n",
            )
        ],
    ),
]
