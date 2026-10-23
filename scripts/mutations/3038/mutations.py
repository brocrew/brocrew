"""3038 · the edges the gap tests pin, second half — what a turn read back from a record keeps, the
budget's last byte, the usage readings and the kept sign-in moments on
disk, the look for a moved sign-in, and what a Codex thread holds of its lead.

⛔ **The subject**: the edges that two earlier tables left out to stay at twenty rows, each with a
gap test written to kill it. A record too large to carry whole is cut; a person's door takes only a
whole place from 0; a file that costs exactly what is left of the budget is sent; the readings keep at most
sixteen windows and are written beside the file and renamed; the kept sign-in moments are written
through a temporary that never stays, read back without throwing, for both providers, and only when
they are real moments; the look for a moved sign-in asks neither a life older than the last change,
nor anyone once the quit has begun, and says its interval in whole minutes rounded up; the pass
over older conversations leaves a running one and stops at the quit; and a reopened Codex thread
is owed the whole lead whenever its record cannot say what it holds.

## ⚑ What a row here measures

 * ⚑ **M1 is the turn reader** (`turn-as-sent.ts`): a record past 20,000 characters is cut.
 * ⚑ **M2 is the door** (`ipc.ts`): a place asked for is a whole number from 0.
 * ⚑ **M3 is the budget** (`instructions.ts`): a file that costs exactly what is left is sent.
 * ⚑ **M4, M5 are the usage readings**: the sixteen-window bound on what the host keeps
   (`runtime-host.ts`), and the file written beside and renamed (`provider-usage-file.ts`).
 * ⚑ **M6–M9 are the file of sign-in moments** (`sign-in-changes.ts`): no temporary left behind, a
   file that is not JSON said and not thrown, Codex's moment read, a zero moment not taken.
 * ⚑ **M10–M12, M20 are the look for a moved sign-in** (`runtime-host.ts`): not a life older than
   the last change, nobody during the quit, the interval said rounded up to whole minutes and in
   the singular for one.
 * ⚑ **M13–M17 are what a Codex thread holds of its lead** (`codex-lead.ts`): a message that opens
   with this conversation's line and is no lead the record knows, a held section this launch no
   longer has, a row that kept no text before its launch's lead, a lead in a launch that kept no
   record of its text, and a failed turn's change that never reached the thread.
 * ⚑ **M18, M19 are the pass over older conversations** (`runtime-host.ts`): a running conversation
   keeps its own report, and the quit stops the pass.

## ⛔ What this table does not contain

 * ⚠️ A Claude record that names no conversation, `/compact` with spaces around it, and Claude in
   full with another server's tool said as "can't count": each shares its anchor with a row of an
   earlier table.
 * ⚠️ The sign-in file's folder made on a write, and a file not there said by nothing: left for
   another table.
 * ⚠️ The pass's adopted and Codex guards, the reported-effort `''` guard, the wait composition, the
   context reading's cache, and the host's reset of the first turn's lead after a failure.
"""

TAS = "apps/desktop/src/main/archive/turn-as-sent.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
INSTR = "apps/desktop/src/main/runtime/instructions.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
USAGE_FILE = "apps/desktop/src/main/provider-usage-file.ts"
SIGN_FILE = "apps/desktop/src/main/sign-in-changes.ts"
LEAD = "apps/desktop/src/main/runtime/codex-lead.ts"

