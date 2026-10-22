"""3033 · F093 R1's exact matching and its one window door (f5980ebc, 791f5ca9), the popup totals'
every-request parts (966b3415, W4.184), and BroBot's own rules first in Claude's budget (b8414e4f,
W4.178).

⛔ **The subject**: R1 finds a ledger message in the provider's own record by the EXACT text this
app handed over (`user_turn.sent`), or — for a conversation brought in from elsewhere — by the
text its importer took from that record, and never by words inside a message; every turn it cannot
find says why; and a window reaches it only inside `whatTheModelGot`, a person's read that a quit
refuses (the old `turn-as-sent-in-the-app.ts` channel is deleted, and the preload carries no
`turnAsSent`). 966b3415 makes the popup's total count what every request carries: BroBot's tools by
name under Claude's tool search, and other servers' tool names apart from BroBot's. b8414e4f grants
BroBot's own rules file first in Claude's 256 KiB instruction budget, so a repository's files give
way instead.

## ⚑ What a row here measures

 * ⚑ **M1–M4 are the reader's exact rules** (`archive/turn-as-sent.ts`): Codex's handed-over block
   compared exactly (~407), Codex's imported message by the importer's split (~394), Claude's
   imported turn as its string content exactly, and an image kept out of the text a Claude message
   is matched by.
 * ⚑ **M5–M9 are the host's key and count** (`runtime-host.ts` `readTurnAsSent`): the `key` is the
   text handed over (`handed-over`) or, only for a `provider_transcript` turn, the importer's text
   (`its-own-record`); the `before.some(turn.key === null && same words)` refusal; the nth counted
   by the same text only.
 * ⚑ **M10, M11 are "every unfindable turn says why"**: Codex's compaction named, and the not-found
   sentence matched to how the turn was looked for.
 * ⚑ **M12, M13 are the single window door** (`runtime/ipc.ts`): `whatTheModelGot` behind
   `requireAPerson`, and refused during a quit.
 * ⚑ **M14–M17 are 966b3415** (`what-this-agent-was-given.ts`): other servers' names in the total,
   BroBot's own names never among them, a full hand-over not counted as names, and
   `toolsInEveryRequest` reporting what the total counted.
 * ⚑ **M18 is b8414e4f** (`instructions.ts` `allocate`): BroBot's rules at the head of the grant
   order — the commit's RED-then-GREEN test is its killer.

## ⛔ What this table does not contain

 * ⚠️ Table 3029's rows on the same files (Claude's exact rule as a substring, the nth, each
   provider's conversation guard, the file guard, the settle, the count across a /clear, the
   archive's frames) — not repeated.
 * ⚠️ Table 187's M7/M8 (the reverse chain walk, profile memory before the chain) — not repeated.
 * ⚠️ Killable but left out to stay at eighteen: the refusal's `turn.words === of.words` made
   `true` (killed by the same test's control, `sess_two_unalike`), and `otherServersToolsWhy`
   wired to `null` (killed by the one-read test's `/keeps none of their descriptions/`).
 * ⚠️ `allocate`'s `new Set([...])` made an array: an EQUIVALENT mutant — the second copy of
   BroBot's rules is last in the reverse walk, so charging it twice spends only what nothing else
   wanted. Not a row and not a gap.
 * ⚠️ Decisions no existing test would kill — Codex's nth, Codex's `role === 'user'` on a
   handed-over block, the imported Codex message kept whole, counting the nth by kind, Codex's
   other-servers sentence, Claude's not-yet-reported sentence, the budget's exact 256 KiB edge,
   BroBot's rules before identity — are in `gaps-3033.md`.
"""

TAS = "apps/desktop/src/main/archive/turn-as-sent.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
GIVEN = "apps/desktop/src/main/runtime/what-this-agent-was-given.ts"
INSTR = "apps/desktop/src/main/runtime/instructions.ts"

