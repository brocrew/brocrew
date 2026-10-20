import { privateFolder } from './privatePaths.js'
import { lstatSync, readFileSync, mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { browserChoice } from './shared/browser/launchConfig.js'
import type { BrowserChoice } from './shared/browser/launchConfig.js'

export class ConfigError extends Error {}
export interface AgentChromeConfig {
  port: number
  home: string
  authPath: string
  workspace: string
  downloadsRoot: string
  browser?: BrowserChoice
  token: string
  adminToken: string
  noSandbox?: boolean
  noTestType?: boolean
}

export function privateDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!lstatSync(dir).isDirectory()) throw new ConfigError('Plugin unavailable. Try again.')
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

export function loadConfig(env: Record<string, string | undefined>): AgentChromeConfig {
  const home = env.BROCREW_CHROME_DATA
  const authPath = env.BROCREW_CHROME_AUTH
  if (!home || !path.isAbsolute(home) || !authPath || !path.isAbsolute(authPath))
    throw new ConfigError('Plugin unavailable. Try again.')
  const port = Number(env.BROCREW_CHROME_PORT ?? '0')
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new ConfigError('Plugin unavailable. Try again.')
  if (env.BROCREW_CHROME_EXECUTABLE && !path.isAbsolute(env.BROCREW_CHROME_EXECUTABLE))
    throw new ConfigError('Plugin unavailable. Try again.')
  privateDirectory(home)
  let auth: unknown
  try {
    const stat = lstatSync(authPath)
    if (
      !stat.isFile() ||
      stat.size > 16384 ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
    )
      throw new Error()
    auth = JSON.parse(readFileSync(authPath, 'utf8'))
  } catch {
    throw new ConfigError('Plugin unavailable. Try again.')
  }
  const pair = auth as { mcpToken?: unknown; adminToken?: unknown } | null
  const valid = (v: unknown): v is string =>
    typeof v === 'string' && /^[\x21-\x7e]{32,4096}$/.test(v)
  if (!valid(pair?.mcpToken) || !valid(pair?.adminToken) || pair.mcpToken === pair.adminToken)
    throw new ConfigError('Plugin unavailable. Try again.')
  const workspace = path.join(home, 'files')
  const downloadsRoot = path.join(home, 'downloads')
  for (const dir of [workspace, downloadsRoot]) {
    privateFolder(home, dir, true)
    privateDirectory(dir)
  }
  return {
    port,
    home,
    authPath,
    workspace,
    downloadsRoot,
    token: pair.mcpToken,
    adminToken: pair.adminToken,
    browser: browserChoice('chrome', env.BROCREW_CHROME_EXECUTABLE),
  }
}
