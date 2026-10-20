import { chmodSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { privateFolder } from './privatePaths.js'

export class ConfigError extends Error {}
export interface WhatsAppConfig {
  port: number
  home: string
  authPath: string
  /** Files an agent puts here can be sent to a group. */
  files: string
  /** Photos and PDFs get_media saves. */
  downloads: string
  /** The bridge's WhatsApp session and message store. Only the bridge opens it. */
  bridgeData: string
  /** The bridge's working copies of files it uploads. */
  scratch: string
  /** The bridge program, copied here so it can run. */
  bin: string
  token: string
  adminToken: string
}

const unavailable = () => new ConfigError('Plugin unavailable. Try again.')

export function privateDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!lstatSync(dir).isDirectory()) throw unavailable()
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

export function loadConfig(env: Record<string, string | undefined>): WhatsAppConfig {
  const home = env.BROCREW_WHATSAPP_DATA
  const authPath = env.BROCREW_WHATSAPP_AUTH
  if (!home || !path.isAbsolute(home) || !authPath || !path.isAbsolute(authPath))
    throw unavailable()
  const port = Number(env.BROCREW_WHATSAPP_PORT ?? '0')
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw unavailable()
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
    throw unavailable()
  }
  const pair = auth as { mcpToken?: unknown; adminToken?: unknown } | null
  const valid = (v: unknown): v is string =>
    typeof v === 'string' && /^[\x21-\x7e]{32,4096}$/.test(v)
  if (!valid(pair?.mcpToken) || !valid(pair?.adminToken) || pair.mcpToken === pair.adminToken)
    throw unavailable()
  const folders = {
    files: path.join(home, 'files'),
    downloads: path.join(home, 'downloads'),
    bridgeData: path.join(home, 'bridge'),
    scratch: path.join(home, 'scratch'),
    bin: path.join(home, 'bin'),
  }
  for (const dir of Object.values(folders)) {
    privateFolder(home, dir, true)
    privateDirectory(dir)
  }
  return {
    port,
    home,
    authPath,
    ...folders,
    token: pair.mcpToken,
    adminToken: pair.adminToken,
  }
}
