#!/usr/bin/env python3
"""
147 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

`suite` selects which vitest project the runner uses: `node` (runtime + desktop) or `dom`.
"""

import sys
from pathlib import Path

AUTH = "packages/runtime/src/internal/auth.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"

# (name, suite, [(file, old, new), ...])
MUTATIONS = [
    # ---- the derived comparison ---------------------------------------------------------------
    (
        "M1 · the fingerprint IS the token (no digest at all)",
        "node",
        [(AUTH, "  return createHash('sha256').update(token, 'utf8').digest('hex')", "  return token")],
    ),
    (
        "M2 · the fingerprint is constant, so nothing ever differs",
        "node",
        [
            (
                AUTH,
                "  return createHash('sha256').update(token, 'utf8').digest('hex')",
                "  return createHash('sha256').update('constant', 'utf8').digest('hex')",
            )
        ],
    ),
    # ---- what a session records at launch ------------------------------------------------------
    (
        "M3 · the launch credential is never recorded (THE detection, disabled)",
        "node",
        [
            (
                CLAUDE,
                "    if (injected) handle.noteLaunchCredential(credentialFingerprint(injected))",
                "    if (false && injected) handle.noteLaunchCredential(credentialFingerprint(injected))",
            )
        ],
    ),
    (
        "M4 · the digest is taken from a SECOND read, not the injected bytes",
        "node",
        [
            (
                CLAUDE,
                "    const injected = additions.CLAUDE_CODE_OAUTH_TOKEN",
                "    const injected = this.authTokenProvider?.() ?? undefined",
            )
        ],
    ),
    (
        "M5 · a STARTED session gets no credential watch",
        "node",
        [
            (
                CLAUDE,
                "      // 147: the same bridge `childEnvAdditions` injects from, so this session can later ask whether\n      // the machine sign-in it launched with is still the machine's.\n      this.authTokenProvider,",
                "      undefined,",
            )
        ],
    ),
    (
        "M6 · a RESUMED session gets no credential watch",
        "node",
        [
            (
                CLAUDE,
                "        // …and a resumed session watches its sign-in exactly like a started one (147). Without this\n        // the fix would cover only conversations opened since the app launched, which is the half\n        // that needs it least.\n        this.authTokenProvider,",
                "        undefined,",
            )
        ],
    ),
    # ---- what the session concludes from it ----------------------------------------------------
    (
        "M7 · the answer does not latch",
        "node",
        [(CLAUDE, "    this._signInSuperseded = true\n    return true", "    return true")],
    ),
    (
        "M8 · a Keychain that yields nothing counts as a supersession (fail-closed in the wrong place)",
        "node",
        [
            (
                CLAUDE,
                "    if (current === null) return false // cannot tell — never a refusal, see above",
                "    if (current === null) return true",
            )
        ],
    ),
    (
        "M9 · the comparison always agrees, so a replaced sign-in is never noticed",
        "node",
        [
            (
                CLAUDE,
                "    if (credentialFingerprint(current) === this.launchCredential) return false",
                "    if (true) return false",
            )
        ],
    ),
    # ---- the host's turn boundary --------------------------------------------------------------
    (
        "M10 · the message gate stops asking (THE §2 DEFECT)",
        "node",
        [(HOST, "    this.assertSignInCurrent(session, verb)\n  }", "  }")],
    ),
    (
        "M11 · the check itself is a no-op",
        "node",
        [
            (
                HOST,
                "    if (session.handle.checkSignIn?.() !== true) return",
                "    if (true) return",
            )
        ],
    ),
    (
        "M12 · the state is published AFTER the throw, so the button arrives after the refusal",
        "node",
        [
            (
                HOST,
                "    this.publishStateIfChanged(session)\n    throw new Error(\n      `cannot ${verb}: this conversation is still running",
                "    throw new Error(\n      `cannot ${verb}: this conversation is still running",
            )
        ],
    ),
    (
        "M13 · the refusal stops naming the remedy",
        "node",
        [
            (
                HOST,
                "        'and your machine now has a different one. Nothing has been sent.',",
                "        '.',",
            )
        ],
    ),
    (
        "M14 · a QUEUED message flushes onto the old sign-in",
        "node",
        [(HOST, "      this.assertSignInCurrent(session, 'send')\n      await session.handle.send(queued.text)", "      await session.handle.send(queued.text)")],
    ),
    (
        "M15 · the disclosure never carries it, so no surface can render it",
        "node",
        [(HOST, "    signInSuperseded: session.handle.signInSuperseded === true,", "    signInSuperseded: false,")],
    ),
    (
        "M16 · the disclosure ASKS instead of reading the latch (a subprocess per publish)",
        "node",
        [
            (
                HOST,
                "    signInSuperseded: session.handle.signInSuperseded === true,",
                "    signInSuperseded: session.handle.checkSignIn?.() === true,",
            )
        ],
    ),
    # ---- what the renderer does with it --------------------------------------------------------
    (
        "M17 · the close result is invented, so a refused close still reopens",
        "node",
        [(STORE, "      else if (record.phase === 'closing' && was !== undefined) record.phase = was\n      return ok", "      else if (record.phase === 'closing' && was !== undefined) record.phase = was\n      return true")],
    ),
    (
        "M18 · the bar is never drawn",
        "dom",
        [
            (
                PANE,
                '<div v-if="signInSuperseded" class="sign-in-bar" data-cy="sign-in-superseded">',
                '<div v-if="false && signInSuperseded" class="sign-in-bar" data-cy="sign-in-superseded">',
            )
        ],
    ),
    (
        "M19 · an ABSENT disclosure reads as a supersession (the flicker before the host answers)",
        "dom",
        [
            (
                PANE,
                "const signInSuperseded = computed(() => props.record.meta?.liveness.signInSuperseded === true)",
                "const signInSuperseded = computed(() => props.record.meta?.liveness.signInSuperseded !== true)",
            )
        ],
    ),
    (
        "M20 · the button is live during another command (a double press double-reopens)",
        "dom",
        [
            (
                PANE,
                '            :disabled="props.record.busy"\n            title="Close this session and open it again',
                '            :disabled="false"\n            title="Close this session and open it again',
            )
        ],
    ),
    (
        "M21 · the button asks for nothing (106's control that cannot act)",
        "dom",
        [(PANE, "@click=\"emit('reopenSignIn')\"", '@click="undefined"')],
    ),
    (
        "M22 · the sentence stops saying nothing is lost",
        "dom",
        [
            (
                PANE,
                "            take another turn on the old one — reopen it to carry on. Nothing here is lost.",
                "            take another turn on the old one.",
            )
        ],
    ),
]


def main() -> int:
    if sys.argv[1] == "--count":
        print(len(MUTATIONS))
        return 0
    if sys.argv[1] == "--name":
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    if sys.argv[1] == "--suite":
        print(MUTATIONS[int(sys.argv[2])][1])
        return 0

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(f"MUTATION DID NOT APPLY: {rel} matched {found} times, expected 1", file=sys.stderr)
            return 2
        path.write_text(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
