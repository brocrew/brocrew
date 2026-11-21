import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Scan the personal-home tree for markers attributable to this run. Changes made by other
 * provider sessions cannot identify an app write; run-specific markers cover writes beyond
 * a fixed before/after observation window or a short list of files.
 *
 * Markers have separate labels and values. Print only labels in findings: a value may be
 * a real credential, and no assertion or CI log may disclose it.
 *
 * @typedef {{ label: string, value: string }} Marker
 * @typedef {{ path: string, label: string }} Hit
 */

/** Shortest marker worth scanning for. A 4-character needle matches half the disk. */
export const MIN_MARKER_LENGTH = 8

/**
 * How deep a personal home is walked. The whole walk costs ~113 ms under `~/.claude` and ~204 ms
 * under `~/.codex`, so this is only a loop guard, deep enough that reaching it is worth
 * reporting; {@link pathsNaming} reports it either way. Plugin caches, marketplace checkouts and
 * their `node_modules` sit well below depth 6.
 */
export const DEFAULT_MAX_DEPTH = 64

/**
 * A scan with no markers finds nothing and proves nothing, so this throws rather than returning
 * `[]`: an empty marker list (say the caller's session id is `undefined`) lets every `expect`
 * pass and reads as coverage forever. The same goes for a marker too short to be distinctive.
 *
 * @param {readonly Marker[]} markers
 * @returns {readonly Marker[]}
 */
export function requireMarkers(markers) {
  if (!Array.isArray(markers) || markers.length === 0) {
    throw new Error('personal-home-guard: a scan with no markers is vacuous — pass at least one')
  }
  for (const marker of markers) {
    if (typeof marker?.label !== 'string' || marker.label.length === 0) {
      throw new Error('personal-home-guard: every marker needs a label to report itself by')
    }
    if (typeof marker?.value !== 'string' || marker.value.length < MIN_MARKER_LENGTH) {
      throw new Error(
        `personal-home-guard: marker "${marker?.label}" is shorter than ${MIN_MARKER_LENGTH} characters and would match anything`,
      )
    }
  }
  return markers
}

/**
 * Every path under `root` whose name contains one of `markers`.
 *
 * Directory names count: a leaked Claude session shows up as
 * `projects/<sanitized-cwd>/<sessionId>.jsonl`, and the sanitized cwd is a marker in its own right
 * even before a transcript lands in it.
 *
 * Symlinks are not followed: a personal home links out to plugin checkouts and worktrees, and
 * following them would walk half the disk and could loop. `withFileTypes` reports a link as
 * neither file nor directory, so it is named and skipped.
 *
 * The walk says when it stopped looking, so "covered everything" and "stopped looking" never read
 * the same. It can stop early three ways: it hits `limit` hits (`truncated`), it hits `maxDepth`
 * (`tooDeep`), or a directory will not open (`unreadable`). Each is a value the caller receives,
 * and `complete` is the single question to ask of them. They are reported rather than thrown,
 * unlike `requireMarkers`: hitting a cap is a fact about the machine, and the caller knows
 * whether to widen the limit or fail. An unreadable directory is not a finding (we could not have
 * written there either) but it is a hole in the evidence.
 *
 * @param {string} root
 * @param {readonly Marker[]} markers
 * @param {{ maxDepth?: number, limit?: number }} [options]
 * @returns {{ hits: Hit[], truncated: boolean, tooDeep: string[], unreadable: string[], complete: boolean }}
 */
export function pathsNaming(root, markers, options = {}) {
  requireMarkers(markers)
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const limit = options.limit ?? 50
  /** @type {Hit[]} */
  const hits = []
  let truncated = false
  /** Directories the depth bound stopped us descending into. @type {string[]} */
  const tooDeep = []
  /** Directories that would not open. @type {string[]} */
  const unreadable = []
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (depth > maxDepth) {
      tooDeep.push(dir)
      return
    }
    if (hits.length >= limit) {
      truncated = true
      return
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      // A directory that is not there is not one we failed to see: an absent home, or a path that
      // vanished between the parent listing and this call, leaves nothing unexamined. A directory that
      // exists and will not open is a part of the home this scan did not see.
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') unreadable.push(dir)
      return
    }
    for (const entry of entries) {
      if (hits.length >= limit) {
        truncated = true
        return
      }
      const full = join(dir, entry.name)
      const marker = markers.find((m) => entry.name.includes(m.value))
      if (marker) hits.push({ path: full, label: marker.label })
      if (entry.isDirectory()) walk(full, depth + 1)
    }
  }
  walk(root, 0)
  return {
    hits,
    truncated,
    tooDeep,
    unreadable,
    // The one question a caller should ask before believing an empty `hits`.
    complete: !truncated && tooDeep.length === 0 && unreadable.length === 0,
  }
}

