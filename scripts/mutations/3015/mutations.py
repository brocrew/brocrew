"""3015 · F035 (29419fcb), F035's window (9c566be7) and D-034 (8bf333ba).

⛔ **The subject**: two pieces of new logic a person relies on without seeing. F035 decides when a
scheduled one-shot that fired leaves the level — at the turn its provider began, at that turn's
`working` — whether the turn is named for it, and whether a restated level writes a row; the
window keeps a put-back job's FIRST listing and shows the named turn in normal mode and the
reading export. D-034 says, off the host's memory of replacements, which conversation stands in
whose place on the Graph — to the end of a chain, and never round a hand-edited loop.

## ⚑ What a row here measures

 * ⚑ **M1–M6 are F035's start/stop/wake path**: the level row written at `provider_turn`, not
   `working` (M1); a restated level that moves nothing writes no row (M2); only a job STATED as a
   one-shot is due (M3); the turn names its one-shot only when exactly one came due (M4); the
   handle asks for a restate after a provider turn (M5), and only for a level holding a one-shot
   (M6).
 * ⚑ **M7–M12 are F035's window**: the `left` lookup and its one-level reach (M7, M8), its carry
   across a slab release (M9), the named line shown in normal mode (M10), kept by the reading
   export (M11), and marked by the fold at all (M12).
 * ⚑ **M13–M22 are D-034's forest** (`runtime-host.ts`'s `theWholeForest`): the loop guard (M13),
   the end of the chain not one hop (M14), the map gathering not overwriting (M15), the
   once-per-read map not the per-row derivation (M16), the drawn check (M17), the two fills
   (M18, M19), and three ways a conversation names itself (M20–M22).

## ⛔ What this table does not contain

 * ⚠️ F035's window wording — "Woken by…", the day form, `scheduleLine`'s quoting and clipping,
   the `describe-event` line: words.
 * ⚠️ D-034 row 8, the store's `Omit` of `standsInFor`/`inItsPlace` in `ForestedConversation`
   (`session-store.ts`): a type only. esbuild erases it, so no vitest case can kill it; only
   `tsc` does.
 * ⚠️ D-034 M16's cost half (O(rows × replacements) per read): no test measures it; only its
   loop half is killed.
 * ⚠️ The constructor's load of `replacedBy` from the store, which the restart cases also kill:
   F071's / D-017's line, not 8bf333ba's.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STATE = "apps/desktop/src/shared/agent-state.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CRONS = "packages/runtime/src/claude/session-crons.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
WINDOW = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"
EXPORT = "apps/desktop/src/renderer/src/lib/readable-export.ts"

FIRED = "a-one-shot-that-fired-leaves-the-schedule-as-its-turn-begins.test.ts"
RESTATE = "a-level-is-said-again-after-a-turn-its-provider-began.test.ts"
PUTBACK = "a-job-put-back-keeps-its-first-listing.test.ts"
WOKE = "a-turn-a-scheduled-job-woke-says-which-job.test.ts"
FOREST = "the-forest-says-whose-place-a-replaced-conversation-stands-in.test.ts"
CHAIN = "a-chain-a-restart-and-a-hand-edited-loop-say-whose-place-each-stands-in.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── F035 · 29419fcb ───────────────────────────────────────────────────────────────────────
    # RETIREMENT APPROVED — 3015 M1: anchor-absent; removed by 7767d7951f43feac990c4cb4b08a9d46263a738a.
    # The inferred oneShotsThatCameDue/letGoOfWhatCameDue flow and its status-versus-provider_turn
    # placement were removed. The replacement planner records confirmed fire/cancellation receipts and
    # emits listing changes from evidence. A confirmed correlated fire now removes a one-shot, tested in
    # schedule-receipts-clean-room.test.ts; there is no old let-go-at-working operation to move earlier.
    # Definition retained as historical evidence; no row execution.
    (
        "M1 · 🔴 the fired one-shot leaves the level at `provider_turn`, so the app's level row lands "
        f"between the turn row and its `working` · killed by `{FIRED}`",
        [(HOST,
          "    const letGo = event.type === 'status' ? this.letGoOfWhatCameDue(session, event.state) : null\n",
          "    const letGo = event.type === 'provider_turn' ? this.letGoOfWhatCameDue(session, 'working') : null\n")],
    ),
    # RETIREMENT APPROVED — 3015 M2: anchor-absent; removed by 82cf5886a3024342ad02692c8b0bf5ea7d048b9e.
    # The restated schedule flag, itsLevelAlready guard and its special turn-restatement path were
    # deliberately removed, as already approved for 3015 M5/M6. Provider listings and receipt-driven
    # currentListing updates replace this mechanism. Mutating generic listing suppression would no longer
    # resurrect a restated provider-turn level. Definition retained as historical evidence; no row
    # execution.
    (
        "M2 · a restated level that moves nothing writes a ledger row on every provider turn · "
        f"killed by `{FIRED}`",
        [(HOST,
          "      if (itsLevelAlready(event.jobs, event.dropped, session.scheduled)) return\n",
          "      if (itsLevelAlready(event.jobs, event.dropped, session.scheduled)) void 0\n")],
    ),
    (
        "M3 · 🔴 a job whose kind the provider did not state is taken out as a fired one-shot · "
        f"killed by `{FIRED}`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 moved removal to independently correlated fire receipts. Keep correlation and creation proof, but classify an unknown recurring kind as a fired one-shot, the original explicit-kind defect.
            ("apps/desktop/src/shared/schedule-receipts.ts", "          if (g.input.recurring === false) g.presence = 'fired'", "          if (g.input.recurring !== true) g.presence = 'fired'"),
        ],
    ),
    # RETIREMENT APPROVED — 3015 M4: anchor-absent; removed by 7767d7951f43feac990c4cb4b08a9d46263a738a.
    # The code guessed which one-shot a provider turn represented only when exactly one was due; that
    # inference and first-of-several destructuring were removed. Current fire evidence identifies its job
    # by correlated target, retaining nominal/actual history. Mutating correlation ambiguity would not
    # preserve the old clock-only first-due guess. Definition retained as historical evidence; no row
    # execution.
    (
        "M4 · the turn names the first of several one-shots that came due · killed by "
        f"`{FIRED}`",
        [(HOST,
          "    if (only === undefined || more.length > 0) return event\n",
          "    if (only === undefined) return event\n")],
    ),
    # RETIREMENT APPROVED — 3015 M5: anchor-absent; removed by 82cf5886a. instantOfLocal and the fired-
    # one-shot level-restatement mechanism were removed, along with the restatement test. Scheduling now
    # keeps a start per repeating-job run and derives run evidence without that restate; SessionCrons
    # emits changes only. No repeated-wall-time inverse solver or restate flag remains. Definition
    # retained as historical evidence; no row execution.
    (
        "M5 · 🔴 the handle never asks for a restate, so the change gate swallows the provider's "
        f"correcting Stop level · killed by `{RESTATE}`",
        [(CLAUDE,
          "    if (event.type === 'provider_turn') this.aProviderTurnSinceTheLastStop = true\n",
          "    if (event.type === 'provider_turn') this.aProviderTurnSinceTheLastStop = false\n")],
    ),
    # RETIREMENT APPROVED — 3015 M6: anchor-absent; removed by 82cf5886a. instantOfLocal and the fired-
    # one-shot level-restatement mechanism were removed, along with the restatement test. Scheduling now
    # keeps a start per repeating-job run and derives run evidence without that restate; SessionCrons
    # emits changes only. No repeated-wall-time inverse solver or restate flag remains. Definition
    # retained as historical evidence; no row execution.
    (
        "M6 · a level of recurring jobs only is said again on every restate · killed by "
        f"`{RESTATE}`",
        [(CRONS,
          "    const restated = restate && this.publishedAOneShot && fingerprint === this.published\n",
          "    const restated = restate && fingerprint === this.published\n")],
    ),
    # ── F035's window · 9c566be7 ──────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 a job put back takes the restate row's moment, not its first listing — a passed "
        f"one-shot is promised a year away · killed by `{PUTBACK}`",
        [(TRANSCRIPT,
          "  const since = (before.jobs.find(listed) ?? before.left.find(listed))?.listedSince ?? at\n",
          "  const since = before.jobs.find(listed)?.listedSince ?? at\n")],
    ),
    (
        "M8 · `left` accumulates every level's drop, reaching back without bound · killed by "
        f"`{PUTBACK}`",
        [(TRANSCRIPT,
          "          left: before.jobs.filter((one) => !jobs.some((job) => job.id === one.id)),\n",
          "          left: [...before.left, ...before.jobs.filter((one) => !jobs.some((job) => job.id === one.id))],\n")],
    ),
    (
        "M9 · the carry forgets `left` across a slab release · killed by "
        f"`{PUTBACK}`",
        [(WINDOW,
          "      left: [...state.schedule.left],\n",
          "      left: [],\n")],
    ),
    (
        "M10 · 🔴 the line naming the job that woke a turn is hidden in normal mode · killed by "
        f"`{WOKE}`",
        [(MODE,
          "      return mode === 'debug' || item.level !== 'info' || item.wokenByAJob === true\n",
          "      return mode === 'debug' || item.level !== 'info'\n")],
    ),
    (
        "M11 · the reading export drops the named line · killed by "
        f"`{WOKE}`",
        [(EXPORT,
          "      return item.level === 'info' && item.wokenByAJob !== true\n",
          "      return item.level === 'info'\n")],
    ),
    (
        "M12 · the fold stops marking the named line, so it is hidden in normal mode and the export "
        f"· killed by `{WOKE}`",
        [(TRANSCRIPT,
          "          wokenByAJob: true,\n",
          "")],
    ),
    # ── D-034 · 8bf333ba ──────────────────────────────────────────────────────────────────────
    (
        "M13 · 🔴 **the loop guard is gone** · a hand-edited loop names a stand-in, so a window hides "
        f"a whole cycle behind itself · killed by `{CHAIN}`",
        [(HOST,
          "      return now === conversation || this.replacedBy.has(now) ? null : now\n",
          "      return now === conversation ? null : now\n")],
    ),
    (
        "M14 · 🔴 one hop, not the end of the chain: the first link names nothing, and the end "
        f"stands in for the last link only · killed by `{CHAIN}`",
        [(HOST,
          "      const now = this.theOneInItsPlace(conversation)\n",
          "      const now = this.replacedBy.get(conversation) ?? conversation\n")],
    ),
    (
        "M15 · the stand-in map overwrites instead of gathering: the end of a chain stands in for "
        f"one link, and the other is hidden on the Graph · killed by `{CHAIN}`",
        [(HOST,
          "      if (now !== null) standsInFor.set(now, [...(standsInFor.get(now) ?? []), named(old)])\n",
          "      if (now !== null) standsInFor.set(now, [named(old)])\n")],
    ),
    (
        "M16 · the pre-review per-row derivation, with no loop guard: each member of a hand-edited "
        f"loop stands in for the one 64 hops behind it · killed by `{CHAIN}`",
        [(HOST,
          "                standsInFor: standsInFor.get(row.conversation) ?? [],\n",
          "                standsInFor: this.theOnesItTookThePlaceOf(row.conversation).map(named),\n")],
    ),
    (
        "M17 · the drawn check always says drawn, so the window looks up a node that is not in "
        f"`nodes` · killed by `{FOREST}`",
        [(HOST,
          "      drawn.has(conversation)\n",
          "      true\n")],
    ),
    (
        "M18 · 🔴 no stand-in names whose place it stands in, so the window draws both side by side "
        f"(D-034's symptom) · killed by `{FOREST}` and `{CHAIN}`",
        [(HOST,
          "                standsInFor: standsInFor.get(row.conversation) ?? [],\n",
          "                standsInFor: [],\n")],
    ),
    (
        "M19 · 🔴 a replaced conversation never names its stand-in, so the window cannot hide it or "
        f"re-hang its piece · killed by `{FOREST}` and `{CHAIN}`",
        [(HOST,
          "                inItsPlace: inItsPlace(row.conversation),\n",
          "                inItsPlace: null,\n")],
    ),
    (
        "M20 · a conversation nobody replaced names itself as the one in its place · killed by "
        f"`{FOREST}`",
        [(HOST,
          "      return now === conversation || this.replacedBy.has(now) ? null : now\n",
          "      return this.replacedBy.has(now) ? null : now\n")],
    ),
    (
        "M21 · the stand-in names itself instead of the one it replaced · killed by "
        f"`{FOREST}`",
        [(HOST,
          "      if (now !== null) standsInFor.set(now, [...(standsInFor.get(now) ?? []), named(old)])\n",
          "      if (now !== null) standsInFor.set(now, [...(standsInFor.get(now) ?? []), named(now)])\n")],
    ),
    (
        "M22 · a replaced conversation names itself as the one in its place · killed by "
        f"`{FOREST}` and `{CHAIN}`",
        [(HOST,
          "      return now === null ? null : named(now)\n",
          "      return now === null ? null : named(conversation)\n")],
    ),
]
