"""413 · words the person did not say — each row is THE DEFECT, put back (131).

🔴 **HO-020 §5.3 raised a display defect to an AUTHORITY defect.** ⚑ The PO's words, verbatim:

> ⛔ **"A PM acting on words the person did not say is acting on false authority, and `214`'s 12,646
> messages say this class does not stay small."**

## ⛔ What `410` counted, and the half the brief got wrong about it

⚠️ **`410` F2, on every run: *"1 unattributed turn on Codex, 2 on Claude, on the project
manager."*** The brief reads that as the residue of `routeRequest` — the one producer `406`
knowingly left unmarked. ⛔ **Only one of the two is.** `routeRequest` is the CLAUDE-only one (row
8 is *not performed* on Codex, so no question is ever routed there), and the turn that is
unattributed on BOTH is **`message_agent`** — the door every piece of work in this product goes
through.

| the fact | where it lives |
|---|---|
| `214` removed 12,646 messages that rendered injected material as *"You"* | `UserMessage.vue`'s own docblock |
| `278` built `ContinuationEntry.vue` so the go-ahead would not be one more | *"never `UserMessage.vue` with a badge"* |
| `406` built `WorkReportEntry.vue` for a reply and a stall notice | and named a fourth producer it did not mark |
| ⛔ a task one agent gives another was STILL the person's bubble | `agent-tools.ts` → `host.queueMessage(agent, text, by)` |

## ⚑ The shape of the fix, and therefore the shape of this table

⛔ **The marking stopped being per-producer.** `406` marked three call sites by hand, named a
fourth, and missed a fifth; `whoseWordsTheseAre` answers once, at the door, from WHO IS ASKING —
and **the default is the app's**. A turn is unmarked only when a WINDOW sent it, which is a
POSITIVE test: the next transport this host grows is app-authored by forgetting.

⚠️ **`§1` is that predicate and its two honest failure modes** — the tempting *"not the app and
not an agent"* (`M1`), and a decoder that stops being its encoder's inverse (`M2`, `M3`, `M32`).

⛔ **`§2` is the four doors and the held path**, which is where `406`'s own rule — *one writer for
both keys* — became a value carried whole rather than a pair rebuilt from a proxy.

⛔ **`§3` is the entry**, and the one thing it must not be: `ContinuationEntry` says *sent for
you*, which is the OPPOSITE of true here and is exactly why `406` refused to mark `routeRequest`
without building this.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M21`, `M30`–`M32`, `M34`, `M35` | ⚑ **`run_suite`** — `apps/desktop/test/words-the-person-did-not-say.test.ts` |
| `M22`–`M29` | ⚑ **`run_dom`** — `apps/desktop/test/dom/relayed-turn.dom.test.ts` |
| `M33` | ⚑ **`run_suite`** — `apps/desktop/test/opening-line.test.ts` |

⚠️ **Every row was applied ALONE and watched go red against the file named here**, before the
table existed — `verify-each-mutation-row-without-running-the-table`. ⛔ No table was run.

🔴 **Two rows survived the first pass, and both were coverage rather than bad rows.**

 - ⛔ **`M20`** — the mode test called `isVisibleIn('relayed', 'normal')`. The signature is
   `(mode, item)`, so `'normal'` arrived where an item belongs, `item.kind` read `undefined`, and
   the switch fell to its `default: return true`. **Both assertions were satisfied by the default
   arm of the switch the row had just mutated out**, and `pnpm run typecheck` — which refuses both
   arguments — had not been run since the file was written.
 - ⛔ **`M32`** — the one-spelling census SKIPS `window-caller.ts`, which is where the row hides,
   and no behavioural test can tell the constant from the literal because both produce
   `webContents:7`. ⚑ The excluded file is now asserted from the inside, by COUNT.

⚑ **`M33`–`M35` came from the by-hand adversarial pass over this diff**, not from the table: a
regression this dispatch would have shipped silently (the rail label) and a defect `406` reported
and nobody closed (an ending settling the wrong held row).

## ⛔ What this table deliberately does NOT contain

⛔ **No row deleting `relayedFrom` from the wire, `RelayedItem` from the union, or the `v-else-if`
from `TranscriptView`.** Each is a compile error, and `a-mutation-on-a-census-is-invisible-to-that-census`
is the other half: the §1 census reads the source it would have to mutate.

⛔ **No row on `sendInterrupting`'s BEHAVIOUR.** Nothing in the product reaches it as anything but
a window, so a behavioural row there would be measured where both readings agree
(`a-comparison-tested-where-both-sides-agree`). ⚑ `M9` deletes its marking and the SOURCE census
is what kills it, which is the honest instrument for a door a caller cannot yet be wrong about.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
WINDOW = "apps/desktop/src/main/runtime/window-caller.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
MAILBOX = "apps/desktop/src/main/runtime/queued-message.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"
WORDS = "apps/desktop/src/renderer/src/lib/relayed-turn.ts"
ENTRY = "apps/desktop/src/renderer/src/components/RelayedEntry.vue"
QUEUED = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
VIEW = "apps/desktop/src/renderer/src/components/TranscriptView.vue"
STREAM = "apps/desktop/src/renderer/src/lib/describe-event.ts"
RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
# ⚑ ANCHOR CORRECTED IN PLACE BY 687: `sendAs` now passes the caller's declaration (`678` H1).
# The defect each row plants — the sent turn losing its authorship — is unchanged.
SEND_SPREAD = "      ...whoseWordsTheseAre(by, this.profileOf, facts, declared),\n"
# ⚑ ANCHOR CORRECTED IN PLACE BY 687: the held rows spread the entry's authorship too since R22, so the flush's line is no
# longer unique alone; it is named with the comment that follows it. The row is unchanged.
# ⛔ **The tail is a WHOLE comment prefix, and every replacement re-emits it** (`687`'s review): an
# anchor that ends inside a comment and a replacement that drops it leaves the comment's remainder as
# bare code, and the mutant is a parse error rather than the row's defect.
FLUSH_TAIL = "      // 🔴 **671 · the task rides the held message to the turn it becomes**"
FLUSH_SPREAD = "      ...queued.authorship,\n" + FLUSH_TAIL
# ⚑ ANCHOR CORRECTED IN PLACE BY 687: the entry's authorship now carries the caller's declaration (`678` H1).
MAILBOX_VALUE = "      authorship: whoseWordsTheseAre(by, this.profileOf, facts, says),\n"
# ⚑ ANCHOR CORRECTED IN PLACE BY 657: the held row now spreads the mailbox entry's own authorship rather
# than re-reading it after the push (`650` F5). The defect this row plants — the row losing its
# subject — is unchanged; re-verified RED by hand.
# ⚑ ANCHOR CORRECTED IN PLACE BY 687: `heldAuthorship` is gone (R22) and the held row spreads the entry's authorship
# whole. The defect this row plants — the held row losing its subject — is unchanged.
QUEUED_ROW = "      ...held.authorship,\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the predicate, and the default it decides ────────────────────────────────────────
    (
        "M1 · 🔴 the dangerous default, put back · *not the app and not an agent* reads as *a "
        "person*, so every caller this host does not have yet ships as the person. ⛔ `THE_APP_ITSELF`'s "
        "own docblock names the next one — *tomorrow the MCP tool a PM would spawn agents through* "
        "— and this is the whole of §3: the default must be the app's",
        [
            (
                HOST,
                "  return by !== THE_APP_ITSELF && aWindowIsAsking(by.ownerId)\n",
                "  return by !== THE_APP_ITSELF && sessionSpeakingAs(by) === null\n",
            )
        ],
    ),
    (
        "M2 · ⛔ a bare prefix names a window · `webContents:` with nothing after it is no window at "
        "all, and admitting it makes the empty suffix a person. ⚑ `sessionSpeakingAs` refuses the "
        "same shape one prefix over, and this is that rule not copied",
        [
            (
                WINDOW,
                "  return ownerId.startsWith(WINDOW_CALLER_PREFIX) && ownerId.length > WINDOW_CALLER_PREFIX.length\n",
                "  return ownerId.startsWith(WINDOW_CALLER_PREFIX)\n",
            )
        ],
    ),
    (
        "M3 · 🔴 the decoder stops being the encoder's inverse · every non-empty caller id is a "
        "window, so an AGENT's words go out as the person's — the shipped defect, reached from the "
        "predicate instead of from the door",
        [
            (
                WINDOW,
                "  return ownerId.startsWith(WINDOW_CALLER_PREFIX) && ownerId.length > WINDOW_CALLER_PREFIX.length\n",
                "  return ownerId.length > 0\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the relay is never derived from the caller · `message_agent`'s turn keeps its "
        "authorship and loses its SUBJECT, so a task one agent gave another is drawn under the "
        "go-ahead's *sent for you* — `406`'s stated falsehood, arriving through the producer it "
        "did not know about",
        [
            (
                HOST,
                "  const wroteIt = carriedFor ?? sessionSpeakingAs(by) ?? undefined\n",
                "  const wroteIt = carriedFor ?? undefined\n",
            )
        ],
    ),
    (
        "M5 · ⛔ the belt goes · a caller that hands over a report from a window publishes it "
        "UNMARKED — `406`'s own hazard (*a turn carrying `work` and no `attribution` renders as the "
        "person's own bubble with the facts attached*) coming back through the door the new default "
        "opened. ⚠️ Tested where the two readings DIVERGE: no call site does this today",
        [
            (
                HOST,
                # ⚑ **RE-POINTED at 624, not retired** — `appNotice` joined the conjunction as a
                # third subject and prettier reflowed it onto five lines. ⛔ The row's subject and
                # its defect are unchanged: the belt goes, and a report from a window publishes
                # UNMARKED. `correct-a-stale-mutation-anchor-dont-retire-it`.
                "    report === undefined &&\n"
                "    wroteIt === undefined &&\n"
                "    appNotice === undefined &&\n",
                "    wroteIt === undefined &&\n"
                "    appNotice === undefined &&\n",
            )
        ],
    ),
    (
        "M6 · 🔴 a routed question loses its subject · the caller is the APP, so a relay derived "
        "from `by` alone is absent — and the turn falls through to the go-ahead's entry. ⚑ This is "
        "the one sample where *derive it* and *pass it* give different answers",
        [
            (
                HOST,
                "  const wroteIt = carriedFor ?? sessionSpeakingAs(by) ?? undefined\n",
                "  const wroteIt = sessionSpeakingAs(by) ?? undefined\n",
            )
        ],
    ),
    (
        "M7 · ⛔ the question is attributed to the conversation it was DELIVERED to · the parent is "
        "named as the author of its own child's question, which is an invented actor made out of "
        "the wrong id — `413` §4's *unless the ledger holds that name*, holding the wrong one",
        # A relayed question names the child that asked, not the parent receiving it. The carriedFor
        # mutation deliberately names the parent and must be caught by the authorship test.
        [
            (HOST, '        { carriedFor: asked, ...about },\n      )', '        { carriedFor: parent, ...about },\n      )'),
        ],
    ),
    # ── §2 · the four doors and the held path ─────────────────────────────────────────────────
    (
        "M8 · 🔴 the sent door stops asking · the shipped defect, put back at the place `410` "
        "measured it: a task one agent gives another arrives as a plain `user_turn` and is drawn "
        "under `<strong>You</strong>` with the person's own avatar",
        [(HOST, SEND_SPREAD, "")],
    ),
    (
        "M9 · ⛔ the INTERRUPTING door stops asking · nothing in the product reaches it as anything "
        "but a window today, so this row is caught by the SOURCE census rather than by a sample — "
        "which is the point: *right by accident* is what a shared writer exists to stop being the "
        "reason",
        [(HOST, "      ...whoseWordsTheseAre(by, this.profileOf),\n", "")],
    ),
    (
        "M10 · 🔴 the FLUSH rebuilds instead of spreading · *a report is present, therefore the app "
        "sent this* is `406`'s reasoning, and it is right for the two producers `406` had and wrong "
        "for the two it did not. ⛔ A held question or a held task flushes as the person's",
        # A flushed held message keeps the carried entry’s authorship, rather than re-deriving it
        # from the receiver. The mutation targets that surviving assignment and the authorship
        # tests.
        [
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Preserve the original defect, ID and killer at the formatted keyed-handoff boundary. No plant or table run. Held: running it needs W4 written lift.
            (HOST, "        ...queued.authorship,\n        // 🔴 **671 · the piece rides the held message to the turn it becomes**", "        ...(queued.authorship.work === undefined\n          ? {}\n          : { attribution: 'app_authored' as const, work: queued.authorship.work }),\n        // 🔴 **671 · the piece rides the held message to the turn it becomes**"),
        ],
    ),
    (
        "M11 · ⛔ the mailbox does not hold it · one layer under `M10`: the held message keeps its "
        "text and its attachments and loses whose words they are, so nothing at the flush — and "
        "nothing at any of the three endings — has an answer to give",
        # The held entry must record whose words it contains, or they can later be read as the
        # person’s own. Store empty authorship to plant that defect; the attribution test must
        # reject it.
        [
            (HOST, '      authorship: whoseWordsTheseAre(by, this.profileOf, facts, says ?? undefined),\n', '      authorship: {},\n'),
        ],
    ),
    (
        "M12 · ⛔ the held ROW is the person's for the length of a turn · `message_queued` carries "
        "no subject, so a task waiting behind a running turn sits in the transcript under *You* "
        "with a **Cancel it** button on it — and then silently becomes somebody else's row",
        # message_queued must publish the held entry’s full authorship, not only attach it to the
        # eventual turn. The spread occurs at several writers, so use the busy-mailbox context to
        # make the anchor unique. Dropping the spread must be caught by the authorship and
        # final-question tests.
        [
            (HOST, "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n      ...held.authorship,\n", "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n"),
        ],
    ),
    (
        "M13 · ⚠️ the held row claims an authorship it has not earned · `message_queued` is not a "
        "turn — `045` opens a turn row from `user_turn` and from nothing else — so a row saying "
        "BroBot wrote something that has not been sent is the ledger asserting a send "
        "⛔ RETIRED BY 687 — R22 MADE THE MUTATION THE RULE; THE INVERSE IS `687` M4",
        # 🔴 **RETIRED BY 687 — R22 MADE THE MUTATION THE RULE; THE INVERSE IS `687` M4.** ⛔ This
        # row planted *the held row carries `attribution`*, and the PM's ruling R22 (`670` F-a) is
        # exactly that: a held go-ahead's authorship IS `attribution` with no subject, and taking it
        # off drew BroBot's words as the person's queued message. ⚑ `heldAuthorship` is gone and
        # the held rows carry the authorship whole, so this anchor has no subject left to name —
        # and `687` M4 plants the removal and is killed by it.
        [
            (
                HOST,
                "  const { attribution: _whoWroteIt, ...subject } = whose\n  void _whoWroteIt\n  return subject\n",
                "  return whose\n",
            )
        ],
    ),
    (
        "M14 · ⛔ an ENDING with no beginning is rebuilt as the person's · `054` pages the "
        "transcript, so a window can hold `message_unqueued` without ever seeing the queueing. ⚑ "
        "The TEARDOWN abandon, because a person can no longer cancel one of these and a row nothing "
        "can drive is a row that survives",
        # ⚑ **Anchor CORRECTED by `638`, not retired** — `correct-a-stale-mutation-anchor-dont-retire-it`.
        # ⛔ **The SUBJECT did not move**: `abandonQueued` still publishes `message_unqueued:'abandoned'`
        # with `heldAuthorship`, and this row still removes it. ⚠️ What moved is the METHOD'S TAIL —
        # `638` added `if (abandoned.length > 0) this.theWorldMoved('work')` after the loop, so the
        # anchor's trailing `  }` is no longer adjacent. ⚑ Shortened to the loop's own close, which is
        # unique. 🔴 **Re-verified RED by hand against its own killer file.**
        [
            (
                HOST,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 687: `heldAuthorship` is gone (R22); the teardown ending spreads the
                # authorship whole. The row — the ending losing its subject — is unchanged.
                "        ...queued.authorship,\n      })\n    }\n",
                "      })\n    }\n",
            )
        ],
    ),
    # ── §3 · the fold, and the entry it picks ─────────────────────────────────────────────────
    (
        "M15 · 🔴 the fold ignores the relay · the event says another conversation wrote it and the "
        "transcript draws the go-ahead's entry — *sent for you*, under `278`'s authorship line, "
        "over a child's question. ⛔ Exactly the falsehood `406` refused to ship",
        [
            (
                FOLD,
                # ⚑ **545 re-anchored**: the arm carries the relayer's identity and wrapped.
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the relayed turn's call now also hands `says` (`687` H1) and wrapped; the row's defect is unchanged.
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Remove only the relay dispatch arm; the new navigation argument does not change its subject.
                "      else if (wasRelayed(event.relayedFrom))\n        appendRelayedTurn(\n          state,\n          event.text,\n          relayerIdentity(event.relayedFromProfile),\n          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n          isAgentMessageKind(event.says) ? event.says : undefined,\n          event.relayedFrom,\n        )\n",
                "",
            )
        ],
    ),
    (
        "M16 · ⛔ the relay is read BEFORE the report · a reply that also named its author would "
        "draw as a bare relay and lose the outcome, the number and the mark `406` exists for. ⚠️ "
        "Nothing produces both today, which is why the ORDER is asserted rather than assumed",
        [
            (
                'apps/desktop/src/renderer/src/lib/transcript.ts',
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the relayed turn's call now also hands `says` (`687` H1) and wrapped; the row's defect is unchanged.
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Reverse the same report/relay priority, preserving all current arguments on each branch.
                "      if (isAWorkReport(event.work))\n        appendWorkReport(\n          state,\n          event.text,\n          event.work,\n          wasRelayed(event.relayedFrom)\n            ? {\n                relayedFromProfile: relayerIdentity(event.relayedFromProfile),\n                relayedFrom: event.relayedFrom,\n              }\n            : null,\n        )\n      else if (wasRelayed(event.relayedFrom))\n        appendRelayedTurn(\n          state,\n          event.text,\n          relayerIdentity(event.relayedFromProfile),\n          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n          isAgentMessageKind(event.says) ? event.says : undefined,\n          event.relayedFrom,\n        )\n",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the relayed turn's call now also hands `says` (`687` H1) and wrapped; the row's defect is unchanged.
                "      if (wasRelayed(event.relayedFrom))\n        appendRelayedTurn(\n          state,\n          event.text,\n          relayerIdentity(event.relayedFromProfile),\n          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n          isAgentMessageKind(event.says) ? event.says : undefined,\n          event.relayedFrom,\n        )\n      else if (isAWorkReport(event.work))\n        appendWorkReport(\n          state,\n          event.text,\n          event.work,\n          wasRelayed(event.relayedFrom)\n            ? {\n                relayedFromProfile: relayerIdentity(event.relayedFromProfile),\n                relayedFrom: event.relayedFrom,\n              }\n            : null,\n        )\n",
            ),
        ],
    ),
    (
        "M17 · ⛔ the guard becomes a truthiness check · replay is a trust boundary and "
        "`boundStoredEvent` has no arm for this key, so a row edited on disk decides which entry a "
        "person reads with `{}`. ⚑ `406`'s `isAWorkReport` lesson, one field over",
        [
            (
                FOLD,
                "  return typeof relayedFrom === 'string' && relayedFrom.length > 0\n",
                "  return relayedFrom !== undefined\n",
            )
        ],
    ),
    (
        "M18 · ⛔ the held row loses its subject in the FOLD · the event carries it and the item "
        "does not, so `QueuedMessage` has nothing to key on and falls back to *You* with both "
        "controls — `M12` one layer nearer the screen",
        [
            (
                FOLD,
                # ⚑ **545 re-anchored, and SHORTENED to the span the defect needs.** The flag is
                # what `QueuedMessage` keys the entry on, so dropping it alone is this row's whole
                # subject; the line after it disambiguates the queued arm from the rebuild arm,
                # which is what the old six-line tail was doing.
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Drop only the held-row relay flag; preserve newly added navigation data so the defect remains lost subject.
                "        ...(wasRelayed(event.relayedFrom)\n          ? { relayed: true as const, ...relayNavigation(event.relayedFrom) }\n          : {}),\n        // ⚑ **545 · and WHO, which is the same row's other question** — see\n",
                "        ...(wasRelayed(event.relayedFrom)\n          ? relayNavigation(event.relayedFrom)\n          : {}),\n        // ⚑ **545 · and WHO, which is the same row's other question** — see\n",
            )
        ],
    ),
    (
        "M19 · ⛔ the REBUILD loses it · the branch that never saw the queueing draws a task one "
        "agent gave another as the person's own bubble, and offers their words back to the composer",
        [
            (
                FOLD,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Drop only the rebuilt-row relay flag, preserving its report and navigation fields.
                "        ...(isAWorkReport(event.work) ? { report: event.work } : {}),\n        // ⚑ **413, the same hazard one subject over** — and the one that offers the words back.\n        ...(wasRelayed(event.relayedFrom)\n          ? { relayed: true as const, ...relayNavigation(event.relayedFrom) }\n          : {}),\n",
                "        ...(isAWorkReport(event.work) ? { report: event.work } : {}),\n        // ⚑ **413, the same hazard one subject over** — and the one that offers the words back.\n        ...(wasRelayed(event.relayedFrom)\n          ? relayNavigation(event.relayedFrom)\n          : {}),\n",
            )
        ],
    ),
    (
        "M20 · ⛔ the row is hidden in `normal` · a task arrives in a conversation and leaves NO "
        "trace on the surface a person reads, which is worse than the defect it replaces: at least "
        "the bubble was there to be misread",
        [(MODE, "    case 'relayed':\n      return true\n", "    case 'relayed':\n      return false\n")],
    ),
    (
        "M21 · ⚠️ the turn is not counted · a task is the turn every file the child touches is "
        "written under, so a scope axis that skips it files that work under the previous prompt — "
        "`096`'s axis, silently wrong for the commonest turn in the product",
        [
            (
                FOLD,
                # ⚑ **545 re-anchored**: the push gained the relayer's identity and wrapped, so
                # the anchor takes the last line of THAT push rather than a bare closing brace.
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the push gained `says` (`687` H1) as its last spread; the row — the turn not counted — is unchanged.
                "    ...(says === undefined ? {} : { says }),\n  })\n  state.changes.turn += 1\n",
                "    ...(says === undefined ? {} : { says }),\n  })\n",
            )
        ],
    ),
    # ── §4 · the component, where a person actually meets it ──────────────────────────────────
    (
        "M22 · 🔴 the heading is *You* again · the entry exists and says the one thing it was built "
        "not to say. ⚠️ Asserted on the HEADING rather than on the row, because `406` learned that "
        "a `toContain` over a whole row is satisfied by a neighbouring element",
        [
            (
                'apps/desktop/src/renderer/src/components/RelayedEntry.vue',
                '<span data-cy="relayed-sender">{{ sender }}</span>',
                '<span data-cy="relayed-sender">You</span>',
            ),
        ],
    ),
    (
        "M23 · ⛔ the mark says *sent for you* · the go-ahead's line, over a child's question — one "
        "word answering two questions (`395`), and the exact sentence `406` refused to put here",
        [(WORDS, "export const RELAYED_MARK = 'from another conversation'\n", "export const RELAYED_MARK = 'sent for you'\n")],
    ),
    (
        "M24 · ⛔ the avatar is the person's · *a dashed edge reads as `this is not the person` at a "
        "glance, before any label is read* — `ContinuationEntry`'s own argument, and the half that "
        "works for somebody scrolling past",
        [
            (
                ENTRY,
                '      <svg class="icon"><use href="#i-bot" /></svg>\n',
                '      <svg class="icon"><use href="#i-user" /></svg>\n',
            )
        ],
    ),
    (
        "M25 · ⚠️ the avatar stops being dashed · the same signal, one property over: solid is what "
        "the PERSON's avatar is, so the two rows become one shape with different words",
        [(ENTRY, "  border: 1px dashed var(--line-strong);\n", "  border: 1px solid var(--line-strong);\n")],
    ),
    (
        "M26 · ⛔ the mark is rendered INSIDE the body · `001`'s rule inverted: the message's "
        "`textContent` stops being exactly what went to the provider, so a copy, a search and every "
        "assertion get words nobody sent",
        [
            (
                'apps/desktop/src/renderer/src/components/RelayedEntry.vue',
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The same mark remains outside the body; omit it there before placing it inside the raw/readable words.
                "      <span class=\"about\" data-cy=\"relayed-mark\">{{ RELAYED_MARK }}</span>\n",
                "",
            ),
            (
                'apps/desktop/src/renderer/src/components/RelayedEntry.vue',
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 636446c24 added readable words; put the mark inside both views of the same message, preserving the old body-contamination meaning.
                "      <MarkdownWords v-if=\"view === 'readable'\" :text=\"item.text\" />\n      <template v-else>{{ item.text }}</template>\n",
                "      <MarkdownWords v-if=\"view === 'readable'\" :text=\"item.text\" />\n      <template v-else>{{ item.text }}</template>\n      <span class=\"about\" data-cy=\"relayed-mark\">{{ RELAYED_MARK }}</span>\n",
            ),
        ],
    ),
    (
        "M27 · 🔴 the person-only controls come back on a row nobody typed · **Cancel it** destroys "
        "a task `message_agent` has already told the assigning agent was accepted, with no rail "
        "anywhere that mints it again; **Put it back in the composer** loads another MODEL's words "
        "into the person's draft to be sent under their name. ⚑ `406` closed this for a report; "
        "this is the half that reaches every task",
        [
            (
                QUEUED,
                # ⚑ **RE-POINTED at 624, not retired** — the gate grew a third disjunct (the
                # app's own notice, `HO-095` §6.2) and wrapped. ⛔ The row's subject is unchanged:
                # the relayed arm goes and the person-only controls come back on a task one agent
                # gave another. `correct-a-stale-mutation-anchor-dont-retire-it`.
                "    props.item.relayed === true ||\n",
                "    false ||\n",
            )
        ],
    ),
    (
        "M28 · ⛔ the HELD task is the person's · `QueuedMessage` falls back to *You* while a task "
        "waits behind a running turn, which is the window a person is actually watching",
        [
            (
                QUEUED,
                # ⚑ **545 re-anchored**: the relayed arm asks the one naming function.
                # ⚑ **624 re-anchored again**: the relayed arm became an early `return` when the
                # app's own notice took the tail of the ternary (`HO-095` §6.1). ⛔ The row's
                # subject is unchanged — the HELD task falls back to *You* — and it is now the
                # narrower claim, because the app's own arm survives the mutation.
                "  if (props.item.relayed === true)\n    return relayedSender(props.item.relayedFromProfile, props.identities ?? null)\n",
                "",
            )
        ],
    ),
    (
        "M29 · ⛔ the held row shows no mark · the heading changes and nothing says WHY, so the row "
        "reads as BroBot's own words rather than as somebody else's carried here — and it stops "
        "saying the same thing as the turn it becomes",
        [
            (
                'apps/desktop/src/renderer/src/components/QueuedMessage.vue',
                '          <span v-else-if="item.relayed" class="about" data-cy="queued-about">{{\n            RELAYED_MARK\n          }}</span>\n',
                '',
            ),
        ],
    ),
    # ── §5 · the raw stream, and the one place the id is printed ──────────────────────────────
    (
        "M30 · ⛔ the raw stream says BroBot wrote it · false of a relayed turn, whose words are a "
        "model's — in the surface a debugger trusts most. ⚑ And the id goes with it, which is "
        "`413` §4's other half: the LEDGER is where the name lives",
        [
            (
                STREAM,
                # ⚑ **545 re-anchored**: the line names the relayer's identity beside the id.
                "          : event.relayedFrom !== undefined\n            ? `(relayed from ${event.relayedFrom}${relayer(event.relayedFromProfile)})`\n",
                "",
            )
        ],
    ),
    (
        "M31 · ⚠️ the HELD row's line drops it · the row a reader meets first whenever the target "
        "is busy, which is the ordinary case for work",
        [
            (
                STREAM,
                # ⚑ **545 re-anchored**: the held line names the relayer's identity too.
                "      return `${event.text.length} chars · waiting${\n        event.relayedFrom === undefined\n          ? ''\n          : ` · relayed from ${event.relayedFrom}${relayer(event.relayedFromProfile)}`\n      } (ours)`",
                "      return `${event.text.length} chars · waiting (ours)`",
            )
        ],
    ),
    (
        "M32 · ⛔ the prefix is spelled twice · `sessionSpeakingAs`'s own rule, broken: *it lives "
        "beside the encoder so the two spellings cannot drift apart, which is the only reason a "
        "prefix scheme is safe to depend on*. ⚑ A literal in `ipc.ts` is exactly the state `413` "
        "found and removed",
        [
            (
                WINDOW,
                "  return `${WINDOW_CALLER_PREFIX}${contents.id}`\n",
                "  return `webContents:${contents.id}`\n",
            )
        ],
    ),
    # ── §6 · the two the by-hand pass over this diff found ────────────────────────────────────
    (
        "M33 · 🔴 the rail loses every spawned conversation's NAME · the cue keys on *no "
        "attribution at all*, and `413` made a worker's first turn `app_authored` — so the row a "
        "person picks a worker out of a list by goes blank, and so does the command palette's "
        "detail line. ⚑ The regression this dispatch would have shipped in silence: no test in it "
        "touched that surface",
        [
            (
                RECORD,
                "    message.event.attribution !== 'provider_transcript'\n",
                "    message.event.attribution === undefined\n",
            )
        ],
    ),
    (
        "M34 · 🔴 an ending settles the row it did NOT name · `394` made the mailbox hold a work "
        "message AND a question, and the fold answered *the last unresolved one*. ⛔ Sending the "
        "work splices out the QUESTION's row — a child's question vanishes from the one surface a "
        "person reads it on, and the message that HAS gone says *not sent* for ever. ⚑ `406` "
        "reported this and nobody closed it",
        [
            (
                FOLD,
                "    if (messageId !== undefined && item.messageId === messageId) return item\n    if (item.messageId === undefined) unnamed ??= item\n",
                "    return item\n",
            )
        ],
    ),
    (
        "M35 · ⛔ the row carries no name to be found by · one layer under `M34`: the lookup is "
        "sound and there is nothing for it to match, so every ending falls back to position again",
        [
            (
                FOLD,
                "        ...(event.messageId === undefined ? {} : { messageId: event.messageId }),\n        ...(event.attachments ? { attachments: event.attachments } : {}),\n",
                "        ...(event.attachments ? { attachments: event.attachments } : {}),\n",
            )
        ],
    ),
]
