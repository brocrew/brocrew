import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MAX_USAGE_WINDOWS, SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { MAX_INSTANT } from '../shared/clock'
import type { ProviderUsageReading, UsageWindowSeen } from '../shared/runtime-ipc'
import { AN_ACCOUNT_ID } from './provider-accounts-file'

/**
 * 🔴 **F096 — each provider's newest usage reading per window, kept across a restart.**
 *
 * The host holds the readings a conversation's provider sends (Claude's `rate_limit_event`, Codex's
 * rate-limit snapshot) as one value per provider and window. Until F096 they lived in memory only,
 * so a restart forgot how full the weekly window was until the provider spoke again. This file
 * keeps that one value per window, overwritten in place: `<userData>/provider-usage.json`.
 *
 * ⚑ **A file in the data folder, not a table.** A table would be a database migration, which an
 * older build then refuses to open; a reading is a fact this app can lose without harm (the next
 * provider frame says it again), so it is not worth that.
 *
 * ⚑ **And which windows each provider has reported, first and last** (`seen`) — kept when the
 * readings are forgotten, so the file says whether a window comes at all.
 *
 * ⚑ **Read once, at the host's start, and written when a number moves or a window is first seen**
 * (and when readings are forgotten, when the sign-in they were read on moves, and at the quit).
 * ⚑ Written beside it and renamed, so a reader never sees half a file; each process writes its own
 * temporary file (`<file>.<pid>.tmp`), so two writers can lose a write but never tear one.
 */
export interface KeptUsage {
  readonly readings: Readonly<Record<Provider, readonly KeptReading[]>>
  readonly seen: Readonly<Record<Provider, readonly UsageWindowSeen[]>>
  /**
   * The sign-in each provider's latest reading was read on, as the conversation that reported it
   * tagged it (`SessionHandle.signInTag`): what a later run compares its own sign-in with before it
   * lets a kept reading warn. Absent for a provider whose latest reading carried no tag.
   */
  readonly readOn?: Readonly<Partial<Record<Provider, string>>>
}

/**
 * A reading as it is kept, with the account it was read on when that is known: Claude's as
 * `provider-accounts-file.ts` names it, Codex's as its sign-in tag (which is of its account). ⛔ An
 * id, never the account's email.
 */
export interface KeptReading extends ProviderUsageReading {
  readonly account?: string
}

/** Where a data folder keeps its readings. */
export function providerUsageFile(userData: string): string {
  return join(userData, 'provider-usage.json')
}

/** No readings at all. */
export const NO_USAGE_KEPT: KeptUsage = {
  readings: { claude: [], codex: [] },
  seen: { claude: [], codex: [] },
}

/**
 * The readings `file` holds, each checked as a reading must be, or none: a file that is missing,
 * is not JSON, or holds something else is read as no readings — they come back with the provider's
 * next frame. ⛔ At most {@link MAX_USAGE_WINDOWS} windows a provider, as the host keeps.
 */
export function readKeptUsage(file: string): KeptUsage {
  let said: unknown
  try {
    said = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return NO_USAGE_KEPT
  }
  const whole = aRecord(said)
  const tags = aRecord(whole['readOn'])
  const readOn: Partial<Record<Provider, string>> = {}
  for (const provider of SUPPORTED_PROVIDERS) {
    const tag = tags[provider]
    if (typeof tag === 'string' && /^[0-9a-f]{32}$/.test(tag)) readOn[provider] = tag
  }
  return {
    readings: perProvider(whole['readings'], aReading),
    seen: perProvider(whole['seen'], aWindowSeen),
    ...(Object.keys(readOn).length === 0 ? {} : { readOn }),
  }
}

/** Each provider's rows of one kind, each checked, one per window, at most {@link MAX_USAGE_WINDOWS}. */
function perProvider<T extends { readonly window: string }>(
  said: unknown,
  checked: (row: unknown) => T | null,
): Record<Provider, T[]> {
  const providers = aRecord(said)
  const kept = { claude: [], codex: [] } as Record<Provider, T[]>
  for (const provider of SUPPORTED_PROVIDERS) {
    const rows = providers[provider]
    if (!Array.isArray(rows)) continue
    const windows = new Set<string>()
    for (const row of rows) {
      const one = checked(row)
      if (one === null || windows.has(one.window)) continue
      if (kept[provider].length >= MAX_USAGE_WINDOWS) break
      windows.add(one.window)
      kept[provider].push(one)
    }
  }
  return kept
}

/** `said` as a record, or an empty one when it is not one. */
function aRecord(said: unknown): Record<string, unknown> {
  return typeof said === 'object' && said !== null && !Array.isArray(said)
    ? (said as Record<string, unknown>)
    : {}
}

/** Write every provider's readings, replacing what the file held. */
export function writeKeptUsage(file: string, usage: KeptUsage): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(usage, null, 2)}\n`)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/** One window seen as the host keeps it, or `null` when `row` is not one. */
function aWindowSeen(row: unknown): UsageWindowSeen | null {
  const { window, first, last } = aRecord(row)
  if (!aWindow(window) || !aTime(first) || !aTime(last) || last < first) return null
  return { window, first, last }
}

/** A window's name as a provider says it: a string, not empty, at most 120 characters. */
function aWindow(window: unknown): window is string {
  return typeof window === 'string' && window.length > 0 && window.length <= 120
}

/** One reading as the host keeps it, or `null` when `row` is not one. */
function aReading(row: unknown): KeptReading | null {
  const { window, usedPercent, resetsAt, at, account } = aRecord(row)
  if (!aWindow(window)) return null
  if (!aTime(at)) return null
  const percent = usedPercent === null ? null : aPercent(usedPercent)
  if (percent === undefined) return null
  if (resetsAt !== null && !aTime(resetsAt)) return null
  // An account that is not one is read as not known, as a reading kept before there were any.
  const readOn = typeof account === 'string' && AN_ACCOUNT_ID.test(account) ? account : undefined
  return {
    window,
    usedPercent: percent,
    resetsAt: resetsAt as number | null,
    at: at as number,
    ...(readOn === undefined ? {} : { account: readOn }),
  }
}

/** A percentage a provider could report, or `undefined` when it is not one. */
function aPercent(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** An epoch-ms instant, positive and one a date can hold ({@link MAX_INSTANT}): past it, saying it throws. */
function aTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_INSTANT
}
