"""1038 · D-038 · a Claude parent in auto can give a Codex helper in auto.

⚑ **Why `1038`**: card D-00N's table is `100N`. D-038 is one DEV commit, `dc5f3f4c`.

## What it changed

The wider-than-its-parent rail compares REACH: one table per provider and mode says what stands between
an act past the conversation's folder and that act running with nobody asked. A child is wider when it
would keep nothing there and its giver keeps something. The four ask → auto pairs are refused; Claude
auto → Codex auto now passes. The refusal puts the act first and names what the giver keeps
(`wouldLack`).

 * `M1`–`M4` — the derivation and its table, killed by DEV's `apps/desktop/test/a-mode-a-child-inherits.test.ts` (and `M3`, `M4` by the runtime package's file of that name).
 * `M5`–`M10` — the rail in `admitGive`, its sentence, detail and order, killed by the landing's
   `a-give-that-would-reach-further-than-its-giver-is-refused.test.ts`, which arms the comparison
   through a wrapper: no give the real doors can make meets the rail today (a child runs in its
   giver's mode), so it stands as a guard held for a ruling.

Designed read-only by a Sonnet 5.5 agent from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 10 of 10.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `9ffd7d6a` (the merge of `dc5f3f4c`), none by a syntax, reference or type error. Each killer file ran
  green unmutated first.
"""

SPAWN_RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
APPROVAL_MODE = "packages/runtime/src/approval-mode.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a child that keeps a card of its own is still called wider · whatTheChildWouldLack loses its early return, so a giver that keeps anything makes every child wider, an ask giver's ask child included, and the door refuses ordinary same-mode gives — killed by `a-mode-a-child-inherits.test.ts`",
        [
            (APPROVAL_MODE, "  if (keeps(child).length > 0) return []\n", ""),
        ],
    ),
    (
        "M2 · never wider becomes a set difference · the child lacks each protection the giver keeps that the child does not, so a Codex ask giver is refused its Claude ask helper for the missing sandbox, a pair that was given before D-038 (F-D) — killed by `a-mode-a-child-inherits.test.ts`",
        [
            (APPROVAL_MODE, "  if (keeps(child).length > 0) return []\n", ""),
            (APPROVAL_MODE, "  return PROTECTIONS.filter((one) => kept.includes(one))", "  return PROTECTIONS.filter((one) => kept.includes(one) && !keeps(child).includes(one))"),
        ],
    ),
    (
        "M3 · Codex auto still reads as sandboxed · the table says Codex auto keeps the sandbox past the folder, the old premise F050 corrected, so the table and the wire profile (danger-full-access) disagree — killed by `a-mode-a-child-inherits.test.ts`, `a-mode-a-child-inherits.test.ts`",
        [
            (APPROVAL_MODE, "  codex: { ask: ['the-card-before-an-act', 'the-sandbox-around-an-act'], auto: [] },", "  codex: { ask: ['the-card-before-an-act', 'the-sandbox-around-an-act'], auto: ['the-sandbox-around-an-act'] },"),
        ],
    ),
    (
        "M4 · Claude ask keeps nothing past its folder · the table carries 499's old empty ask row over, so no give from a Claude ask giver is ever wider and the rail refuses nothing — killed by `a-mode-a-child-inherits.test.ts`, `a-mode-a-child-inherits.test.ts`",
        [
            (APPROVAL_MODE, "  claude: { ask: ['the-card-before-an-act'], auto: [] },", "  claude: { ask: [], auto: [] },"),
        ],
    ),
    (
        "M5 · the refusal joins the protections it names with a comma · a giver that keeps both the card and the sandbox reads 'the card before you act, the sandbox around what you run, and the conversation…', which names three things instead of two — killed by `a-give-that-would-reach-further-than-its-giver-is-refused.test.ts`",
        [
            (SPAWN_RAILS, ".map((kept) => PROTECTION_SAID[kept]).join(' and ')", ".map((kept) => PROTECTION_SAID[kept]).join(', ')"),
        ],
    ),
    (
        "M6 · the rail's refusal is dropped from admitGive · the comparison and its refusal block are deleted as dead code (no give meets it today, D-038 F-B), so the day a per-profile mode makes it reachable a wider conversation is started — killed by `a-give-that-would-reach-further-than-its-giver-is-refused.test.ts`",
        [
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the comparison is asked only when the start has a provider (an agent whose conversations ran on both has none until a person chooses), so it is indented under that condition; same plant.
            (SPAWN_RAILS, "  const wouldLack =\n    provider === null\n      ? []\n      : whatTheChildWouldLack(\n          { provider, approvalMode },\n          { provider: giving.provider, approvalMode: giving.approvalMode },\n        )\n  if (wouldLack.length > 0) {\n    return no('wider-than-its-parent', {\n      asked: approvalMode,\n      spawnerRunsAs: giving.approvalMode,\n      wouldLack,\n      profileId: asked.profile,\n    })\n  }\n", ""),
        ],
    ),
    (
        "M7 · the refusal's detail drops what the giver keeps · asked and spawnerRunsAs say the whole story to a reader of the rail's name, but wouldLack is what builds the sentence's clause, so the caller reads 'with a protection' and the payload carries no fact to act on — killed by `a-give-that-would-reach-further-than-its-giver-is-refused.test.ts`",
        [
            (SPAWN_RAILS, "      spawnerRunsAs: giving.approvalMode,\n      wouldLack,\n      profileId: asked.profile,", "      spawnerRunsAs: giving.approvalMode,\n      profileId: asked.profile,"),
        ],
    ),
    (
        "M8 · the child is compared on the giver's provider · admitGive reads the new conversation's provider as the giver's when it asks the comparison, so a cross-provider child is judged as a same-provider one — killed by `a-give-that-would-reach-further-than-its-giver-is-refused.test.ts`",
        [
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the comparison is asked only when the start has a provider (an agent whose conversations ran on both has none until a person chooses), so it is indented under that condition; same plant.
            (SPAWN_RAILS, "          { provider, approvalMode },\n          { provider: giving.provider, approvalMode: giving.approvalMode },\n", "          { provider: giving.provider, approvalMode },\n          { provider: giving.provider, approvalMode: giving.approvalMode },\n"),
        ],
    ),
    (
        "M9 · the name rule is asked before the reach rail · a typo in the agent's name is refused as no-such-profile ahead of the wider-than-its-parent rule, so a caller that is both is told to fix the spelling first — killed by `a-give-that-would-reach-further-than-its-giver-is-refused.test.ts`",
        [
            (SPAWN_RAILS, "  // ⚑ never wider than the giver — see the rail for why it compares what each keeps past its folder.\n", "  if (!known && asked.new !== true) return no('no-such-profile', { profileId: asked.profile })\n  // ⚑ never wider than the giver — see the rail for why it compares what each keeps past its folder.\n"),
        ],
    ),
    (
        "M10 · the reach rail is asked before the kill switch · the app-wide spawning switch is moved to after the rail, so a refused wider give is told about a mode when spawning is off for everyone — killed by `a-give-that-would-reach-further-than-its-giver-is-refused.test.ts`",
        [
            (SPAWN_RAILS, "  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })\n", ""),
            (SPAWN_RAILS, "  // ⚑ **R3 — the name**: a typo is refused, and a new agent is asked for by `new` alone.\n", "  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })\n  // ⚑ **R3 — the name**: a typo is refused, and a new agent is asked for by `new` alone.\n"),
        ],
    ),
]
