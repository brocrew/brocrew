import { openSync, readSync, closeSync, statSync } from 'node:fs'
import { z } from 'zod'
import { providerSchema, sessionStatusSchema } from '@brobot2/shared'
import { sessionRefSchema } from '@brobot2/runtime'
import { isPathSegment, PATH_SEGMENT_RULE, BUNDLE_SUFFIX } from '../../shared/runtime-ipc'
import type { SessionBundle } from './export-session'

/**
 * # ⛔ Reading a `.brobot-session.json` back in, and refusing one with a REASON (214 §1)
 *
 * `213`: *"Export succeeded and BroBot described it as a self-contained copy. The visible Import
 * actions only import provider-history messages; there was no bundle/file import action or picker
 * anywhere in the Sessions UI."* ⚑ **`011` proved the export is byte-identical and `027` proved the
 * frames arrive gap-free. The bytes were never the problem — nothing read them back.**
 *
 * ## ⚠️ Why this is a whole module rather than a `JSON.parse` at the call site
 *
 * ⛔ **A bundle is the only file in this app that a person can be SENT.** Every other input either
 * came from a provider we launched or from a directory we scanned; this one arrives by email, chat
 * or a shared drive, and the person pressing Import is telling us they trust the sender, not that
 * they have read 40 MB of JSON. So it is checked the way the IPC boundary is checked — against a
 * schema, once, at the door — and everything past this module holds a {@link SessionBundle} that
 * was validated rather than asserted.
 *
 * ⛔ **And a refusal must say what is wrong** (`086`, `118`). `194` M2's shape is the warning: a
 * half-understood file that is accepted anyway leaves a conversation that opens and is wrong. Every
 * `no` below carries a sentence a person can act on — this is not a bundle, this bundle is from a
 * newer BroBot, this file is too big to be one.
 *
 * ## What is NOT checked, deliberately
 *
 * The `ledger` entries are validated for SHAPE (`ordinal`, optional `at`, an `event` object with a
 * string `type`) and not for VOCABULARY. `TranscriptEvent` is a large union that grows every few
 * dispatches, and a bundle exported by a later build legitimately carries a variant this one has
 * never heard of — the renderer's fold already ends in a `default` that ignores what it cannot
 * place, and `unknown-payload-bound.test.ts` covers the size. ⚠️ **Refusing a whole conversation
 * because one row is from the future would be the opposite of what a transfer format is for.**
 */

/**
 * How large a file this will read, in bytes.
 *
 * ⛔ **A bound, because the file is a stranger's.** `053` made a gigabyte-scale export possible, so
 * a gigabyte-scale bundle exists — and the reader below takes the file into one string, which above
 * ~512 MB does not go slowly, it throws (`052`, `053`, the same wall twice already). A ceiling that
 * REFUSES with a sentence is strictly better than a heap error two minutes in, and it is
 * deliberately generous: 128 MB of pretty-printed JSON is a very long conversation.
 *
 * ⚠️ **This is the honest boundary of what 214 shipped, and the response doc says so.** Streaming a
 * bundle back in the way `writeBundleExport` streams one out is a real piece of work — it needs an
 * incremental JSON reader — and it is not what closes the loop. Nothing is silently truncated: past
 * this size the answer is `no`, with the size in it.
 */
export const MAX_BUNDLE_BYTES = 128 * 1024 * 1024

/**
 * The `meta` block, checked field by field.
 *
 * ⚠️ **`profileId` is `.nullable()` and NOT `.optional().nullable()` collapsed into a default.**
 * `188` §1 (from `168` L5) is the whole reason: an explicit `null` means *"this conversation lived
 * in the user's own home"* and a MISSING field means *"this bundle predates the field"*, and
 * `importBundle` still tells those apart. A schema that supplied a default here would erase the
 * difference before the code that respects it ever ran.
 */
