import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { UpdateChannel } from '../shared/updates'

/**
 * 🔴 **W4.109 · B1 — how a computer's BroBot looks for updates**: whether it checks by itself, and
 * on which channel. One per computer, not per workspace: `<appData>/@brobot2/settings.json`, beside
 * the default data folder, never inside one.
 *
 * ⚑ **A hidden launch keeps its own** (`<userData>/update-settings.json`): every test, smoke and
 * probe is one, and none of them may change what a person chose for this computer. ⛔ It checks
 * only when asked, or when its own file says so, so no test reaches GitHub by running long.
 */
export interface UpdateSettings {
  readonly checkAutomatically: boolean
  readonly channel: UpdateChannel
}

/**
 * Default to automatic checks and stable releases.
 */
export const UPDATE_DEFAULTS: UpdateSettings = { checkAutomatically: true, channel: 'stable' }
/** What a hidden launch starts with: checks off. */
export const HIDDEN_UPDATE_DEFAULTS: UpdateSettings = {
  checkAutomatically: false,
  channel: 'stable',
}

/** Where the settings live, and what they are until the file says otherwise. */
export function updateSettingsOf(where: {
  readonly appData: string
  readonly userData: string
  readonly hidden: boolean
}): { readonly file: string; readonly defaults: UpdateSettings } {
  return where.hidden
    ? { file: join(where.userData, 'update-settings.json'), defaults: HIDDEN_UPDATE_DEFAULTS }
    : { file: join(where.appData, '@brobot2', 'settings.json'), defaults: UPDATE_DEFAULTS }
}

/** The settings in `file`, or `defaults` for anything it does not say plainly. */
export function readUpdateSettings(file: string, defaults: UpdateSettings): UpdateSettings {
  let said: unknown
  try {
    said = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return defaults
  }
  const updates =
    typeof said === 'object' && said !== null ? (said as { updates?: unknown }).updates : undefined
  const read =
    typeof updates === 'object' && updates !== null ? (updates as Record<string, unknown>) : {}
  return {
    checkAutomatically:
      typeof read.checkAutomatically === 'boolean'
        ? read.checkAutomatically
        : defaults.checkAutomatically,
    channel: read.channel === 'beta' || read.channel === 'stable' ? read.channel : defaults.channel,
  }
}

/**
 * Write the settings, keeping whatever else the file holds. ⚑ Written beside it and renamed, so a
 * reader never sees half a file. ⚑ **Each process writes its own temporary file**, so two writers —
 * workspaces beside one computer's file, or two launches the one-host gate let through — can lose a
 * write but never tear one. A write that fails takes its temporary file with it; one a kill leaves
 * is named so a reset knows it (`scripts/lib/clean-base.mjs`' `UPDATE_SETTINGS_PART`).
 */
export function writeUpdateSettings(file: string, settings: UpdateSettings): void {
  let rest: Record<string, unknown> = {}
  try {
    const said = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof said === 'object' && said !== null && !Array.isArray(said)) {
      rest = said as Record<string, unknown>
    }
  } catch {
    // No file yet, or one that is not JSON: it is replaced.
  }
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify({ ...rest, updates: settings }, null, 2)}\n`)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
