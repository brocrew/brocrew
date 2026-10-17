#!/usr/bin/env python3
"""214's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **All three sections came from one hour of a person using the app** (`213`), and none of the
project's 26 live instruments or 4,379 unit tests had found any of them. §1 in particular had been
provably true for six dispatches and nobody could reach it: `011` proved the export byte-identical,
`027` proved 2,500 gap-free frames, `089` wrote `importBundle` — and `194` H4, reviewing that very
method, recorded *"`importBundle` has no production caller at this HEAD."*

The rows fall into four groups:

  * `M1`-`M8`   §3 · one answer to *"what can this card do"*, for the overview and the card alike.
  * `M9`-`M14`  §2 · which words on the adoption path are the person's, and which are the harness's.
  * `M15`-`M23` §1 · the return path: the fact, the refusal, the placement, and the door.
  * `M24`-`M25` §1 · the reader's own sentences — a refusal that does not say WHY is 118's defect.
  * `M27`       §1 · 🔴 the self-contradicting bundle, found by the LIVE SMOKE on a file this
                dispatch built by hand — see `read-bundle.ts`'s `headerDisagreesWithLedger`.
  * `M28`-`M40` ⛔ **the adversarial review of this dispatch's own diff** — sixteen findings, of
                which these are the ones a table can hold. See the response's §5.
  * `M26`       criterion 8's new live step, whose verdict must be data (`206` H1).

## ⛔ Seven rows RETIRED by this dispatch, and what replaced each one

`mutations:check` reported seven stale anchors. ⚠️ **A stale row protects nothing, so retiring one
silently is how coverage disappears** — the shape `coverage-that-jumps-over-the-middle` warns about.
Each is named here with the row that takes it over:

  | retired | it protected | replaced by |
  |---|---|---|
  | `154` M9  | the library READS `foundInUserHome` rather than re-deriving it | `M21` |
  | `154` M10 | …and asks at all, instead of calling every row `ours`         | `M22` |
  | `205` M15 | a multi-select question gets no one-click options             | `M3`  |
  | `205` M16 | …nor does a secret one                                        | `M4`  |
  | `205` M17 | Reject survives on a question this surface cannot answer      | `M5`  |
  | `209` M23 | a pure GRANT does not fall through to the question branch     | `M6`/`M7` |
  | `209` M25 | zero questions map to `no-question` rather than `multiple`    | ⛔ **deliberately gone** |
  | `154` M1  | the rail's drop exists at all                                 | `M41` |
  | `154` M2  | …and does not drop the whole unresumable half                 | `M42` |
  | `154` M3  | …and is READ off the row rather than re-derived (032)         | `M43` |

⛔ **`209` M25 is the one with no replacement, because it protected the defect.** `207` M1 fixed the
row's SENTENCE — it used to say *"asks more than one question"* about a request that asks none — and
kept the premise that such a request cannot be answered from here. `213` found that premise printed
under *"asks you to approve its plan"*. `M1` asserts the opposite of what M25 protected, on purpose.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **The native FILE PICKER.** `M23` kills the field-and-button path, which is the half a test can
    drive; `app:choose-bundle` opens an OS dialog in the main process and no instrument in this
    repository — unit, dom or live — can click one. ⚠️ **That is why the typed field is not a
    convenience but the primary input**, exactly as `076` §3 settled for the cwd. The picker's
    contract (null means cancelled, and cancelling must not blank a typed path) IS asserted, against
    a stubbed bridge, in `dom/library-restore.dom.test.ts`.
  * ⛔ **Whether a bundle from a genuinely DIFFERENT machine restores.** Every test here exports and
    re-imports on one filesystem, with the ref rewritten to stand in for a stranger's. What a bundle
    that crossed an OS, a path separator or a provider version does is not measured by anything.
  * ⛔ **`194` H4's freshness gap, which this dispatch does NOT close.** `importBundle` de-duplicates
    on the provider's ref and compares no extent, so a bundle exported after a SECOND life comes back
    as a duplicate and its newer half is discarded. `M20` kills the disclosure — the app must not
    claim a restore it did not perform — and nothing here can kill the loss itself, because the app
    has no way to detect it. It is §1's named left work.
  * ⛔ **`MAX_BUNDLE_BYTES`.** 128 MB is a refusal nothing in `pnpm run ci` can afford to trigger, and
    a test that stubbed `statSync` would be asserting over its own stub. The ceiling is stated in the
    source and in the response; it is not asserted anywhere.
  * ⛔ **Whether the live step `11c` READS anything.** `M26` kills the SHAPE of its verdict, which is
    what `scripts` can decide from the source. What that step observes is live-only, and `196`'s
    standing edge applies: **no project executes a live step.**
  * ⛔ **The 1,526 real messages §2 reclassifies.** The rules were measured against 7,305 messages in
    120 rollouts under `~/.codex/sessions`, and the tests assert trimmed copies of those exact
    shapes. A test that walked the machine's own corpus would pass or fail by whose laptop it ran on.
  * ⛔ **`209` §4's three gated items and `scripts/mutations/lib/`.** Untouched, deliberately.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"
ATTN = "apps/desktop/src/renderer/src/lib/attention.ts"
CARD = "apps/desktop/src/renderer/src/components/UserInputCard.vue"
INJECTED = "apps/desktop/src/main/archive/codex-injected.ts"
CODEX = "apps/desktop/src/main/archive/import-codex.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
LIB = "apps/desktop/src/main/library/session-library.ts"
READER = "apps/desktop/src/main/archive/read-bundle.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
LIBRARY = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
SMOKE = "scripts/ui-live-smoke.mjs"
NORM = "apps/desktop/src/main/archive/normalizer.ts"
RAIL = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
FACETS = "apps/desktop/src/renderer/src/lib/library-filters.ts"
CONVERSATION_LIST = "apps/desktop/src/renderer/src/lib/conversation-list.ts"

MUTATIONS = [
    # -------------------------------------------------- §3 · one answer, for every surface
    (
        "M1  · ⛔ THE DEFECT, verbatim · a request that asks NOTHING is not approvable — 213's plan "
        "card, with Reject as the only thing on offer (replaces the premise 209 M25 protected)",
        [(OFFER, "  if (questions.length === 0) {", "  if (questions.length === 0 && false) {")],
    ),
    (
        "M2  · §3 · the positive control says Answer on a request that asks nothing, so the word "
        "and the buttons beside it disagree again",
        [(OFFER, "      positive: 'Approve',", "      positive: 'Answer',")],
    ),
    (
        "M3  · ⛔ 205 M15, moved · a MULTI-SELECT question gets one-click options, so one click "
        "sends one answer to a question that asked for several and calls it the answer",
        [(OFFER, "  if (only.multiSelect === true) return 'multi-select'\n", "")],
    ),
    (
        "M4  · ⛔ 205 M16, moved · …and a SECRET one does too, so the provider's sensitive answer "
        "goes on a dashboard",
        [(OFFER, "  if (only.secret === true) return 'secret'\n", "")],
    ),
    (
        "M5  · ⛔ 205 M17, moved · Reject disappears from a question this surface cannot answer, so "
        "a row that can do nothing at all is offered — 106's defect exactly",
        # ⚑ **728 · re-anchored in place, not retired** — 728 builds a server's own reject beside REJECT; the row still takes Reject away from a question this surface cannot answer
        [(OFFER, "        : [reject],", "        : [],")],
    ),
    (
        "M6  · ⛔ 209 M23's remainder · the projection stops reading the shared offer and decides "
        "for itself again, so Home and the card can come apart a second time",
        [(ATTN, "        decisions: offer.decisions,", "        decisions: [{ kind: 'reject' as const, label: 'Reject' }],")],
    ),
    (
        "M7  · ⛔ 209 M23's other half · a pure GRANT's scope is never drawn, so the row offers an "
        "Approve with nothing a person could weigh",
        [(ATTN, "            ? grantScopeLines(grant)", "            ? []")],
    ),
    (
        "M8  · ⛔ §3's altitude · the CARD holds its own copy of the rule again — the exact line "
        "that was right while the overview was wrong, and the reason nothing went red",
        # ⚑ **Anchor corrected by 482, meaning unchanged.** The word is now the `<strong>` half of
        # a two-line control — the line under it says what the press does — so the row puts the
        # card's own copy of the rule back in the element that holds the word.
        [
            (
                CARD,
                "          <strong>{{ offer.positive }}</strong>",
                "          <strong>{{ questions.length > 0 ? 'Answer' : 'Approve' }}</strong>",
            )
        ],
    ),
    # ------------------------------------ §2 · whose words these are on the adoption path
    (
        "M9  · ⛔ THE DEFECT, verbatim · every non-assistant role speaks in the user's name again — "
        "822 `developer` lines rendered as \"You (per the transcript)\" (213 finding 2)",
        [(INJECTED, "  if (role !== 'user') return { injected: true, said: null }", "  if (false) return { injected: true, said: null }")],
    ),
    (
        "M10 · ⛔ §2 · the CLI's own separator is ignored, so the ambient block and the person's "
        "request come back as one bubble and the prompt is buried under it again",
        [(INJECTED, "  if (marker !== -1) {", "  if (false) {")],
    ),
    (
        "M11 · ⛔ §2 · a preamble the CLI closed with <environment_context> is the user speaking — "
        "484 of them in the measured corpus",
        [(INJECTED, "  if (text.trimEnd().endsWith(ENVIRONMENT_CLOSE)) return { injected: true, said: null }\n", "")],
    ),
    (
        "M12 · ⛔ §2 · the split's answer is thrown away and the whole line becomes a user turn — "
        "the importer ignoring the classifier it calls",
        [(CODEX, "      if (parts.said !== null) {", "      if (true) {")],
    ),
    (
        "M13 · ⚠️ §2's OTHER failure · the injected half is DROPPED instead of kept as chatter, so "
        "an injection stops being visible at all — 086 in the direction that is easy to miss",
        [(CODEX, "      if (parts.injected) {", "      if (false) {")],
    ),
    (
        "M14 · §2 · a split message hands back the whole text as what the person said, so the "
        "prompt is shown once and still buried",
        [(INJECTED, "    const said = text.slice(marker + REQUEST_MARKER.length).trim()", "    const said = text.trim()")],
    ),
    # ------------------------------------------------------ §1 · the way back in
    (
        "M15 · ⛔ THE DEFECT, verbatim · a restored bundle leaves no mark, so nothing downstream can "
        "tell it from a conversation this app ran",
        [(STORE, "    markRestored.run(at, snapshot.session.id)\n", "")],
    ),
    (
        "M16 · ⛔ §1 · the column is read as always-false, so the row says it was never restored",
        [(STORE, "  return row.restored_at !== null", "  return false")],
    ),
    (
        "M17 · ⛔ 194 M2, verbatim · a restored bundle is offered a Resume whose provider transcript "
        "is in no home we provision — the click fails as \"session missing\"",
        [(STORE, "  return !foundInUserHome(row) && !restoredFromBundle(row)", "  return !foundInUserHome(row)")],
    ),
    (
        "M18 · ⛔ §1 · the refusal names the WRONG reason — a bundle from somebody's email is "
        "described as one of your own conversations found in your own folder (086)",
        [(STORE, "  if (restoredFromBundle(row)) {", "  if (false) {")],
    ),
    (
        "M19 · §1 · the fact never leaves the store, so every surface that asks where a "
        "conversation came from gets the wrong answer",
        [(STORE, "\n    restoredFromBundle: restoredFromBundle(row),", "\n    restoredFromBundle: false,")],
    ),
    (
        "M20 · ⚠️ 194 H4's disclosure · a duplicate is reported as a fresh restore, so the app "
        "claims to have written a conversation it did not write",
        [(HOST, "        already: existing !== null,", "        already: false,")],
    ),
    (
        "M21 · ⛔ 154 M9, moved · the library derives the origin a second time instead of reading "
        "the row (032) — here, by forgetting the newer of the two provenances",
        # ⚑ **671 · anchor corrected in place** — the three-way answer moved into a `const origin`
        # so `LibraryEntry.profileId` is keyed on the SAME answer. Subject unchanged; re-verified RED.
        [(LIB, "  const origin = row.restoredFromBundle ? 'restored' : row.foundInUserHome ? 'user-home' : 'ours'", "  const origin = row.foundInUserHome ? 'user-home' : 'ours'")],
    ),
    (
        "M22 · ⛔ 154 M10, moved · …or stops asking at all, and every recorded row reads as ours",
        # ⚑ **671 · anchor corrected in place**, as M21 above.
        [(LIB, "  const origin = row.restoredFromBundle ? 'restored' : row.foundInUserHome ? 'user-home' : 'ours'", "  const origin = 'ours'")],
    ),
    (
        "M23 · ⛔ §1's door · Restore never reaches the host, so the one action 213 went looking "
        "for is on screen and does nothing — 118's defect exactly",
        [(LIBRARY, "    const result = await window.api.runtime.importBundleFile({ path })", "    const result = { ok: false as const, reason: 'not wired' }")],
    ),
    (
        "M24 · ⛔ §1's reader · an EMPTY file falls through to the JSON parser, so somebody who "
        "picked a zero-byte download is told their file is not JSON rather than that it is empty",
        [(READER, "  if (size === 0) return { ok: false, reason: 'that file is empty' }\n", "")],
    ),
    (
        "M25 · ⚠️ §1's reader · a refusal stops naming WHERE the file is wrong, so \"that is not a "
        "bundle\" is all a person gets about a file that very nearly is one",
        [(READER, "    const where = first && first.path.length > 0 ? ` (at ${first.path.join('.')})` : ''", "    const where = ''")],
    ),
    (
        "M27 · 🔴 §1's reader · a bundle that disagrees with ITSELF about which conversation it is "
        "is accepted, so it lands as a row that collides with one we already hold (194 M2's family)",
        [(READER, "  if (last === null || last === bundle.meta.ref.sessionId) return null", "  if (true) return null")],
    ),
    (
        "M28 · 🔴 194 M2 AT THE COMMAND · the reopen boundary loses its refusal, so a restored bundle "
        "provisions a home that never held it and fails as the provider's \"unknown session\"",
        [(HOST, "    if (row.homeRefusal) {", "    if (false) {")],
    ),
    (
        "M29 · ⛔ §1 · the boundary reuses `read-only`, so a file somebody EMAILED is described as "
        "one found in Claude's own folder — 118's mistake, second time",
        [(HOST, "        row.restoredFromBundle ? 'restored-elsewhere' : 'read-only',", "        'read-only',")],
    ),
    (
        "M30 · ⛔ §1 · the store stops shipping the home refusal, so every reader of it is blind",
        [(STORE, "      homeRefusal: hasSomewhereToReopen(row) ? null : whyNotResumable(row),", "      homeRefusal: null,")],
    ),
    (
        "M31 · 🔴 §2 · NORMALIZER_VERSION is not bumped, so every Codex ledger already recorded keeps "
        "the misattribution, never reads stale, and is never offered a Rebuild",
        # ⚑ 680 corrected this anchor in place (not retired): 680 bumped the version to 4 for the Claude
        # importer, so the row takes BOTH bumps away — back to 2, the state 214's §2 guards against.
        [(NORM, "export const NORMALIZER_VERSION = 4", "export const NORMALIZER_VERSION = 2")],
    ),
    (
        "M32 · 🔴 §2 · a message that IS one wrapped element speaks in the user's name again — the "
        "22 KB `<skill>` block 213 met, still on screen as \"You\"",
        [(INJECTED, "  const wrapper = WHOLLY_WRAPPED.exec(text)", "  const wrapper = null")],
    ),
    (
        "M33 · ⛔ §2's WORSE failure · the `<image>` exemption goes, so a person's only message — a "
        "picture they attached — is not misattributed but DELETED from the transcript",
        [(INJECTED, "  if (wrapper !== null && !PERSON_AUTHORED_TAGS.has(wrapper[1]!.toLowerCase())) {", "  if (wrapper !== null) {")],
    ),
    (
        "M34 · §2 · the AGENTS.md preamble with no environment block behind it is the user again",
        [(INJECTED, "  if (text.trimStart().startsWith(AGENTS_HEADING)) return { injected: true, said: null }\n", "")],
    ),
    (
        "M35 · ⛔ §1 · a bundle's profileId stops being a path segment, so a file somebody SENT you "
        "names a directory — the one entrance that skipped `ipc.ts`'s rule",
        [(READER, "z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`).nullable()", "z.string().nullable()")],
    ),
    (
        "M36 · ⛔ §1 · a refusal this module WROTE is replaced by a path, so \"does not name a "
        "conversation this app can read\" reads as \"(at ledger.0.event)\"",
        [(READER, "    if (first?.code === 'custom') {", "    if (false) {")],
    ),
    (
        "M37 · ⛔ §1 · the rail lists a restored bundle among conversations you can pick up again",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives.
        # closed-threads.ts was deleted by D-017b, but its drop (a conversation found in the user's
        # own folder, or restored from a bundle this machine never ran, stays off the rail) moved
        # unchanged into conversationList in conversation-list.ts, which names the loop variable
        # `row`, not `session`. This plant makes a restored bundle (foundInUserHome false,
        # restoredFromBundle true) reach the list again.
        [
            (CONVERSATION_LIST, '    if (row.foundInUserHome || row.restoredFromBundle) continue', '    if (row.foundInUserHome) continue'),
        ],
    ),
    (
        "M38 · ⛔ §1 · a restored bundle is counted as one of the user's own and printed as "
        "\"imported\" — the one word its own chip argues is false about it",
        [(LIB, "    if (entry.origin === 'restored') {", "    if (false) {")],
    ),
    (
        "M39 · ⛔ §1 · the Origin facet loses the option that selects a restored conversation, so its "
        "two remaining options between them exclude a whole class of the library",
        [(FACETS, "  { value: 'restored', label: 'Restored from a bundle' },\n", "")],
    ),
    (
        "M40 · ⚠️ §1 · a restored bundle with NO transcript still claims BroBot has the whole "
        "conversation and can show it (086)",
        [(STORE, "      row.has_events === 0\n        ? 'restored from a bundle that carried no conversation'", "      false\n        ? 'restored from a bundle that carried no conversation'")],
    ),
    (
        "M41 · ⛔ 154 M1, moved · the rail's drop goes ENTIRELY, so every row that can never answer "
        "\"what can I pick up again\" is back in the list whose whole purpose is that question",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives in
        # conversationList: rows that can never be picked up again are dropped from the one list.
        # The plant deletes the whole guard line, so the adopted and restored rows come back. It is
        # the same edit as the old one with `session` renamed to `row`.
        [
            (CONVERSATION_LIST, '    if (row.foundInUserHome || row.restoredFromBundle) continue\n', ''),
        ],
    ),
    (
        "M42 · ⛔ 154 M2, moved · …and the INVERSE: every unresumable row is dropped, so the rail "
        "loses that half altogether",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives. The
        # inverse plant drops every unresumable row that is not found in the user's own folder, so
        # the app-owned unresumable conversation (a real conversation started here whose ref can no
        # longer be read) vanishes from the list. Only the file and the variable name changed.
        [
            (CONVERSATION_LIST, '    if (row.foundInUserHome || row.restoredFromBundle) continue', '    if (!row.foundInUserHome) continue'),
        ],
    ),
    (
        "M43 · ⛔ 154 M3, moved · the renderer works the rule out for itself again (032 — two "
        "implementations of one predicate, which is how they came to disagree)",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # list reads the host's `foundInUserHome` answer and does not re-derive it (032).
        # `adoptedAt` and `profileId` are both still on UnresumableSessionInfo, so the plant is
        # valid and fails by behaviour, not by a type error. The test's own comment names this exact
        # re-derivation.
        [
            (CONVERSATION_LIST, '    if (row.foundInUserHome || row.restoredFromBundle) continue', '    if (row.adoptedAt !== null && row.profileId === null) continue'),
        ],
    ),
    (
        "M26 · ⛔ 206 H1 · the live step writes its own verdict into a sentence instead of returning "
        "typed claims, so a run cannot tell asserted from merely printed",
        [
            (
                SMOKE,
                "    return claims(\n      asserted(\n        `1 · a bundle of ",
                "    return (\n      `ASSERTED: ` +\n      (\n        `1 · a bundle of ",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        if not path.exists():
            print(f"!! {name}: {rel} does not exist", file=sys.stderr)
            bad += 1
            continue
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
