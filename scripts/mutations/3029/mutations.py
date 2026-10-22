"""3029 · F093 R1 · the provider's own record of a turn — the R1 branch (b9607dc1, e8bebde0,
a9a20179, 0d47ee9f, 5dbf25b2; merge 2b9e6d39) and 63834ba5.

⛔ **The subject**: one message of a conversation's ledger, read back out of the provider's OWN file
(Claude Code's transcript, Codex's rollout) — found by its words as whole paragraphs and by how many
earlier messages of the SAME provider conversation held them; the file read only when it sits in
that provider's record folders of this profile's home; a turn of an earlier conversation, or one the
file no longer holds, read from the archive's copy, and only when the archive holds raw frames; a
send that reached no provider conversation never matched in another's file. 63834ba5 carries the
reading into `whatTheModelGot` and says whether the provider kept the same text BroBot handed over.

## ⚑ What a row here measures

 * ⚑ **M1–M4 are the reader's matching rules** (`archive/turn-as-sent.ts`): words as whole
   paragraphs, the nth match, and the provider conversation on each record (Claude's `sessionId`,
   Codex's `session_meta` id).
 * ⚑ **M5, M6 are the file boundary** (`archive/native-file.ts`): `isTheProvidersRecord` holds a
   Claude file to `projects/`; the Codex state database is read through a private copy, so nothing
   is created beside it in a provider home.
 * ⚑ **M7–M12 are the host's walk** (`runtime-host.ts` `readTurnAsSent`): the guard actually
   applied, which conversation a turn is settled into, the refusal of a send that reached none, the
   nth counted in one conversation, and the archive asked only when it holds raw frames.
 * ⚑ **M13 is 63834ba5's wiring** (`whatTheModelGot`): R1 reads the MESSAGE's place, not the place
   asked.
 * ⚑ **M14, M15 are `providerKeptTheSameText`** (`what-this-agent-was-given.ts`): not known when
   the provider's record is missing, or when the message carried a file.

## ⛔ What this table does not contain

 * ⚠️ Killable but left out to keep the table at fifteen rows (each twins a row here or is
   rendering rather than matching): Claude's parts order by `renderedRole` (§1's first test kills it), an unknown Claude record or a
   torn Codex line dropped (§3 kills both), a new launch not settling a turn left open (§4's quit
   test kills it), and the walk stopping at a no-conversation turn's end before the ledger names
   one (the same test, M9's twin).
   `providerKeptTheSameText` compared with no text kept (`sent !== null` dropped) is killed by the
   same `sameText` test as M14, M15.
 * ⚠️ Decisions no existing test would kill — the Codex reader's nth, Claude's `isMeta`/sidechain/
   `tool_result` exclusions, a record naming no conversation, the `+ sep` folder boundary, the
   Codex rollout-name rule, the 20,000-character cut, the state-db scratch removal, the first
   non-empty part's words, the IPC door's argument gate — are in `gaps-3029.md`.
 * ⚠️ The source-read test's own slice markers (`readTurnAsSent`'s signature and
   `return reading.answer('archive')`): mutating them breaks the test's slice, not the product.
"""

TAS = "apps/desktop/src/main/archive/turn-as-sent.ts"
NATIVE = "apps/desktop/src/main/archive/native-file.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
GIVEN = "apps/desktop/src/main/runtime/what-this-agent-was-given.ts"

