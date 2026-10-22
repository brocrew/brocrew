#!/usr/bin/env python3
"""279's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **The finding is the person's gap 7**: *"See the agent's own commands. Our command palette only knows
BroBot's commands, not Claude's or Codex's."* `249` built the palette and it had never asked a
provider what IT can do.

## ⚑ What the providers actually publish, measured before a line was written

`probe:provider-commands` — zero turns and zero tokens on both sides, a real Claude login with a
prompt that never yields and the bundled Codex `0.146.0` before any thread started:

```
claude · initializationResult().commands   44 rows in 1 918 ms   ← the CLI handshake, paid anyway
         supportedCommands()                same 44 names in 0 ms  ← cached; init is therefore free
         44/44 description · 17/44 argumentHint · 7/44 aliases · longest description 1 135
         35 of 44 whole at 200 · 40 at 500 · 41 at 1 000        ← where MAX_COMMAND_TEXT comes from
         1 of 44 contains a NEWLINE                             ← where commandDetail comes from
codex  · skills/list             6 rows · imagegen, openai-docs, plugin-creator, review-agent, …
         plugin/list             {"marketplaces":[],…}          ← not commands
         collaborationMode/list  Plan, Default                  ← MODES, not commands
         hooks/list              nothing
         3 of the 4 defaultPrompts write `$name`; NONE writes `/name`
```

⛔ **So the two providers are not answering the same question**, and half the rows below exist to
kill a build that assumed they were. Claude publishes built-ins AND skills, typed `/name`; Codex
publishes skills only, typed `$name`, and **no Codex name appears among Claude's forty-four**.

## The row groups

 * `M1`-`M4`   🔴 **the band lies about who owns it** — the sigil is hard-coded, the heading stops
                naming the provider, the description is dropped, the hint is dropped.
 * `M5`-`M7`   🔴 **§3's ruling** — a listed row becomes runnable, the cursor reaches one, and the
                disclosure sentence goes.
 * `M8`-`M10`  ⛔ **the `shown`/`drawn` split**, which is the subtlest thing this dispatch built.
 * `M11`-`M13` ⛔ **`undefined` ≠ `[]`** — §2's two nulls, collapsed three different ways.
 * `M14`-`M16` ⚑ **the level** — the fold merges, the carry is dropped, the carry shares its array.
 * `M17`-`M20` ⚠️ **the adapters** — a malformed payload becomes an empty list, the normalizer eats
                the frame it should sit beside, the cap stops counting, and `clip` goes off by one.
 * `M21`-`M22` ⚠️ **the Codex half specifically** — the trigger written for the model is drawn
                instead of the sentence written for a person, and a disabled skill is listed.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row reaches the PROVIDER's half.** Nothing here can prove Claude publishes 44 commands or
   that Codex publishes none of them — that is `probe:provider-commands`' job, and the honest limit
   is that every row below measures what BroBot does with an answer rather than what the answer is.
   Step `79` of `smoke:ui` is the only instrument that crosses the whole seam.
 * ⚠️ **No row reaches the fire-and-forget READS.** `publishCommands` (Claude) and `readCommandList`
   (Codex) are detached promises inside a session handle; neither `desktop` nor `dom` can reach them
   and the `runtime` project has no double that spawns a CLI. ⛔ **Their failure path — publish
   NOTHING rather than an empty list — is therefore untested here, and it is the one place a
   regression would look exactly like a provider that had gone quiet.** Named rather than papered
   over; `agentNote`'s `set === null` branch is what makes the consequence survivable.
 * ⚠️ **No row mutates a capability NOTE into a different sentence**, only into an identical one
   (`M23`). A note is prose; a row that reworded it could only be killed by a source census, and
   `268 §1` ruled a RED produced only by a text census non-evidentiary. Making the two notes IDENTICAL
   is a behavioural change — it is the "available, but not the same thing" collapse `capabilities.ts`
   exists to prevent — so that is the row that exists.

## ⚠️ FOUR of the twenty-three measured by hand — and the other nineteen were NOT

`279` §4 says *"Write, do not run."* So `mutations.txt` does not exist at this HEAD and its absence
is the honest state — `238`'s lesson is that a row can sit green beside prose insisting it must die,
and only a run closes that.

⛔ **All 23 anchors are verified present exactly once** (`mutations.py --dry-run .`), which is what
§4 asks for. Beyond that, `278`'s precedent is to put every defect into the tree by hand and record
what it really produced. ⚠️ **This table could not finish that**, and the reason is written down
rather than left as an unexplained gap: a SECOND mutation harness was running on this machine from
another worktree throughout, and the load average went from 42 to **241**. A whole-project run that
takes 25 seconds on an idle machine was taking minutes; nineteen rows × three projects would have
been hours of contention that makes neither run more true. ⛔ **The four that WERE measured are
recorded below; the rest say NOT MEASURED, which is a different thing from a prediction and is not
written as one.**

**Baselines, taken on the unmutated tree: `runtime` 1,473 · `desktop` 3,017 · `dom` 799.**
`scripts` was not run per row: no row mutates a file in it, which `mutations.py --files` makes
checkable rather than assertable.

```
                                                      runtime   desktop    dom
M1   the sigil is hard-coded to a slash                GREEN     1 red     GREEN    ← measured
M2   the heading stops naming the provider             GREEN     1 red     1 red    ← measured
M3   the description is dropped from a row             GREEN     1 red     GREEN    ← measured
M4   the argument hint is dropped                      GREEN     1 red     1 red    ← measured
M5 … M23                                               NOT MEASURED — see above
```

⚑ **`M3` is why predictions are not recorded as measurements.** Before the run this table expected
`dom 1 red`, and the machine said `GREEN`. The reason is exact and worth keeping: dropping the
DESCRIPTION leaves the ARGUMENT HINT, `commandDetail` still returns a line, and the browser
assertion that reads the row's text still passes. The row is killed in `desktop` and the `dom`
assertion it looked like it should have moved was about something else. ⛔ **A table that had written
`1 red` there from reasoning would have been wrong in the one direction that matters** — it would
claim coverage the suite does not have.

⚠️ **`M22` is expected to SURVIVE and was not measured either**, so that expectation is a reading of
the code rather than an observation: the `enabled !== false` filter it removes lives inside
`readCommandList`, a detached promise in a session handle that no vitest project executes. It is
recorded because the consequence is worth naming — a disabled skill listed as a command the agent
has is `106` arriving through the one door nothing watches — not because a run has confirmed it.

⛔ **To finish this table, run `scripts/mutations/279/mutate.sh` on an idle machine.** That is what
the harness is for, and it will write `mutations.txt` beside this file.

⛔ **`M17` is the row that teaches the most.** It turns *"a payload we cannot read"* into `commands:
[]` — a one-word change that looks like tidying and means *"this agent has no commands"* on exactly
the traffic we understood least. ⚑ It dies on the paired assertion in `provider-commands.test.ts`,
which is the only test in the suite that checks a malformed frame produces NO event beside a real
empty one that produces ONE. Written the obvious way — asserting only that a real empty list is
carried — the row would have survived.
"""

