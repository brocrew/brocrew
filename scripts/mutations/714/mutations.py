"""714 · Names, a new project, and a command with files — R41's second six (`712` F-4), a launch into
a NEW project on the Team page (`712` F-6), a command with files said before the press (`708` H-3a),
and the longest endings measured and fitted to their row (`701` F-6).

⚑ **The PM's §2:** every identity a person reads is NAMED, never by slug (R41) — Home's waiting row,
both halves of the reopen list, the Info tab's home line, the shelf's cell, the grant chips and the
Team card's rename field printed the slug; the Team page drew a launch only for an agent with NO
recorded projects; the composer lit Send over a command with files, which the host refuses (R42);
and a long `retracted` / `abandoned` state spilled out of `.msg-meta`'s fixed 22 px.

## 🔴 What has to be killable

 * `M1`–`M16` 🔴 **R41**: each surface back to the slug, or handed no roster — the attention row's
   `who` (and a name invented for nobody), the reopen list's two halves and its two hops
   (`SessionLibrary`, `RuntimeScreen`), the Info tab and its hop (`SessionDrawer`), the shelf, its
   label and its hop (`ConversationPane`), the grant chips, the rename field's label; the word
   *agent* back to *profile*; the user-home row given the word it cannot have.
 * `M17`–`M20` 🔴 **`712` F-6**: the new places never drawn; every launch drawn, the recorded place
   twice; the words wrong; the tags taken from the whole launch list.
 * `M21`–`M34` 🔴 **`708` H-3a**: the gate blocking a command with no files; no gate; the gate
   outranking a superseded sign-in; a `$` list's words read as `/` commands; a guess where no list
   is held; the alias, the plugin retry, the cut-short hedge, the shape test, the MCP join and the
   trim each lost; the sentence claiming more than the list confirmed, or losing `R42`'s clause; and
   the refusal table's row back to a word that says nothing is dark.
 * `M35`–`M38` 🔴 **`701` F-6**: the row's fixed height back; the state no longer the part that
   gives way; the row that may not wrap, and the state that starts from nothing (both found by
   `714`'s review, beside the longest heading).
 * `M39`–`M44` ⚠️ **found by `714`'s review**: a bundle's conversation named from this roster, and
   given a profile it does not carry; the kept-open pane's composer never told, or told over a
   start's own words; the Team card's grant line back to slugs, and its naming step naming nobody.

## ⛔ What this table cannot reach

 * ⚠️ **`RuntimeScreen` is mounted by no test, and `SessionLibrary`'s hop is read where it is
   written** (`211` §11): `M6` and `M7` are killed by a census over their source.
 * ⚠️ **The host's own refusal** is main's, and `708`'s table holds it; the composer only reads the
   window's list, and `a-command-in-the-box.test.ts` holds the two to one corpus.
 * ⚠️ **The photographs** are evidence, not assertions.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
RUNTIMESCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SESSIONINFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"
SESSIONDRAWER = "apps/desktop/src/renderer/src/components/SessionDrawer.vue"
SESSIONSHELF = "apps/desktop/src/renderer/src/components/SessionShelf.vue"
CONVERSATIONPANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"

ATTENTION = f"{LIB}/attention.ts"
QUEUE_ROW = f"{COMPONENTS}/AttentionQueue.vue"
REOPEN = f"{COMPONENTS}/ResumableSessions.vue"
LIBRARY = f"{COMPONENTS}/SessionLibrary.vue"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"
INFO = f"{COMPONENTS}/SessionInfo.vue"
DRAWER = f"{COMPONENTS}/SessionDrawer.vue"
SHELF = f"{COMPONENTS}/SessionShelf.vue"
PANE = f"{COMPONENTS}/ConversationPane.vue"
SHEET = f"{COMPONENTS}/CapabilitiesSheet.vue"
TEAM = f"{COMPONENTS}/TeamWorkspace.vue"
ROSTER = f"{LIB}/team-roster.ts"
GATE = f"{LIB}/a-command-with-files.ts"
REFUSALS = f"{LIB}/send-refusals.ts"
HELD = f"{COMPONENTS}/QueuedMessage.vue"
KEPT = f"{COMPONENTS}/KeptOpenPane.vue"

NODE = "a-command-in-the-box.test.ts"
DRAWN = "names-a-new-project-and-a-command-with-files.dom.test.ts"
CENSUS = "send-refusals.test.ts"

MUTATIONS = [
    # ── §1 · R41 ────────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **Home's row carries the slug as its `who`** · the attention row names nobody — "
        f"killed by `{NODE}`",
        [
            (
                ATTENTION,
                "        who: record.meta?.profileId == null ? null : nameOf(record.meta.profileId),\n",
                "        who: record.meta?.profileId ?? null,\n",
            )
        ],
    ),
    (
        "M2 · 🔴 **Home's row draws the slug beside a name it holds** · `712` F-4's own line — "
        f"killed by `{DRAWN}`",
        [
            (
                QUEUE_ROW,
                '<span v-if="request.who" data-cy="attention-who"> · {{ request.who }}</span>',
                '<span v-if="request.who" data-cy="attention-who"> · {{ request.profileId }}</span>',
            )
        ],
    ),
    (
        "M3 · ⛔ **a name invented for nobody** · a row the host placed as no identity reads as "
        f"BroBot's — killed by `{NODE}`",
        [
            (
                ATTENTION,
                "        who: record.meta?.profileId == null ? null : nameOf(record.meta.profileId),\n",
                "        who: nameOf(record.meta?.profileId ?? 'brobot'),\n",
            )
        ],
    ),
    (
        "M4 · 🔴 **the reopen list's reopenable row asks no roster** · *agent: developer* over Ada — "
        f"killed by `{DRAWN}`",
        [
            (
                REOPEN,
                "            >agent: {{ agentName(session.profileId, props.identities) }}</span\n",
                "            >agent: {{ agentName(session.profileId, null) }}</span\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **the reopen list's recorded row asks no roster** — killed by " f"`{DRAWN}`",
        [
            (
                REOPEN,
                "<template v-else>agent: {{ agentName(session.profileId, props.identities) }}</template>",
                "<template v-else>agent: {{ agentName(session.profileId, null) }}</template>",
            )
        ],
    ),
    (
        "M6 · 🔴 **`SessionLibrary` never forwards the roster** · the list is named in a test and "
        f"never in the app — killed by `{NODE}`",
        [(LIBRARY, '          :identities="props.identities"\n', "")],
    ),
    (
        "M7 · 🔴 **`RuntimeScreen` never hands the roster to the library** — killed by " f"`{NODE}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — Handing SessionLibrary
        # the window's roster is still the rule: the rail's agent name must come from the window's
        # identities, not a bare profile id. D-017b only moved the prop (it now sits before
        # `@read="readFromTheLibrary"`), so the old anchor went stale. The plant drops the
        # `:identities` line and the source-reading test goes red.
        [
            (RUNTIMESCREEN, "            :identities=\"agentStore.identities.value?.identities ?? null\"\n            @read=\"readFromTheLibrary\"\n", "            @read=\"readFromTheLibrary\"\n"),
        ],
    ),
    (
        "M8 · 🔴 **the Info tab's home line asks no roster** · *agent: developer* over Ada — "
        f"killed by `{DRAWN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The Info tab must name
        # the agent through the window's roster (`agent: Ada · CLAUDE_CONFIG_DIR`); that still holds
        # and is still asserted by the DOM test. The old line's shape changed in D-017b, so I
        # re-aimed at the current `agent:` template line and pass null in place of the roster.
        [
            (SESSIONINFO, '              `agent: ${agentName(session.profileId, props.identities ?? null)}`\n', '              `agent: ${agentName(session.profileId, null)}`\n'),
        ],
    ),
    (
        "M9 · 🔴 **`SessionDrawer` never hands the Info tab the roster it holds** — killed by "
        f"`{DRAWN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — SessionDrawer must pass
        # the window's identities down to SessionInfo, or the Info tab falls back to a profile id;
        # the rule survives D-017b. The `:kept="kept"` neighbour line is still there and makes the
        # old string unique again (two other `:identities="props.identities"` exist, on SessionPanel
        # and SessionWork, so the anchor keeps its neighbours).
        [
            (SESSIONDRAWER, '        :kept="kept"\n        :identities="props.identities"\n        @refresh-config=', '        :kept="kept"\n        @refresh-config='),
        ],
    ),
    (
        "M10 · 🔴 **the shelf's cell asks no roster** — killed by " f"`{DRAWN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The shelf's 'Agent ·
        # Ada' line must come from the window's roster; the rule holds and the DOM test still
        # asserts it. The value is now `reported(whereItCameFrom(props.session) ??
        # agentName(props.session.profileId, props.identities ?? null))`, so I re-anchored on the
        # inner `agentName(...)` line and pass null.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · the agent's name is read where the drawer looks its roster up; the plant looks it up with no roster
            ("apps/desktop/src/renderer/src/components/SessionDrawer.vue", "const who = computed(() => whoIsIn(props.session, props.identities))", "const who = computed(() => whoIsIn(props.session, null))"),
        ],
    ),
    (
        "M11 · 🔴 **`ConversationPane` never hands the shelf the roster it holds** — killed by "
        f"`{DRAWN}`",
        [
            (
                "apps/desktop/src/renderer/src/components/ConversationPane.vue",
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · the pane hands its roster to the drawer; the plant drops that hand-off so the name falls back to the slug
                "        :work=\"props.work ?? null\"\n        :identities=\"props.identities ?? null\"\n",
                "        :work=\"props.work ?? null\"\n",
            )
        ],
    ),
    (
        "M12 · ⚑ **the shelf's cell called *Profile* again** · a name under the person's word for the slug "
        f"(`631`) — killed by `{DRAWN}`",
        [(SHELF, "      label: 'Agent',\n", "      label: 'Profile',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The grant chips were the `profile-list`
        # editor for identity-list grants (can_spawn). They are deleted with that grant, and
        # `candidate.slug` no longer appears in CapabilitiesSheet.vue. The sheet now "has six rows
        # and says any agent may start that identity" (card). Its anchor is left stale, so the
        # census records it retired.
        "M13 · 🔴 **the grant chips print the slug** · `712` F-4's `candidate.slug` — killed by "
        f"`{DRAWN}`",
        [
            (
                SHEET,
                "              agentName(candidate.slug, store.identities.value?.identities ?? null)\n",
                "              candidate.slug\n",
            )
        ],
    ),
    (
        "M14 · 🔴 **the rename field is labelled with the slug** — killed by " f"`{DRAWN}`",
        [
            (
                TEAM,
                ":aria-label=\"`Display name for ${member.heading}`\"",
                ":aria-label=\"`Display name for ${member.identity.slug}`\"",
            )
        ],
    ),
    (
        "M15 · ⚑ **the reopen list says *profile:* over a name** — killed by " f"`{DRAWN}`",
        [
            (
                REOPEN,
                "            >agent: {{ agentName(session.profileId, props.identities) }}</span\n",
                "            >profile: {{ agentName(session.profileId, props.identities) }}</span\n",
            )
        ],
    ),
    (
        "M16 · ⛔ **a conversation from the person's own folder is given the word *agent*** · it ran "
        f"as no agent at all — killed by `{DRAWN}`",
        [
            (
                REOPEN,
                "              >from {{ providerName(session.provider) }}'s own folder</template\n",
                "              >agent: {{ providerName(session.provider) }}'s own folder</template\n",
            )
        ],
    ),
    # ── §2 · `712` F-6 ──────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `placesItIsStartingIn` and the
        # launch-into-a-NEW-project tag line are gone from team-roster.ts and TeamWorkspace.vue,
        # because `projectsOfItsLaunches` was removed. Card D-016a: 'no Projects anywhere (sidebar,
        # rooms, cards)'. Its anchor is left stale, so the census records it retired.
        "M17 · 🔴 **a launch into a NEW project is never drawn on a card that has projects** · `712` "
        f"F-6 itself — killed by `{DRAWN}`",
        [
            (
                TEAM,
                '                  v-if="placesItIsStartingIn(member.use).length > 0"\n',
                '                  v-if="false"\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The filter
        # `use.projectsOfItsLaunches.filter(place => !use.projects.includes(place))` belonged to
        # `placesItIsStartingIn`, which the commit deleted along with both project fields on
        # `IdentityUse`. Nothing draws a launch's place any more. Its anchor is left stale, so the
        # census records it retired.
        "M18 · ⛔ **every launch is new** · the place it already works in is drawn twice, and a launch "
        f"into it says a conversation is starting somewhere new — killed by `{DRAWN}`",
        [
            (
                ROSTER,
                "  return use.projectsOfItsLaunches.filter((place) => !use.projects.includes(place))\n",
                "  return use.projectsOfItsLaunches\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The words '— a conversation is
        # starting' beside a recorded-projects list were part of the deleted project-tag block. The
        # `starting` reading now is the plain 'Starting now' line, which makes no first-conversation
        # claim, so the defect has no surface. Its anchor is left stale, so the census records it
        # retired.
        "M19 · ⚑ **the words say it is the agent's FIRST conversation** · on a card with recorded "
        f"projects, which is never true — killed by `{DRAWN}`",
        [
            (
                TEAM,
                "                  — a conversation is starting</span\n",
                "                  — its first conversation is starting</span\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `v-for="place in
        # placesItIsStartingIn(member.use)"` was the project-tag loop, deleted with
        # `projectsOfItsLaunches` and `placesItIsStartingIn`. The tags drew a project per launch and
        # projects no longer exist. Its anchor is left stale, so the census records it retired.
        "M20 · ⚠️ **the tags come from the whole launch list** · the gate asks the new places and the "
        f"line draws them all — killed by `{DRAWN}`",
        [
            (
                TEAM,
                '                    v-for="place in placesItIsStartingIn(member.use)"\n',
                '                    v-for="place in member.use.projectsOfItsLaunches"\n',
            )
        ],
    ),
    # ── §3 · `708` H-3a ─────────────────────────────────────────────────────────────────────────
    (
        "M21 · ⛔ **118's opposite defect** · a command with NO files is blocked too — killed by "
        f"`{DRAWN}`",
        [
            (
                PANE,
                "  return command === null || props.handing.staged.length === 0\n",
                "  return command === null\n",
            )
        ],
    ),
    (
        "M22 · 🔴 **no gate** · Send lit over a press the host refuses — `708` H-3a itself — killed by "
        f"`{DRAWN}`",
        [
            (
                PANE,
                "  return command === null || props.handing.staged.length === 0\n"
                "    ? null\n"
                "    : aCommandTakesNoAttachmentsYet(command)\n",
                "  return command === null ? null : null\n",
            )
        ],
    ),
    (
        "M23 · ⚠️ **the command's reason outranks a superseded sign-in** · taking the file off would "
        f"not light Send, and the sentence says it would — killed by `{DRAWN}`",
        [
            (
                PANE,
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n"
                "  const command = aCommandInTheBox(props.draft, control.value.commands)\n",
                "  const command = aCommandInTheBox(props.draft, control.value.commands)\n"
                "  if (command !== null && props.handing.staged.length > 0)\n"
                "    return aCommandTakesNoAttachmentsYet(command)\n"
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n",
            )
        ],
    ),
    (
        "M24 · ⛔ **a `$` list's words read as `/` commands** · Codex's `imagegen` blocks `/imagegen`, "
        f"which the host sends — killed by `{NODE}`",
        [
            (
                GATE,
                "  if (set === null || set.prefix !== THE_SLASH) return null\n",
                "  if (set === null) return null\n",
            )
        ],
    ),
    (
        "M25 · ⛔ **a guess where no list is held** · the window claims a fact only the host can "
        f"settle — killed by `{NODE}`",
        [
            (
                GATE,
                "  if (set === null || set.prefix !== THE_SLASH) return null\n",
                "  if (set === null)\n"
                "    return text.trim().startsWith(THE_SLASH) ? { word: text.trim(), listed: false } : null\n"
                "  if (set.prefix !== THE_SLASH) return null\n",
            )
        ],
    ),
    (
        "M26 · 🔴 **an alias is not a command** · `/usage` sent with a file the host refuses — killed "
        f"by `{NODE}`",
        [(GATE, "(command.aliases ?? []).includes(name)", "false")],
    ),
    (
        "M27 · 🔴 **the CLI's plugin retry lost** · `/myplugin review` is `myplugin:review` — killed "
        f"by `{NODE}`",
        [
            (
                GATE,
                "  if (named.sub !== null && on(`${named.base}:${named.sub}`)) return { word, listed: true }\n",
                "",
            )
        ],
    ),
    (
        "M28 · ⛔ **the cut-short hedge applied to a whole list** · `/clear`, which no list names, "
        f"is blocked — killed by `{NODE}`",
        [
            (
                GATE,
                "  return commands.dropped > 0 && SHAPED_LIKE_A_COMMAND.test(named.base)\n",
                "  return SHAPED_LIKE_A_COMMAND.test(named.base)\n",
            )
        ],
    ),
    (
        "M29 · ⛔ **the shape test lost** · a path reads as a command on a cut-short list — killed by "
        f"`{NODE}`",
        [
            (
                GATE,
                "  return commands.dropped > 0 && SHAPED_LIKE_A_COMMAND.test(named.base)\n",
                "  return commands.dropped > 0\n",
            )
        ],
    ),
    (
        "M30 · 🔴 **the MCP join lost** · `/srv:prompt (MCP)` is not the name the list carries — "
        f"killed by `{NODE}`",
        [
            (
                GATE,
                "  return { name: mcp ? `${base} ${MCP_MARK}` : base, base, sub }\n",
                "  return { name: base, base, sub }\n",
            )
        ],
    ),
    (
        "M31 · 🔴 **the trim lost** · a leading space stops a command the CLI still runs — killed by "
        f"`{NODE}`",
        [(GATE, "  const trimmed = text.trim()\n", "  const trimmed = text\n")],
    ),
    (
        "M32 · ⚠️ **the sentence claims a command the list could not confirm** — killed by " f"`{NODE}`",
        [
            (
                GATE,
                "    : `${command.word} reads as a command (this conversation's command list could not confirm it)`\n",
                "    : `${command.word} is a command`\n",
            )
        ],
    ),
    (
        "M33 · 🔴 **`R42`'s clause lost from the sentence** — killed by " f"`{DRAWN}`",
        [(GATE, ", and a command takes no attachments — remove them", ", and it cannot carry files — remove them")],
    ),
    (
        "M34 · ⚑ **the refusal table says nothing is dark** · the row back to a word that claims the "
        f"window cannot know — killed by `{CENSUS}`",
        [
            (
                REFUSALS,
                "    knowable: 'before',\n    gate:\n      '⚑ **714 · ",
                "    knowable: 'never',\n    gate:\n      '⚑ **714 · ",
            )
        ],
    ),
    # ── §4 · `701` F-6 ──────────────────────────────────────────────────────────────────────────
    (
        "M35 · 🔴 **the row's fixed 22 px back** · the host's longest endings spill over the words "
        f"below — `701` F-6 itself — killed by `{DRAWN}`",
        [(HELD, "  min-height: 22px;\n", "  height: 22px;\n")],
    ),
    (
        "M36 · ⚠️ **the state no longer gives way** · at its content's width it drops below a heading "
        "with room beside it and pushes the clock to a line of its own (it squeezed both onto two "
        f"lines until the row could wrap) — killed by `{DRAWN}`",
        # ⚑ **Re-anchored in place, not retired** — NOT VERIFIED. The row guards the held message's state giving way to its heading; the state's words are now drawn in the accent's text colour, and the plant still removes its floor and its share of the row.
        [(HELD, "  min-width: 0;\n  flex: 1 1 11em;\n  color: var(--accent-text);\n", "  color: var(--accent-text);\n")],
    ),
    # ── found by 714's own review ─────────────────────────────────────────────────────────────────
    (
        "M37 · 🔴 **the row may not wrap** · beside the longest heading a held row draws, the state "
        f"is left no room on the line and spills sideways — killed by `{DRAWN}`",
        [(HELD, "     line at all. It takes the next one instead. */\n  flex-wrap: wrap;\n", "     line at all. It takes the next one instead. */\n")],
    ),
    (
        "M38 · 🔴 **the state starts from nothing** · the floor lost, the longest heading leaves it "
        f"0 px wide — the review's own measurement — killed by `{DRAWN}`",
        [(HELD, "  flex: 1 1 11em;\n", "  flex: 1 1 0;\n")],
    ),
    (
        "M39 · ⛔ **a conversation restored from a bundle is named from THIS roster** · another "
        f"machine's `developer` reads as this machine's *Ada* — killed by `{DRAWN}`",
        [
            (
                REOPEN,
                '            <template v-if="session.restoredFromBundle">from a bundle</template>\n',
                '            <template v-if="false">from a bundle</template>\n',
            )
        ],
    ),
    (
        "M40 · ⚠️ **the person's own folder asked FIRST** · an import sets `adopted_at`, so a bundle "
        "that names no profile is also `foundInUserHome`, and reads *from Claude's own folder* — "
        f"714's second review — killed by `{DRAWN}`",
        [
            (
                REOPEN,
                '            <template v-if="session.restoredFromBundle">from a bundle</template>\n'
                '            <template v-else-if="session.foundInUserHome"\n'
                "              >from {{ providerName(session.provider) }}'s own folder</template\n"
                "            >\n",
                '            <template v-if="session.foundInUserHome"\n'
                "              >from {{ providerName(session.provider) }}'s own folder</template\n"
                "            >\n"
                '            <template v-else-if="session.restoredFromBundle">from a bundle</template>\n',
            )
        ],
    ),
    (
        "M41 · 🔴 **the kept-open pane's composer is never told** · a press STARTS the conversation "
        f"before the host refuses it — killed by `{DRAWN}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — A /compact with a file
        # must be dark before the press that would CONTINUE the conversation, and must say why.
        # D-017b removed the kept-open pane, but a `recorded` phase ConversationPane is now the pane
        # for that case, and DEV re-aimed section 3b of the DOM test at it. The plant makes
        # `sendBlocked` null on the recorded phase only, so the row stays distinct from row 219's
        # plain `:blocked` removal.
        [
            (CONVERSATIONPANE, '  const command = aCommandInTheBox(props.draft, control.value.commands)\n  return command === null || props.handing.staged.length === 0\n    ? null\n    : aCommandTakesNoAttachmentsYet(command)', "  const command = aCommandInTheBox(props.draft, control.value.commands)\n  return props.record.phase === 'recorded' || command === null || props.handing.staged.length === 0\n    ? null\n    : aCommandTakesNoAttachmentsYet(command)"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row protected the kept-open pane's
        # `starting` guard; D-017b deleted `KeptOpenPane.vue` and `kept-open.ts` on purpose (a
        # conversation is a conversation, on screen too) and dropped the `starting: true` control
        # from the DOM test. ConversationPane has no `starting` guard of its own to plant on, and a
        # launch maps to composerState 'busy' instead. Its anchor is left stale, so the census
        # records it retired.
        "M42 · ⚠️ **the kept-open pane's reason displaces a start's own words** · while the start is "
        f"in the air — killed by `{DRAWN}`",
        [(KEPT, "  if (props.starting) return null\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The Team card's grant line
        # (`grantLine(field, namedGrants(...))`) and `namedGrants` are deleted from
        # TeamWorkspace.vue, along with the identity-list grants the line named. With no grant
        # naming identities, there are no slugs to name. Its anchor is left stale, so the census
        # records it retired.
        "M43 · 🔴 **the Team card's grant line prints the slugs** · *May start conversations as: "
        f"named, ghost* over Ada — killed by `{DRAWN}`",
        [
            (
                TEAM,
                ">{{ grantLine(field, namedGrants(member.identity.capabilities), null) }}</small",
                ">{{ grantLine(field, member.identity.capabilities, null) }}</small",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** `grantsAsAPersonReadsThem`, the naming
        # step over `profile-list` fields, is deleted from team-roster.ts, and no `profile-list`
        # field remains in capabilities.ts. D-014 removed can_spawn, which was that step's only
        # subject. Its anchor is left stale, so the census records it retired.
        "M44 · ⚠️ **the naming step names nobody** · every identity a grant lists passed through as "
        f"its slug — killed by `{DRAWN}`",
        [
            (
                ROSTER,
                "    named[field.key] = (allowed[field.key] as readonly string[]).map((slug) =>\n"
                "      agentName(slug, identities),\n"
                "    )\n",
                "    named[field.key] = allowed[field.key]\n",
            )
        ],
    ),
]
