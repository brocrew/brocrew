"""425 · the remedy a refusal carries — each row is THE DEFECT, put back (131).

🔴 **HO-023 §2.2, in the PO's words:**

> *"The rail composed one — 'send a message to that one instead' — and `405`'s rule stripped it.
> That rule was right in general and wrong here: **record the refusal, not the request** should not
> have thrown away **what the app itself knew you could do instead.** Add a remedy to the refusal
> shape. **The model was handed a way out and the person was handed a rule name; both should have had
> both.**"*

## ⛔ The defect, in the four fields a person was left with

```
refused: spawn_agent · profile-already-live · while this holds · retrying may work
```

⚠️ **The model had the way out all along.** `PublishedRefusal.reason` reaches Claude as a structured
object and Codex on its MCP result path, so the rail's prose remedy was never the thing that was
missing. ⛔ **The loss is at the durable seam**: `refusalIn` reduced the payload to
`{rail, permanence, retryable}`, `noteRefusal` published that quartet, and both person-readers could
render only those fields.

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · the seam** (`M1`–`M4`) — the writer, and the reader that lifts the word off an untyped bag.
- **§2 · the twelve that must stay EMPTY** (`M5`–`M8`) — the hard half of the property. Each row
  fills in a rail `422` §5.1 measured as false, destructive, person-only or advice for a DIFFERENT
  call. 🔴 **These are the rows that matter most**: a remedy field is only worth having if the app is
  willing to leave it blank. ⚑ **`424` landed between this table being written and being merged, and
  repriced all twelve** — so what these rows now break is a BICONDITIONAL: every retryable rail
  carries an act and no other rail pretends to.
- **§3 · the nine that carry one** (`M9`–`M12`) — one loses its word, two swap words, a permanent
  rail gains one. ⚠️ `a-file-level-contains-cannot-tell-sibling-declarations-apart` is the direct
  hazard for a nine-rail map folded onto five words, and `M10` and `M11` are it.
- **§4 · the sentence the four resource rails never had** (`M13`, `M14`).
- **§5 · the two readers** (`M15`–`M21`) — the clause, the guard, the distinctness, and the raw line.
- **§6 · the defect this dispatch's own review found** (`M22`). 🔴 **A remedy that names an act the
  NEXT RAIL refuses** — HO-023 §2.2's defect rebuilt inside the fix for it, reaching both readers.
  ⚠️ It was in the first draft, it passed every assertion written at the time, and only a
  line-by-line audit of the dispatch's own diff caught it. **The row exists so nothing can put it
  back quietly.**

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M22` | ⚑ **`run_suite`** — `apps/desktop/test/a-refusal-carries-its-remedy.test.ts` |
| `M9`, `M10`, `M22` also | ⚑ `test/a-reply-and-its-absence.test.ts`, `test/a-question-is-not-work.test.ts` |
| `M7` also | ⚑ `test/the-interruption-that-looks-like-a-fault.test.ts` |
| `M1`, `M21` also | ⚑ `test/a-refusal-you-can-see.test.ts` |

🔴 **`M2` is caught by the dispatch's own file and by NOTHING else, and that was measured rather than
assumed.** ⛔ This table first claimed `a-question-is-not-work.test.ts` for it and the row **survived**
there: that file reads the remedy off the tool PAYLOAD — the model's answer — and `M2` moves what the
HOST writes into the ledger. ⚑ **They are two readers and only one file reads both**, which is the
clearest statement of why the seam needed a test of its own.

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row making a carrier copy the remedy off its incoming payload instead of re-deriving it from
the rail.** ⚠️ Every refusal a door builds already carries the word its table says, so the copy and
the derivation agree for every input this suite can produce — a mutation whose value never differs is
a phantom survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ The re-derivation
earns its place the same way `permanence`'s does: it corrects a payload built by hand, and nothing in
this app builds one.

⛔ **No row inside any rail's `PERMANENCE` table, and none on `retryable`.** Those are `341`'s and
`424`'s; this dispatch added a field beside them and moved neither.

⛔ **No row making the model's `reason` carry the code instead of the sentence.** ⚠️ It is the change
HO-023 §2.2 forbade — *"the model loses a sentence it is currently given"* — and a row that performed
it would be measuring a decision rather than a defect. ⚑ `M13` measures the half that IS a defect:
the four rails whose sentence taught nothing.

⛔ **No row putting a remedy on `that-agent-is-you`.** ⚑ `424` added that rail after this table was
written, and the MERGE would not compile until `425` classified it — *"Property 'that-agent-is-you' is
missing in type"*, from `tsc`, on a table nobody had touched. ⚠️ **A mutation row would measure less
than that compile error already does**, and `M12` already covers a permanent rail being given an act.

⛔ **No row on `REFUSAL_REMEDIES`' order or on `isRefusalRemedy`'s `typeof` guard.** Neither carries a
rule: the list is walked everywhere it is read, and a non-string cannot reach the guard from any
writer in this app.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 retired `agent-already-has-a-message-waiting`: M22 is retired by ruling, and the gate line and §6
should drop it. ⚠️ M10's label names that retired word as its sibling, and calls the investigate act
*send it again as a question*; D-010's refusal now says *a follow-up, or ask_question*.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
SPAWN = "apps/desktop/src/main/runtime/spawn-rails.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"
INTERRUPT = "apps/desktop/src/main/runtime/interrupt-rails.ts"
DOCUMENT = "apps/desktop/src/main/documents/canonical-document.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
# ⚑ **466 moved `permanenceSaid` here** so the digest's fold could read the same table — see
# `M21`, whose anchor follows the function rather than the file it used to live in.
REFUSALS = "apps/desktop/src/shared/refusals.ts"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
CARRIED = "      remedy: refused.remedy,\n"
GUARD = "  const said = isRefusalRemedy(remedy) ? remedy : null\n"
LIFTED = (
    "    if (typeof retryable === 'boolean') return { rail, permanence, retryable, remedy: said }\n"
)
CLAUSE = "        }${remedyClause(event.remedy)}`,\n"
SAID = "  return isRefusalRemedy(remedy) ? REMEDY_SAID[remedy] : null\n"
EMPTY = "  return said === null ? '' : ` · ${said}`\n"
PERMANENCE_SAID = (
    "  return isRailPermanence(permanence) ? PERMANENCE_SAID[permanence] : permanence\n"
)
RAW = "      }${isRefusalRemedy(event.remedy) ? ` · ${event.remedy}` : ''} (ours)`\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the seam ─────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE SHIPPED DEFECT, verbatim · the host publishes the quartet and drops the word, "
        "so the model is handed a way out and the person reading the transcript is handed a rule "
        "name — HO-023 §2.2 exactly, and the four fields the person read in his own ledger",
        [(HOST, CARRIED, "")],
    ),
    (
        "M2 · ⛔ the host composes one instead of carrying it · every refusal in the app promises "
        "the same act, so a capability a person has not granted, a name that is taken and a task "
        "that has ended all tell a reader to make the same call again once something settles. ⚠️ It "
        "is the shape a fix written in the WRITER rather than at the rails takes, and it makes the "
        "policy live in an eighth place",
        [(HOST, CARRIED, "      remedy: 'make-the-same-call-when-this-settles',\n")],
    ),
    (
        "M3 · 🔴 the reader drops it one layer in · the doors decide, the payload carries it, the "
        "model gets it — and `refusalIn` lifts the quartet back out and leaves the fifth fact on the "
        "floor. ⚑ This is the exact seam `422` §5.1 traced, put back",
        [(TOOLS, LIFTED, "    if (typeof retryable === 'boolean') return { rail, permanence, retryable, remedy: null }\n")],
    ),
    (
        "M4 · ⚠️ the guard goes · a word a LATER build wrote is lifted out of the bag and published "
        "as this app's own promise, so a ledger row written by a version that knew an act says it to "
        "a version that does not — and the row cannot say whether the gesture still exists",
        [(TOOLS, GUARD, "  const said = remedy as RefusalRemedy | null\n")],
    ),
    # ── §2 · the twelve that must stay empty ──────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** `profile-already-live` was a
        # `spawn_agent` rail and its subject is gone on purpose: D-016 replaced `spawn_agent` with
        # `give_work`, which REACHES the giver's own conversation of that identity (helperAs)
        # instead of refusing it. The remedy test says so in its roster: '`profile-already-live`
        # went with `spawn_agent`: a give finds the one conversation it has instead of being refused
        # it.' Its anchor is left stale, so the census records it retired.
        "M5 · 🔴 the rail the PO's own ledger row named gets the sentence it already says · "
        "`profile-already-live` promises an act, and `422` §1 measured `liveSessionAs` to have no "
        "entitlement filter — so the promise can name a session the caller may not reach, whose own "
        "answer is `no-such-agent`. ⛔ A remedy that can be a lie about entitlement is the one shape "
        "§2 of the brief forbids by construction",
        [(SPAWN, "  'profile-already-live': null,\n", "  'profile-already-live': 'make-the-same-call-when-this-settles',\n")],
    ),
    (
        "M6 · ⛔ the hardest `null` is filled in · `no-such-agent` folds an id that does not exist "
        "and one the caller may not reach into one privacy-preserving answer, and `list_agents` "
        "composes a DIFFERENT call. ⚠️ Finding another id is not making this id reachable, and a "
        "field that said otherwise would rebuild `405`'s defect inside the fix for it",
        [(TOOLS, "  'no-such-agent': null,\n", "  'no-such-agent': 'make-the-same-call-when-this-settles',\n")],
    ),
    (
        "M7 · 🔴 waiting for somebody else is recorded as an act the caller can perform · "
        "`a-person-is-being-asked` said *wait for the person to answer* — honest CONTEXT, and only "
        "the person's own door ends that state, which `424` has since said again in the permanence. "
        "⛔ A remedy here would tell a person reading the transcript that their agent had a way out "
        "when the way out was them",
        [(INTERRUPT, "  'a-person-is-being-asked': null,\n", "  'a-person-is-being-asked': 'make-the-same-call-when-this-settles',\n")],
    ),
    (
        "M8 · ⚠️ correction is recorded as remedy · `no-task-by-that-name` folds an id that names "
        "nothing, an id in somebody else's ledger and a conversation never given work. ⛔ `list_tasks` "
        "helps compose another call and this rail's subject never becomes answerable — the second "
        "group of `422` §5.1, promoted into the field that must not hold it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # rail whose subject never becomes answerable must get no remedy) survives:
        # `no-task-by-that-name` became `no-piece-by-that-name` in REPLY_RAILS, still permanent and
        # still null in the reply-rails.ts `REMEDY`. The plant hands it
        # 'make-the-same-call-when-this-settles', and the rail's own note says it gets NOTHING.
        # Killed by `a-refusal-carries-its-remedy.test.ts`.
        [
            (REPLY, "  'no-piece-by-that-name': null,\n", "  'no-piece-by-that-name': 'make-the-same-call-when-this-settles',\n"),
        ],
    ),
    # ── §3 · the nine that carry one ──────────────────────────────────────────────────────────
    (
        "M9 · ⛔ the cleanest rail in the dispatch loses its word · `summary-too-long` is refused "
        "about the CALLER's own words, the caller can change them, and the act needs nothing from "
        "anybody else. ⚑ If any rail may be silent this one may not",
        [(REPLY, "  'summary-too-long': 'shorten-the-summary-and-attach-the-long-form',\n", "  'summary-too-long': null,\n")],
    ),
    (
        "M10 · 🔴 the *investigate* half is deleted from the durable row · a receiver holding an open "
        "piece of work is told to make the same call again once something settles, so the one act "
        "HO-021 §1 ruled must survive this rail — send it again as a QUESTION — stops being recorded "
        "anywhere a person can read it. ⚠️ It is one of two sibling entries in one map that now share "
        "a word, and `a-file-level-contains-cannot-tell-sibling-declarations-apart` is why each has "
        "its own row",
        # ⚑ **Re-anchored by `429`**, which renamed the word because the ACT changed: `withdraw_task`
        # did not exist when `425` wrote `ask-about-the-open-work-or-wait`, and *wait* was the arm
        # that walked a model into `415` §6.3's duplicate. ⛔ The ROW is unchanged and is sharper: the
        # replacement still deletes the investigate half, and now the withdraw half with it.
        # Re-verified RED individually.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # one retryable spawn-style rail carries the act 'withdraw-the-work-or-ask-about-it', so a
        # question sent again stays recorded) survives in the piece model: D-016 renamed
        # `agent-already-has-work-open` to the stall rule `its-work-has-stalled`, and the
        # `TOOL_REMEDY` comment in agent-tools.ts says the word went there. The plant now belongs in
        # spawn-rails.ts `REMEDY`, swapping that word for the sibling word
        # 'make-the-same-call-when-this-settles' (a valid RefusalRemedy, so no TypeError). Killed by
        # `a-refusal-carries-its-remedy.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`, `a-question-is-not-work.test.ts`,
        # `taking-work-back.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            (SPAWN, "not being worked on: follow ${them} up with message_agent (kind follow-up), or take ${them} back with withdraw_task.`", "not being worked on: give it again once it has finished.`"),
        ],
    ),
    (
        "M11 · ⛔ one of four siblings loses the word the other three keep · a file too large to be "
        "a document is refused with no act, while unreadable, empty and not-UTF-8 all still carry "
        "one. ⚑ A file-level assertion over the four would pass this; the walk asserts per shape",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (one
        # of the four resource-shape siblings must not lose the word the other three keep) still
        # holds: `resource-too-large` is in `RESOURCE_REMEDY` as retryable with
        # 'offer-a-workspace-markdown-file-that-reads'. Only the file moved, from
        # documents/canonical-document.ts to resources/resources.ts. Killed by
        # `a-refusal-carries-its-remedy.test.ts`.
        [
            (RESOURCES, "  'resource-too-large': 'offer-a-workspace-markdown-file-that-reads',\n", "  'resource-too-large': null,\n"),
        ],
    ),
    (
        "M12 · ⚠️ a PERMANENT rail is given an act · `resource-not-a-document` means *this exact "
        "call can never succeed*, and a remedy beside that word tells a model the world can change "
        "when what has to change is the call. ⛔ `425` §3.1's ruling is over the twenty-one "
        "retryable rails, and widening it is a decision rather than a fix",
        # ⚑ **Re-anchored in place by `635`, not retired** (142's rule,
        # `correct-a-stale-mutation-anchor-dont-retire-it`). ⛔ `HO-097` §1 widened the store past
        # Markdown, so the rail was RENAMED — its old name was a true sentence about a
        # Markdown-only store and became a lie. ⚠️ **The DEFECT is unchanged**: a `permanent` rail
        # handed a remedy field.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # PERMANENT rail must not be given an act) still holds for the renamed rail
        # `resource-not-a-form-this-app-keeps`, which is null in `RESOURCE_REMEDY` and permanent in
        # `RESOURCE_PERMANENCE`. The old name `resource-not-a-document` went with documents, but the
        # defect (a remedy beside a permanent word) is unchanged. Killed by
        # `a-refusal-carries-its-remedy.test.ts`.
        [
            (RESOURCES, "  'resource-not-a-form-this-app-keeps': null,\n", "  'resource-not-a-form-this-app-keeps': 'offer-a-workspace-markdown-file-that-reads',\n"),
        ],
    ),
    # ── §4 · the sentence the four never had ──────────────────────────────────────────────────
    (
        # ⚑ **`M13` and `M14` re-anchored in place by `635`, not retired** (142's rule). ⛔ `HO-097`
        # §1 widened the store past Markdown, so the sentence names *one of the types this app
        # holds* instead of *a Markdown file*. ⚠️ **Both DEFECTS are unchanged**: the clause
        # deleted, and the clause promising a provider-native verb.
        "M13 · 🔴 the model goes back to being told what is wrong and not what to do · the four "
        "resource-shape rails say the file is unreadable, too large, empty or not text and stop. "
        "⚑ These are the only remedies in this dispatch written from nothing, and the word alone "
        "would leave the model reading a code with no sentence behind it",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
            # ⚑ **…and again at `726` (R92)**: the sentence no longer says *inside this conversation's working directory* — any readable file is taken.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # four resource-shape rails must say what to do, not only what is wrong) survives:
        # `OFFER_ANOTHER_FILE` is still appended to the reasons of the retryable resource rails, now
        # worded 'a file of that type' instead of 'a document of that type'. The plant empties the
        # constant, so the reason has the wrong-thing half and none of the act. Killed by
        # `a-refusal-carries-its-remedy.test.ts`, `a-reply-and-its-absence.test.ts`.
        [
            (RESOURCES, "const OFFER_ANOTHER_FILE =\n  ' Write a file and offer that path instead — one of the types this app holds, not empty, and no larger than a file of that type may be.'\n", "const OFFER_ANOTHER_FILE = ''\n"),
        ],
    ),
    (
        "M14 · ⛔ the remedy promises a provider-native verb · `422` §3 bounds these four to "
        "requiring a valid workspace ARTIFACT, because the tool that writes one is spelled "
        "differently on every provider and named by none of them in our own vocabulary. ⚠️ A model "
        "whose provider calls it something else is told to use a tool it does not have",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
            # ⚑ **…and again at `726` (R92)**: the sentence no longer says *inside this conversation's working directory* — any readable file is taken.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # remedy names the artifact, not a provider-native verb such as a Write tool) survives on
        # the same `OFFER_ANOTHER_FILE` constant, which only moved files and changed 'document' to
        # 'file'. The plant keeps 'offer that path instead' in the sentence so only the
        # no-provider-verb assertion can catch it. Killed by `a-refusal-carries-its-remedy.test.ts`.
        [
            (RESOURCES, "const OFFER_ANOTHER_FILE =\n  ' Write a file and offer that path instead — one of the types this app holds, not empty, and no larger than a file of that type may be.'\n", "const OFFER_ANOTHER_FILE =\n  ' Use your Write tool to make a Markdown file and offer that path instead.'\n"),
        ],
    ),
    # ── §5 · the two readers ──────────────────────────────────────────────────────────────────
    (
        "M15 · 🔴 the transcript draws the quartet again · the row carries the act, the ledger keeps "
        "it, and the one reader HO-023 §2.2 is about renders four fields — a fix that stopped at the "
        "durable record, which is the shape `M9` of `405`'s own table caught one dispatch earlier",
        [(TRANSCRIPT, CLAUSE, "        }`,\n")],
    ),
    (
        "M16 · ⛔ the person is shown the code · a transcript row reads "
        "`ask-about-the-open-work-or-wait` at somebody, which is the vocabulary printed at a reader "
        "— and it draws a word a later build wrote as well, because a lookup that falls through has "
        "nothing left to fall through to",
        [(TRANSCRIPT, SAID, "  return typeof remedy === 'string' ? remedy : null\n")],
    ),
    (
        "M17 · ⚠️ the unknown word is drawn as itself · a promise this build cannot vouch for is "
        "printed into a sentence about a refusal, so a person is offered a gesture that may no "
        "longer exist — `421`'s defect, one surface over and one dispatch later",
        [(TRANSCRIPT, EMPTY, "  return remedy === undefined || remedy === null ? '' : ` · ${String(remedy)}`\n")],
    ),
    (
        "M18 · 🔴 two of the five clauses become one · the copy-paste a nine-rail map folded onto "
        "five words invites: a receiver with an open piece of work and a launch still settling read "
        "identically in the transcript, and nothing about either rail has changed. ⚑ The distinctness "
        "check is what this row exists to prove is carrying its rule",
        # ⚑ **Re-anchored by `429`** — the member was renamed and its clause rewritten. ⛔ The ROW is
        # unchanged: it makes two of the five clauses identical, which is exactly what the
        # distinctness check exists to catch. Re-verified RED individually.
        # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
        [(TRANSCRIPT, "  'shorten-the-summary-and-attach-the-long-form':\n    'it can shorten the summary and put the long form in a file it names',\n", "  'shorten-the-summary-and-attach-the-long-form':\n    'there is nothing to change — the same call again, once that has settled',\n")],
    ),
    (
        "M19 · ⛔ the raw stream drops the word · the Events tab is where a reader checks what the "
        "ROW carried, and the durable fact this dispatch added is the one field it does not show",
        [(DESCRIBE, RAW, "      } (ours)`\n")],
    ),
    (
        "M20 · ⚠️ the raw stream prints it unguarded · a word from a later build appears in the "
        "line, so the one place a reader goes to see what the app knows shows a promise the app "
        "cannot keep",
        [(DESCRIBE, RAW, "      }${event.remedy === undefined || event.remedy === null ? '' : ` · ${String(event.remedy)}`} (ours)`\n")],
    ),
    # ── §6 · the defect this dispatch's own review found ──────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The rail is retired, so its remedy
        # entry is gone. D-010 removed `'agent-already-has-a-message-waiting':
        # 'withdraw-the-work-or-ask-about-it'` from the TOOL_REMEDY map in agent-tools.ts. Its
        # anchor is left stale, so the census records it retired (`anchor-absent`).
        "M22 · 🔴 THE DEFECT THIS DISPATCH ALMOST SHIPPED, put back · "
        "`agent-already-has-a-message-waiting` promises *the same call, once this settles* — and "
        "`RuntimeHost.queueMessage`'s own ordering note says why that is a lie: **every held WORK "
        "message already has an open task of its own**, so when the mailbox drains the identical "
        "call meets `agent-already-has-work-open`, the very next rail. ⛔ A remedy naming an act the "
        "NEXT RAIL REFUSES is HO-023 §2.2's defect rebuilt inside the fix for it, and it reaches "
        "both readers. ⚠️ It was caught by reviewing this dispatch's own diff and by nothing else",
        [
            (
                TOOLS,
                # ⚑ **Re-anchored by `429`**, which renamed the word. ⛔ The ROW is unchanged — it
                # puts back the exact false promise this dispatch's own review caught — and `429`
                # makes it MORE false, not less: withdrawing is now a real act on this rail and the
                # replacement deletes it along with the ask. Re-verified RED individually.
                "  'agent-already-has-a-message-waiting': 'withdraw-the-work-or-ask-about-it',\n",
                "  'agent-already-has-a-message-waiting': 'make-the-same-call-when-this-settles',\n",
            )
        ],
    ),
    (
        "M21 · ⛔ the permanence adopts the remedy's rule · a word this build does not recognise is "
        "drawn as NOTHING rather than as itself, so a refusal made under a vocabulary that has moved "
        "tells a person a rule stopped their agent and refuses to say for how long. ⚑ The two guards "
        "are deliberately different and this row is the difference. ⚑ ANCHOR CORRECTED IN PLACE "
        "BY 466: the function moved from the renderer's transcript to `shared/refusals.ts` so a "
        "second reader — the digest fold, which is `main/` — could use the one table. Same "
        "bytes, same defect; only the file moved",
        [(REFUSALS, PERMANENCE_SAID, "  return isRailPermanence(permanence) ? PERMANENCE_SAID[permanence] : ''\n")],
    ),
]
