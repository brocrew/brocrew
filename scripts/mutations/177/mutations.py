#!/usr/bin/env python3
"""
177 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What the table is about

177 has two subjects and they fail in opposite directions.

⛔ **The gate (§1/§2)** turns a provider frame into a visible line. Its failure mode is BOTH ways:
too quiet is a user hitting a wall with no warning, too loud is the noise 074 removed from Claude's
side. So the boundary is mutated on both sides (M3/M4/M5), not just downward.

⛔ **The two effort menus (§4)** are a consistency claim, and consistency claims are the ones that
pass vacuously. **M13 is the most important row in this table**: it recreates the exact defect 176
reported and 177 §4 ruled in — the launcher's menu pooling across every model regardless of which
one is named. That defect is NOT present at HEAD (176 read the union loop without the three lines
of scoping above it), so the only thing that makes §4's assertion worth having is that it goes red
when the defect is introduced. This is that proof.

  * **M1/M2** drop each of the two walls the provider reports directly. Neither needs a threshold,
    so a gate that had quietly become "percentage only" would still look plausible.
  * **M3** puts the floor at 0: every routine heartbeat now speaks. ⚑ **This is the mutation that
    protects 074's rule**, and the live probe measures the same thing against the real wire.
  * **M4** puts it at 101: nothing ever warns, which is HEAD's behaviour before 177 wearing a
    constant.
  * **M5** is the boundary off-by-one — `<=` instead of `<`, so exactly 90 stays silent. A floor
    asserted only from far above would not notice.
  * **M6** reads `resetsAt` as milliseconds. It is epoch SECONDS, so the sentence still renders and
    still says "resets", in 1970.
  * **M7** drops the quiet frame entirely instead of carrying it as chatter. Nothing visible
    changes; the ledger and the debug view lose the snapshot.
  * **M8** puts `model/rerouted` back in the chatter list — 177 §2's whole subject.
  * **M9** drops `fromModel` from the reroute sentence, so it says a model answered without saying
    which one you had asked for.
  * **M10** promotes `model/verification` along with it — the over-broad reading of §2, caught by
    the paired negative rather than by anything about the reroute itself.
  * **M11** restores the drawer's old scoping, where a model id the catalogue does not list yields
    an empty, disabled menu and a title blaming the provider.
  * **M12** restores `effortsArePooled`'s old `model === null` test, so the menu pools and says
    nothing about it.
  * **M13** removes the launcher's scoping — ⛔ **the defect 176 described.**
  * **M14** reads only the primary window, so a secondary one at 99% is invisible.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **`throttle-probe.smoke.ts`.** The live pair — the frame the provider really sends staying
    quiet, and the same frame one field apart speaking — is a smoke. `vitest` never runs it and no
    mutation here can red it. ⚑ What proves it is the run, in the response doc, with the payload it
    measured. M3 is its unit-level twin and is red, which is the closest this table gets.
 2. **`codex-live.smoke.ts` §3.13**, the Codex question path. Same reason: it needs the real
    provider, and its finding (the tool exists only in plan mode) is a fact about Codex.
 3. **`scripts/ui-live-smoke.mjs` step 20.** 177 §5 DELETED an assertion there. A deletion cannot be
    mutated into a red — there is nothing left to break — and the property it used to guard is now
    proved by `archive-sweep.smoke.ts` §6, which is also a smoke. ⛔ **This is the one part of 177
    that no automated check covers, and it is the PM's own ruling rather than a judgement of mine.**
 4. **The 90% floor itself.** M3/M4/M5 prove the code reads the constant and the boundary is where
    it says. Whether 90 is the RIGHT number is an argument, not a test — it is made in the constant's
    own doc comment and rests on the measured 74% the live frame carries.

🔴 **`435` MOVED §4's rule out of this file, and `M11`/`M12` follow it** (HO-025 §5).

⛔ **`177` fixed a measured on-screen drift by COPYING the pooling rule into `SessionSettings.vue`**,
and its own comment said so: *"Same rule now, in both places — and the comment above already
described this behaviour, which is how far apart the two had drifted."* `417` then deleted the other
copy with the launcher control that read it, and `435` put that control back — so the choice was to
write the rule a THIRD time or to have one derivation. ⚑ It is one derivation now
(`renderer/src/lib/effort-menu.ts`), and both surfaces read it.

⚠️ **So `M11` and `M12` are re-anchored there rather than retired** (142's rule: correct, never
delete). ⛔ **The recorded RED for both was measured against the OLD text, in `SessionSettings.vue`,
on the drawer alone** — the kill is the same defect and it now reaches BOTH surfaces, which is a
wider blast radius than the verdict was earned against. ⚑ `CENSUS.md`'s per-file digests are what
make that checkable, and re-running this table is the only thing that makes either verdict current.
⚠️ **Both corrected rows were applied alone and watched go red** against
`apps/desktop/test/asks-nothing-offers-everything.test.ts` §2 before this was written.

"""

