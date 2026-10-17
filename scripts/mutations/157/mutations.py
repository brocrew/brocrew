#!/usr/bin/env python3
"""
157 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

`suite` is `runtime` for every entry: this ticket touches `packages/runtime` and nothing else, so
`desktop` and `dom` would print `NO-TESTS` on every row (154's note, in reverse).

⚠️ **Anchors are taken from the FORMATTED source.** 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the exact string the entry was anchored on. Every target here was
copied after the last format run, and `mutate.sh` refuses rather than reporting a green if one of
them stops matching.

⛔ **M1 is the live hole 069 A1 opened and this ticket closes**: a Codex session in `auto` reading
and writing `~/.codex/auth.json`. If it survives, this ticket did not close what it says it closed.
⛔ **M2 is the failure mode that would make the fix worthless**: a session denied its own cwd.
⛔ **M6 and M7 are the two ways to break `ask`**, which §3 says may not move at all — one stops it
prompting, the other makes the prompt's answer do nothing.
"""

import sys
from pathlib import Path

PROFILE = "packages/runtime/src/codex/permission-profile.ts"
RUNTIME = "packages/runtime/src/codex/codex-runtime.ts"
CONFINE = "packages/runtime/src/internal/confinement.ts"

# The three lines the whole deny set is. Each has its own mutation, and the ORDER of the last two is
# the carve-out rule — reversing it is M3.
REFUSED_LOOP = "  for (const root of roots.refused) entries.set(root, 'deny')\n"
OWN_LOOP = "  for (const root of roots.own) entries.set(root, 'write')\n"

# The launch-order line. It must come BEFORE `transportFactory`, because the app-server reads its
# config once at startup — see M11.
START_WRITE = (
    "    this.writePermissionProfiles(opts.cwd, opts) "
    "// …and the profiles the spawn is about to read (157)\n"
    "    const transport = this.transportFactory({ cwd: opts.cwd, providerHome: opts.providerHome })\n"
)

