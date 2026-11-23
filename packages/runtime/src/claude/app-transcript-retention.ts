import { basename, relative, resolve, sep } from 'node:path'
import type { Settings } from '@anthropic-ai/claude-agent-sdk'

export function isManagedClaudeHome(providerHome: string, managedRoot?: string): boolean {
  if (!managedRoot || basename(managedRoot) !== 'provider-homes') return false
  const parts = relative(resolve(managedRoot), resolve(providerHome)).split(sep)
  return (
    parts.length === 3 &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
    parts[2] === 'claude'
  )
}

/** The app owns cleanup only below its explicit managed root, never in another provider home. */
export function managedTranscriptSettings(
  providerHome: string,
  managedRoot?: string,
): Pick<Settings, 'cleanupPeriodDays'> {
  return isManagedClaudeHome(providerHome, managedRoot) ? { cleanupPeriodDays: 36500 } : {}
}