import sys
from pathlib import Path

NORMALIZE = "packages/runtime/src/codex/normalize.ts"
SETTINGS = "apps/desktop/src/renderer/src/components/SessionSettings.vue"
# ⚑ **Added by `435`** — where §4's rule lives now; see the docstring paragraph below.
MENU = "apps/desktop/src/renderer/src/lib/effort-menu.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"

MUTATIONS = [
    (
        "M1 · ⛔ the wall the provider reports directly is ignored — only a percentage can speak",
        NORMALIZE,
        """  if (reached) {
    return `codex is rate-limited (${reached}) — the turn may stall until it resets${when}`
  }""",
        """  if (false && reached) {
    return `codex is rate-limited (${reached}) — the turn may stall until it resets${when}`
  }""",
    ),
    (
        "M2 · ⛔ `spendControlReached` is dropped — the workspace's own limit is silent",
        NORMALIZE,
        """  if (readField(snapshot, 'spendControlReached') === true) {""",
        """  if (readField(snapshot, 'spendControlReached') === undefined) {""",
    ),
    (
        "M3 · ⛔ the floor goes to 0 — every routine heartbeat speaks, which is 074's noise back",
        NORMALIZE,
        "const RATE_LIMIT_WARN_PERCENT = 90",
        "const RATE_LIMIT_WARN_PERCENT = 0",
    ),
    (
        "M4 · ⛔ the floor goes to 101 — nothing ever warns, which is HEAD before 177",
        NORMALIZE,
        "const RATE_LIMIT_WARN_PERCENT = 90",
        "const RATE_LIMIT_WARN_PERCENT = 101",
    ),
    (
        "M5 · ⚠️ the boundary off-by-one — exactly at the floor stays silent",
        NORMALIZE,
        "  if (!worst || worst.used < RATE_LIMIT_WARN_PERCENT) return null",
        "  if (!worst || worst.used <= RATE_LIMIT_WARN_PERCENT) return null",
    ),
    (
        "M6 · ⚠️ `resetsAt` read as milliseconds — it is epoch SECONDS, so the line still says "
        "'resets', in 1970",
        NORMALIZE,
        "  const when = resets > 0 ? `; resets ${new Date(resets * 1000).toISOString()}` : ''",
        "  const when = resets > 0 ? `; resets ${new Date(resets).toISOString()}` : ''",
    ),
    (
        "M7 · ⛔ the quiet frame is DROPPED rather than kept as chatter — nothing visible changes "
        "and the ledger loses the snapshot · killed by `codex-normalize.test.ts` (named by W4.78)",
        NORMALIZE,
        # ⚑ **W4.78 · re-anchored in place, not retired** — 9e0b6c40 turned the rate-limit early return into a ternary (`said`) so a provider_usage reading can be appended; the auto-guess at line 265 is the safety-buffering case, the wrong row
        "        : [wrapUnknown('codex', { method, params }, 'lifecycle', method)]\n",
        "        : []\n",
    ),
    (
        "M8 · ⛔ `model/rerouted` goes back to chatter — 177 §2's whole subject",
        NORMALIZE,
        """    case 'model/rerouted':
      return [{ type: 'error', message: rerouteMessage(params), fatal: false }]""",
        """    case 'model/rerouted':
      return [wrapUnknown('codex', { method, params }, 'lifecycle', method)]""",
    ),
    (
        "M9 · ⚠️ the reroute sentence loses the model you ASKED for — half the fact",
        NORMALIZE,
        "  if (from && to) return `codex answered this turn with ${to} instead of ${from}${why}`",
        "  if (from && to) return `codex moved this turn to ${to}${why}`",
    ),
    (
        "M10 · ⚠️ `model/verification` is promoted too — the over-broad reading of §2",
        NORMALIZE,
        """    case 'model/verification':
    case 'turn/moderationMetadata':""",
        """    case 'turn/moderationMetadata':""",
    ),
    (
        "M11 · ⛔ the drawer's old scoping — an id the catalogue does not list yields an EMPTY, "
        "disabled menu that blames the provider "
        "⚑ ANCHOR CORRECTED IN PLACE BY 435 · killed by `the-one-model-picker-holds-and-sends.test.ts` (named by W4.78)",
        "apps/desktop/src/renderer/src/lib/model-lists.ts",
        # ⚑ **W4.78 · re-anchored in place, not retired** — effort-menu.ts was deleted in 6d2d195d (UI-012). The rule that an id the catalogue does not list gets the whole set instead of an empty menu now lives in model-lists.ts theEffortsOffered: a model with no row is offered the provider's whole ladder. The replacement brings back the drawer's old exact-row scoping, so an unlisted id gets an EMPTY ladder and the picker says the model "has no effort levels". sameModel is already imported there. (moved from effort-menu.ts)
        "      levels: theEffortLadder(list.models).map((level) => ({ id: level, label: level })),\n",
        "      levels: theEffortLadder(list.models.filter((one) => sameModel(one.id, id))).map((level) => ({ id: level, label: level })),\n",
    ),
    (
        "M12 · ⚠️ the drawer pools without SAYING so — `effortsArePooled` back to `model === null` "
        "⚑ ANCHOR CORRECTED IN PLACE BY 435",
        MENU,
        """  return listed.length > 1 && !listed.some((row) => row.id === named)""",
        """  return named === '' && listed.length > 1""",
    ),
    # ⚠️ **STALE SINCE `417`, and `435` deliberately left it that way.** HO-022 §2 deleted the
    # launcher's whole model/effort fold, so this anchor has matched zero times since — and it was
    # already stale before `435` arrived (`301 §5`: do not correct another dispatch's evidence to
    # land a fix nobody asked for). ⛔ **Its CLAIM is live again**: HO-025 §5 put the control back,
    # and the scoping it attacks is now `effort-menu.ts`'s — which is exactly where `M11` above was
    # re-anchored.
    #
    # ⚑ **So re-aiming it would duplicate `M11`'s SUBJECT on `M11`'s anchor**, and the launcher-side
    # half of `176`'s defect is already covered by `435 M9`. ⛔ **Not because two rows cannot share
    # one anchor** — `run-table.sh` restores and byte-verifies the pristine tree between every row,
    # ~40 tables do it, and `435`'s own `M5`/`M6` and `M9`/`M10` are two such pairs. ⚠️ That reason
    # was written here and was false; it is corrected rather than deleted, because a wrong mechanism
    # in a comment is how the next person reaches the wrong conclusion for a right-looking reason.
    (
        "M13 · ⛔ THE DEFECT 176 REPORTED — the launcher's menu pools across every model regardless "
        "of which one is named, so `haiku` is offered `xhigh`",
        LAUNCHER,
        """  const exact = typed === '' ? [] : listed.filter((row) => row.id === typed)
  const scoped = exact.length > 0 ? exact : listed""",
        """  const scoped = listed
  void typed""",
    ),
    (
        "M14 · ⚠️ only the PRIMARY window is read — a secondary one at 99% is invisible",
        NORMALIZE,
        # ⚑ **F074 · re-anchored in place, not retired** — F074 moved the fuller-window read into `fullestWindow`, which a Codex turn's usage limit reads too; the row still hides the secondary window.
        "  return [readField(snapshot, 'primary'), readField(snapshot, 'secondary')]",
        "  return [readField(snapshot, 'primary')]",
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, rel, find, replace = MUTATIONS[index]
    path = root / rel
    text = path.read_text(encoding="utf-8")
    hits = text.count(find)
    if hits != 1:
        print(f"!! anchor found {hits} times in {rel} — refusing", file=sys.stderr)
        return 1
    if not dry:
        path.write_text(text.replace(find, replace), encoding="utf-8")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--count":
        print(len(MUTATIONS))
        return 0
    if args and args[0] == "--name":
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args and args[0] == "--files":
        print(" ".join(sorted({rel for _n, rel, *_r in MUTATIONS})))
        return 0
    dry = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]
    root = Path(args[0])
    if len(args) > 1:
        return apply(root, int(args[1]), dry)
    # No index: check every anchor without touching the tree (166 §11).
    bad = 0
    for i, (name, *_rest) in enumerate(MUTATIONS):
        result = apply(root, i, dry=True)
        print(f"{'ok  ' if result == 0 else 'BAD '} {name[:90]}")
        bad += result
    return bad


if __name__ == "__main__":
    raise SystemExit(main())
