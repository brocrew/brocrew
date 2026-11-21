import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CodexRequestRefused } from './codex-transport'

/**
 * Whether Codex answered `thread/resume` because the thread is gone. `thread/resume` refuses with
 * JSON-RPC `-32600` for every failure, so the answer is read in full: the refusal must be the
 * app-server's ({@link CodexRequestRefused}, not a transport that could not ask), of `thread/resume`,
 * under that code, in one of two known sentences ("no rollout found for thread id <id>" or "failed to
 * resolve rollout path `<...-id.jsonl>`: file does not exist") naming this thread, and the home must
 * hold no rollout of it.
 *
 * Every doubt keeps the conversation: an unknown sentence, another code or thread id, a rollout on
 * disk (archived included; its "is archived" refusal is not read) or an unreadable directory
 * answers `false`. A reworded refusal therefore means never letting go, never forgetting. Re-run
 * `pnpm run probe:codex-lost-thread` when the bundled binary changes.
 */
export function codexNoLongerHasTheThread(
  error: unknown,
  threadId: string,
  providerHome: string,
): boolean {
  if (!(error instanceof CodexRequestRefused) || error.method !== 'thread/resume') return false
  if (!saysTheThreadIsGone(error.refusal, threadId)) return false
  return rolloutsOf(providerHome, threadId) === 'none'
}

/** The code Codex refuses every `thread/resume` with (JSON-RPC invalid request). */
const REFUSED_A_RESUME = -32600

/** The app-server's refusal, in one of the two known sentences, naming this thread. */
function saysTheThreadIsGone(refusal: unknown, threadId: string): boolean {
  if (typeof refusal !== 'object' || refusal === null) return false
  const { code, message } = refusal as { code?: unknown; message?: unknown }
  if (code !== REFUSED_A_RESUME || typeof message !== 'string') return false
  if (message === `no rollout found for thread id ${threadId}`) return true
  const path = /^failed to resolve rollout path `(.+)`: file does not exist$/.exec(message)?.[1]
  return path !== undefined && basename(path).includes(threadId)
}

/**
 * Whether `home` holds a rollout of the thread: `'none'` only when both trees Codex keeps rollouts
 * in were read and no entry names it. Anything unreadable is `'unknown'`; a missing tree is an answer
 * (a wiped home). Symlinks are not followed.
 */
function rolloutsOf(home: string, threadId: string): 'none' | 'some' | 'unknown' {
  const namesIt = (dir: string, root: boolean): boolean => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if (root && (error as { code?: unknown }).code === 'ENOENT') return false
      throw error
    }
    for (const entry of entries) {
      if (entry.name.includes(threadId)) return true
      if (entry.isDirectory() && namesIt(join(dir, entry.name), false)) return true
    }
    return false
  }
  try {
    const found =
      namesIt(join(home, 'sessions'), true) || namesIt(join(home, 'archived_sessions'), true)
    return found ? 'some' : 'none'
  } catch {
    return 'unknown'
  }
}
