#!/usr/bin/env python3
"""
180 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean. ⚑ `home-boot.ts` in particular was reformatted
by prettier AFTER it was first written, and these anchors are from the formatted file.

## What this table is about

180 stopped two `codex app-server` processes from booting on one home at the same moment. The
provider creates its sqlite state as it starts and does not serialize that with itself; measured
against the bundled 0.146.0 binary, **7 trials in 10 lost an app-server** with both spawns in one
tick, and the loser's exit reached the launcher as the whole of what a first message got you.

  * **M1** takes the wait out of the gate — the exact pre-180 behaviour, both launches spawning in
    the same tick. ⚑ This is the mutation that reproduces the defect, and the live probe
    `probe:codex-home-race` was RUN against it: **7/10 trials lost an app-server**, 0/10 without it.
  * **M2** releases the slot at acquisition, so the gate exists and holds nothing.
  * **M3** stops `listModels` letting go at the handshake, so the probe holds the home across its
    whole `model/list`. ⚠️ Nothing breaks visibly — it is a LATENCY defect, and the test that
    catches it is the one asserting where the gate lets go rather than that it exists.
  * **M4** keys the queue on the lexical path, so `/var/…` and `/private/var/…` become two homes
    with one directory underneath. 178 lost a live assertion to exactly this spelling.
  * **M5** removes the fail-open timer: a boot that never answers would then forbid every later
    Codex launch on that home for the life of the process. ⛔ A race mitigation that can deadlock is
    a worse defect than the race.
  * **M6** stops the transport recognising the sqlite death, so the Rust line is forwarded again —
    180 §3's whole subject.
  * **M7** drops the home out of that sentence, leaving a message with nothing actionable in it.
    ⚑ Its test fixture is a home shaped like a REAL one — `~/Library/Application Support/…`, space
    and all — because the first version of this message scraped the path out of the child's stderr
    with `\\S+` and would have shown a user `/Users/x/Library/Application` and stopped. The path is
    read from the env the transport spawned with now, which is the only copy the app can vouch for.
  * **M8** takes back the already-aborted arm of `cancelWith`. ⛔ **Not an invented slip**: adding
    the gate's `await` is what made that hole reachable, and two of 070's own tests found it.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The sqlite failure itself.** No `vitest` mutation can produce it: it needs two real
    app-servers, a real cold `CODEX_SQLITE_HOME`, and it lands ~7 times in 10. The instrument for
    that half is `packages/runtime/smoke/codex-home-race.smoke.ts`, which is a SMOKE — `pnpm run ci`
    never runs it, so it is absent from every column below. It was run by hand, both ways
    (175's point, unchanged: live assertions are not in `vitest`).
 2. **Whether the app's two spawns are still 159 ms apart.** That was measured by watching the
    process table during a cold run, not asserted anywhere. The gate makes the number stop
    mattering, which is the point, but nothing in this repo would notice it changing.
 3. **The cross-process case.** The gate is in-process. Two BroBot2 instances on one `userData`
    would still race and nothing here can see it — see `home-boot.ts` for why that is out of reach
    rather than overlooked.
 4. **Step 38 of `smoke:ui`.** It was green 5/5 BEFORE this change and 3/3 after, which is a fact
    about how rarely the race fires in that step, not evidence the fix works. The evidence is M1.
"""

import sys
from pathlib import Path

BOOT = "packages/runtime/src/codex/home-boot.ts"
RUNTIME = "packages/runtime/src/codex/codex-runtime.ts"
TRANSPORT = "packages/runtime/src/codex/codex-transport.ts"
BOUNDED = "packages/runtime/src/internal/bounded.ts"

MUTATIONS = [
    (
        "M1 · ⛔ the gate does not WAIT — pre-180 exactly: both app-servers spawn in one tick",
        BOOT,
        "  if (ahead !== undefined) await waitAtMost(ahead, opts.waitMs ?? BOOT_WAIT_MS)\n",
        "",
    ),
    (
        "M2 · ⛔ the slot is released at acquisition — a gate that holds nothing",
        BOOT,
        "  let done = false\n  return () => {",
        "  release()\n  let done = false\n  return () => {",
    ),
    (
        "M3 · ⚠️ the probe holds the home across its whole `model/list`, not just the handshake",
        RUNTIME,
        "      bootSettled() // the state runtime exists; `model/list` below is a network wait (180)\n",
        "",
    ),
    (
        "M4 · ⛔ the queue is keyed lexically — `/var/…` and `/private/var/…` become two homes",
        BOOT,
        "    return realpathSync(providerHome)",
        "    return resolve(providerHome)",
    ),
    (
        "M5 · ⛔ the fail-open timer goes — one stuck app-server forbids every later launch",
        BOOT,
        "    const timer = setTimeout(done, waitMs)",
        "    const timer = setTimeout(() => {}, waitMs)",
    ),
    (
        "M6 · ⛔ the transport stops recognising the sqlite death — the Rust line is forwarded again",
        TRANSPORT,
        "    if (!/failed to initialize sqlite state runtime/i.test(this.stderrTail)) {",
        "    if (!/failed to initialise sqlite state runtime/i.test(this.stderrTail)) {",
    ),
    (
        "M7 · ⛔ the message stops naming the home — a sentence with nothing actionable in it",
        TRANSPORT,
        "    const where = this.sqliteHome ? ` in ${this.sqliteHome}` : ''",
        "    const where = ''",
    ),
    (
        "M8 · ⛔ `cancelWith` goes back to ignoring an ALREADY-aborted signal — 070's leak, reachable",
        BOUNDED,
        "  if (signal.aborted) onAbort()\n  else signal.addEventListener('abort', onAbort, { once: true })",
        "  signal.addEventListener('abort', onAbort, { once: true })",
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
