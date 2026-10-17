#!/usr/bin/env python3
"""211's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **All five are one family — `086`: the app states something it cannot back.** None of them was
found by any of this project's 26 live instruments or 4,295 unit tests; an Exploration Agent found
them by using the app for an hour, for $0.12. So every row below is a defect a person SAW.

The rows fall into five groups, one per section of the dispatch:

  * `M1`-`M8`   §1 the launch draft — the half that came back was the dangerous half.
  * `M9`-`M12`  §2 the calm card — a claim about the app made by a card that reads fixtures.
  * `M13`-`M18` §3 the opening line — the one fact that tells two rows apart, and its refusal.
  * `M19`-`M24` §4 the lifecycle toggle — what its tooltip promises, and what it showed.
  * `M25`-`M29` §5 the clock — a navigation-time snapshot labelled LOCAL TIME.
  * `M30`-`M33` criterion 8's price — a spend figure the run prints for itself, and cannot overstate.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **`RuntimeScreen.vue`'s WIRING of §1.** `M5`/`M6` kill the decision and `M1`-`M4` kill the
    surface's half, but the binding between them — `:launch="launchDraft"` and
    `@update:launch` — is asserted by nothing: no test in this repository mounts `RuntimeScreen`,
    which needs a live `window.api` bridge and a session store. ⚠️ **The two ends are covered and
    the wire is not.** A live `smoke:ui` step is the only instrument that could, and §1's gesture —
    fill the launcher, open a conversation, come back — is not one any existing step performs.
  * ⛔ **Whether the restored launcher is LEGIBLE.** `M7` kills the assertion that the fine-tune fold
    comes back open over a changed model. Whether a user reads the restored strip as "restored"
    rather than as "default" is a judgement, and the PM's eyes are the instrument.
  * ⛔ **`209` §4's three gated items and `scripts/mutations/lib/`.** Untouched by this dispatch, so
    no row here reaches them, and that is deliberate rather than an omission.
  * ⛔ **The rail row at a real rail's width, under a real font.** `M18` kills the row's line in a
    200 px `dom` mount, which is the width the rail is. Whether 120 characters is the right bound is
    a judgement about a column nobody has measured in the shipped app.
  * **A conversation whose ledger is genuinely longer than one window.** `M13` drives the refusal
    with `openWindow(hasOlder: true)`, which is what the host sends for one — but a real 2,500-event
    resume is not reproducible in a unit test, and `HISTORY_WINDOW_MAX_EVENTS` is not exercised here.
  * **The provider chatter itself.** `M20` puts 208 `unknown{plan}` payloads back into the
    conversation using a synthetic fold. What Codex actually emits during a plan is 210's
    measurement, not this table's.
  * ⛔ **Whether the live smoke's step `7b` actually READS the raw category.** `M24` kills the
    attribute and the unit test that pins it, so a rename cannot land silently — but that step's own
    selector (`[data-cy=event-log] [data-type=unknown]`) is a live-only read, and the same edge
    `196` names about every step in `ui-live-smoke.mjs` applies: no project executes one.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.


⚠️ **`413` CORRECTED `M14`'s ANCHOR IN PLACE, and the recorded RED was measured against the OLD
text.** ⛔ The guard used to read `attribution === undefined`; `413` made a turn unmarked only when
a WINDOW sent it, so that spelling started refusing every turn BroBot carried — and a spawned
conversation lost its rail label. The line is now `!== 'provider_transcript'`, which is the rule
this row was always about: provenance this app cannot VERIFY. ⚑ The corrected row was applied
alone and watched go red against `apps/desktop/test/opening-line.test.ts` before this note was
written; re-running the table is the only thing that makes the artefact's verdict current.

⛔ **MEASURED while doing it (413): it is the LABEL that tells the census, not the anchor.** With
the anchor corrected and the label left alone, this table came back **`complete`** — the run state
is computed from a definition fingerprint that covers the label and not the old text, so a
corrected anchor silently keeps a verdict measured against text that no longer exists. ⚑ The
`⚑ ANCHOR CORRECTED IN PLACE BY 413` suffix is what moves this table to `partial-or-invalid`, and
that is the honest state: the artefact was produced against a definition this file no longer has.
⚠️ **The cost is per TABLE and not per row** — every other row here is downgraded with it, which is
a fact about the instrument rather than about those rows.
"""