TURN = "turn-as-sent.test.ts"
WHAT = "what-this-agent-was-given.test.ts"
DOOR = "shutdown-door.test.ts"
ONE_READ = "the-one-read-says-who-wrote-each-part-and-how-the-tools-are-handed.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # it('🔴 words inside a message are not it, nor is its text with a character more or less')
    # — `read('codex', codex, { text: FIRST })` must not be found
    (
        "M1 · 🔴 **Codex: words inside a block** · a handed-over Codex block is matched when it merely "
        f"contains the text, so a person's words inside a longer block find it · killed by `{TURN}`",
        [(TAS,
          # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 094f095e (W4.204) rewrote readingCodex's handed-over match as an if-condition ending the line with no `&&`; the exact block compare is still the subject, planted as `includes`.
          # ⚑ **W4.645 · re-anchored in place, not retired** — the block is compared as the ledger keeps it (`codexTextAsKept`, the saved methods' lines in the app's lead in their kept form); the exact compare is still the subject, planted as `includes`.
          "              codexTextAsKept(block.text) === asked.text\n",
          "              codexTextAsKept(block.text).includes(asked.text)\n")],
    ),
    # it('⛔ its state database is read through a copy: no -shm, no -wal, nothing new or changed')
    # — `expect(turn.found && turn.message).toBe(said)` (§5, throwaway HOME/CODEX_HOME)
    (
        "M2 · 🔴 **Codex: any message is the imported one** · an imported turn is matched without the "
        "importer's split, so the rollout's first message (Codex's own developer block) is read as it "
        f"· killed by `{TURN}`",
        [(TAS,
          # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 094f095e (W4.204) made Codex's imported-record match the last term of an if-condition (no trailing `&&`); the importer's split compare is replaced by `true` as before.
          # ⚑ **W4.645 · re-anchored in place, not retired** — the split is taken of the message as the importer keeps it (`codexMessageAsKept`), which wraps the compare over two lines; it is replaced by `true` as before.
          "            splitCodexMessage(role, messageText(codexMessageAsKept(payload)['content'])).said ===\n"
          "              asked.text\n",
          "            true\n")],
    ),
    # it('🔴 a turn read from the provider’s own record: found by the text its importer took from it')
    # — `sess_imported_words` (FIRST alone) must answer 'has the text this app read from it'
    (
        "M3 · 🔴 **Claude: an imported turn found by words inside a message** · its importer's text "
        f"is matched as a substring of the record's content · killed by `{TURN}`",
        [(TAS,
          "            : typeof content === 'string' && content === asked.text\n",
          "            : typeof content === 'string' && content.includes(asked.text)\n")],
    ),
    # it('🔴 a message with an image: found by its text, and the image named beside it')
    (
        "M4 · an image beside a Claude message is counted into the text it is matched by, so a "
        f"message sent with a picture is never found · killed by `{TURN}`",
        [(TAS,
          "    .filter((block) => block.isText)\n",
          "    .filter(() => true)\n")],
    ),
    # it('🔴 the provider’s own file, found as the archive finds it'), and
    # it('🔴 each turn in the provider conversation Claude names after it: a /clear starts the count again')
    (
        "M5 · 🔴 **found by the ledger's words, not the text handed over** · the `handed-over` key "
        f"carries `event.text`, so no message BroBot wrapped is ever found · killed by `{TURN}`",
        [(HOST,
          "                ? { by: 'handed-over', text: stored }\n",
          "                ? { by: 'handed-over', text: event.text }\n")],
    ),
    # it('⛔ a message whose text this app did not keep: said so, never found by its words'), and
    # it('⛔ a person’s compaction on Codex: said so')
    (
        "M6 · 🔴 **every turn with no copy treated as imported** · a turn handed over before this app "
        "kept its text is looked for by its words as the importer's text, and its own reason is lost "
        f"· killed by `{TURN}`",
        [(HOST,
          "                : event.attribution === 'provider_transcript'\n",
          "                : true\n")],
    ),
    # it('⛔ an earlier message with the same words and nothing to match it by: which one cannot be told')
    (
        "M7 · 🔴 **the ambiguity refusal gone** · an earlier message with the same words and no copy "
        "of what was handed over is not counted, so the file's first such message is read as this "
        f"one · killed by `{TURN}`",
        [(HOST,
          "    if (before.some((turn) => turn.key === null && turn.words === of.words)) {\n",
          "    if (false) {\n")],
    ),
    # it('⚑ the same text twice: the second message is the file’s second'), and the /clear test's
    # ordinal 7 (`AGAIN`)
    (
        "M8 · 🔴 **refused though both were kept** · any earlier message with the same words refuses, "
        f"even one whose handed-over text was kept and counts · killed by `{TURN}`",
        [(HOST,
          "    if (before.some((turn) => turn.key === null && turn.words === of.words)) {\n",
          "    if (before.some((turn) => turn.words === of.words)) {\n")],
    ),
    # it('🔴 each turn in the provider conversation Claude names after it: a /clear starts the count again')
    # — ordinal 7 sent `CLAUDE_FIRST\n\nAGAIN` after one CLAUDE_FIRST in life-b
    (
        "M9 · 🔴 **the nth counts every earlier message** · not only those handed over with the same "
        f"text, so a later message with new text looks for a second copy that does not exist · killed by `{TURN}`",
        [(HOST,
          # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 094f095e (W4.204) replaced the `nth` count with the `before` list of earlier same-text turns' rules; the defect is the same, counting every earlier kept turn regardless of text.
          "        turn.key !== null && turn.key.text === key.text ? [turn.key.by] : [],\n",
          "        turn.key !== null ? [turn.key.by] : [],\n")],
    ),
    # it('⛔ a person’s compaction on Codex: said so')
    (
        "M10 · a person's `/compact` on Codex is said to be a text this app kept no copy of, not "
        f"Codex's own compaction that sent no words · killed by `{TURN}`",
        [(HOST,
          # ⚑ **provider selection refactor · re-anchored in place, not retired** — The compaction predicate now spans two lines with an exhaustive selector; forcing it false still mislabels the native compaction command.
          "          providerValue(row.provider, { claude: false, codex: true }) &&\n          target.words.trim() === '/compact'\n",
          "          false\n")],
    ),
    # it('⛔ a text it never got: said so'), and the `sess_imported_words` answer
    (
        "M11 · the not-found sentence names the wrong way of looking: a handed-over turn is said not "
        f"to match “the text this app read from it”, and the reverse · killed by `{TURN}`",
        [(TAS,
          "  return asked.by === 'handed-over'\n",
          "  return asked.by !== 'handed-over'\n")],
    ),
    # it('⛔ C9 d · both reads are a person’s doors: refused on a channel with no person behind it, answered on a window'),
    # and it('⛔ read only, and reached by a window only inside the person’s own read')
    (
        "M12 · 🔴 **the window door with no person check** · `whatTheModelGot`, R1's one way in, "
        "answers a channel no person is behind, with the agent's instructions and the provider's "
        f"record of each message · killed by `{WHAT}` and `{TURN}`",
        [(IPC,
          "      requireAPerson(sink, command.kind)\n"
          "      return host.whatTheModelGot(command.sessionId, command.ordinal)\n",
          "      return host.whatTheModelGot(command.sessionId, command.ordinal)\n")],
    ),
    # it('refuses every database-reaching command once a quit has begun, and asks the host nothing'),
    # and it('⛔ read only, and reached by a window only inside the person’s own read')
    (
        "M13 · R1's door answered during a quit — a ledger walk and a provider-file read started "
        f"while the app tears down · killed by `{DOOR}` and `{TURN}`",
        [(IPC,
          "  whatTheModelGot: 'refused',\n",
          "  whatTheModelGot: 'answered',\n")],
    ),
    # it('⚑ Claude: unknown until a tool list comes, names-until-loaded with ToolSearch, in-every-request without — and the total follows'),
    # and it('⚑ what every request carries adds up to the total: …')
    (
        "M14 · 🔴 **the total leaves out other servers' tool names** · on Claude with its tool search "
        f"the figure says them but the total does not add them · killed by `{ONE_READ}` and `{WHAT}`",
        [(GIVEN,
          "    ...(otherServers.size === null ? [] : [otherServers.size]),\n",
          "    // other servers' tools left out of the total\n")],
    ),
    # the same two tests: `otherServersToolsInEveryRequest` toEqual the other servers' names alone
    (
        "M15 · 🔴 **BroBot's own tools counted twice** · `mcp__brobot__*` names are taken as another "
        f"server's, and counted again beside `toolsInEveryRequest` · killed by `{ONE_READ}` and `{WHAT}`",
        [(GIVEN,
          "  const names = published.filter((one) => one.startsWith('mcp__') && !one.startsWith(ours))\n",
          "  const names = published.filter((one) => one.startsWith('mcp__'))\n")],
    ),
    # it('⚑ Claude: unknown until a tool list comes, …') — the in-full case: `toBeNull()` and the why
    (
        "M16 · other servers' tools handed over in full are counted by their names alone, as if "
        f"Claude deferred them, and the total says less than every request carries · killed by `{ONE_READ}`",
        [(GIVEN,
          "  return deferral.kind === 'names-until-loaded'\n"
          "    ? { size: sizeOf(names.join('\\n')), why: null }\n",
          "  return true\n"
          "    ? { size: sizeOf(names.join('\\n')), why: null }\n")],
    ),
    # it('⚑ what every request carries adds up to the total: …') — `toolsInEveryRequest` toEqual the names
    # and less than `tools`; and the one-read test's `expect(s.toolsInEveryRequest).toEqual(names)`
    (
        "M17 · 🔴 **the figures add up to more than the total again** · `toolsInEveryRequest` reports "
        f"BroBot's full definitions while the total counted their names · killed by `{WHAT}` and `{ONE_READ}`",
        [(GIVEN,
          # ⚑ **the namespace sentence is shown · re-anchored in place, not retired** — the tools in full now add the sentence they are declared under where one is sent; the row still reports them in full where every request carries their names
          "      tools: toolsInFull,\n      toolsInEveryRequest,\n",
          "      tools: toolsInFull,\n      toolsInEveryRequest: toolsInFull,\n")],
    ),
    # it('🔴 a repository that fills the instruction budget gives way: BroBot’s own rules still reach a Claude agent, and the read says they were sent, from BroBot')
    (
        "M18 · 🔴 **BroBot's rules shed first again** · granted last (first in prompt order, and the "
        "grant walk is the reverse), so a repository that fills Claude's 256 KiB budget pushes out the "
        f"safety rules and the person's instructions for the agent · killed by `{WHAT}`",
        [(INSTR,
          "    ...candidates.filter((item) => item.kind === 'profile-instructions'),\n",
          "    // BroBot's own rules: no place of their own in the grant order\n")],
    ),
]