# (name, suite, [(file, old, new), ...])
MUTATIONS = [
    # ---- §Ruling · the deny set, and the carve-outs that keep the session alive ------------------
    (
        "M1 · THE 069 A1 HOLE, BACK · auto denies nothing, so ~/.codex/auth.json is readable again",
        "runtime",
        [(PROFILE, REFUSED_LOOP, "")],
    ),
    (
        "M2 · …and the opposite failure: no carve-outs, so a session cannot reach its own cwd or home",
        "runtime",
        [(PROFILE, OWN_LOOP, "")],
    ),
    (
        "M3 · the two loops swap order, so the deny beats the carve-out it contains",
        "runtime",
        [(PROFILE, REFUSED_LOOP + OWN_LOOP, OWN_LOOP + REFUSED_LOOP)],
    ),
    (
        "M4 · the blanket grant becomes read-only — auto keeps the machine but loses every write",
        "runtime",
        [(PROFILE, "new Map<string, 'write' | 'deny'>([['/', 'write']])", "new Map<string, 'write' | 'deny'>([['/', 'deny']])")],
    ),
    (
        "M5 · the network stays off, which :workspace does and danger-full-access never did",
        "runtime",
        [(PROFILE, "    'enabled = true',", "    'enabled = false',")],
    ),
    # ---- §3 · the two ways to break `ask`, which must not move at all ----------------------------
    (
        "M6 · ask extends :workspace, so an in-cwd write stops prompting (001 non-negotiable 1)",
        "runtime",
        [(PROFILE, "const ASK_EXTENDS = ':read-only'", "const ASK_EXTENDS = ':workspace'")],
    ),
    (
        "M7 · ask gains the deny set, so every APPROVED write silently does nothing",
        "runtime",
        [
            (
                PROFILE,
                "    'description = \"BroBot · ask — read-only, every action escalates to a prompt\"',\n"
                "    `extends = ${tomlString(ASK_EXTENDS)}`,",
                "    'description = \"BroBot · ask — read-only, every action escalates to a prompt\"',\n"
                "    `extends = ${tomlString(ASK_EXTENDS)}`,\n"
                "    `[permissions.${tomlString(CODEX_PERMISSION_PROFILES.ask)}.filesystem]`,\n"
                "    ...[...autoFilesystem(confinement)]\n"
                "      .filter(([, access]) => access === 'deny')\n"
                "      .map(([path, access]) => `${tomlString(path)} = ${tomlString(access)}`),",
            )
        ],
    ),
    # ---- §2 · the file, and what the app-server does with it -------------------------------------
    (
        "M8 · the default profile becomes the unattended one — a selector-less request stops asking",
        "runtime",
        [
            (
                PROFILE,
                "    `default_permissions = ${tomlString(CODEX_PERMISSION_PROFILES.ask)}`,",
                "    `default_permissions = ${tomlString(CODEX_PERMISSION_PROFILES.auto)}`,",
            )
        ],
    ),
    (
        "M9 · default_permissions is dropped — the server warns and falls back to its own defaults",
        "runtime",
        [
            (
                PROFILE,
                "    `default_permissions = ${tomlString(CODEX_PERMISSION_PROFILES.ask)}`,\n    '',\n",
                "",
            )
        ],
    ),
    (
        "M10 · TOML escaping is dropped, so a path with a quote or a newline breaks the file (153)",
        "runtime",
        [(PROFILE, "    if (char === '\"') out += '\\\\\"'", "    if (char === '\"') out += char")],
    ),
    (
        "M11 · the profile is written AFTER the spawn, so the app-server never reads it",
        "runtime",
        [
            (
                RUNTIME,
                START_WRITE,
                "    const transport = this.transportFactory({ cwd: opts.cwd, providerHome: opts.providerHome })\n"
                "    this.writePermissionProfiles(opts.cwd, opts)\n",
            )
        ],
    ),
    (
        "M12 · resume does not write it, so a home provisioned before this change can never reopen",
        "runtime",
        [(RUNTIME, "    this.writePermissionProfiles(ref.cwd, options)\n", "")],
    ),
    (
        "M13 · the 0600 mode is dropped from the file the deny set lives in",
        "runtime",
        [
            (
                PROFILE,
                "writeFileSync(path, renderCodexPermissionConfig(confinement), { mode: 0o600 })",
                "writeFileSync(path, renderCodexPermissionConfig(confinement))",
            )
        ],
    ),
    (
        "M14 · a symlinked provider home is followed instead of refused",
        "runtime",
        [
            (
                PROFILE,
                "  if (stat.isSymbolicLink()) throw new Error(`codex provider home is a symlink: ${providerHome}`)",
                "  if (false) throw new Error(`codex provider home is a symlink: ${providerHome}`)",
            )
        ],
    ),
    # ---- §2 · the wire: one selector, and the legacy fields that may not ride with it -------------
    (
        "M15 · thread/start sends the legacy sandbox alongside the profile — -32600 on every launch",
        "runtime",
        [
            (
                RUNTIME,
                "    permissions: CODEX_PERMISSION_PROFILES.ask,\n  },\n  auto: {",
                "    permissions: CODEX_PERMISSION_PROFILES.ask,\n    sandbox: 'read-only',\n  },\n  auto: {",
            )
        ],
    ),
    (
        "M16 · turn/start stops carrying the profile, so a mid-conversation mode switch is silent",
        "runtime",
        [(RUNTIME, "    permissions: profile.permissions,\n", "")],
    ),
    (
        "M17 · the two modes' profiles are swapped — ask runs unattended and auto prompts",
        "runtime",
        [
            (
                RUNTIME,
                "    permissions: CODEX_PERMISSION_PROFILES.ask,\n  },\n  auto: {\n    approvalPolicy: 'never',\n    approvalsReviewer: 'user',\n    permissions: CODEX_PERMISSION_PROFILES.auto,",
                "    permissions: CODEX_PERMISSION_PROFILES.auto,\n  },\n  auto: {\n    approvalPolicy: 'never',\n    approvalsReviewer: 'user',\n    permissions: CODEX_PERMISSION_PROFILES.ask,",
            )
        ],
    ),
    # ---- §2 · the validator, which is the only thing that reads the answer back -------------------
    (
        "M18 · the validator stops reading activePermissionProfile — any profile passes as ours",
        "runtime",
        [
            (
                RUNTIME,
                "  const activeId = isRecord(activeProfile) ? activeProfile['id'] : activeProfile\n  if (activeId !== expected.permissions)",
                "  const activeId = expected.permissions\n  if (activeId !== expected.permissions)",
            )
        ],
    ),
    (
        "M19 · …and stops checking that auto still has the whole machine writable",
        "runtime",
        [
            (
                RUNTIME,
                "    if (!Array.isArray(roots) || !roots.includes('/'))",
                "    if (false)",
            )
        ],
    ),
    (
        "M20 · …and stops checking that auto still has the network danger-full-access had",
        "runtime",
        [
            (
                RUNTIME,
                "    if (network !== true) problems.push(`networkAccess=${JSON.stringify(network)} (must be true)`)",
                "    if (false) problems.push(`networkAccess=${JSON.stringify(network)} (must be true)`)",
            )
        ],
    ),
    # ---- 032 · the rule the list is derived from -------------------------------------------------
    (
        "M21 · confinedRoots returns one spelling, so a symlinked root is denied under only one name",
        "runtime",
        [
            (
                CONFINE,
                "  const spellings = (list: ResolvedRoot[]): string[] => [\n    ...new Set(list.flatMap((root) => [root.lexical, root.real])),\n  ]",
                "  const spellings = (list: ResolvedRoot[]): string[] => [\n    ...new Set(list.map((root) => root.lexical)),\n  ]",
            )
        ],
    ),
    (
        "M22 · …and the reach-in filter is bypassed, so a symlinked cwd carves out the credential store",
        "runtime",
        [
            (
                CONFINE,
                "  return { own: spellings(roots.own), refused: spellings(roots.protectedRoots) }",
                "  return {\n    own: [confinement.cwd, confinement.providerHome].map((root) => resolve(root)),\n    refused: spellings(roots.protectedRoots),\n  }",
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
    if sys.argv[1] == "--suite":
        print(MUTATIONS[int(sys.argv[2])][1])
        return 0

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, _, edits = MUTATIONS[index]
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
