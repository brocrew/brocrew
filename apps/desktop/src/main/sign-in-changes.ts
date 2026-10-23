import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'

/**
 * 🔴 **W4.172 · F095 — when this app last saw each provider's sign-in change, kept across a
 * restart** (`RuntimeHost.aSignInChanged`): `<userData>/sign-in-changes.json`, a provider's moment
 * in epoch ms. ⚑ A usage limit recorded before it was the sign-in before's, and holds nothing.
 *
 * ⚑ **Why a file and not a row of the ledger**: the moment is one fact per provider, about this
 * Mac and not about any one conversation, written once per switch (a later report of the same
 * switch moves nothing) and read whole at a launch — where every conversation starts on the
 * current sign-in, so nothing could report a change made before it. A ledger row would belong to
 * whichever conversation happened to see the switch, and reading it at every look at the limits
 * would want an index of its own, so a migration, for one number per provider.
 *
 * ⚑ Written whole, through a temporary file of this process's own; a file that cannot be read is
 * no change seen, and says so — the safe way to be wrong, since a limit it would have ended still
 * ends at its reset or when the provider takes work again.
 */

/** The file's name in a data folder — and a reset's manifest names it (`scripts/lib/clean-base.mjs`). */
export const SIGN_IN_CHANGES_FILE = 'sign-in-changes.json'

/** Where the moments are kept, and how they are read and written. */
export interface SignInChanges {
  /** Each provider's last noted change; empty when none was, or the file cannot be read. */
  read(): ReadonlyMap<Provider, number>
  /** Keep these moments, whole. ⚠️ Throws when they cannot be written; the caller says so. */
  write(changed: ReadonlyMap<Provider, number>): void
}

/** The moments kept in a data folder. */
export function signInChangesIn(userData: string): SignInChanges {
  const file = join(userData, 'sign-in-changes.json')
  return {
    read: () => readSignInChanges(file),
    write: (changed) => writeSignInChanges(file, changed),
  }
}

/** The moments in `file`: each provider's, when it is a moment; nothing for a file not there. */
export function readSignInChanges(file: string): ReadonlyMap<Provider, number> {
  const changed = new Map<Provider, number>()
  let said: unknown
  try {
    said = JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`the sign-in changes in ${file} could not be read: ${String(error)}`)
    }
    return changed
  }
  const moments =
    typeof said === 'object' && said !== null ? (said as { changed?: unknown }).changed : undefined
  if (typeof moments !== 'object' || moments === null) return changed
  for (const provider of SUPPORTED_PROVIDERS) {
    const at = (moments as Record<string, unknown>)[provider]
    if (typeof at === 'number' && Number.isFinite(at) && at > 0) changed.set(provider, at)
  }
  return changed
}

/**
 * Keep `changed` in `file`, whole: a temporary file of this process's own, renamed over it. ⛔ Its
 * folder is never made here: the data folder is there while the app runs, and a write after it was
 * removed fails rather than bringing it back.
 */
export function writeSignInChanges(file: string, changed: ReadonlyMap<Provider, number>): void {
  const temporary = `${file}.${String(process.pid)}.tmp`
  const content = { version: 1, changed: Object.fromEntries(changed) }
  try {
    writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
