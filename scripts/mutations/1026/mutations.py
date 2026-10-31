"""1026 · D-026 · one door for the window to list files, and every file gets a title.

⚑ **Why `1026`**: card D-00N's table is `100N`. D-026 is one DEV commit, `1ba9c001` (over D-028's
docs page, `8e263334`, which has no rows).

## What it changed

* **The door**: one strict command, `filesKept`, answers the files kept in a conversation's tree, one
  conversation, or one piece, one row per file the same in all three scopes, in label order, then
  oldest first within a piece. Every window hears a kept file at once on D-019's channel
  (`RuntimeStatesMessage { moved, kept }`).
* **The titles**: every file is titled once, as it is kept, from its own bytes: a Markdown file's first
  `# ` heading outside a fenced block, a page's first `<title>` a browser would use, else its name;
  capped at 200 characters. A row kept before this build reads as its name.

 * `M1`–`M15` — the door, the walk, the push, and the title rules. Killed by the landing's
   `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`.
 * `M20`–`M29` — each door's stored title, the fallback, and the title reader's edges. Killed by the
   landing's `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`. (`M25` and `M30` were designed
   and dropped: they planted `M3`'s and `M4`'s defects again.)

Designed read-only by Sonnet 5.5 agents from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 24 of 24.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `6ff5b867` (the merges of `1ba9c001`, `03a0a207` and `de8dd56c`), none by a syntax, reference or type
  error. Each killer file ran green unmutated first.
"""

