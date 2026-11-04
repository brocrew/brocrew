import { importLegacyConfiguration } from './legacyConfiguration.js'
import type { LegacyConfigurationInput } from './legacyConfiguration.js'
import { randomBytes } from 'node:crypto'
import { privateFolder } from './privatePaths.js'
import { lstatSync, mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { browserChoice } from './shared/browser/launchConfig.js'
import type { BrowserChoice } from './shared/browser/launchConfig.js'
import { sharedProfilesRelease, sharedProfilesReleased } from './sharedProfilesRelease.js'

export class ConfigError extends Error {}
export interface AgentChromeConfig {
  port: number
  shared?: { root: string; workspaceId: string; workspaceLabel: string; migrationApproved: boolean }
  home: string
  workspace: string
  downloadsRoot: string
  browser?: BrowserChoice
  token: string
  previousVersion?: string
  previousDataSchema?: number
  noSandbox?: boolean
  noTestType?: boolean
}

export function privateDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!lstatSync(dir).isDirectory()) throw new ConfigError('Plugin unavailable. Try again.')
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

/** The installation owner supplies retained paths; HOME and cwd never select a store. */
export function loadConfig(env: Record<string, string | undefined>): AgentChromeConfig {
  const invalid = (): never => {
    throw new ConfigError('Plugin unavailable. Try again.')
  }
  let bootstrap: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(env.BROCREW_PLUGIN_BOOTSTRAP ?? '')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
    bootstrap = value as Record<string, unknown>
  } catch {
    return invalid()
  }
  const home = bootstrap.dataDirectory
  if (
    bootstrap.api !== 1 ||
    bootstrap.pluginId !== 'chrome' ||
    typeof home !== 'string' ||
    !path.isAbsolute(home) ||
    bootstrap.dataSchema !== 1 ||
    (bootstrap.previousDataSchema !== undefined && bootstrap.previousDataSchema !== 1) ||
    (bootstrap.previousVersion !== undefined && typeof bootstrap.previousVersion !== 'string')
  )
    return invalid()
  if (env.BROCREW_CHROME_EXECUTABLE && !path.isAbsolute(env.BROCREW_CHROME_EXECUTABLE))
    return invalid()
  const priorOwner = bootstrap.priorOwner as { ownerId?: unknown; ownerLabel?: unknown } | undefined
  if (
    priorOwner !== undefined &&
    (!priorOwner ||
      typeof priorOwner !== 'object' ||
      typeof priorOwner.ownerId !== 'string' ||
      typeof priorOwner.ownerLabel !== 'string')
  )
    return invalid()
  let legacy: LegacyConfigurationInput | undefined
  if (bootstrap.legacyConfiguration !== undefined) {
    const value = bootstrap.legacyConfiguration as LegacyConfigurationInput
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.directory !== 'string' ||
      !path.isAbsolute(value.directory) ||
      typeof value.floor !== 'string' ||
      !path.isAbsolute(value.floor)
    )
      return invalid()
    legacy = value
  }
  const sharedRoot = bootstrap.sharedDataDirectory
  let shared: AgentChromeConfig['shared']
  if (sharedRoot !== undefined) {
    if (typeof sharedRoot !== 'string' || !path.isAbsolute(sharedRoot)) return invalid()
    // This is the historical installation/root owner, never a requesting app workspace.
    const workspaceId = (priorOwner?.ownerId ?? env.BROCREW_PLUGIN_OWNER_ID) as string | undefined
    if (
      !workspaceId ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(workspaceId)
    )
      throw new ConfigError('Shared Chrome workspace identity is invalid.')
    if (sharedProfilesReleased(process.platform, sharedProfilesRelease)) {
      shared = {
        root: sharedRoot,
        workspaceId,
        workspaceLabel: (priorOwner?.ownerLabel ??
          env.BROCREW_PLUGIN_OWNER_LABEL ??
          'another') as string,
        migrationApproved: true,
      }
    }
  }
  // Schema 1 is unchanged. Opening the same stores preserves existing domain migrations;
  // startup never imports or executes commands from the old app consumption ledger.
  privateDirectory(home)
  importLegacyConfiguration(home, legacy)
  if (shared) privateFolder(shared.root, shared.root)
  const workspace = path.join(home, 'files')
  const downloadsRoot = path.join(home, 'downloads')
  for (const dir of [workspace, downloadsRoot]) {
    privateFolder(home, dir, true)
    privateDirectory(dir)
  }
  return {
    port: 0,
    home,
    workspace,
    downloadsRoot,
    ...(shared ? { shared } : {}),
    token: randomBytes(32).toString('hex'),
    previousVersion: bootstrap.previousVersion as string | undefined,
    previousDataSchema: bootstrap.previousDataSchema as number | undefined,
    browser: browserChoice('chrome', env.BROCREW_CHROME_EXECUTABLE),
  }
}
