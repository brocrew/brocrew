import { providerDescriptor, providerRecord, type Provider } from '@brobot2/shared'

/**
 * **The commands the agent already has** (279) — the provider-neutral vocabulary for them.
 *
 * Include the running agent's provider commands alongside BroBot's app commands in the palette.
 *
 * ## ⚠️ Both providers answer, and they are not answering the same question
 *
 * `279` §1 says the nearest Codex surfaces *"may not be the same thing as Claude's slash commands"*
 * and asks for a measurement rather than a reading. `probe:provider-commands` is that measurement —
 * zero turns and zero tokens on both sides — and the answer is sharper than either "yes" or "no":
 *
 * | | what it publishes | rows, measured | how a person writes one |
 * |---|---|---|---|
 * | **Claude** `0.3.218` | built-ins **and** skills, in one list | **44** | `/compact`, `/code-review` |
 * | **Codex** `0.146.0` | ⛔ **skills only** | **6** | `$imagegen`, `$review-agent` |
 *
 * ⛔ **So Codex publishes no `/compact`, no `/model`, no `/usage` — not "we have not asked", but no
 * such thing on the protocol at all.** `plugin/list` answered with marketplaces, `hooks/list` with
 * nothing, and `collaborationMode/list` with `Plan`/`Default`, which are modes and not commands.
 * ⚑ **Zero of Codex's six names appear in Claude's forty-four**, which is asserted in the probe: two
 * vocabularies, and a band that blended them would teach that `/compact` is one of Codex's own
 * commands. ⚑ **713**: a person's `/compact` does compact on Codex now — BroBot turns it into Codex's
 * own compaction request (`R59`) — but it is BroBot's word, not a row Codex publishes.
 *
 * ⚠️ **The sigil is measured, not styled.** Three of the four Codex skills that ship a
 * `interface.defaultPrompt` write themselves as `$name` in it and **none** writes `/name`. That is
 * the provider's own sentence about its own skill, so it is what {@link ProviderCommandSet.prefix}
 * carries — see there for why the prefix is stated once per set rather than baked into each row.
 *
 * ## The level rule, which this app has now paid for three times
 *
 * The SDK is explicit that `commands_changed` REPLACES: *"Clients should REPLACE their cached
 * command list with this payload; `supportedCommands()` tracks the latest push, so a re-fetch
 * returns the same fresh list."* `222` cost a dispatch to the distinction, and `247`/`253` both
 * restate it — so this event carries a whole list every time and never a delta.
 *
 * ⚑ **`undefined` ≠ `[]` lives in the REGISTRY rather than in the event**, and that is deliberate.
 * Unlike `background_work` — which has a level half and an edge half and therefore needs an optional
 * field — this event has exactly one payload and no reason to exist without it. So the event always
 * states the level, and the two facts §2 requires be told apart are told apart where they are
 * actually visible: a session nobody has asked holds `null`, and a session whose provider answered
 * with nothing holds `[]`. ⛔ **A `[]` rendered as "this agent has no commands" would be right; a
 * `null` rendered the same way would be a lie about a session that has not started.**
 *
 * ## ⚠️ Codex says "ask again"; Claude says "here it is"
 *
 * The two change signals are not the same shape and neither adapter may pretend otherwise.
 * `SDKCommandsChangedMessage` carries the new list. Codex's `skills/changed` is
 * `Record<string, never>` — an empty object whose own doc says *"treat this as an invalidation
 * signal and re-run `skills/list`"*. So Claude's arm is a normalizer arm and Codex's is a re-fetch,
 * and the asymmetry is stated in both adapters rather than smoothed into a shared shape that would
 * have to lie about one of them.
 */

/**
 * One command the running agent will answer to.
 *
 * ⚠️ **`name` is BARE — no sigil.** The prefix belongs to the set (see {@link ProviderCommandSet}),
 * because it is one fact about the provider and putting it on 44 rows is the "one rule spelled in N
 * places drifts" hazard `169` §1 named and `248` had to fix in five.
 */
export interface ProviderCommand {
  /** What the provider calls it, without its prefix — `compact`, `imagegen`. */
  readonly name: string
  /**
   * What it does, in the provider's own words, bounded by {@link MAX_COMMAND_TEXT}.
   *
   * ⚠️ **Optional because absence is a real state, not because it is rare.** Measured, all 44 Claude
   * rows carry one — but a skill is authored by whoever wrote it, and a row with nothing to say must
   * render as a row with no second line rather than as an empty one (`211` §3's rule).
   */
  readonly description?: string
  /** The provider's own hint for what follows the command — `[pr number]`. 17 of 44 carry one. */
  readonly argumentHint?: string
  /**
   * Other names that resolve to this one — `/cost` and `/stats` both reach `/usage`.
   *
   * ⚑ Carried rather than dropped because they are exactly what a person searches for and never
   * what they read: the palette matches them and never draws them, which is the same split
   * `PaletteCommand.keywords` already makes.
   */
  readonly aliases?: string[]
  /**
   * Where the row is a skill with a file of its own (Codex's): that file, the scope it was found
   * in, and its description as the provider sends it to the model, which can differ from
   * {@link description}, the short one a person picks it by.
   */
  readonly skill?: ProviderSkill
}

