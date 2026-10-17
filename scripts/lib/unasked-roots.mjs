import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Locate targets writable without approval under Codex's `workspace-write` and `on-request`
 * preset: the conversation folder and enabled temporary folders. Permission probes must
 * choose a target outside all of them to measure an actual request.
 *
 * Compare real paths of the nearest existing folders. A new target file cannot be realpathed,
 * and lexical fallback would misclassify aliases such as `/tmp` and redirected `$TMPDIR`.
 *
 * @param {string} path absolute path the probe will ask Codex to write
 * @param {string} cwd conversation working directory
 * @param {{ temporary?: readonly string[] }} [options] temporary folders, defaulting to the machine's
 * @returns {string | null} containing unasked-writable folder, or null for a target requiring approval
 */
export function writableUnasked(path, cwd, { temporary = [tmpdir(), '/tmp'] } = {}) {
  const target = realOfNearest(path)
  for (const root of [cwd, ...temporary]) {
    const rel = relative(realOfNearest(root), target)
    if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) return root
  }
  return null
}

/** The real path of `path`'s nearest existing ancestor, with the rest joined back on. */
function realOfNearest(path) {
  let head = resolve(path)
  const rest = []
  while (!existsSync(head)) {
    const up = dirname(head)
    if (up === head) break
    rest.unshift(basename(head))
    head = up
  }
  let real = head
  try {
    real = realpathSync(head)
  } catch {
    // ⚠️ an unreadable ancestor keeps its spelling — the comparison is then by the path as given
  }
  return rest.length === 0 ? real : join(real, ...rest)
}