TURN = "turn-as-sent.test.ts"
WHAT = "what-this-agent-was-given.test.ts"
HOMES = "user-homes.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # it('🔴 “no” is not found inside “there is no default”; a paragraph of its own is')
    (
        "M1 · 🔴 **words found inside a sentence** · a person's “no” is matched inside "
        f"“There is no default.” — the exact-text rule becomes a substring · killed by `{TURN}`",
        [(TAS,
          # ⚑ **W4.181 · re-anchored in place, not retired** — W4.181 · R1 now finds a turn by the exact text handed over (f5980ebc); `holdsTheWords` is gone, the subject is not — the plant makes Claude's exact rule a substring again (reviewed: re-anchor, not retire)
          "            ? textOf(content) === asked.text\n",
          "            ? textOf(content).includes(asked.text)\n")],
    ),
    # it('⛔ words it never got: said so') — FIRST at nth 1 is found
    (
        "M2 · 🔴 **the nth ignored** · Claude's reader takes the first message holding the words, "
        f"whichever was asked · killed by `{TURN}`",
        [(TAS,
          # ⚑ **W4.204 · re-anchored in place, not retired** — W4.204: the count became the earlier same-text messages, each taking its own record; the row still makes the reader take the first match
          "        if (taken++ < asked.before.length) return 'more'\n",
          "        if (taken++ < 0) return 'more'\n")],
    ),
    # it('⚑ only in the provider conversation it was in') — Claude, life 'another'
    (
        "M3 · 🔴 **another conversation's message** · Claude's reader matches a record whose "
        f"`sessionId` names another provider conversation · killed by `{TURN}`",
        [(TAS,
          "        if (asked.life !== null && typeof its === 'string' && its !== asked.life) return 'more'\n",
          "        if (false) return 'more'\n")],
    ),
    # it('⚑ only in the provider conversation it was in') — Codex, life 'another'
    (
        "M4 · 🔴 **another thread's message** · Codex's reader matches a message under any "
        f"`session_meta` id · killed by `{TURN}`",
        [(TAS,
          # ⚑ **W4.181 · re-anchored in place, not retired** — W4.181 · R1's exact matching (W4.185) folded Codex's conversation guard into `candidate`; the plant still matches a message under any session_meta id
          "          const candidate = state === 'looking' && (asked.life === null || life === asked.life)\n",
          "          const candidate = state === 'looking' && true\n")],
    ),
    # it('⛔ a file that is not the provider’s record of a conversation is never read')
    (
        "M5 · 🔴 **any `.jsonl` in the home is Claude's record** · a file the provider's lookup "
        f"names outside `projects/` is read as the transcript · killed by `{TURN}`",
        [(NATIVE,
          # ⚑ **provider selection refactor · re-anchored in place, not retired** — The archive validator now uses an exhaustive selector; dropping the projects boundary still accepts unrelated JSONL files.
          "  if (providerValue(provider, { claude: true, codex: false }))\n    return under('projects') && resolved.endsWith('.jsonl')\n",
          "  if (providerValue(provider, { claude: true, codex: false }))\n    return resolved.endsWith('.jsonl')\n")],
    ),
    # it('leaves no -shm or -wal beside a WAL-mode state database')
    (
        "M6 · 🔴 **a write in the provider's home** · Codex's state database is opened in place, "
        f"not through the private copy, and SQLite creates its `-shm` beside it · killed by `{HOMES}`",
        [(NATIVE,
          "    const db = new Database(copy, { readonly: true, fileMustExist: true })\n",
          "    const db = new Database(path, { readonly: true, fileMustExist: true })\n")],
    ),
    # it('⛔ a file that is not the provider’s record of a conversation is never read'), and
    # it('⛔ read only: the host opens the one file the archive names, and writes nothing')
    (
        "M7 · 🔴 **the guard never applied** · the host reads whatever file the lookup names, "
        f"`isTheProvidersRecord` or not · killed by `{TURN}`",
        [
            ('apps/desktop/src/main/runtime/runtime-host.ts', '      path = found !== null && isTheProvidersRecord(row.provider, home, found) ? found : null\n', '      path = found\n'),
        ],
    ),
    # it('🔴 each turn in the provider conversation Claude names after it: a /clear starts the count again')
    # — ordinal 1 (life-a) answers 'not in the provider's own record' instead of 'gone'
    (
        "M8 · 🔴 **an earlier conversation's turn read in the current file** · a turn of life-a "
        f"is looked for in life-b's transcript rather than the archive · killed by `{TURN}`",
        [
            ('apps/desktop/src/main/runtime/runtime-host.ts', '    const ref = of.life === null ? row.ref : { ...row.ref, sessionId: of.life }\n', '    const ref = row.ref\n'),
        ],
    ),
    # it('⛔ a send that reached no provider conversation, and a turn a quit left open')
    (
        "M9 · 🔴 **a failed send matched in another conversation's file** · a turn that reached no "
        f"provider conversation, in a ledger that names one, is read in life-b's transcript · killed by `{TURN}`",
        [(HOST,
          "    if (target.life === null && named) {\n",
          "    if (false) {\n")],
    ),
    # it('🔴 each turn in the provider conversation Claude names after it: a /clear starts the count again')
    (
        "M10 · 🔴 **settled when handed over** · a turn is put in the conversation in force at its "
        "message, not the one Claude names after it, so a first turn is in none and a /clear's "
        f"first turn in the old one · killed by `{TURN}`",
        [(HOST,
          # ⚑ **W4.181 · re-anchored in place, not retired** — W4.181 · the Turn literal is spread over lines now (its `key` and `words`); the plant still settles a turn into the conversation in force when it was handed over
          "            words: event.text,\n            life,\n            settled: false,\n",
          "            words: event.text,\n            life,\n            settled: true,\n")],
    ),
    # it('🔴 each turn in the provider conversation Claude names after it: a /clear starts the count again')
    # — ordinal 4 finds the AGAIN message
    (
        "M11 · 🔴 **the count across a /clear** · earlier messages of another provider conversation "
        f"are counted into the nth, so the new file's second same-words message is read · killed by `{TURN}`",
        [(HOST,
          # ⚑ **W4.181 · re-anchored in place, not retired** — W4.181 · the nth now counts from `before`, the earlier turns of the same provider conversation; the plant still counts another conversation's messages into it
          "    const before = turns.filter((turn) => turn.ordinal < of.ordinal && turn.life === of.life)\n",
          "    const before = turns.filter((turn) => turn.ordinal < of.ordinal)\n")],
    ),
    # it('⛔ a place that holds no message, and a conversation the app does not hold: said so'),
    # and the /clear and not-the-record tests' exact 'gone' answers
    (
        "M12 · **the archive asked with no frames** · a conversation whose file is gone and whose "
        "archive holds nothing answers the reader's “not in Claude Code’s record” instead of "
        f"“gone, and the app kept no copy” · killed by `{TURN}`",
        [(HOST,
          "    if (this.deps.store.rawFrameCount(sessionId) === 0) {\n",
          "    if (false) {\n")],
    ),
    # it('⚑ C9 d · joined with the provider’s own record (R1): the turn as Claude Code kept it, read from a recorded transcript')
    (
        "M13 · 🔴 asked at the reply's place, R1 reads the place asked rather than the message "
        f"it answers for, and finds no message there · killed by `{WHAT}`",
        [(HOST,
          "      providersRecord: await this.turnAsSent(sessionId, message.ordinal),\n",
          "      providersRecord: await this.turnAsSent(sessionId, ordinal),\n")],
    ),
    # it('⚑ C9 d · whether the provider kept the same text as BroBot handed over: yes, no, or not known'),
    # and the first C9 d test's `providerKeptTheSameText: null` beside R1_GONE
    (
        "M14 · 🔴 **a missing record said to differ** · with the provider's record not found, the "
        f"answer is `false` instead of not known · killed by `{WHAT}`",
        [(GIVEN,
          "      handed.providersRecord.found &&\n",
          "      true &&\n")],
    ),
    # it('⚑ C9 d · whether the provider kept the same text as BroBot handed over: yes, no, or not known')
    (
        "M15 · a message that carried a file is compared as text, though each provider records "
        f"files in its own way · killed by `{WHAT}`",
        [(GIVEN,
          "      theMessagesOf(event).every((one) => (one.attachments?.length ?? 0) === 0)\n",
          "      true\n")],
    ),
]
