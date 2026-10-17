"""3022 · F009's agent record (223477ab) and F046's compare-and-set re-title (627aa7a9).

⛔ **The subject**: what `list_profiles` / the agent record says of an agent and to whom, and the
one-time re-titling of files the old heading reader named. The record says how each piece ended and
never whether a conversation runs; it is told only to a caller that reaches one of the agent's
conversations; a title is replaced only while it is still the one the old reader gave.

## ⚑ What a row here measures

 * ⚑ **M1–M4 are the host's reading of an agent's record** (`runtime-host.ts`): the profile folded as
   the roster folds it, the end of a replacement chain, and the reach fold that decides who is told
   the rules and which pieces are counted.
 * ⚑ **M5–M8 are the record's telling** (`agent-tools.ts`): an open piece without an ending time,
   the plural of the older files, a running state that must never be said, and the profile trimmed.
 * ⚑ **M9, M10, M16 are the store's selection and compare-and-set** (`session-store.ts`): which
   files are offered to the pass, and the write that lands only while the title is the one read.
 * ⚑ **M11, M13, M14, M15 are the pass** (`runtime-host.ts`): the cutoff date, the pages of the scan,
   which forms are re-titled, and the compare on the title the decision was made on.
 * ⚑ **M12 is the old reader** (`resources.ts`): reproduced with its 200-character cap.

## ⛔ What this table does not contain

 * ⚠️ The `form === 'page' && was !== row.name` guard: equivalent, for a page the old reader and the
   fresh read are one function.
 * ⚠️ The `was === null` guard: equivalent, the SQL already filters NULL titles.
 * ⚠️ Dropping `after = at`: it would hang rather than fail.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
RES = "apps/desktop/src/main/resources/resources.ts"

RECORD = "an-agents-record-says-how-each-piece-ended-and-never-whether-a-conversation-runs.test.ts"
RETITLE = "a-title-the-old-heading-reader-gave-is-replaced-and-nothing-else.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · the profile is not folded as the roster folds it, so `TESTER` is refused · killed by "
        f"`{RECORD}`",
        [(HOST,
          "const slug = foldProfileName(profile)",
          "const slug = profile")],
    ),
    (
        "M2 · the record names the next hop of a replacement chain, not the end of it · killed by "
        f"`{RECORD}`",
        [(HOST,
          "const standing = this.theOneInItsPlace(conversation)",
          "const standing = this.replacedBy.get(conversation) ?? conversation")],
    ),
    (
        "M3 · 🔴 the rules are told to a caller that reaches none of the agent's conversations · "
        f"killed by `{RECORD}`",
        [(HOST,
          "inReach.length === 0 && !this.itsGrantReachesWhatItDidNotStart(by)",
          "this.deps.store.conversationsOf(agent.profile).length === 0 && !this.itsGrantReachesWhatItDidNotStart(by)")],
    ),
    (
        "M4 · 🔴 pieces and their counts are read past the reach fold · killed by "
        f"`{RECORD}`",
        [(HOST,
          "      inReach.map((one) => one.conversation),",
          "      this.deps.store.conversationsOf(agent.profile).map((one) => one.conversation),")],
    ),
    (
        "M5 · an open piece carries an ending time of `null` · killed by "
        f"`{RECORD}`",
        [(TOOLS,
          "...(held.endedAt === null ? {} : { ended_at: held.endedAt }),",
          "ended_at: held.endedAt,")],
    ),
    (
        "M6 · the plural count of older files says `it` · killed by "
        f"`{RECORD}`",
        [(TOOLS,
          "finds ${record.filesNotListed === 1 ? 'it' : 'them'} by its profile.",
          "finds it by its profile.")],
    ),
    (
        "M7 · 🔴 the record says whether a conversation runs — a running state in the text · killed by "
        f"`{RECORD}`",
        [(TOOLS,
          "last changed at ${at(one.lastChangedAt)}${ended}`",
          "last changed at ${at(one.lastChangedAt)} · not running — a message starts it again${ended}`")],
    ),
    (
        "M8 · a profile with blanks around it is refused · killed by "
        f"`{RECORD}`",
        [(TOOLS,
          "const read = host.agentRecord(args.profile.trim(), by, me)",
          "const read = host.agentRecord(args.profile, by, me)")],
    ),
    (
        "M9 · a file titled by its name and kept after the cutoff is never re-titled · killed by "
        f"`{RETITLE}`",
        [(STORE,
          "AND (title = name OR created_at < @keptBefore)",
          "AND created_at < @keptBefore")],
    ),
    (
        "M10 · a file kept AT the cutoff is read as the old reader gave it · killed by "
        f"`{RETITLE}`",
        [(STORE,
          "AND (title = name OR created_at < @keptBefore)",
          "AND (title = name OR created_at <= @keptBefore)")],
    ),
    (
        "M11 · the cutoff moves a day early · killed by "
        f"`{RETITLE}`",
        [(HOST,
          "const FRONT_MATTER_READ_EVERYWHERE_SINCE = Date.UTC(2026, 9, 11)",
          "const FRONT_MATTER_READ_EVERYWHERE_SINCE = Date.UTC(2026, 9, 10)")],
    ),
    (
        "M12 · the old reader is reproduced without its 200-character cap · killed by "
        f"`{RETITLE}`",
        [(RES,
          "return titleBy(file.form === 'markdown' ? markdownHeading : TITLE_OF_FORM[file.form], file)",
          "return file.form === 'markdown' ? (markdownHeading(new TextDecoder('utf-8').decode(file.bytes)) ?? file.name) : titleBy(TITLE_OF_FORM[file.form], file)")],
    ),
    (
        "M13 · the scan stops after its first page · killed by "
        f"`{RETITLE}`",
        [(HOST,
          "if (page.length < FILES_TITLED_AT_ONCE) break",
          "if (page.length <= FILES_TITLED_AT_ONCE) break")],
    ),
    (
        "M14 · a page titled by its name is never re-titled · killed by "
        f"`{RETITLE}`",
        [(HOST,
          "if (was === null || (form !== 'markdown' && form !== 'page')) continue",
          "if (was === null || form !== 'markdown') continue")],
    ),
    (
        "M15 · 🔴 the compare uses a fresh re-read, not the title the decision was made on, so a title "
        f"written meanwhile is overwritten · killed by `{RETITLE}`",
        [(HOST,
          "this.deps.store.retitleResource(row.resource, was, title)",
          "this.deps.store.retitleResource(row.resource, this.deps.store.resource(row.resource)?.title ?? was, title)")],
    ),
    (
        "M16 · 🔴 the write no longer compares with the title it read · killed by "
        f"`{RETITLE}`",
        [(STORE,
          "WHERE id = @id AND title = @was AND @title <> @was",
          "WHERE id = @id AND @title <> @was")],
    ),
]
