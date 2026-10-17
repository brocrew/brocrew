"""3010 · F080 and its follow-ups · a turn its provider started by itself — 374e794e, 792b03c6,
efa15c45, 4e28706c.

⛔ **The subject**: a wake (a turn the provider began by itself after its background work ended) is
a turn of its own, in the machine, in the adapter, in the ledger and on screen. The machine opens it
as `provider_turn` and ends it as a `turn` row marked `startedBy: 'the-provider'`, `interrupted` when
a Stop was asked of it first, and carrying a refused login (F076) only when none was; a message that
joins a wake inherits the Stop asked of it; the Claude adapter ends a turn only on a result that
names the turn's own message (`user_message_uuid` or `user_message_uuids`), and a message refused
before the push never ends the wake it was to join; the store closes a wake's row when another wake
opens, bounds what a wake followed by the turn, message or reopen before it, quotes only the
provider's own text, and says a wake came after the last message only when it did; a giver reads the
newest five endings; the window's transcript begins a wake afresh; and an old ledger's stop names
nobody after the wake it cut.

## ⚑ What a row here measures

 * ⚑ **M1–M5 are the machine** (`session-machine.ts`): a refused login on a wake's row (M1), the
   adapter's fact over the debt guess (M2), `interrupted` for a stopped wake (M3), no login on a
   stopped wake's row (M4), a Stop of a wake inherited by the message that joins it (M5).
 * ⚑ **M6–M8 are the Claude adapter's attribution** (`claude-runtime.ts`): a stopped turn's late
   result never ends the replacement (M6), either key names the message (M7), a message refused
   before the push leaves the wake running (M8).
 * ⚑ **M9–M13 are the store** (`session-store.ts`): a wake after the last message (M9), a second
   wake never joins the first's open row (M10), only text summaries are quoted (M11), the bound on
   what a wake followed is each of an unended message and a reopen (M12, M13).
 * ⚑ **M14 is the giver's read** (`agent-tools.ts`): the newest five endings, not the oldest.
 * ⚑ **M15 is the window's transcript** (`transcript.ts`): a wake forgets the turn before's error.
 * ⚑ **M16 is the fold** (`tasks.ts`): an old ledger's stop names nobody on the next wake.
 * ⚑ M1 and M4 share one anchor and plant different defects (the login dropped always; the login
   kept under a Stop); M12 and M13 share one and drop different members of the bound.

## ⛔ What this table does not contain

 * ⚠️ 7558149a: test and census only (replay's `resetsAt`, the deadline census); no product line.
 * ⚠️ The store's `provider_session.status` column through a wake (§3 of the store file): the
   drafter named no row for it.
 * ⚠️ The renderer's `provider_turn` notice wording and `opensTurn`: wording, and a one-line
   predicate already pinned by the same file.
 * ⚠️ All 16 candidate rows of the report's f080 section are here; none was dropped (each anchor
   was found, once, in today's text — the line numbers had moved).
"""

MACHINE = "packages/runtime/src/internal/session-machine.ts"
ADAPTER = "packages/runtime/src/claude/claude-runtime.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"

