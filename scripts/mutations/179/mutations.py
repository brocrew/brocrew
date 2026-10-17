#!/usr/bin/env python3
"""
179 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What this table is about

A conversation reopened onto a recorded model read `provider: claude · model: … · reasoning: …` for
as long as nobody typed into it — measured in the person's app and reproduced by
`BROBOT_SMOKE_PROVIDER=claude pnpm run smoke:resume`. Three things changed:

  * the **model row** now falls back to what the launch ASKED for, marked `(requested)`, when the
    provider has not reported yet (M1–M4);
  * a **reopened session's row** stops saying `ended` (M5–M7);
  * the **launcher** says why its reasoning menu is empty, on screen, and only when the provider
    actually answered (M8–M10).

Row by row:

  * **M1** takes the fallback out of the model row — `info?.model ?? '…'`, the pre-179 line exactly.
    ⚑ This is the mutation that restores the reported defect.
  * **M2** shows the request UNMARKED. ⛔ Not cosmetic: 177 shipped a reroute notice, and *"codex
    answered with `gpt-5.4` instead of `gpt-5.6-sol`"* is only legible if the row distinguishes what
    we asked for from what answered.
  * **M3** prefers our request OVER the provider's report, so a session that was rerouted goes on
    naming the model it did not run.
  * **M4** does the same to the reasoning row. Its own fallback and the model's are two lines, and
    a table that only mutated one would let the other rot.
  * **M5** makes `reopened()` a no-op — §2's defect restored: `ended` for the whole second life.
  * **M6** makes it clear the status unconditionally, so a session mid-turn is knocked back to
    `idle`. ⛔ The opposite failure, and the reason the guard is a guard rather than a write.
  * **M7** stops the resume path CALLING it: the store learns the rule and nobody asks.
  * **M8** lets the launcher claim the provider named no levels when we never got a list at all —
    a limit invented from silence (106, and `effortTitle`'s own note).
  * **M9** stops the sentence being rendered, leaving it in the `title` where it was.
  * **M10** stops the control being disabled: 118's *"not even greyed is worse"*.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **That Claude reports nothing until the first turn's `system/init`.** That is a fact about the
    provider, measured on the wire by `packages/runtime/smoke/resume-agent-info.smoke.ts` — a SMOKE,
    which `pnpm run ci` never runs. Every column below is green or red on a `FakeRuntime` that
    reports whatever the test tells it to.
 2. **The product-level string.** `provider: claude · model: … · reasoning: …` came out of the real
    app, and the assertion that it cannot come back is in `scripts/resume-live-smoke.mjs`, which is
    also not in `ci`. Run both ways: red before the change, 10/10 after, on Claude AND on Codex.
 3. **Whether the reopen list SHOWS the stale status.** `resumable()` carries it and both surfaces
    hide sessions the current window already holds open, so the visible harm needs a second window
    or a second app. The column asserted here is the one the row itself reports.
 4. **The renderer's own reading of the rows.** `SessionHeader` and `SessionInfo` both read
    `liveness.agent`; the `dom` project covers the launcher half of this dispatch, and the header
    half is covered by the host tests through the payload those components render.
"""

import sys
from pathlib import Path

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"

MUTATIONS = [
    (
        "M1 · ⛔ the model row loses its fallback — pre-179 exactly: the ellipsis is back",
        HOST,
        # ⚑ **Anchor corrected at `578`, subject unmoved.** The `'…'` literal became the shared
        # {@link PROVIDER_HAS_NOT_REPORTED} the renderer now reads too; the FALLBACK this row removes
        # is the same fallback. Re-verified RED by hand at the correction
        # (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
        "  if (info?.model) return info.model\n  return settings.model === null ? PROVIDER_HAS_NOT_REPORTED : `${settings.model} (requested)`",
        "  return info?.model ?? PROVIDER_HAS_NOT_REPORTED",
    ),
    (
        "M2 · ⛔ the request is shown UNMARKED — a claim we cannot back (177's reroute)",
        HOST,
        "  return settings.model === null ? PROVIDER_HAS_NOT_REPORTED : `${settings.model} (requested)`",
        "  return settings.model === null ? PROVIDER_HAS_NOT_REPORTED : settings.model",
    ),
    (
        "M3 · ⛔ our request WINS over the provider's report — a rerouted session names the wrong model",
        HOST,
        "  if (info?.model) return info.model\n  return settings.model === null",
        "  if (settings.model !== null) return `${settings.model} (requested)`\n  return settings.model === null",
    ),
    (
        "M4 · ⛔ the reasoning row loses the same fallback",
        HOST,
        "    return settings.reasoningEffort === null\n      ? PROVIDER_HAS_NOT_REPORTED\n      : `${settings.reasoningEffort} (requested)`",
        "    return PROVIDER_HAS_NOT_REPORTED",
    ),
    (
        "M5 · ⛔ `reopened()` clears nothing — the row says `ended` for the whole second life",
        STORE,
        "    if (row?.status !== 'ended' && row?.status !== 'errored') return false\n    updateStatus.run('idle', at, sessionId)",
        "    if (row?.status !== 'ended' && row?.status !== 'errored') return false",
    ),
    (
        "M6 · ⛔ …and it clears UNCONDITIONALLY — a session mid-turn knocked back to idle",
        STORE,
        "    if (row?.status !== 'ended' && row?.status !== 'errored') return false\n",
        "",
    ),
    (
        "M7 · ⛔ the resume path never calls it — the store knows the rule and nobody asks",
        HOST,
        "    this.record(session, () => this.deps.store.reopened(sessionId, this.now()))\n",
        "",
    ),
    (
        "M8 · ⛔ the launcher blames a provider that never spoke — a limit invented from silence",
        LAUNCHER,
        "  modelChoices.value !== null && effortChoices.value.length === 0",
        "  effortChoices.value.length === 0",
    ),
    (
        "M9 · ⛔ the sentence goes back to being a tooltip — nothing on screen says why",
        LAUNCHER,
        '              <p v-else-if="effortSilence" class="reason-hint" data-cy="reasoning-silence">\n                {{ effortSilence }}\n              </p>\n',
        "",
    ),
    (
        "M10 · ⛔ the dead control is not even greyed (118)",
        LAUNCHER,
        '                    :disabled="effortSilence !== null"\n',
        "",
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
