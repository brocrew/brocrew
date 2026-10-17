import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CodexRequestRefused } from './codex-transport'

/**
 * # 🔴 706 · a thread Codex no longer has — told BY WHAT IT IS (`705` F-3)
 *
 * ⚑ **Measured, `probe:codex-lost-thread`, bundled `codex-cli 0.146.0`** — what `thread/resume` is
 * answered with when the thread is gone, and beside it what a failure of the attempt looks like:
 *
 * | the thread | the answer |
 * |---|---|
 * | an id the home never had | `{"code":-32600,"message":"no rollout found for thread id <id>"}` |
 * | a home wiped under it | the same |
 * | its rollout file deleted, its state row left | `{"code":-32600,"message":"failed to resolve rollout path \`<…-<id>.jsonl>\`: file does not exist"}` |
 * | ⛔ an app-server that died as it was asked | no answer at all — the transport's `codex app-server exited` |
 *
 * ⛔ **The code says nothing on its own**: `-32600` is JSON-RPC's *invalid request*, the one code
 * Codex gives every refusal of `thread/resume`. ⚑ So the answer is read in full — the refusal must
 * be the app-server's (a {@link CodexRequestRefused}, never a transport that could not ask), of
 * `thread/resume`, under that code, in one of the two measured sentences, **about the thread this
 * resume named** — and then asked of the disk: the home must hold NO rollout of it. ⚑ **That second
 * question is Claude's own** (`defaultSessionExists` asks every project folder, and only the kernel's
 * absence is one), asked here only after the provider has answered.
 *
 * ⚠️ **An ARCHIVED rollout counts as on disk, on purpose** — `thread/unarchive` brings the thread back,
 * and nothing in this app archives one; its refusal words (*"… is archived"*) are not read here, so
 * such a conversation is kept, the direction a doubt must err in (the `706` review).
 *
 * 🔴 **Every doubt keeps the conversation** — the ruling's other half: *"a transient failure must
 * never make the app forget a conversation."* A sentence this file does not know, a code that
 * differs, another thread's id, a rollout still on disk, a directory that could not be read: each
 * answers `false`, and the next press asks again. ⚠️ **A Codex that rewords its refusal therefore
 * regresses to *never let go*, never to *forgets*** — re-run `pnpm run probe:codex-lost-thread` when
 * the bundled binary moves (its assertions name this function's answer for every arm).
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

/** ⚑ The one code `0.146.0` refused every `thread/resume` with, measured — *invalid request*. */
const REFUSED_A_RESUME = -32600

/** The app-server's refusal, in one of the two measured sentences, naming THIS thread. */
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
 * in were READ and no entry names it. ⛔ Anything that could not be read is `'unknown'`, never
 * `'none'` — and a tree that does not exist is the one absence that IS an answer (a wiped home).
 * ⚑ Symlinks are not followed (`Dirent.isDirectory()` is false for one), so the walk ends.
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
