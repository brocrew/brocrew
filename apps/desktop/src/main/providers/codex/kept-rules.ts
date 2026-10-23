import { dirname, join } from 'node:path'
import {
  CODEX_EXEC_POLICY_RULES,
  forgetToolApproval,
  keptToolApprovals,
  keptToolApprovalsFile,
  type KeptToolApproval,
} from '@brobot2/runtime'
import type { KeptRule, KeptRulesFile } from '../../../shared/runtime-ipc'
import { NO_LONGER_KEPT, readSmall, rewrite } from '../kept-rule-io'
import type { KeptRulePolicy } from '../kept-rule-policy'

/** One line Codex writes for a kept command: its prefix, as a JSON list of words. */
const PREFIX_RULE = /^prefix_rule\(pattern=(\[.*\]), decision="allow"\)$/

/** A line as written on any system: a Windows line ending is not part of it. */
const withoutCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)

function codexRulesIn(file: string): KeptRulesFile | null {
  const read = readSmall(file)
  if (read.state === 'absent') return null
  if (read.state === 'unreadable') return { file, rules: [], unreadable: read.why }
  const lines = [...new Set(read.text.split('\n').map(withoutCr))]
  const rules = lines.flatMap((line): KeptRule[] => {
    const pattern = PREFIX_RULE.exec(line)?.[1]
    if (pattern === undefined) return []
    try {
      const prefix: unknown = JSON.parse(pattern)
      return Array.isArray(prefix) && prefix.every((word) => typeof word === 'string')
        ? [{ kept: line, rule: { kind: 'command-prefix', prefix: prefix as string[] } }]
        : []
    } catch {
      return []
    }
  })
  return rules.length === 0 ? null : { file, rules }
}

function codexApprovalsIn(home: string): KeptRulesFile | null {
  const kept = keptToolApprovals(home)
  return kept.length === 0
    ? null
    : {
        file: keptToolApprovalsFile(home),
        rules: kept.map((one) => ({
          kept: JSON.stringify({ server: one.server, url: one.url, tool: one.tool }),
          rule: { kind: 'tool', tool: one.tool, server: one.server },
        })),
      }
}

export const keptRules: KeptRulePolicy = {
  projectFolders: () => [],
  files: (homes) =>
    homes.flatMap((home) =>
      [codexRulesIn(join(home, CODEX_EXEC_POLICY_RULES)), codexApprovalsIn(home)].filter(
        (one): one is KeptRulesFile => one !== null,
      ),
    ),
  remove: (file, kept, platform) => {
    if (file === keptToolApprovalsFile(dirname(file))) {
      forgetToolApproval(dirname(file), JSON.parse(kept) as KeptToolApproval)
    } else {
      rewrite(
        file,
        (text) => {
          const lines = text.split('\n')
          const left = lines.filter((line) => withoutCr(line) !== kept)
          if (left.length === lines.length) throw new Error(NO_LONGER_KEPT)
          return left.join('\n')
        },
        platform,
      )
    }
  },
}
