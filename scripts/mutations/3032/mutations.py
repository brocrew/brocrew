"""3032 · F095's rest — a sign-in change survives a restart, the look finds a switch while
everything waits, and every receipt at a limit says what ends it — 27bf5340, 46bcad38, 3d525d33,
557dee86 (Gabi, W4.172; merged by W4.185).

⛔ **The subject**: the moment this app saw each provider's sign-in change is kept in
`<userData>/sign-in-changes.json`, written whole through a temporary file and read back at launch
(a moment still ahead of the clock is set aside); at each look at a limit the oldest conversation
that started on or after the last noted change is asked whether the Mac's sign-in moved
(`noticeAMovedSignIn`); a limit's receipt says the reset is the latest it waits, never the only way
out (`whatItsLimitHolds`), and after a reopen it never says *"goes in as it starts"*; a reopened life
that reads as moved within ten minutes is the launch read differently, decided as it is found and
never noted as a change, and the latch holds for that window only (`didNotHelp`); and at a limit,
`flushQueued` arms the reset before asking whether the conversation is free, and reopens a moved
sign-in all the same.

## ⚑ What a row here measures

 * ⚑ **M1–M3 are the file** (`sign-in-changes.ts`): the name the reset's manifest knows (M1), the
   rename that lands a write (M2), and the host's write at a noted change (M3).
 * ⚑ **M4, M5 are the launch's read** (`RuntimeHost` constructor): a kept moment is taken (M4), and
   one still ahead of the clock is set aside (M5).
 * ⚑ **M6, M7 are the look** (`noticeAMovedSignIn`): the reset timer asks it (M6), and it asks the
   OLDEST eligible conversation, not the newest (M7).
 * ⚑ **M8–M11 are the receipts** (`whatItsLimitHolds`, `whyItWaitsForItsLimit`,
   `whyItWaitsForItsSignIn`): Codex is promised only a completed turn (M8), the "goes sooner" ways
   out are said at all (M9), a card counts as a turn it also waits for (M10), and after a reopen at a
   limit the receipt never says the words go in as it starts (M11).
 * ⚑ **M12, M13 are the loop guard** (`assertSignInCurrent`, `itsReopenDidNotHelp`): the launch read
   differently is never noted as a change (M12), and the latch lapses after its window (M13).
 * ⚑ **M14, M15 are `flushQueued` at a limit**: a moved sign-in is reopened all the same (M14), and
   the reset and its looks are armed while what waits is held behind a turn or a card (M15).

Every killer is `a-usage-limit-is-named-and-waited-out.test.ts` §4 · the hold, whose host keeps its
sign-in changes in a `mkdtemp` userData (`brobot2-f074-…`), runs a provider double, and points every
provider home under that folder: no real `~/.claude`, `~/.codex` or app userData is read or written.

## ⛔ What this table does not contain

 * ⚠️ **The reader's validation and Codex's moment** (`at > 0`, `Number.isFinite`, the `PROVIDERS`
   list), **a corrupt file read as none**, **the folder never made by the write**, **the temporary
   removed on a failed write**, and **the constructor's rewrite of a set-aside moment**: no test
   reaches them — see `gaps-3032.md`.
 * ⚠️ **`noticeAMovedSignIn`'s two skips** (a life older than the noted change, a life already marked
   moved) and its own `reopenForWhatWaits(oldest)`: a delay of one look, a scenario no test builds,
   and a reopen the flush path makes anyway — see `gaps-3032.md`.
 * ⚠️ **`reopened.didNotHelp = true` removed**: killable by the loop-guard case, but the mutant
   reopens the conversation in a loop until the case's 4 s wait fails — the very loop the guard
   exists for. M12 and M13 measure the latch without it.
 * ⚠️ **Left out for count, killable**: the reader looking at the file's top level rather than
   `changed` (same assertion as M1/M2), and `whatItsLimitHolds`' `afterAReopen` branch ignored
   (same case as M11).
 * ⚠️ **The send door's `noteASignInChange`** and **one switch is one change**: table 3025 M8, M9.
 * ⚠️ **Wording-only changes** in `agent-tools.ts` (`whereTheReplyWent`, answer_question's
   `hasIt`/`toldWhen`), `question-rails.ts` and `anAnswerKeptForItsStart`: sentences, pinned word for
   word by their own tests; not decisions.
 * ⚠️ **`scripts/lib/clean-base.mjs`'s manifest entry and `SIGN_IN_CHANGES_PART`**: the reset
   script, not the subject named for this table.
"""

FILE = "apps/desktop/src/main/sign-in-changes.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

