"""606 · Home is two destinations, not one.

⛔ **`EXT-008` §3, ordered by `EXT-009` §2**: ⚑ ***Waiting on you*** **and** ***While you were
away*** **are separate destinations.** 🔴 **They are not two views of one thing** — one is what he
owes, one is what changed — ⚠️ **and `HO-025` §2 is the rule underneath:** *a digest is WINDOWED;
the queue is COMPLETE regardless of age.*

## 🔴 The property every row here is pointed at

⛔ **A single destination holding both would have to pick one of those two properties and be wrong
about the other**, and a single BADGE over both would be bounded by neither. ⚑ So the split is not
cosmetic and the table is not about layout: it is about **which population each surface counts, and
what each surface says it is bounded by.**

## ⚑ Five claims, and a table pushed on one would pass a repair that traded another

 1. **Both places are REACHABLE and RESERVED** (M1–M4). ⛔ An unreserved word is read as a project
    id — the trap `useSurface.ts` writes down four lines above its own list.
 2. **One rail, ONE count** (M5–M6). ⚑ `EXT-008` §5 keeps counts off the rail and the mockup badges
    *Waiting on you* alone; the windowed count is on its own page, which is what makes `HO-025` §2
    structural rather than a convention.
 3. **The poll follows the CARD** (M7–M8). 🔴 **This is the one a reader should look at first.**
 4. **Each surface counts what it DRAWS** (M9–M12). ⛔ `304`, which the split could have
    re-created rather than removed.
 5. **The marks and the bounds** (M13–M17). ⚠️ §3.2: the `soon` mark comes off only what was
    wired, and a destination states what it is bounded by.

## 🔴 The one a reader should look at first

⛔ **M7 is the defect this dispatch actually shipped in its own drop and caught with a test.** ⚑ It
leaves `distil()` gated on `surface.value !== 'home'` — **a real surface, a compiling file, no
error anywhere** — and the digest simply never reads on the page that draws it. ⚠️ That is rule
`27.1` in one line: *a guard scoped by where things live today is a guard with an expiry date, and
it expires silently.*

## ⛔ What this table does NOT cover, said out loud

 1. **What `homeAttention` or the digest COMPUTE.** ⚑ `606` §4 scopes both out; `scripts/mutations/
    305`, `403`, `434`, `453` and `468` own the first and `438`/`466` own the second.
 2. **The demo seed's numbers and the project rows.** ⛔ §4 again, and `195` H3 is what touching
    them cost.
 3. **`PersonsQueue`'s own rows and sentences** — `401`, `403` and `533` own them, and four of
    their anchors were CORRECTED IN PLACE by this dispatch rather than retired.
 4. **`homeAttention.headline`.** ⚠️ Nothing draws it after the split and its live arm is about a
    catch-up across projects, which is the OTHER destination. ⛔ Reported as a finding; a row here
    would pin a line no surface reads.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1–M4 | `apps/desktop/test/home-is-two-destinations.test.ts` §1 · reserved, routed, railed, palettable |
| M5–M6 | `…home-is-two-destinations.test.ts` §2 and `…dom/home-is-two-destinations.dom.test.ts` §1 |
| M7–M8 | `…home-is-two-destinations.test.ts` §3 · the gate derived from the routing |
| M9–M10 | `…dom/home-agrees.dom.test.ts` · `304`'s own file, now across two screens |
| M11–M12 | `…dom/home-is-two-destinations.dom.test.ts` §2 · each page paints one population |
| M13–M15 | `…home-is-two-destinations.test.ts` §4 · the marks |
| M16–M17 | `…dom/home-is-two-destinations.dom.test.ts` §2 · the bounds, where a person reads them |

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun` and no verdict is claimed here. ⚑ **17 of 17 are
RED, and each was checked for the RIGHT reason**: the output was searched for `SyntaxError`,
`Transform failed` and `error TS`, because a row red on a parse error measured nothing (`452 M8`).
"""

SURFACE = "apps/desktop/src/renderer/src/composables/useSurface.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
PALETTE = "apps/desktop/src/renderer/src/lib/command-palette.ts"
WAITING = "apps/desktop/src/renderer/src/components/WaitingOnYou.vue"
AWAY = "apps/desktop/src/renderer/src/components/WhileYouWereAway.vue"
ACTIVITY_PAGE = "apps/desktop/src/renderer/src/components/RecentActivity.vue"
HOME = "apps/desktop/src/renderer/src/components/HomeSurface.vue"
DIGEST = "apps/desktop/src/renderer/src/lib/digest.ts"

