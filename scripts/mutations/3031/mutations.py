"""3031 · 3d1eb064 · the launch line names the starter by the piece it started this conversation from.

⚑ ``giveWork`` raises ``reservingAStartFrom`` to the giver's own piece for its create's synchronous
stretch, so the new conversation's first launch — composed before the give is written down — names
its starter by that piece (``SessionSlot.startedFrom``); it is lowered straight after, so no later
launch inherits it.

## ⚑ What a row here measures

 * ⚑ **M1 is the raise**: without it, the first launch from a give names its starter by nothing the
   give said.
 * ⚑ **M2 is the lowering**: left raised, a replacement's launch — which names its starter alone —
   names it by the last give's piece.

## ⛔ What this table does not contain

 * ⚠️ ``thePieceItWasStartedFrom``'s fallback chain is ``whoStartedIt``'s, already measured by the
   record's own tables; ``theStarterCalled`` on a resume is the devs' §8 case.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

CHILD = "the-text-a-child-is-actually-told.test.ts"
REPLACED = "a-replacement-after-a-give-names-its-starter-alone.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a give's first launch is not told the piece it starts from — the child names its "
        f"giver by none · killed by `{CHILD}`",
        [(HOST,
          "    this.reservingAStartFrom = giving.parent\n",
          "    this.reservingAStartFrom = null\n")],
    ),
    (
        "M2 · ⛔ the piece a give starts from is never lowered — a later replacement names its starter "
        f"by that give's piece · killed by `{REPLACED}`",
        [(HOST,
          # Leaving the previous give's piece raised changes a later replacement's launch line.
          "      const starting = this.createFromGive(start, startsOn)\n      this.reservingAStartFrom = null\n      this.reservingNormalWorker = null\n",
          "      const starting = this.createFromGive(start, startsOn)\n      this.reservingNormalWorker = null\n")],
    ),
]
