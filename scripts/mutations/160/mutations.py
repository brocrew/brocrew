#!/usr/bin/env python3
"""
160 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run did, with a `git checkout` loop, and one of its
three paths was untracked — so git aborted the whole checkout every iteration and 22 mutations
accumulated into the source. 160 adds an untracked file too (`stale-permission-config.ts`).

⚠️ **Anchors are taken from the FORMATTED source.** 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the exact string the entry was anchored on. Every target here was
copied after the last format run.

## What the table is about

⛔ **160 is a REVERT, so the mutations are the two guards coming BACK.** M1 and M2 restore 153's
`protectedRoots` and 157's Codex profile respectively — if either survives, the ticket did not do
what it says. ⛔ **M3–M5 are the opposite failure**: the revert going too far and dropping the
`userData` guard that has a real reason, which would reopen 069 A1.
"""

import sys
from pathlib import Path

INDEX = "apps/desktop/src/main/index.ts"
SCRATCH = "apps/desktop/src/main/runtime/scratch-cwd.ts"
CONFINE = "packages/runtime/src/internal/confinement.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
STALE = "packages/runtime/src/codex/stale-permission-config.ts"

# ⚑ **736 · corrected in place, not retired** — R96 made `ask` the Codex CLI's default preset, so the
# `ask` row's sandbox is `workspace-write` (measured, the Codex terminal's *Workspace (Ask for
# approval)*). M9, M11, M12 and M13 still plant what their labels say — a named profile on `ask`,
# `ask` unattended, the two modes swapped, the reviewer unpinned — against the line as it stands.
ASK_PROFILE = "  ask: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' },\n"
AUTO_PROFILE = "  auto: { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' },\n"

REFUSAL_NOW = (
    "    `${which} belongs to BroBot2 itself, not to this conversation. ` +\n"
    "    `The app refuses its own data directory to every session, in every mode.`\n"
)
REFUSAL_153 = (
    "    `${which} is not this conversation's to reach. BroBot2 keeps both its own data and your ` +\n"
    "    `providers' own folders out of every session, in every mode.`\n"
)

