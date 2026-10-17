"""408 · only the delegating tiers — each row is THE DEFECT, put back (131).

🔴 **One subject: WHICH conversations lose the provider's own delegation door.** ⛔ `407` shut it on
`SessionSlot.spawnedBy !== null` — *this app created it* — and the person ruled the opposite way round:

> ⛔ *"Only the main BroBot agent should not be allowed to run sub agents, and maybe also the PM. But
> apart from that, Agents can do whatever they want. They can spawn their own internal agents or
> dynamic workflows or whatever."*

⚑ **So the predicate is the identity's own `can_spawn`** — the field `admitSpawn` already spends, so
one rule and not two (`169` §1) — with `null` (no readable grant) failing CLOSED.

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M4` | ⚑ **`run_suite`** — `apps/desktop/test/only-the-delegating-tiers.test.ts` |
| `M5`, `M6` | ⚑ **`run_suite`** — `apps/desktop/test/only-the-delegating-tiers.test.ts` |
| `M7`–`M10` | ⚑ **`run_suite`** — `apps/desktop/test/consent-never-containment.test.ts` |

⚠️ **`M1` and `M4` are also seen by `a-parent-that-survives-a-restart.test.ts` §8**, which is where
`407` put its own start-and-resume pair; the row is verified against the file that OWNS the subject.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row keying the predicate on `role`.** ⚑ HO-016 §3 is standing and `374` already refused it,
but the deeper reason is that it is not a text substitution: `nativeDelegationContext` is handed a
`ProfileCapabilities`, and a role-keyed version would have to be given the store instead — a
different function, not this one with a line changed.

⛔ **No row inside `codexAppServerArgs` beyond `M9`.** `407` owns that function and its own tests pin
the three argv arms; what `408` added to it is the enumeration in its docblock, and a docblock is not
a row.

⛔ **No row removing `Task` from the list.** ⚠️ It reads as a row and is not one: `disallowedTools`
is a name list and `Task` names nothing in the pinned SDK, so removing it changes what the provider
is asked for by exactly nothing — a mutation whose value never differs is a phantom survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ `M5` and `M6` move the two names that
DO change the launch.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
SHARED = "apps/desktop/src/shared/capabilities.ts"
CLAUDE_RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
START = "        ...nativeDelegationContext(delegationGrantsOf(this.deps.store, profileId)),\n"

RESUME = "        ...nativeDelegationContext(delegationGrantsOf(this.deps.store, row.profileId)),\n"

CLOSED = "  if (capabilities === null) return { disableNativeMultiAgentDelegation: true }\n"

GRANTED = (
    # Use producesAConversationOfItsOwn because both spawn and staffing grants create conversations.
    # Checking only canSpawn would exempt the manager tier from this rule.
    "  return producesAConversationOfItsOwn(capabilities)\n"
    "    ? { disableNativeMultiAgentDelegation: true }\n"
    "    : {}\n"
)

LIST = "export const NATIVE_MULTI_AGENT_DELEGATION_TOOLS = ['Agent', 'Workflow', 'Task'] as const\n"

ARGV = "    ? ['app-server', '--config', 'agents.enabled=false']\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the scope, which is the whole finding ─────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The whole subject of 408 (which
        # conversations lose native delegation) was removed on purpose. Commit: "The CLIs' own
        # sub-agents stay on for every agent: no Agent/Task/Workflow deny list for Claude, no
        # agents.enabled=false for Codex". Its anchor is left stale, so the census records it
        # retired.
        "M1 · 🔴 the shipped defect, put back · the launch asks *did this app create it* instead of "
        "*may this identity create agents*, so a worker loses the provider delegation the person said it "
        "may have and BroBot's own conversation keeps the door `402` F4 measured a model walking "
        "through. ⚠️ `407`'s predicate, exactly",
        [
            (
                HOST,
                START,
                "        ...(slot.spawnedBy === null ? {} : { disableNativeMultiAgentDelegation: true as const }),\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The fail-closed `capabilities === null`
        # arm of nativeDelegationContext was deleted with the deny list. Card: "the CLIs' own
        # sub-agents stay on for every agent (today any start grant turns them off)". A first launch
        # that keeps native delegation is now the rule. Its anchor is left stale, so the census
        # records it retired.
        "M2 · ⛔ the first launch fails OPEN · an identity with no row yet is treated as one that may "
        "create nobody, so the very first conversation of every profile launches with the provider's "
        "native delegation intact — `402` F3's ordering means `store.create` runs AFTER the provider "
        "is started, so this is every identity's first launch and not a corner",
        [(HOST, CLOSED, "  if (capabilities === null) return {}\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** producesAConversationOfItsOwn and the
        # whole predicate are gone. The row's defect (every identity loses delegation) is the
        # opposite of D-014, and the rule it protected (only granted tiers lose it) was withdrawn:
        # no agent loses it now. Its anchor is left stale, so the census records it retired.
        "M3 · ⛔ an EMPTY grant counts as a grant · every identity is a delegating tier, so a worker "
        "granted nobody loses its provider's own delegation — `407`'s over-reach arriving through "
        "the new predicate, and the half of the person's ruling that says *apart from that, Agents can do "
        "whatever they want*",
        [
            (
                HOST,
                GRANTED,
                "  return capabilities.canSpawn.length >= 0 ? { disableNativeMultiAgentDelegation: true } : {}\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The resume-path nativeDelegationContext
        # spread was deleted with the start-path one (commit: "no Agent/Task/Workflow deny list").
        # Start and resume can no longer disagree, because neither passes a delegation flag. Its
        # anchor is left stale, so the census records it retired.
        "M4 · 🔴 the RESUME keeps `407`'s question · a conversation's answer changes when the app is "
        "restarted: a granted identity reopens with the door open and an app-created worker reopens "
        "with it shut. ⚠️ The half-migrated shape — one path moved, the other left — which is the "
        "defect a start-only test cannot see",
        [
            (
                HOST,
                RESUME,
                "        ...(slot.spawnedBy === null ? {} : { disableNativeMultiAgentDelegation: true as const }),\n",
            )
        ],
    ),
    # ── §2 · the list, measured against the pin ────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted
        # NATIVE_MULTI_AGENT_DELEGATION_TOOLS (claude-runtime.ts), and deniedToolNames now holds
        # only forbiddenExternalSpellings. Workflow staying available is D-014's decision ("no
        # Agent/Task/Workflow deny list for Claude"). Its anchor is left stale, so the census
        # records it retired.
        "M5 · 🔴 `Workflow` leaves the list · the pinned SDK ships it, its `script` fans out "
        "subagents through `agent()`/`parallel()`/`pipeline()`, and `407`'s list never named it — so "
        "a delegating tier keeps a door that starts a dozen agents at once. ⚑ The hole `407` left "
        "behind after its scope was corrected",
        [(CLAUDE, LIST, "export const NATIVE_MULTI_AGENT_DELEGATION_TOOLS = ['Agent', 'Task'] as const\n")],
    ),
    (
        "M6 · ⛔ `Skill` comes back · a document read into the SAME conversation is refused as though "
        "it were a dispatch — it mints no identity, adds no depth and creates no sibling, so it "
        "duplicates no governed verb and HO-019's class does not reach it. ⚠️ Removing a capability "
        "nobody asked us to remove is the over-reach in the other direction",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — D-014 kept and
        # widened the rule (the app never withholds a provider tool that duplicates no governed
        # verb); only-the-delegating-tiers.test.ts was deleted, so the killers are claude-runtime
        # and external-mcp. Re-verified RED alone.
        [
            # ⚑ **the providers' question tools are off · re-anchored in place, not retired** — NOT VERIFIED and HELD: the list now leads with Claude's own question tool, off on every launch; the row still adds Skill; its file is a runtime seat no mutant runs on without a written lift
            (CLAUDE_RUNTIME, "    const deniedToolNames = [...CLAUDE_TOOLS_TURNED_OFF, ...forbiddenExternalSpellings(externalMcp)]\n", "    const deniedToolNames = [\n      'Skill',\n      ...CLAUDE_TOOLS_TURNED_OFF,\n      ...forbiddenExternalSpellings(externalMcp),\n    ]\n"),
        ],
    ),
    # ── §3 · the disclosure, which `407` got wrong in both halves ──────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The disclosure sentence
        # (SPAWN_NATIVE_DELEGATION_MEANS in capabilities.ts) was deleted with the deny list it
        # described. There is no longer a scope for a sentence to name wrongly. Its anchor is left
        # stale, so the census records it retired.
        "M7 · 🔴 the disclosure keeps `407`'s scope · the sheet tells a person that *sessions this "
        "app spawns* lose native delegation, which is the tier that KEEPS it — a safety sentence "
        "naming the wrong sessions is worse than none",
        [
            (
                SHARED,
                # ⚠️ **464 corrected this anchor.** The clause named the grant `canSpawn` by the label
                # it wore at `408`; `456` renamed that label and `464` moved the sentence onto the new
                # one. ⛔ `M7`'s intent — *the disclosure keeps `407`'s scope* — is unchanged, and the
                # row was re-verified RED after the correction.
                "  'A conversation running as an identity that may start conversations as somebody has ' +\n",
                "  'Sessions this app spawns have provider-native delegation ' +\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** SPAWN_NATIVE_DELEGATION_MEANS is gone,
        # so there is no disclosure left to name BroBot. D-014's own rule ("no rule names an agent")
        # is carried by other D-014 tests, not by this sentence. Its anchor is left stale, so the
        # census records it retired.
        "M8 · ⛔ the disclosure names BroBot · a sentence that is FALSE the first time somebody "
        "narrows BroBot to none, which is one checkbox in the very sheet this string is rendered "
        "in. ⚠️ **`409` flipped which way it is wrong and not that it is wrong**: before the seed it "
        "was false on a fresh install and true after a grant; now it is true on a fresh install and "
        "false after a narrowing. ⚑ Standing rule 8: a sentence that DESCRIBES a capability drifts "
        "every time the capability changes, and a grant is a person's to move",
        [
            (
                SHARED,
                # ⚠️ **464 corrected this anchor** — the clause moved onto the next line when the
                # sentence was rewritten to name the grant by `456`'s label. Intent unchanged;
                # re-verified RED after the correction.
                "  'provider-native delegation disabled at launch, and so does one whose grants this app cannot ' +\n",
                "  'provider-native delegation disabled at launch — BroBot itself, and any agent you ' +\n"
                "  'have granted the right to start conversations as others. Codex is launched ' +\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** codexAppServerArgs now always returns
        # ['app-server'] (commit: "no agents.enabled=false for Codex"). The `agents.enabled=false`
        # arm this row widened was deleted on purpose. Its anchor is left stale, so the census
        # records it retired.
        "M9 · ⛔ the Codex launch asks for a second setting · `agents.enabled=false` is one key and "
        "the app adds another beside it, so a person reading the disclosure is told about one "
        "mechanism and the child is launched with two. ⚠️ Measured against the pinned app-server: "
        "the one key moves nothing outside the `[agents]` table, and a second one is a claim nobody "
        "checked",
        [
            (
                CODEX,
                ARGV,
                "    ? ['app-server', '--config', 'agents.enabled=false', '--config', 'tools.web_search=false']\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The fail-closed clause belonged to
        # SPAWN_NATIVE_DELEGATION_MEANS, which D-014 deleted together with the fail-closed launch
        # arm it described. No launch is restricted any more, so there is nothing to disclose. Its
        # anchor is left stale, so the census records it retired.
        "M10 · ⚠️ the disclosure drops the fail-closed clause · a person whose brand-new profile "
        "launches restricted has no sentence that explains it, and the one state every identity "
        "passes through on its first launch is the one the sheet does not mention",
        [
            (
                SHARED,
                # ⚠️ **464 corrected this anchor**, for `M8`'s reason and with the same intent.
                "  'provider-native delegation disabled at launch, and so does one whose grants this app cannot ' +\n",
                "  'provider-native delegation disabled at launch. Codex is launched with ' +\n",
            )
        ],
    ),
]