const metaSchema = z.object({
  sessionId: z.string().min(1),
  provider: providerSchema,
  /**
   * ⛔ **Held to `sessionRefSchema`'s OWN rules, not to weaker ones.** `insertAdoptedRow` calls
   * `serializeSessionRef` as its first statement inside the import transaction, and that schema
   * requires `cwd.min(1)` and a non-negative integer `rotation`. A reader that accepted less handed
   * the store a value it throws on — and the throw surfaced as a raw Zod dump printed verbatim on
   * the Sessions page, breaking this module's own contract that *a refusal always carries the
   * sentence, never a code*.
   */
  ref: z.object({
    provider: providerSchema,
    sessionId: z.string().min(1),
    cwd: z.string().min(1),
    rotation: z.number().int().nonnegative().optional(),
  }),
  cwd: z.string().min(1),
  /**
   * 🔴 **A path segment, because this string BECOMES A DIRECTORY NAME.**
   *
   * `provider_session.profile_id` is what `session-store.ts` calls *"the free string, and the
   * directory name"*, and `ipc.ts` holds every renderer-supplied `profileId` to `isPathSegment`
   * saying in as many words that the rule must be the same everywhere. ⛔ **This reader was the one
   * entrance that skipped it** — and it is the entrance for the one file this module's own header
   * calls *"the only file in this app that a person can be SENT"*. Measured before the fix: a bundle
   * carrying `"profileId": "../../../../tmp/pwned"` was accepted, and the database afterwards held
   * an `agent_profile` row with that slug, durably, shown as the row's profile in the library.
   *
   * ⚠️ **A real escape was one guarantee away, not zero** — `deriveProviderHome` asserts the same
   * rule before it builds a path. That is a guarantee held one call downstream of the door it
   * belongs at, which is exactly the shape `071` and `203` exist to refuse.
   */
  profileId: z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`).nullable().optional(),
  status: sessionStatusSchema,
  adoptedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const bundleSchema = z.object({
  // Checked as a NUMBER here and for membership in `importBundle`, which owns the list of shapes it
  // can read and answers `unreadable bundle version: N` — a better sentence than a schema's.
  bundleVersion: z.number(),
  meta: metaSchema,
  raw: z.object({ format: z.string(), frames: z.array(z.string()) }),
  ledger: z.array(
    z.object({
      ordinal: z.number().int().nonnegative(),
      at: z.number().optional(),
      // See the module note: shape, not vocabulary — with the one exception below.
      event: z
        .object({ type: z.string().min(1) })
        .passthrough()
        .superRefine((event, ctx) => {
          /**
           * ⛔ **The two variants the STORE reads, checked here because it THROWS on them.**
           *
           * The tolerant `default` the module note leans on is in the RENDERER's fold — downstream
           * of `appendTx`, which calls `serializeSessionRef(event.ref)` on a `session` or
           * `conversation_reset` (`session-store.ts:1719`) and `.parse()`s it. A malformed one there
           * is a Zod dump reaching the Sessions page verbatim, which is precisely the *"a refusal
           * always carries the sentence, never a code"* contract this file states about itself.
           *
           * ⚠️ **Only these two, and deliberately.** Every other variant is genuinely inert on the
           * way in, and widening this to the whole union is what would make a bundle from a later
           * build unreadable — the thing a transfer format must not do.
           */
          if (event['type'] !== 'session' && event['type'] !== 'conversation_reset') return
          if (!sessionRefSchema.safeParse(event['ref']).success) {
            ctx.addIssue({
              code: 'custom',
              message: `a ${String(event['type'])} entry does not name a conversation this app can read`,
            })
          }
        }),
    }),
  ),
})

/** What the door answers. A refusal always carries the sentence, never a code. */
export type BundleRead = { ok: true; bundle: SessionBundle } | { ok: false; reason: string }

/**
 * Read and validate a bundle at `path`.
 *
 * Returns rather than throws: every outcome here is something a person did (picked the wrong file,
 * picked one from a newer build) and belongs on the surface that asked, not in a stack trace. The
 * one thing that DOES throw is unreachable-by-construction damage — see the catch.
 */
export function readBundleFile(path: string): BundleRead {
  let size: number
  try {
    const stats = statSync(path)
    if (!stats.isFile()) return { ok: false, reason: `that is not a file: ${path}` }
    size = stats.size
  } catch {
    return { ok: false, reason: `there is no file at ${path}` }
  }
  if (size === 0) return { ok: false, reason: 'that file is empty' }
  if (size > MAX_BUNDLE_BYTES) {
    return {
      ok: false,
      reason:
        `that file is ${Math.round(size / 1024 / 1024)} MB, and BroCrew reads bundles up to ` +
        `${MAX_BUNDLE_BYTES / 1024 / 1024} MB in one piece`,
    }
  }

  let text: string
  try {
    // ⚠️ **Opened once and read once, rather than `readFileSync` after `statSync`.** The size was
    // measured above and the ceiling was decided from it; re-opening by path would let a file that
    // passed the check be replaced by a larger one before it was read. Same discipline as
    // `writeStreamed`'s handle in `export-session.ts`, for the same reason.
    const fd = openSync(path, 'r')
    try {
      const buffer = Buffer.allocUnsafe(size)
      let read = 0
      while (read < size) {
        const got = readSync(fd, buffer, read, size - read, read)
        // A short read on a regular file means it shrank underneath us; stop rather than spin.
        if (got === 0) break
        read += got
      }
      text = buffer.subarray(0, read).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    return { ok: false, reason: `that file could not be read: ${path}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // ⛔ The commonest wrong file, and the sentence names what was expected rather than quoting a
    // parser at someone: `SyntaxError: Unexpected token < in JSON at position 0` is not a fact
    // about their file, it is a fact about ours.
    return { ok: false, reason: 'that is not a BroCrew session bundle — it is not even JSON' }
  }

  const result = bundleSchema.safeParse(parsed)
  if (!result.success) {
    const first = result.error.issues[0]
    const where = first && first.path.length > 0 ? ` (at ${first.path.join('.')})` : ''
    /**
     * ⛔ **Our own wording survives; Zod's does not** (214 §1, review).
     *
     * The generic sentence below is right for a structural miss — a missing `meta`, a string where a
     * number belongs — because Zod's message for those is type jargon about our types, which is a
     * fact about us and not about their file. ⚠️ **A `custom` issue is different**: it is a sentence
     * this module wrote on purpose, and dropping it was how *"a `session` entry does not name a
     * conversation this app can read"* came out as *"(at ledger.0.event)"* — a path, which tells a
     * person nothing they can act on.
     */
    if (first?.code === 'custom') {
      return { ok: false, reason: `that bundle cannot be read: ${first.message}` }
    }
    return {
      ok: false,
      reason: `that is not a BroCrew session bundle${where} — a bundle is the file Export writes, named …${BUNDLE_SUFFIX}`,
    }
  }
  // The cast is what the schema above BUYS: every field `SessionBundle` names has been checked, and
  // `event` is deliberately wider here than the union it will be read as — see the module note.
  const bundle = result.data as unknown as SessionBundle
  const disagreement = headerDisagreesWithLedger(bundle)
  if (disagreement !== null) return { ok: false, reason: disagreement }
  return { ok: true, bundle }
}

