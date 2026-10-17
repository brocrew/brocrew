"""731 · The last folder words, and a transcript found where it is.

⚑ **Ordered by** the PM, the closing wave (#1): `706` F-5, and two of `726` §9's kept checks, ruled on
2026-09-25:

> *"A TYPE check stays only where it is about what can be DRAWN (the viewer cannot draw a binary as
> text, or a non-image as an image). A type allow-list whose purpose is keeping credentials out
> goes: a text viewer opens any readable text file a person names, `auth.json` included."*
>
> *"HO-097's 'Keep it in the project folder' remedy becomes a habit, in §2a's words: files the agent
> creates go in its working folder unless it is asked to put them elsewhere. It is never a condition
> for anything to work."*

## 🔴 A · `706` F-5 — a Claude transcript found where the CLI recorded it — M1–M6

Each row puts back the cwd-named lookup at one of the three doors (the archive, the child-work
root, the export) or blinds the shared lookup, and names the `731` flip that notices.

## 🔴 B · the type allow-lists whose purpose was credentials — M7–M13

M7–M9 put an allow-list back at each door it was removed from; M10–M13 weaken what the ruling
KEPT — a binary is not drawn as text — and the refusal words `731`'s review found the lists had been
hiding (a file this user may not read, a socket).

## 🔴 C · HO-097's remedy, and the second act that named a folder — M14–M16

## 🔴 D · what a person is told — M17–M23

⚑ Retired by the same rulings, each annotated in its own table: `356 M26`, `356 M27`, `726 M16`.
Corrected in place and re-verified RED alone: `635 M11`, `635 M12`, `726 M10`.
"""

ADAPTER = "packages/runtime/src/claude/claude-runtime.ts"
NATIVE = "apps/desktop/src/main/archive/native-file.ts"
CHILD = "apps/desktop/src/main/child-work.ts"
EXPORT = "apps/desktop/src/main/archive/export-session.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
OUTPUT = "apps/desktop/src/main/workflow-output.ts"
SOURCE = "apps/desktop/src/main/instruction-source.ts"
TEXT = "apps/desktop/src/main/read-text-file.ts"
DOCUMENTS = "apps/desktop/src/main/documents/canonical-document.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"
FORMS = "apps/desktop/src/shared/documents.ts"
OUTPUT_VIEW = "apps/desktop/src/renderer/src/components/WorkflowOutputViewer.vue"
CHILD_VIEW = "apps/desktop/src/renderer/src/components/ChildWorkViewer.vue"
TOLD_VIEW = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
DOCUMENT_VIEW = "apps/desktop/src/renderer/src/components/CanonicalDocumentViewer.vue"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

