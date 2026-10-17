"""3030 · F096 · usage windows — 76b4410b, 0bd493da, 9089b4fd (dev e86f28e1), and 28085e11.

⚑ **The subject**: each provider's usage, kept per window and across a restart, told to agents,
and warned about at 80%. The host keeps the newest reading per provider AND window
(`takeTheUsage`), writes it to `<userData>/provider-usage.json` and reads it back at the next start
— each row checked, a torn file read as none (`provider-usage-file.ts`, `takeTheKeptUsage`); it
forgets a provider's readings, in the file too, when what the provider runs on changes in this app
or the Mac's sign-in moves (`forgetTheUsage`, `aSignInChanged`), and a life on the older login no
longer feeds them, decided per life (`lifeSince <= lifeSince`). `list_profiles` carries each
provider's readings in words (`providerUsageText`). A window at or past
`USAGE_NEARS_ITS_LIMIT_AT` is an about-to-stop wall in the band (`wallsFromUsage`), and the band's
sentence says how much of each limit is used (`usageSays`), Claude's own warning line carrying its
figure (`rateLimitThrottle`). 28085e11: a person-only verb's refusal says what that verb does.

## ⚑ What a row here measures

 * ⚑ **M1–M3 · the 80% wall** (`provider-limit.ts · wallsFromUsage`): the threshold, a Codex
   bucket's window, and a window the provider's own wall names.
 * ⚑ **M4–M5 · the band's figure** (`usage-limit.ts`): the figure beside the limit, and Codex's
   *"N% of a 7-day window used"* read as one.
 * ⚑ **M6 · Claude's own warning line** (`normalize.ts · rateLimitThrottle`): `utilization` is a
   fraction made a percent.
 * ⚑ **M7 · one reading a WINDOW** (`takeTheUsage`): windows of one frame do not overwrite each other.
 * ⚑ **M8–M9 · an older login's readings never kept** (`aSignInChanged`): the life that saw the
   change is the older login's (`<=`, not `<`), and a life started after it is not.
 * ⚑ **M10–M11 · the file in the host** — a forget is written to the file, and the next host
   starts with what was kept.
 * ⚑ **M12–M13 · the file itself** (`provider-usage-file.ts`): where it is, and a missing or torn
   file read as none rather than thrown.
 * ⚑ **M14 · the agents' line names the right provider** (`agent-tools.ts`): Codex's line is said
   from Codex's readings.
 * ⚑ **M15 · 28085e11** (`ipc.ts · noPersonBehindIt`): a verb with no sentence of its own keeps
   *"changes what agents are allowed to do"*.

## ⛔ What this table does not contain

 * ⚠️ **Already measured elsewhere**: the sparse reading (3006 M9), `forgetTheUsage`'s
   `usage.delete` (3006 M10), the `readsAnOlderLogin` guard at `deliver` (3006 M11), and 488 M9.
 * ⚠️ **Equivalent through the fold** — `wallsFromUsage`'s `resetsAt <= now` skip and its
   `stopped.has(provider)` skip: `limitsForAPerson` hands the result to `foldProviderLimits`, which
   drops a passed reset and an about-to-stop beside a stopped wall anyway; only a pure call could
   tell (gaps file).
 * ⚠️ **No existing killer** (gaps-3030.md): the 80% boundary itself (`<` → `<=`: the tests read 79
   and 82, never 80), the write-beside-and-rename, the host's sixteen-window cap on readings, a
   reset that alone moved not written, the per-verb sentences of 28085e11 (every test compares
   `noPersonBehindIt(kind)` with itself), and a file from another login (no guard exists).
 * ⚠️ **Left out for count, killable**: the file's one-row-per-window and sixteen-row cap and its
   `aTime`/`aPercent`/`last < first` checks (§1 kills each), the quit's `keepTheUsage()` (§2's quit
   test), `if (moved)` (§2's write-once test), the agents' past tense for a passed reset and its
   payload's `reset_since` (§3), the agents' Codex bucket words (§3), the `'this window'` key (§4),
   Claude's agent-words naming by `PROVIDER_NAME`, the fuller of Codex's two slots (§4's pure
   test), and `fuller`'s `Math.max` (only the DOM test
   `a-question-is-answered-…-plain.dom.test.ts` reads 92 and 96 together).
"""

