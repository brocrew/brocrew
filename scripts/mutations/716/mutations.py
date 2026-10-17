"""716 · what a person must fix, said once — PM rulings R62, R66, R67 and `710` F-4, F-5, F-7, and
`reanchor.py` landed.

## 🔴 A · R66/R67 at `spawn_agent` (M1-M5) · B · the wake (M6-M9) · C · the readers (M10-M12)

⚑ **R66**: *"A host step a person must fix … and Claude's 'Native CLI binary … not found', thrown before
any spawn, get R51's permanent word, not a broken tool. The sentence says which it is, a program or a
folder, in words."* ⚑ **R67**: *"Codex's missing binary … answers with R51's `agent-could-not-be-started`."*

## 🔴 D · Claude's adapter (M13-M15) · E · a person's two doors (M16-M18)

## 🔴 F · `710` F-7 — the refusal's word, answered when asked (M19-M24)

## 🔴 G · `710` F-5 — what a person can do instead of *try again* (M25-M31)

## 🔴 H · R62 — `closing` beside `running` (M32-M34) · I · `710` F-4 — the re-copy (M35-M37)

## ⛔ J · `reanchor.py` (M38-M42) · K · the second review (M43-M54)

## ⚑ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M9`, `M12`, `M16`-`M24`, `M43`-`M45`, `M47`, `M48`, `M51` | ⚑ **`run_suite`** — `what-a-person-must-fix-said-once.test.ts` |
| `M10`, `M11`, `M13`-`M15`, `M46`, `M49`, `M50` | ⚑ **`run_suite`** — `packages/runtime/test/claude-binary.test.ts` |
| `M25`, `M27`-`M31` | ⚑ **`run_suite`** — `what-a-person-can-do-instead-of-try-again.test.ts` |
| `M26` | ⚑ **`run_suite`** — `reopen-while-closing.test.ts` |
| `M32`-`M34` | ⚑ **`run_suite`** — `a-conversation-still-closing-keeps-resume.test.ts` |
| `M35`-`M37` | ⚑ **`run_suite`** — `a-person-whose-machine-ran-short.test.ts` |
| `M38`-`M42`, `M52`-`M54`, `M57` | ⚑ **`run_suite`** — `scripts/test/reanchor.test.mjs` |
| `M55` | ⚑ **`run_suite`** — `packages/runtime/test/claude-binary.test.ts` |
| `M56` | ⚑ **`run_suite`** — `import-from-home.test.ts` |
| `M58`, `M59` | ⚑ **`run_suite`** — `what-a-person-must-fix-said-once.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `reanchor.py`'s read-back** (a table that does not read back as planned is written back):
no planted table makes the splice produce a different table, so a row there would survive unmeasured.
⛔ **No row on the Claude candidates' Linux, Android and Windows arms**: the app runs on macOS, and
`claude-binary.test.ts` §2 pins their spelling; M50 is the darwin arm, the one a real machine reads.

## ⚑ K · the second review (M43-M54)

⚑ Rows for the arms `716`'s review found untested or wrong: the `cancelled` and `launch` words (M43, M44),
the folder reader's stop at a `ResumeError` and at a read (M45, M46), the three clause doors (M47), the
holding folder (M48), the reinstall offered only where it helps (M49), the darwin candidate (M50), the
answered refusal's log line (M51), and `reanchor.py`'s note placement, dry apply and all-or-nothing
(M52-M54). ⚑ **And four for round two**: an `open` is a write only where its caller says so (M55,
M56), splices and notes applied in one pass from the bottom (M57), and a call on an entry that exists
is refused by that entry (M58), and the three clause doors say the fix too (M59).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
UNAVAILABLE = "apps/desktop/src/main/runtime/session-unavailable.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
REFUSAL = "apps/desktop/src/main/runtime/launch-refusal.ts"
RUNTIME = "packages/runtime/src/runtime.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
BINARY = "packages/runtime/src/claude/claude-binary.ts"
AUTH = "packages/runtime/src/internal/auth.ts"
REANCHOR = "scripts/mutations/reanchor.py"

SAID_ONCE = "what-a-person-must-fix-said-once.test.ts"
IMPORT = "import-from-home.test.ts"
BINARY_TEST = "claude-binary.test.ts"
TRY_AGAIN = "what-a-person-can-do-instead-of-try-again.test.ts"
REOPEN_WHILE_CLOSING = "reopen-while-closing.test.ts"
R62 = "a-conversation-still-closing-keeps-resume.test.ts"
RAN_SHORT = "a-person-whose-machine-ran-short.test.ts"
REANCHOR_TEST = "reanchor.test.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        f"M1 · 🔴 R67 undone · Codex's missing program is not asked, and is a broken tool — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "  if (error instanceof CodexUnavailableError || error instanceof ClaudeUnavailableError) {\n", "  if (error instanceof ClaudeUnavailableError) {\n"),
        ],
    ),
    (
        f"M2 · 🔴 Claude's missing program is a broken tool again · the typed error is not asked — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "  if (error instanceof CodexUnavailableError || error instanceof ClaudeUnavailableError) {\n", "  if (error instanceof CodexUnavailableError) {\n"),
        ],
    ),
    (
        f"M3 · 🔴 a folder the disk refused is a broken tool again · R66's arm gone — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "  if (folder !== null) {\n    return { rail: 'agent-could-not-be-started', because: folder.code, what: 'folder' }\n  }\n", ""),
        ],
    ),
    (
        f"M4 · ⚠️ a folder is told it is a program · the sentence that says which is lost — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "because: folder.code, what: 'folder' }", "because: folder.code, what: 'program' }"),
        ],
    ),
    (
        f"M5 · ⚠️ `spawn_agent` never says the folder's sentence · the word's own names a program — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "  return failed.what === 'folder' ? { ...refused, reason: A_FOLDER_COULD_NOT_BE_MADE } : refused\n", "  return refused\n"),
        ],
    ),
    (
        f"M6 · 🔴 a wake answers the SPAWN's word · a program or a folder at a wake leaves the wake's own vocabulary — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "  if (launch?.rail === 'agent-could-not-be-started') {\n", "  if (launch?.rail === 'no such word') {\n"),
        ],
    ),
    (
        f"M7 · ⚠️ a wake's missing program is not said as one — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "  if (unwoken.what === 'program') return { ...refused, reason: A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN }\n", ""),
        ],
    ),
    (
        f"M8 · ⚠️ a wake's folder is not said as one — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "  if (unwoken.what === 'folder')\n    return { ...refused, reason: A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE }\n", ""),
        ],
    ),
    (
        f"M9 · ⚠️ the wake forgets WHICH · `what` is dropped on the way to the wake's word — killed by `{SAID_ONCE}`",
        [
            (TOOLS, "      ...(launch.what === undefined ? {} : { what: launch.what }),\n", ""),
        ],
    ),
    (
        f"M10 · ⚠️ a spawn's code is read as a folder · the program's R51 word loses its own case — killed by `{BINARY_TEST}`",
        [
            (RUNTIME, "      return !aSpawnsCode && !aRead && aPersonMustFixIt\n", "      return !aRead && aPersonMustFixIt\n"),
        ],
    ),
    (
        f"M11 · ⚠️ the provisioning lock's `EEXIST` is a folder a person must fix · a wait clears that one — killed by `{BINARY_TEST}`",
        [
            (RUNTIME, "        (code === 'EEXIST' && syscall === 'mkdir')\n", "        code === 'EEXIST'\n"),
        ],
    ),
    (
        f"M12 · 🔴 a read-only volume is not a folder a person must fix — killed by `{SAID_ONCE}`",
        [
            (RUNTIME, "  'EROFS',\n  'ENOSPC',\n", "  'ENOSPC',\n"),
        ],
    ),
    (
        f"M13 · 🔴 Claude's missing program is the SDK's plain error again · never asked where the SDK looks — killed by `{BINARY_TEST}`",
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · a launch given the installed program now asks a different question of a throw; with no program given, the plant still rethrows the SDK's plain error instead of asking where the SDK looks
            (CLAUDE, "        ? aProgramTheSdkCouldNotFind(error)\n", "        ? error\n"),
        ],
    ),
    (
        f"M14 · ⚠️ a resume wraps the missing program in a `ResumeError` · the wake could not name it — killed by `{BINARY_TEST}`",
        [
            (CLAUDE, "        error instanceof AuthUnavailableError ||\n        error instanceof ClaudeUnavailableError\n", "        error instanceof AuthUnavailableError\n"),
        ],
    ),
    (
        f"M15 · ⛔ every SDK refusal is called a missing program · the question asked of the text's absence — killed by `{BINARY_TEST}`",
        [
            (BINARY, "  if (whereTheSdkLooks() !== null) return thrown\n", ""),
        ],
    ),
    (
        f"M16 · 🔴 a person reads Node's errno for a folder again · the host's translation skipped — killed by `{SAID_ONCE}`",
        [
            (HOST, "    const said = this.aFolderAsARefusal(\n      this.aShortageAsARefusal(error, id, reopening),\n      id,\n      reopening,\n    )\n", "    const said = this.aShortageAsARefusal(error, id, reopening)\n"),
        ],
    ),
    (
        f"M17 · ⚠️ the folder's sentence loses WHERE · a person cannot find the folder to fix — killed by `{SAID_ONCE}`",
        [
            (UNAVAILABLE, "  const path = folder?.path ?? null\n", "  const path = null\n"),
        ],
    ),
    (
        f"M18 · ⚠️ a folder BroBot2 may not write is told nothing it can do — killed by `{SAID_ONCE}`",
        [
            (UNAVAILABLE, "  if (code === 'EACCES' || code === 'EPERM') {\n", "  if (code === 'EPERM') {\n"),
        ],
    ),
    (
        f"M19 · 🔴 every refusal is ANSWERED · a caller that did not ask gets a value where it reads a rejection — killed by `{SAID_ONCE}`",
        [
            (IPC, "        const reason = command.answerARefusal === true ? whyALaunchWasRefused(error) : null\n", "        const reason = whyALaunchWasRefused(error)\n"),
        ],
    ),
    (
        f"M20 · 🔴 no refusal is ever answered · the launcher that asks still gets only a message — killed by `{SAID_ONCE}`",
        [
            (IPC, "        const reason = command.answerARefusal === true ? whyALaunchWasRefused(error) : null\n", "        const reason = null\n"),
        ],
    ),
    (
        f"M21 · ⚠️ a sign-in refusal has no word · the launcher cannot tell the refusal it must NOT skip its check for — killed by `{SAID_ONCE}`",
        [
            (REFUSAL, "  if (error instanceof AuthUnavailableError) return 'sign-in'\n", ""),
        ],
    ),
    (
        f"M22 · ⚠️ a folder is answered `launch` — killed by `{SAID_ONCE}`",
        [
            (REFUSAL, "  if (reason === 'its-folder-could-not-be-made') return 'folder'\n", ""),
        ],
    ),
    (
        f"M23 · ⚠️ a machine that ran short is answered `launch` — killed by `{SAID_ONCE}`",
        [
            (REFUSAL, "  if (reason === 'machine-ran-short') return 'machine'\n", ""),
        ],
    ),
    (
        f"M24 · ⚠️ a spawn's code no wait clears has no word — killed by `{SAID_ONCE}`",
        [
            (REFUSAL, "  if (spawnNoWaitClearsOf(error) !== null) return 'program'\n", ""),
        ],
    ),
    (
        f"M25 · 🔴 a REOPEN whose agent did not answer is told to start it again · a new conversation, for one that exists — killed by `{TRY_AGAIN}`",
        [
            (HOST, "    return reopening ? saidOfAReopen(said) : said\n", "    return said\n"),
        ],
    ),
    (
        f"M26 · ⚠️ a Reopen past the close's wait is told nothing about the wait — killed by `{REOPEN_WHILE_CLOSING}`",
        [
            (HOST, "      throw this.refusalTranslated(reopening ? saidOfAReopen(error) : error)\n", "      throw this.refusalTranslated(error)\n"),
        ],
    ),
    (
        f"M27 · ⚠️ `took-too-long` forgets which gesture it was — killed by `{TRY_AGAIN}`",
        [
            (UNAVAILABLE, "      return context.reopening === true\n        ? `${stopped} The conversation is kept: ${reopenIt}. ${keeps}`\n", "      return false\n        ? `${stopped} The conversation is kept: ${reopenIt}. ${keeps}`\n"),
        ],
    ),
    (
        f"M28 · ⚠️ `still-closing` forgets that a reopen already waited — killed by `{TRY_AGAIN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — A message that waited on
        # a closing conversation must be told it waited and how to wait longer; the
        # `context.reopening === true` branch of `still-closing` still exists and the test asserts
        # its exact sentence. The old prefix occurs twice in the file, so the `old` string includes
        # the first words of the sentence to be unique; the plant forces the other branch.
        [
            (UNAVAILABLE, "      return context.reopening === true\n        ? `BroCrew was still putting away this conversation's last session", "      return false\n        ? `BroCrew was still putting away this conversation's last session"),
        ],
    ),
    (
        f"M29 · ⚠️ a start in flight does not say it ends by itself · a person left pressing at a state that ends without them — killed by `{TRY_AGAIN}`",
        [
            (UNAVAILABLE, " It opens by itself when its agent answers; if its agent does not answer in time, BroCrew stops it.`", "`"),
        ],
    ),
    (
        f"M30 · 🔴 the claim door tells a closed reservation it is *still opening* · a promise it will open that nothing keeps — killed by `{TRY_AGAIN}`",
        [
            (HOST, "    if (onItsWayOut(slot)) {\n      return new SessionUnavailable(\n        'still-closing',\n        `session ${sessionId} was not taken over: it is on its way out`,\n      )\n    }\n    const session = slot.session\n", "    const session = slot.session\n"),
        ],
    ),
    (
        f"M31 · ⚠️ `run-by-another-host` gives no way back in — killed by `{TRY_AGAIN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The run-by-another-host
        # sentence must say where the way back in is; the sentence survives D-017b as 'It can
        # continue here once that part has let it go.' and the test pins it exactly. The plant cuts
        # that closing clause.
        [
            (UNAVAILABLE, " so it was not opened here. It can continue here once that part has let it go.'", " so it was not opened here.'"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `closing` wire field was removed
        # from ResumableSessionInfo and UnresumableSessionInfo in D-017b, together with
        # `stillClosing` in runtime-host.ts (no grep hits).
        # A-conversation-still-closing-keeps-resume.test.ts now asserts
        # `not.toHaveProperty('closing')`, so the defect this row planted is the decision. Its
        # anchor is left stale, so the census records it retired.
        f"M32 · 🔴 a closing conversation reads `closing: false` on the reopen half — killed by `{R62}`",
        [
            (HOST, "      closing: this.stillClosing(session.sessionId),\n", "      closing: false,\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Same removal as M32: the `closing`
        # field and `stillClosing` no longer exist in the host or the shared IPC types, and the
        # killer test now pins their absence. There is nothing left to plant on. Its anchor is left
        # stale, so the census records it retired.
        f"M33 · 🔴 …and on the half with no ref — killed by `{R62}`",
        [
            (HOST, "      closing: this.stillClosing(row.sessionId),\n", "      closing: false,\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Same removal as M32: `closing` is gone
        # from the wire (D-017b, 05 rule 5: every sentence that says whether a process runs is
        # deleted). The test asserts the field is absent, so re-adding it would be the defect. Its
        # anchor is left stale, so the census records it retired.
        f"M34 · ⚠️ every conversation this host holds reads `closing` · a running one included — killed by `{R62}`",
        [
            (HOST, "    return slot !== undefined && onItsWayOut(slot)\n", "    return slot !== undefined\n"),
        ],
    ),
    (
        f"M35 · 🔴 a re-copy's shortage is *\"auth.json not found … sign in\"* again — killed by `{RAN_SHORT}`",
        [
            (AUTH, "      // came; `RuntimeHost.reprovisionProviderAuth` says it in a person's words, by the code.\n      if (transientSetupFailureOf(error) !== null) throw error\n", "      // came; `RuntimeHost.reprovisionProviderAuth` says it in a person's words, by the code.\n"),
        ],
    ),
    (
        f"M36 · 🔴 a re-copy's shortage reaches the window as Node's errno · the door does not say it — killed by `{RAN_SHORT}`",
        [
            (HOST, "      const shortage = transientSetupFailureOf(error)\n      if (shortage === null) throw error\n      console.warn(`runtime host did not re-copy", "      const shortage = transientSetupFailureOf(error)\n      if (shortage !== 'never') throw error\n      console.warn(`runtime host did not re-copy"),
        ],
    ),
    (
        f"M37 · ⚠️ a re-copy's `EMFILE` blames the machine — killed by `{RAN_SHORT}`",
        [
            (HOST, "        shortage === 'EMFILE'\n          ? 'Your machine sign-in was not copied: BroCrew had too many files open.", "        shortage === 'a code no shortage has'\n          ? 'Your machine sign-in was not copied: BroCrew had too many files open."),
        ],
    ),
    (
        f"M38 · ⛔ a SHARED constant is corrected without `\"shared\": true` · every reader listed, but nobody said it is shared — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "        if readers != 1 and not shared:\n", "        if readers < 1:\n"),
        ],
    ),
    (
        f"M39 · ⛔ an anchor that matches twice is written · the row applies at the wrong place — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "            if matches != 1:\n", "            if matches == 0:\n"),
        ],
    ),
    (
        f"M40 · ⛔ a splice by CHARACTER column · an em dash earlier on the line moves it — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "    return sum(len(line) for line in lines[: lineno - 1]) + column\n", "    return sum(len(line) for line in lines[: lineno - 1]) + len(lines[lineno - 1][:column].decode(\"utf-8\", \"ignore\"))\n"),
        ],
    ),
    (
        f"M41 · ⛔ `--dry-run` writes — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "    if arguments.dry_run:\n", "    if False:\n"),
        ],
    ),
    (
        f"M42 · ⛔ a shared constant listed for only SOME of its readers is not refused · the write moves the rest, and only the read-back puts it back (exit 3, not a refusal) — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "            if len(group) != readers:\n", "            if len(group) > readers:\n"),
        ],
    ),
    (
        f"M43 · ⚠️ a start stopped before it opened is answered `launch` · the launcher cannot tell a person's own Cancel from a failure — killed by `{SAID_ONCE}`",
        [
            (REFUSAL, "  if (reason === 'cancelled') return 'cancelled'\n", ""),
        ],
    ),
    (
        f"M44 · ⚠️ a refused launch with no word of its own is rejected though it was answered for — killed by `{SAID_ONCE}`",
        [
            (REFUSAL, "  if (reason !== null) return 'launch'\n", ""),
        ],
    ),
    (
        f"M45 · 🔴 what a provider's RESUME failed on is called a folder BroBot2 could not make · a transcript read, told to fix a folder — killed by `{SAID_ONCE}`",
        [
            (RUNTIME, "    if (step instanceof ResumeError) return null\n", ""),
        ],
    ),
    (
        f"M46 · ⚠️ a READ refused is called a folder BroBot2 could not make or write — killed by `{BINARY_TEST}`",
        [
            (RUNTIME, "      return !aSpawnsCode && !aRead && aPersonMustFixIt\n", "      return !aSpawnsCode && aPersonMustFixIt\n"),
        ],
    ),
    (
        f"M47 · 🔴 the model field, Import and the sweep read Node's errno for a folder again — killed by `{SAID_ONCE}`",
        [
            (HOST, "      const { failed, fix } = whatAFolderRefused(folder)\n      return fix === null ? `BroCrew ${failed}` : `BroCrew ${failed}. ${fix}`\n", "      return errorMessage(error)\n"),
        ],
    ),
    (
        f"M48 · ⚠️ a refused write names the folder that was never made as the one to fix — killed by `{SAID_ONCE}`",
        [
            (UNAVAILABLE, "          failed: `${could}, because it may not write in ${dirname(path)}`,\n", "          failed: `${could}, because it may not write in ${path}`,\n"),
        ],
    ),
    (
        f"M49 · ⚠️ no computer is ever offered the reinstall · the shipped-package check reads the wrong name, so every missing program reads as one BroBot2 has none of — killed by `{BINARY_TEST}`",
        [
            (BINARY, "      shipped.includes(candidate.slice(0, candidate.lastIndexOf('/'))),\n", "      shipped.includes(candidate.split('/claude')[0] ?? ''),\n"),
        ],
    ),
    (
        f"M50 · ⛔ the SDK's candidate for this computer is misspelt · the program is never where the mirror looks — killed by `{BINARY_TEST}`",
        [
            (BINARY, "        : [`${pkg}${platform}-${arch}`]\n", "        : [`${pkg}${arch}-${platform}`]\n"),
        ],
    ),
    (
        f"M51 · ⚠️ an ANSWERED refusal is logged nowhere · a missing program's own words go unrecorded — killed by `{SAID_ONCE}`",
        [
            (IPC, "        console.warn(`runtime command createSession was refused (${reason}) and answered:`, error)\n", ""),
        ],
    ),
    (
        f"M52 · ⛔ a note is placed below its literal's line · after a multi-line literal shrinks, every note moves — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "            line_start = _offset(lines, one.node.lineno, 0)\n", "            line_start = _offset(lines, one.node.end_lineno + 1, 0)\n"),
        ],
    ),
    (
        f"M53 · ⛔ a corrected row is never dry-applied · a second edit its first one removes is written — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "                table_contract.apply_row(after, root, index, dry=True)\n", "                pass\n"),
        ],
    ),
    (
        f"M54 · ⛔ a read-back failure puts back only its own table · the tables before it stay written — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "            for done in written:\n", "            for done in [path]:\n"),
        ],
    ),
    (
        f"M55 · ⚠️ an `open` is always a write · a transcript nobody may read, at Import, is told a folder could not be written — killed by `{BINARY_TEST}`",
        [
            (RUNTIME, "        (READ_ONLY_SYSCALLS.includes(syscall) || (syscall === 'open' && !opensAreWrites))\n", "        READ_ONLY_SYSCALLS.includes(syscall)\n"),
        ],
    ),
    (
        f"M56 · ⚠️ Import takes an `open` for a write · its transcript reads read as folders — killed by `{IMPORT}`",
        [
            (HOST, "          failure = `it could not be imported: ${this.howAFailureReads(error, true)}`\n", "          failure = `it could not be imported: ${this.howAFailureReads(error)}`\n"),
        ],
    ),
    (
        f"M57 · ⛔ splices and notes applied lowest-first · every later offset has moved, and the table is garbled — killed by `{REANCHOR_TEST}`",
        [
            (REANCHOR, "key=lambda edit: (edit[0], edit[1]), reverse=True):", "key=lambda edit: (edit[0], edit[1]), reverse=False):"),
        ],
    ),
    (
        f"M58 · ⚠️ a call on an entry that exists blames the folder that holds it · a `chmod` of the home names its parent — killed by `{SAID_ONCE}`",
        [
            (UNAVAILABLE, "    return syscall !== null && CREATES_AN_ENTRY.includes(syscall)\n", "    return true\n"),
        ],
    ),
    (
        f"M59 · ⚠️ the model field, Import and the sweep say what failed and not what a person can do — killed by `{SAID_ONCE}`",
        [
            (HOST, "      return fix === null ? `BroCrew ${failed}` : `BroCrew ${failed}. ${fix}`\n", "      return `BroCrew ${failed}`\n"),
        ],
    ),
]
