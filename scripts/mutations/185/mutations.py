#!/usr/bin/env python3
"""
185 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a shell that is zsh. The pristine copy and the trap in `mutate.sh` are why this one
cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What this table is about

`withDeadline` has said since 058 that it *"releases the AWAITER; it does not release the work"*. On
the two Codex credential paths the work is a **detached `codex app-server`**, and neither path had
anything that could reach one: the check's `finally` cannot run until `initialize` returns, and the
sign-in's cancel handle does not exist until then either — its reservation's `cancel` was
`async () => {}`. Measured before the fix on the pinned 0.146.0 binary, 5 trials per path:
**5/5 left a live child, 5/5 left the home's boot gate held, 5/5 survived the app's own quit.**

Row by row:

  * **M1** takes the abort back out of the check's deadline path, so a check that times out releases
    only itself — the reported defect on path A, verbatim.
  * **M2** makes the sign-in reservation cancel nothing again (`PENDING_SIGN_IN`'s old body), which
    is the reported defect on path B.
  * **M3** puts the reservation skip back into `cancelProviderSignIn`, so the Cancel BUTTON stops
    reaching a sign-in that is still handshaking. ⚑ M2 and M3 are two different ways the same window
    was unreachable, and a table that only reverted one could not say which repair matters.
  * **M4** stops the quit reaching in-flight credential checks. ⚑ Sign-ins have had their own line in
    `closeAll` since 098; a check is the same detached child with no map to be walked past.
  * **M5** drops the post-start re-ask, which is the only thing covering the window between
    `CodexLogin.start` releasing its abort listener and the host storing the real handle.
  * **M6** unbounds `initialize` — the wait that started all of this. Nothing else changes, so this
    row is the one that says whether the bound alone would have been enough.
  * **M7** and **M8** unwire `cancelWith` on the check and on the sign-in respectively: the spawn is
    still made, the handshake is still bounded, and only ownership OF THE CHILD is gone. ⚑ Each is
    asserted *before* its promise is awaited, deliberately — the 8-second budget closes these
    transports too, so a test that awaited first would pass with no ownership at all and measure the
    deadline (180's lesson about a fake that finishes its work anyway).
  * **M9** unbounds `CodexLogin.cancel`'s courtesy request. A wedged app-server then never answers
    `account/login/cancel`, so `dispose()` — the only line that kills anything — is never reached,
    and `RuntimeHost.boundedCancel`'s promise that *"the process is still reaped"* becomes false.
  * **M10** raises the handshake bound to the host's own ten seconds, so the host's generic deadline
    is the one that fires again. Nothing hangs; the caller simply stops being told which step went
    quiet, and the child lives for the difference. ⚑ This row is what makes the NUMBER an argument
    rather than a preference.
  * **M11** restores the old boot-gate deletion (182 M1): a successor that failed open erases the
    still-pending predecessor's slot, and the next launch races the app-server the gate exists to
    serialize.
  * **M12** makes an arrival wait only for the LAST live boot rather than for all of them — the other
    half of M11, and the reason the home's entry is a set rather than a chain.
  * **M13** removes the abort arm from the queue wait (182 L1), so a caller who gave up keeps its
    place until the whole 15-second budget runs out.
  * **M14** drops `assertNotCancelled` from the sign-in, so a gesture cancelled before it started
    spawns an app-server anyway — 070's rule, which is what makes wiring the abort one line AFTER the
    spawn safe rather than lucky.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **A real process dying.** Every fake transport here answers `close()` honestly; a real
    app-server that ignored SIGTERM would look identical to it. The instrument for that half is
    `apps/desktop/smoke/credential-ownership.smoke.ts` — the pinned binary, attributed by executable
    AND cwd — and it is where the 5/5-before, 0/5-after rate comes from.
 2. **The numbers themselves.** M10 pins that the handshake bound is below the host's, which is the
    only part of "8 seconds" a test can hold. That 8 s is far enough above a real handshake is a
    measurement (180: 85–95 ms, 239 ms cold), not an assertion.
 3. **A second BroBot2 process.** The boot gate is in-process and per-home, and has been since 180.
    Nothing here changes that, and no row can see it.
 4. **`smoke:ui`.** No live step signs in or checks a credential — the sign-in panel is never opened
    by any of the 60 steps — so a pass proves nothing about either path. Stated, not skipped.

⚠️ **Projects: `runtime` AND `desktop`, derived from the files this table touches.** Two files are
under `packages/runtime/src` and two under `apps/desktop/src/main`. ⛔ **`dom`, `shared` and
`scripts` are NOT run, and that is a fact about the change**: 185 touched no renderer component and
no shared type.
"""