LIMIT = "apps/desktop/src/shared/provider-limit.ts"
BAND = "apps/desktop/src/renderer/src/lib/usage-limit.ts"
NORMALIZE = "packages/runtime/src/claude/normalize.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
FILE = "apps/desktop/src/main/provider-usage-file.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"

USAGE = "a-providers-usage-is-kept-told-to-agents-and-warned.test.ts"
CLAUDE_NORMALIZE = "claude-normalize.test.ts"
CREATING = "creating-an-agent.test.ts"
EDGES = "the-usage-warning-at-its-edges-and-each-verbs-refusal.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ---- A · the 80% wall (provider-limit.ts · wallsFromUsage) ---------------------------------
    # USAGE · '§4' › '🔴 at 80% of Claude’s weekly window: a wall about to stop, said as the band says
    # one' — 82% makes no wall, so `[wall]` is undefined.
    (
        "M1 · the warning comes only at the providers' own 90% — Claude's weekly window at 82% says "
        f"nothing, which is the line the person asked to hear of · killed by `{USAGE}`",
        [(LIMIT,
          "      if (used === null || used < USAGE_NEARS_ITS_LIMIT_AT) continue\n",
          "      if (used === null || used < 90) continue\n")],
    ),
    # USAGE · '§4' › '⛔ a Codex bucket’s window makes no warning: the band’s sentence could not name
    # it' — a bucket at 92% makes one wall, not none.
    (
        "M2 · a Codex bucket's window at 92% is warned as *\"Codex is near its weekly limit\"* while the "
        f"account's own window stands far from it · killed by `{USAGE}`",
        [(LIMIT,
          "      if (/\\)\\s*$/.test(reading.window)) continue\n",
          "      if (/^$/.test(reading.window)) continue\n")],
    ),
    # USAGE · '§4' › '⚑ the pure rule: a window the provider’s own wall names keeps the provider’s
    # line' — `wallsFromUsage` beside the provider's own `seven_day` wall answers one wall, not none.
    (
        "M3 · a window the provider's own warning already names gets BroBot's line too — two lines "
        f"for one limit, ours replacing the provider's in the fold · killed by `{USAGE}`",
        [(LIMIT,
          "      if (named.has(key) || (near.get(key)?.used ?? -1) >= used) continue\n",
          "      if (named.has('') || (near.get(key)?.used ?? -1) >= used) continue\n")],
    ),

    # ---- B · the band's figure (usage-limit.ts) ------------------------------------------------
    # USAGE · '§4' › '🔴 at 80% of Claude’s weekly window …' — `usageSays` reads "Claude is near its
    # weekly limit; it resets …", without "(82% used)".
    (
        "M4 · the band never says how much of a limit is used — *\"near its weekly limit\"* with no "
        f"figure · killed by `{USAGE}`",
        [(BAND,
          "  used === null ? '' : ` (${String(Math.round(used))}% used)`\n",
          "  used === null ? '' : ''\n")],
    ),
    # USAGE · '§4' › '🔴 Codex’s 7-day window at 90%: the same, in its own words' — "Codex is near its
    # weekly limit;" without "(90% used)".
    (
        "M5 · Codex's *\"90% of a 7-day window used\"* is not read as a figure — the band says Claude's "
        f"figure and never Codex's · killed by `{USAGE}`",
        [(BAND,
          "  const said = /(\\d+(?:\\.\\d+)?)% (?:of .+? )?used\\b/.exec(line)?.[1]\n",
          "  const said = /(\\d+(?:\\.\\d+)?)% used\\b/.exec(line)?.[1]\n")],
    ),

    # ---- C · Claude's own warning line (normalize.ts · rateLimitThrottle) ----------------------
    # CLAUDE_NORMALIZE · 'rate-limit visibility' › '⚑ F096 · an allowed_warning says how much of the
    # window is used, when the frame does' — "— 1% used", not "— 92% used".
    (
        "M6 · Claude's `utilization` is said as the fraction it is — its own warning at 92% reads "
        f"*\"— 1% used\"* · killed by `{CLAUDE_NORMALIZE}`",
        [(NORMALIZE,
          "      ? ` — ${String(Math.round(utilization * 100))}% used`\n",
          "      ? ` — ${String(Math.round(utilization))}% used`\n")],
    ),

    # ---- D · one reading a window (runtime-host.ts · takeTheUsage) ------------------------------
    # USAGE · '§3' › '🔴 each provider’s readings, in the payload and in words: used, resets, read
    # at' — one reading for claude, not seven_day, five_hour and seven_day_opus.
    (
        "M7 · 🔴 a provider's readings are kept under ONE key — each window of a frame overwrites the "
        f"last, so the weekly figure is lost to the 5-hour one · killed by `{USAGE}`",
        [(HOST,
          # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. e2ef389e1 added account context to each reading; preserve all fields while storing every window under its provider key.
          "      held.set(reading.window, {\n        window: reading.window,",
          "      held.set(provider, {\n        window: reading.window,")],
    ),

    # ---- E · an older login's readings never kept (runtime-host.ts · aSignInChanged) ------------
    # USAGE · '§2' › '🔴 the Mac’s Claude sign-in moving forgets Claude’s readings, and leaves Codex’s'
    # — the life that reported the change (lifeSince === the change's) puts its 90% back.
    (
        "M8 · 🔴 the life that reported the sign-in change is not marked as the older login's — its "
        f"next frame puts the account before's 90% back the moment it was forgotten · killed by `{USAGE}`",
        [(HOST,
          "        session.lifeSince <= lifeSince &&\n",
          "        session.lifeSince < lifeSince &&\n")],
    ),
    # USAGE · '§2' › '🔴 the Mac’s Claude sign-in moving …' — the life started on the new sign-in
    # keeps nothing: `kept().claude` is [], not its 3%.
    (
        "M9 · every running life of the provider is marked as the older login's, decided by the "
        "moment this app noticed — a life already on the new sign-in never feeds the readings · "
        f"killed by `{USAGE}`",
        [(HOST,
          "        session.lifeSince <= lifeSince &&\n",
          "        true &&\n")],
    ),

    # ---- F · the file, in the host (runtime-host.ts) --------------------------------------------
    # USAGE · '§2' › '🔴 what the provider runs on changing in this app forgets its readings, in the
    # file too' — `kept().claude` still holds the 11%.
    (
        "M10 · a forget is held in memory only — the file keeps the old login's readings, and the "
        f"next start says them against the new one · killed by `{USAGE}`",
        [(HOST,
          "    if (!this.usage.delete(provider)) return\n"
          "    this.keepTheUsage()\n",
          "    if (!this.usage.delete(provider)) return\n")],
    ),
    # USAGE · '§2' › '🔴 a reading is written when it arrives, and the next host starts with it' —
    # the restarted host's `providerUsage().claude` is [].
    (
        "M11 · the next host never takes the readings it kept — a restart forgets how full the weekly "
        f"window is until the provider speaks again · killed by `{USAGE}`",
        [(HOST,
          "      if (held.size > 0) this.usage.set(provider, held)\n",
          "      void held\n")],
    ),

    # ---- G · the file itself (provider-usage-file.ts) --------------------------------------------
    # USAGE · '§1' › '🔴 what is written is read back, per provider and window, with the windows seen'
    # — `providerUsageFile(dir)` is not `join(dir, 'provider-usage.json')`.
    (
        "M12 · the readings are written under another name than the one `clean-base` and the "
        f"person know · killed by `{USAGE}`",
        [(FILE,
          "  return join(userData, 'provider-usage.json')\n",
          "  return join(userData, 'usage.json')\n")],
    ),
    # USAGE · '§1' › '⛔ a missing file, one that is not JSON, and rows that are not readings read as
    # none' — `readKeptUsage` throws ENOENT instead of answering NO_USAGE_KEPT.
    (
        "M13 · 🔴 a missing or torn readings file throws instead of reading as none · killed by "
        f"`{USAGE}`",
        [(FILE,
          "  } catch {\n"
          "    return NO_USAGE_KEPT\n"
          "  }\n",
          "  } catch (error) {\n"
          "    throw error\n"
          "  }\n")],
    ),

    # ---- H · the agents' line (agent-tools.ts · list_profiles) -----------------------------------
    # USAGE · '§3' › '🔴 each provider’s readings, in the payload and in words …' — the text never says
    # "Codex's usage: no reading yet": Codex's line carries Claude's 34%.
    (
        "M14 · 🔴 the agents' line for each provider is said from Claude's readings — *\"Codex's usage: "
        f"weekly 34% used\"* is Claude's figure under Codex's name · killed by `{USAGE}`",
        [(TOOLS,
          "                providerUsageText(provider, reading.usage[provider], reading.readAt),\n",
          "                providerUsageText(provider, reading.usage.claude, reading.readAt),\n")],
    ),

    # ---- I · 28085e11 (ipc.ts · noPersonBehindIt) ------------------------------------------------
    # CREATING · '§5' › '⛔ a person’s door needs a person behind the channel, and the same payload on a
    # window does not' — the refusal reads "createAgent reads what agents …".
    (
        "M15 · a person-only verb with no sentence of its own is refused as a READ — `createAgent` "
        f"no longer says it changes what agents are allowed to do · killed by `{CREATING}`",
        [(IPC,
          "  const does = WHAT_A_PERSONS_VERB_DOES[kind] ?? 'changes what agents are allowed to do'\n",
          "  const does = WHAT_A_PERSONS_VERB_DOES[kind] ?? 'reads what agents are allowed to do'\n")],
    ),
    # ⚑ **M16–M20 · W4.181 — killed by the landing's own edge test**, added after M1–M15 were run.
    (
        "M16 · 🔴 exactly 80% is not yet warned — the line is past 80, not at it · killed by "
        f"`{EDGES}`",
        [(LIMIT,
          "      if (used === null || used < USAGE_NEARS_ITS_LIMIT_AT) continue\n",
          "      if (used === null || used <= USAGE_NEARS_ITS_LIMIT_AT) continue\n")],
    ),
    (
        "M17 · a reading whose window has reset since is still warned, asked of the pure rule · "
        f"killed by `{EDGES}`",
        [(LIMIT,
          "        (reading.resetsAt <= now || reading.resetsAt > MAX_INSTANT)\n",
          "        reading.resetsAt > MAX_INSTANT\n")],
    ),
    (
        "M18 · ⛔ a reset past what a date can hold reaches `toISOString` and throws · killed by "
        f"`{EDGES}`",
        [(LIMIT,
          "        (reading.resetsAt <= now || reading.resetsAt > MAX_INSTANT)\n",
          "        reading.resetsAt <= now\n")],
    ),
    (
        "M19 · a provider a wall already stopped is also warned of its usage, asked of the pure rule · "
        f"killed by `{EDGES}`",
        [(LIMIT,
          "    if (stopped.has(provider)) continue\n",
          "")],
    ),
    (
        "M20 · 🔴 every person's verb is refused with the generic sentence again — the defect "
        f"28085e11 fixed · killed by `{EDGES}`",
        [(IPC,
          "  const does = WHAT_A_PERSONS_VERB_DOES[kind] ?? 'changes what agents are allowed to do'\n",
          "  const does = 'changes what agents are allowed to do'\n")],
    ),
]
