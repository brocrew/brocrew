"""314 · Two gates, and a symlink — what the suite would notice if each finding came back.

# The findings this table exists to protect

⛔ **Codex memory is TWO gates, and 312 measured that the second is the one nobody guesses.**
`[features] memories = true` alone injects the memory summary and starts the background pipeline —
and exposes **no tools at all**, because `[memories] dedicated_tools` defaults FALSE. So a profile
could have memory genuinely switched on and no way to read or write it. `use_memories` is the WHOLE
surface (false removes the summary and all four tools) and `generate_memories` decides only whether
a new thread may feed the background extractor — it does **not** hide `add_ad_hoc_note`.

⛔ **And the file the gates live in is one Codex also writes.** 312 measured both obvious approaches
failing: a SECOND `[features]` table is a hard `-32600` *"duplicate key"* — not last-one-wins — and
rewriting the file whole deleted an unrelated `apps = true` and Codex's own `[projects."…"]
trust_level`, of which the next launch re-added only the current cwd's. The only measurable safe
operation is an in-place merge that preserves every other entry.

🔴 **The third finding is a memory that lives in `/tmp`.** 312 measured a real Claude child FOLLOWING
a `memory/MEMORY.md` symlink out of the provider home and answering from the target. 170 §2 already
ruled that BroBot follows what the provider follows and DISCLOSES it — and that disclosure only
exists while the target still reads. When a `/tmp` target disappears at the next reboot the read is
ENOENT, `absent` is deliberately silent, and the panel says nothing at all about a profile that had
a memory yesterday and does not now.

# The groups

* **M1-M5 · the four keys.** Each gate closed in turn, and one row that removes a key from the table
  altogether — the row that shows the disclosure binding is not a substitute for the child.
* **M6-M9 · the merge that must not rewrite.** The idempotence check, the in-place merge itself, and
  the two halves of the verification that hold a line scanner to what a real parser says.
* **M10-M13 · putting it on disk.** The last-look before the rename, the staging cleanup, the file's
  own mode, and unreadable-is-not-absent.
* **M14-M17 · every home, every launch.** The three call sites, and the ordering inside one of them.
* **M18-M21 · the disclosure** (`308`'s shape, applied to the Codex half for the first time).
* **M22-M27 · the link that leads nowhere** (§3), in the main process and on the panel.
* **M28-M29 · found reviewing this diff**, not by a report: a WORKING redirect announced as a
  loss, and a zero-byte config merged into as though it were an existing document.

# ⚠️ What this table cannot reach

⛔ **The live smoke, which is the only thing that proves a TOOL exists.**
`packages/runtime/smoke/codex-memory-config.smoke.ts` is executed by no vitest project — the smoke
config is a separate one, excluded from `pnpm run ci` — so **no row below can redden on it**. That
matters more here than usual: 312 measured Codex's TOML parser silently accepting
`[memories] not_a_real_field = true`, so every green cell in this table is a statement about the
FILE and never about the child's inventory. The child is proved once, by hand, and the run is
recorded in the response.

⛔ **A key name that is wrong but well-formed is only caught because a unit test spells the four out.**
There is no mechanism here that would notice `dedicated_tool`; `codex-memory-config.test.ts`'s exact
`toEqual` is. That is a fixture in the sense 301 means, and it is the honest limit of the file-level
half.

⛔ **The `raced` window itself.** M10 breaks the guard and a test kills it through the
`beforePublish` seam — but the seam is a test seam. Nothing here measures the real interleaving with
a Codex process appending a trust entry; the probe run in the response is where that shape was
observed live (the child appended its own `[projects."…"]` entry AFTER the merge, in the capture).

# ⛔ NOT MEASURED

**Not one row below was applied.** They were verified to apply exactly once (`mutations.py
--dry-run .`) after prettier had formatted the tree — a step 296 learned the hard way, because
formatting moves anchors — and `mutate.sh` on an idle machine is what finishes the job. Every
predicted cell is written `EXPECTED (NOT MEASURED)` so nothing here reads as a figure somebody took.

⚑ **M9 is recorded as an EXPECTED SURVIVOR rather than left for somebody to discover.** It disables
the symmetric half of the verification — *no new leaf appeared* — and no construction in the suite
reaches it today: every route that could add a leaf also changes or drops one, which M8 covers. It
is kept in the code because it costs one loop and it is the half that would matter first if the
scanner ever learned to insert a table.

⚠️ Like the tables before it, this one does NOT mutate the harness it is run by.

⚑ **Three anchors of OTHER tables went stale on this dispatch's edits and were corrected IN PLACE,
never retired** (142): `170 M6`, `170 M7` and `188 M1`. ⛔ **`170 M7`'s PREMISE was overturned** — a
dangling link is disclosed on purpose now — so its row was re-aimed at the half that stayed (an
absence must remain silent) and the reversal is written into 170's own table beside it, rather than
being quietly rewritten. `pnpm run mutations:check` is what says no other anchor moved.
"""

