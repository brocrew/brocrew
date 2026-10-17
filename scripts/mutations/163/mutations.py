#!/usr/bin/env python3
"""
163 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand** (157's dry-run corrupted three source files that way; 129's trap
and the pristine copy in `mutate.sh` are the reason this one cannot).

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on.

## What the table is about

163 fixes two things that had nothing in common except the moment they happen — the process ending.

⛔ **M1–M6 are the quit signal.** The defect is that a SECOND `SIGINT` killed the process from the
kernel, mid-teardown, because Chromium restores the default disposition after handing us the first
one. M5 and M6 are the ones that matter most: they move the listeners back to where 075 put them,
where they are silently overwritten and never fire — a mutation that only the source scan can catch,
because every policy test in `app-lifetime.test.ts` goes on passing over a signal the app never sees.

⛔ **M7–M10 are what a row says when the provider never named it**, and M9/M10 are the vacuity trap
itself: the ref row's placeholder is a non-empty string, so a test that asks `length > 0` reads it as
a thread id. That is exactly how step 44 came to kill the app inside the window it was waiting past.

⛔ **M11–M12 are the ruling** — the ref must reach disk the moment it is known, not at the next
convenient write.
"""

import sys
from pathlib import Path

LIFETIME = "apps/desktop/src/main/app-lifetime.ts"
INDEX = "apps/desktop/src/main/index.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
INFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"

REGISTRATION = """    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => lifetime.quitSignal(signal))
    }
"""

REASON_BRANCH = """  return row.has_events === 0
    ? 'no turn was ever taken in this one, so there is nothing to reopen'
    : `this one stopped before ${provider} gave it an id, so there is nothing to reopen`
"""

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · the quit signal -----------------------------------------------------------------
    (
        "M1 · 068 finding 1 IS BACK · a repeat signal exits at once, through the middle of the "
        "teardown — what the kernel used to do for us",
        [
            (
                LIFETIME,
                "      if (forcedExit !== null) return\n",
                "      deps.exit(1)\n      if (forcedExit !== null) return\n",
            )
        ],
    ),
    (
        "M2 · …and the opposite: the repeat is absorbed FOREVER, so SIGTERM stops working (094/095)",
        [
            (
                LIFETIME,
                "      if (forcedExit !== null) return\n",
                "      if (forcedExit !== null) return\n      if (signalled > 1) return\n",
            )
        ],
    ),
    (
        "M3 · the impatience clock starts on the FIRST signal, so one polite quit is cut short at 20s",
        [(LIFETIME, "      signalled += 1\n", "      signalled += 2\n")],
    ),
    (
        "M4 · the first signal does not quit at all — the listeners exist and the app ignores them",
        [
            (
                LIFETIME,
                "        try {\n          deps.quit()\n        } catch (error) {\n"
                "          deps.log(`BroBot2 failed to quit on ${signal}:`, error)\n        }\n",
                "        void signal\n",
            )
        ],
    ),
    (
        "M5 · ⛔ 075 IS BACK · the listeners move to the top of the main script, where Chromium "
        "overwrites them and they never fire",
        [
            (INDEX, REGISTRATION, ""),
            (
                INDEX,
                "app.on('before-quit', (event) => lifetime.beforeQuit(event))\n",
                "for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {\n"
                "  process.on(signal, () => lifetime.quitSignal(signal))\n}\n"
                "app.on('before-quit', (event) => lifetime.beforeQuit(event))\n",
            ),
        ],
    ),
    (
        "M6 · …or they go entirely, leaving Chromium's one-shot handler in charge again",
        [(INDEX, REGISTRATION, "")],
    ),
    # ---- §2 · what a row with no ref says ------------------------------------------------------
    (
        "M7 · 151's sentence IS BACK for both branches · a killed conversation is told no turn was "
        "ever taken in it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # killed conversation must not be told that no turn was ever taken in it (163 / 086). D-017b
        # changed both branch sentences from 'nothing to reopen' to 'nothing to carry on from', so
        # the whole two-branch return is collapsed to the single sentence at its new wording.
        [
            (STORE, "  return row.has_events === 0\n    ? 'no turn was ever taken in this one, so there is nothing to carry on from'\n    : `this one stopped before ${provider} gave it an id, so there is nothing to carry on from`", "  return 'no turn was ever taken in this one, so there is nothing to carry on from'"),
        ],
    ),
    (
        "M8 · …and the branch inverts, so a session that genuinely never started is described as "
        "having stopped partway",
        [(STORE, "  return row.has_events === 0\n", "  return row.has_events !== 0\n")],
    ),
    (
        "M9 · the ref row stops saying whether it is a ref, so only its prose can be asked (the "
        "state step 44 read a placeholder in)",
        [
            (
                INFO,
                '      <dd data-cy="session-ref" :data-announced="sessionRef ? \'yes\' : \'no\'">\n',
                '      <dd data-cy="session-ref">\n',
            )
        ],
    ),
    (
        "M10 · …or it always says yes, so the placeholder claims to be a thread id",
        [
            (
                INFO,
                ':data-announced="sessionRef ? \'yes\' : \'no\'"',
                ':data-announced="\'yes\'"',
            )
        ],
    ),
    # ---- §2 · the ruling: durable from the moment it is known -----------------------------------
    #
    # ⚠️ **Both anchors were RE-TAKEN in 199, not retired.** That dispatch gave the same write a
    # second trigger — a `conversation_reset` moves the ref too — which turned the one-line `if`
    # these were anchored on into a block, and `census.py --check` reported both rows stale. What
    # they protect is unchanged, so the anchors follow the source rather than the rows being
    # dropped. Re-run after re-taking; a stale anchor that is merely re-typed protects nothing.
    (
        "M11 · the ref is never written to the row at all, so nothing can ever be reopened",
        [
            (
                STORE,
                "      if (event.type === 'session' || event.type === 'conversation_reset') {\n"
                "        updateRef.run(serializeSessionRef(event.ref), at, sessionId)\n"
                "      }\n",
                "",
            )
        ],
    ),
    (
        "M12 · ⛔ the PM's ruling, reverted · the ref waits for the next convenient write — the "
        "session's END — so a crash before that loses it",
        [
            (
                STORE,
                "      if (event.type === 'session' || event.type === 'conversation_reset') {\n"
                "        updateRef.run(serializeSessionRef(event.ref), at, sessionId)\n"
                "      }\n",
                # ⚠️ 199's arm is left INTACT on purpose. This row is about 163's claim — that the
                # ref is durable from the moment it is known — and folding a second dispatch's
                # behaviour into the defect would make a failure here ambiguous about which one
                # broke.
                "      if (\n"
                "        (event.type === 'session' && event.state === 'ended') ||\n"
                "        event.type === 'conversation_reset'\n"
                "      ) {\n"
                "        updateRef.run(serializeSessionRef(event.ref), at, sessionId)\n"
                "      }\n",
            )
        ],
    ),
]


def apply(root: Path, index: int) -> bool:
    _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(f"!! {rel}: anchor found {found} times, expected exactly 1", file=sys.stderr)
            return False
        path.write_text(text.replace(old, new, 1))
    return True


if __name__ == "__main__":
    if sys.argv[1] == "--count":
        print(len(MUTATIONS))
    elif sys.argv[1] == "--name":
        print(MUTATIONS[int(sys.argv[2])][0])
    else:
        sys.exit(0 if apply(Path(sys.argv[1]), int(sys.argv[2])) else 1)
