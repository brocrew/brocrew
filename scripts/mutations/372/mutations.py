"""372 · Five filesystem identities that a plain ``realpathSync`` leaves as spellings.

⛔ **Each row restores the defect this investigation measured.** On this machine's case-folding
APFS volume, the ordinary Node wrapper resolves links but preserves the caller's case and Unicode
spelling. ``realpathSync.native`` returns the filesystem's spelling. A containment decision made
between one of each is therefore still a string comparison, even though both values were called
"real".

## What each row defends

| row | boundary restored by the mutation | gate that must turn red |
|---|---|---|
| ``M1`` | a structured Claude path under either protected root is called ``outside`` | runtime · ``confinement.test.ts`` |
| ``M2`` | a differently-cased cwd below the OS home walks into personal instructions | desktop · ``instructions.test.ts`` |
| ``M3`` | a legitimate image below the served provider-homes root becomes a 404 | desktop · ``asset-protocol.test.ts`` |
| ``M4`` | a legitimate child/workflow file below its read root becomes ``not-readable`` | desktop · ``child-work.test.ts`` |
| ``M5`` | a legitimate provider-named image below ``generated_images`` is discarded | runtime · ``generated-image.test.ts`` |

⚠️ **The three local resolvers remain three local resolvers on purpose.** Asset serving collapses
every failure to a 404/null, the text reader returns a tagged refusal, and generated-image lookup
returns no claim. This table changes filesystem spelling only; it does not route those distinct
failure policies through one helper.

## What this table deliberately does not mutate

- ``spawn-rails.ts`` keeps its lexical pre-I/O entitlement check. A case-only descendant can be
  conservatively refused before the native arm, but changing that requires a ruling about the
  no-existence-oracle order; replacing a resolver cannot settle it.
- ``provider-home.ts`` likewise performs its lexical boundary check before its bare ``realpath``.
  Its app callers derive both paths from one managed root, and changing the later call alone would
  not change that verdict.
- Codex home attestation, home-boot map keys and Claude's default-memory derivation compare exact
  identity, serialize work, or mirror provider naming; they are not inside-root decisions.

⚠️ The shared runner's reachability manifest is an exact historical list and does not name these
five product files. It must therefore take its conservative ``ALL`` route for each row; the table
does not claim the targeted gate is the only project the runner executes.
"""

REAL_PATH = "packages/runtime/src/internal/real-path.ts"
INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
ASSET_PROTOCOL = "apps/desktop/src/main/asset-protocol.ts"
READ_TEXT_FILE = "apps/desktop/src/main/read-text-file.ts"
GENERATED_IMAGE = "packages/runtime/src/codex/generated-image.ts"

MUTATIONS = [
    (
        # 🔴 **RETIRED BY RULING at `726` — R92 removed the guard it measured, and the row is
        # measured to SURVIVE.** Both comparisons it names were the protected-root scan's; R92 removed
        # the scan. `realResolve` still serves the plan-file and memory ALLOWANCES, where an alias
        # keeping its case is refused the allowance (a card — the safe direction). Verified at `726`
        # (`verify_row.py`, killers `real-path`, `confinement`, `claude-runtime`): SURVIVED.
        "M1 · 🔴 THE SECOND SAME-KEYSTROKE BYPASS · the deepest existing ancestor keeps "
        "the caller's spelling again, so both protected-root comparisons can miss one physical "
        "root and classify its path as `outside` instead of `refused` "
        "· ⚠️ EXPECTED SURVIVOR since 726 (R92 removed the guard)",
        [
            (
                REAL_PATH,
                "return join(realpathSync.native(head), ...[...tail].reverse())",
                "return join(realpathSync(head), ...[...tail].reverse())",
            )
        ],
    ),
    (
        "M2 · ⛔ the OS-home boundary keeps the cwd's alternate spelling, so neither its lexical "
        "nor purportedly-real arm recognizes home and the project walk reads the personal "
        "`CLAUDE.md` files above the repository",
        [
            (
                INSTRUCTIONS,
                "return join(realpathSync.native(at), ...tail)",
                "return join(realpathSync(at), ...tail)",
            )
        ],
    ),
    (
        # ⚑ **`726` · R92 — the root this label names is gone, and so was the killer; the defect is
        # not.** The door's answer is the path the host RECORDS for an image, so an alias's case
        # would be written into the ledger. Its killer is now `asset-protocol.test.ts`'s *"a case
        # alias of an image is served under the file’s OWN spelling"*, and the row re-verified RED.
        "M3 · ⚠️ the asset door preserves an untrusted URL's case, so a real generated image "
        "inside the provider-homes root is classified outside and returned as a 404; the paired "
        "outside-root request remains refused",
        [
            (
                ASSET_PROTOCOL,
                "return realpathSync.native(path)",
                "return realpathSync(path)",
            )
        ],
    ),
    (
        # 🔴 **RETIRED BY RULING at `726` — R92 removed the guard it measured, and the row is
        # measured to SURVIVE.** The case mattered only to the read ROOT a real path was compared
        # against (`readWithin`/`readWithinAny`); R92 removed the root, so a provider-recorded path
        # is read by its real path with nothing to compare it to. Verified at `726` (`verify_row.py`,
        # killers `child-work`, `workflow-output`, `instructions`, `runtime-host`): SURVIVED.
        "M4 · ⚠️ the shared text-file door preserves a provider-recorded path's case, so a "
        "real file inside its declared read root becomes `not-readable`; an equally cased file "
        "outside the root is still the control · ⚠️ EXPECTED SURVIVOR since 726 (R92 removed the guard)",
        [
            (
                READ_TEXT_FILE,
                "return { ok: true, path: realpathSync.native(path) }",
                "return { ok: true, path: realpathSync(path) }",
            )
        ],
    ),
    (
        "M5 · ⚠️ the Codex image resolver preserves the provider claim's case, so an existing "
        "raster inside `generated_images` is discarded as outside; a same-shaped real file beyond "
        "that root remains null",
        [
            (
                GENERATED_IMAGE,
                "return realpathSync.native(path)",
                "return realpathSync(path)",
            )
        ],
    ),
]