from __future__ import annotations

import sys
from pathlib import Path

LOGIN = "packages/runtime/src/codex/codex-login.ts"
BOOT = "packages/runtime/src/codex/home-boot.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS = [
    (
        "M1  · ⛔ the check's deadline releases only its waiter again — path A's defect, verbatim",
        HOST,
        "      owner.abort()\n",
        "",
    ),
    (
        "M2  · ⛔ the sign-in reservation cancels nothing — `PENDING_SIGN_IN`'s old body",
        HOST,
        "    cancel: async () => owner.abort(),",
        "    cancel: async () => {},",
    ),
    (
        "M3  · ⛔ the Cancel button skips a sign-in that has not finished starting",
        HOST,
        "    if (!signIn) return\n",
        "    if (!signIn || signIn.authUrl === '') return\n",
    ),
    (
        "M4  · ⛔ the quit walks past a credential check in flight",
        HOST,
        "    for (const check of this.authChecks) check.abort()\n",
        "",
    ),
    (
        "M5  · ⛔ a Cancel landing as the sign-in returns is lost again",
        HOST,
        "    if (startup.signal.aborted) {",
        "    if (false as boolean) {",
    ),
    (
        "M6  · ⛔ `initialize` is unbounded again — the wait that started all of this",
        LOGIN,
        "  const result = await bounded(transport.request('initialize', INITIALIZE_PARAMS), 'initialize')",
        "  const result = await transport.request('initialize', INITIALIZE_PARAMS)",
    ),
    (
        "M7  · ⛔ the CHECK spawns with nothing that owns the child · killed by `codex-login.test.ts` (named by W4.78)",
        LOGIN,
        # ⚑ **W4.78 · re-anchored in place, not retired** — ambiguous since 5fecec18 added changeCodexKeyInHome with an identical `cancel = cancelWith(signal, ...)` line; the comment line above pins it to probeCodexAuthInHome (the CHECK)
        "    // Ownership from the spawn, not from the handshake (070/185) — see {@link CodexLogin.start}.\n    cancel = cancelWith(signal, () => spawned.close())\n",
        "    // Ownership from the spawn, not from the handshake (070/185) — see {@link CodexLogin.start}.\n    cancel = cancelWith(undefined, () => spawned.close())\n",
    ),
    (
        "M8  · ⛔ the SIGN-IN spawns with nothing that owns the child",
        LOGIN,
        "    const cancel = cancelWith(signal, () => spawned.close())",
        "    const cancel = cancelWith(undefined, () => spawned.close())",
    ),
    (
        "M9  · ⛔ Cancel waits forever on the app-server it is cancelling, so nothing is reaped",
        LOGIN,
        "        await withDeadline(\n          this.transport.request('account/login/cancel', { loginId: this.loginId }),\n          LOGIN_CANCEL_ACK_TIMEOUT_MS,\n          'codex account/login/cancel',\n        )",
        "        await this.transport.request('account/login/cancel', { loginId: this.loginId })",
    ),
    (
        "M10 · ⛔ the handshake bound equals the host's, so the generic deadline fires first again",
        LOGIN,
        "export const CREDENTIAL_HANDSHAKE_TIMEOUT_MS = 8_000",
        "export const CREDENTIAL_HANDSHAKE_TIMEOUT_MS = 10_000",
    ),
    (
        "M11 · ⛔ a fail-open successor erases the still-pending predecessor's slot (182 M1)",
        BOOT,
        "    if (live.size === 0 && booting.get(home) === live) booting.delete(home)",
        "    if (booting.get(home) === live) booting.delete(home)",
    ),
    (
        "M12 · ⛔ an arrival waits only for the LAST live boot, not for every one",
        BOOT,
        "  const ahead = [...live]",
        "  const ahead = [...live].slice(-1)",
    ),
    (
        "M13 · ⛔ the queue wait cannot be cancelled — a caller who gave up keeps its place (182 L1)",
        BOOT,
        "    signal?.addEventListener('abort', onAbort, { once: true })\n",
        "",
    ),
    (
        "M14 · ⛔ a sign-in cancelled before it started spawns an app-server anyway",
        LOGIN,
        "    assertNotCancelled(signal, 'codex sign-in')\n",
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