/** A skill's own file, as the provider listed it. */
export interface ProviderSkill {
  /** The full path of its `SKILL.md`. */
  readonly path: string
  /** Where the provider found it: `system`, `user`, `repo`… */
  readonly scope: string
  /** Its description as the model is given it, bounded by {@link MAX_COMMAND_TEXT}. */
  readonly description?: string
}

/** The longest skill path a row carries; a longer one leaves the row without its file. */
export const MAX_SKILL_PATH = 4096

/** The longest scope word a row carries. */
export const MAX_SKILL_SCOPE = 40

/**
 * A whole command list as one provider last stated it, with the sentence a person needs to use one.
 *
 * ⛔ **`prefix` is a fact about the PROVIDER and is why this is a set rather than a bare array.**
 * Claude's rows are typed `/name` and Codex's `$name`; a palette that drew one for the other would
 * be telling a person to type something the agent will not answer to. Measured — see the module
 * note — rather than styled.
 */
export interface ProviderCommandSet {
  readonly commands: readonly ProviderCommand[]
  /** What a person types before {@link ProviderCommand.name} — `/` for Claude, `$` for Codex. */
  readonly prefix: string
}

/**
 * 🔴 **708 · a list as a provider stated it, and how many rows it could not carry** — what the host
 * decides `R42` against.
 *
 * ⚠️ **`dropped` travels with it** (708's review): a list {@link boundCommands} cut short is not an
 * answer about the rows it dropped, so a name missing from it may still be a command.
 */
export interface ProviderCommandAnswer extends ProviderCommandSet {
  readonly dropped?: number
}

/**
 * The most rows one level payload will carry.
 *
 * ⚑ Same shape of bound as {@link MAX_BACKGROUND_WORK}, and the same rule: a cap is never silent —
 * `provider_commands.dropped` says out loud when it bit. Measured, the real catalogues are **44**
 * (Claude) and **6** (Codex), so 200 is far above anything a provider ships; it exists so one
 * malformed payload cannot become a permanent list in every store downstream (`052`).
 */
export const MAX_PROVIDER_COMMANDS = 200

/**
 * The ceiling on a provider STRING carried on this event, in characters — **ellipsis included**.
 *
 * ⛔ **A round number, and that is a deliberate departure from `background_work`'s 201.** That bound
 * is odd because `normalize.ts`'s `truncate` appends its ellipsis AFTER slicing to the bound, so a
 * `.max(200)` schema would reject exactly the strings it had just shortened — and `toWireEvent`
 * re-validates at the IPC boundary, so the row would degrade to `unknown` and be lost. {@link clip}
 * does the arithmetic instead, so the schema states the number this constant states.
 *
 * ⚠️ **500 rather than 200, and the number is measured rather than inherited.** These are not
 * summary-sized: the live Claude catalogue's longest description is **1 135** characters, and of its
 * 44 rows **35 are whole at 200, 40 at 500, 41 at 1 000**. At 200 the cut lands mid-sentence in
 * `/code-review` and takes the half naming `--fix` with it. 500 is the knee — a thousand buys one
 * more row for twice the ceiling.
 */
export const MAX_COMMAND_TEXT = 500

/**
 * The ceiling on a command's own NAME, in characters.
 *
 * Measured at 24 (`run-skill-generator`, `fewer-permission-prompts`), so 120 is five times the
 * longest real one. Separate from {@link MAX_COMMAND_TEXT} because a name is what a person types
 * and a description is what they read: a name long enough to need truncating is not a name.
 */
export const MAX_COMMAND_NAME = 120

/**
 * The most alternate names one row will carry.
 *
 * ⚠️ **Bounded for the reason the list is bounded, not because it is expected to bite.** Aliases are
 * matched and never drawn, so an unbounded array would grow the wire and the store with strings no
 * surface can show — which is the shape of `052` rather than a cosmetic concern. Measured, the
 * widest real row carries **two** (`/usage`, reached by `cost` and `stats`), so 20 is ten times the
 * observed maximum and exists only to stop one malformed payload becoming unbounded.
 *
 * ⚑ **A row past this keeps its command and loses only the extra names**, which is why exceeding it
 * is NOT counted in `dropped`: that number means the list is understating what the agent HAS, and a
 * command reachable by two names instead of three is still listed and still typeable.
 */
export const MAX_COMMAND_ALIASES = 20

/**
 * ⛔ **Codex's own prefix**, from the provider's sentence about its own skills — see the module note.
 */
export const CODEX_COMMAND_PREFIX = providerDescriptor('codex').commandPrefix

/** ⛔ **Claude's**, from 44 rows that are `/`-invoked in the CLI this app embeds. */
export const CLAUDE_COMMAND_PREFIX = providerDescriptor('claude').commandPrefix

