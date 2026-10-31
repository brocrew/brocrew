"""1004 · D-004 · a Claude conversation killed by a login renewed elsewhere reopens itself on it (`0f92f24e`).

⚑ **Why `1004`** (T-002): a table id must be a positive integer (`runner_contract.TABLE_ID`), and
the work model's cards have none, so card D-00N's table is `100N`.

D-004 → table 1004 · A Claude conversation killed by a login renewed elsewhere on this Mac reopens
itself on the new login (R101, landed 0f92f24e; census follow-up c8bc47da). The fix has five parts.
(1) The host marks a session whose fatal error is `auth_stale` (`deliver`). (2) After `finalize`,
the pump's `finally` calls `reopenOnARenewedSignIn`. Only when the dead handle's `checkSignIn()`
says a DIFFERENT valid token now holds does it call `resumeSession(id, watching, null, null,
'as-recorded', 'the-sign-in-was-renewed')`. It passes the window that watched the conversation die,
or none. (3) `because` is threaded into `reopenSession`'s `reopened` row. (4) The renderer store
sees `reopened`+`because` on an ended record and calls `store.resume` (attach + replay). (5) The
transcript draws REOPENED_ON_A_RENEWED_SIGN_IN once, at `warn`, and STALE_AUTH_NOTICE says the
renewed case needs no press ("Otherwise, to carry on…"). The failed turn is never re-sent. The table
has 13 rows. M1–M2 restore the defect (no hook, no mark). M3 is the "same token/expired keeps
today's stop" boundary. M4–M6 cover the why and where of the reopen: M4 the why, M5 the delivery, M6
the "does not wait on somebody looking" control from D-004a. M7 is the "never re-send" boundary.
M8–M10 are the window's take-back and the line (never drawn / drawn on every reopen). M11–M13
survived the card's own tests (see Verification): the line at `info` was hidden in the reading
view, STALE_AUTH_NOTICE's new sentence was pinned by nothing, and a mark widened to any fatal error
went unseen. All anchors were
counted == 1 on `main` @ `04463ecf`, the tree T-002 verified them on. Main's killers are
apps/desktop/test/a-conversation-reopens-on-a-renewed-sign-in.test.ts (describe 'D-004 · R101 — a
login renewed elsewhere reopens the conversation it killed'). Its `waitFor` throws after about 2 s
(400 × 5 ms), well inside the 60 s testTimeout, so a missing reopen is red by assertion, not by
timeout.

## ⚠️ What has no row here, and why

- `describe-event.ts`'s new caption ('…by itself, on a renewed sign-in (ours)'). It is a raw-stream
  caption; the transcript sweep asserts only `describeEvent(event) !== ''`, for the bare
  `{type:'reopened'}` and (since T-002) the `because` variant, and pins neither caption's words. 673
  left its own two captions unrowed for the same reason.
- `runtime-ipc.ts`'s `because?: 'the-sign-in-was-renewed'`. It is a type only, and tsc is its gate.
- The `publishOurs(…because === undefined ? … : …)` ternary. That is 673's `THE_ROW` anchor, which
  T-002 corrected in place. M4 puts back the same missing `because` one call upstream without
  sharing it.
- `if (this.launches.closed || …) return`, the quit guard. It is equivalent in practice: a closed
  launch table refuses the resume, and the host's catch swallows the refusal. No test lets a death
  race a quit.
- `|| this.slots.has(session.id)`, for when a person's own Reopen won the race. No test reaches the
  window between the death and the host's check, and it is not a boundary the card drew.
- `await session.launch.settled`. This is ordering mechanism. Dropping it would either be harmless
  or make `resumeSession` refuse 'not confirmed stopped' (caught), which is M1's outcome with a
  worse label.
- The renderer store's `record.phase === 'ended'` term. It is equivalent today: the host reopens
  only after `finalize` and the launch release, and the window's record ended on the fatal error
  before that.
- The store's `message.event.because === 'the-sign-in-was-renewed'` term. It is a boundary of the
  code, not of the card. The one other reopen that can reach a window's store at `handover === 0` on
  an ended record is `startAndSend`'s resume of a conversation a quit left open. If rowed, it is
  unmeasured and likely may-survive; worth a row only if the PM wants the take-back limited to this
  case.
- `event.fatal &&` in the mark. It is equivalent: `auth_stale` is only ever emitted fatal
  (`packages/runtime/src/claude/normalize.ts:214`).
- Splitting M3 into 'same token' and 'expired' arms. That distinction lives inside
  `ClaudeSessionHandle.checkSignIn` (`null` → false, same fingerprint → false) and is owned by the
  runtime's sign-in-supersede tests and the 147/149 tables. The host sees one boolean.
- Comment-only edits: `assertSignInCurrent`'s docblock and STALE_AUTH_NOTICE's docblock.

⚠️ No row for the words of REOPENED_ON_A_RENEWED_SIGN_IN. The D-004 test compared them only
against the constant itself (`item.text === REOPENED_ON_A_RENEWED_SIGN_IN`), so any rewording
survived, including dropping *"Nothing was re-sent: send again to carry on."*, the card's own
promise (M7's). T-002 pinned that sentence with a literal assertion instead of a row; the first
sentence is still compared only against the constant.

⚑ Beside other tables' anchors, none equal: M8 sits just below `242 M12`'s, M3 beside `149 M18`'s,
M12 abuts `672 M16`'s, and M4 is upstream of `673`'s `THE_ROW`.

## Verification

T-002 designed these rows read-only and verified each one alone with `verify_row.py`: applied,
its own killer files run, restored from bytes. The table has not been run.
- RED alone: M1–M4, M8, M9 on `a-conversation-reopens-on-a-renewed-sign-in.test.ts`; M5 there and on
  `nothing-waits-on-somebody-looking.test.ts`; M6 on the latter; M7 there and on
  `words-the-person-did-not-say.test.ts`; M10 on `transcript.test.ts`.
- ⚠️ **M11, M12 and M13 SURVIVED D-004's own tests.** T-002 added: the line's level and its
  visibility in the reading view, plus the card's own words (*"Nothing was re-sent…"*) (M11); the
  stop notice's new sentence in `transcript.test.ts` (M12); and a death with another cause on a
  renewed login, which keeps today's stop (M13). All three are RED now. It also added the
  `reopened` + `because` variant (`adds: 1`) to `transcript.test.ts`'s sweep of the events we author.
"""