/**
 * 🔴 **Does this bundle contradict itself about WHICH conversation it is?** (214 §1)
 *
 * ⛔ **Found by the live smoke, on a file this dispatch built by hand.** Step `11c` synthesises "a
 * bundle from somewhere else" by rewriting `meta.ref.sessionId` — and the restored row came back
 * carrying the ORIGINAL id, because `session-store.ts`'s `appendTx` writes `external_ref` from the
 * ledger's own `session` / `conversation_reset` events (`:1718`). ⚑ **That is right**: the ledger is
 * the record of what the provider said, `meta` is a header, and when they disagree the record wins.
 *
 * ⚠️ **What is NOT right is what follows from it.** `importBundle` de-duplicates on
 * `meta.ref.sessionId` BEFORE the ledger is applied, so a bundle whose header names a conversation
 * we do not have and whose ledger names one we DO gets past the check, is written as a new row, and
 * then has its ref rewritten into a collision. ⛔ **Two rows, one provider ref** — and the library
 * keys its list on exactly that id, so one of them silently stops being listed. That is the
 * *"persists a ref without its referent"* family `194` M2 is about, arriving through the door this
 * dispatch opened, which is why it is closed in the same commit rather than recorded.
 *
 * ⛔ **Refused at the reader rather than repaired at the writer.** A bundle that disagrees with
 * itself is not a bundle, and *"is this a bundle"* is this module's whole question. Repairing it —
 * preferring one id over the other — would mean choosing, silently, which conversation a stranger's
 * file is about.
 *
 * ⚑ **The LAST such event, not all of them.** A conversation that reset (`199`) legitimately carries
 * several refs with different ids: that is what a reset IS. What must agree with the header is the
 * one the row ends up pointing at, which is the last one `appendTx` applies — and for every bundle
 * this app writes they agree by construction, because `exportSession` takes `meta.ref` off the row
 * that same event wrote.
 */
function headerDisagreesWithLedger(bundle: SessionBundle): string | null {
  let last: string | null = null
  for (const entry of bundle.ledger) {
    const event = entry.event as { type?: string; ref?: { sessionId?: unknown } }
    if (event.type !== 'session' && event.type !== 'conversation_reset') continue
    if (typeof event.ref?.sessionId === 'string') last = event.ref.sessionId
  }
  // ⚠️ A bundle whose ledger names no conversation at all is not a disagreement — an adopted or
  // derived session has no `session` event of ours, and refusing those would refuse most of them.
  if (last === null || last === bundle.meta.ref.sessionId) return null
  return (
    'that bundle disagrees with itself about which conversation it is — its header says ' +
    `${bundle.meta.ref.sessionId} and its own transcript ends on ${last}`
  )
}