# There is no protectedRoots, cwd wall or own-root carve-out to restore here. The rows retain their
# removed-code anchors and are recorded retired because their former defects are now intended
# behavior.
MUTATIONS = [
    # ---- §1 · the guard coming back, which is the whole thing this ticket removed ---------------
    (
        "M1 · 153 §2 IS BACK · the personal homes rejoin protectedRoots, so a Claude session is "
        "refused ~/.claude and ~/.codex again",
        [
            (
                INDEX,
                "    protectedRoots: () => [userData],",
                "    protectedRoots: () => [\n"
                "      userData,\n"
                "      `${process.env['HOME']}/.claude`,\n"
                "      `${process.env['HOME']}/.codex`,\n"
                "    ],",
            )
        ],
    ),
    (
        "M2 · …and the guard leaves entirely, dropping the ONE root that has a neighbour reason "
        "(069 A1 reopens)",
        [(INDEX, "    protectedRoots: () => [userData],", "    protectedRoots: () => [],")],
    ),
    (
        "M3 · the RULE is deleted from where the roots are produced, so the next widening has "
        "nothing to answer to (§4)",
        [
            (
                INDEX,
                "    // ## ⛔ THE RULE FOR THIS LIST: **match the CLI, unless the reason is NEIGHBOURS** (160)",
                "    // ## The rule for this list",
            )
        ],
    ),
    (
        "M4 · …and 069 A1 stops being named, so `userData` reads as a preference rather than an "
        "incident",
        [
            (
                INDEX,
                "    // live in here. That is 069 A1 — `Read ../provider-homes/<project>/<profile>/codex/auth.json`",
                "    // live in here. That is the finding — `Read ../provider-homes/<project>/<profile>/codex/auth.json`",
            )
        ],
    ),
    # ---- §1 · the cwd rule, half-reverted: one half goes, one half must not ---------------------
    (
        "M5 · the cwd check stops refusing the app's own data, so `cwd: <userData>/provider-homes` "
        "is selectable again",
        # ⚠️ **Anchor corrected by 489**, which made `assertNotAppData` ANSWER rather than throw
        # (`appDataReason`, so a second caller can tell a policy wall from a missing directory) and
        # moved the call ABOVE the existence check — 341's *refuse on entitlement before refusing on
        # existence*, at the folder door. ⛔ The DEFECT is unchanged: delete the wall and
        # `cwd: <userData>/provider-homes` is selectable again.
        [(SCRATCH,
          "  const wall = appDataReason(userData, cwd, true)\n  if (wall !== null) return { ok: false, reason: wall }\n",
          "")],
    ),
    (
        "M6 · …and the opposite over-revert: a personal home is refused as a cwd again, which the "
        "CLI does not do",
        [
            (
                SCRATCH,
                # ⚠️ **Anchor corrected by 371**, which extracted `resolve(expandHome(trimmed))` into
                # `cwdSpelling` so the spawn chokepoint and `checkSessionCwd` could not come to
                # disagree about a padded path. ⛔ The DEFECT below is unchanged, and the row was
                # re-applied and re-run at 371 rather than carried on a verdict it had not re-earned.
                # ⚠️ **Re-anchored again by 489**, which put the app-data wall between
                # `cwdSpelling` and `let isDirectory`. ⛔ The injected refusal is unchanged and still
                # lands on the same path, before anything else looks at it.
                "  const cwd = cwdSpelling(trimmed)\n",
                "  const cwd = cwdSpelling(trimmed)\n"
                "  if (/\\.(claude|codex)(\\/|$)/.test(cwd)) {\n"
                "    return { ok: false, reason: `cwd is one of your provider's own folders: ${cwd}` }\n"
                "  }\n",
            )
        ],
    ),
    # ---- §1 · the refusal sentence, wrong in both directions (086, twice) -----------------------
    (
        "M7 · the refusal claims a reach this app no longer has — 153's wording, restored verbatim",
        [(CONFINE, REFUSAL_NOW, REFUSAL_153)],
    ),
    # ---- §2 · the legacy sandbox modes, and the profile that must not come back -----------------
    (
        "M8 · 157 IS BACK · auto selects a named permissions profile, which -32600s beside `sandbox`",
        [
            (
                CODEX,
                AUTO_PROFILE,
                "  auto: {\n"
                "    approvalPolicy: 'never',\n"
                "    approvalsReviewer: 'user',\n"
                "    sandbox: 'danger-full-access',\n"
                "    permissions: 'brobot-auto',\n"
                "  },\n",
            )
        ],
    ),
    (
        "M9 · …and ask does too, which is the half that breaks 001 non-negotiable 1 (an accepted "
        "card doing nothing)",
        [
            (
                CODEX,
                ASK_PROFILE,
                "  ask: {\n"
                "    approvalPolicy: 'on-request',\n"
                "    approvalsReviewer: 'user',\n"
                "    sandbox: 'workspace-write',\n"
                "    permissions: 'brobot-ask',\n"
                "  },\n",
            )
        ],
    ),
    (
        "M10 · auto loses the machine — `read-only` instead of `danger-full-access`, so `ps` and the "
        "user's own files go with it",
        [(CODEX, AUTO_PROFILE, AUTO_PROFILE.replace("'danger-full-access'", "'read-only'"))],
    ),
    (
        "M11 · …and ask stops prompting — `danger-full-access` instead of `workspace-write` (`read-only` "
        "until `736`)",
        [(CODEX, ASK_PROFILE, ASK_PROFILE.replace("'workspace-write'", "'danger-full-access'"))],
    ),
    (
        "M12 · the two modes are swapped — ask runs unattended and auto prompts",
        [
            (
                CODEX,
                ASK_PROFILE + AUTO_PROFILE,
                ASK_PROFILE.replace("'workspace-write'", "'danger-full-access'")
                + AUTO_PROFILE.replace("'danger-full-access'", "'workspace-write'"),
            )
        ],
    ),
    (
        "M13 · the reviewer is no longer pinned to `user`, so a host config can route escalation to "
        "an auto-approver",
        [(CODEX, ASK_PROFILE, ASK_PROFILE.replace("'user'", "'auto_review'"))],
    ),
    # ---- §2 · the stale-block migration --------------------------------------------------------
    (
        "M14 · the stale `[permissions.*]` block is never removed at START",
        [(CODEX, "    removeStaleCodexPermissionConfig(opts.providerHome)\n", "")],
    ),
    (
        "M15 · …nor at RESUME, which is the path a 157-era home actually arrives by",
        [(CODEX, "    removeStaleCodexPermissionConfig(options.providerHome)\n", "")],
    ),
    (
        "M16 · the removal runs AFTER the spawn, so the app-server has already read the block",
        [
            (
                CODEX,
                "    removeStaleCodexPermissionConfig(opts.providerHome)\n"
                "    const transport = this.transportFactory({ cwd: opts.cwd, providerHome: opts.providerHome })\n",
                "    const transport = this.transportFactory({ cwd: opts.cwd, providerHome: opts.providerHome })\n"
                "    removeStaleCodexPermissionConfig(opts.providerHome)\n",
            )
        ],
    ),
    (
        "M17 · 🔒 the ownership check is bypassed, so ANY config.toml in a Codex home is deleted",
        [
            (
                STALE,
                "  if (!text.startsWith(GENERATED_HEADER)) return null // somebody else's config; not ours to delete",
                "  if (false) return null // somebody else's config; not ours to delete",
            )
        ],
    ),
    (
        "M18 · …and the opposite: the removal is a no-op, so the block it reported removing is "
        "still there",
        [(STALE, "  rmSync(path, { force: true })\n", "")],
    ),
    (
        "M19 · the header match becomes a substring search, so a file merely MENTIONING BroBot is "
        "deleted",
        [
            (
                STALE,
                "  if (!text.startsWith(GENERATED_HEADER)) return null",
                "  if (!text.includes(GENERATED_HEADER)) return null",
            )
        ],
    ),
    # ---- the placement rule both halves rest on (032/071), unchanged by 160 and still load-bearing
    (
        "M20 · a protected root stops being refused when only the REAL path lands in it (a symlink "
        "launders the credential store)",
        [
            (
                CONFINE,
                "    if (isWithin(root.lexical, lexical) || isWithin(root.real, real)) return 'refused'",
                "    if (isWithin(root.lexical, lexical)) return 'refused'",
            )
        ],
    ),
    (
        "M21 · …and the session's own carve-out stops requiring BOTH spellings, so a symlinked cwd "
        "carves out `userData`",
        [
            (
                CONFINE,
                "    if (isWithin(root.lexical, lexical) && isWithin(root.real, real)) return 'own'",
                "    if (isWithin(root.lexical, lexical)) return 'own'",
            )
        ],
    ),
    (
        "M22 · the wide scan narrows back to `file_path`, so `Glob`'s optional `path` walks into "
        "the app's data uncheck",
        [
            (
                CONFINE,
                "      if (canNameAFile(node) && place(node, confinement.cwd, roots) === 'refused') {",
                "      if (false && place(node, confinement.cwd, roots) === 'refused') {",
            )
        ],
    ),
]


def main() -> int:
    if sys.argv[1] == "--count":
        print(len(MUTATIONS))
        return 0
    if sys.argv[1] == "--name":
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(f"MUTATION DID NOT APPLY: {rel} matched {found} times, expected 1", file=sys.stderr)
            return 2
        path.write_text(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
