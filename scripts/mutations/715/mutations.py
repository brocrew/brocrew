"""715 · A `cd` is not a different conversation.

⚑ **Ordered by** the PM — the person's own BroBot conversation died on it, 2026-09-25 02:08 (ruled `R64`).

## 🔴 A · `R64` — the first init of a launch is the only one read (M1-M5)

⚑ Measured by `probe:claude-resume-after-cd` against the bundled CLI: `system/init` opens EVERY turn,
and since `680`'s bump (2.1.281; 2.1.218 did not) a later one names the folder the model's Bash
tool `cd`'d into. `validateInitRef` compared every init with the resumed ref, so a reopened
conversation died on the turn after a `cd`. The run loop now reads the FIRST init of a launch —
exactly as `011` requires, still refusing another id, another cwd, the moved folder itself and an
empty id — and hands a later one to nothing.

## ⚑ B · a later init reaches nothing — not the machine, not the ref (M6-M7)

⚑ **Save one, since `721` (R75):** the init after a `conversation_reset` moves the ref's id — never
its cwd, never the machine. That door's rows are table `721` §A; M7 here still measures every other
later init.

## ⛔ What this table cannot reach

 * ⚠️ **The live probes** (`probe:claude-resume-after-cd`, `probe:codex-resume-after-cd`, loopback,
   $0) — not in `ci`; their tables are in `715`'s response.
 * ⚠️ **`smoke:ui` step 83** — the person's path through the app (open, end, reopen, `cd`, one more
   message), run hidden on Haiku for `715` on `main` (RED: *"resume mismatch: … got …/findings"*)
   and on this branch (green).
 * ⚠️ **Codex** — nothing changed there: `validateHandshake` reads the handshake response once per
   launch, and the probe measured that a model's `cd` never moves what Codex reports.
"""

CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the first init is the only one read ─────────────────────────────────────────────
    (
        "M1 · 🔴 **every init is read again** — `main`'s behaviour: a later init naming the folder "
        "the model `cd`'d into ends a reopened conversation (the person's 02:08) — killed by "
        "`claude-runtime.test.ts` (715)",
        [(CLAUDE, "        if (candidate && !this.initRead) {\n", "        if (candidate) {\n")],
    ),
    (
        "M2 · 🔴 **the first init is never marked read** — so every later one is a first — killed by "
        "`claude-runtime.test.ts` (715)",
        [(CLAUDE, "        if (candidate && !this.initRead) {\n          this.initRead = true\n", "        if (candidate && !this.initRead) {\n")],
    ),
    (
        "M3 · ⛔ **the flag starts as read** — no init is ever read, so no session opens and no resume "
        "is proven — killed by `claude-runtime.test.ts` (715, 011)",
        [(CLAUDE, "  private initRead = false\n", "  private initRead = true\n")],
    ),
    (
        "M4 · ⛔ **the first init may name any folder UNDER the launch cwd** — R64 read as *\"a subfolder "
        "is fine\"* rather than *\"a later init is not a claim\"*; the moved folder passes as the "
        "resume's own — killed by `claude-runtime.test.ts` (715)",
        [(CLAUDE, "rawInitCwd !== this._targetRef.cwd", "!rawInitCwd.startsWith(this._targetRef.cwd)")],
    ),
    (
        "M5 · ⛔ **a later init is read again when it leaves the launch folder** — `cd ..` still ends a "
        "reopened conversation — killed by `claude-runtime.test.ts` (715)",
        [(CLAUDE, "        if (candidate && !this.initRead) {\n", "        if (candidate && (!this.initRead || !candidate.cwd.startsWith(this.cwd))) {\n")],
    ),
    # ── B · a later init reaches nothing ────────────────────────────────────────────────────
    (
        "M6 · 🔴 **a later init still reaches the machine** — the branch before its review: a session "
        "in `closing` is reopened by it and ends on the MOVED ref — killed by "
        "`claude-runtime.test.ts` (715, review F1)",
        [(CLAUDE, "        if (candidate && !this.initRead) {\n          this.initRead = true\n", "        if (candidate && this.initRead) this.machine.sessionStarted(candidate, this.opening)\n        if (candidate && !this.initRead) {\n          this.initRead = true\n")],
    ),
    (
        "M7 · ⛔ **a later init WRITES the ref** — the moved cwd becomes what the host archives and "
        "reopens from — killed by `claude-runtime.test.ts` (715)",
        [(CLAUDE, "        if (candidate && !this.initRead) {\n", "        if (candidate && this.initRead) this._ref = candidate\n        if (candidate && !this.initRead) {\n")],
    ),
]


if __name__ == "__main__":
    raise SystemExit("run through mutate.sh, never directly")