from pathlib import Path

MEM = "packages/runtime/src/codex/memory-config.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"
DISCLOSURE = "apps/desktop/src/main/runtime/provider-config.ts"
INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
# ⚑ F093 · the refusal words moved out of the panel into one table both surfaces read.
REFUSALS = "apps/desktop/src/renderer/src/lib/refusal-words.ts"

# The launch prologue, quoted whole so M17 can reorder it without touching anything else. 188 M1
# anchors on this block plus the attestation line below it; the two rows never run together.
# ⚑ **the launch settings are recorded · re-anchored in place, NOT VERIFIED and HELD (its killer reads provider-home code, where no mutant runs without a written lift)** — a start now keeps what the memory write answered, for its launch settings, so the write's line names that; the row's edit and claim are unchanged
LAUNCH_SWEEP_THEN_GATES = (
    "    removeStaleCodexPermissionConfig(opts.providerHome)\n"
    "    // ⛔ **The two gates, on EVERY launch and not only on provisioning** (314). A profile created\n"
    "    // before this existed has no memory config at all, and there is no migration hook — so the only\n"
    "    // place that reaches every home is the place the 157 migration above already stands.\n"
    "    //\n"
    "    // ⚠️ **Below the stale sweep and above the attestation**, and both halves of that ordering are\n"
    "    // load-bearing: merging into a file the line above is about to delete would be work thrown away,\n"
    "    // and `assertCodexSqliteHomeContained` parses this very file, so it must see the bytes the child\n"
    "    // will. ⚑ It never throws — see {@link ensureCodexMemoryConfig}; a home whose config cannot be\n"
    "    // merged launches without memory rather than not launching.\n"
    "    const memoryConfig = ensureCodexMemoryConfig(opts.providerHome)\n"
)

