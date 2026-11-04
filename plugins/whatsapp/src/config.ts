import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  importLegacyConfiguration,
  type LegacyConfiguration,
  type ConsumedConfiguration,
} from './legacyConfiguration.js'
import { privateFolder } from './privatePaths.js'

export class ConfigError extends Error {}
export interface WhatsAppConfig {
  home: string
  previousVersion?: string
  previousDataSchema?: number
  legacyConsumed?: ConsumedConfiguration
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
}
const unavailable = () => new ConfigError('Plugin unavailable. Try again.')
export function privateDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!lstatSync(dir).isDirectory()) throw unavailable()
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

/** Generic runner input; never derive retained account data from HOME or the code directory. */
export function loadConfig(env: Record<string, string | undefined>): WhatsAppConfig {
  let bootstrap: {
    dataDirectory?: string
    previousVersion?: string
    previousDataSchema?: number
    legacyConfiguration?: LegacyConfiguration
  } = {}
  if (env.BROCREW_PLUGIN_BOOTSTRAP) {
    try {
      bootstrap = JSON.parse(env.BROCREW_PLUGIN_BOOTSTRAP)
      if (!bootstrap || typeof bootstrap !== 'object') throw unavailable()
    } catch {
      throw unavailable()
    }
  }
  const home = env.BROCREW_PLUGIN_DATA ?? bootstrap.dataDirectory
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw unavailable()
  if (bootstrap.dataDirectory !== undefined && bootstrap.dataDirectory !== home) throw unavailable()
  if (bootstrap.previousVersion !== undefined && typeof bootstrap.previousVersion !== 'string')
    throw unavailable()
  // Schema 1 needs no file conversion. Leave account/history bytes and consumed commands opaque.
  // A later schema needs its own package migration; do not reinterpret it as a fresh account.
  if (bootstrap.previousDataSchema !== undefined && bootstrap.previousDataSchema !== 1)
    throw new ConfigError('Unsupported WhatsApp data schema. Existing data was kept.')
  privateDirectory(home)
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
    home,
    ...folders,
    previousVersion: bootstrap.previousVersion,
    previousDataSchema: bootstrap.previousDataSchema,
    legacyConsumed: importLegacyConfiguration(home, bootstrap.legacyConfiguration),
  }
}