from pathlib import Path

VOCAB = "packages/runtime/src/provider-commands.ts"
CNORM = "packages/runtime/src/claude/normalize.ts"
XNORM = "packages/runtime/src/codex/normalize.ts"
XRUN = "packages/runtime/src/codex/codex-runtime.ts"
XCAPS = "packages/runtime/src/codex/capabilities.ts"
LIB = "apps/desktop/src/renderer/src/lib/command-palette.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
WINDOW = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
PANEL = "apps/desktop/src/renderer/src/components/CommandPalette.vue"

FOLD_REPLACE = """      state.commands = {
        set: { commands: [...event.commands], prefix: event.prefix },
        dropped: event.dropped ?? 0,
      }"""

CARRY_COPY = """    commands: {
      set:
        state.commands.set === null
          ? null
          : { commands: [...state.commands.set.commands], prefix: state.commands.set.prefix },
      dropped: state.commands.dropped,
    },"""

UNTOLD = """  if (agent.set === null) {
    return `BroBot has not been told what ${named} can do here — a conversation that has not started, or a provider that did not answer.`
  }"""

MALFORMED = """  const raw = readField(message, 'commands')
  if (!Array.isArray(raw)) return []"""

CLAUDE_BESIDE = """      const background_ = [
        ...backgroundWorkEvents(message, background),"""

