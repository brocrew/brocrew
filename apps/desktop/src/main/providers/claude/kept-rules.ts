import { persistedRulesFile } from '@brobot2/runtime'
import type { KeptRule, KeptRulesFile } from '../../../shared/runtime-ipc'
import { NO_LONGER_KEPT, readSmall, rewrite } from '../kept-rule-io'
import type { KeptRulePolicy } from '../kept-rule-policy'

/** A Claude permission rule, as Claude Code's settings spell one: `Tool`, or `Tool(specifier)`. */
function claudeRule(kept: string): KeptRule['rule'] {
  const open = kept.indexOf('(')
  return open > 0 && kept.endsWith(')')
    ? { kind: 'tool', tool: kept.slice(0, open), content: kept.slice(open + 1, -1) }
    : { kind: 'tool', tool: kept }
}

/** A settings file's `permissions.allow`, or `null` when there is none. */
function allowOf(parsed: unknown): string[] | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const permissions = (parsed as { permissions?: unknown }).permissions
  if (typeof permissions !== 'object' || permissions === null) return null
  const allow = (permissions as { allow?: unknown }).allow
  return Array.isArray(allow) ? allow.filter((one): one is string => typeof one === 'string') : null
}

function claudeRulesIn(file: string): KeptRulesFile | null {
  const read = readSmall(file)
  if (read.state === 'absent') return null
  if (read.state === 'unreadable') return { file, rules: [], unreadable: read.why }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch {
    return { file, rules: [], unreadable: 'it is not JSON' }
  }
  const allow = [...new Set(allowOf(parsed) ?? [])]
  return allow.length === 0
    ? null
    : { file, rules: allow.map((kept) => ({ kept, rule: claudeRule(kept) })) }
}

/** A settings file's text with one allow rule gone, and everything else in it as it was. */
function withoutAllowRule(text: string, kept: string): string {
  const parsed: unknown = JSON.parse(text)
  const allow = allowOf(parsed)
  if (allow === null || !allow.includes(kept)) throw new Error(NO_LONGER_KEPT)
  const permissions = (parsed as { permissions: { allow: unknown[] } }).permissions
  permissions.allow = permissions.allow.filter((one) => one !== kept)
  return `${JSON.stringify(parsed, null, 2)}\n`
}

export const keptRules: KeptRulePolicy = {
  projectFolders: (records) => [
    ...new Set(records.filter((one) => one.provider === 'claude').map((one) => one.cwd)),
  ],
  files: (homes, projectFiles) =>
    [...new Set([...homes.map(persistedRulesFile), ...projectFiles])].flatMap(
      (file) => claudeRulesIn(file) ?? [],
    ),
  remove: (file, kept, platform) => rewrite(file, (text) => withoutAllowRule(text, kept), platform),
}