RESULT = "a-result-names-its-own-message.test.ts"
WAKES = "a-wakes-stop-and-the-message-that-joins-it.test.ts"
ROW = "what-a-wake-followed-and-what-its-row-says.test.ts"
GIVER = "a-giver-reads-its-childs-wake.test.ts"
SCREEN = "a-wake-on-screen-begins-afresh.test.ts"
OLD = "a-stop-of-an-old-ledgers-wake-names-nobody-after-it.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a wake a refused login ends forgets the login on its own `turn` row · killed by "
        f"`{WAKES}`",
        [(MACHINE,
          "        ...(!stopAsked && said.loginRefused === true ? { loginRefused: true } : {}),\n",
          "        ...{},\n")],
    ),
    (
        "M2 · 🔴 **the debt guess beats the adapter's fact** · a replacement's own result, named as "
        f"the open turn's, is swallowed as the stopped turn's · killed by `{WAKES}`",
        [(MACHINE,
          "    if (whose === 'the-open-turn' && this.turn) this.turn.absorbsForeignTerminal = false\n",
          "    if (false) this.turn.absorbsForeignTerminal = false\n")],
    ),
    (
        "M3 · 🔴 a Stop asked of a wake, then a fault, reads as the wake's own failure, not "
        f"`interrupted` · killed by `{RESULT}` and `{WAKES}`",
        [(MACHINE,
          "        state: stopAsked ? 'interrupted' : 'failed',\n",
          "        state: 'failed',\n")],
    ),
    (
        "M4 · a wake stopped first still carries `loginRefused` on its row · killed by "
        f"`{WAKES}`",
        [(MACHINE,
          "        ...(!stopAsked && said.loginRefused === true ? { loginRefused: true } : {}),\n",
          "        ...(said.loginRefused === true ? { loginRefused: true } : {}),\n")],
    ),
    (
        "M5 · 🔴 **a Stop asked of a wake is lost when a message joins it** · the joined message "
        f"that never left resumes the stopped wake · killed by `{WAKES}`",
        [(MACHINE,
          "      interruptRequested: this.stopAskedOfTheBurst,\n",
          "      interruptRequested: false,\n")],
    ),
    (
        "M6 · 🔴 a stopped turn's late result, naming the stopped message, ends the replacement "
        f"before its message is sent · killed by `{RESULT}`",
        [(ADAPTER,
          "    if (sent === null || sent.turnId !== this.machine.activeTurnId) return false\n",
          "    if (sent === null) return false\n")],
    ),
    (
        "M7 · 🔴 a result naming the message only in `user_message_uuids` never ends the turn · "
        f"killed by `{RESULT}`",
        [(ADAPTER,
          "      (Array.isArray(said.user_message_uuids) && said.user_message_uuids.includes(sent.uuid))\n",
          "      false\n")],
    ),
    (
        "M8 · 🔴 a message whose queued settings were refused before the push ends the wake it "
        f"was to join · killed by `{RESULT}`",
        [(ADAPTER,
          "      this.machine.failTurn(`could not apply the queued settings: ${errorMessage(error)}`, {\n"
          "        neverSent: true,\n"
          "      })\n",
          "      this.machine.failTurn(`could not apply the queued settings: ${errorMessage(error)}`)\n")],
    ),
    (
        "M9 · 🔴 a wake BEFORE the last message makes the last exchange \"not an answer\" · "
        f"killed by `{ROW}`",
        [(STORE,
          "      WHERE session_id = ? AND generation = ? AND type = 'provider_turn' AND ordinal > ?\n",
          "      WHERE session_id = ? AND generation = ? AND type = 'provider_turn' AND ordinal != ?\n")],
    ),
    (
        "M10 · 🔴 **a second wake joins the first wake's open row** instead of closing it "
        f"`unknown` · killed by `{ROW}`",
        [(STORE,
          "        event.type === 'user_turn' &&\n        already !== undefined &&\n",
          "        (event.type === 'user_turn' || event.type === 'provider_turn') &&\n"
          "        already !== undefined &&\n")],
    ),
    (
        "M11 · a background ending's non-text summary (a number) is quoted as the provider's own "
        f"words · killed by `{ROW}`",
        [(STORE,
          "        AND json_valid(payload) AND json_type(payload, '$.ended.summary') = 'text'\n",
          "        AND json_valid(payload) AND json_type(payload, '$.ended.summary') IS NOT NULL\n")],
    ),
    (
        "M12 · 🔴 work that ended before an unended message is quoted as what woke the wake — "
        f"the message's opening no longer bounds it · killed by `{ROW}`",
        [(STORE,
          "                                   AND type IN ('turn', 'user_turn', 'provider_turn', 'reopened')\n",
          "                                   AND type IN ('turn', 'provider_turn', 'reopened')\n")],
    ),
    (
        "M13 · work that ended in the life before a reopen is quoted as waking a wake in this one "
        f"· killed by `{ROW}`",
        [(STORE,
          "                                   AND type IN ('turn', 'user_turn', 'provider_turn', 'reopened')\n",
          "                                   AND type IN ('turn', 'user_turn', 'provider_turn')\n")],
    ),
    (
        "M14 · a giver reading its child's wake is quoted the OLDEST five endings, not the newest "
        f"· killed by `{GIVER}`",
        [(TOOLS,
          "        const shown = after.slice(-SUMMARIES_SHOWN)\n",
          "        const shown = after.slice(0, SUMMARIES_SHOWN)\n")],
    ),
    (
        "M15 · a wake's own failure is deduped against the turn before's and never drawn · "
        f"killed by `{SCREEN}`",
        [(TRANSCRIPT,
          "      state.activity = null\n      state.lastError = null\n      if (event.oneShotCameDue === undefined) {\n",
          "      state.activity = null\n      if (event.oneShotCameDue === undefined) {\n")],
    ),
    (
        "M16 · in a ledger written before F080, a person's stop of one wake names them on the "
        f"next wake too · killed by `{OLD}`",
        [(TASKS,
          "          // ⛔ **484** — the ask belongs to the drive it ended, as above.\n          asked = null\n",
          "          // ⛔ **484** — the ask belongs to the drive it ended, as above.\n          void asked\n")],
    ),
]
