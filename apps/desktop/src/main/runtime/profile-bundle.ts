import { lstatSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
import { BUNDLE_MARKER } from './factory-text'
import { publishOwnFile } from './workspace'

/**
 * 🔴 **Where each dialect's compiled leaf lives** (377, from `362`'s decision and `364` §2.3).
 *
 * ## ⛔ Codex — `AGENTS.override.md`, and it must be non-empty
 *
 * `362` §2 asked the bundled 0.146.0 provider directly for `thread/start.instructionSources` in
 * three disposable homes, and corrected the premise everyone had been working from:
 *
 * | planted | reported |
 * |---|---|
 * | profile `AGENTS.md` + NON-EMPTY profile `AGENTS.override.md` | only the override |
 * | profile `AGENTS.md` + EMPTY profile `AGENTS.override.md` | only `AGENTS.md` |
 *
 * ⛔ **The global pair is first-NONEMPTY**, so an empty override does not shadow — it falls
 * through. The header {@link bundleHeader} writes is what makes a bundle with no configured layer
 * and no project still non-empty, which is why it is not decoration.
 *
 * ⚠️ **The override takes the slot rather than leaving it open** (HO-016's ruling as `377` §6 cites
 * it): the app owns a file the provider reads FIRST, so a factory bundle cannot be silently replaced
 * by a profile `AGENTS.md` somebody drops in beside it.
 *
 * ## ⛔ Claude — a name of our own, and NOT `CLAUDE.md`
 *
 * `362` §1.1 measured that Claude's User memory leaf is exactly `<CLAUDE_CONFIG_DIR>/CLAUDE.md`, and
 * `instructions.ts` already reads that file as this profile's `profile-memory` — **the file the
 * AGENT writes.** ⛔ Publishing the bundle there would overwrite an agent's memory with app text
 * once a launch, which is the *"instruction drift"* HO-009 §2.2 forbids with the writer reversed.
 *
 * ⚑ **So Claude gets a leaf the provider does not read natively at all**, which is safe precisely
 * because `claude-runtime.ts` keeps `settingSources: []` — `364` §2.2 measured what enabling one
 * imports, and it is executable configuration rather than prose. The app reads this file back
 * through the same guarded reader and appends it through the preset, which is the route `362` §1.2
 * measured a live child quoting.
 */
export const BUNDLE_LEAF: Readonly<Record<Provider, string>> = {
  codex: 'AGENTS.override.md',
  claude: 'brobot-instructions.md',
}

/**
 * ⛔ **Enough of the file to answer *is this ours*, and not one byte more.**
 *
 * ⚠️ **A bounded read and not `readFileSync`.** This runs on every launch against a path inside a
 * home the workload itself can write, so the file may be arbitrarily large — reading it whole to
 * compare its first sixty characters would let anything in that directory decide how much memory
 * this process spends. `362` had the same instinct one layer down: the instruction reader caps
 * every file it opens.
 */
const MARKER_PROBE_BYTES = 256

/**
 * 🔴 **What publishing did** — a path, or a refusal a person can act on.
 *
 * ⛔ **A returned value rather than a throw**, which is `341`'s shape for a rail and the reason it
 * is right here too: a launch does not fail because somebody owns their own override file. It
 * proceeds, the provider reads THEIR file, and the person is told that ours was not published.
 */
export type BundlePublish =
  | { readonly ok: true; readonly path: string; readonly bytes: number }
  | { readonly ok: false; readonly path: string; readonly reason: 'unmanaged-override' }

/**
 * ⛔ **Is the file at this path one this app wrote?** — by its first line, and by nothing else.
 *
 * ⚠️ **`lstat` first, and a symlink is NOT ours.** A link at the leaf would make the marker read
 * come from wherever it points, so a planted link to a file whose first line happens to carry the
 * marker would license `rename` over the link's own name. `publishOwnFile` replaces the NAME rather
 * than writing through it, so the link's target is never written — but answering *"ours"* here would
 * still delete a person's link without telling them, which is the silence HO-016 named.
 *
 * ⚑ **Absent is OURS**, in the sense that matters: there is nothing to disagree with, so the
 * publish proceeds. That is the ordinary case on every first launch.
 */
function isOurs(path: string): boolean {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return true // absent — nothing to overwrite
  }
  if (!stat.isFile()) return false
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    // ⛔ **Unreadable is NOT ours.** A file this app cannot open is one it cannot claim, and the
    // narrow direction here is to leave it alone and say so.
    return false
  }
  try {
    const buffer = Buffer.alloc(MARKER_PROBE_BYTES)
    const read = readSync(fd, buffer, 0, MARKER_PROBE_BYTES, 0)
    return buffer.subarray(0, read).toString('utf8').startsWith(BUNDLE_MARKER)
  } catch {
    return false
  } finally {
    try {
      closeSync(fd)
    } catch {
      // nothing was written; a failed close cannot make the answer wrong
    }
  }
}

/**
 * 🔴 **Put this launch's compiled bundle in the provider home, or refuse to** (377).
 *
 * ⛔ **Called on every fresh start AND every cold resume**, which is the live-profile semantic `158`
 * §2 ruled for the reader and which `362` §1.3 measured on a real Claude child: rewriting the leaf
 * between close and resume changed the child's answer on the same provider session id. ⚠️ It does
 * NOT reach an already-live handle's next turn, and no surface may imply that it does.
 *
 * ⚑ **Idempotent by construction** — the whole file is derived from typed context, so re-publishing
 * the same launch writes the same bytes. It is written unconditionally rather than compared first,
 * because the compare would have to read a file the workload can rewrite between the read and the
 * rename, and the write is one `rename` either way.
 *
 * 🔴 **D-024 · R1 — and the same bytes for every conversation of the profile.** The file carries
 * only what is true of the profile — the factory rules its grants choose and the person's own text
 * — so a sibling's launch, or a person's look at a conversation, rewrites it with what it already
 * says. ⛔ What is true of one conversation never lands here; it rides that launch alone.
 */
export function publishProfileBundle(
  provider: Provider,
  providerHome: string,
  text: string,
): BundlePublish {
  const name = BUNDLE_LEAF[provider]
  const path = join(providerHome, name)
  if (!isOurs(path)) return { ok: false, path, reason: 'unmanaged-override' }
  // ⚠️ **"this profile's own folder" and NOT the repo's word for it** (151, 169 §2). The
  // internal name is accurate and belongs in comments; a sentence a person reads on a failed
  // publish must name a folder rather than a concept nobody outside this repository has met.
  publishOwnFile(providerHome, name, text, 'this profile’s own folder')
  return { ok: true, path, bytes: Buffer.byteLength(text, 'utf8') }
}
