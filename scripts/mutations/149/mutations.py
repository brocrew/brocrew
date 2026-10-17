#!/usr/bin/env python3
"""
149 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

`suite` selects which vitest project the runner uses: `node` (runtime + desktop) or `dom`.

⚠️ **Anchors are taken from the FORMATTED source.** 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the exact string the entry was anchored on. Every target here was
copied after the last format run, and `mutate.sh` refuses rather than reporting a green if one of
them stops matching.
"""

import sys
from pathlib import Path

AUTH = "packages/runtime/src/internal/auth.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
# ⚑ **470 · where `signInHeldBy`'s RULE lives now.** HO-028 §3 put a second reopen offer on the
# grant sheet, so the question *is this conversation holding work a reopen would destroy* moved
# out of the pane and into a module both surfaces read. ⛔ M29's defect is byte-for-byte the one
# 149 wrote — the waiting-card arm stops holding the button back — and only its address moved.
REOPENING = "apps/desktop/src/renderer/src/lib/reopening.ts"

# (name, suite, [(file, old, new), ...])
# ⚑ **708 · anchors corrected in place, not retired** (standing rule 27): `R42` handed every turn
# gate a `from`, so each `assertCanTakeTurn(` call gained that key and most now span several
# lines; the rows below that named a gate call were re-spelled to it and each re-verified RED
# alone, with its killer named in 708's response.
MUTATIONS = [
    # ---- 148 H4 · the Keychain read that could freeze the app ------------------------------------
    (
        "M1 · the turn-path read is the BLOCKING one wrapped in a promise (H4, undone)",
        "node",
        [
            (
                AUTH,
                # ⚑ **710 · re-anchored in place, not retired** — `710`'s second review put the spawn inside a `try` (a synchronous refusal resolves `null`); the row still wraps the BLOCKING read in a promise.
                "  return new Promise((resolve) => {\n    try {\n      execFile(",
                "  return Promise.resolve(defaultKeychainReader()).then((v) => v as string | null)\n  // eslint-disable-next-line no-unreachable\n  return new Promise((resolve) => {\n    try {\n      execFile(",
            )
        ],
    ),
    (
        "M2 · the asynchronous read has no deadline",
        "node",
        [
            (
                AUTH,
                # ⚑ **710 · re-anchored in place, not retired** — `710`'s second review indented the spawn into a `try`; the row still drops the deadline.
                "          encoding: 'utf8',\n          timeout: KEYCHAIN_READ_TIMEOUT_MS,\n          killSignal: 'SIGKILL',\n        },\n        (error, stdout) => {",
                "          encoding: 'utf8',\n        },\n        (error, stdout) => {",
            )
        ],
    ),
    (
        "M3 · a deadline `security` can ignore (SIGTERM, inside a Keychain prompt)",
        "node",
        [
            (
                AUTH,
                # ⚑ **710 · re-anchored in place, not retired** — `710`'s second review indented the spawn into a `try`; the row still drops the kill `security` cannot ignore.
                "          timeout: KEYCHAIN_READ_TIMEOUT_MS,\n          killSignal: 'SIGKILL',\n        },\n        (error, stdout) => {",
                "          timeout: KEYCHAIN_READ_TIMEOUT_MS,\n        },\n        (error, stdout) => {",
            )
        ],
    ),
    (
        "M4 · the LAUNCH read goes back to being unbounded",
        "node",
        [
            (
                AUTH,
                "      timeout: KEYCHAIN_READ_TIMEOUT_MS,\n      killSignal: 'SIGKILL',\n    }).trim()",
                "    }).trim()",
            )
        ],
    ),
    (
        "M5 · a killed read THROWS instead of yielding null (fail-open, lost)",
        "node",
        [
            (
                AUTH,
                "        resolve(error ? null : stdout.trim())",
                "        if (error) throw error\n        resolve(stdout.trim())",
            )
        ],
    ),
    (
        "M6 · the non-blocking provider skips the parse it shares with its twin",
        "node",
        [
            (
                AUTH,
                "    const parsed = parseClaudeOAuthToken(await reader(), clock())\n    return parsed ? parsed.accessToken : null",
                "    return await reader()",
            )
        ],
    ),
    # ---- 147's detection, still load-bearing ----------------------------------------------------
    (
        "M7 · the handle is handed the BLOCKING reader again (H4, arriving through the wiring)",
        "node",
        [
            (
                CLAUDE,
                "      // machine's without freezing the process that asks.\n      this.authTokenProviderAsync,",
                "      // machine's without freezing the process that asks.\n      this.authTokenProvider as never,",
            )
        ],
    ),
    (
        "M8 · a Keychain that yields nothing counts as a supersession",
        "node",
        [(CLAUDE, "    if (current === null) return false //", "    if (current === null) return true //")],
    ),
    (
        "M9 · the answer does not latch",
        "node",
        [(CLAUDE, "    this._signInSuperseded = true\n    return true", "    return true")],
    ),
    (
        "M10 · the launch credential is never recorded (THE detection, disabled)",
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
        "M11 · a RESUMED session gets no credential watch",
        "node",
        [
            (
                CLAUDE,
                "        // that needs it least.\n        this.authTokenProviderAsync,",
                "        // that needs it least.\n        undefined,",
            )
        ],
    ),
    # ---- 148 H2 · every turn passes the gate ----------------------------------------------------
    (
        "M12 · the plan go-ahead skips the gate (THE H2 DEFECT)",
        # ⚑ Re-anchored by 234 §3 (M12, M13 and M15 together): the turn gate took the CONTENT rule
        # (`228` L1), so every `assertCanTakeTurn` call site hands over its text and attachment
        # count now. The rules these rows are about are unchanged, and 234's table re-runs all three.
        "node",
        [
            (
                HOST,
                "    if (text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
                "    if (false && text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
            )
        ],
    ),
    (
        "M13 · the plan gate runs BELOW the release, so the plan is lost for a turn that never went",
        "node",
        [
            (
                HOST,
                "    if (text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
                "",
            ),
            (
                HOST,
                "    await session.handle.setPlanMode(false)",
                "    await session.handle.setPlanMode(false)\n    if (text !== undefined) {\n      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })\n    }",
            ),
        ],
    ),
    (
        "M14 · ordinary `send` stops asking",
        "node",
        [
            (
                HOST,
                "    const session = this.require(sessionId)\n    await this.assertCanTakeTurn(session, 'send')\n    await session.handle.send(text)",
                "    const session = this.require(sessionId)\n    this.assertAcceptsMessages(session, 'send')\n    await session.handle.send(text)",
            )
        ],
    ),
    (
        "M15 · queueing stops asking",
        "node",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — queueAs still runs the
        # full assertCanTakeTurn('queue', ...) gate (content + sign-in) before deciding idle vs
        # busy; D-017 only wrapped it in a try/catch for the new 'start-it-again' race handling,
        # which shifted its indentation and broke the literal match. The defect (dropping to the
        # weaker assertAcceptsMessages, which is what the busy branch already calls a few lines
        # later) still plants the same bug: queueing onto a session with a stale sign-in is no
        # longer refused.
        [
            (HOST, "      await this.assertCanTakeTurn(session, 'queue', {\n        text,\n        attached: attachments.length,\n        from: this.originOf(by),\n      })", "      this.assertAcceptsMessages(session, 'queue')"),
        ],
    ),
    (
        "M16 · the queued flush stops asking (the turn nobody pressed anything for)",
        "node",
        [
            (
                HOST,
                "      await this.assertCanTakeTurn(session, 'send')\n      await session.handle.send(queued.text)",
                "      await session.handle.send(queued.text)",
            )
        ],
    ),
    (
        "M17 · the interrupt's SECOND check is removed (THE 148 M1 TOCTOU)",
        "node",
        [
            (
                HOST,
                "    await this.assertCanTakeTurn(session, 'send')\n    await session.handle.send(text)\n    // ⚠️ **Was missing, and 077 is when it started to matter.**",
                "    await session.handle.send(text)\n    // ⚠️ **Was missing, and 077 is when it started to matter.**",
            )
        ],
    ),
    (
        "M18 · the check itself is a no-op · killed by `sign-in-supersede.test.ts` (named by W4.78)",
        "node",
        [
            (
                HOST,
                # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-004's `reopenOnARenewedSignIn` asks the
                # same `checkSignIn` in the same words, so the line alone matched twice. The anchor
                # now carries the signature of `assertSignInCurrent`, the refusal this row disarms;
                # the defect is unchanged. Re-verified RED alone on `sign-in-supersede.test.ts`.
                # ⚑ **W4.78 · re-anchored in place, not retired** — e0e93e6e turned the early return into a block that also clears reopenedForWhatWaited; `if (true)` makes the check a no-op again. Killer: 'refuses the next turn once the machine sign-in has been replaced'.
                "  private async assertSignInCurrent(session: HostedSession, verb: 'send' | 'queue'): Promise<void> {\n    if ((await session.handle.checkSignIn?.()) !== true) {\n",
                "  private async assertSignInCurrent(session: HostedSession, verb: 'send' | 'queue'): Promise<void> {\n    if (true) {\n",
            )
        ],
    ),
    (
        "M19 · the state is published AFTER the throw, so the bar arrives after the refusal · killed by `sign-in-supersede.test.ts` (named by W4.78)",
        "node",
        [
            (
                HOST,
                # ⚑ **W4.78 · re-anchored in place, not retired** — e0e93e6e changed the thrown `new Error(` into `new ItsSignInMovedOn(`; the plant again drops the publish ahead of the throw. Killer: 'publishes the state BEFORE it throws' (asserts a liveness with signInSuperseded true after the refused send); medium because a later publish from elsewhere could mask it.
                "    this.publishStateIfChanged(session)\n    throw new ItsSignInMovedOn(\n      `cannot ${verb}: this conversation is holding the ${PROVIDER_NAME[session.provider]} ` +\n",
                "    throw new ItsSignInMovedOn(\n      `cannot ${verb}: this conversation is holding the ${PROVIDER_NAME[session.provider]} ` +\n",
            )
        ],
    ),
    (
        "M20 · the refusal stops being true of a RENEWAL (149 §6)",
        "node",
        [
            (
                HOST,
                "  claude: 'this computer has moved on to a different one since — a renewal counts',",
                "  claude: 'somebody replaced the one this computer had',",
            )
        ],
    ),
    # ---- 148 H5 · one projection, and a dedupe key that belongs to its sink ----------------------
    (
        "M21 · a reconnecting surface is handed the BARE liveness (THE H5 DEFECT)",
        "node",
        [
            (
                HOST,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 5ae6a3206 inserted provider-block disclosure; preserve it while handing the reconnecting surface bare liveness.
                "      liveness: livenessFor(session),\n      ...this.providerBlockDisclosure(session.id, session.provider),\n      history: options.history,",
                "      liveness: session.liveness.current,\n      ...this.providerBlockDisclosure(session.id, session.provider),\n      history: options.history,",
            )
        ],
    ),
    (
        "M22 · the dedupe key outlives the sink it describes",
        "node",
        [(HOST, "    session.lastDisclosures = ''\n    return this.discloseReopened(", "    return this.discloseReopened(")],
    ),
    (
        "M23 · the tracker publishes a SHORTER disclosure (the queued banner, wiped)",
        "node",
        [
            (
                HOST,
                "          session.sink.sendLiveness({ sessionId: id, liveness: livenessFor(session) })",
                "          session.sink.sendLiveness({\n            sessionId: id,\n            liveness: { ...session.liveness.current, ...sessionDisclosures({ provider, handle }) },\n          })",
            )
        ],
    ),
    (
        "M24 · the disclosure ASKS instead of reading the latch (a subprocess per publish)",
        "node",
        [
            (
                HOST,
                "    signInSuperseded: session.handle.signInSuperseded === true,",
                "    signInSuperseded: Boolean(session.handle.checkSignIn?.()),",
            )
        ],
    ),
    # ---- 148 H1 · close, then reopen, on the same record -----------------------------------------
    (
        "M25 · a record that ENDED cannot be adopted again (THE H1 DEFECT — the person's own report)",
        "node",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The H1 rule survives: a
        # record whose life stopped must be adoptable again. D-017b only renamed the phase `ended`
        # to `recorded` (`SessionPhase` is now 'opening'|'open'|'closing'|'recorded') and the guard
        # in `adoptHandover` now reads `phase !== 'recorded'`. The same guard also lets a recorded
        # record be looked at again and adopted live, so the rule matters more now.
        [
            (STORE, "    if (record.meta !== null && record.phase !== 'recorded') return false", '    if (record.meta !== null) return false'),
        ],
    ),
    (
        "M26 · a hand-over folds the previous life in on top of this one",
        "node",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # second hand-over for a conversation already adopted must not fold on top of it, because
        # `openWindow` clears the record and drops live events. `adoptHandover`'s first guard is now
        # `if (record.meta !== null && record.phase !== 'recorded') return false`; the old `'ended'`
        # string is gone. The plant removes that guard.
        [
            (STORE, "    if (record.meta !== null && record.phase !== 'recorded') return false", '    if (false) return false'),
        ],
    ),
    # ---- 148 M3 + §6 · the bar's words and the button's judgement --------------------------------
    (
        "M27 · `resume` reports success over a record the window cannot show (039)",
        "node",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — resume()'s guard against
        # reporting success over a record the window cannot show is untouched in spirit — D-017's
        # R10 only renamed the variable it checks. The line `if (!this.isOpen(sessionId))` became
        # `if (!this.isOpen(opened))` because a reopen can now come back as a REPLACEMENT
        # conversation (`opened` may differ from the requested `sessionId`); the isOpen check
        # itself, and the reason for it, are identical.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives:
        # `resume` must not report success over a record the window cannot show (a record a refused
        # twin deleted from the map). `this.isOpen` no longer exists (renamed `isLive`), and D-017b
        # replaced the old `if (!this.isOpen(opened)) {` guard with `return sessions.get(opened) ===
        # into ? opened : null` in `resume`. The plant makes it answer the id unconditionally.
        [
            (STORE, '        return sessions.get(opened) === into ? opened : null', '        return opened'),
        ],
    ),
    (
        "M28 · the button is live over live work again",
        "dom",
        [
            (
                PANE,
                "const canReopenSignIn = computed(() => signInHeldBy.value === null && !props.record.busy)",
                "const canReopenSignIn = computed(() => !props.record.busy)",
            )
        ],
    ),
    (
        "M29 · a card open no longer holds the button back (146 §1 by a third road)",
        "dom",
        [
            (
                REOPENING,
                "  if (sessionPanel(state).waiting > 0) return 'question'",
                "  if (false) return 'question'",
            )
        ],
    ),
    (
        "M30 · the bar stops saying what reopening costs",
        "dom",
        [
            (
                PANE,
                '          <p class="sign-in-bar-cost" data-cy="sign-in-cost">{{ signInBarCost }}</p>',
                '          <p class="sign-in-bar-cost" data-cy="sign-in-cost"></p>',
            )
        ],
    ),
    (
        "M31 · the bar goes back to accusing somebody of switching account",
        "dom",
        [
            (
                PANE,
                "              changed since. No more turns can go out on the old one.",
                "              been replaced by somebody since. No more turns can go out on the old one.",
            )
        ],
    ),
    (
        "M32 · the plan go-ahead button stays live on a superseded sign-in (148 H2, renderer half)",
        "dom",
        [
            (
                PANE,
                "  () => composerState.value === 'idle' && !props.record.busy && !signInSuperseded.value,",
                "  () => composerState.value === 'idle' && !props.record.busy,",
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
    raise SystemExit(main())
