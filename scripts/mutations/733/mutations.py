"""733 · The last credential guards.

⚑ **Ordered by** the PM, the closing wave: `731` F-2, F-3 and F-4, under R92 and R93 (the person,
2026-09-25): *"BroBot adds no file- or folder-access restriction of its own … not on what BroBot
itself opens for a person"* and *"no new guards and remove old guards"*.

## 🔴 A · `731` F-2 — a config file the Info panel lists opens like any other — M1–M9

M1–M4 are the host's door (`config-file.ts`, `RuntimeHost.readConfigFile`): gone, confined by a path
instead of a name, a refusal mis-worded, the resolved path reported for the named one. M5–M9 are
the panel: no Open, a path sent instead of a name, a read that outlives its conversation, a press
that does not close, a refusal in other words than the text door's.

## 🔴 B · `731` F-3 — the two readers follow links, and the two link rules that stay — M10–M16

M10 puts the refusal of a linked `.claude` directory back; M11 a loop no longer refused; M12–M13 a
link to nothing silent again on the walk; M14–M15 the memory-note row's own dangling word and size;
M16 its sentence. ⚑ The reader's own `lstat` — the refusal of a linked FILE — is `170 M4`, corrected
in place: since `733` that one line decides the walk's links and the memory index's alike.

## 🔴 C · `731` F-4, and what the design map says of the credential sentence — M17–M18

## 🔴 D · what `733`'s own review found the removed link refusal had been doing — M19–M24

M19 the home boundary where a link LANDS (`personal-home`); M20 one file reached by two names sent
once (`same-file`); M21 a followed link that does not say so; M22 an ended conversation's Open; M23
a read in flight across a conversation switch; M24 a paper left under a file a re-read says is gone.

⚑ Retired by the same rulings, each named in its own table, are listed by the census.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CONFIG = "apps/desktop/src/main/config-file.ts"
INFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"
READER = "apps/desktop/src/main/runtime/instructions.ts"
NOTES = "apps/desktop/src/main/runtime/memory-notes.ts"
NOTE_ROW = "apps/desktop/src/renderer/src/components/MemoryNoteEntry.vue"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
MAP = "apps/desktop/src/renderer/src/lib/design-v2-map.ts"

GUARDS = "the-last-credential-guards.test.ts"
PANEL = "a-config-file-opens-like-any-other.dom.test.ts"
WALK = "instructions.test.ts"
ROW = "memory-notes.test.ts"
ROW_WORDS = "memory-you-can-watch.dom.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · `731` F-2 ────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the Open's door refuses every file** — the host answers `no-path` for a session it "
        f"holds, which is the panel before `733` with a button on it — killed by `{GUARDS}` (733)",
        [
            (
                HOST,
                "  readConfigFile(sessionId: string, name: string): ConfigFileResult {\n    const live",
                "  readConfigFile(sessionId: string, name: string): ConfigFileResult {\n    if (sessionId) return { ok: false, reason: 'no-path' }\n    const live",
            )
        ],
    ),
    (
        "M2 · ⛔ **the confinement is a PATH beside the home, not a NAME the config declares** — a "
        "guessed name reaches a file, and `../../auth.json` walks out of the home — killed by "
        f"`{GUARDS}` (733)",
        [
            (
                CONFIG,
                "  const path = files.find((file) => file.name === name)?.path\n",
                "  const home = files[0]?.path.replace(/[^/]*$/, '')\n  const path = home === undefined ? undefined : home + name\n",
            )
        ],
    ),
    (
        "M3 · 🔴 **a declared file that is not there says `no-path`, not `gone`** — the row would say it "
        f"names nothing, beside a reveal that says the file went — killed by `{GUARDS}` (733)",
        [
            (
                CONFIG,
                "  if (!resolved.ok) return { ok: false, reason: resolved.reason }\n",
                "  if (!resolved.ok) return { ok: false, reason: 'no-path' }\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the path reported back is where the link LANDED, not the row the person pressed** — "
        f"killed by `{GUARDS}` (733; macOS resolves the scratch home through `/private`)",
        [
            (
                CONFIG,
                "  return { ok: true, path, name: basename(path), ...read }\n",
                "  return { ok: true, path: resolved.path, name: basename(path), ...read }\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **no Open on a config row** — Finder and nothing else, as before `733` — killed by "
        f"`{PANEL}` (733)",
        [(INFO, '              v-if="file.exists && props.onReadConfigFile"\n', '              v-if="false"\n')],
    ),
    (
        "M6 · ⛔ **the Open sends the PATH the panel drew, not the file's NAME** — every door here takes "
        f"a row, never a path — killed by `{PANEL}` (733)",
        [(INFO, '              @click="readConfig(file.name)"\n', '              @click="readConfig(file.path)"\n')],
    ),
    (
        "M7 · 🔴 **a read outlives the conversation it was made in** — keyed by NAME, the next "
        f"conversation's `auth.json` row would show this one's text — killed by `{PANEL}` (733)",
        [(INFO, "    revealRefusal.value = null\n    reading.value = null\n", "    revealRefusal.value = null\n")],
    ),
    (
        "M8 · ⚠️ **a second press does not close the paper** — the provider rows' gesture, missing here "
        f"— killed by `{PANEL}` (733)",
        [
            (
                INFO,
                "  if (reading.value?.name === name) {\n    reading.value = null\n    return\n  }\n",
                "",
            )
        ],
    ),
    (
        "M9 · ⚠️ **a file that cannot be drawn as text is refused in other words than the text door's** "
        f"— killed by `{PANEL}` (733)",
        [
            (
                INFO,
                "  'not-readable': 'it cannot be shown as text here',\n",
                "  'not-readable': 'that file is not one this app will open',\n",
            )
        ],
    ),
    # ── B · `731` F-3 ────────────────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 **a `.claude` directory that is a link is not walked into** — killed by "
        f"`{WALK}` (733)",
        [
            (
                READER,
                "    const dotUsable = safeStat(dot)?.isDirectory() === true\n",
                "    const dotUsable = lstatSync(dot, { throwIfNoEntry: false })?.isDirectory() === true\n",
            )
        ],
    ),
    (
        "M11 · ⚑ **a LOOP of links is `unreadable`, not refused as a link** — the kept rule's word — "
        f"killed by `{WALK}` (733, the loop control) and `{ROW}`",
        [
            (
                READER,
                "    if (isAbsent(error)) return { ok: false, reason: 'absent' }\n"
                "    return { ok: false, reason: isSymlinkError(error) ? 'symlink' : 'unreadable' }\n",
                "    if (isAbsent(error)) return { ok: false, reason: 'absent' }\n"
                "    return { ok: false, reason: 'unreadable' }\n",
            )
        ],
    ),
    (
        "M12 · 🔴 **a `CLAUDE.md` that is a link to nothing goes SILENT on the walk** — it had a row while "
        f"the walk refused every link — killed by `{WALK}` (733)",
        [
            (
                READER,
                "      const said = read.reason === 'absent' ? brokenMemoryLink(path) : { path, reason: read.reason }\n",
                "      const said = read.reason === 'absent' ? null : { path, reason: read.reason }\n",
            )
        ],
    ),
    (
        "M13 · 🔴 **…and so does a `.claude` directory that is a link to nothing** — killed by "
        f"`{WALK}` (733)",
        [(READER, "      if (broken !== null) refused.push(broken)\n    }\n", "    }\n")],
    ),
    (
        "M14 · 🔴 **a memory note that is a link to nothing reads as a note that vanished** — killed by "
        f"`{ROW}` (733)",
        [
            (
                NOTES,
                "    const unread = read.reason === 'absent' && isALink(path) ? 'dangling-link' : read.reason\n",
                "    const unread = read.reason\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ **a linked note's size is dropped while its text is the target's** — `lstat` sees "
        f"a link, not a file, so the row prints no size for a note it did read — killed by `{ROW}` (733)",
        [(NOTES, "    const seen = statSync(path)\n", "    const seen = lstatSync(path)\n")],
    ),
    (
        "M16 · ⚠️ **the row has no sentence for a link to nothing, and prints the code** — killed by "
        f"`{ROW_WORDS}` (733)",
        [(NOTE_ROW, "  'dangling-link': 'a link with nothing at the other end',\n", "")],
    ),
    # ── C · `731` F-4, and the design map ────────────────────────────────────────────────────────
    (
        "M17 · 🔴 **the person's clause says *Markdown* again** — a condition the store does not have "
        f"— killed by `{GUARDS}` (733)",
        [
            (
                TRANSCRIPT,
                "    'it can write a file of a type this app holds and offer that instead',\n",
                "    'it can offer a different Markdown file',\n",
            )
        ],
    ),
    (
        "M18 · ⛔ **the design map files the credential sentence `supported` again** — a promise the "
        "product no longer keeps, counted as kept — killed by `the-map-before-the-move.test.ts` (733)",
        [
            (
                MAP,
                "    quote: 'Credential file contents are never previewed here.',\n    heldIn: ['v2.3'],\n    verdict: 'false',\n",
                "    quote: 'Credential file contents are never previewed here.',\n    heldIn: ['v2.3'],\n    verdict: 'supported',\n",
            )
        ],
    ),
    # ── D · what the removed link refusal had been doing ───────────────────────────────────────
    # 🔴 **RETIRED BY RULING at `736`** — `733` F-1 under R92: a project link into the person's own `~/CLAUDE.md` or `~/.claude/CLAUDE.md` is followed, as the CLI follows it (measured). The `personal-home` refusal this row mutated is gone; table `736` M23 puts it back as the defect.
    (
        "M19 · 🔴 **a link that lands in the person's OWN instructions is appended** — a `.claude` or "
        "a `CLAUDE.md` pointed into home carries personal memory past the home boundary (168 H4, at "
        f"the leaf) — killed by `{WALK}` (733)",
        [(READER, "    if (isPersonalInstruction(real, home)) {\n", "    if (false) {\n")],
    ),
    (
        "M20 · 🔴 **one file reached by two names is sent twice** — `CLAUDE.md -> AGENTS.md`, a common "
        f"convention, appends the same conventions twice (HO-075 §1) — killed by `{WALK}` (733)",
        [(READER, "    if (taken.has(real)) {\n", "    if (false) {\n")],
    ),
    (
        "M21 · ⚠️ **a followed link does not say where it led** — another file's text under this path, "
        f"and nothing on the row — killed by `{WALK}` (733)",
        [(READER, "  return real === derived ? undefined : real\n", "  return undefined\n")],
    ),
    (
        "M22 · 🔴 **an ENDED conversation's config file does not open** — the panel draws the row and "
        f"the door answers `no-path` under it — killed by `{GUARDS}` (733)",
        [(HOST, "    if (row === null) return { ok: false, reason: 'no-path' }\n    const home = this.providerHomeFor(row)\n",
          "    if (row === null || row !== null) return { ok: false, reason: 'no-path' }\n    const home = this.providerHomeFor(row)\n")],
    ),
    (
        "M23 · 🔴 **a read in flight at a conversation switch lands in the next conversation's row** "
        f"— killed by `{PANEL}` (733)",
        [(INFO, "    // to a press made in conversation A lands under B's row of the same name.\n    pressed += 1\n",
          "    // to a press made in conversation A lands under B's row of the same name.\n")],
    ),
    (
        "M24 · ⚠️ **a paper stays under a file a re-read says is gone**, with no button left to close "
        f"it — killed by `{PANEL}` (733)",
        [(INFO, "    if (!config.value.files.some((file) => file.name === open.name && file.exists)) {\n",
          "    if (false) {\n")],
    ),
]
