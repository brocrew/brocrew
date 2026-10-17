#!/usr/bin/env python3
"""235's mutation table — each row is THE DEFECT, put back verbatim (131).

235 is two sentences.

**One:** an event of ours that fails its own schema is REPLACED by an `unknown` and the stream
carries on — and until this dispatch the replacement was indistinguishable from honest provider
chatter. `230` H1 named exactly what that costs: *"a log that dropped `tool_call` rows specifically,
while still recording turns and messages, would be invisible to them — and `snapshot().tools` reads
the same list, so there is no third surface to ask."* `degradeEvent` is the third surface.

**Two:** the instrument that would have measured the run that found it was reading its verdict off
stdout — `grep -E '^ *Tests +' | tail -1` — which is an assumption about ordering dressed as a
parse, in a repository that runs vitest inside vitest on purpose.

The row groups:

 * `M1`-`M2`   🔴 **the erasure goes invisible again**, on each of its two carriers: the machine
              field an instrument counts, and the label a person and the live smoke read.
 * `M3`-`M4`   ⛔ **the two DOORS.** `toRuntimeEvent` and the desktop wire boundary both turn a
              malformed event of ours into an `unknown`; a rule changed at one of them is a rule
              nothing can rely on (233's lesson, applied before it could be repeated).
 * `M5`-`M8`   **what the marker must refuse to do** — echo a hostile type, throw on a candidate
              that will not be read, invent a name it does not have, or brand honest chatter as an
              erasure.
 * `M9`-`M10` ⛔ **the verdict channel** (206 H2 · re-verified 231): the last-line stdout parse put
              back, and the missing-report case falling silently back to zeros.
 * `M11`      the lock message that sends an operator to a command that crashes.
 * `M12`-`M13` ⛔ **the cleanup that runs twice**, and the restore with no pristine copy to run from.
 * `M14`      the wire boundary degrading in silence.
 * `M15`      the field removed from the schema, so the marker is stripped at the next boundary.
 * `M16`-`M18` ⛔ **the three an adversarial pass over this dispatch's OWN diff found**: the marker's
              namespace shared with provider strings; a guard placed one call too late, because Zod
              reads the discriminant before we do and both doors still threw; and a cleanup that
              aborted on an unset `$WORK` and leaked the repository-global lock.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row makes a shipped adapter emit a malformed `tool_call`, because none can.** 235 §1
   measured it: **418 `tool_call` frames** (342 Claude, 76 Codex) among 2,337 emitted under every
   JSON-reachable input, and **zero** failed the schema — every field is either literal-guarded or
   comes from a summarizer that cannot return anything but a string.
   `packages/runtime/test/tool-call-integrity.test.ts` is that measurement kept as a guard; the rows
   below mutate the BOUNDARY, which is where the erasure would happen if an adapter ever did. A row
   that fabricated a malformed adapter would be testing a fixture rather than the code.
 * **No row reaches the live smoke.** `ui-live-smoke.mjs` is ui-dev's this week and out of bounds;
   the response names the exact assertion a step should make. What is proved here is that the signal
   is on the surface such a step reads — `describeEvent` renders it — not that a step reads it.
 * ⛔ **No row proves the `console.warn` WORDING.** `M14` removes the warning and dies in the spy
   test that an adversarial pass over this diff forced into existence — the first draft of this
   table asserted that spy existed when it did not, and the row would have been recorded as a
   survivor. What a person makes of the sentence is still not a claim a table can make.
 * **`suite_count` has no row of its own.** It is `run_suite`'s parse in a second function, and the
   tables' own `only_count` copies are not in this dispatch's file list — the response reports the
   census instead of pretending a row covers it.
"""

from pathlib import Path