HOST = 'apps/desktop/src/main/runtime/runtime-host.ts'
STORE = 'apps/desktop/src/renderer/src/lib/session-store.ts'
FOLD = 'apps/desktop/src/renderer/src/lib/transcript.ts'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        'M1 · 🔴 **THE DEFECT, restored: the teardown never looks at the login** — a Claude child killed by a login renewed elsewhere stays stopped, and the person reopens it and types *continue* (`sess_2066076d`) — killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (D-004)',
        [
            (HOST, '      void this.finalize(session, ending).then(() => this.reopenOnARenewedSignIn(session))\n', '      void this.finalize(session, ending)\n'),
        ],
    ),
    (
        "M2 · 🔴 **the death on a revoked sign-in is never marked** — the teardown's hook runs and finds nothing to act on, so the conversation stays stopped — killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (D-004)",
        [
            # Both fatal-error and failed-turn recovery can mark this same rejected life.
            (HOST, "      if (\n        (event.cause === 'auth_stale' && session.itRetriedRejectedLogin !== true) ||\n        canRenewRejected\n      ) {\n", "      if (false) {\n"),
            (HOST, "    session.diedOnAStaleSignIn = true\n    session.whatItsFailedTurnWasFor = wasFor\n", "    session.whatItsFailedTurnWasFor = wasFor\n"),
        ],
    ),
    (
        "M3 · ⛔ **it reopens whatever the machine login holds** — the same token (or an expired login) reopens by itself too, when the card keeps today's stop for both — killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (D-004, the same-token control)",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — c006ea64 (F076) moved the `this.slots.has(session.id)` half below the held-words step, so the launches.closed line stands alone above the checkSignIn gate; dropping the gate again reopens on whatever the login holds. Killer still asserts the same-token and expired-login controls (no second launch).
            (HOST, "      if ((await session.handle.checkSignIn?.()) !== true) return\n", ""),
        ],
    ),
    (
        'M4 · 🔴 **the reopen says no why** — the `reopened` row loses `because`, so the window never takes the conversation back and no line is drawn, while the provider conversation quietly runs again — killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (D-004)',
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) took modelAndEffort out of reopenSession; `because` is now its third argument. Killer still asserts the `reopened` row with because 'the-sign-in-was-renewed' and the window take-back.
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 0d73f79e added a page argument after because in the reopenSession call; the plant still drops the why, so the reopened row carries no because and the window never takes the conversation back.
            (HOST, "        return await this.reopenSession(slot, sink ?? NO_SURFACE, because, page)\n", "        return await this.reopenSession(slot, sink ?? NO_SURFACE, undefined, page)\n"),
        ],
    ),
    (
        "M5 · 🔴 **reopened unwatched though a person watched it die** — the conversation runs again with no owner and his window stays on the stop — killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (D-004) and D-004a's control in `nothing-waits-on-somebody-looking.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired —
        # `reopenOnARenewedSignIn`'s rule ('onto the window that was watching it... else unwatched,
        # as a wake does') is untouched by D-017; the call shrank from 6 args to 5 only because the
        # wake's now-deleted `admit` rail-thunk parameter was removed from `resumeSession`'s
        # signature, and `watching` is still the 2nd argument.
        # `nothing-waits-on-somebody-looking.test.ts`'s own D-004 census regex-asserts
        # `resumeSession(\s*session\.id,\s*watching,` and a `watching` count of 2, giving a
        # confirmed static-analysis killer alongside the behavioral one.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) dropped the 'as-recorded' model argument from resumeSession; watching is still the sink argument. Killer still asserts the window takes it back (handover 'attached').
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 0d73f79e made the renewed sign-in reopen read no history page ('not-read'), and 6c0df8b8 moved the call one level deeper into doReopenOnARenewedSignIn behind a queue; the plant still reopens unwatched though a window watched it die.
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. 7d2f08f06 wrapped resume in synchronous-work timing; preserve the timing wrapper while omitting only the watching sink.
            (HOST, "        await this.timedReopen('runtime sign-in renewed resume', () =>\n          this.resumeSession(session.id, watching, null, 'the-sign-in-was-renewed', 'not-read'),\n        )\n", "        await this.timedReopen('runtime sign-in renewed resume', () =>\n          this.resumeSession(session.id, null, null, 'the-sign-in-was-renewed', 'not-read'),\n        )\n"),
        ],
    ),
    (
        'M6 · ⛔ **a reopen that waits on somebody looking** — a conversation that died with no window watching it is never reopened, the planted shape D-004a named — killed by `nothing-waits-on-somebody-looking.test.ts` (D-004a §5 control)',
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — The watching line now occurs twice (also in startForWhatItHeld, D-017 R3), so the anchor carries the resumeSession line beneath it (whose 'as-recorded' argument 0c50fe0b removed). Killer §5 'the reopen on a renewed sign-in does not wait on somebody looking' still counts `watching` in the method body (2) and goes red at 3.
            (HOST, "      const watching = session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null\n      // ⚑ Only this reopen says the login was renewed for it.\n", "      const watching = session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null\n      if (watching === null) return\n      // ⚑ Only this reopen says the login was renewed for it.\n"),
        ],
    ),
    (
        "M7 · ⛔ **the failed turn is re-sent by itself** — the reopened child is handed the person's last words again, and a tool step that already ran runs twice — killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (D-004) and `words-the-person-did-not-say.test.ts` §1",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The docblock immediately
        # above `reopenOnARenewedSignIn` still says, verbatim, 'Never re-sends the failed turn: a
        # tool step may already have run' — the exact rule this row's plant violates — and
        # `a-conversation-reopens-on-a-renewed-sign-in.test.ts` still asserts no `user_turn` event
        # follows the `reopened` row. Only the call's own arg count shrank (the wake's `admit` param
        # was removed); `Caller = Pick<RuntimeEventSink,'ownerId'>` so `session.sink` still
        # satisfies `this.send`'s third parameter with no type mismatch.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) dropped the 'as-recorded' argument from the resumeSession call; the re-send plant is unchanged (send(sessionId, text, by) and store.events still exist). Killer still asserts no user_turn after the `reopened` row.
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 0d73f79e added the 'not-read' page argument and 6c0df8b8 moved the call inside a try in doReopenOnARenewedSignIn; the plant still re-sends the failed turn right after the reopen.
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. 7d2f08f06 wrapped resume in synchronous-work timing; preserve the timing wrapper while re-sending the same failed user turn after resume.
            (HOST, "        await this.timedReopen('runtime sign-in renewed resume', () =>\n          this.resumeSession(session.id, watching, null, 'the-sign-in-was-renewed', 'not-read'),\n        )\n", "        await this.timedReopen('runtime sign-in renewed resume', () =>\n          this.resumeSession(session.id, watching, null, 'the-sign-in-was-renewed', 'not-read'),\n        )\n        const failed = this.deps.store\n          .events(session.id)\n          .flatMap((entry) => (entry.event.type === 'user_turn' ? [entry.event.text] : []))\n          .pop()\n        if (failed !== undefined) await this.send(session.id, failed, session.sink)\n"),
        ],
    ),
    (
        "M8 · 🔴 **the window never takes it back** — the host reopened the conversation on the renewed login, but the person's window stays on the stop with a dead composer — killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (D-004)",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The window-takes-it-back
        # check survives, only widened from sign-in-renewal-only to any `reopened` event on an ended
        # record (D-017 · R5 folds an agent-caused reopen into the same path); a renewed sign-in is
        # still one instance of that event, so disabling the whole condition reproduces 'the window
        # never takes it back' for D-004's own scenario.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: when
        # the host reopens a conversation on a renewed login, the window must take it back and go
        # live again. D-017b replaced the `reopened`+`record.phase==='ended'` -> `store.resume` hook
        # with a look: an ended fold gives phase 'recorded', and the store looks again when the
        # reopened life's events reach that recorded record. The plant removes that second look,
        # which is the take-back the updated test now pins (`attached` with `liveFrom`), so the
        # window stays on the stop.
        [
            (STORE, "      record.earlyEvents.push(message)\n      void store.look(message.sessionId, 'again')\n", '      record.earlyEvents.push(message)\n'),
        ],
    ),
    (
        'M9 · 🔴 **the reopen draws no line** — the conversation comes back under a notice that still says it stopped, and nothing says it was reopened or that nothing was re-sent — killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (D-004)',
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. f65480153 added a distinct app-replaced-copy branch; disable the same original renewed-sign-in notice branch without changing the new branch.
            (FOLD, "      } else if (event.because === 'the-sign-in-was-renewed') {\n", "      } else if (false && event.because === 'the-sign-in-was-renewed') {\n"),
        ],
    ),
    (
        'M10 · ⛔ **every reopen says the login was renewed** — a person\'s Reopen and an agent\'s wake draw *"Claude\'s login was renewed elsewhere…"* too, a false cause on every seam — killed by `transcript.test.ts` (673\'s `adds: 0` for `reopened`)',
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. f65480153 added a distinct app-replaced-copy branch; widen the original notice to ordinary reopens, keeping that distinct branch intact.
            (FOLD, "      } else if (event.because === 'the-sign-in-was-renewed') {\n", "      } else if (event.because === 'the-sign-in-was-renewed' || true) {\n"),
        ],
    ),
    (
        "M11 · ⚠️ **the line drawn at `info`, which the reading view hides** — the reopen's one line exists in the fold, but the person in the default view never sees it · killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (the test T-002 added)",
        [
            (FOLD, "        notice(state, 'warn', REOPENED_ON_A_RENEWED_SIGN_IN)\n", "        notice(state, 'info', REOPENED_ON_A_RENEWED_SIGN_IN)\n"),
        ],
    ),
    (
        'M12 · ⚠️ **the stop notice put back as it was before D-004** — it tells the person to find and press the conversation, even though the app reopens a renewed login by itself · killed by `transcript.test.ts` (the test T-002 added) · killed by `a-refused-key-is-said-as-a-key.test.ts`',
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # stale-sign-in stop notice must say that a login renewed elsewhere is carried on by the app
        # itself, with no press needed. Only the words changed: the closed-list wording is gone and
        # the sentence now reads 'this app carries it on with the new login by itself'. The old
        # anchor no longer matches, so the plant deletes that renewed-login sentence from today's
        # STALE_AUTH_NOTICE and leaves 'Otherwise, send it a message to carry on'.
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the stale sign-in notice now says "this computer" instead of "this Mac", so the anchor follows the new word; the plant still drops the sentence that says a renewed login carries on by itself
            (FOLD, "If your machine’s Claude login was renewed elsewhere on this computer, ' +\n  'this app carries it on with the new login by itself, and a line below says so. Otherwise, send", "Otherwise, send"),
        ],
    ),
    (
        'M13 · ⚠️ **any fatal error counts as a revoked sign-in** — a child that crashed for another reason, while the token happened to be renewed, is reopened by itself under *"Claude\'s login was renewed elsewhere"*, a false cause · killed by `a-conversation-reopens-on-a-renewed-sign-in.test.ts` (the test T-002 added)',
        [
            (HOST, "      if (\n        (event.cause === 'auth_stale' && session.itRetriedRejectedLogin !== true) ||\n        canRenewRejected\n      ) {\n", "      if (true) {\n"),
        ],
    ),
]
