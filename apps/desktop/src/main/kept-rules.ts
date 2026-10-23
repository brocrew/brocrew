import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { providerRecord, type Provider } from '@brobot2/shared'
import type { KeptRuleRemoved, KeptRules, KeptRulesFile } from '../shared/runtime-ipc'
import { providerKnowledge } from './providers/knowledge-definitions'
import { NO_LONGER_KEPT } from './providers/kept-rule-io'

/**
 * The rules an *Always allow* kept beyond its conversation, where each provider keeps them, and the
 * one way to remove one (the Providers page's kept rules).
 *
 * - **Claude** keeps an allow rule in a settings file's `permissions.allow`, written `Tool` or
 *   `Tool(specifier)` (Claude Code's settings and permissions docs). Listed: for every folder a Claude
 *   conversation here worked in, the project's local settings, found as a launch finds them and
 *   handed in already found (`settings-locations.ts`: finding one runs git, never on the main
 *   thread); and each agent home's `settings.json`.
 * - **Codex** keeps a command's in each agent's home, one `prefix_rule(pattern=[…], decision="allow")`
 *   line per rule ({@link CODEX_EXEC_POLICY_RULES}); an MCP tool's in this app's own file beside it
 *   ({@link keptToolApprovals}). ⚠️ Codex appends to its file under a lock this process cannot take,
 *   so a rule Codex keeps in the instant a removal rewrites that file can be lost with it.
 *
 * ⚑ Only allow rules are listed: they are what *Always allow* keeps. ⛔ A removal edits only the
 * file it names, and only a rule this list holds when it is asked — anything else is refused.
 * ⛔ And never a file in the person's own provider folders (a conversation run in the home folder
 * keeps its project settings there): those are listed, and a rule in them is removed by hand.
 */

/** Where to look: the local settings of the folders Claude conversations worked in, and every agent's home. */
export interface WhereRulesAreKept {
  readonly projectFiles: Readonly<Record<Provider, readonly string[]>>
  readonly homes: readonly { readonly provider: Provider; readonly path: string }[]
  /** The person's own provider folders, which this app reads from and never writes to. */
  readonly personsOwn: readonly string[]
}

/** Every provider's kept rules, file by file; a file that keeps none is left out. */
export function readKeptRules(where: WhereRulesAreKept): KeptRules {
  const homesOf = (provider: Provider): string[] =>
    where.homes.filter((home) => home.provider === provider).map((home) => home.path)
  const marked = (file: KeptRulesFile): KeptRulesFile =>
    inThePersonsOwn(file.file, where.personsOwn) ? { ...file, notEditedHere: PERSONS_OWN } : file
  return providerRecord((provider) =>
    providerKnowledge[provider].keptRules
      .files(homesOf(provider), where.projectFiles[provider])
      .map(marked),
  )
}

const PERSONS_OWN = 'it is in your own provider folder, which BroCrew does not write to'

/** Whether a file is in one of the person's own provider folders, read through any link. */
function inThePersonsOwn(file: string, personsOwn: readonly string[]): boolean {
  const real = realOrResolved(file)
  return personsOwn.some((folder) => {
    const root = realOrResolved(folder)
    return real === root || real.startsWith(`${root}${sep}`)
  })
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Remove one kept rule from its file. ⛔ Only a rule the list holds now, in the file it names: the
 * window's word is checked against a fresh reading, never trusted. ⛔ Never throws: a refusal says
 * why.
 */
export function removeKeptRule(
  where: WhereRulesAreKept,
  input: { readonly provider: Provider; readonly file: string; readonly kept: string },
  platform: NodeJS.Platform = process.platform,
): KeptRuleRemoved {
  const listed = readKeptRules(where)[input.provider].find((one) => one.file === input.file)
  if (listed === undefined || !listed.rules.some((one) => one.kept === input.kept)) {
    return { removed: false, why: NO_LONGER_KEPT }
  }
  if (listed.notEditedHere !== undefined) return { removed: false, why: listed.notEditedHere }
  try {
    providerKnowledge[input.provider].keptRules.remove(input.file, input.kept, platform)
    return { removed: true }
  } catch (error) {
    return { removed: false, why: error instanceof Error ? error.message : String(error) }
  }
}