ROW_ROLE = """              :role="runnable(row) ? 'option' : 'presentation'\""""

MUTATIONS = [
    # ── the band lies about who owns it ─────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT the measurement exists to prevent · the sigil is hard-coded to a slash, "
        "so a Codex session is told to type `/imagegen` — a string its agent will never answer to. "
        "Measured: 3 of Codex's 4 defaultPrompts write `$name` and NONE writes `/name` "
        "· MEASURED: desktop 1 red of 3017, dom GREEN",
        [(LIB, "      title: `${prefix}${command.name}`,", "      title: `/${command.name}`,")],
    ),
    (
        "M2 · 🔴 the heading stops naming the provider · §2's *\"visibly distinguishable\"* is gone "
        "and BroBot's verbs sit under the same word as the agent's "
        "· MEASURED: desktop 1 red of 3017, dom 1 red of 799",
        [
            (
                LIB,
                "  if (group !== 'agent' || agent === null) return GROUP_LABEL[group]\n  return `${providerName(agent.provider)}'s own commands`",
                "  void agent\n  return GROUP_LABEL[group]",
            )
        ],
    ),
    (
        "M3 · ⚠️ the description is dropped · the band lists 44 bare names and the person who wanted "
        "to know what `/verify` does has to go and find out elsewhere "
        "· MEASURED: desktop 1 red of 3017, dom GREEN — the hint still draws a line, see the header",
        [
            (
                LIB,
                "  const said = (description ?? '').replace(/\\s+/g, ' ').trim()",
                "  const said = ''\n  void description",
            )
        ],
    ),
    (
        "M4 · ⚠️ the argument hint is dropped · 17 of the 44 carry one, and `/code-review` without "
        "its `[--fix]` is a command you cannot use · MEASURED: desktop 1 red of 3017, dom 1 red of 799",
        [
            (
                LIB,
                "  const takes = (argumentHint ?? '').replace(/\\s+/g, ' ').trim()",
                "  const takes = ''\n  void argumentHint",
            )
        ],
    ),
    # ── §3's ruling: listed, never run ──────────────────────────────────────────────────────────
    (
        "M5 · 🔴 a listed row becomes RUNNABLE · Enter reaches `/compact`, and the palette appears to "
        "offer a command §3 rules out of scope and nothing will send "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3017, dom 4 red of 799",
        [
            (
                LIB,
                "  return command.action !== null\n}",
                "  void command\n  return true\n}",
            )
        ],
    ),
    (
        "M6 · 🔴 the CLICK half of the same rule goes · the cursor still cannot reach a listed row and "
        "a mouse can — `169`'s split gesture, upside down · EXPECTED (NOT MEASURED): dom 1 red of 799",
        [(PANEL, "  if (!runnable(command)) return\n  hide()", "  hide()")],
    ),
    (
        "M7 · 🔴 §3's disclosure is emptied · the band lists 44 rows that look exactly like the "
        "pressable ones above them and says nothing about what it will not do "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3017, dom 1 red of 799",
        [
            (
                LIB,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "  return `${named} answers to ${many} of its own.${short} Type one with ${prefix} in the conversation — BroCrew lists them and does not run them.`",
                "  void many\n  void short\n  void prefix\n  return null",
            )
        ],
    ),
    # ── the shown/drawn split ───────────────────────────────────────────────────────────────────
    (
        "M8 · ⛔ `drawn` reverts to `shown.length > 0` · a query matching ONLY the agent's commands "
        "renders *\"Nothing matches\"* above the rows it found — the two lists were one until this "
        "dispatch split them · EXPECTED (NOT MEASURED): dom 1 red of 799",
        [
            (
                PANEL,
                "const drawn = computed(() => bands.value.some((band) => band.rows.length > 0))",
                "const drawn = computed(() => shown.value.length > 0)",
            )
        ],
    ),
    (
        "M9 · ⛔ the Enter fallback keys on `shown` again · pressing Enter over a full band navigates "
        "AWAY to All conversations, out of a palette that had just found what was asked for "
        "· EXPECTED (NOT MEASURED): dom 1 red of 799",
        [(PANEL, "    else if (!drawn.value) escapeToLibrary()", "    else if (shown.value.length === 0) escapeToLibrary()")],
    ),
    (
        "M10 · ⚠️ `role=\"option\"` is put back on every row · a screen reader is promised that Enter "
        "acts on a row Enter cannot reach — `223`'s *\"naming a gesture a mount has switched off is "
        "106 one layer down\"* · EXPECTED (NOT MEASURED): dom 1 red of 799",
        [(PANEL, ROW_ROLE, '              role="option"')],
    ),
    # ── §2's two nulls ──────────────────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 an UNTOLD session reads as an agent with no commands · §2 by name: *\"do not show an "
        "empty section as though the agent had none\"* — a conversation that has not started, and a "
        "provider that never answered, both described as an agent that has nothing "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3017, dom 1 red of 799",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — §2 still holds: an
        # untold agent (`set === null`) must not read as 'reports no commands'. D-017b only rewrote
        # the null arm's sentence to 'BroBot has not been told what X can do here — it is told when
        # this conversation takes its next message, unless its provider does not answer.' The plant
        # swaps that arm for the empty-set sentence.
        [
            # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
            (LIB, "  if (agent.set === null) {\n    return `BroCrew has not been told what ${named} can do here — it is told when this conversation takes its next message, unless its provider does not answer.`\n  }", '  if (agent.set === null) {\n    return `${named} reports no commands of its own for this conversation.`\n  }'),
        ],
    ),
    (
        "M12 · 🔴 the registry starts at an EMPTY SET rather than at `null` · every fresh conversation "
        "claims its agent answers to nothing, before anyone has been asked "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3017, dom 1 red of 799",
        [(FOLD, "    commands: { set: null, dropped: 0 },", "    commands: { set: { commands: [], prefix: '/' }, dropped: 0 },")],
    ),
    (
        "M13 · ⚠️ the shortfall is not said · the band shows 200 rows of an agent that has 260 and "
        "nothing says so — `247` §3's *\"a registry that quietly undercounts is worse than none\"* "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3017",
        [
            (
                LIB,
                "  const short = agent.dropped > 0 ? ` ${agent.dropped} more could not be listed.` : ''",
                "  const short = ''",
            )
        ],
    ),
    # ── the level ───────────────────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 the fold MERGES instead of replacing · §4's level row. The SDK says *\"clients should "
        "REPLACE their cached command list with this payload\"*; a merge makes a skill deleted "
        "mid-session immortal, which is `222`'s stale indicator in another hat "
        "· EXPECTED (NOT MEASURED): desktop 3 red of 3017",
        [
            (
                FOLD,
                FOLD_REPLACE,
                "      state.commands = {\n        set: {\n          commands: [...(state.commands.set?.commands ?? []), ...event.commands],\n          prefix: event.prefix,\n        },\n        dropped: event.dropped ?? 0,\n      }",
            )
        ],
    ),
    (
        "M15 · ⛔ the window carry is dropped · this level is stated ONCE, so a conversation long "
        "enough to roll its window forgets the list for good — there is no next restatement to wait "
        "for, unlike `background_work`'s and `scheduled_work`'s · EXPECTED (NOT MEASURED): desktop 1 red of 3017",
        [(WINDOW, "    state.commands = carry.commands\n", "")],
    ),
    (
        "M16 · ⚠️ the carry SHARES its array instead of copying it · two folds hold one list, and a "
        "level that replaces in one of them mutates the other — the hazard every neighbour in "
        "`carryForward` copies one level deep to avoid · EXPECTED (NOT MEASURED): desktop 1 red of 3017",
        [
            (
                WINDOW,
                CARRY_COPY,
                "    commands: state.commands,",
            )
        ],
    ),
    # ── the adapters ────────────────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 a payload we cannot READ becomes an empty list · the band is emptied on exactly the "
        "traffic we understood least, and `[]` is the one value that means *the agent has none* "
        "· EXPECTED (NOT MEASURED): runtime 1 red of 1472",
        [(CNORM, MALFORMED, "  const raw = readField(message, 'commands')\n  const rows: unknown[] = Array.isArray(raw) ? raw : []")],
    ),
    (
        "M18 · ⚠️ the normalizer EATS the frame it should sit beside · the level arrives and the raw "
        "stream loses the payload it came from, so there is no longer a place to check what the "
        "provider really said — `245`'s ruling and `247`'s construction "
        "· EXPECTED (NOT MEASURED): runtime 1 red of 1472",
        [
            (
                CNORM,
                CLAUDE_BESIDE,
                "      const commandsPush = providerCommandsEvents(message)\n      if (commandsPush.length > 0) return commandsPush\n      const background_ = [\n        ...backgroundWorkEvents(message, background),",
            )
        ],
    ),
    (
        "M19 · ⚠️ the cap stops counting what it dropped · a list silently one row short, which is "
        "`092`'s no-silent-cap rule and the reason `dropped` exists at all "
        "· EXPECTED (NOT MEASURED): runtime 2 red of 1472",
        [(VOCAB, "  return { commands, dropped: sent.length - commands.length }", "  return { commands, dropped: 0 }")],
    ),
    (
        "M20 · ⚠️ `clip` goes EXCLUSIVE · a bounded string is one character over the schema, so "
        "`toWireEvent` degrades the whole event to `unknown` and the band silently loses the row — "
        "the exact off-by-one `background_work` had to write 201 for · EXPECTED (NOT MEASURED): runtime 1 red of 1472",
        [
            (
                VOCAB,
                "  return text.length > max ? `${text.slice(0, max - 1)}…` : text",
                "  return text.length > max ? `${text.slice(0, max)}…` : text",
            )
        ],
    ),
    # ── the Codex half ──────────────────────────────────────────────────────────────────────────
    (
        "M21 · ⚠️ Codex draws the TRIGGER written for the model instead of the sentence written for a "
        "person · both fields are on every one of the six live rows and they are not the same "
        "sentence — `imagegen`'s reads *\"Generate or edit images for websites, games, and more\"* "
        "against a 170-character instruction about when to reach for it "
        "· EXPECTED (NOT MEASURED): runtime 1 red of 1472",
        [
            (
                XNORM,
                "  const short = readString(readField(skill, 'interface'), 'shortDescription')\n  const described = short || readString(skill, 'description')",
                "  const described = readString(skill, 'description')",
            )
        ],
    ),
    (
        "M22 · ⛔ a DISABLED skill is listed as available · a palette row for something the agent will "
        "not answer to, which is `106` arriving through the one door no project executes "
        "· EXPECTED (NOT MEASURED): SURVIVOR on all three — see the header",
        [
            (
                XRUN,
                "        sent.filter((skill) => readField(skill, 'enabled') !== false).map(readCodexSkill),",
                "        sent.map(readCodexSkill),",
            )
        ],
    ),
    (
        "M23 · ⚠️ the two capability notes are made IDENTICAL · `capabilities.ts`' own *\"available, but "
        "not the same thing\"* collapse: a person who has used `/compact` on Claude looks for it on "
        "Codex, finds nothing, and is told the capability is available "
        "· EXPECTED (NOT MEASURED): runtime 1 red of 1472",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-capabilities.ts",
                # ⚑ **713 · corrected in place** (standing rule 27): Codex's note says `/compact` still
                # works there now (`R59`). Same collapse, same replacement; re-verified RED alone.
                "    note: \"Codex's own skills, typed with a leading $. Codex publishes no slash commands over its app-server, so this list is skills and nothing else. /compact still works here: BroCrew turns it into Codex's own compaction request.\",",
                "    note: \"Claude's own — its built-in commands and its skills in one list, typed with a leading slash. Claude pushes a fresh list whenever it changes.\",",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool = False) -> int:
    """Apply row `index` under `root`. Returns the number of anchors that did not resolve."""
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        if not path.exists():
            print(f"!! {name}: {rel} does not exist")
            bad += 1
            continue
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found, and 268 §2 found one that had reached a committed table.
        # Checked here rather than by eye, on every row, every run.
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
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} rows apply exactly once ({edits} edit anchors)")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
