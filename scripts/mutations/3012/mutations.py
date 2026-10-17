"""3012 · F036, the memory lines, and the pending-settings compare — 80bff428, a5030808, aab65c9c,
05eb3115.

⛔ **The subject**: four host-side changes that each decide what is said, and when.

 * **F036 (80bff428)** — a conversation OWES an answer when a child routed a question to it as the
   parent, or by name, and the question is open; the host keeps an incremental index of who routed
   to whom (seeded once, from the store, never from a person's routing), pushes the parent's word
   when a routing or its asker moves, carries the debt across a replacement, and lets an owing
   conversation be stopped (D-018).
 * **The app counts itself (a5030808)** — the watchdog's figure is the app's own processes, in
   bytes (Electron's metrics are in KB); the reading of what it spawned leaves out its own `ps`
   probe and says whether it has read yet.
 * **The agents' own line (aab65c9c)** — a second watch with its own floor (16 GiB, or three
   quarters of a smaller machine), step and rearm level; each spawned process credited to the agent
   that heads it (never to a Chromium helper); the largest agents named first; and the host names
   only the pids it was asked about.
 * **The pending-settings compare (05eb3115)** — on Claude a turn's `working` status comes before
   its words, so the words' own row compares what the conversation holds again — once, behind the
   flag the status set, and the flag is cleared at every turn ending.

## ⚑ What a row here measures

 * ⚑ **M1–M6 are F036** (`runtime-host.ts`, M6 `session-store.ts`): a first routing indexed (M1), the
   parent's owed read moved (M2), a person's question never the parent's to owe (M3), an owing
   conversation stopped (M4), a stand-in's owed read (M5), the seed leaves a person's routing out
   (M6, a spare row of the report's).
 * ⚑ **M7–M9 are the app counting itself** (`memory-watch.ts`, `process-tree.ts`): KB as bytes
   (M7), its own probe left out (M8), "not read yet" (M9).
 * ⚑ **M10–M14 are the agents' own line** (`memory-watch.ts`, `process-tree.ts`, `runtime-host.ts`):
   the rearm level itself (M10), the floor on a large Mac (M11), a command under a Chromium helper
   (M12), the largest named first (M13), only the asked pids (M14).
 * ⚑ **M15–M18 are the compare** (`runtime-host.ts`): the flag set at Claude's `working` (M15), the
   words' compare (M16), the flag cleared at a turn's ending (M17), the compare announcing without
   comparing (M18; one anchor with M16, a different defect).

## ⛔ What this table does not contain

 * ⚠️ 09ca7541 (F036's window): a NO commit — the ranking is the shared ladder, already pinned, and
   the window's moved rows were re-anchored and verified in the commit.
 * ⚠️ a5030808's `index.ts` row (the app's sample adding its agents back): killed only by a source
   check over `index.ts`; left out at the 18-row cap. a5030808's `Tab` → `main` name: a word on the
   line; left out at the cap.
 * ⚠️ F036's other spare rows: the asker folded twice per listing (`oneStatePerListing`, a cost),
   a `status` row's re-ask (the drafter doubts its killer), the index reseeded on every read (a
   cost) — left out at the cap.
 * ⚠️ The three ladder rows F036 moved (`1017 M122`, `258 M25`, `258 M26`) are re-anchors of other
   tables, not rows of this one.
 * ⚠️ a rebuilt asker record (report item 6): no test pins it.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
WATCH = "apps/desktop/src/main/memory-watch.ts"
TREE = "apps/desktop/src/main/process-tree.ts"

OWES = "an-agent-that-owes-another-an-answer-says-so.test.ts"
ITSELF = "the-memory-warning-counts-the-app-itself-and-says-its-agents-apart.test.ts"
AGENTS = "the-agents-own-memory-line-is-written-only-as-a-runaway-climbs.test.ts"
BYPID = "the-memory-line-names-an-agent-by-its-work-from-its-pid.test.ts"
COMPARE = "a-claude-turns-words-compare-its-work-again.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a first routing to an already-seeded parent is never indexed, so the parent never "
        f"owes · killed by `{OWES}`",
        [(HOST,
          "        if (askers === undefined) this.routedTo.set(event.parent, new Set([conversation]))\n",
          "        if (askers === undefined) {}\n")],
    ),
    (
        "M2 · 🔴 **the running parent is never pushed `owes-an-answer`** · its stale empty owed "
        f"read stands when a child routes a question to it · killed by `{OWES}`",
        [(HOST,
          "      if (event.to !== 'a-person') this.theAnswersItOwesMoved(this.theOneInItsPlace(event.parent))\n",
          "      if (false) this.theAnswersItOwesMoved(this.theOneInItsPlace(event.parent))\n")],
    ),
    (
        "M3 · 🔴 a question its child addressed to a PERSON is owed by the parent · killed by "
        f"`{OWES}`",
        [(HOST,
          "            (one.went.is === 'the-parent' || one.went.is === 'the-agent-the-asker-named'),\n",
          "            true,\n")],
    ),
    (
        "M4 · (D-018) a conversation that owes an answer is never stopped by its idle countdown · "
        f"killed by `{OWES}`",
        [(HOST,
          # ⚑ **W4.210 · re-anchored in place, not retired** — W4.210: the idle check refuses active only (needs-you held by the ledger is stoppable), over several lines; the row still makes owing an answer refuse the stop
          "      state.is === 'active' ||\n",
          "      state.is === 'active' ||\n      state.is === 'owes-an-answer' ||\n")],
    ),
    (
        "M5 · a stand-in keeps the empty owed read it took before it stood in, so it never says "
        f"what the replaced one owed · killed by `{OWES}`",
        [(HOST,
          "      this.theAnswersItOwesMoved(event.sessionId)\n",
          "      void event.sessionId\n")],
    ),
    (
        "M6 · the index's seed counts a question routed to a PERSON as an edge somebody owes on · "
        f"killed by `{OWES}`",
        [(STORE,
          "        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.to') END IS NOT 'a-person'`,\n",
          "        AND 1 = 1`,\n")],
    ),
    (
        "M7 · 🔴 **Electron's kilobytes counted as bytes** · the app's own figure is a thousand times "
        f"too small and its floor is never crossed · killed by `{ITSELF}`",
        [(WATCH,
          "    bytes: processes.reduce((total, one) => total + one.memory.workingSetSize * 1024, 0),\n",
          "    bytes: processes.reduce((total, one) => total + one.memory.workingSetSize, 0),\n")],
    ),
    (
        "M8 · the app's own `ps` probe is listed as one of its agents, so \"none of its agents is "
        f"running\" is never said · killed by `{ITSELF}`",
        [(TREE,
          "  return parseProcessTable(table).filter((row) => !(row.ppid === rootPid && row.name === 'ps'))\n",
          "  return parseProcessTable(table)\n")],
    ),
    (
        "M9 · a listing not read yet is said as one that found none · killed by "
        f"`{ITSELF}`",
        [(TREE,
          "    everRead: () => everRead,\n",
          "    everRead: () => true,\n")],
    ),
    (
        "M10 · the agents' line starts a new episode at exactly its rearm level, not only below it "
        f"· killed by `{AGENTS}`",
        [(WATCH,
          "    if (options.rearmBelowBytes !== undefined && rss < options.rearmBelowBytes) reported = 0\n",
          "    if (options.rearmBelowBytes !== undefined && rss <= options.rearmBelowBytes) reported = 0\n")],
    ),
    (
        "M11 · 🔴 a large Mac's agents' floor is three quarters of its memory (48 GiB on 64), not "
        f"16 GiB — a runaway is never written · killed by `{AGENTS}`",
        [(WATCH,
          "  return Math.min(AGENTS_MEMORY_FLOOR_BYTES, Math.floor(machineBytes * 0.75))\n",
          "  return Math.max(AGENTS_MEMORY_FLOOR_BYTES, Math.floor(machineBytes * 0.75))\n")],
    ),
    (
        "M12 · a command under a Chromium helper is credited to the helper, not heading its own "
        f"subtree · killed by `{AGENTS}`",
        [(TREE,
          "        pid === rootPid || alreadyCounted.has(pid) ? child.pid : (headOf.get(pid) ?? child.pid)\n",
          "        pid === rootPid ? child.pid : (headOf.get(pid) ?? child.pid)\n")],
    ),
    (
        "M13 · 🔴 the agents' line names the SMALLEST agents, not the largest · killed by "
        f"`{AGENTS}`",
        [(WATCH,
          "  const ranked = [...groups].sort(([, a], [, b]) => totalBytes(b) - totalBytes(a))\n",
          "  const ranked = [...groups].sort(([, a], [, b]) => totalBytes(a) - totalBytes(b))\n")],
    ),
    (
        "M14 · the host names agents the memory line was not asked about · killed by "
        f"`{BYPID}`",
        [(HOST,
          "      if (pid === undefined || !wanted.has(pid)) continue\n",
          "      if (pid === undefined) continue\n")],
    ),
    (
        "M15 · 🔴 **a Claude turn never compares again at its words** · the flag is never set at its "
        f"early `working` · killed by `{COMPARE}`",
        [(HOST,
          "      session.itsWorkWasReadBeforeItsWords = true\n",
          "      void session\n")],
    ),
    (
        "M16 · 🔴 the words' row clears the flag and compares nothing, so the drive the words name "
        f"is never said · killed by `{COMPARE}`",
        [(HOST,
          "        this.sayWhenItsWorkMoved(session.id, this.whatItHolds(session.id))\n",
          "        void session.id\n")],
    ),
    (
        "M17 · a wake's flag leaks into the next words-first turn, which compares at its words · "
        f"killed by `{COMPARE}`",
        [(HOST,
          "      session.finishedSinceItsLastTurn = []\n      session.itsWorkWasReadBeforeItsWords = false\n",
          "      session.finishedSinceItsLastTurn = []\n")],
    ),
    (
        "M18 · the words' row announces `work` without comparing, whether or not anything moved · "
        f"killed by `{COMPARE}`",
        [(HOST,
          "        this.sayWhenItsWorkMoved(session.id, this.whatItHolds(session.id))\n",
          "        this.theWorldMoved('work')\n")],
    ),
]