MUTATIONS = [
    # ── §1 · reachable, and reserved ───────────────────────────────────────────────────────────
    (
        "M1 · ⛔ `waiting` leaves `RESERVED_PLACES` · the word is read as a project id, so the rail's own destination opens `ProjectWorkspace` looking for a project called *waiting* — ⚡ the trap `useSurface.ts` writes down four lines above its own list, and `566 M17` is the same row one destination over",
        [(SURFACE, "  'waiting',\n", "")],
    ),
    (
        "M2 · ⛔ …and the same for `away` · ⚑ SEPARATE from M1 because a fix that reserved one and forgot the other is exactly the shape this pair exists to catch — one commit added two words and a census that asserted only the first would pass it",
        [(SURFACE, "  'away',\n", "")],
    ),
    (
        "M3 · 🔴 the digest's destination is routed on HOME · both `v-else-if`s name one surface, so `EXT-008` §3's split is undone in one line while every component, place and rail row still exists. ⛔ A person pressing *While you were away* lands nowhere",
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the page on `away` is Recent activity now; the plant still routes it on another place
        [(SCREEN, "  <RecentActivity\n            v-else-if=\"surface === 'away'\"", "  <RecentActivity\n            v-else-if=\"surface === 'home'\"")],
    ),
    (
        "M4 · ⚠️ `⌘K` loses the queue · the palette row goes, so the one place a person searches by name cannot take them to the destination that holds everything they owe. ⛔ `570` is what a screen nothing reaches costs",
        [(PALETTE, "    action: { kind: 'go', place: 'waiting' },", "    action: { kind: 'go', place: 'home' },")],
    ),
    # ── §2 · one rail, one count ───────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 THE FOLD `HO-025` §2 FORBIDS · the windowed row gains the COMPLETE count, so one rail draws the same number twice and the second is about a population that row does not open. ⛔ `304`'s contradiction with the two halves swapped, and `EXT-008` §5 forbids the badge outright",
        [(RAIL, "          <svg class=\"icon\"><use href=\"#i-activity\" /></svg>\n          <span class=\"rail-copy\">\n            <strong>Recent activity</strong>\n          </span>\n",
                "          <svg class=\"icon\"><use href=\"#i-activity\" /></svg>\n          <span class=\"rail-copy\">\n            <strong>Recent activity</strong>\n          </span>\n          <span v-if=\"homeCount > 0\" class=\"count badge\" data-cy=\"away-badge\">\n            {{ homeCount }}\n          </span>\n")],
    ),
    (
        "M6 · ⛔ zero is drawn as a badge · `009`'s rule inverted — a `0` on the rail is a mark that says nothing, and the honest report of nothing waiting is the absence of the mark. ⚑ On a fresh install every row would carry one",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule that zero draws
        # no badge on the Waiting rail row survives, but the guard was renamed from `homeCount > 0`
        # to `waitingCount > 0` in SideRail.vue. The plant makes it `>= 0`, so a 0 is drawn.
        [
            (RAIL, '<span v-if="waitingCount > 0" class="count badge" data-cy="waiting-badge">', '<span v-if="waitingCount >= 0" class="count badge" data-cy="waiting-badge">'),
        ],
    ),
    # ── §3 · the poll follows the card ─────────────────────────────────────────────────────────
    (
        "M7 · 🔴 **THE DEFECT THIS DISPATCH SHIPPED IN ITS OWN DROP** · the digest's poll stays gated on `home`. ⛔ `home` is a real surface, the file compiles, nothing throws — and the one page that draws the digest never reads it. ⚑ Rule `27.1` in a line: *a guard scoped by where things live today expires silently*",
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the read for the page on `away` is Recent activity's now; the plant still gates it on another place
        # ⚑ **Recent activity reads one page per call · re-anchored in place, not retired** — each call reads one page now; the plant still gates Recent activity's read on another place
        [(SCREEN, "  if (surface.value === 'away') return readPage()", "  if (surface.value === 'home') return readPage()")],
    ),
    (
        "M8 · ⚠️ arriving no longer re-derives · the interval still fires, so the page is right within `DISTIL_EVERY_MS` and wrong for up to thirty seconds after a person opens it — ⛔ with nothing on screen saying which",
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — arriving reads Recent activity again now; the plant still stops it reading on arrival
        [(SCREEN, "  if (now === 'away' || now === 'waiting') void readActivity()", "  if (now === 'home' || now === 'waiting') void readActivity()")],
    ),
    # ── §4 · each surface counts what it draws ─────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** HomeSurface.vue, the placeholder
        # screen that drew the four seeded decisions and their count, was deleted (count_now -1).
        # Home and the demo seed were removed on purpose, so nothing is left for a stat to disagree
        # with. Its anchor is left stale, so the census records it retired.
        "M9 · 🔴 `304`, RE-CREATED BY THE SPLIT · the placeholder screen's stat reads the queue's word instead of its own rows, so a dashboard drawing four seeded decisions says *All clear* above them. ⛔ `468` is why: a placeholder nothing can clear is not work, so `homeAttention`'s sum is zero here",
        [(HOME, '<strong data-cy="home-decisions">{{ rows.length }}</strong>',
                '<strong data-cy="home-decisions">{{ rows.length === 0 ? \'All clear\' : \'All clear\' }}</strong>')],
    ),
    (
        # The seeded Home and group count are gone. Retain this absent anchor recorded as retired.
        "M10 · ⛔ the seeded group stops declaring itself · the rows stay, the chip stays, and the attribute every disclosure census reads goes — ⚑ `118`'s rule: an unwired surface says so whether or not it has anything in it",
        [(HOME, '<div class="group-label" data-wired="false" data-cy="seeded-group">',
                '<div class="group-label" data-cy="seeded-group">')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants demo-seed rows into
        # `homeAttention` so the placeholder clause returns. The demo seed and its renderer fixtures
        # were removed, `homeAttention` no longer takes an `attention` (seeded rows) input, and
        # `attention: [],` no longer exists in WaitingOnYou.vue. There is no placeholder clause left
        # to resurrect. Its anchor is left stale, so the census records it retired.
        "M11 · 🔴 the placeholder clause comes back on a screen with no placeholders · `homeAttention` is handed the demo seed's rows by a surface that draws none of them, so the queue's introduction ends *The 4 project decisions below are seeded placeholders* over a page that has none. ⛔ `304` pointing the other way",
        [(WAITING, "    attention: [],\n", "    attention: [{}, {}, {}, {}] as never,\n")],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** While you were away and the digest view are deleted; Recent activity replaces them.
        "M12 · ⚠️ the windowed count counts what the card REFUSED to draw · `withheld` lines are added back, so the number a person reads includes rows this app would not label — ⛔ and `DigestProject.withheld` exists precisely because those are never swallowed",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule that the
        # windowed count counts what the card draws and never the withheld lines survives. The
        # digest is now one window, so `whatChanged` is `return view.lines.length` instead of a
        # reduce over `view.projects`, and `DigestView.withheld` still exists. The plant adds
        # `view.withheld` back.
        [
            (DIGEST, '  return view.lines.length', '  return view.lines.length + view.withheld'),
        ],
    ),
    # ── §5 · the marks and the bounds ──────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row puts back the `soon` mark on
        # the Home rail row. That row was removed (the test comment in
        # home-is-two-destinations.dom.test.ts says 'D-016 took the Home row that stood below
        # them'), and SideRail.vue has no `not-wired` or `soon` mark left. SoonChip.vue was deleted
        # too. Its anchor is left stale, so the census records it retired.
        "M13 · 🔴 §3.2's DEFECT, PUT BACK · the `soon` mark comes off Home while everything behind it is still the demo seed. ⛔ `front-door-words.ts` names it: *nothing unwired implies a working state* — and `606` wired nothing on this screen, it took two real things OFF it",
        [(RAIL, '          <span class="not-wired">soon</span>\n', "")],
    ),
    (
        "M14 · ⚠️ …and the same error facing the other way · the queue's own destination is marked unwired, so a page on which every row is a real pending request tells a person it does not work yet. ⛔ A mark is a claim in both directions",
        [(WAITING, '    data-wired="true"\n', '    data-wired="false"\n')],
    ),
    (
        "M15 · ⚠️ …and on the digest's destination · `438` took the digest out of the demo seed and it reads the ledger with its own provenance on every line, so this mark would call a real reading a placeholder — ⛔ `302`'s defect with the noun pointing the other way",
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the destination is Recent activity now, with the same wired mark; the plant still calls it a placeholder.
        [(ACTIVITY_PAGE, "    data-wired=\"true\"\n", "    data-wired=\"false\"\n")],
    ),
    (
        "M16 · 🔴 the COMPLETE list stops saying it is complete · the one sentence that distinguishes this destination from its neighbour goes, and a person is left with two lists and no way to tell which is bounded by what. ⛔ `HO-025` §2 is the whole reason there are two",
        [(WAITING, "      <p class=\"page-bound\" data-cy=\"waiting-bound\">\n        Everything still open, however old. This list is not windowed.\n      </p>\n", "")],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** While you were away and the digest view are deleted; Recent activity replaces them.
        "M17 · 🔴 THE CLAIM `430` REFUSES, WITH NOTHING CORRECTING IT · the window sentence under *While you were away* becomes a coverage claim this app cannot make. ⛔ `430` searched `last_seen`, `last_read`, `read_cursor`, `seen_at`, `viewed_at` and a digest cursor and found no durable per-person last-view marker — ⚑ which is why the heading is a PLACE name and the line under it states the window",
        [(AWAY, "              : `What changed in ${props.digest.windowWords}. Older than that is not on this page.`",
                "              : `Everything that happened while you were away.`")],
    ),
]