SESSION_STORE = "apps/desktop/src/main/db/session-store.ts"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"
AGENT_TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · every kept file is titled by its name alone · keptFor stops reading the bytes and gives each file its name as its title, so a Markdown heading and a page's <title> are never used at any of the three doors — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "    return { ok: true, files: files.map((file) => ({ ...file, title: resourceTitle(file) })) }\n", "    return { ok: true, files: files.map((file) => ({ ...file, title: file.name })) }\n"),
        ],
    ),
    (
        "M2 · `#Title` and `## Sub` are read as a level-1 heading · the heading pattern lets the space after the # be optional, so a hashtag, a shebang-like line or a level-2 heading titles the file — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RESOURCES, "    const heading = /^ {0,3}#(?:[ \\t]+(.*))?$/s.exec(line)\n", "    const heading = /^ {0,3}#(?:[ \\t]*(.*))?$/s.exec(line)\n"),
        ],
    ),
    (
        "M3 · a heading inside a fenced code block titles the file · no fence is ever opened, so a `# comment` in a shell snippet is taken for the first heading — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RESOURCES, "    const opening = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line)?.[1]\n", "    const opening = undefined as string | undefined\n"),
        ],
    ),
    (
        "M4 · a <title> inside an HTML comment titles the page · comments are no longer passed over, so a commented-out old title is read before the real one — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RESOURCES, "  const markup = /<!--|<(title|script|style|svg|math)(?=[\\s/>])/gi\n", "  const markup = /<(title|script|style|svg|math)(?=[\\s/>])/gi\n"),
        ],
    ),
    (
        "M5 · a reply's files and a give's inputs are stored with no title · the reply door writes title null and the store writes null for a give's input, so the door reads them as their names (update_work, the third door, is pinned by the D-024 test) — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "              role: 'made',\n              title: file.title,\n", "              role: 'made',\n              title: null,\n"),
            (SESSION_STORE, "          'input',\n          input.title,\n", "          'input',\n          null,\n"),
        ],
    ),
    (
        "M6 · files are in label order compared as text · inLabelOrder compares each level of the numbers as strings, so R.10 is listed before R.2 — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (SESSION_STORE, "    const apart = (a[level] ?? 0) - (b[level] ?? 0)\n", "    const apart = String(a[level] ?? 0).localeCompare(String(b[level] ?? 0))\n"),
        ],
    ),
    (
        "M7 · the tree scope stops one generation down · the walk under the held pieces never recurses, so a piece given by a conversation below the holder (and its files) is missing from the holder's tree — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (SESSION_STORE, "           SELECT w.id FROM work w JOIN held h ON w.parent_id = h.id\n", "           SELECT w.id FROM work w JOIN held h ON w.parent_id = h.id AND 0\n"),
        ],
    ),
    (
        "M8 · a conversation that took another's place forgets what the replaced one gave · the tree scope asks for the asked conversation's own gives only, not those of the conversations it stands in for — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "        givers: this.theIdsItStandsFor(asked.conversation),\n", "        givers: [asked.conversation],\n"),
        ],
    ),
    (
        "M9 · a renamed piece keeps its title as given · currentWorkTitle prefers the title the give carried over the newest retitle, so a file's piece is stale after the giver renames it — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            # The shared title helper still gives a current retitle precedence over the give.
            ("apps/desktop/src/main/db/current-work-title.ts", "  return typeof retitled?.title === 'string' ? retitled.title : given\n", "  return given ?? (typeof retitled?.title === 'string' ? retitled.title : null)\n"),
        ],
    ),
    (
        "M10 · a file kept before titles were taken reads with an empty title · the one mapper stops falling back to the file's name for a null stored title — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "    title: resource.title ?? resource.name,\n", "    title: resource.title ?? '',\n"),
        ],
    ),
    (
        "M11 · a conversation scope that names no conversation answers an empty list · the existence check is gone, so an unknown conversation reads as one that holds no files instead of answering no-such-conversation — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "    } else if (this.deps.store.conversationBinding(asked.conversation) === null) {\n", "    } else if (false) {\n"),
        ],
    ),
    (
        "M12 · a reply keeps its files and tells no window · the reply door no longer marks its files as kept, so the push never carries them — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "    this.filesWereKept(piece.piece, resources)\n", "    void resources\n"),
        ],
    ),
    (
        "M13 · a give hands over inputs and tells no window · recordTheGive no longer marks the inputs as kept, so the piece's input files are never pushed — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "    this.filesWereKept(piece.piece, piece.inputs)\n", "    void piece.inputs\n"),
        ],
    ),
    (
        "M14 · update_work keeps files and tells no window · the update_work door no longer marks its rows as kept — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "    this.filesWereKept(named.piece, rows)\n", "    void rows\n"),
        ],
    ),
    (
        "M15 · a push re-sends every file on the piece · the flush stops keeping only the files this keep wrote, so each keep repeats the piece's earlier files to every window — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts` — killed by `a-kept-file-is-titled-by-its-bytes-and-listed-by-one-door.test.ts`",
        [
            (RUNTIME_HOST, "          .filter((row) => resources.includes(row.resource.resource))\n", "          .filter(() => true)\n"),
        ],
    ),
    (
        "M20 · a reply's file is stored under its name · the reply door writes file.name where it wrote the title taken from the file's bytes, so a Markdown report handed back with reply_to_parent is titled report.md and never by its heading — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (RUNTIME_HOST, "              role: 'made',\n              title: file.title,\n", "              role: 'made',\n              title: file.name,\n"),
        ],
    ),
    (
        "M21 · a give's input is stored under its name · give_work's inputs carry file.name as their title, so a brief handed over with the work reads as brief.md and never as its heading — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (RUNTIME_HOST, "        resource: newResourceId(),\n        title: file.title,\n", "        resource: newResourceId(),\n        title: file.name,\n"),
        ],
    ),
    (
        "M22 · an update_work file is stored under its name · the keeper door (a giver's input, an owner's made file) writes file.name, so a file kept for a piece is never titled by its heading or its <title> — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (RUNTIME_HOST, "                  role,\n                  title: file.title,\n", "                  role,\n                  title: file.name,\n"),
        ],
    ),
    (
        "M23 · a file kept before titles were taken reads as no title · keptFileOf hands the window the raw column where it fell back to the name, so a pre-D-026 row has a null title at the door and the push — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (RUNTIME_HOST, "    title: resource.title ?? resource.name,\n", "    title: resource.title,\n"),
        ],
    ),
    (
        "M24 · list_tasks made never says a title that differs from the name · the line drops its ' · <title>' arm, so a file titled by its heading reads like a headingless one and the agent never sees what the file is called — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (AGENT_TOOLS, "                              : ` · ${one.resource.title}`\n", "                              : ''\n"),
        ],
    ),
    (
        "M26 · a leading byte order mark stays in the text · the title is read off Buffer.toString('utf8'), which keeps U+FEFF in front of the first '#', so a Markdown file saved with a BOM is titled by its name — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (RESOURCES, "titleOf(new TextDecoder('utf-8').decode(file.bytes))", "titleOf(file.bytes.toString('utf8'))"),
        ],
    ),
    (
        "M27 · a <title> inside an <svg> is the page's title · svg is dropped from what the page scan passes over, so an inline drawing's tooltip ahead of the real <title> becomes the file's title — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (RESOURCES, "const markup = /<!--|<(title|script|style|svg|math)(?=[\\s/>])/gi", "const markup = /<!--|<(title|script|style|math)(?=[\\s/>])/gi"),
        ],
    ),
    (
        "M28 · a found title is cut ten times too late · the cap reads RESOURCE_TITLE_CHARS * 10, so a 300-character heading or <title> is kept whole instead of cut to 200 ending in … — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (RESOURCES, "  if (title.length <= RESOURCE_TITLE_CHARS) return title\n", "  if (title.length <= RESOURCE_TITLE_CHARS * 10) return title\n"),
        ],
    ),
    (
        "M29 · a title's entities are decoded twice · decodeEntities runs over its own output, so &amp;lt; becomes < instead of stopping at &lt; — killed by `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`",
        [
            (RESOURCES, "decodeEntities(text.slice(tagEnds + 1, closed.index))", "decodeEntities(decodeEntities(text.slice(tagEnds + 1, closed.index)))"),
        ],
    ),
]