/**
 * 🔴 **708 · each provider's prefix, known before any list is** — the half of `R42` that must hold
 * when the list cannot be had.
 *
 * ⚑ **A fact about the PROVIDER, and that is why it can be stated without asking**: the prefix is
 * how its commands are typed, measured once per provider (the module note), and it does not move
 * with the list. ⛔ **So a `/` word a person types on Codex is never a command**, whether or not
 * Codex's `skills/list` answered — which is `R42`'s *"if Codex publishes no command list there,
 * its messages keep the frame"* — and the host asks for a list only where the prefix is `/`.
 *
 * Each prefix comes from the provider's required descriptor field, so a new provider must supply
 * its own measured spelling.
 */
export const PROVIDER_COMMAND_PREFIX = providerRecord(
  (provider) => providerDescriptor(provider).commandPrefix,
)

/**
 * ⛔ **The ONE bounding rule, for both providers and all THREE producers.**
 *
 * ⚠️ **Not a convenience.** Claude states this list twice — once at session start from
 * `initializationResult()` and again on every `commands_changed` push — and Codex a third way, by
 * re-running `skills/list`. Three call sites each applying their own caps is `169` §1's finding
 * exactly: one rule spelled in N places drifts, and here a drift means one path shipping strings the
 * schema rejects, which `toWireEvent` degrades to `unknown` and loses in silence.
 *
 * ⚠️ **A row with no usable name is COUNTED, not quietly skipped** — `092`'s no-silent-cap rule, in
 * the wording `247` settled on. A command with no name cannot be typed and cannot be searched for,
 * so a list one row short with nothing to say so would understate what the agent has.
 *
 * The shortfall is measured against what the provider SENT, so one subtraction covers the ceiling,
 * the nameless rows, and anything that was not a row at all. It cannot go negative, because the kept
 * set is a subset of the sent set.
 */
export function boundCommands(sent: readonly ProviderCommand[]): {
  readonly commands: ProviderCommand[]
  readonly dropped: number
} {
  const commands = sent
    // ⛔ **A name that does not fit is DROPPED, not clipped** — {@link MAX_COMMAND_NAME}'s own rule:
    // *"a name long enough to need truncating is not a name."* Clipping it would put a row on screen
    // inviting a person to type `/aaa…`, which is `106` — a control that cannot act — reached by
    // being tidy. It is counted with the nameless ones for the same reason they are counted.
    .filter((row) => row.name.trim() !== '' && row.name.length <= MAX_COMMAND_NAME)
    .slice(0, MAX_PROVIDER_COMMANDS)
    .map((row) => ({
      name: row.name,
      ...(row.description ? { description: clip(row.description, MAX_COMMAND_TEXT) } : {}),
      ...(row.argumentHint ? { argumentHint: clip(row.argumentHint, MAX_COMMAND_TEXT) } : {}),
      ...(row.aliases?.length
        ? {
            // ⚠️ Dropped rather than clipped, for the reason the NAME above is: an alias is matched
            // and never drawn, so a clipped one is a string that can only fail to match. Not
            // counted — see {@link MAX_COMMAND_ALIASES}.
            aliases: row.aliases
              .filter((alias) => alias.trim() !== '' && alias.length <= MAX_COMMAND_NAME)
              .slice(0, MAX_COMMAND_ALIASES),
          }
        : {}),
      ...(row.skill !== undefined &&
      row.skill.path !== '' &&
      row.skill.path.length <= MAX_SKILL_PATH &&
      row.skill.scope.length <= MAX_SKILL_SCOPE
        ? {
            skill: {
              path: row.skill.path,
              scope: row.skill.scope,
              ...(row.skill.description
                ? { description: clip(row.skill.description, MAX_COMMAND_TEXT) }
                : {}),
            },
          }
        : {}),
    }))
  return { commands, dropped: sent.length - commands.length }
}

/**
 * Keep `max` characters, ellipsis included — so the result is never longer than `max`.
 *
 * ⛔ **`max` INCLUSIVE, unlike `normalize.ts`'s `truncate`, and the difference is the whole reason
 * this exists here.** That one appends an ellipsis AFTER the slice, so bounding to 200 produces a
 * 201-character string and the schema has to be one wider than the bound — which is what
 * {@link MAX_COMMAND_TEXT}'s own comment explains for `background_work`. Doing the arithmetic once,
 * here, means every bound in this file is the number the schema states rather than one less than it.
 *
 * ⚠️ **Only TEXT is clipped.** A name and an alias are things a person types, and a truncated one is
 * unusable — so those are dropped instead; see {@link boundCommands}. Shortening a description
 * costs a reader some words, and shortening a name costs them the command.
 *
 * ⚑ **Exported since 319, and the sentence above is why it was not copied instead.** `boundRecall`
 * in `memory-recall.ts` bounds the model's note about a cited memory file and needs exactly this
 * INCLUSIVE arithmetic, so it reaches for the one helper rather than growing a second two-line copy
 * of it — `169` §1 at the smallest scale it applies at. ⛔ The module it lives in is about command
 * palettes and this is about memory; nothing else crosses between them, and nothing else should.
 */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
