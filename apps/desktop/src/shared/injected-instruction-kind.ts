/**
 * **What kind of instruction text this is** (158) — the door it came through, not a folder name.
 *
 * `profile-memory` is the profile's own `CLAUDE.md`, read from the app-owned provider home: the
 * "who" of *"HOME is who; CWD is what"* (156). `project-memory` is a `CLAUDE.md` on the cwd chain:
 * the "what". `workspace-instructions` is the one project file **BroBot itself wrote** (006) — the
 * same door, said out loud, because a file the app generates and a file the user wrote are not the
 * same provenance and 086 rules that a merged blob with no provenance is not a disclosure.
 *
 * `agent-memory` is the one the AGENT wrote (165), maintained by the model across conversations.
 * ⛔ **Its door is the PROVIDER's, not ours**: the provider loads it, and BroBot reads it only so
 * the user can see what the agent has been telling itself. See
 * {@link SessionInstructions.agentMemory}, which is a separate field precisely so this list can go
 * on meaning *"what BroBot appended"*.
 *
 * ⚠️ **Two corrections rather than a rewrite** (142), both of them sentences that were true when
 * written and stopped being:
 *
 *  - this named the path as `<providerHome>/projects/<sanitized-cwd>/memory/MEMORY.md`, which
 *    **166 replaced** with one memory per PROFILE. A `kind` is a door, not a folder, so the path is
 *    simply gone from here — `claudeAutoMemoryIndex` is where it lives and where it stays current.
 *  - it said *"Claude loads it into its own system prompt"*, which **317 made half a fact**: 314
 *    switched Codex's memory on, so both providers now have one. The provider is named generically
 *    because naming one of two is the defect 317 exists to fix.
 *
 * `agent-memory-note` identifies requested memory written by `memories__add_ad_hoc_note` under `memories/extensions/ad_hoc/notes/<stamp>-<slug>.md`. Its author matches `agent-memory`, but its requested provenance differs and must remain visible.
 *
 * ## 🔴 `agent-memory-topic` is a THIRD kind and not a second use of the one above (322)
 *
 * Claude's store is `MEMORY.md` plus one file per memory — `user_role.md`, `feedback_testing.md` —
 * and the panel listed the index alone until 322, so two of three files in a real profile were in
 * the store and not on the screen.
 *
 * ⛔ **The tempting move was to reuse `agent-memory-note`, and its own label is why that is wrong:**
 * *"a note the agent was asked to write"*. That sentence is Codex's `memories__add_ad_hoc_note`
 * exactly — a person said *"remember this"* and a tool call answered — and it is FALSE of most
 * Claude topic files, which the provider tells the model to write unprompted (*"you should build up
 * this memory system over time"*). ⚠️ Diluting it to cover both would cost F4's row the one word
 * that made it the row he went looking for, and 086's rule is that a reader who cannot tell two
 * provenances apart edits the wrong file. **Two doors, two kinds; {@link InjectedInstruction.reach}
 * carries what they have in common.**
 */
export type InjectedInstructionKind =
  /**
   * 🔴 **The app's own compiled instructions for this profile** (377) — `factory + configured`,
   * rendered from one canonical source at every launch. ⚑ **D-024 · R1 — what is true of one
   * conversation is not in it**: that is {@link SessionInstructions.thisConversation}.
   *
   * ⛔ **A kind of its own and never `profile-memory`, which is the file beside it.** That one is
   * `<providerHome>/CLAUDE.md`, which the AGENT writes; this one the APP writes and replaces every
   * launch. 086's rule is that a reader who cannot tell two provenances apart edits the wrong file,
   * and these two are one directory apart with opposite owners — the worst possible case for
   * blurring them.
   */
  | 'profile-instructions'
  | 'profile-memory'
  | 'project-memory'
  /**
   * 🔴 **The repository's own `AGENTS` layer, bridged to Claude** (377, from `364` §2.3).
   *
   * ⛔ **Only ever on Claude, and the asymmetry is the point rather than a gap.** Codex discovers
   * these files natively; sending it a copy as well would give it the bytes twice. ⚠️ So a row of
   * this kind on a Codex session would be a defect, not a feature — `364` §2.4's first acceptance
   * condition.
   */
  | 'repository-conventions'
  | 'workspace-instructions'
  | 'agent-memory'
  | 'agent-memory-note'
  | 'agent-memory-topic'
