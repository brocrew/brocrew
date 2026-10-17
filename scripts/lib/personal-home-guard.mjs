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
 * How deep a personal home is walked.
 *
 * ⛔ **It was 6, and 6 did not reach most of either home** (196 M2). The comment justified it from
 * `~/.codex/sessions/YYYY/MM/DD/<file>`, which is 5 — true of the path this guard was written for
 * and of nothing else in the tree around it. Measured at 196 on this machine: at depth 6,
 * **156 directories under `~/.claude` and 1,627 under `~/.codex`** were never descended into, and
 * the scan reported `{ hits: [], truncated: false }` — indistinguishable from a clean home. Plugin
 * caches, marketplace checkouts and their `node_modules` all live below the old bound.
 *
 * ⚑ **The whole walk costs 113 ms and 204 ms respectively**, measured the same way, so the bound
 * was buying nothing. It is a loop guard now — deep enough that reaching it is a fact worth
 * reporting rather than the ordinary case — and {@link pathsNaming} reports it either way.
 */
export const DEFAULT_MAX_DEPTH = 64

/**
 * ⛔ **A scan with no markers finds nothing and proves nothing.**
 *
 * This throws rather than returning `[]` on purpose: an empty marker list is how a control of this
 * shape dies quietly — the caller's session id turns out to be `undefined`, every `expect` still
 * passes, and the file reads as coverage forever after (`129`'s trap, and the vacuous-test class
 * `113` audited). The same goes for a marker too short to be distinctive.
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
 * Every path under `root` whose NAME contains one of `markers`.
 *
 * Directory names count: a leaked Claude session shows up as
 * `projects/<sanitized-cwd>/<sessionId>.jsonl`, and the sanitized cwd is a marker in its own right
 * even before a transcript lands in it.
 *
 * ⚠️ **Symlinks are not followed.** A personal home contains links out to plugin checkouts and
 * worktrees; following them would walk half the disk and could loop. `withFileTypes` reports a link
 * as neither file nor directory, so it is named-and-skipped rather than descended into.
 *
 * ⛔ **It says when it STOPPED LOOKING, and until 188 it did not** (182 M8). The walk gives up at
 * `limit` hits, and the caller received an array that looks exactly like a complete one — so on a
 * machine with more than fifty matching paths, a leak later in the traversal was unexamined and the
 * step reporting on it was green. ⚑ **This is `176`'s own rule turned on the instrument that
 * enforces it**: "covered everything" and "stopped looking" must not read the same. The truncation
 * is now a value the caller has to receive, and both callers in `ui-live-smoke.mjs` fail on it.
 *
 * ⚠️ **Reported rather than thrown**, unlike `requireMarkers`: a vacuous marker list is always a
 * programming error, while hitting the cap is a fact about the machine the scan is running on — the
 * caller is the one that knows whether it can widen the limit or must fail.
 *
 * ⛔ **AND when it stopped for either of the other two reasons** (196 M2, from 193). `188` closed
 * the hit cap and left the other two exits silent: a walk that hit `maxDepth` returned, and a
 * directory that would not open returned, and both then reported `truncated: false`. A matching file
 * at `.claude/a/b/c/d/e/f/g/<session-id>.jsonl`, or one nested directory that happened to be
 * unreadable at that moment, produced `{ hits: [], truncated: false }` — the exact shape of a clean
 * machine. ⚑ **Three ways to stop early and one of them reported: that is the same defect as having
 * none.** All three are now values the caller receives, and `complete` is the single question worth
 * asking of them.
 *
 * ⚠️ **An unreadable directory is still not a FINDING** — the old comment was right that we could
 * not have written there either. It is a hole in the EVIDENCE, which is a different claim, and the
 * caller is the one that decides what to do about it.
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
      // ⚠️ **A directory that is not THERE is not a directory we failed to see.** An absent personal
      // home, or a path that vanished between the parent listing and this call, leaves nothing
      // unexamined — it is the cleanest possible answer. A directory that exists and will not open
      // is the opposite: it is a part of the home this scan did not see, and 196 M2 is that it used
      // to return exactly like the first case.
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
    // ⚑ The one question a caller should ask before believing an empty `hits`.
    complete: !truncated && tooDeep.length === 0 && unreadable.length === 0,
  }
}

/**
 * Why a scan is not complete, in one sentence — or `null` when it is.
 *
 * ⚠️ It names the FIRST few paths rather than counting them: "3 directories were unreadable" sends
 * nobody anywhere, and the point of the sentence is that a person can go and look.
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
 * The one sentence a leak assertion needs, over one or more walks: `'none'` **only** when every walk
 * FINISHED and none of them found anything.
 *
 * ⛔ **`describeHits(scan.hits)` is not that sentence, and 202 is why it is worth its own function.**
 * Nine TypeScript callers asked the question in eight slightly different ways, every one of them
 * against a declaration that said `pathsNaming` returned an array — so five threw on the line meant
 * to prove nothing leaked, and four passed over an object whose `.length` is `undefined`. The walk
 * has reported its own incompleteness since 196; what was missing was one idiom that cannot be
 * spelled in a way that ignores it. An incomplete walk says what it could not see, and an incomplete
 * walk that also found something says both.
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
 * The OTHER direction, in one sentence: **is everything of ours THERE?** `'none'` — nothing is
 * missing — only when every marker was found.
 *
 * ⛔ **`describeScan` cannot answer this and neither can a boolean** (206 H3, from 193's class).
 * {@link describeScan} asks *is anything of ours in a place it should not be*, where a hit is the
 * finding. An isolation row also has to make the opposite claim — *every session this run created is
 * in the isolated home* — and there the ABSENCE of a hit is the finding, which is precisely where
 * "I looked and it is not there" and "I could not look" stop being the same answer. A walk that
 * gave up at the hit cap, hit the depth bound, or met one unreadable directory returns the same
 * empty `hits` as a home that genuinely lacks the file.
 *
 * ⚑ **Asymmetric on purpose, and this is the load-bearing line.** For a marker that WAS found the
 * walk's completeness is irrelevant: a hit is proof, and failing the claim because the walk also
 * stopped early somewhere else would be a red nobody could act on (176's rule about measuring the
 * machine). Incompleteness is reported only where it bears on the answer — beside a marker that is
 * missing, whose absence the walk is not entitled to assert.
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