/**
 * Why a scan is not complete, in one sentence, or `null` when it is.
 *
 * It names the first few paths rather than counting them, so a person can go and look.
 *
 * @param {{ truncated: boolean, tooDeep: string[], unreadable: string[], complete: boolean }} scan
 * @returns {string | null}
 */
export function whyIncomplete(scan) {
  if (scan.complete) return null
  const reasons = []
  if (scan.truncated)
    reasons.push('the hit limit was reached, so later matches were never examined')
  if (scan.tooDeep.length > 0) {
    reasons.push(
      `${scan.tooDeep.length} director(y|ies) sit below the depth bound and were not descended ` +
        `into (e.g. ${scan.tooDeep.slice(0, 3).join(', ')})`,
    )
  }
  if (scan.unreadable.length > 0) {
    reasons.push(
      `${scan.unreadable.length} director(y|ies) would not open (e.g. ` +
        `${scan.unreadable.slice(0, 3).join(', ')})`,
    )
  }
  return reasons.join('; ')
}

/**
 * Which of `files` CONTAIN one of `markers`.
 *
 * Takes an explicit file list rather than a tree: a content scan over a provider home is gigabytes,
 * and a check that cannot state which files it read is not a check. Files that are missing, too
 * large, or unreadable are reported through `skipped` so a scan cannot look thorough by having read
 * nothing.
 *
 * @param {readonly string[]} files
 * @param {readonly Marker[]} markers
 * @param {{ maxBytes?: number }} [options]
 * @returns {{ hits: Hit[], read: string[], skipped: string[] }}
 */
export function filesContaining(files, markers, options = {}) {
  requireMarkers(markers)
  const maxBytes = options.maxBytes ?? 8_000_000
  /** @type {Hit[]} */
  const hits = []
  /** @type {string[]} */
  const read = []
  /** @type {string[]} */
  const skipped = []
  for (const file of files) {
    let text
    try {
      if (statSync(file).size > maxBytes) {
        skipped.push(`${file} (larger than ${maxBytes} bytes)`)
        continue
      }
      text = readFileSync(file, 'utf8')
    } catch {
      skipped.push(`${file} (absent or unreadable)`)
      continue
    }
    read.push(file)
    for (const marker of markers) {
      if (text.includes(marker.value)) hits.push({ path: file, label: marker.label })
    }
  }
  return { hits, read, skipped }
}

/**
 * A one-line rendering of what a scan found — labels only, never values.
 *
 * @param {readonly Hit[]} hits
 * @returns {string}
 */
export function describeHits(hits) {
  if (hits.length === 0) return 'none'
  return hits.map((hit) => `${hit.label} → ${hit.path}`).join(' · ')
}

/**
 * The one sentence a leak assertion needs, over one or more walks: `'none'` only when every walk
 * finished and none of them found anything.
 *
 * Use this rather than `describeHits(scan.hits)`: `pathsNaming` returns an object, not an array,
 * so an array idiom either throws or passes over a `.length` of `undefined`. An incomplete walk
 * says what it could not see, and one that also found something says both.
 *
 * @param {...{ hits: Hit[], truncated: boolean, tooDeep: string[], unreadable: string[], complete: boolean }} scans
 * @returns {string}
 */
export function describeScan(...scans) {
  const cut = scans.map((scan) => whyIncomplete(scan)).filter((why) => why !== null)
  const found = describeHits(scans.flatMap((scan) => scan.hits))
  if (cut.length === 0) return found
  const stopped = `the walk did not finish, so it can only say it stopped looking: ${cut.join(' · ')}`
  return found === 'none' ? stopped : `${found} — and ${stopped}`
}

/**
 * The other direction, in one sentence: is everything of ours there? `'none'` (nothing missing)
 * only when every marker was found.
 *
 * {@link describeScan} asks whether anything of ours is somewhere it should not be, where a hit
 * is the finding. An isolation row also claims every session this run created is in the isolated
 * home, where the absence of a hit is the finding, and "I looked and it is not there" must not
 * read the same as "I could not look".
 *
 * Asymmetric on purpose: for a marker that was found, the walk's completeness is irrelevant (a hit
 * is proof, and failing over an early stop elsewhere would be a red nobody could act on).
 * Incompleteness is reported only beside a missing marker, whose absence the walk is not entitled
 * to assert.
 *
 * @param {{ hits: Hit[], truncated: boolean, tooDeep: string[], unreadable: string[], complete: boolean }} scan
 * @param {readonly Marker[]} markers
 * @returns {string}
 */
export function describeMissing(scan, markers) {
  requireMarkers(markers)
  const found = new Set(scan.hits.map((hit) => hit.label))
  const missing = markers.filter((marker) => !found.has(marker.label)).map((m) => m.label)
  if (missing.length === 0) return 'none'
  const why = whyIncomplete(scan)
  const named = `missing: ${missing.join(', ')}`
  return why === null
    ? named
    : `${named} — but the walk did not finish, so they are NOT known to be absent: ${why}`
}
