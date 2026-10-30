"""3025 · a Claude sign-in that changes ends the limits the sign-in before reached — 13a0ab52.

⛔ **The subject**: where this app sees the Mac's login move under a conversation (a send refused
for a moved sign-in, a child killed by a revoked one), it notes the moment, per PROVIDER; walls
recorded strictly before it are dropped before the fold, so they hold nothing, are not shown, and
what waited for them goes at once. One switch is one change: a life that began before the noted
change does not move it. A key, a re-copy or a sign-in in this app is NOT a change.

## ⚑ What a row here measures

 * ⚑ **M1–M3 are the store's drop** (`session-store.ts`, `providerLimitsSeen`): the strict `<`
   (a wall in the very instant of the change stays — M1; one a millisecond older goes — M2), and
   the key read off the wall's own provider (M3).
 * ⚑ **M4, M5 are the reopen door** (`reopenOnARenewedSignIn`): it notes the change (M4), and only
   after the sign-in is read as changed — a death on the same or a missing sign-in ends nothing (M5).
   M4's anchor is part of M5's; they plant different defects.
 * ⚑ **M6 is the deliberate exclusion**: `providerLoginChanged` (a key saved or removed, a re-copy,
   a sign-in in this app) does not end a wall. The anchored line predates the commit.
 * ⚑ **M7 is the noted instant**: the host's own `now`, not a millisecond early.
 * ⚑ **M8 is the send door** (`assertSignInCurrent`): a send refused for a moved sign-in notes it.
 * ⚑ **M9 is "one switch is one change"**: a life begun before the noted change reports the same
   change and does not move it, so a limit the new sign-in reached since still holds.
 * ⚑ **M10 is the hold's read** (`theResetItWaitsFor`): the hold reads the walls without the old
   sign-in's, so what waited goes.

M1–M7 are killed only by the new file (`a-sign-in-that-changes-…`); M8–M10 by the commit's own
three cases in §4 of `a-usage-limit-is-named-and-waited-out.test.ts` (and M8, M10 by the new file too).

## ⛔ What this table does not contain

 * ⚠️ `lifeSince < noted` → `<=` in `aSignInChanged`: needs a life reserved in the exact noted
   millisecond; no deterministic killer.
 * ⚠️ The `queueMicrotask` → a direct call: no observable difference in these harnesses.
 * ⚠️ `limitsForAPerson` read without `this.signInChangedAt`: killed by §4's second case too, but
   left out to keep the table at ten; M10 is its twin on the hold's side.
 * ⚠️ `this.wallsForTheHold = null` and the `lookAtTheLimitAgain` call in `aSignInChanged`: the
   first is repeated inside the second, and dropping the second leaves the hold to a reset timer
   (60 s here) that the bounded waits outlast only as a timeout — not proposed.

## ⚑ Keyed by provider, not profile — by ruling (W4, W4.170)

A Claude sign-in is the Mac's one Keychain login, shared by every Claude profile, so a change is
machine-wide and the walls are the account's, not a profile's; a Claude API key is app-wide too.
So `signInChangedAt` is keyed by provider, and a change for one Claude profile ends every Claude
profile's walls. The tests pin that; it is not a gap.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

SIGNIN = "a-sign-in-that-changes-ends-only-the-limits-the-one-before-reached.test.ts"
USAGE = "a-usage-limit-is-named-and-waited-out.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a wall recorded in the very instant of the change is dropped — it could be the new "
        f"sign-in's first · killed by `{SIGNIN}`",
        # Re-anchored in place: the kept walls read tests the change on its own line.
        [(STORE,
          "          if (wall.at < changed) return []\n",
          "          if (wall.at <= changed) return []\n")],
    ),
    (
        "M2 · a wall a millisecond older than the change still holds · killed by "
        f"`{SIGNIN}`",
        # Re-anchored in place: the kept walls read tests the change on its own line.
        [(STORE,
          "          if (wall.at < changed) return []\n",
          "          if (wall.at < changed - 1) return []\n")],
    ),
    (
        "M3 · 🔴 **the key is not the provider** · a Claude change ends Codex's walls, and a Codex "
        f"change ends none · killed by `{SIGNIN}`",
        [(STORE,
          "const changed = signInChangedAt?.get(wall.provider)",
          "const changed = signInChangedAt?.get('claude')")],
    ),
    (
        "M4 · 🔴 a conversation killed by a sign-in renewed elsewhere reopens, but the old walls keep "
        f"holding and what waited still waits · killed by `{SIGNIN}`",
        [(HOST,
          "this.aSignInChanged(session.provider, session.lifeSince, session.profileId)",
          "void session.lifeSince")],
    ),
    (
        "M5 · 🔴 any death on a stale sign-in ends the walls, even on the same sign-in or a missing "
        f"one · killed by `{SIGNIN}`",
        [(HOST,
          # ⚑ **a refused Codex copy is replaced once · re-anchored in place, not retired** — the three lines stand two spaces deeper, inside the branch that a copy replaced by a fresh one of the same account does not take
          "        if ((await session.handle.checkSignIn?.()) !== true) return\n        // ⚑ The machine's login moved: the limits the login before reached stop applying.\n        this.aSignInChanged(session.provider, session.lifeSince, session.profileId)",
          "        this.aSignInChanged(session.provider, session.lifeSince, session.profileId)\n        if ((await session.handle.checkSignIn?.()) !== true) return")],
    ),
    (
        "M6 · 🔴 a key saved or removed, a re-copy or a sign-in in this app ends the walls, so held "
        f"words meet the old limit and are spent · killed by `{SIGNIN}`",
        [(HOST,
          "    this.forgetTheUsage(provider)\n    this.providersMoved({ what: 'login', provider })",
          "    this.forgetTheUsage(provider)\n    this.providersMoved({ what: 'login', provider })\n"
          "    this.aSignInChanged(provider, this.now())")],
    ),
    (
        "M7 · the change is noted a millisecond early: a wall a millisecond before it survives · "
        f"killed by `{SIGNIN}`",
        [(HOST,
          "this.signInChangedAt.set(provider, this.now())",
          "this.signInChangedAt.set(provider, this.now() - 1)")],
    ),
    (
        "M8 · 🔴 **the send door notes nothing** · a send refused for a moved sign-in leaves the old "
        f"account's walls holding until their reset · killed by `{USAGE}` and `{SIGNIN}`",
        # ⚑ W4.172 · re-anchored in place: the send door notes the change at once
        # (`noteASignInChange`), and releases what waited in a microtask.
        [(HOST,
          "      } else if (this.noteASignInChange(provider, session.lifeSince, session.profileId)) {\n",
          "      } else if (false) {\n")],
    ),
    (
        "M9 · 🔴 **one switch is many changes** · a conversation begun before the switch that reports "
        f"it later erases a limit the new sign-in reached since · killed by `{USAGE}`",
        # ⚑ W4.172 · re-anchored in place: the guard is in `noteASignInChange`, which says whether the
        # moment moved.
        [(HOST,
          "    if (noted !== undefined && lifeSince < noted) return false\n",
          "    if (noted !== undefined && lifeSince < noted && false) return false\n")],
    ),
    (
        "M10 · 🔴 the hold reads the old sign-in's walls: the limits are not shown, but what waited "
        f"still waits for their reset · killed by `{USAGE}` and `{SIGNIN}`",
        [(HOST,
          "        const epoch = this.providerLimitEpoch\n        const walk = this.deps.store.providerLimitsSeen(\n          now,\n          this.signInChangedAt,\n          this.limitAccountSnapshot(),\n        )\n",
          "        const epoch = this.providerLimitEpoch\n        const walk = this.deps.store.providerLimitsSeen(\n          now,\n          undefined,\n          this.limitAccountSnapshot(),\n        )\n")],
    ),
]