EV = "packages/runtime/src/events.ts"
WIRE = "apps/desktop/src/main/runtime/event-wire.ts"
HARN = "scripts/mutations/lib/harness.sh"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the erasure goes invisible again ---------------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim (230 M3's residual) · the replacement stops saying what it "
        "replaced, so an erased tool_call and a turn that called no tools are the same ledger",
        [
            (
                EV,
                "  if (named !== undefined) event.degradedFrom = named\n  return event",
                "  return event",
            )
        ],
    ),
    (
        "M2 · ⛔ the human/live-smoke half · the label stops naming the erasure, so the one surface a "
        "live step can read (`describeEvent` → `.rdetail`) goes back to looking like chatter",
        [
            (
                EV,
                "  const label = named === undefined ? DEGRADED_UNNAMED : `${DEGRADED_LABEL_PREFIX}${named}`",
                "  const label = named === undefined ? DEGRADED_UNNAMED : named",
            )
        ],
    ),
    # ---- the two doors ----------------------------------------------------------------------------
    (
        "M3 · ⛔ the OTHER door · `toRuntimeEvent` builds its own unmarked `unknown` again — the "
        "'changed the rule at ONE of its N call sites' class, which is what 233's adversarial pass "
        "found in 233's own diff",
        [
            (
                EV,
                "  return degradeEvent(provider, candidate)\n}",
                "  return { type: 'unknown', provider, category: 'unrecognized', raw: boundRaw(candidate) }\n}",
            )
        ],
    ),
    (
        "M4 · ⛔ the WIRE door · the boundary wraps our own malformed event as if it were provider "
        "chatter again, which is the exact confusion 235 exists to end",
        [
            (
                WIRE,
                "import { degradeEvent, parseRuntimeEvent, type RuntimeEvent } from '@brobot2/runtime'",
                "import { parseRuntimeEvent, wrapUnknown, type RuntimeEvent } from '@brobot2/runtime'",
            ),
            (
                WIRE,
                "    const degraded = degradeEvent(provider, event, toCloneable(event))",
                "    const degraded = wrapUnknown(provider, toCloneable(event))",
            ),
        ],
    ),
    # ---- what the marker must refuse to do --------------------------------------------------------
    (
        "M5 · a hostile `type` is echoed into a log line and a DOM row — the guard that says a name "
        "has to look like a name is removed",
        [
            (
                EV,
                "const DEGRADED_TYPE_PATTERN = /^[a-z][a-z_]{0,63}$/",
                "const DEGRADED_TYPE_PATTERN = /^[\\s\\S]*$/",
            )
        ],
    ),
    (
        "M6 · reading the type off a candidate that has already failed validation is done without a "
        "guard, so a throwing getter or a revoked proxy takes the event pump with it",
        [
            (
                EV,
                "  let type: unknown\n  try {",
                "  let type: unknown\n  if (true) {",
            ),
            (
                EV,
                "    type = (candidate as Record<string, unknown>)['type']\n  } catch {\n    return undefined\n  }",
                "    type = (candidate as Record<string, unknown>)['type']\n  }",
            ),
        ],
    ),
    (
        "M7 · a frame with no readable name is given one anyway — `degradedFrom` stops meaning 'this "
        "is what it was' and starts meaning 'this is what we guessed'",
        [
            (
                EV,
                "  if (named !== undefined) event.degradedFrom = named",
                "  event.degradedFrom = named ?? 'unknown'",
            )
        ],
    ),
    (
        "M8 · ⛔ honest chatter is branded an erasure · `wrapUnknown` fills the field in from the "
        "payload, so a provider frame that merely CONTAINS `type: 'tool_call'` is reported as one of "
        "ours that we lost (007 P2-8, on the other side)",
        [
            (
                EV,
                "  if (shown) event.label = shown\n  return event\n}",
                "  if (shown) event.label = shown\n"
                "  const kind = (raw as { type?: unknown })?.type\n"
                "  if (typeof kind === 'string') event.degradedFrom = kind\n"
                "  return event\n}",
            )
        ],
    ),
    # ---- the verdict channel (206 H2) -------------------------------------------------------------
    (
        "M9 · ⛔ THE 206 H2 DEFECT, verbatim · the verdict is read from the LAST `Tests` line in "
        "captured stdout again, so a nested vitest summary decides whether a mutation was killed",
        [
            (
                HARN,
                "  status=$?\n"
                '  counts="$(summary_counts "$report")"\n'
                "  rm -f \"$report\"\n"
                '  read -r files tests failed <<<"$counts"',
                "  status=$?\n"
                "  rm -f \"$report\"\n"
                "  local line\n"
                "  line=\"$(printf '%s\\n' \"$out\" | grep -E '^ *Tests +' | tail -1)\"\n"
                "  files=\"$(printf '%s\\n' \"$out\" | grep -E '^ *Test Files +' | tail -1 | sed -nE 's/.*\\(([0-9]+)\\).*/\\1/p')\"\n"
                "  tests=\"$(printf '%s' \"$line\" | sed -nE 's/.*\\(([0-9]+)\\).*/\\1/p')\"\n"
                "  failed=\"$(printf '%s' \"$line\" | sed -nE 's/.*[^0-9]([0-9]+) failed.*/\\1/p')\"\n"
                '  failed="${failed:-0}"',
            )
        ],
    ),
    (
        "M10 · a missing report reads as zeros instead of as NO-REPORT — the fallback to the weaker "
        "channel that is how the weaker channel stays in use",
        [
            (
                HARN,
                "import json, sys\n"
                "with open(sys.argv[1]) as fh:\n"
                "    report = json.load(fh)\n"
                'print(len(report["testResults"]), report["numTotalTests"], report["numFailedTests"])',
                "import json, sys\n"
                "try:\n"
                "    with open(sys.argv[1]) as fh:\n"
                "        report = json.load(fh)\n"
                '    print(len(report["testResults"]), report["numTotalTests"], report["numFailedTests"])\n'
                "except Exception:\n"
                '    print("0 0 0")',
            )
        ],
    ),
    # ---- the message a person reads under pressure ------------------------------------------------
    (
        "M11 · the lock collision prints its arguments the wrong way round again, so the one "
        "instruction an interrupted operator is given raises ValueError (four dispatches recorded "
        "this and none fixed it)",
        [
            (
                HARN,
                "verify the anchors with \\`python3 <table>/mutations.py --dry-run .\\`",
                "verify the anchors with \\`python3 <table>/mutations.py . --dry-run\\`",
            )
        ],
    ),
    # ---- the cleanup that ran twice ---------------------------------------------------------------
    (
        "M12 · ⛔ THE 56-TABLE LINE, verbatim · the hand-written trap put back inside the installer, "
        "so an interrupt cleans up twice and the second pass runs `cp` from a pristine copy that the "
        "first pass deleted",
        [
            (
                HARN,
                "  trap 'tree_cleanup' EXIT\n  trap 'trap - EXIT; tree_cleanup; exit 130' PIPE INT TERM HUP",
                "  trap 'restore; rm -rf \"$WORK\"; release_tree_lock' EXIT PIPE INT TERM HUP",
            )
        ],
    ),
    (
        "M13 · the restore runs with no pristine copy to restore from — one `cp` error per file, on "
        "top of whatever actually went wrong, which is where a real RESTORE FAILED gets buried",
        [
            (
                HARN,
                '  if [[ -d "${PRISTINE:-}" ]]; then restore; fi',
                "  restore",
            )
        ],
    ),
    # ---- the degradation nobody is told about -----------------------------------------------------
    (
        "M14 · the wire boundary degrades in silence · 085's rule, on the one event that means an "
        "adapter is emitting frames the contract refuses",
        [
            (
                WIRE,
                "    console.warn(\n"
                "      `runtime wire: ${provider} emitted an event that failed the contract and was replaced by ` +\n"
                "        `\\`unknown\\` — ${degraded.type === 'unknown' ? degraded.label : '?'}: ${parsed.reason}`,\n"
                "    )",
                "    void (\n"
                "      `runtime wire: ${provider} emitted an event that failed the contract and was replaced by ` +\n"
                "        `\\`unknown\\` — ${degraded.type === 'unknown' ? degraded.label : '?'}: ${parsed.reason}`\n"
                "    )",
            ),
        ],
    ),
    (
        "M15 · the field is taken back off the schema, so the marker is stripped by the very next "
        "boundary that re-validates the frame — present on the object, absent from the contract · killed by `events.test.ts` (named by W4.78)",
        [
            (
                EV,
                # ⚑ **W4.78 · re-anchored in place, not retired** — the field is still on unknownEventSchema but is no longer the last one: 33eb0dff added `passing` after it, so `})` no longer follows; deleting the line drops the field from the schema exactly as before (zod strips it on re-validation)
                "  degradedFrom: z.string().optional(),\n",
                "",
            )
        ],
    ),
    # ---- the two the adversarial pass over this dispatch's own diff added -------------------------
    (
        "M16 · ⛔ the marker's namespace is shared with provider data again · a Codex item whose own "
        "kind string is `degraded:tool_call` renders byte-identically to a real erasure on the ONE "
        "row a live step reads",
        [
            (
                EV,
                "  return label.startsWith(DEGRADED_LABEL_PREFIX) ? `provider:${label}` : label",
                "  return label",
            )
        ],
    ),
    (
        "M18 · ⛔ the cleanup aborts before it lets go of the lock · `$WORK` unguarded under the "
        "`set -u` every table sets, so a run that died before the scratch dir existed leaks the "
        "repository-global tree lock and refuses every later mutation run",
        [
            (
                HARN,
                '  if [[ -n "${WORK:-}" ]]; then rm -rf "$WORK"; fi',
                '  rm -rf "$WORK"',
            )
        ],
    ),
    (
        "M17 · ⛔ the guard goes back one call too late · Zod reads the discriminant off the "
        "candidate before we do, so a throwing getter escapes BOTH doors and takes the event pump "
        "with it — through a function documented 'Never throws' since HO-001",
        [
            (
                EV,
                "  let parsed: ReturnType<typeof runtimeEventSchema.safeParse>\n"
                "  try {\n"
                "    parsed = runtimeEventSchema.safeParse(candidate)\n"
                "  } catch (error) {\n"
                "    return { ok: false, reason: `reading the candidate threw: ${String(error)}` }\n"
                "  }",
                "  const parsed = runtimeEventSchema.safeParse(candidate)",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

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
