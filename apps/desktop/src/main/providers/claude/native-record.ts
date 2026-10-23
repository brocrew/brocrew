import { closeSync, existsSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { claudeTranscriptPath, type SessionRef } from '@brobot2/runtime'

/** How far back {@link newestReplyModel} reads before it says it found none. */
const REPLY_MODEL_BUDGET_BYTES = 4 * 1024 * 1024

/**
 * ⚑ **W4.203 · the model Claude Code recorded on the newest reply of its own transcript** — the
 * `message.model` of the last `assistant` line, read back from the end of the file a page at a
 * time — or `null` when none is found within {@link REPLY_MODEL_BUDGET_BYTES}. ⛔ A reply of the
 * CLI's own making (`<synthetic>`: an error it reports as a reply) and a line of one of its own
 * sub-agents (`isSidechain`) do not count. ⚠️ Read only, and for Claude's transcripts only.
 */
export function newestReplyModel(path: string): string | null {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const stop = Math.max(0, size - REPLY_MODEL_BUDGET_BYTES)
    /**
     * The pages, in file order, of the line read so far without the break before it: a line not
     * yet whole. ⚑ Kept as pages and joined once, so one long line is not copied again per page.
     */
    let carried: Buffer[] = []
    let from = size
    const modelOf = (line: string): string | null => {
      // ⚑ Most lines are not replies, and some are large: only one that names a model is parsed.
      if (!line.includes('"model"')) return null
      try {
        const entry = JSON.parse(line) as {
          type?: unknown
          isSidechain?: unknown
          message?: { model?: unknown }
        }
        if (entry.type !== 'assistant' || entry.isSidechain === true) return null
        const model = entry.message?.model
        return typeof model === 'string' && model !== '' && model !== '<synthetic>' ? model : null
      } catch {
        return null
      }
    }
    while (from > stop) {
      const start = Math.max(stop, from - 64 * 1024)
      const chunk = Buffer.alloc(from - start)
      readSync(fd, chunk, 0, chunk.length, start)
      from = start
      // ⚑ The bytes before this page's first line break may begin mid-line — and mid-character —
      // unless the page starts the file: they wait, as bytes, for the page before it. ⚑ The break
      // is looked for in this page alone: what is carried has none, by construction.
      const firstBreak = start === 0 ? -1 : chunk.indexOf(0x0a)
      if (start !== 0 && firstBreak === -1) {
        carried = [chunk, ...carried]
        continue
      }
      const whole = Buffer.concat([chunk.subarray(firstBreak + 1), ...carried])
      carried = start === 0 ? [] : [chunk.subarray(0, firstBreak)]
      const lines = whole.toString('utf8').split('\n')
      for (let at = lines.length - 1; at >= 0; at -= 1) {
        const model = modelOf(lines[at] ?? '')
        if (model !== null) return model
      }
    }
    // ⚑ The whole file was read, or the budget ran out before a reply was found.
    return null
  } finally {
    closeSync(fd)
  }
}

export function nativePath(home: string, ref: SessionRef): string | null {
  const found = claudeTranscriptPath(ref.sessionId, ref.cwd, home)
  return found !== null && existsSync(found) ? found : null
}
export function ownsRecord(home: string, file: string): boolean {
  const real = (one: string): string => {
    try {
      return realpathSync.native(one)
    } catch {
      return resolve(one)
    }
  }
  const resolved = real(file)
  return resolved.startsWith(join(real(home), 'projects') + sep) && resolved.endsWith('.jsonl')
}