READER = "the-turn-reader-counts-and-refuses-at-its-edges.test.ts"
TURN_HOST = "the-turn-host-asks-the-archive-counts-each-kind-and-guards-its-door.test.ts"
BUDGET = "brobots-rules-are-granted-first-at-the-budgets-edges.test.ts"
USAGE = "a-providers-usage-is-kept-at-its-edges.test.ts"
SIGN_IN = "f095s-rest-the-kept-moment-the-look-and-the-receipt.test.ts"
THREAD = "what-a-codex-thread-holds-read-from-its-record.test.ts"
THE_PASS = "the-pass-over-older-conversations-skips-and-keeps-what-it-must.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a record this build cannot read is carried whole however large, not cut at 20,000 "
        f"characters · killed by `{READER}`",
        [
            ("apps/desktop/src/main/archive/turn-reading.ts", "  return written.length <= RAW_MAX ? raw : { cutAt: RAW_MAX, start: written.slice(0, RAW_MAX) }\n", "  return raw\n"),
        ],
    ),
    (
        "M2 · the door takes a negative place for the message the model got · killed by "
        f"`{TURN_HOST}`",
        [(IPC,
          "    ordinal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),\n",
          "    ordinal: z.number().int().max(Number.MAX_SAFE_INTEGER),\n")],
    ),
    (
        "M3 · a file whose cost is exactly what is left of the budget is refused, not sent · "
        f"killed by `{BUDGET}`",
        [
            ("apps/desktop/src/main/providers/instruction-composition.ts", "    if (cost > budget) continue\n", "    if (cost >= budget) continue\n"),
        ],
    ),
    (
        "M4 · the host keeps readings for any number of windows, not at most sixteen · killed by "
        f"`{USAGE}`",
        [(HOST,
          # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. e2ef389e1 renamed the existing prior reading to found before account compatibility is checked; omit only the sixteen-window cap.
          "      if (found === undefined && held.size >= MAX_USAGE_WINDOWS) continue\n",
          "")],
    ),
    (
        "M5 · the readings are written straight into their file, not beside it and renamed, so a "
        f"write that fails tears the file it would have replaced · killed by `{USAGE}`",
        [(USAGE_FILE,
          r"    writeFileSync(temporary, `${JSON.stringify(usage, null, 2)}\n`)" "\n",
          r"    writeFileSync(file, `${JSON.stringify(usage, null, 2)}\n`)" "\n")],
    ),
    (
        "M6 · a sign-in moment write whose rename fails leaves its temporary file in the data "
        f"folder · killed by `{SIGN_IN}`",
        [(SIGN_FILE,
          "    rmSync(temporary, { force: true })\n",
          "    void temporary\n")],
    ),
    (
        "M7 · a sign-in moments file that is not JSON is thrown at the reader instead of read as "
        f"no change seen and said · killed by `{SIGN_IN}`",
        [(SIGN_FILE,
          "      console.warn(`the sign-in changes in ${file} could not be read: ${String(error)}`)\n",
          "      throw error\n")],
    ),
    (
        "M8 · Codex's sign-in moment is not read back from the file, only Claude's · killed by "
        f"`{SIGN_IN}`",
        # Keeping only the first registry entry preserves the original omitted-second-provider fault.
        [(SIGN_FILE,
          "  for (const provider of SUPPORTED_PROVIDERS) {\n",
          "  for (const provider of SUPPORTED_PROVIDERS.slice(0, 1)) {\n")],
    ),
    (
        "M9 · a moment of zero is taken as a real sign-in change · killed by "
        f"`{SIGN_IN}`",
        [(SIGN_FILE,
          "    if (typeof at === 'number' && Number.isFinite(at) && at > 0) changed.set(provider, at)\n",
          "    if (typeof at === 'number' && Number.isFinite(at) && at >= 0) changed.set(provider, at)\n")],
    ),
    (
        "M10 · the look asks the oldest running life even when it began before the last change "
        "noted, so it can only report that change again and the newer life is never asked · "
        f"killed by `{SIGN_IN}`",
        [(HOST,
          "      if (noted !== undefined && session.lifeSince < noted) continue\n",
          "")],
    ),
    (
        "M11 · a look for a moved sign-in asks a conversation once the quit has begun · killed by "
        f"`{SIGN_IN}`",
        [(HOST,
          "    if (this.launches.closed) return\n"
          "    const noted = this.signInChangedAt.get(provider)\n"
          "    let oldest: HostedSession | null = null\n",
          "    const noted = this.signInChangedAt.get(provider)\n"
          "    let oldest: HostedSession | null = null\n")],
    ),
    (
        "M12 · the receipt says the look's interval rounded down, so a look of 130 seconds is "
        f"said as 2 minutes · killed by `{SIGN_IN}`",
        [(HOST,
          "    const minutes = Math.max(1, Math.ceil(this.lookAtTheLimitAgainMs / 60_000))\n",
          "    const minutes = Math.max(1, Math.floor(this.lookAtTheLimitAgainMs / 60_000))\n")],
    ),
    (
        "M13 · a message that opens with this conversation's line but is no lead the record knows "
        f"leaves what the thread holds as it was, not unknown · killed by `{THREAD}`",
        [(LEAD,
          "      if (row.sent !== null || (!row.handedOver && !leadSinceLaunch)) sections = null\n",
          "      if (!row.handedOver && !leadSinceLaunch) sections = null\n")],
    ),
    (
        "M14 · a section the thread holds that its new launch no longer has is left standing: "
        f"only what changed is sent, never the whole · killed by `{THREAD}`",
        [(LEAD,
          "  if ([...held.sections.keys()].some((heading) => !now.has(heading))) {\n",
          "  if (false) {\n")],
    ),
    (
        "M15 · a row that kept no text, before any lead of its launch, is taken as having left "
        f"the thread's lead alone · killed by `{THREAD}`",
        [(LEAD,
          "      if (row.sent !== null || (!row.handedOver && !leadSinceLaunch)) sections = null\n",
          "      if (row.sent !== null) sections = null\n")],
    ),
    (
        "M16 · a lead recorded in a launch that kept no record of its text is taken as leaving "
        f"the thread's sections as they were · killed by `{THREAD}`",
        [(LEAD,
          "    if (launch === null) sections = null\n",
          "    if (launch === null) continue\n")],
    ),
    (
        "M17 · a change this app failed to send is still counted among the sections the thread "
        f"holds, so the reopen never sends it again · killed by `{THREAD}`",
        [(LEAD,
          "        sections = pending.sections\n",
          "")],
    ),
    (
        "M18 · the pass over older conversations reads a conversation running now and writes a "
        f"model over its own report · killed by `{THE_PASS}`",
        [(HOST,
          "      if (row === null || this.slots.has(one.sessionId)) continue\n",
          "      if (row === null) continue\n")],
    ),
    (
        "M19 · the pass over older conversations goes on recording after the quit has begun · "
        f"killed by `{THE_PASS}`",
        [
            ("apps/desktop/src/main/runtime/runtime-host.ts", "      if (this.launches.closed) break\n      const readEarlierModel = providerDefinitions[one.provider].transcripts.readEarlierModel", "      const readEarlierModel = providerDefinitions[one.provider].transcripts.readEarlierModel"),
        ],
    ),
    (
        "M20 · the receipt says the look's interval in the plural for one minute — \"within 1 "
        f"minutes\" · killed by `{SIGN_IN}`",
        [(HOST,
          "    const look = `within ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`\n",
          "    const look = `within ${String(minutes)} minutes`\n")],
    ),
]