FOUND = "a-transcript-found-where-it-was-recorded.test.ts"
NAMED_FIRST = "  const first = at(named)\n  if (first !== null) return first\n"
THE_SCAN = "  for (const folder of folders) {\n    if (folder === named) continue\n"
NOT_TEXT = "    if (head.includes(0)) return 'not-readable'\n"
HABIT_TAIL = "  'directory, unless you’re asked to put them somewhere else.'\n"
KEEP = (
    "const KEEP_IT_AND_NAME_ITS_PATH =\n"
    "  ' Keep it and name its path in your summary instead. Put the files you create in your working ' +\n"
    + HABIT_TAIL
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · `706` F-5 ───────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the lookup asks only the folder named from the cwd** — the scan of every project "
        f"folder goes, so a symlinked, moved or over-long folder's transcript is not found — killed by `{FOUND}` (731)",
        [(ADAPTER, THE_SCAN, "  for (const folder of [] as string[]) {\n    if (folder === named) continue\n")],
    ),
    (
        "M2 · ⛔ **the named folder is no longer FIRST** — the scan alone decides, so a copy of the id in "
        "any other folder wins over the one the preflight tries first — killed by "
        f"`{FOUND}` (731, the held-twice control)",
        [(ADAPTER, NAMED_FIRST, ""), (ADAPTER, "    if (folder === named) continue\n", "")],
    ),
    (
        "M3 · 🔴 **the archive names Claude's folder from the cwd again** — `706` F-5 itself: a conversation "
        f"Claude still resumes is never archived — killed by `{FOUND}` (731)",
        [
            (
                NATIVE,
                "      ? claudeTranscriptPath(ref.sessionId, ref.cwd, providerHome)\n",
                "      ? join(providerHome, 'projects', ref.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${ref.sessionId}.jsonl`)\n",
            )
        ],
    ),
    (
        "M4 · 🔴 **the child-work root is named from the cwd again** — a parent recorded elsewhere shows "
        f"every child `gone` — killed by `{FOUND}` (731)",
        [
            (
                CHILD,
                "  const transcript = claudeTranscriptPath(parent.sessionId, parent.cwd, providerHome)\n",
                "  const transcript: string | null = null\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **the export ignores where the CLI recorded it** — a cwd past 200 characters is exported "
        f"into an uncut folder only a scan finds — killed by `{FOUND}` (731)",
        [
            ('apps/desktop/src/main/archive/export-session.ts', "import type { SessionRef } from '@brobot2/runtime'", "import { claudeProjectDirName, type SessionRef } from '@brobot2/runtime'"),
            ('apps/desktop/src/main/archive/export-session.ts', "    return join(targetHome, 'projects', basename(dirname(recordedAt)), `${ref.sessionId}.jsonl`)", "    return join(targetHome, 'projects', claudeProjectDirName(ref.cwd), `${ref.sessionId}.jsonl`)"),
        ],
    ),
    (
        "M6 · ⛔ **the host hands the export no recorded file** — the door is right and nothing reaches it "
        f"— killed by `{FOUND}` (731, through the host)",
        [
            ('apps/desktop/src/main/runtime/runtime-host.ts', '    const path = this.deps.nativeTranscriptPath(row.provider, this.providerHomeFor(row), row.ref)\n', '    const path: string | null = null\n'),
        ],
    ),
    # ── B · the type allow-lists ────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 **a workflow's output must carry one of eight text extensions again** — the list whose "
        "point was *that a private key is not on it* — killed by `workflow-output.test.ts` (731)",
        [
            (
                OUTPUT,
                "  const real = resolved.path\n",
                "  const real = resolved.path\n"
                "  if (!/\\.(output|md|markdown|txt|json|jsonl|log|csv)$/i.test(real)) return 'not-readable'\n",
            )
        ],
    ),
    (
        "M8 · 🔴 **an instruction file must be Markdown again** — `auth.json` refused on a provider's say-so "
        "— killed by `the-layer-a-file-belongs-to.test.ts` (731)",
        [
            (
                SOURCE,
                "  const read = readTextFile(resolved.path, MAX_INSTRUCTION_BYTES)\n",
                "  if (!/\\.(md|markdown)$/i.test(resolved.path)) return { ok: false, reason: 'not-readable' }\n"
                "  const read = readTextFile(resolved.path, MAX_INSTRUCTION_BYTES)\n",
            )
        ],
    ),
    (
        "M9 · 🔴 **a Codex child's rollout must end `.jsonl` again** — the check that *refuses nothing real* "
        "and existed to refuse `auth.json` — killed by `runtime-host.test.ts` (731)",
        [
            (
                HOST,
                "    const read = readChildFile(path, MAX_CHILD_WORK_BYTES)\n",
                "    if (!path.endsWith('.jsonl')) return { ok: false, reason: 'not-readable' }\n"
                "    const read = readChildFile(path, MAX_CHILD_WORK_BYTES)\n",
            )
        ],
    ),
    (
        "M10 · 🔴 **a binary is drawn as text** — the one type check the ruling KEPT goes, and a PNG named "
        "`.md` is mojibake on the paper — killed by `workflow-output.test.ts` (731)",
        [(TEXT, NOT_TEXT, "")],
    ),
    (
        "M11 · ⛔ **the binary check looks at the first bytes only** — a PNG's NUL is its ninth byte — "
        "killed by `workflow-output.test.ts` (731)",
        [(TEXT, NOT_TEXT, "    if (head.subarray(0, 4).includes(0)) return 'not-readable'\n")],
    ),
    (
        "M12 · ⛔ **every failed open is `gone` again** — a file that is there is drawn as *no longer on "
        "disk* (`731`'s review) — killed by `workflow-output.test.ts` (731)",
        [(TEXT, "    return whyItDidNotOpen(realPath, error)\n", "    return 'gone'\n")],
    ),
    (
        "M13 · ⛔ **a socket is called `unreadable`** — *it is there, and could not be read* about a thing "
        "that is not a file — killed by `workflow-output.test.ts` (731)",
        [
            (
                TEXT,
                "    return statSync(realPath).isFile() ? 'unreadable' : 'not-readable'\n",
                "    return 'unreadable'\n",
            )
        ],
    ),
    # ── C · the folder in an act ────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 **HO-097's remedy makes the folder part of the act again** — *keep it in the project "
        "folder* — killed by `the-last-folder-words.test.ts` (731) · killed by `documents-hold-what-agents-produce.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # remedy for a type the store does not hold names the act, then the factory habit, and never
        # a folder condition) still holds. `KEEP_IT_AND_NAME_ITS_PATH` moved to
        # resources/resources.ts. The plant puts back 'Keep it in the project folder…', dropping the
        # habit. Killed by `the-last-folder-words.test.ts`, `the-act-inside-the-cut.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # remedy constant KEEP_IT_AND_NAME_ITS_PATH now reads `Keep it where it is and name its path
        # in what you write instead.` (door-neutral, since three doors say it), so the old `in your
        # summary` text matches nothing. The plant puts the folder back into the first sentence
        # (`Keep it in the project folder`) and leaves the habit sentence alone; the killer asserts
        # the reason does not match /project folder/. Killed by `the-last-folder-words.test.ts`,
        # `the-act-inside-the-cut.test.ts`.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 4fe481a6 made the act say 'name its full path' and dropped 'instead'; the plant still makes the folder part of the act again.
            # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the refusal repeats the v6 core's folder habit now
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
            # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 says the core's folder clause as 'Use the assigned folder', and the refusal repeats it; the same defect on the new words
            (RESOURCES, "  ' Keep it where it is and name its full path in what you write. Use the assigned folder.'", "  ' Keep it in the project folder and name its full path in what you write. Use the assigned folder.'"),
        ],
    ),
    (
        "M15 · ⛔ **the remedy's habit drifts from the factory text's** — two sentences for one habit — "
        "killed by `the-last-folder-words.test.ts` (731)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # remedy's habit is the factory text's sentence word for word, so the two cannot drift)
        # still holds. `KEEP_IT_AND_NAME_ITS_PATH` in resources.ts ends with the habit. The plant
        # rewords its tail, so it differs from the factory sentence. Killed by
        # `the-last-folder-words.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # habit sentence is still the second half of the remedy, but D-016c re-split the string
        # literal, so the old line `'directory, unless you’re asked ...'` matches nothing; the line
        # is now `'in your working directory, unless you’re asked to put them somewhere else.'`
        # (curly apostrophe, count 1). The plant lets the remedy's habit drift from the factory
        # text's, which the killer holds equal. Killed by `the-last-folder-words.test.ts`.
        [
            # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the refusal repeats the v6 core's folder habit now
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
            # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 says the core's folder clause as 'Use the assigned folder', and the refusal repeats it; the same defect on the new words
            (RESOURCES, "Use the assigned folder.'", "Use the assigned folder, or else your working folder.'"),
        ],
    ),
    (
        "M16 · 🔴 **`summary-too-long` puts the long form IN your working directory again** — a folder in "
        "an act, after `726` let `resource_path` take a file anywhere — killed by "
        "`the-act-inside-the-cut.test.ts` (731)",
                # ⚑ **736 · corrected in place, not retired** — `733` F-4 renders the kinds of file;
                # the row still puts a folder in the act
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # `summary-too-long` refusal does not make a folder part of its act; a folder appears only
        # in the factory habit) still holds in reply-rails.ts. The plant adds 'in your working
        # directory' to the act's sentence. Killed by `the-act-inside-the-cut.test.ts`.
        [
            # ⚑ **602 · re-anchored in place, not retired** — Shared summary remedy retains files anywhere; same defect restricts it to the working directory. Source-only, NOT VERIFIED.
            (REPLY, "Put the rest in ${HELD_FORMS_SAID} and name its path in resource_paths;", "Put the rest in ${HELD_FORMS_SAID} in your working directory and name its path in resource_paths;"),
        ],
    ),
    # ── D · what a person is told ───────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 **a workflow output's refusal reads as a policy again** — *not something this app will "
        "open* — killed by `a-text-file-opens-where-it-can-be-read.dom.test.ts` (731)",
        [
            (
                OUTPUT_VIEW,
                "  'not-readable': 'That file cannot be shown as text here.',\n",
                "  'not-readable': 'That path is not something this app will open.',\n",
            )
        ],
    ),
    (
        "M18 · 🔴 **a child's refusal reads as a policy again** — killed by "
        "`a-text-file-opens-where-it-can-be-read.dom.test.ts` (731)",
        [
            (
                CHILD_VIEW,
                "  'not-readable': 'That file cannot be shown as text here.',\n",
                "  'not-readable': 'That path is not something this app will open.',\n",
            )
        ],
    ),
    (
        "M19 · 🔴 **an instruction file's refusal reads as a policy again** — *this app will not open "
        "that file* — killed by `the-panel-that-stopped-explaining-itself.dom.test.ts` (731)",
        [
            (
                TOLD_VIEW,
                "  'not-readable': 'it cannot be shown as text here',\n",
                "  'not-readable': 'this app will not open that file',\n",
            )
        ],
    ),
    (
        "M20 · 🔴 **the pane is the old four-name rule** — a `.sh` the list used to refuse opens on "
        "Markdown, its comment a heading — killed by `a-text-file-opens-where-it-can-be-read.dom.test.ts` (731)",
        [
            (
                OUTPUT_VIEW,
                "  props.result.ok ? textViewFor(props.result.name) : { raw: false, sourceOnly: false },\n",
                "  props.result.ok\n"
                "    ? { raw: /\\.(jsonl|json|log|csv)$/i.test(props.result.name), sourceOnly: false }\n"
                "    : { raw: false, sourceOnly: false },\n",
            )
        ],
    ),
    (
        "M21 · ⛔ **a page gets a Markdown pane** — `HO-097` §1.3's *source with some characters eaten, "
        "offered under a word that promises a rendering* — killed by "
        "`a-text-file-opens-where-it-can-be-read.dom.test.ts` (731)",
        [(FORMS, "  if (formOfName(name) === 'page') return { raw: true, sourceOnly: true }\n", "")],
    ),
    (
        "M22 · 🔴 **an undrawn image points at the project folder again** — where the registered copy "
        "never was — killed by `documents-hold-what-agents-produce.dom.test.ts` (731)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # viewer points at no project folder, because the kept copy was never there) still holds.
        # `CanonicalDocumentViewer.vue` survives with its `NOT_DRAWN` record, but the sentence was
        # reworded, so the old string is gone. The plant adds 'open the project folder to look at
        # it' to the image sentence. Killed by `documents-hold-what-agents-produce.dom.test.ts`.
        [
            (DOCUMENT_VIEW, "  image: 'This file is an image. It is kept, and this window cannot draw it yet.',\n", "  image: 'This file is an image. It is kept, and this window cannot draw it yet — open the project folder to look at it.',\n"),
        ],
    ),
    (
        "M23 · ⛔ **the export's note says *by this exact path* again** — the first half of where Claude "
        f"looks, as if it were the whole — killed by `{FOUND}` (731)",
        [
            (
                EXPORT,
                "Claude looks for a session in this folder first, then by its id — a home",
                "Claude finds a session by this exact path — a home",
            )
        ],
    ),
]


if __name__ == "__main__":
    raise SystemExit("run through mutate.sh, never directly")