USAGE = "a-usage-limit-is-named-and-waited-out.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ---- A · the file (sign-in-changes.ts, noteASignInChange) ------------------------------------
    # USAGE · §4 › '🔴 W4.172 · a sign-in change is kept across a restart: …' — `readSignInChanges(
    # join(userData, SIGN_IN_CHANGES_FILE)).get('claude')` is undefined; and › '⛔ W4.172 · the
    # control: …' — `rmSync(join(userData, SIGN_IN_CHANGES_FILE))` throws ENOENT.
    (
        "M1 · 🔴 the moments are kept under a name the reset's manifest does not know — a reset leaves "
        f"them behind, and they end a fresh base's limits · killed by `{USAGE}`",
        [(FILE,
          "  const file = join(userData, 'sign-in-changes.json')\n",
          "  const file = join(userData, 'sign-in-changes')\n")],
    ),
    # USAGE · §4 › '🔴 W4.172 · a sign-in change is kept across a restart: …' — the file is never
    # there (`kept.get('claude')` undefined, and the next run's limits row is back).
    (
        "M2 · 🔴 a write never lands: the temporary is not renamed over the file, so a restart reads "
        f"no change and the old account's limit holds again · killed by `{USAGE}`",
        [(FILE,
          "    renameSync(temporary, file)\n",
          "    void renameSync\n")],
    ),
    # USAGE · §4 › '🔴 W4.172 · a sign-in change is kept across a restart: …' — `kept.get('claude')`
    # undefined; › '⛔ W4.172 · the control: …' — `rmSync` of the absent file throws.
    (
        "M3 · 🔴 **the noted change is this run's memory only** · a send that notes it writes nothing, "
        f"and after a restart the old sign-in's limit holds until its reset · killed by `{USAGE}`",
        [(HOST,
          "      this.deps.signInChanges?.write(this.signInChangedAt)\n",
          "      void this.deps.signInChanges\n")],
    ),

    # ---- B · the launch's read (RuntimeHost constructor) -----------------------------------------
    # USAGE · §4 › '🔴 W4.172 · a sign-in change is kept across a restart: …' — after `aHost()`,
    # `host.limitsForAPerson().rows` holds the old wall, not `[]`.
    (
        "M4 · 🔴 the kept moment is read at launch but never taken — the old sign-in's limit is shown "
        f"and holds what waits after a restart · killed by `{USAGE}`",
        [(HOST,
          "        this.signInChangedAt.set(provider, at)\n",
          "        void at\n")],
    ),
    # USAGE · §4 › '⛔ W4.172 · a kept moment still ahead of the clock is set aside: it would hide
    # every limit until then' — `limitsForAPerson().rows` is `[]`, not one.
    (
        "M5 · 🔴 a kept moment a day ahead of the clock is taken: every limit reached until then, the "
        f"new sign-in's own among them, is hidden and holds nothing · killed by `{USAGE}`",
        [(HOST,
          "        if (at > now) {\n",
          "        if (false) {\n")],
    ),

    # ---- C · the look (noticeAMovedSignIn) -------------------------------------------------------
    # USAGE · §4 › '🔴 W4.172 · a switch made while everything waits for a limit is noticed at the
    # next look, though nothing new is sent' — times out waiting for the held words; also › '…the
    # look asks the oldest conversation…' and › '…held behind a turn at a limit…' (rows never 0).
    (
        "M6 · 🔴 **the look never asks** · a switch made while everything waits for a limit is not "
        f"found until something new is sent, or the reset · killed by `{USAGE}`",
        [(HOST,
          "        void this.noticeAMovedSignIn(provider)\n",
          "        void provider\n")],
    ),
    # USAGE · §4 › '🔴 W4.172 · the look asks the oldest conversation, whatever it holds: a switch is
    # found though only a conversation begun after it holds words' — the look asks only `fresh`
    # (current), so the held words never go.
    (
        "M7 · the look asks the NEWEST conversation — one begun on the new sign-in, which reads as "
        f"current — and a switch under an older one is never found · killed by `{USAGE}`",
        [(HOST,
          "      if (oldest === null || session.lifeSince < oldest.lifeSince) oldest = session\n",
          "      if (oldest === null || session.lifeSince > oldest.lifeSince) oldest = session\n")],
    ),

    # ---- D · the receipts (whatItsLimitHolds and its callers) ------------------------------------
    # USAGE · §4 › '⚑ W4.172 · …and Codex’s says only what Codex has: a completed turn' — the
    # anchored regex meets Claude's sign-in clause in Codex's receipt.
    (
        "M8 · Codex's receipt promises a sign-in look and a cleared-limit notice Codex never gives — "
        f"words an agent waits on that cannot happen · killed by `{USAGE}`",
        [(HOST,
          # ⚑ **provider selection refactor · re-anchored in place, not retired** — The limit receipt now uses an exhaustive selector; selecting the longer sign-in notice for every provider makes the same false promise.
          "    const sooner = providerValue(provider, { claude: true, codex: false })\n",
          "    const sooner = true\n")],
    ),
    # USAGE · §4 › '🔴 W4.172 · the receipt says what really ends the wait: the reset at the latest,
    # sooner when Claude takes work again' — `toContain('It goes sooner if Claude …')` fails; also
    # › '…Codex’s says only what Codex has…'.
    (
        "M9 · 🔴 **the reset read as the only way out** · the receipt names the reset and nothing "
        f"sooner, though the words go at a cleared limit, a completed turn or a switch · killed by `{USAGE}`",
        [(HOST,
          "    return `${name}’s usage limit is reached, so it waits until the limit resets, at ${at}. ${sooner}`\n",
          "    return `${name}’s usage limit is reached, so it waits until the limit resets, at ${at}.`\n")],
    ),
    # USAGE · §4 › '🔴 W4.172 · held behind a turn at a limit, the receipt says it waits for both — and
    # the reset is armed though the conversation is busy' — the anchored regex wants 'It also waits
    # for the turn this conversation is running to end.' on a conversation parked on its card.
    (
        "M10 · a conversation parked on a permission card is not a turn: the receipt says the limit "
        f"alone, though the words also wait for that card · killed by `{USAGE}` · killed by `a-helper-stopped-on-a-persons-approval.test.ts`",
        [(HOST,
          "      status === 'working' || status === 'waiting_permission' || session.holdingQueue > 0\n",
          "      status === 'working' || session.holdingQueue > 0\n")],
    ),
    # USAGE · §4 › '🔴 W4.172 · reopened on a new sign-in that is at a limit too, the receipt says the
    # reopen alone does not send it' and › '🔴 W4.172 · a reopen that waits for something, at a
    # limit: …' — the anchored regexes want '…current one. After the reopen…'.
    (
        "M11 · 🔴 **W1's misread, back** · reopened on a new sign-in at a limit, the receipt says what "
        f"is held goes in as it starts — and then that it waits for the limit · killed by `{USAGE}`",
        [(HOST,
          "      const first = limit === null ? `${when}${then ?? ''}.` : `${when}.`\n",
          "      const first = `${when}${then ?? ''}.`\n")],
    ),

    # ---- E · the loop guard (didNotHelp) ---------------------------------------------------------
    # USAGE · §4 › '⛔ W4.172 · a life this app reopened that reads as moved again at once is a launch
    # read differently: no change is noted, and the limit still holds' — `limitsForAPerson().rows` is
    # `[]`, not one. ⚑ The latch is still set, so the mutant does not loop.
    (
        "M12 · 🔴 **the launch read differently is noted as a change** · a reopened life that reads as "
        f"moved at once ends every limit, so held words are sent into one · killed by `{USAGE}`",
        [(HOST,
          "        reopened.didNotHelp = true\n",
          "        reopened.didNotHelp = true\n"
          "        this.noteASignInChange(provider, session.lifeSince)\n")],
    ),
    # USAGE · §4 › '⛔ W4.172 · a life this app reopened that reads as moved again at once …' — past
    # the window (`ahead.ms = 11 min`) it times out waiting for 'a second reopen past the window'.
    (
        "M13 · 🔴 **latched for good** (557dee86's fix undone) · a conversation the loop guard held is "
        f"never reopened by this app again, and its receipt's '10 minutes' goes stale · killed by `{USAGE}`",
        [(HOST,
          "    return reopened?.didNotHelp === true && this.now() - reopened.at < REOPEN_LOOP_GUARD_MS\n",
          "    return reopened?.didNotHelp === true\n")],
    ),

    # ---- F · flushQueued at a limit --------------------------------------------------------------
    # USAGE · §4 › '🔴 W4.172 · a reopen that waits for something, at a limit: the receipt says when it
    # reopens and that the limit holds after it, and it does' — times out waiting for 'the reopen once
    # the card was answered'; also the loop-guard case's 'a second reopen past the window'.
    (
        "M14 · 🔴 a moved sign-in at a limit is never reopened when its card is answered — the receipt "
        f"said it would be, and what is held waits for a person · killed by `{USAGE}`",
        [(HOST,
          "      // as the receipt says ({@link whyItWaitsForItsSignIn}).\n"
          "      this.reopenForWhatWaits(session)\n",
          "      // as the receipt says ({@link whyItWaitsForItsSignIn}).\n")],
    ),
    # USAGE · §4 › '🔴 W4.172 · held behind a turn at a limit, the receipt says it waits for both — and
    # the reset is armed though the conversation is busy' — no reset, so no look: times out waiting
    # for 'the look to find the switch'.
    (
        "M15 · 🔴 words held behind a turn or a card at a limit arm no reset and no look — a switch "
        f"under the busy conversation is never found, though the receipt promises it · killed by `{USAGE}`",
        [(HOST,
          "    const atItsLimit = this.itWaitsForItsLimit(session, false)\n"
          "    // The host is deliberately putting a turn on this session right now, so the queue waits its\n"
          "    // place in the order the user asked for. See {@link sendInterrupting}.\n"
          "    if (session.holdingQueue) return\n"
          "    if (session.handle.status() !== 'idle') return\n",
          "    // The host is deliberately putting a turn on this session right now, so the queue waits its\n"
          "    // place in the order the user asked for. See {@link sendInterrupting}.\n"
          "    if (session.holdingQueue) return\n"
          "    if (session.handle.status() !== 'idle') return\n"
          "    const atItsLimit = this.itWaitsForItsLimit(session, false)\n")],
    ),
]
