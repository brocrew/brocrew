"""3035 · the edges the gap tests pin — a turn read back from the provider's own record, the totals
of other servers' tools, the budget order, the usage readings kept, and the kept sign-in moment.

⛔ **The subject**: what the window shows as "what the model got" is read out of the provider's own
file, by the exact text handed over, from the right conversation, through a guard that takes only
the provider's own record and a private copy of its database; the popup's total says nothing, `null`
or why for other servers' tools on each provider; BroBot's rules are granted before the profile's
memory; a reading whose reset alone moved is kept; and a sign-in moment set aside at launch leaves
the file, while the look at a limit asks a life that can still find a switch.

## ⚑ What a row here measures

 * ⚑ **M1–M8 are the turn reader** (`turn-as-sent.ts`): Codex's count of earlier messages with the
   same text, by each kind; the harness speaking in the person's name and a sub-agent's message,
   never handed over; a text-only array never a person's message; a developer block never the
   message; the base prompt from this thread only; a message read from the record reported whole.
 * ⚑ **M9 is the host** (`runtime-host.ts`): a file that lacks the message sends the read to the
   archive's copy.
 * ⚑ **M10 is the reader's per-kind rule on Codex**: each earlier message is found by its own rule,
   so a turn read from the record does not take a handed-over turn's place.
 * ⚑ **M11–M14 are the record guard and the database copy** (`native-file.ts`): a folder whose name
   only starts like the provider's, a link that leads outside, Codex's rollout name, and the
   private copy removed after a read.
 * ⚑ **M15, M16 are the totals** (`what-this-agent-was-given.ts`): Codex's other servers found by
   search, and Claude before its tool list.
 * ⚑ **M17 is the budget order** (`instructions.ts`): BroBot's rules before the profile's memory.
 * ⚑ **M18 is the usage readings** (`runtime-host.ts`): a frame whose only change is the reset.
 * ⚑ **M19, M20 are the sign-in moment** (`runtime-host.ts`): a moment set aside at launch is
   dropped from the file; the look never asks a life already marked moved.

## ⛔ What this table does not contain

 * ⚠️ The gap tests pin more than twenty rows; these were left for another table, each with its
   anchor checked once in today's code: a Claude record that names no conversation is refused
   (shares an anchor with 3029); the 20,000-character cut on a raw record; the door's
   `.nonnegative()`; `/compact` with spaces around it (shares an anchor with 3033); Claude in full
   with no other server said as "can't count"; the exact 256 KiB edge; the sixteen-window cap on
   readings; the readings file written beside and renamed; the sign-in file's folder made, its
   temporary left, a torn file thrown, Codex's moment not read, a zero moment taken; the look
   asking a life older than the last change, asking during the quit, and the receipt's interval.
 * ⚠️ The Claude shape of an imported turn and a handed-over turn with the same text: on Claude both
   match a string content, so no file can tell them apart, and no row here measures it.
"""

TAS = "apps/desktop/src/main/archive/turn-as-sent.ts"
NATIVE = "apps/desktop/src/main/archive/native-file.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
GIVEN = "apps/desktop/src/main/runtime/what-this-agent-was-given.ts"
INSTR = "apps/desktop/src/main/runtime/instructions.ts"