from __future__ import annotations

import sys

LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
DRAFT = "apps/desktop/src/renderer/src/lib/launch-draft.ts"
DIGEST = "apps/desktop/src/renderer/src/components/DigestCard.vue"
HOME = "apps/desktop/src/renderer/src/components/HomeSurface.vue"
# ⚑ **606 · the digest card's HOST**, which `EXT-008` §3 moved off Home into its own destination.
# ⛔ `M12` is the only row on this constant and its SUBJECT is unchanged: gate the real reading on
# an unrelated population and the one part of the screen that reads the ledger disappears.
AWAY = "apps/desktop/src/renderer/src/components/WhileYouWereAway.vue"
RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"
OPENING = "apps/desktop/src/renderer/src/lib/opening-line.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"
STREAM = "apps/desktop/src/renderer/src/components/EventStream.vue"
CLOCK = "apps/desktop/src/renderer/src/composables/useMinuteClock.ts"
PRICE = "scripts/lib/smoke-price.mjs"

MUTATIONS = [
    # ------------------------------------------------------------- §1 · the launch draft
    (
        "M1  · ⛔ THE DEFECT, verbatim · the provider resets to the default when you come back — "
        "210's `chose Claude, got Codex`, reproduced twice",
        [
            (
                LAUNCHER,
                "const provider = ref<Provider>(restored.provider)",
                "const provider = ref<Provider>(props.defaultProvider)",
            )
        ],
    ),
    (
        "M2  · ⛔ THE DEFECT · the folder comes back blank — the right prompt, in the wrong working "
        "directory",
        [(LAUNCHER, "const cwd = ref(restored.cwd)", "const cwd = ref('')")],
    ),
    (
        "M3  · ⛔ THE DEFECT · the profile resets to BroBot — the right prompt, under the wrong "
        "identity, with the wrong memory",
        [
            (
                LAUNCHER,
                "const profileChoice = ref<string>(restored.profileChoice)",
                "const profileChoice = ref<string>(DEFAULT_PROFILE_ID)",
            )
        ],
    ),
    (
        "M4  · §1 · the surface never reports what was chosen, so the frame holds an empty draft "
        "and the restore has nothing to restore",
        [(LAUNCHER, "    emit('update:launch', {", "    void ({")],
    ),
    (
        "M5  · ⛔ §1 · a FAILED launch clears the settings while `NewConversation` hands the words "
        "back — the defect arriving from the failure path instead of from navigation",
        [
            (
                DRAFT,
                "  return opened === null ? held : emptyLaunchDraft(defaultProvider)",
                "  return emptyLaunchDraft(defaultProvider)",
            )
        ],
    ),
    (
        "M6  · §1 · a conversation that opened does NOT consume the draft — the next launcher opens "
        "pre-loaded with the last conversation's provider, profile and folder",
        [
            (
                DRAFT,
                "  return opened === null ? held : emptyLaunchDraft(defaultProvider)",
                "  return held",
            )
        ],
    ),
    (
        "M7  · §1 · the fine-tune fold comes back SHUT over a restored model — the launch is set up "
        "one way and the strip reads like defaults (030/106's hidden state)",
        [
            (
                LAUNCHER,
                "const fineTuneOpen = ref(restored.fineTuneOpen)",
                "const fineTuneOpen = ref(false)",
            )
        ],
    ),
    (
        "M8  · §1 · a restored folder is never re-checked, so a directory deleted while you were "
        "away keeps Send lit — 203's defect, arriving through the restore",
        [(LAUNCHER, "if (cwd.value !== '') checkCwdSoon()", "if (false) checkCwdSoon()")],
    ),
    # ------------------------------------------------------------- §2 · the calm card
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and While you were away are deleted; the no-whole-app-claim rule is pinned on Recent activity in surfaces.render.test.ts.
        "M9  · ⛔ THE DEFECT, verbatim · the card claims the whole APP is quiet while the live queue "
        "beside it offers a decision — 210's screen, in the largest type on it "
        "⚑ ANCHOR CORRECTED IN PLACE BY 438",
        [
            (
                DIGEST,
                '<strong data-cy="digest-headline">What the ledger recorded</strong>',
                '<strong data-cy="digest-headline">Everything is quiet</strong>',
            )
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and While you were away are deleted; the no-whole-app-claim rule is pinned on Recent activity in surfaces.render.test.ts.
        "M10 · ⛔ §2 · *safe to close the app* is back — the sentence this card has never been able "
        "to back, about running conversations it has never read (202) "
        "⚑ ANCHOR CORRECTED IN PLACE BY 438",
        [
            (
                DIGEST,
                "          Every line says how it is known — observed, claimed, or a gap the ledger cannot fill.",
                "          Everything is done and it is safe to close the app.",
            )
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and While you were away are deleted; the no-whole-app-claim rule is pinned on Recent activity in surfaces.render.test.ts.
        "M11 · §2 · the pill says ALL CAUGHT UP again — the same whole-app claim in the badge "
        "⚑ ANCHOR CORRECTED IN PLACE BY 438",
        [
            (
                DIGEST,
                "{{ view === null ? 'not read yet' : view.windowWords }}",
                "{{ 'All caught up' }}",
            )
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and While you were away are deleted; the no-whole-app-claim rule is pinned on Recent activity in surfaces.render.test.ts.
        "M12 · §2 · the digest is GATED on an unrelated population again — 205's silent inversion, "
        "now aimed at the real reading: hand the card nothing whenever the fixture rows are "
        "non-empty, and the one part of Home that reads the ledger disappears exactly when the "
        "screen is busiest ⚑ RE-AIMED BY 438 (the seed's bullets no longer exist; the surviving "
        "half of the rule is that the reading is handed over ungated)",
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 606, not retired** — the card moved to `AWAY` and the
        # fixture rows it used to sit beside are on the other destination, so the unrelated
        # population this row gates on is now the digest's own window. ⛔ Re-verified RED by hand.
        [
            (
                AWAY,
                '        :view="props.digest"',
                '        :view="props.digestWindowMs > 0 ? null : props.digest"',
            )
        ],
    ),
    # ------------------------------------------------------------- §3 · the opening line
    (
        "M13 · ⛔ §3 · a session reopened part-way through its ledger names itself after the oldest "
        "message it happens to hold — a row that INVENTS one looks exactly like a row that knows",
        [(RECORD, "    !record.window.hasOlder &&", "    true &&")],
    ),
    (
        "M14 · 🔒 §3 · a line only a PROVIDER FILE claims becomes the row's identity (074) — the "
        "shape that made `approved, ship it` read as something the person typed "
        "⚑ ANCHOR CORRECTED IN PLACE BY 413",
        [(RECORD, "    message.event.attribution !== 'provider_transcript'", "    true")],
    ),
    (
        "M15 · §3 · the LATEST message overwrites the opening, so the row's identity changes under "
        "the reader every turn",
        [(RECORD, "    record.opening === null &&", "    true &&")],
    ),
    (
        "M16 · §3 · a pasted multi-line prompt keeps its newlines — a row of blanks where the cue "
        "should be",
        [(OPENING, "  const flat = text.replace(/\\s+/g, ' ').trim()", "  const flat = text.trim()")],
    ),
    (
        "M17 · §3 · the bound goes, so a 9,000-character paste becomes the row's title and its "
        "`title` attribute",
        [
            (
                OPENING,
                "  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`",
                "  return flat",
            )
        ],
    ),
    (
        "M18 · ⛔ THE DEFECT, verbatim · the row draws no opening line — two conversations sharing a "
        "profile and a folder read `workspace-a / codex · idle`, twice",
        [(RAIL, '              v-if="row.opening"\n', '              v-if="false"\n')],
    ),
    # ------------------------------------------------------------- §4 · the lifecycle toggle
    (
        "M19 · §4 · the toggle stops showing the boundaries it names — turning it on changes "
        "nothing, which is the tooltip false in the other direction",
        [(MODE, "      return mode === 'debug' || item.level !== 'info'", "      return item.level !== 'info'")],
    ),
    (
        "M20 · ⛔ THE DEFECT, verbatim · every recognized whisper is back in the conversation — "
        "210's 208 `item/plan/delta` markers, over the plan they buried",
        [
            (
                MODE,
                "      return item.category === 'unrecognized' || (mode === 'debug' && item.category === 'lifecycle')",
                "      return item.category === 'unrecognized' || mode === 'debug'",
            )
        ],
    ),
    (
        "M21 · ⛔ §4 · the OTHER half of `debug shows everything` — `visibleItems` short-circuits "
        "again, so the filter is correct and the whole transcript ignores it",
        [
            (
                MODE,
                "  return items.filter((item) => isVisibleIn(mode, item))",
                "  return mode === 'debug' ? items : items.filter((item) => isVisibleIn(mode, item))",
            )
        ],
    ),
    (
        "M22 · §4 · the tooltip promises `idle gaps` again — a noun no mode has ever been able to "
        "show, because an `idle` status appends no item at all",
        [
            (
                MODE,
                "  'Show lifecycle events in the conversation — session start, turn boundaries, provider housekeeping'",
                "  'Show lifecycle events in the conversation — session start, turn boundaries, idle gaps'",
            )
        ],
    ),
    (
        "M23 · §4 · a superseded tool call is drawn again in the lifecycle view — the checklist and "
        "the calls it was built from, the same fact twice",
        [(MODE, "      return item.superseded !== true", "      return mode === 'debug' || item.superseded !== true")],
    ),
    (
        "M24 · ⛔ §4 · the raw row loses the category, so the classification the conversation no "
        "longer draws is countable NOWHERE — a filter blinding the instrument that justifies it",
        [(STREAM, '        :data-category="categoryOf(message.event)"\n', "")],
    ),
    # ------------------------------------------------------------- §5 · the clock
    (
        "M25 · §5 · a boundary exactly now schedules a zero-delay timeout that re-reads the same "
        "minute and schedules another — a spin, on the cheapest thing on the screen",
        [(CLOCK, "  return MINUTE_MS - past", "  return (MINUTE_MS - past) % MINUTE_MS")],
    ),
    (
        "M26 · ⛔ §5 · the clock ticks once and stops — 210's `opened at 00:43, still 00:43 at "
        "00:46`, one minute later than before",
        [(CLOCK, "      clock.value = now()\n      arm()", "      clock.value = now()")],
    ),
    (
        "M27 · §5 · the timer outlives the surface that owns it — 099's cost, on every visit to Home",
        [(CLOCK, "  onScopeDispose(() => clearTimeout(timer))", "  void 0")],
    ),
    (
        # The Home surface and local-time statistic are gone and have no successor header. Keep the
        # absent anchor recorded as retired.
        "M28 · ⛔ THE DEFECT, verbatim · LOCAL TIME is the navigation-time snapshot again — the seed's "
        "frozen night under a heading that says what time it is",
        [(HOME, "{{ clockSince(headerClock) }}", "{{ clockSince(now) }}")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row protects Home's greeting
        # reading the same clock as its stat (`new Date(headerClock.value).getHours()` in
        # `HomeSurface.vue`). That component was deleted by D-016a ("no Projects, Home or proposals
        # anywhere"), and no greeting or header clock remains anywhere in `apps/desktop/src`, so
        # there are no two claims about the time of day left to disagree. Its anchor is left stale,
        # so the census records it retired.
        "M29 · §5 · the greeting and the stat read different clocks — 009's `one surface, two claims "
        "about the time of day`, restored",
        [(HOME, "  const hour = new Date(headerClock.value).getHours()", "  const hour = new Date(props.now).getHours()")],
    ),
    (
        "M30 · ⛔ criterion 8 · a billed message is counted once per FILE that replayed it, so every "
        "run that reopens a conversation reports more spend than it made",
        [(PRICE, "      if (seen.has(id)) continue", "      if (false) continue")],
    ),
    (
        "M31 · ⛔ criterion 8 · a model this file has no rate for is folded into the total as FREE — "
        "a confident number with a whole model missing from it",
        [(PRICE, "  if (rate === undefined) return null", "  if (rate === undefined) return 0")],
    ),
    (
        "M32 · criterion 8 · the total stops SAYING that a model went unpriced, so the omission is "
        "silent — the one thing worse than no total",
        [(PRICE, "      : ` · ⚠️ NOT PRICED: ", "      : ` · (")],
    ),
    (
        "M33 · criterion 8 · a cache write whose TTL the wire did not state is charged at the DEARER "
        "1-hour rate, so the run overstates what it spent",
        [
            (
                PRICE,
                "      row.cacheWrite5m += usage.cache_creation_input_tokens ?? 0",
                "      row.cacheWrite1h += usage.cache_creation_input_tokens ?? 0",
            )
        ],
    ),
]

def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
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
