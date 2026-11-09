import { providerDescriptor, providerRecord } from '@brobot2/shared'

export interface ProviderCommand {
  /** What the provider calls it, without its prefix — `compact`, `imagegen`. */
  readonly name: string
  
  readonly description?: string
  /** The provider's own hint for what follows the command — `[pr number]`. 17 of 44 carry one. */
  readonly argumentHint?: string
  
  readonly aliases?: string[]
  
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

export interface ProviderCommandSet {
  readonly commands: readonly ProviderCommand[]
  /** What a person types before {@link ProviderCommand.name} — `/` for Claude, `$` for Codex. */
  readonly prefix: string
}

export interface ProviderCommandAnswer extends ProviderCommandSet {
  readonly dropped?: number
}

export const MAX_PROVIDER_COMMANDS = 200

export const MAX_COMMAND_TEXT = 500

export const MAX_COMMAND_NAME = 120

export const MAX_COMMAND_ALIASES = 20

export const PROVIDER_COMMAND_PREFIX = providerRecord(
  (provider) => providerDescriptor(provider).commandPrefix,
)

export function boundCommands(sent: readonly ProviderCommand[]): {
  readonly commands: ProviderCommand[]
  readonly dropped: number
} {
  const commands = sent
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

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