READER = "the-turn-reader-counts-and-refuses-at-its-edges.test.ts"
TURN_HOST = "the-turn-host-asks-the-archive-counts-each-kind-and-guards-its-door.test.ts"
GUARD = "the-providers-record-guard-follows-links-and-its-database-copy-is-removed.test.ts"
TOTALS = "the-other-servers-total-says-nothing-null-or-why-on-each-provider.test.ts"
BUDGET = "brobots-rules-are-granted-first-at-the-budgets-edges.test.ts"
USAGE = "a-providers-usage-is-kept-at-its-edges.test.ts"
SIGN_IN = "f095s-rest-the-kept-moment-the-look-and-the-receipt.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **Codex: the count of earlier messages ignored** · a text handed over once is found "
        "again when the second message with that text is asked for, so a later turn is answered with "
        f"an earlier turn's record · killed by `{READER}`",
        [(TAS,
          "              if (taken < asked.before.length) taken += 1\n",
          "              if (false) taken += 1\n")],
    ),
    (
        "M2 · 🔴 **Codex: a turn read from the record, its count ignored** · asked for the second "
        f"message read from the record with that text, the first is returned · killed by `{READER}`",
        [(TAS,
          "            if (taken < asked.before.length) {\n",
          "            if (false) {\n")],
    ),
    (
        "M3 · 🔴 the harness speaking in the person's name (`isMeta`) is taken as the message handed "
        f"over · killed by `{READER}`",
        [(TAS,
          "  if (record['isMeta'] === true || record['isCompactSummary'] === true) return false\n",
          "  if (record['isCompactSummary'] === true) return false\n")],
    ),
    (
        "M4 · 🔴 a sub-agent's message with the same text is taken as the message handed over · "
        f"killed by `{READER}`",
        [(TAS,
          "  if (record['isSidechain'] === true) return false\n",
          "  if (false) return false\n")],
    ),
    (
        "M5 · an array of text blocks alone — the harness's, never a person's — is taken as a message "
        f"handed over · killed by `{READER}`",
        [(TAS,
          "  return !kinds.includes('tool_result') && kinds.includes('image') && kinds.includes('text')\n",
          "  return !kinds.includes('tool_result') && kinds.includes('text')\n")],
    ),
    (
        "M6 · 🔴 **Codex: a developer block is the message** · a developer block with the same text as "
        "the message handed over is reported as the message, and the person's own block as the "
        f"provider's · killed by `{READER}`",
        [(TAS,
          "              role === 'user' &&\n",
          "              true &&\n")],
    ),
    (
        "M7 · Codex: another thread's `session_meta` lends this conversation its base prompt · killed "
        f"by `{READER}`",
        [(TAS,
          "        if (said !== '' && (asked.life === null || life === asked.life)) {\n",
          "        if (said !== '') {\n")],
    ),
    (
        "M8 · Codex: a message read from the record is reported as the words its importer split from "
        f"it, not as the record keeps it · killed by `{READER}` and `{TURN_HOST}`",
        [(TAS,
          "            message = messageText(payload['content'])\n",
          "            message = asked.text\n")],
    ),
    (
        "M9 · 🔴 **the file's answer is the last word** · a provider file that does not hold the "
        "message says it was not found, and the archive's copy, which holds it, is never asked · "
        f"killed by `{TURN_HOST}`",
        [(HOST,
          "        if (answer.found) return answer\n",
          "        return answer\n")],
    ),
    (
        "M10 · 🔴 **Codex: every earlier message found by this turn's rule** · a turn read from the "
        "record, counted as handed over, takes the handed-over turn's place, and the handed-over "
        f"turn after it is not found · killed by `{TURN_HOST}`",
        [(TAS,
          "  const next = (): TurnAsked['by'] => asked.before[taken] ?? asked.by\n",
          "  const next = (): TurnAsked['by'] => asked.by\n")],
    ),
    (
        "M11 · 🔴 a folder whose name only starts like the provider's (`projects-old/`, "
        f"`sessions-old/`) passes the record guard · killed by `{GUARD}`",
        [(NATIVE,
          "  const under = (folder: string): boolean => resolved.startsWith(join(real(home), folder) + sep)\n",
          "  const under = (folder: string): boolean => resolved.startsWith(join(real(home), folder))\n")],
    ),
    (
        "M12 · 🔴 **links not followed** · a link named like a record under `projects/` that leads "
        f"outside the home passes the record guard · killed by `{GUARD}`",
        [(NATIVE,
          "      return realpathSync.native(one)\n",
          "      return resolve(one)\n")],
    ),
    (
        "M13 · any `.jsonl` under Codex's folders passes as its rollout, whatever its name · killed by "
        f"`{GUARD}`",
        [(NATIVE,
          "    /^rollout-.*\\.jsonl$/.test(basename(resolved))\n",
          "    resolved.endsWith('.jsonl')\n")],
    ),
    (
        "M14 · the private copy of a provider's database is left in the temporary folder after every "
        f"read · killed by `{GUARD}`",
        [(NATIVE,
          "    if (scratch !== null) rmSync(scratch, { recursive: true, force: true })\n",
          "    void scratch\n")],
    ),
    (
        "M15 · Codex's other servers are taken as Claude's: with a server granted, the total says it "
        "can't count them because Claude has not reported its tool list, where Codex finds them by "
        f"search and none is in every request · killed by `{TOTALS}`",
        [(GIVEN,
          "  if (deferral.kind === 'found-by-search') {\n",
          "  if (false) {\n")],
    ),
    (
        "M16 · Claude before its tool list, with a server granted, counts nothing for other servers' "
        f"tools instead of saying it can't tell · killed by `{TOTALS}`",
        [(GIVEN,
          "    return granted.length === 0\n",
          "    return true\n")],
    ),
    (
        "M17 · 🔴 **the profile's memory granted before BroBot's rules** · with room for one of the "
        "two, the rules are the row and the memory is sent · killed by "
        f"`{BUDGET}`",
        [(INSTR,
          "    ...candidates.filter((item) => item.kind === 'profile-instructions'),\n"
          "    ...candidates.filter((item) => item.kind === 'profile-memory'),\n",
          "    ...candidates.filter((item) => item.kind === 'profile-memory'),\n"
          "    ...candidates.filter((item) => item.kind === 'profile-instructions'),\n")],
    ),
    (
        "M18 · a frame whose only change is the reset is taken as saying the same again: nothing is "
        f"written, and a restart reads the old reset · killed by `{USAGE}`",
        [(HOST,
          # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. e2ef389e1 added account comparison; retain it while suppressing changes only to reset time.
          "        found?.usedPercent !== usedPercent ||\n        found.resetsAt !== resetsAt ||\n        found.account !== account",
          "        found?.usedPercent !== usedPercent ||\n        found.account !== account")],
    ),
    (
        "M19 · 🔴 a kept sign-in moment ahead of the clock is set aside but left in the file, so every "
        f"launch sets it aside again · killed by `{SIGN_IN}`",
        [(HOST,
          "          deps.signInChanges?.write(this.signInChangedAt)\n",
          "          void deps.signInChanges\n")],
    ),
    (
        "M20 · 🔴 **the look asks a life already marked moved** · it asks that older life at every "
        "look, so a newer life is never asked and a switch made under it is never found · killed by "
        f"`{SIGN_IN}`",
        [(HOST,
          "      if (session.itsSignInMovedOn === true || session.handle.checkSignIn === undefined) continue\n",
          "      if (session.handle.checkSignIn === undefined) continue\n")],
    ),
]
