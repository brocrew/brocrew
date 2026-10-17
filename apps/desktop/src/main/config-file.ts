import { basename } from 'node:path'
import type { ConfigFileResult, ProviderConfigFile } from '../shared/runtime-ipc'
import { readTextFile, realPathOf } from './read-text-file'

/**
 * 🔴 **733 · Reading one config file the Info panel lists** — its *Open* (`731` F-2).
 *
 * ⛔ **Until `733` the panel offered Finder and nothing else for these files, and the reason was a
 * credential**: *"Reveal, never open, and the difference is a credential. This panel names an
 * `auth.json`"*. The PM, on `731` F-2, under R92 (*"not on what BroBot itself opens for a person"*)
 * and R93 (*"no new guards and remove old guards"*): *"Offer Open as for any other file, and drop
 * the credential wording."*
 *
 * ⚑ **So it is exactly the provider-reported file's Open** (`instruction-source.ts`), on another
 * row: the renderer names the FILE by the name {@link ProviderConfigFile} gave it, the caller hands
 * over the list this session's provider config declares, and what is read is decided by
 * {@link readTextFile}'s rules alone — a regular file, not a binary (which cannot be drawn as text),
 * within a ceiling it reports. `auth.json` included.
 *
 * ⚠️ **The name is the confinement, not a path.** The renderer never supplies a path, for the reason
 * every door beside this one gives: the readable set is *"the files this session's config
 * declares"*, and a path parameter would make it *"whatever the renderer asks for"*.
 */

/**
 * How much of a config file is read.
 *
 * ⚠️ **A megabyte, a workflow output's ceiling**, not an instruction file's half of one: Claude's
 * `.claude.json` is state the SDK keeps growing. A cut is reported, never hidden — the panel says
 * the paper was cut at the size limit, and the result carries the file's real size.
 */
export const MAX_CONFIG_BYTES = 1024 * 1024

/**
 * Read the file named `name` off `files`, or say why not.
 *
 * No Electron, no database, no session — the caller supplies the list the provider config reports
 * and this decides whether to open one of them, so the whole door is one function a test can drive
 * with real files.
 */
export function readConfigFile(
  /** ⛔ **The confinement.** The files this session's provider config declares. */
  files: readonly ProviderConfigFile[],
  name: string,
): ConfigFileResult {
  const path = files.find((file) => file.name === name)?.path
  if (path === undefined || path === '') return { ok: false, reason: 'no-path' }
  // Read at the REAL path: a link is followed, and it is where it lands that is read.
  const resolved = realPathOf(path)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  const read = readTextFile(resolved.path, MAX_CONFIG_BYTES)
  if (typeof read === 'string') return { ok: false, reason: read }
  // ⚠️ The path reported back is the one the config NAMED — the row the person pressed.
  return { ok: true, path, name: basename(path), ...read }
}