MUTATIONS = [
    # ── §1 · the four keys ────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the TOOL gate closes, so every Codex profile has memory "
        "switched on, a summary injected, a background pipeline running — and no way for the agent "
        "to read or write any of it. 312's feature-only arm, shipped "
        "· EXPECTED (NOT MEASURED): runtime red (codex-memory-config), desktop red (disclosure), "
        "dom GREEN",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-memory-settings.ts",
                "    key: 'dedicated_tools',\n    value: true,\n",
                "    key: 'dedicated_tools',\n    value: false,\n",
            )
        ],
    ),
    (
        "M2 · ⛔ the FEATURE gate closes, so there is no memory at all — the state every profile was "
        "in before this dispatch, and the one friction log F2 is about "
        "· EXPECTED (NOT MEASURED): runtime red, desktop red, dom GREEN",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-memory-settings.ts",
                "    table: 'features',\n    key: 'memories',\n    value: true,\n",
                "    table: 'features',\n    key: 'memories',\n    value: false,\n",
            )
        ],
    ),
    (
        "M3 · ⛔ `use_memories` goes false — the WHOLE surface, which 312 measured removing summary "
        "injection AND all four tools even with `dedicated_tools = true`. The subtlest of the four, "
        "because the other three still look right in the file "
        "· EXPECTED (NOT MEASURED): runtime red, desktop red, dom GREEN",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-memory-settings.ts",
                "    key: 'use_memories',\n    value: true,\n",
                "    key: 'use_memories',\n    value: false,\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ `generate_memories` goes false, so a new conversation is never eligible for "
        "background extraction — the profile can still be TOLD things and never learns anything on "
        "its own (312: `memory_mode=\"disabled\"` in `state_5.sqlite`) "
        "· EXPECTED (NOT MEASURED): runtime red, desktop red, dom GREEN",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-memory-settings.ts",
                "    key: 'generate_memories',\n    value: true,\n",
                "    key: 'generate_memories',\n    value: false,\n",
            )
        ],
    ),
    (
        "M5 · 🔴 a key is dropped from the TABLE, so the writer stops writing it and the disclosure "
        "stops naming it — and they AGREE. ⛔ The row that shows a two-way binding between prose and "
        "code cannot notice a capability going missing; only a test that spells the four keys out "
        "can · EXPECTED (NOT MEASURED): runtime 2 red (the exact-positive assertions), desktop GREEN "
        "— ⚠️ that desktop GREEN is the finding, not an omission",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-memory-settings.ts",
                "  {\n    table: 'memories',\n    key: 'use_memories',\n    value: true,\n    why: 'the whole surface; false removes the memory summary and all four tools',\n  },\n",
                "",
            )
        ],
    ),
    # ── §2 · the merge that must not rewrite ──────────────────────────────────
    (
        "M6 · ⛔ the idempotence check inverts, so a home whose gates are already right is the only "
        "one written to and a home that needs them is left alone — memory never switches on, and the "
        "file churns forever on the homes that were fine "
        "· EXPECTED (NOT MEASURED): runtime red, desktop red, dom GREEN",
        [
            (
                MEM,
                "    (setting) => currentValue(before, setting) !== setting.value,\n",
                "    (setting) => currentValue(before, setting) === setting.value,\n",
            )
        ],
    ),
    (
        "M7 · 🔴 the existing table is never found, so every merge APPENDS a second `[features]` — "
        "312's measured `-32600` *duplicate key*, with stderr *Invalid configuration; using "
        "defaults.* Not last-one-wins: the app-server refuses the config outright "
        "· EXPECTED (NOT MEASURED): runtime red (the merge is refused by its own verification), "
        "desktop red, dom GREEN",
        [
            (
                MEM,
                "    const span = findTable(lines, table)\n",
                "    const span = table === '' ? findTable(lines, table) : null\n",
            )
        ],
    ),
    (
        "M8 · 🔴 the verification checks that a leaf is still PRESENT and stops checking that it is "
        "still EQUAL, so the scanner may rewrite somebody's value as long as it leaves a key of that "
        "name behind — the whole-file-rewrite finding, arrived at one leaf at a time "
        "· EXPECTED (NOT MEASURED): runtime 1 red (the preservation trap), desktop GREEN, dom GREEN",
        [
            (
                MEM,
                "    if (now.get(path) !== value) {\n",
                "    if (!now.has(path)) {\n",
            )
        ],
    ),
    (
        "M9 · ⚑ EXPECTED SURVIVOR · the symmetric half — *no new leaf appeared* — stops being "
        "checked. ⛔ No construction in the suite reaches it: every route that can add a leaf also "
        "changes or drops one, which M8 covers. Recorded as a survivor rather than left to be "
        "discovered · EXPECTED (NOT MEASURED): GREEN everywhere, deliberately",
        [
            (
                MEM,
                "    if (OURS.has(path) || was.has(path)) continue\n",
                "    continue\n",
            )
        ],
    ),
    # ── §3 · putting it on disk ───────────────────────────────────────────────
    (
        "M10 · 🔴 the last look before the rename goes, so a `config.toml` Codex appended a project "
        "trust entry to while we were staging is overwritten by bytes read before it — the exact "
        "loss 312 measured a whole-file rewrite causing, in a window of two syscalls "
        "· EXPECTED (NOT MEASURED): runtime 1 red (the race test), desktop GREEN, dom GREEN",
        [
            (
                MEM,
                "  if (now !== expected) {\n",
                "  if (now === undefined) {\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ a failed or abandoned publish leaves its staging file in the provider home, once "
        "per launch, forever — beside a `config.toml` a person is being told to open by hand "
        "· EXPECTED (NOT MEASURED): runtime 1 red, desktop GREEN, dom GREEN",
        [(MEM, "      unlinkSync(staged)\n", "")],
    ),
    (
        "M12 · ⚠️ the file's own mode is discarded and every merge republishes it 0600 — this file "
        "is Codex's as much as ours, and silently tightening somebody else's permissions on every "
        "launch is a change nobody asked for "
        "· EXPECTED (NOT MEASURED): runtime 1 red, desktop GREEN, dom GREEN",
        [(MEM, "    mode = statSync(path).mode & 0o777\n", "    mode = 0o600\n")],
    ),
    (
        "M13 · 🔴 unreadable collapses into absent, so a config behind a permission wall or a broken "
        "mount is REPLACED with a fresh one carrying only our four keys — 312's whole-file rewrite, "
        "reached by an error path instead of by a decision "
        "· EXPECTED (NOT MEASURED): runtime 1 red, desktop GREEN, dom GREEN",
        [
            (
                MEM,
                "    if (!isAbsent(error)) {\n      // ⚠️ Unreadable is NOT absent. Writing a fresh file over something we could not read would be\n      // the whole-file rewrite 312 measured, chosen by an error path.\n      return { outcome: 'refused', path, why: `config.toml is not readable: ${errorText(error)}` }\n    }\n",
                "",
            )
        ],
    ),
    # ── §4 · every home, every launch ─────────────────────────────────────────
    (
        "M14 · ⛔ a START stops writing the gates, so a profile created before this dispatch stays "
        "broken forever — there is no migration hook, and `provisionProviderHome` has never written "
        "a `config.toml` "
        "· EXPECTED (NOT MEASURED): runtime red (the launch tests), desktop GREEN, dom GREEN",
        # ⚑ **the launch settings are recorded · re-anchored in place, NOT VERIFIED and HELD (its killer reads provider-home code, where no mutant runs without a written lift)** — a start now keeps what the write answered, for its launch settings; the row still stops the write, and the launch then says its memory settings are not known
        [(CODEX, "    const memoryConfig = ensureCodexMemoryConfig(opts.providerHome)\n", "    const memoryConfig = undefined\n")],
    ),
    (
        "M15 · ⛔ a RESUME stops writing them — the path the person's EXISTING conversations actually "
        "arrive by, which is the half that decides whether the fix reaches the profiles the friction "
        "log is about · EXPECTED (NOT MEASURED): runtime 1 red, desktop GREEN, dom GREEN",
        # ⚑ **the launch settings are recorded · re-anchored in place, NOT VERIFIED and HELD (its killer reads provider-home code, where no mutant runs without a written lift)** — a resume now keeps what the write answered, for its launch settings; the row still stops the write
        [(CODEX, "      memoryConfig = ensureCodexMemoryConfig(options.providerHome)\n", "      memoryConfig = undefined as never\n")],
    ),
    (
        "M16 · ⛔ 168 L2's shape, one dispatch later · the PROVISIONING path stops writing them, so a "
        "profile that is only ever adopted into — no start, no resume — is reached by nothing, while "
        "the config block goes on telling its owner that BroBot declares memory in that file "
        "· EXPECTED (NOT MEASURED): desktop red (provider-homes), runtime GREEN, dom GREEN",
        [
            ("apps/desktop/src/main/providers/codex/index.ts", "  ensureCodexMemoryConfig(home)\n", ""),
        ],
    ),
    (
        "M17 · 🔴 the write moves ABOVE the stale sweep, so on a home carrying 157's block we merge "
        "into a file the next line deletes — a migration that reports success, changes nothing, and "
        "leaves the child with memory off "
        "· EXPECTED (NOT MEASURED): runtime red (the ordering assertions), desktop GREEN, dom GREEN",
        [
            (
                CODEX,
                LAUNCH_SWEEP_THEN_GATES,
                "    const memoryConfig = ensureCodexMemoryConfig(opts.providerHome)\n"
                + LAUNCH_SWEEP_THEN_GATES.rsplit("\n    const memoryConfig = ensureCodexMemoryConfig", 1)[0]
                + "\n",
            )
        ],
    ),
    # ── §5 · the disclosure ───────────────────────────────────────────────────
    (
        "M18 · ⛔ 308's defect in the Codex half · the sentence stops being RENDERED from the table "
        "and names two of the four keys by hand, so a user reading where their memory is configured "
        "is told about half of it · EXPECTED (NOT MEASURED): desktop 1 red, runtime GREEN, dom GREEN",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                # ⚠️ **ANCHOR CORRECTED at `605`, and the SUBJECT is untouched** — the row still
                # hard-codes the keys the sentence renders. ⛔ `605` split the clause in two so the
                # tools and the servers could each say whether the app-server remembers them,
                # which moved the wrap this anchor sat on. ⚑ Re-verified RED by hand.
                "  `preferences, and where BroCrew switches this profile's memory on: ${humanList(CODEX_MEMORY_KEYS)} ` +\n",
                "  `preferences, and where BroCrew switches this profile's memory on: features.memories and memories.dedicated_tools ` +\n",
            )
        ],
    ),
    (
        "M19 · ⚠️ the keys lose their table, so the block names `memories`, `dedicated_tools`, "
        "`use_memories` and `generate_memories` — four bare words a person cannot find in a TOML "
        "file, two of which are spelled the same as the table they are not in "
        "· EXPECTED (NOT MEASURED): desktop 1 red, runtime GREEN, dom GREEN",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                "const CODEX_MEMORY_KEYS = CODEX_MEMORY_SETTINGS.map((one) => `${one.table}.${one.key}`)\n",
                "const CODEX_MEMORY_KEYS = CODEX_MEMORY_SETTINGS.map((one) => one.key)\n",
            )
        ],
    ),
    (
        "M20 · ⛔ the file note goes back to *absent means built-in defaults*, which went false the "
        "moment this app started creating the file — a sentence describing a state that no longer "
        "occurs for any profile that has been opened "
        "· EXPECTED (NOT MEASURED): desktop 1 red, runtime GREEN, dom GREEN",
        [
            (
                # This row follows the same behavior after provider facts moved into the registry.
                "packages/shared/src/providers/configuration.ts",
                # ⚑ **provider registry · re-anchored in place, not retired** — The config layout moved into shared data; the same old note hides that the app writes and merges memory settings.
                "      note: 'MCP servers + preferences, and the memory keys above — Codex writes here too, so BroCrew merges and never rewrites it',\n",
                "      note: 'MCP servers + preferences; absent means built-in defaults',\n",
            )
        ],
    ),
    (
        "M21 · ⛔ the whole Codex sentence goes back to what it said before this dispatch, so the "
        "app writes four keys into a file whose disclosure never mentions that it writes anything — "
        "308's finding, in the half 308 said nothing could check "
        "· EXPECTED (NOT MEASURED): desktop 2 red, runtime GREEN, dom GREEN",
        [
            (
                # This row follows the same behavior after provider facts moved into the registry.
                "packages/shared/src/providers/configuration.ts",
                # ⚑ **provider registry · re-anchored in place, not retired** — The config layout moved into shared data; the old summary still omits the memory keys written by the app.
                "  model: CODEX_MODEL_NOTE,\n",
                "  model: 'file-based — config.toml in this home is where MCP servers and preferences are declared',\n",
            )
        ],
    ),
    # ── §6 · the link that leads nowhere ──────────────────────────────────────
    (
        "M22 · 🔴 THE §3 FINDING, verbatim · a broken memory link is silent again, so a profile whose "
        "`MEMORY.md` pointed into `/tmp` loses everything at the next reboot and the panel says "
        "nothing at all — the state one real profile is in, left over from 293 "
        "· EXPECTED (NOT MEASURED): desktop 2 red (instructions), dom GREEN — ⚠️ the DOM row is fed a "
        "constructed payload and cannot reach the main-process decision",
        [(INSTRUCTIONS, "    if (!seen.isSymbolicLink()) continue\n", "    continue\n")],
    ),
    (
        "M23 · ⛔ only the leaf is checked, so a broken link at the `memory/` DIRECTORY is silent — "
        "and that is the shape where the leaf cannot be `lstat`ed at all, because there is no path "
        "to it. 170's `link` field covered both; this would cover one "
        "· EXPECTED (NOT MEASURED): desktop 1 red, runtime GREEN, dom GREEN",
        [
            (
                INSTRUCTIONS,
                "  for (const candidate of [path, dirname(path)]) {\n",
                "  for (const candidate of [path]) {\n",
            )
        ],
    ),
    (
        "M24 · ⚠️ the target is resolved with `realpath` instead of `readlink`, so the one fact worth "
        "printing about a broken link — where it pointed — becomes `(unreadable)` on exactly the "
        "links this row exists for. `realpath` cannot answer for a link that leads nowhere "
        "· EXPECTED (NOT MEASURED): desktop 2 red, runtime GREEN, dom GREEN",
        [
            (
                INSTRUCTIONS,
                "      target = resolve(dirname(candidate), readlinkSync(candidate))\n",
                "      target = resolve(dirname(candidate), realpathSync(candidate))\n",
            )
        ],
    ),
    (
        "M25 · ⛔ the other polarity · the symlink test goes, so an ordinary `memory/` directory with "
        "no index written yet is reported as a broken link — a warning on every profile that has just "
        "started remembering, which is 086 in the direction 170 ruled against "
        "· EXPECTED (NOT MEASURED): desktop 1 red, runtime GREEN, dom GREEN",
        [(INSTRUCTIONS, "    if (!seen.isSymbolicLink()) continue\n", "")],
    ),
    (
        "M26 · ⛔ the panel stops drawing the target, so the row says a link is broken and never says "
        "which one — the user is told their memory is gone and given nothing to go and look at "
        "· EXPECTED (NOT MEASURED): dom 1 red, desktop GREEN, runtime GREEN",
        [(PANEL, '          <span v-if="item.link" class="refused">\n', '          <span v-if="false" class="refused">\n')],
    ),
    (
        "M27 · ⚠️ the reason falls through to the raw word, so the panel prints `· not read: "
        "dangling-link` — naming a reader that declined to act when nothing declined anything, which "
        "is the same wording defect 187 §2 fixed for `over-budget` "
        "· EXPECTED (NOT MEASURED): dom 1 red, desktop GREEN, runtime GREEN",
        [
            (
                REFUSALS,
                "  'dangling-link': 'a link with nothing at the other end — whatever was here is gone',\n",
                "",
            )
        ],
    ),
    # ── §7 · found reviewing this diff, not by a report ───────────────────────
    (
        "M28 · 🔴 a WORKING redirect is reported as a LOSS · the link check stops asking whether the "
        "link leads anywhere, so a `memory/` somebody pointed at another disk on purpose — with no "
        "index written into it yet — is announced as a memory that is gone. ⚑ Found reviewing 314's "
        "own diff: the first draft asked only *is this a symlink* "
        "· EXPECTED (NOT MEASURED): desktop 1 red, runtime GREEN, dom GREEN",
        [(INSTRUCTIONS, "    if (resolves(candidate)) continue\n", "")],
    ),
    (
        "M29 · ⚠️ a zero-byte `config.toml` is treated as an existing document, so the four keys are "
        "merged into it with no provenance block — the file a person is being told to open by hand "
        "arrives with no sentence saying who wrote those keys or that they come back on every "
        "launch. ⚑ Also found reviewing this diff; there was nothing there to preserve "
        "· EXPECTED (NOT MEASURED): runtime 1 red, desktop GREEN, dom GREEN",
        [
            (
                MEM,
                "  const fresh = original.trim() === ''\n",
                "  const fresh = existing === null\n",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found, and 268 §2 found one that had reached a committed table.
        if find == replace:
            print(f"!! {name}: the replacement is identical to the anchor — this row is a no-op")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        edits = sum(len(edits) for _name, edits in MUTATIONS)
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(
            f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} rows apply exactly once ({edits} edit anchors)"
        )
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
